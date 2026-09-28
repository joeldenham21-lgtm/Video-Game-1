// Inside the Starmaw: the throat, and the cage of stolen suns.
// uP0.x: 1 = vision (S28), 2 = throat run (S37), 3 = core + launch (S38), 4 = the cage breaks (S39)
#include "common.glsl"
#include "ships.glsl"

vec3 camPos, camTar; float camFov = 1.7; float camRoll = 0.;
float vision = 0.; float tunnel = 0.; float cageOn = 1.; float breakT = -1.;
vec3 fPos; mat3 fRot = mat3(1.); float fOn = 0.; float fScale = 1.;
float seedT = -1.; vec3 seedA, seedB;
float kessarFocus = 0.;
const float CAGE_R = 30.;

mat3 basisZ(vec3 fwd, vec3 up){ vec3 z = normalize(fwd); vec3 x = normalize(cross(up, z)); return mat3(x, cross(z, x), z); }

void setup(float t){
  int V = int(uP0.x + .5);
  float u = t/uD;
  if (V == 1){
    vision = 1.;
    kessarFocus = ease(remap(t, 5., 11.5));
    camPos = mix(vec3(0, 8., 110.), vec3(7.6, 2.8, 39.5), ease(u)); camTar = mix(vec3(0), vec3(8.3, 2.3, 32.8), kessarFocus); camFov = 1.6; camRoll = .05*sin(t*.4);
  }
  if (V == 2){
    tunnel = 1.; cageOn = 0.;
    float z = -t*140.;
    fOn = 1.; fScale = 9.;
    fPos = vec3(2.*sin(t*1.3), 1.5*sin(t*.9), z - 40.);
    fRot = basisZ(vec3(.1*cos(t*1.3), .08*cos(t*.9), -1.), vec3(.25*sin(t*1.3), 1, 0));
    camPos = vec3(-1.5*sin(t*1.1), 3. + .8*sin(t*.7), z) + shake(t, .4); camTar = fPos + vec3(0, 1.5, -20.); camFov = 1.35;
    camRoll = .08*sin(t*.8);
  }
  if (V == 3){
    fOn = 1.; fScale = 9.;
    float s = ease(remap(t, 0., 4.));
    fPos = mix(vec3(0, 2., 185.), vec3(0, -3., 100.), s);
    fRot = basisZ(mix(vec3(0, 0, -1), vec3(.8, -.2, -.6), smoothstep(5.5, 7.5, t)), vec3(0, 1, 0));
    fPos += vec3(1., -.2, -.6)*easeIn(remap(t, 5.5, 8.))*60.;
    seedT = t - 5.1;
    seedA = fPos; seedB = vec3(0, 0, CAGE_R);
    camPos = vec3(16., 7., 150. - 15.*u) + shake(t, .3); camTar = mix(fPos, vec3(0, 0, 30.), .55); camFov = 1.45;
  }
  if (V == 4){
    breakT = t;
    camPos = vec3(10. - 3.*u, 3., 85. - 12.*u) + shake(t, .4 + 2.*exp(-t*1.2)); camTar = vec3(0, 0, 0); camFov = 1.5;
  }
}

