"""Owen Burke's bivouac (~2,300 m, subalpine): a two-person geodesic tent pitched in the lee of a big boulder on a
stamped platform, a snow-block wall on the windward side, guy lines to rocks, a gear cache (pack, rope, stove and
pot on a stone, fuel bottles, food bag), his orange bivvy bag laid out beside the tent, wands."""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube


def build():
    s = P.Site("owens_bivouac", seed_=71)
    s.bucket("main", vis_end=700.0)
    s.bucket("detail", vis_end=80.0)
    G = P.Ground("owens_bivouac")
    # the boulder (north), half buried
    bz = G.h(0.3, 3.6)
    s.add(P.blob((0, 0, 0), (2.8, 2.2, 2.1), "rock", 18, 0.28, 3.0, rings=10), T(0.3, 3.6, bz - 0.2), "main")
    s.add(P.blob((0, 0, 0), (1.3, 1.1, 0.9), "rock", 12, 0.3, 5.0, rings=7), T(-2.6, 2.6, G.h(-2.6, 2.6) - 0.1), "main")
    s.col_box("rock", Vector((0.3, 3.6, bz + 0.9)), (4.8, 3.6, 2.8))
    s.col_box("rock", Vector((-2.6, 2.6, G.h(-2.6, 2.6) + 0.4)), (2.2, 1.8, 1.2))
    # stamped platform + tent
    s.add(P.heightpatch(4.2, 3.2, 0.35, lambda x, y: 0.03 + 0.02 * P.nz((x, y, 0), 2.0), "snow"), T(0.0, 0.2, G.h(0, 0.2)), "main")
    tent, anchors = PR.dome_tent(1.1, 0.72, 1.05, (0.85, 0.6, 0.06), seed_=1.0)
    Mt = T(0.0, 0.3, G.h(0, 0.3)) @ RZ(8)
    s.add(tent, Mt, "main")
    s.col_box("canvas" if False else "wood", Mt @ Vector((0, 0, 0.45)), (2.0, 1.3, 0.9), Mt)
    for k, a in enumerate(anchors):
        wa = Mt @ a
        g = wa + (wa - (Mt @ Vector((0, 0, 0.5)))).normalized() * 1.1
        g.z = G.h(g.x, g.y)
        s.add(AR.guy(wa, g, 0.0, 0.003, 2, "rope"), None, "detail")
        s.add(P.blob((0, 0, 0), (0.18, 0.15, 0.12), "rock", 6, 0.3, k * 1.3, rings=3), T(g), "detail")
    # snow-block wall on the windward (west) side, a few blocks toppled
    for row in range(3):
        for k in range(5 - row):
            x = -2.2 + row * 0.05
            y = -1.2 + k * 0.52 + row * 0.26
            z = G.h(x, y) + 0.15 + row * 0.29
            s.add(box(0.36, 0.5, 0.28, "snow_packed", 'x', tint=(0.97, 0.98, 1.0)), T(x, y, z) @ RZ(P.rnd(-6, 6)), "main")
    s.col_box("snow", Vector((-2.2, -0.2, G.h(-2.2, -0.2) + 0.45)), (0.4, 2.6, 0.9))
    s.add(box(0.36, 0.5, 0.28, "snow_packed"), T(-2.7, 1.2, G.h(-2.7, 1.2) + 0.1) @ RZ(30) @ RY(20), "detail")
    # gear cache by the boulder
    gear = P.Mesh()
    gear.extend(PR.backpack((0.15, 0.25, 0.5)).transformed(T(1.8, 1.6, G.h(1.8, 1.6)) @ RZ(-30) @ RX(-8)))
    coil = P.Mesh()
    for k in range(7):
        coil.extend(tube([Vector((0.25 * math.cos(a / 8 * 2 * math.pi), 0.22 * math.sin(a / 8 * 2 * math.pi), 0.02 + k * 0.024)) for a in range(9)],
                         0.011, "rope", 5, tint=(0.2, 0.45, 0.85)))
    gear.extend(coil.transformed(T(2.3, 0.9, G.h(2.3, 0.9))))
    stone = P.blob((0, 0, 0), (0.25, 0.22, 0.12), "rock", 7, 0.2, 9.0, rings=4)
    gear.extend(stone.transformed(T(1.5, -1.2, G.h(1.5, -1.2))))
    gear.extend(PR.stove_canister().transformed(T(1.5, -1.2, G.h(1.5, -1.2) + 0.11)))
    for k in range(2):
        gear.extend(lathe([(0, 0), (0.045, 0), (0.045, 0.2), (0.02, 0.24), (0.0, 0.25)], "metal_bare", 10,
                          tint=(0.8, 0.15, 0.1) if k else (0.85, 0.85, 0.85)).transformed(T(1.8 + k * 0.12, -1.5, G.h(1.8, -1.5))))
    gear.extend(PR.duffel(0.45, 0.14, "nylon", (0.2, 0.2, 0.22)).transformed(T(2.1, -0.4, G.h(2.1, -0.4)) @ RZ(70)))
    s.add(gear, None, "detail")
    s.col_box("wood", Vector((1.9, 1.3, G.h(1.9, 1.3) + 0.3)), (1.2, 1.4, 0.6))
    # the bivvy bag, laid out on a foam pad beside the tent
    bag = box(0.7, 2.1, 0.22, "nylon_paint_2s", 'y', seg=0.25, tint=(0.9, 0.35, 0.05))
    bag.displace(lambda p: Vector((0, 0, (0.06 * P.nz(p, 3.0, 2.0) - 0.05 * abs(p.y) * 0.3) if p.z > 0 else 0)))
    s.add(bag, T(-1.3, -1.2, G.h(-1.3, -1.2) + 0.12) @ RZ(-12), "main")
    s.add(box(0.6, 1.9, 0.02, "plastic", 'y', tint=(0.1, 0.35, 0.15)), T(-1.3, -1.2, G.h(-1.3, -1.2) + 0.01) @ RZ(-12), "detail")
    # wands with ribbons along the route down
    for k in range(4):
        p = Vector((3.5 + k * 3.0, -3.0 - k * 2.2, 0))
        p.z = G.h(p.x, p.y)
        s.add(rod(p, p + Vector((0.03, 0.0, 1.5)), 0.01, "wood_log", 4), None, "detail")
        s.add(P.quad(p + Vector((0.03, 0, 1.5)), p + Vector((0.3, 0.05, 1.45)), p + Vector((0.3, 0.05, 1.3)), p + Vector((0.03, 0, 1.34)),
                     "nylon_paint_2s", tint=(0.9, 0.3, 0.04)), None, "detail")
    s.marker("Arrive_Default", (3.0, -4.5, G.h(3.0, -4.5)), 45)
    s.marker("Log_burke_02", (-1.3, -1.0, G.h(-1.3, -1.0) + 0.3), 0)
    s.marker("Loot_Pack", (1.8, 1.6, G.h(1.8, 1.6) + 0.4), 0)
    s.marker("Loot_Tent", (0.0, 0.3, G.h(0, 0.3) + 0.2), 0)
    s.marker("Loot_Stove", (1.5, -1.2, G.h(1.5, -1.2) + 0.3), 0)
    s.marker("Use_Tent", (0.0, -0.55, G.h(0, -0.55) + 0.5), 0)
    s.shelter("Shelter_Tent", Vector((0.0, 0.3, G.h(0, 0.3))), (1.9, 1.3, 1.0), 0.75, yaw=8)
    return [s]
