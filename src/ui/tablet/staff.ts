/** Aba Funcionários: contratação permanente e evolução até o nível 5. */
import * as api from '../../sim/api';
import { errText, h, isNotImplemented, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { badge, kv, pips } from '../widgets';
import type { TabApi } from './index';

const ROLES: { role: api.Role; name: string; desc: string; color: string; ic: string }[] = [
  { role: 'cashier', name: 'Caixa', desc: 'Atende os clientes na fila sozinho.', color: '#3b7fd4', ic: 'coin' },
  { role: 'stocker', name: 'Repositor', desc: 'Leva caixas e abastece as prateleiras.', color: '#d9a441', ic: 'box' },
  { role: 'janitor', name: 'Faxineiro', desc: 'Limpa sujeira e joga o lixo fora.', color: '#35a891', ic: 'brush' },
];

function speed(role: api.Role, level: number): string {
  if (level <= 0) return '—';
  try { return `${api.employeeSpeed(role, level).toFixed(1).replace('.', ',')} s por ação`; } catch { return '—'; }
}

export function staffTab(body: HTMLElement, kit: UiKit, _tab: TabApi): void {
  const s = kit.ctx.state;
  body.appendChild(h('div', { class: 'banner', html: `${icon('users', 22)}<span>Funcionários são contratados <b>para sempre</b> e recebem salário todo dia. Evolua até o nível 5 para ganhar velocidade.</span>` }));
  const grid = h('div', { class: 'cards' });
  for (const r of ROLES) {
    const lvl = s.employees[r.role];
    let next: ReturnType<typeof api.employeeCost> = null;
    let err = '';
    try { next = api.employeeCost(s, r.role); } catch (e) { err = isNotImplemented(e) ? 'Em desenvolvimento' : errText(e); }
    const maxed = !err && next === null;
    const low = next ? s.level < next.minLevel : false;
    const poor = next ? s.money < next.cost : false;
    grid.appendChild(h('div', { class: `card ${lvl > 0 ? 'owned' : ''}` },
      h('div', { class: 'card-head' }, h('div', { class: 'ptile', style: `--tc:${r.color}`, html: icon(r.ic, 24) }),
        h('div', { class: 'grow' }, h('h5', null, r.name), h('small', null, r.desc)),
        lvl > 0 ? badge(`Nível ${lvl}`, 'good') : badge('Vago', 'mute')),
      h('div', null, pips(lvl, 5)),
      kv('Velocidade agora', speed(r.role, lvl)),
      next ? kv(lvl === 0 ? 'Salário diário' : 'Salário no próximo nível', `${money(next.dailyWage)}/dia`) : null,
      next && lvl > 0 ? kv('Velocidade no próximo nível', speed(r.role, lvl + 1)) : null,
      err ? kv('Custo', err) : null,
      maxed ? h('div', { class: 'banner' }, 'Nível máximo alcançado.') : next ? h('div', { class: 'card-actions' },
        h('b', { style: 'font-size:18px' }, money(next.cost)),
        h('button', { class: 'btn primary', disabled: low || poor,
          on: { click: () => kit.act('employee', () => api.hireOrUpgrade(s, r.role), lvl === 0 ? `${r.name} contratado!` : `${r.name} evoluiu para o nível ${lvl + 1}!`) } },
        low ? `Requer nível ${next.minLevel}` : poor ? 'Dinheiro insuficiente' : lvl === 0 ? 'Contratar' : 'Evoluir')) : null));
  }
  body.appendChild(grid);
}
