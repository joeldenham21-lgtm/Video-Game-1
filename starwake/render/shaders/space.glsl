// STARWAKE -- generic space scene renderer with per-shot staging.
// uP0.x selects the shot staging (see setup()).
#include "common.glsl"
#include "ships.glsl"

// ---------------------------------------------------------------- staging state
vec3 camPos, camTar; float camFov = 1.8, camRoll = 0.;
vec3 camShake = vec3(0);
// sky
vec3 nebA = vec3(.1, .05, .12), nebB = vec3(.03, .06, .14), nebC = vec3(.12, .03, .03);
float nebDens = .6, nebSeed = 3., starsBright = .7;
// star
bool starOn = false; vec3 starPos = vec3(0); float starRad = 1.; float starTemp = 3.2; float starLife = 1.;
float starDead = 0.;   // 1 = black cinder with ember rim
vec3 lightDir = vec3(0, 0, 1); vec3 lightCol = vec3(1);  // key light for ships when star is off
// planet
int plType = 0; vec3 plPos = vec3(0); float plRad = 1.; float plFrost = 0.; float plSpin = 0.; float plNight = 0.;
// starmaw
bool mawOn = false; vec3 mawPos = vec3(0); mat3 mawRot = mat3(1.); float mawScale = 1.; float mawOpen = 1.;
float mawCore = 1.; float mawCrack = 0.;
// ribbon
float ribbon = 0.; float ribbonProg = 1.; vec3 ribA, ribB, ribC; float ribW = .15;
// siphon beam (maw -> star)
float siphon = 0.;
// fleet of destroyers
int fleetN = 0; vec3 fleetPos = vec3(0); mat3 fleetRot = mat3(1.); float fleetScale = 1.; float fleetArrive = -1.; float fleetSpread = 1.;
// fighters
int fN = 0; vec3 fPos[4]; mat3 fRot[4]; float fScale = 1.; int fKind[4]; vec3 fEng[4]; float fEngPow[4];
// battle fx
float battle = 0.; float flak = 0.;
vec4 boom[4]; float boomT[4]; int boomN = 0;   // xyz pos, w radius; age in seconds
float warpFlash = 0.; vec3 warpFlashPos;
float lightning = 0.;
vec3 fillDir = vec3(0, 1, 0), fillCol = vec3(0);     // secondary light (nebula / planet shine)
float fWarp[4]; float fTrail[4]; float fAura[4];
int boltN = 0; vec3 boltA[12], boltB[12], boltC[12];
float crackGlow = 0.; float burst = 0.; float streams = 0.;
float entry = 0.;   // atmospheric entry plasma on fighter 0

mat3 basisZ(vec3 fwd, vec3 up){
  vec3 z = normalize(fwd);
  vec3 x = normalize(cross(up, z));
  return mat3(x, cross(z, x), z);   // columns: local axes in world
}
vec3 fleetShip(int i);
vec3 bez(vec3 a, vec3 b, vec3 c, float s){ return mix(mix(a, b, s), mix(b, c, s), s); }

