// QA de jogabilidade — BUG: recarregar a página (ou o Android matar o app) com a loja aberta apaga as unidades que os
// clientes já pegaram das prateleiras (cesta/esteira): o save do `pagehide` grava os níveis sem elas e os clientes não
// são salvos. Em "Terminar o dia" com clientes dentro as unidades voltam (returnToShelf); no recarregar, não.
// Uso: npx vite build && (npx vite preview --port 5211 &) && node tests/e2e/qa-play-reload-stock.mjs  (QA_URL configurável)
// Sai com código 1 enquanto o bug existir.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.QA_URL ?? 'http://localhost:5211/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
await context.addInitScript(() => { try { if (!localStorage.getItem('mercadinho:settings')) localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
const page = await context.newPage();
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };
const start = async () => {
  await page.waitForFunction(() => window.__game && window.__player && window.__npc && window.__ui, null, { timeout: 40000 });
  await page.waitForTimeout(600);
  for (let i = 0; i < 6 && (await page.locator('.title-screen').isVisible().catch(() => false)); i++) {
    await page.evaluate(() => [...document.querySelectorAll('.title-screen button')].find((b) => /Jogar|Continuar/.test(b.textContent))?.click());
    await page.waitForTimeout(700);
  }
};
const units = () => page.evaluate(() => ({
  levels: __game.state.furniture.reduce((a, f) => a + (f.levels ?? []).reduce((b, l) => b + l.units, 0), 0),
  baskets: __npc.customers().reduce((a, c) => a + (__npc.customerInfo(c.id)?.units ?? 0), 0),
  storage: Object.values(__game.state.storage).reduce((a, b) => a + b, 0),
  boxes: __game.state.sidewalk.reduce((a, b) => a + b.units, 0),
  served: __game.state.ledger.served,
}));
await page.goto(URL);
await start();
await page.evaluate(() => { __npc.stock(20); __game.state.employees.cashier = 0; __npc.sync(); __game.clock.openStore(); __npc.timeScale = 6; __npc.spawnNow(3, 'normal'); });
const got = await page.waitForFunction(() => __npc.customers().reduce((a, c) => a + (__npc.customerInfo(c.id)?.units ?? 0), 0) >= 2, null, { timeout: 120000, polling: 100 }).then(() => true, () => false);
await page.evaluate(() => { __npc.timeScale = 1; __game.clock.paused = true; });
const before = await units();
check('clientes pegaram produtos (preparação)', got && before.baskets > 0, JSON.stringify(before));
await page.reload(); // pagehide → save
await start();
const after = await units();
const total = (u) => u.levels + u.baskets + u.storage + u.boxes;
check('recarregar não some com as unidades das cestas (voltam às prateleiras/depósito)', total(after) === total(before) || after.served > before.served, JSON.stringify({ before, after }));
await browser.close();
console.log(fails.length ? `FALHAS (${fails.length})` : 'OK');
process.exit(fails.length ? 1 : 0);
