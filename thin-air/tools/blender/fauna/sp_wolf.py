"""Grey wolf (Canis lupus), BC interior/coastal form in its late-October winter coat.
Adult male: 0.80 m at the withers, ~1.05 m nose to tail base + 0.45 m tail, ~42 kg; narrow keel chest,
tucked flank, long legs with elbows tight to the chest, big feet, bushy tail carried low.
G-space: +x right, +y up, +z back, faces -z, feet on y = 0."""
import numpy as np
from flib import Prim, mirror, vnoise, fbm, ear_shell, uv_sphere

SKELETON = [
    ("root", (0, 0, 0), (0, 0, -0.25), None, False),
    ("pelvis", (0, 0.70, 0.36), (0, 0.72, 0.18), "root", True),
    ("spine1", (0, 0.72, 0.18), (0, 0.725, -0.02), "pelvis", True),
    ("spine2", (0, 0.725, -0.02), (0, 0.715, -0.21), "spine1", True),
    ("chest", (0, 0.715, -0.21), (0, 0.69, -0.33), "spine2", True),
    ("neck1", (0, 0.69, -0.33), (0, 0.745, -0.44), "chest", True),
    ("neck2", (0, 0.745, -0.44), (0, 0.80, -0.53), "neck1", True),
    ("head", (0, 0.80, -0.53), (0, 0.79, -0.73), "neck2", True),
    ("jaw", (0, 0.772, -0.575), (0, 0.752, -0.765), "head", True),
    ("ear.L", (0.042, 0.858, -0.585), (0.058, 0.95, -0.58), "head", True),
    ("ear.R", (-0.042, 0.858, -0.585), (-0.058, 0.95, -0.58), "head", True),
    ("tail1", (0, 0.715, 0.47), (0, 0.655, 0.60), "pelvis", True),
    ("tail2", (0, 0.655, 0.60), (0, 0.575, 0.71), "tail1", True),
    ("tail3", (0, 0.575, 0.71), (0, 0.48, 0.79), "tail2", True),
    ("tail4", (0, 0.48, 0.79), (0, 0.37, 0.845), "tail3", True),
]
for s, x in ((".L", 1.0), (".R", -1.0)):
    SKELETON += [
        ("scapula" + s, (0.055 * x, 0.755, -0.22), (0.09 * x, 0.555, -0.355), "chest", True),
        ("upperarm" + s, (0.09 * x, 0.555, -0.355), (0.092 * x, 0.385, -0.275), "scapula" + s, True),
        ("forearm" + s, (0.092 * x, 0.385, -0.275), (0.08 * x, 0.125, -0.29), "upperarm" + s, True),
        ("hand" + s, (0.08 * x, 0.125, -0.29), (0.078 * x, 0.037, -0.312), "forearm" + s, True),
        ("fpaw" + s, (0.078 * x, 0.037, -0.312), (0.078 * x, 0.012, -0.368), "hand" + s, True),
        ("thigh" + s, (0.075 * x, 0.625, 0.37), (0.095 * x, 0.415, 0.285), "pelvis", True),
        ("shin" + s, (0.095 * x, 0.415, 0.285), (0.082 * x, 0.175, 0.44), "thigh" + s, True),
        ("foot" + s, (0.082 * x, 0.175, 0.44), (0.078 * x, 0.037, 0.415), "shin" + s, True),
        ("hpaw" + s, (0.078 * x, 0.037, 0.415), (0.078 * x, 0.012, 0.36), "foot" + s, True),
    ]

EYE = (0.0385, 0.827, -0.635)


