/** Aba Licenças: libera categorias de produtos. */
import { LICENSES, PRODUCTS } from '../../sim/catalog';
import { buyLicense } from '../../sim/economy';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { CATEGORY_COLOR, CATEGORY_NAME, badge } from '../widgets';
import type { TabApi } from './index';

export function licensesTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const grid = h('div', { class: 'cards' });
  for (const lic of LICENSES) {
    const owned = s.licenses.includes(lic.id);
    const lowLevel = s.level < lic.minLevel;
    const poor = s.money < lic.cost;
    const items = PRODUCTS.filter((p) => p.category === lic.id).map((p) => p.name).join(', ');
    grid.appendChild(h('div', { class: `card ${owned ? 'owned' : lowLevel ? 'locked' : ''}` },
      h('div', { class: 'card-head' },
        h('div', { class: 'ptile', style: `--tc:${CATEGORY_COLOR[lic.id]}`, html: icon(owned ? 'check' : lowLevel ? 'lock' : 'badge', 24) }),
        h('div', { class: 'grow' }, h('h5', null, `Licença de ${CATEGORY_NAME[lic.id]}`), h('small', null, items)),
        owned ? badge('Ativa', 'good') : badge(`Nível ${lic.minLevel}`, lowLevel ? 'warn' : 'mute')),
      owned ? null : h('div', { class: 'card-actions' },
        h('b', { style: 'font-size:18px' }, lic.cost === 0 ? 'Grátis' : money(lic.cost)),
        h('button', { class: 'btn primary', disabled: lowLevel || poor, on: { click: () => kit.act('license', () => buyLicense(s, lic.id), `Licença de ${lic.name} adquirida!`) } },
          lowLevel ? `Requer nível ${lic.minLevel}` : poor ? 'Dinheiro insuficiente' : 'Comprar licença'))));
  }
  body.appendChild(grid);
}
