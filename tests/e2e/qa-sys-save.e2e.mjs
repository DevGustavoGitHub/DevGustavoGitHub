// QA de sistemas — save/recarregar em cada situação, autosave e ciclo de vida (segundo plano).
// Para cada situação: foto do estado (dinheiro, unidades por produto em níveis+depósito+calçada, caixas, unidades nas cestas
// dos clientes, móveis por montar) → save (pagehide) → recarregar → nova foto → compara.
// Uso: npx vite build --outDir <dir> && QA_DIST=<dir> node tests/e2e/qa-sys-save.e2e.mjs   (sobe vite preview na porta 5212;
//      QA_URL usa um servidor já aberto)
// Sai com código 1 enquanto houver falhas (cada FAIL corresponde a um item de docs/qa/systems.md).
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
import { spawn } from 'node:child_process';
const PORT = process.env.QA_PORT ?? '5212';
const URL = process.env.QA_URL ?? `http://localhost:${PORT}/`;
let server = null; // sem QA_URL: sobe o próprio `vite preview` (QA_DIST = pasta do build; padrão dist/)
if (!process.env.QA_URL) {
  server = spawn('npx', ['vite', 'preview', '--outDir', process.env.QA_DIST ?? 'dist', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL)).ok) break; } catch { /* aguardando */ } await new Promise((r) => setTimeout(r, 500)); }
}
const SAVE_KEY = 'mercadinho-sim:save:v1';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404|MIME type/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => {
  try {
    if (!localStorage.getItem('mercadinho:settings')) localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: 'low', reduceMotion: true, volume: 0 }));
    localStorage.setItem('mercadinho:tutorial', 'done');
  } catch { /* */ }
  // captura AudioContexts (para conferir suspensão em segundo plano)
  const AC = window.AudioContext;
  if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); (window.__acs ??= []).push(this); } };
  // espião de escrita do save
  const set = Storage.prototype.setItem;
  window.__saves = 0;
  Storage.prototype.setItem = function (k, v) { if (k === 'mercadinho-sim:save:v1') window.__saves++; return set.call(this, k, v); };
  window.__qa = {
    snap() {
      const g = window.__game, s = g.state;
      const units = {};
      const add = (k, n) => { if (n) units[k] = (units[k] ?? 0) + n; };
      for (const f of s.furniture) for (const l of f.levels ?? []) if (l.productId) add(l.productId, l.units);
      for (const [k, n] of Object.entries(s.storage)) add(k, n);
      for (const b of s.sidewalk) add(b.productId, b.units);
      const basis = {};
      for (const [k, v] of Object.entries(s.costBasis)) if (v.units) basis[k] = v.units;
      let cust = 0;
      const custP = {};
      for (const c of window.__npc?.customers?.() ?? []) {
        const i = window.__npc.customerInfo(c.id);
        if (!i) continue;
        cust += i.units;
        for (const it of i.items) custP[it.productId] = (custP[it.productId] ?? 0) + it.qty;
      }
      return {
        day: s.day, money: s.money, loan: s.loan, phase: g.clock.phase, minute: Math.round(g.clock.minute), level: s.level, levelAck: s.levelAck,
        boxes: s.sidewalk.length, carried: s.sidewalk.filter((b) => b.carried).length, held: window.__player?.held?.()?.length ?? window.__player?.held?.()?.boxes ?? null,
        units, total: Object.values(units).reduce((a, b) => a + b, 0), basis, cust, custP, furniture: s.furniture.length, stock: s.furnitureStock.length,
        served: s.ledger.served, revenue: s.ledger.revenue, customers: (window.__npc?.customers?.() ?? []).length,
      };
    },
    /** Abastece os níveis etiquetados como se as unidades tivessem sido compradas (costBasis coerente). */
    stockBought(n) {
      const s = window.__game.state;
      const lv = () => { const o = {}; for (const f of s.furniture) for (const l of f.levels ?? []) if (l.productId) o[l.productId] = (o[l.productId] ?? 0) + l.units; return o; };
      const a = lv();
      window.__npc.stock(n);
      const b = lv();
      for (const [k, v] of Object.entries(b)) { const d = v - (a[k] ?? 0); if (d > 0) { const cb = (s.costBasis[k] ??= { units: 0, avg: 500 }); cb.units += d; } }
    },
    /** Caixa comprada (como economy.buyBoxes, sem cobrar). */
    box(productId, units, extra = {}) {
      const s = window.__game.state;
      const b = { productId, units, open: false, ...extra };
      s.sidewalk.push(b);
      const cb = (s.costBasis[productId] ??= { units: 0, avg: 500 });
      cb.units += units;
      window.__game.bus.emit('stateChanged', { what: 'sidewalk' });
      return b;
    },
  };
});

