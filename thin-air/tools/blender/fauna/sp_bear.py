"""Grizzly bear (Ursus arctos horribilis), adult male in autumn condition: ~1.05 m at the shoulder hump on all fours,
2.0 m nose to rump, ~250 kg. Massive shoulder hump, dished face, small round ears, small eyes, thick limbs, long pale
front claws, plantigrade hind feet, stub tail; dark brown coat with silver-tipped ("grizzled") guard hairs on the back.
Extra coat 'bear_oldgrey': Old Grey — an old boar, heavily silvered, grey muzzle, pale scars across the face/shoulder."""
import numpy as np
from flib import Prim, mirror, vnoise, fbm, ear_shell, uv_sphere

SKELETON = [
    ("root", (0, 0, 0), (0, 0, -0.4), None, False),
    ("pelvis", (0, 0.92, 0.62), (0, 0.95, 0.35), "root", True),
    ("spine1", (0, 0.95, 0.35), (0, 0.99, 0.05), "pelvis", True),
    ("spine2", (0, 0.99, 0.05), (0, 1.02, -0.25), "spine1", True),
    ("chest", (0, 1.02, -0.25), (0, 0.98, -0.45), "spine2", True),
    ("neck1", (0, 0.98, -0.45), (0, 0.96, -0.62), "chest", True),
    ("neck2", (0, 0.96, -0.62), (0, 0.94, -0.76), "neck1", True),
    ("head", (0, 0.94, -0.76), (0, 0.87, -1.08), "neck2", True),
    ("jaw", (0, 0.875, -0.83), (0, 0.825, -1.05), "head", True),
    ("ear.L", (0.1, 1.03, -0.8), (0.125, 1.1, -0.8), "head", True),
    ("ear.R", (-0.1, 1.03, -0.8), (-0.125, 1.1, -0.8), "head", True),
    ("tail1", (0, 0.88, 0.8), (0, 0.8, 0.87), "pelvis", True),
]
for s, x in ((".L", 1.0), (".R", -1.0)):
    SKELETON += [
        ("scapula" + s, (0.12 * x, 1.03, -0.4), (0.16 * x, 0.72, -0.55), "chest", True),
        ("upperarm" + s, (0.16 * x, 0.72, -0.55), (0.17 * x, 0.45, -0.45), "scapula" + s, True),
        ("forearm" + s, (0.17 * x, 0.45, -0.45), (0.16 * x, 0.14, -0.5), "upperarm" + s, True),
        ("hand" + s, (0.16 * x, 0.14, -0.5), (0.16 * x, 0.06, -0.57), "forearm" + s, True),
        ("fpaw" + s, (0.16 * x, 0.06, -0.57), (0.16 * x, 0.02, -0.72), "hand" + s, True),
        ("thigh" + s, (0.12 * x, 0.9, 0.65), (0.15 * x, 0.55, 0.5), "pelvis", True),
        ("shin" + s, (0.15 * x, 0.55, 0.5), (0.15 * x, 0.14, 0.64), "thigh" + s, True),
        ("foot" + s, (0.15 * x, 0.14, 0.64), (0.15 * x, 0.05, 0.46), "shin" + s, True),
        ("hpaw" + s, (0.15 * x, 0.05, 0.46), (0.15 * x, 0.02, 0.37), "foot" + s, True),
    ]

EYE = (0.068, 0.965, -0.94)


