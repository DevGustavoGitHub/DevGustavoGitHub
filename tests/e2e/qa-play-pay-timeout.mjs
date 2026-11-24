// QA de jogabilidade — BUG: painel de pagamento (troco/maquininha) aberto por mais de ~90 s de jogo. O npc
// (src/npc/checkout.ts, fase 'paying': pendingT > 90) faz o cliente estender o dinheiro/cartão de novo SEM avisar a UI;
// o painel continua aberto e, quando o jogador confirma o valor certo, `onResult` ignora (phase !== 'paying'):
// nada de venda, dinheiro nem checkout:done — mas o painel fecha como se tivesse dado certo (e a missão conta a venda).
// O npc roda com __npc.timeScale = 8 só enquanto o painel está aberto (equivale a ~110 s).
// Uso: npx vite build && (npx vite preview --port 5211 &) && node tests/e2e/qa-play-pay-timeout.mjs  (QA_URL configurável)
// Sai com código 1 enquanto o bug existir.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.QA_URL ?? 'http://localhost:5211/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
await context.addInitScript(() => { try { localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
const page = await context.newPage();
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };
const until = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);
await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__player && window.__npc && window.__ui, null, { timeout: 40000 });
await page.waitForTimeout(600);
for (let i = 0; i < 6 && (await page.locator('.title-screen').isVisible().catch(() => false)); i++) {
  await page.evaluate(() => [...document.querySelectorAll('.title-screen button')].find((b) => /Jogar|Continuar/.test(b.textContent))?.click());
  await page.waitForTimeout(700);
}
await page.evaluate(() => {
  window.__ev = { req: [], done: [] };
  __game.bus.on('checkoutRequest', (p) => window.__ev.req.push(p));
  __game.bus.on('checkout:done', (p) => window.__ev.done.push(p));
  const real = __game.services.pick; window.__reg = new Map();
  __game.services.pick = { add(o, fn) { window.__reg.set(o, fn); real?.add(o, fn); }, remove(o) { window.__reg.delete(o); real?.remove(o); } };
  __npc.stock(20); __game.state.employees.cashier = 0; __npc.sync();
  __game.clock.openStore(); __player.sit();
  __npc.timeScale = 6; __npc.spawnNow(1, 'normal');
});
// bipa tudo e toca no pagamento (funções registradas no PickService, como o npc-seated.e2e)
const opened = await until(() => {
  for (const [o, fn] of [...window.__reg]) { if (o.userData.npcPay) { __npc.timeScale = 1; fn(); return true; } fn(); }
  return !!document.querySelector('.pay');
}, null, 150000) && await until(() => !!document.querySelector('.pay'), null, 6000);
check('painel de pagamento abriu', opened);
const req = await page.evaluate(() => window.__ev.req[window.__ev.req.length - 1]);
const money0 = await page.evaluate(() => __game.state.money);
// o painel fica aberto ~110 s de npc
await page.evaluate(() => { __npc.timeScale = 8; });
await page.waitForTimeout(14000);
await page.evaluate(() => { __npc.timeScale = 1; });
const mid = await page.evaluate(() => ({ panel: !!document.querySelector('.pay'), lane: __npc.lanes()[0] }));
check('com o painel aberto o cliente NÃO volta a estender o pagamento', !(mid.panel && mid.lane?.phase === 'pay' && mid.lane?.shown), JSON.stringify({ panel: mid.panel, phase: mid.lane?.phase, shown: mid.lane?.shown }));
// confirma o valor certo no painel
if (req?.method === 'card') {
  const s = (req.total / 100).toFixed(2).replace('.', ',').replace(/,?0+$/, '');
  for (const ch of s) await page.locator(`.pay-pad [data-key="${ch}"]`).click();
} else if (req) {
  let rest = req.paid - req.total;
  for (const d of [5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5]) while (rest >= d) { rest -= d; await page.locator(`.pay-den[data-den="${d}"]`).click(); }
}
await page.locator('#pay-ok').click();
await until(() => !document.querySelector('.pay'), null, 4000);
await page.waitForTimeout(1500);
const end = await page.evaluate(() => ({ done: window.__ev.done.length, money: __game.state.money, lane: __npc.lanes()[0] }));
check('confirmar o valor certo conclui a venda (checkout:done + dinheiro)', end.done === 1 && end.money > money0, JSON.stringify({ done: end.done, money0, money: end.money, phase: end.lane?.phase, shown: end.lane?.shown }));
await browser.close();
console.log(fails.length ? `FALHAS (${fails.length})` : 'OK');
process.exit(fails.length ? 1 : 0);