// ---------------------------------------------------------------- shots
void setup(float t){
  int V = int(uP0.x + .5);
  float u = t/uD;
  for (int i = 0; i < 4; i++){ fEng[i] = vec3(1., .35, .15); fEngPow[i] = 1.; fKind[i] = 0; fRot[i] = mat3(1.); fPos[i] = vec3(0); boomT[i] = -1.; fWarp[i] = 0.; fTrail[i] = 0.; fAura[i] = 0.; }
  vec3 UP = vec3(0, 1, 0);

  if (V == 3){ // S03: the Starmaw feeding on the red giant Kessar
    starOn = true; starPos = vec3(0); starRad = 1.; starTemp = 2.5;
    mawOn = true; mawPos = vec3(-2.3, .35, 1.9); mawScale = .3;
    mawRot = basisZ(starPos - mawPos, vec3(0, 1, 0));
    ribbon = 1.;
    camPos = vec3(-1.5 - .25*u, .18 + .08*u, 5.4 - .35*u); camTar = vec3(-1.25, .12, .4); camFov = 1.9; camRoll = -.06;
    nebA = vec3(.14, .04, .03); nebB = vec3(.05, .02, .06); nebDens = .35;
  }
  if (V == 4){ // S04: close on the plasma entering the maw
    starOn = true; starPos = vec3(0); starRad = 1.; starTemp = 2.5;
    mawOn = true; mawPos = vec3(-2.3, .35, 1.9); mawScale = .3;
    mawRot = basisZ(starPos - mawPos, vec3(0, 1, 0));
    ribbon = 1.;
    vec3 side = mawRot*vec3(1, 0, 0);
    camPos = mawPos + mawRot*vec3(.55 - .08*u, .18, .75 + .1*u); camTar = mawPos + mawRot*vec3(0, 0, .12); camFov = 1.7; camRoll = .12;
    nebA = vec3(.14, .04, .03); nebDens = .3;
  }
  if (V == 5){ // S05: the star dies over Kessar
    starOn = true; starPos = vec3(0); starRad = 1.; starTemp = 2.5;
    starLife = 1. - ease(remap(t, 1.5, 8.5));
    starDead = step(starLife, .001);
    mawOn = true; mawPos = vec3(-2.3, .35, 1.9); mawScale = .3;
    mawRot = basisZ(starPos - mawPos, vec3(0, 1, 0));
    ribbon = smoothstep(.02, .15, starLife);
    ribW = .15*starLife;
    plType = 1; plPos = vec3(5.2, -3.2, 12.); plRad = 3.; plFrost = ease(remap(t, 3.5, 10.5)); plSpin = t*.01;
    camPos = vec3(0.6, -.3 + .1*u, 19.5); camTar = vec3(1.4, -.9, 0.); camFov = 1.65;
    nebA = vec3(.12, .04, .03); nebDens = .3;
  }
  if (V == 6){ // S08: the Hollow Fleet gathers at the dead star
    starOn = true; starPos = vec3(1.5, .6, -60.); starRad = 2.2; starTemp = 3.; starLife = 0.; starDead = 1.;
    mawOn = true; mawPos = vec3(9., 7.5, -60.); mawScale = 9.; mawCore = .45;
    mawRot = basisZ(vec3(.25, -.1, 1), UP);
    fleetN = 8; fleetPos = vec3(-.1, -.12, -2.6); fleetScale = .42; fleetSpread = .8;
    fleetRot = basisZ(vec3(.08, .02, -1), UP);
    fleetArrive = 1.;
    fillDir = normalize(vec3(.8, .6, .3)); fillCol = vec3(.4, .45, .7)*.9;
    lightDir = normalize(vec3(-.3, .2, -1.)); lightCol = vec3(.9, .35, .2)*.6;
    camPos = vec3(.5 - .3*u, .02 + .05*u, 1.2 - .5*u); camTar = vec3(.3, .35, -8.); camFov = 1.55; camRoll = -.03;
    nebA = vec3(.3, .06, .07); nebB = vec3(.12, .04, .16); nebC = vec3(.25, .08, .03); nebDens = 1.; nebSeed = 11.;
  }
  if (V == 7){ // S09: Asha alone over frozen Kessar, the dead star above
    plType = 1; plFrost = 1.; plPos = vec3(0, -6.2, -3.); plRad = 6.; plSpin = 1.3;
    starOn = true; starPos = vec3(-9., 3.2, -40.); starRad = 1.6; starLife = 0.; starDead = 1.;
    fillDir = normalize(vec3(.7, .45, .3)); fillCol = vec3(.3, .38, .62)*.6;
    lightDir = normalize(vec3(-.4, .3, -.6));
    fN = 1; fScale = .3;
    fPos[0] = vec3(-.9 + 1.5*u, .18 + .02*sin(t*.8), 2.2 - .3*u);
    fRot[0] = basisZ(vec3(1, .0, -.2), vec3(-.1, 1, 0));
    fTrail[0] = 1.;
    camPos = vec3(-.35 + .9*u, .3, 3.35); camTar = mix(vec3(-.3, .05, 1.), fPos[0], .75); camFov = 1.8; camRoll = .03;
    nebA = vec3(.05, .08, .16); nebB = vec3(.08, .04, .12); nebDens = .5; nebSeed = 21.;
  }
  if (V == 8){ // S11: tracking beside Asha's interceptor; the fleet beyond
    starOn = true; starPos = vec3(20., 4., -80.); starRad = 2.; starLife = 0.; starDead = 1.;
    fillDir = normalize(vec3(-.3, .8, .5)); fillCol = vec3(.35, .42, .65)*.6;
    fN = 1; fScale = .3;
    fPos[0] = vec3(0, .02*sin(t*1.1), 0);
    fRot[0] = basisZ(vec3(0, 0, 1), vec3(.06*sin(t*.7), 1, 0));
    camPos = vec3(.75 - .1*u, .14, -.2 + .45*u); camTar = vec3(0, 0, .05); camFov = 1.6;
    camShake = shake(t*.5, .006);
    fleetN = 6; fleetPos = vec3(-3., -.6, -14. + t*.18); fleetScale = .9; fleetSpread = 1.4; fleetArrive = -100.;
    fleetRot = basisZ(vec3(0, 0, 1), UP);
    mawOn = true; mawPos = vec3(-26., 4., -70.); mawScale = 12.; mawCore = .7; mawRot = basisZ(vec3(.4, 0, 1), UP);
    plType = 1; plFrost = 1.; plPos = vec3(-4., -12.4, -30.); plRad = 13.; plSpin = 2.;
    lightDir = normalize(vec3(.4, .5, .6)); lightCol = vec3(.3, .35, .55)*.5;
    nebA = vec3(.1, .06, .14); nebB = vec3(.03, .04, .1); nebDens = .7; nebSeed = 11.;
  }
  if (V == 9){ // S12: formation, then the jump
    starOn = false;
    fillDir = normalize(vec3(-.3, .8, .5)); fillCol = vec3(.35, .42, .65)*.6;
    lightDir = normalize(vec3(.5, .3, -.8)); lightCol = vec3(.9, .5, .3)*.35;
    fN = 3; fScale = .3;
    float jump = max(t - 7.9, 0.);
    float go = (exp(jump*9.) - 1.)*.6;
    fPos[0] = vec3(0, 0, -go);
    fPos[1] = vec3(.55, -.08, .45 - go*1.05);
    fPos[2] = vec3(-.55, -.1, .5 - go*1.1);
    for (int i = 0; i < 3; i++){
      fPos[i] += .015*vec3(sin(t*.9 + float(i)), sin(t*1.3 + float(i)*2.), 0);
      fRot[i] = basisZ(vec3(0, 0, -1), UP);
      fWarp[i] = smoothstep(7.85, 8.1, t);
      fEngPow[i] = 1. + 3.*smoothstep(7.2, 7.9, t);
      fEng[i] = mix(vec3(1., .35, .15), vec3(.6, .8, 1.), smoothstep(7.4, 7.9, t));
    }
    warpFlash = smoothstep(8.1, 8.15, t)*exp(-max(t - 8.15, 0.)*5.);
    warpFlashPos = vec3(0, 0, -3.);
    camPos = vec3(.25, .42, 1.9 + .25*u); camTar = vec3(0, -.05, -1.); camFov = 1.7;
    camShake = shake(t, .004 + .03*smoothstep(7.8, 8.2, t));
    fleetN = 4; fleetPos = vec3(4., -1.5, -12.); fleetScale = .9; fleetSpread = 1.2; fleetArrive = -100.; fleetRot = basisZ(vec3(-.3, 0, -1), UP);
    nebA = vec3(.1, .06, .14); nebB = vec3(.03, .04, .1); nebDens = .7; nebSeed = 11.;
  }
  if (V == 10){ // S14: the Veil Reach
    starOn = true; starPos = vec3(34., 9., -70.); starRad = 1.6; starTemp = 16.;
    plType = 2; plPos = vec3(-3.2, -3.3, -16.); plRad = 6.; plSpin = .4 + t*.004; plNight = .3;
    fillDir = normalize(vec3(-.5, .3, .6)); fillCol = vec3(.25, .3, .6)*.35;
    warpFlash = exp(-t*2.5)*step(0., t);
    warpFlashPos = vec3(0, 0, -1.5);
    fN = 3; fScale = .12;
    float fly = remap(t, 1.2, 16.);
    for (int i = 0; i < 3; i++){
      vec3 off = vec3(float(i - 1)*.28, -float(abs(i - 1))*.06, float(abs(i - 1))*.3);
      fPos[i] = vec3(.2, -.25, 1.5) + off + vec3(-.6, -.5, -6.)*easeOut(fly);
      fRot[i] = basisZ(vec3(-.1, -.08, -1), UP);
      fEngPow[i] = step(1.2, t);
    }
    camPos = vec3(.35 - .2*u, .15 - .1*u, 3.2); camTar = vec3(-.6, -.7, -12.); camFov = 1.55; camRoll = -.04;
    nebA = vec3(.12, .25, .65); nebB = vec3(.45, .12, .55); nebC = vec3(.05, .45, .5); nebDens = 1.35; nebSeed = 42.;
    starsBright = .9;
  }
  if (V == 11){ // S15: Veyra's night side, veins pulsing
    starOn = true; starPos = vec3(60., 10., -20.); starRad = 1.6; starTemp = 16.;
    plType = 2; plPos = vec3(0, -9.3, -7.); plRad = 8.5; plSpin = 1.9 + t*.006; plNight = 1.;
    fillDir = normalize(vec3(-.5, .3, .6)); fillCol = vec3(.2, .3, .5)*.25;
    fN = 2; fScale = .16;
    fPos[0] = vec3(-1.6 + 2.8*u, -.25, -.4); fPos[1] = fPos[0] + vec3(-.35, .07, .3);
    fRot[0] = basisZ(vec3(1, -.05, -.2), UP); fRot[1] = fRot[0];
    camPos = vec3(0, .15, 2.4); camTar = vec3(.1, -.45, -1.); camFov = 1.7; camRoll = .05;
    nebA = vec3(.12, .25, .65); nebB = vec3(.45, .12, .55); nebC = vec3(.05, .45, .5); nebDens = 1.1; nebSeed = 42.;
  }
  if (V == 12){ // S16: atmospheric entry
    starOn = true; starPos = vec3(80., 30., 10.); starRad = 2.; starTemp = 16.;
    plType = 2; plPos = vec3(0, -40.5, 0); plRad = 40.; plSpin = 2.2; plNight = .6;
    fillDir = normalize(vec3(.2, -1., .1)); fillCol = vec3(.1, .6, .6)*.3;
    fN = 1; fScale = .3;
    fPos[0] = vec3(0, -.05 - .05*u, -.1*u);
    fRot[0] = basisZ(vec3(0, -.35, -1), vec3(.1*sin(t*.8), 1, 0));
    entry = smoothstep(2.5, 6., t);
    fTrail[0] = entry;
    camPos = vec3(.35, .35, .9) + shake(t, .01 + .03*entry); camTar = vec3(0, -.2, -.6); camFov = 1.5; camRoll = -.1;
    nebA = vec3(.12, .25, .65); nebB = vec3(.45, .12, .55); nebC = vec3(.05, .45, .5); nebDens = 1.; nebSeed = 42.;
  }
  if (V == 13){ // S30: the Starmaw arrives over Veyra
    starOn = true; starPos = vec3(60., 12., -40.); starRad = 2.; starTemp = 16.;
    plType = 2; plPos = vec3(0, -30., -10.); plRad = 26.; plSpin = .9; plNight = .4;
    fillDir = normalize(vec3(0, -1, .2)); fillCol = vec3(.1, .5, .6)*.35;
    float arrive = 1.2;
    float a = t - arrive;
    mawOn = a > 0.; mawPos = vec3(2., 3.5, -22.); mawScale = 7.; mawCore = .8; mawOpen = .2;
    mawRot = basisZ(normalize(starPos - mawPos), UP);
    warpFlash = a > 0. ? exp(-a*1.6)*1.6 : smoothstep(-.4, 0., a)*.3;
    warpFlashPos = mawPos;
    fleetN = 9; fleetPos = mawPos + vec3(-2., -1.5, 8.); fleetScale = .9; fleetSpread = 2.; fleetArrive = 4.;
    fleetRot = basisZ(vec3(-.4, -.2, 1), UP);
    camPos = vec3(-1.5, -1.2 + .5*u, 12.); camTar = vec3(1., 1., -20.); camFov = 1.55; camRoll = .06;
    camShake = shake(t, .02*exp(-max(a, 0.)*.8)*step(0., a));
    nebA = vec3(.12, .25, .65); nebB = vec3(.45, .12, .55); nebC = vec3(.05, .45, .5); nebDens = 1.1; nebSeed = 42.;
  }
  if (V == 14){ // S31: the harvest of Essara begins
    starOn = true; starPos = vec3(0); starRad = 1.; starTemp = 16.;
    starLife = 1. - .08*remap(t, 2., 11.);
    mawOn = true; mawPos = vec3(-2.4, .3, 1.8); mawScale = .32; mawOpen = ease(remap(t, 0., 3.)); mawCore = .6 + .8*remap(t, 3., 8.);
    mawRot = basisZ(starPos - mawPos, UP);
    ribbon = smoothstep(2.5, 4., t); ribbonProg = ease(remap(t, 3., 9.5));
    siphon = smoothstep(1.5, 2.5, t);
    camPos = vec3(-1.3 - .3*u, .25, 5.6 - .6*u); camTar = vec3(-1.2, .15, .4); camFov = 1.9; camRoll = .05;
    nebA = vec3(.12, .25, .65); nebB = vec3(.45, .12, .55); nebC = vec3(.05, .45, .5); nebDens = .9; nebSeed = 42.;
  }
  if (V >= 15 && V <= 17){ // the battle: the Starmaw feeding on Essara, fleet in defence
    starOn = true; starPos = vec3(-60., 20., -260.); starRad = 18.; starTemp = 16.; starLife = .9;
    mawOn = true; mawPos = vec3(-18., 8., -150.); mawScale = 32.; mawOpen = 1.; mawCore = 1.3;
    mawRot = basisZ(starPos - mawPos, UP);
    ribbon = 1.; ribW = .15*starRad;
    siphon = 1.;
    fleetN = 6; fleetPos = vec3(10., -4., -60.); fleetScale = 3.; fleetSpread = 1.6; fleetArrive = -100.;
    fleetRot = basisZ(vec3(-.3, 0, 1), UP);
    fillDir = normalize(vec3(-.3, .5, .8)); fillCol = vec3(.25, .3, .5)*.4;
    nebA = vec3(.12, .25, .65); nebB = vec3(.45, .12, .55); nebC = vec3(.05, .45, .5); nebDens = 1.; nebSeed = 42.;
    plType = 2; plPos = vec3(30., -95., 40.); plRad = 80.; plSpin = .6; plNight = .5;
  }
  if (V == 15){ // S34: Asha charges the Starmaw; the batteries open up
    fN = 1; fScale = 1.;
    fPos[0] = vec3(1.2*sin(t*.9), .6*sin(t*1.3), -t*6.);
    fRot[0] = basisZ(vec3(.15*cos(t*.9), .1*cos(t*1.3), -1.), vec3(.5*sin(t*.9), 1, 0));
    fEng[0] = vec3(.4, 1., .9); fAura[0] = 1.; fEngPow[0] = 1.5; fTrail[0] = 1.;
    camPos = fPos[0] + vec3(-1.8, .9, 5.5) + shake(t, .06); camTar = fPos[0] + vec3(0, .2, -12.); camFov = 1.6; camRoll = .05*sin(t*.7);
    boltN = 10;
    for (int i = 0; i < 10; i++){
      float fi = float(i);
      float per = 1.1 + hash11(fi)*.8;
      float ph = fract((t + hash11(fi*3.)*5.)/per);
      vec3 src = fleetPos + fleetRot*(fleetShip(i % 6)*fleetScale);
      vec3 tgt = fPos[0] + vec3((hash11(fi*5. + floor((t + hash11(fi*3.)*5.)/per)) - .5)*12., (hash11(fi*7.) - .5)*6., 8. + 10.*hash11(fi*9.));
      vec3 dir = normalize(tgt - src);
      float L = length(tgt - src);
      boltA[i] = src + dir*L*ph*1.3; boltB[i] = boltA[i] - dir*4.;
      boltC[i] = vec3(1., .25, .12)*1.5;
    }
    boomN = 3;
    for (int i = 0; i < 3; i++){
      float fi = float(i);
      float per = 1.7 + fi*.4;
      float k = floor((t + fi)/per);
      boomT[i] = mod(t + fi, per);
      boom[i] = vec4(fPos[0] + vec3((hash11(k*3. + fi) - .5)*14., (hash11(k*5. + fi) - .5)*7., -8. - 14.*hash11(k*7. + fi)), .9);
    }
  }
  if (V == 16){ // S35: the hunters
    fN = 4; fScale = 1.;
    vec3 base = vec3(0, 0, -t*7.);
    fPos[0] = base + vec3(.8*sin(t*1.7), .5*sin(t*2.3), 0);
    fRot[0] = basisZ(vec3(.2*cos(t*1.7), .15*cos(t*2.3), -1.), vec3(.6*sin(t*1.7), 1, 0));
    fEng[0] = vec3(.4, 1., .9); fAura[0] = 1.; fEngPow[0] = 1.5;
    for (int i = 1; i < 4; i++){
      float fi = float(i);
      fKind[i] = 1;
      fPos[i] = base + vec3((fi - 2.)*2.2 + .6*sin(t*1.3 + fi), .8*sin(t*1.1 + fi*2.) + (fi == 2. ? 1. : 0.), 5. + fi*1.5);
      fRot[i] = basisZ(normalize(fPos[0] - fPos[i]), UP);
      fEng[i] = vec3(1., .2, .1);
    }
    camPos = base + vec3(1.1, .55, -3.6) + shake(t, .05); camTar = base + vec3(0, .15, 3.5); camFov = 1.5; camRoll = -.06;
    boltN = 6;
    for (int i = 0; i < 6; i++){
      float fi = float(i);
      int sh = 1 + i % 3;
      float per = .7 + hash11(fi*2.)*.4;
      float ph = fract((t + hash11(fi)*3.)/per);
      vec3 src = fPos[sh] + fRot[sh]*vec3((i % 2 == 0 ? .2 : -.2), 0, .4);
      vec3 miss = vec3((hash11(fi*9. + floor(t/per)) - .5)*1.6, (hash11(fi*4. + floor(t/per)) - .5)*1.2, 0);
      vec3 dir = normalize(fPos[0] + miss - src - vec3(0, 0, 3.));
      boltA[i] = src + dir*ph*14.; boltB[i] = boltA[i] - dir*1.2;
      boltC[i] = vec3(1., .2, .1)*1.5;
    }
    boomN = 2;
    boomT[0] = t - 5.6; boom[0] = vec4(fPos[0] + vec3(-.9, .5, -1.5), .6);
    boomT[1] = t - 8.2; boom[1] = vec4(base + vec3(-2.5, 1.2, -6.), .8);
  }
  if (V == 17){ // S36: Jax
    fN = 4; fScale = 1.;
    vec3 base = vec3(0, 0, -t*7.);
    fPos[0] = base + vec3(.6*sin(t*1.2), .3*sin(t*1.9), 0);
    fRot[0] = basisZ(vec3(.1*cos(t*1.2), .05, -1.), vec3(.3*sin(t*1.2), 1, 0));
    fEng[0] = vec3(.4, 1., .9); fAura[0] = 1.; fEngPow[0] = 1.5;
    // Jax dives in from above
    float dive = ease(remap(t, 0., 2.2));
    fPos[1] = base + mix(vec3(-6., 7., 3.), vec3(-1.4, .6, 5.5), dive);
    fRot[1] = basisZ(mix(vec3(.5, -.8, -.4), vec3(.05, 0, -1.), dive), UP);
    fEng[1] = vec3(1., .55, .2); fEngPow[1] = 1.4;
    for (int i = 2; i < 4; i++){
      float fi = float(i);
      fKind[i] = 1;
      fPos[i] = base + vec3((fi - 2.5)*2.6, .5*sin(t + fi), 8. + fi);
      fRot[i] = basisZ(normalize(fPos[0] - fPos[i]), UP);
      fEng[i] = vec3(1., .2, .1);
    }
    boomN = 2;
    boomT[0] = t - 2.6; boom[0] = vec4(fPos[2], 1.3);
    boomT[1] = t - 3.3; boom[1] = vec4(fPos[3], 1.4);
    if (t > 2.6) fPos[2] += vec3(0, -50., 0);
    if (t > 3.3) fPos[3] += vec3(0, -50., 0);
    boltN = 6;
    for (int i = 0; i < 6; i++){
      float fi = float(i);
      float fire = 1.6 + fi*.25;
      float a = t - fire;
      vec3 src = fPos[1] + fRot[1]*vec3((i % 2 == 0 ? .55 : -.55), -.01, .3);
      vec3 tgt = i < 3 ? base + vec3(-1.3, .5, 10.) : base + vec3(1.3, .5, 11.);
      vec3 dir = normalize(tgt - src);
      boltA[i] = a > 0. && a < .5 ? src + dir*a*40. : vec3(1e4);
      boltB[i] = boltA[i] - dir*1.5;
      boltC[i] = vec3(1., .6, .25)*1.6;
    }
    camPos = base + vec3(2.4, 1.2, -4.) + shake(t, .05 + .12*exp(-max(t - 2.6, 0.)*2.)*step(2.6, t)); camTar = base + vec3(-1., .8, 4.); camFov = 1.5; camRoll = .05;
  }
  if (V == 18){ // S40: the Starmaw breaks open; ten thousand suns go home
    starOn = true; starPos = vec3(-60., 20., -260.); starRad = 18.; starTemp = 16.; starLife = .9;
    mawOn = true; mawPos = vec3(-10., 4., -120.); mawScale = 30.; mawOpen = 1.; mawCore = (1.5 + 2.*remap(t, 0., 3.))*(1. - .7*remap(t, 4., 8.));
    mawRot = basisZ(starPos - mawPos, UP);
    crackGlow = ease(remap(t, 0., 3.5));
    burst = remap(t, 2.5, 12.);
    streams = remap(t, 3., 12.);
    fillDir = normalize(vec3(-.3, .5, .8)); fillCol = vec3(.25, .3, .5)*.4;
    camPos = vec3(30. - 8.*u, 10., 60. - 20.*u) + shake(t, .3 + 1.5*exp(-max(t - 3., 0.)*.8)*step(3., t)); camTar = mawPos; camFov = 1.5;
    nebA = vec3(.12, .25, .65); nebB = vec3(.45, .12, .55); nebC = vec3(.05, .45, .5); nebDens = 1.; nebSeed = 42.;
  }
  if (V == 19){ // S42: Kessar's sun rekindles
    starOn = true; starPos = vec3(0); starRad = 1.; starTemp = 2.5;
    float re = remap(t, 1., 6.5);
    starLife = ease(re);
    starDead = step(starLife, .001);
    plType = 1; plPos = vec3(5.2, -3.2, 12.); plRad = 3.; plFrost = 1. - .35*ease(remap(t, 4., 12.)); plSpin = .5 + t*.01;
    camPos = vec3(-1.6, .9, 8.5 - .5*u); camTar = mix(vec3(0), vec3(4.6, -2.8, 11.), ease(remap(t, 5.5, 10.5))); camFov = 1.6;
    warpFlash = exp(-max(t - 1., 0.)*2.)*step(1., t)*.8; warpFlashPos = starPos;
    nebA = vec3(.12, .04, .03); nebDens = .3;
  }
}

