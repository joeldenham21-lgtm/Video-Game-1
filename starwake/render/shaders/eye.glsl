// Extreme close-up: Ilune's eye. A star-shaped pupil and an iris like a small galaxy.
#include "common.glsl"
vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  vec2 p = uv*.78 + vec2(.015*sin(t*.3), .008*sin(t*.4));
  // lids: almond shape that opens from a slow blink
  float open = ease(remap(t, .2, 1.6));
  float lidTop = .3*open*(1. - pow(abs(p.x)/1.05, 2.)) + .02;
  float lidBot = -.26*open*(1. - pow(abs(p.x)/1.05, 2.)) - .02;
  float inEye = smoothstep(.006, -.006, p.y - lidTop)*smoothstep(-.006, .006, p.y - lidBot);
  // skin: deep blue-violet with luminous freckles
  vec3 skin = mix(vec3(.02, .025, .06), vec3(.05, .05, .1), fbm(vec3(p*8., 1.), 4));
  vec2 c = floor(p*38.);
  vec2 f = fract(p*38.) - .5;
  float dots = exp(-dot(f, f)*60.)*step(.8, hash12(c))*smoothstep(.12, .3, abs(p.y - (lidTop + lidBot)*.5));
  skin += vec3(.2, 1., .9)*dots*.45*(.6 + .4*sin(t*2. + hash12(c)*20.));
  // lid folds: shade the skin as a surface bulging around the eye
  float dTop = p.y - lidTop, dBot = lidBot - p.y;
  float fold = exp(-max(dTop, 0.)*14.)*step(0., dTop) + exp(-max(dBot, 0.)*18.)*step(0., dBot);
  float crease = exp(-abs(dTop - .09)*60.)*step(0., dTop);
  skin *= .6 + .9*fold;
  skin -= vec3(.02)*crease;
  skin += vec3(.05, .25, .3)*fold*smoothstep(.2, -.3, p.y)*.4;   // glow from the sea below
  // eyeball
  vec2 ic = vec2(.02, 0.);
  float r = length(p - ic);
  float ang = atan(p.y - ic.y, p.x - ic.x);
  vec3 eye = vec3(.03, .04, .05)*(1. - r*.5);
  float irisR = .26;
  if (r < irisR){
    float fib = fbm(vec3(ang*14., r*6., 1.), 4);
    float fib2 = fbm(vec3(ang*40., r*20., 5.), 3);
    vec3 ic1 = vec3(.05, .7, .75), ic2 = vec3(.45, .25, 1.), ic3 = vec3(1., .75, .35);
    vec3 ir = mix(ic1, ic2, smoothstep(.08, .22, r + (fib - .5)*.08));
    ir *= .45 + .9*fib*fib2;
    float spiral = pow(.5 + .5*cos(ang*2. - log(r + .01)*6. + t*.6), 6.);
    ir += ic3*spiral*smoothstep(.16, .06, r)*.8;
    ir += ic3*exp(-abs(r - .075)*90.)*.9;
    ir *= smoothstep(irisR, irisR - .02, r);
    ir += vec3(.02, .3, .35)*exp(-abs(r - irisR)*120.);
    // star pupil, breathing
    float dil = .045 + .01*sin(t*.9);
    float star = dil*(.55 + .45*pow(abs(cos(ang*2.)), 6.));
    ir *= smoothstep(star, star + .006, r);
    eye = ir*1.1;
  }
  // reflections: the glowing sea and a small figure (Asha)
  vec2 rp = p - vec2(-.08, .09);
  float refl = exp(-pow(abs(rp.x)*1.2, 2.)*1200. - pow(abs(rp.y), 2.)*2600.)*.9;
  // curved window of the sky across the cornea
  refl += exp(-abs(length(p - ic + vec2(.05, -.05)) - .2)*140.)*step(0., p.y - .02)*step(p.x, .1)*.12;
  float fig = step(abs(p.x + .075), .006)*step(abs(p.y - .065), .02);
  eye += vec3(.7, .9, 1.)*refl - vec3(.6)*fig*refl*2.;
  eye += vec3(.2, .8, .8)*.15*smoothstep(-.1, -.25, p.y)*inEye;
  vec3 col = mix(skin*.8, eye, inEye);
  // wet rim along the lids
  col += vec3(.4, .7, .8)*exp(-abs(p.y - lidTop)*260.)*.08*open + vec3(.4, .7, .8)*exp(-abs(p.y - lidBot)*300.)*.1*open;
  // soft shadow of the upper lid across the eye
  col *= mix(1., .45, inEye*exp(-max(lidTop - p.y, 0.)*25.));
  return col;
}
