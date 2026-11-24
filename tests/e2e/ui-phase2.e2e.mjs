// E2E da UI (Fase 2, atualizado na Fase 4 para o fluxo atual): falência → recomeço (via Terminar o dia → resumo e via
// tablet), pedido automático, "Encher prateleiras" (antigo "Comprar o que falta"), finanças (banco, gráfico, mais
// vendidos), melhorias, preços (sugerido = api.suggestedPrice) e acessibilidade/Opções (com sensibilidade da câmera).
// A verificação de layout do checkout antigo saiu (o painel de pagamento atual é medido em phone-fit.e2e.mjs).
// Uso: npx vite build && (npx vite preview --port 5204 &) && node tests/e2e/ui-phase2.e2e.mjs   (UI2_URL e UI2_SHOTS configuráveis)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const URL = process.env.UI2_URL ?? 'http://localhost:5204/';
const OUT = process.env.UI2_SHOTS ?? '/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/ui2/';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const fails = [];
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); if (!ok) fails.push(name); };
const errors = [];

async function boot(w, h, settings = { reduceMotion: true, quality: 'low' }) {
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
  await page.waitForFunction(() => window.__game && window.__ui, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.getByText('Jogar', { exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 });
  return { ctx, page };
}
/** Abre o computador (atalho do carrinho) e vai para a aba `tab` (id do trilho). */
const openTablet = async (page, tab) => {
  if (!(await page.locator('.t3').count())) { // comprar produtos não fecha o tablet: só abre se estiver fechado
    await page.locator('.cart-fab').click();
    await page.waitForSelector('.t3', { timeout: 9000 }).catch(() => {});
  }
  if (tab) await page.locator(`.rail-btn[data-tab="${tab}"]`).click();
  await page.waitForTimeout(250);
};
const closeTablet = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); };

/* ---------- 1) Falência → Recomeçar (via Terminar o dia → resumo e via tablet) ---------- */
{
  const { ctx, page } = await boot(1280, 720);
  await page.evaluate(() => { const s = __game.state; s.money = -50_000_000; s.loan = 0; s.shelf = {}; s.storage = {}; s.sidewalk = []; });
  await page.evaluate(() => __ui.endDay()); // fase prep: pede confirmação
  await page.locator('.mx-dialog .btn.primary').click();
  await page.waitForSelector('.summary', { timeout: 9000 });
  await page.locator('#sum-next').click();
  await page.waitForSelector('.bankrupt', { timeout: 4000 }).catch(() => {});
  check('falência: tela aparece depois de "Continue jogando!"', (await page.locator('.bankrupt').count()) === 1);
  await page.screenshot({ path: `${OUT}e2e-bankrupt.png` });
  const txt = await page.locator('.bankrupt').innerText().catch(() => '');
  check('falência: explica o que é mantido', /mant[eé]m/i.test(txt) && /Recomeçar/.test(txt), txt.slice(0, 200));
  await page.locator('.cart-fab').click({ force: true, timeout: 2000 }).catch(() => {});
  check('falência: tablet não abre por cima da tela', (await page.locator('.t3').count()) === 0);
  const before = await page.evaluate(() => ({ lvl: __game.state.level, lic: __game.state.licenses.length }));
  await page.locator('#bk-restart').click();
  await page.waitForFunction(() => !document.querySelector('.bankrupt'), null, { timeout: 4000 });
  const after = await page.evaluate(() => ({ money: __game.state.money, loan: __game.state.loan, lvl: __game.state.level, lic: __game.state.licenses.length, paused: __game.clock.paused, phase: __game.clock.phase, saved: Object.keys(localStorage).some((k) => k.includes('save')) }));
  check('recomeço: caixa positivo e dívida zerada', after.money > 0 && after.loan === 0, JSON.stringify(after));
  check('recomeço: nível e licenças mantidos', after.lvl === before.lvl && after.lic === before.lic);
  check('recomeço: relógio liberado e fase de preparação', after.paused === false && after.phase === 'prep', JSON.stringify(after));
  check('recomeço: save existe', after.saved);
  await openTablet(page, 'finance');
  check('recomeço: tablet volta a abrir', (await page.locator('.t3').count()) === 1);
  await closeTablet(page);
  // via tablet (sem passar pelo resumo)
  await page.evaluate(() => { __game.state.money = -50_000_000; });
  await page.locator('.cart-fab').click();
  await page.waitForSelector('.bankrupt', { timeout: 3000 }).catch(() => {});
  check('falência: abrir o tablet com caixa negativo mostra a tela', (await page.locator('.bankrupt').count()) === 1);
  await page.locator('#bk-restart').click();
  await page.waitForFunction(() => !document.querySelector('.bankrupt'), null, { timeout: 4000 });
  check('recomeço (2): ok', await page.evaluate(() => __game.state.money > 0));
  await ctx.close();
}

