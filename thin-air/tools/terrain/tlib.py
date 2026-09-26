"""ctypes bindings for terrain_c.c (compiled on demand into tools/terrain/_cache/libterrain.so)."""
from __future__ import annotations

import ctypes as C
import os
import subprocess

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "_cache")
SRC = os.path.join(HERE, "terrain_c.c")
LIB = os.path.join(CACHE, "libterrain.so")

_lib = None


def lib():
	global _lib
	if _lib is not None:
		return _lib
	os.makedirs(CACHE, exist_ok=True)
	if not os.path.exists(LIB) or os.path.getmtime(LIB) < os.path.getmtime(SRC):
		subprocess.check_call(["gcc", "-O2", "-fPIC", "-shared", "-o", LIB, SRC, "-lm"])
	_lib = C.CDLL(LIB)
	f32p = np.ctypeslib.ndpointer(dtype=np.float32, flags="C_CONTIGUOUS")
	u8p = np.ctypeslib.ndpointer(dtype=np.uint8, flags="C_CONTIGUOUS")
	i32p = np.ctypeslib.ndpointer(dtype=np.int32, flags="C_CONTIGUOUS")
	_lib.noise_grid.argtypes = [f32p, C.c_int, C.c_int, C.c_double, C.c_double, C.c_double, C.c_double, C.c_int,
								C.c_double, C.c_double, C.c_uint32, C.c_int, C.c_void_p, C.c_void_p, C.c_double]
	_lib.noise_eroded.argtypes = [f32p, C.c_int, C.c_int, C.c_double, C.c_double, C.c_double, C.c_double, C.c_int,
								  C.c_double, C.c_double, C.c_uint32, C.c_void_p, C.c_void_p]
	_lib.erosion_noise.argtypes = [f32p, f32p, C.c_int, C.c_int, C.c_double, C.c_double, C.c_double, C.c_double,
								   C.c_int, C.c_double, C.c_double, C.c_double, C.c_double, C.c_uint32, f32p, C.c_void_p,
								   C.c_void_p]
	_lib.pf_order.argtypes = [f32p, C.c_int, C.c_int, C.c_void_p, C.c_int, i32p, i32p, C.c_void_p]
	_lib.pf_order.restype = C.c_int
	_lib.spl_incise.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_void_p, C.c_void_p, C.c_float, C.c_float,
								C.c_float, C.c_int, C.c_void_p, C.c_float, C.c_void_p]
	_lib.spl_steady.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_void_p, f32p, C.c_float, C.c_float,
								C.c_void_p, C.c_int, C.c_float, C.c_void_p]
	_lib.spl_steady_rand.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_void_p, f32p, C.c_float, C.c_float,
									 C.c_void_p, C.c_int, C.c_float, C.c_float, C.c_uint64, C.c_void_p]
	_lib.thermal.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_float, C.c_int, C.c_float, C.c_void_p,
							 C.c_void_p]
	_lib.droplets.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_int, C.c_uint64, C.c_void_p, C.c_void_p,
							  C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p]
	_lib.flow_mfd.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_float, f32p]
	_lib.render_persp.argtypes = [f32p, C.c_int, C.c_float, C.c_float, C.c_void_p, f32p, C.c_float, f32p, C.c_int,
								  C.c_int, C.c_float, f32p]
	_lib.route.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_int, C.c_int, C.c_int, C.c_int, C.c_float, C.c_float,
						   C.c_float, C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_int, i32p, i32p, C.c_int]
	_lib.route.restype = C.c_int
	_lib.route_turn.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_int, C.c_int, C.c_int, C.c_int, C.c_float,
								C.c_float, C.c_float, C.c_float, C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_int, i32p, i32p,
								C.c_int]
	_lib.route_turn.restype = C.c_int
	_lib.lic_fall.argtypes = [f32p, f32p, C.c_int, C.c_int, C.c_int, f32p]
	_lib.horizon_ao.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_int, C.c_float, C.c_float, f32p]
	_lib.horizon_dir.argtypes = [f32p, C.c_int, C.c_int, C.c_float, C.c_float, C.c_float, C.c_float, C.c_float,
								 f32p]
	return _lib


def _ptr(a):
	return None if a is None else a.ctypes.data


def _f32(a):
	return np.ascontiguousarray(a, dtype=np.float32)


def noise(ny, nx, x0, z0, dx, freq, octaves=6, lacunarity=2.0, gain=0.5, seed=1, kind="fbm", warpx=None,
		  warpz=None, rotate=0.0):
	"""Gradient noise on a grid. kind: fbm | ridged | billow | swiss. Coordinates in metres."""
	out = np.empty((ny, nx), np.float32)
	k = {"fbm": 0, "ridged": 1, "billow": 2, "swiss": 3}[kind]
	wx = None if warpx is None else _f32(warpx)
	wz = None if warpz is None else _f32(warpz)
	lib().noise_grid(out, nx, ny, x0, z0, dx, freq, octaves, lacunarity, gain, seed & 0xFFFFFFFF, k, _ptr(wx),
					 _ptr(wz), rotate)
	return out


