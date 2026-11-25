// QA de jogabilidade — BUG (legibilidade): ao repor, o selo do nível do player ("Macarrão 500g 2/16 · caixa: 18")
// aparece por cima do cartão de missão da UI (canto superior direito), cobrindo o ícone e o começo do texto
// (844×390 e 740×360). Esperado: nenhum texto do jogo sobreposto.
// Uso: npx vite build && (npx vite preview --port 5211 &) && node tests/e2e/qa-play-badge-overlap.mjs  (QA_URL configurável)
// Sai com código 1 enquanto o bug existir.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.QA_URL ?? 'http://localhost:5211/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };
for (const [w, h] of [[844, 390], [740, 360]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  await context.addInitScript(() => { try { localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && window.__player && window.__ui, null, { timeout: 40000 });
  await page.waitForTimeout(600);
  for (let i = 0; i < 6 && (await page.locator('.title-screen').isVisible().catch(() => false)); i++) {
    await page.evaluate(() => [...document.querySelectorAll('.title-screen button')].find((b) => /Jogar|Continuar/.test(b.textContent))?.click());
    await page.waitForTimeout(700);
  }
  const f = await page.evaluate(() => {
    __game.clock.paused = true;
    window.__npc.stock(0, 'macarrao'); // prateleiras iniciais sem etiqueta: etiqueta os níveis vazios (0 un.)
    const b = { productId: 'macarrao', units: 20, carried: true, open: true };
    __game.state.sidewalk.push(b); __player.svc.carryingAll.push(b); __game.bus.emit('stateChanged', { what: 'sidewalk' });
    return __game.state.furniture.find((x) => x.type === 'shelf' && x.levels?.some((l) => l.productId === 'macarrao'));
  });
  await page.evaluate(([x, z]) => __player.teleport(x, z), [f.x + 1, f.z + 2.1]);
  await page.evaluate((id) => __player.aimLevel(id, 1), f.id);
  await page.waitForFunction(() => __player.actions().primary?.label === 'Repor', null, { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => __player.press()); // repõe 1 unidade: mostra o selo do nível
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const el = [...document.querySelectorAll('body *')].find((e) => e.offsetParent && e.children.length === 0 && /·\s*caixa:/.test(e.textContent));
    const m = document.querySelector('.mcard');
    if (!el || !m) return { badge: !!el, mission: !!m, area: 0 };
    const b = el.getBoundingClientRect(), c = m.getBoundingClientRect();
    const ix = Math.max(0, Math.min(b.right, c.right) - Math.max(b.left, c.left)), iy = Math.max(0, Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top));
    return { badge: [b.left | 0, b.top | 0, b.right | 0, b.bottom | 0], mission: [c.left | 0, c.top | 0, c.right | 0, c.bottom | 0], area: Math.round(ix * iy) };
  });
  check(`[${w}x${h}] selo do nível não cobre o cartão de missão`, r.area === 0, JSON.stringify(r));
  await context.close();
}
await browser.close();
console.log(fails.length ? `FALHAS (${fails.length})` : 'OK');
process.exit(fails.length ? 1 : 0);