def body():
    P = [
        Prim("ell", "spine2", "body", k=0.0, c=(0, 0.585, -0.15), r=(0.104, 0.162, 0.235), rot=(-4, 0, 0)),
        Prim("ell", "chest", "body", k=0.05, c=(0, 0.655, -0.27), r=(0.094, 0.118, 0.13)),
        Prim("ell", "chest", "chest", k=0.04, c=(0, 0.528, -0.345), r=(0.068, 0.085, 0.07)),
        Prim("ell", "spine1", "belly", k=0.06, c=(0, 0.628, 0.10), r=(0.088, 0.094, 0.19), rot=(9, 0, 0)),
        Prim("ell", "pelvis", "body", k=0.05, c=(0, 0.685, 0.20), r=(0.08, 0.062, 0.13)),
        Prim("ell", "pelvis", "body", k=0.06, c=(0, 0.66, 0.345), r=(0.078, 0.08, 0.10)),
        Prim("cone", "neck1", "neck", k=0.06, a=(0, 0.665, -0.30), b=(0, 0.79, -0.52), ra=0.105, rb=0.072),
        Prim("ell", "neck2", "neck", k=0.05, c=(0, 0.705, -0.425), r=(0.086, 0.1, 0.1)),
        Prim("ell", "neck2", "chest", k=0.03, c=(0, 0.752, -0.555), r=(0.04, 0.032, 0.05)),
        # head
        Prim("ell", "head", "head", k=0.026, c=(0, 0.822, -0.57), r=(0.068, 0.066, 0.086)),
        Prim("cone", "head", "muzzle", k=0.024, a=(0, 0.803, -0.628), b=(0, 0.787, -0.77), ra=0.038, rb=0.021),
        Prim("cone", "head", "muzzle", k=0.02, a=(0, 0.826, -0.62), b=(0, 0.8, -0.76), ra=0.028, rb=0.016),
        Prim("ell", "head", "nose", k=0.008, c=(0, 0.795, -0.779), r=(0.021, 0.0155, 0.0135)),
        # tail
        Prim("cone", "tail1", "tail", k=0.03, a=(0, 0.715, 0.46), b=(0, 0.655, 0.60), ra=0.034, rb=0.046),
        Prim("cone", "tail2", "tail", k=0.02, a=(0, 0.655, 0.60), b=(0, 0.575, 0.71), ra=0.046, rb=0.05),
        Prim("cone", "tail3", "tail", k=0.02, a=(0, 0.575, 0.71), b=(0, 0.48, 0.79), ra=0.05, rb=0.04),
        Prim("cone", "tail4", "tail", k=0.02, a=(0, 0.48, 0.79), b=(0, 0.385, 0.84), ra=0.04, rb=0.016),
    ]

    def side(x, s):
        return [
            Prim("cone", "head", "muzzle", k=0.018, a=(0.013 * x, 0.8, -0.63), b=(0.011 * x, 0.785, -0.765), ra=0.033, rb=0.019),
            Prim("ell", "head", "muzzle", k=0.012, c=(0.022 * x, 0.767, -0.69), r=(0.017, 0.02, 0.078)),
            Prim("ell", "head", "cheek", k=0.02, c=(0.047 * x, 0.793, -0.598), r=(0.042, 0.04, 0.055)),
            Prim("ell", "head", "head", k=0.012, c=(0.027 * x, 0.846, -0.624), r=(0.022, 0.013, 0.022)),
            Prim("ell", "thigh" + s, "body", k=0.05, c=(0.075 * x, 0.525, 0.35), r=(0.045, 0.12, 0.08), rot=(-16, 0, 0)),
            Prim("ell", "thigh" + s, "body", k=0.035, c=(0.064 * x, 0.54, 0.405), r=(0.038, 0.085, 0.042)),
            Prim("ell", "scapula" + s, "body", k=0.04, c=(0.066 * x, 0.662, -0.27), r=(0.044, 0.10, 0.07)),
            Prim("ell", "upperarm" + s, "leg", k=0.04, c=(0.08 * x, 0.50, -0.302), r=(0.044, 0.10, 0.064), rot=(10, 0, 0)),
            Prim("cone", "upperarm" + s, "leg", k=0.03, a=(0.09 * x, 0.54, -0.35), b=(0.092 * x, 0.39, -0.278), ra=0.044, rb=0.035),
            Prim("cone", "forearm" + s, "leg", k=0.015, a=(0.092 * x, 0.385, -0.272), b=(0.08 * x, 0.14, -0.288), ra=0.033, rb=0.02),
            Prim("ell", "forearm" + s, "leg", k=0.02, c=(0.089 * x, 0.32, -0.284), r=(0.029, 0.07, 0.031)),
            Prim("ell", "hand" + s, "leg", k=0.01, c=(0.08 * x, 0.125, -0.29), r=(0.021, 0.024, 0.023)),
            Prim("cone", "hand" + s, "leg", k=0.008, a=(0.08 * x, 0.12, -0.29), b=(0.078 * x, 0.042, -0.31), ra=0.019, rb=0.018),
            Prim("ell", "fpaw" + s, "paw", k=0.012, c=(0.078 * x, 0.026, -0.33), r=(0.029, 0.022, 0.043)),
            Prim("cone", "shin" + s, "leg", k=0.025, a=(0.095 * x, 0.41, 0.29), b=(0.082 * x, 0.185, 0.435), ra=0.042, rb=0.021),
            Prim("ell", "shin" + s, "leg", k=0.02, c=(0.087 * x, 0.34, 0.35), r=(0.031, 0.075, 0.04), rot=(-30, 0, 0)),
            Prim("ell", "foot" + s, "leg", k=0.01, c=(0.082 * x, 0.176, 0.449), r=(0.02, 0.025, 0.022)),
            Prim("cone", "foot" + s, "leg", k=0.008, a=(0.082 * x, 0.17, 0.44), b=(0.078 * x, 0.042, 0.418), ra=0.019, rb=0.018),
            Prim("ell", "hpaw" + s, "paw", k=0.012, c=(0.078 * x, 0.026, 0.397), r=(0.027, 0.021, 0.04)),
            Prim("sph", "head", "eye", k=0.004, sub=True, c=(EYE[0] * x, EYE[1], EYE[2]), r=0.0128),
        ]

    return P + mirror(side)