// ---------------------------------------------------------------- scene SDF
float gMat = 0.;      // 0 maw hull, 1 maw core, 2 blade, 3 destroyer, 4 interceptor, 5 hunter
float gId = 0.;
vec3 fleetShip(int i){
  float fi = float(i);
  float side = mod(fi, 2.) < .5 ? -1. : 1.;
  vec3 o = vec3(side*(1.2 + hash11(fi*3.1)*1.8) + (hash11(fi*7.7) - .5), (hash11(fi*5.7) - .5)*1.4, -fi*2.6 - hash11(fi*1.3)*1.2);
  return o*fleetSpread;
}
float fleetShipArrive(int i){ return fleetArrive + float(i)*.55 + hash11(float(i)*9.1)*.4; }

float map(vec3 p){
  float d = 1e9;
  gMat = 0.;
  if (mawOn){
    vec3 q = transpose(mawRot)*(p - mawPos)/mawScale;
    float bs = length(q) - 2.6;
    if (bs < .5){
      float m;
      float dm = sdStarmaw(q, mawOpen, m)*mawScale;
      if (dm < d){ d = dm; gMat = m; }
    } else d = min(d, bs*mawScale);
  }
  if (fleetN > 0){
    vec3 lp = transpose(fleetRot)*(p - fleetPos)/fleetScale;
    for (int i = 0; i < 12; i++){
      if (i >= fleetN) break;
      if (uT < fleetShipArrive(i)) continue;
      vec3 q = lp - fleetShip(i);
      float s = .75 + .5*hash11(float(i)*2.3);
      float bs = length(q) - 1.2*s;
      float dd;
      if (bs < .3) dd = sdDestroyer(q/s)*s*fleetScale; else dd = bs*fleetScale;
      if (dd < d){ d = dd; gMat = 3.; gId = float(i); }
    }
  }
  for (int i = 0; i < 4; i++){
    if (i >= fN) break;
    vec3 q = transpose(fRot[i])*(p - fPos[i])/fScale;
    float bs = length(q) - .7;
    float dd;
    if (bs < .3) dd = (fKind[i] == 1 ? sdHunter(q) : sdInterceptor(q))*fScale; else dd = bs*fScale;
    if (dd < d){ d = dd; gMat = fKind[i] == 1 ? 5. : 4.; gId = float(i); }
  }
  return d;
}
vec3 calcNormal(vec3 p, float e){
  vec2 k = vec2(1, -1);
  return normalize(k.xyy*map(p + k.xyy*e) + k.yyx*map(p + k.yyx*e) + k.yxy*map(p + k.yxy*e) + k.xxx*map(p + k.xxx*e));
}
float march(vec3 ro, vec3 rd, float tmax, out float steps){
  float t = .001;
  steps = 0.;
  for (int i = 0; i < 140; i++){
    float d = map(ro + rd*t);
    if (d < t*.0006) return t;
    t += d*.9;
    steps += 1.;
    if (t > tmax) break;
  }
  return -1.;
}

