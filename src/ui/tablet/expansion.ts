/** Aba Expansão (como as "seções" da referência): uma etapa por cartão, com nível da loja exigido. */
import * as api from '../../sim/api';
import { MAX_EXPANSION, storeBounds } from '../../core/layout';
import { EXPANSIONS } from '../../sim/tuning';
import { expansionSvg } from '../art';
import { h, money } from '../dom';
import type { UiKit } from '../kit';
import { actionBtn } from '../widgets';
import { bigCard, buyState } from './services';
import type { TabApi } from './index';

export function expansionTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  const cur = storeBounds(s.expansion);
  body.appendChild(h('div', { class: 'banner' }, `Salão atual: ${cur.width} × ${cur.depth} m (etapa ${s.expansion} de ${MAX_EXPANSION}). Mais espaço para móveis e clientes; o aluguel sobe um pouco a cada etapa.`));
  const grid = h('div', { class: 'bigs' });
  EXPANSIONS.slice(0, MAX_EXPANSION).forEach((e, i) => {
    const b = storeBounds(i + 1);
    const done = i < s.expansion;
    const btn = i === s.expansion
      ? actionBtn(buyState(s, { owned: false, minLevel: e.minLevel, cost: e.cost, label: `Expandir ${money(e.cost)}`, id: 'exp-buy',
        onClick: () => kit.act('expansion', () => api.buyExpansion(s), 'Loja ampliada!') }))
      : done ? actionBtn({ kind: 'owned', label: 'Concluída' })
        : s.level < e.minLevel ? actionBtn({ kind: 'lock', level: e.minLevel }) : actionBtn({ kind: 'off', label: 'Faça a anterior' });
    grid.appendChild(bigCard(`Seção ${i + 1}`, expansionSvg(i + 1, 76), `Salão de ${b.width} × ${b.depth} m · ${money(e.cost)}`, btn, null, done ? 'owned' : ''));
  });
  body.appendChild(grid);
}
