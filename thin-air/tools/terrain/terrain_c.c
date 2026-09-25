/* THIN AIR — terrain simulation kernels (called from gen_terrain.py through ctypes).
 *
 * Build: gcc -O2 -march=x86-64-v2 -fPIC -shared -o _cache/libterrain.so terrain_c.c -lm
 * (gen_terrain.py compiles it automatically into tools/terrain/_cache/.)
 *
 * All grids are row-major float32, index = j*nx + i, x grows with i (east), z grows with j (south).
 * Heights are metres. Everything is deterministic for a given seed.
 *
 *  - noise_grid      gradient noise fBm / ridged multifractal / billow with optional domain warp
 *  - pf_order        priority-flood drainage ordering + receivers (Barnes 2014, epsilon variant)
 *  - spl_incise      implicit stream-power incision (Braun & Willett 2013), n = 1
 *  - thermal         talus-angle thermal erosion with per-cell erodibility
 *  - droplets        particle hydraulic erosion (Beyer 2015) with erosion brush + hardness
 *  - flow_mfd        multiple-flow-direction flow accumulation (Freeman 1991) on a filled DEM
 *  - horizon_ao      heightfield sky visibility (horizon-based ambient occlusion)
 */
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ hashing / rng */
static inline uint32_t hash3(int32_t x, int32_t y, uint32_t seed) {
	uint32_t h = (uint32_t)x * 0x8da6b343u ^ (uint32_t)y * 0xd8163841u ^ seed * 0xcb1ab31fu;
	h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
	return h;
}

static inline uint64_t splitmix(uint64_t *s) {
	uint64_t z = (*s += 0x9e3779b97f4a7c15ull);
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
	z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
	return z ^ (z >> 31);
}
static inline double rnd01(uint64_t *s) { return (splitmix(s) >> 11) * (1.0 / 9007199254740992.0); }

static inline float bilin_(const float *h, int nx, int ny, float x, float y) {
	if (x < 0) x = 0;
	if (y < 0) y = 0;
	if (x > nx - 1.001f) x = nx - 1.001f;
	if (y > ny - 1.001f) y = ny - 1.001f;
	int ix = (int)x, iy = (int)y;
	float u = x - ix, v = y - iy;
	const float *r = h + (size_t)iy * nx + ix;
	return (r[0] * (1 - u) + r[1] * u) * (1 - v) + (r[nx] * (1 - u) + r[nx + 1] * u) * v;
}

/* ------------------------------------------------------------------ gradient noise */
static const float GRAD[16][2] = {
	{1, 0}, {0.9239f, 0.3827f}, {0.7071f, 0.7071f}, {0.3827f, 0.9239f}, {0, 1}, {-0.3827f, 0.9239f},
	{-0.7071f, 0.7071f}, {-0.9239f, 0.3827f}, {-1, 0}, {-0.9239f, -0.3827f}, {-0.7071f, -0.7071f},
	{-0.3827f, -0.9239f}, {0, -1}, {0.3827f, -0.9239f}, {0.7071f, -0.7071f}, {0.9239f, -0.3827f}};

static inline float gnoise(double x, double y, uint32_t seed) {
	double fx = floor(x), fy = floor(y);
	int32_t ix = (int32_t)fx, iy = (int32_t)fy;
	float tx = (float)(x - fx), ty = (float)(y - fy);
	const float *g00 = GRAD[hash3(ix, iy, seed) & 15];
	const float *g10 = GRAD[hash3(ix + 1, iy, seed) & 15];
	const float *g01 = GRAD[hash3(ix, iy + 1, seed) & 15];
	const float *g11 = GRAD[hash3(ix + 1, iy + 1, seed) & 15];
	float n00 = g00[0] * tx + g00[1] * ty;
	float n10 = g10[0] * (tx - 1) + g10[1] * ty;
	float n01 = g01[0] * tx + g01[1] * (ty - 1);
	float n11 = g11[0] * (tx - 1) + g11[1] * (ty - 1);
	float ux = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
	float uy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
	float a = n00 + (n10 - n00) * ux, b = n01 + (n11 - n01) * ux;
	return (a + (b - a) * uy) * 1.4142f; /* ~[-1,1] */
}

/* gradient noise with analytic derivative (value, d/dx, d/dy in lattice units) */
static inline float gnoise_d(double x, double y, uint32_t seed, float *ddx, float *ddy) {
	double fx = floor(x), fy = floor(y);
	int32_t ix = (int32_t)fx, iy = (int32_t)fy;
	float tx = (float)(x - fx), ty = (float)(y - fy);
	const float *g00 = GRAD[hash3(ix, iy, seed) & 15];
	const float *g10 = GRAD[hash3(ix + 1, iy, seed) & 15];
	const float *g01 = GRAD[hash3(ix, iy + 1, seed) & 15];
	const float *g11 = GRAD[hash3(ix + 1, iy + 1, seed) & 15];
	float n00 = g00[0] * tx + g00[1] * ty;
	float n10 = g10[0] * (tx - 1) + g10[1] * ty;
	float n01 = g01[0] * tx + g01[1] * (ty - 1);
	float n11 = g11[0] * (tx - 1) + g11[1] * (ty - 1);
	float ux = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
	float uy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
	float dux = 30.0f * tx * tx * (tx - 1) * (tx - 1);
	float duy = 30.0f * ty * ty * (ty - 1) * (ty - 1);
	float a = n00 + (n10 - n00) * ux, b = n01 + (n11 - n01) * ux;
	float dadx = g00[0] + (g10[0] - g00[0]) * ux + (n10 - n00) * dux;
	float dbdx = g01[0] + (g11[0] - g01[0]) * ux + (n11 - n01) * dux;
	float dady = g00[1] + (g10[1] - g00[1]) * ux;
	float dbdy = g01[1] + (g11[1] - g01[1]) * ux;
	*ddx = (dadx + (dbdx - dadx) * uy) * 1.4142f;
	*ddy = (dady + (dbdy - dady) * uy + (b - a) * duy) * 1.4142f;
	return (a + (b - a) * uy) * 1.4142f;
}

/* Derivative-damped fBm ("eroded" noise, after I. Quilez): octaves are suppressed where the accumulated
 * slope is high, which gives sharp ridges, smooth valley floors and spur/gully structure. Output ~[-1, 1]. */
