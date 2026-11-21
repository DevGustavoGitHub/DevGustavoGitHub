/** Aba Móveis: escolhe um móvel e entra no modo construção (evento build:start). */
import * as api from '../../sim/api';
import { PRODUCTS } from '../../sim/catalog';
import { errText, h, isNotImplemented, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { badge, emptyState } from '../widgets';
import type { TabApi } from './index';

const chosen = new Map<string, string>();

export function furnitureTab(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  let specs: api.FurnitureSpec[];
  try { specs = api.furnitureCatalog(); } catch (e) {
    body.appendChild(emptyState(isNotImplemented(e) ? 'Catálogo de móveis em desenvolvimento.' : errText(e)));
    return;
  }
  body.appendChild(h('div', { class: 'banner', html: `${icon('sofa', 22)}<span>Escolha um móvel e posicione-o na loja. A cobrança acontece ao confirmar a posição.</span>` }));
  const grid = h('div', { class: 'cards' });
  for (const sp of specs) {
    const low = s.level < sp.minLevel;
    const poor = s.money < sp.cost;
    const options = PRODUCTS.filter((p) => s.licenses.includes(p.category) && (sp.categories.length === 0 || sp.categories.includes(p.category)));
    const showSel = sp.slots > 0 && options.length > 0;
    const sel = showSel ? h('select', { class: 'sel', 'aria-label': 'Produto exposto', on: { change: (e) => chosen.set(sp.type, (e.target as HTMLSelectElement).value) } },
      h('option', { value: '' }, 'Produto: escolher depois'),
      options.map((p) => h('option', { value: p.id, selected: chosen.get(sp.type) === p.id }, p.name))) : null;
    grid.appendChild(h('div', { class: `card ${low ? 'locked' : ''}` },
      h('div', { class: 'card-head' }, h('div', { class: 'ptile', style: '--tc:#6b5b95', html: icon(low ? 'lock' : 'sofa', 24) }),
        h('div', { class: 'grow' }, h('h5', null, sp.name), h('small', null, sp.slots > 0 ? `${sp.slots} ${sp.slots > 1 ? 'espaços' : 'espaço'} de produto` : 'Sem espaço de produto')),
        low ? badge(`Nível ${sp.minLevel}`, 'warn') : null),
      sel,
      h('div', { class: 'card-actions' }, h('b', { style: 'font-size:18px' }, money(sp.cost)),
        h('button', { class: 'btn primary', disabled: low || poor, on: { click: () => {
          const pid = chosen.get(sp.type) || undefined;
          kit.ctx.bus.emit('build:start', { type: sp.type, productId: pid });
          kit.toast(`Posicione: ${sp.name}`, 'info');
          tab.close();
        } } }, low ? `Requer nível ${sp.minLevel}` : poor ? 'Dinheiro insuficiente' : 'Posicionar'))));
  }
  body.appendChild(grid);
}
