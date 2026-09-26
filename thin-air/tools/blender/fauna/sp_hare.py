"""Snowshoe hare (Lepus americanus) in late October, nearly finished moulting into its white winter coat (a few
brown patches left on the back and face), black ear tips, huge furred hind feet. Crouched rest posture with folded
hind legs; gaits: slow hop (walk) and the fast half-bound (gallop). ~0.45 m long, 1.5 kg."""
import numpy as np
from flib import Prim, mirror, vnoise, fbm, ear_shell, uv_sphere

SKELETON = [
    ("root", (0, 0, 0), (0, 0, -0.1), None, False),
    ("pelvis", (0, 0.19, 0.09), (0, 0.215, 0.02), "root", True),
    ("spine1", (0, 0.215, 0.02), (0, 0.22, -0.05), "pelvis", True),
    ("spine2", (0, 0.22, -0.05), (0, 0.205, -0.11), "spine1", True),
    ("chest", (0, 0.205, -0.11), (0, 0.185, -0.15), "spine2", True),
    ("neck1", (0, 0.185, -0.15), (0, 0.2, -0.18), "chest", True),
    ("neck2", (0, 0.2, -0.18), (0, 0.215, -0.2), "neck1", True),
    ("head", (0, 0.215, -0.2), (0, 0.2, -0.29), "neck2", True),
    ("jaw", (0, 0.197, -0.225), (0, 0.184, -0.28), "head", True),
    ("ear.L", (0.016, 0.245, -0.215), (0.03, 0.33, -0.185), "head", True),
    ("ear.R", (-0.016, 0.245, -0.215), (-0.03, 0.33, -0.185), "head", True),
    ("tail1", (0, 0.17, 0.13), (0, 0.165, 0.165), "pelvis", True),
]
for s, x in ((".L", 1.0), (".R", -1.0)):
    SKELETON += [
        ("scapula" + s, (0.028 * x, 0.2, -0.115), (0.034 * x, 0.13, -0.155), "chest", True),
        ("upperarm" + s, (0.034 * x, 0.13, -0.155), (0.034 * x, 0.08, -0.13), "scapula" + s, True),
        ("forearm" + s, (0.034 * x, 0.08, -0.13), (0.03 * x, 0.022, -0.155), "upperarm" + s, True),
        ("hand" + s, (0.03 * x, 0.022, -0.155), (0.03 * x, 0.009, -0.175), "forearm" + s, True),
        ("fpaw" + s, (0.03 * x, 0.009, -0.175), (0.03 * x, 0.003, -0.2), "hand" + s, True),
        ("thigh" + s, (0.045 * x, 0.165, 0.09), (0.055 * x, 0.1, 0.0), "pelvis", True),
        ("shin" + s, (0.055 * x, 0.1, 0.0), (0.052 * x, 0.05, 0.1), "thigh" + s, True),
        ("foot" + s, (0.052 * x, 0.05, 0.1), (0.05 * x, 0.012, -0.005), "shin" + s, True),
        ("hpaw" + s, (0.05 * x, 0.012, -0.005), (0.05 * x, 0.004, -0.05), "foot" + s, True),
    ]

EYE = (0.03, 0.226, -0.234)


def body():
    P = [
        Prim("ell", "spine1", "body", k=0.0, c=(0, 0.152, 0.0), r=(0.072, 0.075, 0.125)),
        Prim("ell", "chest", "chest", k=0.03, c=(0, 0.14, -0.1), r=(0.052, 0.06, 0.065)),
        Prim("ell", "pelvis", "body", k=0.03, c=(0, 0.16, 0.08), r=(0.065, 0.07, 0.07)),
        Prim("cone", "neck1", "body", k=0.03, a=(0, 0.17, -0.15), b=(0, 0.205, -0.2), ra=0.04, rb=0.03),
        Prim("ell", "head", "head", k=0.015, c=(0, 0.217, -0.23), r=(0.034, 0.036, 0.048)),
        Prim("ell", "head", "muzzle", k=0.012, c=(0, 0.2, -0.268), r=(0.021, 0.021, 0.027)),
        Prim("ell", "head", "nose", k=0.004, c=(0, 0.2, -0.293), r=(0.009, 0.008, 0.006)),
        Prim("ell", "tail1", "tail", k=0.01, c=(0, 0.172, 0.14), r=(0.018, 0.018, 0.02)),
    ]

    def side(x, s):
        return [
            Prim("ell", "thigh" + s, "body", k=0.03, c=(0.047 * x, 0.12, 0.06), r=(0.034, 0.055, 0.06)),
            Prim("cone", "forearm" + s, "leg", k=0.01, a=(0.034 * x, 0.1, -0.135), b=(0.03 * x, 0.025, -0.155), ra=0.013, rb=0.009),
            Prim("ell", "fpaw" + s, "paw", k=0.006, c=(0.03 * x, 0.009, -0.172), r=(0.01, 0.008, 0.02)),
            Prim("cone", "shin" + s, "leg", k=0.012, a=(0.055 * x, 0.1, 0.0), b=(0.052 * x, 0.05, 0.1), ra=0.022, rb=0.012),
            Prim("ell", "foot" + s, "paw", k=0.01, c=(0.05 * x, 0.014, 0.03), r=(0.019, 0.011, 0.075)),
            Prim("sph", "head", "eye", k=0.002, sub=True, c=(EYE[0] * x, EYE[1], EYE[2]), r=0.009),
        ]

    return P + mirror(side)


def jaw():
    return [Prim("cone", "jaw", "jaw", k=0.0, a=(0, 0.195, -0.23), b=(0, 0.186, -0.275), ra=0.012, rb=0.008)]