// ---------------------------------------------------------------- star
vec3 starRamp(float x){
  if (starTemp > 8.){ // young blue star
    vec3 c = mix(vec3(.02, .08, .4), vec3(.2, .45, 1.), smoothstep(0., .5, x));
    c = mix(c, vec3(.6, .8, 1.), smoothstep(.45, .9, x));
    return mix(c, vec3(.95, .97, 1.), smoothstep(.9, 1.4, x));
  }
  vec3 c = mix(vec3(.3, .02, .0), vec3(1., .25, .02), smoothstep(0., .5, x));
  c = mix(c, vec3(1., .55, .15), smoothstep(.45, .9, x));
  return mix(c, vec3(1., .88, .65), smoothstep(.9, 1.4, x));
}
vec3 starSurface(vec3 n, vec3 rd){
  float T = uGlobalT;
  vec3 nn = n;
  nn.xz = rot(T*.01)*nn.xz;
  vec3 w = vec3(fbm(nn*3. + T*.03, 4), fbm(nn*3. + 7. - T*.03, 4), fbm(nn*3. + 3., 4));
  vec3 v = voronoi(nn*9. + w*2.2 + vec3(0, T*.04, 0));
  float cells = 1. - smoothstep(.1, .95, v.x);
  float fil = fbm(nn*18. + w*4. + vec3(T*.05), 4);
  float big = fbm(nn*2.2 + w*1.5 + vec3(T*.02), 5);
  float spots = smoothstep(.68, .76, fbm(nn*3.2 + 10., 4));
  float I = .35 + .45*cells + .45*(fil - .5);
  I *= .5 + 1.*big;
  I *= 1. - .85*spots;
  float mu = max(dot(n, -rd), 0.);
  I *= .3 + .7*pow(mu, .6);
  if (ribbon > 0.){
    float dw = length(n - normalize(ribA - starPos));
    I += ribbon*(exp(-dw*dw*80.)*2. + exp(-dw*7.)*.35);
  }
  float life = starLife;
  vec3 c = starRamp(I*mix(.5, 1., life));
  return c*(.3 + 1.5*I)*mix(.25, 1.6, life);
}
vec3 corona(vec3 ro, vec3 rd, float tlimit){
  vec3 oc = starPos - ro;
  float b = dot(oc, rd);
  if (b < 0.) return vec3(0);
  if (tlimit < b) return vec3(0);
  float R = starRad*mix(.02, 1., pow(starLife, .5));
  vec3 cp = ro + rd*b;
  float dc = length(cp - starPos);
  float h = max(dc/R - 1., 0.);
  vec3 dir = normalize(cp - starPos);
  vec3 X = normalize(cross(rd, vec3(0, 1, 0))), Y = cross(X, rd);
  float ang = atan(dot(dir, Y), dot(dir, X));
  float T = uGlobalT;
  vec3 col = starRamp(.75*starLife + .2);
  float g = 0.;
  if (h < 1.2){
    float flame = fbm(vec3(ang*3., h*3. - T*.15, T*.05), 5);
    float fil = pow(fbm(vec3(ang*9., h*6. - T*.25, 3.), 4), 3.)*4.;
    g = exp(-h*5.)*(.4 + 1.4*flame) + fil*exp(-h*9.);
  }
  g += .1*exp(-h*1.8);
  g += .01*exp(-h*.7);
  float life = starLife;
  vec3 c = col*g*mix(.0, 3.5, life);
  // death: ember rim and final flash
  if (starDead > .5 || life < .999){
    float emb = .3 + 1.2*fbm(vec3(ang*6., T*.2, 1.), 3);
    float emb2 = smoothstep(.45, .8, fbm(vec3(ang*4., T*.15, 5.), 3));
    float rim = (exp(-abs(dc/starRad - 1.)*50.)*.35*emb*emb2 + exp(-max(dc/starRad - 1., 0.)*6.)*.03)*smoothstep(.6, 0., life);
    c += vec3(1., .2, .04)*rim;
    // collapse shockwave
    float sw = (1. - life);
    c += vec3(1., .5, .25)*exp(-abs(dc/starRad - (1. + 5.*smoothstep(.85, 1., sw)))*25.)*smoothstep(.85, .9, sw)*smoothstep(1.3, 1., sw + 0.)*.0;
  }
  return c;
}

