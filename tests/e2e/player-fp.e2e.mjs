// E2E do módulo PLAYER (Fases 3–4, 1ª pessoa): olhar/mover por toque, colisão, alvo + rótulo, pegar, abrir/repor/fechar,
// FASE 4: interação por NÍVEL (pick.level; Repor → placeUnitsInLevel; Retirar com caixa vazia → pullUnitsFromLevel e repor
// em outro nível; dois produtos no mesmo móvel; Outro produto / Não cabe aqui / Nível cheio; Preço do nível), multitoque
// (joystick + botão ao mesmo tempo via CDP, segurar pelo mesmo pointerId), sensibilidade do olhar (lookSensitivity),
// tentativa de tela cheia/paisagem no navegador; arremessar, largar (build:box), limpar, sentar + PickService, eventos.
// Uso: npx vite build && (npx vite preview --port 5202 &) && PLAYER_URL=http://localhost:5202/ node tests/e2e/player-fp.e2e.mjs
// Sai com código 1 se alguma verificação falhar. Prints em $PLAYER_SHOTS (padrão: /tmp/player-fp).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.PLAYER_URL ?? 'http://localhost:5202/';
const SHOTS = (process.env.PLAYER_SHOTS ?? '/tmp/player-fp').replace(/\/?$/, '/');
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };

const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
// FASE 4: lookSensitivity salva antes de carregar (o player deve ler de mercadinho:settings)
await context.addInitScript(() => {
  try { const k = 'mercadinho:settings'; const o = JSON.parse(localStorage.getItem(k) || '{}') || {}; if (o.lookSensitivity == null) { o.lookSensitivity = 1.5; localStorage.setItem(k, JSON.stringify(o)); } } catch { /* sem storage */ }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon|MIME/.test(m.text())) errors.push(m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__player, null, { timeout: 30000 });
await page.evaluate(() => { for (const [id, p] of [[2, 'feijao'], [3, 'macarrao']]) { const f = __game.state.furniture.find((x) => x.id === id); if (!f) continue; f.productId = p; f.levels = (f.levels ?? []).map(() => ({ productId: p, units: 0 })); __game.state.slots[p] = f.levels.length; } __game.bus.emit('stateChanged', { what: 'shelf' }); }); // jogo novo começa sem produto: etiqueta as 2 prateleiras iniciais
await page.waitForTimeout(900);
await page.evaluate(() => window.__world?.setTier?.('low')); // SwiftShader: mais quadros por segundo
/** Fecha título/tutorial/painéis modais da UI que estiverem abertos. */
const closeModals = async () => {
  for (let i = 0; i < 10; i++) {
    if (!(await page.evaluate(() => __player.svc.inputLocked))) return;
    const btn = page.locator('button:visible', { hasText: /Jogar|Continuar|Começar|Pular|Fechar|Entendi|Vamos|OK/i }).first();
    if (await btn.count()) await btn.click({ timeout: 1500 }).catch(() => {}); else await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
};
await closeModals();
if (await page.evaluate(() => __player.svc.inputLocked)) { console.log('WARN modal da UI não fechou; liberando input para o teste'); await page.evaluate(() => __game.bus.emit('ui:modal', { open: false })); }
await page.evaluate(() => {
  __game.clock.paused = true;
  window.__ev = [];
  for (const n of ['player:action', 'build:box', 'build:state', 'stateChanged', 'ui:openTablet', 'store:sign', 'sfx', 'toast']) {
    __game.bus.on(n, (p) => window.__ev.push({ n, p: p === undefined ? null : JSON.parse(JSON.stringify(p, (k, v) => (typeof v === 'function' ? undefined : v))) }));
  }
});
const cdp = await context.newCDPSession(page);
// CDP: touchStart [novo ponto] acrescenta um dedo; touchMove [pontos] move; touchEnd [ponto] solta só esse; touchEnd [] solta todos
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 1, radiusX: 2, radiusY: 2, force: 1 })) });
const drag = async (x0, y0, x1, y1, steps = 8, hold = 0) => {
  await touch('touchStart', [{ x: x0, y: y0 }]);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }]); await page.waitForTimeout(16); }
  if (hold) await page.waitForTimeout(hold);
  await touch('touchEnd', []);
};
/** Espera uma condição no navegador (o jogo pode rodar a poucos quadros por segundo no SwiftShader). */
const until = (fn, arg, ms = 4000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
const frames = (n = 4) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); f(); }), n);
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; };
const tapSel = async (sel) => {
  const c = await center(sel);
  if (!c) return false;
  const cover = await page.evaluate(([s, x, y]) => { const e = document.elementFromPoint(x, y); return e && !e.closest(s) ? `${e.tagName}.${typeof e.className === 'string' ? e.className : ''}` : ''; }, [sel, c.x, c.y]);
  if (cover) console.log(`WARN ${sel} coberto por ${cover}`);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(120);
  return true;
};
const holdSel = async (sel, ms) => { const c = await center(sel); if (!c) return false; await touch('touchStart', [c]); await page.waitForTimeout(ms); await touch('touchEnd', []); await page.waitForTimeout(80); return true; };
/** Segura o seletor (toque CDP) até a condição valer (ou `ms`): independe do FPS do SwiftShader. */
const holdUntil = async (sel, fn, arg, ms = 6000) => { const c = await center(sel); if (!c) return false; await touch('touchStart', [c]); const ok = await until(fn, arg, ms); await touch('touchEnd', []); await page.waitForTimeout(120); return ok; };
const evs = (n) => page.evaluate((k) => window.__ev.filter((e) => e.n === k).map((e) => e.p), n);
const clearEv = () => page.evaluate(() => { window.__ev.length = 0; });
const act = () => page.evaluate(() => __player.actions());
const label = () => page.locator('.pl-lab').first().textContent();
const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
/** Coloca o jogador num ponto livre (raio 0,3) perto de (x,z). */
const place = (x, z, yaw = 0, pitch = 0) => page.evaluate(([x, z, yaw, pitch]) => {
  const w = __game.services.world;
  const free = (a, b) => !w || [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([dx, dz]) => w.isWalkable(a + dx, b + dz));
  let px = x, pz = z;
  outer: for (let r = 0; r <= 2; r += 0.25) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r; if (free(tx, tz)) { px = tx; pz = tz; break outer; } }
  __player.teleport(px, pz, yaw, pitch);
  return { x: px, z: pz };
}, [x, z, yaw, pitch]);
/** Caixa nova já carregada (fechada por padrão). */
const giveBox = (pid, units, open = false) => page.evaluate(([pid, units, open]) => {
  const b = { productId: pid, units, carried: true, open };
  __game.state.sidewalk.push(b); __player.svc.carryingAll.push(b); __game.bus.emit('stateChanged', { what: 'sidewalk' });
}, [pid, units, open]);
const dropAll = () => page.evaluate(() => __player.dropAll());
/** Some com as caixas da mão (tira do estado): nada empilhado na frente das prateleiras bloqueia a mira dos níveis. */
const discardHeld = () => page.evaluate(() => { for (const b of [...__player.svc.carryingAll]) { const i = __game.state.sidewalk.indexOf(b); if (i >= 0) __game.state.sidewalk.splice(i, 1); } __game.bus.emit('stateChanged', { what: 'sidewalk' }); });

