class_name Inventory
extends RefCounted
## Slot inventory with stacking, durability and a soft weight limit. Used by the player and containers.
## A stack is {"id": StringName, "count": int, "durability": float (0..1)}; an empty slot is {}.

signal changed()

var slots: Array[Dictionary] = []
var max_weight := 30.0


func _init(slot_count := 24, weight_limit := 30.0) -> void:
	max_weight = weight_limit
	resize(slot_count)


func size() -> int:
	return slots.size()


func resize(n: int) -> void:
	while slots.size() < n:
		slots.append({})
	# Never drop items when shrinking: only trim trailing empty slots.
	while slots.size() > n and slots[slots.size() - 1].is_empty():
		slots.pop_back()
	changed.emit()


func clear() -> void:
	for i in slots.size():
		slots[i] = {}
	changed.emit()


static func stack_limit(id: StringName) -> int:
	return maxi(1, int(ItemDB.get_item(id).get("stack", 1)))


## Adds items, filling existing stacks first. Returns how many could NOT be added.
func add(id: StringName, amount := 1, durability := 1.0) -> int:
	if amount <= 0 or not ItemDB.has_item(id):
		return amount
	var left := amount
	var limit := stack_limit(id)
	if limit > 1:
		for s in slots:
			if left <= 0:
				break
			if not s.is_empty() and s["id"] == id and s["count"] < limit:
				var n := mini(limit - int(s["count"]), left)
				s["count"] = int(s["count"]) + n
				left -= n
	for i in slots.size():
		if left <= 0:
			break
		if slots[i].is_empty():
			var n := mini(limit, left)
			slots[i] = {"id": id, "count": n, "durability": durability}
			left -= n
	if left != amount:
		changed.emit()
	return left


func can_add(id: StringName, amount := 1) -> bool:
	var limit := stack_limit(id)
	var room := 0
	for s in slots:
		if s.is_empty():
			room += limit
		elif s["id"] == id:
			room += limit - int(s["count"])
		if room >= amount:
			return true
	return room >= amount


## Removes `count` of `id` (from the last stacks first). All-or-nothing.
func remove(id: StringName, amount := 1) -> bool:
	if amount <= 0:
		return true
	if count(id) < amount:
		return false
	var left := amount
	for i in range(slots.size() - 1, -1, -1):
		var s := slots[i]
		if s.is_empty() or s["id"] != id:
			continue
		var n := mini(int(s["count"]), left)
		s["count"] = int(s["count"]) - n
		left -= n
		if int(s["count"]) <= 0:
			slots[i] = {}
		if left <= 0:
			break
	changed.emit()
	return true


## Removes up to `count` from slot `index`; returns the removed stack ({} if none).
func remove_at(index: int, amount := -1) -> Dictionary:
	if index < 0 or index >= slots.size() or slots[index].is_empty():
		return {}
	var s := slots[index]
	var n: int = int(s["count"]) if amount < 0 else mini(amount, int(s["count"]))
	var out := {"id": s["id"], "count": n, "durability": s.get("durability", 1.0)}
	s["count"] = int(s["count"]) - n
	if int(s["count"]) <= 0:
		slots[index] = {}
	changed.emit()
	return out


func count(id: StringName) -> int:
	var total := 0
	for s in slots:
		if not s.is_empty() and s["id"] == id:
			total += int(s["count"])
	return total


func has(id: StringName, n := 1) -> bool:
	return count(id) >= n


## requirements: {item_id: count}
func has_all(requirements: Dictionary) -> bool:
	for k in requirements:
		if count(StringName(k)) < int(requirements[k]):
			return false
	return true


func remove_all(requirements: Dictionary) -> bool:
	if not has_all(requirements):
		return false
	for k in requirements:
		remove(StringName(k), int(requirements[k]))
	return true


func get_slot(i: int) -> Dictionary:
	return slots[i] if i >= 0 and i < slots.size() else {}


func set_slot(i: int, stack: Dictionary) -> void:
	if i >= 0 and i < slots.size():
		slots[i] = stack
		changed.emit()


func swap(a: int, b: int) -> void:
	if a == b or a < 0 or b < 0 or a >= slots.size() or b >= slots.size():
		return
	# Merge identical stackables instead of swapping.
	var sa := slots[a]; var sb := slots[b]
	if not sa.is_empty() and not sb.is_empty() and sa["id"] == sb["id"]:
		var limit := stack_limit(sa["id"])
		var n := mini(limit - int(sb["count"]), int(sa["count"]))
		if n > 0:
			sb["count"] = int(sb["count"]) + n
			sa["count"] = int(sa["count"]) - n
			if int(sa["count"]) <= 0:
				slots[a] = {}
			changed.emit()
			return
	slots[a] = sb
	slots[b] = sa
	changed.emit()


func find(id: StringName) -> int:
	for i in slots.size():
		if not slots[i].is_empty() and slots[i]["id"] == id:
			return i
	return -1


func find_with_tag(tag: String) -> int:
	for i in slots.size():
		if not slots[i].is_empty() and tag in ItemDB.get_item(slots[i]["id"]).get("tags", []):
			return i
	return -1


func free_slots() -> int:
	var n := 0
	for s in slots:
		if s.is_empty():
			n += 1
	return n


func total_weight() -> float:
	var w := 0.0
	for s in slots:
		if not s.is_empty():
			w += float(ItemDB.get_item(s["id"]).get("weight", 0.1)) * int(s["count"])
	return w


func is_overweight() -> bool:
	return total_weight() > max_weight


## Wears the item in slot `index`. Returns true if it broke (and was removed).
func use_durability(index: int, amount: float) -> bool:
	var s := get_slot(index)
	if s.is_empty():
		return false
	s["durability"] = float(s.get("durability", 1.0)) - amount
	if float(s["durability"]) <= 0.0:
		remove_at(index, 1)
		return true
	changed.emit()
	return false


func to_dict() -> Dictionary:
	var arr := []
	for s in slots:
		if s.is_empty():
			arr.append(null)
		else:
			arr.append({"id": String(s["id"]), "count": int(s["count"]), "durability": float(s.get("durability", 1.0))})
	return {"slots": arr, "max_weight": max_weight}


func from_dict(d: Dictionary) -> void:
	var arr: Array = d.get("slots", [])
	max_weight = float(d.get("max_weight", max_weight))
	slots.clear()
	for e in arr:
		if e is Dictionary and ItemDB.has_item(StringName(e.get("id", ""))):
			slots.append({"id": StringName(e["id"]), "count": int(e.get("count", 1)), "durability": float(e.get("durability", 1.0))})
		else:
			slots.append({})
	changed.emit()