def jaw():
    P = [
        Prim("cone", "jaw", "jaw", k=0.0, a=(0, 0.774, -0.585), b=(0, 0.767, -0.752), ra=0.023, rb=0.0125),
        Prim("ell", "jaw", "jaw", k=0.012, c=(0, 0.764, -0.74), r=(0.015, 0.011, 0.02)),
    ]
    return P + mirror(lambda x, s: [Prim("ell", "jaw", "jaw", k=0.015, c=(0.03 * x, 0.776, -0.597), r=(0.015, 0.021, 0.034))])


def ears():
    Vs, Ts, off = [], [], 0
    wh, we = [], []
    for x in (1.0, -1.0):
        base = (0.040 * x, 0.848, -0.586)
        V, T = ear_shell(base, (0.3 * x, 1.0, 0.1), (-0.3 * x, 0.0, 1.0), height=0.088, width=0.082,
                         thick=0.0055, cup=0.75, tip_bend=0.08)
        Vs.append(V)
        Ts.append(T + off)
        off += len(V)
        u = np.clip((V[:, 1] - 0.848) / 0.03, 0.0, 1.0)
        wh.append(1.0 - u)
        we.append((u, x))
    V = np.concatenate(Vs)
    T = np.concatenate(Ts)
    n = len(Vs[0])
    eL = np.concatenate([we[0][0], np.zeros(n)])
    eR = np.concatenate([np.zeros(n), we[1][0]])
    return V, T, {"head": np.concatenate(wh), "ear.L": eL, "ear.R": eR}, "ear", 0


def eyes():
    Vs, Ts, off = [], [], 0
    for x in (1.0, -1.0):
        V, T = uv_sphere((EYE[0] * x - 0.003 * x, EYE[1], EYE[2] + 0.002), 0.0118)
        Vs.append(V)
        Ts.append(T + off)
        off += len(V)
    V = np.concatenate(Vs)
    return V, np.concatenate(Ts), {"head": np.ones(len(V))}, "eye", 1


def _mix(a, b, t):
    if np.ndim(t) == 0:
        return a * (1.0 - t) + b * t
    t = np.clip(t, 0.0, 1.0)[:, None]
    return a * (1.0 - t) + b * t


