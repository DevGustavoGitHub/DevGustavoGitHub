// Gera um HTML único (JS inline) a partir de dist/ — para hospedar em lugares que só aceitam 1 arquivo.
// Uso: npm run build && node scripts/build-single.mjs <saida.html> [--fragment]
//   --fragment: só o conteúdo do <body> (sem doctype/html/head), para plataformas que já embrulham a página.
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const fragment = process.argv.includes('--fragment');
if (!out) { console.error('uso: node scripts/build-single.mjs <saida.html> [--fragment]'); process.exit(1); }
const dist = 'dist';
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const m = html.match(/<script[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/);
if (!m) throw new Error('script do bundle não encontrado em dist/index.html');
const js = fs.readFileSync(path.join(dist, m[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = (html.match(/<style>([\s\S]*?)<\/style>/) ?? [, ''])[1];
const bodyInner = (html.match(/<body>([\s\S]*?)<\/body>/) ?? [, ''])[1].replace(/<script[\s\S]*?<\/script>/g, '');

const css = `${style}\n:root{color-scheme:dark;--bg:#101418}body{background:var(--bg)}`;
const body = `<style>${css}</style>\n${bodyInner}\n<script type="module">${js}</script>`;
const page = fragment
  ? `<title>Mercadinho 3D</title>\n${body}`
  : `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Mercadinho 3D</title></head><body>${body}</body></html>`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`ok: ${out} (${(page.length / 1024).toFixed(0)} KB, ${fragment ? 'fragmento' : 'página completa'})`);
