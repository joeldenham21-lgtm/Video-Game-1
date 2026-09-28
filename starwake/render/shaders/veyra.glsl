// STARWAKE -- the surface of Veyra. uP0.x selects the staging.
#include "common.glsl"
#include "ships.glsl"
#include "figures.glsl"

// ---------------------------------------------------------------- staging state
vec3 camPos, camTar; float camFov = 1.8, camRoll = 0.;
vec3 sunDir = vec3(0, .2, -1); vec3 sunCol = vec3(1.); float sunI = 1.;
vec3 skyTop = vec3(.05, .1, .3), skyHor = vec3(.4, .5, .8);
float night = 0.;          // stars and bioluminescence
float redSky = 0.;         // the harvest
float storm = 0.;
float flash = 0.; vec3 flashPos = vec3(0);
vec3 ggDir = normalize(vec3(-.5, .25, -1.)); float ggSize = .22; float ggOn = 1.;
float fogD = .00012; vec3 fogCol = vec3(.4, .5, .8);
// world
float oceanOn = 1.; float bio = 0.; float waveAmp = 1.;
float cloudSea = 0.; float cloudY = 600.;
float treesOn = 1.; float treeGlow = .5; float ignite = 0.; float treeCell = 5200.;
float rootsOn = 0.; vec3 rootOrigin = vec3(0);
float sporeAmt = 0.;
// fighter / wreck
float fOn = 0.; vec3 fPos = vec3(0); mat3 fRot = mat3(1.); float fScale = 14.; vec3 fEng = vec3(1., .35, .15);
float fAura = 0.; float fTrail = 0.; float fSmoke = 0.; float fEntry = 0.;
float wreckOn = 0.; vec3 wreckPos; mat3 wreckRot = mat3(1.);
float splash = -1.; vec3 splashPos = vec3(0);
// characters
int chN = 0; vec3 chPos[6]; float chYaw[6]; int chKind[6]; vec4 chPose[6]; float chGlow[6];
// epilogue
float podFall = -1.; float newStars = 0.; float pillar = 0.; vec3 pillarPos = vec3(0);
float rain = 0.; float boltT = -1.; vec3 boltTop, boltBot; float hit = 0.; float starRibbon = 0.;
vec3 podStart, podEnd;
float hideRoot = 0.;

mat3 basisZ(vec3 fwd, vec3 up){ vec3 z = normalize(fwd); vec3 x = normalize(cross(up, z)); return mat3(x, cross(z, x), z); }