void noise_eroded(float *out, int nx, int ny, double x0, double z0, double dx, double freq, int octaves,
				  double gain, double damp, uint32_t seed, const float *warpx, const float *warpz) {
	for (int j = 0; j < ny; j++) {
		for (int i = 0; i < nx; i++) {
			size_t k = (size_t)j * nx + i;
			double x = x0 + i * dx, z = z0 + j * dx;
			if (warpx) x += warpx[k];
			if (warpz) z += warpz[k];
			double px = x * freq, pz = z * freq;
			double sum = 0, amp = 1, norm = 0, adx = 0, adz = 0;
			for (int o = 0; o < octaves; o++) {
				float ddx, ddz;
				float n = gnoise_d(px + o * 17.31, pz - o * 9.77, seed + (uint32_t)o * 7919u, &ddx, &ddz);
				adx += ddx * amp;
				adz += ddz * amp;
				sum += amp * n / (1.0 + damp * (adx * adx + adz * adz));
				norm += amp;
				amp *= gain;
				/* rotate + scale by ~2 (IQ's m = [0.8 -0.6; 0.6 0.8] * 2) */
				double nx2 = 1.6 * px - 1.2 * pz, nz2 = 1.2 * px + 1.6 * pz;
				px = nx2; pz = nz2;
			}
			out[k] = (float)(sum / norm * 1.6);
		}
	}
}

/* kind: 0 fBm, 1 ridged multifractal (Musgrave), 2 billow (|n|), 3 swiss-ish (ridged w/o weight) */
void noise_grid(float *out, int nx, int ny, double x0, double z0, double dx, double freq, int octaves,
				double lacunarity, double gain, uint32_t seed, int kind, const float *warpx, const float *warpz,
				double rotate) {
	double cr = cos(rotate), sr = sin(rotate);
	for (int j = 0; j < ny; j++) {
		for (int i = 0; i < nx; i++) {
			size_t k = (size_t)j * nx + i;
			double x = x0 + i * dx, z = z0 + j * dx;
			if (warpx) x += warpx[k];
			if (warpz) z += warpz[k];
			double rx = x * cr - z * sr, rz = x * sr + z * cr;
			double f = freq, amp = 1.0, sum = 0.0, norm = 0.0, weight = 1.0;
			for (int o = 0; o < octaves; o++) {
				/* per-octave rotation + offset breaks lattice alignment */
				double a = 0.5 + o * 1.7;
				double ox = rx * cos(a) - rz * sin(a) + o * 37.13, oz = rx * sin(a) + rz * cos(a) - o * 11.71;
				float n = gnoise(ox * f, oz * f, seed + (uint32_t)o * 1013u);
				if (kind == 0) {
					sum += n * amp;
				} else if (kind == 1) {
					double s = 1.0 - fabs(n);
					s *= s;
					s *= weight;
					weight = s * 2.0;
					if (weight > 1.0) weight = 1.0;
					if (weight < 0.0) weight = 0.0;
					sum += s * amp;
				} else if (kind == 2) {
					sum += (fabs(n) * 2.0 - 1.0) * amp;
				} else {
					double s = 1.0 - fabs(n);
					sum += (s * s * 2.0 - 1.0) * amp;
				}
				norm += amp;
				amp *= gain;
				f *= lacunarity;
			}
			out[k] = (float)(sum / norm);
		}
	}
}

/* "Erosion noise" (after Clay John's eroded-terrain shader / R. S. Johansen's erosion filter): per octave, a
 * Gaussian-weighted sum of cosine stripes centred on jittered lattice points, oriented so the stripes run down
 * the local fall line. Each octave bends its stripes along the gradient accumulated so far, so small gullies
 * branch off larger ones (dendritic look) without any flow simulation or grid bias.
 *   gx, gz: base terrain gradient (dh/dx, dh/dz, m/m); slope_fade: gradients below this get no gullies.
 *   freq: 1/metres of the first octave; out: height offset in [-~1, ~1] (sum of octaves, amplitudes gain^o);
 *   dout_x/z (optional): its derivative (per metre) for chaining. */
static inline void hash2(int32_t x, int32_t y, uint32_t seed, float *hx, float *hy) {
	uint32_t a = hash3(x, y, seed), b = hash3(x, y, seed ^ 0x9e3779b9u);
	*hx = (a & 0xFFFFFF) / 16777216.0f;
	*hy = (b & 0xFFFFFF) / 16777216.0f;
}

void erosion_noise(const float *gx, const float *gz, int nx, int ny, double x0, double z0, double dx, double freq,
				   int octaves, double gain, double lacunarity, double bend, double slope_fade, uint32_t seed,
				   float *out, float *dout_x, float *dout_z) {
	const float TAU = 6.2831853f;
	for (int j = 0; j < ny; j++) {
		for (int i = 0; i < nx; i++) {
			size_t k = (size_t)j * nx + i;
			double X = x0 + i * dx, Z = z0 + j * dx;
			float ggx = gx[k], ggz = gz[k];
			float gl = sqrtf(ggx * ggx + ggz * ggz);
			float fade = gl / (gl + (float)slope_fade);
			/* stripes run along the gradient: their phase varies across it (perpendicular direction) */
			float dirx = 0, dirz = 0;
			if (gl > 1e-6f) { dirx = -ggz / gl; dirz = ggx / gl; }
			float hsum = 0, dsx = 0, dsz = 0;   /* accumulated value + derivative (per lattice unit of octave 0) */
			double f = freq;
			float a = 1.0f;
			for (int o = 0; o < octaves; o++) {
				/* bend: add the accumulated slope of the gullies so far (rotated 90 deg like dir) */
				float bx = dirx + (float)bend * (-dsz), bz = dirz + (float)bend * dsx;
				float bl = sqrtf(bx * bx + bz * bz);
				if (bl > 1e-6f) { bx /= bl; bz /= bl; }
				double px = X * f + o * 31.7, pz = Z * f - o * 17.3;
				double fpx = floor(px), fpz = floor(pz);
				int32_t ipx = (int32_t)fpx, ipz = (int32_t)fpz;
				float fx = (float)(px - fpx), fz = (float)(pz - fpz);
				float va = 0, vdx = 0, vdz = 0, wt = 0;
				for (int b2 = -2; b2 <= 1; b2++) {
					for (int a2 = -2; a2 <= 1; a2++) {
						float hx, hy;
						hash2(ipx - a2, ipz - b2, seed + (uint32_t)o * 7717u, &hx, &hy);
						float ppx = fx + a2 - hx * 0.5f, ppz = fz + b2 - hy * 0.5f;
						float d = ppx * ppx + ppz * ppz;
						float w = expf(-d * 2.0f);
						float mag = ppx * bx + ppz * bz;
						float c = cosf(mag * TAU), sn = sinf(mag * TAU);
						va += c * w;
						vdx += -sn * bx * w;
						vdz += -sn * bz * w;
						wt += w;
					}
				}
				va /= wt; vdx /= wt; vdz /= wt;
				hsum += va * a;
				/* derivative in octave-0 lattice units: chain rule factor f/freq */
				float sc = (float)(f / freq);
				dsx += vdx * a * sc;
				dsz += vdz * a * sc;
				a *= (float)gain;
				f *= lacunarity;
			}
			out[k] = hsum * fade;
			if (dout_x) dout_x[k] = dsx * fade * (float)freq * TAU;
			if (dout_z) dout_z[k] = dsz * fade * (float)freq * TAU;
		}
	}
}

