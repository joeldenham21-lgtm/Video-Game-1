// STARWAKE -- character rigs as signed distance fields.
// Origin at the feet, facing +Z, units in metres.
// pose: x = walk phase, y = walk amount, z = look up (rad), w = arms raised (0..1)

float gFigPart = 0.;   // 0 body, 1 head, 2 robe, 3 hair/fronds
float gHairStyle = 0.; // 0 = Asha's ponytail, 1 = short (her father)

vec3 limb(vec3 a, float len, float pitch, float roll){
  // direction from pitch (forward swing about X) and roll (out to the side about Z)
  vec3 d = vec3(sin(roll), -cos(roll)*cos(pitch), cos(roll)*sin(pitch));
  return a + d*len;
}

// Asha Venn: pilot, 1.74 m, flight suit, short ponytail
float sdAsha(vec3 p, vec4 pose){
  float ph = pose.x, w = pose.y;
  float bob = abs(sin(ph))*.03*w;
  p.y -= bob;
  float d;
  // legs
  float sL = sin(ph)*.42*w, sR = -sL;
  vec3 hipL = vec3(-.09, .92, 0), hipR = vec3(.09, .92, 0);
  vec3 kneeL = limb(hipL, .45, sL, 0.), kneeR = limb(hipR, .45, sR, 0.);
  vec3 ankL = limb(kneeL, .43, sL - max(0., sin(ph + 1.6))*.7*w, 0.);
  vec3 ankR = limb(kneeR, .43, sR - max(0., sin(ph + 1.6 + PI))*.7*w, 0.);
  d = sdCapsule2(p, hipL, kneeL, .075, .055);
  d = min(d, sdCapsule2(p, kneeL, ankL, .052, .04));
  d = min(d, sdCapsule2(p, hipR, kneeR, .075, .055));
  d = min(d, sdCapsule2(p, kneeR, ankR, .052, .04));
  d = min(d, sdRoundBox(p - ankL - vec3(0, -.02, .05), vec3(.045, .035, .11), .02));
  d = min(d, sdRoundBox(p - ankR - vec3(0, -.02, .05), vec3(.045, .035, .11), .02));
  // torso
  float tor = sdCapsule2(p, vec3(0, .95, 0), vec3(0, 1.36, 0), .13, .16);
  tor = smin(tor, sdEllipsoid(p - vec3(0, 1.3, .01), vec3(.2, .13, .12)), .06);
  d = smin(d, tor, .05);
  // jacket collar
  d = min(d, sdCapsule2(p, vec3(0, 1.42, -.02), vec3(0, 1.5, -.03), .085, .075));
  // arms
  float ar = pose.w;
  vec3 shL = vec3(-.2, 1.4, 0), shR = vec3(.2, 1.4, 0);
  float swing = -sL*.6;
  vec3 elL = limb(shL, .3, swing + ar*1.6, -.12 - ar*.3);
  vec3 elR = limb(shR, .3, -swing + ar*.5, .12);
  vec3 wrL = limb(elL, .27, swing*1.3 + ar*2.2 + .15, -.05);
  vec3 wrR = limb(elR, .27, -swing*1.3 + .15 + ar*.4, .05);
  d = min(d, sdCapsule2(p, shL, elL, .055, .045));
  d = min(d, sdCapsule2(p, elL, wrL, .045, .035));
  d = min(d, sdCapsule2(p, shR, elR, .055, .045));
  d = min(d, sdCapsule2(p, elR, wrR, .045, .035));
  d = min(d, length(p - wrL - normalize(wrL - elL)*.06) - .045);
  d = min(d, length(p - wrR - normalize(wrR - elR)*.06) - .045);
  gFigPart = 0.;
  // head, looking up
  vec3 hp = p - vec3(0, 1.6, .02);
  hp.yz = rot(-pose.z)*hp.yz;
  float head = sdEllipsoid(hp, vec3(.085, .11, .1));
  float hair = sdEllipsoid(hp - vec3(0, .02, -.03), vec3(.09, .1, .1));
  if (gHairStyle < .5) hair = min(hair, sdCapsule2(hp, vec3(0, .02, -.1), vec3(0, -.12, -.14), .035, .015));
  float neck = sdCapsule(p, vec3(0, 1.45, 0), vec3(0, 1.56, .01), .045);
  float hd = min(head, hair);
  if (hd < d){ gFigPart = hair < head ? 3. : 1.; }
  d = min(d, min(hd, neck));
  return d;
}