def body():
    P = [
        Prim("ell", "spine2", "body", k=0.0, c=(0, 0.72, -0.2), r=(0.25, 0.3, 0.42)),
        Prim("ell", "chest", "hump", k=0.1, c=(0, 0.97, -0.36), r=(0.2, 0.16, 0.24)),
        Prim("ell", "chest", "chest", k=0.08, c=(0, 0.66, -0.5), r=(0.2, 0.22, 0.15)),
        Prim("ell", "spine1", "belly", k=0.1, c=(0, 0.72, 0.25), r=(0.25, 0.27, 0.35)),
        Prim("ell", "pelvis", "body", k=0.1, c=(0, 0.8, 0.58), r=(0.23, 0.2, 0.2)),
        Prim("cone", "neck1", "neck", k=0.1, a=(0, 0.84, -0.45), b=(0, 0.9, -0.76), ra=0.22, rb=0.15),
        Prim("ell", "head", "head", k=0.05, c=(0, 0.95, -0.84), r=(0.14, 0.12, 0.15)),
        Prim("cone", "head", "muzzle", k=0.05, a=(0, 0.905, -0.93), b=(0, 0.872, -1.07), ra=0.075, rb=0.046),
        Prim("ell", "head", "nose", k=0.015, c=(0, 0.876, -1.105), r=(0.04, 0.03, 0.024)),
        Prim("cone", "tail1", "tail", k=0.04, a=(0, 0.87, 0.78), b=(0, 0.8, 0.86), ra=0.05, rb=0.03),
    ]

    def side(x, s):
        claws = []
        for i, dx in enumerate((-0.055, -0.028, 0.0, 0.028, 0.055)):
            claws.append(Prim("cone", "fpaw" + s, "claw", k=0.004, a=((0.16 + dx) * x, 0.03, -0.69 + abs(dx) * 0.3),
                              b=((0.16 + dx * 1.1) * x, 0.006, -0.775 + abs(dx) * 0.4), ra=0.009, rb=0.003))
        return claws + [
            Prim("ell", "head", "cheek", k=0.04, c=(0.09 * x, 0.9, -0.86), r=(0.08, 0.08, 0.1)),
            Prim("ell", "thigh" + s, "leg", k=0.1, c=(0.15 * x, 0.62, 0.58), r=(0.12, 0.24, 0.18)),
            Prim("ell", "scapula" + s, "hump", k=0.08, c=(0.13 * x, 0.85, -0.45), r=(0.1, 0.18, 0.13)),
            Prim("cone", "upperarm" + s, "leg", k=0.08, a=(0.17 * x, 0.72, -0.55), b=(0.17 * x, 0.46, -0.45), ra=0.12, rb=0.095),
            Prim("cone", "forearm" + s, "leg", k=0.04, a=(0.17 * x, 0.45, -0.45), b=(0.16 * x, 0.14, -0.5), ra=0.085, rb=0.068),
            Prim("ell", "hand" + s, "leg", k=0.03, c=(0.16 * x, 0.08, -0.54), r=(0.075, 0.065, 0.08)),
            Prim("ell", "fpaw" + s, "paw", k=0.03, c=(0.16 * x, 0.035, -0.63), r=(0.085, 0.036, 0.085)),
            Prim("cone", "shin" + s, "leg", k=0.06, a=(0.15 * x, 0.55, 0.5), b=(0.15 * x, 0.15, 0.63), ra=0.11, rb=0.07),
            Prim("ell", "foot" + s, "paw", k=0.03, c=(0.15 * x, 0.075, 0.6), r=(0.07, 0.07, 0.08)),
            Prim("ell", "hpaw" + s, "paw", k=0.03, c=(0.15 * x, 0.04, 0.47), r=(0.078, 0.042, 0.15)),
            Prim("sph", "head", "eye", k=0.004, sub=True, c=(EYE[0] * x, EYE[1], EYE[2]), r=0.013),
        ]

    return P + mirror(side)


def jaw():
    return [Prim("cone", "jaw", "jaw", k=0.0, a=(0, 0.872, -0.86), b=(0, 0.848, -1.045), ra=0.05, rb=0.028)] + \
        mirror(lambda x, s: [Prim("ell", "jaw", "jaw", k=0.03, c=(0.055 * x, 0.87, -0.87), r=(0.035, 0.05, 0.07))])


def ears():
    Vs, Ts, off, wh, ws = [], [], 0, [], []
    for x in (1.0, -1.0):
        base = (0.1 * x, 1.02, -0.8)
        V, T = ear_shell(base, (0.35 * x, 1.0, 0.1), (-0.2 * x, 0.2, 1.0), height=0.075, width=0.095, thick=0.012,
                         cup=0.7, tip_bend=0.0)
        Vs.append(V)
        Ts.append(T + off)
        off += len(V)
        u = np.clip((V[:, 1] - 1.02) / 0.025, 0.0, 1.0)
        wh.append(1.0 - u)
        ws.append(u)
    n = len(Vs[0])
    return np.concatenate(Vs), np.concatenate(Ts), {"head": np.concatenate(wh), "ear.L": np.concatenate([ws[0], np.zeros(n)]),
                                                    "ear.R": np.concatenate([np.zeros(n), ws[1]])}, "ear", 0