void setup(float t){
  int V = int(uP0.x + .5);
  float u = t/uD;
  for (int i = 0; i < 6; i++){ chPos[i] = vec3(0); chYaw[i] = 0.; chKind[i] = 0; chPose[i] = vec4(0); chGlow[i] = 1.; }
  vec3 UP = vec3(0, 1, 0);

  if (V == 1){ // S17: above the cloud sea at dusk -- the lanterntrees
    sunDir = normalize(vec3(.45, .06, -1.)); sunCol = vec3(1., .6, .35); sunI = 1.3;
    skyTop = vec3(.03, .05, .2); skyHor = vec3(.85, .38, .3);
    night = .25; cloudSea = 1.; cloudY = 600.; oceanOn = 0.;
    fogD = .000022; fogCol = vec3(.6, .38, .42);
    ggDir = normalize(vec3(-.6, .17, -1.)); ggSize = .2;
    treeGlow = .8;
    camPos = vec3(1800. + 900.*u, 1500. - 80.*u, 5600. - 1800.*u); camTar = camPos + vec3(.3, .02, -1.)*1000.; camFov = 1.7; camRoll = -.03;
    fOn = 1.; fScale = 14.;
    fPos = camPos + vec3(40. + 300.*u, -50. - 40.*u, -260. - 500.*u);
    fRot = basisZ(vec3(.35, -.1, -1.), vec3(-.3, 1, 0)); fTrail = 1.;
  }
  if (V == 2){ // S20: night; the wreck in the glowing shallows beneath the roots
    sunI = 0.; night = 1.; bio = 1.; cloudSea = 0.; treeGlow = 1.;
    skyTop = vec3(.005, .01, .03); skyHor = vec3(.02, .05, .09);
    fogD = .0012; fogCol = vec3(.02, .08, .11);
    ggDir = normalize(vec3(.3, .32, -1.)); ggSize = .16;
    rootsOn = 1.; rootOrigin = vec3(0);
    rootOrigin = vec3(0, 0, 0);
    wreckOn = 1.; wreckPos = vec3(-7.5, .6, -22.); wreckRot = basisZ(vec3(.6, -.25, -1.), vec3(.4, 1, .1));
    fScale = 12.; fSmoke = 1.;
    chN = 1; chKind[0] = 0; chPos[0] = vec3(1.2, -.12, -20.); chYaw[0] = 3.1; chPose[0] = vec4(0, 0, .45*ease(remap(t, 3.5, 7.)), 0.);
    sporeAmt = 1.;
    camPos = vec3(2.6 - .5*u, 1.0 + .1*u, -5. - 3.*u); camTar = vec3(-.8, 2.6 + .6*u, -60.); camFov = 1.65;
  }
  // shared night cathedral look for S21-S25
  if (V >= 6 && V <= 9){
    sunI = 0.; night = 1.; bio = 1.; cloudSea = 0.; treeGlow = 1.;
    skyTop = vec3(.005, .01, .03); skyHor = vec3(.02, .05, .09);
    fogD = .0012; fogCol = vec3(.02, .08, .11);
    ggDir = normalize(vec3(.3, .32, -1.)); ggSize = .16;
    rootsOn = 1.; rootOrigin = vec3(0);
    wreckOn = 1.; wreckPos = vec3(-7.5, .6, -22.); wreckRot = basisZ(vec3(.6, -.25, -1.), vec3(.4, 1, .1)); fScale = 12.; fSmoke = 1.;
    sporeAmt = 1.;
  }
  if (V == 3){ // S16: atmospheric entry at dusk, high above the cloud sea
    sunDir = normalize(vec3(.6, .03, -1.)); sunCol = vec3(1., .55, .3); sunI = 1.3;
    skyTop = vec3(.0, .005, .03); skyHor = vec3(.7, .32, .3);
    night = .8; cloudSea = 1.; cloudY = 600.; oceanOn = 0.; treeGlow = .8;
    fogD = .00003; fogCol = vec3(.45, .3, .4);
    ggDir = normalize(vec3(-.7, .12, -1.)); ggSize = .22;
    camPos = vec3(0, 9000. - 2500.*u, 9000. - 3000.*u); camTar = camPos + vec3(.05, -.42, -1.)*1000.; camFov = 1.55; camRoll = .1*sin(t*.6);
    camPos += shake(t, 3. + 8.*smoothstep(3., 6., t));
    fOn = 1.; fScale = 14.;
    fPos = camPos + vec3(4., -18. - 6.*u, -50. - 8.*u);
    fRot = basisZ(vec3(.02, -.45, -1.), vec3(.15*sin(t*.8), 1, 0));
    fEntry = smoothstep(2.5, 6., t);
  }
  if (V == 4){ // S18: the living storm
    sunI = .15; sunDir = normalize(vec3(.3, .4, -1.)); sunCol = vec3(.6, .7, 1.);
    skyTop = vec3(.02, .025, .04); skyHor = vec3(.08, .09, .13);
    storm = 1.; night = .2; cloudSea = 1.; cloudY = 900.; oceanOn = 0.; treeGlow = .6;
    fogD = .0003; fogCol = vec3(.08, .09, .12);
    ggOn = 0.; rain = 1.;
    camPos = vec3(0, 1700. - 30.*u, 2000. - 1200.*u); camTar = camPos + vec3(-.05, -.08, -1.)*100.;
    fOn = 1.; fScale = 14.;
    fPos = camPos + vec3(2. + 3.*sin(t*.9), -7. + 2.*sin(t*1.3), -48.);
    fRot = basisZ(vec3(.05*cos(t*.9), -.03, -1.), vec3(.4*sin(t*.9), 1, 0));
    hit = smoothstep(3.3, 3.4, t);
    if (hit > 0.){ fRot = basisZ(vec3(.2*sin(t*5.), -.2, -1.), vec3(sin(t*7.), 1, 0)); fEng = vec3(1., .35, .15)*(.4 + .6*step(.5, hash11(floor(t*14.)))); }
    camPos += shake(t, .6 + 3.*hit*exp(-(t - 3.4)*1.5));
    // lightning schedule
    float bt = mod(t, 2.3);
    boltT = t < 3.3 ? bt : t - 3.3;
    float bseed = t < 3.3 ? floor(t/2.3) : 9.;
    boltTop = camPos + vec3(-500. + 1000.*hash11(bseed), 420., -1700. - 500.*hash11(bseed + 1.));
    boltBot = t >= 3.3 ? fPos : boltTop + vec3(150., -1100., 80.);
    flash = exp(-boltT*6.)*(t >= 3.3 ? 2.5 : 1.);
    flashPos = boltBot;
  }
  if (V == 5){ // S19: the fall into the glowing sea
    sunI = 0.; night = .6; bio = 1.; storm = .6; cloudSea = 0.; treeGlow = 1.;
    skyTop = vec3(.01, .015, .03); skyHor = vec3(.05, .07, .1);
    fogD = .0004; fogCol = vec3(.03, .07, .1); rain = .6;
    ggOn = 0.;
    camPos = vec3(-35., 3.5, 70.); camTar = mix(vec3(30., 90., -30.), vec3(-10., 3., -10.), ease(remap(t, .5, 4.6))); camFov = 1.45;
    fOn = t < 4.4 ? 1. : 0.; fScale = 14.;
    float fall = clamp(t/4.4, 0., 1.);
    fPos = vec3(80. - 90.*fall, 160.*(1. - fall*fall) + 2., -40. + 30.*fall);
    fRot = basisZ(vec3(-.7, -1.2*fall - .3, .3), vec3(sin(t*4.), cos(t*4.), 0));
    fEng = vec3(1., .4, .15)*step(.5, hash11(floor(t*16.)));
    fSmoke = 1.;
    splash = t > 4.4 ? t - 4.4 : -1.; splashPos = vec3(-10., 0, -10.);
    flash = splash > 0. ? exp(-splash*3.)*3. : 0.; flashPos = splashPos + vec3(0, 5, 0);
    camPos += shake(t, .3 + (splash > 0. ? 2.*exp(-splash*2.) : 0.));
  }
  if (V == 6){ // S21: the Aurai emerge
    chN = 6;
    chKind[0] = 0; chPos[0] = vec3(1.6, -.12, -17.5); chYaw[0] = 3.14; chPose[0] = vec4(0, 0, .25, 0);
    for (int i = 1; i < 6; i++){
      float fi = float(i);
      chKind[i] = 1;
      chPos[i] = vec3(-12. + fi*4.6 + 2.*sin(fi*3.), -.12, -40. - 6.*hash11(fi*2.7));
      chYaw[i] = 0.;
      chGlow[i] = smoothstep(1. + fi*.7, 2.5 + fi*.7, t);
      chPose[i] = vec4(0, 0, -.1, 0);
    }
    float walk = remap(t, 4., 11.5);
    chPos[1] = mix(vec3(-3., -.12, -42.), vec3(-.4, -.12, -25.), walk);
    chPose[1] = vec4(t*3.2, 1. - smoothstep(.9, 1., walk), -.15, 0);
    chYaw[1] = .15;
    camPos = vec3(3.6, 1.45, -12.6); camTar = vec3(-.5, 1.8, -32.); camFov = 1.6;
  }
  if (V == 7){ // S22: face to face
    chN = 2;
    chKind[0] = 0; chPos[0] = vec3(-1.05, -.12, -22.); chYaw[0] = 1.5708; chPose[0] = vec4(0, 0, .42, 0);
    chKind[1] = 1; chPos[1] = vec3(1.05, -.12, -22.); chYaw[1] = -1.5708; chPose[1] = vec4(0, 0, -.28 + .05*sin(t*.5), 0);
    camPos = vec3(-.2 + .3*u, 1.55, -17. - .5*u); camTar = vec3(0, 1.8, -22.); camFov = 1.75;
  }
  if (V == 8){ // S24: walking beneath the roots
    chN = 2;
    float x = -7. + 13.*u;
    chKind[0] = 0; chPos[0] = vec3(x, -.12, -21.4); chYaw[0] = 1.5708; chPose[0] = vec4(t*4.6, 1., .25, 0);
    chKind[1] = 1; chPos[1] = vec3(x + 1.3, -.12, -22.3); chYaw[1] = 1.5708; chPose[1] = vec4(t*3.4 + 1., 1., -.1, 0);
    camPos = vec3(x - 1.5, 1.6, -13.5); camTar = vec3(x + .6, 1.9, -22.); camFov = 1.7;
  }
  if (V == 9){ // S25: looking out over the living sea
    chN = 2;
    chKind[0] = 0; chPos[0] = vec3(-.55, -.12, -24.); chYaw[0] = 3.14159; chPose[0] = vec4(0, 0, .12, 0);
    chKind[1] = 1; chPos[1] = vec3(.75, -.12, -24.4); chYaw[1] = 3.14159; chPose[1] = vec4(0, 0, -.05, 0);
    camPos = vec3(.2 - .4*u, 1.3, -17.5 - .8*u); camTar = vec3(.1, 2.6, -80.); camFov = 1.7;
  }
  if (V == 10){ // S32: the sky burns; the Aurai sing
    sunDir = normalize(vec3(-.2, .35, -1.)); sunCol = vec3(1., .35, .15); sunI = .8;
    skyTop = vec3(.1, .02, .02); skyHor = vec3(.6, .15, .06); redSky = 1.;
    night = .1; bio = 1.; treeGlow = 1.; ignite = ease(remap(t, 5., 11.));
    fogD = .0009; fogCol = vec3(.25, .06, .04);
    ggDir = normalize(vec3(.5, .3, -1.)); ggSize = .16;
    rootsOn = 1.; rootOrigin = vec3(0);
    starRibbon = 1.;
    chN = 6;
    for (int i = 0; i < 6; i++){
      float fi = float(i);
      chKind[i] = 1;
      chPos[i] = vec3(-11. + fi*4.3, -.12, -27. - 3.*sin(fi*1.7));
      chYaw[i] = 0.;
      chPose[i] = vec4(0, 0, .35, ease(remap(t, 2. + fi*.4, 5. + fi*.4)));
      chGlow[i] = 1. + ignite*1.5;
    }
    camPos = vec3(0, .9 + .3*u, -7. - 3.*u); camTar = vec3(0, 6., -60.); camFov = 1.55;
  }
  if (V == 11){ // S33: the fighter rises, wreathed in light
    sunDir = normalize(vec3(-.2, .35, -1.)); sunCol = vec3(1., .35, .15); sunI = .8;
    skyTop = vec3(.1, .02, .02); skyHor = vec3(.6, .15, .06); redSky = 1.;
    night = .1; bio = 1.; treeGlow = 1.; ignite = 1.;
    fogD = .0009; fogCol = vec3(.25, .06, .04);
    ggDir = normalize(vec3(.5, .3, -1.)); ggSize = .16;
    rootsOn = 1.; rootOrigin = vec3(0);
    starRibbon = 1.;
    fOn = 1.; fScale = 12.; fAura = 1.; fEng = vec3(.4, 1., .9);
    float rise = ease(remap(t, .5, 5.));
    float go = easeIn(remap(t, 5.5, 10.));
    fPos = vec3(0, -1.5 + 14.*rise + 400.*go, -40. - 300.*go);
    fRot = basisZ(mix(vec3(0, 0, 1), vec3(0, .8, -1.), smoothstep(4.5, 6.5, t)), vec3(0, 1, 0));
    fTrail = go;
    pillar = smoothstep(4., 8., t); pillarPos = vec3(-60., 0, -150.);
    splash = rise > 0. ? t - .5 : -1.; splashPos = vec3(0, 0, -40.);
    chN = 4;
    for (int i = 0; i < 4; i++){
      float fi = float(i);
      chKind[i] = 1; chPos[i] = vec3(-9. + fi*6. + (i > 1 ? 3. : 0.), -.12, -30. + 2.*sin(fi*2.)); chYaw[i] = 3.14;
      chPose[i] = vec4(0, 0, .5, 1.); chGlow[i] = 2.;
    }
    camPos = vec3(8., 2.2, -8.) + shake(t, .05 + .15*go); camTar = mix(vec3(0, 6., -40.), fPos, .6*smoothstep(5., 9., t)); camFov = 1.5;
  }
  if (V == 12){ // S43: dawn; the returned stars; Nim sees it first
    sunDir = normalize(vec3(.4, .03 + .05*u, -1.)); sunCol = vec3(1., .7, .45); sunI = .9;
    skyTop = vec3(.05, .08, .22); skyHor = vec3(.95, .6, .45);
    night = .45; newStars = 1.; bio = .6; treeGlow = .7;
    fogD = .0006; fogCol = vec3(.5, .45, .5);
    ggDir = normalize(vec3(-.55, .25, -1.)); ggSize = .18;
    rootsOn = 1.; rootOrigin = vec3(0);
    chN = 2;
    chKind[0] = 1; chPos[0] = vec3(.8, -.12, -24.);
    chYaw[0] = 3.14159 - .9*smoothstep(19.8, 22., t);
    chPose[0] = vec4(0, 0, .18 - .12*smoothstep(19.5, 21.5, t), 0);
    chKind[1] = 2; chPos[1] = vec3(-.45, -.12, -23.5);
    chYaw[1] = 3.14159 + .25*smoothstep(13., 14., t);
    chPose[1] = vec4(0, 0, .55*smoothstep(12.8, 13.6, t), .85*smoothstep(13.3, 13.9, t)*(1. - smoothstep(18.5, 19.5, t)));
    chGlow[1] = 1. + .8*smoothstep(19.8, 20.3, t)*(1. - smoothstep(21.5, 23., t));
    podFall = remap(t, 13., 18.);
    podStart = vec3(420., 700., -2400.); podEnd = vec3(-150., 0., -900.);
    splash = t > 18. ? t - 18. : -1.; splashPos = podEnd;
    camPos = vec3(2.6 - .8*u, 1.4, -15. - 3.5*u); camTar = vec3(-.4, 3.5, -80.); camFov = 1.7;
  }
  if (V >= 13 && V <= 14){
    sunI = 0.; night = 1.; bio = 1.; cloudSea = 0.; treeGlow = 1.;
    skyTop = vec3(.005, .01, .03); skyHor = vec3(.02, .05, .09);
    fogD = .0012; fogCol = vec3(.02, .08, .11);
    ggDir = normalize(vec3(.3, .32, -1.)); ggSize = .16;
    rootsOn = 1.; rootOrigin = vec3(0);
    wreckOn = 1.; wreckPos = vec3(-7.5, .6, -22.); wreckRot = basisZ(vec3(.6, -.25, -1.), vec3(.4, 1, .1)); fScale = 12.; fSmoke = 1.;
    sporeAmt = 1.;
  }
  if (V == 13){ // H3: Ilune hums the song Asha's father taught her
    chN = 2;
    chKind[0] = 0; chPos[0] = vec3(.95, -.12, -21.);
    chYaw[0] = -1.5708 + .9*smoothstep(7.4, 9.0, t)*(1. - smoothstep(15.5, 17.5, t));
    chPose[0] = vec4(0, 0, .3 - .3*smoothstep(7.4, 9., t) + .3*smoothstep(15.5, 17., t), 0);
    chKind[1] = 1; chPos[1] = vec3(-.95, -.12, -21.3); chYaw[1] = 1.5708;
    chPose[1] = vec4(0, 0, -.2 + .5*smoothstep(9.5, 11., t)*(1. - smoothstep(14.5, 16., t)), 0);
    chGlow[1] = 1. + .9*smoothstep(.6, 1.5, t)*(1. - smoothstep(6.5, 8., t));
    camPos = vec3(.3 + .1*u, 1.6, -17.6 - .9*u); camTar = vec3(0, 1.85, -21.2); camFov = 1.8;
  }
  if (V == 14){ // C1: something small peeks out
    chN = 2;
    vec2 F = normalize(vec2(-2.5, -6.1)), Rt = vec2(-F.y, F.x);
    vec3 fw = vec3(F.x, 0, F.y), rt = vec3(Rt.x, 0, Rt.y);
    rt = -rt;
    chKind[0] = 0; chPos[0] = vec3(.9, -.12, -20.78);
    float peek = smoothstep(.5, 1.3, t)*1.45 + smoothstep(3.3, 5.3, t)*1.2;
    vec3 hide = vec3(-1.6, -.12, -24.5) + fw*1.3;
    chKind[1] = 2; chPos[1] = hide + rt*peek;
    chYaw[0] = atan(chPos[1].x - chPos[0].x, chPos[1].z - chPos[0].z); chPose[0] = vec4(0, 0, .04*sin(t*.7) - .1, 0);
    chYaw[1] = atan(chPos[0].x - chPos[1].x, chPos[0].z - chPos[1].z);
    chPose[1] = vec4(t*4.2, step(3.3, t)*(1. - smoothstep(5., 5.4, t)), .18*sin(t*1.6) + .1, .35*smoothstep(6.0, 6.6, t)*(1. - smoothstep(8., 8.8, t)));
    chGlow[1] = .5 + .7*smoothstep(.4, 2., t);
    hideRoot = 1.;
    camPos = vec3(.9 + .08*u, 1.0, -18.4 - .5*u); camTar = vec3(-1.6, .75, -24.5); camFov = 1.75;
}
}