const fails = [];
const results = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); results.push({ name, ok, extra }); if (!ok) fails.push(name); };
const until = async (fn, arg, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await page.evaluate(fn, arg); if (r) return r; await page.waitForTimeout(250); } return null; };
const boot = async () => { await page.waitForFunction(() => window.__game && window.__ui && window.__npc && window.__player, null, { timeout: 60000 }); await page.waitForTimeout(600); };
const start = async () => {
  await page.evaluate(() => { const b = [...document.querySelectorAll('.title-screen .btn')].find((x) => /Jogar|Continuar/.test(x.textContent)); b?.click(); });
  await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 }).catch(() => {});
};
const snap = () => page.evaluate(() => window.__qa.snap());
const saveNow = () => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const reload = async () => { await page.reload(); await boot(); };
const sameUnits = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const diffUnits = (a, b) => { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = (b[k] ?? 0) - (a[k] ?? 0); if (d) o[k] = d; } return o; };
/** Compara antes/depois: dinheiro, empréstimo, dia, unidades (contando as das cestas), caixas, móveis, custo médio coerente. */
const compare = (tag, A, B, { expectCustUnits = true } = {}) => {
  const want = { ...A.units };
  if (expectCustUnits) for (const [k, n] of Object.entries(A.custP)) want[k] = (want[k] ?? 0) + n;
  check(`[${tag}] dinheiro e empréstimo preservados`, A.money === B.money && A.loan === B.loan, JSON.stringify({ antes: [A.money, A.loan], depois: [B.money, B.loan] }));
  check(`[${tag}] nenhuma unidade some nem duplica (níveis+depósito+calçada${expectCustUnits ? '+cestas' : ''})`, sameUnits(want, B.units), `diferença ${JSON.stringify(diffUnits(want, B.units))} (cestas antes: ${A.cust} un.)`);
  // antes de recarregar, o custo médio ainda conta as unidades das cestas (só sai na venda); depois, nada deveria sobrar
  const held = { ...A.units };
  for (const [k, n] of Object.entries(A.custP)) held[k] = (held[k] ?? 0) + n;
  const driftA = diffUnits(held, A.basis), driftB = diffUnits(B.units, B.basis);
  check(`[${tag}] custo médio não fica incoerente ao recarregar (costBasis.units = unidades possuídas)`, JSON.stringify(Object.entries(driftA).sort()) === JSON.stringify(Object.entries(driftB).sort()), `costBasis − possuídas: antes ${JSON.stringify(driftA)}, depois ${JSON.stringify(driftB)}`);
  check(`[${tag}] caixas e móveis preservados`, A.boxes === B.boxes && A.furniture === B.furniture && A.stock === B.stock, JSON.stringify({ antes: [A.boxes, A.furniture, A.stock], depois: [B.boxes, B.furniture, B.stock] }));
};

await page.goto(URL);
await boot();
await start();

