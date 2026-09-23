// RINGFALL build: bundles src/ (and three.js) into a single self-contained HTML file.
//   node build.mjs            → index.html (standalone page) + dist/artifact.html (fragment for hosted viewers)
//   node build.mjs --dev      → unminified with inline sourcemaps
//   node build.mjs --serve    → also serve this folder on http://localhost:8080
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import http from 'http';
import { extname, join } from 'path';

const ROOT = new URL('.', import.meta.url).pathname;
const DEV = process.argv.includes('--dev');
const SERVE = process.argv.includes('--serve');

const t0 = Date.now();
const result = await build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: !DEV,
  sourcemap: DEV ? 'inline' : false,
  write: false,
  legalComments: 'none',
  define: { __DEV__: DEV ? 'true' : 'false' },
  logLevel: 'warning',
  plugins: [{
    // fall back to a silent audio stub if the synth module is missing
    name: 'audio-fallback',
    setup(b) {
      b.onResolve({ filter: /^\.\/audio\.js$/ }, (args) => {
        const real = join(args.resolveDir, 'audio.js');
        return { path: existsSync(real) ? real : join(ROOT, 'src/engine/audio-null.js') };
      });
    },
  }],
});
let js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const shell = await readFile(join(ROOT, 'src/shell.html'), 'utf8');
const three = '/*! three.js r160 | MIT License | https://github.com/mrdoob/three.js */\n';
const scriptTag = `<script type="module">\n${three}${js}</script>`;
const page = shell.replace('<!--GAME_SCRIPT-->', () => scriptTag);
await writeFile(join(ROOT, 'index.html'), page);

// Fragment build: same page without the document skeleton (the host wraps it in its own <html>/<head>/<body>).
const head = page.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = page.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
const headKeep = [...head.matchAll(/<title>[\s\S]*?<\/title>|<link[^>]*>|<style>[\s\S]*?<\/style>/gi)].map(m => m[0]).join('\n');
await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(join(ROOT, 'dist/artifact.html'), `${headKeep}\n${body}`);

const kb = (Buffer.byteLength(page) / 1024).toFixed(0);
console.log(`built index.html (${kb} KB) + dist/artifact.html in ${Date.now() - t0}ms${DEV ? ' [dev]' : ''}`);

if (SERVE) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
  http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const data = await readFile(join(ROOT, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
  }).listen(8080, () => console.log('serving on http://localhost:8080'));
}