const shelfOf = (pid) => page.evaluate((p) => { const f = __game.state.furniture.find((x) => x.productId === p); return f ? { id: f.id, x: f.x, z: f.z, rot: f.rot } : null; }, pid);
/** FASE 4: níveis do móvel (teste escreve direto; os derivados se recalculam na próxima mutação da sim). */
const setLevels = (id, levels) => page.evaluate(([id, levels]) => {
  const f = __game.state.furniture.find((x) => x.id === id);
  const n = Math.max(levels.length, f.levels?.length ?? 0), fill = levels.find((l) => l.productId)?.productId;
  f.levels = Array.from({ length: n }, (_, i) => ({ ...(levels[i] ?? (fill ? { productId: fill, units: 0 } : { units: 0 })) }));
  __game.bus.emit('stateChanged', { what: 'shelf' });
}, [id, levels]);
const lvls = (id) => page.evaluate((id) => (__game.state.furniture.find((x) => x.id === id)?.levels ?? []).map((l) => ({ ...l })), id);
const boxNow = () => page.evaluate(() => { const b = __player.svc.carrying; return b ? { pid: b.productId, units: b.units, open: !!b.open } : null; });
/** Fica 1,6 m à frente do móvel e mira o nível `lvl` pelo caminho real (raycast + world.levelAt), via __player.aimLevel. */
const aimLvl = async (f, lvl) => {
  const a = (f.rot * Math.PI) / 180, fx = Math.sin(a), fz = Math.cos(a);
  const sw = f.rot === 90 || f.rot === 270, cx = f.x + (sw ? 0.5 : 1), cz = f.z + (sw ? 1 : 0.5);
  await place(cx + fx * 1.6, cz + fz * 1.6);
  const ok = await page.evaluate(([id, l]) => __player.aimLevel(id, l), [f.id, lvl]);
  await until(([id, l]) => __player.target()?.id === id && __player.target()?.level === l, [f.id, lvl], 3000);
  await frames(2);
  return ok;
};
const aimFurniture = async (f) => { // fica 1,9 m à frente (lado do cliente) e mira o centro do móvel
  const a = (f.rot * Math.PI) / 180, fx = Math.sin(a), fz = Math.cos(a);
  const sw = f.rot === 90 || f.rot === 270, cx = f.x + (sw ? 0.5 : 1), cz = f.z + (sw ? 1 : 0.5);
  await place(cx + fx * 1.9, cz + fz * 1.9);
  await page.evaluate(([x, z]) => __player.lookAt(x, 0.95, z), [cx, cz]);
  await until((id) => __player.target()?.kind === 'furniture' && __player.target()?.id === id, f.id, 3000);
  await page.waitForTimeout(100);
};

// 1) câmera 1ª pessoa
{
  const c = await page.evaluate(() => __player.cam());
  check('câmera em 1ª pessoa a ~1,6 m e FOV ~70', Math.abs(c.eye[1] - 1.6) < 0.06 && Math.abs(c.fov - 70) < 1.5, JSON.stringify({ y: c.eye[1], fov: c.fov }));
  const avatar = await page.evaluate(() => { let n = 0; __game.scene.traverse((o) => { if (/avatar/i.test(o.name)) n++; }); return n; });
  check('sem avatar de 3ª pessoa na cena', avatar === 0);
  check('mira central visível', await page.locator('.pl-cross').isVisible());
}

// 2) olhar por toque (metade direita) e limite de pitch
{
  await place(6, 6.5, 0, 0);
  await frames();
  const a = await page.evaluate(() => __player.cam());
  await drag(640, 220, 540, 190);
  await frames();
  const b = await page.evaluate(() => __player.cam());
  check('arrastar à direita da tela gira a câmera (yaw e pitch)', b.yaw - a.yaw > 0.2 && b.pitch > a.pitch, `dyaw=${(b.yaw - a.yaw).toFixed(2)} dpitch=${(b.pitch - a.pitch).toFixed(2)}`);
  for (let i = 0; i < 4; i++) await drag(640, 120, 640, 385, 10);
  await frames();
  const c = await page.evaluate(() => __player.cam());
  check('pitch limitado', c.pitch >= -1.36 && c.pitch < -1.2, c.pitch.toFixed(2));
}

