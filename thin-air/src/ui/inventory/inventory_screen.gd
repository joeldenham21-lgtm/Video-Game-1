class_name InventoryScreen
extends CanvasLayer
## Inventory · Equipment · Crafting screen (scenes/ui/inventory_screen.tscn). A field-gear "PDA" over a
## frosted view of the world, which keeps running. Opens on the "inventory" action while a player exists,
## from stations via open_station(station_id, station) and from containers via open_container().
## Emits Events.ui_screen_opened/closed(&"inventory"); the player disables its own input on those.
##
## Controls — mouse: click select, drag to move/equip/assign, double/right-click use, shift-click transfer,
## ctrl-click split, drag onto the dimmed backdrop to drop, 1–6 assign hotbar, G drop, Tab/I/Esc close.
## Gamepad: stick/d-pad navigate, A open actions (or place in move mode), B back, Y close, LB/RB tabs.
## Touch: tap to select, big action buttons, drag works too. Scales with Settings touch_ui_scale.

const SCREEN := &"inventory"
enum Tab { INVENTORY, EQUIPMENT, CRAFTING }
const TAB_TITLES := ["Inventory", "Equipment", "Crafting"]
const CATEGORIES := [["all", "All"], ["tools", "Tools"], ["weapons", "Weapons"], ["survival", "Survival"],
	["clothing", "Clothing"], ["medical", "Medical"], ["food", "Food & Water"], ["materials", "Materials"]]
const EQUIP_LAYOUT := [
	[&"head", "HEAD", Vector2(40, 36), Vector2(230, 78)],
	[&"face", "FACE", Vector2(332, 36), Vector2(246, 92)],
	[&"body", "BODY", Vector2(22, 200), Vector2(222, 210)],
	[&"back", "BACK", Vector2(350, 190), Vector2(250, 190)],
	[&"hands", "HANDS", Vector2(350, 330), Vector2(318, 330)],
	[&"legs", "LEGS", Vector2(22, 372), Vector2(214, 400)],
	[&"feet", "FEET", Vector2(330, 470), Vector2(248, 548)],
]

static var _instance: InventoryScreen = null

var is_open := false
var tab: Tab = Tab.INVENTORY
var player: Node = null
var inv: Inventory = null
var container_inv: Inventory = null
var container_title := ""
var container_node: Node = null
var station_id: StringName = &"hand"
var station_node: Node = null

var sel_slot: ItemSlot = null
var move_from: ItemSlot = null
var sel_recipe: Dictionary = {}
var craft_job: CraftJob = null
var craft_recipe_id: StringName = &""
var craft_station_node: Node = null
var recipe_filter := "all"

var _root: Control
var _backdrop: ColorRect
var _frame: Control
var _pages: Array[Control] = []
var _tab_buttons: Array[Button] = []
var _tab_underline: ColorRect
var _info_label: Label
var _weight_label: Label
var _weight_bar: ProgressBar
var _footer_hint: Label
var _footer_status: Label
var _status_timer := 0.0
var _detail_panel: PanelContainer
var _detail: Dictionary = {}
var _pack_panel: PanelContainer
var _pack_title: Label
var _pack_scroll: ScrollContainer
var _pack_grid: GridContainer
var _pack_slots: Array[ItemSlot] = []
var _hotbar_rows: Array[HBoxContainer] = []
var _hotbar_slots: Array[ItemSlot] = []
var _cont_panel: PanelContainer
var _cont_title: Label
var _cont_grid: GridContainer
var _cont_slots: Array[ItemSlot] = []
var _equip_slots: Dictionary = {}
var _wear_grid: GridContainer
var _wear_slots: Array[ItemSlot] = []
var _stats_box: VBoxContainer
var _doll: Control
var _station_card: PanelContainer
var _station_icon: TextureRect
var _station_name: Label
var _station_status: Label
var _station_bar: ProgressBar
var _station_actions: HBoxContainer
var _chip_row: HBoxContainer
var _recipe_list: VBoxContainer
var _recipe_scroll: ScrollContainer
var _recipe_rows: Array[Button] = []
var _rd: Dictionary = {}
var _dirty := true
var _slot_px := 96.0
var _cont_px := 96.0
var _compact := false
var _margin: MarginContainer
var _header: HBoxContainer
var _brand: Label
var _body: HBoxContainer
var _craft_left: VBoxContainer
var _device := "mouse"
var _wear_hint: Label
var _prev_mouse_mode: Input.MouseMode = Input.MOUSE_MODE_VISIBLE
var _tween: Tween
var _silhouette: ShaderMaterial
var _hover_sfx_cd := 0.0
var _evt_toggle := false      ## the inventory/pause key already toggled us this frame through an InputEvent
var _slow_t := 0.0
var _craft_secs := -1
var _other_screens: Dictionary = {}   ## other UI screens currently open (journal, map, pause, build…)


static func get_instance() -> InventoryScreen:
	if _instance != null and is_instance_valid(_instance):
		return _instance
	var tree := Engine.get_main_loop() as SceneTree
	if tree:
		var n := tree.get_first_node_in_group(&"inventory_screen")
		if n is InventoryScreen:
			return n
	return null


func _enter_tree() -> void:
	if _instance != null and is_instance_valid(_instance) and _instance != self:
		queue_free()     # one screen per world
		return
	_instance = self
	add_to_group(&"inventory_screen")


func _exit_tree() -> void:
	if _instance == self:
		_instance = null


func _ready() -> void:
	if is_queued_for_deletion():
		return
	_device = "touch" if Settings.is_mobile() else "mouse"
	process_mode = Node.PROCESS_MODE_ALWAYS
	layer = 40
	_silhouette = ShaderMaterial.new()
	_silhouette.shader = load("res://src/ui/inventory/silhouette.gdshader")
	_build()
	visible = false
	_root.visible = false
	get_viewport().size_changed.connect(_layout)
	Events.settings_changed.connect(_layout)
	Events.inventory_changed.connect(_mark_dirty)
	Events.equipment_changed.connect(func(_s: StringName, _i: StringName) -> void: _mark_dirty())
	Events.blueprint_unlocked.connect(func(_i: StringName) -> void: _mark_dirty())
	Events.ui_screen_opened.connect(func(sc: StringName) -> void:
		if sc != SCREEN:
			_other_screens[sc] = true)
	Events.ui_screen_closed.connect(func(sc: StringName) -> void: _other_screens.erase(sc))
	Events.game_loaded.connect(_on_game_loaded)
	_layout()


# =============================================================================================== open / close

func _can_open() -> bool:
	return Game.player != null and is_instance_valid(Game.player) and not get_tree().paused \
		and (Game.state == Game.State.PLAYING) and _other_screens.is_empty()


func open(to_tab: Tab = Tab.INVENTORY) -> void:
	player = Game.player
	inv = ItemActions.inventory_of(player)
	if inv == null:
		return
	if not inv.changed.is_connected(_mark_dirty):
		inv.changed.connect(_mark_dirty)
	var was_open := is_open
	is_open = true
	visible = true
	_root.visible = true
	if not was_open:
		_prev_mouse_mode = Input.mouse_mode
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		Events.ui_screen_opened.emit(SCREEN)
		Audio.play_ui(&"inventory_open")
		_animate_in()
	_set_tab(to_tab)
	_refresh_all()


## Open on a station's recipes (campfire, workbench, fabricator). `station` may be null.
func open_station(sid: StringName, station: Node = null) -> void:
	station_id = sid
	station_node = station
	_clear_container()
	open(Tab.CRAFTING)


## Open in transfer mode with a container's inventory next to the pack.
func open_container(container: Inventory, title: String, source: Node = null) -> void:
	_clear_container()
	container_inv = container
	container_title = title
	container_node = source
	if container_inv and not container_inv.changed.is_connected(_mark_dirty):
		container_inv.changed.connect(_mark_dirty)
	station_id = &"hand"
	station_node = null
	open(Tab.INVENTORY)


func close() -> void:
	if not is_open:
		return
	is_open = false
	_cancel_move()
	_clear_container()
	station_id = &"hand"
	station_node = null
	Audio.play_ui(&"inventory_close")
	Events.ui_screen_closed.emit(SCREEN)
	if _prev_mouse_mode == Input.MOUSE_MODE_CAPTURED and not Settings.is_mobile():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_animate_out()


func toggle() -> void:
	if is_open:
		close()
	elif _can_open():
		open()


func _clear_container() -> void:
	if container_inv and container_inv.changed.is_connected(_mark_dirty):
		container_inv.changed.disconnect(_mark_dirty)
	container_inv = null
	container_node = null
	container_title = ""


func _animate_in() -> void:
	if _tween:
		_tween.kill()
	_frame.modulate.a = 0.0
	_frame.position.y = 14.0
	(_backdrop.material as ShaderMaterial).set_shader_parameter("fade", 0.0)
	_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_tween.tween_property(_frame, "modulate:a", 1.0, 0.16)
	_tween.tween_property(_frame, "position:y", 0.0, 0.2)
	_tween.tween_method(func(v: float) -> void: (_backdrop.material as ShaderMaterial).set_shader_parameter("fade", v), 0.0, 1.0, 0.18)


func _animate_out() -> void:
	if _tween:
		_tween.kill()
	_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN)
	_tween.tween_property(_frame, "modulate:a", 0.0, 0.1)
	_tween.tween_method(func(v: float) -> void: (_backdrop.material as ShaderMaterial).set_shader_parameter("fade", v), 1.0, 0.0, 0.12)
	_tween.chain().tween_callback(func() -> void:
		if not is_open:
			_root.visible = false
			visible = false)


# =============================================================================================== input

func _unhandled_input(event: InputEvent) -> void:
	if is_open:
		return
	if event.is_action_pressed("inventory") and _can_open():
		_evt_toggle = true
		open()
		get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	if not is_open:
		return
	_track_device(event)
	if event.is_action_pressed("inventory") or event.is_action_pressed("pause"):
		_evt_toggle = true
		close()
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("ui_cancel"):
		if move_from:
			_cancel_move()
		elif _focus_in_detail_actions() and sel_slot and is_instance_valid(sel_slot):
			sel_slot.grab_focus()
		else:
			close()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventJoypadButton and event.pressed:
		var jb := event as InputEventJoypadButton
		if jb.button_index == JOY_BUTTON_LEFT_SHOULDER:
			_set_tab(wrapi(tab - 1, 0, 3) as Tab, true)
			get_viewport().set_input_as_handled()
			return
		if jb.button_index == JOY_BUTTON_RIGHT_SHOULDER:
			_set_tab(wrapi(tab + 1, 0, 3) as Tab, true)
			get_viewport().set_input_as_handled()
			return
	if event.is_action_pressed("rotate_left") and event is InputEventKey:
		_set_tab(wrapi(tab - 1, 0, 3) as Tab, true)
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("rotate_right") and event is InputEventKey:
		_set_tab(wrapi(tab + 1, 0, 3) as Tab, true)
		get_viewport().set_input_as_handled()
		return
	for i in 6:
		if event.is_action_pressed("hotbar_%d" % (i + 1)):
			_assign_selected_to_hotbar(i)
			get_viewport().set_input_as_handled()
			return
	if event.is_action_pressed("drop") and event is InputEventKey:
		_action_drop()
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("ui_accept") and (event is InputEventJoypadButton or event is InputEventKey):
		var f := _root.get_viewport().gui_get_focus_owner()
		if f is ItemSlot:
			var s := f as ItemSlot
			if move_from:
				_place_move(s)
			else:
				_select_slot(s)
				_focus_first_action()
			get_viewport().set_input_as_handled()