// ---------------------------------------------------------------- sky
vec3 skyGen(vec3 rd){ return nebula(rd, vec3(.12, .25, .65), vec3(.45, .12, .55), vec3(.05, .45, .5), 1.1, 42.); }

vec3 gasGiant(vec3 rd, out float cover){
  cover = 0.;
  if (ggOn < .5) return vec3(0);
  float D = 1e5, R = D*tan(ggSize);
  vec3 ce = ggDir*D;
  vec2 h = sphIntersect(vec3(0), rd, ce, R);
  vec3 col = vec3(0);
  mat3 B = basisZ(ggDir, normalize(vec3(.25, 1, 0)));
  vec3 rn = normalize(B[1]);
  // rings
  float tr = dot(ce, rn)/dot(rd, rn);
  vec3 ringCol = vec3(0); float ringA = 0.;
  if (tr > 0.){
    float rr = length(rd*tr - ce)/R;
    if (rr > 1.35 && rr < 2.3){
      float band = fbm(vec3(rr*40., 0, 0), 4);
      ringA = smoothstep(1.35, 1.45, rr)*smoothstep(2.3, 2.1, rr)*(.3 + .7*band)*step(abs(rr - 1.85), .5 - .06*step(.5, fract(rr*6.)));
      ringCol = mix(vec3(.9, .8, .7), vec3(.6, .7, .9), band)*ringA;
    }
  }
  if (h.x > 0.){
    cover = 1.;
    vec3 n = normalize(rd*h.x - ce);
    vec3 ln = transpose(B)*n;
    float lat = ln.y;
    float bands = fbm(vec3(lat*9. + fbm(ln*3., 3)*1.2, lat*2., 1.), 5);
    vec3 alb = mix(vec3(.55, .42, .55), vec3(.25, .35, .6), bands);
    alb = mix(alb, vec3(.8, .75, .8), smoothstep(.6, .8, fbm(ln*vec3(2., 16., 2.), 4))*.5);
    float dif = max(dot(n, sunDir), 0.);
    float term = smoothstep(-.05, .2, dot(n, sunDir));
    col = alb*(dif*sunCol*1.2*max(sunI, .25) + vec3(.02, .03, .06));
    col += alb*vec3(.1, .6, .6)*.08*night;  // shine from Veyra's glow
    float fres = pow(1. - max(dot(n, -rd), 0.), 3.);
    col += vec3(.4, .5, 1.)*fres*term*.35;
    if (tr > 0. && tr < h.x) col = mix(col, ringCol*(.3 + max(sunI, .3)), ringA*.8);
  } else col = ringCol*(.25 + max(sunI, .25))*.8;
  return col;
}

