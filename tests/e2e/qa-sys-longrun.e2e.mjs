// QA de sistemas — longa duração: N dias de jogo acelerados (timeScale 20) com a loja movimentada (expansão 2, depósito,
// 21 móveis, caixa/repositor/faxineiro, pedidos automáticos). Por dia: erros de console, geometrias/texturas/programas
// (renderer.info), heap JS após GC (CDP), objetos na cena, nós do DOM, ouvintes do bus, conservação de unidades
// (costBasis.units = níveis+depósito+calçada+cestas) e caixas "carregadas" sem dono. Janela de custo por quadro
// (CDP Performance.getMetrics: ScriptDuration/TaskDuration ÷ quadros) com a loja cheia em timeScale 1.
// Uso: QA_URL=http://localhost:5212/ QA_DAYS=9 QA_SAVE=<busy-save.json> node tests/e2e/qa-sys-longrun.e2e.mjs
// QA_SAVE: save inicial (gerado pela sim); sem ele a loja é montada no próprio teste a partir do jogo novo.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.QA_URL ?? 'http://localhost:5212/';
const DAYS = Number(process.env.QA_DAYS ?? 9);
const OUT = process.env.QA_OUT ?? '';
const SAVE = process.env.QA_SAVE ? readFileSync(process.env.QA_SAVE, 'utf8') : null;
const QUALITY = process.env.QA_QUALITY ?? 'low';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--enable-precise-memory-info'],
});
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/404|MIME type|GPU stall|swiftshader|WebGL/i.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(([save, q]) => {
  try {
    localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: q, reduceMotion: true, volume: 0 }));
    localStorage.setItem('mercadinho:tutorial', 'done');
    if (save && !sessionStorage.getItem('qa:seeded')) { localStorage.setItem('mercadinho-sim:save:v1', save); sessionStorage.setItem('qa:seeded', '1'); }
  } catch { /* */ }
  window.__frames = 0;
  const tick = () => { window.__frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}, [SAVE, QUALITY]);
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); if (!ok) fails.push(n); };

await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__ui && window.__npc && window.__player, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { const b = [...document.querySelectorAll('.title-screen .btn')].find((x) => /Jogar|Continuar/.test(x.textContent)); b?.click(); });
await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 }).catch(() => {});
// o jogador fica parado no meio da loja (sem caixa na mão); funcionários fazem o trabalho
await page.evaluate(() => { const s = window.__game.state; window.__player.teleport?.(4, s.expansion >= 2 ? 11 : 8, 0, 0); window.__npc.sync(); });

/** Métricas do estado do jogo + conservação de unidades. */
const probe = () => page.evaluate(() => {
  const g = window.__game, s = g.state, info = g.renderer.info;
  let objs = 0, meshes = 0;
  g.scene.traverse((o) => { objs++; if (o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) meshes++; });
  const owned = {};
  const add = (k, n) => { if (n) owned[k] = (owned[k] ?? 0) + n; };
  for (const f of s.furniture) for (const l of f.levels ?? []) if (l.productId) add(l.productId, l.units);
  for (const [k, n] of Object.entries(s.storage)) add(k, n);
  for (const b of s.sidewalk) add(b.productId, b.units);
  for (const c of window.__npc.customers()) { const i = window.__npc.customerInfo(c.id); for (const it of i?.items ?? []) add(it.productId, it.qty); }
  const drift = {};
  for (const k of new Set([...Object.keys(owned), ...Object.keys(s.costBasis)])) { const d = (s.costBasis[k]?.units ?? 0) - (owned[k] ?? 0); if (d) drift[k] = d; }
  const heldIds = window.__player.svc?.carryingAll?.length ?? 0;
  let listeners = 0;
  for (const set of g.bus.h?.values?.() ?? []) listeners += set.size;
  return {
    day: s.day, phase: g.clock.phase, minute: Math.round(g.clock.minute), money: s.money, level: s.level,
    customers: window.__npc.customers().length, staff: window.__npc.staff().length,
    geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
    calls: info.render.calls, objs, meshes, dom: document.getElementsByTagName('*').length, listeners,
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null,
    boxes: s.sidewalk.length, carried: s.sidewalk.filter((b) => b.carried).length, playerHeld: heldIds, storage: Object.values(s.storage).reduce((a, b) => a + b, 0),
    drift, dirt: s.dirt.length, saveKB: Math.round((localStorage.getItem('mercadinho-sim:save:v1') ?? '').length / 102.4) / 10,
  };
});
const heapAfterGC = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const h = await cdp.send('Runtime.getHeapUsage'); return Math.round(h.usedSize / 1e5) / 10; };
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
/** Custo por quadro numa janela de `ms` (timeScale atual). */
const frameCost = async (ms = 8000) => {
  const m0 = await metrics(); const f0 = await page.evaluate(() => window.__frames);
  await page.waitForTimeout(ms);
  const m1 = await metrics(); const f1 = await page.evaluate(() => window.__frames);
  const fr = Math.max(1, f1 - f0);
  return {
    frames: fr, fps: +(fr / (ms / 1000)).toFixed(1),
    scriptMsPerFrame: +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / fr).toFixed(2),
    taskMsPerFrame: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / fr).toFixed(2),
    styleLayoutMsPerFrame: +((((m1.RecalcStyleDuration - m0.RecalcStyleDuration) + (m1.LayoutDuration - m0.LayoutDuration)) * 1000) / fr).toFixed(2),
    customers: await page.evaluate(() => window.__npc.customers().length),
  };
};