def eyes():
    Vs, Ts, off = [], [], 0
    for x in (1.0, -1.0):
        V, T = uv_sphere((EYE[0] * x - 0.003 * x, EYE[1], EYE[2]), 0.0115)
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


def _pattern(P, N, R, old):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ny = N[:, 1]
    leg = np.clip(R["leg"] + R["paw"], 0, 1)
    head = np.clip(R["head"] + R["cheek"] + R["muzzle"] + R["nose"] + R["jaw"], 0, 1)
    Pn = np.stack([x, y * (0.35 + 0.65 * (1 - leg)), z * (0.3 + 0.7 * leg)], 1)
    fine = vnoise(Pn, 330.0, 21)
    fine2 = vnoise(Pn, 160.0, 22)
    med = fbm(P, 9.0, 3, 23)
    brown = np.array([0.23, 0.155, 0.1])
    dark = np.array([0.1, 0.07, 0.05])
    tip = np.array([0.58, 0.48, 0.36]) if not old else np.array([0.66, 0.63, 0.58])
    col = brown * (0.75 + 0.45 * fine + 0.25 * (med - 0.5))[:, None]
    # grizzled guard-hair tips over the hump, back and flanks (strongest on top)
    griz = _ss(-0.1, 0.8, ny) * (1 - leg * 0.85) * (1 - head * 0.5)
    amount = (0.55 if not old else 0.95) * griz * _ss(0.45, 0.8, fine2 * 0.6 + med * 0.4 + (0.15 if old else 0.0))
    col = _mix(col, tip * (0.85 + 0.3 * fine)[:, None], amount)
    col = _mix(col, dark * (0.8 + 0.4 * fine)[:, None], leg * _ss(0.6, 0.3, y) * 0.9)
    col = _mix(col, dark, _ss(-0.3, -0.8, ny) * 0.5)
    muz = np.array([0.42, 0.32, 0.22]) if not old else np.array([0.55, 0.52, 0.47])
    col = _mix(col, muz * (0.85 + 0.3 * fine)[:, None], np.clip(R["muzzle"] + R["jaw"] * 0.8, 0, 1) * 0.8)
    col = _mix(col, np.array([0.05, 0.04, 0.035]), R["nose"])
    col = _mix(col, np.array([0.62, 0.57, 0.48]), R["claw"])
    col = _mix(col, np.array([0.02, 0.015, 0.012]), R["eye"])
    fl = 0.8 + 0.2 * (med - 0.5) + 0.2 * R["hump"]
    fl = fl * (1 - leg) + leg * (0.55 * _ss(0.1, 0.5, y) + 0.2)
    fl = fl * (1 - head) + head * (0.3 + 0.3 * R["cheek"] - 0.2 * R["muzzle"])
    fl = fl * (1 - R["claw"]) * (1 - R["nose"]) * (1 - R["eye"]) * (1 - R["paw"] * _ss(0.05, 0.02, y))
    if old:
        # three old claw scars raking the left face and one across the right shoulder: pale, short-haired
        sc = np.zeros(len(P), np.float32)
        for k in range(3):
            d = np.abs((y - 0.93 - 0.025 * k) - 0.45 * (z + 0.9))
            sc = np.maximum(sc, (d < 0.007) * (x > 0.05) * _ss(-1.0, -0.95, z) * _ss(-0.8, -0.84, z) * 1.0)
        d = np.abs((y - 0.82) + 0.5 * (z + 0.3))
        sc = np.maximum(sc, (d < 0.009) * (x < -0.1) * _ss(-0.6, -0.5, z) * _ss(0.0, -0.1, z))
        col = _mix(col, np.array([0.5, 0.4, 0.35]), sc * 0.8)
        fl = fl * (1 - 0.8 * sc)
    return col, np.clip(fl, 0, 1)


