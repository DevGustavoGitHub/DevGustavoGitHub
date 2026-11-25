/** Visual original de cédulas e moedas (CSS). */
import type { Cents } from '../sim/money';
import { h, moneyShort } from './dom';

const BILL_COLORS: Record<number, [string, string]> = {
  20000: ['#8f9bb3', '#5c6a87'], 10000: ['#6fbf8a', '#2f8a58'], 5000: ['#f0a85a', '#c4741e'],
  2000: ['#e9c658', '#b8921a'], 1000: ['#e98f8f', '#bd4c4c'], 500: ['#a58ee0', '#6f55bd'], 200: ['#78b4e8', '#3a7fbf'],
};
const COIN_COLORS: Record<number, [string, string]> = {
  100: ['#f1d37a', '#b88f1d'], 50: ['#e3c26a', '#a67c16'], 25: ['#d6a96a', '#9a6a2a'], 10: ['#cfd3da', '#8a919e'], 5: ['#d8a98a', '#a06a4a'],
};

export const isBill = (d: Cents): boolean => d >= 200;

export function denomLabel(d: Cents): string {
  return d >= 100 ? `R$ ${d / 100}` : `${d} centavos`;
}

/** Cria o elemento visual (botão se `onClick`, senão span decorativo). */
export function denomEl(d: Cents, opts: { mini?: boolean; onClick?: () => void } = {}): HTMLElement {
  const bill = isBill(d);
  const [c1, c2] = (bill ? BILL_COLORS[d] : COIN_COLORS[d]) ?? ['#ccc', '#999'];
  const label = d >= 100 ? String(d / 100) : String(d);
  const kids = bill
    ? [h('i', { class: 'orn' }), h('i', { class: 'orn2' }), h('small', null, 'R$'), h('b', null, label)]
    : [h('b', null, label)];
  const cls = `den ${bill ? 'bill' : 'coin'}${d === 100 ? ' bimetal' : ''}${opts.mini ? ' mini' : ''}`;
  const attrs = { class: cls, style: `--c1:${c1};--c2:${c2}`, 'aria-label': moneyShort(d) };
  return opts.onClick
    ? h('button', { ...attrs, on: { click: opts.onClick } }, ...kids)
    : h('span', attrs, ...kids);
}