// Aurai: 2.6 m, slender, crested head with trailing fronds, flowing robe
float sdAurai(vec3 p, vec4 pose, float seed){
  float ph = pose.x, w = pose.y;
  float T = uGlobalT;
  float d;
  float sL = sin(ph)*.35*w;
  // robe: flared, hem ripples
  float yb = clamp(p.y, 0., 1.9);
  float rr = mix(.42, .16, pow(yb/1.9, .8));
  float ang = atan(p.x, p.z);
  rr += .03*sin(ang*6. + T*1.5 + seed*7. + p.y*3.)*smoothstep(1.2, 0., p.y);
  vec3 rp = p;
  rp.z += sL*.25*smoothstep(1.2, 0., p.y);
  float robe = max(length(rp.xz*vec2(1., 1.25)) - rr, abs(p.y - .98) - .95);
  robe = max(robe, -p.y + .02);
  gFigPart = 2.;
  d = robe;
  // torso and shoulders
  float tor = sdCapsule2(p, vec3(0, 1.6, 0), vec3(0, 2.05, 0), .12, .14);
  tor = smin(tor, sdEllipsoid(p - vec3(0, 2.0, 0), vec3(.24, .09, .1)), .05);
  if (tor < d) gFigPart = 0.;
  d = smin(d, tor, .08);
  // long neck
  vec3 hp = p - vec3(0, 2.34, .05);
  hp.yz = rot(-pose.z)*hp.yz;
  float neck = sdCapsule2(p, vec3(0, 2.05, 0), vec3(0, 2.3, .04), .06, .045);
  // head: elongated crest sweeping back
  float head = sdEllipsoid(hp, vec3(.085, .12, .11));
  head = smin(head, sdCapsule2(hp, vec3(0, .06, -.02), vec3(0, .2, -.28), .07, .02), .05);
  // fronds
  float fr = 1e9;
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    float sx = (fi - 1.5)*.05;
    float sway = sin(T*1.1 + fi*1.7 + seed*3.)*.05;
    vec3 a0 = vec3(sx, .12, -.12), a1 = vec3(sx*2. + sway, -.05, -.36), a2 = vec3(sx*2.5 + sway*2., -.45, -.42);
    fr = min(fr, sdCapsule2(hp, a0, a1, .018, .012));
    fr = min(fr, sdCapsule2(hp, a1, a2, .012, .004));
  }
  if (min(head, neck) < d) gFigPart = 1.;
  d = min(d, min(head, neck));
  if (fr < d) gFigPart = 3.;
  d = min(d, fr);
  // arms: long and thin; raise for song
  float ar = pose.w;
  vec3 shL = vec3(-.22, 1.98, 0), shR = vec3(.22, 1.98, 0);
  vec3 elL = limb(shL, .42, -sL*.5 + ar*.4, -.15 - ar*1.7);
  vec3 elR = limb(shR, .42, sL*.5 + ar*.4, .15 + ar*1.7);
  vec3 wrL = limb(elL, .4, -sL*.6 + .2 + ar*.3, -.1 - ar*2.3);
  vec3 wrR = limb(elR, .4, sL*.6 + .2 + ar*.3, .1 + ar*2.3);
  float arms = sdCapsule2(p, shL, elL, .045, .035);
  arms = min(arms, sdCapsule2(p, elL, wrL, .035, .02));
  arms = min(arms, sdCapsule2(p, shR, elR, .045, .035));
  arms = min(arms, sdCapsule2(p, elR, wrR, .035, .02));
  // long fingers as a single tapered blade
  arms = min(arms, sdCapsule2(p, wrL, wrL + normalize(wrL - elL)*.16, .022, .006));
  arms = min(arms, sdCapsule2(p, wrR, wrR + normalize(wrR - elR)*.16, .022, .006));
  if (arms < d) gFigPart = 0.;
  d = min(d, arms);
  return d;
}

// bioluminescent markings of the Aurai (local-space pattern)
float auraiMarks(vec3 p, float seed){
  float T = uGlobalT;
  float ang = atan(p.x, p.z);
  // flowing lines that spiral around the body
  float f = fract(p.y*3.2 + sin(ang*2. + p.y*1.5)*.25 + ang*.16);
  float lines = exp(-abs(f - .5)*60.)*(.4 + .6*step(.35, vnoise(p*6. + seed)));
  // fine constellations of dots
  vec3 q = p*22.;
  vec3 c = floor(q);
  vec3 fr = fract(q) - .5;
  float dots = exp(-dot(fr, fr)*40.)*step(.86, hash13(c + seed));
  float crest = smoothstep(2.4, 2.6, p.y)*.15;
  float pulse = .55 + .45*sin(T*2. - p.y*3. + seed*5.);
  return (lines*.8 + dots*.9 + crest)*pulse;
}
