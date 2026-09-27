"""Mule deer (Odocoileus hemionus) doe in grey-brown winter coat, late October.
~0.98 m at the withers, 1.45 m nose to rump, 65 kg. Long slender legs (unguligrade, black hooves), deep narrow chest,
long neck carried high, big 'mule' ears, white rump patch, short white tail with a black tip, white throat patch,
dark forehead cap, white muzzle with a black chin band. Gaits: walk, trot, bound (gallop), and the stot (pronk)."""
import numpy as np
from flib import Prim, mirror, vnoise, fbm, ear_shell, uv_sphere

SKELETON = [
    ("root", (0, 0, 0), (0, 0, -0.3), None, False),
    ("pelvis", (0, 0.98, 0.38), (0, 1.0, 0.18), "root", True),
    ("spine1", (0, 1.0, 0.18), (0, 1.0, -0.05), "pelvis", True),
    ("spine2", (0, 1.0, -0.05), (0, 1.0, -0.26), "spine1", True),
    ("chest", (0, 1.0, -0.26), (0, 0.98, -0.38), "spine2", True),
    ("neck1", (0, 0.98, -0.38), (0, 1.13, -0.49), "chest", True),
    ("neck2", (0, 1.13, -0.49), (0, 1.29, -0.57), "neck1", True),
    ("head", (0, 1.29, -0.57), (0, 1.21, -0.84), "neck2", True),
    ("jaw", (0, 1.245, -0.635), (0, 1.195, -0.815), "head", True),
    ("ear.L", (0.05, 1.36, -0.6), (0.16, 1.44, -0.585), "head", True),
    ("ear.R", (-0.05, 1.36, -0.6), (-0.16, 1.44, -0.585), "head", True),
    ("tail1", (0, 0.97, 0.5), (0, 0.9, 0.595), "pelvis", True),
    ("tail2", (0, 0.9, 0.595), (0, 0.82, 0.635), "tail1", True),
]
for s, x in ((".L", 1.0), (".R", -1.0)):
    SKELETON += [
        ("scapula" + s, (0.06 * x, 1.0, -0.29), (0.1 * x, 0.77, -0.42), "chest", True),
        ("upperarm" + s, (0.1 * x, 0.77, -0.42), (0.1 * x, 0.6, -0.335), "scapula" + s, True),
        ("forearm" + s, (0.1 * x, 0.6, -0.335), (0.09 * x, 0.32, -0.36), "upperarm" + s, True),
        ("hand" + s, (0.09 * x, 0.32, -0.36), (0.085 * x, 0.085, -0.37), "forearm" + s, True),
        ("fpaw" + s, (0.085 * x, 0.085, -0.37), (0.085 * x, 0.004, -0.425), "hand" + s, True),
        ("thigh" + s, (0.08 * x, 0.92, 0.42), (0.1 * x, 0.66, 0.29), "pelvis", True),
        ("shin" + s, (0.1 * x, 0.66, 0.29), (0.09 * x, 0.42, 0.47), "thigh" + s, True),
        ("foot" + s, (0.09 * x, 0.42, 0.47), (0.085 * x, 0.09, 0.445), "shin" + s, True),
        ("hpaw" + s, (0.085 * x, 0.09, 0.445), (0.085 * x, 0.004, 0.39), "foot" + s, True),
    ]

EYE = (0.052, 1.305, -0.665)


