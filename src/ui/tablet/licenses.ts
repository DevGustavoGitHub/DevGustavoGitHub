/** Aba Licenças (como na referência): cartão por categoria com os produtos e o nível da loja exigido. */
import { LICENSES, PRODUCTS } from '../../sim/catalog';
import { buyLicense } from '../../sim/economy';
import { licenseSvg } from '../art';
import { h, money } from '../dom';
import type { UiKit } from '../kit';
import { actionBtn, CATEGORY_NAME } from '../widgets';
import { bigCard, buyState } from './services';
import type { TabApi } from './index';

export function licensesTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const grid = h('div', { class: 'bigs' });
  LICENSES.forEach((lic, i) => {
    const owned = s.licenses.includes(lic.id);
    const ps = PRODUCTS.filter((p) => p.category === lic.id);
    const btn = actionBtn(buyState(s, { owned, minLevel: lic.minLevel, cost: lic.cost, label: lic.cost === 0 ? 'Grátis' : `Comprar ${money(lic.cost)}`, id: `lic-${lic.id}`,
      onClick: () => kit.act('license', () => buyLicense(s, lic.id), `Licença de ${lic.name} adquirida!`) }));
    grid.appendChild(bigCard(`Licença ${i + 1} · ${CATEGORY_NAME[lic.id]}`, licenseSvg(lic.id, ps, 84), ps.map((p) => p.name).join(', '), btn, null, owned ? 'owned' : ''));
  });
  body.appendChild(grid);
}
