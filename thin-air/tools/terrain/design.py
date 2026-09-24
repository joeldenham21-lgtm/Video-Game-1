"""THIN AIR — hand-designed macro landform of the Hollow Creek / Mount Corrigan basin (DESIGN.md §3).

Coordinates: metres, x east, z south (north = -z), y = metres above sea level. The playable map is
x, z in [-1536, 1536]; everything outside is the surrounding range (MID band to +-3072 m, FAR to +-24.6 km).

The landform is built from two skeleton networks:
  * VALLEYS: polylines of (x, z, floor_y, half_width) — valley floors, cirque floors, glacier surface.
  * CRESTS:  polylines of (x, z, crest_y) — ridge crests, peaks, cols.
Height = floor + (crest - floor) * profile(d_v / (d_v + d_c)), then domain-warped ridged noise, stream-power
incision, thermal + droplet erosion and the explicit features below (glacier, lake, rivers, trails, pads).
"""
from __future__ import annotations

HALF = 1536.0
CELL = 1.5
SIZE = 2049

# --------------------------------------------------------------------------------------------- POIs
# id, name, x, z, y (target altitude of the pad / feature), discovery radius, flat_radius, extra
POIS = [
	dict(id="crash_site", name="Crash Site", x=-520.0, z=820.0, y=1480.0, radius=70.0, flat_radius=22.0,
		 zone="valley"),
	dict(id="loon_lake", name="Loon Lake", x=260.0, z=640.0, y=1420.0, radius=230.0, flat_radius=0.0,
		 zone="valley", water=True),
	dict(id="ranger_cabin", name="Ranger Cabin", x=420.0, z=520.0, y=1425.5, radius=45.0, flat_radius=14.0,
		 zone="valley"),
	dict(id="fire_lookout", name="Fire Lookout", x=-900.0, z=260.0, y=1782.0, radius=45.0, flat_radius=9.0,
		 zone="valley"),
	dict(id="ashford_mine", name="Ashford Mine", x=820.0, z=-80.0, y=1950.0, radius=90.0, flat_radius=30.0,
		 zone="forest", adit=dict(x=784.0, z=-86.0, dir=[-1.0, 0.0])),
	dict(id="trapper_cabin", name="Trapper's Cabin", x=-760.0, z=-260.0, y=1748.0, radius=45.0,
		 flat_radius=12.0, zone="forest"),
	dict(id="owens_bivouac", name="Owen's Bivouac", x=380.0, z=-520.0, y=2300.0, radius=40.0, flat_radius=8.0,
		 zone="subalpine"),
	dict(id="glacier_camp", name="Glacier Camp", x=168.0, z=-668.0, y=2500.0, radius=45.0, flat_radius=11.0,
		 zone="glacier"),
	dict(id="icefall", name="Corrigan Icefall", x=-60.0, z=-770.0, y=None, radius=120.0, flat_radius=0.0,
		 zone="glacier"),
	dict(id="ice_cave", name="Ice Cave", x=178.0, z=-452.0, y=2404.0, radius=40.0, flat_radius=7.0,
		 zone="glacier", entrance=dict(x=172.0, z=-470.0, dir=[0.0, -1.0])),
	dict(id="kestrel_station", name="Kestrel Station", x=-360.0, z=-980.0, y=2950.0, radius=110.0,
		 flat_radius=46.0, zone="col"),
	dict(id="summit", name="Mount Corrigan", x=120.0, z=-1260.0, y=3452.0, radius=50.0, flat_radius=3.5,
		 zone="summit"),
]
POI = {p["id"]: p for p in POIS}

