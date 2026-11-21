/** Aba Finanças: resumo do dia em andamento (ledger). */
import { dailyWages } from '../../sim/economy';
import { h, money } from '../dom';
import type { UiKit } from '../kit';
import { kv, sectionTitle } from '../widgets';
import type { TabApi } from './index';

export function financeTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const l = s.ledger;
  const wages = dailyWages(s);
  const fixed = s.rent + wages;
  const profit = l.revenue + l.tips - l.cogs - fixed;
  body.appendChild(h('div', { class: 'sum-grid' },
    h('div', { class: 'stat' }, h('small', null, 'Caixa agora'), h('b', null, money(s.money))),
    h('div', { class: 'stat' }, h('small', null, `Dia ${s.day} — lucro previsto`), h('b', { class: profit >= 0 ? 'good' : 'bad' }, money(profit, { sign: true }))),
    h('div', { class: 'stat' }, h('small', null, 'Clientes atendidos'), h('b', null, String(l.served))),
    h('div', { class: 'stat' }, h('small', null, 'Clientes perdidos'), h('b', { class: l.lost > l.served ? 'bad' : '' }, String(l.lost)))));
  body.appendChild(h('div', { class: 'card' }, sectionTitle('Resultado do dia (até agora)'),
    kv('Receita bruta de vendas', money(l.revenue)),
    kv('Gorjetas', money(l.tips)),
    kv('Custo das mercadorias vendidas', money(-l.cogs)),
    kv('Aluguel e contas', money(-s.rent)),
    kv('Salários', money(-wages)),
    kv('Lucro líquido previsto', h('span', { class: profit >= 0 ? 'good' : 'bad' }, money(profit, { sign: true })), 'total')));
  body.appendChild(h('div', { class: 'card' }, sectionTitle('Fluxo de caixa'),
    kv('Compras de mercadoria hoje', money(-l.purchases)),
    kv('Variação de caixa prevista', money(l.revenue + l.tips - l.purchases - fixed, { sign: true })),
    h('small', { class: 'muted' }, 'Comprar estoque tira dinheiro do caixa, mas só vira custo quando a mercadoria é vendida. Por isso o lucro usa o custo das mercadorias vendidas.')));
}
