// The jump: a tunnel of stretched starlight.
#include "common.glsl"
vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  vec2 p = uv + (vec2(vnoise2(vec2(t*20., 1.)), vnoise2(vec2(1., t*20.))) - .5)*.01;
  float r = length(p), a = atan(p.y, p.x);
  float z = .12/max(r, .001);
  vec3 col = vec3(0);
  for (int k = 0; k < 3; k++){
    float fk = float(k);
    float N = 90. + fk*70.;
    float cell = floor((a/TAU + .5)*N);
    float h = hash11(cell + fk*31.);
    float fa = fract((a/TAU + .5)*N) - .5;
    float speed = 3. + 3.*h;
    float seg = fract(z*.6 + h*7. - t*speed);
    float len = .25 + .5*h;
    float streak = smoothstep(0., .05, seg)*smoothstep(len, len*.6, seg)*step(.5, h);
    float thin = exp(-fa*fa*800.*r);
    vec3 c = mix(vec3(.45, .6, 1.), vec3(.9, .7, 1.), hash11(cell*3.1));
    col += c*streak*thin*(.6 + 1.5*r)*1.4;
  }
  // tunnel walls of energy
  float swirl = fbm(vec3(a*3. + z*.5, z*2. - t*6., t), 4);
  col += vec3(.15, .25, .7)*smoothstep(.45, .8, swirl)*exp(-r*1.5)*.6*r*2.;
  // bright vanishing point
  col += vec3(.7, .85, 1.)*(exp(-r*r*60.)*2. + exp(-r*6.)*.4);
  // entry and exit flashes
  col += vec3(.8, .9, 1.)*(exp(-t*5.)*3. + exp(-(uD - t)*6.)*4.);
  return col;
}