# --------------------------------------------------------------------------------------------- valleys
# (x, z, floor_y, half_width). Floors are the ground of the valley bottom (water/ice surface where present).
MAP_VALLEYS = {
	# braided outwash plain from the foot of Corrigan Falls to the Loon Lake delta
	"hollow_upper": [(45, 100, 1509, 40), (55, 200, 1494, 110), (85, 330, 1471, 170), (135, 430, 1450, 190),
					 (175, 480, 1430, 170)],
	"loon_basin": [(175, 480, 1423, 170), (260, 640, 1419, 165), (300, 800, 1418, 120)],
	"hollow_lower": [(300, 805, 1417, 95), (265, 880, 1412, 110), (200, 980, 1398, 120), (140, 1100, 1381, 110),
					 (100, 1220, 1362, 90), (82, 1340, 1342, 60), (80, 1450, 1320, 30), (82, 1536, 1299, 16)],
	"west_floor": [(-60, 170, 1510, 110), (-250, 190, 1515, 130), (-450, 330, 1508, 150),
				   (-560, 480, 1498, 130), (-470, 640, 1484, 110)],
	"crash_terrace": [(-330, 690, 1472, 110), (-520, 820, 1480, 170), (-610, 1000, 1482, 130),
					  (-560, 1180, 1470, 90)],
	"trapper": [(-1140, -430, 2340, 110), (-990, -360, 2090, 55), (-800, -275, 1765, 45), (-620, -170, 1648, 45),
				(-430, -30, 1568, 55), (-250, 90, 1522, 70)],
	"ashford": [(470, -560, 2292, 95), (600, -420, 2152, 50), (740, -250, 2000, 40), (895, -85, 1878, 35),
				(905, 100, 1722, 35), (785, 320, 1542, 45), (565, 495, 1436, 60), (440, 575, 1421, 45)],
	"glacier": [(-290, -1000, 2905, 125), (-200, -950, 2862, 115), (-128, -878, 2800, 105),
				(-60, -770, 2660, 105), (35, -625, 2482, 100), (105, -548, 2442, 90), (178, -470, 2410, 60)],
	"forefield": [(175, -430, 2396, 60), (152, -335, 2342, 45), (140, -262, 2302, 35)],
	"falls": [(140, -262, 2300, 14), (126, -175, 2060, 14), (102, -65, 1770, 18), (72, 25, 1604, 24),
			  (45, 100, 1509, 34)],
	"sentinel": [(820, -1030, 2705, 110), (800, -830, 2525, 50), (780, -610, 2255, 40), (760, -420, 2085, 35),
				 (740, -250, 2000, 40)],
	"crash_creek": [(-1180, 850, 2150, 105), (-1010, 830, 1860, 50), (-810, 810, 1600, 45), (-660, 800, 1490, 55)],
	"east_lower": [(1150, 700, 2160, 100), (960, 755, 1820, 50), (720, 780, 1540, 45), (470, 800, 1426, 45)],
}

# Outside the map: the surrounding valleys (drain the MID band) and the regional trunk valleys (FAR).
OUTER_VALLEYS = {
	"gorge_south": [(82, 1536, 1299, 16), (92, 1700, 1272, 24), (130, 2000, 1236, 60), (190, 2400, 1190, 130),
					(300, 3000, 1112, 250), (450, 4200, 985, 420), (600, 6100, 820, 650)],
	"west": [(-2350, -3300, 1760, 140), (-2750, -1600, 1470, 240), (-2900, 0, 1300, 300), (-3000, 1800, 1150, 340),
			 (-3250, 4000, 960, 450), (-3600, 6300, 770, 650)],
	"east": [(2500, -3400, 1780, 140), (2880, -1500, 1480, 240), (3000, 0, 1330, 300), (3100, 2000, 1150, 340),
			 (3250, 4200, 950, 450), (3000, 6300, 790, 650)],
	"north": [(-2350, -3300, 1760, 140), (-1300, -3150, 1850, 120), (0, -3250, 1960, 90), (1300, -3250, 1880, 120),
			  (2500, -3400, 1780, 140)],
	"trunk": [(-24600, 7800, 420, 900), (-12000, 7200, 590, 800), (-3600, 6300, 770, 650), (600, 6100, 820, 650),
			  (3000, 6300, 790, 650), (12000, 7000, 640, 800), (24600, 8200, 420, 900)],
	"nw_regional": [(-3600, 6300, 770, 650), (-6000, 2000, 1000, 500), (-7000, -4000, 1250, 400),
					(-8000, -12000, 1100, 500), (-9000, -24600, 800, 700)],
	"ne_regional": [(3000, 6300, 790, 650), (7000, 1500, 1020, 500), (8000, -5000, 1200, 400),
					(10000, -14000, 1000, 500), (12000, -24600, 750, 700)],
	"n_regional": [(-2350, -3300, 1760, 140), (-4000, -6000, 1500, 300), (-3000, -12000, 1250, 450),
				   (-1000, -24600, 850, 700)],
	"sw_regional": [(-12000, 7200, 590, 800), (-15000, 0, 800, 600), (-18000, -10000, 900, 600),
					(-24600, -16000, 700, 800)],
	"se_regional": [(12000, 7000, 640, 800), (16000, -2000, 850, 600), (20000, -12000, 900, 600),
					(24600, -20000, 700, 800)],
	"s_regional": [(0, 24600, 300, 1000), (-2000, 15000, 380, 900), (600, 6100, 820, 650)],
}

