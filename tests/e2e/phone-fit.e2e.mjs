// Regressões reportadas em celular real:
//  1) teclado da maquininha (C, 0, apagar) cortado em telas baixas;
//  2) câmera "subindo para o céu" ao confirmar o modo de construção.
// Uso: npm run build && (npx vite preview --port 5181 &) && node tests/e2e/phone-fit.e2e.mjs
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.NPC_URL ?? 'http://localhost:5181/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, x); if (!ok) fails.push(n); };
const boot = async (w, h) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: true });
  await p.goto(URL);
  await p.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await p.getByText('Jogar', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(900);
  return p;
};

// 1) teclado inteiro visível e sem rolagem do painel
for (const [w, h] of [[844, 390], [800, 330], [740, 300], [390, 844], [390, 700], [390, 600]]) {
  const p = await boot(w, h);
  await p.evaluate(() => __game.bus.emit('checkoutRequest', { customerId: 99, items: [{ productId: 'arroz', qty: 1 }, { productId: 'feijao', qty: 1 }], total: 2840, method: 'card' }));
  await p.waitForTimeout(600);
  for (let i = 0; i < 4; i++) { const it = p.locator('.item:not(.scanned)').first(); if (await it.count() === 0) break; await it.click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(450); }
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const keys = [...document.querySelectorAll('.keypad .key')]; if (!keys.length) return null;
    const ck = document.querySelector('.ck');
    return { bottom: Math.max(...keys.slice(-3).map((k) => k.getBoundingClientRect().bottom)), vh: innerHeight, scrolls: ck.scrollHeight > ck.clientHeight + 1, keyH: keys[0].getBoundingClientRect().height };
  });
  check(`teclado do cartão cabe em ${w}x${h}`, !!r && r.bottom <= r.vh && !r.scrolls, JSON.stringify(r));
  await p.close();
}

// 2) câmera nunca olha para cima ao sair do modo de construção
{
  const p = await boot(844, 390);
  const id = await p.evaluate(() => __game.state.furniture.find((f) => f.type === 'shelf').id);
  await p.evaluate((fid) => __game.bus.emit('build:edit', { furnitureId: fid }), id);
  await p.waitForTimeout(2200);
  await p.keyboard.press('Enter');
  let maxUp = -1;
  for (let i = 0; i < 20; i++) {
    const fy = await p.evaluate(() => { const c = __game.camera; const d = new c.position.constructor(); c.getWorldDirection(d); return d.y; });
    maxUp = Math.max(maxUp, fy);
    await p.waitForTimeout(100);
  }
  check('câmera não aponta para cima após confirmar a construção', maxUp < 0, `maior fy=${maxUp.toFixed(2)}`);
  await p.close();
}
await b.close();
console.log(fails.length ? 'FALHAS: ' + fails.join(', ') : 'OK');
process.exit(fails.length ? 1 : 0);
