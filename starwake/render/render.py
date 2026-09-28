"""STARWAKE renderer.

Renders one shot of the timeline through a filmic post pipeline:

  scene (HDR, optional motion-blur subframes)
    -> text/title layer (added in HDR so titles bloom)
    -> bloom mip chain  +  anamorphic streak chain
    -> composite: exposure, ACES tonemap, grade, vignette,
                  chromatic aberration, film grain, dither
    -> rgb24 frames piped into ffmpeg

usage:
  python render/render.py S01                 # full shot -> build/shots/S01.mp4
  python render/render.py S01 --still 2,6.5   # preview PNGs at those times
  python render/render.py S01 --scale 0.5     # quick low-res render
"""
import argparse, os, re, subprocess, sys, time
import numpy as np
import moderngl
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from timeline import SHOTS  # noqa: E402

FPS = 24
OUT_W, OUT_H = 1920, 804  # 2.39:1 scope

VS = """#version 330
in vec2 p; out vec2 vUV;
void main(){ vUV = p*.5+.5; gl_Position = vec4(p,0,1); }"""


def load_glsl(name, seen=None):
    seen = seen or set()
    path = os.path.join(HERE, "shaders", name)
    src = open(path).read()

    def inc(m):
        f = m.group(1)
        if f in seen:
            return ""
        seen.add(f)
        return load_glsl(f, seen)
    return re.sub(r'#include\s+"([^"]+)"', inc, src)


def scene_source(name, cube=False):
    body = load_glsl(name)
    head = "#version 330\n" + ("#define CUBE_PASS\n" if cube else "") + "in vec2 vUV; out vec4 oCol;\n"
    if cube:
        return head + body + """
uniform int uFace;
void main(){
  vec2 st = gl_FragCoord.xy / uR * 2. - 1.;
  float sc = st.x, tc = st.y;
  vec3 d;
  if (uFace == 0) d = vec3(1, -tc, -sc);
  else if (uFace == 1) d = vec3(-1, -tc, sc);
  else if (uFace == 2) d = vec3(sc, 1, tc);
  else if (uFace == 3) d = vec3(sc, -1, -tc);
  else if (uFace == 4) d = vec3(sc, -tc, 1);
  else d = vec3(-sc, -tc, -1);
  oCol = vec4(max(skyGen(normalize(d)), 0.), 1.);
}"""
    return head + body + """
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - .5*uR) / uR.y;
  vec3 c = render(uv, fc);
  oCol = vec4(max(c, 0.), 1.);
}"""