vec3 skyColor(vec3 rd){
  float y = rd.y;
  vec3 top = mix(skyTop, vec3(.25, .02, .02), redSky);
  vec3 hor = mix(skyHor, vec3(.9, .2, .08), redSky);
  vec3 c = mix(hor, top, pow(clamp(y + .02, 0., 1.), .45));
  c *= 1. - .7*storm;
  float sd = max(dot(rd, sunDir), 0.);
  c += sunCol*(pow(sd, 6.)*.25 + pow(sd, 60.)*.7)*sunI;
  c += sunCol*smoothstep(.99955, .9998, sd)*30.*sunI;
  if (newStars > 0.){
    vec3 q = rd*60.;
    vec3 id = floor(q);
    vec3 f = fract(q) - .5 - (hash33(id + 5.) - .5)*.6;
    float h = hash13(id + 11.);
    float px = length(fwidth(rd))*60.;
    float sN = exp(-dot(f, f)/(px*px*1.2))*step(.93, h)*smoothstep(0., .25, rd.y);
    float tw = .7 + .3*sin(uGlobalT*3. + h*50.);
    c += mix(vec3(1., .85, .6), vec3(.7, .85, 1.), hash13(id))*sN*tw*6.*newStars;
  }
  if (starRibbon > 0.){
    // Essara in the burning sky, a thread of her light drawn upward
    vec3 X = normalize(cross(sunDir, vec3(0, 1, 0))), Y = cross(X, sunDir);
    vec2 sp = vec2(dot(rd, X), dot(rd, Y));
    float along = dot(rd, sunDir);
    if (along > .9){
      float th = abs(sp.x + .02*sin(sp.y*40. - uGlobalT*3.)*smoothstep(0., .3, sp.y));
      float beam = exp(-th*300.)*step(0., sp.y)*smoothstep(.45, 0., sp.y);
      c += vec3(1., .6, .35)*beam*2.*starRibbon;
    }
  }
  float cover;
  vec3 gg = gasGiant(rd, cover);
  vec3 stars = (starfield(rd, .9) + sky(rd)*1.2)*night*smoothstep(-.02, .15, y)*(1. - storm);
  c += stars*(1. - cover);
  c = mix(c, gg + c*.15, max(cover, step(.001, dot(gg, gg))*.85));
  // high cirrus
  if (y > 0.){
    vec2 cp = rd.xz/(y + .08)*1.5;
    float ci = smoothstep(.55, .85, fbm2(cp + vec2(uGlobalT*.01, 0), 5));
    c = mix(c, mix(hor*1.1, sunCol*1.3, pow(sd, 3.))*(.4 + .6*sunI) + vec3(.02, .05, .08)*night, ci*.5*(1. - night*.6));
  }
  return c;
}

