/** Widgets reutilizáveis (steppers, tiles de produto, linhas chave/valor). */
import type { Category, Product } from '../sim/catalog';
import { CATEGORY_COLOR, productSvg } from './art';
import { h, money } from './dom';
import { icon } from './icons';

export { CATEGORY_COLOR };
export const CATEGORY_NAME: Record<Category, string> = {
  mercearia: 'Mercearia', bebidas: 'Bebidas', laticinios: 'Laticínios', congelados: 'Congelados', padaria: 'Padaria', limpeza: 'Limpeza',
  hortifruti: 'Hortifrúti', higiene: 'Higiene e Beleza', frios: 'Açougue e Frios', eletronicos: 'Eletrônicos',
};

/** Ícone procedural do produto (cor/forma do catálogo). */
export function productTile(p: Product): HTMLElement {
  return h('div', { class: 'ptile pt3', style: `--tc:${CATEGORY_COLOR[p.category]}`, html: productSvg(p, 40), title: p.name });
}

/** Botão de compra no estilo da referência: azul (comprar), vermelho (nível da loja N), cinza (possuído/sem dinheiro). */
export type BuyState =
  | { kind: 'buy'; label: string; onClick: () => void; id?: string }
  | { kind: 'lock'; level: number }
  | { kind: 'owned'; label?: string }
  | { kind: 'poor'; cost: number; have: number }
  | { kind: 'off'; label: string };
export function actionBtn(s: BuyState): HTMLButtonElement {
  switch (s.kind) {
    case 'buy': return h('button', { class: 'abtn buy', id: s.id, on: { click: s.onClick } }, s.label);
    case 'lock': return h('button', { class: 'abtn lock', disabled: true, 'aria-label': `Libera no nível ${s.level} da loja` }, `Nível da loja ${s.level}`);
    case 'owned': return h('button', { class: 'abtn owned', disabled: true }, s.label ?? 'Possuído');
    case 'poor': return h('button', { class: 'abtn poor', disabled: true, title: `Faltam ${money(s.cost - s.have)}` }, `Faltam ${money(s.cost - s.have)}`);
    default: return h('button', { class: 'abtn off', disabled: true }, s.label);
  }
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

/** Texto colorido por sinal com seta (↑/↓) que só aparece no modo daltônico (`.mx-cb`). */
export function signed(value: number, text: string, goodWhenPositive = true): HTMLElement {
  const flat = value === 0;
  const good = goodWhenPositive ? value >= 0 : value <= 0;
  return h('span', { class: flat ? 'mute' : good ? 'good' : 'bad' },
    flat ? null : h('span', { class: 'cbi', 'aria-hidden': 'true' }, value > 0 ? '↑' : '↓'), text);
}

/** Interruptor acessível (role=switch). */
export function toggle(on: boolean, label: string, onChange: (v: boolean) => void): HTMLElement {
  const b = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': label });
  b.addEventListener('click', () => onChange(b.getAttribute('aria-checked') !== 'true'));
  return b;
}