def ears():
    Vs, Ts, off, wh, ws = [], [], 0, [], []
    for x in (1.0, -1.0):
        base = (0.014 * x, 0.24, -0.215)
        V, T = ear_shell(base, (0.2 * x, 1.0, 0.35), (-0.2 * x, 0.0, 1.0), height=0.088, width=0.034, thick=0.003,
                         cup=0.7, tip_bend=0.05)
        Vs.append(V)
        Ts.append(T + off)
        off += len(V)
        u = np.clip((V[:, 1] - 0.24) / 0.012, 0.0, 1.0)
        wh.append(1.0 - u)
        ws.append(u)
    n = len(Vs[0])
    return np.concatenate(Vs), np.concatenate(Ts), {"head": np.concatenate(wh), "ear.L": np.concatenate([ws[0], np.zeros(n)]),
                                                    "ear.R": np.concatenate([np.zeros(n), ws[1]])}, "ear", 0


def eyes():
    Vs, Ts, off = [], [], 0
    for x in (1.0, -1.0):
        V, T = uv_sphere((EYE[0] * x - 0.001 * x, EYE[1], EYE[2]), 0.0085, 8, 6)
        Vs.append(V)
        Ts.append(T + off)
        off += len(V)
    V = np.concatenate(Vs)
    return V, np.concatenate(Ts), {"head": np.ones(len(V))}, "eye", 1


def pattern(P, N, R):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    fine = vnoise(P, 900.0, 41)
    patch = fbm(P, 30.0, 3, 42)
    white = np.array([0.88, 0.88, 0.86])
    brown = np.array([0.42, 0.33, 0.24])
    col = white * (0.88 + 0.14 * fine)[:, None]
    moult = np.clip((patch - 0.58) * 5.0, 0, 1) * np.clip((N[:, 1] + 0.2) * 1.5, 0, 1) * (1 - R["paw"])
    moult = moult * np.clip(R["body"] + R["head"] * 0.7, 0, 1)
    col = col * (1 - moult[:, None] * 0.8) + brown * (0.8 + 0.3 * fine)[:, None] * (moult[:, None] * 0.8)
    tip = R["ear"] * np.clip((y - 0.305) / 0.015, 0, 1)
    col = col * (1 - tip[:, None]) + np.array([0.04, 0.035, 0.03]) * tip[:, None]
    for reg, c in (("nose", (0.35, 0.25, 0.22)), ("eye", (0.02, 0.015, 0.012))):
        w = np.clip(R[reg], 0, 1)[:, None]
        col = col * (1 - w) + np.array(c) * w
    fl = 0.8 + 0.2 * (patch - 0.5)
    fl = fl * (1 - R["leg"] * 0.6) * (1 - R["ear"] * 0.8) * (1 - R["nose"]) * (1 - R["eye"])
    fl = fl * (1 - R["head"] * 0.45) * (1 - R["muzzle"] * 0.6)
    return col, np.clip(fl, 0, 1)


LEGS = {}
for s in (".L", ".R"):
    LEGS["F" + s[1]] = dict(chain=["scapula" + s, "upperarm" + s, "forearm" + s, "hand" + s, "fpaw" + s], front=True,
                           theta_swing_rel=[(0, 10), (0.3, -40), (0.6, -30), (0.9, 0), (1, 0)])
    LEGS["H" + s[1]] = dict(chain=["thigh" + s, "shin" + s, "foot" + s, "hpaw" + s], front=False,
                           theta_swing_rel=[(0, -40), (0.3, -50), (0.6, -20), (0.9, 0), (1, 0)], theta_push=-45.0,
                           phi_break=30.0, phi_swing=35.0)

HOP = {"HL": 0.0, "HR": 0.03, "FL": 0.48, "FR": 0.58}
CLIPS = {
    "idle": dict(kind="idle", dur=3.0, neck=6.0, head=-4.0),
    "walk": dict(kind="gait", T=0.6, v=0.8, duty=0.5, phases=HOP, lift_f=0.03, lift_h=0.04, bob=0.015, bob_freq=1,
                 bob_phase=0.7, pitch_amp=6.0, pitch_phase=0.2, neck=0.0, scap_amp=6.0),
    "gallop": dict(kind="gait", T=0.36, v=6.0, duty=0.26, phases=HOP, lift_f=0.06, lift_h=0.07, bob=0.03,
                   bob_freq=1, bob_phase=0.75, pitch_amp=10.0, pitch_phase=0.2, flex_amp=14.0, flex_phase=0.05,
                   neck=-8.0, ears=35.0, scap_amp=12.0),
    "sniff": dict(kind="sniff", dur=2.4, neck=-25.0, head=-15.0),
    "look": dict(kind="look", dur=3.0, neck=25.0, head=-10.0, ears=-15.0),
    "hit": dict(kind="hit", dur=0.4, loop=False),
    "death": dict(kind="death", dur=1.2, loop=False, lie_height=0.05),
}

SPEC = dict(
    name="hare", h=0.0028, tris=5000, tex=512, skeleton=SKELETON, body=body,
    parts=[dict(prims=jaw, h=0.002, tris=200)], meshes=[ears, eyes],
    regions=["body", "chest", "head", "muzzle", "nose", "jaw", "ear", "eye", "leg", "paw", "tail"],
    pattern=pattern, legs=LEGS, clips=CLIPS,
    bones=dict(pelvis="pelvis", spine=["spine1", "spine2"], chest="chest", neck=["neck1", "neck2"], head="head",
               jaw="jaw", ears=["ear.L", "ear.R"], tail=["tail1"]),
    chest_bone="chest", pelvis_bone="pelvis",
    meta=dict(fur_length=0.025, mass=1.5),
    preview=[("idle", 0), ("gallop", 4)],
    head_view=((0.35, 0.5, 0.35), (0.0, -0.05, 0.18)),
    preview_scale=0.35,
)
