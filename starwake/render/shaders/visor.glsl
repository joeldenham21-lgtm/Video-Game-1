// The face: extreme close-ups of Asha inside her helmet, lit by what she sees.
// uP0.x: 1 = the Veil Reach, before we see it (V1); 2 = the cage of suns, humming (V2)
#include "common.glsl"

vec3 camPos, camTar; float camFov = 1.4;
float V = 1.;
const vec3 HC = vec3(0, .012, -.006);   // helmet centre
const float HR = .168;

// ---------------------------------------------------------------- what she sees
vec3 skyGen(vec3 rd){
  if (uP0.x < 1.5) return nebula(rd, vec3(.12, .25, .65), vec3(.45, .12, .55), vec3(.05, .45, .5), 1.3, 42.);
  return vec3(0);
}
float noteGlow(float t){
  // Kessar's sun answers each note of the song (HUM3 starts at 3.0 s, tempo 1.2)
  float g = 0.;
  float s0 = 3.0;
  float on[4] = float[4](0., .96, 1.92, 3.6);
  for (int i = 0; i < 4; i++){
    float a = t - (s0 + on[i]);
    g += step(0., a)*exp(-a*1.2)*(.4 + .2*float(i));
  }
  return g + smoothstep(6.5, 10., t)*.9;
}
vec3 env(vec3 rd, float t){
  if (V < 1.5){
    vec3 c = starfield(rd, .8) + sky(rd);
    // Veyra, glowing, filling her view
    vec3 pd = normalize(vec3(-.35, .02, 1.));
    float ang = acos(clamp(dot(rd, pd), -1., 1.));
    float R = .5;
    if (ang < R){
      vec3 X = normalize(cross(pd, vec3(0, 1, 0))), Y = cross(X, pd);
      vec2 sp = vec2(dot(rd, X), dot(rd, Y))/R;
      vec3 n = vec3(sp, sqrt(max(1. - dot(sp, sp), 0.)));
      float f1 = fbm(n*3. + 1., 5);
      float lines = exp(-abs(f1 - .5)*40.);
      c = mix(vec3(.01, .03, .08), vec3(.1, .9, .85), lines*.9) + vec3(.4, .3, 1.)*lines*.3;
      c += vec3(.4, .6, 1.)*pow(1. - n.z, 4.)*1.5;
    }
    c += sunGlow(rd, normalize(vec3(.6, .25, 1.)), .01, vec3(.6, .8, 1.), .6);
    // the warp exit flash
    c += vec3(.8, .9, 1.)*exp(-t*3.)*4.;
    return c;
  }
  // the cage of stolen suns
  vec3 c = vec3(.02, .01, .005);
  vec3 q = rd*14.;
  vec3 id = floor(q); vec3 f = fract(q) - .5;
  float h = hash13(id);
  c += blackbody(mix(3., 18., h))*exp(-dot(f, f)*30.)*step(.6, h)*1.2;
  float bars = exp(-abs(fract(atan(rd.x, rd.z)*4.) - .5)*40.) + exp(-abs(fract(rd.y*6.) - .5)*40.);
  c = mix(c, vec3(.03, .02, .02), clamp(bars*.5, 0., .8));
  vec3 kd = normalize(vec3(-.1, .05, 1.));
  float ka = acos(clamp(dot(rd, kd), -1., 1.));
  float g = noteGlow(t);
  c += vec3(1., .4, .12)*(smoothstep(.09, .07, ka)*(1.5 + 2.*g) + exp(-ka*8.)*(.4 + g));
  return c;
}
vec3 keyDir(){ return V < 1.5 ? normalize(vec3(-.35, .05, 1.)) : normalize(vec3(-.1, .08, 1.)); }
vec3 keyCol(float t){
  if (V < 1.5) return mix(vec3(.25, .7, .9), vec3(.5, .45, 1.), .3)*(1.2*smoothstep(.2, 2.5, t) + exp(-t*3.)*6.);
  return vec3(1., .45, .15)*(.35 + 1.1*noteGlow(t));
}

