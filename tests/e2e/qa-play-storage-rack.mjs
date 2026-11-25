// QA de jogabilidade (pós-teste 3) — depósito pela estante:
// caixas FECHADAS e organizadas por produto (incompleta na frente da 1ª coluna, cheias atrás; produtos lado a lado);
// mirar a caixa de um produto = "Retirar <produto>" (vem a da frente, incompleta primeiro); com caixa do mesmo produto
// na mão = "Completar" (se couber tudo, a caixa da mão fica vazia na mão; senão entra inteira).
// Uso: QA_URL=http://localhost:5175/ node tests/e2e/qa-play-storage-rack.mjs
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.QA_URL ?? 'http://localhost:5173/';
const OUT = process.env.QA_SHOTS ?? '/tmp';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fails = []; const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); if (!ok) fails.push(n); };
const until = async (fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg)) return true; await p.waitForTimeout(150); } return false; };

await p.goto(URL);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('mercadinho:tutorial', 'done'); });
await p.reload();
await p.waitForFunction(() => window.__game && window.__player && window.__world, null, { timeout: 30000 });
await p.waitForTimeout(800);
await p.evaluate(() => [...document.querySelectorAll('.title-screen button')].find((x) => /Jogar|Continuar/.test(x.textContent))?.click());
await p.waitForTimeout(800);
await p.evaluate(() => {
  const s = __game.state; __game.clock.paused = true;
  s.level = 10; s.levelAck = 10; s.money = 1_000_000; s.storageUnlocked = true;
  s.furniture.push({ id: s.nextFurnitureId++, type: 'rack', x: 1, z: -5, rot: 0 });
  s.storage = { feijao: 17, arroz: 6, cafe: 25 }; // feijão 12+5, arroz 6, café 10+10+5
  __game.bus.emit('stateChanged', { what: 'furniture' }); __game.bus.emit('stateChanged', { what: 'storage' });
});
await p.waitForTimeout(800);
const rb = await p.evaluate(() => __world.rackBoxes());
const by = (pid) => rb.filter((x) => x.pid === pid);
check('estante: 6 caixas (feijão 2, arroz 1, café 3), todas fechadas', rb.length === 6 && by('feijao').length === 2 && by('arroz').length === 1 && by('cafe').length === 3 && (await p.evaluate(() => __world.boxCounts().rack)) === 6, JSON.stringify(rb.map((x) => x.pid)));
const fe = by('feijao');
check('mesmo produto: uma atrás da outra (mesma coluna)', Math.abs(fe[0].x - fe[1].x) < 0.05 && Math.abs(fe[0].y - fe[1].y) < 0.05 && Math.abs(fe[0].z - fe[1].z) > 0.3 && fe[0].z > fe[1].z, JSON.stringify(fe));
check('produtos diferentes lado a lado', Math.abs(by('arroz')[0].x - fe[0].x) > 0.3, JSON.stringify({ arroz: by('arroz')[0], fe: fe[0] }));

const aim = async (box) => {
  await p.evaluate((bx) => { __player.teleport(bx.x, bx.z + 1.35); __player.lookAt(bx.x, bx.y + 0.16, bx.z + 0.17); }, box);
  await p.waitForTimeout(500);
  return p.evaluate(() => ({ t: __player.target(), a: __player.actions() }));
};
let a = await aim(fe[0]);
check('mirar a caixa do feijão: "Retirar Feijão"', a.t?.kind === 'rackBox' && a.a.primary?.label === 'Retirar Feijão', JSON.stringify(a));
await p.screenshot({ path: `${OUT}/rack-feijao.png` });
await p.evaluate(() => __player.press());
await p.waitForTimeout(300);
let st = await p.evaluate(() => ({ s: __game.state.storage.feijao, hand: __player.svc.carryingAll.map((x) => [x.productId, x.units, !!x.open]) }));
check('retira a incompleta (5) fechada e o depósito fica com 12', st.s === 12 && st.hand.length === 1 && st.hand[0][0] === 'feijao' && st.hand[0][1] === 5 && !st.hand[0][2], JSON.stringify(st));

const rb2 = await p.evaluate(() => __world.rackBoxes());
a = await aim(rb2.find((x) => x.pid === 'feijao'));
check('com feijão na mão, mirar o feijão: "Completar"', a.a.primary?.label === 'Completar', JSON.stringify(a));
await p.evaluate(() => __player.press());
await p.waitForTimeout(300);
st = await p.evaluate(() => ({ s: __game.state.storage.feijao, hand: __player.svc.carryingAll.length }));
check('sem incompleta: a caixa entra inteira (17) e sai da mão', st.s === 17 && st.hand === 0, JSON.stringify(st));

await p.evaluate(() => { const bx = { productId: 'feijao', units: 7, carried: true, open: true }; __game.state.sidewalk.push(bx); __player.svc.carryingAll.push(bx); __game.bus.emit('stateChanged', { what: 'sidewalk' }); });
await p.waitForTimeout(200);
const rb3 = await p.evaluate(() => __world.rackBoxes());
a = await aim(rb3.find((x) => x.pid === 'feijao'));
await p.evaluate(() => __player.press());
await p.waitForTimeout(300);
st = await p.evaluate(() => ({ s: __game.state.storage.feijao, hand: __player.svc.carryingAll.map((x) => [x.productId, x.units]) }));
check('completar: 7 un. fecham a incompleta (24) e a caixa da mão fica vazia na mão', st.s === 24 && st.hand.length === 1 && st.hand[0][1] === 0, JSON.stringify(st));
const rb4 = await p.evaluate(() => __world.rackBoxes());
a = await aim(rb4.find((x) => x.pid === 'cafe'));
check('com caixa vazia na mão, mirar caixa do depósito: "Caixa vazia"', a.a.primary?.label === 'Caixa vazia' && a.a.primary?.enabled === false, JSON.stringify(a));
// visão geral
await p.evaluate(() => { __player.teleport(2.2, -2.6); __player.lookAt(2, 0.7, -4.6); });
await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/rack-overview.png` });
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(fails.length ? `FALHAS: ${fails.join(', ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
