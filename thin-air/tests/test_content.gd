extends TestCase
## Content autoload + the Android Lite preset (small APK that downloads its media on first launch).
## The download itself is exercised against a local server on an exported Linux Lite build
## (tools/release/content_server.py; see README "Building from source").

const PRESETS := "res://export_presets.cfg"

## Files the Lite build needs before its media pack exists: boot, main menu hand-off, download screen, theme.
const BOOT_FILES := [
	"src/autoload/content.gd", "src/autoload/terrain_data.gd", "src/autoload/audio.gd",
	"scenes/main.tscn", "scenes/ui/main_menu.tscn", "scenes/ui/content_download.tscn",
	"src/ui/menus/content_download.gd", "src/ui/ui_theme.gd", "assets/ui/theme.tres",
	"assets/fonts/IBMPlexSans-Regular.ttf", "assets/fonts/IBMPlexSans-Light.ttf",
	"assets/fonts/IBMPlexSans-Medium.ttf", "assets/fonts/IBMPlexSans-SemiBold.ttf",
	"assets/fonts/IBMPlexMono-Medium.ttf", "assets/audio/bus_layout.tres",
	"data/content_manifest.json", "data/items.json", "data/story.json",
	"assets/models/poi/shaders/poi_surface.gdshader",
]
## The heavy media the Lite build must leave out (or it won't fit under 30 MB).
const HEAVY_FILES := [
	"assets/terrain/height.f32", "assets/terrain/normal.png", "assets/textures/terrain/terrain_albedo_height.png",
	"assets/textures/foliage/impostor_albedo.webp", "assets/audio/music/alpine.ogg",
	"assets/models/fauna/wolf.glb", "assets/icons/axe.png", "assets/ui/loading_vista.jpg",
	"scenes/player/textures/map_albedo.jpg",
]


func run() -> void:
	check(Content.available and not Content.needs_download(), "full (editor) build: media available, no download")
	check(not OS.has_feature(Content.FEATURE), "editor build does not carry the content_download feature")
	check(Content.get_index() == 0, "Content is the first autoload (mounts the pack before the others load)")
	check(Content.finish(), "finish() is a no-op success when media are built in")
	check(Content.size_text() != "", "size_text() always has a label")

	var m: Variant = JSON.parse_string(FileAccess.get_file_as_string(Content.MANIFEST_PATH))
	check(m is Dictionary and m.has("id") and m.has("size") and m.has("sha256") and m.has("urls"),
		"data/content_manifest.json has id/size/sha256/urls (CI fills it)")

	var cfg := ConfigFile.new()
	check(cfg.load(PRESETS) == OK, "export_presets.cfg loads")
	var lite := ""
	var full := ""
	for sec in cfg.get_sections():
		if sec.count(".") != 1:
			continue
		match String(cfg.get_value(sec, "name", "")):
			"Android Lite": lite = sec
			"Android": full = sec
	check(lite != "" and full != "", "Android and Android Lite presets exist")
	if lite == "" or full == "":
		return
	check(String(cfg.get_value(lite, "custom_features", "")).contains(Content.FEATURE),
		"Android Lite carries the content_download feature")
	check(bool(cfg.get_value(lite + ".options", "permissions/internet", false)),
		"Android Lite asks for the INTERNET permission")
	check(String(cfg.get_value(lite + ".options", "package/unique_name", "")) ==
		String(cfg.get_value(full + ".options", "package/unique_name", "")), "Lite and full APKs are the same app")
	var excl: PackedStringArray = []
	for p in String(cfg.get_value(lite, "exclude_filter", "")).split(","):
		if p.strip_edges() != "":
			excl.append(p.strip_edges())
	var needed_out: Array[String] = []
	for f in BOOT_FILES:
		check(FileAccess.file_exists("res://" + f), "boot file exists: " + f)
		if _excluded(f, excl):
			needed_out.append(f)
	check(needed_out.is_empty(), "Lite build keeps every boot file %s" % [needed_out])
	var heavy_in: Array[String] = []
	for f in HEAVY_FILES:
		if not _excluded(f, excl):
			heavy_in.append(f)
	check(heavy_in.is_empty(), "Lite build leaves the heavy media out %s" % [heavy_in])


static func _excluded(path: String, patterns: PackedStringArray) -> bool:
	for p in patterns:
		if path.matchn(p) or ("res://" + path).matchn(p):
			return true
	return false
