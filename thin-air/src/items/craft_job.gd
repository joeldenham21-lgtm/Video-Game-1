class_name CraftJob
extends RefCounted
## A timed craft in progress (see Crafting.begin). Ingredients are already taken from the inventory;
## advance() it every frame, cancel() refunds them. The owner decides what "interrupted" means.

signal finished(result: Dictionary)
signal cancelled()

var recipe: Dictionary = {}
var inventory: Inventory = null
var station: StringName = &"hand"
var duration := 1.0
var elapsed := 0.0
var done := false
var aborted := false
## Crafting.complete() result once finished: {ok, result, count, overflow}.
var last_result: Dictionary = {}


func progress() -> float:
	return clampf(elapsed / duration, 0.0, 1.0)


func remaining() -> float:
	return maxf(0.0, duration - elapsed)


func is_running() -> bool:
	return not done and not aborted


## Advances the job; returns true on the frame it completes.
func advance(delta: float) -> bool:
	if not is_running():
		return false
	elapsed += delta
	if elapsed >= duration:
		finish_now()
		return true
	return false


## Completes immediately. Returns the Crafting.complete() result ({ok, result, count, overflow}).
func finish_now() -> Dictionary:
	if not is_running():
		return {"ok": false}
	done = true
	elapsed = duration
	var res := Crafting.complete(recipe, inventory)
	last_result = res
	finished.emit(res)
	return res


## Aborts and refunds the ingredients. Returns the count that did not fit back in.
func cancel() -> int:
	if not is_running():
		return 0
	aborted = true
	var overflow := Crafting.refund_ingredients(recipe, inventory)
	cancelled.emit()
	return overflow
