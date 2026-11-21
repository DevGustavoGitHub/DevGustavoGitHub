/** Aba Melhorias: upgrades permanentes (ex.: carrinho de carga). */
import * as api from '../../sim/api';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { safe } from '../safe';
import { badge, emptyState } from '../widgets';
import type { TabApi } from './index';

export function upgradesTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const cat = safe(() => api.upgradeCatalog(s), [] as api.UpgradeSpec[]);
  body.appendChild(h('div', { class: 'banner', html: `${icon('star', 22)}<span>Melhorias são compras <b>permanentes</b> que facilitam o seu trabalho na loja.</span>` }));
  if (!cat.v.length) { body.appendChild(emptyState(cat.pending ? 'Melhorias em desenvolvimento.' : (cat.err ?? 'Nenhuma melhoria disponível.'))); return; }
  const grid = h('div', { class: 'cards' });
  for (const u of cat.v) {
    const locked = !u.owned && s.level < u.minLevel;
    const poor = !u.owned && !locked && s.money < u.cost;
    grid.appendChild(h('div', { class: `card up-card${u.owned ? ' owned' : locked ? ' locked' : ''}`, 'data-upgrade': u.id },
      h('div', { class: 'card-head' }, h('div', { class: 'ptile', html: icon(locked ? 'lock' : 'box', 24) }),
        h('div', { class: 'grow' }, h('h5', null, u.name), h('small', null, u.description)),
        u.owned ? badge('Possuída', 'good') : locked ? badge(`Nível ${u.minLevel}`, 'warn') : badge(money(u.cost), 'info')),
      h('div', { class: 'card-actions' },
        h('span', { class: 'muted', style: 'font-size:13px' }, u.owned ? 'Já está ativa.' : locked ? `Libera no nível ${u.minLevel} (você está no ${s.level}).` : poor ? `Faltam ${money(u.cost - s.money)}.` : ''),
        h('button', { class: 'btn primary', disabled: u.owned || locked || poor, on: { click: () => {
          void kit.confirm({ title: `Comprar ${u.name}?`, text: `${u.description} Custo: ${money(u.cost)}.`, ok: `Comprar ${money(u.cost)}` }).then((ok) => {
            if (ok) kit.act('upgrade', () => api.buyUpgrade(s, u.id), `${u.name} comprada!`, 'buy');
          });
        } } }, u.owned ? 'Possuída' : locked ? 'Bloqueada' : 'Comprar'))));
  }
  body.appendChild(grid);
}
