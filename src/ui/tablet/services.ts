/** Aba Serviços (como na referência): descartar caixas vazias, depósito, capacidade de clientes e personalização. */
import * as api from '../../sim/api';
import { furnitureSvg, storageSvg, upgradeSvg } from '../art';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { safe } from '../safe';
import { actionBtn, type BuyState } from '../widgets';
import type { TabApi } from './index';

export function bigCard(title: string, art: string, text: string, btn: HTMLElement, extra?: HTMLElement | null, cls = ''): HTMLElement {
  return h('div', { class: `bigcard ${cls}` }, h('h5', null, title), h('div', { class: 'art', html: art }), h('p', null, text), extra ?? null, btn);
}

/** Estado do botão de compra (nível, dinheiro, possuído). */
export function buyState(s: { level: number; money: number }, o: { owned: boolean; minLevel: number; cost: number; label: string; onClick: () => void; id?: string }): BuyState {
  if (o.owned) return { kind: 'owned' };
  if (s.level < o.minLevel) return { kind: 'lock', level: o.minLevel };
  if (s.money < o.cost) return { kind: 'poor', cost: o.cost, have: s.money };
  return { kind: 'buy', label: o.label, onClick: o.onClick, id: o.id };
}

export function servicesTab(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  const grid = h('div', { class: 'bigs' });
  // 1) caixas vazias
  const empty = s.sidewalk.filter((b) => b.units <= 0 && !b.carried).length;
  grid.appendChild(bigCard('Descartar caixas vazias', furnitureSvg('rack', 76), `Caixas vazias no chão: ${empty}. Toque para jogá-las fora de uma vez.`,
    empty ? actionBtn({ kind: 'buy', label: `Descartar (${empty})`, id: 'svc-discard', onClick: () => {
      kit.act('sidewalk', () => {
        for (let i = s.sidewalk.length - 1; i >= 0; i--) { const b = s.sidewalk[i]; if (b && b.units <= 0 && !b.carried) api.discardBox(s, i); }
      }, `${empty} ${empty > 1 ? 'caixas descartadas' : 'caixa descartada'}.`, 'trash');
    } }) : actionBtn({ kind: 'off', label: 'Nada para descartar' })));
  // 2) depósito
  const st = safe(() => api.storageCost(), { cost: 0, minLevel: 1 });
  const cap = safe(() => api.storageCapacity(s), 0).v, used = safe(() => api.storageUsed(s), 0).v;
  grid.appendChild(bigCard('Depósito', storageSvg(76),
    s.storageUnlocked ? `Caixas guardadas: ${used} de ${cap}. Compre estantes (Mercado › Móveis) para guardar mais.` : `Sala nos fundos para guardar caixas de reserva. ${money(st.v.cost)}.`,
    actionBtn(buyState(s, { owned: s.storageUnlocked, minLevel: st.v.minLevel, cost: st.v.cost, label: `Liberar ${money(st.v.cost)}`, id: 'svc-storage',
      onClick: () => kit.act('storage', () => api.unlockStorage(s), 'Depósito liberado! A porta dos fundos está aberta.') })), null, s.storageUnlocked ? 'owned' : ''));
  // 3) capacidade de clientes
  const ccap = safe(() => api.customerCapacity(s), 0);
  // pós-teste 3: não se compra mais — informativo (cresce sozinha com o nível e as expansões)
  grid.appendChild(bigCard('Capacidade de clientes', upgradeSvg('capacity', 76),
    `${ccap.pending ? 'Em desenvolvimento.' : `Até ${ccap.v} clientes na loja ao mesmo tempo.`} Cresce sozinha com o nível e as expansões; o movimento do dia cresce com o nível e a reputação.`,
    actionBtn({ kind: 'owned', label: 'Automática' })));
  // 4) personalização
  grid.appendChild(bigCard('Personalização', furnitureSvg('decor', 76, 'banner'), 'Nome da loja, cores da parede, do piso e do letreiro.',
    h('button', { class: 'abtn buy', on: { click: () => tab.goto('decor') } }, h('span', { html: icon('brush', 18) }), 'Personalizar')));
  body.appendChild(grid);
}
