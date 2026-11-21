// E2E integrado: dia completo (abrir loja -> clientes -> fechar -> relatório -> próximo dia -> persistência).
// Uso: npm run build && (npx vite preview --port 5175 &) && node tests/e2e/fullday.e2e.mjs
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const URL = process.env.NPC_URL ?? 'http://localhost:5175/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404|MIME type/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? 'PASS' : 'FAIL', n, x); if (!ok) fails.push(n); };

await page.goto(URL);
await page.waitForFunction(() => window.__game && window.__npc, null, { timeout: 30000 });
await page.getByText('Jogar', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
const s0 = await page.evaluate(() => ({ day: __game.state.day, money: __game.state.money }));
await page.evaluate(() => { __npc.timeScale = 20; __game.clock.openStore(); });
// espera o relógio fechar a loja e esvaziar -> relatório
await page.getByText('Próximo dia', { exact: false }).first().waitFor({ timeout: 170000 }).catch(() => {});
const rep = await page.evaluate(() => ({ phase: __game.clock.phase, day: __game.state.day, money: __game.state.money, text: document.body.innerText.slice(0, 2000) }));
check('relatório do dia apareceu', /Próximo dia/.test(rep.text));
check('relatório mostra lucro', /lucro/i.test(rep.text));
await page.getByText('Próximo dia', { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
const s1 = await page.evaluate(() => ({ day: __game.state.day, money: __game.state.money, phase: __game.clock.phase }));
check('avançou para o dia 2 em fase prep', s1.day === s0.day + 1 && s1.phase === 'prep', JSON.stringify(s1));
await page.reload();
await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
const s2 = await page.evaluate(() => ({ day: __game.state.day, money: __game.state.money }));
check('save persistiu após recarregar', s2.day === s1.day && s2.money === s1.money, JSON.stringify(s2));
check('sem erros de console', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(fails.length ? 'FALHAS: ' + fails.join(', ') : 'OK');
process.exit(fails.length ? 1 : 0);
