// Inside the great tree: the chamber of the Heartseed.
// uP0.x: 1 = approach (S26), 2 = the hand (S27), 3 = beside the seed (S29)
#include "common.glsl"
#include "figures.glsl"

vec3 camPos, camTar; float camFov = 1.7;
int chN = 0; vec3 chPos[2]; float chYaw[2]; int chKind[2]; vec4 chPose[2];
vec3 seedPos = vec3(0, 3.6, 0);
float seedPow = 1.; float touch = 0.;
float handOn = 0.; vec3 handPos; float handReach = 0.;

vec3 bioColor(float k){ return mix(vec3(.1, 1., .85), vec3(.5, .35, 1.), k); }
vec3 seedCol(){ return mix(vec3(.35, 1., .9), vec3(1., .85, .5), .35); }

void setup(float t){
  int V = int(uP0.x + .5);
  float u = t/uD;
  if (V == 1){
    chN = 2;
    float w = remap(t, 0., 9.);
    chKind[0] = 1; chPos[0] = mix(vec3(-.8, 0, 16.), vec3(-1.2, 0, 4.6), w); chYaw[0] = 3.14159; chPose[0] = vec4(t*3.2, 1. - smoothstep(.85, 1., w), .15, 0);
    chKind[1] = 0; chPos[1] = mix(vec3(1., 0, 17.5), vec3(1.1, 0, 5.8), w); chYaw[1] = 3.14159; chPose[1] = vec4(t*4.4, 1. - smoothstep(.85, 1., w), .35*smoothstep(.5, 1., w), 0);
    camPos = vec3(.6, 1.7 + .6*u, 22. - 5.*u); camTar = vec3(0, 3.2, 0); camFov = 1.6;
  }
  if (V == 2){
    handOn = 1.;
    handReach = ease(remap(t, .3, 4.2));
    touch = smoothstep(4.0, 4.4, t);
    seedPow = .35 + touch*2.2*exp(-max(t - 4.4, 0.)*.9);
    camPos = vec3(.42, 3.42, 1.55); camTar = vec3(0, 3.55, 0); camFov = 1.8;
    handPos = mix(vec3(.38, 3.12, 1.12), vec3(.1, 3.46, .58), handReach);
  }
  if (V == 3){
    chN = 2;
    chKind[0] = 1; chPos[0] = vec3(-1.3, 0, 2.2); chYaw[0] = 3.14159 + .5; chPose[0] = vec4(0, 0, .2, 0);
    chKind[1] = 0; chPos[1] = vec3(1.0, 0, 2.6); chYaw[1] = 3.14159 - .45; chPose[1] = vec4(0, 0, .3, 0);
    seedPow = 1.6;
    camPos = vec3(-3.5 + .6*u, 1.9, 8.5 - .8*u); camTar = vec3(.2, 2.6, 0); camFov = 1.7;
  }
}

