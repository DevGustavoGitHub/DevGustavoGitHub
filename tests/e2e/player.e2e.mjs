// E2E do módulo PLAYER (Fase 2): multitouch, pinça, toques na UI, multi-caixas, interação preferida, histerese.
// Uso: npx vite build && (npx vite preview --port 5178 &) && node tests/e2e/player.e2e.mjs
// Sai com código 1 se qualquer verificação falhar.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.PLAYER_URL ?? 'http://localhost:5178/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };
const warn = (m) => console.log('WARN', m);

async function boot(viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('MIME')) errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && window.__player, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  // fecha tela de título/tutorial/modais
  for (let i = 0; i < 4; i++) {
    const locked = await page.evaluate(() => __player.svc.inputLocked);
    if (!locked) break;
    await page.getByText(/^(Jogar|Continuar)$/).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => { __game.clock.paused = true; });
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 2, radiusY: 2, force: 1 })),
  });
  return { context, page, errors, touch };
}
const frames = (page, n = 6) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); f(); }), n);
const snap = (page) => page.evaluate(() => ({ x: __player.svc.position.x, z: __player.svc.position.z, ...__player.cam() }));

/* ================= TOQUE (dois viewports) ================= */
for (const vp of [{ width: 844, height: 390, name: 'paisagem' }, { width: 390, height: 844, name: 'retrato' }]) {
  const { context, page, errors, touch } = await boot(vp);
  const W = vp.width, H = vp.height;
  const tag = `[${vp.name}]`;
  check(`${tag} jogo carregou e entrada livre`, !(await page.evaluate(() => __player.svc.inputLocked)));
  // posição aberta para andar
  await page.evaluate(() => { const b = __player.svc.position; const w = __game.services.world; const c = w.counters()[0]; b.set(c.queue[0]?.x ?? c.operator.x, 0, (c.queue[0]?.z ?? c.operator.z) + 1); });

  // --- joystick + deslize simultâneos
  const s0 = await snap(page);
  const L = { id: 1, x: W * 0.2, y: H * 0.7 }, R = { id: 2, x: W * 0.75, y: H * 0.5 };
  await touch('touchStart', [L, R]);
  let stickShown = false;
  for (let i = 1; i <= 14; i++) {
    L.x = W * 0.2 + i * 8; R.x = W * 0.75 - i * 12; R.y = H * 0.5 + i * 3;
    await touch('touchMove', [L, R]);
    await page.waitForTimeout(40);
    if (i === 8) stickShown = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.style.width === '112px' && d.style.display === 'block'));
  }
  const sMid = await snap(page);
  await touch('touchEnd', [L, R]);
  await frames(page, 10);
  const moved = Math.hypot(sMid.x - s0.x, sMid.z - s0.z);
  const camMoved = Math.abs(sMid.yawT - s0.yawT) > 0.2;
  check(`${tag} joystick visível durante o toque`, stickShown);
  check(`${tag} joystick move o jogador (>0.4 m)`, moved > 0.4, `d=${moved.toFixed(2)}`);
  check(`${tag} deslize move a câmera ao mesmo tempo`, camMoved, `dYaw=${(sMid.yawT - s0.yawT).toFixed(2)}`);
  const stopped = await snap(page);
  await page.waitForTimeout(400);
  const stopped2 = await snap(page);
  check(`${tag} soltar o joystick para o jogador`, Math.hypot(stopped2.x - stopped.x, stopped2.z - stopped.z) < 0.15);

  // --- pinça: afastar = aproximar (dist diminui); juntar = afastar
  const p0 = await snap(page);
  const A = { id: 3, x: W * 0.6, y: H * 0.5 }, B = { id: 4, x: W * 0.8, y: H * 0.5 };
  await touch('touchStart', [A, B]);
  for (let i = 1; i <= 10; i++) { A.x = W * 0.6 - i * 10; B.x = W * 0.8 + i * 10; await touch('touchMove', [A, B]); await page.waitForTimeout(30); }
  await touch('touchEnd', [A, B]);
  await frames(page, 6);
  const p1 = await snap(page);
  check(`${tag} pinça (afastar dedos) aproxima a câmera`, p1.distT < p0.distT - 0.5, `${p0.distT.toFixed(1)} -> ${p1.distT.toFixed(1)}`);
  const C = { id: 5, x: W * 0.56, y: H * 0.5 }, D = { id: 6, x: W * 0.96, y: H * 0.5 };
  await touch('touchStart', [C, D]);
  for (let i = 1; i <= 10; i++) { C.x += W * 0.012; D.x -= W * 0.012; await touch('touchMove', [C, D]); await page.waitForTimeout(30); }
  await touch('touchEnd', [C, D]);
  await frames(page, 6);
  const p2 = await snap(page);
  check(`${tag} pinça (juntar dedos) afasta a câmera`, p2.distT > p1.distT + 0.5, `${p1.distT.toFixed(1)} -> ${p2.distT.toFixed(1)}`);
  check(`${tag} zoom respeita limites 4.5..18`, p2.distT >= 4.5 && p2.distT <= 18);

  // --- toques sobre a UI não movem câmera/jogador
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'e2e-ui';
    d.style.cssText = 'position:fixed;left:8px;top:8px;width:140px;height:100px;background:#f0f;opacity:.6;z-index:50';
    __game.uiRoot.appendChild(d);
    const d2 = d.cloneNode(); d2.id = 'e2e-ui2'; d2.style.left = 'auto'; d2.style.right = '8px'; __game.uiRoot.appendChild(d2);
  });
  const u0 = await snap(page);
  const U1 = { id: 7, x: 70, y: 50 }, U2 = { id: 8, x: W - 70, y: 50 };
  await touch('touchStart', [U1, U2]);
  for (let i = 1; i <= 10; i++) { U1.x += 8; U1.y += 10; U2.x -= 10; await touch('touchMove', [U1, U2]); await page.waitForTimeout(30); }
  await touch('touchEnd', [U1, U2]);
  await frames(page, 8);
  const u1 = await snap(page);
  check(`${tag} arrastar sobre a UI não gira nem dá zoom`, Math.abs(u1.yawT - u0.yawT) < 1e-6 && Math.abs(u1.pitchT - u0.pitchT) < 1e-6 && Math.abs(u1.distT - u0.distT) < 1e-6);
  check(`${tag} arrastar sobre a UI (metade esquerda) não move o jogador`, Math.hypot(u1.x - u0.x, u1.z - u0.z) < 0.05);
  // botões reais do HUD (se houver): tocar e arrastar a partir deles
  const btn = await page.evaluate(() => {
    const els = [...__game.uiRoot.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 20 && r.height > 20 && r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0 && getComputedStyle(b).visibility !== 'hidden'; });
    const b = els.find((e) => e.getBoundingClientRect().left < innerWidth / 2) ?? els[0];
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (btn) {
    const k0 = await snap(page);
    const T = { id: 9, x: btn.x, y: btn.y };
    await touch('touchStart', [T]);
    for (let i = 1; i <= 8; i++) { T.x += 6; T.y -= 4; await touch('touchMove', [T]); await page.waitForTimeout(30); }
    await touch('touchEnd', [T]);
    await frames(page, 6);
    const k1 = await snap(page);
    check(`${tag} arrastar a partir de botão do HUD não move câmera/jogador`, Math.abs(k1.yawT - k0.yawT) < 1e-6 && Math.hypot(k1.x - k0.x, k1.z - k0.z) < 0.05);
  } else warn(`${tag} sem botão de HUD visível para o teste real`);
  check(`${tag} sem erros no console`, errors.length === 0, errors.join(' | ').slice(0, 300));
  await context.close();
}

