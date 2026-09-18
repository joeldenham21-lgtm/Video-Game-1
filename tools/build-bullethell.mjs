// Bundles bullethell/src/*.js + bullethell/dev.html into ONE self-contained
// bullethell/index.html (works from file:// too). Usage: node tools/build-bullethell.mjs
import { readFileSync, writeFileSync } from 'fs';
const ROOT = new URL('../bullethell/', import.meta.url).pathname;
const ORDER = ['math', 'input', 'audio', 'fx', 'bullets', 'patterns', 'items', 'player', 'enemies', 'bosses', 'levels', 'backgrounds', 'hud', 'save', 'ui', 'main'];
let out = '// HOLLOW CHOIR — single-file build. Source of truth: bullethell/src/*.js (bundled by tools/build-bullethell.mjs)\n"use strict";\nconst __m = {};\n';
for (const name of ORDER) {
  let src = readFileSync(ROOT + 'src/' + name + '.js', 'utf8');
  const exports = [];
  // imports -> destructuring from the module table
  src = src.replace(/^import \* as (\w+) from '\.\/(\w+)\.js';\s*$/gm, (_, ns, mod) => `const ${ns} = __m.${mod};`);
  src = src.replace(/^import \{([^}]+)\} from '\.\/(\w+)\.js';\s*$/gm, (_, names, mod) => `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = __m.${mod};`);
  if (/^import /m.test(src)) throw new Error('unhandled import in ' + name);
  // exports -> plain declarations, remembered for the export object
  src = src.replace(/^export (const|let|function|class) (\w+)/gm, (_, kind, id) => { exports.push(id); return `${kind} ${id}`; });
  if (/^export /m.test(src)) throw new Error('unhandled export in ' + name);
  out += `\n// ===================== ${name}.js =====================\n__m.${name} = (() => {\n${src}\nreturn { ${exports.join(', ')} };\n})();\n`;
}
const html = readFileSync(ROOT + 'dev.html', 'utf8');
if (!html.includes('<!--BUNDLE-->')) throw new Error('dev.html has no <!--BUNDLE--> marker');
const built = html.replace(/<!--BUNDLE-->\s*<script type="module" src="\.\/src\/main\.js"><\/script>/, () => `<script type="module">\n${out.replace(/<\/script/g, '<\\/script')}\n</script>`);
writeFileSync(ROOT + 'index.html', built);
console.log(`built bullethell/index.html: ${(built.length / 1024).toFixed(0)} KB, ${ORDER.length} modules inlined`);