/* ---------- 1) carregando 1 caixa (e outra largada em prévia de posicionamento) ---------- */
await page.evaluate(() => {
  const s = window.__game.state, p = window.__player.pos?.() ?? { x: 6, z: 7 };
  window.__qa.box('feijao', 12, { x: p.x + 0.5, z: p.z, open: true });
  window.__game.bus.emit('stateChanged', { what: 'sidewalk' });
  const b = s.sidewalk[s.sidewalk.length - 1];
  b.carried = true;
  window.__player.svc?.carryingAll?.push?.(b);
});
await page.waitForTimeout(500);
let A = await snap();
await saveNow();
await reload();
let B = await snap();
compare('carregando caixa', A, B);
check('[carregando caixa] caixa carregada volta ao chão (carried=false) e não fica "fantasma"', B.carried === 0, JSON.stringify({ carried: B.carried }));
await start();

/* ---------- 2) loja aberta, clientes com itens na cesta / sentado no caixa com itens na esteira ---------- */
await page.evaluate(() => {
  const g = window.__game, s = g.state;
  s.money = Math.max(s.money, 300000);
  window.__qa.stockBought(40);
  s.employees.cashier = 0; s.employees.stocker = 0; s.employees.janitor = 0;
  window.__npc.sync();
  window.__reg = new Map();
  const real = g.services.pick;
  g.services.pick = { add(o, fn) { window.__reg.set(o, fn); real?.add(o, fn); }, remove(o) { window.__reg.delete(o); real?.remove(o); } };
  window.__req = [];
  g.bus.on('checkoutRequest', (p) => window.__req.push(p));
  const cid = s.furniture.find((f) => f.type === 'counter').id;
  window.__player.sit(cid);
  g.clock.openStore();
  window.__npc.timeScale = 6;
  window.__npc.spawnNow(4, 'normal');
});
const belt = await until(() => { const l = window.__npc.lanes()[0]; const c = window.__qa.snap(); return l && l.belt > 0 && c.cust > 0 ? { belt: l.belt, cust: c.cust } : null; }, undefined, 180000);
check('cenário: clientes com itens (esteira/cesta)', !!belt, JSON.stringify(belt));
await page.evaluate(() => { window.__npc.timeScale = 1; });
A = await snap();
await saveNow();
await reload();
B = await snap();
compare('clientes com itens na cesta / sentado no caixa', A, B);
check('[clientes] relógio do dia preservado ao recarregar (fase/hora)', A.phase === B.phase && Math.abs(A.minute - B.minute) <= 30, JSON.stringify({ antes: [A.phase, A.minute], depois: [B.phase, B.minute] }));
await start();

/* ---------- 3) pagamento aberto (painel de troco/maquininha) ---------- */
await page.evaluate(() => {
  const g = window.__game, s = g.state;
  window.__reg = new Map();
  const real = g.services.pick;
  g.services.pick = { add(o, fn) { window.__reg.set(o, fn); real?.add(o, fn); }, remove(o) { window.__reg.delete(o); real?.remove(o); } };
  window.__req = [];
  g.bus.on('checkoutRequest', (p) => window.__req.push(p));
  window.__player.sit(s.furniture.find((f) => f.type === 'counter').id);
  g.clock.openStore();
  window.__npc.timeScale = 6;
  window.__npc.spawnNow(2, 'normal');
});
let payOpen = null;
for (let i = 0; i < 240 && !payOpen; i++) {
  payOpen = await page.evaluate(() => {
    for (const [o, fn] of [...window.__reg]) if (!o.userData.npcPay) fn();
    for (const [o, fn] of [...window.__reg]) if (o.userData.npcPay) { fn(); break; }
    return window.__req.length && document.querySelector('section.pay') ? window.__req[0] : null;
  });
  if (!payOpen) await page.waitForTimeout(400);
}
check('cenário: painel de pagamento aberto', !!payOpen, '');
await page.evaluate(() => { window.__npc.timeScale = 1; });
A = await snap();
await saveNow();
await reload();
B = await snap();
compare('pagamento aberto', A, B);
await start();