// 3) andar com o joystick + colisão com a parede do fundo e a fachada
{
  const p0 = await place(3.5, 1.6, 0, 0);
  const rest = await page.evaluate(() => __player.input.restPos());
  await drag(rest.x, rest.y, rest.x, rest.y - 50, 4, 1300);
  await frames();
  const p1 = await page.evaluate(() => __player.pos());
  check('joystick move para frente (−z)', p1.z < p0.z - 0.6, `${p0.z.toFixed(2)} → ${p1.z.toFixed(2)}`);
  check('colisão: para antes da parede do fundo (raio 0,3)', p1.z >= 0.28, p1.z.toFixed(3));
  await place(2, 9.0, Math.PI, 0);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
  await frames();
  const p2 = await page.evaluate(() => __player.pos());
  const depth = await page.evaluate(() => 10 + 2 * __game.state.expansion);
  check('colisão: não atravessa a fachada (fora da porta)', p2.z <= depth - 0.28 && p2.z > 9.2, p2.z.toFixed(3));
}

// 4) alvo + rótulo: caixa no chão → "Pegar" (anel verde), pegar pelo botão
{
  await closeModals();
  const p = await place(6, 7.5, 0, 0);
  await page.evaluate(([x, z]) => { __game.state.sidewalk.push({ productId: 'feijao', units: 12, x, z, open: false }); __game.bus.emit('stateChanged', { what: 'sidewalk' }); __player.lookAt(x, 0.15, z); }, [p.x, p.z - 1.4]);
  await until(() => __player.target()?.kind === 'box');
  const t = await page.evaluate(() => __player.target());
  check('mira na caixa do chão vira alvo "box"', t?.kind === 'box', JSON.stringify(t));
  check('rótulo "Pegar" no botão de ação', (await label()) === 'Pegar' && (await page.locator('.pl-main.ready').count()) === 1);
  await shot('p1-alvo-caixa');
  await clearEv();
  await tapSel('.pl-act-btn');
  await until(() => !!__player.svc.carrying && __player.held().boxes === 1);
  const s = await page.evaluate(() => ({ pid: __player.svc.carrying?.productId, held: __player.held() }));
  check('pegar caixa (toque no botão de ação)', s.pid === 'feijao' && s.held.boxes === 1 && s.held.open[0] === 0, JSON.stringify(s));
  const pa = await evs('player:action');
  check('player:action pickBox + stateChanged', pa.some((e) => e.kind === 'pickBox' && e.productId === 'feijao') && (await evs('stateChanged')).length > 0);
  check('botões da caixa visíveis (Arremessar, Largar, Abrir caixa)', await page.locator('.pl-throw').isVisible() && await page.locator('.pl-drop').isVisible() && (await page.locator('.pl-box .pl-cap').textContent()) === 'Abrir caixa');
}

// 5) repor exige caixa aberta: "Abrir caixa" → abre (anima) → segurar "Repor"
{
  await closeModals();
  const f = await shelfOf('feijao');
  await setLevels(f.id, [{ productId: 'feijao', units: 0 }, { productId: 'feijao', units: 0 }]);
  await aimLvl(f, 0);
  const a0 = await act();
  check('nível do produto com caixa fechada → "Repor" (abre ao segurar)', a0.primary?.label === 'Repor', JSON.stringify(a0));
  await clearEv();
  await tapSel('.pl-act-btn');
  await until(() => __player.held().open[0] === 1);
  const o = await page.evaluate(() => ({ open: __player.svc.carrying?.open, held: __player.held() }));
  check('caixa abre (Box.open + abas animadas + produtos visíveis)', o.open === true && o.held.open[0] === 1 && o.held.items > 0, JSON.stringify(o));
  check('sfx boxOpen + player:action openBox', (await evs('sfx')).some((e) => e.name === 'boxOpen') && (await evs('player:action')).some((e) => e.kind === 'openBox'));
  check('ação vira "Repor"', (await act()).primary?.label === 'Repor');
  const before = (await lvls(f.id))[0].units;
  await shot('p2-caixa-aberta-repor');
  await holdUntil('.pl-act-btn', ([id, b]) => __game.state.furniture.find((x) => x.id === id).levels[0].units >= b + 6, [f.id, before], 6000);
  const L = await lvls(f.id);
  const after = { shelf: L[0].units, units: (await boxNow())?.units, other: L.slice(1).reduce((a, l) => a + l.units, 0), n: L.length };
  check('segurar "Repor" repete no nível mirado (placeUnitsInLevel, 1 un. a cada ~0,12 s)', after.shelf - before >= 4 && after.shelf - before <= 12 && after.other === 0, `${before} → ${after.shelf} (outros níveis ${after.other}; ${after.n} níveis)`);
  check('player:action placeUnits por unidade (com level)', (await evs('player:action')).filter((e) => e.kind === 'placeUnits' && e.level === 0).length === after.shelf - before);
  await tapSel('.pl-box .pl-btn');
  await until(() => __player.held().open[0] === 0);
  const cl = await page.evaluate(() => ({ open: __player.svc.carrying?.open, held: __player.held() }));
  check('botão "Fechar caixa" fecha (abas fechadas, sem produtos à vista)', cl.open === false && cl.held.open[0] === 0 && cl.held.items === 0, JSON.stringify(cl));
  check('sfx boxClose', (await evs('sfx')).some((e) => e.name === 'boxClose'));
  {
    const b4 = (await lvls(f.id))[0].units;
    await holdUntil('.pl-act-btn', ([id, b]) => __game.state.furniture.find((x) => x.id === id).levels[0].units >= b + 3, [f.id, b4], 6000);
    const r = await page.evaluate(([id]) => ({ open: __player.svc.carrying?.open, u: __game.state.furniture.find((x) => x.id === id).levels[0].units }), [f.id]);
    check('segurar com caixa fechada abre e já repõe sem soltar', r.open === true && r.u >= b4 + 3, JSON.stringify({ b4, ...r }));
  }
  await page.evaluate(() => __player.look(__player.cam().yaw, 0.15));
  await page.waitForTimeout(150);
  await shot('p3-caixa-fechada');
  await discardHeld();
}