// ---------------------------------------------------------------- world SDF
float gMat = 0.;  // 1 tree, 2 roots, 3 fighter, 4 asha, 5 aurai
float gId = 0.;
float sdTree(vec3 p, float h){
  float H = 2800. + 700.*h;
  float y = p.y;
  float yy = clamp(y/H, 0., 1.);
  vec3 q = p;
  q.xz = rot(y*.0007 + h*6.)*q.xz;
  float a = atan(q.z, q.x);
  float r = mix(170., 20., pow(yy, .5));
  r *= 1. + .14*sin(a*6. + y*.003) + .05*sin(a*17. - y*.01);
  r += 260.*exp(-max(y, 0.)/110.)*(.7 + .3*sin(a*5. + h*9.));
  float trunk = max(length(q.xz) - r, y - H);
  // billowing canopy of lobes, like thunderheads made of leaves
  float crown = 1e9;
  for (int i = 0; i < 7; i++){
    float fi = float(i);
    float ang = fi*2.39996 + h*7.;
    float rad = fi == 0. ? 0. : 280. + 200.*hash11(fi + h*13.);
    vec3 c = vec3(cos(ang)*rad, H*(.8 + .12*hash11(fi*3.1 + h)) - rad*.25, sin(ang)*rad);
    float sz = fi == 0. ? 420. : 240. + 120.*hash11(fi*5.7 + h);
    crown = smin(crown, sdEllipsoid(p - c, vec3(sz, sz*.62, sz)), 120.);
  }
  crown += 60.*(vnoise(p*.006) - .5) + 25.*(vnoise(p*.02) - .5);
  // limbs reaching into the canopy
  for (int i = 0; i < 5; i++){
    float fa = float(i)*1.2566 + h*4.;
    vec3 e = vec3(cos(fa)*380., H*.82, sin(fa)*380.);
    crown = min(crown, sdCapsule2(p, vec3(0, H*.6, 0), e, 45., 14.));
  }
  return min(trunk*.7, crown*.5);
}
vec2 treeCellHash(vec2 c){ return hash22(c*1.37 + 4.1); }
float trees(vec3 p, out float id){
  id = 0.;
  if (treesOn < .5) return 1e9;
  vec2 c = floor(p.xz/treeCell);
  vec2 hh = treeCellHash(c);
  vec2 base = (c + .5)*treeCell + (hh - .5)*treeCell*.3;
  float border = min(min(p.x - c.x*treeCell, (c.x + 1.)*treeCell - p.x), min(p.z - c.y*treeCell, (c.y + 1.)*treeCell - p.z));
  float d = border + 150.;
  if (hh.x > .3){
    float dt = sdTree(p - vec3(base.x, -30., base.y), hh.y);
    if (dt < d){ d = dt; id = hash12(c); }
  }
  return d;
}
// near-field: the root cathedral around rootOrigin
float roots(vec3 p){
  if (rootsOn < .5) return 1e9;
  vec3 q = p - rootOrigin;
  // colossal trunk wall behind
  vec3 tq = q - vec3(-60., 0, 150.);
  float ta = atan(tq.z, tq.x);
  float trunk = length(tq.xz) - (95. + 6.*sin(ta*9. + q.y*.03) + 3.*sin(ta*23.));
  float d = trunk;
  // arching roots: a designed cathedral with an open nave around (0, 0, -20)
  for (int i = 0; i < 7; i++){
    vec4 A; float yaw;
    if (i == 0){ A = vec4(-2., -3., -38., 17.); yaw = 0.; }
    else if (i == 1){ A = vec4(-22., -2., -18., 10.); yaw = 1.25; }
    else if (i == 2){ A = vec4(21., -2., -24., 12.); yaw = -1.05; }
    else if (i == 3){ A = vec4(6., -3., -70., 24.); yaw = .25; }
    else if (i == 4){ A = vec4(-34., -2., -52., 15.); yaw = .85; }
    else if (i == 5){ A = vec4(30., -2., -2., 10.); yaw = -.35; }
    else { A = vec4(-16., -2., 12., 9.); yaw = 1.45; }
    float fi = float(i);
    vec3 lp = q - A.xyz;
    lp.xz = rot(yaw)*lp.xz;
    float m = 1.4 + 1.4*hash11(fi*7.3) + A.w*.04;
    vec2 tt = vec2(length(lp.xy) - A.w, lp.z);
    float arch = length(tt) - m*(1. + .25*sin(atan(lp.y, lp.x)*3. + fi));
    d = smin(d, arch, 2.);
  }
  if (hideRoot > .5){
    vec3 hq = q - vec3(-1.6, 0, -24.5);
    hq.x += .25*sin(hq.y*.35);
    float col = sdCapsule2(hq, vec3(0, -1.5, 0), vec3(.8, 16., -.6), 1.25, .55);
    col = smin(col, sdCapsule2(hq, vec3(0, -1., 0), vec3(-1.6, -.3, .9), .7, .3), .6);
    d = smin(d, col, .8);
  }
  // bark relief
  d += .35*(vnoise(q*.4) - .5) + .12*(vnoise(q*1.6) - .5);
  return d;
}
float sdWreck(vec3 p){
  vec3 q = transpose(wreckRot)*(p - wreckPos)/fScale;
  float bs = length(q) - .7;
  if (bs > .2) return bs*fScale;
  float d = sdInterceptor(q);
  // torn wing
  d = max(d, -sdBox(q - vec3(.45, 0, -.1), vec3(.14, .1, .2)));
  return d*fScale;
}
float figure(vec3 p, int i){
  vec3 q = p - chPos[i];
  q.xz = rot(chYaw[i])*q.xz;
  float bs = length(q - vec3(0, 1.3, 0)) - 1.7;
  if (bs > .3) return bs;
  if (chKind[i] == 2) return sdAurai(q/.5, chPose[i], float(i) + 7.)*.5;   // Nim, an Aurai child
  return chKind[i] == 0 ? sdAsha(q, chPose[i]) : sdAurai(q, chPose[i], float(i));
}
float mapW(vec3 p){
  float d = 1e9; gMat = 0.;
  float id;
  float dt = trees(p, id);
  if (dt < d){ d = dt; gMat = 1.; gId = id; }
  float dr = roots(p);
  if (dr < d){ d = dr; gMat = 2.; }
  if (wreckOn > .5){ float dw = sdWreck(p); if (dw < d){ d = dw; gMat = 3.; } }
  if (fOn > .5){
    vec3 q = transpose(fRot)*(p - fPos)/fScale;
    float bs = length(q) - .7;
    float df = bs > .2 ? bs*fScale : sdInterceptor(q)*fScale;
    if (df < d){ d = df; gMat = 3.; }
  }
  for (int i = 0; i < 6; i++){
    if (i >= chN) break;
    float dc = figure(p, i);
    if (dc < d){ d = dc; gMat = chKind[i] == 0 ? 4. : 5.; gId = float(i); }
  }
  return d;
}
vec3 normalW(vec3 p, float e){
  vec2 k = vec2(1, -1);
  return normalize(k.xyy*mapW(p + k.xyy*e) + k.yyx*mapW(p + k.yyx*e) + k.yxy*mapW(p + k.yxy*e) + k.xxx*mapW(p + k.xxx*e));
}
float marchW(vec3 ro, vec3 rd, float tmax, int maxSteps){
  float t = .05;
  for (int i = 0; i < 200; i++){
    if (i >= maxSteps) break;
    float d = mapW(ro + rd*t);
    if (abs(d) < t*.0015 + .004) return t;
    t += d*.85;
    if (t > tmax) break;
  }
  return -1.;
}

