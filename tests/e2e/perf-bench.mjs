// Banco de medidas de desempenho (SwiftShader, sem GPU real): imprime métricas que servem de PROXY do custo no celular.
// Não é um teste de aprovação: só falha em regressões óbvias (erro de console, programas de shader crescendo depois do
// aquecimento, textura de canvas reenviada todo quadro). Docs: docs/PERF.md.
//
// Uso: npx vite build && (npx vite preview --port 5230 --strictPort &) && BENCH_URL=http://localhost:5230/ node tests/e2e/perf-bench.mjs
//   sem BENCH_URL sobe o próprio `vite preview` (BENCH_PORT, padrão 5230; BENCH_DIST = pasta do build, padrão dist/).
// Variáveis: BENCH_QUALITY=high|medium|low|auto (padrão high) · BENCH_DPR=2.625 · BENCH_W=915 · BENCH_H=412 (celular deitado)
//   BENCH_THROTTLE=4 (CPU ×4 via CDP) · BENCH_SECS=60 (janela do dia acelerado) · BENCH_SAVE=arquivo.json (save da loja
//   movimentada; padrão: gera com o fixture de tests/qa-sys-sim.test.ts) · BENCH_OUT=métricas.json · BENCH_SHOTS=pasta (prints)
//   BENCH_UNCAPPED=1 (Chromium sem vsync/limite de quadros: imita tela de alta taxa; mostra o limitador de FPS)
//   BENCH_JS_PR=0.4 (pixel ratio forçado nas janelas de tempo de JS: o SwiftShader rasteriza na CPU e, na resolução cheia,
//   faria ~1 quadro/s; 0 = não força) · BENCH_JS_SHADOW=256 (idem: mapa de sombra menor; o passe de sombra continua
//   sendo submetido como no jogo) · BENCH_PHASES=static,win,alloc,day (quais etapas rodar)
//   BENCH_PROFILE=1 (perfil de CPU na janela com CPU ×N: funções com mais tempo próprio; use um build sem minificar).
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const env = process.env;
const PORT = env.BENCH_PORT ?? '5230';
const URL = env.BENCH_URL ?? `http://localhost:${PORT}/`;
const QUALITY = env.BENCH_QUALITY ?? 'high';
const DPR = Number(env.BENCH_DPR ?? 2.625);
const VW = Number(env.BENCH_W ?? 915), VH = Number(env.BENCH_H ?? 412);
const THROTTLE = Number(env.BENCH_THROTTLE ?? 4);
const SECS = Number(env.BENCH_SECS ?? 60);
const SHOTS = env.BENCH_SHOTS ?? '';
const UNCAPPED = env.BENCH_UNCAPPED === '1';
const JS_PR = Number(env.BENCH_JS_PR ?? 0.15);
const JS_SHADOW = Number(env.BENCH_JS_SHADOW ?? 256);
const PHASES = new Set((env.BENCH_PHASES ?? 'static,win,alloc,day').split(','));

let server = null;
if (!env.BENCH_URL) {
  server = spawn('npx', ['vite', 'preview', '--outDir', env.BENCH_DIST ?? 'dist', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL)).ok) break; } catch { /* aguardando */ } await new Promise((r) => setTimeout(r, 500)); }
}
let saveJson = env.BENCH_SAVE ? readFileSync(env.BENCH_SAVE, 'utf8') : null;
if (!saveJson) {
  const f = join(mkdtempSync(join(tmpdir(), 'bench-')), 'busy.json');
  const r = spawnSync('npx', ['vitest', 'run', 'tests/qa-sys-sim.test.ts', '-t', 'fixture'], { env: { ...env, QA_FIXTURE: f }, encoding: 'utf8' });
  if (!existsSync(f)) { console.error('não consegui gerar o save da loja movimentada', r.stdout?.slice(-800), r.stderr?.slice(-800)); process.exit(2); }
  saveJson = readFileSync(f, 'utf8');
}

const args = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--enable-precise-memory-info'];
if (UNCAPPED) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404|MIME type|GPU stall|swiftshader/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