// 6) FASE 4 — níveis: Retirar com caixa vazia → repor em outro nível; dois produtos no mesmo móvel; desabilitados; Preço
{
  await closeModals();
  const f = await shelfOf('feijao');
  const g = await shelfOf('macarrao');
  await setLevels(f.id, [{ productId: 'feijao', units: 4 }, { productId: 'feijao', units: 6 }]);
  await giveBox('cafe', 0, true); // caixa aberta e vazia
  const aimed = await aimLvl(f, 1);
  const t = await page.evaluate(() => __player.target());
  check('mira no móvel preenche pick.level (world.levelAt ou reserva)', aimed && t?.kind === 'furniture' && t.id === f.id && t.level === 1, JSON.stringify(t));
  const a = await act();
  check('caixa aberta VAZIA + nível com unidades → "Retirar"', a.primary?.label === 'Retirar' && a.primary.enabled, JSON.stringify(a));
  await clearEv();
  await holdUntil('.pl-act-btn', (id) => __game.state.furniture.find((x) => x.id === id).levels[1].units === 0, f.id, 6000);
  await page.waitForTimeout(300); // segue segurando além do fim: não pode devolver ("Repor")
  const r = { lv: await lvls(f.id), box: await boxNow() };
  check('segurar "Retirar" puxa o nível para a caixa (pullUnitsFromLevel; caixa vira do produto do nível)', r.lv[1].units === 0 && r.lv[0].units === 4 && r.box?.pid === 'feijao' && r.box.units === 6, JSON.stringify(r));
  const ev = await evs('player:action');
  check('player:action pullUnits por unidade e nada devolvido no meio (não vira "Repor")', ev.filter((e) => e.kind === 'pullUnits' && e.level === 1).length === 6 && !ev.some((e) => e.kind === 'placeUnits'), JSON.stringify(ev.map((e) => e.kind)));
  await aimLvl(f, 0);
  check('com a caixa puxada, outro nível → "Repor"', (await act()).primary?.label === 'Repor', JSON.stringify(await act()));
  await holdUntil('.pl-act-btn', () => __player.svc.carrying?.units === 0, null, 6000);
  const r2 = { lv: await lvls(f.id), box: await boxNow() };
  check('repor em outro nível (nível 0: 4 → 10, caixa vazia)', r2.lv[0].units === 10 && r2.box?.units === 0, JSON.stringify(r2));
  await discardHeld();
  await giveBox('arroz', 10, true);
  await aimLvl(f, 1);
  check('nível com outro produto e 0 un. aceita a caixa → "Repor"', (await act()).primary?.label === 'Repor', JSON.stringify(await act()));
  await holdUntil('.pl-act-btn', (id) => __game.state.furniture.find((x) => x.id === id).levels[1].units >= 8, f.id, 6000);
  await page.waitForTimeout(300);
  const r3 = { lv: await lvls(f.id), box: await boxNow() };
  check('dois produtos diferentes na mesma prateleira (nível 0 feijão, nível 1 arroz)', r3.lv[0].productId === 'feijao' && r3.lv[0].units === 10 && r3.lv[1].productId === 'arroz' && r3.lv[1].units === 8 && r3.box?.units === 2, JSON.stringify(r3));
  await shot('p2b-dois-produtos');
  const full = await act();
  check('nível cheio → "Nível cheio" desabilitado', full.primary?.label === 'Nível cheio' && full.primary.enabled === false, JSON.stringify(full));
  await aimLvl(f, 0);
  const o = await act();
  check('nível de outro produto com unidades → "Outro produto" desabilitado', o.primary?.label === 'Outro produto' && o.primary.enabled === false && (await page.locator('.pl-main.disabled').count()) === 1, JSON.stringify(o));
  await page.evaluate(() => __player.press());
  check('ação desabilitada não mexe no nível', JSON.stringify(await lvls(f.id)) === JSON.stringify(r3.lv));
  await discardHeld();
  await setLevels(g.id, [{ productId: 'macarrao', units: 5 }, { units: 0 }]);
  await giveBox('refri', 6, true);
  await aimLvl(g, 1);
  const nf = await act();
  check('categoria recusada (bebida na prateleira) → "Não cabe aqui" desabilitado', nf.primary?.label === 'Não cabe aqui' && nf.primary.enabled === false, JSON.stringify(nf));
  await discardHeld();
  await giveBox('feijao', 4, false);
  await aimLvl(g, 1);
  check('caixa fechada + nível vazio sem etiqueta → "Repor" (abre ao segurar)', (await act()).primary?.label === 'Repor', JSON.stringify(await act()));
  await discardHeld();
  await clearEv();
  for (const [lvl, pid] of [[1, 'arroz'], [0, 'feijao']]) {
    await closeModals();
    const ok = await aimLvl(f, lvl);
    const p = await act();
    const dbg = await page.evaluate(() => ({ t: __player.target(), locked: __player.svc.inputLocked, mode: __player.svc.mode, carrying: __player.svc.carryingAll.length, pos: __player.pos(), cam: __player.cam() }));
    await page.evaluate(() => __player.press());
    await page.waitForTimeout(80);
    check(`sem caixa, nível ${lvl} → "Preço" do produto do nível (${pid}) + secundário Mover`, p.primary?.label === 'Preço' && p.secondary === 'Mover' && (await evs('ui:openTablet')).some((e) => e.tab === 'prices' && e.productId === pid), JSON.stringify({ ok, p, dbg }));
  }
  await closeModals();
}

