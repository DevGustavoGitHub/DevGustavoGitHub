/** Aba Melhorias: compras permanentes (carrinho de carga, pote de gorjeta, capacidade de clientes...). */
import * as api from '../../sim/api';
import { upgradeSvg } from '../art';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { safe } from '../safe';
import { emptyState, actionBtn } from '../widgets';
import { bigCard, buyState } from './services';
import type { TabApi } from './index';

export function upgradesTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const cat = safe(() => api.upgradeCatalog(s), [] as api.UpgradeSpec[]);
  body.appendChild(h('div', { class: 'banner', html: `${icon('star', 22)}<span>Melhorias são compras <b>permanentes</b> que facilitam o seu trabalho na loja.</span>` }));
  if (!cat.v.length) { body.appendChild(emptyState(cat.pending ? 'Melhorias em desenvolvimento.' : (cat.err ?? 'Nenhuma melhoria disponível.'))); return; }
  const grid = h('div', { class: 'bigs' });
  for (const u of cat.v) {
    const btn = actionBtn(buyState(s, { owned: u.owned, minLevel: u.minLevel, cost: u.cost, label: `Comprar ${money(u.cost)}`, id: `up-${u.id}`,
      onClick: () => {
        void kit.confirm({ title: `Comprar ${u.name}?`, text: `${u.description} Custo: ${money(u.cost)}.`, ok: `Comprar ${money(u.cost)}` }).then((ok) => {
          if (ok) kit.act('upgrade', () => api.buyUpgrade(s, u.id), `${u.name} comprada!`, 'buy');
        });
      } }));
    const card = bigCard(u.name, upgradeSvg(u.id, 76), u.description, btn, null, `up-card${u.owned ? ' owned' : ''}`);
    card.setAttribute('data-upgrade', u.id);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}