// ---------------------------------------------------------------- geometry
float gMat = 0.; float gId = 0.;
float sdSeed(vec3 p){
  vec3 q = p - seedPos;
  q.xz = rot(uGlobalT*.25)*q.xz;
  q.y /= 1.7;
  float d = sdOcta(q, .55)*1.2;
  vec3 r = q; r.xz = rot(.785)*r.xz;
  d = max(d, sdOcta(r, .6)*1.2);
  return d;
}
float sdHand(vec3 p){
  // a gloved right hand, palm facing the seed, fingers reaching
  vec3 q = p - handPos;
  q.xz = rot(-.5)*q.xz;
  q.yz = rot(.35)*q.yz;
  float palm = sdRoundBox(q, vec3(.045, .052, .014), .012);
  float curl = (1. - handReach)*.8;
  float d = palm;
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    float x = -.033 + fi*.022;
    float len = (i == 1 || i == 2) ? .05 : .042;
    vec3 a = vec3(x, .05, 0);
    vec3 b = a + vec3(0, len*cos(curl), -len*sin(curl));
    vec3 c = b + vec3(0, len*.85*cos(curl*1.6), -len*.85*sin(curl*1.6));
    d = min(d, sdCapsule(q, a, b, .0095));
    d = min(d, sdCapsule(q, b, c, .0085));
  }
  d = min(d, sdCapsule(q, vec3(-.045, -.01, 0), vec3(-.075, .03, -.02), .011));
  d = min(d, sdCapsule2(q, vec3(0, -.05, 0), vec3(.02, -.35, .05), .03, .04));  // wrist, sleeve
  return d;
}
float mapC(vec3 p){
  gMat = 0.;
  // hollow trunk: wall of braided root fibres
  float a = atan(p.z, p.x);
  float R = 11. + 1.2*sin(a*5. + p.y*.2) + .5*sin(a*17. - p.y*.6);
  float fib = .35*abs(sin(a*28. + p.y*.35 + 1.5*sin(p.y*.1)));
  float wall = R - length(p.xz) - fib;
  // entrance arch toward +z
  float ent = length(vec2(p.x, max(p.y - 3., 0.))) - 3.2;
  wall = max(wall, -max(ent, -p.z));
  float d = wall*.8;
  gMat = 1.;
  // floor roots
  float roots = p.y + .25 - .35*abs(sin(p.x*.8 + sin(p.z*.5)*2.)) - .2*vnoise(p*1.5);
  if (roots < d){ d = roots; gMat = 1.; }
  float s = sdSeed(p);
  if (s < d){ d = s; gMat = 2.; }
  for (int i = 0; i < 2; i++){
    if (i >= chN) break;
    vec3 q = p - chPos[i];
    q.xz = rot(chYaw[i])*q.xz;
    float bs = length(q - vec3(0, 1.3, 0)) - 1.7;
    float dc = bs > .3 ? bs : (chKind[i] == 0 ? sdAsha(q, chPose[i]) : sdAurai(q, chPose[i], float(i) + 3.));
    if (dc < d){ d = dc; gMat = chKind[i] == 0 ? 4. : 5.; gId = float(i); }
  }
  if (handOn > .5){
    float h = sdHand(p);
    if (h < d){ d = h; gMat = 6.; }
  }
  return d;
}
vec3 normalC(vec3 p, float e){
  vec2 k = vec2(1, -1);
  return normalize(k.xyy*mapC(p + k.xyy*e) + k.yyx*mapC(p + k.yyx*e) + k.yxy*mapC(p + k.yxy*e) + k.xxx*mapC(p + k.xxx*e));
}

