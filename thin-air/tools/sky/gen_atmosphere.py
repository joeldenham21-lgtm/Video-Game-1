#!/usr/bin/env python3
"""THIN AIR — physically based atmosphere LUTs for the sky shader.

Spectral (31 wavelengths, 400–700 nm) single scattering with Rayleigh, Mie (Ångström aerosol) and ozone
absorption (Chappuis band), plus Hillaire-2020 isotropic multiple scattering. Converted to linear sRGB
white-balanced so the top-of-atmosphere sun is (1, 1, 1) with unit irradiance.

Outputs (tools/sky/_cache/):
  atmosphere_lut.bin  – RGBE9995 texels of a 3D texture W=64 (32 azimuth-to-sun Rayleigh+MS | 32 Mie w/o phase),
                        H=64 (view elevation, el = 90°·v²), D=256 (4 camera altitudes × 64 sun elevations,
                        el_s = -20° + 110°·t²). Radiance per unit TOA solar irradiance (1/sr).
  atmosphere_cpu.bin  – float32 RGB rows (width 64 sun slices) for CPU lighting:
                        rows 0-6  transmittance to the sun at 1300, 2000, 2700, 3450, 4500, 6000, 9000 m
                        rows 7-10  sky irradiance on a horizontal plane (4 camera altitudes)
                        rows 11-14 horizon radiance (el 1.5°) averaged over azimuth (incl. Mie phase)
                        rows 15-18 horizon radiance toward the sun, rows 19-22 away from the sun
                        rows 23-26 zenith radiance
  atmosphere_meta.json – parameters.
Then run tools/sky/bake_sky_resources.gd (Godot) to turn them into .res resources.

Deterministic; ~2–4 min on 4 cores. Usage: python3 tools/sky/gen_atmosphere.py
"""
import json
import os
import sys
import time

import numpy as np
from scipy.ndimage import map_coordinates

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "_cache")
os.makedirs(CACHE, exist_ok=True)

# ------------------------------------------------------------------------------------------ constants
R_G = 6360e3
R_T = 6460e3
H_TOP = R_T - R_G

LAMBDA = np.arange(400.0, 701.0, 10.0)            # nm, 31 samples
NL = LAMBDA.size

# Rayleigh (sea level), fit to Hillaire 2020 / Bruneton values: 13.558e-6 /m at 550 nm, λ^-4.
BETA_R = 13.558e-6 * (550.0 / LAMBDA) ** 4.0
H_R = 8000.0
# Mie: clean free-troposphere mountain aerosol. Scale height 2 km so the aerosol optical depth above the
# valley (1,300 m) is ≈0.05 at 550 nm and ≈0.017 above the summit (deeper blue, crisper sky up high).
# Ångström exponent 1.2, single-scattering albedo 0.92.
BETA_M_EXT = 4.8e-5 * (550.0 / LAMBDA) ** 1.2
BETA_M_SCA = 0.92 * BETA_M_EXT
H_M = 2000.0
MIE_G = 0.8
# Ozone: Chappuis band relative cross-section (peak ≈ 600 nm), scaled so σ(550) = 1.881e-6 /m at peak density.
_OZ_L = np.array([400, 440, 480, 500, 520, 550, 575, 600, 625, 650, 680, 700, 720], float)
_OZ_R = np.array([0.0, 0.045, 0.20, 0.36, 0.55, 1.0, 1.36, 1.55, 1.2, 0.80, 0.345, 0.26, 0.18], float)
SIGMA_O = 1.881e-6 * np.interp(LAMBDA, _OZ_L, _OZ_R)
GROUND_ALBEDO = 0.35

CAM_ALTS = [1300.0, 2000.0, 2700.0, 3450.0]
T_ALTS = [1300.0, 2000.0, 2700.0, 3450.0, 4500.0, 6000.0, 9000.0]
N_AZ, N_VIEW, N_SUN = 32, 64, 64
N_STEPS = 56


def dens_r(h):
    return np.exp(-np.maximum(h, 0.0) / H_R)


def dens_m(h):
    return np.exp(-np.maximum(h, 0.0) / H_M)


def dens_o(h):
    return np.maximum(0.0, 1.0 - np.abs(h - 25e3) / 15e3)


def sun_el_of_t(t):
    return -20.0 + 110.0 * t * t


def view_el_of_v(v):
    return 90.0 * v * v


# ------------------------------------------------------------------------------------------ colour
def _g(x, mu, s1, s2):
    s = np.where(x < mu, s1, s2)
    return np.exp(-0.5 * ((x - mu) / s) ** 2)


