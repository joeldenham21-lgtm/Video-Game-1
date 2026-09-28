// STARWAKE -- shared shader library
#define PI 3.14159265
#define TAU 6.28318531

uniform float uT;        // time within shot (s)
uniform float uD;        // shot duration (s)
uniform float uGlobalT;  // time within film (s)
uniform vec2  uR;        // render resolution
uniform int   uF;        // frame index
uniform vec4  uP0, uP1, uP2, uP3;  // per-shot parameters
uniform samplerCube uSky;          // baked nebula (see skyGen in scene shaders)
vec3 sky(vec3 rd){ return texture(uSky, rd).rgb; }

// ------------------------------------------------------------ hashing
float hash11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz)*p3.zy); }
vec3  hash33(vec3 p3){ p3 = fract(p3*vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx)*p3.zyx); }

// ------------------------------------------------------------ noise
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f*f*(3. - 2.*f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vnoise2(vec2 x){
  vec2 i = floor(x), f = fract(x);
  f = f*f*(3. - 2.*f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec3 p, int oct){
  float a = .5, s = 0.;
  for (int i = 0; i < oct; i++){ s += a*vnoise(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= .5; }
  return s;
}
float fbm2(vec2 p, int oct){
  float a = .5, s = 0.;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < oct; i++){ s += a*vnoise2(p); p = m*p; a *= .5; }
  return s;
}
float ridged(vec3 p, int oct){
  float a = .5, s = 0.;
  for (int i = 0; i < oct; i++){ s += a*(1. - abs(2.*vnoise(p) - 1.)); p = p*2.07 + vec3(3.3, 1.1, 7.7); a *= .5; }
  return s;
}
// cellular: x = F1 distance, y = F2 - F1 (edge measure), z = cell id
vec3 voronoi(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float d1 = 8., d2 = 8., id = 0.;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 g = vec3(x, y, z);
    vec3 o = hash33(i + g);
    float d = length(g + o - f);
    if (d < d1){ d2 = d1; d1 = d; id = hash13(i + g); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2 - d1, id);
}

// ------------------------------------------------------------ transforms
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
mat3 camLook(vec3 ro, vec3 ta, float roll){
  vec3 f = normalize(ta - ro);
  vec3 r = normalize(cross(f, vec3(sin(roll), cos(roll), 0.)));
  vec3 u = cross(r, f);
  return mat3(r, u, f);
}
float ease(float x){ x = clamp(x, 0., 1.); return x*x*(3. - 2.*x); }
float ease2(float x){ x = clamp(x, 0., 1.); return x*x*x*(x*(x*6. - 15.) + 10.); }
float easeOut(float x){ x = clamp(x, 0., 1.); return 1. - (1. - x)*(1. - x)*(1. - x); }
float easeIn(float x){ x = clamp(x, 0., 1.); return x*x*x; }
float remap(float x, float a, float b){ return clamp((x - a)/(b - a), 0., 1.); }
// handheld / camera shake
vec3 shake(float t, float amt){
  return amt*vec3(fbm(vec3(t*2.1, 0, 0), 3) - .5, fbm(vec3(0, t*2.3, 5), 3) - .5, fbm(vec3(9, 0, t*1.7), 3) - .5);
}

// ------------------------------------------------------------ SDF
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
float sdRoundBox(vec3 p, vec3 b, float r){ return sdBox(p, b - r) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h) - r; }
float sdCapsule2(vec3 p, vec3 a, vec3 b, float ra, float rb){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h) - mix(ra, rb, h); }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdEllipsoid(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0 - 1.)/k1; }
float sdCyl(vec3 p, float h, float r){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.) + length(max(d, 0.)); }
float sdOcta(vec3 p, float s){ p = abs(p); return (p.x + p.y + p.z - s)*.57735027; }
float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b - a)/k, 0., 1.); return mix(b, a, h) - k*h*(1. - h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
// polar repetition around Y; returns local angle-cell id in .y via out
vec3 pModPolarY(vec3 p, float n, out float cell){
  float ang = TAU/n;
  float a = atan(p.z, p.x) + ang*.5;
  cell = floor(a/ang);
  a = mod(a, ang) - ang*.5;
  float r = length(p.xz);
  return vec3(r*cos(a), p.y, r*sin(a));
}

// ------------------------------------------------------------ colour
vec3 blackbody(float k){ // k in thousands of kelvin, 1..40
  k = clamp(k, 1., 40.);
  vec3 c;
  c.r = k < 6.6 ? 1. : 1.29*pow(k*10. - 60., -.1332);
  c.g = k < 6.6 ? .39*log(k*100.) - 1.4 : 1.13*pow(k*10. - 60., -.0755);
  c.b = k < 6.6 ? (k < 2. ? 0. : .543*log(k*10. - 10.) - 1.196) : 1.;
  return clamp(c, 0., 1.);
}
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(TAU*(c*t + d)); }