/* ------------------------------------------------------------------ binary heap */
typedef struct { float k; int32_t i; } HItem;
typedef struct { HItem *a; int n, cap; } Heap;

static void hpush(Heap *h, float k, int32_t i) {
	if (h->n == h->cap) {
		h->cap = h->cap ? h->cap * 2 : 1024;
		h->a = (HItem *)realloc(h->a, sizeof(HItem) * h->cap);
	}
	int c = h->n++;
	while (c > 0) {
		int p = (c - 1) >> 1;
		if (h->a[p].k <= k) break;
		h->a[c] = h->a[p];
		c = p;
	}
	h->a[c].k = k; h->a[c].i = i;
}
static HItem hpop(Heap *h) {
	HItem top = h->a[0];
	HItem last = h->a[--h->n];
	int c = 0;
	for (;;) {
		int l = 2 * c + 1;
		if (l >= h->n) break;
		int r = l + 1, m = (r < h->n && h->a[r].k < h->a[l].k) ? r : l;
		if (h->a[m].k >= last.k) break;
		h->a[c] = h->a[m];
		c = m;
	}
	if (h->n > 0) h->a[c] = last;
	return top;
}

static const int DI[8] = {1, -1, 0, 0, 1, 1, -1, -1};
static const int DJ[8] = {0, 0, 1, -1, 1, -1, 1, -1};
static const float DL[8] = {1, 1, 1, 1, 1.41421356f, 1.41421356f, 1.41421356f, 1.41421356f};

/* Priority flood from outlets (grid border + outlet mask). Produces:
 *  order[N]: cells in processing order (outlets first, i.e. downstream -> upstream)
 *  rcv[N]:   receiver (the neighbour that flooded the cell; itself for outlets)
 *  filled[N] (optional): depression-filled heights with a tiny epsilon gradient.  Returns N. */
int pf_order(const float *h, int nx, int ny, const uint8_t *outlet, int border_outlets, int32_t *rcv,
			 int32_t *order, float *filled) {
	int N = nx * ny;
	uint8_t *seen = (uint8_t *)calloc(N, 1);
	float *f = filled ? filled : (float *)malloc(sizeof(float) * N);
	Heap hp = {0};
	for (int k = 0; k < N; k++) {
		int i = k % nx, j = k / nx;
		int b = border_outlets && (i == 0 || j == 0 || i == nx - 1 || j == ny - 1);
		if (b || (outlet && outlet[k])) {
			seen[k] = 1; f[k] = h[k]; rcv[k] = k;
			hpush(&hp, h[k], k);
		}
	}
	int cnt = 0;
	while (hp.n > 0) {
		HItem it = hpop(&hp);
		int c = it.i;
		order[cnt++] = c;
		int ci = c % nx, cj = c / nx;
		for (int d = 0; d < 8; d++) {
			int ni = ci + DI[d], nj = cj + DJ[d];
			if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
			int n = nj * nx + ni;
			if (seen[n]) continue;
			seen[n] = 1;
			float v = h[n];
			float lim = f[c] + 1e-4f * DL[d];
			f[n] = v > lim ? v : lim;
			rcv[n] = c;
			hpush(&hp, f[n], n);
		}
	}
	/* unreachable cells (no outlet at all) become their own outlets */
	for (int k = 0; k < N; k++)
		if (!seen[k]) { rcv[k] = k; f[k] = h[k]; order[cnt++] = k; }
	free(hp.a);
	free(seen);
	if (!filled) free(f);
	return cnt;
}

/* Implicit stream-power incision, E = K * A^m * S. `fixed` cells never change (and act as outlets).
 * K_map (optional) multiplies K per cell (rock hardness). uplift (optional) m/yr-like units per dt.
 * After each step a thermal pass limits slopes to talus_tan (0 = off). */
void thermal(float *h, int nx, int ny, float cell, float talus_tan, int iters, float rate, const float *erod,
			 const uint8_t *fixed);

void spl_incise(float *h, int nx, int ny, float dx, const uint8_t *fixed, const float *K_map, float K, float m,
				float dt, int iters, const float *uplift, float talus_tan, float *area_out) {
	int N = nx * ny;
	int32_t *rcv = (int32_t *)malloc(sizeof(int32_t) * N);
	int32_t *order = (int32_t *)malloc(sizeof(int32_t) * N);
	float *A = (float *)malloc(sizeof(float) * N);
	for (int it = 0; it < iters; it++) {
		pf_order(h, nx, ny, fixed, 1, rcv, order, NULL);
		for (int k = 0; k < N; k++) A[k] = dx * dx;
		for (int k = N - 1; k >= 0; k--) {
			int c = order[k], r = rcv[c];
			if (r != c) A[r] += A[c];
		}
		for (int k = 0; k < N; k++) {
			int c = order[k];
			if (fixed && fixed[c]) continue;
			if (uplift) h[c] += uplift[c] * dt;
			int r = rcv[c];
			if (r == c) continue;
			if (h[c] <= h[r]) continue;
			int di = abs(c % nx - r % nx), dj = abs(c / nx - r / nx);
			float dist = dx * ((di && dj) ? 1.41421356f : 1.0f);
			float kk = K * (K_map ? K_map[c] : 1.0f);
			float F = kk * dt * powf(A[c], m) / dist;
			h[c] = (h[c] + F * h[r]) / (1.0f + F);
		}
		if (talus_tan > 0) thermal(h, nx, ny, dx, talus_tan, 2, 0.5f, NULL, fixed);
	}
	if (area_out) memcpy(area_out, A, sizeof(float) * N);
	free(rcv); free(order); free(A);
}