def cie_cmf(lam):
    x = 1.056 * _g(lam, 599.8, 37.9, 31.0) + 0.362 * _g(lam, 442.0, 16.0, 26.7) - 0.065 * _g(lam, 501.1, 20.4, 26.2)
    y = 0.821 * _g(lam, 568.8, 46.9, 40.5) + 0.286 * _g(lam, 530.9, 16.3, 31.1)
    z = 1.217 * _g(lam, 437.0, 11.8, 36.0) + 0.681 * _g(lam, 459.0, 26.0, 13.8)
    return np.stack([x, y, z], axis=1)          # NL x 3


XYZ2RGB = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])


def planck(lam_nm, T):
    lam = lam_nm * 1e-9
    h, c, k = 6.62607e-34, 2.99792e8, 1.380649e-23
    return 1.0 / (lam ** 5 * (np.exp(h * c / (lam * k * T)) - 1.0))


SOLAR = planck(LAMBDA, 5778.0)
SOLAR /= SOLAR.mean()
CMF = cie_cmf(LAMBDA)
_SPEC2RGB = (SOLAR[:, None] * CMF) @ XYZ2RGB.T  # NL x 3: spectral (per unit solar) -> RGB
SUN_RGB = _SPEC2RGB.sum(axis=0)                  # TOA sun colour before white balance
SPEC2RGB = _SPEC2RGB / SUN_RGB[None, :]          # white-balanced: TOA sun -> (1,1,1)


def to_rgb(spec):
    """spec [..., NL] (per unit TOA solar irradiance) -> linear sRGB [..., 3] (out-of-gamut clipped)."""
    return np.maximum(spec @ SPEC2RGB, 0.0)


# ------------------------------------------------------------------------------------------ geometry
def ray_sphere_far(r, mu, R):
    """distance along ray (start radius r, cos zenith mu) to exit sphere radius R (r<=R)."""
    disc = r * r * (mu * mu - 1.0) + R * R
    return -r * mu + np.sqrt(np.maximum(disc, 0.0))


def ray_hits_ground(r, mu):
    disc = r * r * (mu * mu - 1.0) + R_G * R_G
    return (mu < 0.0) & (disc >= 0.0)


# ------------------------------------------------------------------------------------------ optical depth table
OD_NH, OD_NMU = 256, 1024


def od_h_of_x(x):
    return H_TOP * x * x


def build_od_table():
    """Column densities (Rayleigh, Mie, ozone) from (h, zenith angle) to the top; inf where the ground blocks."""
    xs = (np.arange(OD_NH) + 0.0) / (OD_NH - 1)
    hs = od_h_of_x(xs)
    ths = np.linspace(0.0, np.pi, OD_NMU)
    H, TH = np.meshgrid(hs, ths, indexing="ij")
    r = R_G + H
    mu = np.cos(TH)
    ground = ray_hits_ground(r, mu) & (H > 1.0)
    L = ray_sphere_far(r, mu, R_T)
    n = 200
    s = (np.arange(n) + 0.5) / n
    s = s * s                                           # denser near the start
    ds_w = np.diff(np.concatenate([[0.0], ((np.arange(n) + 1.0) / n) ** 2]))
    out = np.zeros((3, OD_NH, OD_NMU))
    for i in range(n):
        d = L * s[i]
        rr = np.sqrt(r * r + d * d + 2.0 * r * mu * d)
        hh = rr - R_G
        w = L * ds_w[i]
        out[0] += dens_r(hh) * w
        out[1] += dens_m(hh) * w
        out[2] += dens_o(hh) * w
    big = 1e12
    for k in range(3):
        out[k][ground] = big
    # h == 0 and below-horizon: blocked
    return out


def od_lookup(table, h, mu):
    x = np.sqrt(np.clip(h / H_TOP, 0.0, 1.0)) * (OD_NH - 1)
    th = np.arccos(np.clip(mu, -1.0, 1.0)) / np.pi * (OD_NMU - 1)
    coords = np.stack([x.ravel(), th.ravel()])
    res = [map_coordinates(table[k], coords, order=1, mode="nearest").reshape(h.shape) for k in range(3)]
    return res


def transmittance_spec(odr, odm, odo):
    tau = odr[..., None] * BETA_R + odm[..., None] * BETA_M_EXT + odo[..., None] * SIGMA_O
    return np.exp(-np.minimum(tau, 80.0))


