/** Widgets reutilizáveis (steppers, tiles de produto, linhas chave/valor). */
import type { Category } from '../sim/catalog';
import { h } from './dom';
import { icon } from './icons';

export const CATEGORY_COLOR: Record<Category, string> = {
  mercearia: '#d9a441', bebidas: '#3b7fd4', laticinios: '#5fb4d6', congelados: '#7b8ff0', padaria: '#c9803f', limpeza: '#35a891',
};
export const CATEGORY_NAME: Record<Category, string> = {
  mercearia: 'Mercearia', bebidas: 'Bebidas', laticinios: 'Laticínios', congelados: 'Congelados', padaria: 'Padaria', limpeza: 'Limpeza',
};

export function productTile(name: string, cat: Category): HTMLElement {
  return h('div', { class: 'ptile', style: `--tc:${CATEGORY_COLOR[cat]}` }, name.slice(0, 1).toUpperCase());
}

export function stepper(value: string, onMinus: () => void, onPlus: () => void, opts: { minusOff?: boolean; plusOff?: boolean } = {}): HTMLElement {
  return h('div', { class: 'stepper' },
    h('button', { class: 'icon-btn', 'aria-label': 'Menos', html: icon('minus'), disabled: opts.minusOff, on: { click: onMinus } }),
    h('output', null, value),
    h('button', { class: 'icon-btn', 'aria-label': 'Mais', html: icon('plus'), disabled: opts.plusOff, on: { click: onPlus } }));
}

export const kv = (k: string, v: string | Node, cls = ''): HTMLElement =>
  h('div', { class: `kv ${cls}` }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));

export function badge(text: string, tone: 'good' | 'bad' | 'warn' | 'info' | 'mute' = 'mute'): HTMLElement {
  return h('span', { class: `badge ${tone}` }, text);
}

/** Variação (seta + %) de um multiplicador de mercado. `invert`: subir é ruim (custo de compra). */
export function variation(mult: number, invert = true): HTMLElement {
  const pct = Math.round((mult - 1) * 100);
  const flat = Math.abs(pct) < 1;
  const up = pct > 0;
  const bad = invert ? up : !up;
  const cls = flat ? 'mute' : bad ? 'bad' : 'good';
  return h('span', { class: `var ${cls}`, title: 'Variação em relação à média' },
    h('span', { html: flat ? icon('minus', 14) : icon(up ? 'up' : 'down', 14) }),
    flat ? 'na média' : `${up ? '+' : ''}${pct}%`);
}

export const sectionTitle = (t: string, right?: Node | string): HTMLElement =>
  h('div', { class: 'sec-title' }, h('h4', null, t), right ?? null);

export const emptyState = (t: string): HTMLElement => h('div', { class: 'empty' }, t);

/** Pips de nível (n de max). */
export function pips(n: number, max: number): HTMLElement {
  return h('span', { class: 'pips', 'aria-label': `Nível ${n} de ${max}` },
    Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
}
