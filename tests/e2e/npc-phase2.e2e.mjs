// E2E Fase 2 do módulo NPC: pedido automático, cancelamento de checkout sem travar, clientes especiais.
// Uso: npx vite build && (npx vite preview --port 5179 &) && node tests/e2e/npc-phase2.e2e.mjs
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.NPC_URL ?? 'http://localhost:5179/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('MIME type')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__npc, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByText('Jogar', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(600);

const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };
const until = async (fn, arg, ms = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = await page.evaluate(fn, arg); if (r) return r; await page.waitForTimeout(250); }
  return null;
};

// preparação: loja estocada, jogador "no balcão", UI escondida
await page.evaluate(() => {
  const s = __game.state;
  s.money = 5_000_000;
  for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) s.shelf[id] = 20;
  window.__toasts = []; window.__reqs = []; window.__compl = [];
  __game.bus.on('toast', (t) => window.__toasts.push(t.text));
  __game.bus.on('checkoutRequest', (r) => window.__reqs.push(r));
  __game.bus.on('customerComplaint', (c) => window.__compl.push(c));
  const pl = (__game.services.player ??= { position: { x: 9, z: 5 }, carrying: null, inputLocked: false });
  Object.defineProperty(pl, 'inputLocked', { get: () => false, set: () => {}, configurable: true });
  Object.defineProperty(pl, 'atCounter', { get: () => __game.state.furniture.find((f) => f.type === 'counter')?.id ?? null, set: () => {}, configurable: true });
  __game.uiRoot.style.display = 'none';
  setInterval(() => { __game.clock.paused = false; }, 100);
});

/* ---------- 1) pedido automático ---------- */
await page.evaluate(() => {
  const s = __game.state;
  s.shelf.arroz = 0;
  s.sidewalk.length = 0;
  s.autoOrders = { arroz: { minUnits: 9999, boxes: 1 } };
  __game.clock.openStore();
});
const t1 = await until(() => window.__toasts.find((t) => t.startsWith('Pedido automático')));
check('toast de pedido automático ao abrir', !!t1, String(t1));
check('toast cita caixas do produto', !!t1 && /\d+ cx Arroz/.test(t1), String(t1));
const side1 = await page.evaluate(() => __game.state.sidewalk.filter((b) => b.productId === 'arroz').length);
check('caixas chegaram à calçada', side1 >= 1, String(side1));
await page.evaluate(() => { window.__toasts.length = 0; __game.state.sidewalk.length = 0; __game.clock.minute = Math.ceil((__game.clock.minute + 1) / 60) * 60 + 1; });
const t2 = await until(() => window.__toasts.find((t) => t.startsWith('Pedido automático')));
check('pedido automático novamente a cada hora', !!t2, String(t2));

// repositor abastece as caixas novas (várias por viagem quando houver)
await page.evaluate(() => {
  const s = __game.state;
  s.employees.stocker = 4; s.shelf.arroz = 0; s.shelf.feijao = 0;
  s.autoOrders = {};
  s.sidewalk.length = 0;
  s.sidewalk.push({ productId: 'arroz', units: 6 }, { productId: 'feijao', units: 12 });
  __game.state.sidewalk.slice();
  __npc.sync();
  __npc.timeScale = 4;
});
const stocked = await until(() => { const s = __game.state; return s.shelf.arroz > 0 && s.shelf.feijao > 0 && s.sidewalk.length === 0 ? { a: s.shelf.arroz, f: s.shelf.feijao } : null; }, undefined, 90000);
check('repositor abasteceu 2 caixas e jogou as vazias fora', !!stocked, JSON.stringify(stocked));
await page.evaluate(() => { __game.state.employees.stocker = 0; __npc.sync(); });

