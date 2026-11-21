// Desempenho do mundo 3D (draw calls / geometrias / texturas) + qualidade + gesto de dois dedos.
// Uso: npx vite build && node tests/e2e/perf.e2e.mjs   (sobe `vite preview --port 5177` sozinho)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const PORT = process.env.PERF_PORT ?? '5177';
const URL = process.env.PERF_URL ?? `http://localhost:${PORT}/`;
const MAX_CALLS = 220;
let server = null;
if (!process.env.PERF_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL)).ok) break; } catch { /* aguardando */ } await new Promise((r) => setTimeout(r, 500)); }
}
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('MIME type')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { try { localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: 'high', volume: 0, haptics: false })); } catch { /* */ } });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.getByText('Jogar', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);

  const stats = () => page.evaluate(async () => {
    const g = window.__game;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const i = g.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  });
  const fmt = (s) => `calls=${s.calls} tris=${s.tris} geometries=${s.geometries} textures=${s.textures}`;

  // cena típica: expansão 1, depósito, ~18 móveis abastecidos, caixas na calçada, sujeira
  const setup = (exp) => page.evaluate((exp) => {
    const s = window.__game.state;
    s.expansion = exp; s.storageUnlocked = true;
    const W = 12 + 4 * exp;
    s.furniture.length = 0;
    const prods = ['arroz', 'feijao', 'macarrao', 'cafe', 'refri', 'agua', 'leite', 'queijo', 'pao', 'detergente', 'sorvete'];
    let id = 1;
    const add = (type, x, z, rot, productId, variant) => s.furniture.push({ id: id++, type, x, z, rot, productId, variant });
    for (let i = 0; i < 4; i++) add('shelf', 1 + i * 2, 0, 0, prods[i]);
    add('shelf', 1, 4, 180, prods[8]); add('shelf', 1, 5, 0, prods[9]); add('shelf', 4, 4, 180, prods[5]); add('shelf', 4, 5, 0, prods[6]);
    add('fridge', W - 1, 1, 270, prods[4]); add('freezer', W - 1, 4, 270, prods[10]); add('fridge', 9, 0, 0, prods[7]);
    add('counter', 7, 5, 0);
    add('decor', 0, 8, 0, undefined, 'plant'); add('decor', 3, 8, 0, undefined, 'banner'); add('decor', W - 1, 8, 0, undefined, 'tree');
    add('rack', 1, -5, 0); add('rack', 4, -5, 0);
    for (const p of prods) { s.shelf[p] = 14; s.slots[p] = 2; }
    s.storage = { arroz: 18, refri: 14, leite: 30, feijao: 5 };
    s.sidewalk.length = 0;
    for (const p of ['arroz', 'feijao', 'refri', 'leite', 'agua', 'macarrao']) s.sidewalk.push({ productId: p, units: 6 });
    s.dirt = [{ x: 3.4, z: 3.2 }, { x: 5.2, z: 7.1 }, { x: 9.6, z: 6.6 }];
    window.__game.bus.emit('stateChanged', { what: 'furniture' });
    window.__world.rebuild();
    window.__world.setCamera(W / 2 + 4, 11, 10 + 2 * exp + 15, W / 2, 0, (10 + 2 * exp) / 2 - 1);
  }, exp);

  const rows = [];
  for (const exp of [1, 2, 3, 4, 1]) {
    await setup(exp);
    const s = await stats();
    rows.push({ exp, ...s });
    console.log(`expansao ${exp}: ${fmt(s)}`);
  }
  const first = rows[0], last = rows[rows.length - 1];
  check(`draw calls <= ${MAX_CALLS} (cena tipica, expansao 1)`, first.calls <= MAX_CALLS, `(${first.calls})`);
  check(`draw calls <= ${MAX_CALLS} em todas as expansoes`, rows.every((r) => r.calls <= MAX_CALLS), `(max ${Math.max(...rows.map((r) => r.calls))})`);
  check('geometrias nao crescem ao voltar a expansao 1', last.geometries <= first.geometries + 2, `(${first.geometries} -> ${last.geometries})`);
  check('texturas nao crescem ao voltar a expansao 1', last.textures <= first.textures, `(${first.textures} -> ${last.textures})`);
  const maxG = Math.max(...rows.map((r) => r.geometries)), maxT = Math.max(...rows.map((r) => r.textures));
  check('geometrias nao crescem entre expansoes', maxG <= first.geometries + 40, `(max ${maxG} vs ${first.geometries})`);
  check('texturas nao crescem entre expansoes', maxT <= first.textures + 2, `(max ${maxT} vs ${first.textures})`);
  // 5 rebuilds seguidos: sem vazamento
  const before = await stats();
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.__world.rebuild());
  const after = await stats();
  check('rebuild repetido nao vaza geometrias/texturas', after.geometries <= before.geometries && after.textures <= before.textures, `(${fmt(before)} -> ${fmt(after)})`);

  // qualidade em tempo real
  await page.evaluate(() => window.__game.bus.emit('settings:changed', { quality: 'low', volume: 0, haptics: false }));
  await page.waitForTimeout(300);
  const q = await page.evaluate(() => ({ ...window.__world.quality() }));
  console.log('qualidade low:', JSON.stringify(q));
  check('tier low: pixel ratio <= 1 e sombras desligadas', q.pixelRatio <= 1 && q.shadows === 0, JSON.stringify(q));
  const lowS = await stats();
  console.log('low:', fmt(lowS));
  await page.evaluate(() => window.__game.bus.emit('settings:changed', { quality: 'high', volume: 0, haptics: false }));
  await page.waitForTimeout(300);
  const q2 = await page.evaluate(() => ({ ...window.__world.quality() }));
  check('tier high: sombras 2048', q2.shadows === 2048, JSON.stringify(q2));

  // produtos novos: qualquer shape/cor gera visual sem quebrar
  const gen = await page.evaluate(() => window.__world.testGenericProducts());
  check('visuais genericos por shape/cor', gen.ok, JSON.stringify(gen));

  check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));

  // gestos de dois dedos no build mode (CDP touch)
  const mctx = await browser.newContext({ viewport: { width: 800, height: 500 }, hasTouch: true, isMobile: true });
  const mp = await mctx.newPage();
  const merr = [];
  mp.on('pageerror', (e) => merr.push(e.message));
  await mp.goto(URL);
  await mp.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await mp.getByText('Jogar', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await mp.waitForTimeout(500);
  const mq = await mp.evaluate(() => window.__world.quality());
  check('celular: tier inicial low/medium', mq.tier === 'low' || mq.tier === 'medium', JSON.stringify(mq));
  await mp.evaluate(() => { window.__game.state.money = 9999999; window.__game.bus.emit('build:start', { type: 'shelf', productId: 'arroz' }); });
  await mp.waitForTimeout(1500);
  const cdp = await mctx.newCDPSession(mp);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const pose0 = await mp.evaluate(() => ({ ...window.__world.build.pose, dist: window.__world.build.camDist }));
  // pinca: afastar dois dedos horizontalmente (zoom in) mantendo o angulo
  const cx = 400, cy = 250;
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx - 40 - i * 12, cy], [cx + 40 + i * 12, cy]]);
  await touch('touchEnd', []);
  await mp.waitForTimeout(200);
  const pose1 = await mp.evaluate(() => ({ ...window.__world.build.pose, dist: window.__world.build.camDist }));
  check('pinca altera o zoom', pose1.dist < pose0.dist - 1, `(${pose0.dist.toFixed(1)} -> ${pose1.dist.toFixed(1)})`);
  check('pinca nao gira o movel', pose1.rot === pose0.rot, `(${pose0.rot} -> ${pose1.rot})`);
  // giro: dois dedos rodam ~100 graus em torno do centro
  await touch('touchStart', [[cx - 60, cy], [cx + 60, cy]]);
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * (Math.PI * 0.6);
    await touch('touchMove', [[cx - 60 * Math.cos(a), cy - 60 * Math.sin(a)], [cx + 60 * Math.cos(a), cy + 60 * Math.sin(a)]]);
  }
  await touch('touchEnd', []);
  await mp.waitForTimeout(200);
  const pose2 = await mp.evaluate(() => ({ ...window.__world.build.pose, dist: window.__world.build.camDist }));
  check('giro de dois dedos gira o movel', pose2.rot !== pose1.rot, `(${pose1.rot} -> ${pose2.rot})`);
  check('giro nao altera o zoom', Math.abs(pose2.dist - pose1.dist) < 1.5, `(${pose1.dist.toFixed(1)} -> ${pose2.dist.toFixed(1)})`);
  // toque simples posiciona; arrastar o fantasma move
  const p3 = await mp.evaluate(() => ({ ...window.__world.build.pose }));
  const scr = await mp.evaluate(() => window.__world.build.ghostScreen());
  await touch('touchStart', [[scr.x, scr.y]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[scr.x - i * 14, scr.y]]);
  await touch('touchEnd', []);
  await mp.waitForTimeout(200);
  const p4 = await mp.evaluate(() => ({ ...window.__world.build.pose }));
  check('arrastar com um dedo move o fantasma', p4.x !== p3.x || p4.z !== p3.z, `(${p3.x},${p3.z} -> ${p4.x},${p4.z})`);
  check('sem erros de pagina (celular)', merr.length === 0, merr.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server?.kill();
}
console.log(fails.length ? `\nFALHOU: ${fails.join('; ')}` : '\nOK');
process.exit(fails.length ? 1 : 0);