def body():
    P = [
        Prim("ell", "spine2", "body", k=0.0, c=(0, 0.805, -0.18), r=(0.13, 0.21, 0.26), rot=(-3, 0, 0)),
        Prim("ell", "chest", "body", k=0.06, c=(0, 0.9, -0.33), r=(0.11, 0.13, 0.13)),
        Prim("ell", "chest", "chest", k=0.05, c=(0, 0.71, -0.41), r=(0.085, 0.1, 0.08)),
        Prim("ell", "spine1", "belly", k=0.07, c=(0, 0.835, 0.11), r=(0.125, 0.14, 0.2), rot=(5, 0, 0)),
        Prim("ell", "pelvis", "body", k=0.06, c=(0, 0.93, 0.36), r=(0.11, 0.1, 0.14)),
        Prim("ell", "pelvis", "rump", k=0.04, c=(0, 0.89, 0.455), r=(0.08, 0.09, 0.05)),
        Prim("cone", "neck1", "neck", k=0.06, a=(0, 0.9, -0.37), b=(0, 1.26, -0.58), ra=0.105, rb=0.058),
        Prim("ell", "neck1", "throat", k=0.05, c=(0, 1.0, -0.47), r=(0.07, 0.1, 0.08)),
        Prim("ell", "head", "head", k=0.025, c=(0, 1.31, -0.63), r=(0.064, 0.066, 0.085)),
        Prim("cone", "head", "face", k=0.028, a=(0, 1.29, -0.67), b=(0, 1.222, -0.815), ra=0.05, rb=0.03),
        Prim("ell", "head", "nose", k=0.012, c=(0, 1.215, -0.832), r=(0.027, 0.024, 0.02)),
        Prim("cone", "tail1", "tail", k=0.03, a=(0, 0.965, 0.49), b=(0, 0.9, 0.595), ra=0.034, rb=0.038),
        Prim("cone", "tail2", "tail", k=0.02, a=(0, 0.9, 0.595), b=(0, 0.825, 0.632), ra=0.036, rb=0.02),
    ]

    def side(x, s):
        return [
            Prim("ell", "head", "face", k=0.02, c=(0.042 * x, 1.285, -0.66), r=(0.028, 0.04, 0.06)),
            Prim("ell", "head", "face", k=0.012, c=(0.022 * x, 1.215, -0.79), r=(0.017, 0.022, 0.045)),
            Prim("ell", "thigh" + s, "body", k=0.06, c=(0.09 * x, 0.78, 0.39), r=(0.062, 0.16, 0.11), rot=(-12, 0, 0)),
            Prim("ell", "scapula" + s, "body", k=0.05, c=(0.075 * x, 0.88, -0.34), r=(0.05, 0.12, 0.08)),
            Prim("ell", "upperarm" + s, "leg", k=0.05, c=(0.095 * x, 0.7, -0.38), r=(0.05, 0.11, 0.07), rot=(12, 0, 0)),
            Prim("cone", "forearm" + s, "leg", k=0.03, a=(0.1 * x, 0.6, -0.335), b=(0.09 * x, 0.34, -0.358), ra=0.042, rb=0.022),
            Prim("ell", "forearm" + s, "leg", k=0.02, c=(0.097 * x, 0.52, -0.345), r=(0.034, 0.08, 0.036)),
            Prim("ell", "hand" + s, "leg", k=0.01, c=(0.09 * x, 0.32, -0.36), r=(0.023, 0.026, 0.025)),
            Prim("cone", "hand" + s, "leg", k=0.008, a=(0.09 * x, 0.31, -0.36), b=(0.085 * x, 0.09, -0.37), ra=0.018, rb=0.016),
            Prim("ell", "hand" + s, "leg", k=0.008, c=(0.085 * x, 0.085, -0.372), r=(0.02, 0.022, 0.022)),
            Prim("cone", "fpaw" + s, "leg", k=0.008, a=(0.085 * x, 0.08, -0.375), b=(0.085 * x, 0.035, -0.4), ra=0.017, rb=0.018),
            Prim("ell", "fpaw" + s, "hoof", k=0.006, c=(0.085 * x, 0.02, -0.408), r=(0.022, 0.02, 0.03), rot=(-20, 0, 0)),
            Prim("cone", "shin" + s, "leg", k=0.04, a=(0.1 * x, 0.66, 0.3), b=(0.09 * x, 0.43, 0.465), ra=0.058, rb=0.025),
            Prim("ell", "shin" + s, "leg", k=0.025, c=(0.095 * x, 0.58, 0.37), r=(0.04, 0.085, 0.05), rot=(-35, 0, 0)),
            Prim("ell", "foot" + s, "leg", k=0.01, c=(0.09 * x, 0.42, 0.482), r=(0.022, 0.03, 0.028)),
            Prim("cone", "foot" + s, "leg", k=0.008, a=(0.09 * x, 0.41, 0.47), b=(0.085 * x, 0.09, 0.445), ra=0.019, rb=0.016),
            Prim("ell", "foot" + s, "leg", k=0.008, c=(0.085 * x, 0.088, 0.446), r=(0.02, 0.022, 0.022)),
            Prim("cone", "hpaw" + s, "leg", k=0.008, a=(0.085 * x, 0.085, 0.44), b=(0.085 * x, 0.035, 0.412), ra=0.017, rb=0.018),
            Prim("ell", "hpaw" + s, "hoof", k=0.006, c=(0.085 * x, 0.02, 0.402), r=(0.021, 0.02, 0.029), rot=(-20, 0, 0)),
            Prim("sph", "head", "eye", k=0.004, sub=True, c=(EYE[0] * x, EYE[1], EYE[2]), r=0.016),
        ]

    return P + mirror(side)