def pattern(P, N, R):
    return _pattern(P, N, R, False)


def pattern_old(P, N, R):
    return _pattern(P, N, R, True)


LEGS = {}
for s in (".L", ".R"):
    LEGS["F" + s[1]] = dict(chain=["scapula" + s, "upperarm" + s, "forearm" + s, "hand" + s, "fpaw" + s], front=True,
                           theta_swing_rel=[(0, 12), (0.25, -45), (0.5, -60), (0.8, -5), (1, 0)], phi_break=40.0,
                           phi_swing=45.0)
    LEGS["H" + s[1]] = dict(chain=["thigh" + s, "shin" + s, "foot" + s, "hpaw" + s], front=False,
                           theta_swing_rel=[(0, -25), (0.3, -30), (0.6, -15), (0.9, 0), (1, 0)], phi_break=45.0,
                           phi_swing=40.0, theta_push=-20.0)

LSEQ = {"HL": 0.0, "FL": 0.25, "HR": 0.5, "FR": 0.75}
CLIPS = {
    "idle": dict(kind="idle", dur=4.0, neck=-4.0, head=-6.0),
    "walk": dict(kind="gait", T=1.4, v=1.3, duty=0.68, phases=LSEQ, lift_f=0.1, lift_h=0.08, bob=0.012, roll_amp=3.0,
                 yaw_amp=3.0, neck=-6.0, head=-2.0, head_bob=3.0, scap_amp=10.0),
    "trot": dict(kind="gait", T=0.8, v=2.8, duty=0.45, phases={"HL": 0.0, "FR": 0.03, "HR": 0.5, "FL": 0.53},
                 lift_f=0.13, lift_h=0.11, bob=0.02, roll_amp=2.0, neck=-6.0, scap_amp=12.0),
    "gallop": dict(kind="gait", T=0.56, v=9.5, duty=0.33, phases={"HL": 0.0, "HR": 0.12, "FR": 0.45, "FL": 0.56},
                   lift_f=0.2, lift_h=0.16, bob=0.05, bob_freq=1, bob_phase=0.25, pitch_amp=6.0, pitch_phase=0.1,
                   flex_amp=8.0, flex_phase=0.02, neck=-4.0, head=2.0, scap_amp=16.0, ears=20.0),
    "sniff": dict(kind="sniff", dur=3.0, neck=-35.0, head=-25.0),
    "look": dict(kind="look", dur=3.2, neck=12.0, head=-6.0, ears=-10.0),
    "snarl": dict(kind="snarl", dur=2.0, neck=-12.0, head=10.0, jaw=16.0, ears=40.0, drop=0.08),
    "attack": dict(kind="attack", dur=1.2, loop=False, events={"swipe": 0.62}, move=1.2, reach=0.45, lunge_fwd=0.4),
    "hit": dict(kind="hit", dur=0.6, loop=False),
    "death": dict(kind="death", dur=2.2, loop=False, lie_height=0.3),
}

SPEC = dict(
    name="bear", h=0.009, tris=13000, tex=1024, skeleton=SKELETON, body=body,
    parts=[dict(prims=jaw, h=0.005, tris=900)], meshes=[ears, eyes],
    regions=["body", "hump", "belly", "chest", "neck", "head", "cheek", "muzzle", "nose", "jaw", "ear", "eye", "leg", "paw",
             "claw", "tail"],
    pattern=pattern, legs=LEGS, clips=CLIPS,
    bones=dict(pelvis="pelvis", spine=["spine1", "spine2"], chest="chest", neck=["neck1", "neck2"], head="head",
               jaw="jaw", ears=["ear.L", "ear.R"], tail=["tail1"]),
    chest_bone="chest", pelvis_bone="pelvis",
    disp=lambda P: 0.002 * (fbm(P, 25.0, 2, 29) - 0.5),
    meta=dict(fur_length=0.06, mass=250.0),
    preview=[("idle", 0), ("walk", 10), ("gallop", 4), ("attack", 18)],
    head_view=((1.3, 2.3, 1.3), (0.0, 0.8, 0.85)),
    preview_scale=1.7,
)
