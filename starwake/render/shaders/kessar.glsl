// Kessar, twenty years ago: a rooftop, a father, a child, and the sun being taken.
// uP0.x: 1 = wide (K1), 2 = two-shot (K2), 3 = the sun goes out (K3), 5 = dawn, twenty years later (K5)
#include "common.glsl"
#include "figures.glsl"

vec3 camPos, camTar; float camFov = 1.8, camRoll = 0.;
vec3 sunDir; float sunR = .24; float life = 1.; float thread = 1.; float frozen = 0.; float snow = 0.;
float power = 1.; float dawn = 0.; float figs = 1.; float collapse = 0.;
vec3 dadPos = vec3(-.35, 0, -2.2), kidPos = vec3(.3, .35, -2.35);

void setup(float t){
  int V = int(uP0.x + .5);
  float u = t/uD;
  sunDir = normalize(vec3(.1, .2, -1.));
  if (V == 1){
    camPos = vec3(1.4 - .5*u, 1.0 + .25*u, 6.5 - 1.5*u); camTar = vec3(-.2, 3.6, -30.); camFov = 1.55;
  }
  if (V == 2){
    camPos = vec3(2.1 - .3*u, 1.0, 1.1 - .4*u); camTar = vec3(-.4, 1.9, -6.); camFov = 1.7; camRoll = .02;
    thread = 1.1;
  }
  if (V == 3){
    life = 1. - ease2(remap(t, 1.5, 7.2));
    collapse = remap(t, 7.0, 7.6);
    thread = smoothstep(.02, .2, life)*1.4;
    power = 1. - smoothstep(7.2, 9.5, t)*.85;
    snow = smoothstep(8., 12., t);
    camPos = vec3(.9 - .4*u, .9 + .2*u, 4.2 - 1.6*u); camTar = vec3(-.1, 3.2, -20.); camFov = 1.6;
  }
  if (V == 5){
    figs = 0.; frozen = 1.; power = 0.; thread = 0.;
    dawn = 1.;
    sunDir = normalize(vec3(.1, .04 + .12*ease(remap(t, 0., 9.)), -1.));
    life = 1.;
    camPos = vec3(1.4 - .6*u, 1.1 + .6*u, 5.5 - 1.2*u); camTar = vec3(-.2, 2.2 + 1.5*u, -30.); camFov = 1.6;
  }
}

// ---------------------------------------------------------------- sky
vec3 skyGen(vec3 rd){ return nebula(rd, vec3(.08, .05, .1), vec3(.04, .05, .12), vec3(.1, .03, .02), .5, 5.); }

vec3 sunColor(){ return mix(vec3(1., .25, .06), vec3(1., .5, .2), life)*(dawn > .5 ? 1.2 : 1.); }