/* ---------- 2) Pedido automático ---------- */
{
  const { ctx, page } = await boot(1280, 720);
  await page.evaluate(() => { __game.state.money = 2_000_000; __game.state.shelf = {}; __game.state.storage = {}; __game.state.sidewalk = []; });
  await openTablet(page, 'auto');
  const card = page.locator('.card[data-product="arroz"]');
  await card.locator('.switch').click();
  await page.waitForTimeout(300);
  const rule = await page.evaluate(() => __game.state.autoOrders.arroz ?? null);
  check('auto: ligar cria a regra', !!rule, JSON.stringify(rule));
  await card.locator('.auto-ctl .fld').nth(0).locator('button[aria-label="Mais"]').click();
  await card.locator('.auto-ctl .fld').nth(1).locator('button[aria-label="Mais"]').click();
  await page.waitForTimeout(300);
  const rule2 = await page.evaluate(() => __game.state.autoOrders.arroz ?? null);
  check('auto: steppers alteram mínimo e caixas', !!rule2 && !!rule && rule2.minUnits > rule.minUnits && rule2.boxes === rule.boxes + 1, JSON.stringify(rule2));
  check('auto: resumo mostra regra ligada', /1/.test(await page.locator('.auto-sum').innerText()));
  await page.screenshot({ path: `${OUT}e2e-auto.png` });
  const money0 = await page.evaluate(() => __game.state.money);
  await page.locator('#auto-run').click();
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => ({ money: __game.state.money, boxes: __game.state.sidewalk.filter((b) => b.productId === 'arroz').length }));
  check('auto: "Pedir agora" compra as caixas', res.boxes === rule2.boxes && res.money < money0, JSON.stringify(res));
  check('auto: mostra o que foi pedido hoje', /Arroz/.test(await page.locator('#auto-today').innerText()));
  await page.evaluate(() => __game.bus.emit('toast', { text: 'Pedido automático: 2 cx Feijão', kind: 'info' }));
  await page.locator('.rail-btn[data-tab="prices"]').click();
  await page.locator('.rail-btn[data-tab="auto"]').click();
  await page.waitForTimeout(250);
  check('auto: pedido do npc aparece em "hoje"', /Feij/.test(await page.locator('#auto-today').innerText()));
  await page.locator('.card[data-product="arroz"] .switch').click();
  await page.waitForTimeout(300);
  check('auto: desligar remove a regra', await page.evaluate(() => !__game.state.autoOrders.arroz));
  await ctx.close();
}

/* ---------- 3) "Encher prateleiras" (substitui "Comprar o que falta") e Preços ---------- */
{
  const { ctx, page } = await boot(844, 390);
  await page.evaluate(() => { const s = __game.state; s.money = 2_000_000; s.sidewalk = []; s.storage = {}; for (const f of s.furniture) for (const l of f.levels ?? []) l.units = 0; s.shelf = {}; __game.bus.emit('stateChanged', { what: 'shelf' }); });
  await openTablet(page, 'market');
  await page.locator('#mk-fill').click();
  await page.waitForTimeout(250);
  const lines = await page.locator('.cart-lines .cline').count();
  check('encher prateleiras: põe no carrinho o que falta (antes de cobrar)', lines > 0, String(lines));
  const m0 = await page.evaluate(() => __game.state.money);
  check('encher prateleiras: nada é cobrado antes de comprar', (await page.evaluate(() => __game.state.money)) === m0);
  await page.screenshot({ path: `${OUT}e2e-fill-cart.png` });
  await page.locator('#cart-buy').click();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ money: __game.state.money, boxes: __game.state.sidewalk.length }));
  check('encher prateleiras: Comprar cria as caixas e debita o caixa', r.boxes > 0 && r.money < m0, JSON.stringify(r));
  // Preços: sugerido = api.suggestedPrice (média de mercado na Fase 4) e selo "Justo"
  await page.evaluate(() => { const s = __game.state; s.prices.arroz = 99900; __game.bus.emit('stateChanged', { what: 'price' }); });
  await openTablet(page, 'prices');
  check('preços: preço muito alto aparece como "Abusivo"', /Abusivo/.test(await page.locator('.card[data-product="arroz"]').innerText()));
  await page.locator('#price-all').click();
  await page.waitForTimeout(300);
  const pr = await page.evaluate(() => {
    const s = __game.state, card = document.querySelector('.card[data-product="arroz"]');
    return { set: s.prices.arroz, sug: Number(card?.querySelector('[data-sug]')?.getAttribute('data-sug')), text: card?.textContent ?? '' };
  });
  check('preços: "Definir todos no sugerido" usa o preço sugerido', pr.set === pr.sug && pr.sug > 0, JSON.stringify(pr));
  check('preços: no sugerido o selo é "Justo"', /Justo/.test(pr.text) && /Preço sugerido/.test(pr.text), pr.text.slice(0, 160));
  await page.screenshot({ path: `${OUT}e2e-prices.png` });
  await ctx.close();
}