/* Steady-state stream-power landscape (dt -> infinity): every non-fixed cell sits above its receiver by
 * dist * min(ks * A^-m, tmax). The drainage tree is re-derived from the current surface each iteration and the
 * update is damped, so the network self-organises from the initial surface (the designed landform).
 * ks (steepness index) is a per-cell map; fixed cells (valley floors, domain border) are outlets. */
void spl_steady(float *h, int nx, int ny, float dx, const uint8_t *fixed, const float *ks, float m, float tmax_default,
				const float *tmax_map, int iters, float damping, float *area_out) {
	int N = nx * ny;
	int32_t *rcv = (int32_t *)malloc(sizeof(int32_t) * N);
	int32_t *order = (int32_t *)malloc(sizeof(int32_t) * N);
	float *A = (float *)malloc(sizeof(float) * N);
	float *hn = (float *)malloc(sizeof(float) * N);
	for (int it = 0; it < iters; it++) {
		pf_order(h, nx, ny, fixed, 1, rcv, order, NULL);
		for (int k = 0; k < N; k++) A[k] = dx * dx;
		for (int k = N - 1; k >= 0; k--) {
			int c = order[k], r = rcv[c];
			if (r != c) A[r] += A[c];
		}
		for (int k = 0; k < N; k++) {
			int c = order[k], r = rcv[c];
			if (r == c || (fixed && fixed[c])) { hn[c] = h[c]; continue; }
			int di = abs(c % nx - r % nx), dj = abs(c / nx - r / nx);
			float dist = dx * ((di && dj) ? 1.41421356f : 1.0f);
			float s = ks[c] * powf(A[c], -m);
			float tm = tmax_map ? tmax_map[c] : tmax_default;
			if (s > tm) s = tm;
			hn[c] = hn[r] + s * dist;
		}
		for (int k = 0; k < N; k++)
			if (!(fixed && fixed[k])) h[k] = damping * h[k] + (1.0f - damping) * hn[k];
	}
	if (area_out) memcpy(area_out, A, sizeof(float) * N);
	free(rcv); free(order); free(A); free(hn);
}

/* Steady-state stream power with stochastic receivers: each iteration re-derives the drainage tree on the
 * depression-filled surface, picking every cell's receiver at random among its lower neighbours with probability
 * ~ slope^rexp (instead of the flooding neighbour / steepest D8 neighbour, which aligns channels with the grid).
 * The damped iteration averages many such trees, so valleys meander naturally and branch dendritically. */
void spl_steady_rand(float *h, int nx, int ny, float dx, const uint8_t *fixed, const float *ks, float m,
					 float tmax_default, const float *tmax_map, int iters, float damping, float rexp, uint64_t seed,
					 float *area_out) {
	int N = nx * ny;
	int32_t *rcv = (int32_t *)malloc(sizeof(int32_t) * N);
	int32_t *order = (int32_t *)malloc(sizeof(int32_t) * N);
	float *A = (float *)malloc(sizeof(float) * N);
	float *hn = (float *)malloc(sizeof(float) * N);
	float *f = (float *)malloc(sizeof(float) * N);
	uint64_t s = seed;
	for (int it = 0; it < iters; it++) {
		int cnt = pf_order(h, nx, ny, fixed, 1, rcv, order, f);
		for (int k = 0; k < cnt; k++) {
			int c = order[k];
			if (rcv[c] == c) continue;
			int ci = c % nx, cj = c / nx;
			float w[8], ws = 0;
			for (int d = 0; d < 8; d++) {
				int ni = ci + DI[d], nj = cj + DJ[d];
				w[d] = 0;
				if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
				float dz = f[c] - f[nj * nx + ni];
				if (dz <= 0) continue;
				w[d] = powf(dz / (dx * DL[d]), rexp);
				ws += w[d];
			}
			if (ws <= 0) continue;
			float r = (float)rnd01(&s) * ws;
			for (int d = 0; d < 8; d++) {
				if (w[d] <= 0) continue;
				r -= w[d];
				if (r <= 0) { rcv[c] = (cj + DJ[d]) * nx + ci + DI[d]; break; }
			}
		}
		for (int k = 0; k < N; k++) A[k] = dx * dx;
		for (int k = cnt - 1; k >= 0; k--) {
			int c = order[k], r = rcv[c];
			if (r != c) A[r] += A[c];
		}
		for (int k = 0; k < cnt; k++) {
			int c = order[k], r = rcv[c];
			if (r == c || (fixed && fixed[c])) { hn[c] = h[c]; continue; }
			int di = abs(c % nx - r % nx), dj = abs(c / nx - r / nx);
			float dist = dx * ((di && dj) ? 1.41421356f : 1.0f);
			float sl = ks[c] * powf(A[c], -m);
			float tm = tmax_map ? tmax_map[c] : tmax_default;
			if (sl > tm) sl = tm;
			hn[c] = hn[r] + sl * dist;
		}
		for (int k = 0; k < N; k++)
			if (!(fixed && fixed[k])) h[k] = damping * h[k] + (1.0f - damping) * hn[k];
	}
	if (area_out) memcpy(area_out, A, sizeof(float) * N);
	free(rcv); free(order); free(A); free(hn); free(f);
}

/* Thermal erosion: material above the talus slope slides to the steepest lower neighbour.
 * erod (optional) 0..1 scales how much a cell gives (hard rock ~0.1, loose ~1). */
void thermal(float *h, int nx, int ny, float cell, float talus_tan, int iters, float rate, const float *erod,
			 const uint8_t *fixed) {
	for (int it = 0; it < iters; it++) {
		int rev = it & 1;
		for (int jj = 1; jj < ny - 1; jj++) {
			int j = rev ? ny - 1 - jj : jj;
			for (int ii = 1; ii < nx - 1; ii++) {
				int i = rev ? nx - 1 - ii : ii;
				int c = j * nx + i;
				if (fixed && fixed[c]) continue;
				float best = 0; int bn = -1;
				for (int d = 0; d < 8; d++) {
					int n = (j + DJ[d]) * nx + (i + DI[d]);
					float ex = h[c] - h[n] - talus_tan * cell * DL[d];
					if (ex > best) { best = ex; bn = n; }
				}
				if (bn < 0) continue;
				if (fixed && fixed[bn]) continue;
				float mv = best * 0.5f * rate * (erod ? erod[c] : 1.0f);
				h[c] -= mv;
				h[bn] += mv;
			}
		}
	}
}