// ------------------------------------------------------------ sky
// multi-layer starfield on the view sphere. 'dens' ~ 1, 'bright' scales.
vec3 starLayer(vec3 rd, float scale, float thresh, float seed){
  vec3 p = rd*scale;
  vec3 id = floor(p);
  vec3 f = fract(p) - .5;
  float h = hash13(id + seed);
  if (h < thresh) return vec3(0);
  vec3 o = (hash33(id + seed*1.7) - .5)*.7;
  float d = length(f - o);
  float mag = pow(hash13(id*1.3 + seed), 6.);
  float tw = .75 + .25*sin(uGlobalT*(2. + 5.*h) + h*100.);
  vec3 col = blackbody(mix(2.5, 16., hash13(id + 4.2)));
  float px = max(length(fwidth(rd))*scale, 1e-4);   // pixel footprint in cell units
  float core = exp(-d*d/(px*px*.45));
  return col*core*(.08 + 6.*mag)*tw;
}
vec3 starfield(vec3 rd, float bright){
  vec3 c = starLayer(rd, 90., .9, 1.)*1.4
         + starLayer(rd, 180., .9, 7.)
         + starLayer(rd, 360., .93, 13.)*.7;
  return c*bright;
}
// volumetric-looking nebula sampled on the view sphere
vec3 nebula(vec3 rd, vec3 c1, vec3 c2, vec3 c3, float dens, float seed){
  vec3 p = rd*2.2 + seed;
  vec3 q = vec3(fbm(p, 4), fbm(p + 5.2, 4), fbm(p + 9.1, 4));
  float n = fbm(p + 2.6*q, 6);
  float m = smoothstep(.35, .85, n);
  float dust = smoothstep(.45, .75, fbm(p*2.3 + 3.*q + 11., 5));
  vec3 col = mix(c1, c2, smoothstep(.3, .8, q.x));
  col = mix(col, c3, smoothstep(.55, .9, q.y)*.8);
  col *= m*m*dens*2.;
  col *= 1. - .85*dust*smoothstep(.2, .7, m);
  return col;
}
// bright star disc with corona, rays and halo (dir = unit dir to star)
vec3 sunGlow(vec3 rd, vec3 dir, float size, vec3 col, float rays){
  float c = max(dot(rd, dir), 0.);
  float a = acos(min(c, 1.));
  float disk = smoothstep(size, size*.93, a);
  vec3 s = col*disk*40.;
  s += col*exp(-a/(size*.8))*6.;
  s += col*exp(-a/(size*3.))*1.2;
  s += col*.12*exp(-a*4.);
  if (rays > 0.){
    vec3 up = abs(dir.y) < .99 ? vec3(0,1,0) : vec3(1,0,0);
    vec3 X = normalize(cross(dir, up)), Y = cross(X, dir);
    float ang = atan(dot(rd, Y), dot(rd, X));
    float r = pow(abs(sin(ang*6. + 1.)), 40.) + pow(abs(sin(ang*11. + 2.)), 60.)*.6;
    s += col*r*rays*exp(-a/(size*5.))*3.;
  }
  return s;
}

// ------------------------------------------------------------ spheres & atmosphere
vec2 sphIntersect(vec3 ro, vec3 rd, vec3 ce, float ra){
  vec3 oc = ro - ce;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - ra*ra;
  float h = b*b - c;
  if (h < 0.) return vec2(-1.);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
// cheap single scattering through a shell; returns inscattered light
vec3 atmosphere(vec3 ro, vec3 rd, vec3 ce, float R, float H, vec3 sunDir, vec3 beta, float tMax, float mieG){
  vec2 t = sphIntersect(ro, rd, ce, R + H);
  if (t.y < 0.) return vec3(0);
  float t0 = max(t.x, 0.), t1 = min(t.y, tMax);
  if (t1 <= t0) return vec3(0);
  const int N = 12;
  float dt = (t1 - t0)/float(N);
  vec3 sum = vec3(0);
  float od = 0.;
  for (int i = 0; i < N; i++){
    vec3 p = ro + rd*(t0 + dt*(float(i) + .5));
    float h = length(p - ce) - R;
    float d = exp(-max(h, 0.)/(H*.25));
    od += d*dt;
    // light-side factor: how far the sample is into sunlight around the limb
    vec3 n = normalize(p - ce);
    float lit = smoothstep(-.25, .25, dot(n, sunDir));
    sum += d*dt*lit*exp(-beta*od*2.5/H);
  }
  float mu = dot(rd, sunDir);
  float ray = .75*(1. + mu*mu);
  float g = mieG;
  float mie = (1. - g*g)/pow(1. + g*g - 2.*g*mu, 1.5)*.08;
  return sum*(beta*ray + vec3(mie))*6./H;
}

// distance between a ray and a segment: (dist, t along ray, s along segment)
vec3 raySeg(vec3 ro, vec3 rd, vec3 a, vec3 b){
  vec3 ba = b - a, w0 = ro - a;
  float B = dot(rd, ba), C = dot(ba, ba), D = dot(rd, w0), E = dot(ba, w0);
  float den = max(C - B*B, 1e-7);
  float s = clamp((E - B*D)/den, 0., 1.);
  float t = max(dot(a + ba*s - ro, rd), 0.);
  s = clamp(dot(ro + rd*t - a, ba)/C, 0., 1.);
  vec3 pb = a + ba*s;
  t = max(dot(pb - ro, rd), 0.);
  return vec3(length(ro + rd*t - pb), t, s);
}
