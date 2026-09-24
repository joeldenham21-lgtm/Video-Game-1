class_name TouchLook
## Static accumulator: touch controls add look deltas (pixels), the player consumes them each frame.

static var _delta := Vector2.ZERO


static func add(d: Vector2) -> void:
	_delta += d


static func consume() -> Vector2:
	var d := _delta
	_delta = Vector2.ZERO
	return d
