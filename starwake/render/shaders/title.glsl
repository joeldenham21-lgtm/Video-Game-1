// Title card: a single point of light that blooms into a star; the title emerges from it.
// uP0.x: 0 = opening title, 1 = end title
#include "common.glsl"
vec3 skyGen(vec3 rd){ return nebula(rd, vec3(.1, .12, .3), vec3(.3, .1, .3), vec3(.05, .2, .3), .5, 8.); }
vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  vec3 rd = normalize(vec3(uv, 2.2));
  rd.xz = rot(.02*t)*rd.xz;
  vec3 col = starfield(rd, .35)*smoothstep(0., 3., t) + sky(rd)*.5*smoothstep(1., 6., t);
  if (uP0.y > .5) return col*1.3 + sky(rd)*.4;
  // the star: appears, swells, settles behind the title
  float grow = smoothstep(.5, 3.2, t);
  float pulse = exp(-pow((t - 3.2)*1.6, 2.));
  float r = length(uv - vec2(0, .02));
  float core = exp(-r*r/(.00008 + .0006*grow))*(2. + 30.*pulse);
  float halo = exp(-r*(18. - 8.*grow))*(.25 + 2.*pulse)*grow;
  float rays = pow(abs(sin(atan(uv.y, uv.x)*4.)), 60.)*exp(-r*9.)*pulse*1.5;
  float ring = exp(-abs(r - (t - 3.2)*.35)*80.)*step(3.2, t)*exp(-(t - 3.2)*1.2)*.8;
  vec3 sc = mix(vec3(1., .85, .6), vec3(.7, .85, 1.), .4);
  col += sc*(core + halo + rays) + vec3(.6, .8, 1.)*ring;
  // horizontal flare line
  col += vec3(.45, .65, 1.)*exp(-abs(uv.y - .02)*400.)*exp(-abs(uv.x)*2.5)*(1.5*pulse + .15*grow);
  if (uP0.x > .5) col *= .9;
  return col;
}
