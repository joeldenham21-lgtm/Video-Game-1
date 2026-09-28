extends Node
## Content — the game's media for the small Android build ("Android Lite", custom feature `content_download`).
## CONTRACT.md §3.
##
## The Lite APK ships code, data, fonts and the UI theme only, so it fits under 30 MB. Textures, models, audio
## and the terrain are one pack (ThinAir-content.pck) on a GitHub release, described by
## data/content_manifest.json (written by CI at export time: tools/release/content_manifest.py). This autoload
## is FIRST in the list: its _init mounts a downloaded pack before any other autoload loads, so a second launch
## is an ordinary boot. On the first launch the main menu hands over to the download screen
## (scenes/ui/content_download.tscn), which calls download(); finish() then mounts the pack and reloads what the
## other autoloads read at startup. The download is fetched in ranged chunks, so an interrupted one (network
## drop, app closed) resumes where it stopped.
##
## Builds without the feature (desktop, the full APK) carry everything: available is true and nothing runs.
## Testing on desktop: the "Linux Lite" preset, and `-- --content-manifest=/abs/path.json` to point at a test
## server (see tools/release/content_server.py).

signal progress(done: int, total: int)
signal failed(message: String)
signal verified()

enum State { IDLE, DOWNLOADING, VERIFYING, READY, FAILED }

const FEATURE := "content_download"
const MANIFEST_PATH := "res://data/content_manifest.json"
const DOWNLOAD_SCENE := "res://scenes/ui/content_download.tscn"
const DIR := "user://content/"
const PACK_PATH := DIR + "ThinAir-content.pck"
const STAMP_PATH := DIR + "installed.json"
const PART_PATH := DIR + "download.part"
const PART_META_PATH := DIR + "download.json"
const CHUNK_PATH := DIR + "chunk.tmp"
const CHUNK_BYTES := 16 * 1024 * 1024
const STALL_SECONDS := 30.0
const MAX_RETRIES := 6

var available := false            ## media present: built in, or the pack is mounted
var manifest: Dictionary = {}
var state: State = State.IDLE
var error_message := ""
var total := 0
var done := 0                     ## bytes on disk + bytes of the chunk in flight

var _req: HTTPRequest = null
var _url_i := 0
var _retries := 0
var _chunk_from := 0
var _chunk_to := 0
var _last_bytes := -1
var _stall_t := 0.0
var _retry_t := -1.0
var _verify_thread: Thread = null


func _init() -> void:
	if not OS.has_feature(FEATURE):
		available = true
		return
	manifest = _read_manifest()
	total = int(manifest.get("size", 0))
	var stamp := _read_json(STAMP_PATH)
	var current := String(stamp.get("id", "")) == String(manifest.get("id", "")) or String(manifest.get("id", "")) == ""
	if current and FileAccess.file_exists(PACK_PATH) and _file_len(PACK_PATH) == int(stamp.get("size", -1)):
		available = ProjectSettings.load_resource_pack(PACK_PATH, false)
		if not available:
			push_warning("Content: %s would not mount — downloading again" % PACK_PATH)
			DirAccess.remove_absolute(STAMP_PATH)
	if available:
		state = State.READY
		var t0 := Time.get_ticks_usec()
		var n := _register_uids()
		print("[Content] mounted %s (%s, %d uids in %.0f ms)" % [PACK_PATH, stamp.get("id", "?"), n,
			(Time.get_ticks_usec() - t0) / 1000.0])


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_process(false)


## True on the Lite build until the pack is downloaded and mounted.
func needs_download() -> bool:
	return not available


## Human-readable size of the download, e.g. "356 MB".
func size_text() -> String:
	return "%d MB" % roundi(total / 1e6) if total > 0 else "a few hundred MB"


## Starts (or resumes) the download. Safe to call again after a failure.
func download() -> void:
	if available or state == State.DOWNLOADING or state == State.VERIFYING:
		return
	var urls: Array = manifest.get("urls", [])
	if urls.is_empty() or total <= 0:
		_fail("This build doesn't say where to download the game's content from.")
		return
	DirAccess.make_dir_recursive_absolute(DIR)
	var meta := _read_json(PART_META_PATH)
	if String(meta.get("id", "")) != String(manifest.get("id", "")) or int(meta.get("size", -1)) != total \
			or _file_len(PART_PATH) > total:
		DirAccess.remove_absolute(PART_PATH)
		_write_json(PART_META_PATH, {"id": manifest.get("id", ""), "size": total})
	if _req == null:
		_req = HTTPRequest.new()
		_req.use_threads = true
		_req.accept_gzip = false
		_req.max_redirects = 8
		_req.request_completed.connect(_on_chunk)
		add_child(_req)
	state = State.DOWNLOADING
	error_message = ""
	_retries = 0
	_retry_t = -1.0
	set_process(true)
	_next_chunk()