/* ------------------------------------------------------------------ droplet erosion */
typedef struct {
	float inertia, capacity, min_capacity, deposit, erode, evaporate, gravity;
	int max_steps, radius;
	float init_water, init_speed, max_erode_step;
} DropParams;

static inline void height_grad(const float *h, int nx, float px, float py, float *hh, float *gx, float *gy) {
	int ix = (int)px, iy = (int)py;
	float u = px - ix, v = py - iy;
	int k = iy * nx + ix;
	float h00 = h[k], h10 = h[k + 1], h01 = h[k + nx], h11 = h[k + nx + 1];
	*gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
	*gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;
	*hh = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
}

/* Heights are divided by `hscale` internally (so parameters are resolution independent-ish).
 * hardness (optional, 0..1): erosion multiplier (1 = soft). ero/dep/flow accumulators optional. */
void droplets(float *h, int nx, int ny, float hscale, int count, uint64_t seed, const DropParams *p,
			  const float *hardness, const uint8_t *nodrop, float *ero_acc, float *dep_acc, float *flow_acc) {
	int N = nx * ny;
	for (int k = 0; k < N; k++) h[k] /= hscale;
	int R = p->radius;
	int bsz = (2 * R + 1) * (2 * R + 1);
	int *boff_i = (int *)malloc(sizeof(int) * bsz), *boff_j = (int *)malloc(sizeof(int) * bsz);
	float *bw = (float *)malloc(sizeof(float) * bsz);
	int bn = 0;
	float wsum = 0;
	for (int dj = -R; dj <= R; dj++)
		for (int di = -R; di <= R; di++) {
			float d = sqrtf((float)(di * di + dj * dj));
			if (d <= R) {
				boff_i[bn] = di; boff_j[bn] = dj; bw[bn] = 1.0f - d / (R + 0.5f); wsum += bw[bn]; bn++;
			}
		}
	for (int b = 0; b < bn; b++) bw[b] /= wsum;
	uint64_t s = seed;
	for (int n = 0; n < count; n++) {
		float px = 1 + (float)rnd01(&s) * (nx - 3), py = 1 + (float)rnd01(&s) * (ny - 3);
		if (nodrop && nodrop[(int)py * nx + (int)px]) continue;
		float dx = 0, dy = 0, speed = p->init_speed, water = p->init_water, sed = 0;
		for (int st = 0; st < p->max_steps; st++) {
			int ix = (int)px, iy = (int)py;
			int cell = iy * nx + ix;
			float u = px - ix, v = py - iy;
			float hh, gx, gy;
			height_grad(h, nx, px, py, &hh, &gx, &gy);
			dx = dx * p->inertia - gx * (1 - p->inertia);
			dy = dy * p->inertia - gy * (1 - p->inertia);
			float len = sqrtf(dx * dx + dy * dy);
			if (len < 1e-8f) break;
			dx /= len; dy /= len;
			px += dx; py += dy;
			if (px < 1 || py < 1 || px >= nx - 2 || py >= ny - 2) break;
			if (flow_acc) flow_acc[cell] += water;
			float nh, ngx, ngy;
			height_grad(h, nx, px, py, &nh, &ngx, &ngy);
			float dh = nh - hh;
			float cap = fmaxf(-dh * speed * water * p->capacity, p->min_capacity);
			if (sed > cap || dh > 0) {
				float amt = dh > 0 ? fminf(dh, sed) : (sed - cap) * p->deposit;
				sed -= amt;
				h[cell] += amt * (1 - u) * (1 - v);
				h[cell + 1] += amt * u * (1 - v);
				h[cell + nx] += amt * (1 - u) * v;
				h[cell + nx + 1] += amt * u * v;
				if (dep_acc) dep_acc[cell] += amt * hscale;
			} else {
				float hard = hardness ? hardness[cell] : 1.0f;
				float amt = fminf((cap - sed) * p->erode * hard, -dh);
				if (amt > p->max_erode_step) amt = p->max_erode_step;
				for (int b = 0; b < bn; b++) {
					int bi = ix + boff_i[b], bj = iy + boff_j[b];
					if (bi < 0 || bj < 0 || bi >= nx || bj >= ny) continue;
					int bc = bj * nx + bi;
					float w = amt * bw[b];
					float take = h[bc] < w ? h[bc] : w;
					h[bc] -= take;
					sed += take;
					if (ero_acc) ero_acc[bc] += take * hscale;
				}
			}
			float sp2 = speed * speed + dh * p->gravity;
			speed = sp2 > 0 ? sqrtf(sp2) : 0;
			water *= (1 - p->evaporate);
		}
	}
	for (int k = 0; k < N; k++) h[k] *= hscale;
	free(boff_i); free(boff_j); free(bw);
}

/* ------------------------------------------------------------------ MFD flow accumulation */
void flow_mfd(const float *h, int nx, int ny, float cell, float pexp, float *acc) {
	int N = nx * ny;
	int32_t *rcv = (int32_t *)malloc(sizeof(int32_t) * N);
	int32_t *order = (int32_t *)malloc(sizeof(int32_t) * N);
	float *f = (float *)malloc(sizeof(float) * N);
	pf_order(h, nx, ny, NULL, 1, rcv, order, f);
	for (int k = 0; k < N; k++) acc[k] = 1.0f;
	for (int k = N - 1; k >= 0; k--) {
		int c = order[k];
		int ci = c % nx, cj = c / nx;
		float w[8], ws = 0;
		for (int d = 0; d < 8; d++) {
			int ni = ci + DI[d], nj = cj + DJ[d];
			w[d] = 0;
			if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
			float dz = f[c] - f[nj * nx + ni];
			if (dz <= 0) continue;
			float sl = dz / (cell * DL[d]);
			w[d] = powf(sl, pexp) * (d < 4 ? 0.5f : 0.354f);
			ws += w[d];
		}
		if (ws <= 0) continue;
		for (int d = 0; d < 8; d++)
			if (w[d] > 0) acc[(cj + DJ[d]) * nx + ci + DI[d]] += acc[c] * w[d] / ws;
	}
	free(rcv); free(order); free(f);
}