# --------------------------------------------------------------------------------------------- crests
MAP_CRESTS = {
	"w_edge": [(-1150, -1450, 3250), (-1380, -1100, 3180), (-1420, -700, 3100), (-1400, -300, 2980),
			   (-1380, 100, 2780), (-1360, 500, 2560), (-1330, 900, 2400), (-1280, 1250, 2300), (-1150, 1450, 2210)],
	"n_west": [(-1150, -1450, 3250), (-820, -1250, 3285), (-600, -1120, 3110), (-450, -1030, 2995),
			   (-360, -980, 2952)],
	"summit_w": [(-360, -980, 2952), (-250, -1070, 3040), (-120, -1160, 3205), (20, -1225, 3365), (120, -1260, 3452)],
	"summit_n": [(120, -1260, 3452), (140, -1400, 3300), (165, -1536, 3180), (190, -1750, 2950)],
	"summit_e": [(120, -1260, 3452), (330, -1290, 3255), (560, -1240, 3120), (820, -1260, 3235),
				 (1060, -1180, 3120), (1300, -1000, 3205)],
	"e_edge": [(1300, -1000, 3205), (1400, -650, 3120), (1420, -250, 3000), (1400, 150, 2820), (1380, 550, 2620),
			   (1340, 950, 2450), (1260, 1300, 2320), (1130, 1470, 2220)],
	"s_west": [(-1150, 1450, 2210), (-800, 1440, 2080), (-450, 1430, 1950), (-110, 1470, 1660)],
	"s_east": [(1130, 1470, 2220), (800, 1450, 2100), (520, 1440, 1980), (270, 1470, 1660)],
	"glacier_e": [(330, -1290, 3255), (360, -1100, 3020), (330, -900, 2805), (290, -720, 2625), (270, -590, 2490),
				  (310, -470, 2370)],
	"headwall_e": [(310, -470, 2370), (335, -300, 2300), (345, -130, 2160), (320, 20, 1960), (250, 130, 1690)],
	"headwall_w": [(-470, -560, 2330), (-300, -380, 2240), (-160, -230, 2200), (-60, -80, 1990), (-40, 40, 1720)],
	"w_spur": [(-1420, -700, 3100), (-1100, -650, 2760), (-800, -620, 2470), (-470, -560, 2330)],
	"trapper_s": [(-1380, 100, 2780), (-1150, 60, 2320), (-930, 50, 2020), (-760, 60, 1840)],
	"lookout": [(-930, 245, 1786), (-890, 275, 1784)],
	"mine_buttress": [(735, -95, 2085), (700, -150, 2150), (640, -260, 2230)],
	"se_spur": [(1380, 550, 2620), (1100, 570, 2250), (860, 600, 1900), (660, 650, 1600)],
	"sw_spur": [(-1330, 900, 2400), (-1060, 1060, 2100), (-820, 1170, 1850), (-620, 1270, 1660)],
	"sentinel_w": [(820, -1260, 3235), (640, -1000, 2900), (560, -760, 2560), (470, -600, 2360)],
	"sentinel_e": [(1060, -1180, 3120), (1050, -900, 2860), (1000, -650, 2600), (930, -420, 2300), (900, -270, 2130)],
}

# Map-edge ridges continue outward into the MID band as crests (so the range reads as one landscape).
OUTER_CRESTS = {
	"nw_out": [(-1150, -1450, 3250), (-1500, -1900, 3150), (-1900, -2400, 2900)],
	"n_out": [(190, -1750, 2950), (250, -2300, 2650), (400, -2800, 2350)],
	"ne_out": [(1300, -1000, 3205), (1800, -1500, 3050), (2200, -2200, 2800)],
	"w_out": [(-1420, -700, 3100), (-1800, -800, 2750), (-2300, -900, 2250)],
	"w_out2": [(-1360, 500, 2560), (-1800, 600, 2200), (-2300, 650, 1850)],
	"e_out": [(1420, -250, 3000), (1900, -300, 2650), (2400, -350, 2150)],
	"e_out2": [(1380, 550, 2620), (1850, 650, 2250), (2400, 700, 1800)],
	"sw_out": [(-1150, 1450, 2210), (-1600, 1900, 2150), (-2000, 2600, 2000)],
	"se_out": [(1130, 1470, 2220), (1600, 1900, 2150), (2000, 2600, 2000)],
	"s_w_out": [(-110, 1470, 1660), (-400, 2200, 2000), (-900, 3000, 2100)],
	"s_e_out": [(270, 1470, 1660), (700, 2200, 2050), (1200, 3000, 2150)],
}

