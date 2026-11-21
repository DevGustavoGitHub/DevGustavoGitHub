/** Aba Automático: regra de pedido automático por produto licenciado. */
import * as api from '../../sim/api';
import { PRODUCTS } from '../../sim/catalog';
import { unitsOwned } from '../../sim/economy';
import { wholesale } from '../../sim/market';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { safe } from '../safe';
import { badge, emptyState, productTile, sectionTitle, stepper, toggle } from '../widgets';
import type { TabApi } from './index';

export interface AutoItem { productId: string; boxes: number; cost: number }
const TODAY_KEY = 'mercadinho:autoToday';
interface Today { day: number; items: AutoItem[] }
const draft = new Map<string, { minUnits: number; boxes: number }>();

export function readToday(day: number): AutoItem[] {
  try {
    const t = JSON.parse(localStorage.getItem(TODAY_KEY) ?? 'null') as Today | null;
    return t && t.day === day ? t.items : [];
  } catch { return []; }
}
/** Soma ao que foi pedido hoje (chamado por quem executa os pedidos: botão "Pedir agora" ou evento `autoOrder:done`). */
export function recordToday(day: number, items: AutoItem[]): void {
  if (!items.length) return;
  const cur = readToday(day);
  const map = new Map(cur.map((i) => [i.productId, { ...i }]));
  for (const it of items) {
    const m = map.get(it.productId);
    if (m) { m.boxes += it.boxes; m.cost += it.cost; } else map.set(it.productId, { ...it });
  }
  try { localStorage.setItem(TODAY_KEY, JSON.stringify({ day, items: [...map.values()] } satisfies Today)); } catch { /* privado */ }
}

