extends Node
## Loads the test script given by `-- --test=res://tests/x.gd`, runs it, prints RESULT and quits with 0/1.


func _ready() -> void:
	var path := ""
	for a in OS.get_cmdline_user_args():
		if String(a).begins_with("--test="):
			path = String(a).substr(7)
	if path == "" or not ResourceLoader.exists(path):
		print("RESULT FAIL (no test script: '%s')" % path)
		get_tree().quit(2)
		return
	var script: Script = load(path)
	# `for t in tests/test_*.gd` also globs the harness itself (this runner, the TestCase base): skip them.
	if script == get_script() or path.get_file() == "test_case.gd" or get_parent() != get_tree().root:
		if get_parent() == get_tree().root:
			print("RESULT PASS (skipped: %s is test infrastructure, not a test)" % path)
			get_tree().quit(0)
		return
	var t: Node = script.new()
	add_child(t)
	await get_tree().process_frame
	await t.run()
	print("RESULT %s (%d passed, %d failed) %s" % ["FAIL" if t.failures else "PASS", t.passes, t.failures, path])
	get_tree().quit(1 if t.failures else 0)