// ---------------------------------------------------------------- cloud sea
float cloudH(vec2 xz){
  vec2 w = xz*.0007 + vec2(uGlobalT*.003, 0);
  float n = fbm2(w + .6*vec2(fbm2(w*.7, 3), fbm2(w*.7 + 5., 3)), 5);
  return cloudY + pow(n, 1.6)*950. - 250.;
}
float marchCloud(vec3 ro, vec3 rd, float tmax){
  if (rd.y > .05 && ro.y > cloudY + 700.) return -1.;
  float top = cloudY + 700.;
  float t = rd.y < 0. ? max((top - ro.y)/rd.y, 0.) : 0.;
  if (rd.y >= 0. && ro.y > top) return -1.;
  for (int i = 0; i < 90; i++){
    vec3 p = ro + rd*t;
    float h = p.y - cloudH(p.xz);
    if (h < 0.) return t;
    t += max(h*.5, 2. + t*.004);
    if (t > tmax) break;
  }
  return -1.;
}

// ---------------------------------------------------------------- materials
vec3 bioColor(float k){ return mix(vec3(.1, 1., .85), vec3(.5, .35, 1.), k); }
float veins(vec3 p, float sc){
  float f = fbm(p*sc, 4);
  float mask = smoothstep(.45, .65, vnoise(p*sc*.35 + 3.));
  return exp(-abs(f - .5)*110.)*mask;
}

vec3 shadeSolid(vec3 p, vec3 rd, vec3 n, float m, float id, float t){
  vec3 Ld = sunDir;
  vec3 Lc = sunCol*sunI;
  float dif = max(dot(n, Ld), 0.);
  float fres = pow(1. - max(dot(n, -rd), 0.), 4.);
  vec3 amb = mix(skyHor, skyTop, n.y*.5 + .5)*.35*(1. - night*.85) + vec3(.01, .02, .04)*night;
  vec3 up = bioColor(.3)*bio*max(-n.y*.6 + .4, 0.)*.12;   // glow bouncing up from the water
  if (flash > 0.){
    vec3 fl = flashPos - p;
    float fd = length(fl);
    Lc += vec3(.7, .8, 1.)*flash*max(dot(n, fl/fd), 0.)*3e5/(fd*fd + 3e4);
  }
  vec3 col = vec3(0);
  if (m == 1.){ // colossal tree
    vec3 alb = mix(vec3(.12, .1, .12), vec3(.2, .16, .15), vnoise(p*.01));
    col = alb*(dif*Lc*1.2 + amb) + up;
    float cells = voronoi(p*.025).x;
    float lantern = smoothstep(.35, .05, cells)*smoothstep(.25, .7, vnoise(p*.004 + 7.))*(.3 + .7*smoothstep(.3, -.6, n.y));
    float crown = smoothstep(1800., 2300., p.y);
    vec3 lc = mix(vec3(1., .75, .4), bioColor(id), .6);
    float ig = 1. + ignite*3.;
    col += lc*lantern*crown*treeGlow*2.2*ig;
    col += bioColor(id)*veins(p, .004)*treeGlow*.9*ig*(.6 + .4*sin(uGlobalT*1.5 - p.y*.01));
  } else if (m == 2.){ // roots
    vec3 alb = mix(vec3(.08, .07, .08), vec3(.15, .13, .12), vnoise(p*.3));
    col = alb*(dif*Lc + amb*1.5) + up*.7;
    float v = veins(p, .08);
    float travel = .5 + .5*sin(uGlobalT*1.2 - length(p.xz - rootOrigin.xz)*.25);
    col += bioColor(vnoise(p*.02))*v*(.25 + 1.5*pow(travel, 4.))*treeGlow*(1. + 2.*ignite);
    col += bioColor(.2)*fres*.04*bio;
  } else if (m == 3.){ // fighter / wreck metal
    vec3 alb = vec3(.14, .15, .17);
    col = alb*(dif*Lc*1.5 + amb) + up*1.5 + Lc*pow(max(dot(reflect(rd, n), Ld), 0.), 30.)*.3;
    col += vec3(.3, .4, .6)*fres*.05*(1. - night);
    if (wreckOn > .5){ // sparking damage
      float sp = step(.985, hash13(floor(p*6.) + floor(uGlobalT*12.)))*step(abs(p.y - wreckPos.y - .5), 2.);
      col += vec3(1., .6, .3)*sp*3.;
    }
  } else { // characters
    int i = int(id);
    vec3 q = p - chPos[i];
    q.xz = rot(chYaw[i])*q.xz;
    if (chKind[i] == 2) q /= .5;
    float part = gFigPart;
    vec3 alb = m == 4. ? vec3(.07, .07, .08) : vec3(.05, .06, .1);
    if (m == 4. && part > 2.5) alb = vec3(.08, .05, .03);
    if (m == 5. && part > 1.5 && part < 2.5) alb = vec3(.1, .12, .2);
    col = alb*(dif*Lc*1.3 + amb*.6) + up*alb*6.;
    col += (m == 5. ? bioColor(.3) : vec3(.5, .6, .8))*fres*(.08 + .25*night);
    if (m == 5.) col += bioColor(fract(float(i)*.37))*auraiMarks(q, float(i))*1.4*chGlow[i]*(part < 2.5 || part > 2.9 ? 1. : .35);
    if (m == 5. && part > 2.5) col += bioColor(.1)*smoothstep(-.2, -.45, q.y - 2.3)*.5*chGlow[i];
  }
  return col;
}

// ---------------------------------------------------------------- water
vec3 waterNormal(vec2 xz, float dist){
  float T = uGlobalT;
  float e = .05 + dist*.002;
  float a = waveAmp*mix(1., .2, clamp(dist/400., 0., 1.));
  #define WH(q) (a*(.06*sin(q.x*.7 + T*1.3) + .05*sin(q.y*.9 - T*1.1 + q.x*.3) + .08*(fbm2(q*.45 + T*.12, 3) - .5)))
  vec2 q = xz;
  float h0 = WH(q);
  float hx = WH((q + vec2(e, 0)));
  float hz = WH((q + vec2(0, e)));
  return normalize(vec3(h0 - hx, e, h0 - hz));
}
vec3 waterEmissive(vec3 p, float dist){
  if (bio <= 0.) return vec3(0);
  float T = uGlobalT;
  vec2 xz = p.xz;
  // drifting plankton specks
  vec2 c = floor(xz*3.);
  vec2 f = fract(xz*3.) - .5 - (hash22(c) - .5)*.6;
  float sp = exp(-dot(f, f)*400.)*step(.75, hash12(c))*(.5 + .5*sin(T*3. + hash12(c)*20.));
  sp *= smoothstep(60., 5., dist);
  // luminous currents
  float cur = exp(-abs(fbm2(xz*.05 + vec2(T*.02, 0), 4) - .5)*25.)*.35;
  // rings around anything standing in the water
  float ring = 0.;
  for (int i = 0; i < 6; i++){
    if (i >= chN) break;
    float r = length(xz - chPos[i].xz);
    ring += exp(-r*1.2)*.8 + exp(-abs(fract(r*.7 - T*.5) - .5)*18.)*exp(-r*.35)*.4;
  }
  if (wreckOn > .5){
    float r = length(xz - wreckPos.xz);
    ring += exp(-abs(fract(r*.25 - T*.3) - .5)*14.)*exp(-r*.06)*.5;
  }
  return bioColor(vnoise(p*.03))*(sp*2. + cur + ring)*bio*(1. + ignite*2.);
}