def _ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def pattern(P, N, R):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ny, nz = N[:, 1], N[:, 2]
    ax = np.abs(x)
    leg = np.clip(R["leg"] + R["paw"], 0, 1)
    head = np.clip(R["head"] + R["cheek"] + R["muzzle"] + R["nose"] + R["jaw"], 0, 1)
    tail = R["tail"]
    ear = R["ear"]
    # hair-flow stretched noise: along the body axis on the trunk, down the legs
    Pb = np.stack([x * 1.0, y * 1.0, z * 0.28], 1)
    Pl = np.stack([x, y * 0.28, z], 1)
    Pn = Pb * (1 - leg[:, None]) + Pl * leg[:, None]
    fine = vnoise(Pn, 620.0, 1)
    fine2 = vnoise(Pn, 300.0, 2)
    med = fbm(P, 16.0, 3, 3)
    big = fbm(P, 4.5, 2, 4)
    tawny = np.array([0.55, 0.46, 0.35])
    grey = np.array([0.52, 0.51, 0.48])
    dark = np.array([0.12, 0.11, 0.10])
    cream = np.array([0.80, 0.75, 0.66])
    white = np.array([0.87, 0.85, 0.81])
    black = np.array([0.045, 0.04, 0.038])
    buff = np.array([0.70, 0.60, 0.46])
    # agouti base: grey/tawny patches, banded guard hairs (pale band + black tip)
    base = _mix(tawny, grey, _ss(0.35, 0.7, big))
    base = base * (0.7 + 0.55 * fine)[:, None]
    base = _mix(base, dark, _ss(0.6, 0.85, fine2) * 0.45)
    # dark saddle / cape: dorsal surfaces from the withers to the tail base
    dorsal = _ss(0.15, 0.8, ny) * _ss(0.58, 0.72, y) * _ss(-0.42, -0.22, z) * (1 - _ss(0.5, 0.58, z))
    cape = _ss(-0.45, -0.3, z) * (1 - _ss(-0.1, 0.05, z)) * _ss(0.0, 0.6, ny) * _ss(0.55, 0.7, y)
    sad = np.clip(dorsal * (0.55 + 0.45 * med) + cape * 0.35, 0, 1) * (1 - head) * (1 - leg * 0.6)
    col = _mix(base, _mix(dark, base, 0.35 * fine), sad * 0.8)
    # pale ventral: belly, inner legs, throat, chest
    ventral = _ss(-0.15, -0.65, ny) * _ss(0.72, 0.55, y)
    throat = (R["chest"] + R["neck"] * _ss(-0.1, -0.7, ny)) * _ss(-0.2, -0.6, ny + nz * 0.5)
    inner_leg = leg * _ss(0.3, 0.0, np.sign(x) * N[:, 0]) * 0.8
    pale = np.clip(ventral + throat + inner_leg + R["belly"] * _ss(0.0, -0.6, ny), 0, 1)
    col = _mix(col, cream * (0.9 + 0.2 * fine)[:, None], pale)
    # legs: buff-tawny below the elbow/stifle, cream toward the paws; dark pencil stripe down the foreleg front
    lower = leg * _ss(0.42, 0.25, y)
    col = _mix(col, buff * (0.85 + 0.3 * fine)[:, None], lower * 0.85)
    col = _mix(col, cream, leg * _ss(0.12, 0.03, y) * 0.6)
    pencil = leg * (z < 0) * _ss(-0.3, -0.75, nz) * _ss(0.12, 0.2, y) * _ss(0.42, 0.3, y)
    col = _mix(col, dark * 1.6, pencil * 0.7)
    # head: grey-tawny crown, tawny muzzle top, white lips/cheeks/chin, dark eye rim, black nose
    ex = np.abs(ax - 0.0375)
    ed = np.sqrt(ex ** 2 + (y - 0.826) ** 2 + (z + 0.637) ** 2)
    crown = head * _ss(0.2, 0.8, ny)
    col = _mix(col, _mix(grey, tawny, 0.4) * (0.85 + 0.3 * fine)[:, None], crown * 0.6)
    muz_top = R["muzzle"] * _ss(0.2, 0.7, ny)
    col = _mix(col, tawny * 1.02, muz_top * 0.7)
    lips = (R["muzzle"] * _ss(0.3, -0.2, ny) + R["jaw"] + R["cheek"] * _ss(0.0, -0.5, ny)) * _ss(0.83, 0.79, y)
    col = _mix(col, white * (0.92 + 0.12 * fine)[:, None], np.clip(lips, 0, 1))
    brow = head * np.exp(-((ax - 0.03) ** 2 + (y - 0.85) ** 2 + (z + 0.63) ** 2) / 0.00012)
    col = _mix(col, cream, brow * 0.7)
    eyeline = head * np.exp(-(ed - 0.013) ** 2 / 0.00001) * _ss(-0.5, 0.2, nz)
    col = _mix(col, dark * 0.6, np.clip(eyeline * 1.2, 0, 1))
    col = _mix(col, black, R["nose"])
    lipline = R["muzzle"] * _ss(-0.55, -0.85, ny) * _ss(0.768, 0.762, y)
    col = _mix(col, black * 2.0, np.clip(lipline, 0, 1) * 0.85)
    # ears: tawny-grey backs with dark rims, pale insides
    inner_ear = ear * _ss(0.1, -0.5, nz)
    col = _mix(col, _mix(tawny, grey, 0.5) * 0.85, ear * (1 - inner_ear))
    col = _mix(col, cream * 0.9, inner_ear)
    col = _mix(col, dark, ear * _ss(0.93, 0.955, y))
    # tail: agouti top with a dark precaudal spot, paler underside, black tip
    col = _mix(col, cream * 0.85, tail * _ss(0.0, -0.6, ny + nz * 0.3) * 0.6)
    spot = tail * _ss(0.48, 0.5, z) * (1 - _ss(0.56, 0.6, z)) * _ss(0.3, 0.8, ny)
    col = _mix(col, dark, spot * 0.8)
    col = _mix(col, black * 1.5, tail * _ss(0.5, 0.44, y) * 0.9)
    col = _mix(col, black * 0.4, R["eye"])
    # fur length: long ruff/cape/tail, medium flanks, short head and lower legs, none on nose/eyes
    fl = 0.72 + 0.12 * (med - 0.5)
    fl = fl + 0.25 * np.clip(R["neck"] + cape, 0, 1) + 0.12 * dorsal
    fl = np.where(pale > 0.5, fl * 0.75, fl)
    fl = fl * (1 - leg) + leg * (0.45 * _ss(0.2, 0.45, y) + 0.12)
    fl = fl * (1 - head) + head * (0.25 + 0.3 * R["cheek"] - 0.15 * R["muzzle"])
    fl = fl * (1 - tail) + tail * 1.0
    fl = fl * (1 - ear) + ear * 0.12
    fl = fl * (1 - R["nose"]) * (1 - R["eye"]) * (1 - R["paw"] * 0.4)
    return col, np.clip(fl, 0, 1)


