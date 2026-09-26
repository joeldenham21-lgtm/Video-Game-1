import plib as P


def build():
    s = P.Site("_test")
    s.add(P.box(4, 3, 2.5, "wood_planks", seg=0.5).transformed(P.T(0, 0, 1.25)))
    s.add(P.box(5, 4, 0.2, "metal_corrugated").transformed(P.T(0, 0, 2.6)), bucket="detail")
    s.bucket("detail", vis_end=60.0)
    s.col_box("wood", (0, 0, 1.25), (4, 3, 2.5), P.RZ(30))
    s.marker("Loot_Test", (1, 2, 0.5), yaw=90)
    s.light("Lamp", (0, 0, 2.0))
    return [s]