## Touch buttons press actions with Input.action_press() (no InputEvent, CONTRACT §5): poll for those.
func _poll_injected_actions() -> void:
	if _evt_toggle:
		_evt_toggle = false
		return
	if Input.is_action_just_pressed("inventory"):
		if is_open:
			close()
		elif _can_open():
			open()
	elif is_open and Input.is_action_just_pressed("pause"):
		close()


func _track_device(event: InputEvent) -> void:
	var d := _device
	if event is InputEventJoypadButton or (event is InputEventJoypadMotion and absf((event as InputEventJoypadMotion).axis_value) > 0.4):
		d = "pad"
	elif event is InputEventScreenTouch:
		d = "touch"
	elif event is InputEventMouseButton or (event is InputEventMouseMotion and (event as InputEventMouseMotion).relative.length() > 2.0):
		d = "mouse"
	elif event is InputEventKey:
		d = "keys"
	if d != _device:
		_device = d
		_update_footer()
		if d == "pad" or d == "keys":
			_ensure_focus()


func _ensure_focus() -> void:
	var f := _root.get_viewport().gui_get_focus_owner()
	if f != null and _root.is_ancestor_of(f):
		return
	match tab:
		Tab.INVENTORY:
			if not _pack_slots.is_empty():
				_pack_slots[0].grab_focus()
		Tab.EQUIPMENT:
			(_equip_slots[&"body"] as ItemSlot).grab_focus()
		Tab.CRAFTING:
			if not _recipe_rows.is_empty():
				_recipe_rows[0].grab_focus()


func _focus_in_detail_actions() -> bool:
	var f := _root.get_viewport().gui_get_focus_owner()
	return f != null and _detail_panel.is_ancestor_of(f)


func _focus_first_action() -> void:
	var box: Container = _detail.get("actions")
	for c in box.get_children():
		if c is Button and not (c as Button).disabled:
			(c as Button).grab_focus()
			return


# =============================================================================================== build

func _build() -> void:
	_root = Control.new()
	_root.name = "Root"
	_root.theme = InvStyle.theme()
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_backdrop = DropZone.new()
	_backdrop.screen = self
	_backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/ui/inventory/backdrop.gdshader")
	_backdrop.material = mat
	_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_backdrop.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed and (e as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			_cancel_move())
	_root.add_child(_backdrop)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 44)
	margin.add_theme_constant_override("margin_top", 30)
	margin.add_theme_constant_override("margin_bottom", 22)
	_root.add_child(margin)
	_frame = margin
	_margin = margin
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_child(col)
	col.add_child(_build_header())
	var body := HBoxContainer.new()
	_body = body
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 14)
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(body)
	var pages := Control.new()
	pages.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pages.mouse_filter = Control.MOUSE_FILTER_IGNORE
	body.add_child(pages)
	for p in [_build_inventory_page(), _build_equipment_page(), _build_crafting_page()]:
		p.set_anchors_preset(Control.PRESET_FULL_RECT)
		pages.add_child(p)
		_pages.append(p)
	_detail_panel = _build_detail_panel()
	body.add_child(_detail_panel)
	col.add_child(_build_footer())


func _build_header() -> Control:
	var h := HBoxContainer.new()
	_header = h
	h.custom_minimum_size = Vector2(0, 58)
	h.add_theme_constant_override("separation", 6)
	var brand := InvStyle.caps("Field kit", 14, InvStyle.TEXT_FAINT, 3)
	brand.custom_minimum_size = Vector2(120, 0)
	_brand = brand
	brand.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	h.add_child(brand)
	var tab_wrap := Control.new()
	tab_wrap.custom_minimum_size = Vector2(3 * 170 + 8, 52)
	tab_wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(tab_wrap)
	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 4)
	tabs.set_anchors_preset(Control.PRESET_FULL_RECT)
	tab_wrap.add_child(tabs)
	for i in 3:
		var b := Button.new()
		b.text = TAB_TITLES[i].to_upper()
		InvStyle.style_button(b, "ghost", 19)
		b.add_theme_font_override("font", InvStyle.caps_font("SemiBold", 3))
		b.custom_minimum_size = Vector2(170, 52)
		b.focus_mode = Control.FOCUS_NONE
		var idx := i
		b.pressed.connect(func() -> void:
			Audio.play_ui(&"ui_click")
			_set_tab(idx as Tab))
		tabs.add_child(b)
		_tab_buttons.append(b)
	_tab_underline = ColorRect.new()
	_tab_underline.color = InvStyle.ACCENT
	_tab_underline.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tab_underline.size = Vector2(120, 3)
	tab_wrap.add_child(_tab_underline)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(spacer)
	_info_label = InvStyle.label("", 18, InvStyle.TEXT_DIM, "Mono")
	_info_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	h.add_child(_info_label)
	var sep := VSeparator.new()
	sep.add_theme_constant_override("separation", 28)
	sep.add_theme_stylebox_override("separator", _vline())
	h.add_child(sep)
	var wbox := VBoxContainer.new()
	wbox.alignment = BoxContainer.ALIGNMENT_CENTER
	wbox.custom_minimum_size = Vector2(190, 0)
	wbox.add_theme_constant_override("separation", 6)
	var wrow := HBoxContainer.new()
	wrow.add_child(InvStyle.caps("Load", 13, InvStyle.TEXT_FAINT))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	wrow.add_child(sp)
	_weight_label = InvStyle.label("0.0 / 30 kg", 18, InvStyle.TEXT, "Mono")
	wrow.add_child(_weight_label)
	wbox.add_child(wrow)
	_weight_bar = _bar(InvStyle.GOOD, 5)
	wbox.add_child(_weight_bar)
	h.add_child(wbox)
	var close_b := Button.new()
	close_b.text = "✕"
	InvStyle.style_button(close_b, "ghost", 24)
	close_b.custom_minimum_size = Vector2(56, 52)
	close_b.focus_mode = Control.FOCUS_NONE
	close_b.pressed.connect(close)
	h.add_child(close_b)
	return h


func _vline() -> StyleBoxLine:
	var s := StyleBoxLine.new()
	s.color = InvStyle.LINE_STRONG
	s.vertical = true
	s.thickness = 1
	s.grow_begin = -12
	s.grow_end = -12
	return s


func _bar(color: Color, height := 6) -> ProgressBar:
	var pb := ProgressBar.new()
	pb.show_percentage = false
	pb.custom_minimum_size = Vector2(0, height)
	pb.min_value = 0.0
	pb.max_value = 1.0
	pb.step = 0.001
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(1, 1, 1, 0.08)
	bg.set_corner_radius_all(2)
	var fg := StyleBoxFlat.new()
	fg.bg_color = color
	fg.set_corner_radius_all(2)
	pb.add_theme_stylebox_override("background", bg)
	pb.add_theme_stylebox_override("fill", fg)
	pb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return pb


func _set_bar_color(pb: ProgressBar, c: Color) -> void:
	var fg := pb.get_theme_stylebox("fill") as StyleBoxFlat
	if fg and fg.bg_color != c:
		fg = fg.duplicate()
		fg.bg_color = c
		pb.add_theme_stylebox_override("fill", fg)


func _build_footer() -> Control:
	var f := HBoxContainer.new()
	f.custom_minimum_size = Vector2(0, 30)
	_footer_hint = InvStyle.label("", 16, InvStyle.TEXT_FAINT)
	_footer_hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	f.add_child(_footer_hint)
	_footer_status = InvStyle.label("", 17, InvStyle.ACCENT, "Medium")
	_footer_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	f.add_child(_footer_status)
	return f


func _card(title := "") -> Array:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", InvStyle.panel(InvStyle.BG, 8, InvStyle.LINE, 1, 18))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	p.add_child(v)
	var t: Label = null
	if title != "":
		var row := HBoxContainer.new()
		t = InvStyle.caps(title, 15, InvStyle.TEXT_DIM)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(t)
		v.add_child(row)
	return [p, v, t]


func _make_slot(kind: ItemSlot.Kind) -> ItemSlot:
	var s := ItemSlot.new()
	s.kind = kind
	s.selected.connect(_select_slot)
	s.activated.connect(_activate_slot)
	s.quick_transfer.connect(_quick_transfer)
	s.split_requested.connect(func(sl: ItemSlot) -> void:
		_select_slot(sl)
		_action_split())
	s.dropped_on.connect(_on_slot_drop)
	s.mouse_entered.connect(_hover_sfx)
	return s


func _hover_sfx() -> void:
	if _hover_sfx_cd <= 0.0:
		Audio.play_ui(&"ui_hover")
		_hover_sfx_cd = 0.06


# ---------------------------------------------------------------------------------------------- inventory page

func _build_inventory_page() -> Control:
	var page := HBoxContainer.new()
	page.add_theme_constant_override("separation", 14)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var c := _card("Pack")
	_pack_panel = c[0]
	_pack_title = c[2]
	_pack_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v: VBoxContainer = c[1]
	var sort_b := Button.new()
	sort_b.text = "Sort"
	InvStyle.style_button(sort_b, "ghost", 16)
	sort_b.focus_mode = Control.FOCUS_NONE
	sort_b.pressed.connect(func() -> void:
		if inv:
			inv.sort()
			Audio.play_ui(&"ui_click"))
	(v.get_child(0) as HBoxContainer).add_child(sort_b)
	_pack_scroll = ScrollContainer.new()
	_pack_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_pack_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(_pack_scroll)
	_pack_grid = GridContainer.new()
	_pack_grid.columns = 6
	_pack_grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_pack_grid.add_theme_constant_override("h_separation", 8)
	_pack_grid.add_theme_constant_override("v_separation", 8)
	_pack_scroll.add_child(_centered(_pack_grid))
	v.add_child(InvStyle.hline())
	v.add_child(InvStyle.caps("Hotbar", 14, InvStyle.TEXT_FAINT))
	v.add_child(_make_hotbar_row())
	page.add_child(_pack_panel)
	var cc := _card("Storage")
	_cont_panel = cc[0]
	_cont_title = cc[2]
	_cont_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var cv: VBoxContainer = cc[1]
	var take_all := Button.new()
	take_all.text = "Take all"
	InvStyle.style_button(take_all, "ghost", 16)
	take_all.focus_mode = Control.FOCUS_NONE
	take_all.pressed.connect(_take_all)
	(cv.get_child(0) as HBoxContainer).add_child(take_all)
	var cs := ScrollContainer.new()
	cs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	cs.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	cv.add_child(cs)
	_cont_grid = GridContainer.new()
	_cont_grid.columns = 4
	_cont_grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_cont_grid.add_theme_constant_override("h_separation", 8)
	_cont_grid.add_theme_constant_override("v_separation", 8)
	cs.add_child(_centered(_cont_grid))
	page.add_child(_cont_panel)
	return page