# ------------------------------------------------------------------------------------------ multiple scattering
MS_NH, MS_NMU = 32, 32


def fib_sphere(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1.0 - 2.0 * i / n)
    theta = np.pi * (1.0 + 5 ** 0.5) * i
    return np.stack([np.cos(theta) * np.sin(phi), np.cos(phi), np.sin(theta) * np.sin(phi)], axis=1)


def build_ms_table(od):
    """Ψ_ms(h, μs) spectral (Hillaire 2020, eq. 5-10)."""
    dirs = fib_sphere(64)                              # 64 x 3 (y up)
    hs = H_TOP * ((np.arange(MS_NH) + 0.5) / MS_NH) ** 2
    mus = np.linspace(-1.0, 1.0, MS_NMU)
    psi = np.zeros((MS_NH, MS_NMU, NL))
    n = 40
    for ih, h in enumerate(hs):
        r = R_G + h
        for im, mus_ in enumerate(mus):
            sun = np.array([np.sqrt(max(0.0, 1 - mus_ * mus_)), mus_, 0.0])
            mu_v = dirs[:, 1]
            ground = ray_hits_ground(np.full(64, r), mu_v)
            t_end = np.where(ground,
                             -r * mu_v - np.sqrt(np.maximum(r * r * (mu_v * mu_v - 1) + R_G * R_G, 0)),
                             ray_sphere_far(np.full(64, r), mu_v, R_T))
            L2 = np.zeros((64, NL))
            fms = np.zeros((64, NL))
            T = np.ones((64, NL))
            dt = t_end / n
            for i in range(n):
                d = (i + 0.5) * dt
                px = dirs[:, 0] * d
                py = r + dirs[:, 1] * d
                pz = dirs[:, 2] * d
                rr = np.sqrt(px * px + py * py + pz * pz)
                hh = rr - R_G
                sca = dens_r(hh)[:, None] * BETA_R + dens_m(hh)[:, None] * BETA_M_SCA
                ext = dens_r(hh)[:, None] * BETA_R + dens_m(hh)[:, None] * BETA_M_EXT + dens_o(hh)[:, None] * SIGMA_O
                mu_s_p = (px * sun[0] + py * sun[1] + pz * sun[2]) / rr
                odr, odm, odo = od_lookup(od, hh, mu_s_p)
                Ts = transmittance_spec(odr, odm, odo)
                seg = np.exp(-ext * dt[:, None])
                # integrate analytically over the segment (energy conserving)
                w = (1.0 - seg) / np.maximum(ext, 1e-12)
                L2 += T * sca * Ts * w / (4 * np.pi)     # single scattering toward x, isotropic phase
                fms += T * sca * w                        # scattering optical depth seen from x
                T = T * seg
            # ground bounce at the end of ground-hitting rays
            gp = np.stack([dirs[:, 0] * t_end, r + dirs[:, 1] * t_end, dirs[:, 2] * t_end], axis=1)
            gn = gp / np.linalg.norm(gp, axis=1, keepdims=True)
            mu_g = gn @ sun
            odr, odm, odo = od_lookup(od, np.zeros(64), mu_g)
            Tg = transmittance_spec(odr, odm, odo)
            L2 += np.where(ground[:, None], T * Tg * np.maximum(mu_g, 0)[:, None] * GROUND_ALBEDO / np.pi, 0.0)
            # ∫_Ω (…) P_u dω with P_u = 1/4π is the mean over uniformly distributed directions.
            L2m = L2.mean(axis=0)
            fm = fms.mean(axis=0)
            psi[ih, im] = L2m / (1.0 - fm)
    return hs, mus, psi


def ms_lookup(psi, h, mu_s):
    xh = np.clip(np.sqrt(np.clip(h, 0, None) / H_TOP) * MS_NH - 0.5, 0, MS_NH - 1)
    xm = np.clip((mu_s + 1.0) * 0.5 * (MS_NMU - 1), 0, MS_NMU - 1)
    coords = np.stack([xh.ravel(), xm.ravel()])
    out = np.stack([map_coordinates(psi[:, :, k], coords, order=1, mode="nearest") for k in range(NL)], axis=-1)
    return out.reshape(h.shape + (NL,))


# ------------------------------------------------------------------------------------------ sky view
def phase_rayleigh(c):
    return 3.0 / (16.0 * np.pi) * (1.0 + c * c)