// 7) arremessar: vazia na lixeira → descartada; cheia → cai ao lado com aviso; no chão → dropBox
{
  await closeModals();
  const bin = await page.evaluate(() => __game.services.world?.trashBin() ?? { x: 10.5, z: 11.5 });
  const stand = await place(bin.x - 2.3, bin.z, -Math.PI / 2, 0);
  await giveBox('macarrao', 0, true);
  await page.evaluate(([x, z]) => __player.lookAt(x, 0.55, z), [bin.x, bin.z]);
  await until(() => __player.target()?.kind === 'trash' && __player.actions().primary?.label === 'Jogar fora');
  const t = await page.evaluate(() => ({ t: __player.target(), a: __player.actions() }));
  check('mira na lixeira com caixa vazia → "Jogar fora"', t.t?.kind === 'trash' && t.a.primary?.label === 'Jogar fora', JSON.stringify(t));
  await clearEv();
  const n0 = await page.evaluate(() => __game.state.sidewalk.length);
  await tapSel('.pl-throw .pl-btn');
  check('caixa voando (malha própria)', await until(() => __player.flying() === 1, null, 2000));
  await shot('p4-arremesso');
  await until(() => __player.flying() === 0, null, 6000);
  await page.waitForTimeout(150);
  const n1 = await page.evaluate(() => __game.state.sidewalk.length);
  check('caixa vazia arremessada na lixeira é descartada', n1 === n0 - 1 && (await evs('player:action')).some((e) => e.kind === 'discardBox'), `${n0} → ${n1}`);
  check('sfx throw no início', (await evs('sfx')).some((e) => e.name === 'throw'));
  await giveBox('macarrao', 6, false);
  await page.evaluate(([x, z]) => __player.lookAt(x, 0.55, z), [bin.x, bin.z]);
  await page.waitForTimeout(300);
  await clearEv();
  await until(() => __player.target()?.kind === 'trash', null, 2000);
  await page.evaluate(() => __player.throwBox());
  await until(() => __player.flying() === 0, null, 6000);
  await page.waitForTimeout(150);
  const full = await page.evaluate(([bx, bz]) => { const b = __game.state.sidewalk.find((x) => x.productId === 'macarrao' && x.units === 6); return b ? { carried: !!b.carried, d: Math.hypot(b.x - bx, b.z - bz), ok: __game.state.sidewalk.includes(b) } : null; }, [bin.x, bin.z]);
  check('caixa cheia na lixeira cai ao lado (dropBox) com aviso', !!full && !full.carried && full.d > 0.4 && full.d < 2.2 && (await evs('toast')).length > 0, JSON.stringify(full));
  await place(6, 6.5, 0, -0.55);
  await giveBox('cafe', 4, false);
  // arremesso logo depois do teleporte (sem quadro processado no meio): a mira assistida antiga (lixeira) não pode valer —
  // o player só usa a lixeira se ela estiver à frente na pose atual (antes a caixa voava para a vitrine, de forma intermitente)
  await frames(3);
  await page.evaluate(() => __player.throwBox());
  await until(() => __player.flying() === 0, null, 6000);
  await page.waitForTimeout(150);
  const fl = await page.evaluate(() => { const b = __game.state.sidewalk.find((x) => x.productId === 'cafe' && x.units === 4); return b ? { carried: !!b.carried, x: b.x, z: b.z, can: __game.services.world ? true : true } : null; });
  check('arremesso no chão larga a caixa onde caiu (api.dropBox)', !!fl && !fl.carried && fl.z < 6.5 && fl.z > 2.5, JSON.stringify(fl));
  check('player:action throwBox', (await evs('player:action')).some((e) => e.kind === 'throwBox'));
}

// 8) largar: build:box {boxIndex} → prévia do world (confirma) ou fallback à frente
{
  await closeModals();
  await place(6, 7.5, 0, -0.3);
  await giveBox('arroz', 5, false);
  const idx = await page.evaluate(() => __game.state.sidewalk.length - 1);
  await clearEv();
  await tapSel('.pl-drop .pl-btn');
  await until(() => window.__ev.some((e) => e.n === 'build:state' && e.p?.active) || !__player.svc.carrying, null, 3000);
  const bb = await evs('build:box');
  check('Largar emite build:box com o índice da caixa', bb.length === 1 && bb[0].boxIndex === idx, JSON.stringify(bb));
  const st = await evs('build:state');
  if (st.some((e) => e.active)) {
    check('durante a prévia os botões de ação somem', !(await page.locator('.pl-acts').isVisible()));
    await page.evaluate(() => __player.look(__player.cam().yaw, -0.75)); // prévia no chão logo à frente
    await page.waitForTimeout(1200);
    const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /COLOCAR/i.test(x.textContent)); b?.click(); return !!b; });
    if (!clicked) await page.keyboard.press('Enter');
    await until(() => !__player.svc.carrying, null, 4000);
  }
  const d = await page.evaluate(() => { const b = __game.state.sidewalk.find((x) => x.productId === 'arroz' && x.units === 5); return b ? { carried: !!b.carried, x: b.x, z: b.z } : null; });
  check(`caixa largada no chão (${st.some((e) => e.active) ? 'prévia do world' : 'fallback à frente'})`, !!d && !d.carried && Number.isFinite(d.x) && !(await page.evaluate(() => !!__player.svc.carrying)), JSON.stringify(d));
  if (await page.evaluate(() => __player.svc.mode === 'build')) { await page.keyboard.press('Escape'); await until(() => __player.svc.mode !== 'build', null, 3000); }
  await dropAll();
}

