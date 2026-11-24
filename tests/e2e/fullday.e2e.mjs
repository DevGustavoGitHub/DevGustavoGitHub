// E2E integrado (fluxo da Fase 3/4): abrir a loja pela placa (evento store:sign) -> clientes -> 21:00 noite ->
// "Terminar o dia" -> resumo -> "Continue jogando!" -> dia 2 em 'prep' -> recarregar a página -> save persistiu (dia e dinheiro).
// Uso: npx vite build && (npx vite preview --port 5204 &) && node tests/e2e/fullday.e2e.mjs   (NPC_URL configurável)
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.NPC_URL ?? 'http://localhost:5204/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404|MIME type/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => { try { if (!localStorage.getItem('mercadinho:settings')) localStorage.setItem('mercadinho:settings', JSON.stringify({ quality: 'low', reduceMotion: true })); } catch { /* */ } });
const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); if (!ok) fails.push(n); };

await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__npc && window.__ui, null, { timeout: 30000 });
await page.getByText('Jogar', { exact: true }).first().click({ timeout: 5000 });
await page.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 });
const s0 = await page.evaluate(() => ({ day: __game.state.day, money: __game.state.money, phase: __game.clock.phase }));
check('começa o dia 1 em preparação', s0.phase === 'prep', JSON.stringify(s0));

// abre pela placa da porta (o player emite store:sign; a UI abre direto) e acelera o dia
await page.evaluate(() => { __npc.timeScale = 20; __game.bus.emit('store:sign'); });
await page.waitForTimeout(400);
check('placa (store:sign) abre a loja', await page.evaluate(() => __game.clock.phase === 'open'));

// 21:00: noite + botão "Terminar o dia" (o resumo NÃO abre sozinho)
await page.waitForSelector('#end-day', { timeout: 170000 }).catch(() => {});
const night = await page.evaluate(() => ({ phase: __game.clock.phase, card: document.querySelector('.mcard.night')?.textContent ?? '', btn: !!document.querySelector('#end-day') }));
check('noite: aviso e botão "Terminar o dia"', night.btn && night.phase === 'closing' && /Nenhum cliente novo/.test(night.card), JSON.stringify(night));
const served = await page.evaluate(() => __npc.stats?.served ?? __game.state.ledger.served);
console.log('  clientes atendidos/registrados no dia:', JSON.stringify(served));
await page.waitForTimeout(1500);
check('resumo não abre sozinho à noite', (await page.locator('.summary').count()) === 0);

// Terminar o dia (confirma se ainda houver clientes) -> resumo
await page.locator('#end-day').click();
await page.waitForTimeout(400);
if (await page.locator('.mx-dialog').count()) await page.locator('.mx-dialog .btn.primary').click();
await page.waitForSelector('.summary', { timeout: 15000 }).catch(() => {});
const rep = await page.evaluate(() => ({ phase: __game.clock.phase, text: document.querySelector('.summary')?.textContent ?? '', profit: document.querySelector('#sum-profit')?.textContent ?? '' }));
check('resumo do dia apareceu', /Dia 1 conclu/i.test(rep.text) && rep.phase === 'report', JSON.stringify({ phase: rep.phase, t: rep.text.slice(0, 80) }));
check('resumo mostra rendimento, despesa e lucro', /Rendimento/.test(rep.text) && /Despesa/.test(rep.text) && /Lucro/.test(rep.text) && /R\$/.test(rep.profit), rep.profit);

// Continue jogando! -> dia 2 em preparação
await page.locator('#sum-next').click();
await page.waitForTimeout(800);
const s1 = await page.evaluate(() => ({ day: __game.state.day, money: __game.state.money, phase: __game.clock.phase }));
check('"Continue jogando!" avança para o dia 2 em fase prep', s1.day === s0.day + 1 && s1.phase === 'prep' && (await page.locator('.summary').count()) === 0, JSON.stringify(s1));

// recarrega: o save persistiu (dia e dinheiro)
await page.reload();
await page.waitForFunction(() => window.__game && window.__ui, null, { timeout: 30000 });
const s2 = await page.evaluate(() => ({ day: __game.state.day, money: __game.state.money, cont: [...document.querySelectorAll('.title-screen .btn')].some((b) => /Continuar/.test(b.textContent)) }));
check('save persistiu após recarregar (dia e dinheiro)', s2.day === s1.day && s2.money === s1.money, JSON.stringify({ s1, s2 }));
check('tela inicial oferece "Continuar"', s2.cont);
await browser.close();
check('sem erros de console', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(fails.length ? 'FALHAS: ' + fails.join(', ') : 'OK');
process.exit(fails.length ? 1 : 0);