def phase_mie(c, g=MIE_G):
    k = 3.0 / (8.0 * np.pi) * (1 - g * g) / (2 + g * g)
    return k * (1 + c * c) / np.power(1 + g * g - 2 * g * c, 1.5)


def sky_slice(od, psi, cam_h, sun_el_deg):
    """Returns (rayleigh+ms RGB [N_VIEW, N_AZ, 3], mie-no-phase RGB [N_VIEW, N_AZ, 3])."""
    el_v = np.radians(view_el_of_v(np.arange(N_VIEW) / (N_VIEW - 1)))
    az = np.radians(np.linspace(0.0, 180.0, N_AZ))
    EL, AZ = np.meshgrid(el_v, az, indexing="ij")
    d = np.stack([np.cos(EL) * np.cos(AZ), np.sin(EL), np.cos(EL) * np.sin(AZ)], axis=-1)   # N_VIEW,N_AZ,3
    es = np.radians(sun_el_deg)
    sun = np.array([np.cos(es), np.sin(es), 0.0])
    cos_t = d @ sun
    r0 = R_G + cam_h
    mu = d[..., 1]
    L = ray_sphere_far(r0, mu, R_T)
    # quadratic step distribution
    edges = (np.arange(N_STEPS + 1) / N_STEPS) ** 2
    sh = EL.shape
    T = np.ones(sh + (NL,))
    Lr = np.zeros(sh + (NL,))
    Lm = np.zeros(sh + (NL,))
    pr = phase_rayleigh(cos_t)[..., None]
    for i in range(N_STEPS):
        t0 = L * edges[i]
        t1 = L * edges[i + 1]
        tm = 0.5 * (t0 + t1)
        dt = (t1 - t0)[..., None]
        px = d[..., 0] * tm
        py = r0 + d[..., 1] * tm
        pz = d[..., 2] * tm
        rr = np.sqrt(px * px + py * py + pz * pz)
        hh = rr - R_G
        rho_r = dens_r(hh)[..., None]
        rho_m = dens_m(hh)[..., None]
        rho_o = dens_o(hh)[..., None]
        ext = rho_r * BETA_R + rho_m * BETA_M_EXT + rho_o * SIGMA_O
        mu_s = (px * sun[0] + py * sun[1] + pz * sun[2]) / rr
        odr, odm, odo = od_lookup(od, hh, mu_s)
        Ts = transmittance_spec(odr, odm, odo)
        ms = ms_lookup(psi, hh, mu_s)
        seg = np.exp(-ext * dt)
        w = (1.0 - seg) / np.maximum(ext, 1e-12)
        Lr += T * (rho_r * BETA_R * pr * Ts + (rho_r * BETA_R + rho_m * BETA_M_SCA) * ms) * w
        Lm += T * (rho_m * BETA_M_SCA * Ts) * w
        T = T * seg
    return to_rgb(Lr), to_rgb(Lm)


# ------------------------------------------------------------------------------------------ RGBE9995
def pack_rgbe9995(rgb):
    """rgb float32 [..., 3] (>= 0) -> uint32 E5B9G9R9 as Godot/Vulkan expect."""
    N, B, EMAX = 9, 15, 31
    sharedexp_max = (2 ** N - 1) / 2 ** N * 2.0 ** (EMAX - B)
    c = np.clip(np.nan_to_num(rgb, nan=0.0, posinf=sharedexp_max), 0.0, sharedexp_max)
    maxc = c.max(axis=-1)
    exp_shared = np.maximum(-B - 1, np.floor(np.log2(np.maximum(maxc, 1e-30)))) + 1 + B
    denom = np.power(2.0, exp_shared - B - N)
    maxm = np.floor(maxc / denom + 0.5)
    exp_shared = np.where(maxm == 2 ** N, exp_shared + 1, exp_shared)
    denom = np.power(2.0, exp_shared - B - N)
    rm = np.floor(c[..., 0] / denom + 0.5).astype(np.uint32)
    gm = np.floor(c[..., 1] / denom + 0.5).astype(np.uint32)
    bm = np.floor(c[..., 2] / denom + 0.5).astype(np.uint32)
    e = exp_shared.astype(np.uint32)
    return (rm & 0x1FF) | ((gm & 0x1FF) << 9) | ((bm & 0x1FF) << 18) | ((e & 0x1F) << 27)