LEGS = {}
for s in (".L", ".R"):
    LEGS["F" + s[1]] = dict(chain=["scapula" + s, "upperarm" + s, "forearm" + s, "hand" + s, "fpaw" + s], front=True,
                           theta_swing_rel=[(0, 16), (0.2, -60), (0.5, -85), (0.8, -8), (1, 0)])
    LEGS["H" + s[1]] = dict(chain=["thigh" + s, "shin" + s, "foot" + s, "hpaw" + s], front=False,
                           theta_swing_rel=[(0, 18), (0.3, 34), (0.6, 24), (0.9, 3), (1, 0)])

LSEQ = {"HL": 0.0, "FL": 0.25, "HR": 0.5, "FR": 0.75}

CLIPS = {
    "idle": dict(kind="idle", dur=4.0),
    "walk": dict(kind="gait", T=0.9, v=1.15, duty=0.64, phases=LSEQ, lift_f=0.075, lift_h=0.07, bob=0.009,
                 roll_amp=1.5, yaw_amp=2.0, neck=-8.0, head=4.0, head_bob=2.5, tail=8.0, tail_sway=7.0, scap_amp=9.0),
    "trot": dict(kind="gait", T=0.6, v=2.6, duty=0.42, phases={"HL": 0.0, "FR": 0.02, "HR": 0.5, "FL": 0.52},
                 lift_f=0.1, lift_h=0.085, bob=0.013, neck=-16.0, head=10.0, head_bob=1.0, tail=0.0, tail_sway=4.0,
                 scap_amp=11.0),
    "gallop": dict(kind="gait", T=0.42, v=8.5, duty=0.3, phases={"HL": 0.0, "HR": 0.1, "FR": 0.42, "FL": 0.52},
                   lift_f=0.15, lift_h=0.13, bob=0.028, bob_freq=1, bob_phase=0.25, pitch_amp=5.0, pitch_phase=0.1,
                   flex_amp=9.0, flex_phase=0.02, neck=-6.0, head=6.0, tail=-30.0, tail_flutter=6.0, scap_amp=16.0,
                   ears=18.0),
    "stalk": dict(kind="gait", T=1.5, v=0.5, duty=0.72, phases=LSEQ, lift_f=0.05, lift_h=0.045, bob=0.004, drop=0.11,
                  neck=-26.0, head=22.0, ears=-10.0, tail=14.0, chest_pitch=-4.0, scap_amp=8.0, breakover=0.6),
    "sniff": dict(kind="sniff", dur=3.0),
    "look": dict(kind="look", dur=3.2),
    "howl": dict(kind="howl", dur=4.0, loop=False),
    "snarl": dict(kind="snarl", dur=2.0),
    "attack": dict(kind="attack", dur=1.0, loop=False, events={"bite": 0.52}, move=0.9),
    "hit": dict(kind="hit", dur=0.5, loop=False),
    "death": dict(kind="death", dur=1.7, loop=False, lie_height=0.13),
}

SPEC = dict(
    name="wolf", h=0.0055, tris=11000, tex=1024, skeleton=SKELETON, body=body,
    parts=[dict(prims=jaw, h=0.003, tris=900)], meshes=[ears, eyes],
    regions=["body", "belly", "chest", "neck", "head", "cheek", "muzzle", "nose", "jaw", "ear", "eye", "leg", "paw",
             "tail"],
    pattern=pattern, legs=LEGS, clips=CLIPS,
    bones=dict(pelvis="pelvis", spine=["spine1", "spine2"], chest="chest", neck=["neck1", "neck2"], head="head",
               jaw="jaw", ears=["ear.L", "ear.R"], tail=["tail1", "tail2", "tail3", "tail4"]),
    chest_bone="chest", pelvis_bone="pelvis",
    disp=lambda P: 0.0012 * (fbm(P, 45.0, 2, 9) - 0.5),
    meta=dict(fur_length=0.034, mass=42.0),
    preview=[("idle", 0), ("trot", 4), ("gallop", 3), ("snarl", 10)],
)