def jaw():
    return [Prim("cone", "jaw", "jaw", k=0.0, a=(0, 1.24, -0.64), b=(0, 1.197, -0.81), ra=0.026, rb=0.015),
            Prim("ell", "jaw", "jaw", k=0.012, c=(0, 1.198, -0.8), r=(0.017, 0.014, 0.022))] + \
        mirror(lambda x, s: [Prim("ell", "jaw", "jaw", k=0.015, c=(0.032 * x, 1.25, -0.655), r=(0.016, 0.03, 0.04))])


def ears():
    Vs, Ts, off, wh, ws = [], [], 0, [], []
    for x in (1.0, -1.0):
        base = (0.048 * x, 1.352, -0.605)
        V, T = ear_shell(base, (0.82 * x, 0.55, 0.05), (0.0, 0.45, 1.0), height=0.19, width=0.115, thick=0.006,
                         cup=0.8, tip_bend=0.04, na=11, nu=9)
        Vs.append(V)
        Ts.append(T + off)
        off += len(V)
        u = np.clip(np.abs(V[:, 0] - base[0]) / 0.03, 0.0, 1.0)
        wh.append(1.0 - u)
        ws.append(u)
    n = len(Vs[0])
    V = np.concatenate(Vs)
    return V, np.concatenate(Ts), {"head": np.concatenate(wh), "ear.L": np.concatenate([ws[0], np.zeros(n)]),
                                   "ear.R": np.concatenate([np.zeros(n), ws[1]])}, "ear", 0


