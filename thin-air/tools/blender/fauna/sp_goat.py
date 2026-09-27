"""Mountain goat (Oreamnos americanus), winter coat: the ungulate rig of sp_deer re-proportioned (wider, lower,
stockier limbs), a hair hump over the withers, beard, short black backward-curving horns, small pointed ears,
long shaggy white fur with 'pantaloons' on the upper legs, black hooves/nose/eyes. ~0.9 m at the shoulder, 75 kg."""
import copy
import numpy as np
import sp_deer as D
from flib import Prim, mirror, vnoise, fbm, ear_shell, uv_sphere


def T(p):
    return (p[0] * 1.12, p[1] * 0.86, p[2] * 0.9)


SKELETON = [(n, T(h), T(t), par, d) for (n, h, t, par, d) in D.SKELETON]
EYE = T(D.EYE)


def tprim(pr, rs=1.14):
    p = dict(pr.p)
    for k in ("a", "b", "c"):
        if k in p:
            p[k] = T(p[k])
    for k in ("ra", "rb"):
        if k in p:
            p[k] *= rs
    if "r" in p:
        p["r"] = tuple(v * rs for v in p["r"]) if isinstance(p["r"], tuple) else p["r"] * rs
    return Prim(pr.kind, pr.bone, pr.region, k=pr.k * 1.1, sub=pr.sub, **p)


def body():
    P = [tprim(p) for p in D.body() if p.region != "rump"]
    P += [
        Prim("ell", "chest", "hump", k=0.08, c=T((0, 1.0, -0.3)), r=(0.12, 0.1, 0.17)),
        Prim("ell", "head", "beard", k=0.02, c=T((0, 1.19, -0.7)), r=(0.026, 0.07, 0.04), rot=(15, 0, 0)),
    ]
    for x in (1.0, -1.0):
        P.append(Prim("cone", "head", "horn", k=0.004, a=T((0.03 * x, 1.36, -0.64)), b=T((0.036 * x, 1.52, -0.57)),
                      ra=0.012, rb=0.003))
    return P


def jaw():
    return [tprim(p) for p in D.jaw()]


def ears():
    Vs, Ts, off, wh, ws = [], [], 0, [], []
    for x in (1.0, -1.0):
        base = T((0.05 * x, 1.35, -0.6))
        V, T_ = ear_shell(base, (0.75 * x, 0.6, 0.2), (0.0, 0.4, 1.0), height=0.1, width=0.055, thick=0.006, cup=0.8,
                          tip_bend=0.0)
        Vs.append(V)
        Ts.append(T_ + off)
        off += len(V)
        u = np.clip(np.abs(V[:, 0] - base[0]) / 0.02, 0.0, 1.0)
        wh.append(1.0 - u)
        ws.append(u)
    n = len(Vs[0])
    return np.concatenate(Vs), np.concatenate(Ts), {"head": np.concatenate(wh), "ear.L": np.concatenate([ws[0], np.zeros(n)]),
                                                    "ear.R": np.concatenate([np.zeros(n), ws[1]])}, "ear", 0


def eyes():
    Vs, Ts, off = [], [], 0
    for x in (1.0, -1.0):
        V, T_ = uv_sphere((EYE[0] * x - 0.002 * x, EYE[1], EYE[2]), 0.0135)
        Vs.append(V)
        Ts.append(T_ + off)
        off += len(V)
    V = np.concatenate(Vs)
    return V, np.concatenate(Ts), {"head": np.ones(len(V))}, "eye", 1


def pattern(P, N, R):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ny = N[:, 1]
    leg = np.clip(R["leg"] + R["hoof"], 0, 1)
    fine = vnoise(np.stack([x, y * 0.4, z], 1), 300.0, 31)
    med = fbm(P, 12.0, 3, 32)
    white = np.array([0.86, 0.85, 0.8])
    ivory = np.array([0.8, 0.76, 0.66])
    col = white * (0.86 + 0.18 * fine)[:, None]
    t = np.clip(0.35 * med + 0.4 * leg * (y < 0.35) + 0.25 * np.clip(-ny, 0, 1), 0, 1)[:, None]
    col = col * (1 - t) + ivory * (0.85 + 0.2 * fine)[:, None] * t
    for reg, c in (("hoof", (0.04, 0.035, 0.03)), ("horn", (0.035, 0.03, 0.028)), ("nose", (0.04, 0.035, 0.035)),
                   ("eye", (0.02, 0.015, 0.012))):
        w = np.clip(R[reg], 0, 1)[:, None]
        col = col * (1 - w) + np.array(c) * w
    fl = 0.75 + 0.2 * (med - 0.5) + 0.3 * R["hump"] + 0.25 * R["beard"] + 0.15 * R["neck"]
    fl = fl * (1 - leg) + leg * (0.7 * (y > 0.45) + 0.25)
    head = np.clip(R["head"] + R["face"] + R["jaw"], 0, 1)
    fl = fl * (1 - head) + head * 0.28
    fl = fl * (1 - R["ear"]) + R["ear"] * 0.2
    fl = fl * (1 - R["hoof"]) * (1 - R["horn"]) * (1 - R["nose"]) * (1 - R["eye"])
    return col, np.clip(fl, 0, 1)


CLIPS = {}
for k, c in D.CLIPS.items():
    if k == "stot":
        continue
    c = copy.deepcopy(c)
    if c["kind"] != "death":
        c["neck"] = c.get("neck", 0.0) - 14.0
    if c["kind"] == "gait":
        c["v"] *= 0.75
        c["lift_f"] *= 0.9
    CLIPS[k] = c

SPEC = dict(
    name="goat", h=0.006, tris=11000, tex=1024, skeleton=SKELETON, body=body,
    parts=[dict(prims=jaw, h=0.0035, tris=700)], meshes=[ears, eyes],
    regions=D.SPEC["regions"] + ["hump", "beard", "horn"],
    pattern=pattern, legs=copy.deepcopy(D.LEGS), clips=CLIPS, bones=D.SPEC["bones"],
    chest_bone="chest", pelvis_bone="pelvis",
    disp=lambda P: 0.0015 * (fbm(P, 30.0, 2, 39) - 0.5),
    meta=dict(fur_length=0.05, mass=75.0),
    preview=[("idle", 0), ("gallop", 4)],
    head_view=((0.9, 1.7, 1.2), (0.0, 0.5, 1.0)),
    preview_scale=1.2,
)
