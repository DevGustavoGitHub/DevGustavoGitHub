// Teste e2e do áudio (Playwright + Chromium). Uso: node tests/e2e/audio.e2e.mjs
// Requer: playwright global (NODE_PATH=/opt/node-tools/node_modules) e Chromium em /opt/pw-browsers/chromium.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH ?? '/opt/node-tools/node_modules/playwright');

const PORT = 5199;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite não subiu')), 30000);
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); res(); } });
});

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) failed++; };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url ?? '').endsWith('/favicon.ico')) errors.push(m.text() + ' ' + (m.location().url ?? '')); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // sem HMR: outros agentes salvando arquivos não podem recarregar a página no meio do teste
  await page.route('**/@vite/client', (route) => route.fulfill({ contentType: 'application/javascript', body:
    'const h={accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},decline(){},on(){},off(){},send(){},data:{}};' +
    'export const createHotContext=()=>h;export const injectQuery=(u)=>u;export const removeStyle=()=>{};export class ErrorOverlay{}' +
    'export const updateStyle=(id,css)=>{const s=document.createElement("style");s.textContent=css;document.head.appendChild(s);};' }));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const booted = await page.waitForFunction(() => window.__game, null, { timeout: 20000 }).then(() => true, () => false);
  if (!booted) {
    // outro módulo quebrado/em edição: testa o áudio sozinho (mesmo EventBus, contexto mínimo)
    console.log('AVISO o jogo não iniciou (' + (errors[0] ?? 'sem erro') + ') — módulo de áudio isolado');
    errors.length = 0;
    await page.evaluate(async () => {
      const { EventBus } = await import('/src/core/events.ts');
      const audio = (await import('/src/audio/index.ts')).default();
      const ctx = { bus: new EventBus(), services: {}, rand: Math.random, state: {}, clock: {}, uiRoot: document.body, save() {},
        camera: { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6, 1.6, 8, 1] } } };
      audio.init(ctx);
      window.__game = ctx;
    });
  }

  check(await page.evaluate(() => window.__game.services.audio.state) === 'none', 'antes do gesto: AudioContext não criado');
  await page.mouse.click(50, 50); // gesto do usuário
  await page.waitForFunction(() => window.__game.services.audio.state === 'running', null, { timeout: 5000 });
  check(true, 'AudioContext running após gesto');

  await page.evaluate(async () => {
    const th = await import('/src/audio/theory.ts');
    const bus = window.__game.bus;
    for (const name of th.PUBLIC_SFX) { bus.emit('sfx', { name, pan: Math.random() * 2 - 1 }); await new Promise((r) => setTimeout(r, 60)); }
    bus.emit('sfx', { name: 'inexistente' });
    bus.emit('sfx');
    bus.emit('sfx', { name: 'place', x: 3, z: 4 }); // posição opcional (pan/volume pela câmera)
    bus.emit('levelUp', { level: 2 }); bus.emit('dayEnded', {}); bus.emit('storeOpened');
    bus.emit('customerComplaint', { customerId: 1, productId: 'x', ratio: 1.2 });
    bus.emit('toast', { text: 'a', kind: 'bad' }); bus.emit('toast', { text: 'b', kind: 'good' }); bus.emit('toast', { text: 'c' });
    bus.emit('player:action'); bus.emit('player:action', { kind: 'constructor' }); bus.emit('checkout:done');
    bus.emit('settings:changed', { volume: 0.4, haptics: false, quality: 'low' });
    bus.emit('settings:changed', { volume: 0.4, quality: 'high' });
    for (let i = 0; i < 200; i++) bus.emit('sfx', { name: 'scan' }); // estresse: limitador
    await new Promise((r) => setTimeout(r, 3200)); // deixa vencer as janelas (celebrate/night/sign)
  });
  check(errors.length === 0, 'sem erros de console/página' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // ---- reações aos eventos da Fase 3 (o log registra o que de fato tocou)
  const ev = await page.evaluate(async () => {
    const bus = window.__game.bus, A = window.__audio;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const names = () => A.log().map((e) => e.name);
    const out = {};
    A.clear();
    for (const kind of ['throwBox', 'clean', 'sit', 'stand', 'dropBox', 'sign', 'pickBox', 'move', 'useComputer']) {
      bus.emit('player:action', { kind }); await wait(120);
    }
    out.actions = names();
    await wait(1700); A.clear();
    bus.emit('sfx', { name: 'mop' }); await wait(400); bus.emit('player:action', { kind: 'clean' }); // fim da animação
    out.mop = names();
    await wait(400); A.clear();
    bus.emit('sfx', { name: 'levelup' }); bus.emit('levelUp', { level: 3 }); await wait(250); bus.emit('sfx', { name: 'levelup' });
    out.level = names();
    await wait(300); A.clear();
    bus.emit('player:action', { kind: 'sign' }); bus.emit('storeOpened');
    out.open = names();
    await wait(300); A.clear();
    bus.emit('storeClosing');
    bus.emit('checkout:done', { customerId: 1, counterId: 9999, total: 1200, tip: 0, method: 'cash', happy: true });
    await wait(150);
    bus.emit('checkout:done', { customerId: 2, counterId: 9999, total: 3000, tip: 250, method: 'card', happy: true });
    out.closing = A.log().map((e) => `${e.name}:${e.level > 0 ? 'tip' : '0'}`);
    await wait(200); A.clear();
    for (let i = 0; i < 4; i++) { bus.emit('sfx', { name: 'step' }); await wait(150); }
    out.steps = A.log().map((e) => Math.sign(e.pan));
    return out;
  });
  check(JSON.stringify(ev.actions) === JSON.stringify(['throw', 'mop', 'sit', 'stand', 'place', 'sign']), 'player:action → throw/mop/sit/stand/place/sign: ' + ev.actions.join(','));
  check(JSON.stringify(ev.mop) === '["mop"]', 'sfx mop explícito + player:action clean = um só esfregão: ' + ev.mop.join(','));
  check(ev.level.includes('celebrate') && ev.level.filter((n) => n === 'levelup').length <= 1 && ev.level[ev.level.length - 1] === 'celebrate',
    'levelUp → celebrate; levelup não toca depois (o anterior é silenciado): ' + ev.level.join(','));
  check(JSON.stringify(ev.open) === '["sign"]', 'placa cobre o sino de storeOpened: ' + ev.open.join(','));
  check(JSON.stringify(ev.closing) === '["night:0","register:0","register:tip"]', 'storeClosing → night; checkout:done → register (+gorjeta): ' + ev.closing.join(','));
  check(ev.steps.length === 4 && ev.steps.every((s, i) => i === 0 || s === -ev.steps[i - 1]), 'passos alternam pé: ' + ev.steps.join(','));

  // visibilidade: simula aba oculta/visível
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.__game.services.audio.state === 'suspended', null, { timeout: 3000 });
  check(true, 'suspende quando a aba oculta');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.__game.services.audio.state === 'running', null, { timeout: 3000 });
  check(true, 'retoma quando a aba volta');

  // render offline de cada SFX (3 sementes; 'register' também com gorjeta)
  const res = await page.evaluate(async () => {
    const synth = await import('/src/audio/synth.ts');
    const th = await import('/src/audio/theory.ts');
    const music = await import('/src/audio/music.ts');
    const SR = 44100, T0 = 0.01;
    const analyze = (d, dur) => {
      let peak = 0, sum = 0, nan = false;
      for (const v of d) { if (!Number.isFinite(v)) nan = true; const a = Math.abs(v); if (a > peak) peak = a; }
      const a0 = Math.floor(T0 * SR), a1 = Math.min(d.length, Math.ceil((T0 + dur) * SR));
      for (let i = a0; i < a1; i++) sum += d[i] * d[i];
      const edge = (s, e) => { let m = 0; for (let i = Math.max(0, s); i < Math.min(e, d.length); i++) m = Math.max(m, Math.abs(d[i])); return m; };
      return { peak, rms: Math.sqrt(sum / Math.max(1, a1 - a0)), nan, head: edge(0, a0), after: edge(Math.ceil((T0 + dur + 0.25) * SR), d.length), tail: edge(d.length - 64, d.length) };
    };
    const out = {};
    const jobs = th.ALL_SFX.map((n) => [n, n, 0]).concat([['register+tip', 'register', 1]]);
    for (const [key, name, level] of jobs) {
      for (let seed = 1; seed <= 3; seed++) {
        const oc = new OfflineAudioContext(1, Math.ceil(SR * 4.5), SR);
        const rig = { ctx: oc, out: oc.destination, noise: synth.makeNoise(oc, 2) };
        const dur = synth.playRecipe(name, rig, T0, th.makeRng(seed), level);
        const a = analyze((await oc.startRendering()).getChannelData(0), dur);
        const p = out[key];
        out[key] = p ? { dur: Math.max(dur, p.dur), peak: Math.max(a.peak, p.peak), rms: Math.min(a.rms, p.rms), nan: a.nan || p.nan,
          head: Math.max(a.head, p.head), after: Math.max(a.after, p.after), tail: Math.max(a.tail, p.tail), spec: th.SFX_SPEC[name].dur }
          : { dur, ...a, spec: th.SFX_SPEC[name].dur };
      }
    }
    // 2 compassos de música (pad+baixo+piano+melodia)
    const oc = new OfflineAudioContext(1, SR * 9, SR);
    const rig = { ctx: oc, out: oc.destination, noise: synth.makeNoise(oc, 2) };
    const song = th.generateSong(5);
    const r = th.makeRng(9);
    for (let b = 0; b < 2; b++) music.scheduleBar(rig, 0.1 + b * th.barSeconds(), song.phrases[0], b, r, { quality: 'high', melody: true });
    out.__music = { ...analyze((await oc.startRendering()).getChannelData(0), 8.8), dur: 8.8, spec: 9 };
    return out;
  });
  for (const [name, a] of Object.entries(res)) {
    const ok = !a.nan && a.peak > 0.05 && a.peak < 0.98 && a.rms > 0.004 && a.head < 0.02 && a.after < 0.003 && a.tail < 0.002 && a.dur <= a.spec + 0.02;
    check(ok, `${name.padEnd(12)} peak=${a.peak.toFixed(3)} rms=${a.rms.toFixed(4)} dur=${a.dur.toFixed(2)} head=${a.head.toFixed(4)} after=${a.after.toFixed(4)} tail=${a.tail.toFixed(4)}`);
  }
  check(res.step.peak < res.box.peak * 0.5, `passo discreto (pico ${res.step.peak.toFixed(3)} < metade da caixa ${res.box.peak.toFixed(3)})`);
  check(res.celebrate.peak >= res.levelup.peak && res.celebrate.dur > res.levelup.dur, 'celebrate mais marcante que levelup');
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* já encerrado */ }
}
process.exit(failed ? 1 : 0);