// 9) limpar: esfregão ~0,9 s e depois api.cleanDirt
{
  await closeModals();
  const p = await place(3.5, 5.5, 0, 0);
  await page.evaluate(([x, z]) => { __game.state.dirt.push({ x, z }); __game.bus.emit('stateChanged', { what: 'dirt' }); __player.lookAt(x, 0, z); }, [p.x, p.z - 1.3]);
  await until(() => __player.actions().primary?.label === 'Limpar', null, 3000);
  check('mira na sujeira → "Limpar"', (await act()).primary?.label === 'Limpar', JSON.stringify(await act()));
  const n0 = await page.evaluate(() => __game.state.dirt.length);
  await clearEv();
  await tapSel('.pl-act-btn');
  await until(() => __player.mopping(), null, 2000);
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => ({ mop: __player.mopping(), held: __player.held(), dirt: __game.state.dirt.length }));
  check('esfregão aparece e esfrega (sujeira ainda lá no meio)', mid.mop && mid.held.mop && mid.dirt === n0, JSON.stringify(mid));
  await shot('p5-esfregao');
  await until(() => !__player.mopping(), null, 5000);
  await page.waitForTimeout(100);
  const n1 = await page.evaluate(() => __game.state.dirt.length);
  check('depois de ~0,9 s a sujeira some (cleanDirt) + sfx mop + player:action clean', n1 === n0 - 1 && (await evs('sfx')).some((e) => e.name === 'mop') && (await evs('player:action')).some((e) => e.kind === 'clean'), `${n0} → ${n1}`);
}

// 10) sentar no caixa, olhar limitado, PickService, sair
{
  await closeModals();
  const cid = await page.evaluate(() => __game.state.furniture.find((f) => f.type === 'counter').id);
  await page.evaluate((id) => __player.forceTarget({ kind: 'seat', id }), cid);
  await until(() => __player.actions().primary?.label === 'Sentar no caixa', null, 2000);
  check('assento do caixa → "Sentar no caixa"', (await act()).primary?.label === 'Sentar no caixa', JSON.stringify(await act()));
  await clearEv();
  await tapSel('.pl-act-btn');
  await page.evaluate(() => __player.forceTarget(null));
  await until(() => __player.svc.mode === 'seated' && !__player.cam().trans, null, 4000);
  const s = await page.evaluate(() => ({ mode: __player.svc.mode, seatedAt: __player.svc.seatedAt, atCounter: __player.svc.atCounter, y: __player.cam().eye[1] }));
  check('sentado: mode=seated, seatedAt=atCounter=balcão', s.mode === 'seated' && s.seatedAt === cid && s.atCounter === cid, JSON.stringify(s));
  check('sentado: botão "Sair do caixa" visível; joystick e ação ocultos', await page.locator('.pl-exit').isVisible() && !(await page.locator('.pl-acts').isVisible()) && !(await page.locator('.pl-joy').isVisible()));
  check('sfx sit + player:action sit', (await evs('sfx')).some((e) => e.name === 'sit') && (await evs('player:action')).some((e) => e.kind === 'sit' && e.furnitureId === cid));
  await drag(520, 250, 40, 250, 12); await drag(520, 250, 40, 250, 12); // longe do botão "Sair do caixa" e dos painéis da UI
  await frames();
  const sy = await page.evaluate(() => __player.cam().seatYaw);
  check('olhar sentado limitado a ±60°', Math.abs(sy) <= Math.PI / 3 + 1e-6 && Math.abs(sy) > 0.9, sy.toFixed(3));
  await page.evaluate(() => { const c = __player.cam(); __player.look(c.yaw, c.pitch); });
  const scr = await page.evaluate(() => __player.tapProbe(0.9)); // objeto tocável registrado no PickService
  await page.waitForTimeout(100);
  await page.touchscreen.tap(scr.x + 6, scr.y + 4);
  await until(() => __player.tapProbeHits() > 0, null, 1500);
  const tapped = await page.evaluate(() => __player.tapProbeHits());
  check('toque no objeto registrado no PickService chama onTap', tapped === 1, JSON.stringify({ scr, tapped }));
  await page.evaluate(() => __game.bus.emit('ui:modal', { open: true }));
  await page.touchscreen.tap(scr.x, scr.y);
  await page.waitForTimeout(120);
  await page.evaluate(() => __game.bus.emit('ui:modal', { open: false }));
  check('toques ignorados com ui:modal aberto', (await page.evaluate(() => __player.tapProbeHits())) === 1);
  await page.evaluate(() => __player.removeTapProbe());
  await shot('p6-sentado');
  await clearEv();
  await tapSel('.pl-exit');
  await until(() => __player.svc.mode === 'walk' && !__player.cam().trans, null, 4000);
  const u = await page.evaluate(() => ({ mode: __player.svc.mode, seatedAt: __player.svc.seatedAt, atCounter: __player.svc.atCounter, y: __player.cam().eye[1] }));
  check('"Sair do caixa" levanta atrás do balcão', u.mode === 'walk' && u.seatedAt === null && u.atCounter === null && Math.abs(u.y - 1.6) < 0.06, JSON.stringify(u));
  check('sfx stand + player:action stand', (await evs('sfx')).some((e) => e.name === 'stand') && (await evs('player:action')).some((e) => e.kind === 'stand'));
}