def main():
    t0 = time.time()
    print("optical depth table…", flush=True)
    od = build_od_table()
    print("  %.1fs" % (time.time() - t0))
    print("multiple scattering Ψ_ms…", flush=True)
    _, _, psi = build_ms_table(od)
    print("  %.1fs" % (time.time() - t0))
    lut = np.zeros((len(CAM_ALTS) * N_SUN, N_VIEW, 2 * N_AZ, 3), np.float32)   # D, H, W, 3
    cpu = np.zeros((27, N_SUN, 3), np.float32)
    ts = np.arange(N_SUN) / (N_SUN - 1)
    sun_els = sun_el_of_t(ts)
    el_v = np.radians(view_el_of_v(np.arange(N_VIEW) / (N_VIEW - 1)))
    az = np.radians(np.linspace(0.0, 180.0, N_AZ))
    # solid-angle weights for irradiance on a horizontal plane (upper hemisphere, both azimuth halves)
    d_el = np.gradient(el_v)
    d_az = np.gradient(az)
    for ia, cam_h in enumerate(CAM_ALTS):
        for js, el_s in enumerate(sun_els):
            R, M = sky_slice(od, psi, cam_h, el_s)
            k = ia * N_SUN + js
            lut[k, :, :N_AZ] = R
            lut[k, :, N_AZ:] = M
            # derived CPU quantities (Mie with phase)
            es = np.radians(el_s)
            sun = np.array([np.cos(es), np.sin(es), 0.0])
            EL, AZ = np.meshgrid(el_v, az, indexing="ij")
            d = np.stack([np.cos(EL) * np.cos(AZ), np.sin(EL), np.cos(EL) * np.sin(AZ)], axis=-1)
            full = R + M * phase_mie(d @ sun)[..., None]
            wgt = (np.cos(EL) * np.sin(EL) * d_el[:, None] * d_az[None, :])[..., None] * 2.0   # ×2 for mirrored half
            wgt *= np.pi / wgt.sum()                                                             # exact ∫cos dω = π
            cpu[7 + ia, js] = (full * wgt).sum(axis=(0, 1))
            # horizon at 1.5° elevation
            v_h = np.sqrt(1.5 / 90.0) * (N_VIEW - 1)
            i0 = int(np.floor(v_h))
            f = v_h - i0
            hor = full[i0] * (1 - f) + full[i0 + 1] * f         # N_AZ x 3
            cpu[11 + ia, js] = hor.mean(axis=0)
            cpu[15 + ia, js] = hor[0]
            cpu[19 + ia, js] = hor[-1]
            cpu[23 + ia, js] = full[-1].mean(axis=0)
        print("  alt %d done %.1fs" % (cam_h, time.time() - t0), flush=True)
    # transmittance rows
    for it, h in enumerate(T_ALTS):
        mu = np.sin(np.radians(sun_els))
        odr, odm, odo = od_lookup(od, np.full(N_SUN, h), mu)
        cpu[it, :] = to_rgb(transmittance_spec(odr, odm, odo))
    packed = pack_rgbe9995(lut)
    packed.astype("<u4").tofile(os.path.join(CACHE, "atmosphere_lut.bin"))
    cpu.astype("<f4").tofile(os.path.join(CACHE, "atmosphere_cpu.bin"))
    meta = {
        "lut": {"width": 2 * N_AZ, "height": N_VIEW, "depth": len(CAM_ALTS) * N_SUN, "format": "RGBE9995",
                "n_az": N_AZ, "n_view": N_VIEW, "n_sun": N_SUN, "cam_alts": CAM_ALTS,
                "sun_el": "-20 + 110 t^2", "view_el": "90 v^2"},
        "cpu": {"width": N_SUN, "height": 27, "format": "RGBF", "t_alts": T_ALTS},
        "mie_g": MIE_G, "sun_rgb_before_wb": SUN_RGB.tolist(),
    }
    with open(os.path.join(CACHE, "atmosphere_meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    # quick report
    def show(label, row, el):
        j = int(round(np.sqrt((el + 20) / 110) * (N_SUN - 1)))
        print("%-28s el %5.1f: %s" % (label, sun_el_of_t(j / (N_SUN - 1)), np.round(cpu[row, j], 4)))
    for el in (-6.0, 0.0, 5.0, 20.0, 45.0):
        show("transmittance 1300", 0, el)
        show("zenith 1300", 23, el)
        show("zenith 3450", 26, el)
        show("horizon avg 1300", 11, el)
        show("irradiance 1300", 7, el)
    print("max lut %.3f; done in %.1fs" % (lut.max(), time.time() - t0))


if __name__ == "__main__":
    sys.exit(main())
