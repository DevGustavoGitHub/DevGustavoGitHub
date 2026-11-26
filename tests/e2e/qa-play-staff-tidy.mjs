// QA de jogabilidade (pós-teste 3, rodada do repositor/faxineiro):
// 1) repositor e faxineiro vão às lixeiras de fora PELA PORTA (nunca atravessam a fachada);
// 2) repositor ocioso espera no depósito, ao lado da passagem;
// 3) prioridade pelo nível mais vazio (prateleira cheia + outra com 1 un. vem antes de produto com níveis pela metade);
// 4) faxineiro recolhe caixas vazias do chão e leva para a reciclagem;
// 5) nível com etiqueta e 0 un. continua registrado: a etiqueta mostra o produto ("--"), e o repositor repõe ali.
// Uso: QA_URL=http://localhost:5175/ node tests/e2e/qa-play-staff-tidy.mjs
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
  s.level = 10; s.levelAck = 10; s.money = 1_000_000; s.storageUnlocked = true; s.upgrades.push('recycler');
  s.furniture.push({ id: s.nextFurnitureId++, type: 'rack', x: 1, z: -5, rot: 0 });
  const sh = s.furniture.find((f) => f.id === 2), sh2 = s.furniture.find((f) => f.id === 3);
  sh.levels = [{ productId: 'feijao', units: 12 }, { productId: 'feijao', units: 1 }, { productId: 'arroz', units: 4 }, { productId: 'arroz', units: 4 }];
  sh2.levels = [{ productId: 'macarrao', units: 0 }, { units: 0 }, { units: 0 }, { units: 0 }]; // macarrão zerado, mas registrado
  s.storage = { feijao: 12, arroz: 16, macarrao: 20 };
  s.employees.stocker = 1; s.employees.janitor = 1;
  __npc.stock(0, 'zzz'); // recalcula os derivados (shelf/slots)...
  for (const f of s.furniture) for (const l of f.levels ?? []) if (l.productId === 'zzz') delete l.productId; // ...sem deixar etiqueta falsa
  __game.bus.emit('stateChanged', { what: 'furniture' }); __game.bus.emit('stateChanged', { what: 'employees' }); __game.bus.emit('stateChanged', { what: 'shelf' });
  __npc.sync();
  __player.teleport(3, 6);
  window.__trace = [];
  window.__first = null;
  const D = __world.bounds().depth, dx = __game.services.world.door().x;
  setInterval(() => {
    for (const x of __npc.staff()) if (x.role !== 'cashier') window.__trace.push([x.role, x.x, x.z]);
    if (!window.__first) { const l = __game.state.furniture.find((f) => f.id === 2).levels; if (l[1].units > 1) window.__first = 'feijao'; else if (l[2].units > 4 || l[3].units > 4) window.__first = 'arroz'; }
  }, 100);
  window.__D = D; window.__dx = dx;
});
await p.waitForTimeout(500);
// 5) etiqueta do nível zerado mostra o produto
// funcionários trabalham já na preparação (manhã): sem abrir a loja
await p.evaluate(() => { __npc.timeScale = 4; });
const filled = await until(() => { const l = __game.state.furniture.find((f) => f.id === 2).levels; return l[1].units === 12; }, null, 90000);
check('repõe a prateleira com 1 un. mesmo com a outra cheia (e na preparação, antes de abrir)', filled, JSON.stringify(await p.evaluate(() => __game.state.furniture.find((f) => f.id === 2).levels)));
check('prioridade: o nível mais vazio (feijão 1/12) antes do arroz (4/8 + 4/8)', (await p.evaluate(() => window.__first)) === 'feijao', String(await p.evaluate(() => window.__first)));
const mac = await until(() => __game.state.furniture.find((f) => f.id === 3).levels[0].units > 0, null, 90000);
check('nível zerado mas registrado (macarrão) é reposto com o mesmo produto; níveis sem etiqueta continuam vazios', mac && (await p.evaluate(() => __game.state.furniture.find((f) => f.id === 3).levels.slice(1).every((l) => !l.productId && l.units === 0))), JSON.stringify(await p.evaluate(() => __game.state.furniture.find((f) => f.id === 3).levels)));
// 4) caixas vazias no chão → faxineiro leva para a reciclagem
const before = await p.evaluate(() => __game.state.ledger.recycled);
await p.evaluate(() => { const s = __game.state; s.sidewalk.push({ productId: 'cafe', units: 0, x: 7.5, z: 3.5, open: true }, { productId: 'leite', units: 0, x: 7.9, z: 3.2, open: true }); __game.bus.emit('stateChanged', { what: 'sidewalk' }); });
const gone = await until(() => !__game.state.sidewalk.some((x) => x.units === 0 && (x.productId === 'cafe' || x.productId === 'leite')), null, 90000);
const rec = await p.evaluate((b0) => __game.state.ledger.recycled - b0, before);
check('faxineiro recolhe as caixas vazias do chão e recicla', gone && rec >= 2, JSON.stringify({ gone, rec }));
// 1) ninguém atravessa a fachada fora da porta
const cross = await p.evaluate(() => {
  const D = window.__D, dx = window.__dx, bad = [];
  const tr = window.__trace;
  for (let i = 1; i < tr.length; i++) {
    const [r0, x0, z0] = tr[i - 1], [r1, x1, z1] = tr[i];
    if (r0 !== r1) continue;
    if ((z0 < D - 0.05) !== (z1 < D - 0.05) && Math.abs(z1 - z0) < 1.5) { const x = (x0 + x1) / 2; if (Math.abs(x - dx) > 1.05) bad.push([r1, x.toFixed(2), z0.toFixed(2), z1.toFixed(2)]); }
  }
  return { bad: bad.slice(0, 5), n: tr.length };
});
check('repositor/faxineiro saem e entram só pela porta (sem atravessar a fachada)', cross.bad.length === 0, JSON.stringify(cross));
// 2) repositor ocioso espera no depósito, ao lado da passagem
const home = await until(() => { const s = __npc.staff().find((x) => x.role === 'stocker'); return s && s.job === 'idle' && s.z < 0 && Math.abs(s.x - window.__dx) < 3.5; }, null, 60000);
check('repositor ocioso espera no depósito ao lado da passagem', home, JSON.stringify(await p.evaluate(() => __npc.staff())));
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(fails.length ? `FALHAS: ${fails.join(', ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