/* ---------- instrumentação (antes do jogo iniciar) ---------- */
await page.addInitScript(([save, q]) => {
  try {
    localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: q, volume: 0, haptics: false }));
    localStorage.setItem('mercadinho:tutorial', 'done');
    if (save && !sessionStorage.getItem('bench:seeded')) { localStorage.setItem('mercadinho-sim:save:v1', save); sessionStorage.setItem('bench:seeded', '1'); }
  } catch { /* */ }
  const B = (window.__bench = {
    on: false, samples: [], cbRender: 0, cbRendered: 0,
    tex: { canvas: 0, canvasBytes: 0, data: 0, dataBytes: 0, mip: 0, sizes: {} }, buf: { calls: 0, bytes: 0 },
    links: [], progWaitMs: 0, mut: 0, simSec: 0, lastT: 0,
  });
  const raf = window.requestAnimationFrame.bind(window);
  const patchRenderer = () => {
    const r = window.__game?.renderer;
    if (!r || r.__benchPatched) return;
    const orig = r.render.bind(r);
    r.render = (s, c) => { const t0 = performance.now(); orig(s, c); B.cbRender += performance.now() - t0; B.cbRendered++; };
    r.__benchPatched = true;
  };
  window.requestAnimationFrame = (cb) => raf((t) => {
    patchRenderer();
    B.cbRender = 0; B.cbRendered = 0;
    const t0 = performance.now();
    cb(t);
    const ms = performance.now() - t0;
    if (B.cbRendered > 0) { if (B.on && B.lastT) B.simSec += Math.min(0.1, (t - B.lastT) / 1000); B.lastT = t; }
    if (B.on) B.samples.push([t, ms, B.cbRender, B.cbRendered]);
  });
  const sizeOf = (a) => { for (const x of a) if (x && typeof x === 'object' && 'width' in x && 'height' in x && !ArrayBuffer.isView(x)) return [x.width * x.height * 4, `${x.width}x${x.height}`]; const v = a.find((x) => ArrayBuffer.isView(x)); return [v ? v.byteLength : 0, null]; };
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    for (const name of ['texImage2D', 'texSubImage2D']) {
      const o = P[name];
      P[name] = function (...a) {
        if (B.on) { const [bytes, canvas] = sizeOf(a); if (canvas) { B.tex.canvas++; B.tex.canvasBytes += bytes; B.tex.sizes[canvas] = (B.tex.sizes[canvas] ?? 0) + 1; } else { B.tex.data++; B.tex.dataBytes += bytes; } }
        return o.apply(this, a);
      };
    }
    const gm = P.generateMipmap; P.generateMipmap = function (...a) { if (B.on) B.tex.mip++; return gm.apply(this, a); };
    for (const name of ['bufferData', 'bufferSubData']) {
      const o = P[name];
      P[name] = function (...a) { if (B.on) { B.buf.calls++; const v = a.find((x) => ArrayBuffer.isView(x)); B.buf.bytes += v ? v.byteLength : 0; } return o.apply(this, a); };
    }
    const lp = P.linkProgram; P.linkProgram = function (...a) { B.links.push(performance.now()); return lp.apply(this, a); };
    const gp = P.getProgramParameter; P.getProgramParameter = function (...a) { const t0 = performance.now(); const r = gp.apply(this, a); B.progWaitMs += performance.now() - t0; return r; };
  }
  new MutationObserver((l) => { if (B.on) B.mut += l.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}, [saveJson, QUALITY]);

const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const throttle = (rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate });
const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, x); if (!ok) fails.push(n); };
const out = { quality: QUALITY, dpr: DPR, viewport: [VW, VH], throttle: THROTTLE, uncapped: UNCAPPED };

const t00 = Date.now();
await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__world && window.__npc && window.__player && window.__ui, null, { timeout: 90000 });
const bootMs = Date.now() - t00;
await page.waitForTimeout(600);
await page.evaluate(() => { const b = [...document.querySelectorAll('.title-screen .btn')].find((x) => /Jogar|Continuar/.test(x.textContent)); b?.click(); });
await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
// shaders compilados até aqui = carregamento (tela inicial); depois disto, cada link é uma travada potencial no jogo
const boot = await page.evaluate(() => ({ links: window.__bench.links.length, waitMs: +window.__bench.progWaitMs.toFixed(1), warm: window.__world.warm?.() ?? null }));

