/** Aba Mercado: compra de caixas no atacado do dia. */
import { LICENSES, PRODUCTS } from '../../sim/catalog';
import * as api from '../../sim/api';
import { shelfCapacity, unitsOwned } from '../../sim/economy';
import { wholesale } from '../../sim/market';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { CATEGORY_NAME, badge, productTile, sectionTitle, stepper, variation } from '../widgets';
import type { TabApi } from './index';

const qty = new Map<string, number>();

export function marketTab(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  body.appendChild(h('div', { class: 'banner', html: `${icon('box', 22)}<span>As caixas são <b>entregues na calçada</b>, na hora, em frente à loja. Leve-as para a prateleira ou o depósito.</span>` }));
  for (const lic of LICENSES) {
    const owned = s.licenses.includes(lic.id);
    body.appendChild(sectionTitle(CATEGORY_NAME[lic.id], owned ? undefined : badge(`Nível ${lic.minLevel}`, 'warn')));
    if (!owned) {
      body.appendChild(h('div', { class: 'card locked' },
        h('div', { class: 'card-head' }, h('span', { html: icon('lock', 26) }),
          h('div', { class: 'grow' }, h('h5', null, `Categoria bloqueada`), h('small', null, `Compre a licença de ${lic.name} para vender estes produtos.`))),
        h('div', { class: 'card-actions' }, h('span'), h('button', { class: 'btn small', on: { click: () => tab.goto('licenses') } }, 'Ver licenças'))));
      continue;
    }
    const grid = h('div', { class: 'cards' });
    for (const p of PRODUCTS.filter((x) => x.category === lic.id)) {
      const unit = wholesale(s, p.id);
      const boxCost = unit * p.boxSize;
      const n = Math.max(1, qty.get(p.id) ?? 1);
      const total = boxCost * n;
      const afford = s.money >= total;
      const side = s.sidewalk.filter((b) => b.productId === p.id).length;
      grid.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-head' }, productTile(p.name, p.category),
          h('div', { class: 'grow' }, h('h5', null, p.name),
            h('small', null, `${money(unit)} a unidade · caixa com ${p.boxSize}`)),
          h('div', { style: 'text-align:right' }, h('div', { style: 'font-weight:900' }, money(boxCost)), variation(s.market[p.id] ?? 1))),
        h('div', { class: 'stock' },
          h('span', null, `Prateleira ${s.shelf[p.id] ?? 0}/${shelfCapacity(s, p.id)}`),
          s.storageUnlocked ? h('span', null, `Depósito ${s.storage[p.id] ?? 0}`) : null,
          h('span', null, `Calçada ${side} cx`),
          h('span', null, `Total ${unitsOwned(s, p.id)} un`)),
        h('div', { class: 'card-actions' },
          stepper(`${n}`, () => { qty.set(p.id, Math.max(1, n - 1)); tab.refresh(); }, () => { qty.set(p.id, Math.min(50, n + 1)); tab.refresh(); }, { minusOff: n <= 1 }),
          h('button', { class: 'btn primary', disabled: !afford, on: { click: () => {
            kit.act('orderBoxes', () => api.orderBoxes(s, p.id, n), `${n} ${n > 1 ? 'caixas' : 'caixa'} de ${p.name} na calçada.`, 'box');
          } } }, h('span', { html: icon('cart', 20) }), `Comprar ${money(total)}`))));
    }
    body.appendChild(grid);
  }
}
