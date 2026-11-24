// QA de jogabilidade — BUG: é possível montar uma prateleira nos tiles do operador, atrás do balcão (onde fica a
// cadeira). `canPlace` só protege a antessala da porta e a alcançabilidade; a cadeira some e, ao sentar (mirando o
// balcão), a câmera fica DENTRO da prateleira. Esperado: prévia vermelha nesse lugar (tile do operador reservado).
// Uso: npx vite build && (npx vite preview --port 5211 &) && node tests/e2e/qa-play-operator-tile.mjs  (QA_URL configurável)
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
await page.waitForFunction(() => window.__game && window.__player && window.__world && window.__ui, null, { timeout: 40000 });
await page.waitForTimeout(600);
for (let i = 0; i < 6 && (await page.locator('.title-screen').isVisible().catch(() => false)); i++) {
  await page.evaluate(() => [...document.querySelectorAll('.title-screen button')].find((b) => /Jogar|Continuar/.test(b.textContent))?.click());
  await page.waitForTimeout(700);
}
// prateleira no estoque de montagem e modo de posicionamento (mesmo caminho da compra no Mercado)
const op = await page.evaluate(() => {
  __game.clock.paused = true;
  __game.state.furnitureStock = [{ type: 'shelf' }];
  __game.bus.emit('build:start', { type: 'shelf', stockIndex: 0 });
  return __game.services.world.counters()[0].operator;
});
await page.waitForTimeout(500);
await page.evaluate(([x, z]) => { __player.teleport(x, z - 2.6); __player.lookAt(x - 0.5, 0, z - 0.2); }, [op.x, op.z]);
await page.waitForTimeout(1200);
const pose = await page.evaluate(() => __world.build?.pose ?? null);
const opInside = (p) => !!p && op.x > p.x && op.x < p.x + (p.rot === 90 || p.rot === 270 ? 1 : 2) && op.z > p.z && op.z < p.z + (p.rot === 90 || p.rot === 270 ? 2 : 1);
check('prévia sobre o tile do operador (cadeira do caixa) fica inválida', !(pose?.valid && opInside(pose)), JSON.stringify({ pose, op }));
await page.evaluate(() => [...document.querySelectorAll('[data-world-build] button')].find((b) => b.getAttribute('aria-label') === 'Colocar')?.click());
await page.waitForTimeout(800);
const r = await page.evaluate(([ox, oz]) => {
  const blocked = __game.state.furniture.some((f) => f.type !== 'counter' && (() => { const sw = f.rot === 90 || f.rot === 270; const W = sw ? 1 : (f.type === 'shelf' ? 2 : 1), D = sw ? (f.type === 'shelf' ? 2 : 1) : 1; return ox > f.x && ox < f.x + W && oz > f.z && oz < f.z + D; })());
  let chairs = null; try { chairs = __world.chairs(); } catch { /* */ }
  return { blocked, chairs };
}, [op.x, op.z]);
check('depois de COLOCAR, o tile do operador continua livre e a cadeira existe', !r.blocked && Array.isArray(r.chairs) && r.chairs.length > 0, JSON.stringify(r));
await browser.close();
console.log(fails.length ? `FALHAS (${fails.length})` : 'OK');
process.exit(fails.length ? 1 : 0);