/* ---------- configuração de render e cena ---------- */
const cfg = await page.evaluate(() => {
  const g = window.__game, r = g.renderer, gl = r.getContext();
  const db = r.getDrawingBufferSize(new (g.camera.position.constructor)());
  const lights = {}; let casters = 0, receivers = 0, transparent = 0, renderables = 0, skinned = 0, instanced = 0;
  const mats = {}; const castersByName = {};
  g.scene.traverseVisible((o) => {
    if (o.isLight) lights[o.type] = (lights[o.type] ?? 0) + 1;
    if (!(o.isMesh || o.isSprite || o.isLine || o.isPoints)) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.every((m) => m && m.visible === false)) return; // proxies de pick
    renderables++;
    if (o.isSkinnedMesh) skinned++;
    if (o.isInstancedMesh) instanced++;
    if (o.castShadow) { casters++; const k = o.parent?.name || o.name || o.type; castersByName[k] = (castersByName[k] ?? 0) + 1; }
    if (o.receiveShadow) receivers++;
    for (const m of ms) { if (!m) continue; mats[m.type] = (mats[m.type] ?? 0) + 1; if (m.transparent) transparent++; }
  });
  const sun = g.scene.getObjectByProperty('isDirectionalLight', true);
  const q = window.__world.quality?.() ?? {};
  return {
    quality: q, canvas: [db.x, db.y], pixels: db.x * db.y, pixelRatio: r.getPixelRatio(), dpr: devicePixelRatio,
    msaa: gl.getParameter(gl.SAMPLES), antialias: !!gl.getContextAttributes()?.antialias,
    toneMapping: r.toneMapping, shadowEnabled: r.shadowMap.enabled, shadowAuto: r.shadowMap.autoUpdate, shadowType: r.shadowMap.type,
    shadowMap: sun?.castShadow ? sun.shadow.mapSize.x : 0, fog: !!g.scene.fog,
    lights, renderables, skinned, instanced, casters, receivers, transparent, mats, castersByName,
    programs: r.info.programs?.length ?? 0, textures: r.info.memory.textures, geometries: r.info.memory.geometries,
    backdrop: [...document.querySelectorAll('#ui-root *')].filter((e) => { const s = getComputedStyle(e); return (s.backdropFilter && s.backdropFilter !== 'none') && e.getClientRects().length > 0; }).map((e) => e.className.toString().slice(0, 24)),
  };
});
out.boot = { ms: bootMs, ...boot };
console.log(`carregamento: ${bootMs} ms até o jogo existir; shaders linkados no carregamento=${boot.links} (espera ${boot.waitMs} ms)${boot.warm ? ` aquecimento=${JSON.stringify(boot.warm)}` : ''}`);
out.cfg = cfg;
console.log(`qualidade=${QUALITY} tier=${cfg.quality.tier ?? '?'} canvas=${cfg.canvas.join('x')} (${(cfg.pixels / 1e6).toFixed(2)} Mpx, pixelRatio ${cfg.pixelRatio}, DPR ${cfg.dpr}) MSAA=${cfg.msaa} sombra=${cfg.shadowMap}${cfg.shadowAuto ? ' (todo quadro)' : ' (estática)'} luzes=${JSON.stringify(cfg.lights)}`);
console.log(`cena: renderáveis=${cfg.renderables} skinned=${cfg.skinned} instanced=${cfg.instanced} casters=${cfg.casters} receivers=${cfg.receivers} transparentes=${cfg.transparent} materiais=${JSON.stringify(cfg.mats)}`);
console.log(`casters por grupo: ${JSON.stringify(cfg.castersByName)}  backdrop-filter visíveis: ${cfg.backdrop.length} ${JSON.stringify(cfg.backdrop)}`);

