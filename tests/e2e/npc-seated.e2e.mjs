// E2E Fase 3 do módulo NPC: caixa sentado (itens na esteira tocáveis via PickService, checkout:display,
// pagamento estendido tocável → checkoutRequest stage 'pay' → checkoutResult → venda/checkout:done),
// funcionário caixa sentado, repositor abrindo a caixa, visual dos clientes (prints).
// Uso: npx vite build && (npx vite preview --port 5193 &) && node tests/e2e/npc-seated.e2e.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const OUT = process.env.NPC_SHOTS ?? '/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/npc3';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.NPC_URL ?? 'http://localhost:5193/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('MIME type')) errors.push(m.text()); if (m.text().includes('[npc]')) console.log('WARN', m.text()); });
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
  while (Date.now() - t0 < ms) { const r = await page.evaluate(fn, arg); if (r) return r; await page.waitForTimeout(200); }
  return null;
};

// preparação: loja abastecida, espiões de eventos e do PickService, jogador sentado no caixa
const setup = await page.evaluate(() => {
  const g = __game, s = g.state;
  s.money = Math.max(s.money, 200000);
  for (const f of s.furniture) if (f.productId) s.shelf[f.productId] = 30;
  s.employees.cashier = 0; s.employees.stocker = 0; s.employees.janitor = 0;
  __npc.sync();
  window.__ev = { display: [], req: [], done: [], sfx: [], avail: [] };
  g.bus.on('checkout:display', (p) => window.__ev.display.push(p));
  g.bus.on('checkoutRequest', (p) => window.__ev.req.push(p));
  g.bus.on('checkout:done', (p) => window.__ev.done.push(p));
  g.bus.on('sfx', (p) => window.__ev.sfx.push(p?.name));
  // espião do PickService (encaminha ao do player, se existir)
  const real = g.services.pick;
  window.__reg = new Map();
  window.__ever = new Set();
  g.services.pick = {
    add(o, fn) { window.__reg.set(o, fn); window.__ever.add(o); real?.add(o, fn); },
    remove(o) { window.__reg.delete(o); real?.remove(o); },
  };
  const cid = s.furniture.find((f) => f.type === 'counter')?.id ?? null;
  let how = 'svc';
  if (window.__player?.sit && window.__player.sit(cid)) how = '__player.sit';
  else Object.defineProperty(g.services.player, 'seatedAt', { get: () => cid, set: () => {}, configurable: true });
  setInterval(() => { g.clock.paused = false; }, 100);
  g.clock.paused = false; g.clock.openStore();
  return { cid, how, pick: !!real, seated: g.services.player?.seatedAt };
});
console.log('setup', JSON.stringify(setup));
check('jogador sentado no caixa', setup.seated === setup.cid, JSON.stringify(setup));

/* ---------- 1) cliente põe itens na esteira, registrados no PickService ---------- */
await page.evaluate(() => { __npc.timeScale = 4; __npc.spawnNow(1, 'normal'); });
const reg1 = await until(() => {
  const l = __npc.lanes()[0];
  return window.__reg.size > 0 && l && l.belt > 0 ? { reg: window.__reg.size, lane: l } : null;
}, undefined, 70000);
check('itens na esteira registrados no PickService', !!reg1, JSON.stringify(reg1));
await page.evaluate(() => { __npc.timeScale = 1; });
await page.waitForTimeout(900);
const outl = await page.evaluate(() => [...window.__reg.keys()].filter((o) => !o.userData.npcPay).map((o) => { let n = 0; o.traverse((c) => { if (c.userData.isOutline) n++; }); return n; }));
check('itens tocáveis com contorno verde', outl.length > 0 && outl.every((n) => n > 0), JSON.stringify(outl));
await page.screenshot({ path: `${OUT}/01-belt.png` });
const disp0 = await page.evaluate(() => window.__ev.display.find((d) => d.mode === 'items') ?? null);
check('checkout:display items ao começar', !!disp0 && disp0.total === 0, JSON.stringify(disp0));