vec3 skyCol(vec3 rd){
  float y = rd.y;
  float sd = dot(rd, sunDir);
  float L = life;
  vec3 hor = dawn > .5 ? vec3(.9, .5, .3) : mix(vec3(.05, .03, .06), vec3(.6, .14, .05), L);
  vec3 top = dawn > .5 ? vec3(.1, .16, .36) : mix(vec3(.004, .005, .012), vec3(.08, .03, .1), L);
  vec3 c = mix(hor, top, pow(clamp(y + .05, 0., 1.), .5));
  c += sunColor()*pow(max(sd, 0.), 6.)*.3*L;
  // the sun: an enormous red giant sitting on the horizon
  float a = acos(clamp(sd, -1., 1.));
  float R = sunR*mix(.04, 1., pow(L, .6));
  if (a < R){
    vec3 X = normalize(cross(sunDir, vec3(0, 1, 0))), Y = cross(X, sunDir);
    vec2 sp = vec2(dot(rd, X), dot(rd, Y))/R;
    float mu = sqrt(max(1. - dot(sp, sp), 0.));
    float g = fbm(vec3(sp*6., uGlobalT*.05), 5);
    float I = (.55 + .6*g)*(.35 + .65*pow(mu, .5));
    vec3 sc = mix(vec3(.5, .05, 0.), vec3(1., .45, .12), smoothstep(.3, 1., I));
    c = sc*I*mix(.3, 1.05, L)*(dawn > .5 ? 1.2 : 1.);
    // the wound where the thread is pulled from
    if (thread > 0.){ float w = length(sp - vec2(-.25, .96)); c += vec3(1., .8, .5)*exp(-w*w*40.)*3.*thread; }
  }
  c += sunColor()*exp(-max(a - R, 0.)/(R*.2))*.35*L;
  // collapse flash
  if (collapse > 0. && collapse < 1.) c += vec3(1., .7, .5)*exp(-max(a, 0.)*6.)*sin(collapse*PI)*3.;
  // stars come out as the light dies
  c += (starfield(rd, .9) + sky(rd))*(1. - L)*(1. - dawn*.8)*smoothstep(0., .15, y);
  // bands of cloud lit from below
  if (y > 0.){
    vec2 cp = rd.xz/(y + .06);
    float cl = smoothstep(.5, .8, fbm2(cp*.6 + vec2(uGlobalT*.01, 0), 5));
    vec3 cc = mix(vec3(.05, .03, .05), sunColor()*.9, pow(max(sd, 0.), 2.)*L + .15*L);
    if (dawn > .5) cc = mix(vec3(.4, .3, .45), vec3(1., .7, .5), pow(max(sd, 0.), 2.));
    c = mix(c, cc, cl*.55);
  }
  // the thread: a filament of the sun's light drawn up to a black ring in the sky
  if (thread > 0.){
    vec3 X = normalize(cross(sunDir, vec3(0, 1, 0))), Y = cross(X, sunDir);
    vec3 a0 = normalize(sunDir + (X*-.25 + Y*.96)*sunR);
    vec3 a2 = normalize(vec3(-.42, .3, -1.));
    vec3 a1 = normalize(mix(a0, a2, .5) + vec3(.15, .12, 0));
    float best = 1e9, bs = 0.;
    vec3 prev = a0;
    for (int i = 1; i <= 40; i++){
      float k = float(i)/40.;
      vec3 pc = normalize(mix(mix(a0, a1, k), mix(a1, a2, k), k));
      vec3 ba = pc - prev, pa = rd - prev;
      float hh = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.);
      float dd = length(pa - ba*hh);
      if (dd < best){ best = dd; bs = (float(i - 1) + hh)/40.; }
      prev = pc;
    }
    float w = mix(.004, .0012, bs);
    float n = .6 + .8*vnoise(vec3(bs*40. - uGlobalT*3., 0, 0));
    c += vec3(1., .55, .25)*(exp(-pow(best/w, 2.))*2.5*n + exp(-best/(w*6.))*.2)*thread*L;
    // the Starmaw, a tiny black ring
    float dr = acos(clamp(dot(rd, a2), -1., 1.));
    float ring = smoothstep(.0035, .0025, abs(dr - .012));
    c = mix(c, vec3(0), ring*step(.001, L));
    c += vec3(1., .5, .2)*exp(-dr*dr/(.004*.004))*1.5*thread*L;
  }
  return c;
}

