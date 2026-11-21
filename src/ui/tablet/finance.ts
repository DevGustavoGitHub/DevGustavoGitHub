/** Aba Finanças: banco (empréstimo), gráfico de lucro (30 dias), produtos mais vendidos e resumo do dia. */
import * as api from '../../sim/api';
import { productById } from '../../sim/catalog';
import { dailyWages } from '../../sim/economy';
import { chartLegend, profitChart } from '../chart';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { safe } from '../safe';
import { badge, kv, sectionTitle, signed, stepper } from '../widgets';
import type { TabApi } from './index';

const STEP = 10000; // R$ 100
let takeAmt = 100000;
let payAmt = 50000;

/** Caixa que mal cobre 2 dias de despesas fixas. */
export const lowCashLimit = (s: { rent: number } & Parameters<typeof dailyWages>[0]): number => (s.rent + dailyWages(s)) * 2;

function bankCard(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  const info = safe(() => api.loanInfo(s), null);
  const card = h('div', { class: 'card', id: 'bank-card' }, sectionTitle('Banco', info.v ? badge(info.v.owed > 0 ? 'Com dívida' : 'Sem dívida', info.v.owed > 0 ? 'warn' : 'good') : undefined));
  body.appendChild(card);
  const li = info.v;
  if (!li) {
    card.appendChild(h('div', { class: 'empty' }, info.pending ? 'O banco abre em breve.' : (info.err ?? 'Indisponível.')));
    return;
  }
  const maxTake = Math.max(0, li.available);
  takeAmt = Math.min(Math.max(takeAmt, Math.min(STEP, maxTake)), maxTake);
  const maxPay = Math.max(0, Math.min(li.owed, s.money));
  payAmt = Math.min(Math.max(payAmt, Math.min(STEP, maxPay)), maxPay);
  card.append(
    h('div', { class: 'bank-grid' },
      h('div', { class: 'stat' }, h('small', null, 'Você deve'), h('b', { class: li.owed > 0 ? 'warn' : '' }, money(li.owed))),
      h('div', { class: 'stat' }, h('small', null, 'Disponível'), h('b', null, money(li.available))),
      h('div', { class: 'stat' }, h('small', null, 'Limite'), h('b', null, money(li.maxLoan))),
      h('div', { class: 'stat' }, h('small', null, 'Juros por dia'), h('b', { class: li.dailyInterest > 0 ? 'bad' : '' }, money(li.dailyInterest)))),
    h('div', { class: 'bank-cols' },
      h('div', { class: 'bank-act' }, h('h6', null, 'Pegar empréstimo'),
        h('div', { class: 'bank-row' },
          stepper(money(takeAmt), () => { takeAmt = Math.max(STEP, takeAmt - STEP); tab.refresh(); }, () => { takeAmt = Math.min(maxTake, takeAmt + STEP); tab.refresh(); },
            { minusOff: takeAmt <= STEP || maxTake <= 0, plusOff: takeAmt >= maxTake }),
          h('button', { class: 'btn small', disabled: maxTake <= 0 || takeAmt >= maxTake, on: { click: () => { takeAmt = maxTake; tab.refresh(); } } }, 'Máx.')),
        h('button', { class: 'btn primary', id: 'bank-take', disabled: maxTake <= 0 || takeAmt <= 0, on: { click: () => {
          const v = takeAmt;
          kit.act('loan', () => api.takeLoan(s, v), `Empréstimo de ${money(v)} liberado no caixa.`, 'cash');
        } } }, `Pegar ${money(takeAmt)}`)),
      h('div', { class: 'bank-act' }, h('h6', null, 'Pagar dívida'),
        h('div', { class: 'bank-row' },
          stepper(money(payAmt), () => { payAmt = Math.max(STEP, payAmt - STEP); tab.refresh(); }, () => { payAmt = Math.min(maxPay, payAmt + STEP); tab.refresh(); },
            { minusOff: payAmt <= STEP || maxPay <= 0, plusOff: payAmt >= maxPay }),
          h('button', { class: 'btn small', disabled: maxPay <= 0 || payAmt >= maxPay, on: { click: () => { payAmt = maxPay; tab.refresh(); } } }, li.owed <= s.money ? 'Tudo' : 'Máx.')),
        h('button', { class: 'btn accent', id: 'bank-pay', disabled: maxPay <= 0 || payAmt <= 0, on: { click: () => {
          const v = payAmt;
          kit.act('loan', () => api.repayLoan(s, v), `Você pagou ${money(v)} da dívida.`, 'coin');
        } } }, `Pagar ${money(payAmt)}`))),
    h('small', { class: 'muted' }, 'O empréstimo cobra juros todos os dias e o limite cresce com o seu nível. Se o caixa acabar e não houver como pagar, a loja vai à falência.'));
}