/* ------------------------------------------------------------------ fall-line LIC (couloirs) */
static inline void grad_at(const float *h, int nx, int ny, float x, float y, float *gx, float *gy) {
	if (x < 1) x = 1;
	if (y < 1) y = 1;
	if (x > nx - 2.001f) x = nx - 2.001f;
	if (y > ny - 2.001f) y = ny - 2.001f;
	*gx = 0.5f * (bilin_(h, nx, ny, x + 1, y) - bilin_(h, nx, ny, x - 1, y));
	*gy = 0.5f * (bilin_(h, nx, ny, x, y + 1) - bilin_(h, nx, ny, x, y - 1));
}

/* Line integral convolution of `src` along the fall line of `h` (L steps down and L up, 1 cell each).
 * Produces streaks that follow the slope: the texture of couloirs, gullies and rock ribs on steep faces. */
void lic_fall(const float *h, const float *src, int nx, int ny, int L, float *out) {
	for (int j = 0; j < ny; j++) {
		for (int i = 0; i < nx; i++) {
			float acc = 0, wsum = 0;
			for (int dir = -1; dir <= 1; dir += 2) {
				float x = (float)i, y = (float)j;
				for (int s = 0; s <= L; s++) {
					if (dir == 1 && s == 0) continue;
					float w = 0.5f + 0.5f * cosf(3.14159265f * s / (L + 1));
					acc += w * bilin_(src, nx, ny, x, y);
					wsum += w;
					float gx, gy;
					grad_at(h, nx, ny, x, y, &gx, &gy);
					float g = sqrtf(gx * gx + gy * gy);
					if (g < 1e-6f) break;
					x += dir * gx / g;
					y += dir * gy / g;
					if (x < 0 || y < 0 || x > nx - 1 || y > ny - 1) break;
				}
			}
			out[(size_t)j * nx + i] = acc / (wsum > 0 ? wsum : 1);
		}
	}
}

/* ------------------------------------------------------------------ horizon AO */
static inline float bilin(const float *h, int nx, int ny, float x, float y) {
	if (x < 0) x = 0;
	if (y < 0) y = 0;
	if (x > nx - 1.001f) x = nx - 1.001f;
	if (y > ny - 1.001f) y = ny - 1.001f;
	int ix = (int)x, iy = (int)y;
	float u = x - ix, v = y - iy;
	const float *r = h + (size_t)iy * nx + ix;
	return (r[0] * (1 - u) + r[1] * u) * (1 - v) + (r[nx] * (1 - u) + r[nx + 1] * u) * v;
}

/* Sky visibility (cosine weighted, per-direction horizon): out = mean_d 1/(1+tan^2(horizon)) for
 * horizons above the horizontal. Steps grow geometrically from one cell to maxdist. */
void horizon_ao(const float *h, int nx, int ny, float cell, int ndirs, float maxdist, float growth, float *out) {
	for (int j = 0; j < ny; j++) {
		for (int i = 0; i < nx; i++) {
			float h0 = h[(size_t)j * nx + i] + 0.3f;
			float vis = 0;
			for (int d = 0; d < ndirs; d++) {
				float a = (d + 0.5f) * 6.2831853f / ndirs;
				float cx = cosf(a), cy = sinf(a);
				float t = 1.0f, mt = 0;
				while (t * cell < maxdist) {
					float hs = bilin(h, nx, ny, i + cx * t, j + cy * t);
					float tn = (hs - h0) / (t * cell);
					if (tn > mt) mt = tn;
					t = t * growth + 0.5f;
				}
				vis += 1.0f / (1.0f + mt * mt);
			}
			out[(size_t)j * nx + i] = vis / ndirs;
		}
	}
}

/* ------------------------------------------------------------------ trail router */
/* Least-cost path on a heightfield, 16-connected (knight moves give smooth switchbacks).
 * Step cost = length * (1 + wg*(grade/gmax)^2 + penalty) ; grades above gmax cost `over` extra per unit.
 * penalty (optional) per cell (water, glacier, cliffs...). Search limited to the rectangle [i0,i1]x[j0,j1].
 * Returns path length (cells written to path_i/path_j from start to goal), 0 if not found. */
static const int RI[16] = {1, -1, 0, 0, 1, 1, -1, -1, 2, 2, -2, -2, 1, 1, -1, -1};
static const int RJ[16] = {0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 2, -2, 2, -2};

int route(const float *h, int nx, int ny, float cell, int si, int sj, int ti, int tj, float gmax, float wg, float over,
		  const float *penalty, int i0, int j0, int i1, int j1, int32_t *path_i, int32_t *path_j, int maxlen) {
	int W = i1 - i0 + 1, Hh = j1 - j0 + 1, M = W * Hh;
	float *dist = (float *)malloc(sizeof(float) * M);
	int32_t *prev = (int32_t *)malloc(sizeof(int32_t) * M);
	uint8_t *done = (uint8_t *)calloc(M, 1);
	for (int k = 0; k < M; k++) { dist[k] = 3.0e38f; prev[k] = -1; }
	Heap hp = {0};
	int s = (sj - j0) * W + (si - i0), t = (tj - j0) * W + (ti - i0);
	dist[s] = 0;
	hpush(&hp, 0, s);
	while (hp.n > 0) {
		HItem it = hpop(&hp);
		int c = it.i;
		if (done[c]) continue;
		done[c] = 1;
		if (c == t) break;
		int ci = c % W + i0, cj = c / W + j0;
		float hc = h[(size_t)cj * nx + ci];
		for (int d = 0; d < 16; d++) {
			int ni = ci + RI[d], nj = cj + RJ[d];
			if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue;
			int n = (nj - j0) * W + (ni - i0);
			if (done[n]) continue;
			float L = cell * sqrtf((float)(RI[d] * RI[d] + RJ[d] * RJ[d]));
			float hn = h[(size_t)nj * nx + ni];
			/* for knight moves also check the midpoint so steep steps can't be skipped */
			float g = fabsf(hn - hc) / L;
			float q = g / gmax;
			float cst = L * (1.0f + wg * q * q + (penalty ? penalty[(size_t)nj * nx + ni] : 0.0f));
			if (g > gmax) cst += L * over * (g - gmax) / gmax;
			float nd = dist[c] + cst;
			if (nd < dist[n]) { dist[n] = nd; prev[n] = c; hpush(&hp, nd, n); }
		}
	}
	int len = 0;
	if (prev[t] >= 0 || s == t) {
		int c = t;
		while (c >= 0 && len < maxlen) {
			path_i[len] = c % W + i0; path_j[len] = c / W + j0; len++;
			if (c == s) break;
			c = prev[c];
		}
		/* reverse to start -> goal */
		for (int a = 0, b = len - 1; a < b; a++, b--) {
			int32_t ti2 = path_i[a]; path_i[a] = path_i[b]; path_i[b] = ti2;
			int32_t tj2 = path_j[a]; path_j[a] = path_j[b]; path_j[b] = tj2;
		}
	}
	free(hp.a); free(dist); free(prev); free(done);
	return len;
}