// ---------------------------------------------------------------- scene
float gMat = 0.; float gId = 0.;
float city(vec3 p){
  // towers of the old city, stepping down toward the horizon
  vec2 c = floor(p.xz/34.);
  vec2 f = p.xz - (c + .5)*34.;
  float d = 1e9;
  float h = hash12(c);
  if (p.z < -20.){
    float H = 20. + 110.*h*h*smoothstep(-40., -400., (c.y + .5)*34.);
    vec2 sz = vec2(8. + 7.*hash12(c + 3.), 8. + 7.*hash12(c + 7.));
    float b = sdBox(vec3(f.x, p.y + 40. - H*.5, f.y), vec3(sz.x, H*.5, sz.y));
    // domed tops and spires on some
    if (h > .6) b = min(b, length(vec3(f.x, p.y + 40. - H, f.y)) - min(sz.x, sz.y)*.9);
    if (h > .85) b = min(b, sdCapsule2(vec3(f.x, p.y + 40., f.y), vec3(0, H, 0), vec3(0, H + 30., 0), 1.5, .2));
    d = b;
  }
  // stay inside the cell
  vec2 q = abs(f) - 17.;
  float bound = -max(q.x, q.y) + .5;
  return min(d, max(bound, 2.));
}
float roof(vec3 p){
  float d = p.y;                                                    // the roof
  d = min(d, sdBox(p - vec3(0, .5, -3.1), vec3(12., .55, .18)));     // parapet
  d = min(d, sdBox(p - vec3(-5.5, 1.3, 1.5), vec3(1.3, 1.3, 1.5)));  // stair hut
  d = min(d, sdCapsule(p, vec3(-7.5, 0, -2.), vec3(-7.5, 5.5, -2.), .05)); // antenna
  d = min(d, sdCapsule(p, vec3(-8., 4.6, -2.), vec3(-7., 4.6, -2.), .03));
  return d;
}
float figures(vec3 p){
  if (figs < .5) return 1e9;
  // father
  gHairStyle = 1.;
  vec3 q = (p - dadPos)/1.06;
  float d1 = length(q - vec3(0, 1.1, 0)) > 1.6 ? length(q - vec3(0, 1.1, 0)) - 1.4 : sdAsha(q, vec4(0, 0, .12, 0))*1.06;
  // child, standing on the parapet step, leaning on her father
  gHairStyle = 0.;
  vec3 k = (p - kidPos)/.6;
  k.xz = rot(.25)*k.xz;
  float d2 = length(k - vec3(0, 1.1, 0)) > 1.6 ? (length(k - vec3(0, 1.1, 0)) - 1.4)*.6 : sdAsha(k, vec4(0, 0, .3, 0))*.6;
  gId = d1 < d2 ? 0. : 1.;
  return min(d1, d2);
}
float step_(vec3 p){ return sdBox(p - vec3(.3, .17, -2.5), vec3(.5, .17, .35)); }
float mapK(vec3 p){
  float d = roof(p); gMat = 1.;
  float s = step_(p); if (s < d){ d = s; gMat = 1.; }
  float c = city(p); if (c < d){ d = c; gMat = 2.; }
  float f = figures(p); if (f < d){ d = f; gMat = 3.; }
  return d;
}
vec3 normalK(vec3 p, float e){
  vec2 k = vec2(1, -1);
  return normalize(k.xyy*mapK(p + k.xyy*e) + k.yyx*mapK(p + k.yyx*e) + k.yxy*mapK(p + k.yxy*e) + k.xxx*mapK(p + k.xxx*e));
}

vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  setup(t);
  vec3 ro = camPos;
  mat3 cam = camLook(ro, camTar, camRoll);
  vec3 rd = cam*normalize(vec3(uv, camFov));
  vec3 col = skyCol(rd);
  float tt = .02, hit = -1.;
  for (int i = 0; i < 160; i++){
    float d = mapK(ro + rd*tt);
    if (abs(d) < .0008*tt + .0006){ hit = tt; break; }
    tt += d*.9;
    if (tt > 2500.) break;
  }
  float T = uGlobalT;
  vec3 sc = sunColor()*life;
  vec3 amb = mix(vec3(.02, .015, .03), vec3(.1, .05, .06), life);
  if (dawn > .5) amb = vec3(.14, .15, .22);
  if (hit > 0.){
    vec3 p = ro + rd*hit;
    float m = gMat; float id = gId;
    vec3 n = normalK(p, .001 + hit*.0008);
    float dif = max(dot(n, sunDir), 0.);
    float fres = pow(1. - max(dot(n, -rd), 0.), 4.);
    float back = pow(max(dot(rd, sunDir), 0.), 2.);
    vec3 alb = vec3(.1, .085, .08);
    float snowCover = frozen*smoothstep(.3, .8, n.y);
    if (m == 2.) alb = vec3(.12, .1, .1);
    if (m == 3.) alb = vec3(.03, .03, .035);
    alb = mix(alb, vec3(.85, .9, 1.), snowCover);
    vec3 c = alb*(dif*sc*1.4 + amb*(.4 + .6*n.y*.5 + .3));
    c += sc*fres*back*(m == 3. ? 3. : 1.2);                        // rim light from the dying sun
    if (dawn > .5) c += vec3(1., .85, .7)*pow(max(dot(reflect(rd, n), sunDir), 0.), 60.)*snowCover*4.;   // glitter
    if (m == 2.){
      // windows: warm, failing as the power dies
      vec3 q = p;
      vec2 w = vec2(dot(q.xz, vec2(.7071)) + q.x*.3, q.y);
      vec2 g = floor(vec2((q.x + q.z)*.9, q.y*.7));
      float wh = hash12(g);
      float win = step(.55, wh)*step(abs(fract((q.x + q.z)*.9) - .5), .3)*step(abs(fract(q.y*.7) - .5), .25);
      float alive = step(1. - power, hash12(g + 9.));
      float fl = .8 + .2*sin(T*20.*hash12(g) + wh*40.);
      c += vec3(1., .62, .3)*win*alive*fl*.9*(1. - frozen);
      if (frozen > .5) c += vec3(1., .8, .6)*win*pow(max(dot(reflect(rd, n), sunDir), 0.), 8.)*1.5;
    }
    // aerial perspective: warm haze toward the sun
    float fog = 1. - exp(-hit*.0011);
    vec3 fcol = mix(vec3(.03, .02, .04), sunColor()*.35 + vec3(.08, .03, .03), life*pow(max(dot(rd, sunDir)*.5 + .5, 0.), 3.));
    if (dawn > .5) fcol = mix(vec3(.3, .32, .42), vec3(.9, .6, .4), pow(max(dot(rd, sunDir)*.5 + .5, 0.), 3.));
    col = mix(c, fcol, fog);
  }
  // shafts of light through the haze
  float sd = max(dot(rd, sunDir), 0.);
  vec3 X = normalize(cross(sunDir, vec3(0, 1, 0))), Y = cross(X, sunDir);
  float ang = atan(dot(rd, Y), dot(rd, X));
  float shafts = pow(fbm(vec3(ang*8., T*.05, 1.), 3), 3.)*pow(sd, 20.)*1.5;
  col += sunColor()*shafts*life*step(-.05, rd.y);
  // snow falling, or diamond dust in the dawn
  float flakes = max(snow, dawn*.6);
  if (flakes > 0.){
    vec3 fwd = normalize(camTar - camPos);
    for (int k = 0; k < 6; k++){
      float dist = 1.2*pow(1.7, float(k));
      float tq = dist/dot(rd, fwd);
      if (hit > 0. && tq > hit) break;
      vec3 p = ro + rd*tq + vec3(sin(T*.5 + float(k))*.4, T*(dawn > .5 ? .1 : .9), 0);
      vec3 Xv = normalize(cross(fwd, vec3(0, 1, 0))), Yv = cross(Xv, fwd);
      vec2 q = vec2(dot(p, Xv), dot(p, Yv))*(4./dist);
      vec2 c = floor(q); vec2 f = fract(q) - .5 - (hash22(c + float(k)*9.) - .5)*.7;
      float h = hash12(c + float(k));
      float s = exp(-dot(f, f)*(dist < 2. ? 90. : 400.))*step(.7, h);
      vec3 fc2 = dawn > .5 ? vec3(1., .85, .6)*(.5 + 1.5*pow(sd, 3.)) : vec3(.7, .75, .9)*(.3 + power*.3);
      col += fc2*s*flakes*(dist < 2. ? .4 : 1.);
    }
  }
  return col;
}
