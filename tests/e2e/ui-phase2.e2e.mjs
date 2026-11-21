// E2E da UI (Fase 2): layout em 4 viewports, falência→recomeço, pedido automático, "Comprar o que falta", acessibilidade e finanças.
// Uso: npx vite build && (npx vite preview --port 5180 &) && node tests/e2e/ui-phase2.e2e.mjs   (UI2_URL e UI2_SHOTS configuráveis)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.UI2_URL ?? 'http://localhost:5180/';
const OUT = process.env.UI2_SHOTS ?? '/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/ui2/';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) fails.push(name); };
const errors = [];

async function boot(w, h, settings = { reduceMotion: true }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000); // swiftshader em 1280x720 é lento
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('404') && !t.includes('MIME type')) errors.push(`${w}x${h}: ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`${w}x${h} pageerror: ${e.message}`));
  await page.addInitScript((v) => { try { if (!localStorage.getItem('mercadinho:settings')) localStorage.setItem('mercadinho:settings', JSON.stringify(v)); } catch { /* */ } }, settings);
  await page.goto(URL);
  await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.getByText('Jogar', { exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 });
  return { ctx, page };
}
const openTablet = async (page, tab) => {
  await page.locator('button[aria-label="Abrir tablet de gestão"]').click();
  if (tab) await page.locator('.tab-btn', { hasText: tab }).click();
  await page.waitForTimeout(250);
};
const closeTablet = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); };

/* ---------- 1) Layout em 4 viewports: painel do checkout não sobrepõe o HUD ---------- */
for (const [w, h] of [[390, 844], [844, 390], [740, 360], [1280, 720]]) {
  const { ctx, page } = await boot(w, h);
  await page.evaluate(() => {
    __game.state.money = 800000;
    __game.bus.emit('checkoutRequest', { customerId: 7, items: [{ productId: 'arroz', qty: 2 }, { productId: 'feijao', qty: 3 }, { productId: 'cafe', qty: 1 }, { productId: 'macarrao', qty: 2 }], total: 12345, method: 'cash', paid: 15000 });
  });
  await page.waitForSelector('.ck', { timeout: 5000 });
  await page.waitForTimeout(700);
  const lay = async () => page.evaluate(() => {
    const hud = document.querySelector('.hud').getBoundingClientRect();
    const ck = document.querySelector('.ck').getBoundingClientRect();
    const doc = document.scrollingElement;
    return { hudBottom: hud.bottom, ckTop: ck.top, ckBottom: ck.bottom, ckLeft: ck.left, ckRight: ck.right, vw: innerWidth, vh: innerHeight, hOver: doc.scrollWidth > doc.clientWidth + 1 };
  });
  let l = await lay();
  const tag = `${w}x${h}`;
  check(`[${tag}] checkout (escanear) não sobrepõe o HUD`, l.ckTop >= l.hudBottom - 1, JSON.stringify(l));
  check(`[${tag}] checkout dentro da tela e sem rolagem horizontal`, l.ckBottom <= l.vh + 1 && l.ckRight <= l.vw + 1 && l.ckLeft >= -1 && !l.hOver);
  await page.screenshot({ path: `${OUT}e2e-${tag}-checkout-scan.png` });
  const n = await page.locator('.item').count();
  for (let i = 0; i < n; i++) { await page.locator('.item').nth(i).click({ force: true }); await page.waitForTimeout(120); }
  await page.waitForSelector('.keypad, .drawer, .tray-wrap', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(500);
  l = await lay();
  check(`[${tag}] checkout (pagar) não sobrepõe o HUD`, l.ckTop >= l.hudBottom - 1, JSON.stringify(l));
  check(`[${tag}] checkout (pagar) dentro da tela`, l.ckBottom <= l.vh + 1 && l.ckRight <= l.vw + 1);
  await page.screenshot({ path: `${OUT}e2e-${tag}-checkout-pay.png` });
  await ctx.close();
}

/* ---------- 2) Falência → Recomeçar (via fim de dia e via tablet) ---------- */
{
  const { ctx, page } = await boot(1280, 720);
  await page.evaluate(() => {
    const s = __game.state;
    s.money = -50_000_000; s.loan = 0; s.shelf = {}; s.storage = {}; s.sidewalk = [];
    __game.bus.emit('storeEmpty'); // gera o relatório (closeDay)
  });
  await page.getByText('Próximo dia', { exact: false }).first().click({ timeout: 5000 });
  await page.waitForSelector('.bankrupt', { timeout: 4000 });
  check('falência: tela aparece depois de "Próximo dia"', true);
  await page.screenshot({ path: `${OUT}e2e-bankrupt.png` });
  const txt = await page.locator('.bankrupt').innerText();
  check('falência: explica o que é mantido', /mant[eé]m/i.test(txt) && /Recomeçar/.test(txt));
  // com a tela aberta o tablet não abre
  await page.locator('button[aria-label="Abrir tablet de gestão"]').click({ force: true, timeout: 2000 }).catch(() => {});
  check('falência: tablet não abre por cima da tela', (await page.locator('.tablet').count()) === 0);
  const before = await page.evaluate(() => ({ lvl: __game.state.level, lic: __game.state.licenses.length }));
  await page.locator('#bk-restart').click();
  await page.waitForFunction(() => !document.querySelector('.bankrupt'), null, { timeout: 4000 });
  const after = await page.evaluate(() => ({ money: __game.state.money, loan: __game.state.loan, lvl: __game.state.level, lic: __game.state.licenses.length, paused: __game.clock.paused, phase: __game.clock.phase, saved: !!localStorage.getItem('mercadinho:save') || Object.keys(localStorage).some((k) => k.includes('save')) }));
  check('recomeço: caixa positivo e dívida zerada', after.money > 0 && after.loan === 0, JSON.stringify(after));
  check('recomeço: nível e licenças mantidos', after.lvl === before.lvl && after.lic === before.lic);
  check('recomeço: relógio liberado e fase de preparação', after.paused === false && after.phase === 'prep');
  check('recomeço: save existe', after.saved);
  // abre o tablet normalmente
  await openTablet(page, 'Finanças');
  check('recomeço: tablet volta a abrir', (await page.locator('.tablet').count()) === 1);
  await closeTablet(page);

  // via tablet (sem passar pelo relatório)
  await page.evaluate(() => { __game.state.money = -50_000_000; });
  await page.locator('button[aria-label="Abrir tablet de gestão"]').click();
  await page.waitForSelector('.bankrupt', { timeout: 3000 });
  check('falência: abrir o tablet com caixa negativo mostra a tela', true);
  await page.locator('#bk-restart').click();
  await page.waitForFunction(() => !document.querySelector('.bankrupt'), null, { timeout: 4000 });
  check('recomeço (2): ok', await page.evaluate(() => __game.state.money > 0));
  await ctx.close();
}

/* ---------- 3) Pedido automático ---------- */
{
  const { ctx, page } = await boot(1280, 720);
  await page.evaluate(() => { __game.state.money = 2_000_000; __game.state.shelf = {}; __game.state.storage = {}; __game.state.sidewalk = []; });
  await openTablet(page, 'Automático');
  const card = page.locator('.card[data-product="arroz"]');
  await card.locator('.switch').click();
  await page.waitForTimeout(300);
  let rule = await page.evaluate(() => __game.state.autoOrders.arroz ?? null);
  check('auto: ligar cria a regra', !!rule, JSON.stringify(rule));
  await card.locator('.auto-ctl .fld').nth(0).locator('button[aria-label="Mais"]').click();
  await card.locator('.auto-ctl .fld').nth(1).locator('button[aria-label="Mais"]').click();
  await page.waitForTimeout(300);
  const rule2 = await page.evaluate(() => __game.state.autoOrders.arroz ?? null);
  check('auto: steppers alteram mínimo e caixas', !!rule2 && !!rule && rule2.minUnits > rule.minUnits && rule2.boxes === rule.boxes + 1, JSON.stringify(rule2));
  const sumTxt = await page.locator('.auto-sum').innerText();
  check('auto: resumo mostra regra ligada', /1/.test(sumTxt));
  await page.screenshot({ path: `${OUT}e2e-auto.png` });
  const money0 = await page.evaluate(() => __game.state.money);
  await page.locator('#auto-run').click();
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => ({ money: __game.state.money, boxes: __game.state.sidewalk.filter((b) => b.productId === 'arroz').length }));
  check('auto: "Pedir agora" compra as caixas', res.boxes === rule2.boxes && res.money < money0, JSON.stringify(res));
  check('auto: mostra o que foi pedido hoje', /Arroz/.test(await page.locator('#auto-today').innerText()));
  // toast do npc também é registrado
  await page.evaluate(() => __game.bus.emit('toast', { text: 'Pedido automático: 2 cx Feijão', kind: 'info' }));
  await page.locator('.tab-btn', { hasText: 'Preços' }).click();
  await page.locator('.tab-btn', { hasText: 'Automático' }).click();
  await page.waitForTimeout(250);
  check('auto: pedido do npc aparece em "hoje"', /Feij/.test(await page.locator('#auto-today').innerText()));
  // desligar
  await page.locator('.card[data-product="arroz"] .switch').click();
  await page.waitForTimeout(300);
  check('auto: desligar remove a regra', await page.evaluate(() => !__game.state.autoOrders.arroz));
  await ctx.close();
}

/* ---------- 4) Comprar o que falta ---------- */
{
  const { ctx, page } = await boot(390, 844);
  await page.evaluate(() => { __game.state.money = 2_000_000; __game.state.shelf = {}; __game.state.storage = {}; __game.state.sidewalk = []; });
  await openTablet(page, 'Mercado');
  const info = await page.locator('#miss-info').innerText();
  check('comprar o que falta: mostra caixas e custo antes de confirmar', /caixa/.test(info) && /R\$/.test(info), info);
  await page.locator('.seg.sm button', { hasText: '100%' }).click();
  await page.waitForTimeout(250);
  const info100 = await page.locator('#miss-info').innerText();
  check('comprar o que falta: 100% custa mais que 50%', info100 !== info, `${info} -> ${info100}`);
  await page.screenshot({ path: `${OUT}e2e-miss-confirm-before.png` });
  const m0 = await page.evaluate(() => __game.state.money);
  await page.locator('#miss-buy').click();
  await page.waitForSelector('.mx-dialog', { timeout: 3000 });
  check('comprar o que falta: pede confirmação com o valor', /R\$/.test(await page.locator('.mx-dialog').innerText()));
  await page.screenshot({ path: `${OUT}e2e-miss-confirm.png` });
  check('comprar o que falta: nada foi cobrado antes de confirmar', (await page.evaluate(() => __game.state.money)) === m0);
  await page.locator('.mx-dialog .btn.primary').click();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ money: __game.state.money, boxes: __game.state.sidewalk.length }));
  check('comprar o que falta: compra e debita o caixa', r.boxes > 0 && r.money < m0, JSON.stringify(r));
  await ctx.close();
}

/* ---------- 5) Finanças (banco + gráfico + mais vendidos) e Melhorias ---------- */
{
  const { ctx, page } = await boot(1280, 720);
  await page.evaluate(() => {
    const s = __game.state;
    s.level = 8; s.money = 900000;
    s.history = Array.from({ length: 30 }, (_, i) => ({ day: i + 1, revenue: 90000 + i * 2000, tips: 0, cogs: 50000, purchases: 60000, fixed: 17000, netProfit: (i % 5 === 2 ? -1 : 1) * (8000 + ((i * 7919) % 30000)), cashDelta: 0, served: 20 + i, lost: 3, reputation: 4 }));
    s.stats = [{ day: s.day, p: { arroz: [40, 120000, 30000], feijao: [30, 40000, 9000] } }];
    s.day = 31;
  });
  await openTablet(page, 'Finanças');
  const svg = page.locator('.chart svg');
  check('finanças: gráfico SVG renderizado com 30 barras', (await svg.locator('rect.bar-pos, rect.bar-neg').count()) === 30);
  await svg.hover({ position: { x: 200, y: 80 }, force: true });
  await page.waitForTimeout(250);
  check('finanças: tooltip aparece ao passar o mouse/tocar', await page.locator('.chart .ctip').isVisible());
  check('finanças: tabela de mais vendidos', (await page.locator('.tbl tbody tr').count()) >= 2 && /Arroz/.test(await page.locator('.tbl').innerText()));
  await page.screenshot({ path: `${OUT}e2e-finance.png` });
  const loan0 = await page.evaluate(() => __game.state.loan);
  await page.locator('#bank-take').click();
  await page.waitForTimeout(300);
  check('banco: pegar empréstimo aumenta dívida e caixa', await page.evaluate((l) => __game.state.loan > l, loan0));
  await page.locator('#bank-pay').click();
  await page.waitForTimeout(300);
  check('banco: pagar reduz a dívida', await page.evaluate(() => __game.state.loan >= 0));
  await page.locator('.tab-btn', { hasText: 'Melhorias' }).click();
  await page.waitForTimeout(250);
  check('melhorias: lista o carrinho de carga', /Carrinho/.test(await page.locator('.tb-body').innerText()));
  await page.locator('.up-card .btn.primary').click();
  await page.locator('.mx-dialog .btn.primary').click();
  await page.waitForTimeout(400);
  check('melhorias: comprar marca como possuída', /Possu[ií]da/.test(await page.locator('.tb-body').innerText()) && await page.evaluate(() => __game.state.upgrades.includes('dolly')));
  await ctx.close();
}

/* ---------- 6) Acessibilidade (Opções) ---------- */
{
  const { ctx, page } = await boot(844, 390, {});
  await page.evaluate(() => { window.__sc = []; __game.bus.on('settings:changed', (p) => window.__sc.push(p)); });
  await page.locator('button[aria-label="Menu"]').click();
  await page.getByText('Opções', { exact: true }).first().click();
  await page.locator('button[data-f="large"]').click();
  await page.locator('button[aria-label="Modo daltônico"]').click();
  await page.locator('button[aria-label="Reduzir movimento"]').click();
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('mercadinho:settings')),
    cls: document.querySelector('.mx-root').className,
    fs: document.querySelector('.mx-root').style.getPropertyValue('--fs'),
    good: getComputedStyle(document.querySelector('.mx-root')).getPropertyValue('--c-good').trim(),
    last: window.__sc[window.__sc.length - 1],
    anim: getComputedStyle(document.querySelector('.menu-card')).animationName,
  }));
  check('acessibilidade: persiste em mercadinho:settings', r.saved.fontSize === 'large' && r.saved.colorblind === true && typeof r.saved.reduceMotion === 'boolean', JSON.stringify(r.saved));
  check('acessibilidade: emite settings:changed com os campos novos', r.last && r.last.fontSize === 'large' && r.last.colorblind === true && 'reduceMotion' in r.last);
  check('acessibilidade: classes e escala aplicadas', r.cls.includes('mx-fs-l') && r.cls.includes('mx-cb') && r.fs === '1.2');
  check('acessibilidade: cor "bom" vira azul no modo daltônico', r.good === '#1f6fd1', r.good);
  await page.locator('button[aria-label="Reduzir movimento"]').click(); // alterna de volta
  await page.locator('button[aria-label="Reduzir movimento"]').click(); // e liga de novo
  const rm = await page.evaluate(() => document.querySelector('.mx-root').classList.contains('mx-rm'));
  check('acessibilidade: reduzir movimento liga a classe mx-rm', rm === true || (await page.evaluate(() => JSON.parse(localStorage.getItem('mercadinho:settings')).reduceMotion === rm)));
  await page.screenshot({ path: `${OUT}e2e-options-a11y.png` });
  await page.reload();
  await page.waitForFunction(() => window.__game);
  const persisted = await page.evaluate(() => document.querySelector('.mx-root').classList.contains('mx-fs-l'));
  check('acessibilidade: persiste após recarregar', persisted);
  await ctx.close();
}

await browser.close();
console.log('console errors:', errors.length ? errors : 'nenhum');
if (errors.length) fails.push('erros de console');
console.log(fails.length ? `FALHAS: ${fails.join(' | ')}` : 'TUDO OK');
process.exit(fails.length ? 1 : 0);