## A single-line strip that scrolls sideways (drag / wheel) when it doesn't fit — chips and fuel buttons on phones.
static func _hscroll(row: Control) -> ScrollContainer:
	var sc := ScrollContainer.new()
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	sc.add_child(row)
	return sc


## Wraps a grid so it sits centred at the top of a ScrollContainer (which never centres its child itself).
static func _centered(c: Control) -> CenterContainer:
	var cc := CenterContainer.new()
	cc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cc.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	cc.add_child(c)
	return cc


func _make_hotbar_row() -> HBoxContainer:
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 8)
	for i in ItemActions.HOTBAR_SIZE:
		var s := _make_slot(ItemSlot.Kind.HOTBAR)
		s.index = i
		s.hotkey = str(i + 1)
		row.add_child(s)
		_hotbar_slots.append(s)
	_hotbar_rows.append(row)
	return row


# ---------------------------------------------------------------------------------------------- equipment page

func _build_equipment_page() -> Control:
	var page := HBoxContainer.new()
	page.add_theme_constant_override("separation", 14)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var c := _card("Worn")
	var doll_panel: PanelContainer = c[0]
	var v: VBoxContainer = c[1]
	var doll := DollFigure.new()
	_doll = doll
	doll.custom_minimum_size = Vector2(460, 590)
	doll.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(doll)
	for e in EQUIP_LAYOUT:
		var s := _make_slot(ItemSlot.Kind.EQUIP)
		s.equip_slot = e[0]
		s.empty_label = e[1]
		s.position = e[2]
		s.size = Vector2(88, 88)
		doll.add_child(s)
		doll.anchors.append([s, e[3]])
		_equip_slots[e[0]] = s
	page.add_child(doll_panel)
	var rc := _card("Wearable gear in your pack")
	var right: PanelContainer = rc[0]
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var rv: VBoxContainer = rc[1]
	_stats_box = VBoxContainer.new()
	_stats_box.add_theme_constant_override("separation", 8)
	var ws := ScrollContainer.new()
	ws.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ws.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	rv.add_child(ws)
	_wear_grid = GridContainer.new()
	_wear_grid.columns = 5
	_wear_grid.add_theme_constant_override("h_separation", 8)
	_wear_grid.add_theme_constant_override("v_separation", 8)
	ws.add_child(_centered(_wear_grid))
	rv.add_child(InvStyle.hline())
	rv.add_child(InvStyle.caps("Protection", 14, InvStyle.TEXT_FAINT))
	rv.add_child(_stats_box)
	rv.add_child(InvStyle.hline())
	_wear_hint = InvStyle.caps("Hotbar  ·  select an item, press 1–6", 14, InvStyle.TEXT_FAINT)
	rv.add_child(_wear_hint)
	rv.add_child(_make_hotbar_row())
	page.add_child(right)
	return page


# ---------------------------------------------------------------------------------------------- crafting page

func _build_crafting_page() -> Control:
	var page := HBoxContainer.new()
	page.add_theme_constant_override("separation", 14)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var left := VBoxContainer.new()
	_craft_left = left
	left.add_theme_constant_override("separation", 14)
	left.custom_minimum_size = Vector2(600, 0)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.mouse_filter = Control.MOUSE_FILTER_IGNORE
	page.add_child(left)
	# station card
	var sc := _card()
	_station_card = sc[0]
	var sv: VBoxContainer = sc[1]
	var srow := HBoxContainer.new()
	srow.add_theme_constant_override("separation", 16)
	sv.add_child(srow)
	_station_icon = TextureRect.new()
	_station_icon.custom_minimum_size = Vector2(84, 84)
	_station_icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_station_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_station_icon.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	srow.add_child(_station_icon)
	var sinfo := VBoxContainer.new()
	sinfo.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sinfo.add_theme_constant_override("separation", 6)
	srow.add_child(sinfo)
	_station_name = InvStyle.caps("Campfire", 17, InvStyle.TEXT, 3)
	sinfo.add_child(_station_name)
	_station_status = InvStyle.label("", 18, InvStyle.TEXT_DIM)
	sinfo.add_child(_station_status)
	_station_bar = _bar(InvStyle.ACCENT, 6)
	sinfo.add_child(_station_bar)
	_station_actions = HBoxContainer.new()
	_station_actions.add_theme_constant_override("separation", 8)
	sv.add_child(_hscroll(_station_actions))
	left.add_child(_station_card)
	# category chips
	_chip_row = HBoxContainer.new()
	_chip_row.add_theme_constant_override("separation", 6)
	for cat in CATEGORIES:
		var b := Button.new()
		b.text = cat[1]
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		InvStyle.style_button(b, "secondary", 16)
		b.add_theme_stylebox_override("pressed", InvStyle.panel(InvStyle.ACCENT_DIM, 5, InvStyle.ACCENT, 1, 10))
		b.add_theme_color_override("font_pressed_color", InvStyle.ACCENT)
		var key: String = cat[0]
		b.pressed.connect(func() -> void:
			recipe_filter = key
			Audio.play_ui(&"ui_click")
			_refresh_crafting())
		b.set_meta("key", key)
		_chip_row.add_child(b)
	left.add_child(_hscroll(_chip_row))
	var lc := _card()
	var list_panel: PanelContainer = lc[0]
	list_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	(list_panel.get_theme_stylebox("panel") as StyleBoxFlat).set_content_margin_all(8)
	_recipe_scroll = ScrollContainer.new()
	_recipe_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_recipe_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	(lc[1] as VBoxContainer).add_child(_recipe_scroll)
	_recipe_list = VBoxContainer.new()
	_recipe_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_recipe_list.add_theme_constant_override("separation", 4)
	_recipe_scroll.add_child(_recipe_list)
	left.add_child(list_panel)
	# recipe detail
	var dc := _card()
	var dpanel: PanelContainer = dc[0]
	dpanel.custom_minimum_size = Vector2(520, 0)
	dpanel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var dv: VBoxContainer = dc[1]
	dv.add_theme_constant_override("separation", 14)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 18)
	dv.add_child(top)
	var icon_bg := IconStage.new()
	icon_bg.custom_minimum_size = Vector2(150, 150)
	top.add_child(icon_bg)
	var tv := VBoxContainer.new()
	tv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tv.alignment = BoxContainer.ALIGNMENT_CENTER
	tv.add_theme_constant_override("separation", 4)
	top.add_child(tv)
	var rname := InvStyle.label("", 30, InvStyle.TEXT, "SemiBold")
	rname.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rname.custom_minimum_size.x = 200
	tv.add_child(rname)
	var rmeta := InvStyle.label("", 17, InvStyle.TEXT_DIM)
	tv.add_child(rmeta)
	var rscroll := ScrollContainer.new()
	rscroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	rscroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	dv.add_child(rscroll)
	var rin := VBoxContainer.new()
	rin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rin.add_theme_constant_override("separation", 12)
	rscroll.add_child(rin)
	var rdesc := InvStyle.label("", 19, Color(0.78, 0.81, 0.83))
	rdesc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rdesc.custom_minimum_size.x = 240
	rin.add_child(rdesc)
	var rnote := InvStyle.label("", 17, InvStyle.TEXT_DIM, "Italic")
	rnote.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rnote.custom_minimum_size.x = 240
	rin.add_child(rnote)
	rin.add_child(InvStyle.hline())
	rin.add_child(InvStyle.caps("Requires", 14, InvStyle.TEXT_FAINT))
	var ings := VBoxContainer.new()
	ings.add_theme_constant_override("separation", 6)
	rin.add_child(ings)
	var rstats_label := InvStyle.caps("Result", 14, InvStyle.TEXT_FAINT)
	rin.add_child(rstats_label)
	var rstats := VBoxContainer.new()
	rstats.add_theme_constant_override("separation", 7)
	rin.add_child(rstats)
	rin.move_child(rstats_label, 2)     # description · result stats · requirements
	rin.move_child(rstats, 3)
	var reason := InvStyle.label("", 17, InvStyle.BAD, "Medium")
	dv.add_child(reason)
	var craft_row := HBoxContainer.new()
	craft_row.add_theme_constant_override("separation", 10)
	dv.add_child(craft_row)
	var craft_b := Button.new()
	craft_b.text = "Craft"
	InvStyle.style_button(craft_b, "primary", 22)
	craft_b.custom_minimum_size = Vector2(0, 62)
	craft_b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	craft_b.pressed.connect(_on_craft_pressed)
	craft_row.add_child(craft_b)
	var prog := _bar(Color(1, 1, 1, 0.35), 62)
	prog.show_behind_parent = false
	prog.set_anchors_preset(Control.PRESET_FULL_RECT)
	(prog.get_theme_stylebox("background") as StyleBoxFlat).bg_color = Color(0, 0, 0, 0)
	prog.visible = false
	craft_b.add_child(prog)
	var cancel_b := Button.new()
	cancel_b.text = "Cancel"
	InvStyle.style_button(cancel_b, "secondary", 18)
	cancel_b.custom_minimum_size = Vector2(130, 62)
	cancel_b.visible = false
	cancel_b.pressed.connect(_cancel_craft)
	craft_row.add_child(cancel_b)
	page.add_child(dpanel)
	_rd = {"panel": dpanel, "icon": icon_bg, "name": rname, "meta": rmeta, "desc": rdesc, "note": rnote,
		"ings": ings, "stats": rstats, "stats_label": rstats_label, "reason": reason, "craft": craft_b, "progress": prog, "cancel": cancel_b}
	return page


# ---------------------------------------------------------------------------------------------- detail column

