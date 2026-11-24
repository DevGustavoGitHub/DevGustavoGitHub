// QA de jogabilidade — BUG: toque curto no botão de ação "Preço" (prateleira do macarrão) abre o tablet em Preços e o
// clique sintético do mesmo toque cai no botão "+0,50" do Café: o preço do Café muda sem o jogador perceber.
// O botão do player age no pointerdown e abre o tablet embaixo do dedo; o `click` do touchend acerta o tablet.
// Uso: npx vite build && (npx vite preview --port 5211 &) && node tests/e2e/qa-play-ghost-click.mjs  (QA_URL configurável)
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
await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__player && window.__ui, null, { timeout: 40000 });
await page.waitForTimeout(600);
const cdp = await context.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1, radiusX: 3, radiusY: 3, force: 1 })) });
const tap = async (x, y) => { await touch('touchStart', [{ x, y }]); await page.waitForTimeout(80); await touch('touchEnd', []); await page.waitForTimeout(100); };
for (let i = 0; i < 6 && (await page.locator('.title-screen').isVisible().catch(() => false)); i++) {
  const b = await page.locator('.title-screen button:visible', { hasText: /Jogar|Continuar/ }).first().boundingBox().catch(() => null);
  if (b) await tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(700);
}
await page.evaluate(() => {
  __game.clock.paused = true;
  window.__clicks = [];
  document.addEventListener('click', (e) => { const t = e.target.closest('button'); if (t && t.closest('.t3')) window.__clicks.push((t.textContent || '').trim().slice(0, 16) + '|' + (t.closest('[data-product]')?.dataset.product ?? '')); }, true);
});
// prateleira do macarrão (id 3, layout inicial), níveis 0 e 2
const f = await page.evaluate(() => __game.state.furniture.find((x) => x.type === 'shelf' && x.levels?.some((l) => l.productId === 'macarrao')));
for (const lvl of [0, 2]) {
  await page.evaluate(() => { __game.state.prices = {}; window.__clicks.length = 0; });
  await page.evaluate(([x, z]) => __player.teleport(x, z), [f.x + 1, f.z + 0.5 + 1.6]);
  await page.evaluate(([id, l]) => __player.aimLevel(id, l), [f.id, lvl]);
  await page.waitForFunction(() => __player.actions().primary?.label === 'Preço', null, { timeout: 4000 }).catch(() => {});
  const b = await page.locator('.pl-act-btn').first().boundingBox();
  await tap(b.x + b.width / 2, b.y + b.height / 2); // toque curto e real no "Preço"
  await page.waitForFunction(() => !!document.querySelector('.t3'), null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ prices: { ...__game.state.prices }, clicks: window.__clicks.slice(), tab: document.querySelector('.t3-head h2')?.textContent }));
  check(`toque em "Preço" (macarrão, nível ${lvl}) não altera nenhum preço nem toca botões do tablet`, Object.keys(r.prices).length === 0 && r.clicks.length === 0, JSON.stringify(r));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.t3'), null, { timeout: 4000 }).catch(() => {});
}
await browser.close();
console.log(fails.length ? `FALHAS (${fails.length})` : 'OK');
process.exit(fails.length ? 1 : 0);
