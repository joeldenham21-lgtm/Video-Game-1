extends Node
## Static item / recipe / buildable data loaded from data/*.json. CONTRACT.md §3, §6.

const ITEMS_PATH := "res://data/items.json"
const RECIPES_PATH := "res://data/recipes.json"
const BUILDABLES_PATH := "res://data/buildables.json"
const FALLBACK_ICON := "res://assets/icons/_unknown.png"

var items: Dictionary = {}        # StringName -> Dictionary
var recipes: Array[Dictionary] = []
var recipes_by_id: Dictionary = {}
var buildables: Dictionary = {}
var _icon_cache: Dictionary = {}


func _ready() -> void:
	reload()


func reload() -> void:
	items.clear(); recipes.clear(); recipes_by_id.clear(); buildables.clear()
	var raw_items: Variant = _read_json(ITEMS_PATH)
	if raw_items is Dictionary:
		for k in raw_items:
			var d: Dictionary = raw_items[k]
			d["id"] = StringName(k)
			items[StringName(k)] = d
	var raw_recipes: Variant = _read_json(RECIPES_PATH)
	if raw_recipes is Array:
		for r in raw_recipes:
			if r is Dictionary:
				recipes.append(r)
				recipes_by_id[StringName(r.get("id", r.get("result", "")))] = r
	var raw_build: Variant = _read_json(BUILDABLES_PATH)
	if raw_build is Dictionary:
		for k in raw_build:
			var b: Dictionary = raw_build[k]
			b["id"] = StringName(k)
			buildables[StringName(k)] = b


func get_item(id: StringName) -> Dictionary:
	return items.get(id, {})


func has_item(id: StringName) -> bool:
	return items.has(id)


func all_items() -> Array[StringName]:
	var out: Array[StringName] = []
	for k in items:
		out.append(k)
	return out


func get_recipe(id: StringName) -> Dictionary:
	return recipes_by_id.get(id, {})


func recipes_for_station(station: StringName) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for r in recipes:
		if StringName(r.get("station", "hand")) == station:
			out.append(r)
	return out


func get_buildable(id: StringName) -> Dictionary:
	return buildables.get(id, {})


func all_buildables() -> Array[StringName]:
	var out: Array[StringName] = []
	for k in buildables:
		out.append(k)
	return out


func get_icon(id: StringName) -> Texture2D:
	if _icon_cache.has(id):
		return _icon_cache[id]
	var path: String = get_item(id).get("icon", "")
	if path == "":
		path = get_buildable(id).get("icon", "")
	var tex: Texture2D = null
	if path != "" and ResourceLoader.exists(path):
		tex = load(path)
	elif ResourceLoader.exists(FALLBACK_ICON):
		tex = load(FALLBACK_ICON)
	_icon_cache[id] = tex
	return tex


func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if parsed == null:
		push_error("ItemDB: invalid JSON in %s" % path)
	return parsed