func _build_detail_panel() -> PanelContainer:
	var c := _card()
	var p: PanelContainer = c[0]
	p.custom_minimum_size = Vector2(440, 0)
	var v: VBoxContainer = c[1]
	v.add_theme_constant_override("separation", 10)
	var stage := IconStage.new()
	stage.custom_minimum_size = Vector2(0, 196)
	v.add_child(stage)
	var name_l := InvStyle.label("", 30, InvStyle.TEXT, "SemiBold")
	name_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	name_l.custom_minimum_size.x = 200
	v.add_child(name_l)
	var meta := InvStyle.label("", 17, InvStyle.TEXT_DIM)
	meta.clip_text = true
	v.add_child(meta)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(scroll)
	var inner := VBoxContainer.new()
	inner.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	inner.add_theme_constant_override("separation", 10)
	scroll.add_child(inner)
	var desc := InvStyle.label("", 19, Color(0.78, 0.81, 0.83))
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc.custom_minimum_size.x = 240
	inner.add_child(desc)
	var stats := VBoxContainer.new()
	stats.add_theme_constant_override("separation", 7)
	inner.add_child(stats)
	var hb_label := InvStyle.caps("Assign to hotbar", 13, InvStyle.TEXT_FAINT)
	v.add_child(hb_label)
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 6)
	for i in ItemActions.HOTBAR_SIZE:
		var b := Button.new()
		b.text = str(i + 1)
		InvStyle.style_button(b, "secondary", 17)
		b.custom_minimum_size = Vector2(52, 44)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var idx := i
		b.pressed.connect(func() -> void: _assign_selected_to_hotbar(idx))
		hb.add_child(b)
	v.add_child(hb)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 8)
	actions.add_theme_constant_override("v_separation", 8)
	v.add_child(actions)
	var empty := InvStyle.label("Select an item to inspect it.", 19, InvStyle.TEXT_FAINT)
	empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	empty.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	empty.custom_minimum_size.x = 240
	inner.add_child(empty)
	_detail = {"stage": stage, "name": name_l, "meta": meta, "desc": desc, "stats": stats, "hb_label": hb_label,
		"hb": hb, "actions": actions, "empty": empty, "scroll": scroll}
	return p


# =============================================================================================== layout

func _layout() -> void:
	if _root == null:
		return
	var vp := get_viewport().get_visible_rect().size
	var s := float(Settings.get_value(&"touch_ui_scale", 1.0))
	if Settings.is_mobile():
		s *= 1.6          # a 6.8" phone at arm's length: body text ≈ 12 sp
	s = clampf(s, 0.6, 2.4)
	# never let the logical canvas get smaller than the compact layout needs
	s = minf(s, minf(vp.x / 1300.0, vp.y / 620.0))
	_root.scale = Vector2(s, s)
	_root.position = Vector2.ZERO
	_root.size = vp / s
	_compact = _root.size.y < 900.0
	var mh := 24 if _compact else 44
	_margin.add_theme_constant_override("margin_left", mh)
	_margin.add_theme_constant_override("margin_right", mh)
	_margin.add_theme_constant_override("margin_top", 12 if _compact else 30)
	_margin.add_theme_constant_override("margin_bottom", 8 if _compact else 22)
	_header.custom_minimum_size.y = 50 if _compact else 58
	_brand.visible = _root.size.x > 1560.0
	_detail_panel.custom_minimum_size.x = clampf(_root.size.x * 0.25, 350.0, 470.0)
	(_detail["stage"] as Control).custom_minimum_size.y = clampf(_root.size.y * 0.18, 104.0, 196.0)
	(_rd["icon"] as Control).custom_minimum_size = Vector2.ONE * (112.0 if _compact else 150.0)
	(_rd["panel"] as Control).custom_minimum_size.x = 440.0 if _compact else 520.0
	_craft_left.custom_minimum_size.x = 520.0 if _compact else 600.0
	for row in _recipe_rows:
		row.custom_minimum_size.y = _recipe_row_h()
	_frame.set_offsets_preset(Control.PRESET_FULL_RECT)
	_fit_doll()
	_fit_grids()
	_mark_dirty()


func _recipe_row_h() -> float:
	return 64.0 if _compact else 76.0


## Height available to the pages (root minus margins, header, footer and gaps).
func _body_height() -> float:
	var m := 20.0 if _compact else 52.0
	return _root.size.y - m - _header.custom_minimum_size.y - 30.0 - 28.0


## Chooses pack/container grid columns and slot sizes so the stacks (plus the hotbar row) fill their panels.
func _fit_grids() -> void:
	if _root == null:
		return
	var mh := 48.0 if _compact else 88.0
	var bh := _body_height()
	var total_w := _root.size.x - mh - _detail_panel.custom_minimum_size.x - 14.0
	var n := inv.size() if inv != null else ItemActions.BASE_SLOTS
	const PAD := 36.0 + 16.0            # card padding + scrollbar room
	var fixed_h := 36.0 + 24.0 + 12.0 * 4.0 + 1.0 + 18.0
	if container_inv != null:
		var wp := floorf((total_w - 14.0) * 0.56)
		_slot_px = _grid_fit(_pack_grid, n, wp - PAD, bh - fixed_h, true)
		_cont_px = _grid_fit(_cont_grid, container_inv.size(), total_w - 14.0 - wp - PAD, bh - 36.0 - 24.0 - 12.0, false)
		_pack_panel.custom_minimum_size.x = wp
	else:
		_slot_px = _grid_fit(_pack_grid, n, total_w - PAD, bh - fixed_h, true)
		_pack_panel.custom_minimum_size.x = 0.0
	for s2 in _pack_slots + _hotbar_slots + _wear_slots:
		s2.custom_minimum_size = Vector2(_slot_px, _slot_px)
	for s2 in _cont_slots:
		s2.custom_minimum_size = Vector2(_cont_px, _cont_px)


## Best (largest) slot size for `n` slots in w × h, trying 4–12 columns; sets the grid's columns.
static func _grid_fit(grid: GridContainer, n: int, w: float, h: float, hotbar_row: bool) -> float:
	const GAP := 8.0
	var best := 0.0
	var best_cols := 6
	var best_waste := 1 << 20
	for cols in range(4, 13):
		var rows := ceili(float(maxi(n, 1)) / cols)
		var zw := (w - (cols - 1) * GAP) / cols
		var zh := (h - (rows - 1) * GAP - (GAP if hotbar_row else 0.0)) / (rows + (1 if hotbar_row else 0))
		if hotbar_row:
			zw = minf(zw, (w - 5.0 * GAP) / 6.0)
		var z := minf(minf(zw, zh), 112.0)
		var waste := rows * cols - n
		if z > best + 2.0 or (absf(z - best) <= 2.0 and waste < best_waste):
			best = maxf(z, best)
			best_cols = cols
			best_waste = waste
	grid.columns = best_cols
	return floorf(clampf(best, 60.0, 112.0))


## Columns for the "wearable gear" grid: the equipment page's middle card width over the slot pitch.
func _wear_columns() -> int:
	var mh := 48.0 if _compact else 88.0
	var w := _root.size.x - mh - _detail_panel.custom_minimum_size.x - (_doll as Control).custom_minimum_size.x - 36.0 * 2.0 - 14.0 * 2.0 - 16.0
	return clampi(int((w + 8.0) / (_slot_px + 8.0)), 3, 10)


## Scales the paper doll to the page height (phones).
func _fit_doll() -> void:
	var doll := _doll as DollFigure
	if doll == null:
		return
	var k := clampf((_body_height() - 36.0 - 30.0) / 590.0, 0.6, 1.0)
	doll.k = k
	doll.custom_minimum_size = Vector2(460.0, 590.0) * k
	for e in EQUIP_LAYOUT:
		var sl: ItemSlot = _equip_slots[e[0]]
		sl.position = (e[2] as Vector2) * k
		sl.size = Vector2(88.0, 88.0) * k
	doll.queue_redraw()


# =============================================================================================== refresh

func _mark_dirty() -> void:
	_dirty = true


func _process(delta: float) -> void:
	_hover_sfx_cd -= delta
	_poll_injected_actions()
	_process_craft(delta)
	if _status_timer > 0.0:
		_status_timer -= delta
		if _status_timer <= 0.0:
			_footer_status.text = ""
	if not is_open:
		return
	if player == null or not is_instance_valid(player) or ItemActions.inventory_of(player) != inv:
		if Game.player != null and is_instance_valid(Game.player):
			player = Game.player
			inv = ItemActions.inventory_of(player)
			_dirty = true
		else:
			close()
			return
	if container_node != null and (not is_instance_valid(container_node) or _too_far(container_node, 4.0)):
		_clear_container()
		_dirty = true
	if station_node != null and (not is_instance_valid(station_node) or _too_far(station_node, 4.5)):
		station_id = &"hand"
		station_node = null
		_dirty = true
	_slow_t -= delta
	if _slow_t <= 0.0:
		_slow_t = 0.25            # clock / temperature / station status need not update every frame
		_update_header_info()
		if tab == Tab.CRAFTING and not _dirty:
			_update_station_card()
	# An anchored container that once grew to a (transient) large minimum size keeps its offsets: snap it back.
	if _frame.size.y > _root.size.y + 0.5 and (_tween == null or not _tween.is_running()) \
			and _frame.get_combined_minimum_size().y <= _root.size.y:
		_frame.set_offsets_preset(Control.PRESET_FULL_RECT)
	if _dirty:
		_dirty = false
		_refresh_all()
	elif tab == Tab.CRAFTING:
		_update_craft_progress()


func _too_far(n: Node, dist: float) -> bool:
	if not (n is Node3D) or not (player is Node3D):
		return false
	return (n as Node3D).global_position.distance_to((player as Node3D).global_position) > dist


func _refresh_all() -> void:
	if inv == null:
		return
	_fit_grids()
	_refresh_pack()
	_refresh_container()
	_refresh_hotbars()
	_refresh_weight()
	match tab:
		Tab.EQUIPMENT:
			_refresh_equipment()
		Tab.CRAFTING:
			_refresh_crafting()
	_refresh_detail()
	_update_footer()


func _set_tab(t: Tab, sfx := false) -> void:
	tab = t
	for i in _pages.size():
		_pages[i].visible = i == t
	for i in _tab_buttons.size():
		_tab_buttons[i].add_theme_color_override("font_color", InvStyle.TEXT if i == t else InvStyle.TEXT_DIM)
	_detail_panel.visible = t != Tab.CRAFTING
	_place_underline.call_deferred()
	if sfx:
		Audio.play_ui(&"ui_click")
	if t == Tab.CRAFTING:
		_cancel_move()
	_dirty = true
	if _device == "pad" or _device == "keys":
		_ensure_focus.call_deferred()


func _place_underline() -> void:
	var b := _tab_buttons[tab]
	_tab_underline.position = Vector2(b.position.x + 22, b.position.y + b.size.y - 3)
	_tab_underline.size = Vector2(b.size.x - 44, 3)


func _update_header_info() -> void:
	var parts: PackedStringArray = [Climate.get_time_string()]
	if player is Node3D:
		var p := (player as Node3D).global_position
		parts.append("%d °C" % roundi(Climate.get_air_temperature(p)))
		parts.append("%s m" % _thousands(roundi(p.y)))
	_info_label.text = "   ".join(parts)


static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out