// ---------------------------------------------------------------- particles
vec3 spores(vec3 ro, vec3 rd, float tHit){
  if (sporeAmt <= 0.) return vec3(0);
  vec3 acc = vec3(0);
  vec3 fwd = normalize(camTar - camPos);
  for (int k = 0; k < 7; k++){
    float dist = 1.5*pow(1.6, float(k));
    float den = dot(rd, fwd);
    float t = dist/den;
    if (t > tHit) break;
    vec3 p = ro + rd*t;
    vec3 pp = p + vec3(0, -uGlobalT*.25, 0) + vec3(sin(uGlobalT*.3 + p.y)*.3, 0, 0);
    float sc = 1.2/dist*2.;
    vec3 X = normalize(cross(fwd, vec3(0, 1, 0))), Y = cross(X, fwd);
    vec2 q = vec2(dot(pp, X), dot(pp, Y))*sc;
    vec2 c = floor(q);
    vec2 f = fract(q) - .5 - (hash22(c + float(k)*17.) - .5)*.7;
    float h = hash12(c + float(k)*3.1);
    float size = .035 + .06*smoothstep(4., 1.5, dist);   // near ones bloom out of focus
    float g = exp(-dot(f, f)/(size*size*.25))*step(.72, h);
    float tw = .6 + .4*sin(uGlobalT*2. + h*40.);
    acc += bioColor(h*.5)*g*tw*(dist < 3. ? .3 : 1.);
  }
  return acc*sporeAmt*1.6;
}

