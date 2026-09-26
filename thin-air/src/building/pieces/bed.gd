class_name BuildBed
extends BuildObject
## Bough bed / hide bed: interact to sleep (BuildSleep dialog: hours, fade, time skip, vitals, autosave).
## buildables.json "sleep_quality" (bough 0.6, hide bed 1.0) sets how warm and rested you wake.

@export var glb := "camp_bed.glb"


func _ready() -> void:
	model_glb = glb
	surface = &"wood"
	super._ready()


func own_prompt(player: Node) -> String:
	var why := BuildSleep.sleep_problem(player, global_position)
	return "Sleep" if why == "" else why


func own_interact(player: Node) -> void:
	var why := BuildSleep.sleep_problem(player, global_position)
	if why != "":
		Game.notify(why, &"warning")
		Audio.play_ui(&"ui_back")
		return
	BuildSleep.open_for(self, player)