// ---------------------------------------------------------------- render
vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  setup(t);
  vec3 ro = camPos;
  mat3 cam = camLook(ro, camTar, 0.);
  vec3 rd = cam*normalize(vec3(uv, camFov));
  float T = uGlobalT;
  vec3 sc = seedCol();

  float tt = .02; float hit = -1.;
  for (int i = 0; i < 160; i++){
    float d = mapC(ro + rd*tt);
    if (abs(d) < .0006*tt + .0004){ hit = tt; break; }
    tt += d*.8;
    if (tt > 80.) break;
  }
  vec3 col = vec3(0);
  float tHit = hit > 0. ? hit : 1e9;
  if (hit > 0.){
    vec3 p = ro + rd*hit;
    float m = gMat; float id = gId;
    vec3 n = normalC(p, .0008 + hit*.0006);
    vec3 L = seedPos - p;
    float dl = length(L); L /= dl;
    float fall = seedPow*14./(dl*dl + 2.);
    float dif = max(dot(n, L), 0.);
    float fres = pow(1. - max(dot(n, -rd), 0.), 4.);
    if (m == 1.){
      vec3 alb = mix(vec3(.1, .08, .09), vec3(.2, .16, .15), vnoise(p*.8));
      col = alb*(dif*fall*sc + vec3(.02, .035, .05));
      float v = exp(-abs(fbm(p*.25, 4) - .5)*90.)*smoothstep(.45, .65, vnoise(p*.1 + 3.));
      float trav = .5 + .5*sin(T*1.5 - length(p - seedPos)*.4);
      col += bioColor(vnoise(p*.05))*v*(.2 + 1.2*pow(trav, 3.))*(.6 + .4*seedPow);
      // pool of light on the floor
      if (p.y < .3) col += bioColor(.25)*exp(-length(p.xz)*.35)*.15*seedPow;
    } else if (m == 2.){
      vec3 q = p - seedPos;
      q.xz = rot(uGlobalT*.25)*q.xz;
      // facets: quantised normal gives each face its own brightness
      vec3 fn = floor(n*2.5 + .5);
      float facet = .55 + .45*hash13(fn + 3.);
      // luminous inner veins and a bright heart
      float inner = fbm(q*4.5 + vec3(0, T*.4, 0), 5);
      float veinsI = exp(-abs(inner - .5)*22.);
      float heart = exp(-length(q*vec3(1., .6, 1.))*4.);
      float edge = pow(fres, .7);
      col = sc*(.18*facet + veinsI*1.4 + heart*2.2)*seedPow*2.2 + vec3(.9, 1., 1.)*edge*.8*seedPow;
      col += vec3(1., .85, .5)*pow(max(dot(reflect(rd, n), normalize(vec3(.3, 1., .2))), 0.), 30.)*.6;
    } else if (m == 6.){
      vec3 alb = vec3(.05, .05, .055);
      col = alb*(dif*fall*sc*1.5 + .01) + sc*fres*fall*.6;
      col += sc*touch*.4*exp(-length(p - handPos - vec3(0, .1, -.05))*20.);
    } else {
      int i = int(id);
      vec3 q = p - chPos[i];
      q.xz = rot(chYaw[i])*q.xz;
      vec3 alb = m == 4. ? vec3(.07, .07, .08) : vec3(.05, .06, .1);
      col = alb*(dif*fall*sc*1.4 + .01) + sc*fres*fall*.25;
      if (m == 5.) col += bioColor(.3)*auraiMarks(q, float(i) + 3.)*1.3;
    }
  }
  // seed glow and god rays through the dust
  vec3 rs = seedPos - ro;
  float b = dot(rs, rd);
  if (b > 0.){
    float d = length(ro + rd*b - seedPos);
    float vis = b < tHit + .5 ? 1. : .0;
    col += sc*(exp(-d*d*6.)*1.6 + exp(-d*.9)*.25)*seedPow*vis;
    vec3 dirv = normalize(ro + rd*b - seedPos);
    float ang = atan(dirv.y, length(dirv.xz)) + atan(dirv.z, dirv.x)*.3;
    float shafts = pow(fbm(vec3(ang*6., T*.1, 0), 3), 3.)*exp(-d*.25)*.6;
    col += sc*shafts*seedPow*.5;
  }
  // floating spores
  vec3 fwd = normalize(camTar - camPos);
  for (int k = 0; k < 6; k++){
    float dist = .8*pow(1.7, float(k));
    float tq = dist/dot(rd, fwd);
    if (tq > tHit) break;
    vec3 p = ro + rd*tq + vec3(0, -T*.2, 0);
    vec3 X = normalize(cross(fwd, vec3(0, 1, 0))), Y = cross(X, fwd);
    vec2 q = vec2(dot(p, X), dot(p, Y))*(3./dist);
    vec2 c = floor(q); vec2 f = fract(q) - .5 - (hash22(c + float(k)*9.) - .5)*.7;
    float h = hash12(c + float(k));
    col += mix(bioColor(h*.5), sc, .5)*exp(-dot(f, f)*1600.)*step(.8, h)*(.6 + .4*sin(T*2. + h*30.))*.9*smoothstep(.7, 2., dist);
  }
  // touch: a bloom of light washes through
  col += sc*touch*exp(-max(t - 4.4, 0.)*2.)*.35*step(.5, handOn);
  return col;
}