// ---------------------------------------------------------------- planet
vec3 planetShade(vec3 p, vec3 n, vec3 rd, vec3 L, vec3 Lc){
  vec3 q = n;
  q.xz = rot(plSpin)*q.xz;
  float ndl = dot(n, L);
  float day = smoothstep(-.1, .3, ndl);
  float fil = max(dot(n, fillDir), 0.);
  vec3 alb, em = vec3(0);
  float wet = 0.;
  if (plType == 1){ // Kessar: ochre continents, dark seas, clouds -> ice
    float cont = fbm(q*2.3 + 4., 6);
    float land = smoothstep(.48, .52, cont);
    vec3 ground = mix(vec3(.04, .08, .13), mix(vec3(.35, .22, .1), vec3(.5, .4, .28), fbm(q*9., 4)), land);
    float cl = smoothstep(.5, .75, fbm(q*4. + vec3(0, 0, uGlobalT*.004), 6));
    ground = mix(ground, vec3(.85), cl*.8);
    float cr = voronoi(q*14.).y;
    vec3 ice = mix(vec3(.45, .55, .72), vec3(.85, .92, 1.), fbm(q*6. + 2., 5));
    ice *= .75 + .25*smoothstep(0., .08, cr);
    ice = mix(ice, vec3(.25, .35, .5), smoothstep(.5, .7, fbm(q*3. + 9., 4))*.6);
    alb = mix(ground, ice, plFrost);
    wet = (1. - land)*(1. - plFrost) + plFrost*.3;
    float city = smoothstep(.7, .9, fbm(q*30., 3))*land*(1. - day)*(1. - plFrost);
    em = vec3(1., .6, .25)*city*.25;
  } else { // Veyra: ocean moon with rivers of living light
    vec3 w = vec3(fbm(q*2.5, 4), fbm(q*2.5 + 5.1, 4), fbm(q*2.5 + 9.7, 4));
    float cl = smoothstep(.5, .78, fbm(q*3.2 + w*1.6 + vec3(uGlobalT*.003, 0, 0), 6));
    vec3 sea = mix(vec3(.01, .04, .1), vec3(.02, .12, .18), fbm(q*5. + w, 4));
    float isl = smoothstep(.66, .7, fbm(q*5. + 3.*w, 5));
    sea = mix(sea, vec3(.03, .1, .07), isl);
    alb = mix(sea, vec3(.9, .92, 1.), cl*.9);
    wet = (1. - cl)*(1. - isl);
    float f1 = fbm(q*3. + 2.2*w, 5), f2 = fbm(q*8. + 3.*w + 4., 4);
    float lines = exp(-abs(f1 - .5)*55.) + .55*exp(-abs(f2 - .5)*70.) + isl*.6;
    float pulse = .55 + .45*sin(uGlobalT*1.4 - f1*30.);
    vec3 vc = mix(vec3(.1, .95, .85), vec3(.55, .35, 1.), smoothstep(.3, .7, w.x));
    em = vc*lines*pulse*(1. - day*.9)*(1. - cl*.75)*(.5 + plNight)*.9;
  }
  vec3 col = alb*(max(ndl, 0.)*Lc*1.5 + fil*fillCol*1.2);
  vec3 h = normalize(L - rd);
  col += Lc*pow(max(dot(n, h), 0.), 80.)*wet*.8;
  col += fillCol*pow(max(dot(n, normalize(fillDir - rd)), 0.), 40.)*wet*.3;
  return col + em;
}

