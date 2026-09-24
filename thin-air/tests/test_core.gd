extends TestCase
## Core smoke tests: autoloads present, Inventory logic, SaveUtil.


func run() -> void:
	for n in ["Events", "Settings", "ItemDB", "TerrainData", "Climate", "Game", "Audio", "Save", "Story"]:
		check(get_tree().root.has_node(n), "autoload " + n)
	# Inject two test items so Inventory can be exercised without data files.
	ItemDB.items[&"_t_stick"] = {"id": &"_t_stick", "stack": 10, "weight": 0.5}
	ItemDB.items[&"_t_axe"] = {"id": &"_t_axe", "stack": 1, "weight": 1.5}
	var inv := Inventory.new(4, 10.0)
	check(inv.add(&"_t_stick", 15) == 0, "add 15 sticks into 2 stacks")
	check(inv.count(&"_t_stick") == 15, "count 15")
	check(inv.free_slots() == 2, "two free slots")
	check(inv.add(&"_t_axe", 3) == 1, "only 2 axes fit")
	check(not inv.remove(&"_t_stick", 16), "remove too many fails")
	check(inv.remove(&"_t_stick", 12) and inv.count(&"_t_stick") == 3, "remove 12")
	check(is_equal_approx(inv.total_weight(), 3 * 0.5 + 2 * 1.5), "weight")
	var d := inv.to_dict()
	var inv2 := Inventory.new(4)
	inv2.from_dict(JSON.parse_string(JSON.stringify(d)))
	check(inv2.count(&"_t_axe") == 2 and inv2.count(&"_t_stick") == 3, "roundtrip")
	check(inv.has_all({"_t_stick": 3, "_t_axe": 1}), "has_all")
	check(SaveUtil.to_v3(SaveUtil.v3(Vector3(1, 2, 3))).is_equal_approx(Vector3(1, 2, 3)), "SaveUtil v3")
	ItemDB.items.erase(&"_t_stick")
	ItemDB.items.erase(&"_t_axe")