const rows = [];
const costs = [];
const driftSeen = [];
const orphanSeen = [];
const t00 = Date.now();
const day0 = await page.evaluate(() => window.__game.state.day);
rows.push({ ...(await probe()), heapGC: await heapAfterGC(), wall: 0 });
console.log('início', JSON.stringify(rows[0]));
for (let d = 0; d < DAYS; d++) {
  const t0 = Date.now();
  await page.evaluate(() => { window.__game.clock.openStore(); window.__npc.timeScale = 20; });
  let busyMeasured = false;
  // dia acelerado; amostra a cada ~4 s
  while (true) {
    await page.waitForTimeout(4000);
    const p = await probe();
    if (Object.keys(p.drift).length && driftSeen.length < 12) driftSeen.push({ day: p.day, minute: p.minute, drift: p.drift });
    if (p.carried > p.playerHeld + p.staff * 3 && orphanSeen.length < 12) orphanSeen.push({ day: p.day, minute: p.minute, carried: p.carried, held: p.playerHeld });
    if (!busyMeasured && (d === 0 || d === Math.floor(DAYS / 2) || d === DAYS - 1) && p.phase === 'open' && p.customers >= 8) {
      busyMeasured = true;
      await page.evaluate(() => { window.__npc.timeScale = 1; });
      const c = await frameCost(8000);
      costs.push({ day: p.day, minute: p.minute, ...c });
      console.log('custo por quadro (loja cheia, timeScale 1):', JSON.stringify(costs[costs.length - 1]));
      await page.evaluate(() => { window.__npc.timeScale = 20; });
    }
    if (p.phase === 'closing' && (p.customers === 0 || Date.now() - t0 > 400000)) break;
    if (Date.now() - t0 > 600000) { console.log('dia demorou demais', JSON.stringify(p)); break; }
  }
  if (d === DAYS - 1) {
    await page.evaluate(() => { window.__npc.timeScale = 1; });
    const c = await frameCost(6000);
    costs.push({ day: 'noite', ...c });
    console.log('custo por quadro (loja vazia à noite):', JSON.stringify(c));
  }
  // termina o dia → resumo → Continue jogando
  await page.evaluate(() => window.__ui.endDay());
  await page.waitForTimeout(500);
  if (await page.locator('.mx-dialog').count()) await page.locator('.mx-dialog .btn.primary').click();
  await page.waitForSelector('#sum-next', { timeout: 20000 }).catch(() => {});
  const rep = await page.evaluate(() => { const h = window.__game.state.history; return h[h.length - 1]; });
  await page.locator('#sum-next').click().catch(() => {});
  await page.waitForTimeout(800);
  // fecha comemorações de nível que tenham aparecido
  for (let i = 0; i < 4; i++) { const n = await page.evaluate(() => { const b = document.querySelector('.cele .btn-go'); b?.click(); return !!b; }); if (!n) break; await page.waitForTimeout(400); }
  const row = { ...(await probe()), heapGC: await heapAfterGC(), served: rep?.served, lost: rep?.lost, net: rep?.netProfit, wall: Math.round((Date.now() - t0) / 1000) };
  rows.push(row);
  console.log(`dia ${rep?.day}:`, JSON.stringify(row));
}

const first = rows[1] ?? rows[0], last = rows[rows.length - 1];
console.log('\nTABELA', JSON.stringify(rows.map((r) => ({ day: r.day, served: r.served, lost: r.lost, geo: r.geometries, tex: r.textures, prog: r.programs, objs: r.objs, dom: r.dom, lis: r.listeners, heapGC: r.heapGC, saveKB: r.saveKB, wall: r.wall }))));
check(`${DAYS} dias jogados`, last.day - day0 >= DAYS, `${day0} → ${last.day}`);
check('sem erros/avisos de console', errors.length === 0, errors.slice(0, 6).join(' | '));
check('geometrias não crescem dia a dia (±10%)', last.geometries <= first.geometries * 1.1 + 5, `${first.geometries} → ${last.geometries}`);
check('texturas não crescem dia a dia', last.textures <= first.textures + 2, `${first.textures} → ${last.textures}`);
check('objetos na cena estáveis', last.objs <= first.objs * 1.1 + 20, `${first.objs} → ${last.objs}`);
check('nós do DOM estáveis', last.dom <= first.dom * 1.15 + 20, `${first.dom} → ${last.dom}`);
check('ouvintes do bus estáveis', last.listeners <= first.listeners + 5, `${first.listeners} → ${last.listeners}`);
check('heap JS após GC estável (< +25%)', last.heapGC <= first.heapGC * 1.25, `${first.heapGC} MB → ${last.heapGC} MB`);
check('conservação de unidades: costBasis = níveis+depósito+calçada+cestas em todo o jogo', driftSeen.length === 0, JSON.stringify(driftSeen.slice(0, 4)));
check('nenhuma caixa "carregada" sem dono (some do mundo)', orphanSeen.length === 0, JSON.stringify(orphanSeen.slice(0, 4)));
const served = rows.slice(1).reduce((a, r) => a + (r.served ?? 0), 0), lost = rows.slice(1).reduce((a, r) => a + (r.lost ?? 0), 0);
console.log('atendidos', served, 'perdidos', lost, 'tempo total', Math.round((Date.now() - t00) / 1000), 's');
console.log('CUSTOS', JSON.stringify(costs));
if (OUT) writeFileSync(OUT, JSON.stringify({ rows, costs, driftSeen, orphanSeen, errors: errors.slice(0, 50), served, lost }, null, 1));
await browser.close();
console.log(fails.length ? `FALHAS (${fails.length}): ${fails.join(' ; ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
