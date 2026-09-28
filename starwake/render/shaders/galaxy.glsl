// Spiral galaxy, seen from outside.
// uP0: x = lit fraction (1 = alive, 0 = all dark), y = relight mode (1 = gold rebirth), z = camera path id
// uP1: camera overrides (x = distance scale, y = elevation, z = yaw offset, w = push amount)
#include "common.glsl"

const float ARMS = 2.;

float galDensity(vec3 p, out float arm, out float dust){
  float r = length(p.xz);
  float th = atan(p.z, p.x);
  float ph = th - log(r + .05)*2.6;
  float warp = fbm(vec3(p.xz*2.5, 1.), 4);
  arm = pow(.5 + .5*cos(ARMS*ph + warp*1.8), 5.);
  float arm2 = pow(.5 + .5*cos(ARMS*ph + warp*1.8 - .7), 8.);
  float disk = exp(-r/.55)*exp(-abs(p.y)/(.035 + .02*r));
  float halo = exp(-length(p*vec3(1., 1.8, 1.))/.16);
  float clump = fbm(p*9. + 3., 4);
  dust = arm2*smoothstep(.35, .7, clump)*exp(-abs(p.y)/.03)*smoothstep(.12, .3, r)*exp(-r/1.1);
  return disk*(.07 + 2.6*arm*(.35 + clump)) + halo*2.6;
}

vec3 skyGen(vec3 rd){ return nebula(rd, vec3(.05, .07, .16), vec3(.12, .04, .1), vec3(.02, .1, .12), .35, 3.); }
vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  // lit fraction animates from uP0.x to uP0.w across the shot
  float lit = mix(uP0.x, uP0.w, ease2(remap(t, uD*.08, uD*.85)));
  float path = uP0.z;
  float dist = 3.1*uP1.x - uP1.w*ease(t/uD);
  float elev = uP1.y;
  float yaw = uP1.z + t*.018;
  vec3 ta = vec3(0., 0., 0.);
  vec3 ro = vec3(cos(yaw)*cos(elev), sin(elev), sin(yaw)*cos(elev))*dist;
  mat3 cam = camLook(ro, ta + vec3(.05, 0, -.1), .18);
  if (path > .5){
    // skimming low over the disc toward the core, through the dust lanes
    float k = t/uD;
    ro = vec3(-1.45 + .55*k, .09 - .02*k, .55 - .25*k);
    ta = vec3(0., -.02, 0.);
    cam = camLook(ro, ta, -.12);
  }
  vec3 rd = cam*normalize(vec3(uv, 1.9));

  // background sky
  vec3 col = starfield(rd, .5) + sky(rd);

  // tilt galaxy frame
  mat3 G = mat3(1.);
  vec3 lro = ro, lrd = rd;
  // slab march
  float H = .35;
  float tn = (-H - lro.y)/lrd.y, tf = (H - lro.y)/lrd.y;
  if (tn > tf){ float s = tn; tn = tf; tf = s; }
  vec2 cyl = sphIntersect(lro, lrd, vec3(0), 2.4);
  tn = max(tn, max(cyl.x, 0.)); tf = min(tf, cyl.y);
  vec3 acc = vec3(0);
  float trans = 1.;
  if (tf > tn && cyl.y > 0.){
    const int N = 56;
    float dt = (tf - tn)/float(N);
    float jit = hash12(fc + float(uF)*.37);
    for (int i = 0; i < N; i++){
      vec3 p = lro + lrd*(tn + dt*(float(i) + jit));
      float arm, dust;
      float d = galDensity(p, arm, dust);
      float r = length(p.xz);
      // colour: warm core, blue arms, pink HII knots
      vec3 c = mix(vec3(1., .78, .5), vec3(.55, .7, 1.), smoothstep(.05, .5, r));
      float knots = smoothstep(.72, .95, fbm(p*16., 3))*arm*smoothstep(.15, .4, r);
      c += vec3(1., .35, .55)*knots*2.;
      // death of the galaxy: arms cool and fade by region
      float region = clamp((fbm(p*3. + 7., 3) - .25)/.5, 0., 1.);
      float alive = 1. - smoothstep(lit - .1, lit + .1, region);
      if (lit < .999){
        vec3 cold = vec3(.25, .3, .42)*.18;
        c = mix(cold, c, alive);
        d *= mix(.25, 1., alive);
      }
      if (uP0.y > .5) c = mix(c, c*vec3(1.25, 1.0, .7), .5);
      float em = d*dt*.9;
      acc += trans*c*em;
      trans *= exp(-dust*dt*90.);
      if (trans < .02) break;
    }
  }
  col = col*trans + acc;

  // resolved stars in the disk plane (sparkles), dying/relighting individually
  float tp = -lro.y/lrd.y;
  if (tp > 0. && path < .5){
    vec3 p = lro + lrd*tp;
    float r = length(p.xz);
    float arm, dust;
    float d = galDensity(vec3(p.x, 0., p.z), arm, dust);
    for (int k = 0; k < 2; k++){
      float sc = k == 0 ? 90. : 210.;
      vec2 q = p.xz*sc;
      vec2 id = floor(q);
      vec2 f = fract(q) - .5;
      vec2 o = (hash22(id + float(k)*13.) - .5)*.7;
      float h = hash12(id + float(k)*7.1);
      float pd = length(f - o);
      float fw = fwidth(q.x)*.9 + .02;
      float s = exp(-pd*pd/(fw*fw))*step(.86, h)*min(d*d*.5, 1.2)*(k == 0 ? 1. : .35);
      vec3 sc2 = blackbody(mix(3., 14., hash12(id + 3.3)));
      // each star has a death time; dies with a small red flare
      float die = hash12(id + 91.)*1.;
      float life = lit - die;
      float state = smoothstep(-.02, .0, life);
      float flare = exp(-abs(life + .004)*700.)*(1. - step(.999, lit))*step(.9, hash12(id + 17.));
      s *= state;
      vec3 fc = uP0.y > .5 ? vec3(1., .85, .5) : vec3(1., .3, .1);
      col += (sc2*s*1.2 + fc*flare*exp(-pd*pd/(fw*fw*2.))*5.)*trans;
    }
  }
  return col;
}