// ---------------------------------------------------------------- volumetric fx
// distance between ray and segment, returns (dist, t along ray, s along segment)
vec3 ribbonFx(vec3 ro, vec3 rd, float tlimit){
  if (ribbon <= 0.) return vec3(0);
  vec3 best = vec3(1e9, 0, 0);
  const int K = 22;
  vec3 prev = bez(ribA, ribB, ribC, 0.);
  for (int i = 1; i <= K; i++){
    float s = float(i)/float(K);
    vec3 cur = bez(ribA, ribB, ribC, s);
    vec3 r = raySeg(ro, rd, prev, cur);
    if (r.x < best.x){ best = vec3(r.x, r.y, (float(i - 1) + r.z)/float(K)); }
    prev = cur;
  }
  if (best.y > tlimit) return vec3(0);
  float s = best.z;
  if (s > ribbonProg) return vec3(0);
  float w = mix(ribW*1.3, ribW*.18, pow(s, .7));
  float T = uGlobalT;
  float n1 = fbm(vec3(s*14. - T*2.2, best.x/w*1.5, T*.3), 4);
  float n2 = vnoise(vec3(s*50. - T*6., best.x/w*3., 1.));
  float core = exp(-pow(best.x/(w*.25), 2.));
  float glow = exp(-pow(best.x/(w*(.7 + .6*n1)), 2.));
  float halo = exp(-best.x/(w*2.5))*.2;
  float hel = exp(-pow((best.x - w*.5*(.5 + .5*sin(s*60. - T*8.)))/(w*.12), 2.));
  float I = (core*1.6 + glow*(.3 + 1.3*n2*n1) + hel*.8 + halo)*ribbon;
  I *= smoothstep(ribbonProg, ribbonProg - .05, s);
  vec3 c = mix(starRamp(1.2), starRamp(.8), s);
  return c*I*2.2;
}
vec3 glowPoint(vec3 ro, vec3 rd, vec3 p, float r, float tlimit){
  float b = dot(p - ro, rd);
  if (b < 0. || b > tlimit) return vec3(0);
  float d = length(ro + rd*b - p);
  return vec3(exp(-pow(d/r, 2.)), exp(-d/(r*4.))*.15, 0);
}
vec3 fireball(vec3 ro, vec3 rd, vec4 s, float age, float tlimit){
  vec2 h = sphIntersect(ro, rd, s.xyz, s.w);
  if (h.y < 0. || h.x > tlimit) return vec3(0);
  float t0 = max(h.x, 0.), t1 = min(h.y, tlimit);
  vec3 acc = vec3(0); float tr = 1.;
  float dt = (t1 - t0)/10.;
  float grow = easeOut(age*1.8);
  for (int i = 0; i < 10; i++){
    vec3 p = ro + rd*(t0 + dt*(float(i) + .5));
    vec3 q = (p - s.xyz)/s.w;
    float r = length(q)/max(grow, .05);
    float n = fbm(q*3. + vec3(0, age*1.5, 0), 4);
    float dens = smoothstep(1., .2, r + n*.6 - .2)*(1. - smoothstep(.8, 2.5, age));
    float temp = mix(12., 1.2, clamp(r + age*.6, 0., 1.));
    vec3 e = blackbody(temp)*dens*mix(10., 1., clamp(age*.8, 0., 1.));
    acc += tr*e*dt/s.w*3.;
    tr *= exp(-dens*dt/s.w*4.);
  }
  float flash = exp(-age*7.)*4.;
  vec3 g = glowPoint(ro, rd, s.xyz, s.w*.8, tlimit);
  return acc + vec3(1., .8, .6)*flash*(g.x + g.y);
}