def noise_eroded(ny, nx, x0, z0, dx, freq, octaves=7, gain=0.5, damp=1.0, seed=1, warpx=None, warpz=None):
	out = np.empty((ny, nx), np.float32)
	wx = None if warpx is None else _f32(warpx)
	wz = None if warpz is None else _f32(warpz)
	lib().noise_eroded(out, nx, ny, x0, z0, dx, freq, octaves, gain, damp, seed & 0xFFFFFFFF, _ptr(wx), _ptr(wz))
	return out


def erosion_noise(gx, gz, x0, z0, dx, freq, octaves=5, gain=0.5, lacunarity=2.0, bend=0.6, slope_fade=0.05,
				  seed=1, derivs=False):
	"""Gully/spur noise aligned with the fall line of the gradient (gx, gz). Returns out (and d/dx, d/dz)."""
	gx = _f32(gx)
	gz = _f32(gz)
	ny, nx = gx.shape
	out = np.empty_like(gx)
	ddx = np.empty_like(gx) if derivs else None
	ddz = np.empty_like(gx) if derivs else None
	lib().erosion_noise(gx, gz, nx, ny, x0, z0, dx, freq, octaves, gain, lacunarity, bend, slope_fade, seed & 0xFFFFFFFF,
						out, _ptr(ddx), _ptr(ddz))
	return (out, ddx, ddz) if derivs else out


def spl_incise(h, dx, fixed=None, kmap=None, K=1e-4, m=0.45, dt=1.0, iters=50, uplift=None, talus_tan=0.0):
	h = _f32(h).copy()
	ny, nx = h.shape
	fx = None if fixed is None else np.ascontiguousarray(fixed, np.uint8)
	km = None if kmap is None else _f32(kmap)
	up = None if uplift is None else _f32(uplift)
	area = np.empty_like(h)
	lib().spl_incise(h, nx, ny, dx, _ptr(fx), _ptr(km), K, m, dt, iters, _ptr(up), talus_tan, _ptr(area))
	return h, area


def spl_steady(h, dx, ks, fixed=None, m=0.45, tmax_deg=45.0, tmax_map=None, iters=20, damping=0.5):
	h = _f32(h).copy()
	ny, nx = h.shape
	fx = None if fixed is None else np.ascontiguousarray(fixed, np.uint8)
	tm = None if tmax_map is None else _f32(tmax_map)
	area = np.empty_like(h)
	lib().spl_steady(h, nx, ny, dx, _ptr(fx), _f32(ks), m, float(np.tan(np.radians(tmax_deg))), _ptr(tm), iters,
					 damping, area.ctypes.data)
	return h, area


def spl_steady_rand(h, dx, ks, fixed=None, m=0.45, tmax_deg=45.0, tmax_map=None, iters=20, damping=0.5, rexp=1.0,
					seed=1):
	"""Steady-state stream-power landscape with stochastic (slope-weighted) receivers. Returns (h, area)."""
	h = _f32(h).copy()
	ny, nx = h.shape
	fx = None if fixed is None else np.ascontiguousarray(fixed, np.uint8)
	tm = None if tmax_map is None else _f32(tmax_map)
	area = np.empty_like(h)
	lib().spl_steady_rand(h, nx, ny, dx, _ptr(fx), _f32(ks), m, float(np.tan(np.radians(tmax_deg))), _ptr(tm), iters,
						  damping, rexp, seed, area.ctypes.data)
	return h, area


def thermal(h, cell, talus_deg=35.0, iters=20, rate=0.5, erod=None, fixed=None):
	h = _f32(h).copy()
	ny, nx = h.shape
	er = None if erod is None else _f32(erod)
	fx = None if fixed is None else np.ascontiguousarray(fixed, np.uint8)
	lib().thermal(h, nx, ny, cell, float(np.tan(np.radians(talus_deg))), iters, rate, _ptr(er), _ptr(fx))
	return h


class DropParams(C.Structure):
	_fields_ = [("inertia", C.c_float), ("capacity", C.c_float), ("min_capacity", C.c_float),
				("deposit", C.c_float), ("erode", C.c_float), ("evaporate", C.c_float), ("gravity", C.c_float),
				("max_steps", C.c_int), ("radius", C.c_int), ("init_water", C.c_float), ("init_speed", C.c_float),
				("max_erode_step", C.c_float)]