func _process(delta: float) -> void:
	if state != State.DOWNLOADING:
		if state == State.VERIFYING and _verify_thread and not _verify_thread.is_alive():
			_verified(_verify_thread.wait_to_finish())
			_verify_thread = null
		return
	if _retry_t >= 0.0:
		_retry_t -= delta
		if _retry_t < 0.0:
			_next_chunk()
		return
	var b := _req.get_downloaded_bytes()
	if b != _last_bytes:
		_last_bytes = b
		_stall_t = 0.0
		done = _chunk_from + b
		progress.emit(done, total)
	else:
		_stall_t += delta
		if _stall_t > STALL_SECONDS:
			_req.cancel_request()
			_retry("the connection stalled")


func _next_chunk() -> void:
	var have := _file_len(PART_PATH)
	done = have
	progress.emit(done, total)
	if have >= total:
		_verify()
		return
	_chunk_from = have
	_chunk_to = mini(have + CHUNK_BYTES, total) - 1
	_last_bytes = -1
	_stall_t = 0.0
	_req.download_file = CHUNK_PATH
	var url := String(manifest["urls"][_url_i % manifest["urls"].size()])
	var headers := PackedStringArray(["Range: bytes=%d-%d" % [_chunk_from, _chunk_to],
		"User-Agent: ThinAir/%s" % ProjectSettings.get_setting("application/config/version", "0.1"),
		"Accept: application/octet-stream"])
	var err := _req.request(url, headers)
	if err != OK:
		_retry("couldn't start the request (%s)" % error_string(err))


