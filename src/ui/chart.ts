/** Gráfico de lucro diário em SVG próprio (barras divergentes), com tooltip por toque/hover/teclado. Cores seguras para daltonismo (azul/laranja + hachura). */
import type { DayReport } from '../sim/economy';
import { h, money } from './dom';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export const POS_COLOR = '#2a6fdb';
export const NEG_COLOR = '#e8710a';

/** Valor curto para o eixo: 1,2 mil / 15 mil. */
export function compact(c: number): string {
  const r = c / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? '−' : '';
  if (a >= 1000) return `${sign}R$ ${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',')} mil`;
  return `${sign}R$ ${Math.round(a)}`;
}

const W = 360, H = 190, ML = 54, MR = 8, MT = 10, MB = 24;

export function profitChart(rows: DayReport[], hold: (v: boolean) => void): HTMLElement {
  const data = rows.slice(-30);
  const wrap = h('div', { class: 'chart' });
  const n = data.length;
  const vals = data.map((r) => r.netProfit);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const span = Math.max(hi - lo, 1);
  const top = hi + span * 0.08, bot = lo - (lo < 0 ? span * 0.08 : 0);
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const y = (v: number): number => MT + ((top - v) / (top - bot)) * plotH;
  const step = plotW / Math.max(n, 1);
  const bw = Math.max(3, Math.min(22, step * 0.68));

  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0,
    'aria-label': `Gráfico de lucro líquido dos últimos ${n} dias. Use as setas para percorrer os dias.` }) as SVGSVGElement;
  const defs = sv('defs');
  const pat = sv('pattern', { id: 'mx-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(sv('rect', { width: 6, height: 6, fill: NEG_COLOR }), sv('rect', { width: 2.4, height: 6, fill: '#fff', opacity: 0.55 }));
  defs.append(pat);
  svg.append(defs);

  const ticks: number[] = [];
  for (const t of [hi, 0, lo].map((v) => Math.round(v))) if (t >= bot && t <= top && ticks.every((o) => Math.abs(y(o) - y(t)) >= 16)) ticks.push(t);
  for (const t of ticks) {
    svg.append(sv('line', { x1: ML, x2: W - MR, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : 'gl' }));
    const lab = sv('text', { x: ML - 6, y: y(t) + 4, 'text-anchor': 'end' });
    lab.textContent = compact(t);
    svg.append(lab);
  }
  const sel = sv('rect', { class: 'sel', y: MT, height: plotH, width: step, x: -100 });
  svg.append(sel);
  data.forEach((r, i) => {
    const x = ML + i * step + (step - bw) / 2;
    const y0 = y(0), y1 = y(r.netProfit);
    const top1 = Math.min(y0, y1), hh = Math.max(1.5, Math.abs(y0 - y1));
    const bar = sv('rect', { x, y: top1, width: bw, height: hh, rx: 2, class: r.netProfit >= 0 ? 'bar-pos' : 'bar-neg' });
    svg.append(bar);
    if (r.netProfit < 0) svg.append(sv('rect', { x, y: top1, width: bw, height: hh, rx: 2, fill: 'none', stroke: NEG_COLOR, 'stroke-width': 1.5 }));
  });
  // rótulos do eixo X: primeiro, meio e último dia
  const xl = (i: number, anchor: string): void => {
    const t = sv('text', { x: ML + i * step + step / 2, y: H - 6, 'text-anchor': anchor });
    t.textContent = `Dia ${data[i]!.day}`;
    svg.append(t);
  };
  if (n >= 1) xl(0, n > 1 ? 'start' : 'middle');
  if (n >= 5) xl(Math.floor((n - 1) / 2), 'middle');
  if (n >= 2) xl(n - 1, 'end');

  const tip = h('div', { class: 'ctip', hidden: true });
  let cur = -1;
  let hideT = 0;
  const show = (i: number): void => {
    if (i < 0 || i >= n) return;
    cur = i;
    const r = data[i]!;
    sel.setAttribute('x', String(ML + i * step));
    tip.hidden = false;
    tip.replaceChildren(
      h('b', null, `Dia ${r.day}`),
      h('span', null, `Lucro ${r.netProfit >= 0 ? '↑ ' : '↓ '}${money(r.netProfit, { sign: true })}`), h('br'),
      h('span', null, `Receita ${money(r.revenue)} · ${r.served} clientes`));
    const pct = ((ML + i * step + step / 2) / W) * 100;
    tip.style.left = `${Math.min(80, Math.max(20, pct))}%`;
    tip.style.top = '2px';
    hold(true);
  };
  const hide = (): void => { cur = -1; tip.hidden = true; sel.setAttribute('x', '-100'); hold(false); };
  const idxAt = (e: PointerEvent): number => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    return Math.floor((x - ML) / step);
  };
  svg.addEventListener('pointermove', (e) => { window.clearTimeout(hideT); show(idxAt(e)); });
  svg.addEventListener('pointerdown', (e) => { window.clearTimeout(hideT); show(idxAt(e)); });
  const leave = (e: PointerEvent): void => {
    window.clearTimeout(hideT);
    // toque: mantém o balão por alguns segundos; mouse: some ao sair
    hideT = window.setTimeout(hide, e.pointerType === 'mouse' ? 0 : 3500);
  };
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('pointerup', leave);
  svg.addEventListener('pointercancel', leave);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? n - 1 : Math.max(0, cur - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(cur < 0 ? 0 : Math.min(n - 1, cur + 1)); }
    else if (e.key === 'Escape') hide();
  });
  svg.addEventListener('blur', () => hide());

  wrap.append(svg, tip);
  return wrap;
}

export function chartLegend(): HTMLElement {
  return h('div', { class: 'legend' },
    h('span', null, h('i', { style: `background:${POS_COLOR}` }), 'Lucro (↑ acima da linha)'),
    h('span', null, h('i', { style: `background:repeating-linear-gradient(45deg,${NEG_COLOR} 0 3px,#fff 3px 5px);border:1.5px solid ${NEG_COLOR}` }), 'Prejuízo (↓ abaixo da linha)'));
}