// ---------------------------------------------------------------- captive suns
vec3 sunOrb(int i, float T){
  float fi = float(i);
  float r = CAGE_R*(.25 + .65*hash11(fi*1.7));
  float incl = (hash11(fi*3.3) - .5)*2.4;
  float speed = (.05 + .12*hash11(fi*5.1))*(hash11(fi*9.) > .5 ? 1. : -1.);
  float a = hash11(fi*7.7)*TAU + T*speed;
  vec3 p = vec3(cos(a)*r, sin(a)*r*sin(incl), sin(a)*r*cos(incl));
  return p;
}
vec3 orbCol(int i){
  float h = hash11(float(i)*2.9);
  return blackbody(mix(2.5, 20., h*h));
}
vec3 suns(vec3 ro, vec3 rd, float tHit, float bright){
  vec3 acc = vec3(0);
  float T = uGlobalT;
  for (int i = 0; i < 90; i++){
    vec3 p = sunOrb(i, T);
    if (i == 0){ p = mix(p, vec3(8.3, 2.3, 32.8), kessarFocus); }
    float b = dot(p - ro, rd);
    if (b < 0. || b > tHit) continue;
    float d = length(ro + rd*b - p);
    float size = .35 + .5*hash11(float(i)*4.4);
    if (i == 0) size = .9 - .5*kessarFocus;
    float flick = .6 + .4*sin(T*(3. + 7.*hash11(float(i))) + float(i));
    float pain = vision*.5*step(.5, fract(T*1.7 + hash11(float(i)*6.)));
    vec3 c = i == 0 ? vec3(1., .32, .08) : orbCol(i);
    float I = i == 0 ? mix(4., 2.2, kessarFocus)*(.8 + .2*sin(T*5.)) : 4.*(1. - .75*kessarFocus);
    acc += c*(exp(-pow(d/size, 2.))*I + exp(-d/(size*3.))*.35)*flick*(1. - pain*.5)*bright;
  }
  return acc;
}

// ---------------------------------------------------------------- structures
float gMat = 0.;
float cage(vec3 p){
  float r = length(p);
  float shell = abs(r - CAGE_R) - .35;
  // latitude / longitude bars
  float lat = asin(clamp(p.y/r, -1., 1.));
  float lon = atan(p.z, p.x);
  float bl = abs(fract(lat/PI*14.) - .5)*PI/14.*r;
  float bo = abs(fract(lon/TAU*28.) - .5)*TAU/28.*r*cos(lat);
  float bars = min(bl, bo) - .3;
  float c = max(shell, bars);
  // cracks open when it breaks
  if (breakT > 0.){
    vec3 v = voronoi(normalize(p)*6.);
    c = max(c, -(smoothstep(0., 3., breakT)*.12 - v.y));
  }
  return c;
}
float chamberWall(vec3 p){
  float r = length(p);
  float a = atan(p.z, p.x), b = asin(clamp(p.y/r, -1., 1.));
  float greeb = step(.5, hash12(floor(vec2(a*40., b*40.))));
  return 220. - r - greeb*3.;
}
float throat(vec3 p){
  // tunnel along -z with ribs
  float a = atan(p.y, p.x);
  float r = length(p.xy);
  float R = 22. + 1.5*sin(a*6.) + 3.*step(.5, fract(p.z/28.))*step(abs(fract(a/TAU*12.) - .5), .15);
  float rib = step(fract(p.z/28.), .12)*2.5;
  return R - rib - r;
}
float mapK(vec3 p){
  float d = 1e9; gMat = 0.;
  if (tunnel > .5){ d = throat(p); gMat = 1.; }
  else {
    if (cageOn > .5){ float c = cage(p); if (c < d){ d = c; gMat = 2.; } }
    float w = chamberWall(p)*.9;
    if (w < d){ d = w; gMat = 1.; }
  }
  if (fOn > .5){
    vec3 q = transpose(fRot)*(p - fPos)/fScale;
    float bs = length(q) - .7;
    float df = bs > .2 ? bs*fScale : sdInterceptor(q)*fScale;
    if (df < d){ d = df; gMat = 3.; }
  }
  return d;
}
vec3 normalK(vec3 p, float e){
  vec2 k = vec2(1, -1);
  return normalize(k.xyy*mapK(p + k.xyy*e) + k.yyx*mapK(p + k.yyx*e) + k.yxy*mapK(p + k.yxy*e) + k.xxx*mapK(p + k.xxx*e));
}

vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  setup(t);
  float T = uGlobalT;
  // vision: the world ripples
  if (vision > .5) uv += .006*vec2(sin(uv.y*18. + T*3.), sin(uv.x*14. - T*2.5));
  vec3 ro = camPos;
  mat3 cam = camLook(ro, camTar, camRoll);
  vec3 rd = cam*normalize(vec3(uv, camFov));

  float tt = .1, hit = -1.;
  for (int i = 0; i < 150; i++){
    float d = mapK(ro + rd*tt);
    if (abs(d) < .0008*tt + .003){ hit = tt; break; }
    tt += d*.85;
    if (tt > 400.) break;
  }
  vec3 col = vec3(0);
  float tHit = hit > 0. ? hit : 1e9;
  float brk = breakT > 0. ? breakT : 0.;
  float surge = 1. + (breakT > 0. ? 3.*smoothstep(0., 2.5, breakT) : 0.) + (seedT > 1.3 ? 1.5*smoothstep(1.3, 2.5, seedT) : 0.);
  if (hit > 0.){
    vec3 p = ro + rd*hit;
    float m = gMat;
    vec3 n = normalK(p, .002 + hit*.0008);
    float fres = pow(1. - max(dot(n, -rd), 0.), 4.);
    vec3 L = normalize(-p);   // light from the caged suns at the centre
    float dif = max(dot(n, L), 0.);
    if (m == 1.){
      vec3 alb = vec3(.05, .045, .045);
      if (tunnel > .5){
        float a = atan(p.y, p.x);
        float strip = step(abs(fract(a/TAU*12.) - .5), .02)*(.5 + .5*sin(p.z*.3 + T*20.));
        float ribL = step(fract(p.z/28.), .12);
        col = alb*(.1 + .4*ribL)*vec3(1., .6, .4) + vec3(1., .45, .2)*strip*.9;
      } else {
        col = alb*(dif*vec3(1., .6, .4)*2.5*surge*(1. - .6*kessarFocus) + .03);
        vec2 g = floor(vec2(atan(p.z, p.x)*60., p.y*2.));
        col += vec3(1., .5, .25)*step(.975, hash12(g))*.3;
      }
    } else if (m == 2.){
      vec3 alb = vec3(.06, .05, .05);
      col = (alb*(.6 + dif*2.5)*vec3(1., .65, .45)*surge + vec3(1., .55, .35)*fres*.6*surge)*(1. - .6*kessarFocus);
      if (breakT > 0.){
        vec3 v = voronoi(normalize(p)*6.);
        float crack = exp(-v.y*30.)*smoothstep(0., 1.5, breakT);
        col += mix(vec3(.4, 1., .9), vec3(1., .85, .5), .5)*crack*8.;
      }
    } else {
      col = vec3(.15, .16, .18)*(dif*1.2 + .05) + vec3(.4, 1., .9)*fres*.5;
    }
  }
  // the captive suns
  if (tunnel < .5) col += suns(ro, rd, tHit, surge);
  // Kessar's sun, pressing against the bars toward her
  if (kessarFocus > 0.){
    vec3 kc = mix(sunOrb(0, T), vec3(8.3, 2.3, 32.8), kessarFocus);
    float kr = .3 + 1.1*kessarFocus;
    vec2 h = sphIntersect(ro, rd, kc, kr);
    if (h.x > 0. && h.x < tHit){
      vec3 n = normalize(ro + rd*h.x - kc);
      float g = fbm(n*4. + vec3(0, T*.3, 0), 5);
      float mu = max(dot(n, -rd), 0.);
      float I = (.5 + .9*g)*(.35 + .65*pow(mu, .5));
      vec3 sc = mix(vec3(.5, .05, .0), vec3(1., .45, .1), smoothstep(.3, .9, I));
      sc = mix(sc, vec3(1., .85, .6), smoothstep(.9, 1.3, I));
      col = sc*I*2.2*(.85 + .15*sin(T*5.));
    }
    float b = dot(kc - ro, rd);
    float d = length(ro + rd*b - kc);
    col += vec3(1., .35, .08)*exp(-max(d - kr, 0.)/(kr*.6))*.5*kessarFocus*step(b, tHit + kr);
  }
  // plasma river down the throat
  if (tunnel > .5){
    vec3 rs = raySeg(ro, rd, vec3(0, 0, ro.z + 5.), vec3(0, 0, ro.z - 900.));
    float n = fbm(vec3(rs.x*.3, (ro.z + rd.z*rs.y)*.02 + T*8., 0), 4);
    col += vec3(1., .45, .18)*(exp(-pow(rs.x/(1.2 + 1.5*n), 2.))*2.2 + exp(-rs.x*.5)*.05)*(.5 + .9*n);
  }
  // fighter aura and engines
  if (fOn > .5){
    float b = dot(fPos - ro, rd);
    float d = length(ro + rd*b - fPos);
    col += (vec3(.3, 1., .9)*exp(-pow(d/(fScale*.5), 2.))*.4 + vec3(1., .85, .5)*exp(-d/(fScale*1.2))*.15)*step(b, tHit + fScale);
    for (int s = -1; s <= 1; s += 2){
      vec3 e = fPos + fRot*vec3(.1*float(s), 0, -.44)*fScale;
      float be = dot(e - ro, rd);
      float de = length(ro + rd*be - e);
      col += vec3(.4, 1., .9)*(exp(-pow(de/(fScale*.03), 2.))*6. + exp(-de/(fScale*.15))*.3)*step(be, tHit + fScale);
    }
  }
  // the Heartseed flies
  if (seedT > 0.){
    float k = ease(clamp(seedT/1.3, 0., 1.));
    vec3 sp = mix(seedA, seedB, k);
    float b = dot(sp - ro, rd);
    float d = length(ro + rd*b - sp);
    vec3 sc = vec3(.5, 1., .9);
    col += sc*(exp(-d*d*.8)*6. + exp(-d*.25)*.4)*step(seedT, 1.35);
    vec3 rs = raySeg(ro, rd, seedA, sp);
    col += sc*exp(-pow(rs.x/.3, 2.))*rs.z*1.5*step(seedT, 1.35);
    float hitT = seedT - 1.3;
    if (hitT > 0.){
      float bb = dot(seedB - ro, rd);
      float dd = length(ro + rd*bb - seedB);
      col += mix(sc, vec3(1., .9, .6), .5)*(exp(-dd*dd/(1. + hitT*60.))*5.*exp(-hitT*.8) + exp(-abs(dd - hitT*25.)*.4)*exp(-hitT*1.)*1.5);
    }
  }
  // the cage breaks: shockwave and beams of freed light
  if (breakT > 0.){
    float b = dot(-ro, rd);
    float d = length(ro + rd*b);
    vec3 sc = mix(vec3(.5, 1., .9), vec3(1., .9, .6), .6);
    col += sc*exp(-abs(d - breakT*22.)*.3)*exp(-breakT*.5)*1.5;
    vec3 dir = normalize(ro + rd*b + vec3(1e-4));
    float ang = atan(dot(dir, cam[1]), dot(dir, cam[0]));
    float beams = pow(fbm(vec3(ang*7., 0., 3.), 3), 4.)*20.;
    vec3 bc = mix(vec3(.3, 1., .9), vec3(1., .75, .35), step(.5, fract(ang*3.18)));
    col += bc*beams*exp(-d*.02)*smoothstep(.5, 3., breakT)*.6;
    col += vec3(1.)*smoothstep(4.5, 6., breakT)*3.;
  }
  // vision grade: memory-like wash
  if (vision > .5){
    float L = dot(col, vec3(.3, .5, .2));
    col = mix(col, vec3(L)*vec3(1., .75, .6), .25*(1. - kessarFocus));
    col += vec3(.4, .15, .05)*.05;
  }
  return col;
}
