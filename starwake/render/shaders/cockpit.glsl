// Inside Asha's cockpit over dead Kessar: frost creeps across the canopy as the Admiral calls.
#include "common.glsl"
vec3 skyGen(vec3 rd){ return nebula(rd, vec3(.05, .08, .16), vec3(.08, .04, .12), vec3(.1, .03, .02), .55, 21.); }

vec3 outside(vec3 rd){
  vec3 col = starfield(rd, .8) + sky(rd);
  // dead star: black disc, faint ember rim
  vec3 sd = normalize(vec3(-.35, .28, 1.));
  float a = acos(clamp(dot(rd, sd), -1., 1.));
  float R = .07;
  if (a < R) col = vec3(0);
  float ang = atan(dot(rd, vec3(0, 1, 0)), dot(rd, vec3(1, 0, 0)));
  col += vec3(1., .2, .04)*exp(-abs(a - R)*300.)*.25*(.4 + fbm(vec3(ang*6., uGlobalT*.2, 0), 3));
  // frozen Kessar below
  vec3 pc = vec3(0, -6.55, 5.);
  vec2 h = sphIntersect(vec3(0), rd, pc, 6.4);
  if (h.x > 0.){
    vec3 n = normalize(rd*h.x - pc);
    vec3 q = n; q.xz = rot(uGlobalT*.004)*q.xz;
    float cr = voronoi(q*16.).y;
    vec3 ice = mix(vec3(.45, .55, .72), vec3(.85, .92, 1.), fbm(q*6., 5));
    ice *= .75 + .25*smoothstep(0., .08, cr);
    vec3 L = normalize(vec3(.6, .5, -.2));
    col = ice*(max(dot(n, L), 0.)*vec3(.28, .34, .55)*.9 + .015);
  }
  col += atmosphere(vec3(0), rd, pc, 6.4, .2, normalize(vec3(.6, .5, -.2)), vec3(.4, .6, 1.)*.12, h.x > 0. ? h.x : 1e9, .7)*vec3(.3, .35, .6)*.5;
  return col;
}

vec3 render(vec2 uv, vec2 fc){
  float t = uT;
  vec2 p = uv + vec2(.01*sin(t*.4), .006*sin(t*.53));   // gentle drift of the craft
  // frost growth from the canopy edges and struts
  float edge = min(1.1 - abs(p.x)*1., .62 - p.y*1.);
  float strutL = abs(p.x + .55 + p.y*.45);
  float strutR = abs(p.x - .55 - p.y*.45);
  float dStr = min(min(strutL, strutR), edge);
  float grow = .015 + .15*ease(remap(t, 1., 12.));
  float dend = fbm(vec3(p*7., 1.), 5);
  // feathery fern structure: ridged noise stretched along two crystal axes
  vec2 pa = rot(.6)*p, pb = rot(-.9)*p;
  float fern = max(ridged(vec3(pa*vec2(60., 14.), 1.), 4), ridged(vec3(pb*vec2(55., 12.), 4.), 4));
  float fine = ridged(vec3(p*90., 2.), 3);
  float frost = smoothstep(grow, grow - .06, dStr - dend*.1)*(.25 + .75*smoothstep(.55, .95, fern)*(.6 + .4*fine));
  // refraction through frost
  vec2 pr = p + (vec2(fbm(vec3(p*20., 3.), 3), fbm(vec3(p*20., 7.), 3)) - .5)*.05*frost;
  vec3 rd = normalize(vec3(pr, 1.6));
  rd.yz = rot(-.1)*rd.yz;
  rd.xz = rot(.12 + .02*t)*rd.xz;
  vec3 col = outside(rd);
  vec3 frostCol = vec3(.55, .68, .85)*.18 + vec3(.3, .7, 1.)*.05;
  col = mix(col, col*.5 + frostCol*(1.2 + .8*dend), frost*.85);
  // glass reflections of instrument lights
  col += vec3(.1, .4, .6)*.035*smoothstep(.3, -.4, p.y)*(.5 + .5*fbm(vec3(p*3., t*.1), 3));
  // HUD
  vec3 hud = vec3(.35, .85, 1.);
  float r = length(p - vec2(0., .02));
  float ret = exp(-abs(r - .09)*900.)*step(.3, abs(fract(atan(p.y - .02, p.x)/TAU*8.) - .5));
  ret += exp(-abs(p.y - .02)*1500.)*step(.13, abs(p.x))*step(abs(p.x), .32);
  float ticks = exp(-abs(p.y - .3)*900.)*step(abs(p.x), .25) + exp(-abs(fract(p.x*40. + t*.4) - .5)*60.)*step(abs(p.y - .315), .012)*step(abs(p.x), .25);
  // comms waveform when a voice is on the line
  float talk = step(.8, t)*step(t, 2.3) + step(4.2, t)*step(t, 12.2);
  float wave = 0.;
  if (p.x > .52 && p.x < .82 && abs(p.y + .2) < .06){
    float b = floor((p.x - .52)*90.);
    float hgt = (.1 + .9*vnoise2(vec2(b*.7, t*9.)))*.05*talk + .003;
    wave = step(abs(p.y + .2), hgt)*step(.3, fract((p.x - .52)*90.));
  }
  float box = exp(-abs(max(abs(p.x - .67) - .17, abs(p.y + .2) - .09))*900.);
  col += hud*(ret*.5 + ticks*.35 + wave*.8 + box*.4)*(.8 + .2*sin(t*30.))*(1. - frost*.6);
  // canopy struts and dashboard silhouette
  float s = min(min(strutL, strutR) - .025, edge - .005);
  float dash = p.y + .38 - .06*cos(p.x*2.);
  float dark = max(smoothstep(.004, -.004, s), smoothstep(.004, -.004, dash));
  vec3 dashCol = vec3(.004, .005, .007);
  // small glowing instruments on the dash
  if (dash < 0.){
    vec2 q = vec2(p.x*9., (p.y + .45)*9.);
    vec2 c = floor(q);
    float h = hash12(c);
    float lit = step(.75, h)*step(abs(fract(q.x) - .5), .35)*step(abs(fract(q.y) - .5), .2);
    dashCol += mix(vec3(1., .35, .15), vec3(.3, .8, 1.), step(.87, h))*lit*.25*(.7 + .3*sin(t*3. + h*20.));
  }
  col = mix(col, dashCol + vec3(.05, .06, .09)*exp(-abs(s)*80.)*.2, dark);
  return col;
}