/* ================= CAIXAS / INTERAÇÃO (desktop-like, API direta) ================= */
{
  const { context, page, errors } = await boot({ width: 844, height: 390 });
  // ouvintes de prompt
  await page.evaluate(() => {
    window.__prompts = []; window.__toasts = [];
    __game.bus.on('interact:prompt', (e) => { __prompts.push({ t: performance.now(), label: e?.label ?? null, action: e?.action }); });
    __game.bus.on('interact:secondary', (e) => { window.__sec = e; });
    __game.bus.on('toast', (e) => __toasts.push(e.text));
  });
  const place = (x, z) => page.evaluate(([x0, z0]) => { __player.svc.position.set(x0, 0, z0); }, [x, z]);
  const lastPrompt = (page) => page.evaluate(() => { const p = __prompts[__prompts.length - 1]; return p ? p.label : null; });
  const press = async () => { await page.evaluate(() => { const p = __prompts[__prompts.length - 1]; if (p?.action) p.action(); }); await frames(page, 4); };
  const settle = async () => { await frames(page, 8); await page.waitForTimeout(350); };
  const clearBoxes = () => page.evaluate(() => { __game.state.sidewalk.length = 0; __player.svc.carryingAll.length = 0; __game.bus.emit('stateChanged', { what: 'sidewalk' }); });
  const addBox = (pid, units, x, z) => page.evaluate(([p, u, x0, z0]) => { __game.state.sidewalk.push({ productId: p, units: u, x: x0, z: z0 }); }, [pid, units, x, z]);

  const info = await page.evaluate(() => {
    const st = __game.state, w = __game.services.world;
    const sh = st.furniture.filter((f) => f.type === 'shelf' && f.productId);
    const f = sh[0];
    const ids = sh.map((q) => q.productId);
    return { shelfId: f?.id, pid: f?.productId, pids: ids, access: f ? w.furnitureAccess(f.id) : null, bin: w.trashBin(), dz: __game.services.world ? w.door() : null, depth: st.expansion };
  });
  check('há prateleira com produto e acesso', !!info.pid && !!info.access, JSON.stringify(info.access));
  // área livre (sem móveis) para teste de pegar: calçada junto à lixeira
  const free = await page.evaluate(() => { const w = __game.services.world; const b = w.trashBin(); for (let r = 0; r < 6; r += 0.5) for (const [dx, dz] of [[-r, 0], [r, 0], [0, -r], [0, r]]) if (w.isWalkable(b.x + dx, b.z + dz) && Math.hypot(dx, dz) > 3.5) return { x: b.x + dx, z: b.z + dz }; return { x: b.x - 4, z: b.z }; });

  // capacidade: API real (dolly) ou aviso se a sim ainda não implementou
  const realCap = await page.evaluate(() => { __game.state.upgrades.push('dolly'); __player.forceCap(null); return new Promise((r) => setTimeout(() => r(__player.capacity()), 300)); });
  if (realCap > 1) check('carryCapacity real com dolly > 1', true, String(realCap));
  else warn('api.carryCapacity ainda devolve 1 com dolly (sim não implementado?); usando forceCap(3)');
  await page.evaluate(() => __player.forceCap(3));

  // --- pegar até a capacidade, LIFO, aviso de cheio
  await clearBoxes();
  await place(free.x, free.z);
  const ps = [info.pids[0] ?? 'arroz', info.pids[1] ?? 'feijao', info.pids[2] ?? 'macarrao', info.pids[3] ?? 'cafe'];
  for (let i = 0; i < 4; i++) await addBox(ps[i], 5 + i, free.x + 0.1 * i, free.z + 0.1);
  await settle();
  for (let i = 0; i < 3; i++) { await press(); await page.waitForTimeout(150); await frames(page, 6); }
  let c = await page.evaluate(() => ({ n: __player.svc.carryingAll.length, top: __player.svc.carrying?.units, topIs: __player.svc.carrying === __player.svc.carryingAll[__player.svc.carryingAll.length - 1], flags: __game.state.sidewalk.filter((b) => b.carried).length }));
  check('carrega 3 caixas (capacidade 3)', c.n === 3 && c.flags === 3, JSON.stringify(c));
  check('carrying é o topo da pilha (LIFO)', c.topIs && c.top != null);
  await settle();
  const lab3 = await lastPrompt(page);
  check('rótulo mostra contador de caixas', /3\/3/.test(lab3 ?? ''), String(lab3));
  await page.evaluate(() => { __toasts.length = 0; });
  // 4ª caixa não entra; botão deve ser "Largar" (mãos cheias) e secundário "Largar tudo"
  check('cheio: não oferece pegar a 4ª caixa', !/^Pegar/.test(lab3 ?? ''), String(lab3));
  check('cheio: secundário "Largar tudo"', await page.evaluate(() => /Largar tudo/.test(__sec?.label ?? '')));
  await page.evaluate(() => { const pl = __player; pl.svc.carryingAll.length; });
  const topBefore = await page.evaluate(() => __player.svc.carrying.productId);
  // Largar (topo) -> 2 restantes, caixa solta com carried=false
  await press(); await settle();
  c = await page.evaluate(() => ({ n: __player.svc.carryingAll.length, flags: __game.state.sidewalk.filter((b) => b.carried).length, total: __game.state.sidewalk.length }));
  check('largar solta só a caixa do topo', c.n === 2 && c.flags === 2 && c.total === 4, JSON.stringify(c));
  const dropped = await page.evaluate(() => __game.state.sidewalk.filter((b) => !b.carried).map((b) => b.productId));
  check('a caixa largada é a do topo', dropped.includes(topBefore));
  // Largar tudo
  await page.evaluate(() => __sec?.action?.());
  await settle();
  // com 2 caixas o secundário existe; se já executou, deve estar vazio
  c = await page.evaluate(() => ({ n: __player.svc.carryingAll.length, flags: __game.state.sidewalk.filter((b) => b.carried).length }));
  check('"Largar tudo" solta todas', c.n === 0 && c.flags === 0, JSON.stringify(c));

  // --- repor: caixa cheia perto da prateleira do produto => "Repor"
  await clearBoxes();
  await page.evaluate(([pid]) => { __game.state.shelf[pid] = 0; }, [info.pid]);
  await addBox(info.pid, 6, free.x, free.z);
  await addBox('__lixo__' in {} ? 'x' : (info.pids.find((p) => p !== info.pid) ?? 'feijao'), 4, free.x + 0.2, free.z);
  await place(free.x, free.z); await settle();
  await press(); await press(); // pega as duas (a do produto ou não, ordem por distância)
  await page.evaluate(([pid]) => { const a = __player.svc.carryingAll; const i = a.findIndex((b) => b.productId === pid); if (i >= 0 && i !== 0) { /* garante que a caixa-alvo NÃO esteja no topo */ const [b] = a.splice(i, 1); a.unshift(b); } }, [info.pid]);
  await place(info.access.x, info.access.z); await settle();
  const labR = await lastPrompt(page);
  check('com caixas do produto perto da prateleira: "Repor" (mesmo fora do topo)', /^Repor/.test(labR ?? ''), String(labR));
  const before = await page.evaluate(([pid]) => __game.state.shelf[pid] ?? 0, [info.pid]);
  await press();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(([pid]) => __game.state.shelf[pid] ?? 0, [info.pid]);
  check('repor transfere unidades para a prateleira', after > before, `${before} -> ${after}`);

  // --- lixeira: caixa vazia perto da lixeira => "Jogar caixa fora"
  await clearBoxes();
  await page.evaluate(() => { __game.state.sidewalk.push({ productId: 'arroz', units: 0, x: 1, z: 1, carried: true }); const b = __game.state.sidewalk[0]; __player.svc.carryingAll.push(b); });
  await place(info.bin.x - 0.8, info.bin.z); await settle();
  const labB = await lastPrompt(page);
  check('caixa vazia perto da lixeira: "Jogar caixa fora"', /^Jogar caixa fora/.test(labB ?? ''), String(labB));
  await press(); await settle();
  c = await page.evaluate(() => ({ n: __player.svc.carryingAll.length, side: __game.state.sidewalk.length }));
  check('jogar fora remove a caixa do estado e das mãos', c.n === 0 && c.side === 0, JSON.stringify(c));

  // --- histerese: oscilar na borda do alcance de pegar não pisca o prompt
  await clearBoxes();
  await addBox('arroz', 3, free.x, free.z);
  await page.evaluate(() => { window.__prompts.length = 0; });
  const flickers = await page.evaluate(async ([fx, fz]) => {
    const t0 = performance.now(); let k = 0;
    while (performance.now() - t0 < 3000) {
      const d = 1.5 + (k % 2 ? 0.08 : -0.08);
      __player.svc.position.set(fx + d, 0, fz);
      k++;
      await new Promise((r) => setTimeout(r, 90));
    }
    return __prompts.length;
  }, [free.x, free.z]);
  check('histerese: prompt não pisca na borda do alcance', flickers <= 3, `${flickers} emissões em 3 s`);

  // --- save com várias carried=true: init solta todas perto do jogador
  await clearBoxes();
  await page.evaluate(() => { for (let i = 0; i < 3; i++) __game.state.sidewalk.push({ productId: 'arroz', units: 2, carried: true }); __game.save(); });
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__player, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const rl = await page.evaluate(() => ({ n: __player.svc.carryingAll.length, flags: __game.state.sidewalk.filter((b) => b.carried).length, side: __game.state.sidewalk.length, placed: __game.state.sidewalk.every((b) => b.x != null) }));
  check('carregar save com 3 carried=true solta todas', rl.n === 0 && rl.flags === 0 && rl.side >= 3 && rl.placed, JSON.stringify(rl));
  check('sem erros no console (caixas)', errors.length === 0, errors.join(' | ').slice(0, 300));
  await context.close();
}

await browser.close();
if (fails.length) { console.error(`\n${fails.length} FALHA(S):\n - ` + fails.join('\n - ')); process.exit(1); }
console.log('\nplayer.e2e: tudo OK');