def droplets(h, count, seed=1, hscale=1.0, hardness=None, nodrop=None, **kw):
	"""Particle erosion. Returns (h, erosion, deposition, flow)."""
	p = DropParams(inertia=kw.get("inertia", 0.05), capacity=kw.get("capacity", 4.0),
				   min_capacity=kw.get("min_capacity", 0.01), deposit=kw.get("deposit", 0.3),
				   erode=kw.get("erode", 0.3), evaporate=kw.get("evaporate", 0.02), gravity=kw.get("gravity", 4.0),
				   max_steps=kw.get("max_steps", 60), radius=kw.get("radius", 2), init_water=1.0,
				   init_speed=kw.get("init_speed", 1.0), max_erode_step=kw.get("max_erode_step", 1e9))
	h = _f32(h).copy()
	ny, nx = h.shape
	ero = np.zeros_like(h)
	dep = np.zeros_like(h)
	flow = np.zeros_like(h)
	hd = None if hardness is None else _f32(hardness)
	nd = None if nodrop is None else np.ascontiguousarray(nodrop, np.uint8)
	lib().droplets(h, nx, ny, hscale, int(count), seed, C.byref(p), _ptr(hd), _ptr(nd), ero.ctypes.data,
				   dep.ctypes.data, flow.ctypes.data)
	return h, ero, dep, flow


def flow_mfd(h, cell, pexp=1.1):
	h = _f32(h)
	ny, nx = h.shape
	acc = np.empty_like(h)
	lib().flow_mfd(h, nx, ny, cell, pexp, acc)
	return acc


def render_persp(h, x0, dx, cam, fov=60.0, sun=(0.5, 0.5, -0.5), W=640, H=360, fog=0.00012, masks=None):
	"""cam = (x, y, z, yaw_deg, pitch_deg). Returns HxWx3 linear float image."""
	h = _f32(h)
	n = h.shape[0]
	s = np.asarray(sun, np.float64)
	s = _f32(s / np.linalg.norm(s))
	out = np.empty((H, W, 3), np.float32)
	m = None if masks is None else _f32(masks)
	lib().render_persp(h, n, x0, dx, _ptr(m), _f32(cam), fov, s, W, H, fog, out)
	return out


def route(h, cell, start, goal, gmax_deg, wg=2.0, over=60.0, penalty=None, margin=120):
	"""Least-cost path between grid cells start=(i, j) and goal=(i, j). Returns (I, J) int arrays."""
	h = _f32(h)
	ny, nx = h.shape
	i0 = max(0, min(start[0], goal[0]) - margin)
	j0 = max(0, min(start[1], goal[1]) - margin)
	i1 = min(nx - 1, max(start[0], goal[0]) + margin)
	j1 = min(ny - 1, max(start[1], goal[1]) + margin)
	maxlen = (i1 - i0 + 1) * (j1 - j0 + 1)
	pi = np.zeros(maxlen, np.int32)
	pj = np.zeros(maxlen, np.int32)
	pen = None if penalty is None else _f32(penalty)
	n = lib().route(h, nx, ny, cell, int(start[0]), int(start[1]), int(goal[0]), int(goal[1]),
					float(np.tan(np.radians(gmax_deg))), wg, over, _ptr(pen), i0, j0, i1, j1, pi, pj, maxlen)
	return pi[:n].copy(), pj[:n].copy()


def route_turn(h, cell, start, goal, gmax_deg, wg=2.0, over=60.0, turn_w=2.0, penalty=None, margin=120):
	"""Like route() but with a turning penalty (long switchback legs). Returns (I, J) int arrays."""
	h = _f32(h)
	ny, nx = h.shape
	i0 = max(0, min(start[0], goal[0]) - margin)
	j0 = max(0, min(start[1], goal[1]) - margin)
	i1 = min(nx - 1, max(start[0], goal[0]) + margin)
	j1 = min(ny - 1, max(start[1], goal[1]) + margin)
	maxlen = (i1 - i0 + 1) * (j1 - j0 + 1)
	pi = np.zeros(maxlen, np.int32)
	pj = np.zeros(maxlen, np.int32)
	pen = None if penalty is None else _f32(penalty)
	n = lib().route_turn(h, nx, ny, cell, int(start[0]), int(start[1]), int(goal[0]), int(goal[1]),
						 float(np.tan(np.radians(gmax_deg))), wg, over, turn_w, _ptr(pen), i0, j0, i1, j1, pi, pj, maxlen)
	return pi[:n].copy(), pj[:n].copy()


def lic_fall(h, src, L=24):
	h = _f32(h)
	ny, nx = h.shape
	out = np.empty_like(h)
	lib().lic_fall(h, _f32(src), nx, ny, L, out)
	return out


def horizon_ao(h, cell, ndirs=12, maxdist=400.0, growth=1.25):
	h = _f32(h)
	ny, nx = h.shape
	out = np.empty_like(h)
	lib().horizon_ao(h, nx, ny, cell, ndirs, maxdist, growth, out)
	return out


def horizon_dir(h, cell, dirx, dirz, maxdist=3000.0, growth=1.08):
	h = _f32(h)
	ny, nx = h.shape
	out = np.empty_like(h)
	lib().horizon_dir(h, nx, ny, cell, dirx, dirz, maxdist, growth, out)
	return out