func _refresh_weight() -> void:
	var w := inv.total_weight()
	var mw := inv.max_weight
	_weight_label.text = "%.1f / %d kg" % [w, roundi(mw)]
	_weight_bar.value = clampf(w / maxf(mw, 0.1), 0.0, 1.0)
	var c := InvStyle.GOOD if w < mw * 0.8 else (InvStyle.WARN if w <= mw else InvStyle.BAD)
	_set_bar_color(_weight_bar, c)
	_weight_label.add_theme_color_override("font_color", InvStyle.BAD if w > mw else InvStyle.TEXT)


func _sync_slots(grid: GridContainer, list: Array[ItemSlot], inventory: Inventory) -> void:
	var n := inventory.size() if inventory else 0
	while list.size() < n:
		var s := _make_slot(ItemSlot.Kind.INV)
		s.custom_minimum_size = Vector2.ONE * (_cont_px if list == _cont_slots else _slot_px)
		grid.add_child(s)
		list.append(s)
	while list.size() > n:
		var s: ItemSlot = list.pop_back()
		if s == sel_slot:
			sel_slot = null
		s.queue_free()
	for i in n:
		var s := list[i]
		s.inventory = inventory
		s.index = i
		s.set_stack(inventory.get_slot(i))
		s.set_selected(s == sel_slot)
		s.set_target(s == move_from)


func _refresh_pack() -> void:
	_sync_slots(_pack_grid, _pack_slots, inv)
	var used := inv.size() - inv.free_slots()
	_pack_title.text = "PACK   %d / %d" % [used, inv.size()]


func _refresh_container() -> void:
	_cont_panel.visible = container_inv != null
	if container_inv == null:
		_sync_slots(_cont_grid, _cont_slots, null)
		return
	_cont_title.text = "%s   %.1f kg" % [container_title.to_upper(), container_inv.total_weight()]
	_sync_slots(_cont_grid, _cont_slots, container_inv)


func _refresh_hotbars() -> void:
	var hb := ItemActions.hotbar_of(player)
	var active := int(player.get("active_slot")) if player != null and player.get("active_slot") != null else -1
	for s in _hotbar_slots:
		var id: StringName = hb[s.index] if s.index < hb.size() else &""
		var cnt := inv.count(id) if id != &"" else 0
		s.set_stack({} if id == &"" else {"id": id, "count": cnt, "durability": 1.0})
		s.dimmed = id != &"" and cnt <= 0
		s.set_selected(s == sel_slot)
		s.empty_label = ""
		s.hotkey = str(s.index + 1) + ("•" if s.index == active else "")
		s.queue_redraw()


func _refresh_equipment() -> void:
	var eq := ItemActions.equipment_of(player)
	for slot in _equip_slots:
		var s: ItemSlot = _equip_slots[slot]
		var id: StringName = eq.get(slot, &"")
		s.set_stack({} if id == &"" else {"id": id, "count": 1, "durability": 1.0})
		s.set_selected(s == sel_slot)
	_doll.queue_redraw()
	# wearables in the pack
	var idxs: Array[int] = []
	for i in inv.size():
		var st := inv.get_slot(i)
		if not st.is_empty() and ItemInfo.is_wearable(st["id"]):
			idxs.append(i)
	var cols := _wear_columns()
	_wear_grid.columns = cols
	var shown := maxi(ceili(float(maxi(idxs.size(), 1)) / cols), 2) * cols
	while _wear_slots.size() < shown:
		var s := _make_slot(ItemSlot.Kind.INV)
		s.custom_minimum_size = Vector2(_slot_px, _slot_px)
		_wear_grid.add_child(s)
		_wear_slots.append(s)
	for k in _wear_slots.size():
		var s := _wear_slots[k]
		s.visible = k < shown
		if k < idxs.size():
			s.inventory = inv
			s.index = idxs[k]
			s.set_stack(inv.get_slot(idxs[k]))
		else:
			s.inventory = null
			s.index = -1
			s.set_stack({})
		s.set_selected(s == sel_slot)
	# protection summary
	for c in _stats_box.get_children():
		c.queue_free()
	var tot := ItemActions.clothing_totals(eq)
	_stat_row(_stats_box, "Insulation", "+%.1f °C" % float(tot["insulation"]), clampf(float(tot["insulation"]) / 30.0, 0.0, 1.0), InvStyle.COLD)
	_stat_row(_stats_box, "Windproof", "%d%%" % roundi(float(tot["windproof"]) * 100.0), float(tot["windproof"]), InvStyle.COLD)
	_stat_row(_stats_box, "Waterproof", "%d%%" % roundi(float(tot["waterproof"]) * 100.0), float(tot["waterproof"]), InvStyle.COLD)
	_stat_row(_stats_box, "Carry", "%d slots · %d kg" % [inv.size(), roundi(inv.max_weight)], -1.0, InvStyle.TEXT)
	var gear := ItemActions.gear_tags(player)
	var chips := HFlowContainer.new()
	chips.add_theme_constant_override("h_separation", 6)
	chips.add_theme_constant_override("v_separation", 6)
	for g in ["crampons", "ice_axe", "rope", "goggles", "o2_mask"]:
		var have := gear.has(StringName(g))
		var l := InvStyle.label(("✓ " if have else "· ") + String(ItemInfo.GEAR_LABELS.get(g, g)), 16,
			InvStyle.GOOD if have else InvStyle.TEXT_FAINT, "Medium")
		var pc := PanelContainer.new()
		pc.add_theme_stylebox_override("panel", InvStyle.panel(Color(1, 1, 1, 0.04 if have else 0.015), 4,
			Color(InvStyle.GOOD.r, InvStyle.GOOD.g, InvStyle.GOOD.b, 0.35) if have else InvStyle.LINE, 1, 6))
		pc.add_child(l)
		chips.add_child(pc)
	_stats_box.add_child(chips)


func _stat_row(parent: Container, label: String, value: String, bar: float, bar_color: Color, value_color := InvStyle.TEXT) -> void:
	var row := VBoxContainer.new()
	row.add_theme_constant_override("separation", 3)
	var h := HBoxContainer.new()
	var l := InvStyle.label(label, 17, InvStyle.TEXT_DIM)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	h.add_child(InvStyle.label(value, 17, value_color, "Mono"))
	row.add_child(h)
	if bar >= 0.0:
		var pb := _bar(bar_color, 3)
		pb.value = bar
		row.add_child(pb)
	parent.add_child(row)


# ---------------------------------------------------------------------------------------------- selection & detail

func _select_slot(s: ItemSlot) -> void:
	if s == null:
		return
	if sel_slot != s:
		if sel_slot and is_instance_valid(sel_slot):
			sel_slot.set_selected(false)
		sel_slot = s
		s.set_selected(true)
		_refresh_detail()


func _selected_stack() -> Dictionary:
	if sel_slot == null or not is_instance_valid(sel_slot):
		return {}
	return sel_slot.stack


func _refresh_detail() -> void:
	var st := _selected_stack()
	var empty := st.is_empty()
	var stage: IconStage = _detail["stage"]
	for k in ["name", "meta", "desc", "stats", "hb_label", "hb"]:
		(_detail[k] as Control).visible = not empty
	(_detail["empty"] as Control).visible = empty
	stage.set_icon(null if empty else ItemDB.get_icon(StringName(st["id"])))
	var actions: Container = _detail["actions"]
	for c in actions.get_children():
		c.queue_free()
	if empty:
		if sel_slot and sel_slot.kind == ItemSlot.Kind.EQUIP:
			(_detail["empty"] as Label).text = "%s slot is empty.\nDrag clothing here, or pick it in your pack and choose Wear." % ItemInfo.SLOT_LABELS.get(String(sel_slot.equip_slot), "This").capitalize()
		else:
			(_detail["empty"] as Label).text = "Select an item to inspect it."
		return
	var id := StringName(st["id"])
	var d := ItemDB.get_item(id)
	var n := int(st.get("count", 1))
	(_detail["name"] as Label).text = ItemInfo.name_of(id) + ("  ×%d" % n if n > 1 else "")
	var meta: PackedStringArray = [ItemInfo.category_label(String(d.get("category", "")))]
	meta.append(ItemInfo.format_weight(float(d.get("weight", 0.0)) * maxi(n, 1)))
	var slot := String(d.get("equip_slot", ""))
	if slot != "" and slot != "hand":
		meta.append("Worn: " + String(ItemInfo.SLOT_LABELS.get(slot, slot)))
	(_detail["meta"] as Label).text = "  ·  ".join(meta)
	(_detail["desc"] as Label).text = String(d.get("desc", ""))
	var stats: Container = _detail["stats"]
	for c in stats.get_children():
		c.queue_free()
	for row in ItemInfo.stat_rows(id):
		var good: bool = row["good"]
		_stat_row(stats, row["label"], row["value"], float(row["bar"]), InvStyle.ACCENT, InvStyle.TEXT if good else InvStyle.BAD)
	var dur := float(st.get("durability", 1.0))
	if ItemSlot._has_durability(id) and sel_slot.kind != ItemSlot.Kind.HOTBAR:
		_stat_row(stats, "Condition", "%d%%" % roundi(dur * 100.0), dur, InvStyle.durability_color(dur))
	var holdable := ItemInfo.is_holdable(id) or ItemInfo.is_consumable(id)
	var own := sel_slot.kind == ItemSlot.Kind.INV and sel_slot.inventory == inv
	(_detail["hb_label"] as Control).visible = holdable and own
	(_detail["hb"] as Control).visible = holdable and own
	_build_actions(actions, id, n)


func _build_actions(box: Container, id: StringName, n: int) -> void:
	var kind := sel_slot.kind
	if kind == ItemSlot.Kind.EQUIP:
		_action_button(box, "Take off", "primary", func() -> void:
			if ItemActions.unequip(player, sel_slot.equip_slot):
				_status("Took off %s" % ItemInfo.name_of(id)))
		return
	if kind == ItemSlot.Kind.HOTBAR:
		_action_button(box, "Clear hotbar %d" % (sel_slot.index + 1), "secondary", func() -> void:
			ItemActions.assign_hotbar(player, sel_slot.index, &""))
		if inv.count(id) > 0 and ItemInfo.is_holdable(id):
			_action_button(box, "Hold", "primary", func() -> void: ItemActions.hold_item(player, id))
		return
	var verb := ItemInfo.primary_action(id)
	var in_player_inv := sel_slot.inventory == inv
	if verb != "" and in_player_inv:
		_action_button(box, verb, "primary", _action_use)
	if container_inv != null:
		_action_button(box, "Store" if in_player_inv else "Take", "primary" if (verb == "" or not in_player_inv) else "secondary",
			func() -> void: _quick_transfer(sel_slot))
	if n > 1:
		_action_button(box, "Split", "secondary", _action_split)
	if in_player_inv:
		_action_button(box, "Drop" if n <= 1 else "Drop all", "secondary", _action_drop)
		if n > 1:
			_action_button(box, "Drop one", "secondary", func() -> void: _action_drop(1))
	if _device == "pad" or _device == "keys":
		_action_button(box, "Move", "ghost", _begin_move)