// 11) placa, computador, depósito trancado, preço/mover
{
  await closeModals();
  await clearEv();
  const run = async (pick, want) => {
    await closeModals(); // a UI real abre o tablet (modal) em ui:openTablet
    await page.evaluate((p) => __player.forceTarget(p), pick);
    await until((w) => __player.actions().primary?.label === w, want, 2000);
    const a = await act();
    await page.evaluate(() => __player.press());
    await page.waitForTimeout(80);
    return a.primary?.label === want;
  };
  check('placa (loja fechada) → "Abrir loja" → store:sign', await run({ kind: 'sign' }, 'Abrir loja') && (await evs('store:sign')).length === 1);
  check('computador → "Usar computador" → ui:openTablet {}', await run({ kind: 'computer' }, 'Usar computador') && (await evs('ui:openTablet')).some((e) => !e.tab));
  const locked = await page.evaluate(() => !__game.state.storageUnlocked);
  if (locked) check('depósito trancado → ui:openTablet {tab:services}', await run({ kind: 'storageDoor' }, 'Depósito (licença)') && (await evs('ui:openTablet')).some((e) => e.tab === 'services'));
  const f = await shelfOf('feijao');
  check('prateleira sem caixa → "Preço" → ui:openTablet prices', await run({ kind: 'furniture', id: f.id }, 'Preço') && (await evs('ui:openTablet')).some((e) => e.tab === 'prices' && e.productId === 'feijao'));
  await closeModals();
  await page.evaluate((id) => __player.forceTarget({ kind: 'furniture', id }), f.id);
  await until(() => __player.actions().secondary === 'Mover', null, 2000);
  await frames(2);
  check('secundário "Mover" visível', await page.locator('.pl-move').isVisible() && (await page.locator('.pl-move .pl-cap').textContent()) === 'Mover');
  await page.evaluate(() => __player.forceTarget(null));
  await page.evaluate(() => { __game.clock.paused = true; });
}

// 12) botões somem em build:state e ui:modal; dolly mostra a pilha; reduceMotion sem balanço
{
  await closeModals();
  await page.evaluate(() => __game.bus.emit('build:state', { active: true, kind: 'furniture' }));
  await frames();
  check('build:state ativo esconde o grupo de ação', !(await page.locator('.pl-acts').isVisible()));
  await page.evaluate(() => __game.bus.emit('build:state', { active: false, kind: 'furniture' }));
  await page.evaluate(() => __game.bus.emit('ui:modal', { open: true }));
  await frames();
  check('ui:modal esconde ações, mira e joystick', !(await page.locator('.pl-acts').isVisible()) && !(await page.locator('.pl-cross').isVisible()) && !(await page.locator('.pl-joy').isVisible()));
  await page.evaluate(() => __game.bus.emit('ui:modal', { open: false }));
  await frames();
  check('controles voltam após fechar o modal', await page.locator('.pl-acts').isVisible() && await page.locator('.pl-joy').isVisible());
  await place(6, 7, 0, 0.1);
  await page.evaluate(() => __player.forceCap(3));
  await giveBox('arroz', 8, false); await giveBox('feijao', 8, false); await giveBox('cafe', 8, true);
  await until(() => __player.held().boxes === 3, null, 2000);
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => __player.held());
  check('dolly (capacidade 3) mostra a pilha', h.boxes === 3 && h.dolly && h.items > 0, JSON.stringify(h));
  await shot('p7-dolly-pilha');
  await dropAll();
  await page.evaluate(() => __player.forceCap(null));
  await page.evaluate(() => __game.bus.emit('settings:changed', { reduceMotion: true }));
  await place(4.5, 7.5, Math.PI / 2, 0);
  const ys = [];
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(60); ys.push(await page.evaluate(() => __player.cam().eye[1])); }
  await page.keyboard.up('KeyW');
  check('reduceMotion: sem balanço de cabeça', ys.every((y) => Math.abs(y - 1.6) < 1e-6), ys.map((y) => y.toFixed(3)).join(','));
  await page.evaluate(() => __game.bus.emit('settings:changed', { reduceMotion: false }));
}

// 13) FASE 4 — multitoque: joystick andando + toque no botão (2 dedos, CDP); segurar pelo MESMO pointerId
{
  await closeModals();
  await page.evaluate(() => { __game.clock.paused = true; });
  await place(6, 7.2, 0, 0);
  await giveBox('feijao', 5, false);
  await frames(3);
  const rest = await page.evaluate(() => __player.input.restPos());
  const p0 = await page.evaluate(() => __player.pos());
  const B = await center('.pl-box .pl-btn');
  const clicks = await page.evaluate(() => { window.__boxClicks = 0; document.querySelector('.pl-box .pl-btn').addEventListener('click', () => window.__boxClicks++); return 0; });
  await touch('touchStart', [{ x: rest.x, y: rest.y, id: 1 }]);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [{ x: rest.x, y: rest.y - i * 12, id: 1 }]); await page.waitForTimeout(30); }
  await page.waitForTimeout(250);
  const walking = await page.evaluate(() => ({ stick: __player.input.stickActive, my: __player.input.moveY }));
  await touch('touchStart', [{ x: B.x, y: B.y, id: 2 }]); // 2º dedo no "Abrir caixa" com o 1º no joystick
  await page.waitForTimeout(60);
  await touch('touchEnd', [{ x: B.x, y: B.y, id: 2 }]); // solta só o 2º dedo
  await touch('touchMove', [{ x: rest.x + 2, y: rest.y - 50, id: 1 }]);
  await page.waitForTimeout(350);
  const mid = await page.evaluate(() => ({ open: !!__player.svc.carrying?.open, stick: __player.input.stickActive, my: __player.input.moveY, pos: __player.pos(), clicks: window.__boxClicks }));
  await touch('touchEnd', []);
  await page.waitForTimeout(100);
  check('joystick andando + toque simultâneo em "Abrir caixa" abre a caixa (pointerdown)', walking.stick && walking.my > 0.5 && mid.open, JSON.stringify({ walking, mid, clicks }));
  check('o joystick continua ativo e andando durante/depois do 2º toque', mid.stick && mid.my > 0.5 && Math.hypot(mid.pos.x - p0.x, mid.pos.z - p0.z) > 0.8, JSON.stringify({ p0, p1: mid.pos }));
  console.log(`INFO click do botão nesse multitoque: ${mid.clicks} (o navegador pode nem gerar click com outro dedo na tela)`);
  await discardHeld();
  // segurar "Repor" com o 2º dedo; soltar o joystick não solta o botão; soltar o dedo do botão para
  const f = await shelfOf('feijao');
  await setLevels(f.id, [{ productId: 'feijao', units: 0 }, { productId: 'arroz', units: 8 }]);
  await giveBox('feijao', 12, true);
  await aimLvl(f, 0);
  check('multitoque: alvo pronto ("Repor")', (await act()).primary?.label === 'Repor', JSON.stringify(await act()));
  const M = await center('.pl-act-btn');
  const L0 = async () => (await lvls(f.id))[0].units;
  const lv0 = (id) => __game.state.furniture.find((x) => x.id === id).levels[0].units;
  await touch('touchStart', [{ x: rest.x, y: rest.y, id: 1 }]); // joystick parado (zona morta)
  await touch('touchStart', [{ x: M.x, y: M.y, id: 2 }]);
  await until(`(${lv0})(${f.id}) >= 3`, null, 5000);
  const n1 = await L0();
  await touch('touchEnd', [{ x: rest.x, y: rest.y, id: 1 }]); // solta o joystick; o botão continua seguro
  await until(`(${lv0})(${f.id}) >= ${n1 + 2}`, null, 5000);
  const n2 = await L0();
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  const n3 = await L0();
  await page.waitForTimeout(450);
  const n4 = await L0();
  check('segurar "Repor" com o 2º dedo enquanto o 1º está no joystick', n1 >= 2, `n1=${n1}`);
  check('soltar o joystick não solta o botão de ação (mesmo pointerId)', n2 > n1, `${n1} → ${n2}`);
  check('soltar o dedo do botão para de repor', n3 >= n2 && n4 === n3 && n4 < 12, `${n2} → ${n3} → ${n4}`);
  const ta = await page.evaluate(() => [...document.querySelectorAll('[data-player-controls] button')].map((b) => getComputedStyle(b).touchAction));
  check('touch-action:none em todos os botões do player', ta.length >= 5 && ta.every((v) => v === 'none'), ta.join(','));
  await discardHeld();
}