func _on_chunk(result: int, code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	if state != State.DOWNLOADING:
		return
	if result != HTTPRequest.RESULT_SUCCESS:
		_retry(_result_text(result))
		return
	var got := _file_len(CHUNK_PATH)
	var want := _chunk_to - _chunk_from + 1
	if code == 206 and got == want:
		_append_chunk()
	elif code == 200 and _chunk_from == 0 and got == total:
		# the server ignored the range and sent the whole file in one go
		DirAccess.remove_absolute(PART_PATH)
		DirAccess.rename_absolute(CHUNK_PATH, PART_PATH)
	elif code == 416:
		DirAccess.remove_absolute(PART_PATH)      # our partial file doesn't match the server's: start over
		_retry("the server rejected the resume point")
		return
	elif code == 404 or code == 403 or code == 410:
		_url_i += 1                                # try the next mirror; each gets the retry budget
		if _url_i >= manifest["urls"].size():
			_fail("The game's content isn't on the server any more (HTTP %d). Install the latest THIN AIR app." % code)
			return
		_retry("HTTP %d, trying the next source" % code)
		return
	else:
		_retry("HTTP %d (%d of %d bytes)" % [code, got, want])
		return
	DirAccess.remove_absolute(CHUNK_PATH)
	_retries = 0
	_next_chunk()


func _append_chunk() -> void:
	var src := FileAccess.open(CHUNK_PATH, FileAccess.READ)
	var dst: FileAccess
	if FileAccess.file_exists(PART_PATH):
		dst = FileAccess.open(PART_PATH, FileAccess.READ_WRITE)
	else:
		dst = FileAccess.open(PART_PATH, FileAccess.WRITE)
	if src == null or dst == null:
		_fail("Couldn't write to the phone's storage (%s). Free some space and try again." %
			error_string(FileAccess.get_open_error()))
		return
	dst.seek_end()
	while src.get_position() < src.get_length():
		dst.store_buffer(src.get_buffer(1 << 20))
	dst.close()
	src.close()


func _retry(reason: String) -> void:
	_retries += 1
	if _retries > MAX_RETRIES:
		_fail("The download keeps failing (%s). Check the connection and try again — it will resume." % reason)
		return
	push_warning("Content: %s — retry %d/%d" % [reason, _retries, MAX_RETRIES])
	_retry_t = minf(pow(2.0, _retries - 1), 20.0)


func _fail(message: String) -> void:
	state = State.FAILED
	error_message = message
	set_process(false)
	push_warning("Content: " + message)
	failed.emit(message)


func _verify() -> void:
	state = State.VERIFYING
	var expect := String(manifest.get("sha256", ""))
	if expect == "":
		_verified("")
		return
	_verify_thread = Thread.new()      # hashing a few hundred MB takes a second or two: keep the UI drawing
	_verify_thread.start(func() -> String: return FileAccess.get_sha256(PART_PATH))


func _verified(sha: String) -> void:
	var expect := String(manifest.get("sha256", ""))
	if expect != "" and sha != expect:
		DirAccess.remove_absolute(PART_PATH)
		state = State.IDLE
		_fail("The download was damaged on the way. Try again.")
		return
	DirAccess.remove_absolute(PACK_PATH)
	var err := DirAccess.rename_absolute(PART_PATH, PACK_PATH)
	if err != OK:
		_fail("Couldn't save the download (%s)." % error_string(err))
		return
	DirAccess.remove_absolute(PART_META_PATH)
	_write_json(STAMP_PATH, {"id": manifest.get("id", ""), "size": _file_len(PACK_PATH)})
	state = State.READY
	set_process(false)
	verified.emit()


## Mounts the verified pack and reloads what the other autoloads read at startup. Returns false if the pack
## wouldn't mount (it's deleted so the next launch downloads it again).
func finish() -> bool:
	if available:
		return true
	if not ProjectSettings.load_resource_pack(PACK_PATH, false):
		DirAccess.remove_absolute(PACK_PATH)
		DirAccess.remove_absolute(STAMP_PATH)
		state = State.IDLE
		_fail("The download wouldn't open. Try again.")
		return false
	available = true
	var n := _register_uids()
	var td := get_node_or_null(^"/root/TerrainData")
	if td and td.has_method(&"load_data"):
		td.call(&"load_data")
	var audio := get_node_or_null(^"/root/Audio")
	if audio and audio.get(&"catalog") != null:
		audio.get(&"catalog").warm_up()
	print("[Content] downloaded and mounted %s (%s, %d uids)" % [PACK_PATH, manifest.get("id", "?"), n])
	return true


## The Lite build's own UID cache only knows the files it ships, so scenes that reference media by uid:// would
## fall back to their text paths (with a warning per reference). Register the pack's media under their UIDs.
func _register_uids() -> int:
	var n := 0
	var stack: Array[String] = ["res://assets", "res://scenes"]
	while not stack.is_empty():
		var dir := stack.pop_back() as String
		for d in DirAccess.get_directories_at(dir):
			stack.append(dir.path_join(d))
		for f in DirAccess.get_files_at(dir):
			if not (f.ends_with(".import") or f.ends_with(".remap")):
				continue
			# exported .import files keep the uid in [remap]; converted text resources (.remap) keep it in the
			# binary they point to
			var cf := ConfigFile.new()
			if cf.load(dir.path_join(f)) != OK:
				continue
			var id := ResourceUID.INVALID_ID
			if f.ends_with(".import"):
				id = ResourceUID.text_to_id(String(cf.get_value("remap", "uid", "")))
			else:
				id = ResourceLoader.get_resource_uid(String(cf.get_value("remap", "path", "")))
			var path := dir.path_join(f.get_basename())
			if id != ResourceUID.INVALID_ID and not ResourceUID.has_id(id):
				ResourceUID.add_id(id, path)
				n += 1
	return n


func _read_manifest() -> Dictionary:
	var path := MANIFEST_PATH
	for a in Array(OS.get_cmdline_args()) + Array(OS.get_cmdline_user_args()):
		if String(a).begins_with("--content-manifest="):
			path = String(a).get_slice("=", 1)
	return _read_json(path)


static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return d if d is Dictionary else {}


static func _write_json(path: String, d: Dictionary) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(d))


static func _file_len(path: String) -> int:
	if not FileAccess.file_exists(path):
		return 0
	var f := FileAccess.open(path, FileAccess.READ)
	return f.get_length() if f else 0


static func _result_text(result: int) -> String:
	match result:
		HTTPRequest.RESULT_CANT_CONNECT, HTTPRequest.RESULT_CANT_RESOLVE:
			return "no connection to the server"
		HTTPRequest.RESULT_CONNECTION_ERROR:
			return "the connection dropped"
		HTTPRequest.RESULT_TLS_HANDSHAKE_ERROR:
			return "a secure connection couldn't be made"
		HTTPRequest.RESULT_TIMEOUT:
			return "the server stopped answering"
		HTTPRequest.RESULT_DOWNLOAD_FILE_CANT_OPEN, HTTPRequest.RESULT_DOWNLOAD_FILE_WRITE_ERROR:
			return "the phone's storage is full or not writable"
		HTTPRequest.RESULT_REDIRECT_LIMIT_REACHED:
			return "too many redirects"
	return "network error %d" % result
