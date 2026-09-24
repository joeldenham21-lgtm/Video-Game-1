class_name TestCase
extends Node
## Base for headless tests. Subclass, implement `func run() -> void` (may await), call check().
## Run: timeout 120 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_core.gd

var failures := 0
var passes := 0


func check(cond: bool, msg: String) -> void:
	if cond:
		passes += 1
		print("PASS ", msg)
	else:
		failures += 1
		print("FAIL ", msg)


func run() -> void:
	pass
