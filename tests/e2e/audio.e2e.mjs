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
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__game);

  check(await page.evaluate(() => window.__game.services.audio.state) === 'none', 'antes do gesto: AudioContext não criado');
  await page.mouse.click(50, 50); // gesto do usuário
  await page.waitForFunction(() => window.__game.services.audio.state === 'running', null, { timeout: 5000 });
  check(true, 'AudioContext running após gesto');

  await page.evaluate(async () => {
    const bus = window.__game.bus;
    const names = ['scan', 'cash', 'coin', 'card', 'pop', 'error', 'levelup', 'door', 'step', 'box', 'trash', 'buy'];
    for (const name of names) { bus.emit('sfx', { name, pan: Math.random() * 2 - 1 }); await new Promise((r) => setTimeout(r, 60)); }
    bus.emit('sfx', { name: 'inexistente' });
    bus.emit('sfx');
    bus.emit('levelUp', { level: 2 }); bus.emit('dayEnded', {}); bus.emit('storeOpened');
    bus.emit('customerComplaint', { customerId: 1, productId: 'x', ratio: 1.2 });
    bus.emit('toast', { text: 'a', kind: 'bad' }); bus.emit('toast', { text: 'b', kind: 'good' }); bus.emit('toast', { text: 'c' });
    bus.emit('settings:changed', { volume: 0.4, haptics: false, quality: 'low' });
    bus.emit('settings:changed', { volume: 0.4, quality: 'high' });
    for (let i = 0; i < 200; i++) bus.emit('sfx', { name: 'scan' }); // estresse: limitador
    await new Promise((r) => setTimeout(r, 1500));
  });
  check(errors.length === 0, 'sem erros de console/página' + (errors.length ? ': ' + errors.join(' | ') : ''));

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

  // render offline de cada SFX
  const res = await page.evaluate(async () => {
    const synth = await import('/src/audio/synth.ts');
    const th = await import('/src/audio/theory.ts');
    const music = await import('/src/audio/music.ts');
    const SR = 44100;
    const analyze = (d) => {
      let peak = 0, sum = 0, nan = false;
      for (const v of d) { if (!Number.isFinite(v)) nan = true; const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
      const edge = (s, e) => { let m = 0; for (let i = s; i < e; i++) m = Math.max(m, Math.abs(d[i])); return m; };
      return { peak, rms: Math.sqrt(sum / d.length), nan, head: edge(0, 8), tail: edge(d.length - 64, d.length) };
    };
    const out = {};
    for (const name of th.ALL_SFX) {
      for (let seed = 1; seed <= 3; seed++) {
        const oc = new OfflineAudioContext(1, SR * 2.5, SR);
        const rig = { ctx: oc, out: oc.destination, noise: synth.makeNoise(oc, 2) };
        const dur = synth.playRecipe(name, rig, 0.01, th.makeRng(seed));
        const buf = await oc.startRendering();
        const a = analyze(buf.getChannelData(0));
        const prev = out[name];
        out[name] = { dur, ...a, peak: Math.max(a.peak, prev?.peak ?? 0), rms: Math.min(a.rms, prev?.rms ?? 9), nan: a.nan || prev?.nan };
      }
    }
    // 2 compassos de música (pad+baixo+piano+melodia)
    const oc = new OfflineAudioContext(1, SR * 9, SR);
    const rig = { ctx: oc, out: oc.destination, noise: synth.makeNoise(oc, 2) };
    const song = th.generateSong(5);
    const r = th.makeRng(9);
    for (let b = 0; b < 2; b++) music.scheduleBar(rig, 0.1 + b * th.barSeconds(), song.phrases[0], b, r, { quality: 'high', melody: true });
    out.__music = analyze((await oc.startRendering()).getChannelData(0));
    return out;
  });
  for (const [name, a] of Object.entries(res)) {
    const ok = !a.nan && a.peak > 0.05 && a.peak < 0.98 && a.rms > 0.002 && a.head < 0.02 && a.tail < 0.01;
    check(ok, `${name.padEnd(8)} peak=${a.peak.toFixed(3)} rms=${a.rms.toFixed(4)} head=${a.head.toFixed(4)} tail=${a.tail.toFixed(4)}`);
  }
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* já encerrado */ }
}
process.exit(failed ? 1 : 0);