func _action_button(box: Container, text: String, kind: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	InvStyle.style_button(b, kind, 19)
	b.custom_minimum_size = Vector2(0, 54)
	b.pressed.connect(func() -> void:
		Audio.play_ui(&"ui_click")
		cb.call())
	box.add_child(b)
	return b


func _status(text: String) -> void:
	_footer_status.text = text
	_status_timer = 3.0


# ---------------------------------------------------------------------------------------------- item actions

func _action_use() -> void:
	if sel_slot == null or sel_slot.inventory != inv or sel_slot.stack.is_empty():
		return
	var id := sel_slot.item_id()
	var verb := ItemInfo.primary_action(id)
	if ItemActions.use_slot(player, inv, sel_slot.index):
		var past := {"Eat": "Ate", "Drink": "Drank", "Apply": "Applied", "Take": "Took", "Read": "Read", "Wear": "Now wearing", "Hold": "Holding"}
		_status("%s %s" % [past.get(verb, verb), ItemInfo.name_of(id)])


func _activate_slot(s: ItemSlot) -> void:
	_select_slot(s)
	if s.stack.is_empty():
		return
	match s.kind:
		ItemSlot.Kind.EQUIP:
			ItemActions.unequip(player, s.equip_slot)
		ItemSlot.Kind.HOTBAR:
			if ItemInfo.is_holdable(s.item_id()):
				ItemActions.hold_item(player, s.item_id())
		_:
			if s.inventory == inv:
				if ItemInfo.primary_action(s.item_id()) != "":
					_action_use()
				elif container_inv:
					_quick_transfer(s)
			else:
				_quick_transfer(s)


func _action_drop(amount := -1) -> void:
	if sel_slot == null or sel_slot.inventory != inv or sel_slot.stack.is_empty():
		return
	var id := sel_slot.item_id()
	var n := int(sel_slot.stack.get("count", 1)) if amount < 0 else amount
	if ItemActions.drop_slot(player, inv, sel_slot.index, amount):
		_status("Dropped %s" % ItemInfo.stack_text(id, n))


func _action_split() -> void:
	if sel_slot == null or sel_slot.inventory == null:
		return
	var i := sel_slot.inventory.split(sel_slot.index)
	if i < 0:
		_status("No free slot to split into")


func _quick_transfer(s: ItemSlot) -> void:
	if container_inv == null or s == null or s.inventory == null or s.stack.is_empty():
		return
	var other := container_inv if s.inventory == inv else inv
	var id := s.item_id()
	var moved := s.inventory.transfer(s.index, other)
	if moved > 0:
		Audio.play_ui(&"ui_click")
		_status("%s %s" % ["Stored" if other == container_inv else "Took", ItemInfo.stack_text(id, moved)])
		if other == inv:
			Events.item_picked_up.emit(id, moved)
	else:
		_status("No room")


func _take_all() -> void:
	if container_inv == null:
		return
	var got := 0
	for i in container_inv.size():
		var st := container_inv.get_slot(i)
		if st.is_empty():
			continue
		var id: StringName = st["id"]
		var m := container_inv.transfer(i, inv)
		if m > 0:
			got += m
			Events.item_picked_up.emit(id, m)
	_status("Took %d item%s" % [got, "" if got == 1 else "s"] if got > 0 else "Nothing taken")


func _assign_selected_to_hotbar(i: int) -> void:
	var st := _selected_stack()
	if st.is_empty() or sel_slot.kind == ItemSlot.Kind.EQUIP:
		return
	var id := StringName(st["id"])
	if not (ItemInfo.is_holdable(id) or ItemInfo.is_consumable(id) or ItemDB.get_item(id).has("light")):
		_status("%s can't go on the hotbar" % ItemInfo.name_of(id))
		return
	ItemActions.assign_hotbar(player, i, id)
	Audio.play_ui(&"ui_click")
	_status("%s → hotbar %d" % [ItemInfo.name_of(id), i + 1])


func _on_slot_drop(from: ItemSlot, to: ItemSlot) -> void:
	if from == null or to == null:
		return
	var fid := from.item_id()
	match to.kind:
		ItemSlot.Kind.EQUIP:
			if from.kind == ItemSlot.Kind.INV and from.inventory == inv:
				ItemActions.equip_slot(player, inv, from.index)
		ItemSlot.Kind.HOTBAR:
			if from.kind == ItemSlot.Kind.HOTBAR:
				var hb := ItemActions.hotbar_of(player)
				var a: StringName = hb[from.index]
				hb[from.index] = hb[to.index]
				hb[to.index] = a
				Events.inventory_changed.emit()
			else:
				ItemActions.assign_hotbar(player, to.index, fid)
		ItemSlot.Kind.INV:
			if from.kind == ItemSlot.Kind.EQUIP:
				ItemActions.unequip(player, from.equip_slot)
			elif from.kind == ItemSlot.Kind.HOTBAR:
				ItemActions.assign_hotbar(player, from.index, &"")
			elif to.inventory == from.inventory:
				to.inventory.move(from.index, to.index)
			elif to.inventory != null and from.inventory != null:
				_move_between(from, to)
	Audio.play_ui(&"ui_click")
	_select_slot(to if not to.stack.is_empty() or to.kind != ItemSlot.Kind.INV else from)
	_mark_dirty()


## Cross-inventory drop onto a specific slot: fill, merge, or swap the two stacks.
func _move_between(from: ItemSlot, to: ItemSlot) -> void:
	var src := from.inventory
	var dst := to.inventory
	var a := src.get_slot(from.index)
	var b := dst.get_slot(to.index)
	if a.is_empty():
		return
	if b.is_empty():
		dst.set_slot(to.index, a.duplicate())
		src.set_slot(from.index, {})
	elif b["id"] == a["id"]:
		var limit := Inventory.stack_limit(a["id"])
		var k := mini(limit - int(b["count"]), int(a["count"]))
		if k > 0:
			b["count"] = int(b["count"]) + k
			a["count"] = int(a["count"]) - k
			dst.set_slot(to.index, b)
			src.set_slot(from.index, {} if int(a["count"]) <= 0 else a)
	else:
		dst.set_slot(to.index, a.duplicate())
		src.set_slot(from.index, b.duplicate())
	if dst == inv:
		Events.item_picked_up.emit(StringName(a["id"]), int(a["count"]))


func _begin_move() -> void:
	if sel_slot == null or sel_slot.stack.is_empty():
		return
	move_from = sel_slot
	move_from.set_target(true)
	_status("Moving %s — choose a slot, B to cancel" % ItemInfo.name_of(move_from.item_id()))
	move_from.grab_focus()


func _place_move(to: ItemSlot) -> void:
	var from := move_from
	_cancel_move()
	if from != null and to != from and is_instance_valid(from) and to.accepts(from.item_id()):
		_on_slot_drop(from, to)


func _cancel_move() -> void:
	if move_from and is_instance_valid(move_from):
		move_from.set_target(false)
	move_from = null


## Dropping a dragged stack on the dimmed backdrop drops it in the world.
func drop_to_world(from: ItemSlot) -> void:
	if from == null:
		return
	match from.kind:
		ItemSlot.Kind.INV:
			if from.inventory == inv:
				_select_slot(from)
				_action_drop()
			elif from.inventory != null:
				var st := from.inventory.remove_at(from.index)
				if not st.is_empty():
					ItemActions.drop_stack(player, st)
		ItemSlot.Kind.EQUIP:
			var id := from.item_id()
			if ItemActions.unequip(player, from.equip_slot):
				var i := inv.find(id)
				if i >= 0:
					ItemActions.drop_slot(player, inv, i, 1)
		ItemSlot.Kind.HOTBAR:
			ItemActions.assign_hotbar(player, from.index, &"")


# =============================================================================================== crafting

func _context_stations() -> Array[StringName]:
	var out := Crafting.available_stations(player)
	if station_id != &"hand" and not out.has(station_id):
		if station_node == null or (station_node.has_method("is_station_active") and station_node.call("is_station_active")):
			out.append(station_id)
	return out


func _refresh_crafting() -> void:
	for c in _chip_row.get_children():
		(c as Button).set_pressed_no_signal(String(c.get_meta("key")) == recipe_filter)
	_update_station_card()
	var stations := _context_stations()
	var shown_stations: Array[StringName] = stations.duplicate()
	if station_id != &"hand" and not shown_stations.has(station_id):
		shown_stations.append(station_id)
	var entries: Array[Dictionary] = []
	for r in ItemDB.recipes:
		var st := StringName(r.get("station", "hand"))
		if not shown_stations.has(st):
			continue
		if recipe_filter != "all" and String(r.get("category", "")) != recipe_filter:
			continue
		var chk := Crafting.can_craft(r, inv, station_id, player)
		var rank := 0 if bool(chk["ok"]) else (2 if bool(chk["locked"]) else 1)
		entries.append({"r": r, "chk": chk, "rank": rank})
	entries.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if a["rank"] != b["rank"]:
			return a["rank"] < b["rank"]
		var sa := String((a["r"] as Dictionary).get("station", "hand")) != "hand"
		var sb := String((b["r"] as Dictionary).get("station", "hand")) != "hand"
		if sa != sb:
			return sa
		return Blueprints.display_name(StringName((a["r"] as Dictionary)["id"])) < Blueprints.display_name(StringName((b["r"] as Dictionary)["id"])))
	while _recipe_rows.size() < entries.size():
		var row := RecipeRow.new()
		row.screen = self
		row.custom_minimum_size.y = _recipe_row_h()
		_recipe_list.add_child(row)
		_recipe_rows.append(row)
	for i in _recipe_rows.size():
		var row: RecipeRow = _recipe_rows[i]
		row.visible = i < entries.size()
		if i < entries.size():
			row.setup(entries[i]["r"], entries[i]["chk"], _silhouette)
			row.set_selected(StringName(entries[i]["r"]["id"]) == StringName(sel_recipe.get("id", "")))
	if (sel_recipe.is_empty() or not _recipe_visible(sel_recipe)) and not entries.is_empty():
		sel_recipe = entries[0]["r"]
		for row in _recipe_rows:
			(row as RecipeRow).set_selected((row as RecipeRow).recipe == sel_recipe)
	_refresh_recipe_detail()


func _recipe_visible(r: Dictionary) -> bool:
	for row in _recipe_rows:
		if row.visible and (row as RecipeRow).recipe == r:
			return true
	return false


func select_recipe(r: Dictionary) -> void:
	sel_recipe = r
	for row in _recipe_rows:
		(row as RecipeRow).set_selected((row as RecipeRow).recipe == r)
	_refresh_recipe_detail()


