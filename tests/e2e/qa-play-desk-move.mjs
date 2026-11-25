// QA de jogabilidade — mesa do computador como móvel (`desk`): mirar = "Usar computador" + "Mover"; o modo de construção
// move/gira sem VENDER/GUARDAR; a posição bloqueia a navegação, o computador funciona no lugar novo e o save guarda.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const OUT = process.env.QA_SHOTS ?? process.argv[2] ?? '/tmp';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fails = []; const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); if (!ok) fails.push(n); };
await p.goto(process.env.QA_URL ?? 'http://localhost:5173/');
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('mercadinho:tutorial', 'done'); });
await p.reload();
await p.waitForFunction(() => window.__game && window.__player && window.__world, null, { timeout: 30000 });
await p.waitForTimeout(800);
await p.evaluate(() => [...document.querySelectorAll('.title-screen button')].find((x) => /Jogar|Continuar/.test(x.textContent))?.click());
await p.waitForTimeout(900);
const d0 = await p.evaluate(() => { __game.clock.paused = true; const d = __game.state.furniture.find((f) => f.type === 'desk'); return d && { ...d }; });
check('jogo novo tem a mesa como móvel', !!d0, JSON.stringify(d0));
// visão geral (da entrada) e de perto
await p.evaluate(() => __player.teleport(6, 9.2, 0.6, -0.12));
await p.evaluate(() => __player.lookAt(9.5, 0.8, 7.5));
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/1-entrada.png` });
await p.evaluate(([x, z]) => { __player.teleport(x + 0.5, z + 2.0); __player.lookAt(x + 0.5, 0.9, z + 0.45); }, [d0.x, d0.z]);
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/2-perto.png` });
const a1 = await p.evaluate(() => ({ t: __player.target(), a: __player.actions() }));
check('mirando a mesa: Usar computador + Mover', a1.t?.kind === 'computer' && a1.a.primary?.label === 'Usar computador' && a1.a.secondary === 'Mover', JSON.stringify(a1));
// Mover: entra no modo de construção sem VENDER/GUARDAR
await p.evaluate(() => __player.secondary());
await p.waitForTimeout(500);
const bm = await p.evaluate(() => ({ pose: __world.build.pose, active: __world.build.active, btns: [...document.querySelectorAll('[data-world-build] button')].map((x) => x.textContent) }));
check('Mover abre o modo de construção da mesa', bm.active && bm.pose.type === 'desk' && bm.pose.mode === 'edit', JSON.stringify(bm));
check('mesa não tem VENDER/GUARDAR', !bm.btns.includes('VENDER') && !bm.btns.includes('GUARDAR') && bm.btns.includes('COLOCAR'), JSON.stringify(bm.btns));
// mira um ponto livre do chão perto da parede esquerda e coloca
await p.evaluate(() => { __player.teleport(2.5, 6.5); __player.lookAt(0.5, 0, 6.5); });
await p.waitForTimeout(700);
await p.evaluate(() => __world.build.rotate(1));
await p.waitForTimeout(300);
const pose = await p.evaluate(() => __world.build.pose);
await p.screenshot({ path: `${OUT}/3-movendo.png` });
await p.locator('[data-world-build] button', { hasText: 'COLOCAR' }).click();
await p.waitForTimeout(700);
const d1 = await p.evaluate(() => { const d = __game.state.furniture.find((f) => f.type === 'desk'); return d && { ...d }; });
check('mesa colocada no novo lugar', pose.valid && d1.x === pose.x && d1.z === pose.z && d1.rot === pose.rot && (d1.x !== d0.x || d1.z !== d0.z), JSON.stringify({ pose, d1 }));
const walk = await p.evaluate(([x, z]) => __game.services.world.isWalkable(x + 0.5, z + 0.5), [d1.x, d1.z]);
check('tile da mesa bloqueado na navegação', walk === false);
// usa o computador no lugar novo
await p.evaluate(([x, z]) => { __player.teleport(x + 1.7, z + 0.5); __player.lookAt(x + 0.45, 0.95, z + 0.5); }, [d1.x, d1.z]);
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/4-novo-lugar.png` });
const a2 = await p.evaluate(() => ({ t: __player.target(), a: __player.actions() }));
check('no lugar novo: Usar computador', a2.t?.kind === 'computer' && a2.a.primary?.label === 'Usar computador', JSON.stringify(a2));
// persiste no save
await p.evaluate(() => __game.save());
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('mercadinho:save') ?? localStorage.getItem(Object.keys(localStorage).find((k) => /save/.test(k) && !/backup|corrupt|recovered/.test(k))) ?? '{}').furniture?.find((f) => f.type === 'desk'));
check('posição salva', saved && saved.x === d1.x && saved.z === d1.z, JSON.stringify(saved));
check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(fails.length ? `FALHAS: ${fails.join(', ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