/* Least-cost path with a turning penalty (state = cell x incoming direction), so grade-limited paths make
 * proper switchbacks with long legs and few hairpins instead of metre-scale zig-zags. Same cost model as route()
 * plus L * turn_w * (1 - cos(turn angle)). */
int route_turn(const float *h, int nx, int ny, float cell, int si, int sj, int ti, int tj, float gmax, float wg,
			   float over, float turn_w, const float *penalty, int i0, int j0, int i1, int j1, int32_t *path_i,
			   int32_t *path_j, int maxlen) {
	int W = i1 - i0 + 1, Hh = j1 - j0 + 1, M = W * Hh, S = M * 17;   /* dir 16 = start (no heading) */
	float *dist = (float *)malloc(sizeof(float) * S);
	int32_t *prev = (int32_t *)malloc(sizeof(int32_t) * S);
	uint8_t *done = (uint8_t *)calloc(S, 1);
	float dcx[16], dcy[16];
	for (int d = 0; d < 16; d++) {
		float l = sqrtf((float)(RI[d] * RI[d] + RJ[d] * RJ[d]));
		dcx[d] = RI[d] / l; dcy[d] = RJ[d] / l;
	}
	for (int k = 0; k < S; k++) { dist[k] = 3.0e38f; prev[k] = -1; }
	Heap hp = {0};
	int s = ((sj - j0) * W + (si - i0)) * 17 + 16, tcell = (tj - j0) * W + (ti - i0);
	dist[s] = 0;
	hpush(&hp, 0, s);
	int goal = -1;
	while (hp.n > 0) {
		HItem it = hpop(&hp);
		int st = it.i;
		if (done[st]) continue;
		done[st] = 1;
		int c = st / 17, din = st % 17;
		if (c == tcell) { goal = st; break; }
		int ci = c % W + i0, cj = c / W + j0;
		float hc = h[(size_t)cj * nx + ci];
		for (int d = 0; d < 16; d++) {
			int ni = ci + RI[d], nj = cj + RJ[d];
			if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue;
			int n = (nj - j0) * W + (ni - i0);
			int ns = n * 17 + d;
			if (done[ns]) continue;
			float L = cell * sqrtf((float)(RI[d] * RI[d] + RJ[d] * RJ[d]));
			float hn = h[(size_t)nj * nx + ni];
			float g = fabsf(hn - hc) / L;
			float q = g / gmax;
			float cst = L * (1.0f + wg * q * q + (penalty ? penalty[(size_t)nj * nx + ni] : 0.0f));
			if (g > gmax) cst += L * over * (g - gmax) / gmax;
			if (din < 16) {
				float cosang = dcx[din] * dcx[d] + dcy[din] * dcy[d];
				cst += L * turn_w * (1.0f - cosang);
			}
			float nd = dist[st] + cst;
			if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = st; hpush(&hp, nd, ns); }
		}
	}
	int len = 0;
	if (goal >= 0) {
		int st = goal;
		while (st >= 0 && len < maxlen) {
			int c = st / 17;
			path_i[len] = c % W + i0; path_j[len] = c / W + j0; len++;
			if (st == s) break;
			st = prev[st];
		}
		for (int a = 0, b = len - 1; a < b; a++, b--) {
			int32_t t1 = path_i[a]; path_i[a] = path_i[b]; path_i[b] = t1;
			int32_t t2 = path_j[a]; path_j[a] = path_j[b]; path_j[b] = t2;
		}
	}
	free(hp.a); free(dist); free(prev); free(done);
	return len;
}

/* ------------------------------------------------------------------ preview ray tracer */
/* Perspective render of a heightfield (world x = x0 + i*dx, z = x0 + j*dx) for generator QA.
 * cam: x,y,z,yaw,pitch(deg; yaw 0 looks -z/north, 90 looks -x/west), fov_deg (vertical). sun: unit vec to sun.
 * masks (optional, 4 floats/cell: snow, rock, grass, forest) override the built-in material rules.
 * out: W*H*3 floats (linear). */