func _refresh_recipe_detail() -> void:
	var r := sel_recipe
	var panel: Control = _rd["panel"]
	panel.visible = not r.is_empty()
	if r.is_empty():
		return
	var chk := Crafting.can_craft(r, inv, station_id, player)
	var locked := bool(chk["locked"])
	var rid := StringName(r.get("id", ""))
	var result := StringName(r.get("result", ""))
	var stage: IconStage = _rd["icon"]
	stage.set_icon(ItemDB.get_icon(result), _silhouette if locked else null)
	var cnt := int(r.get("count", 1))
	(_rd["name"] as Label).text = ("Unknown blueprint" if locked else Blueprints.display_name(rid)) + ("" if cnt <= 1 or locked else "  ×%d" % cnt)
	var st := StringName(r.get("station", "hand"))
	(_rd["meta"] as Label).text = "%s  ·  %s  ·  %s" % [Crafting.station_name(st), String(r.get("category", "")).capitalize(),
		ItemInfo.format_seconds(float(r.get("time", 1.0)))]
	if locked:
		(_rd["desc"] as Label).text = _unlock_hint(r)
		(_rd["note"] as Label).text = ""
	else:
		(_rd["desc"] as Label).text = String(ItemDB.get_item(result).get("desc", ""))
		(_rd["note"] as Label).text = String(r.get("note", ""))
	var ings: VBoxContainer = _rd["ings"]
	for c in ings.get_children():
		c.queue_free()
	var need: Dictionary = r.get("ingredients", {})
	for k in need:
		var have := inv.count(StringName(k))
		ings.add_child(_ingredient_row(StringName(k), have, int(need[k]), locked))
	for t in r.get("tools", []):
		var ok := Crafting.find_tool(inv, StringName(t)) >= 0
		ings.add_child(_tool_row(StringName(t), ok, locked))
	if st != &"hand":
		var ok_st := bool(chk["station_ok"])
		ings.add_child(_tool_row(st, ok_st, locked, true))
	var rstats: VBoxContainer = _rd["stats"]
	for c in rstats.get_children():
		c.queue_free()
	var rows := [] if locked else ItemInfo.stat_rows(result)
	(_rd["stats_label"] as Control).visible = not rows.is_empty()
	for row in rows:
		_stat_row(rstats, row["label"], row["value"], float(row["bar"]), InvStyle.ACCENT, InvStyle.TEXT if bool(row["good"]) else InvStyle.BAD)
	var crafting_this := craft_job != null and craft_job.is_running() and craft_recipe_id == rid
	var busy := craft_job != null and craft_job.is_running()
	var cb: Button = _rd["craft"]
	cb.disabled = not bool(chk["ok"]) or (busy and not crafting_this)
	cb.text = "Crafting…" if crafting_this else ("Craft" if cnt <= 1 else "Craft ×%d" % cnt)
	(_rd["cancel"] as Button).visible = crafting_this
	var reason := String(chk["reason"])
	if bool(chk["ok"]) and not bool(chk["room"]):
		reason = "Pack is full — the result will be dropped at your feet."
	elif busy and not crafting_this:
		reason = "Busy crafting %s" % Blueprints.display_name(craft_recipe_id)
	(_rd["reason"] as Label).text = reason
	(_rd["reason"] as Label).add_theme_color_override("font_color", InvStyle.WARN if bool(chk["ok"]) else InvStyle.BAD)
	_update_craft_progress()


func _unlock_hint(r: Dictionary) -> String:
	var u: Dictionary = r.get("unlock", {})
	var hints: PackedStringArray = []
	for id in u.get("read", []):
		hints.append("read the %s" % ItemInfo.name_of(StringName(id)).to_lower())
	for id in u.get("pickup", []):
		hints.append("find %s" % ItemInfo.name_of(StringName(id)).to_lower())
	for id in u.get("craft", []):
		hints.append("make a %s" % ItemInfo.name_of(StringName(id)).to_lower() if ItemDB.has_item(StringName(id)) else "craft more")
	if not (u.get("scan", []) as Array).is_empty():
		hints.append("scan the right equipment")
	if hints.is_empty():
		return "You don't know how to make this yet."
	return "You don't know how to make this yet. To learn it: %s." % " or ".join(hints)


func _ingredient_row(id: StringName, have: int, need: int, locked: bool) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var ic := TextureRect.new()
	ic.texture = ItemDB.get_icon(id)
	ic.custom_minimum_size = Vector2(46, 46)
	ic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	ic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	ic.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	if locked:
		ic.material = _silhouette
	row.add_child(ic)
	var name_l := InvStyle.label("???" if locked else ItemInfo.name_of(id), 19, InvStyle.TEXT if have >= need else InvStyle.TEXT_DIM)
	name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(name_l)
	var q := InvStyle.label("%d / %d" % [have, need], 19, InvStyle.GOOD if have >= need else InvStyle.BAD, "Mono")
	q.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(q)
	return row


func _tool_row(key: StringName, ok: bool, locked: bool, is_station := false) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var box := Control.new()
	box.custom_minimum_size = Vector2(46, 30)
	row.add_child(box)
	var text := ("At a %s" % Crafting.station_name(key).to_lower()) if is_station else ("Tool: %s" % Crafting.tool_name(key))
	var l := InvStyle.label("???" if locked else text, 18, InvStyle.TEXT_DIM, "Italic")
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(l)
	row.add_child(InvStyle.label("✓" if ok else "✕", 20, InvStyle.GOOD if ok else InvStyle.BAD, "SemiBold"))
	return row


func _on_craft_pressed() -> void:
	if sel_recipe.is_empty() or (craft_job != null and craft_job.is_running()):
		return
	var scale := 0.6 if Game.difficulty == &"explorer" else 1.0
	var job := Crafting.begin(sel_recipe, inv, station_id, player, scale)
	if job == null:
		Audio.play_ui(&"ui_back")
		return
	craft_job = job
	craft_recipe_id = StringName(sel_recipe.get("id", ""))
	var st := StringName(sel_recipe.get("station", "hand"))
	craft_station_node = station_node if st == station_id else _nearest_station(st)
	Audio.play_sfx(&"craft")
	_status("Crafting %s…" % Blueprints.display_name(craft_recipe_id))
	_mark_dirty()


func _nearest_station(sid: StringName) -> Node:
	if sid == &"hand" or not (player is Node3D):
		return null
	var best: Node = null
	var bd := INF
	for n in get_tree().get_nodes_in_group(Crafting.STATION_GROUP):
		if n is Node3D and StringName(n.get("station_id")) == sid:
			var d := (n as Node3D).global_position.distance_to((player as Node3D).global_position)
			if d < bd:
				bd = d
				best = n
	return best


## A load replaces the inventory the running job took its ingredients from: drop the job without refunding
## (ItemsRoot's save carries the refund for a job that was running when the game was saved).
func _on_game_loaded(_slot: int) -> void:
	if craft_job != null and craft_job.is_running():
		craft_job.aborted = true
	craft_job = null
	_mark_dirty()


func _cancel_craft() -> void:
	if craft_job and craft_job.is_running():
		var overflow := craft_job.cancel()
		if overflow > 0:
			_status("Cancelled — some materials didn't fit and were dropped")
		else:
			_status("Cancelled")
	craft_job = null
	_mark_dirty()


func _process_craft(delta: float) -> void:
	if craft_job == null or not craft_job.is_running() or get_tree().paused:
		return
	if craft_job.station != &"hand":
		var sn := craft_station_node
		var ok := sn != null and is_instance_valid(sn) and (not sn.has_method("is_station_active") or bool(sn.call("is_station_active")))
		if ok and player is Node3D and sn is Node3D:
			ok = (sn as Node3D).global_position.distance_to((player as Node3D).global_position) <= float(sn.get("use_radius")) + 1.5
		if not ok:
			craft_job.cancel()
			craft_job = null
			Game.notify("Crafting interrupted.", &"warning")
			_mark_dirty()
			return
	if craft_job.advance(delta):
		var res := craft_job.last_result
		var result := StringName(res.get("result", ""))
		var n := int(res.get("count", 1))
		var overflow := int(res.get("overflow", 0))
		craft_job = null
		if overflow > 0:
			ItemActions.drop_stack(player, {"id": result, "count": overflow, "durability": 1.0})
		Audio.play_sfx(&"craft_done")
		Game.notify("Crafted %s" % ItemInfo.stack_text(result, n), &"item")
		_status("Crafted %s%s" % [ItemInfo.stack_text(result, n), " (dropped — pack full)" if overflow > 0 else ""])
		_mark_dirty()


func _update_craft_progress() -> void:
	var prog: ProgressBar = _rd["progress"]
	var running := craft_job != null and craft_job.is_running() and craft_recipe_id == StringName(sel_recipe.get("id", ""))
	prog.visible = running
	if running:
		prog.value = craft_job.progress()
		var secs := ceili(craft_job.remaining())
		if secs != _craft_secs:
			_craft_secs = secs
			(_rd["craft"] as Button).text = "Crafting…  %s" % ItemInfo.format_seconds(craft_job.remaining())
	else:
		_craft_secs = -1


func _update_station_card() -> void:
	var has_station := station_id != &"hand"
	_station_card.visible = has_station
	if not has_station:
		return
	var icon_id := station_id if ItemDB.get_icon(station_id) != null else &"campfire"
	_station_icon.texture = ItemDB.get_icon(icon_id)
	_station_name.text = Crafting.station_name(station_id).to_upper()
	var status := ""
	if station_node != null and is_instance_valid(station_node) and station_node.has_method("get_station_status"):
		status = String(station_node.call("get_station_status"))
	_station_status.text = status
	var fire := station_node as Campfire
	_station_bar.visible = fire != null
	if fire:
		_station_bar.value = fire.fuel_fraction()
		_set_bar_color(_station_bar, InvStyle.ACCENT if fire.is_burning() else InvStyle.TEXT_FAINT)
	var sig := _station_actions_signature(fire)
	if _station_actions.get_meta("sig", "") == sig:
		return
	_station_actions.set_meta("sig", sig)
	for c in _station_actions.get_children():
		c.queue_free()
	if fire == null:
		return
	var seen := {}
	for s in inv.slots:
		if s.is_empty() or seen.has(s["id"]):
			continue
		var id: StringName = s["id"]
		seen[id] = true
		if fire.fuel_value(id) <= 0.0:
			continue
		var b := Button.new()
		b.text = "+ %s  ×%d" % [ItemInfo.name_of(id), inv.count(id)]
		InvStyle.style_button(b, "secondary", 16)
		b.custom_minimum_size = Vector2(0, 46)
		b.disabled = not fire.can_add_fuel(id)
		b.tooltip_text = "Burns for about %s" % ItemInfo.format_minutes(fire.fuel_value(id))
		b.pressed.connect(func() -> void:
			if fire.add_fuel(id, inv):
				_status("Added %s to the fire" % ItemInfo.name_of(id).to_lower())
				_station_actions.set_meta("sig", ""))
		_station_actions.add_child(b)
	if not fire.is_burning() and fire.fuel_minutes > 0.5:
		var lb := Button.new()
		lb.text = "Light fire"
		InvStyle.style_button(lb, "primary", 17)
		lb.custom_minimum_size = Vector2(0, 46)
		lb.pressed.connect(func() -> void:
			var res := fire.try_light(inv)
			if not bool(res.get("ok", false)):
				_status(String(res.get("text", "It won't catch.")))
			_station_actions.set_meta("sig", "")
			_mark_dirty())
		_station_actions.add_child(lb)