function topTable(body: HTMLElement, kit: UiKit): void {
  const top = safe(() => api.topProducts(kit.ctx.state, 30), []);
  const card = h('div', { class: 'card' }, sectionTitle('Mais vendidos (30 dias)'));
  body.appendChild(card);
  if (!top.v.length) {
    card.appendChild(h('div', { class: 'empty' }, top.pending ? 'Em desenvolvimento.' : 'Ainda não há vendas registradas. Feche um dia para ver o ranking.'));
    return;
  }
  const rows = top.v.slice(0, 8).map((r, i) => {
    let name = r.productId;
    try { name = productById(r.productId).name; } catch { /* removido do catálogo */ }
    const margin = r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0;
    return h('tr', null,
      h('td', null, `${i + 1}. ${name}`),
      h('td', null, String(r.units)),
      h('td', null, money(r.revenue)),
      h('td', null, signed(r.profit, `${margin.toFixed(0)}%`)),
      h('td', null, signed(r.profit, money(r.profit, { sign: true }))));
  });
  card.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, 'Produto'), h('th', null, 'Un.'), h('th', null, 'Receita'), h('th', null, 'Margem'), h('th', null, 'Lucro'))),
    h('tbody', null, rows))));
}

export function financeTab(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  const l = s.ledger;
  const wages = dailyWages(s);
  const fixed = s.rent + wages;
  const profit = l.revenue + l.tips - l.cogs - fixed;
  const low = s.money < lowCashLimit(s);
  if (low) {
    body.appendChild(h('div', { class: `banner ${s.money < 0 ? 'bad' : 'warn'}`, html: `${icon('warn', 22)}<span><b>${s.money < 0 ? 'Caixa negativo!' : 'Caixa baixo.'}</b> Despesas fixas: ${money(fixed)} por dia. Venda mais, compre menos estoque ou use o empréstimo abaixo para não quebrar.</span>` }));
  }
  body.appendChild(h('div', { class: 'sum-grid' },
    h('div', { class: 'stat' }, h('small', null, 'Caixa agora'), h('b', { class: low ? 'warn' : '' }, money(s.money))),
    h('div', { class: 'stat' }, h('small', null, `Dia ${s.day} — lucro previsto`), h('b', null, signed(profit, money(profit, { sign: true })))),
    h('div', { class: 'stat' }, h('small', null, 'Clientes atendidos'), h('b', null, String(l.served))),
    h('div', { class: 'stat' }, h('small', null, 'Clientes perdidos'), h('b', { class: l.lost > l.served ? 'bad' : '' }, String(l.lost)))));

  bankCard(body, kit, tab);

  const hist = safe(() => api.dayHistory(s), []);
  const chartCard = h('div', { class: 'card' }, sectionTitle('Lucro dos últimos 30 dias'));
  if (hist.v.length) {
    const avg = Math.round(hist.v.reduce((a, r) => a + r.netProfit, 0) / hist.v.length);
    chartCard.append(profitChart(hist.v, (v) => tab.hold(v)), chartLegend(),
      h('small', { class: 'muted' }, `Média de ${hist.v.length} ${hist.v.length > 1 ? 'dias' : 'dia'}: `, signed(avg, money(avg, { sign: true })), '. Toque ou passe o mouse nas barras para ver o dia.'));
  } else chartCard.appendChild(h('div', { class: 'empty' }, hist.pending ? 'Em desenvolvimento.' : 'Sem histórico ainda. O gráfico aparece depois do primeiro dia encerrado.'));
  body.appendChild(chartCard);

  topTable(body, kit);

  body.appendChild(h('div', { class: 'card' }, sectionTitle('Resultado do dia (até agora)'),
    kv('Receita bruta de vendas', money(l.revenue)),
    kv('Gorjetas', money(l.tips)),
    kv('Custo das mercadorias vendidas', money(-l.cogs)),
    kv('Aluguel e contas', money(-s.rent)),
    kv('Salários', money(-wages)),
    kv('Lucro líquido previsto', signed(profit, money(profit, { sign: true })), 'total')));
  body.appendChild(h('div', { class: 'card' }, sectionTitle('Fluxo de caixa'),
    kv('Compras de mercadoria hoje', money(-l.purchases)),
    kv('Variação de caixa prevista', money(l.revenue + l.tips - l.purchases - fixed, { sign: true })),
    h('small', { class: 'muted' }, 'Comprar estoque tira dinheiro do caixa, mas só vira custo quando a mercadoria é vendida. Por isso o lucro usa o custo das mercadorias vendidas.')));
}
