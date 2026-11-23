// E2E "sem barra de rolagem" (Fase 4): em celular deitado com as barras do navegador (844×390, 800×360, 740×360 e
// 720×330) as telas do jogo cabem SEM rolagem do contêiner principal e dentro da tela: troco e maquininha
// (checkoutRequest stage 'pay'), tablet/Mercado (tela inteira no celular), Opções (com "Sensibilidade da câmera"),
// pausa, comemoração de nível, noite, resumo do dia e tela inicial. Teclas/botões visíveis ≥ 44 px.
// Uso: npx vite build && (npx vite preview --port 5204 &) && node tests/e2e/phone-fit.e2e.mjs   (NPC_URL; prints em UI4_SHOTS)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.NPC_URL ?? 'http://localhost:5204/';
const OUT = process.env.UI4_SHOTS ?? '/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/ui4/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [];
const errors = [];
const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); if (!ok) fails.push(n); };

/** Mede o contêiner `sel`: rolagem (scroll > client), dentro da tela, alvos < 44 px e descendentes cortados. */
const fit = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const vis = (e) => { const q = e.getBoundingClientRect(); const cs = getComputedStyle(e); return q.width > 0 && q.height > 0 && cs.visibility !== 'hidden'; };
  const small = [...el.querySelectorAll('button, input, select')].filter(vis)
    .filter((e) => { const q = e.getBoundingClientRect(); return Math.min(q.width, q.height) < 44; })
    .map((e) => `${e.className || e.tagName}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
  // botões fora da área visível do contêiner (cortados), exceto os de listas internas roláveis (podem rolar)
  const inScroller = (e) => {
    for (let a = e.parentElement; a && a !== el; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) || (/(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1)) return true;
    }
    return false;
  };
  const cut = [...el.querySelectorAll('button')].filter(vis).filter((e) => !inScroller(e)).filter((e) => {
    const q = e.getBoundingClientRect();
    return q.bottom > Math.min(r.bottom, innerHeight) + 1 || q.top < Math.max(r.top, 0) - 1 || q.right > Math.min(r.right, innerWidth) + 1;
  }).map((e) => (e.textContent || e.getAttribute('aria-label') || e.className).trim().slice(0, 18));
  const doc = document.scrollingElement;
  return {
    scroll: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1, sh: el.scrollHeight, ch: el.clientHeight,
    inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), small, cut,
    page: doc.scrollHeight > doc.clientHeight + 1 || doc.scrollWidth > doc.clientWidth + 1,
  };
}, sel);
const okFit = (r) => !!r && !r.scroll && r.inView && !r.small.length && !r.cut.length && !r.page;

for (const [w, h] of [[844, 390], [800, 360], [740, 360], [720, 330]]) {
  const tag = `${w}x${h}`;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000);
  p.on('console', (m) => { if (m.type() === 'error' && !/404|MIME type/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  await p.addInitScript(() => { try { localStorage.setItem('mercadinho:settings', JSON.stringify({ reduceMotion: true, quality: 'low' })); } catch { /* */ } });
  await p.goto(URL);
  await p.waitForFunction(() => window.__game && window.__ui, null, { timeout: 30000 });
  await p.waitForTimeout(400);
  const shot = (n) => (w === 720 || (w === 844 && /tablet|options/.test(n)) ? p.screenshot({ path: `${OUT}${tag}-${n}.png` }) : null);

  // tela inicial
  let r = await fit(p, '.title-screen');
  check(`[${tag}] tela inicial sem rolagem`, okFit(r), JSON.stringify(r));
  await p.getByText('Jogar', { exact: true }).first().click();
  await p.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 });
  await p.evaluate(() => { window.__game.state.money = 900000; });

  // troco
  await p.evaluate(() => window.__game.bus.emit('checkoutRequest', { customerId: 801, counterId: 1, items: [{ productId: 'arroz', qty: 1 }], total: 3785, method: 'cash', paid: 5000, stage: 'pay' }));
  await p.waitForSelector('.pay.cash', { timeout: 9000 });
  await p.waitForTimeout(250);
  r = await fit(p, '.pay');
  check(`[${tag}] troco: sem rolagem, na tela, teclas ≥ 44 px`, okFit(r), JSON.stringify(r));
  await shot('pay-cash');
  for (const d of [1000, 200, 10, 5]) await p.locator(`.pay-den[data-den="${d}"]`).click();
  await p.locator('#pay-ok').click();
  await p.waitForSelector('.pay', { state: 'detached', timeout: 4000 }).catch(() => {});

  // maquininha
  await p.evaluate(() => window.__game.bus.emit('checkoutRequest', { customerId: 802, counterId: 1, items: [{ productId: 'cafe', qty: 1 }], total: 2350, method: 'card', stage: 'pay' }));
  await p.waitForSelector('.pay.card', { timeout: 9000 });
  await p.waitForTimeout(250);
  r = await fit(p, '.pay');
  const keys = await p.locator('.pay-pad .pk').count();
  check(`[${tag}] maquininha: sem rolagem, na tela, 14 teclas ≥ 44 px`, okFit(r) && keys === 14, JSON.stringify({ r, keys }));
  await shot('pay-card');
  for (const k of ['2', '3', ',', '5']) await p.locator(`.pay-pad [data-key="${k}"]`).click();
  await p.locator('#pay-ok').click();
  await p.waitForSelector('.pay', { state: 'detached', timeout: 4000 }).catch(() => {});

  // tablet / Mercado em tela inteira
  await p.evaluate(() => window.__game.bus.emit('ui:openTablet', { tab: 'market' }));
  await p.waitForSelector('.t3', { timeout: 9000 });
  await p.waitForTimeout(250);
  const t = await fit(p, '.t3');
  check(`[${tag}] tablet ocupa a tela inteira`, !!t && t.x <= 1 && t.y <= 1 && t.w >= w - 2 && t.h >= h - 2, JSON.stringify(t));
  for (const sel of ['.tb-wrap', '.t3-panel', '.t3-body', '.mk-cart']) {
    r = await fit(p, sel);
    check(`[${tag}] Mercado ${sel}: sem rolagem e teclas ≥ 44 px`, okFit(r), JSON.stringify(r));
  }
  const cash = await p.locator('.t3-cash').innerText().catch(() => '');
  check(`[${tag}] tablet mostra o dinheiro no cabeçalho`, /R\$\s*9\.000/.test(cash), cash);
  await shot('tablet-market');
  await p.locator('.subtab[data-sub="furniture"]').click();
  await p.waitForTimeout(200);
  r = await fit(p, '.t3-body');
  check(`[${tag}] Mercado/Móveis: sem rolagem do painel`, okFit(r), JSON.stringify(r));
  await p.locator('.rail-btn[data-tab="prices"]').click();
  await p.waitForTimeout(200);
  const sb = await p.evaluate(() => { const e = document.querySelector('.t3-body'); return { bar: e.offsetWidth - e.clientWidth, sw: getComputedStyle(e).scrollbarWidth }; });
  check(`[${tag}] listas longas (Preços) rolam com barra discreta/oculta`, sb.bar <= 6, JSON.stringify(sb));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);

  // pausa e Opções
  await p.locator('button[aria-label="Menu"]').click();
  await p.waitForSelector('.menu-card', { timeout: 5000 });
  r = await fit(p, '.menu-card');
  check(`[${tag}] menu de pausa sem rolagem`, okFit(r), JSON.stringify(r));
  await p.locator('.menu-card .btn', { hasText: 'Opções' }).click();
  await p.waitForSelector('.opt-card', { timeout: 5000 });
  r = await fit(p, '.opt-card');
  check(`[${tag}] Opções sem rolagem (com sensibilidade da câmera)`, okFit(r) && (await p.locator('.opt-card input[type=range][aria-label="Sensibilidade da câmera"]').count()) === 1, JSON.stringify(r));
  await shot('options');
  await p.keyboard.press('Escape');
  await p.locator('.opt-card .btn.primary').click().catch(() => {});
  await p.waitForTimeout(150);
  await p.locator('.menu-card .icon-btn[aria-label="Fechar"]').first().click().catch(() => {});
  await p.waitForTimeout(150);

  // comemoração de nível
  await p.evaluate(() => { window.__game.state.level = 2; });
  await p.waitForSelector('.cele:not(.summary)', { timeout: 9000 });
  await p.waitForTimeout(300);
  r = await fit(p, '.cele');
  check(`[${tag}] comemoração sem rolagem e botão visível`, okFit(r), JSON.stringify(r));
  await shot('levelup');
  await p.locator('.cele .btn-go').click();
  await p.waitForTimeout(250);

  // noite
  await p.evaluate(() => { const c = window.__game.clock; if (c.phase === 'prep') c.openStore(); c.minute = 21 * 60; c.closeStore(); });
  await p.waitForSelector('#end-day', { timeout: 9000 });
  await p.waitForTimeout(300);
  const nc = await fit(p, '.mcard.night'), eb = await fit(p, '#end-day');
  check(`[${tag}] noite: aviso e "Terminar o dia" na tela, sem sobrepor`, !!nc && !!eb && nc.inView && eb.inView && eb.y >= nc.y + nc.h - 1 && eb.h >= 44, JSON.stringify({ nc, eb }));
  await shot('night');

  // resumo do dia
  await p.locator('#end-day').click();
  await p.waitForTimeout(300);
  if (await p.locator('.mx-dialog').count()) await p.locator('.mx-dialog .btn.primary').click();
  await p.waitForSelector('.summary', { timeout: 9000 });
  await p.waitForTimeout(300);
  r = await fit(p, '.summary');
  check(`[${tag}] resumo do dia sem rolagem e botões visíveis`, okFit(r), JSON.stringify(r));
  await shot('summary');
  await p.locator('#sum-details').click();
  await p.waitForSelector('.sum-sheet', { timeout: 5000 });
  r = await fit(p, '.sum-sheet');
  check(`[${tag}] detalhes do dia na tela (lista interna pode rolar)`, !!r && r.inView && !r.small.length && !r.page, JSON.stringify(r));
  await p.locator('.sum-sheet .rp-foot .btn').click();
  await p.waitForTimeout(250);
  check(`[${tag}] "Continue jogando!" começa o dia 2`, await p.evaluate(() => window.__game.state.day === 2 && window.__game.clock.phase === 'prep'));
  await ctx.close();
}
await b.close();
check('sem erros de console', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(fails.length ? `\n${fails.length} FALHA(S):\n- ${fails.join('\n- ')}` : '\nTUDO OK');
process.exit(fails.length ? 1 : 0);