/* ---------- 2) toques bipam; tudo bipado → notas/cartão estendidos ---------- */
let scans = 0, payShown = false;
for (let i = 0; i < 80 && !payShown; i++) {
  const r = await page.evaluate(() => {
    let n = 0;
    for (const [o, fn] of [...window.__reg]) if (!o.userData.npcPay) { fn(); n++; }
    const pay = [...window.__reg.keys()].some((o) => o.userData.npcPay);
    return { n, pay };
  });
  scans += r.n; payShown = r.pay;
  await page.waitForTimeout(250);
}
check('toques bipam os itens', scans > 0, String(scans));
const ev2 = await page.evaluate(() => ({
  items: window.__ev.display.filter((d) => d.mode === 'items' && d.lastItem), scans: window.__ev.sfx.filter((n) => n === 'scan').length,
}));
const inc = ev2.items.every((d, i, a) => i === 0 || d.total >= a[i - 1].total);
check('checkout:display com lastItem {name, price} e total acumulado', ev2.items.length >= 1 && inc && ev2.items.every((d) => d.lastItem.name && d.lastItem.price > 0 && d.counterId === setup.cid), JSON.stringify(ev2.items.slice(-2)));
check('sfx scan a cada toque', ev2.scans >= ev2.items.length && ev2.scans > 0, `${ev2.scans}/${ev2.items.length}`);
check('pagamento (notas/cartão) estendido e tocável', payShown);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/02-pay.png` });

/* ---------- 3) toque no pagamento → checkoutRequest stage 'pay' ---------- */
const money0 = await page.evaluate(() => __game.state.money);
await page.evaluate(() => { for (const [o, fn] of [...window.__reg]) if (o.userData.npcPay) fn(); });
const req = await until(() => window.__ev.req[0] ?? null, undefined, 5000);
check('checkoutRequest com stage pay', !!req && req.stage === 'pay' && req.counterId === setup.cid && req.total > 0 && (req.method === 'cash' || req.method === 'card') && req.paid >= req.total && req.items.length > 0, JSON.stringify(req));
const afterTap = await page.evaluate(() => ({ reg: window.__reg.size, lane: __npc.lanes()[0] }));
check('pagamento some e deixa de ser tocável após o toque', afterTap.reg === 0 && afterTap.lane.phase === 'paying', JSON.stringify(afterTap));

/* ---------- 4) checkoutResult ok → venda, checkout:done, display idle ---------- */
await page.evaluate((r) => __game.bus.emit('checkoutResult', { customerId: r.customerId, ok: true, speed: 0.9, mistakes: 0 }), req);
const done = await until(() => window.__ev.done[0] ?? null, undefined, 5000);
const money1 = await page.evaluate(() => __game.state.money);
check('checkout:done emitido', !!done && done.customerId === req.customerId && done.counterId === setup.cid && done.total === req.total && typeof done.tip === 'number' && done.method === req.method && typeof done.happy === 'boolean', JSON.stringify(done));
check('dinheiro subiu com a venda', money1 >= money0 + req.total, `${money0} -> ${money1} (total ${req.total})`);
const idle = await page.evaluate(() => window.__ev.display[window.__ev.display.length - 1]);
check('checkout:display idle no fim', idle?.mode === 'idle' && idle.counterId === setup.cid, JSON.stringify(idle));
const clean = await page.evaluate(() => { let hulls = 0; for (const o of window.__ever) { if (o.parent && !o.userData.npcPay) hulls += 100; o.traverse((c) => { if (c.userData.isOutline) hulls++; }); } return { reg: window.__reg.size, hulls, lane: __npc.lanes()[0], ledger: { happy: __game.state.ledger.happy, angry: __game.state.ledger.angry } }; });
check('tocáveis e contornos limpos', clean.reg === 0 && clean.hulls === 0 && clean.lane.phase === null, JSON.stringify(clean));
check('cliente feliz contado na sim', (clean.ledger.happy ?? 0) >= 1, JSON.stringify(clean.ledger));
const leaving = await until((id) => { const i = __npc.customerInfo(id); return !i || i.state.startsWith('leave') || i.state === 'gone'; }, req.customerId, 5000);
check('cliente sai depois de pagar', !!leaving);

/* ---------- 5) cancelamento: estende de novo; 3x = desiste ---------- */
await page.evaluate(() => { window.__ev.req.length = 0; __npc.timeScale = 4; __npc.spawnNow(1, 'normal'); });
const cancelOk = await until(() => {
  for (const [o, fn] of [...window.__reg]) fn();
  const r = window.__ev.req[window.__ev.req.length - 1];
  if (r && !r.__answered) { r.__answered = true; __game.bus.emit('checkoutResult', { customerId: r.customerId, ok: false, speed: 0, mistakes: 0 }); }
  const id = window.__ev.req[0]?.customerId;
  const i = id !== undefined ? __npc.customerInfo(id) : null;
  return id !== undefined && (!i || i.state.startsWith('leave') || i.state === 'gone') ? { reqs: window.__ev.req.length } : null;
}, undefined, 90000);
check('3 cancelamentos: cliente desiste e esteira limpa', !!cancelOk && cancelOk.reqs === 3 && (await page.evaluate(() => window.__reg.size)) === 0, JSON.stringify(cancelOk));

/* ---------- 6) funcionário caixa sentado faz tudo sozinho ---------- */
await page.evaluate(() => {
  if (window.__player?.stand) window.__player.stand(); else Object.defineProperty(__game.services.player, 'seatedAt', { get: () => null, set: () => {}, configurable: true });
  window.__ev.done.length = 0; window.__ev.req.length = 0;
  __game.state.employees.cashier = 1; __npc.sync();
  __npc.timeScale = 4;
});
const seatedCashier = await until(() => __npc.lanes()[0]?.staffed && __npc.staff().length > 0, undefined, 20000);
await page.evaluate(() => __npc.spawnNow(1, 'normal'));
const staffDone = await until(() => window.__ev.done.find((d) => d.staff) ?? null, undefined, 90000);
check('funcionário caixa atende sozinho (checkout:done staff, sem checkoutRequest)', !!seatedCashier && !!staffDone && (await page.evaluate(() => window.__ev.req.length)) === 0, JSON.stringify(staffDone));

/* ---------- 7) repositor abre a caixa antes de repor ---------- */
await page.evaluate(() => {
  const s = __game.state;
  s.shelf.feijao = 0;
  s.sidewalk.push({ productId: 'feijao', units: 12, open: false });
  s.employees.stocker = 1; __npc.sync();
  __npc.timeScale = 4;
});
const opened = await until(() => (window.__ev.sfx.includes('boxOpen') && __game.state.shelf.feijao > 0) ? { shelf: __game.state.shelf.feijao, closeOrTrash: window.__ev.sfx.includes('boxClose') || window.__ev.sfx.includes('trash') } : null, undefined, 90000);
if (!opened) console.log('debug', JSON.stringify(await page.evaluate(() => ({ staff: __npc.staff(), side: __game.state.sidewalk, f: __game.state.furniture.map((f) => [f.id, f.type, f.productId]) }))));
check('repositor abre a caixa (sfx boxOpen) e repõe', !!opened, JSON.stringify(opened));

/* ---------- 8) visual: fila de clientes vista de frente (print) ---------- */
await page.evaluate(() => {
  __game.state.employees.cashier = 0; __game.state.employees.stocker = 0; __npc.sync();
  for (const f of __game.state.furniture) if (f.productId) __game.state.shelf[f.productId] = 30;
  window.__player?.stand?.();
  if (window.__player?.stand === undefined) Object.defineProperty(__game.services.player, 'seatedAt', { get: () => null, set: () => {}, configurable: true });
  __npc.timeScale = 3; __npc.spawnNow(6);
});
await until(() => __npc.lanes()[0]?.line >= 3, undefined, 60000);
await page.evaluate(() => {
  __npc.timeScale = 1;
  __game.uiRoot.style.display = 'none';
  const c = __game.services.world.counters()[0];
  const q = c.queue[1] ?? c.queue[0] ?? c.operator;
  window.__player?.teleport?.(q.x + 2.4, q.z + 0.4);
  window.__player?.lookAt?.(q.x, 1.25, q.z);
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/03-queue.png` });
const cap = await page.evaluate(() => ({ cap: __npc.capacity(), api: (() => { try { return __game.state && window.__npc.capacity(); } catch { return null; } })() }));
check('limite de clientes = min(customerCapacity, desempenho)', cap.cap >= 1 && cap.cap <= 18, JSON.stringify(cap));
const perf = await page.evaluate(() => ({ calls: __game.renderer.info.render.calls, geo: __game.renderer.info.memory.geometries, tex: __game.renderer.info.memory.textures, people: __npc.customers().length + __npc.staff().length }));
console.log('perf', JSON.stringify(perf));
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (fails.length) { console.log('FALHAS:', fails.join(', ')); process.exit(1); }
console.log('OK');
