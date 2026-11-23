/** Aba Preços: preço de venda por produto, margem e comparação com o mercado. */
import * as api from '../../sim/api';
import { PRODUCTS } from '../../sim/catalog';
import type { StoreState } from '../../sim/state';
import { marketAverage, sellPrice, wholesale } from '../../sim/market';
import { PRICE_STEP, roundPrice } from '../../sim/money';
import { setPrice } from '../../sim/economy';
import { h, money } from '../dom';
import type { UiKit } from '../kit';
import { badge, emptyState, kv, productTile } from '../widgets';
import type { TabApi } from './index';

/** Preço sugerido = `api.suggestedPrice` (Fase 4: a média de mercado). Reserva local se a api falhar. */
export function suggestedPrice(state: StoreState, productId: string): number {
  try { return api.suggestedPrice(state, productId); } catch { return roundPrice(marketAverage(state, productId)); }
}

/**
 * Selo do preço em relação à média de mercado, coerente com a curva de aceitação da Fase 4 (≈95% dos clientes
 * aceitam em 1,00 e ≈88% em 1,10 — o lucro máximo fica perto de 1,10 —, metade por volta de 1,30; exigentes
 * recusam acima de 1,10). Justo = até +10%.
 */
export function verdict(ratio: number): { text: string; tone: 'good' | 'bad' | 'warn' | 'info' } {
  if (ratio < 0.95) return { text: 'Barato', tone: 'info' };
  if (ratio <= 1.1 + 1e-9) return { text: 'Justo', tone: 'good' };
  if (ratio <= 1.25) return { text: 'Caro', tone: 'warn' };
  return { text: 'Abusivo', tone: 'bad' };
}

export function pricesTab(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  const list = PRODUCTS.filter((p) => s.licenses.includes(p.category));
  if (!list.length) { body.appendChild(emptyState('Nenhum produto liberado.')); return; }
  const setOne = (id: string, v: number): void => {
    kit.act('price', () => setPrice(s, id, Math.max(PRICE_STEP, v)), undefined, 'pop');
  };
  body.appendChild(h('div', { class: 'card-actions' },
    h('span', { class: 'muted', style: 'font-size:13px;flex:1;min-width:180px' }, 'Preço por unidade, em passos de R$ 0,05. O sugerido é a média do mercado: quase todo cliente aceita. Até 10% acima ainda é justo e costuma render mais; acima disso muitos desistem e os exigentes reclamam.'),
    h('button', { class: 'btn accent small', id: 'price-all', on: { click: () => {
      kit.act('price', () => { for (const p of list) setPrice(s, p.id, suggestedPrice(s, p.id)); }, 'Preço sugerido aplicado a todos os produtos.', 'pop');
    } } }, 'Definir todos no sugerido')));
  const grid = h('div', { class: 'cards' });
  for (const p of list) {
    const basis = s.costBasis[p.id];
    const cost = basis && basis.units > 0 ? basis.avg : wholesale(s, p.id);
    const market = marketAverage(s, p.id);
    const price = sellPrice(s, p.id);
    const ratio = price / market;
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    const v = verdict(ratio);
    const sug = suggestedPrice(s, p.id);
    const btn = (label: string, d: number): HTMLElement =>
      h('button', { class: 'btn small', on: { click: () => setOne(p.id, price + d) } }, label);
    grid.appendChild(h('div', { class: 'card', 'data-product': p.id },
      h('div', { class: 'card-head' }, productTile(p),
        h('div', { class: 'grow' }, h('h5', null, p.name), h('small', null, s.prices[p.id] === undefined ? 'Preço automático (mercado)' : 'Preço definido por você')),
        badge(v.text, v.tone)),
      kv('Custo médio de compra', money(cost)),
      kv('Preço médio de mercado', money(market)),
      kv('Margem', h('span', { class: margin < 8 ? 'bad' : margin < 20 ? 'warn' : 'good' }, `${margin.toFixed(0)}%  (${money(price - cost, { sign: true })}/un)`), ''),
      h('div', { class: 'price-ctl' }, btn('−0,50', -50), btn('−0,05', -PRICE_STEP), h('output', null, money(price)), btn('+0,05', PRICE_STEP), btn('+0,50', 50)),
      h('div', { class: 'card-actions' },
        h('span', { class: 'muted', style: 'font-size:13px' }, `Preço sugerido: ${money(sug)}`),
        h('button', { class: 'btn primary small', 'data-sug': sug, disabled: sug === price, on: { click: () => setOne(p.id, sug) } }, 'Usar sugerido'))));
  }
  body.appendChild(grid);
  void tab;
}
