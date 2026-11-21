/** Aba Expansão e Depósito. */
import * as api from '../../sim/api';
import { storeBounds } from '../../core/layout';
import { errText, h, isNotImplemented, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { badge, kv } from '../widgets';
import type { TabApi } from './index';

function safe<T>(fn: () => T, fallback: T): { v: T; err?: string } {
  try { return { v: fn() }; } catch (e) { return { v: fallback, err: isNotImplemented(e) ? 'Em desenvolvimento' : errText(e) }; }
}

export function expansionTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const cur = storeBounds(s.expansion);
  const nxt = s.expansion < 4 ? storeBounds(s.expansion + 1) : null;
  const cost = safe(() => api.expansionCost(s), null);
  const minLvl = safe(() => api.expansionMinLevel(s), null);
  const maxed = cost.v === null && !cost.err;
  const lowLevel = minLvl.v !== null && s.level < minLvl.v;
  const poor = cost.v !== null && s.money < cost.v;

  body.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'ptile', style: '--tc:#17866a', html: icon('expand', 24) }),
      h('div', { class: 'grow' }, h('h5', null, 'Ampliar o salão'), h('small', null, 'Mais espaço para móveis e clientes.')),
      badge(`Etapa ${s.expansion}/4`, maxed ? 'good' : 'info')),
    kv('Salão atual', `${cur.width} × ${cur.depth} m`),
    nxt ? kv('Depois da expansão', `${nxt.width} × ${nxt.depth} m`) : null,
    cost.err ? kv('Custo', cost.err) : null,
    maxed ? h('div', { class: 'banner' }, 'Sua loja já está no tamanho máximo.') : h('div', { class: 'card-actions' },
      h('b', { style: 'font-size:18px' }, cost.v !== null ? money(cost.v) : '—'),
      h('button', { class: 'btn primary', disabled: cost.v === null || lowLevel || poor,
        on: { click: () => kit.act('expansion', () => api.buyExpansion(s), 'Loja ampliada!') } },
      lowLevel ? `Requer nível ${minLvl.v}` : poor ? 'Dinheiro insuficiente' : 'Expandir'))));

  const st = safe(() => api.storageCost(), { cost: 0, minLevel: 1 });
  const sLow = s.level < st.v.minLevel;
  const sPoor = s.money < st.v.cost;
  body.appendChild(h('div', { class: `card ${s.storageUnlocked ? 'owned' : ''}` },
    h('div', { class: 'card-head' }, h('div', { class: 'ptile', style: '--tc:#8a6d3b', html: icon('box', 24) }),
      h('div', { class: 'grow' }, h('h5', null, 'Depósito'), h('small', null, 'Sala nos fundos para guardar caixas de reserva.')),
      s.storageUnlocked ? badge('Liberado', 'good') : badge(`Nível ${st.v.minLevel}`, sLow ? 'warn' : 'mute')),
    s.storageUnlocked ? kv('Caixas guardadas', String(Object.values(s.storage).reduce((a, b) => a + b, 0))) : st.err ? kv('Custo', st.err) : h('div', { class: 'card-actions' },
      h('b', { style: 'font-size:18px' }, money(st.v.cost)),
      h('button', { class: 'btn primary', disabled: sLow || sPoor || !!st.err,
        on: { click: () => kit.act('storage', () => api.unlockStorage(s), 'Depósito liberado!') } },
      sLow ? `Requer nível ${st.v.minLevel}` : sPoor ? 'Dinheiro insuficiente' : 'Liberar depósito'))));
}