/** Converte o toast do npc ("Pedido automático: 3 cx Arroz, 2 cx Feijão") em itens (custo estimado pelo atacado atual). */
export function parseAutoToast(text: string, state: Parameters<typeof wholesale>[0]): AutoItem[] {
  if (!text.startsWith('Pedido automático:')) return [];
  const out: AutoItem[] = [];
  for (const part of text.slice(text.indexOf(':') + 1).split(',')) {
    const m = /(\d+)\s*cx\s+(.+?)\s*$/.exec(part);
    if (!m) continue;
    const boxes = Number(m[1]);
    const p = PRODUCTS.find((x) => x.name.replace(/\s+[\d(].*$/, '') === m[2]);
    if (p) out.push({ productId: p.id, boxes, cost: wholesale(state, p.id) * p.boxSize * boxes });
  }
  return out;
}

const nameOf = (id: string): string => PRODUCTS.find((p) => p.id === id)?.name ?? id;

export function autoTab(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  const list = PRODUCTS.filter((p) => s.licenses.includes(p.category));
  const rulesR = safe(() => api.autoOrderRules(s), {} as Record<string, api.AutoOrderRule>);
  const rules = rulesR.v;
  if (rulesR.pending) body.appendChild(h('div', { class: 'banner warn', html: `${icon('warn', 22)}<span>Pedido automático em desenvolvimento: as regras ainda não funcionam.</span>` }));
  body.appendChild(h('div', { class: 'banner', html: `${icon('clock', 22)}<span>Quando o estoque total (prateleira + depósito + calçada) fica <b>abaixo do mínimo</b>, a loja compra as caixas sozinha ao abrir e a cada hora, se houver dinheiro.</span>` }));
  if (!list.length) { body.appendChild(emptyState('Nenhum produto liberado.')); return; }

  const costOf = (id: string, boxes: number, boxSize: number): number => wholesale(s, id) * boxSize * boxes;
  let active = 0, estAll = 0, nowN = 0, nowCost = 0;
  for (const p of list) {
    const r = rules[p.id];
    if (!r) continue;
    active++;
    const c = costOf(p.id, r.boxes, p.boxSize);
    estAll += c;
    if (unitsOwned(s, p.id) < r.minUnits) { nowN++; nowCost += c; }
  }
  const today = readToday(s.day);
  const todayCost = today.reduce((a, i) => a + i.cost, 0);
  body.appendChild(h('div', { class: 'card' },
    sectionTitle('Resumo'),
    h('div', { class: 'auto-sum' },
      h('div', { class: 'stat' }, h('small', null, 'Regras ligadas'), h('b', null, String(active))),
      h('div', { class: 'stat' }, h('small', null, 'Custo por rodada (todas)'), h('b', null, money(estAll))),
      h('div', { class: 'stat' }, h('small', null, 'Abaixo do mínimo agora'), h('b', { class: nowN ? 'warn' : '' }, `${nowN} · ${money(nowCost)}`))),
    h('div', { class: 'card-actions' },
      h('span', { class: 'muted', style: 'font-size:13px;flex:1;min-width:160px' }, nowN ? 'Peça agora sem esperar a próxima verificação.' : 'Nada abaixo do mínimo no momento.'),
      h('button', { class: 'btn accent small', id: 'auto-run', disabled: nowN === 0, on: { click: () => {
        const r = kit.act('autoOrder', () => api.runAutoOrders(s), undefined, 'box');
        if (r) {
          recordToday(s.day, r);
          const total = r.reduce((a, i) => a + i.cost, 0);
          kit.toast(r.length ? `Pedidos feitos: ${r.map((i) => `${i.boxes}× ${nameOf(i.productId)}`).join(', ')} (${money(total)}).` : 'Nenhum pedido foi feito (falta de dinheiro?).', r.length ? 'good' : 'info');
          tab.refresh();
        }
      } } }, 'Pedir agora')),
    h('div', null, h('small', { class: 'muted' }, 'Pedido hoje: '),
      today.length
        ? h('span', { class: 'today-list', id: 'auto-today' }, today.map((i) => badge(`${i.boxes}× ${nameOf(i.productId)} · ${money(i.cost)}`, 'info')), h('b', null, ` Total ${money(todayCost)}`))
        : h('small', { class: 'muted', id: 'auto-today' }, 'nenhum ainda.'))));

  const grid = h('div', { class: 'cards' });
  for (const p of list) {
    const r = rules[p.id];
    const d = r ?? draft.get(p.id) ?? { minUnits: p.boxSize * 2, boxes: 1 };
    const stepU = Math.max(2, Math.round(p.boxSize / 4));
    const owned = unitsOwned(s, p.id);
    const below = !!r && owned < r.minUnits;
    const apply = (nu: { minUnits: number; boxes: number }): void => {
      draft.set(p.id, nu);
      if (r) kit.act('autoOrder', () => api.setAutoOrder(s, p.id, nu), undefined, 'pop');
      else tab.refresh();
    };
    grid.appendChild(h('div', { class: `card${r ? '' : ' off'}`, 'data-product': p.id },
      h('div', { class: 'card-head' }, productTile(p.name, p.category),
        h('div', { class: 'grow' }, h('h5', null, p.name), h('small', null, `Em estoque: ${owned} un · caixa com ${p.boxSize}`)),
        below ? badge('Abaixo do mínimo', 'warn') : r ? badge('Ligado', 'good') : badge('Desligado', 'mute'),
        toggle(!!r, `Pedido automático de ${p.name}`, (on) => {
          if (on) { draft.set(p.id, d); kit.act('autoOrder', () => api.setAutoOrder(s, p.id, d), `Pedido automático ligado: ${p.name}.`, 'pop'); }
          else kit.act('autoOrder', () => api.setAutoOrder(s, p.id, null), `Pedido automático desligado: ${p.name}.`, 'pop');
        })),
      h('div', { class: 'auto-ctl' },
        h('div', { class: 'fld' }, h('small', null, 'Pedir quando abaixo de'),
          stepper(`${d.minUnits} un`, () => apply({ ...d, minUnits: Math.max(1, d.minUnits - stepU) }), () => apply({ ...d, minUnits: Math.min(500, d.minUnits + stepU) }), { minusOff: d.minUnits <= 1 })),
        h('div', { class: 'fld' }, h('small', null, 'Caixas por pedido'),
          stepper(`${d.boxes}`, () => apply({ ...d, boxes: Math.max(1, d.boxes - 1) }), () => apply({ ...d, boxes: Math.min(20, d.boxes + 1) }), { minusOff: d.boxes <= 1 }))),
      h('div', { class: 'card-actions' },
        h('small', { class: 'muted' }, `${d.boxes} ${d.boxes > 1 ? 'caixas' : 'caixa'} = ${d.boxes * p.boxSize} un`),
        h('b', null, `≈ ${money(costOf(p.id, d.boxes, p.boxSize))} por pedido`))));
  }
  body.appendChild(grid);
}
