// QA de jogabilidade (pós-teste 3):
// 1) faxineiro ocioso espera ao lado da porta, no lado OPOSTO à placa ABERTO/FECHADO (placa em +x → faxineiro em −x);
// 2) com 2 balcões (um com caixa contratado), cliente prefere o balcão ATENDIDO; quando o jogador sai do outro balcão,
//    quem está só esperando na fila dele muda para o balcão do funcionário (não fica parado até desistir);
// 3) à noite, "Terminar o dia" fica dentro do aviso da noite (não cobre "SAIR DO CAIXA" nem a coluna de ações).
// Uso: QA_URL=http://localhost:5175/ node tests/e2e/qa-play-staff-lanes.mjs
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.QA_URL ?? 'http://localhost:5173/';
const OUT = process.env.QA_SHOTS ?? '/tmp';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fails = []; const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); if (!ok) fails.push(n); };
const until = async (fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg)) return true; await p.waitForTimeout(250); } return false; };

await p.goto(URL);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('mercadinho:tutorial', 'done'); });
await p.reload();
await p.waitForFunction(() => window.__game && window.__player && window.__npc && window.__world, null, { timeout: 30000 });
await p.waitForTimeout(800);
await p.evaluate(() => [...document.querySelectorAll('.title-screen button')].find((x) => /Jogar|Continuar/.test(x.textContent))?.click());
await p.waitForTimeout(800);

// loja: nível 10, 2º balcão em (2,6), 1 caixa e 1 faxineiro contratados, prateleiras cheias
const setup = await p.evaluate(() => {
  const s = __game.state;
  s.level = 10; s.levelAck = 10; s.money = 5_000_000;
  s.furniture.push({ id: s.nextFurnitureId++, type: 'counter', x: 2, z: 6, rot: 0 });
  s.employees.cashier = 1; s.employees.janitor = 1;
  __npc.stock(12);
  __game.bus.emit('stateChanged', { what: 'furniture' }); __game.bus.emit('stateChanged', { what: 'employees' });
  __npc.sync();
  const counters = s.furniture.filter((f) => f.type === 'counter').map((f) => f.id);
  return { counters, door: __game.services.world.door(), sign: __game.services.world.poi('sign') };
});
await p.waitForTimeout(1500);

// 1) faxineiro na porta, lado oposto à placa
const okJan = await until(() => { const j = __npc.staff().find((x) => x.role === 'janitor'); return !!j && j.job === 'idle' && Math.abs(j.x - (__game.services.world.door().x - 1.6)) < 0.9; }, null, 25000);
const jan = await p.evaluate(() => __npc.staff().find((x) => x.role === 'janitor'));
const d = setup.door;
check('faxineiro ocioso ao lado da porta, oposto à placa', okJan && jan.x < d.x - 1 && Math.sign(jan.x - d.x) !== Math.sign(setup.sign.x - d.x) && jan.z > d.z - 1.6, JSON.stringify({ jan, door: d, signX: setup.sign.x }));

// 2) filas: jogador "sentado" controlável por variável de teste
await p.evaluate(() => {
  window.__seat = null;
  const pl = __game.services.player;
  Object.defineProperty(pl, 'seatedAt', { get: () => window.__seat, set: () => {}, configurable: true });
  Object.defineProperty(pl, 'atCounter', { get: () => window.__seat, set: () => {}, configurable: true });
  __game.clock.paused = false; __game.clock.openStore();
  setInterval(() => { __game.clock.paused = false; }, 100);
  __npc.timeScale = 6;
});
const lanesOf = () => p.evaluate(() => __npc.lanes().map((l) => ({ id: l.id, line: l.line, staffed: l.staffed })));
const staffedOk = await until(() => __npc.lanes().some((l) => l.staffed), null, 15000);
const L0 = await lanesOf();
const staffedId = L0.find((l) => l.staffed)?.id, playerId = L0.find((l) => !l.staffed)?.id;
check('2 balcões: um do funcionário e um do jogador', staffedOk && staffedId != null && playerId != null, JSON.stringify(L0));

// jogador ausente: ninguém entra na fila do balcão vazio enquanto o do funcionário tem lugar
let maxIdle = 0, sawStaffed = 0;
for (let i = 0; i < 24; i++) {
  await p.evaluate(() => { __npc.spawnNow?.(); });
  await p.waitForTimeout(700);
  const L = await lanesOf();
  const st = L.find((l) => l.id === staffedId), pl = L.find((l) => l.id === playerId);
  if (st.line < 4) maxIdle = Math.max(maxIdle, pl.line);
  sawStaffed = Math.max(sawStaffed, st.line);
}
check('sem atendente no balcão do jogador, clientes vão ao do funcionário', sawStaffed >= 1 && maxIdle === 0, JSON.stringify({ sawStaffed, maxIdle }));

// jogador senta no balcão dele: fila se forma lá; ao sair, quem só espera muda para o do funcionário
await p.evaluate((id) => { window.__seat = id; }, playerId);
let formed = false;
for (let i = 0; i < 30 && !formed; i++) {
  await p.evaluate(() => { __npc.spawnNow?.(); });
  await p.waitForTimeout(700);
  const L = await lanesOf();
  formed = (L.find((l) => l.id === playerId)?.line ?? 0) >= 2;
}
const before = await lanesOf();
await p.evaluate(() => { window.__seat = null; });
await p.waitForTimeout(3500);
const after = await lanesOf();
const pb = before.find((l) => l.id === playerId).line, pa = after.find((l) => l.id === playerId).line;
const sb = before.find((l) => l.id === staffedId).line, sa = after.find((l) => l.id === staffedId).line;
check('jogador saiu: quem esperava no balcão dele muda para o do funcionário (se lá couber)', formed && (pa < pb || sa >= 6), JSON.stringify({ formed, before, after }));

// 3) noite: botão dentro do aviso, sem cobrir a coluna de ações (SAIR DO CAIXA / arremessar)
await p.evaluate(() => { __npc.timeScale = 1; const c = __game.clock; c.minute = 21 * 60; c.closeStore(); });
await p.waitForSelector('#end-day', { timeout: 15000 });
await p.waitForTimeout(400);
const night = await p.evaluate(() => {
  const r = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; };
  return { card: r(document.querySelector('.mcard.night')), btn: r(document.querySelector('#end-day')), vh: innerHeight, vw: innerWidth };
});
const inCard = night.card && night.btn && night.btn.y >= night.card.y - 1 && night.btn.y + night.btn.h <= night.card.y + night.card.h + 1;
check('noite: "Terminar o dia" dentro do aviso (parte de cima da tela)', !!inCard && night.btn.y + night.btn.h <= night.vh * 0.45 && night.btn.h >= 44, JSON.stringify(night));
await p.screenshot({ path: `${OUT}/night-card.png` });
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(fails.length ? `FALHAS: ${fails.join(', ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
