extends Animal
## Mule deer: grazes (head down) in meadows and forest edges, lifts its head and stares when something is off
## (alert posture, ears forward), gives an alarm snort/bark, and bolts with the mule deer's stotting flight (all four
## hooves together) for the first bounds before settling into a gallop. Very skittish, flees fire and gunshots.

const C_STOT := &"stot"
const STOT_TIME := 2.6


func gait_override() -> StringName:
	if state == State.FLEE and state_time < STOT_TIME:
		return C_STOT
	return &""


func start_flee() -> void:
	if state != State.FLEE:
		set_state(State.FLEE)
		vocal(&"deer_bark", 0.0)
		Audio.play_sfx(&"deer_flee", global_position, -2.0)


func flee_step() -> void:
	super.flee_step()
	if state_time < STOT_TIME:
		target_speed = def.clip_speed(C_STOT, 5.5)


func on_heard(_pos: Vector3, loudness: float, k: float) -> void:
	if loudness > 1.2 or k > 0.6:
		fear = minf(1.0, fear + 0.5 * k * loudness)
		if fear > 0.4:
			start_flee()
