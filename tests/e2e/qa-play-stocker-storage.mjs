// QA de jogabilidade (pós-teste 3) — repositor e depósito:
// 1) sem nada para repor, ele leva as caixas da CALÇADA para o depósito;
// 2) o que sobra na caixa depois de repor vai para o depósito (não fica largado no chão);
// 3) com o carrinho de carga ('dolly') ele leva +1 caixa por viagem (verificado indiretamente: 2 caixas guardadas).
// Uso: QA_URL=http://localhost:5175/ node tests/e2e/qa-play-stocker-storage.mjs
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.QA_URL ?? 'http://localhost:5173/';
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
await p.evaluate(() => {
  const s = __game.state;
  s.level = 10; s.levelAck = 10; s.money = 1_000_000; s.storageUnlocked = true; s.upgrades.push('dolly');
  s.furniture.push({ id: s.nextFurnitureId++, type: 'rack', x: 1, z: -5, rot: 0 });
  s.employees.stocker = 1;
  __game.bus.emit('stateChanged', { what: 'furniture' }); __game.bus.emit('stateChanged', { what: 'employees' });
  __npc.sync();
  __player.teleport(2.5, 4.5);
  __game.clock.paused = false; __game.clock.openStore(); __game.clock.setDoorsClosed(true); // sem clientes: só o repositor
  setInterval(() => { __game.clock.paused = false; if (__game.clock.minute > 1100) __game.clock.minute = 600; }, 200);
  __npc.timeScale = 4;
  const D = __world.bounds().depth;
  // 2 caixas de macarrão na calçada; nenhum nível etiquetado com macarrão → nada para repor
  s.sidewalk.push({ productId: 'macarrao', units: 20, x: 2, z: D + 1.2, open: false }, { productId: 'macarrao', units: 20, x: 2.6, z: D + 1.2, open: false });
  __game.bus.emit('stateChanged', { what: 'sidewalk' });
});
const stored = await until(() => (__game.state.storage.macarrao ?? 0) === 40 && !__game.state.sidewalk.some((x) => x.productId === 'macarrao'), null, 90000);
check('sem nada para repor: guarda no depósito as caixas da calçada', stored, JSON.stringify(await p.evaluate(() => ({ storage: __game.state.storage, side: __game.state.sidewalk.map((x) => [x.productId, x.units, x.carried, x.x, x.z]), staff: __npc.staff() }))));

// sobra: níveis de feijão quase cheios (11/12) → repõe e guarda o resto no depósito
await p.evaluate(() => {
  const s = __game.state;
  __npc.stock(11, 'feijao');
  const room = s.furniture.reduce((a, f) => a + (f.levels ?? []).filter((l) => l.productId === 'feijao').reduce((x, l) => x + (12 - l.units), 0), 0);
  window.__room = room;
  s.sidewalk.push({ productId: 'feijao', units: 12, x: 2, z: __world.bounds().depth + 1.2, open: false });
  __game.bus.emit('stateChanged', { what: 'shelf' }); __game.bus.emit('stateChanged', { what: 'sidewalk' });
});
const room = await p.evaluate(() => window.__room);
const ok2 = await until((r) => (__game.state.storage.feijao ?? 0) === 12 - r && !__game.state.sidewalk.some((x) => x.productId === 'feijao'), room, 120000);
check(`sobra da reposição vai para o depósito (${12 - room} un.), sem caixa largada no chão`, ok2, JSON.stringify(await p.evaluate(() => ({ storage: __game.state.storage, shelf: __game.state.shelf.feijao, side: __game.state.sidewalk.map((x) => [x.productId, x.units, x.carried]), staff: __npc.staff() }))));
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(fails.length ? `FALHAS: ${fails.join(', ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