func _station_actions_signature(fire: Campfire) -> String:
	if fire == null:
		return "none"
	var parts: PackedStringArray = [str(fire.state), str(fire.fuel_minutes > 0.5), str(roundi(fire.fuel_minutes / 30.0))]
	for s in inv.slots:
		if not s.is_empty() and fire.fuel_value(s["id"]) > 0.0:
			parts.append("%s:%d" % [s["id"], inv.count(s["id"])])
	return "|".join(parts)


# =============================================================================================== footer

func _update_footer() -> void:
	if _footer_hint == null:
		return
	if _wear_hint:
		_wear_hint.text = ("Hotbar  ·  drag gear onto a slot" if _device == "touch" else "Hotbar  ·  select an item, press 1–6").to_upper()
	match _device:
		"pad":
			_footer_hint.text = "Ⓐ Actions   Ⓑ Back   Ⓨ Close   LB / RB Tabs"
		"touch":
			_footer_hint.text = "Tap an item for actions · drag to move, equip or drop"
		_:
			match tab:
				Tab.CRAFTING:
					_footer_hint.text = "Click a recipe · Q / R switch tabs · Tab close"
				_:
					_footer_hint.text = "Drag to move · Right-click use · Shift-click transfer · Ctrl-click split · 1–6 hotbar · G drop · Tab close"


# =============================================================================================== helper controls

## Dimmed backdrop; accepts dragged stacks to drop them into the world.
class DropZone extends ColorRect:
	var screen: InventoryScreen

	func _can_drop_data(_at: Vector2, data: Variant) -> bool:
		return data is Dictionary and (data as Dictionary).has("thin_air_slot")

	func _drop_data(_at: Vector2, data: Variant) -> void:
		if screen:
			screen.drop_to_world(data["thin_air_slot"])


## Large item icon on a soft radial "light table".
class IconStage extends Control:
	var _icon: TextureRect

	func _init() -> void:
		_icon = TextureRect.new()
		_icon.set_anchors_preset(Control.PRESET_FULL_RECT)
		_icon.offset_left = 6
		_icon.offset_top = 6
		_icon.offset_right = -6
		_icon.offset_bottom = -6
		_icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		_icon.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_icon)

	func set_icon(t: Texture2D, m: Material = null) -> void:
		_icon.texture = t
		_icon.material = m

	func _draw() -> void:
		var c := size * 0.5
		var r := minf(size.x, size.y) * 0.5
		for i in 12:
			var f := 1.0 - i / 12.0
			draw_circle(c, r * (0.35 + 0.65 * f), Color(1, 1, 1, 0.012))
		draw_arc(c, r * 0.98, 0.0, TAU, 64, Color(1, 1, 1, 0.05), 1.0, true)


## "Stick ×4", or just "Stone" for one.
static func _qty_name(id: StringName, n: int) -> String:
	return ItemInfo.name_of(id) if n == 1 else "%s ×%d" % [ItemInfo.name_of(id), n]


## A row in the recipe list.
class RecipeRow extends Button:
	var screen: InventoryScreen
	var recipe: Dictionary
	var check: Dictionary
	var _sil: Material
	var _sel := false
	var _icon: TextureRect

	func _init() -> void:
		custom_minimum_size = Vector2(0, 76)
		_icon = TextureRect.new()
		_icon.position = Vector2(14, 6)
		_icon.size = Vector2(64, 64)
		_icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		_icon.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_icon)
		focus_mode = Control.FOCUS_ALL
		for st in ["normal", "hover", "pressed", "focus", "disabled"]:
			add_theme_stylebox_override(st, _box(st))
		pressed.connect(func() -> void:
			Audio.play_ui(&"ui_click")
			screen.select_recipe(recipe))
		focus_entered.connect(func() -> void: screen.select_recipe(recipe))

	func _box(st: String) -> StyleBoxFlat:
		var sb := StyleBoxFlat.new()
		sb.set_corner_radius_all(5)
		sb.bg_color = Color(0, 0, 0, 0)
		sb.set_content_margin_all(0)
		if st == "hover":
			sb.bg_color = Color(1, 1, 1, 0.045)
		elif st == "pressed" or st == "focus":
			sb.bg_color = Color(1, 1, 1, 0.07)
		return sb

	func setup(r: Dictionary, chk: Dictionary, sil: Material) -> void:
		recipe = r
		check = chk
		_sil = sil
		tooltip_text = ""
		var locked := bool(chk.get("locked", false))
		_icon.texture = ItemDB.get_icon(StringName(r.get("result", "")))
		_icon.material = sil if locked else null
		_icon.modulate = Color(1, 1, 1, 1.0 if (locked or bool(chk.get("ok", false))) else 0.55)
		queue_redraw()

	func set_selected(v: bool) -> void:
		_sel = v
		var sb := _box("normal")
		if v:
			sb.bg_color = Color(InvStyle.ACCENT.r, InvStyle.ACCENT.g, InvStyle.ACCENT.b, 0.1)
			sb.border_color = Color(InvStyle.ACCENT.r, InvStyle.ACCENT.g, InvStyle.ACCENT.b, 0.6)
			sb.border_width_left = 3
		add_theme_stylebox_override("normal", sb)
		queue_redraw()

	func _draw() -> void:
		if recipe.is_empty():
			return
		var locked := bool(check.get("locked", false))
		var ok := bool(check.get("ok", false))
		var h := size.y
		_icon.size = Vector2(h - 12, h - 12)
		var x := h + 14.0
		var f := InvStyle.font("SemiBold")
		var title := "Unknown blueprint" if locked else Blueprints.display_name(StringName(recipe.get("id", "")))
		var n := int(recipe.get("count", 1))
		if n > 1 and not locked:
			title += "  ×%d" % n
		draw_string(f, Vector2(x, h * 0.44), title, HORIZONTAL_ALIGNMENT_LEFT, size.x - x - 110, 21,
			InvStyle.TEXT_FAINT if locked else (InvStyle.TEXT if ok else InvStyle.TEXT_DIM))
		var sub := ""
		if locked:
			sub = "Learn this blueprint to craft it"
		else:
			var parts: PackedStringArray = []
			var ing: Dictionary = recipe.get("ingredients", {})
			var miss: Dictionary = check.get("missing", {})
			for k in ing:
				parts.append(InventoryScreen._qty_name(StringName(k), int(ing[k])))
			sub = "  ·  ".join(parts)
			if not miss.is_empty():
				sub = "Missing: " + ", ".join(PackedStringArray(miss.keys().map(func(k: Variant) -> String:
					return InventoryScreen._qty_name(StringName(k), int(miss[k])))))
			elif not (check.get("missing_tools", []) as Array).is_empty():
				sub = "Needs %s" % Crafting.tool_name(StringName((check["missing_tools"] as Array)[0])).to_lower()
			elif not bool(check.get("station_ok", true)):
				sub = String(check.get("reason", ""))
		var f2 := InvStyle.font("Regular")
		var col := InvStyle.TEXT_FAINT if locked else (InvStyle.TEXT_DIM if ok else Color(InvStyle.BAD.r, InvStyle.BAD.g, InvStyle.BAD.b, 0.85))
		draw_string(f2, Vector2(x, h * 0.44 + 26), sub, HORIZONTAL_ALIGNMENT_LEFT, size.x - x - 110, 16, col)
		var fm := InvStyle.font("Mono")
		var t := ItemInfo.format_seconds(float(recipe.get("time", 1.0)))
		var tw := fm.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x
		draw_string(fm, Vector2(size.x - tw - 18, h * 0.44), t, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, InvStyle.TEXT_FAINT)
		var st := StringName(recipe.get("station", "hand"))
		if st != &"hand":
			var sn := Crafting.station_name(st).to_upper()
			var sw := InvStyle.caps_font("SemiBold", 1).get_string_size(sn, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
			draw_string(InvStyle.caps_font("SemiBold", 1), Vector2(size.x - sw - 18, h * 0.44 + 24), sn, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, InvStyle.ACCENT if ok else InvStyle.TEXT_FAINT)
		if ok:
			draw_circle(Vector2(6, h * 0.5), 3.0, InvStyle.GOOD)


## Stylised figure for the equipment page, with leader lines to the worn-item slots.
class DollFigure extends Control:
	var anchors: Array = []   # [[slot: Control, anchor: Vector2], ...]
	var k := 1.0              # drawn at 460×590 design units, scaled by k

	func _draw() -> void:
		draw_set_transform(Vector2.ZERO, 0.0, Vector2(k, k))
		var fill := Color(1, 1, 1, 0.045)
		var edge := Color(1, 1, 1, 0.12)
		var cx := 230.0
		# head + neck
		draw_circle(Vector2(cx, 78), 34, fill)
		draw_arc(Vector2(cx, 78), 34, 0, TAU, 48, edge, 1.5, true)
		var body := PackedVector2Array([Vector2(cx - 16, 110), Vector2(cx + 16, 110), Vector2(cx + 62, 136),
			Vector2(cx + 88, 250), Vector2(cx + 96, 352), Vector2(cx + 78, 356), Vector2(cx + 60, 262), Vector2(cx + 52, 296),
			Vector2(cx + 50, 400), Vector2(cx + 42, 548), Vector2(cx + 50, 566), Vector2(cx + 8, 566), Vector2(cx + 8, 408),
			Vector2(cx - 8, 408), Vector2(cx - 8, 566), Vector2(cx - 50, 566), Vector2(cx - 42, 548), Vector2(cx - 50, 400),
			Vector2(cx - 52, 296), Vector2(cx - 60, 262), Vector2(cx - 78, 356), Vector2(cx - 96, 352), Vector2(cx - 88, 250),
			Vector2(cx - 62, 136)])
		draw_colored_polygon(body, fill)
		var loop := body.duplicate()
		loop.append(body[0])
		draw_polyline(loop, edge, 1.5, true)
		for a in anchors:
			var slot: Control = a[0]
			var p: Vector2 = a[1]
			var sc := (slot.position + slot.size * 0.5) / k
			var start := sc + (p - sc).normalized() * slot.size.x / k * 0.52
			var sel := slot is ItemSlot and ((slot as ItemSlot).is_selected or not (slot as ItemSlot).stack.is_empty())
			var col := Color(InvStyle.ACCENT.r, InvStyle.ACCENT.g, InvStyle.ACCENT.b, 0.55) if sel else Color(1, 1, 1, 0.1)
			draw_line(start, p, col, 1.0, true)
			draw_circle(p, 3.0, col)