/* ---------- vistas fixas: draw calls e triângulos (passe principal + sombra) ---------- */
const VIEWS = (W, D) => ({
  'dentro-fundo': [W / 2 + 0.5, 1.6, D - 1.5, W / 2 + 0.5, 1.2, 0],
  'dentro-balcao': [3, 1.6, D - 2, W - 4, 1.0, D - 4],
  'dentro-lateral': [1.5, 1.6, 6, W - 1, 1.2, 4],
  'deposito': [W / 2, 1.6, 0.6, W / 2, 1.0, -4],
  'rua-fachada': [W / 2, 1.6, D + 7.5, W / 2, 2.0, D],
});
const dims = await page.evaluate(() => window.__world.bounds());
const views = VIEWS(dims.width, dims.depth);
out.views = {};
if (PHASES.has('static')) {
  for (const [name, v] of Object.entries(views)) {
    const s = await page.evaluate(async (v) => {
      const g = window.__game, r = g.renderer, w = window.__world;
      w.lockCamera(...v);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const sm = r.shadowMap, auto = sm.autoUpdate;
      sm.autoUpdate = true; sm.needsUpdate = true;
      r.render(g.scene, g.camera); const all = { calls: r.info.render.calls, tris: r.info.render.triangles };
      sm.autoUpdate = false; sm.needsUpdate = false;
      r.render(g.scene, g.camera); const main = { calls: r.info.render.calls, tris: r.info.render.triangles };
      sm.autoUpdate = auto; sm.needsUpdate = true;
      return { calls: main.calls, tris: main.tris, shadowCalls: all.calls - main.calls, shadowTris: all.tris - main.tris };
    }, v);
    out.views[name] = s;
    console.log(`vista ${name}: calls=${s.calls} tris=${s.tris} | passe de sombra (quando atualiza): calls=${s.shadowCalls} tris=${s.shadowTris}`);
    if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${QUALITY}-${name}.png` }); }
  }
  await page.evaluate(() => window.__world.unlockCamera());
}

/* ---------- janelas de medida (loja aberta, clientes) ---------- */
if (JS_PR > 0) {
  // o SwiftShader rasteriza na CPU: na resolução cheia mediria o rasterizador, não o JS do jogo
  out.jsPixelRatio = await page.evaluate(([pr, sh]) => {
    window.__world.autoQuality?.(false);
    const g = window.__game, r = g.renderer;
    r.setPixelRatio(pr); r.setSize(innerWidth, innerHeight, false);
    const sun = g.scene.getObjectByProperty('isDirectionalLight', true);
    if (sh > 0 && sun?.castShadow && sun.shadow.mapSize.x > sh) { sun.shadow.mapSize.set(sh, sh); sun.shadow.map?.dispose(); sun.shadow.map = null; r.shadowMap.needsUpdate = true; }
    return r.getPixelRatio();
  }, [JS_PR, JS_SHADOW]);
  console.log(`janelas de JS: pixel ratio forçado ${out.jsPixelRatio} e mapa de sombra <= ${JS_SHADOW} (só para o rasterizador do SwiftShader não dominar o tempo)`);
}
await page.evaluate(() => {
  const s = window.__game.state;
  { const b = window.__world.bounds(); window.__player.teleport(b.width / 2 - 1.5, b.depth - 2.2, 0, 0); } // meio da loja (salão inicial 10×8)
  window.__player.lookAt(10, 1.1, 3);
  window.__game.clock.openStore();
  window.__npc.timeScale = 1;
  window.__npc.spawnNow(12);
});
await page.waitForTimeout(9000);

const win = async (ms, label) => {
  const m0 = await metrics();
  await page.evaluate(() => { const B = window.__bench; B.samples = []; B.tex = { canvas: 0, canvasBytes: 0, data: 0, dataBytes: 0, mip: 0, sizes: {} }; B.buf = { calls: 0, bytes: 0 }; B.mut = 0; B.simSec = 0; B.on = true; });
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  const res = await page.evaluate(() => {
    const B = window.__bench; B.on = false;
    const S = B.samples, rendered = S.filter((s) => s[3] > 0);
    const q = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
    const cb = rendered.map((s) => s[1]), rn = rendered.map((s) => s[2]), up = rendered.map((s) => s[1] - s[2]);
    const skipped = S.filter((s) => s[3] === 0).map((s) => s[1]);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const span = S.length > 1 ? (S[S.length - 1][0] - S[0][0]) / 1000 : 1;
    const gaps = []; for (let i = 1; i < rendered.length; i++) gaps.push(rendered[i][0] - rendered[i - 1][0]);
    const people = window.__npc.customers().length + window.__npc.staff().length;
    return {
      rafPerSec: +(S.length / span).toFixed(1), renderedPerSec: +(rendered.length / span).toFixed(1), skippedCbMs: +avg(skipped).toFixed(3),
      frameJsMs: +avg(cb).toFixed(2), frameJsP95: +q(cb, 0.95).toFixed(2), frameJsMax: +Math.max(0, ...cb).toFixed(1),
      updateMs: +avg(up).toFixed(2), renderMs: +avg(rn).toFixed(2), renderP95: +q(rn, 0.95).toFixed(2),
      longJs50: cb.filter((x) => x > 50).length, longJs33: cb.filter((x) => x > 33).length, gapP95: +q(gaps, 0.95).toFixed(1), gaps50: gaps.filter((x) => x > 50).length,
      texCanvasPerSec: +(B.tex.canvas / span).toFixed(2), texCanvasKBps: +(B.tex.canvasBytes / span / 1024).toFixed(0), texSizes: B.tex.sizes, texDataPerFrame: +(B.tex.data / Math.max(1, rendered.length)).toFixed(1),
      mipmapsPerSec: +(B.tex.mip / span).toFixed(2), bufUploadsPerFrame: +(B.buf.calls / Math.max(1, rendered.length)).toFixed(1), bufKBPerFrame: +(B.buf.bytes / Math.max(1, rendered.length) / 1024).toFixed(1),
      domMutPerSec: +(B.mut / span).toFixed(1), people, calls: window.__game.renderer.info.render.calls, simSec: +B.simSec.toFixed(1), frames: rendered.length,
      animations: document.getAnimations().filter((a) => a.playState === 'running').map((a) => `${a.animationName ?? a.constructor.name}${a.effect?.getTiming?.().iterations === Infinity ? '∞' : ''}`),
    };
  });
  const m1 = await metrics();
  const secs = (Date.now() - t0) / 1000, fr = Math.max(1, res.frames);
  res.styleRecalcPerSec = +((m1.RecalcStyleCount - m0.RecalcStyleCount) / secs).toFixed(1);
  res.layoutPerSec = +((m1.LayoutCount - m0.LayoutCount) / secs).toFixed(1);
  res.styleLayoutMsPerFrame = +((((m1.RecalcStyleDuration - m0.RecalcStyleDuration) + (m1.LayoutDuration - m0.LayoutDuration)) * 1000) / fr).toFixed(2);
  res.scriptMsPerFrame = +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / fr).toFixed(2);
  console.log(`[${label}] rAF/s=${res.rafPerSec} desenhados/s=${res.renderedPerSec} JS/quadro=${res.frameJsMs} ms (p95 ${res.frameJsP95}, máx ${res.frameJsMax}; update ${res.updateMs} + render ${res.renderMs}) quadros JS>33ms=${res.longJs33} >50ms=${res.longJs50} intervalos>50ms=${res.gaps50} pessoas=${res.people} calls=${res.calls}`);
  console.log(`[${label}] texturas canvas/s=${res.texCanvasPerSec} (${res.texCanvasKBps} KB/s ${JSON.stringify(res.texSizes)}) dados/quadro=${res.texDataPerFrame} mipmaps/s=${res.mipmapsPerSec} buffers/quadro=${res.bufUploadsPerFrame} (${res.bufKBPerFrame} KB) DOM mut/s=${res.domMutPerSec} estilo/s=${res.styleRecalcPerSec} layout/s=${res.layoutPerSec} estilo+layout=${res.styleLayoutMsPerFrame} ms/q script=${res.scriptMsPerFrame} ms/q`);
  console.log(`[${label}] animações CSS rodando: ${JSON.stringify(res.animations)}${res.skippedCbMs ? ` · rAF pulados custam ${res.skippedCbMs} ms` : ''}`);
  return res;
};
const cpuProfile = async (fn) => {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const r = await fn();
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = new Map();
  for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
  let total = 0;
  for (const [id, us] of dt) {
    const n = byId.get(id); if (!n) continue;
    const cf = n.callFrame, k = `${cf.functionName || '(anon)'} ${cf.url ? cf.url.split('/').pop() : ''}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + us); total += us;
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => `${(100 * us / total).toFixed(1)}%  ${(us / 1000).toFixed(0)} ms  ${k}`);
  console.log('perfil de CPU (tempo próprio):'); for (const t of top) console.log('   ', t);
  return { result: r, top };
};
if (PHASES.has('win')) {
  out.normal = await win(12000, 'CPU 1x');
  await throttle(THROTTLE);
  if (env.BENCH_PROFILE === '1') { const p = await cpuProfile(() => win(12000, `CPU ${THROTTLE}x`)); out.throttled = p.result; out.profile = p.top; }
  else out.throttled = await win(12000, `CPU ${THROTTLE}x`);
  await throttle(1);
}