/* ---------- 4) Finanças (banco + gráfico + mais vendidos) e Melhorias ---------- */
{
  const { ctx, page } = await boot(1280, 720);
  await page.evaluate(() => {
    const s = __game.state;
    s.level = 8; s.levelAck = 8; s.money = 900000; // levelAck: sem comemorações de nível nesta seção
    s.history = Array.from({ length: 30 }, (_, i) => ({ day: i + 1, revenue: 90000 + i * 2000, tips: 0, cogs: 50000, purchases: 60000, fixed: 17000, netProfit: (i % 5 === 2 ? -1 : 1) * (8000 + ((i * 7919) % 30000)), cashDelta: 0, served: 20 + i, lost: 3, reputation: 4 }));
    s.stats = [{ day: s.day, p: { arroz: [40, 120000, 30000], feijao: [30, 40000, 9000] } }];
    s.day = 31;
  });
  await openTablet(page, 'finance');
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
  check('banco: pegar empréstimo aumenta a dívida', await page.evaluate((l) => __game.state.loan > l, loan0));
  await page.locator('#bank-pay').click();
  await page.waitForTimeout(300);
  check('banco: pagar reduz a dívida', await page.evaluate(() => __game.state.loan >= 0));
  await page.locator('.rail-btn[data-tab="upgrades"]').click();
  await page.waitForTimeout(250);
  check('melhorias: lista o carrinho de carga', /Carrinho/i.test(await page.locator('.t3-body').innerText()));
  await page.locator('.bigcard[data-upgrade="dolly"] .abtn').click();
  await page.locator('.mx-dialog .btn.primary').click();
  await page.waitForTimeout(400);
  check('melhorias: comprar marca como possuída', await page.evaluate(() => __game.state.upgrades.includes('dolly')) && (await page.locator('.bigcard[data-upgrade="dolly"].owned').count()) === 1);
  await ctx.close();
}

/* ---------- 5) Acessibilidade e Opções (inclui sensibilidade da câmera) ---------- */
{
  const { ctx, page } = await boot(844, 390, {});
  await page.evaluate(() => { window.__sc = []; __game.bus.on('settings:changed', (p) => window.__sc.push(p)); });
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.menu-card .btn', { hasText: 'Opções' }).click();
  await page.locator('button[data-f="large"]').click();
  await page.locator('button[aria-label="Modo daltônico"]').click();
  await page.locator('button[aria-label="Reduzir movimento"]').click();
  const look = page.locator('input[aria-label="Sensibilidade da câmera"]');
  const lk0 = await look.evaluate((e) => ({ min: e.min, max: e.max, v: e.value }));
  check('opções: sensibilidade 0,4–2,0 com padrão 1,0', lk0.min === '0.4' && lk0.max === '2' && Number(lk0.v) === 1, JSON.stringify(lk0));
  await look.evaluate((e) => { e.value = '1.6'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('mercadinho:settings')),
    cls: document.querySelector('.mx-root').className,
    fs: document.querySelector('.mx-root').style.getPropertyValue('--fs'),
    good: getComputedStyle(document.querySelector('.mx-root')).getPropertyValue('--c-good').trim(),
    last: window.__sc[window.__sc.length - 1],
    out: document.querySelector('#opt-look-v')?.textContent,
  }));
  check('acessibilidade: persiste em mercadinho:settings', r.saved.fontSize === 'large' && r.saved.colorblind === true && typeof r.saved.reduceMotion === 'boolean', JSON.stringify(r.saved));
  check('opções: lookSensitivity salva e emitida em settings:changed', r.saved.lookSensitivity === 1.6 && r.last?.lookSensitivity === 1.6 && r.out === '1,6×', JSON.stringify({ s: r.saved.lookSensitivity, e: r.last?.lookSensitivity, out: r.out }));
  check('acessibilidade: emite settings:changed com os campos', !!r.last && r.last.fontSize === 'large' && r.last.colorblind === true && 'reduceMotion' in r.last);
  check('acessibilidade: classes e escala aplicadas', r.cls.includes('mx-fs-l') && r.cls.includes('mx-cb') && r.fs === '1.2', r.cls);
  check('acessibilidade: cor "bom" vira azul no modo daltônico', r.good === '#1f6fd1', r.good);
  await page.screenshot({ path: `${OUT}e2e-options-a11y.png` });
  await page.keyboard.press('Escape'); // Esc fecha só as Opções (a pausa continua)
  await page.waitForTimeout(150);
  check('opções: Esc fecha as Opções e mantém a pausa', (await page.locator('.opt-card').count()) === 0 && (await page.locator('.menu-card').count()) === 1);
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__ui);
  const persisted = await page.evaluate(() => ({ fs: document.querySelector('.mx-root').classList.contains('mx-fs-l'), look: JSON.parse(localStorage.getItem('mercadinho:settings')).lookSensitivity }));
  check('acessibilidade e sensibilidade persistem após recarregar', persisted.fs && persisted.look === 1.6, JSON.stringify(persisted));
  await ctx.close();
}

await browser.close();
check('sem erros de console', errors.length === 0, errors.slice(0, 6).join('\n'));
console.log(fails.length ? `\n${fails.length} FALHA(S):\n- ${fails.join('\n- ')}` : '\nTUDO OK');
process.exit(fails.length ? 1 : 0);