/* ---------- 4) modo de posicionamento: móvel do estoque de montagem e caixa em prévia ---------- */
await page.evaluate(() => {
  const g = window.__game, s = g.state;
  s.furnitureStock.push({ type: 'shelf' });
  g.bus.emit('build:start', { type: 'shelf', stockIndex: s.furnitureStock.length - 1 });
});
const building = await until(() => !!document.querySelector('[data-world-build]') && getComputedStyle(document.querySelector('[data-world-build]')).display !== 'none', undefined, 8000);
check('cenário: modo de posicionamento ativo', !!building);
A = await snap();
await saveNow();
await reload();
B = await snap();
compare('modo de posicionamento (móvel no estoque de montagem)', A, B, { expectCustUnits: false });
await start();
const buildAfter = await page.evaluate(() => { const el = document.querySelector('[data-world-build]'); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; });
check('[posicionamento] após recarregar não fica preso na barra de posicionamento', !buildAfter);

/* ---------- 5) noite (21:00, loja fechando) ---------- */
await page.evaluate(() => { const g = window.__game; g.clock.openStore(); g.clock.minute = 21 * 60 - 0.2; });
await until(() => window.__game.clock.phase === 'closing', undefined, 15000);
await page.waitForTimeout(800);
A = await snap();
await saveNow();
await reload();
B = await snap();
compare('noite', A, B);
check('[noite] após recarregar continua à noite (não recomeça o mesmo dia às 08:00 com o caixa do dia já contado)', B.phase === 'closing' || B.day === A.day + 1, JSON.stringify({ antes: [A.day, A.phase, A.minute, A.served], depois: [B.day, B.phase, B.minute, B.served] }));
await start();

/* ---------- 6) tela de nível (comemoração) ---------- */
const lvl = await page.evaluate(async () => {
  const s = window.__game.state;
  const before = s.level;
  s.xp += 5000; // vários níveis de uma vez
  // mesma regra de economy.addXp
  const xpFor = (n) => (n <= 1 ? 0 : Math.round(60 * Math.pow(n - 1, 2.08) * (1 + 0.05 * Math.max(0, n - 15))));
  while (s.xp >= xpFor(s.level + 1)) s.level++;
  await new Promise((r) => setTimeout(r, 1500));
  return { before, after: s.level, ack: s.levelAck, open: !!document.querySelector('.cele:not(.summary), .celebrate') };
});
check('cenário: comemoração de nível na tela', lvl.after > lvl.before, JSON.stringify(lvl));
A = await snap();
await saveNow();
await reload();
await start();
await page.waitForTimeout(2000);
const celeAgain = await page.evaluate(() => !!document.querySelector('.cele:not(.summary), .celebrate'));
check('[nível] comemoração não vista volta a aparecer depois de recarregar', !lvl.open || celeAgain, JSON.stringify({ abertaAntes: lvl.open, depois: celeAgain }));
await page.evaluate(() => { document.querySelectorAll('.cele .btn, .celebrate .btn').forEach((b) => b.click()); });

/* ---------- 7) empréstimo e falência ---------- */
await page.evaluate(() => { const s = window.__game.state; s.loan += 20000; s.money += 20000; });
A = await snap();
await saveNow();
await reload();
B = await snap();
check('[empréstimo] dívida e dinheiro preservados', A.loan === B.loan && A.money === B.money, JSON.stringify({ A: [A.money, A.loan], B: [B.money, B.loan] }));
await page.evaluate(() => {
  const s = window.__game.state;
  s.money = -900000; s.loan = 0;
  for (const f of s.furniture) for (const l of f.levels ?? []) l.units = 0;
  s.storage = {}; s.sidewalk = []; s.costBasis = {};
  window.__game.bus.emit('stateChanged', { what: 'shelf' });
});
await saveNow();
await reload();
await start();
const bk = await until(() => !!document.querySelector('.bankrupt'), undefined, 8000);
check('[falência] save falido mostra a tela de falência ao continuar', !!bk);
if (bk) {
  await page.evaluate(() => document.querySelector('#bk-restart')?.click());
  await page.waitForTimeout(800);
  const r = await snap();
  check('[falência] recomeço: R$ 300, dívida zerada, layout inicial (balcão, 2 prateleiras, mesa do computador)', r.money === 30000 && r.loan === 0 && r.furniture === 4, JSON.stringify(r));
  await reload();
  const r2 = await snap();
  check('[falência] recomeço persistiu após recarregar', r2.money === r.money && r2.furniture === r.furniture, JSON.stringify({ r: r.money, r2: r2.money }));
  await start();
}