/* ---------- 2) cancelamento do checkout ---------- */
await page.evaluate(() => {
  __game.clock.phase = 'open'; __game.clock.minute = 600; __game.state.employees.stocker = 0;
  for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) __game.state.shelf[id] = 20;
  window.__reqs.length = 0; window.__mode = 'cancel'; window.__cancels = 0;
  __game.bus.on('checkoutRequest', (r) => setTimeout(() => {
    if (window.__mode === 'cancel') { window.__cancels++; __game.bus.emit('checkoutResult', { customerId: r.customerId, ok: false, speed: 0, mistakes: 0 }); }
    else if (window.__mode === 'ok') __game.bus.emit('checkoutResult', { customerId: r.customerId, ok: true, speed: 0.8, mistakes: 0 });
  }, 300));
  __game.state.prices = {};
  __npc.timeScale = 6;
});
let first = null;
for (let k = 0; k < 4 && first === null; k++) {
  await page.evaluate(() => { __game.clock.minute = 600; __npc.spawnNow(1, 'normal'); });
  first = await until(() => window.__reqs[0]?.customerId ?? null, undefined, 70000);
}
check('primeiro checkoutRequest emitido', first !== null, String(first));
await page.waitForTimeout(1500);
const afterCancel = await page.evaluate((id) => ({ info: __npc.customerInfo(id), reqs: window.__reqs.length }), first);
check('cliente continua esperando após cancelar (não preso nem removido)', !!afterCancel.info && (afterCancel.info.state === 'front' || afterCancel.info.state === 'queue') && afterCancel.info.cancels === 1, JSON.stringify(afterCancel.info));
check('cancelar não reabre sozinho (sem loop)', afterCancel.reqs === 1, String(afterCancel.reqs));
check('paciência reduzida', afterCancel.info.waited >= 4 || afterCancel.info.patience < 60);
await page.evaluate(() => { window.__mode = 'ok'; __npc.retryCheckout(); });
const req2 = await until(() => window.__reqs.length >= 2 ? window.__reqs[1].customerId : null, undefined, 15000);
check('novo toque em Atender emite novo checkoutRequest imediato', req2 === first, String(req2));
const sold = await until(() => __npc.stats.sold >= 1, undefined, 30000);
check('venda concluída após nova tentativa', !!sold);
// 3 cancelamentos seguidos: cliente desiste, sem travar a fila
await page.evaluate(() => { window.__mode = 'cancel'; window.__reqs.length = 0; __npc.spawnNow(1, 'normal'); });
let cid = null;
for (let k = 0; k < 4 && cid === null; k++) {
  await page.evaluate(() => { __game.clock.minute = 600; __npc.spawnNow(1, 'normal'); });
  cid = await until(() => window.__reqs[0]?.customerId ?? null, undefined, 70000);
}
for (let i = 0; i < 4; i++) { await page.waitForTimeout(900); await page.evaluate(() => __npc.retryCheckout()); }
await page.waitForTimeout(1500);
const gone = await page.evaluate((id) => { const i = __npc.customerInfo(id); return !i || i.state.startsWith('leave') || i.state === 'gone'; }, cid);
check('após 3 cancelamentos o cliente desiste e sai', gone);
await page.evaluate(() => { window.__mode = 'ok'; });

/* ---------- 3) clientes especiais ---------- */
const dist = await page.evaluate(() => __npc.sampleKinds(6000));
console.log('dist', JSON.stringify(dist));
check('tipos especiais aparecem e são raros', dist.bulk > 0 && dist.picky > 0 && dist.kid > 0 && (dist.bulk + dist.picky + dist.kid) / 6000 < 0.25, JSON.stringify(dist));

await page.evaluate(() => {
  for (const c of __npc.customers()) {}
  window.__compl.length = 0;
  const s = __game.state;
  // preço 1,5x o mercado em tudo: exigente reclama sempre; normal aceita só às vezes
  for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) { const w = s.prices[id] ?? 0; s.prices[id] = Math.round(((w || 1500) * 1.5)); }
  __npc.timeScale = 4;
});
const spawned = await page.evaluate(() => ({ bulk: __npc.spawnNow(1, 'bulk'), picky: __npc.spawnNow(1, 'picky'), kid: __npc.spawnNow(1, 'kid') }));
check('spawn forçado dos 3 tipos', spawned.bulk && spawned.picky && spawned.kid, JSON.stringify(spawned));
const kinds = await page.evaluate(() => __npc.customers().map((c) => c.kind));
check('tipos presentes na loja', ['bulk', 'picky', 'kid'].every((k) => kinds.includes(k)), kinds.join(','));
const comp = await until(() => window.__compl.length >= 1 ? window.__compl.length : null, undefined, 60000);
check('exigente reclama de preço alto', !!comp, String(comp));
// bulk/kid: restaura preços e confere tamanho da compra
await page.evaluate(() => { const s = __game.state; s.prices = {}; for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) s.shelf[id] = 40; });
await page.evaluate(() => {
  __game.clock.phase = 'open'; __game.clock.minute = 600;
  window.__max = {};
  setInterval(() => { for (const c of __npc.customers()) { const i = __npc.customerInfo(c.id); if (i) window.__max[i.kind] = Math.max(window.__max[i.kind] ?? 0, i.units); } }, 100);
  for (let i = 0; i < 3; i++) { __npc.spawnNow(1, 'bulk'); __npc.spawnNow(1, 'kid'); }
});
const sizes = await until(() => (window.__max.bulk >= 4 && window.__max.kid > 0 && __npc.customers().some((c) => c.kind === 'bulk' && c.state === 'queue')) ? window.__max : null, undefined, 120000);
check('compra grande > compra de criança', !!sizes && sizes.bulk > sizes.kid, JSON.stringify(sizes));
await page.screenshot({ path: process.env.NPC_SHOT ?? '/tmp/npc-phase2.png' });
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (fails.length) { console.log('FALHAS:', fails.join(', ')); process.exit(1); }
console.log('OK');
