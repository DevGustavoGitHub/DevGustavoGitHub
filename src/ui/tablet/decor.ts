/** Aba Decoração: nome da loja e cores. */
import * as api from '../../sim/api';
import type { Decor } from '../../sim/state';
import { h, money } from '../dom';
import type { UiKit } from '../kit';
import { sectionTitle } from '../widgets';
import type { TabApi } from './index';

const PALETTES: { key: keyof Decor; title: string; colors: string[] }[] = [
  { key: 'wallColor', title: 'Parede', colors: ['#f2e8d5', '#e8f1f5', '#f6dfe0', '#e1efd9', '#f4e3b8', '#d9d6ee', '#ffffff', '#cfd8dc'] },
  { key: 'floorColor', title: 'Piso', colors: ['#c9c4b8', '#b08968', '#8d99a6', '#e0cfa9', '#9cb5a0', '#6b6f7a', '#d6c4c4', '#4a4e57'] },
  { key: 'signColor', title: 'Letreiro', colors: ['#d93a3a', '#17866a', '#3b7fd4', '#ff9330', '#8e44ad', '#222831', '#e84393', '#f1c40f'] },
];

export function decorTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const input = h('input', { type: 'text', maxlength: 24, value: s.storeName, 'aria-label': 'Nome da loja', autocomplete: 'off' });
  const save = (): void => {
    const name = input.value.trim();
    if (name) kit.act('storeName', () => api.setStoreName(s, name), 'Nome da loja atualizado.', 'pop');
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); save(); } });
  body.appendChild(h('div', { class: 'card' }, sectionTitle('Nome da loja'),
    h('div', { class: 'field' }, input, h('button', { class: 'btn primary', on: { click: save } }, 'Salvar'))));
  for (const p of PALETTES) {
    body.appendChild(h('div', { class: 'card' }, sectionTitle(p.title),
      h('div', { class: 'swatches' }, p.colors.map((c) => h('button', {
        class: `sw ${s.decor[p.key].toLowerCase() === c ? 'on' : ''}`, style: `background:${c}`, 'aria-label': `${p.title} ${c}`,
        on: { click: () => {
          const cost = kit.act('decor', () => api.setDecor(s, { [p.key]: c } as Partial<Decor>), undefined, 'pop');
          if (cost !== undefined && cost > 0) kit.toast(`${p.title} atualizado (${money(cost)}).`, 'good');
          else if (cost !== undefined) kit.toast(`${p.title} atualizado.`, 'good');
        } },
      })))));
  }
}