/* ---------- alocação (amostragem do heap, inclui objetos já coletados) ---------- */
const alloc = async (ms, label) => {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await page.evaluate(() => { const B = window.__bench; B.simSec = 0; B.samples = []; B.on = true; });
  const f0 = await page.evaluate(() => window.__game.renderer.info.render.frame);
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.waitForTimeout(ms);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const f1 = await page.evaluate(() => window.__game.renderer.info.render.frame);
  const sim = await page.evaluate(() => { const B = window.__bench; B.on = false; return B.simSec; });
  const frames = Math.max(1, f1 - f0);
  const sites = new Map();
  let total = 0;
  const walk = (n, stack) => {
    const cf = n.callFrame, name = `${cf.functionName || '(anon)'} ${cf.url ? cf.url.split('/').pop() : ''}:${cf.lineNumber + 1}`;
    const self = n.selfSize ?? 0;
    total += self;
    if (self) { const k = stack.slice(-2).concat(name).join(' < ').replace(/https?:[^ ]*\//g, ''); sites.set(k, (sites.get(k) ?? 0) + self); }
    for (const c of n.children ?? []) walk(c, stack.concat(name).slice(-3));
  };
  walk(profile.head, []);
  const top = [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / frames / 1024).toFixed(1)} KB/q  ${k}`);
  const r = { frames, simSec: +sim.toFixed(1), kbPerFrame: +(total / frames / 1024).toFixed(1), kbPerSimSec: +(total / Math.max(0.1, sim) / 1024).toFixed(0), mbPerSec: +(total / (ms / 1000) / 1e6).toFixed(2), top };
  console.log(`[${label}] alocação: ${r.kbPerFrame} KB/quadro · ${r.kbPerSimSec} KB por segundo de jogo simulado (${frames} quadros, ${r.simSec} s simulados, ${r.mbPerSec} MB/s reais)`);
  for (const t of top.slice(0, 10)) console.log(`    ${t}`);
  return r;
};
if (PHASES.has('alloc')) {
  out.alloc = await alloc(10000, 'loja cheia, timeScale 1');
  await page.evaluate(() => { window.__npc.timeScale = 6; });
  out.allocBusy = await alloc(10000, 'dia acelerado, timeScale 6');
}

/* ---------- dia acelerado: programas de shader, quadros longos, uploads ---------- */
if (PHASES.has('day')) {
  const progs = () => page.evaluate(() => ({ keys: window.__game.renderer.info.programs.map((p) => `${(p.cacheKey.split(',')[0] || '?').slice(0, 18)}#${p.id}`), links: window.__bench.links.length, wait: window.__bench.progWaitMs, minute: window.__game.clock.minute, phase: window.__game.clock.phase }));
  const p0 = await progs();
  await page.evaluate(() => { window.__npc.timeScale = 20; window.__npc.spawnNow(6); });
  out.day = await win(SECS * 1000, `dia acelerado ${SECS}s (timeScale 20)`);
  const p1 = await progs();
  const fresh = p1.keys.filter((k) => !p0.keys.includes(k));
  out.programs = { atWarm: p0.keys.length, atEnd: p1.keys.length, newDuringDay: fresh, linksDuringDay: p1.links - p0.links, linkWaitMsDuringDay: +(p1.wait - p0.wait).toFixed(1), linksAfterStart: p1.links - boot.links, totalLinks: p1.links, totalLinkWaitMs: +p1.wait.toFixed(1), minutes: [Math.round(p0.minute), Math.round(p1.minute), p1.phase] };
  console.log(`programas: aquecido=${p0.keys.length} fim=${p1.keys.length} novos no dia=${JSON.stringify(fresh)} (links depois da tela inicial ${p1.links - boot.links}, no dia ${p1.links - p0.links}; total ${p1.links}, espera de link ${p1.wait.toFixed(1)} ms) relógio ${Math.round(p0.minute)}→${Math.round(p1.minute)} ${p1.phase}`);
  // no dia acelerado (×20) a tela do caixa redesenha a cada item bipado: só acusa se for TODO quadro
  check('textura de canvas não é reenviada todo quadro (dia acelerado)', out.day.texCanvasPerSec < out.day.renderedPerSec * 0.9, `${out.day.texCanvasPerSec}/s com ${out.day.renderedPerSec} quadros/s`);
}

if (out.normal) check('textura de canvas não é reenviada todo quadro (ritmo normal)', out.normal.texCanvasPerSec <= Math.max(2, out.normal.renderedPerSec * 0.3), `${out.normal.texCanvasPerSec}/s com ${out.normal.renderedPerSec} quadros/s`);
if (out.programs) check('nenhum shader novo durante o dia (depois do aquecimento)', out.programs.linksDuringDay === 0, `${out.programs.linksDuringDay} links`);
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
out.errors = errors.slice(0, 20);
if (env.BENCH_OUT) writeFileSync(env.BENCH_OUT, JSON.stringify(out, null, 1));
await browser.close();
server?.kill();
console.log(fails.length ? `FALHOU: ${fails.join('; ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