/* ---------- 8) autosave: intervalo, pagehide, visibilitychange (Android em 2º plano) e evento 'pause' do Capacitor ---------- */
const savedMoney = () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)).money; } catch { return null; } }, SAVE_KEY);
await page.evaluate(() => { window.__game.state.money += 7; });
const m0 = await page.evaluate(() => window.__game.state.money);
const t0 = Date.now();
let autosaved = false;
while (Date.now() - t0 < 20000) { if ((await savedMoney()) === m0) { autosaved = true; break; } await page.waitForTimeout(500); }
check('[autosave] intervalo grava em até ~15 s', autosaved, `após ${Math.round((Date.now() - t0) / 1000)} s`);
// visibilitychange → hidden (o que o WebView do Android dispara ao ir para segundo plano; pagehide não dispara)
// liga o som e faz um gesto para o AudioContext existir e rodar (senão a checagem de áudio não prova nada)
await page.evaluate(() => window.__game.bus.emit('settings:changed', { volume: 0.6 }));
await page.mouse.click(420, 120);
await page.waitForTimeout(600);
await page.evaluate(() => { window.__game.state.money += 11; });
const m1 = await page.evaluate(() => window.__game.state.money);
const vis = await page.evaluate(async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  const t = window.__game.clock.minute;
  document.dispatchEvent(new Event('visibilitychange'));
  document.dispatchEvent(new Event('pause')); // evento do Capacitor (Cordova) ao pausar a Activity
  await new Promise((r) => setTimeout(r, 400));
  return { acs: (window.__acs ?? []).map((a) => a.state), clock: window.__game.clock.minute - t };
});
check('[2º plano] save imediato ao ir para segundo plano (visibilitychange hidden / pause do Capacitor)', (await savedMoney()) === m1, `save gravado tem ${await savedMoney()}, estado ${m1}`);
check('[2º plano] áudio suspenso (AudioContext criado e não "running")', vis.acs.length > 0 && vis.acs.every((s) => s !== 'running'), JSON.stringify(vis.acs));
const back = await page.evaluate(async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  document.dispatchEvent(new Event('resume'));
  await new Promise((r) => setTimeout(r, 600));
  return (window.__acs ?? []).map((a) => a.state);
});
check('[2º plano] áudio volta ao retornar', back.some((s) => s === 'running'), JSON.stringify(back));
// pagehide salva
await page.evaluate(() => { window.__game.state.money += 13; });
const m2 = await page.evaluate(() => window.__game.state.money);
await saveNow();
check('[autosave] pagehide grava', (await savedMoney()) === m2);