// ---------------------------------------------------------------- the face
float gM = 0.;
float face(vec3 p){
  vec3 q = p;
  q.x *= 1. + .18*smoothstep(0., -.1, q.y);        // narrower jaw
  float d = sdEllipsoid(q, vec3(.07, .097, .086));
  d = smin(d, sdCapsule(p, vec3(-.034, .036, .07), vec3(.034, .036, .07), .011), .012);       // brow
  vec3 m = vec3(abs(p.x), p.yz);
  d = smax(d, -(length(m - vec3(.031, .017, .085)) - .016), .008);                           // sockets
  d = smin(d, sdEllipsoid(m - vec3(.04, -.014, .058), vec3(.028, .022, .028)), .02);          // cheeks
  d = smin(d, sdCapsule2(p, vec3(0, .028, .083), vec3(0, -.012, .1), .006, .011), .01);       // nose
  d = smin(d, sdEllipsoid(p - vec3(0, -.016, .092), vec3(.016, .009, .011)), .006);           // nostrils
  float lips = sdEllipsoid(p - vec3(0, -.043, .084), vec3(.021, .0085, .011));
  d = smin(d, lips, .008);
  d = smax(d, -sdBox(p - vec3(0, -.0435, .095), vec3(.016, .0007, .01)), .002);             // mouth line
  d = smin(d, sdEllipsoid(p - vec3(0, -.073, .066), vec3(.028, .022, .026)), .014);          // chin
  d = smin(d, sdCapsule(p, vec3(0, -.08, -.01), vec3(0, -.2, -.02), .045), .03);             // neck
  // comm cap over the hair
  float cap = sdEllipsoid(p - vec3(0, .014, -.01), vec3(.079, .1, .092));
  cap = max(cap, -(p.y - .045 + (p.z - .05)*.4));
  cap = max(cap, p.z - .075);
  if (cap < d) gM = 3.; else gM = 1.;
  d = min(d, cap);
  // eyes
  float eye = length(m - vec3(.031, .016, .068)) - .0118;
  if (eye < d){ gM = 2.; }
  return min(d, eye);
}
float helmet(vec3 p){
  vec3 r = p - HC;
  float l = length(r);
  vec3 q = r/max(l, 1e-4);
  float shell = abs(l - HR - .006) - .006;
  float open = max(.3 - q.z, abs(q.y + .05) - .5)*HR;
  shell = max(shell, -open);
  float ring = sdTorus(p - vec3(0, -.165, -.012), vec2(.105, .022));
  return min(shell, ring);
}
float mapF(vec3 p){
  float h = helmet(p);
  float f = face(p);
  float fm = gM;
  if (h < f){ gM = 4.; return h; }
  gM = fm;
  return f;
}
vec3 normalF(vec3 p){
  vec2 k = vec2(1, -1)*.0004;
  return normalize(k.xyy*mapF(p + k.xyy) + k.yyx*mapF(p + k.yyx) + k.yxy*mapF(p + k.yxy) + k.xxx*mapF(p + k.xxx));
}

vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  V = uP0.x;
  float u = t/uD;
  // slow push in, a breath of drift
  vec3 br = vec3(.002*sin(t*.9), .0015*sin(t*1.3), 0);
  if (V < 1.5){ camPos = vec3(.14 - .04*u, .02, .5 - .1*u); camTar = vec3(-.01, .012, .03); }
  else { camPos = vec3(-.13 + .03*u, .015, .48 - .1*u); camTar = vec3(.005, .012, .03); }
  vec3 ro = camPos + br;
  mat3 cam = camLook(ro, camTar + br, 0.);
  vec3 rd = cam*normalize(vec3(uv, camFov));

  // background: the cockpit, dark, with instrument glints
  vec3 col = vec3(.004, .005, .008) + vec3(.1, .35, .5)*.015*step(.93, hash12(floor(uv*40.)));
  vec3 K = keyDir();
  vec3 Kc = keyCol(t);

  // the visor glass
  vec2 vh = sphIntersect(ro, rd, HC, HR - .002);
  vec3 visorAdd = vec3(0); float visorT = 1.;
  if (vh.x > 0.){
    vec3 vp = ro + rd*vh.x;
    vec3 q = normalize(vp - HC);
    if (q.z > .3 && abs(q.y + .05) < .5){
      vec3 n = q;
      float fr = .08 + .92*pow(1. - max(dot(-rd, n), 0.), 4.);
      vec3 rr = reflect(rd, n);
      float dust = .85 + .15*fbm(vec3(q.xy*60., 1.), 3) + .3*step(.985, hash12(floor(q.xy*400.)));
      visorAdd = env(rr, t)*(fr*.9 + (V < 1.5 ? .07 : .1))*vec3(.95, .9, .8)*dust;
      visorT = (1. - fr)*.75;
    }
  }
  // the face and helmet
  float tt = .2, hit = -1.;
  for (int i = 0; i < 140; i++){
    float d = mapF(ro + rd*tt);
    if (d < .00008){ hit = tt; break; }
    tt += d*.85;
    if (tt > 1.2) break;
  }
  if (hit > 0.){
    vec3 p = ro + rd*hit;
    float m = gM;
    vec3 n = normalF(p);
    float nd = dot(n, K);
    float fres = pow(1. - max(dot(n, -rd), 0.), 3.);
    vec3 rimDir = normalize(vec3(.8, .3, -.5));
    vec3 hud = vec3(.2, .7, 1.)*.04*smoothstep(-.02, -.09, p.y)*step(.0, p.z);
    vec3 c;
    if (m == 1.){          // skin: wrapped diffuse with a warm terminator (subsurface)
      float wrap = max((nd + .35)/1.35, 0.);
      vec3 sss = vec3(1., .35, .25)*smoothstep(.0, .35, wrap)*smoothstep(.7, .3, wrap)*.35;
      vec3 alb = vec3(.5, .37, .32);
      float fall = smoothstep(-.02, .06, dot(p, normalize(vec3(-.3, .2, 1.))))*(V < 1.5 ? 1.6 : .75);   // light falls off across the face
      c = alb*(Kc*wrap*.32*fall + Kc*sss*.5*fall) + alb*hud*2. + alb*vec3(.008, .008, .012);
      c += vec3(.55, .3, .25)*pow(max(dot(n, rimDir), 0.), 3.)*.12;
      c += Kc*pow(max(dot(reflect(rd, n), K), 0.), 24.)*.08;
      c += vec3(.5, .5, .6)*fres*.04;
      if (V > 1.5){  // a tear catching the light
        float tear = smoothstep(.001, .0, abs(p.x + .032 - (p.y - .002)*.08))*step(-.02, p.y)*step(p.y, .002)*smoothstep(7.5, 9., t)*smoothstep(-.02, -.012, p.y + .003*sin(t*2.));
        c += Kc*tear*1.2;
      }
    } else if (m == 2.){   // eyes: dark iris, and the world reflected in them
      vec3 m3 = vec3(abs(p.x), p.yz);
      vec3 ec = vec3(.031, .016, .068);
      vec3 en = normalize(m3 - ec);
      float look = dot(en, normalize(vec3(-.1*sign(p.x), .05, 1.)));
      vec3 iris = mix(vec3(.9, .9, .88), vec3(.12, .08, .05), smoothstep(.82, .88, look));
      iris = mix(iris, vec3(.01), smoothstep(.95, .965, look));
      c = iris*Kc*.1 + env(reflect(rd, n), t)*.3;
      c += Kc*pow(max(dot(reflect(rd, n), K), 0.), 200.)*6.;
      // blink
      float bl = V < 1.5 ? exp(-pow((t - 4.4)*9., 2.)) : exp(-pow((t - 9.6)*7., 2.));
      c = mix(c, vec3(.35, .25, .22)*Kc*.3, bl);
    } else if (m == 3.){   // comm cap
      c = vec3(.03, .03, .035)*(Kc*max(nd, 0.) + .02) + Kc*fres*.05;
    } else {               // helmet shell
      vec3 alb = vec3(.06, .06, .065);
      vec3 hq = normalize(p - HC);
      if (abs(hq.x + .35) < .04 && hq.y > 0.) alb = vec3(.35, .05, .03);   // Throne stripe
      c = alb*(Kc*max(nd, 0.)*.8 + .015) + Kc*pow(max(dot(reflect(rd, n), K), 0.), 40.)*.25;
      c += vec3(.8, .3, .2)*pow(max(dot(n, rimDir), 0.), 4.)*.05;
    }
    col = c;
  }
  if (vh.x > 0. && (hit < 0. || vh.x < hit)) col = col*visorT + visorAdd;
  return col;
}
