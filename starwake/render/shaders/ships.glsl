// STARWAKE -- ship designs (signed distance functions). All ships point +Z.

float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }

// ------------------------------------------------------------------------
// THE STARMAW: a colossal ring whose inner blades form an iris-like maw.
// Ring radius 1. Maw opens toward +Z. Spine trails toward -Z.
// matId: 0 hull, 1 core, 2 blade
float sdStarmaw(vec3 p, float open, out float matId){
  matId = 0.;
  float r = length(p.xy);
  float a = atan(p.y, p.x);
  // main ring, stepped cross-section
  vec2 q = vec2(r - 1., p.z);
  float ring = sdBox2(q, vec2(.085, .2)) - .012;
  ring = min(ring, sdBox2(q - vec2(.07, -.08), vec2(.06, .26)) - .01);
  // segments: armour plates with gaps and rim greebles
  const float NS = 48.;
  float cell = floor((a/TAU + .5)*NS);
  float la = (fract((a/TAU + .5)*NS) - .5)*TAU/NS*r;   // arc-length within cell
  float hh = hash11(cell*1.37);
  float plate = sdBox(vec3(r - 1.17, la, p.z + .02), vec3(.035 + .03*hh, TAU/NS*.42, .16 + .08*hh));
  ring = min(ring, plate);
  float gap = sdBox(vec3(r - 1., la, p.z - .2), vec3(.2, .004, .03));
  ring = max(ring, -gap);
  // trench on front face
  ring = max(ring, -sdBox2(vec2(r - .98, p.z - .2), vec2(.02, .012)));
  // iris blades
  const float NB = 14.;
  float cb = floor((a/TAU + .5)*NB);
  float ba = (fract((a/TAU + .5)*NB) - .5)*TAU/NB;
  vec3 bp = vec3(r*cos(ba), r*sin(ba), p.z);
  float inner = mix(.28, .7, 1. - open);
  // blade leans forward (toward +Z) as it reaches inward -> funnel
  vec3 lp = bp - vec3(mix(.95, inner, .5), 0., .1 + .12*(1. - open));
  lp.xz = rot(.55)*lp.xz;
  lp.xy = rot(.35)*lp.xy;
  float blade = sdBox(lp, vec3((.95 - inner)*.5, .012, .05)) - .004;
  blade = max(blade, -(r - inner));
  if (blade < ring){ matId = 2.; }
  float d = min(ring, blade);
  // talons: eight great claws reaching forward around the maw
  const float NT = 8.;
  float ct = floor((a/TAU + .5)*NT + .5);
  float ta = (fract((a/TAU + .5)*NT + .5) - .5)*TAU/NT;
  vec3 tp = vec3(r*cos(ta), r*sin(ta), p.z);
  float cl = sdCapsule2(tp, vec3(1.12, 0, .05), vec3(1.34, 0, .55), .07, .045);
  cl = min(cl, sdCapsule2(tp, vec3(1.34, 0, .55), vec3(1.22, 0, 1.0), .045, .025));
  cl = min(cl, sdCapsule2(tp, vec3(1.22, 0, 1.0), vec3(.98, 0, 1.28), .025, .004));
  cl = max(cl, abs(tp.y) - .05);
  d = min(d, cl);
  // spokes and core
  const float NK = 6.;
  float ck = floor((a/TAU + .5)*NK);
  float ka = (fract((a/TAU + .5)*NK) - .5)*TAU/NK;
  vec3 kp = vec3(r*cos(ka), r*sin(ka), p.z + .15);
  float spoke = sdBox(kp - vec3(.55, 0, 0), vec3(.45, .012, .018));
  d = min(d, spoke);
  float core = length(p - vec3(0, 0, -.12)) - .15;
  float cage = length(p - vec3(0, 0, -.12)) - .185;
  cage = max(cage, -(length(p - vec3(0, 0, -.12)) - .17));
  cage = max(cage, -max(abs(fract(atan(p.y, p.x)*1.9) - .5) - .38, abs(fract(p.z*14.) - .5) - .3));
  if (core < d){ matId = 1.; }
  d = min(d, core);
  if (cage < d){ matId = 0.; }
  d = min(d, cage);
  // spine / stinger
  float spine = sdCapsule2(p, vec3(0, 0, -.2), vec3(0, 0, -2.2), .1, .006);
  vec3 sp = p; sp.xy = abs(sp.xy);
  float fins = sdBox(vec3(sp.x - .1, sp.y, p.z + .9), vec3(.1, .006, .5)) ;
  fins = max(fins, sp.x*.9 + (p.z + .4)*.18 - .1);
  float sf = min(spine, fins);
  if (sf < d){ matId = 0.; }
  d = min(d, sf);
  return d;
}
float starmawEmissive(vec3 p){
  // window lights along the ring
  float r = length(p.xy), a = atan(p.y, p.x);
  float row = step(abs(p.z + .03 - .06*floor(p.z*16.)/16.), 1.);
  vec2 g = vec2(a*220., p.z*80.);
  float h = hash12(floor(g));
  float lit = step(.92, h)*step(abs(r - 1.09), .07);
  return lit*row;
}