// 14) FASE 4 — sensibilidade do olhar (lookSensitivity de mercadinho:settings e settings:changed), toque e mouse
{
  await closeModals();
  const p0 = await page.evaluate(() => __player.prefs());
  check('lê lookSensitivity de mercadinho:settings no início (1,5)', Math.abs(p0.sensitivity - 1.5) < 1e-6, JSON.stringify(p0));
  const yawAfter = async (sens, how) => {
    await page.evaluate((v) => __game.bus.emit('settings:changed', { lookSensitivity: v }), sens);
    await place(6, 6.5, 0, 0);
    await frames(2);
    const a = (await page.evaluate(() => __player.cam())).yaw;
    if (how === 'touch') await drag(640, 220, 560, 220, 8);
    else { await page.mouse.move(640, 220); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(640 - i * 10, 220); await page.mouse.up(); }
    await frames(3);
    return (await page.evaluate(() => __player.cam())).yaw - a;
  };
  const t1 = await yawAfter(1, 'touch'), t2 = await yawAfter(2, 'touch');
  check('sensibilidade 2,0 ≈ dobro do giro por toque', t1 > 0.05 && Math.abs(t2 / t1 - 2) < 0.25, `s1=${t1.toFixed(3)} s2=${t2.toFixed(3)}`);
  const m1 = await yawAfter(1, 'mouse'), m04 = await yawAfter(0.4, 'mouse');
  check('sensibilidade 0,4 ≈ 40% do giro por mouse', m1 > 0.05 && Math.abs(m04 / m1 - 0.4) < 0.08, `s1=${m1.toFixed(3)} s0.4=${m04.toFixed(3)}`);
  await page.evaluate(() => __game.bus.emit('settings:changed', { lookSensitivity: 9 }));
  const hi = (await page.evaluate(() => __player.prefs())).sensitivity;
  await page.evaluate(() => __game.bus.emit('settings:changed', { quality: 'low' })); // payload sem o campo mantém o valor
  const keep = (await page.evaluate(() => __player.prefs())).sensitivity;
  check('lookSensitivity limitada a 0,4–2,0 e mantida quando o evento não traz o campo', hi === 2 && keep === 2, `${hi} ${keep}`);
  await page.evaluate(() => __game.bus.emit('settings:changed', { lookSensitivity: 1 }));
}

// 15) FASE 4 — paisagem no navegador: no 1º toque tenta tela cheia + orientation.lock (fora de app nativo/iframe)
{
  const l0 = await page.evaluate(() => __player.landscape());
  check('sob WebDriver a tentativa de tela cheia fica desligada (sem ?fs=1)', l0?.state === 'skipped' && l0.reason === 'webdriver', JSON.stringify(l0));
  const p2 = await context.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(URL + (URL.includes('?') ? '&' : '?') + 'fs=1');
  await p2.waitForFunction(() => window.__player, null, { timeout: 30000 });
  const a = await p2.evaluate(() => __player.landscape());
  await p2.touchscreen.tap(420, 200);
  await p2.waitForFunction(() => ['done', 'failed'].includes(__player.landscape()?.state), null, { timeout: 4000 }).catch(() => {});
  const b = await p2.evaluate(() => __player.landscape());
  check('?fs=1: primeiro toque tenta tela cheia + paisagem, sem erro', a?.state === 'idle' && b?.tries === 1 && ['done', 'failed'].includes(b.state) && errs2.length === 0, JSON.stringify({ a, b, errs2 }));
  await p2.close();
}

check('sem erros de console', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
console.log(fails.length ? `FALHAS (${fails.length}): ${fails.join('; ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