# --------------------------------------------------------------------------------------------- water
LOON_LAKE = dict(id="loon_lake", name="Loon Lake", level=1420.0, max_depth=17.0,
				 outline=[(170, 452), (238, 462), (300, 478), (352, 505), (392, 538), (405, 590), (398, 650),
						  (382, 712), (352, 762), (312, 800), (268, 812), (225, 796), (188, 752), (158, 690),
						  (142, 622), (138, 560), (148, 500)])
TARNS = [dict(id="bivouac_tarn", name="Bivouac Tarn", x=318.0, z=-596.0, radius=24.0, level=None, max_depth=4.0),
		 dict(id="snout_pool", name="Snout Pool", x=192.0, z=-410.0, radius=18.0, level=None, max_depth=3.0)]

# Rivers: polylines (x, z, width) — the water surface height is derived from the carved terrain.
RIVERS = [
	dict(id="corrigan_creek", name="Corrigan Creek", kind="creek",
		 points=[(174, -462, 4), (180, -425, 4.5), (168, -370, 5), (152, -320, 5), (142, -265, 5), (133, -215, 4),
				 (126, -175, 4), (114, -120, 5), (102, -65, 5.5), (88, -20, 6), (72, 25, 7), (58, 65, 8),
				 (45, 100, 9)]),
	dict(id="hollow_river", name="Hollow River", kind="braided",
		 points=[(45, 100, 12), (52, 160, 28), (60, 220, 42), (72, 280, 58), (92, 340, 70), (115, 390, 72),
				 (140, 435, 64), (165, 468, 44)]),
	dict(id="hollow_river_lower", name="Hollow River", kind="river",
		 points=[(300, 806, 13), (288, 845, 14), (265, 885, 15), (232, 935, 16), (200, 985, 16), (165, 1045, 16),
				 (140, 1105, 16), (118, 1165, 15), (100, 1225, 15), (88, 1285, 14), (82, 1345, 13), (80, 1400, 11),
				 (80, 1450, 10), (81, 1500, 9), (82, 1560, 9)]),
	dict(id="ashford_creek", name="Ashford Creek", kind="creek",
		 points=[(478, -552, 2), (540, -490, 2.5), (600, -420, 2.5), (670, -335, 3), (740, -250, 3), (820, -170, 3),
				 (895, -85, 3.5), (905, 10, 3.5), (905, 100, 4), (850, 215, 4), (785, 320, 4.5), (690, 410, 5),
				 (565, 495, 5.5), (490, 548, 6), (428, 585, 6)]),
	dict(id="trapper_creek", name="Trapper Creek", kind="creek",
		 points=[(-1100, -410, 2), (-990, -360, 2.5), (-890, -315, 3), (-800, -290, 3), (-700, -225, 3.5),
				 (-620, -170, 3.5), (-520, -95, 4), (-430, -30, 4), (-330, 35, 4.5), (-250, 90, 5), (-150, 140, 5),
				 (-40, 175, 5.5), (48, 196, 6)]),
	dict(id="crash_creek", name="Crash Creek", kind="creek",
		 points=[(-1150, 848, 2), (-1010, 830, 2.5), (-900, 820, 3), (-810, 810, 3), (-730, 802, 3.5),
				 (-640, 770, 3.5), (-560, 730, 3.5), (-470, 700, 4), (-380, 690, 4), (-280, 700, 4.5), (-160, 740, 5),
				 (-40, 790, 5), (80, 830, 5.5), (180, 860, 6), (262, 882, 6)]),
	dict(id="east_creek", name="East Creek", kind="creek",
		 points=[(1150, 700, 2), (1050, 725, 2.5), (960, 755, 3), (840, 770, 3), (720, 780, 3.5), (600, 790, 4),
				 (500, 800, 4), (430, 806, 4.5), (360, 800, 4.5)]),
]