POST = {}
POST["down"] = """#version 330
in vec2 vUV; out vec4 o; uniform sampler2D src; uniform vec2 texel; uniform float thresh;
void main(){
  vec2 t = texel;
  vec3 a = texture(src, vUV + t*vec2(-2, 2)).rgb, b = texture(src, vUV + t*vec2(0, 2)).rgb, c = texture(src, vUV + t*vec2(2, 2)).rgb;
  vec3 d = texture(src, vUV + t*vec2(-2, 0)).rgb, e = texture(src, vUV).rgb, f = texture(src, vUV + t*vec2(2, 0)).rgb;
  vec3 g = texture(src, vUV + t*vec2(-2,-2)).rgb, h = texture(src, vUV + t*vec2(0,-2)).rgb, i = texture(src, vUV + t*vec2(2,-2)).rgb;
  vec3 j = texture(src, vUV + t*vec2(-1, 1)).rgb, k = texture(src, vUV + t*vec2(1, 1)).rgb;
  vec3 l = texture(src, vUV + t*vec2(-1,-1)).rgb, m = texture(src, vUV + t*vec2(1,-1)).rgb;
  vec3 s = e*.125 + (a+c+g+i)*.03125 + (b+d+f+h)*.0625 + (j+k+l+m)*.125;
  if (thresh > 0.) { float br = max(s.r, max(s.g, s.b)); s *= clamp((br - thresh) / max(br, 1e-4), 0., 1.); }
  o = vec4(min(s, vec3(6e4)), 1);
}"""
POST["up"] = """#version 330
in vec2 vUV; out vec4 o; uniform sampler2D src; uniform sampler2D base; uniform vec2 texel; uniform float w;
void main(){
  vec2 t = texel;
  vec3 s = texture(src, vUV + t*vec2(-1, 1)).rgb + 2.*texture(src, vUV + t*vec2(0, 1)).rgb + texture(src, vUV + t*vec2(1, 1)).rgb
         + 2.*texture(src, vUV + t*vec2(-1, 0)).rgb + 4.*texture(src, vUV).rgb + 2.*texture(src, vUV + t*vec2(1, 0)).rgb
         + texture(src, vUV + t*vec2(-1,-1)).rgb + 2.*texture(src, vUV + t*vec2(0,-1)).rgb + texture(src, vUV + t*vec2(1,-1)).rgb;
  o = vec4(texture(base, vUV).rgb + s/16.*w, 1);
}"""
POST["hblur"] = """#version 330
in vec2 vUV; out vec4 o; uniform sampler2D src; uniform vec2 texel; uniform float thresh; uniform float spread;
void main(){
  vec3 s = vec3(0); float ws = 0.;
  for (int i = -7; i <= 7; i++) {
    float w = exp(-float(i*i)/18.);
    vec3 c = texture(src, vUV + vec2(texel.x*float(i)*spread, 0)).rgb;
    if (thresh > 0.) { float br = max(c.r, max(c.g, c.b)); c *= clamp((br - thresh)/max(br,1e-4), 0., 1.); }
    s += c*w; ws += w;
  }
  o = vec4(s/ws, 1);
}"""
POST["acc"] = """#version 330
in vec2 vUV; out vec4 o; uniform sampler2D src; uniform float w;
void main(){ o = vec4(texture(src, vUV).rgb * w, w); }"""
POST["text"] = """#version 330
in vec2 vUV; out vec4 o; uniform sampler2D txt; uniform float gain; uniform float texScale; uniform float scroll;
void main(){
  float y = (1.-vUV.y)*texScale + scroll;
  if (y < 0. || y > 1.) { o = vec4(0); return; }
  vec4 t = texture(txt, vec2(vUV.x, y));
  o = vec4(t.rgb * t.a * gain, 0.);
}"""
POST["comp"] = """#version 330
in vec2 vUV; out vec4 o;
uniform sampler2D scene, bloom, streak;
uniform float exposure, bloomAmt, streakAmt, sat, contrast, vig, ca, grain, fade, frame;
uniform vec3 lift, gammaC, gain, streakTint;
uniform vec2 res;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 uv = vUV, d = uv - .5;
  float r2 = dot(d, d);
  vec3 c;
  vec2 off = d * ca * r2 * .006;
  c.r = texture(scene, uv - off).r;
  c.g = texture(scene, uv).g;
  c.b = texture(scene, uv + off).b;
  c += texture(bloom, uv).rgb * bloomAmt;
  c += texture(streak, uv).rgb * streakAmt * streakTint;
  c *= exposure;
  c *= mix(1., smoothstep(.95, .1, length(d*vec2(1.25, 1.))), vig);
  c = aces(c);
  // grade (lift / gamma / gain) in display space
  c = pow(max(c*gain + lift*(1.-c), 0.), 1./gammaC);
  float L = dot(c, vec3(.2126, .7152, .0722));
  c = mix(vec3(L), c, sat);
  c = clamp((c - .5)*contrast + .5, 0., 1.);
  // film grain, strongest in the mids
  float g = h(uv*res + frame*vec2(17.13, 91.7)) + h(uv*res*.5 + frame*vec2(3.1, 7.7)) - 1.;
  c += g * grain * (1.2 - abs(L - .45)*1.6) * .09;
  c *= fade;
  c += (h(uv*res + frame) - .5) / 255.;
  o = vec4(clamp(c, 0., 1.), 1);
}"""

DEFAULT_GRADE = dict(exposure=1.0, bloom=0.08, streak=0.0, sat=1.0, contrast=1.0,
                     vig=0.55, ca=1.0, grain=0.35, lift=(0, 0, 0), gamma=(1, 1, 1),
                     gain=(1, 1, 1), streak_tint=(0.45, 0.65, 1.0), bloom_thresh=0.0,
                     streak_thresh=1.2)