// ---------------------------------------------------------------- render
vec3 skyGen(vec3 rd){ setup(0.); return nebula(rd, nebA, nebB, nebC, nebDens, nebSeed); }
vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  setup(t);
  if (ribbon > 0.){
    vec3 toM = normalize(mawPos - starPos);
    ribA = starPos + toM*starRad*.96 + vec3(0, .05, 0);
    ribC = mawPos + mawRot*vec3(0, 0, -.12*mawScale);
    ribB = mix(ribA, ribC, .45) + vec3(0, .6, .25)*length(ribC - ribA)*.35;
  }
  vec3 ro = camPos + camShake;
  mat3 cam = camLook(ro, camTar, camRoll);
  vec3 rd = cam*normalize(vec3(uv, camFov));

  // --- sky
  vec3 col = starfield(rd, starsBright) + sky(rd);

  float tHit = 1e9;
  // --- star
  float starR = starRad*mix(.02, 1., pow(starLife, .5));
  vec2 sh = starOn ? sphIntersect(ro, rd, starPos, starR) : vec2(-1);
  if (starOn && sh.x > 0.){
    tHit = sh.x;
    vec3 n = normalize(ro + rd*sh.x - starPos);
    col = starDead > .5 ? vec3(0) : starSurface(n, rd);
  }
  // --- planet
  vec3 L = starOn ? vec3(0) : lightDir;
  vec3 Lc = starOn ? blackbody(starTemp)*mix(0., 1.4, pow(starLife, .7)) : lightCol;
  if (plType > 0){
    vec3 Lp = starOn ? normalize(starPos - plPos) : lightDir;
    vec2 ph = sphIntersect(ro, rd, plPos, plRad);
    if (ph.x > 0. && ph.x < tHit){
      tHit = ph.x;
      vec3 p = ro + rd*ph.x;
      vec3 n = normalize(p - plPos);
      col = planetShade(p, n, rd, Lp, Lc);
      col += (plType == 1 ? mix(vec3(.02, .03, .045), vec3(.5, .6, .8), plFrost*.5) : vec3(.05))*fillCol*max(dot(n, fillDir)*.5 + .5, 0.)*2.;
    }
    vec3 atmC = plType == 1 ? mix(vec3(.9, .6, .4), vec3(.4, .6, 1.), plFrost) : vec3(.3, .5, 1.);
    float atmAmt = plType == 1 ? mix(1., .35, plFrost) : 1.;
    vec3 atm = atmosphere(ro, rd, plPos, plRad, plRad*.035, Lp, atmC*.12, tHit, .75)*atmAmt*.45;
    col += (1. - exp(-atm*Lc*1.5)) + atm*fillCol*.6;
  }
  // --- solid objects
  float steps;
  float th = march(ro, rd, min(tHit, 400.), steps);
  if (th > 0.){
    tHit = th;
    vec3 p = ro + rd*th;
    float m = gMat;
    float mid = gId;
    vec3 n = calcNormal(p, th*.0008);
    bool starLit = starOn && starLife > .01;
    vec3 Ld = starLit ? normalize(starPos - p) : lightDir;
    vec3 Lcol = starLit ? Lc*1.2 : lightCol;
    float dif = max(dot(n, Ld), 0.);
    float fres = pow(1. - max(dot(n, -rd), 0.), 4.);
    float back = pow(max(dot(rd, Ld), 0.), 3.);
    float ao = clamp(1. - steps/140.*1.2, .2, 1.);
    vec3 alb = vec3(.035, .036, .04);
    float gloss = .5;
    if (m >= 4.){
      vec3 q = transpose(fRot[int(mid)])*(p - fPos[int(mid)])/fScale;
      float pan = step(.04, abs(fract(q.z*9.) - .5))*step(.03, abs(fract(q.x*7. + .5) - .5));
      alb = m == 4. ? vec3(.16, .17, .19) : vec3(.06, .055, .055);
      alb *= .7 + .3*pan;
      alb = mix(alb, vec3(.35, .08, .04), step(.42, abs(q.x))*step(q.x*0., 1.)*(m == 4. ? 1. : 0.));
      if (m == 4. && sdEllipsoid(q - vec3(0, .045, .18), vec3(.047, .042, .142)) < .004){ alb = vec3(.01, .015, .02); gloss = 3.; }
    }
    if (m == 3.) alb = vec3(.05, .05, .055);
    vec3 c = alb*(dif*Lcol*2.2 + vec3(.02, .025, .04)*ao + max(dot(n, fillDir), 0.)*fillCol*2.);
    c += fillCol*fres*.5;
    // rim from backlight: the key look of silhouettes against the star
    c += Lcol*fres*back*1.8 + Lcol*fres*.06;
    float spec = pow(max(dot(reflect(rd, n), Ld), 0.), 40.);
    c += Lcol*spec*.4*gloss + fillCol*pow(max(dot(reflect(rd, n), fillDir), 0.), 20.)*.3*gloss;
    if (m == 1.) c = vec3(1., .5, .2)*6.*mawCore + blackbody(starTemp)*4.*mawCore;
    if (m < 2.5 && m != 1.){
      vec3 q = transpose(mawRot)*(p - mawPos)/mawScale;
      c += vec3(1., .55, .25)*starmawEmissive(q)*1.5;
      if (crackGlow > 0.){
        vec3 v = voronoi(q*5.);
        float crack = exp(-v.y*40.)*step(v.z, crackGlow*1.1);
        c += mix(vec3(.4, 1., .9), vec3(1., .85, .5), v.z)*crack*6.*crackGlow;
      }
    }
    if (m == 3.){
      vec3 lp = transpose(fleetRot)*(p - fleetPos)/fleetScale - fleetShip(int(mid));
      vec2 g = floor(vec2(lp.z*60., lp.y*90.));
      c += vec3(1., .75, .45)*step(.9, hash12(g + mid))*step(abs(lp.y), .06)*1.5;
    }
    col = c;
  }
  // --- additive light: corona, ribbon, engines, explosions
  if (starOn) col += corona(ro, rd, tHit);
  if (starOn && starDead < .5 && sh.x < 0.){
    // soft outer halo of the star
    vec3 oc = starPos - ro;
    float b = dot(oc, rd);
    if (b > 0. && b < tHit){
      float dc = length(ro + rd*b - starPos)/starR;
      col += blackbody(starTemp)*exp(-(dc - 1.)*.9)*.015*starLife;
    }
  }
  col += ribbonFx(ro, rd, tHit);
  if (mawOn){
    vec3 cp = mawPos + mawRot*vec3(0, 0, -.12*mawScale);
    vec3 g = glowPoint(ro, rd, cp, .25*mawScale, 1e9);
    col += (vec3(1., .45, .15)*g.x*3. + vec3(1., .4, .2)*g.y*1.5)*mawCore;
  }
  if (fleetN > 0){
    for (int i = 0; i < 12; i++){
      if (i >= fleetN) break;
      float arr = fleetShipArrive(i);
      vec3 sp = fleetPos + fleetRot*(fleetShip(i)*fleetScale);
      float s = (.75 + .5*hash11(float(i)*2.3))*fleetScale;
      vec3 back = fleetRot*vec3(0, 0, -1);
      if (uT >= arr){
        vec3 e = sp + back*1.05*s;
        vec3 g = glowPoint(ro, rd, e, .05*s, tHit + .5*s);
        col += vec3(1., .3, .12)*(g.x*4. + g.y*2.);
      }
      // warp-in: a streak collapsing onto the ship, then a flash
      float a = uT - arr;
      if (a > -.35 && a < 2.){
        float stretch = a < 0. ? (-a/.35) : 0.;
        vec3 tail = sp - back*(-40.*stretch*s) ;
        tail = sp + fleetRot*vec3(0, 0, 1)*(-60.*stretch*s);
        vec3 r = raySeg(ro, rd, sp, sp - fleetRot*vec3(0, 0, 1)*(80.*stretch + .01)*s);
        if (a < 0.) col += vec3(.6, .75, 1.)*exp(-r.x/(.012*s))*3.;
        float fl = a >= 0. ? exp(-a*3.5) : 0.;
        vec3 g = glowPoint(ro, rd, sp, .6*s, 1e9);
        col += vec3(.7, .8, 1.)*fl*(g.x*6. + g.y*3.);
      }
    }
  }
  for (int i = 0; i < 4; i++){
    if (i >= fN) break;
    vec3 e = fPos[i] + fRot[i]*vec3(0, 0, -.44)*fScale;
    vec3 ex = fRot[i]*vec3(.1, 0, 0)*fScale;
    vec3 g1 = glowPoint(ro, rd, e + ex, .022*fScale, tHit + .1*fScale);
    vec3 g2 = glowPoint(ro, rd, e - ex, .022*fScale, tHit + .1*fScale);
    col += fEng[i]*(g1.x + g2.x)*7.*fEngPow[i] + fEng[i]*(g1.y + g2.y)*.8*fEngPow[i];
  }
  for (int i = 0; i < 4; i++){
    if (i >= fN) break;
    vec3 fwd = fRot[i]*vec3(0, 0, 1);
    vec3 e = fPos[i] - fwd*.44*fScale;
    if (fTrail[i] > 0.){
      vec3 r = raySeg(ro, rd, e, e - fwd*fScale*6.);
      if (r.y < tHit + fScale) col += fEng[i]*exp(-pow(r.x/(fScale*.012*(1. + r.z*3.)), 2.))*pow(1. - r.z, 3.)*fTrail[i]*.5;
    }
    if (fWarp[i] > 0.){
      vec3 r = raySeg(ro, rd, fPos[i], fPos[i] - fwd*fScale*60.*fWarp[i]);
      col += vec3(.6, .8, 1.)*exp(-pow(r.x/(fScale*.02), 2.))*fWarp[i]*4.*(1. - r.z*.8);
    }
    if (fAura[i] > 0.){
      vec3 g = glowPoint(ro, rd, fPos[i], fScale*.5, tHit + fScale);
      float sh = .6 + .4*sin(uGlobalT*6. + float(i));
      col += (vec3(.3, .9, 1.)*g.x*.8 + vec3(1., .8, .4)*g.y*1.5)*fAura[i]*sh;
      vec3 seed = fPos[i] - fRot[i]*vec3(0, .06, 0)*fScale;
      vec3 gs = glowPoint(ro, rd, seed, fScale*.05, 1e9);
      col += vec3(.7, 1., .95)*(gs.x*8. + gs.y*3.)*fAura[i];
    }
  }
  if (entry > 0.){
    vec3 fwd = fRot[0]*vec3(0, 0, 1);
    vec3 nose = fPos[0] + fwd*.5*fScale;
    vec3 r = raySeg(ro, rd, nose + fwd*.05*fScale, nose - fwd*fScale*3.);
    float n = fbm(vec3(r.z*12. - uGlobalT*10., r.x/fScale*8., 0), 3);
    float w = fScale*(.12 + .5*r.z);
    float sheath = exp(-pow(r.x/w, 2.))*(1. - r.z)*(.5 + n);
    col += mix(vec3(1., .75, .45), vec3(1., .3, .5), r.z)*sheath*entry*3.;
  }
  for (int i = 0; i < 12; i++){
    if (i >= boltN) break;
    vec3 r = raySeg(ro, rd, boltA[i], boltB[i]);
    if (r.y > tHit) continue;
    float w = max(length(boltB[i] - boltA[i])*.02, r.y*.0012);
    col += boltC[i]*(exp(-pow(r.x/w, 2.))*6. + exp(-r.x/(w*4.))*.4);
  }
  if (siphon > 0. && mawOn){
    vec3 a = mawPos + mawRot*vec3(0, 0, -.1*mawScale);
    vec3 b = starPos + normalize(a - starPos)*starRad*.98;
    vec3 r = raySeg(ro, rd, a, b);
    if (r.y < tHit + 1.){
      float w = mawScale*.015;
      float fl = .7 + .3*sin(uGlobalT*40. + r.z*30.);
      col += vec3(1., .5, .3)*(exp(-pow(r.x/w, 2.))*8.*fl + exp(-r.x/(w*6.))*.6)*siphon;
    }
  }
  for (int i = 0; i < 4; i++){
    if (i >= boomN) break;
    if (boomT[i] >= 0.) col += fireball(ro, rd, boom[i], boomT[i], tHit);
  }
  if (burst > 0. && mawOn){
    vec3 cp = mawPos;
    float b = dot(cp - ro, rd);
    vec3 dp = ro + rd*b - cp;
    float d = length(dp);
    vec3 X = camLook(ro, camTar, 0.)[0], Y = camLook(ro, camTar, 0.)[1];
    float ang = atan(dot(dp, Y), dot(dp, X));
    float R = mawScale;
    float beams = pow(fbm(vec3(ang*9., 0, 5.), 3), 4.)*30.;
    vec3 bc = mix(vec3(.35, 1., .9), vec3(1., .8, .45), step(.5, fract(ang*2.3)));
    col += bc*beams*exp(-d/(R*3.))*smoothstep(0., .1, burst)*exp(-burst*2.5)*.5;
    col += vec3(1., .95, .85)*exp(-d/(R*(.6 + 2.*burst)))*smoothstep(0., .05, burst)*exp(-burst*8.)*4.;
  }
  if (streams > 0.){
    // thousands of freed suns racing away in every direction
    for (int i = 0; i < 40; i++){
      float fi = float(i);
      vec3 dir = normalize(hash33(vec3(fi, 3., 7.)) - .5);
      float st = hash11(fi*1.7)*.4;
      float k = clamp((streams - st)/(1. - st), 0., 1.);
      if (k <= 0.) continue;
      float dist = mawScale*(.3 + 30.*easeIn(k)*(.6 + .8*hash11(fi*5.)));
      vec3 head = mawPos + dir*dist;
      vec3 tail = mawPos + dir*max(dist - mawScale*6., mawScale*.3);
      vec3 r = raySeg(ro, rd, tail, head);
      float w = max(r.y*.0015, mawScale*.02);
      vec3 sc = blackbody(mix(3., 20., hash11(fi*9.)));
      col += sc*(exp(-pow(r.x/w, 2.))*(.4 + 2.*r.z*r.z) + exp(-r.x/(w*6.))*.1)*(1. - k*.5)*2.;
    }
  }
  if (warpFlash > 0.){
    vec3 g = glowPoint(ro, rd, warpFlashPos, 1., 1e9);
    col += vec3(.7, .85, 1.)*warpFlash*(g.x*10. + g.y*5.);
  }
  return col;
}