# --------------------------------------------------------------------------------------------- trails
# Waypoints (x, z). A least-cost router with a grade limit fills in switchbacks between waypoints; "climb"
# legs allow steeper grades (crampons / ice axe) and are the only places the slope test is relaxed.
TRAILS = [
	dict(id="valley_trail", name="Valley Trail", width=1.6, max_grade_deg=16.0, golden=True,
		 legs=[dict(to=(-520, 820), via=[]),
			   dict(to=(-60, 860), via=[(-300, 845)]),
			   dict(to=(282, 842), via=[(120, 850)], ford=True),
			   dict(to=(420, 520), via=[(385, 780), (428, 650)])]),
	dict(id="ashford_road", name="Ashford Mine Road", width=2.6, max_grade_deg=17.0, golden=True,
		 legs=[dict(to=(420, 520), via=[]),
			   dict(to=(820, -80), via=[(590, 430), (720, 240)])]),
	dict(id="burke_route", name="Burke's Route", width=1.3, max_grade_deg=24.0, golden=True,
		 legs=[dict(to=(820, -80), via=[]),
			   dict(to=(380, -520), via=[(720, -300), (560, -420)])]),
	dict(id="glacier_route", name="Glacier Route", width=1.2, max_grade_deg=27.0, golden=True,
		 legs=[dict(to=(380, -520), via=[]),
			   dict(to=(168, -668), via=[(300, -570)]),
			   dict(to=(-128, -878), via=[(90, -640), (-60, -770)], climb=True, max_grade_deg=44.0),
			   dict(to=(-360, -980), via=[(-200, -990), (-300, -1030)], max_grade_deg=29.0)]),
	dict(id="summit_ridge", name="West Ridge", width=1.2, max_grade_deg=42.0, golden=True, climb=True,
		 legs=[dict(to=(-360, -980), via=[]),
			   dict(to=(120, -1260), via=[(-250, -1070), (-120, -1160), (20, -1225)], ridge=True)]),
	dict(id="lookout_trail", name="Lookout Trail", width=1.2, max_grade_deg=20.0, golden=False,
		 legs=[dict(to=(-520, 820), via=[]),
			   dict(to=(-900, 260), via=[(-620, 600), (-760, 420)])]),
	dict(id="trapline", name="Trapline", width=1.0, max_grade_deg=22.0, golden=False,
		 legs=[dict(to=(-900, 260), via=[]),
			   dict(to=(-760, -260), via=[(-760, 100), (-700, -80)])]),
	dict(id="ice_cave_spur", name="Snout Path", width=1.0, max_grade_deg=26.0, golden=False,
		 legs=[dict(to=(380, -520), via=[]),
			   dict(to=(178, -452), via=[(280, -470)])]),
]

# --------------------------------------------------------------------------------------------- zones
ZONES = [
	dict(id="hollow_valley", name="Hollow Creek Valley", biome="valley", polygon=[(-800, 100), (500, 100),
		 (700, 900), (300, 1536), (-150, 1536), (-900, 1100)]),
	dict(id="ashford_flank", name="Ashford Flank", biome="forest", polygon=[(450, -600), (1300, -600),
		 (1300, 600), (450, 600)]),
	dict(id="trapper_woods", name="Trapper Woods", biome="forest", polygon=[(-1300, -500), (-300, -500),
		 (-300, 150), (-1300, 150)]),
	dict(id="corrigan_glacier", name="Corrigan Glacier", biome="glacier", polygon=[(-480, -1080), (-120, -1040),
		 (260, -560), (240, -420), (100, -420), (-420, -880)]),
	dict(id="kestrel_col", name="Kestrel Col", biome="alpine", polygon=[(-520, -1100), (-250, -1100),
		 (-250, -900), (-520, -900)]),
	dict(id="summit_pyramid", name="Summit Pyramid", biome="summit", polygon=[(-150, -1400), (400, -1400),
		 (400, -1120), (-150, -1120)]),
]

# Biome altitude bands (DESIGN.md §3); get_biome() also uses the glacier mask.
BIOME_BANDS = [("valley", 1550.0), ("forest", 2100.0), ("subalpine", 2450.0), ("alpine", 3150.0), ("summit", 9999.0)]
TREELINE = 2100.0
SNOWLINE = 1800.0

# Holes the Structures stream cuts into the heightfield (mine adit, ice cave): the renderer discards and the
# collider leaves a gap inside these discs.
HOLES = [dict(id="ashford_adit", x=781.0, z=-86.0, radius=2.2, y=1951.2),
		 dict(id="ice_cave_mouth", x=172.0, z=-468.0, radius=3.0, y=2406.0)]
