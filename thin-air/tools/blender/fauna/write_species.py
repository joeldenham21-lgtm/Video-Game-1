"""Writes src/fauna/species/<id>.tres (SpeciesDef) for the non-wolf species from one table.
python3 tools/blender/fauna/write_species.py   (wolf.tres is hand-tuned and not overwritten)"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "src", "fauna", "species")

COMMON = dict(scale_range="Vector2(0.94, 1.06)", fur_sheen=0.18, accel=6.0, max_slope=38.0, wade_depth=0.5,
              fov_deg=300.0, hearing=1.2, fire_fear=1.0, skittish=0.6, aggression=0.0, damage=0.0,
              damage_type='&"bite"', attack_range=1.5, attack_cooldown=2.0, harvest_hits=6, night_weight=0.5,
              day_weight=1.0, spawn_weight=1.0, slope_pref="Vector2(0, 25)")

SPECIES = {
    "deer": dict(display_name='"Mule deer"', model="deer", coat="deer", ai="deer", mass=65.0, health=45.0,
                 body_radius=0.2, body_length=1.2, body_height=0.8, eye_height=1.3, fur_length=0.02,
                 eye_color="Color(0.08, 0.05, 0.03, 1)", walk_speed=1.2, trot_speed=3.0, run_speed=11.0, accel=9.0,
                 turn_rate=260.0, max_slope=42.0, sight_range=130.0, fov_deg=310.0, hearing=1.6, smell_range=200.0,
                 fire_fear=1.4, skittish=0.85, flee_distance=90.0,
                 loot='{"meat_raw": 5, "hide_raw": 2, "bone": 2}', harvest_hits=8,
                 gait_clips='PackedStringArray("walk", "trot", "gallop")',
                 sfx_alarm='&"deer_bark"', sfx_hurt='&"deer_bark"', sfx_death='&"deer_bark"',
                 biomes='PackedStringArray("valley", "forest", "subalpine")', min_alt=1300.0, max_alt=2400.0,
                 group_min=1, group_max=4, night_weight=0.5, day_weight=1.3, spawn_weight=1.3,
                 slope_pref="Vector2(0, 22)"),
    "bear": dict(display_name='"Grizzly bear"', model="bear", coat="bear", ai="bear", mass=250.0, health=220.0,
                 scale_range="Vector2(0.9, 1.05)", body_radius=0.36, body_length=1.7, body_height=0.72,
                 eye_height=0.97, fur_length=0.06, eye_color="Color(0.12, 0.07, 0.03, 1)", walk_speed=1.3,
                 trot_speed=2.8, run_speed=9.5, accel=5.0, turn_rate=150.0, max_slope=40.0, wade_depth=0.9,
                 sight_range=70.0, fov_deg=260.0, hearing=1.3, smell_range=320.0, fire_fear=0.5, skittish=0.2,
                 aggression=0.7, flee_distance=25.0, damage=34.0, damage_type='&"claw"', attack_range=1.9,
                 attack_cooldown=1.3, loot='{"meat_raw": 10, "hide_raw": 3, "bone": 4}', harvest_hits=16,
                 gait_clips='PackedStringArray("walk", "trot", "gallop")',
                 sfx_call='&"bear_huff"', sfx_alarm='&"bear_huff"', sfx_hurt='&"bear_roar"',
                 sfx_attack='&"bear_attack"', sfx_threat='&"bear_roar"', sfx_death='&"bear_roar"',
                 biomes='PackedStringArray("valley", "forest")', min_alt=1300.0, max_alt=2250.0, group_min=1,
                 group_max=1, night_weight=0.35, day_weight=0.6, spawn_weight=0.45),
    "old_grey": dict(display_name='"Old Grey"', model="bear", coat="bear_oldgrey", ai="bear", mass=320.0,
                     health=340.0, scale_range="Vector2(1.16, 1.16)", body_radius=0.36, body_length=1.7,
                     body_height=0.72, eye_height=0.97, fur_length=0.065, eye_color="Color(0.1, 0.06, 0.03, 1)",
                     walk_speed=1.3, trot_speed=2.8, run_speed=9.0, accel=5.0, turn_rate=140.0, max_slope=40.0,
                     wade_depth=0.9, sight_range=70.0, fov_deg=260.0, hearing=1.3, smell_range=360.0, fire_fear=0.35,
                     skittish=0.2, aggression=0.95, flee_distance=32.0, damage=42.0, damage_type='&"claw"',
                     attack_range=2.0, attack_cooldown=1.1, loot='{"meat_raw": 12, "hide_raw": 4, "bone": 5}',
                     harvest_hits=20, gait_clips='PackedStringArray("walk", "trot", "gallop")',
                     sfx_call='&"bear_huff"', sfx_alarm='&"bear_huff"', sfx_hurt='&"bear_roar"',
                     sfx_attack='&"bear_attack"', sfx_threat='&"bear_roar"', sfx_death='&"bear_roar"',
                     biomes='PackedStringArray("forest")', min_alt=1300.0, max_alt=2250.0, group_min=1, group_max=1,
                     spawn_weight=0.0),
    "goat": dict(display_name='"Mountain goat"', model="goat", coat="goat", ai="goat", mass=75.0, health=60.0,
                 body_radius=0.21, body_length=1.1, body_height=0.72, eye_height=0.98, fur_length=0.05,
                 eye_color="Color(0.1, 0.07, 0.03, 1)", walk_speed=1.0, trot_speed=2.2, run_speed=6.0, accel=5.0,
                 turn_rate=200.0, max_slope=58.0, sight_range=150.0, fov_deg=300.0, hearing=1.1, smell_range=150.0,
                 skittish=0.5, flee_distance=60.0, loot='{"meat_raw": 5, "hide_raw": 1, "wool": 3, "bone": 2}',
                 harvest_hits=9, gait_clips='PackedStringArray("walk", "trot", "gallop")', sfx_alarm='&"goat_bleat"',
                 sfx_hurt='&"goat_bleat"', sfx_death='&"goat_bleat"',
                 biomes='PackedStringArray("subalpine", "alpine")', min_alt=2150.0, max_alt=3100.0, group_min=2,
                 group_max=4, night_weight=0.4, day_weight=1.2, spawn_weight=1.2, slope_pref="Vector2(22, 52)"),
    "hare": dict(display_name='"Snowshoe hare"', model="hare", coat="hare", ai="hare", mass=1.5, health=6.0,
                 scale_range="Vector2(0.92, 1.08)", body_radius=0.09, body_length=0.36, body_height=0.14,
                 eye_height=0.2, fur_length=0.025, eye_color="Color(0.06, 0.04, 0.02, 1)", walk_speed=0.8,
                 trot_speed=2.5, run_speed=11.0, accel=14.0, turn_rate=420.0, max_slope=40.0, wade_depth=0.12,
                 sight_range=45.0, fov_deg=340.0, hearing=1.5, smell_range=40.0, skittish=0.9, flee_distance=40.0,
                 loot='{"meat_raw": 1, "hide_raw": 1}', harvest_hits=2,
                 gait_clips='PackedStringArray("walk", "gallop")', sfx_death='&"hare_squeal"',
                 biomes='PackedStringArray("valley", "forest", "subalpine")', min_alt=1300.0, max_alt=2400.0,
                 group_min=1, group_max=1, night_weight=1.0, day_weight=0.8, spawn_weight=0.9),
}

ORDER = ["display_name", "model_path", "coat_path", "ai_script", "scale_range", "mass", "health", "body_radius",
         "body_length", "body_height", "eye_height", "fur_length", "fur_sheen", "eye_color", "walk_speed",
         "trot_speed", "run_speed", "accel", "turn_rate", "max_slope", "wade_depth", "gait_clips", "sight_range",
         "fov_deg", "hearing", "smell_range", "fire_fear", "skittish", "aggression", "flee_distance", "damage",
         "damage_type", "attack_range", "attack_cooldown", "loot", "harvest_hits", "sfx_call", "sfx_alarm",
         "sfx_hurt", "sfx_attack", "sfx_threat", "sfx_death", "biomes", "min_alt", "max_alt", "group_min", "group_max",
         "night_weight", "day_weight", "spawn_weight", "slope_pref"]

for sid, d in SPECIES.items():
    v = dict(COMMON)
    v.update(d)
    v["model_path"] = '"res://assets/models/fauna/%s.glb"' % d["model"]
    v["coat_path"] = '"res://assets/textures/fauna/%s_albedo.png"' % d["coat"]
    v["ai_script"] = '"res://src/fauna/%s.gd"' % d["ai"]
    lines = ['[gd_resource type="Resource" script_class="SpeciesDef" load_steps=2 format=3]', "",
             '[ext_resource type="Script" path="res://src/fauna/species_def.gd" id="1"]', "", "[resource]",
             'script = ExtResource("1")', 'id = &"%s"' % sid]
    for k in ORDER:
        if k in v:
            lines.append("%s = %s" % (k, v[k]))
    with open(os.path.join(OUT, sid + ".tres"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("wrote", sid)
