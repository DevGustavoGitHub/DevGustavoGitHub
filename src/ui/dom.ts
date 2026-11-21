/** Helpers de DOM e formatação (sem dependências). */
import type { Cents } from '../sim/money';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string; on?: Record<string, (e: Event) => void> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'on') for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el: Node, kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
}

export const clear = (el: Element): void => { while (el.firstChild) el.removeChild(el.firstChild); };

/** `R$ 1.234,50` — dinheiro em centavos. */
export function money(c: Cents, opts: { sign?: boolean } = {}): string {
  const neg = c < 0;
  const abs = Math.abs(Math.round(c));
  const reais = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const body = `R$ ${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`;
  if (neg) return `−${body}`;
  return opts.sign && c > 0 ? `+${body}` : body;
}

/** Valor curto para notas/moedas: `R$ 2`, `R$ 0,50`. */
export function moneyShort(c: Cents): string {
  return c % 100 === 0 ? `R$ ${c / 100}` : `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
}

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Mensagem amigável a partir de um erro lançado pela api. */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const ni = /^NOT_IMPLEMENTED:\s*(.*)$/.exec(m);
  return ni ? `Recurso em desenvolvimento (${ni[1] ?? '?'})` : m;
}
export const isNotImplemented = (e: unknown): boolean => e instanceof Error && e.message.startsWith('NOT_IMPLEMENTED');

export function el$<T extends HTMLElement>(root: ParentNode, sel: string): T {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`UI: elemento ${sel} não encontrado`);
  return e;
}