def eyes():
    Vs, Ts, off = [], [], 0
    for x in (1.0, -1.0):
        V, T = uv_sphere((EYE[0] * x - 0.002 * x, EYE[1], EYE[2]), 0.0155)
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
    leg = np.clip(R["leg"] + R["hoof"], 0, 1)
    head = np.clip(R["head"] + R["face"] + R["nose"] + R["jaw"], 0, 1)
    Pn = np.stack([x, y * (0.4 + 0.6 * (1 - leg)), z * (0.3 + 0.7 * leg)], 1)
    fine = vnoise(Pn, 520.0, 11)
    med = fbm(P, 14.0, 3, 12)
    grey = np.array([0.47, 0.42, 0.36])
    dorsal_c = np.array([0.36, 0.31, 0.26])
    cream = np.array([0.78, 0.74, 0.66])
    white = np.array([0.9, 0.89, 0.86])
    black = np.array([0.05, 0.045, 0.04])
    tawny = np.array([0.55, 0.45, 0.34])
    col = grey * (0.82 + 0.3 * fine + 0.12 * (med - 0.5))[:, None]
    dorsal = _ss(0.3, 0.9, ny) * _ss(0.85, 0.98, y)
    col = _mix(col, dorsal_c * (0.85 + 0.3 * fine)[:, None], dorsal * 0.8)
    # belly and inner legs: dark cream-grey (mule deer bellies are not bright white)
    ventral = _ss(-0.2, -0.75, ny) * (1 - head)
    col = _mix(col, cream * 0.82, ventral * 0.85)
    # rump patch, tail: white with a black tip
    rump = np.clip(R["rump"] * 1.6 + R["tail"] * _ss(-0.2, 0.3, -nz * 0.2 + 0.6 - ny * 0.3), 0, 1) * _ss(0.4, 0.46, z)
    col = _mix(col, white * (0.92 + 0.1 * fine)[:, None], rump)
    col = _mix(col, black, R["tail"] * _ss(0.86, 0.84, y))
    # throat patch
    throat = R["throat"] * _ss(-0.1, -0.6, ny + nz * 0.6)
    col = _mix(col, white, throat * 0.9)
    # legs: tawny-grey, paler behind; black hooves
    col = _mix(col, tawny * (0.85 + 0.25 * fine)[:, None], leg * _ss(0.62, 0.45, y) * 0.8)
    col = _mix(col, black * 1.4, R["hoof"])
    # face: grey with a dark forehead cap, pale eye ring, white muzzle, black chin band and nose
    ax = np.abs(x)
    cap = head * _ss(1.3, 1.36, y) * _ss(-0.58, -0.68, z) * _ss(0.3, 0.8, ny)
    col = _mix(col, dorsal_c * 0.7, cap * 0.8)
    ed = np.sqrt((ax - EYE[0]) ** 2 + (y - EYE[1]) ** 2 + (z - EYE[2]) ** 2)
    col = _mix(col, cream, head * np.exp(-(ed - 0.02) ** 2 / 0.00003) * 0.6)
    muzzle = np.clip(R["face"] * _ss(-0.74, -0.8, z) + R["jaw"] * _ss(-0.7, -0.78, z), 0, 1)
    col = _mix(col, white, muzzle * 0.85)
    chin = R["jaw"] * _ss(-0.74, -0.79, z) * _ss(0.0, -0.5, ny) + R["jaw"] * _ss(-0.2, -0.6, ny) * _ss(-0.7, -0.76, z) * 0.6
    col = _mix(col, black * 2.0, np.clip(chin, 0, 1) * 0.8)
    col = _mix(col, black, R["nose"] * _ss(-0.83, -0.845, z) + R["nose"] * 0.6)
    ear = R["ear"]
    inner = ear * _ss(0.2, -0.4, nz * 0.8 - ny * 0.3)
    col = _mix(col, grey * 0.9, ear * (1 - inner))
    col = _mix(col, white * 0.85, inner)
    col = _mix(col, black * 2, ear * _ss(0.085, 0.1, np.sqrt((ax - 0.048) ** 2 + (y - 1.352) ** 2 + (z + 0.605) ** 2) * 0.55))
    col = _mix(col, black * 0.5, R["eye"])
    fl = 0.6 + 0.2 * (med - 0.5) + 0.2 * np.clip(R["neck"] + R["throat"], 0, 1)
    fl = fl * (1 - leg) + leg * (0.25 * _ss(0.4, 0.7, y) + 0.08)
    fl = fl * (1 - head) + head * 0.18
    fl = fl * (1 - ear) + ear * 0.15
    fl = fl * (1 - R["hoof"]) * (1 - R["nose"]) * (1 - R["eye"])
    fl = np.where(rump > 0.5, fl * 1.1, fl)
    return col, np.clip(fl, 0, 1)