const errsNormal = errors.slice();
/* ---------- 9) saves corrompidos e de versões antigas no navegador ---------- */
// 9a) JSON ilegível: o jogo começa do zero sem aviso e o autosave sobrescreve o save antigo
await page.evaluate((k) => { const raw = localStorage.getItem(k); window.__game.save = () => {}; localStorage.setItem(k, raw.slice(0, -2)); localStorage.setItem('qa:bad', raw.slice(0, -2)); }, SAVE_KEY);
await reload();
const corrupt = await page.evaluate((k) => ({ day: window.__game.state.day, title: [...document.querySelectorAll('.title-screen .btn')].map((b) => b.textContent.trim()), keys: Object.keys(localStorage), sameRaw: localStorage.getItem(k) === localStorage.getItem('qa:bad') }), SAVE_KEY);
await saveNow();
const kept = await page.evaluate(() => Object.keys(localStorage).some((k) => k !== 'qa:bad' && localStorage.getItem(k) === localStorage.getItem('qa:bad')));
check('[corrompido] save ilegível: jogador é avisado e o save antigo é preservado (backup) antes de sobrescrever', kept, JSON.stringify(corrupt));
// 9b) save válido com produto/móvel desconhecidos (ex.: catálogo mudou numa atualização)
const errs0 = errors.length;
await page.evaluate((k) => {
  const s = JSON.parse(JSON.stringify(window.__game.state));
  s.sidewalk.push({ productId: 'produto-removido', units: 3, open: false });
  s.furniture.push({ id: 99, type: 'balcao-antigo', x: 7, z: 2, rot: 0 });
  s.nextFurnitureId = 100;
  window.__game.save = () => {};
  localStorage.setItem(k, JSON.stringify(s));
}, SAVE_KEY);
await page.reload();
const booted = await page.waitForFunction(() => window.__game && window.__ui && window.__npc && window.__player, null, { timeout: 30000 }).then(() => true).catch(() => false);
await page.waitForTimeout(1500);
check('[corrompido] save com produto/móvel desconhecido ainda abre o jogo (sem erro de inicialização)', booted && errors.length === errs0, errors.slice(errs0, errs0 + 3).join(' | '));

// 9c) save da Fase 3 (sem levels/furnitureStock/Box.open; Furniture.productId + estoque somado)
await page.evaluate(() => localStorage.clear());
await page.addInitScript(() => { try { localStorage.setItem('mercadinho:tutorial', 'done'); } catch { /* */ } });
await reload();
await page.evaluate((k) => {
  const g = window.__game, s = g.state;
  s.money = 98765; s.storageUnlocked = true; s.storage = { feijao: 30 }; s.loan = 5000;
  window.__qa.stockBought(30);
  window.__qa.box('macarrao', 20, { open: true });
  const raw = JSON.parse(JSON.stringify(s));
  const shelf = {};
  for (const f of raw.furniture) {
    const main = (f.levels ?? []).find((l) => l.productId)?.productId;
    for (const l of f.levels ?? []) if (l.productId) shelf[l.productId] = (shelf[l.productId] ?? 0) + l.units;
    delete f.levels;
    if (main) f.productId = main;
  }
  raw.shelf = shelf;
  for (const b of raw.sidewalk) delete b.open;
  delete raw.furnitureStock; delete raw.ledger.happy; delete raw.ledger.angry;
  window.__phase3 = window.__qa.snap();
  g.save = () => {};
  localStorage.setItem(k, JSON.stringify(raw));
  sessionStorage.setItem('qa:p3', JSON.stringify(window.__phase3));
}, SAVE_KEY);
const errs1 = errors.length;
await reload();
const p3 = await page.evaluate(() => ({ before: JSON.parse(sessionStorage.getItem('qa:p3')), after: window.__qa.snap() }));
check('[migração Fase 3] carrega sem erro', errors.length === errs1, errors.slice(errs1, errs1 + 3).join(' | '));
check('[migração Fase 3] dinheiro, dívida e unidades preservados', p3.before.money === p3.after.money && p3.before.loan === p3.after.loan && sameUnits(p3.before.units, p3.after.units), JSON.stringify({ dif: diffUnits(p3.before.units, p3.after.units), m: [p3.before.money, p3.after.money] }));

await browser.close();
check('sem erros de console nas situações normais (1–8)', errsNormal.length === 0, errsNormal.slice(0, 4).join(' | '));
server?.kill();
console.log(fails.length ? `FALHAS (${fails.length}): ${fails.join(' ; ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
