// World em 1ª pessoa (Fase 3): draw calls com a câmera DENTRO da loja na altura dos olhos, vazamentos, tiers,
// pickGroup/destaque, monitor do caixa, etiquetas de preço, caixas abertas/fechadas e posicionamento em 1ª pessoa.
// Uso: npx vite build && node tests/e2e/perf.e2e.mjs   (sobe `vite preview --port 5191` sozinho; PERF_URL usa um servidor já aberto)
// SHOTS=/pasta salva prints das vistas (opcional).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const PORT = process.env.PERF_PORT ?? '5191';
const URL = process.env.PERF_URL ?? `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS ?? '';
const MAX_CALLS = 150; // meta: vista típica em 1ª pessoa
let server = null;
if (!process.env.PERF_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL)).ok) break; } catch { /* aguardando */ } await new Promise((r) => setTimeout(r, 500)); }
}
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('MIME type')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { try { localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: 'high', volume: 0, haptics: false })); } catch { /* */ } });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate(() => { for (const [id, p] of [[2, 'feijao'], [3, 'macarrao']]) { const f = __game.state.furniture.find((x) => x.id === id); if (!f) continue; f.productId = p; f.levels = (f.levels ?? []).map(() => ({ productId: p, units: 0 })); __game.state.slots[p] = f.levels.length; } __game.bus.emit('stateChanged', { what: 'shelf' }); }); // jogo novo começa sem produto: etiqueta as 2 prateleiras iniciais
  // fecha o menu inicial/pausa da UI se estiver aberto (o teste dirige o world por eventos)
  const closeMenus = async () => {
    for (let i = 0; i < 3; i++) {
      const open = await page.evaluate(() => { const b = document.querySelector('.menu-btns button'); if (b) b.click(); return !!b; });
      if (!open) return;
      await page.waitForTimeout(300);
    }
  };
  await page.waitForTimeout(800);
  await closeMenus();
  const tap = (label) => page.evaluate((l) => { const b = document.querySelector(`[data-world-build] button[aria-label="${l}"]`); if (!b) throw new Error('botão ausente: ' + l); b.click(); }, label);
  const frames = (n = 2) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const shot = async (name) => { if (SHOTS) { await frames(2); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

  // vista com câmera travada + render manual (independe do player)
  const view = (v) => page.evaluate(async (v) => {
    const g = window.__game;
    window.__world.lockCamera(...v);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    g.renderer.render(g.scene, g.camera);
    const i = g.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }, v);
  const fmt = (s) => `calls=${s.calls} tris=${s.tris} geometries=${s.geometries} textures=${s.textures}`;

  // cena típica: expansão 1, depósito, 18 móveis abastecidos, 6 caixas (2 abertas), sujeira
  const setup = (exp) => page.evaluate((exp) => {
    const s = window.__game.state;
    s.expansion = exp; s.storageUnlocked = true;
    const W = 12 + 4 * exp;
    s.furniture.length = 0;
    const prods = ['arroz', 'feijao', 'macarrao', 'cafe', 'refri', 'agua', 'leite', 'queijo', 'pao', 'detergente', 'sorvete'];
    let id = 1;
    const add = (type, x, z, rot, productId, variant) => s.furniture.push({ id: id++, type, x, z, rot, productId, variant });
    for (let i = 0; i < 4; i++) add('shelf', 1 + i * 2, 0, 0, prods[i]);
    add('shelf', 1, 4, 180, prods[8]); add('shelf', 1, 5, 0, prods[9]); add('shelf', 4, 4, 180, prods[5]); add('shelf', 4, 5, 0, prods[6]);
    add('fridge', W - 1, 1, 270, prods[4]); add('freezer', W - 1, 4, 270, prods[10]); add('fridge', 9, 0, 0, prods[7]);
    add('counter', 7, 5, 0);
    add('decor', 0, 8, 0, undefined, 'plant'); add('decor', 3, 8, 0, undefined, 'banner'); add('decor', W - 1, 8, 0, undefined, 'tree');
    add('rack', 1, -5, 0); add('rack', 4, -5, 0);
    s.nextFurnitureId = id;
    for (const p of prods) { s.shelf[p] = 14; s.slots[p] = 2; }
    s.storage = { arroz: 18, refri: 14, leite: 30, feijao: 5 };
    s.sidewalk.length = 0;
    ['arroz', 'feijao', 'refri', 'leite', 'agua', 'macarrao'].forEach((p, i) => s.sidewalk.push({ productId: p, units: 6, open: i % 3 === 1 }));
    s.dirt = [{ x: 3.4, z: 3.2 }, { x: 5.2, z: 7.1 }, { x: 9.6, z: 6.6 }];
    window.__game.bus.emit('stateChanged', { what: 'furniture' });
    window.__world.rebuild();
    return { W, D: 10 + 2 * exp };
  }, exp);

  const { W, D } = await setup(1);
  const V = {
    'dentro-fundo': [W / 2 + 0.5, 1.6, D - 1.5, W / 2 + 0.5, 1.2, 0],
    'dentro-porta': [6, 1.6, 3.5, W / 2, 1.2, D + 4],
    'dentro-balcao': [4, 1.6, D - 2.5, 9, 1.0, 5.5],
    'dentro-lateral': [2, 1.6, 7, W - 1, 1.2, 4],
    'rua-fachada': [W / 2, 1.6, D + 7.5, W / 2, 2.0, D],
    'calcada-entrega': [W - 5, 1.6, D + 2, 2, 0.8, D + 1],
  };
  const res = {};
  for (const [name, v] of Object.entries(V)) { res[name] = await view(v); console.log(`${name}: ${fmt(res[name])}`); await shot(name); }
  check(`draw calls <= ${MAX_CALLS} dentro da loja (altura dos olhos)`, ['dentro-fundo', 'dentro-porta', 'dentro-balcao', 'dentro-lateral'].every((k) => res[k].calls <= MAX_CALLS), JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, r]) => [k, r.calls]))));
  check('draw calls <= 170 na rua', res['rua-fachada'].calls <= 170 && res['calcada-entrega'].calls <= 170, `(${res['rua-fachada'].calls}, ${res['calcada-entrega'].calls})`);

  // expansões: sem vazamento de geometria/textura
  const rows = [];
  for (const exp of [1, 2, 3, 4, 1]) {
    const b = await setup(exp);
    const s = await view([b.W / 2 + 0.5, 1.6, b.D - 1.5, b.W / 2 + 0.5, 1.2, 0]);
    rows.push({ exp, ...s }); console.log(`expansao ${exp}: ${fmt(s)}`);
  }
  const first = rows[0], last = rows[rows.length - 1];
  check(`draw calls <= ${MAX_CALLS} em todas as expansões (dentro)`, rows.every((r) => r.calls <= MAX_CALLS), `(max ${Math.max(...rows.map((r) => r.calls))})`);
  check('geometrias não crescem ao voltar à expansão 1', last.geometries <= first.geometries + 2, `(${first.geometries} -> ${last.geometries})`);
  check('texturas não crescem ao voltar à expansão 1', last.textures <= first.textures, `(${first.textures} -> ${last.textures})`);
  const before = await view(V['dentro-fundo']);
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.__world.rebuild());
  const after = await view(V['dentro-fundo']);
  check('rebuild repetido não vaza geometrias/texturas', after.geometries <= before.geometries && after.textures <= before.textures, `(${fmt(before)} -> ${fmt(after)})`);

  // qualidade em tempo real
  await page.evaluate(() => window.__game.bus.emit('settings:changed', { quality: 'low', volume: 0, haptics: false }));
  await page.waitForTimeout(200);
  const q = await page.evaluate(() => ({ ...window.__world.quality() }));
  check('tier low: pixel ratio <= 1 e sem sombras', q.pixelRatio <= 1 && q.shadows === 0, JSON.stringify(q));
  console.log('low (dentro):', fmt(await view(V['dentro-fundo'])));
  await page.evaluate(() => window.__game.bus.emit('settings:changed', { quality: 'high', volume: 0, haptics: false }));
  await page.waitForTimeout(200);
  check('tier high: sombras 2048', (await page.evaluate(() => window.__world.quality().shadows)) === 2048);
  const gen = await page.evaluate(() => window.__world.testGenericProducts());
  check('visuais genéricos por shape/cor', gen.ok, JSON.stringify(gen.bad.slice(0, 3)));

  // ---- Fase 3: serviço, pick e destaque ----
  await page.evaluate(() => { const s = window.__game.state; s.storageUnlocked = false; window.__game.bus.emit('stateChanged', { what: 'storage' }); });
  await frames(2);
  const svc = await page.evaluate(() => {
    const w = window.__game.services.world, kinds = {};
    let invisible = true;
    for (const m of w.pickGroup.children) { const p = m.userData.pick; if (p) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1; if (m.material.visible !== false) invisible = false; }
    const c = w.counters()[0];
    const seat = w.seatPose(c.furnitureId), belt = w.beltSlots(c.furnitureId), hand = w.handoffPoint(c.furnitureId);
    const fin = (v) => v && [v.x, v.y, v.z].every(Number.isFinite);
    const pm = w.makeProductMesh('arroz'), pm2 = w.makeProductMesh('arroz'), bm = w.makeBoxMesh('leite', false, 6);
    bm.userData.setOpen(1);
    const pois = ['computer', 'sign', 'delivery', 'trash', 'storageDoor', 'counter'].map((k) => [k, fin(w.poi(k))]);
    return {
      kinds, invisible, seatOk: fin(seat?.pos) && fin(seat?.look) && seat.pos.y > 1 && seat.pos.y < 1.5, beltN: belt.length,
      beltOrder: seat && belt.length > 1 && belt[0].distanceTo(seat.pos) > belt[belt.length - 1].distanceTo(seat.pos), handOk: fin(hand),
      shared: pm.geometry === pm2.geometry && pm.material === pm2.material, boxMesh: bm.children.length >= 6, pois,
    };
  });
  console.log('picks:', JSON.stringify(svc.kinds));
  check('pickGroup: proxies invisíveis de todos os tipos', svc.invisible && ['furniture', 'box', 'dirt', 'trash', 'sign', 'computer', 'seat', 'storageDoor'].every((k) => svc.kinds[k] > 0), JSON.stringify(svc.kinds));
  check('seatPose/beltSlots/handoffPoint', svc.seatOk && svc.beltN === 8 && svc.beltOrder && svc.handOk, JSON.stringify(svc));
  check('makeProductMesh compartilha geometria/material; makeBoxMesh animável', svc.shared && svc.boxMesh);
  check('poi de todos os tipos', svc.pois.every(([, ok]) => ok), JSON.stringify(svc.pois));
  // raycast do centro da tela contra o pickGroup
  await page.evaluate(() => window.__world.lockCamera(2, 1.6, 3.2, 2, 1.0, 0.5));
  await frames(2);
  const ray = await page.evaluate(() => {
    const w = window.__game.services.world, cam = window.__game.camera;
    const origin = cam.position.clone(), dir = cam.getWorldDirection(cam.position.clone());
    // raio do centro da tela contra os proxies (caixas unitárias escaladas): teste por lajes
    const hits = [];
    for (const m of w.pickGroup.children) {
      const inv = m.matrixWorld.clone().invert();
      const o = origin.clone().applyMatrix4(inv), d = dir.clone().transformDirection(inv);
      // caixa unitária centrada: interseção por lajes
      let t0 = -Infinity, t1 = Infinity;
      for (const ax of ['x', 'y', 'z']) {
        if (Math.abs(d[ax]) < 1e-9) { if (o[ax] < -0.5 || o[ax] > 0.5) { t0 = Infinity; break; } continue; }
        const a = (-0.5 - o[ax]) / d[ax], b = (0.5 - o[ax]) / d[ax];
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
      }
      if (t0 <= t1 && t1 > 0) hits.push({ t: Math.max(0, t0) * m.matrixWorld.getMaxScaleOnAxis(), pick: m.userData.pick });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits[0]?.pick ?? null;
  });
  check('mira do centro acerta a prateleira (pick furniture)', ray?.kind === 'furniture', JSON.stringify(ray));
  const hl = await page.evaluate(async () => {
    const w = window.__game.services.world, g = window.__game;
    w.highlight(null); // o player pode já ter destacado o alvo da mira
    g.renderer.render(g.scene, g.camera); const c0 = g.renderer.info.render.calls;
    w.highlight({ kind: 'furniture', id: 1 });
    g.renderer.render(g.scene, g.camera); const c1 = g.renderer.info.render.calls;
    const cur = window.__world.highlighted();
    w.highlight(null);
    return { c0, c1, cur };
  });
  check('highlight liga/desliga o contorno (+1..2 draw calls)', hl.cur?.id === 1 && hl.c1 - hl.c0 >= 1 && hl.c1 - hl.c0 <= 3, JSON.stringify(hl));
  await page.evaluate(() => window.__game.services.world.highlight({ kind: 'furniture', id: 1 }));
  await shot('destaque-prateleira');
  await page.evaluate(() => window.__game.services.world.highlight(null));

  // ---- monitor do caixa (checkout:display) e vista sentada ----
  const seatV = await page.evaluate(() => { const w = window.__game.services.world; const id = w.counters()[0].furnitureId; const p = w.seatPose(id); return [p.pos.x, p.pos.y, p.pos.z, p.look.x, p.look.y, p.look.z, id]; });
  const cid = seatV[6];
  const sigs = [];
  for (const [mode, extra] of [['idle', {}], ['items', { lastItem: { name: 'Arroz 5kg', price: 3090 }, total: 4520 }], ['cash', { total: 4520, received: 5000, change: 480, giving: 300 }], ['card', { total: 4520, typed: '45,2' }]]) {
    await page.evaluate(([id, mode, extra]) => window.__game.bus.emit('checkout:display', { counterId: id, mode, ...extra }), [cid, mode, extra]);
    sigs.push(await page.evaluate(() => window.__world.screens()[0]?.sig ?? ''));
    if (SHOTS) { await view(seatV.slice(0, 6)); await shot(`sentado-${mode}`); }
  }
  check('checkout:display redesenha o monitor (4 modos)', new Set(sigs).size === 4 && sigs.every((s) => s.length > 2), sigs.map((s) => s.slice(0, 30)).join(' | '));

  // ---- etiquetas de preço ----
  const tg = await page.evaluate(() => {
    const s = window.__game.state; s.shelf.arroz = 0; s.shelf.feijao = 9; s.prices.feijao = 870;
    window.__game.bus.emit('stateChanged', { what: 'price' });
    return window.__world.tags();
  });
  check('etiquetas: "--" esgotado e preço em estoque', tg.arroz === '-' && tg.feijao === '870', JSON.stringify({ arroz: tg.arroz, feijao: tg.feijao }));

  // ---- caixas abertas/fechadas ----
  const bc = await page.evaluate(() => { const s = window.__game.state; s.sidewalk.forEach((b, i) => { b.open = i < 4; }); window.__game.bus.emit('stateChanged', { what: 'sidewalk' }); return window.__world.boxCounts(); });
  check('caixas no chão refletem Box.open', bc.open === 4 && bc.floor === 6, JSON.stringify(bc));
  await view([1.2, 1.5, D + 2.6, 2.6, 0.2, D + 1.3]);
  await shot('caixas-abertas-fechadas');

  // ---- móvel novo sem produto → atribuir e abastecer ----
  const nf = await page.evaluate(() => {
    const s = window.__game.state; s.money = 9e7;
    s.furniture.push({ id: 900, type: 'shelf', x: 9, z: 8, rot: 180 });
    window.__game.bus.emit('stateChanged', { what: 'furniture' });
    const t0 = window.__world.tags();
    s.furniture.find((f) => f.id === 900).productId = 'cafe'; s.shelf.cafe = 10; s.slots.cafe = 4;
    window.__game.bus.emit('stateChanged', { what: 'furniture' });
    void t0;
    return { picks: window.__world.picks().some((p) => p.kind === 'furniture' && p.id === 900), tag: window.__world.tags().cafe };
  });
  check('prateleira nova sem produto aparece e passa a mostrar o produto', nf.picks && !!nf.tag && nf.tag !== '-', JSON.stringify(nf));

  // ---- posicionamento em 1ª pessoa: móvel (compra legada), editar/guardar, montar do estoque ----
  const evs = [];
  await page.exposeFunction('__ev', (e) => evs.push(e));
  await page.evaluate(() => { for (const n of ['build:state', 'build:end', 'camera:override']) window.__game.bus.on(n, (p) => window.__ev({ n, p })); });
  await page.evaluate(() => window.__world.lockCamera(13, 1.6, 9.5, 13, 0, 6.5));
  await page.evaluate(() => window.__game.bus.emit('build:start', { type: 'shelf', productId: 'arroz' }));
  await frames(3);
  const bar = await page.evaluate(() => {
    const el = document.querySelector('[data-world-build]');
    if (!el) return null;
    const btns = [...el.querySelectorAll('button')].map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }));
    return { z: getComputedStyle(el).zIndex, btns, pose: window.__world.build.pose };
  });
  check('barra ⟲ COLOCAR ⟳ / CANCELAR (z-index 35, alvos >= 48px)', !!bar && bar.z === '35' && bar.btns.length === 4 && bar.btns.every((b) => b.h >= 48 && b.w >= 48), JSON.stringify(bar?.btns));
  check('prévia segue a mira e é válida', !!bar && bar.pose.valid && Math.abs(bar.pose.z + 0.5 - 6.5) <= 1.5, JSON.stringify(bar?.pose));
  await shot('posicionar-movel');
  const nF0 = await page.evaluate(() => window.__game.state.furniture.length);
  await closeMenus();
  await tap('Girar para a direita');
  const rot1 = await page.evaluate(() => window.__world.build.pose.rot);
  await tap('Colocar');
  await frames(2);
  const placed = await page.evaluate(() => ({ n: window.__game.state.furniture.length, active: window.__world.build.active, bar: !!document.querySelector('[data-world-build]') }));
  check('girar e COLOCAR (buyFurniture)', rot1 === 90 && placed.n === nF0 + 1 && !placed.active && !placed.bar, JSON.stringify({ rot1, ...placed }));
  const newId = await page.evaluate(() => window.__game.state.furniture[window.__game.state.furniture.length - 1].id);
  await page.evaluate((id) => window.__game.bus.emit('build:edit', { furnitureId: id }), newId);
  await frames(2);
  const editBtns = await page.evaluate(() => [...document.querySelectorAll('[data-world-build] button')].map((b) => b.textContent));
  check('modo editar mostra VENDER e GUARDAR', editBtns.includes('VENDER') && editBtns.includes('GUARDAR'), editBtns.join(','));
  await tap('Guardar no estoque');
  await frames(2);
  const stock = await page.evaluate((id) => ({ gone: !window.__game.state.furniture.some((f) => f.id === id), stock: window.__game.state.furnitureStock?.length ?? -1 }), newId);
  check('GUARDAR desmonta para o estoque (storeFurniture)', stock.gone && stock.stock >= 1, JSON.stringify(stock));
  await page.evaluate((n) => window.__game.bus.emit('build:start', { type: 'shelf', stockIndex: n - 1 }), stock.stock);
  await frames(3);
  await tap('Colocar');
  await frames(2);
  const fromStock = await page.evaluate(() => ({ n: window.__game.state.furniture.length, stock: window.__game.state.furnitureStock.length }));
  check('montar do estoque (placeFromStock)', fromStock.n === nF0 + 1 && fromStock.stock === stock.stock - 1, JSON.stringify(fromStock));
  check('sem camera:override; build:state início/fim e build:end', !evs.some((e) => e.n === 'camera:override') && evs.filter((e) => e.n === 'build:state' && e.p.active).length >= 3 && evs.filter((e) => e.n === 'build:end').length >= 3, JSON.stringify(evs.slice(0, 4)));

  // ---- largar caixa (build:box): calçada válida (ciano), rua inválida ----
  const bi = await page.evaluate(() => { const s = window.__game.state; const b = s.sidewalk[0]; b.carried = true; b.open = true; window.__game.bus.emit('stateChanged', { what: 'sidewalk' }); return 0; });
  await page.evaluate(([D]) => window.__world.lockCamera(6, 1.6, D + 0.6, 6, 0, D + 2.2), [D]);
  await page.evaluate((i) => window.__game.bus.emit('build:box', { boxIndex: i }), bi);
  await frames(3);
  const bp = await page.evaluate(() => window.__world.build.pose);
  await shot('largar-caixa');
  await page.evaluate(([D]) => window.__world.lockCamera(6, 1.6, D + 2.5, 6, 0, D + 5), [D]);
  await frames(3);
  const bpStreet = await page.evaluate(() => window.__world.build.pose);
  check('prévia da caixa: calçada válida, rua inválida', bp.kind === 'box' && bp.valid && !bpStreet.valid, JSON.stringify({ calc: [bp.bx.toFixed(2), bp.bz.toFixed(2), bp.valid], rua: [bpStreet.bx.toFixed(2), bpStreet.bz.toFixed(2), bpStreet.valid] }));
  await page.evaluate(([D]) => window.__world.lockCamera(6, 1.6, D + 0.6, 6, 0, D + 2.2), [D]);
  await frames(3);
  await tap('Colocar');
  await frames(2);
  const dropped = await page.evaluate(() => { const b = window.__game.state.sidewalk[0]; return { carried: !!b.carried, x: b.x, z: b.z, open: b.open }; });
  check('COLOCAR larga a caixa (dropBox) mantendo aberta', !dropped.carried && Number.isFinite(dropped.x) && dropped.open === true, JSON.stringify(dropped));

  await page.evaluate(() => window.__world.unlockCamera());
  check('sem erros de console', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server?.kill();
}
console.log(fails.length ? `\nFALHOU: ${fails.join('; ')}` : '\nOK');
process.exit(fails.length ? 1 : 0);