class Renderer:
    def __init__(self, shot, scale=1.0):
        self.shot = shot
        self.ctx = moderngl.create_standalone_context(backend="egl")
        self.W, self.H = int(OUT_W * scale) // 2 * 2, int(OUT_H * scale) // 2 * 2
        rs = shot.get("rscale", 0.7)
        self.SW, self.SH = int(self.W * rs), int(self.H * rs)
        quad = self.ctx.buffer(np.array([-1, -1, 3, -1, -1, 3], dtype="f4"))
        self.quad = quad
        self.scene_prog = self.ctx.program(vertex_shader=VS, fragment_shader=scene_source(shot["shader"]))
        self.progs = {k: self.ctx.program(vertex_shader=VS, fragment_shader=v) for k, v in POST.items()}
        self.vaos = {k: self.ctx.vertex_array(p, [(quad, "2f", "p")]) for k, p in self.progs.items()}
        self.scene_vao = self.ctx.vertex_array(self.scene_prog, [(quad, "2f", "p")])

        def tex(w, h):
            t = self.ctx.texture((w, h), 4, dtype="f2")
            t.filter = (moderngl.LINEAR, moderngl.LINEAR)
            t.repeat_x = t.repeat_y = False
            return t, self.ctx.framebuffer([t])
        self.tex = tex
        self.sceneT, self.sceneF = tex(self.SW, self.SH)
        self.accT, self.accF = tex(self.SW, self.SH)
        self.fullT, self.fullF = tex(self.W, self.H)
        # bloom chain
        self.mips = []
        w, h = self.W, self.H
        for _ in range(7):
            w, h = max(1, w // 2), max(1, h // 2)
            self.mips.append(tex(w, h))
        self.ups = [tex(t.width, t.height) for t, _ in self.mips]
        # anamorphic streak chain: horizontally squashed
        self.streaks = []
        w, h = self.W // 4, self.H // 8
        for _ in range(4):
            self.streaks.append(tex(w, h))
            w = max(8, w // 2)
        self.streakUps = [tex(t.width, t.height) for t, _ in self.streaks]
        self.outF = self.ctx.simple_framebuffer((self.W, self.H), components=4)
        self.blank = self.ctx.texture((1, 1), 4, dtype="f2", data=np.zeros(4, dtype="f2").tobytes())

        self.text_tex = None
        self.sky = None
        if "vec3 skyGen(" in load_glsl(shot["shader"]):
            self.bake_sky(shot.get("sky_res", 640))
        g = dict(DEFAULT_GRADE)
        g.update(shot.get("grade", {}))
        self.grade = g

    def bake_sky(self, n):
        prog = self.ctx.program(vertex_shader=VS, fragment_shader=scene_source(self.shot["shader"], cube=True))
        vao = self.ctx.vertex_array(prog, [(self.quad, "2f", "p")])
        t, f = self.tex(n, n)
        self.sky = self.ctx.texture_cube((n, n), 4, dtype="f4")
        self.sky.filter = (moderngl.LINEAR, moderngl.LINEAR)
        for k, v in self.shot.get("params", {}).items():
            if k in prog:
                prog[k].value = tuple(v) if isinstance(v, (list, tuple)) else v
        self.set(prog, uR=(float(n), float(n)), uT=0.0, uD=float(self.shot["dur"]),
                 uGlobalT=float(self.shot.get("start", 0)))
        for face in range(6):
            f.use()
            self.set(prog, uFace=face)
            vao.render()
            data = f.read(components=4, dtype="f4")
            self.sky.write(face, data)

    def set(self, prog, **kw):
        for k, v in kw.items():
            if k in prog:
                prog[k].value = v

    def draw_scene(self, t, frame):
        p = self.scene_prog
        if self.sky is not None:
            self.sky.use(5)
            self.set(p, uSky=5)
        params = self.shot.get("params", {})
        self.set(p, uT=t, uD=float(self.shot["dur"]), uR=(float(self.SW), float(self.SH)),
                 uF=frame, uGlobalT=float(self.shot.get("start", 0)) + t)
        for k, v in params.items():
            if k in p:
                p[k].value = tuple(v) if isinstance(v, (list, tuple)) else v
        self.scene_vao.render()

    def frame(self, fi):
        t = fi / FPS
        mb = self.shot.get("mb", 1)
        shutter = self.shot.get("shutter", 0.5)
        ctx = self.ctx
        if mb <= 1:
            self.sceneF.use()
            self.draw_scene(t, fi)
            src = self.sceneT
        else:
            self.accF.use()
            ctx.clear(0, 0, 0, 0)
            for s in range(mb):
                ts = t + (s / mb - 0.5) * shutter / FPS
                self.sceneF.use()
                self.draw_scene(ts, fi)
                self.accF.use()
                ctx.enable(moderngl.BLEND)
                ctx.blend_func = moderngl.ONE, moderngl.ONE
                self.sceneT.use(0)
                self.set(self.progs["acc"], src=0, w=1.0 / mb)
                self.vaos["acc"].render()
                ctx.disable(moderngl.BLEND)
            src = self.accT

        # resample to full res (+ titles in HDR)
        self.fullF.use()
        src.use(0)
        self.set(self.progs["acc"], src=0, w=1.0)
        self.vaos["acc"].render()
        tg = self.text_gain(t)
        if tg > 0 and self.text_tex is not None:
            ctx.enable(moderngl.BLEND)
            ctx.blend_func = moderngl.ONE, moderngl.ONE
            self.text_tex.use(0)
            sc = self.shot["text"].get("scroll")
            off = float(np.interp(t, *zip(*sc))) * self.H / OUT_H if sc else 0.0
            self.set(self.progs["text"], txt=0, gain=tg, texScale=self.H / self.text_h, scroll=off / self.text_h)
            self.vaos["text"].render()
            ctx.disable(moderngl.BLEND)

        g = self.grade
        # bloom: down chain then up chain
        prev = self.fullT
        for i, (mt, mf) in enumerate(self.mips):
            mf.use()
            prev.use(0)
            self.set(self.progs["down"], src=0, texel=(1 / prev.width, 1 / prev.height),
                     thresh=g["bloom_thresh"] if i == 0 else 0.0)
            self.vaos["down"].render()
            prev = mt
        cur = self.mips[-1][0]
        for i in range(len(self.mips) - 2, -1, -1):
            ut, uf = self.ups[i]
            uf.use()
            cur.use(0)
            self.mips[i][0].use(1)
            self.set(self.progs["up"], src=0, base=1, texel=(1 / cur.width, 1 / cur.height), w=1.0)
            self.vaos["up"].render()
            cur = ut
        bloomT = cur

        streakT = self.blank
        if g["streak"] > 0:
            prev = self.fullT
            for i, (st, sfb) in enumerate(self.streaks):
                sfb.use()
                prev.use(0)
                self.set(self.progs["hblur"], src=0, texel=(1 / prev.width, 1 / prev.height),
                         thresh=g["streak_thresh"] if i == 0 else 0.0, spread=1.0 if i == 0 else 1.5)
                self.vaos["hblur"].render()
                prev = st
            cur = self.streaks[-1][0]
            for i in range(len(self.streaks) - 2, -1, -1):
                ut, uf = self.streakUps[i]
                uf.use()
                cur.use(0)
                self.streaks[i][0].use(1)
                self.set(self.progs["up"], src=0, base=1, texel=(1 / cur.width, 1 / cur.height), w=1.0)
                self.vaos["up"].render()
                cur = ut
            streakT = cur

        self.outF.use()
        self.fullT.use(0)
        bloomT.use(1)
        streakT.use(2)
        cp = self.progs["comp"]
        fade = self.fade(t)
        self.set(cp, scene=0, bloom=1, streak=2, exposure=g["exposure"] * self.ramp("exposure_ramp", t),
                 bloomAmt=g["bloom"], streakAmt=g["streak"], sat=g["sat"], contrast=g["contrast"],
                 vig=g["vig"], ca=g["ca"], grain=g["grain"], fade=fade, frame=float(fi % 997),
                 lift=tuple(g["lift"]), gammaC=tuple(g["gamma"]), gain=tuple(g["gain"]),
                 streakTint=tuple(g["streak_tint"]), res=(float(self.W), float(self.H)))
        self.vaos["comp"].render()
        return self.outF.read(components=3)

    def ramp(self, key, t):
        pts = self.shot.get(key)
        if not pts:
            return 1.0
        xs, ys = zip(*pts)
        return float(np.interp(t, xs, ys))

    def fade(self, t):
        d = self.shot["dur"]
        fi, fo = self.shot.get("fade_in", 0), self.shot.get("fade_out", 0)
        f = 1.0
        if fi > 0:
            f *= np.clip(t / fi, 0, 1) ** 1.5
        if fo > 0:
            f *= np.clip((d - t) / fo, 0, 1) ** 1.5
        return float(f)

    def text_gain(self, t):
        tx = self.shot.get("text")
        if not tx:
            return 0.0
        if self.text_tex is None:
            img = tx["make"](self.W, self.H)
            self.text_h = img.size[1]
            self.text_tex = self.ctx.texture(img.size, 4, data=img.tobytes())
            self.text_tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        xs, ys = zip(*tx["gain"])
        return float(np.interp(t, xs, ys))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shot")
    ap.add_argument("--still", default=None)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    shot = dict(SHOTS[a.shot])
    shot["id"] = a.shot
    r = Renderer(shot, a.scale)
    if a.still:
        os.makedirs(os.path.join(ROOT, "build", "stills"), exist_ok=True)
        for ts in a.still.split(","):
            t0 = time.time()
            fi = int(round(float(ts) * FPS))
            data = r.frame(fi)
            img = Image.frombytes("RGB", (r.W, r.H), data).transpose(Image.FLIP_TOP_BOTTOM)
            p = os.path.join(ROOT, "build", "stills", f"{a.shot}_{ts}.png")
            img.save(p)
            print(f"{p}  {time.time() - t0:.2f}s")
        return
    os.makedirs(os.path.join(ROOT, "build", "shots"), exist_ok=True)
    out = a.out or os.path.join(ROOT, "build", "shots", f"{a.shot}.mp4")
    n = int(round(shot["dur"] * FPS))
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                           "-s", f"{r.W}x{r.H}", "-r", str(FPS), "-i", "-", "-vf", "vflip",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p",
                           "-tune", "grain", out], stdin=subprocess.PIPE)
    t0 = time.time()
    for fi in range(n):
        ff.stdin.write(r.frame(fi))
        if fi % 48 == 0:
            el = time.time() - t0
            print(f"{a.shot} {fi}/{n}  {el / (fi + 1):.2f}s/f", flush=True)
    ff.stdin.close()
    ff.wait()
    print(f"{a.shot} done {n} frames in {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