// ------------------------------------------------------------------------
// THRONE DESTROYER: a black dagger. length ~2 (z in [-1, 1]).
float sdDestroyer(vec3 p){
  vec3 q = p;
  q.x = abs(q.x);
  // hull: wedge tapering to nose
  float w = mix(.22, .015, smoothstep(-1., 1., q.z));
  float hgt = mix(.07, .01, smoothstep(-1., 1., q.z));
  float hull = max(max(q.x - w, abs(q.y) - hgt + q.x*.25), abs(q.z) - 1.);
  hull *= .8;
  // superstructure / bridge
  float tower = sdBox(q - vec3(0, .08, -.72), vec3(.05, .05, .1));
  tower = min(tower, sdBox(q - vec3(0, .14, -.76), vec3(.09, .012, .035)));
  // side trenches
  hull = max(hull, -sdBox(vec3(q.x - w*.8, q.y, fract(q.z*9.) - .5), vec3(.02, .015, .38)));
  // engine block
  float eng = sdBox(q - vec3(.1, 0, -1.02), vec3(.07, .045, .06));
  float d = min(hull, min(tower, eng));
  // ventral keel
  d = min(d, sdBox(q - vec3(0, -.06, -.2), vec3(.012, .04, .6)));
  return d;
}

// ------------------------------------------------------------------------
// INTERCEPTOR (Asha's craft). length ~1. Forward-swept wings, twin engines.
float sdInterceptor(vec3 p){
  vec3 q = p; q.x = abs(q.x);
  float body = sdEllipsoid(p - vec3(0, 0, .05), vec3(.075, .06, .5));
  float canopy = sdEllipsoid(p - vec3(0, .045, .18), vec3(.045, .04, .14));
  // wings: swept forward, thin
  vec3 wp = q - vec3(.3, -.01, -.12);
  wp.xz = rot(-.35)*wp.xz;
  float wing = sdBox(wp, vec3(.26, .008, .075 - wp.x*.12)) - .004;
  // wing-tip cannons
  float gun = sdCapsule(q, vec3(.54, -.01, -.15), vec3(.56, -.01, .28), .012);
  // engines
  float eng = sdCapsule2(q, vec3(.1, -.005, -.42), vec3(.1, -.005, .02), .05, .035);
  float fin = sdBox(q - vec3(.1, .07, -.33), vec3(.006, .06, .08));
  float d = smin(body, eng, .04);
  d = min(d, canopy);
  d = min(d, wing);
  d = min(d, gun);
  d = min(d, fin);
  return d;
}
// Throne hunter: claw-winged, dark.
float sdHunter(vec3 p){
  vec3 q = p; q.x = abs(q.x);
  float body = sdEllipsoid(p, vec3(.06, .05, .35));
  vec3 wp = q - vec3(.18, 0, .0);
  wp.xy = rot(.6)*wp.xy;
  float wing = sdBox(wp, vec3(.02, .16, .2)) - .004;
  wing = max(wing, -(q.z + .1 - q.y*.8));
  return min(body, wing);
}
