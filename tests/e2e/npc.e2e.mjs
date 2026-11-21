// E2E do módulo NPC. Uso: (npx vite --port 5175 &) && node tests/e2e/npc.e2e.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const OUT = process.env.NPC_SHOTS ?? '/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/npc';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.NPC_URL ?? 'http://localhost:5175/';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('MIME type')) errors.push(m.text()); if (m.type() === 'warning' && m.text().includes('[npc]')) console.log('WARN', m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__npc, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByText('Jogar', { exact: true }).first().click({ timeout: 3000 }).catch(() => {}); // fecha a tela de título (modal)
await page.waitForTimeout(800);

const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };

const init = await page.evaluate(() => ({ money: __game.state.money, shelf: { ...__game.state.shelf }, world: !!__game.services.world, furniture: __game.state.furniture.length }));
console.log('init', JSON.stringify(init));

// Sem mundo/luzes (módulos em andamento): luz + chão + câmera só para os prints
await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js').catch(() => null);
  let hasLight = false;
  __game.scene.traverse((o) => { if (o.isLight) hasLight = true; });
  if (!hasLight && THREE) {
    __game.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(5, 10, 6); __game.scene.add(d);
    if (!__game.services.world) { const f = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc9c4b8 })); f.position.set(8, 0, 6); __game.scene.add(f); }
  }
  if (!__game.services.player?.update) { __game.camera.position.set(8, 11, 17); __game.camera.lookAt(7, 0, 5); }
});

// estoca prateleiras e (se não houver) garante funcionamento
await page.evaluate(() => {
  const s = __game.state;
  for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) s.shelf[id] = 20;
  window.__moneyBefore = s.money;
  window.__shelfBefore = Object.values(s.shelf).reduce((a, b) => a + b, 0);
  // simula o jogador atendendo: responde ao pedido de checkout como o minigame faria
  __game.bus.on('checkoutRequest', (r) => setTimeout(() => __game.bus.emit('checkoutResult', { customerId: r.customerId, ok: true, speed: 0.7, mistakes: 0 }), 700));
  // jogador "sempre no balcão" (o módulo player real não está encostado no counter durante o teste)
  const pl = (__game.services.player ??= { position: { x: 9, z: 5 }, carrying: null, inputLocked: false });
  try { Object.defineProperty(pl, 'inputLocked', { get: () => false, set: () => {}, configurable: true }); } catch (e) { console.error('inputLocked', e); }
  try { Object.defineProperty(pl, 'atCounter', { get: () => __game.state.furniture.find((f) => f.type === 'counter')?.id ?? null, set: () => {}, configurable: true }); } catch (e) { console.error('atCounter', e); }
  __game.uiRoot.style.display = 'none';
  __game.clock.paused = false; __game.clock.openStore();
  __npc.timeScale = 8;
  setInterval(() => { __game.clock.paused = false; }, 100); // modais da UI pausam o relógio; o teste responde ao checkout sozinho
});
await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/01-customers.png` });
// acelera o relógio (o fps no swiftshader é baixo) até haver vendas concluídas
let shot2 = false, shotB = false;
for (let i = 0; i < 150; i++) {
  const st = await page.evaluate(() => { if (__game.clock.minute < 1100) __game.clock.minute += 8; return { ...__npc.stats, c: __npc.customers().length, fps: 0 }; });
  if (i % 5 === 0) console.log('t', i, JSON.stringify(st), await page.evaluate(() => __game.clock.hhmm));
  if (!shotB) { const bi = await page.evaluate(() => __npc.customers().find((c) => c.bubble)); if (bi) { shotB = true; await page.evaluate((b) => { __game.camera.position.set(b.x + 2, 3.2, b.z + 4); __game.camera.lookAt(b.x, 1.4, b.z); }, bi); await page.waitForTimeout(150); await page.screenshot({ path: `${OUT}/05-bubble.png` }); await page.evaluate(() => { __game.camera.position.set(8, 11, 17); __game.camera.lookAt(7, 0, 5); }); } }
  if (!shot2 && st.c >= 3) { shot2 = true; await page.screenshot({ path: `${OUT}/02-later.png` }); }
  if (st.sold >= 6 && st.left >= 6) break;
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: `${OUT}/03-end.png` });
const end = await page.evaluate(() => ({ stats: { ...__npc.stats }, money: __game.state.money, before: __moneyBefore, shelf: Object.values(__game.state.shelf).reduce((a, b) => a + b, 0), shelfBefore: __shelfBefore, ledger: { ...__game.state.ledger }, min: __game.clock.hhmm, phase: __game.clock.phase, dirt: __game.state.dirt.length, in: __npc.customers(), lanes: __npc.lanes() }));
console.log('end', JSON.stringify(end));
check('clientes spawnaram', end.stats.spawned > 0, String(end.stats.spawned));
check('clientes saíram', end.stats.left > 0, String(end.stats.left));
check('vendas ocorreram', end.stats.sold > 0, String(end.stats.sold));
check('dinheiro mudou', end.money !== end.before, `${end.before} -> ${end.money}`);
check('estoque de prateleira diminuiu', end.shelf < end.shelfBefore);

// fechamento e storeEmpty
const empty = await page.evaluate(() => new Promise((res) => {
  let got = false;
  __game.bus.on('storeEmpty', () => { got = true; });
  __game.clock.paused = false; __game.clock.closeStore();
  __npc.timeScale = 10;
  const t0 = performance.now();
  const iv = setInterval(() => { if (got || performance.now() - t0 > 90000) { clearInterval(iv); res({ got, left: __game.services.npc.customersInStore() }); } }, 200);
}));
check('storeEmpty emitido', empty.got, JSON.stringify(empty));
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (fails.length) { console.log('FALHAS:', fails.join(', ')); process.exit(1); }
console.log('OK');