// ---------------------------------------------------------------- render
vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  setup(t);
  vec3 ro = camPos;
  mat3 cam = camLook(ro, camTar, camRoll);
  vec3 rd = cam*normalize(vec3(uv, camFov));

  vec3 col = skyColor(rd);
  float tHit = 1e9;
  float tMax = 30000.;

  // water plane
  float tw = oceanOn > .5 && rd.y < 0. ? -ro.y/rd.y : -1.;
  if (tw > 0.) tMax = min(tMax, tw);
  // cloud sea
  float tc = cloudSea > .5 ? marchCloud(ro, rd, tMax) : -1.;
  if (tc > 0.) tMax = min(tMax, tc);
  // solids
  int steps = rootsOn > .5 ? 140 : 110;
  float ts = marchW(ro, rd, tMax, steps);
  if (ts > 0.){
    tHit = ts;
    vec3 p = ro + rd*ts;
    float m = gMat, id = gId;
    vec3 n = normalW(p, .002 + ts*.0006);
    col = shadeSolid(p, rd, n, m, id, ts);
  } else if (tc > 0.){
    tHit = tc;
    vec3 p = ro + rd*tc;
    float e = 25. + tc*.004;
    vec3 n = normalize(vec3(cloudH(p.xz - vec2(e, 0)) - cloudH(p.xz + vec2(e, 0)), 2.*e, cloudH(p.xz - vec2(0, e)) - cloudH(p.xz + vec2(0, e))));
    float dif = clamp(dot(n, sunDir)*1.6 + .1, 0., 1.);
    // self shadow toward the sun
    float sh = 1.;
    for (int k = 1; k <= 4; k++){
      vec3 sp = p + sunDir*float(k*k)*60.;
      sh = min(sh, clamp((sp.y - cloudH(sp.xz))/60. + .5, 0., 1.));
    }
    float sss = pow(max(dot(rd, sunDir), 0.), 4.);
    float hh = clamp((p.y - cloudY + 250.)/900., 0., 1.);
    vec3 lit = sunCol*vec3(1.05, .78, .6)*sunI;
    vec3 shd = vec3(.16, .13, .3)*(.5 + .5*hh);
    vec3 c = mix(shd, lit, smoothstep(0., 1., dif*sh));
    float rimL = pow(1. - max(dot(n, -rd), 0.), 3.)*pow(max(dot(rd, sunDir), 0.), 2.);
    c += sunCol*rimL*1.5*sunI;
    c += mix(skyHor, skyTop, .5)*.06*(.5 + hh) + sunCol*sss*.25*sunI*(.3 + hh);
    c *= .62;
    if (flash > 0.){ float fd = length(flashPos - p); c += vec3(.6, .7, 1.)*flash*(.3 + .7*dif)*2e6/(fd*fd + 4e5); }
    // river-light glowing up through the cloud gaps
    c += bioColor(.3)*smoothstep(.25, .0, hh)*.4*night;
    col = c;
  } else if (tw > 0.){
    tHit = tw;
    vec3 p = ro + rd*tw;
    vec3 n = waterNormal(p.xz, tw);
    vec3 rr = reflect(rd, n);
    float fre = .02 + .98*pow(1. - max(dot(n, -rd), 0.), 5.);
    vec3 refl = skyColor(rr);
    if (rootsOn > .5 || wreckOn > .5){
      float tr = marchW(p + n*.05, rr, 250., 70);
      if (tr > 0.){
        vec3 q = p + rr*tr;
        float m = gMat, id = gId;
        refl = shadeSolid(q, rr, normalW(q, .02 + tr*.001), m, id, tr);
      }
    } else {
      float tr = marchW(p + n*.5, rr, 20000., 50);
      if (tr > 0.){ vec3 q = p + rr*tr; float m = gMat, id = gId; refl = shadeSolid(q, rr, normalW(q, 1. + tr*.001), m, id, tr); }
    }
    vec3 deep = mix(vec3(.0, .02, .03), vec3(.02, .05, .06), sunI);
    col = mix(deep, refl, fre);
    col += waterEmissive(p, tw);
  }

  // atmosphere / fog
  float fogT = min(tHit, 60000.);
  float fa = 1. - exp(-fogT*fogD);
  vec3 fc2 = fogCol*(1. - storm*.6) + sunCol*pow(max(dot(rd, sunDir), 0.), 8.)*.4*sunI;
  fc2 = mix(fc2, vec3(.6, .12, .05), redSky*.7);
  col = mix(col, fc2, fa*(tHit > 1e8 ? .0 : 1.));

  // fighter trail and engines
  if (fOn > .5){
    vec3 fwd = fRot*vec3(0, 0, 1);
    for (int s = -1; s <= 1; s += 2){
      vec3 e = fPos + fRot*vec3(.1*float(s), 0, -.44)*fScale;
      float b = dot(e - ro, rd);
      if (b > 0. && b < tHit + fScale){
        float d = length(ro + rd*b - e);
        col += fEng*(exp(-pow(d/(fScale*.022), 2.))*7. + exp(-d/(fScale*.1))*.3);
      }
    }
  }
  col += spores(ro, rd, tHit);

  // wreck smoke / fighter smoke: dark plume lit from below
  if (fSmoke > 0. && (wreckOn > .5 || fOn > .5)){
    vec3 base = wreckOn > .5 ? wreckPos + vec3(2., 1., 0) : fPos;
    vec3 acc = vec3(0); float tr = 1.;
    for (int k = 0; k < 14; k++){
      float tt = dot(base - ro, rd) + (float(k) - 7.)*1.2*(wreckOn > .5 ? 1. : 3.);
      if (tt < 0. || tt > tHit) continue;
      vec3 p = ro + rd*tt;
      vec3 q = p - base;
      float hgt = q.y;
      float rad = 1.5 + hgt*.25;
      vec2 drift = vec2(hgt*.12 + sin(hgt*.2 + uGlobalT)*.8, 0);
      float r = length(q.xz - drift);
      float dens = smoothstep(rad, rad*.3, r)*smoothstep(-1., 2., hgt)*smoothstep(40., 5., hgt);
      dens *= fbm(p*.25 - vec3(0, uGlobalT*.8, 0), 3);
      vec3 sc = vec3(.03, .05, .06) + bioColor(.3)*.05*bio*exp(-max(hgt, 0.)*.1);
      acc += tr*sc*dens*.35;
      tr *= 1. - dens*.28;
    }
    col = col*tr + acc;
  }
  // atmospheric entry plasma around the diving fighter
  if (fEntry > 0. && fOn > .5){
    vec3 fwd = fRot*vec3(0, 0, 1);
    vec3 nose = fPos + fwd*.5*fScale;
    vec3 a = nose + fwd*.05*fScale, b = nose - fwd*fScale*3.5;
    vec3 rs = raySeg(ro, rd, a, b);
    float sgm = rs.z, dq = rs.x;
    float n = fbm(vec3(sgm*12. - uGlobalT*10., dq/fScale*8., 0), 3);
    float w = fScale*(.1 + .45*sgm);
    col += mix(vec3(1., .75, .45), vec3(1., .3, .5), sgm)*exp(-pow(dq/w, 2.))*(1. - sgm)*(.5 + n)*fEntry*3.;
  }
  // aura of the Aurai around the fighter
  if (fAura > 0. && fOn > .5){
    float b = dot(fPos - ro, rd);
    float d = length(ro + rd*b - fPos);
    float sh = .7 + .3*sin(uGlobalT*5.);
    col += (bioColor(.1)*exp(-pow(d/(fScale*.6), 2.))*.5 + vec3(1., .85, .5)*exp(-d/(fScale*1.5))*.25)*fAura*sh;
  }
  if (fTrail > 0. && fOn > .5){
    vec3 fwd = fRot*vec3(0, 0, 1);
    vec3 a = fPos - fwd*.45*fScale, bb = a - fwd*fScale*25.;
    vec3 rs = raySeg(ro, rd, a, bb);
    float sgm = rs.z, dq = rs.x;
    if (rs.y < tHit) col += fEng*exp(-pow(dq/(fScale*.03*(1. + sgm*4.)), 2.))*pow(1. - sgm, 2.)*fTrail*1.2;
  }
  // lightning bolt
  if (boltT >= 0. && boltT < .25){
    vec3 prev = boltTop;
    float bseed = floor(uGlobalT/2.3) + boltTop.x;
    for (int k = 1; k <= 10; k++){
      float fk = float(k)/10.;
      vec3 cur = mix(boltTop, boltBot, fk) + (k < 10 ? (hash33(vec3(fk*13., bseed, 1.)) - .5)*vec3(160., 40., 160.) : vec3(0));
      vec3 rs = raySeg(ro, rd, prev, cur);
      float dq = rs.x;
      vec3 pb = ro + rd*rs.y;
      float w = max(rs.y*.0015, .15);
      col += vec3(.75, .85, 1.)*(exp(-pow(dq/w, 2.))*25. + exp(-dq/(w*10.))*.6)*exp(-boltT*14.);
      prev = cur;
    }
  }
  // splash: flash, spray and a ring of light racing outward
  if (splash >= 0.){
    float b = dot(splashPos - ro, rd);
    float d = length(ro + rd*b - splashPos - vec3(0, 3., 0));
    float sz = 6. + splash*14.;
    col += vec3(.8, 1., .95)*exp(-pow(d/sz, 2.))*exp(-splash*2.5)*2.5;
    if (tw > 0. && tHit >= tw - .01){
      vec3 p = ro + rd*tw;
      float r = length(p.xz - splashPos.xz);
      col += bioColor(.2)*exp(-abs(r - splash*45.)*.15)*exp(-splash*.5)*1.5;
    }
  }
  // pillar of light rising from the great tree
  if (pillar > 0.){
    vec2 dxz = (ro + rd*max(dot(pillarPos - ro, rd), 0.)).xz - pillarPos.xz;
    float bb = dot(pillarPos - ro, rd);
    vec3 pp = ro + rd*max(bb, 0.);
    float dq = length(pp.xz - pillarPos.xz);
    float yf = smoothstep(0., 1., pp.y/(3000.*pillar));
    col += mix(bioColor(.1), vec3(1., .9, .6), .5)*exp(-pow(dq/25., 2.))*(1. - yf)*pillar*3.;
    col += bioColor(.1)*exp(-dq/120.)*(1. - yf)*pillar*.25;
  }
  // a star falls home
  if (podFall > 0. && podFall < 1.){
    vec3 pos = mix(podStart, podEnd, podFall);
    vec3 tail = mix(podStart, podEnd, max(podFall - .12, 0.));
    vec3 rs = raySeg(ro, rd, tail, pos);
    float sgm = rs.z, dq = rs.x;
    float w = max(rs.y*.0012, .3);
    col += vec3(1., .85, .6)*(exp(-pow(dq/w, 2.))*sgm*sgm*4. + exp(-dq/(w*8.))*sgm*.4);
    float hb = dot(pos - ro, rd);
    float hd = length(ro + rd*hb - pos);
    col += vec3(1., .9, .7)*exp(-pow(hd/(w*3.), 2.))*6.;
  }
  // rain
  if (rain > 0.){
    vec2 q = uv*vec2(90., 5.) + vec2(uv.y*9., uGlobalT*38.);
    vec2 c = floor(q);
    float h = hash12(c);
    float streak = step(.93, h)*smoothstep(.5, .0, abs(fract(q.x) - .5)*6.)*smoothstep(0., .3, fract(q.y))*smoothstep(1., .6, fract(q.y));
    col += vec3(.5, .55, .65)*streak*.12*rain*(.5 + flash);
  }
  return col;
}