void render_persp(const float *h, int n, float x0, float dx, const float *masks, const float *cam, float fov_deg,
				  const float *sun, int W, int H, float fog_density, float *out) {
	float cy = cosf(cam[3] * 0.0174533f), sy = sinf(cam[3] * 0.0174533f);
	float cp = cosf(cam[4] * 0.0174533f), sp = sinf(cam[4] * 0.0174533f);
	float fw = cp * -sy, fu = sp, fz = cp * -cy;           /* forward */
	float rx = cy, rz = -sy;                              /* right (horizontal) */
	float ux = -sp * -sy, uy = cp, uz = -sp * -cy;          /* up */
	float th = tanf(fov_deg * 0.5f * 0.0174533f);
	float ext = (n - 1) * dx;
	for (int py = 0; py < H; py++) {
		for (int px = 0; px < W; px++) {
			float sxn = (2.0f * (px + 0.5f) / W - 1.0f) * th * W / H;
			float syn = (1.0f - 2.0f * (py + 0.5f) / H) * th;
			float dxr = fw + rx * sxn + ux * syn, dyr = fu + uy * syn, dzr = fz + rz * sxn + uz * syn;
			float dl = sqrtf(dxr * dxr + dyr * dyr + dzr * dzr);
			dxr /= dl; dyr /= dl; dzr /= dl;
			float t = 0.5f, hit = -1, prev_t = 0;
			float ox = cam[0], oy = cam[1], oz = cam[2];
			while (t < 60000.0f) {
				float x = ox + dxr * t, y = oy + dyr * t, z = oz + dzr * t;
				float gi = (x - x0) / dx, gj = (z - x0) / dx;
				if (gi < 0 || gj < 0 || gi > n - 1 || gj > n - 1) {
					/* outside the grid: only continue if we can come back in */
					if ((x < x0 && dxr <= 0) || (x > x0 + ext && dxr >= 0) || (z < x0 && dzr <= 0) || (z > x0 + ext && dzr >= 0)) break;
				} else {
					float hh = bilin_(h, n, n, gi, gj);
					if (y < hh) {
						float a = prev_t, b = t;
						for (int it = 0; it < 12; it++) {
							float m = 0.5f * (a + b);
							float mx = ox + dxr * m, my = oy + dyr * m, mz = oz + dzr * m;
							if (my < bilin_(h, n, n, (mx - x0) / dx, (mz - x0) / dx)) b = m; else a = m;
						}
						hit = b;
						break;
					}
				}
				prev_t = t;
				t += fmaxf(dx * 0.4f, t * 0.0025f);
			}
			float col[3];
			/* sky */
			float sk = fmaxf(dyr, 0.0f);
			float skyc[3] = {0.55f + 0.1f * (1 - sk), 0.66f + 0.05f * (1 - sk), 0.86f};
			skyc[0] = 0.62f * (1 - sk) + 0.22f * sk; skyc[1] = 0.70f * (1 - sk) + 0.38f * sk; skyc[2] = 0.82f * (1 - sk) + 0.70f * sk;
			if (hit < 0) {
				float sd = dxr * sun[0] + dyr * sun[1] + dzr * sun[2];
				float g = powf(fmaxf(sd, 0.0f), 600.0f) * 20.0f;
				col[0] = skyc[0] + g; col[1] = skyc[1] + g; col[2] = skyc[2] + g;
			} else {
				float x = ox + dxr * hit, y = oy + dyr * hit, z = oz + dzr * hit;
				float gi = (x - x0) / dx, gj = (z - x0) / dx;
				float e = 1.0f;
				float hx = (bilin_(h, n, n, gi + e, gj) - bilin_(h, n, n, gi - e, gj)) / (2 * e * dx);
				float hz = (bilin_(h, n, n, gi, gj + e) - bilin_(h, n, n, gi, gj - e)) / (2 * e * dx);
				float nxv = -hx, nyv = 1, nzv = -hz;
				float nl = sqrtf(nxv * nxv + nyv * nyv + nzv * nzv);
				nxv /= nl; nyv /= nl; nzv /= nl;
				float slope = acosf(nyv) * 57.2958f;
				float snow, rock, grass, forest;
				if (masks) {
					int ii = (int)(gi + 0.5f), jj = (int)(gj + 0.5f);
					if (ii < 0) ii = 0;
					if (jj < 0) jj = 0;
					if (ii > n - 1) ii = n - 1;
					if (jj > n - 1) jj = n - 1;
					const float *m = masks + ((size_t)jj * n + ii) * 4;
					snow = m[0]; rock = m[1]; grass = m[2]; forest = m[3];
				} else {
					float sl = fminf(fmaxf((y - 1800.0f - 150.0f * nzv) / 250.0f, 0.0f), 1.0f);
					snow = sl * fminf(fmaxf((50.0f - slope) / 12.0f, 0.0f), 1.0f);
					rock = fminf(fmaxf((slope - 38.0f) / 10.0f, 0.0f), 1.0f);
					forest = (y < 2100.0f && slope < 38.0f) ? fminf((2100.0f - y) / 120.0f, 1.0f) * (1 - rock) : 0.0f;
					grass = 1.0f - forest;
				}
				float base[3] = {0.20f, 0.19f, 0.13f};
				float gr[3] = {0.28f, 0.26f, 0.14f}, fo[3] = {0.035f, 0.055f, 0.035f};
				float rk[3] = {0.15f, 0.145f, 0.135f}, sn[3] = {0.80f, 0.83f, 0.88f};
				for (int c = 0; c < 3; c++) {
					float v = base[c];
					v = v * (1 - grass) + gr[c] * grass;
					v = v * (1 - forest) + fo[c] * forest;
					v = v * (1 - rock) + rk[c] * rock;
					v = v * (1 - snow) + sn[c] * snow;
					col[c] = v;
				}
				/* sun + shadow ray */
				float ndl = nxv * sun[0] + nyv * sun[1] + nzv * sun[2];
				float sh = 1.0f;
				if (ndl > 0) {
					float st = 2.0f;
					while (st < 8000.0f) {
						float sx2 = x + sun[0] * st, sy2 = y + 0.5f + sun[1] * st, sz2 = z + sun[2] * st;
						float g2i = (sx2 - x0) / dx, g2j = (sz2 - x0) / dx;
						if (g2i < 0 || g2j < 0 || g2i > n - 1 || g2j > n - 1) break;
						if (sy2 < bilin_(h, n, n, g2i, g2j)) { sh = 0; break; }
						st += fmaxf(dx * 0.5f, st * 0.01f);
					}
				} else sh = 0;
				float sunc[3] = {1.0f, 0.93f, 0.82f};
				float amb = 0.30f + 0.15f * nyv;
				for (int c = 0; c < 3; c++) col[c] = col[c] * (sunc[c] * 1.5f * fmaxf(ndl, 0.0f) * sh + skyc[c] * amb * 1.0f);
				float fog = 1.0f - expf(-hit * fog_density);
				for (int c = 0; c < 3; c++) col[c] = col[c] * (1 - fog) + skyc[c] * fog;
			}
			float *o = out + ((size_t)py * W + px) * 3;
			o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
		}
	}
}

/* Directional horizon tangent (for baked sun shadow previews): max tan of elevation toward (dx,dy). */
void horizon_dir(const float *h, int nx, int ny, float cell, float dx, float dy, float maxdist, float growth,
				 float *out) {
	for (int j = 0; j < ny; j++)
		for (int i = 0; i < nx; i++) {
			float h0 = h[(size_t)j * nx + i];
			float t = 1.0f, mt = -10;
			while (t * cell < maxdist) {
				float hs = bilin(h, nx, ny, i + dx * t, j + dy * t);
				float tn = (hs - h0) / (t * cell);
				if (tn > mt) mt = tn;
				t = t * growth + 0.5f;
			}
			out[(size_t)j * nx + i] = mt;
		}
}