LEGS = {}
for s in (".L", ".R"):
    LEGS["F" + s[1]] = dict(chain=["scapula" + s, "upperarm" + s, "forearm" + s, "hand" + s, "fpaw" + s], front=True,
                           theta_swing_rel=[(0, 14), (0.2, -55), (0.5, -95), (0.8, -8), (1, 0)], phi_break=80.0,
                           phi_swing=95.0)
    LEGS["H" + s[1]] = dict(chain=["thigh" + s, "shin" + s, "foot" + s, "hpaw" + s], front=False,
                           theta_swing_rel=[(0, 15), (0.3, 30), (0.6, 20), (0.9, 2), (1, 0)], phi_break=80.0,
                           phi_swing=90.0)

LSEQ = {"HL": 0.0, "FL": 0.25, "HR": 0.5, "FR": 0.75}
CLIPS = {
    "idle": dict(kind="idle", dur=4.0, neck=4.0, head=-2.0, tail=0.0),
    "walk": dict(kind="gait", T=1.0, v=1.2, duty=0.65, phases=LSEQ, lift_f=0.09, lift_h=0.08, bob=0.01,
                 roll_amp=1.2, yaw_amp=1.5, neck=-4.0, head=2.0, head_bob=3.0, tail=0.0, tail_sway=5.0, scap_amp=8.0),
    "trot": dict(kind="gait", T=0.667, v=3.0, duty=0.42, phases={"HL": 0.0, "FR": 0.02, "HR": 0.5, "FL": 0.52},
                 lift_f=0.14, lift_h=0.12, bob=0.016, neck=-2.0, head=4.0, head_bob=1.2, tail=-10.0, scap_amp=11.0),
    "gallop": dict(kind="gait", T=0.5, v=11.0, duty=0.27, phases={"HL": 0.0, "HR": 0.06, "FR": 0.45, "FL": 0.53},
                   lift_f=0.22, lift_h=0.2, bob=0.05, bob_freq=1, bob_phase=0.3, pitch_amp=7.0, pitch_phase=0.1,
                   flex_amp=10.0, flex_phase=0.02, neck=10.0, head=-6.0, tail=-35.0, scap_amp=16.0, ears=25.0),
    "stot": dict(kind="gait", T=0.8, v=5.5, duty=0.3, phases={"HL": 0.0, "HR": 0.02, "FL": 0.03, "FR": 0.05},
                 lift_f=0.32, lift_h=0.32, bob=0.16, bob_freq=1, bob_phase=0.65, swing_scale=0.2, phi_swing=70.0,
                 neck=18.0, head=-10.0, tail=-40.0, ears=10.0, scap_amp=4.0, breakover=0.3),
    "sniff": dict(kind="sniff", dur=3.0, neck=-62.0, head=-18.0, tail=5.0, ears=10.0),
    "look": dict(kind="look", dur=3.2, neck=20.0, head=-12.0, tail=-15.0, ears=-18.0),
    "hit": dict(kind="hit", dur=0.5, loop=False),
    "death": dict(kind="death", dur=1.8, loop=False, lie_height=0.17),
}

SPEC = dict(
    name="deer", h=0.006, tris=11000, tex=1024, skeleton=SKELETON, body=body,
    parts=[dict(prims=jaw, h=0.0035, tris=800)], meshes=[ears, eyes],
    regions=["body", "belly", "chest", "rump", "neck", "throat", "head", "face", "nose", "jaw", "ear", "eye", "leg",
             "hoof", "tail"],
    pattern=pattern, legs=LEGS, clips=CLIPS,
    bones=dict(pelvis="pelvis", spine=["spine1", "spine2"], chest="chest", neck=["neck1", "neck2"], head="head",
               jaw="jaw", ears=["ear.L", "ear.R"], tail=["tail1", "tail2"]),
    chest_bone="chest", pelvis_bone="pelvis",
    disp=lambda P: 0.001 * (fbm(P, 40.0, 2, 19) - 0.5),
    meta=dict(fur_length=0.02, mass=65.0),
    preview=[("idle", 0), ("stot", 12), ("gallop", 4), ("sniff", 40)],
    head_view=((0.9, 1.9, 1.35), (0.0, 0.6, 1.2)),
    preview_scale=1.25,
)
