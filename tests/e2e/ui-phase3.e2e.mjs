// E2E da UI (Fase 3): HUD, carrinho (produto e móvel), pagamento em dinheiro e cartão via eventos, noite + Terminar o dia
// + resumo, comemoração de nível, missões, aberturas do tablet, placa da porta e aviso de orientação.
// Fase 4: no celular deitado o tablet ocupa a tela inteira; aviso de orientação não aparece no app nativo.
// Uso: npx vite build && (npx vite preview --port 5204 &) && node tests/e2e/ui-phase3.e2e.mjs   (UI3_URL e UI3_SHOTS configuráveis)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.UI3_URL ?? 'http://localhost:5204/';
const OUT = process.env.UI3_SHOTS ?? '/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/ui3/';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const fails = [];
const errors = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); if (!ok) fails.push(name); };

async function boot(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('404') && !t.includes('MIME type')) errors.push(`${w}x${h}: ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`${w}x${h} pageerror: ${e.message}`));
  await page.addInitScript(() => { try { localStorage.setItem('mercadinho:settings', JSON.stringify({ reduceMotion: true, quality: 'low' })); } catch { /* */ } });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && window.__ui, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  if (w > h) {
    await page.getByText('Jogar', { exact: true }).first().click();
    await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 });
  }
  // registra eventos para as verificações
  await page.evaluate(() => {
    window.__ev = [];
    for (const n of ['checkoutResult', 'checkout:display', 'build:start', 'ui:modal', 'stateChanged', 'levelUp']) window.__game.bus.on(n, (p) => window.__ev.push({ n, p }));
  });
  return { ctx, page };
}
const last = (page, n) => page.evaluate((n) => [...window.__ev].reverse().find((e) => e.n === n)?.p ?? null, n);
const rect = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; }, sel);
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

for (const [w, h] of [[844, 390], [740, 360], [1280, 720]]) {
  const tag = `${w}x${h}`;
  const { ctx, page } = await boot(w, h);

  /* ---------- 1) HUD ---------- */
  const badge = await page.locator('.day-badge').innerText();
  check(`[${tag}] HUD: selo do dia com "Dia 1" e hora`, /Dia 1/.test(badge) && /\d\d:\d\d/.test(badge), badge);
  check(`[${tag}] HUD: estrela de nível, XP, dinheiro e engrenagem`, (await page.locator('.lvl3 .xp3, .money3, .gear3').count()) === 3);
  check(`[${tag}] HUD: sem botões antigos (interação/atender/loja/tablet)`, (await page.locator('.interact-btn, .attend-btn, .store-btn, .fab').count()) === 0);
  const cr = await rect(page, '.cart-fab');
  check(`[${tag}] HUD: atalho de carrinho embaixo à esquerda (≥48px)`, !!cr && cr.x < w * 0.4 && cr.b > h * 0.75 && cr.w >= 48 && cr.h >= 48, JSON.stringify(cr));
  // não cobre a área do joystick do player (centro x 96–150, y = altura − 90..122, raio 58)
  const jd = cr ? Math.hypot(Math.max(0, cr.x - 150), Math.max(0, (h - 90) - cr.b, cr.y - (h - 90))) : 0;
  check(`[${tag}] atalho de carrinho ao lado do joystick, sem cobri-lo`, jd > 58, String(jd));
  const hb = await rect(page, '.hud3'), bd = await rect(page, '.day-badge');
  check(`[${tag}] HUD: selo do dia no centro do topo`, !!bd && Math.abs(bd.x + bd.w / 2 - w / 2) < 6 && bd.y < 20, JSON.stringify(bd));
  check(`[${tag}] missão inicial visível (0/1)`, /0\/1/.test(await page.locator('.mcard.mission').innerText()));
  const mtext = () => page.evaluate(() => document.querySelector('.mcard.mission')?.textContent ?? '');
  await shot(page, `${tag}-hud`);

  /* ---------- 2) Mercado com carrinho: produto ---------- */
  await page.evaluate(() => { window.__game.state.money = 900000; });
  await page.locator('.cart-fab').click();
  await page.waitForSelector('.t3', { timeout: 9000 });
  check(`[${tag}] carrinho abre o Mercado`, /Mercado/i.test(await page.locator('.t3-head h2').innerText()));
  const tr = await rect(page, '.t3-panel'), t3 = await rect(page, '.t3');
  if (h <= 520) { // Fase 4: no celular deitado o tablet ocupa a tela inteira e mostra o dinheiro no cabeçalho
    const cash = await page.locator('.t3-cash').innerText().catch(() => '');
    check(`[${tag}] tablet em tela inteira no celular, com o dinheiro no cabeçalho`, !!t3 && t3.x <= 1 && t3.y <= 1 && t3.r >= w - 1 && t3.b >= h - 1 && /R\$/.test(cash), JSON.stringify({ t3, cash }));
  } else check(`[${tag}] tablet abaixo do HUD e dentro da tela`, !!tr && tr.y >= hb.b - 1 && tr.b <= h + 1 && tr.r <= w + 1, JSON.stringify({ tr, hb }));
  check(`[${tag}] cartão de produto: ícone, móvel exigido e unidades por caixa`, (await page.locator('.pcard[data-product="arroz"] .pc-art .pic, .pcard[data-product="arroz"] .pc-furn svg, .pcard[data-product="arroz"] .pc-units').count()) === 3);
  const side0 = await page.evaluate(() => window.__game.state.sidewalk.length);
  await page.locator('.pcard[data-product="arroz"] .qty button[aria-label="Mais"]').click();
  await page.locator('.pcard[data-product="arroz"] .add').click();
  check(`[${tag}] Adicionar põe a linha no carrinho (2 cx)`, /2 cx/.test(await page.locator('.cart-lines').innerText()));
  const tot = await page.locator('#cart-total').innerText();
  check(`[${tag}] total do carrinho`, /R\$\s*[1-9]/.test(tot), tot);
  await shot(page, `${tag}-market`);
  await page.locator('#cart-buy').click();
  await page.waitForTimeout(300);
  const side1 = await page.evaluate(() => window.__game.state.sidewalk.length);
  check(`[${tag}] Comprar cria as caixas (entrega instantânea)`, side1 === side0 + 2, `${side0} -> ${side1}`);
  check(`[${tag}] missão avança para pegar a caixa`, /Pegue a caixa/.test(await mtext()));
  // aviso "Precisa de geladeira" para produto licenciado sem móvel compatível
  await page.evaluate(() => { const s = window.__game.state; if (!s.licenses.includes('bebidas')) s.licenses.push('bebidas'); window.__game.bus.emit('stateChanged', { what: 'license' }); });
  await page.waitForTimeout(150);
  const warn = await page.locator('.pcard[data-product="refri"] .pc-warn').innerText().catch(() => '');
  check(`[${tag}] produto sem móvel compatível avisa "Precisa de geladeira"`, /Precisa de geladeira/i.test(warn), warn);

  /* ---------- 2b) Móveis: compra vai para o estoque e inicia o posicionamento ---------- */
  await page.locator('.subtab[data-sub="furniture"]').click();
  await page.waitForTimeout(150);
  const fcards = await page.locator('.pcard[data-furniture]').count();
  check(`[${tag}] aba Móveis lista prateleira, geladeira e freezer`, (await page.locator('.pcard[data-furniture="shelf"], .pcard[data-furniture="fridge"], .pcard[data-furniture="freezer"]').count()) === 3, String(fcards));
  check(`[${tag}] móvel acima do nível mostra "Nível da loja N"`, (await page.locator('.pcard[data-furniture="freezer"] .abtn.lock').count()) === 1);
  check(`[${tag}] cartão de móvel mostra categorias aceitas`, /Aceita:.*Mercearia/.test(await page.locator('.pcard[data-furniture="shelf"]').innerText()));
  await shot(page, `${tag}-market-furniture`);
  await page.locator('.pcard[data-furniture="shelf"] .add').click();
  await page.locator('#cart-buy').click();
  await page.waitForTimeout(300);
  const bs = await last(page, 'build:start');
  const stock = await page.evaluate(() => window.__game.state.furnitureStock?.length ?? -1);
  check(`[${tag}] móvel comprado vai para o estoque e inicia build:start {type, stockIndex:0}`, !!bs && bs.type === 'shelf' && bs.stockIndex === 0 && stock === 1, JSON.stringify({ bs, stock }));
  check(`[${tag}] tablet fecha ao iniciar a montagem`, (await page.locator('.t3').count()) === 0);
  await page.keyboard.press('Escape'); // cancela o posicionamento do world (se houver)
  await page.evaluate(() => { window.__game.bus.emit('build:state', { active: false, kind: 'furniture' }); window.__game.bus.emit('build:end'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__game.bus.emit('ui:openTablet', { tab: 'furniture' }));
  await page.waitForSelector('#mk-stock', { timeout: 9000 }).catch(() => {});
  check(`[${tag}] "Para montar (1)" com botão Montar`, /Para montar \(1\)/.test(await page.locator('#mk-stock').innerText().catch(() => '')) && (await page.locator('#mk-stock .abtn').count()) === 1);
  // outras abas no visual novo
  for (const [tab, title] of [['licenses', 'Licenças'], ['staff', 'Funcionários'], ['services', 'Serviços'], ['upgrades', 'Melhorias']]) {
    await page.locator(`.rail-btn[data-tab="${tab}"]`).click();
    await page.waitForTimeout(120);
    check(`[${tag}] aba ${title} no visual novo`, (await page.locator('.t3-head h2').innerText()).toLowerCase() === title.toLowerCase() && (await page.locator('.bigcard').count()) > 0);
  }
  check(`[${tag}] Melhorias com 4 itens (carrinho, pote, capacidade, recicladora)`, (await page.locator('.bigcard[data-upgrade]').count()) === 4);
  if (w === 844) await shot(page, `${tag}-tab-staff`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.bus.emit('ui:openTablet', { tab: 'prices', productId: 'feijao' }));
  await page.waitForTimeout(250);
  check(`[${tag}] ui:openTablet {tab:'prices', productId} destaca o produto`, /Preços/i.test(await page.locator('.t3-head h2').innerText()) && (await page.locator('[data-product="feijao"].focus-hl').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  /* ---------- 3) Pagamento em dinheiro ---------- */
  await page.evaluate(() => window.__game.bus.emit('checkoutRequest', { customerId: 901, counterId: 1, items: [{ productId: 'arroz', qty: 1 }], total: 3785, method: 'cash', paid: 5000, stage: 'pay' }));
  await page.waitForSelector('.pay.cash', { timeout: 9000 });
  const modalEv = await last(page, 'ui:modal');
  check(`[${tag}] painel de troco abre como modal (ui:modal)`, !!modalEv && modalEv.open === true);
  check(`[${tag}] 5 notas e 5 moedas`, (await page.locator('.pay-row.bills .pay-den').count()) === 5 && (await page.locator('.pay-row.coins .pay-den').count()) === 5);
  const pr = await rect(page, '.pay');
  check(`[${tag}] painel à direita, abaixo do HUD e dentro da tela`, !!pr && pr.x > w * 0.45 && pr.y >= hb.b - 1 && pr.b <= h + 1, JSON.stringify(pr));
  const small = await page.evaluate(() => [...document.querySelectorAll('.pay button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && Math.min(r.width, r.height) < 44; }).length);
  check(`[${tag}] alvos do painel de troco ≥ 44px`, small === 0, String(small));
  await page.locator('.pay-den[data-den="5000"]').click();
  await page.locator('#pay-ok').click();
  await page.waitForTimeout(200);
  check(`[${tag}] troco errado não fecha o painel`, (await page.locator('.pay.cash').count()) === 1 && !(await last(page, 'checkoutResult')));
  await page.locator('.pay-act .pk.red').click();
  for (const d of [1000, 200, 10, 5]) await page.locator(`.pay-den[data-den="${d}"]`).click();
  const disp = await last(page, 'checkout:display');
  check(`[${tag}] checkout:display (cash) com recebido/total/troco/dando`, !!disp && disp.mode === 'cash' && disp.received === 5000 && disp.total === 3785 && disp.change === 1215 && disp.giving === 1215, JSON.stringify(disp));
  check(`[${tag}] 'Dando' verde quando igual ao troco`, await page.locator('#pay-giving.ok').count() === 1);
  await page.locator('.pay-act .pk.blue').click();
  check(`[${tag}] 'Dando' vermelho quando diferente do troco`, await page.locator('#pay-giving.bad').count() === 1);
  await page.locator('.pay-den[data-den="5"]').click();
  await shot(page, `${tag}-pay-cash`);
  await page.locator('#pay-ok').click();
  await page.waitForTimeout(250);
  const r1 = await last(page, 'checkoutResult');
  check(`[${tag}] checkoutResult ok com 1 erro`, !!r1 && r1.customerId === 901 && r1.ok === true && r1.mistakes === 1 && r1.speed >= 0 && r1.speed <= 1, JSON.stringify(r1));
  await page.waitForSelector('.pay', { state: 'detached', timeout: 3000 }).catch(() => {});

  /* ---------- 4) Pagamento no cartão ---------- */
  await page.evaluate(() => window.__game.bus.emit('checkoutRequest', { customerId: 902, counterId: 1, items: [{ productId: 'cafe', qty: 1 }], total: 2350, method: 'card', stage: 'pay' }));
  await page.waitForSelector('.pay.card', { timeout: 9000 });
  check(`[${tag}] maquininha com 1–9, apagar, 0, OK, C (sem vírgula)`, (await page.locator('.pay-pad .pk').count()) === 13);
  for (const k of ['2', '3', '5', '0']) await page.locator(`.pay-pad [data-key="${k}"]`).click();
  const d2 = await last(page, 'checkout:display');
  check(`[${tag}] checkout:display (card) com total e valor digitado`, !!d2 && d2.mode === 'card' && d2.total === 2350 && d2.typed === 2350, JSON.stringify(d2));
  check(`[${tag}] visor mostra R$ 23,50 (vírgula fixa)`, /23,50/.test(await page.locator('#pay-typed').innerText()));
  await shot(page, `${tag}-pay-card`);
  await page.locator('#pay-ok').click();
  await page.waitForTimeout(250);
  const r2 = await last(page, 'checkoutResult');
  check(`[${tag}] checkoutResult do cartão ok`, !!r2 && r2.customerId === 902 && r2.ok === true && r2.mistakes === 0, JSON.stringify(r2));
  await page.waitForSelector('.pay', { state: 'detached', timeout: 3000 }).catch(() => {});

  /* ---------- 5) Comemoração de nível ---------- */
  await page.evaluate(() => { window.__game.state.level = 3; });
  await page.waitForSelector('.cele:not(.summary)', { timeout: 9000 });
  const c1 = await page.locator('.cele').innerText();
  check(`[${tag}] comemoração: Parabéns — Nível 2 e "Agora disponível"`, /Parab/i.test(c1) && /Nível 2/i.test(c1) && /Agora disponível/i.test(c1) && (await page.locator('.cele .c-item').count()) >= 1, c1.slice(0, 120));
  check(`[${tag}] comemoração mostra o gerente comemorando`, (await page.locator('.cele .c-face svg.mgr').count()) === 1);
  await shot(page, `${tag}-levelup`);
  await page.locator('.cele .btn-go').click();
  await page.waitForTimeout(250);
  check(`[${tag}] comemoração em fila: depois vem o Nível 3`, /Nível 3/i.test(await page.locator('.cele').innerText().catch(() => '')));
  await page.locator('.cele .btn-go').click();
  await page.waitForTimeout(250);
  check(`[${tag}] "Continue jogando!" fecha a comemoração`, (await page.locator('.cele').count()) === 0);
  check(`[${tag}] ponto vermelho de novidade na estrela`, await page.locator('.lvl3 .dot').isVisible());
  await page.locator('.lvl3').click();
  await page.waitForSelector('.lvl-sheet', { timeout: 9000 });
  check(`[${tag}] folha de nível lista as novidades`, (await page.locator('.lvl-sheet .urow').count()) >= 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check(`[${tag}] ver as novidades apaga o ponto vermelho`, !(await page.locator('.lvl3 .dot').isVisible()));

  /* ---------- 6) Missões (só em uma resolução: avança por eventos) ---------- */
  if (w === 1280) {
    const mtx = mtext;
    const arrow = await page.evaluate(() => { const a = window.__game.scene.getObjectByName('ui-guide-arrow'); return !!a && a.visible; });
    check('[missões] seta 3D amarela visível sobre o alvo', arrow);
    await page.evaluate(() => window.__game.bus.emit('player:action', { kind: 'pickBox', productId: 'arroz' }));
    await page.waitForTimeout(150);
    check('[missões] "Abra a caixa e reponha a prateleira"', /Abra a caixa e reponha a prateleira/.test(await mtx()));
    await page.evaluate(() => window.__game.bus.emit('player:action', { kind: 'openBox', productId: 'arroz' }));
    await page.waitForTimeout(150);
    check('[missões] abrir a caixa conta 1/2', /1\/2/.test(await mtx()));
    await page.evaluate(() => window.__game.bus.emit('player:action', { kind: 'placeUnits', productId: 'arroz' }));
    await page.waitForTimeout(150);
    check('[missões] abrir a loja na placa', /placa/.test(await mtx()));
    await page.evaluate(() => window.__game.camera.lookAt(window.__game.camera.position.x, window.__game.camera.position.y, window.__game.camera.position.z + 50));
    await page.waitForTimeout(400);
    await shot(page, `${tag}-mission-sign`);
    await page.evaluate(() => window.__game.bus.emit('store:sign'));
    await page.waitForTimeout(400);
    check('[missões] placa abre a loja (store:sign)', await page.evaluate(() => window.__game.clock.phase === 'open'));
    check('[missões] 3 compras: 0/3', /0\/3/.test(await mtx()));
    for (const id of [1, 2, 2, 3]) await page.evaluate((id) => window.__game.bus.emit('checkout:done', { customerId: 9000 + id, counterId: 1, total: 100, tip: 0, method: 'cash', happy: true }), id);
    await page.waitForTimeout(150);
    check('[missões] checkout:done conta 1x por cliente e avança para o lixo', /lixo/.test(await mtx()));
    await page.evaluate(() => window.__game.bus.emit('player:action', { kind: 'discardBox' }));
    await page.waitForTimeout(400);
    check('[missões] mais 5 clientes', /0\/5/.test(await mtx()));
    for (let i = 0; i < 5; i++) await page.evaluate((i) => window.__game.bus.emit('checkout:done', { customerId: 9100 + i, counterId: 1, total: 100, tip: 0, method: 'card', happy: true }), i);
    await page.waitForTimeout(200);
    check('[missões] dica de preço: até 10% acima do mercado', /10% acima do mercado/.test(await mtx()));
    await page.evaluate(() => { const s = window.__game.state; s.prices.arroz = 99900; window.__game.bus.emit('stateChanged', { what: 'price' }); });
    await page.waitForTimeout(600);
    check('[missões] tutorial concluído', await page.evaluate(() => localStorage.getItem('mercadinho:tutorial') === 'done' && !document.querySelector('.mcard.mission')));
    // no expediente a placa só PAUSA a entrada (porta fechada), sem encerrar o dia; tocar de novo reabre
    await page.waitForTimeout(1100); // a placa ignora 2 toques em menos de 1 s
    await page.evaluate(() => window.__game.bus.emit('store:sign'));
    await page.waitForTimeout(300);
    check('[placa] no expediente fecha só a porta (pausa clientes), sem ir para a noite', await page.evaluate(() => window.__game.clock.phase === 'open' && window.__game.clock.doorsClosed === true && !window.__game.clock.signOpen));
    await page.waitForTimeout(1100);
    await page.evaluate(() => window.__game.bus.emit('store:sign'));
    await page.waitForTimeout(300);
    check('[placa] tocar de novo reabre a porta', await page.evaluate(() => window.__game.clock.phase === 'open' && window.__game.clock.doorsClosed === false));
  }

  /* ---------- 7) Noite + Terminar o dia + resumo ---------- */
  await page.evaluate(() => { const c = window.__game.clock; if (c.phase === 'prep') c.openStore(); if (c.phase === 'open') { c.minute = 21 * 60; c.closeStore(); } });
  await page.waitForSelector('#end-day', { timeout: 9000 });
  check(`[${tag}] noite: aviso "Nenhum cliente novo à noite" (com o botão Terminar o dia dentro)`, /Nenhum cliente novo/.test(await page.locator('.mcard.night').innerText()));
  await page.evaluate(() => window.__game.bus.emit('storeEmpty'));
  await page.waitForTimeout(400);
  check(`[${tag}] storeEmpty não abre o relatório sozinho`, (await page.locator('.summary').count()) === 0);
  await shot(page, `${tag}-night`);
  await page.evaluate(() => { const s = window.__game.state; s.ledger.revenue += 8808; s.ledger.cogs += 4000; s.ledger.served += 3; s.ledger.happy = (s.ledger.happy ?? 0) + 2; s.ledger.angry = (s.ledger.angry ?? 0) + 1; });
  await page.locator('#end-day').click();
  await page.waitForTimeout(300);
  if (await page.locator('.mx-dialog').count()) await page.locator('.mx-dialog .btn.primary').click(); // ainda havia clientes do npc
  await page.waitForSelector('.summary', { timeout: 9000 });
  const sum = await page.evaluate(() => ({ total: document.querySelector('#sum-total b')?.textContent, angry: document.querySelector('#sum-angry b')?.textContent, happy: document.querySelector('#sum-happy b')?.textContent, inc: document.querySelector('#sum-income')?.textContent, exp: document.querySelector('#sum-expense')?.textContent, prof: document.querySelector('#sum-profit')?.textContent }));
  check(`[${tag}] resumo: total/irritados/felizes e rendimento/despesa/lucro`, Number(sum.total) === Number(sum.angry) + Number(sum.happy) && Number(sum.happy) >= 2 && /R\$/.test(sum.inc ?? '') && /R\$/.test(sum.exp ?? '') && /R\$/.test(sum.prof ?? ''), JSON.stringify(sum));
  check(`[${tag}] resumo com gerente fazendo joinha`, (await page.locator('.summary .c-face svg.mgr').count()) === 1);
  await shot(page, `${tag}-summary`);
  await page.locator('#sum-details').click();
  await page.waitForSelector('.sum-sheet', { timeout: 9000 });
  check(`[${tag}] "Detalhes" mostra o relatório completo`, /Lucro líquido/.test(await page.locator('.sum-sheet').innerText()));
  if (w === 844) await shot(page, `${tag}-summary-details`);
  await page.locator('.sum-sheet .rp-foot .btn').click(); // o botão do rodapé dos detalhes também continua
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ phase: window.__game.clock.phase, day: window.__game.state.day, night: !!document.querySelector('.mcard.night, #end-day') }));
  check(`[${tag}] "Continue jogando!" começa o próximo dia`, after.phase === 'prep' && after.day === 2 && !after.night, JSON.stringify(after));
  await ctx.close();
}

/* ---------- 8) Aviso de orientação ---------- */
{
  const { ctx, page } = await boot(390, 844);
  const vis = await page.evaluate(() => getComputedStyle(document.querySelector('.rotate')).display !== 'none');
  check('[390x844] aviso "Gire o celular" em retrato', vis && /Gire o celular/.test(await page.locator('.rotate').innerText()));
  check('[390x844] relógio pausado em retrato', await page.evaluate(() => window.__game.clock.paused === true));
  await shot(page, '390x844-rotate');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  check('[844x390] aviso some em paisagem', await page.evaluate(() => getComputedStyle(document.querySelector('.rotate')).display === 'none'));
  await ctx.close();
}
/* ---------- 8b) Fase 4: no app nativo (Capacitor, paisagem travada pelo sistema) o aviso não aparece ---------- */
{
  // simular a ponte Android inteira faz o src/native.ts chamar plugins inexistentes: aqui o app nativo é simulado
  // trocando `Capacitor.isNativePlatform` e pedindo nova avaliação do aviso (o mesmo caminho de rotate.ts)
  const { ctx, page } = await boot(390, 844);
  check('[nativo] (controle) no navegador em retrato o aviso aparece', await page.evaluate(() => getComputedStyle(document.querySelector('.rotate')).display !== 'none'));
  await page.evaluate(() => { window.Capacitor = window.Capacitor ?? {}; window.Capacitor.isNativePlatform = () => true; window.__game.bus.emit('orientation:locked', { locked: false }); });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ shown: getComputedStyle(document.querySelector('.rotate')).display !== 'none', modal: window.__ui.kit.isModalOpen('rotate') }));
  check('[nativo] sem aviso "Gire o celular" no app (orientação travada), sem modal de orientação', !r.shown && !r.modal, JSON.stringify(r));
  await ctx.close();
}
/* ---------- 9) Fase 4 (QA): save ilegível → aviso + "Jogar"; Voltar do Android; placa com toque duplo; baixa do nível ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`qa pageerror: ${e.message}`));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('mercadinho:settings', JSON.stringify({ reduceMotion: true, quality: 'low' }));
    localStorage.setItem('mercadinho-sim:save:v1', '{"version":1, quebrado');
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && window.__ui, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const rec = await page.evaluate(() => ({ dlg: document.querySelector('.mx-dialog')?.textContent ?? '', key: localStorage.getItem('mercadinho:save-recovered'), btns: [...document.querySelectorAll('.title-screen .btn')].map((b) => b.textContent.trim()) }));
  check('[save] save ilegível: aviso claro e a chave some', /não pôde ser carregado/.test(rec.dlg) && /cópia/.test(rec.dlg) && rec.key === null, JSON.stringify(rec));
  check('[save] tela inicial sem "Continuar" quando o save é inválido', rec.btns.some((t) => /Jogar/.test(t)) && !rec.btns.some((t) => /Continuar/.test(t)), JSON.stringify(rec.btns));
  await page.locator('.mx-dialog .btn').click();
  await page.getByText('Jogar', { exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 });
  await page.evaluate(() => { window.__exit = 0; window.__game.bus.on('app:exit', () => { window.__exit++; }); });
  const backEv = () => page.evaluate(() => window.__game.bus.emit('ui:back'));
  await backEv(); await page.waitForTimeout(150);
  check('[voltar] sem painel: abre o menu de pausa', (await page.locator('.menu-card').count()) === 1);
  await backEv(); await page.waitForTimeout(150);
  check('[voltar] na pausa: pergunta "Sair do jogo?"', /Sair do jogo/.test(await page.locator('.mx-dialog').innerText().catch(() => '')));
  await backEv(); await page.waitForTimeout(150);
  check('[voltar] no diálogo: cancela (a pausa continua)', (await page.locator('.mx-dialog').count()) === 0 && (await page.locator('.menu-card').count()) === 1);
  await backEv(); await page.waitForTimeout(150);
  await page.locator('.mx-dialog .btn.danger').click();
  await page.waitForTimeout(150);
  check('[voltar] confirmar "Sair" emite app:exit', await page.evaluate(() => window.__exit === 1));
  await page.locator('.menu-card .btn.primary').first().click(); // Continuar
  await page.evaluate(() => window.__game.bus.emit('ui:openTablet', { tab: 'prices' }));
  await page.waitForSelector('.t3');
  await backEv(); await page.waitForTimeout(200);
  check('[voltar] com o tablet aberto: fecha o tablet', (await page.locator('.t3').count()) === 0 && (await page.locator('.menu-card').count()) === 0);
  await page.evaluate(() => { window.__game.bus.emit('store:sign'); window.__game.bus.emit('store:sign'); });
  await page.waitForTimeout(300);
  check('[placa] toque duplo abre a loja sem perguntar "Fechar a loja?"', await page.evaluate(() => window.__game.clock.phase === 'open' && !document.querySelector('.mx-dialog')));
  // baixa do nível só depois de "Continue jogando!"
  await page.evaluate(() => { window.__game.state.level = 2; });
  await page.waitForSelector('.cele:not(.summary)', { timeout: 9000 });
  check('[nível] sem baixa antes de "Continue jogando!"', await page.evaluate(() => window.__game.state.levelAck === 1));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__ui, null, { timeout: 30000 });
  await page.getByText('Continuar', { exact: true }).first().click();
  await page.waitForSelector('.cele:not(.summary)', { timeout: 9000 }).catch(() => {});
  check('[nível] comemoração não vista volta após recarregar', /Nível 2/i.test(await page.locator('.cele').innerText().catch(() => '')));
  await page.locator('.cele .btn-go').click();
  await page.waitForTimeout(300);
  check('[nível] "Continue jogando!" dá baixa (levelAck = 2)', await page.evaluate(() => window.__game.state.levelAck === 2));
  await ctx.close();
}

await browser.close();
check('sem erros de console', errors.length === 0, errors.slice(0, 6).join('\n'));
console.log(fails.length ? `\n${fails.length} FALHA(S):\n- ${fails.join('\n- ')}` : '\nTUDO OK');
process.exit(fails.length ? 1 : 0);
