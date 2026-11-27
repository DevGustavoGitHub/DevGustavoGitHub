/** Aba Funcionários (como na referência): caixa, faxineiro e repositor com salário diário, níveis e liberação. */
import * as api from '../../sim/api';
import { personSvg } from '../art';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { safe } from '../safe';
import { actionBtn, kv, pips } from '../widgets';
import { bigCard, buyState } from './services';
import type { TabApi } from './index';

const ROLES: { role: api.Role; name: string; desc: string }[] = [
  { role: 'cashier', name: 'Caixa', desc: 'Senta no caixa e atende a fila sozinho.' },
  { role: 'janitor', name: 'Faxineiro', desc: 'Limpa a sujeira e joga o lixo fora.' },
  { role: 'stocker', name: 'Repositor', desc: 'Leva as caixas e abastece as prateleiras.' },
];

const speed = (role: api.Role, level: number): string =>
  level <= 0 ? '—' : safe(() => `${api.employeeSpeed(role, level).toFixed(1).replace('.', ',')} s por ação`, '—').v;

export function staffTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  body.appendChild(h('div', { class: 'banner', html: `${icon('users', 22)}<span>Funcionários são contratados <b>para sempre</b> e recebem salário todo dia. Evolua até o nível 5 para ganhar velocidade.</span>` }));
  const grid = h('div', { class: 'bigs' });
  for (const r of ROLES) {
    const lvl = s.employees[r.role];
    const next = safe(() => api.employeeCost(s, r.role), null);
    const n = next.v;
    const btn = next.err ? actionBtn({ kind: 'off', label: next.err })
      : !n ? actionBtn({ kind: 'owned', label: 'Nível máximo' })
        : actionBtn(buyState(s, { owned: false, minLevel: n.minLevel, cost: n.cost, label: `${lvl === 0 ? 'Contratar' : 'Evoluir'} ${money(n.cost)}`, id: `hire-${r.role}`,
          onClick: () => kit.act('employee', () => api.hireOrUpgrade(s, r.role), lvl === 0 ? `${r.name} contratado!` : `${r.name} evoluiu para o nível ${lvl + 1}!`) }));
    const extra = h('div', null,
      h('div', { class: 'meta' }, h('span', null, 'Salário diário'), h('b', null, n ? money(n.dailyWage) : '—')),
      h('div', { class: 'meta' }, h('span', null, `Nível ${lvl} » ${Math.min(5, lvl + 1)}`), pips(lvl, 5)),
      kv('Velocidade', speed(r.role, lvl || 1)));
    if (r.role === 'cashier' && lvl > 0) {
      const x = api.extraCashierInfo(s);
      extra.appendChild(h('div', { class: 'meta' }, h('span', null, 'Caixas'), h('b', { id: 'cashier-count' }, `Caixas: ${x.count} de ${x.max}`)));
      extra.appendChild(x.cost === null ? actionBtn({ kind: 'owned', label: x.blockedReason ?? 'Máximo de caixas' })
        : x.blockedReason ? actionBtn({ kind: 'off', label: x.blockedReason })
          : actionBtn(buyState(s, { owned: false, minLevel: 1, cost: x.cost, label: `Contratar outro caixa ${money(x.cost)}`, id: 'hire-cashier-extra',
            onClick: () => kit.act('employee', () => api.hireExtraCashier(s), 'Novo caixa contratado!') })));
    }
    if ((r.role === 'stocker' || r.role === 'janitor') && lvl > 0) {
      const role = r.role, x = api.extraStaffInfo(s, role), nome = role === 'stocker' ? 'repositor' : 'faxineiro';
      extra.appendChild(h('div', { class: 'meta' }, h('span', null, role === 'stocker' ? 'Repositores' : 'Faxineiros'), h('b', { id: `${role}-count` }, `${x.count} de ${x.max}`)));
      extra.appendChild(x.cost === null ? actionBtn({ kind: 'owned', label: x.blockedReason ?? 'Máximo: 2' })
        : x.blockedReason ? actionBtn({ kind: 'off', label: x.blockedReason })
          : actionBtn(buyState(s, { owned: false, minLevel: 1, cost: x.cost, label: `Contratar outro ${nome} ${money(x.cost)}`, id: `hire-${role}-extra`,
            onClick: () => kit.act('employee', () => api.hireExtraStaff(s, role), `Novo ${nome} contratado!`) })));
    }
    grid.appendChild(bigCard(r.name, personSvg(r.role, 76), r.desc, btn, extra, lvl > 0 ? 'owned' : ''));
  }
  body.appendChild(grid);
}
