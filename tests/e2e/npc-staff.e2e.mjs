// E2E de funcionários (caixa, repositor, faxineiro). Uso: (npx vite --port 5175 &) && node tests/e2e/npc-staff.e2e.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const OUT = process.env.NPC_SHOTS ?? '/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/npc';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); if (m.text().includes('[npc]')) console.log('WARN', m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(process.env.NPC_URL ?? 'http://localhost:5175/');
await page.waitForFunction(() => window.__game && window.__npc, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByText('Jogar', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(800);
const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, x); if (!ok) fails.push(n); };

await page.evaluate(() => {
  const s = __game.state;
  __npc.stock(3); // Fase 4: níveis (state.shelf é derivado)
  s.sidewalk.push({ productId: 'macarrao', units: 20 }, { productId: 'feijao', units: 12 });
  s.dirt.push({ x: 3.5, z: 6.5 }, { x: 9.5, z: 8.5 });
  s.employees.cashier = 1; s.employees.stocker = 1; s.employees.janitor = 1;
  window.__before = { shelf: s.shelf.macarrao + s.shelf.feijao, boxes: s.sidewalk.length, dirt: s.dirt.length, money: s.money };
  __game.uiRoot.style.display = 'none';
  __npc.sync();
  __game.clock.paused = false; __game.clock.openStore(); __npc.timeScale = 4;
  setInterval(() => { __game.clock.paused = false; }, 100);
  __game.camera.position.set(6, 12, 15); __game.camera.lookAt(6, 0, 6);
});
await page.waitForTimeout(1500);
console.log('staff', JSON.stringify(await page.evaluate(() => __npc.staff())));
let maxShelf = 0;
for (let i = 0; i < 90; i++) {
  const st = await page.evaluate(() => { if (__game.clock.minute < 1100) __game.clock.minute += 6; const s = __game.state; return { boxes: s.sidewalk.length, dirt: s.dirt.length, shelf: s.shelf.macarrao + s.shelf.feijao, sold: __npc.stats.sold, staff: __npc.staff().map((x) => x.role + ':' + x.job).join(','), money: s.money }; });
  maxShelf = Math.max(maxShelf, st.shelf);
  if (i % 5 === 0) console.log('t', i, JSON.stringify(st));
  if (i === 8) await page.screenshot({ path: `${OUT}/04-staff.png` });
  if (st.boxes === 0 && st.dirt === 0 && st.sold >= 3) break;
  await page.waitForTimeout(1000);
}
const r = await page.evaluate(() => ({ b: __before, s: { boxes: __game.state.sidewalk.length, dirt: __game.state.dirt.length, shelf: __game.state.shelf.macarrao + __game.state.shelf.feijao }, sold: __npc.stats.sold, staff: __npc.staff() }));
console.log(JSON.stringify(r));
check('repositor esvaziou as caixas', r.s.boxes === 0, `${r.b.boxes} -> ${r.s.boxes}`);
check('prateleira reabastecida (pico observado)', maxShelf > r.b.shelf, `${r.b.shelf} -> pico ${maxShelf}`);
check('faxineiro limpou a sujeira', r.s.dirt === 0, `${r.b.dirt} -> ${r.s.dirt}`);
check('caixa automático vendeu', r.sold >= 1, String(r.sold));
check('3 funcionários ativos', r.staff.length === 3);
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (fails.length) { console.log('FALHAS:', fails.join(', ')); process.exit(1); }
console.log('OK');
