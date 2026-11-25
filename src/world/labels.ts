/**
 * Rótulos procedurais dos produtos: nome curto + pictograma desenhado em canvas (tudo original), especificação da
 * área do rótulo na geometria (plano frontal ou faixa cilíndrica) e miniatura para as etiquetas de preço.
 * Sem texturas por quadro: o atlas (atlas.ts) chama `drawLabel` uma vez por produto.
 */
import * as THREE from 'three';
import { productById } from '../sim/catalog';
import { productColorOf, productShapeOf, css } from './look';

export const LABEL_CELL_W = 256, LABEL_CELL_H = 384;

/** Área do rótulo no modelo do produto: `flat` (plano em z) ou `cyl` (faixa de cilindro/cone, `w` = largura do arco). */
export type LabelSpec =
  | { k: 'flat'; y: number; w: number; h: number; z: number }
  | { k: 'cyl'; y: number; w: number; h: number; rt: number; rb: number };

const HAND: Record<string, LabelSpec> = {
  arroz: { k: 'flat', y: -0.01, w: 0.22, h: 0.24, z: 0.0535 },
  feijao: { k: 'flat', y: 0, w: 0.16, h: 0.19, z: 0.0415 },
  macarrao: { k: 'flat', y: -0.01, w: 0.15, h: 0.19, z: 0.0315 },
  cafe: { k: 'flat', y: 0, w: 0.12, h: 0.15, z: 0.046 },
  refri: { k: 'cyl', y: 0.02, w: 0.1, h: 0.17, rt: 0.06, rb: 0.06 },
  agua: { k: 'cyl', y: 0.03, w: 0.09, h: 0.14, rt: 0.052, rb: 0.052 },
  leite: { k: 'flat', y: -0.01, w: 0.08, h: 0.14, z: 0.038 },
  queijo: { k: 'cyl', y: 0, w: 0.15, h: 0.055, rt: 0.1045, rb: 0.1045 },
  pao: { k: 'flat', y: 0, w: 0.15, h: 0.1, z: 0.051 },
  detergente: { k: 'flat', y: -0.005, w: 0.085, h: 0.13, z: 0.034 },
  sorvete: { k: 'cyl', y: 0.01, w: 0.15, h: 0.08, rt: 0.0967, rb: 0.0844 },
};

export function labelSpec(pid: string): LabelSpec | null {
  if (HAND[pid]) return HAND[pid]!;
  let p;
  try { p = productById(pid); } catch { return null; }
  switch (productShapeOf(p)) {
    case 'bottle': return { k: 'cyl', y: 0.02, w: 0.085, h: 0.11, rt: 0.0465, rb: 0.0465 };
    case 'can': return { k: 'cyl', y: 0.03, w: 0.065, h: 0.08, rt: 0.039, rb: 0.039 };
    case 'jar': return { k: 'cyl', y: 0.01, w: 0.09, h: 0.07, rt: 0.0535, rb: 0.0535 };
    case 'bag': return { k: 'flat', y: 0, w: 0.16, h: 0.2, z: 0.0385 };
    case 'tray': return { k: 'flat', y: 0.075, w: 0.2, h: 0.07, z: -0.088 };
    default: return { k: 'flat', y: -0.01, w: 0.13, h: 0.15, z: 0.04 };
  }
}
/** Fração da célula (256×384) ocupada pelo rótulo de `pid` (mantém a proporção, sem distorcer). */
export function labelFrac(pid: string): { fw: number; fh: number } {
  const s = labelSpec(pid);
  const a = s ? s.w / s.h : 1;
  const ca = LABEL_CELL_W / LABEL_CELL_H;
  return a <= ca ? { fw: (a * LABEL_CELL_H) / LABEL_CELL_W, fh: 1 } : { fw: 1, fh: LABEL_CELL_W / a / LABEL_CELL_H };
}

const SHORT: Record<string, string> = {
  papelhig: 'P. HIGIÊNICO', cremedental: 'CREME DENTAL', carne: 'CARNE MOÍDA', pilha: 'PILHAS', fone: 'FONE', refri: 'REFRI',
};
/** Nome curto em maiúsculas (derivado do nome do catálogo). */
export function shortName(pid: string): string {
  if (SHORT[pid]) return SHORT[pid]!;
  try { return productById(pid).name.split(/[\s(]/)[0]!.toUpperCase(); } catch { return pid.toUpperCase(); }
}
const hex = (pid: string): number => {
  try { return productColorOf(productById(pid)); } catch { return 0xaaaaaa; }
};
const shade = (c: number, to: number, k: number): string => css(new THREE.Color(c).lerp(new THREE.Color(to), k).getHex());

/* ---------- pictogramas (coordenadas unitárias: raio 1 ≈ metade do disco) ---------- */
type G = CanvasRenderingContext2D;
const OL = '#3a2a1e';
function fs(g: G, fill: string): void { g.fillStyle = fill; g.fill(); g.stroke(); }
function ell(g: G, x: number, y: number, rx: number, ry: number, rot: number, fill: string): void {
  g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); fs(g, fill);
}
function circ(g: G, x: number, y: number, r: number, fill: string): void { ell(g, x, y, r, r, 0, fill); }
function rr(g: G, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); fs(g, fill);
}
function poly(g: G, pts: number[][], fill: string): void {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!))); g.closePath(); fs(g, fill);
}
function line(g: G, pts: number[][], col: string, lw: number): void {
  g.save(); g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!))); g.stroke(); g.restore();
}
function thick(g: G, path: () => void, outer: string, inner: string, lw: number): void {
  g.save(); g.lineCap = 'round';
  path(); g.strokeStyle = OL; g.lineWidth = lw + 0.12; g.stroke();
  path(); g.strokeStyle = outer; g.lineWidth = lw; g.stroke();
  path(); g.strokeStyle = inner; g.lineWidth = lw * 0.6; g.stroke();
  g.restore();
}

const ICONS: Record<string, (g: G) => void> = {
  arroz: (g) => { for (const [x, y, r] of [[-.45, -.3, .5], [.1, -.5, -.3], [.45, -.1, .8], [-.1, 0, .2], [-.5, .3, -.5], [.2, .4, .4], [-.1, .65, -.2]] as const) ell(g, x, y, .32, .13, r, '#fffbe8'); },
  feijao: (g) => { for (const [x, y, r] of [[-.4, -.35, .5], [.25, -.45, -.4], [.5, .1, .9], [-.1, .1, .2], [-.45, .4, -.6], [.2, .5, .3]] as const) { ell(g, x, y, .3, .19, r, '#8b4a26'); ell(g, x - .05, y - .05, .12, .05, r, '#c98a5c'); } },
  macarrao: (g) => { for (const k of [-1, 0, 1]) thick(g, () => { g.beginPath(); for (let i = 0; i <= 20; i++) { const x = -.75 + i * .075, y = k * .4 + Math.sin(x * 5 + k) * .13; i ? g.lineTo(x, y) : g.moveTo(x, y); } }, '#c58a22', '#f6cf55', .2); },
  cafe: (g) => {
    thick(g, () => { g.beginPath(); g.arc(.5, .12, .22, -1.4, 1.4); }, '#fff', '#fff', .12);
    ell(g, 0, .62, .85, .18, 0, '#fff');
    rr(g, -.55, -.25, 1, .75, .32, '#fff'); ell(g, -.05, -.25, .5, .11, 0, '#6b3a1d');
    for (const x of [-.25, .15]) line(g, [[x, -.5], [x + .1, -.65], [x - .05, -.8]], '#9a9a9a', .08);
  },
  refri: (g) => { rr(g, -.14, -.9, .28, .2, .04, '#d83a3a'); rr(g, -.34, -.7, .68, 1.6, .22, '#e04040'); rr(g, -.34, -.12, .68, .55, .02, '#fff'); line(g, [[-.2, .15], [.2, .15]], '#d83a3a', .1); line(g, [[-.2, -.5], [-.2, -.2]], '#ffb0b0', .07); },
  agua: (g) => { g.beginPath(); g.moveTo(0, -.9); g.bezierCurveTo(.15, -.5, .66, -.1, .66, .28); g.arc(0, .28, .66, 0, Math.PI); g.bezierCurveTo(-.66, -.1, -.15, -.5, 0, -.9); fs(g, '#3fa2ea'); ell(g, -.25, .2, .1, .22, .3, '#cdeaff'); },
  leite: (g) => { poly(g, [[-.55, -.65], [.55, -.65], [.4, .8], [-.4, .8]], '#e8f4ff'); poly(g, [[-.5, -.2], [.5, -.2], [.4, .8], [-.4, .8]], '#fff'); line(g, [[-.4, -.2], [.4, -.2]], '#9cc8f0', .07); },
  queijo: (g) => { poly(g, [[-.85, .5], [.85, .5], [.85, -.5]], '#f7c73f'); poly(g, [[-.85, .5], [.85, .5], [.85, .27], [-.85, .27]], '#e8a92a'); circ(g, .45, .0, .11, '#e0a420'); circ(g, .62, -.25, .07, '#e0a420'); circ(g, .05, .15, .08, '#e0a420'); },
  pao: (g) => { g.rotate(-.45); rr(g, -.9, -.32, 1.8, .64, .32, '#d99a52'); for (const x of [-.5, -.1, .3]) line(g, [[x - .1, -.2], [x + .1, .2]], '#a56a2a', .1); },
  detergente: (g) => { for (const [x, y, r] of [[-.2, .15, .52], [.45, -.35, .33], [.4, .5, .22]] as const) { circ(g, x, y, r, 'rgba(175,230,255,0.85)'); ell(g, x - r * .35, y - r * .4, r * .22, r * .12, -.6, '#fff'); } },
  sorvete: (g) => { poly(g, [[-.4, .05], [.4, .05], [0, .95]], '#e0a65a'); line(g, [[-.2, .3], [.2, .3]], '#a36a2a', .05); line(g, [[-.1, .55], [.1, .55]], '#a36a2a', .05); circ(g, 0, -.1, .42, '#f58bb0'); circ(g, 0, -.5, .32, '#8b5a3c'); circ(g, 0, -.85, .09, '#d62828'); },
  banana: (g) => { const p = (): void => { g.beginPath(); g.arc(0, -.35, .85, .2 * Math.PI, .8 * Math.PI); }; thick(g, p, '#e0b320', '#f7d33a', .42); circ(g, .69, .15, .08, '#6b4a1a'); circ(g, -.69, .15, .08, '#6b4a1a'); },
  tomate: (g) => { circ(g, 0, .1, .72, '#e0382a'); ell(g, -.3, -.1, .12, .2, .5, '#ff9a8a'); const pts: number[][] = []; for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5 - Math.PI / 2, r = i % 2 ? .12 : .38; pts.push([Math.cos(a) * r, -.62 + Math.sin(a) * r * .6]); } poly(g, pts, '#4aa23a'); },
  batata: (g) => { ell(g, 0, 0, .82, .56, .3, '#c29a5c'); for (const [x, y] of [[-.3, -.1], [.2, .2], [.4, -.2], [-.1, .25]] as const) ell(g, x, y, .09, .06, 0, '#8a6a38'); },
  alface: (g) => { ell(g, -.42, .1, .45, .62, -.5, '#6fbf4a'); ell(g, .42, .1, .45, .62, .5, '#6fbf4a'); ell(g, 0, -.05, .5, .72, 0, '#8fd45f'); line(g, [[0, .6], [0, -.5]], '#3f8a2a', .07); line(g, [[0, .2], [-.25, -.1]], '#3f8a2a', .05); line(g, [[0, .2], [.25, -.1]], '#3f8a2a', .05); },
  maca: (g) => { circ(g, -.28, .12, .52, '#d3303c'); circ(g, .28, .12, .52, '#d3303c'); line(g, [[0, -.3], [.1, -.75]], '#6b4a1a', .1); ell(g, .32, -.58, .26, .12, -.5, '#4aa23a'); ell(g, -.4, -.05, .09, .18, .4, '#ff9aa0'); },
  sabonete: (g) => { rr(g, -.78, -.35, 1.56, .75, .26, '#f8a8cc'); rr(g, -.52, -.16, 1.04, .37, .16, '#fcd0e3'); circ(g, .55, -.62, .2, 'rgba(255,255,255,0.9)'); circ(g, .2, -.78, .12, 'rgba(255,255,255,0.9)'); },
  papelhig: (g) => { rr(g, -.55, -.6, 1.1, 1.2, .02, '#fff'); ell(g, 0, .6, .55, .2, 0, '#fff'); ell(g, 0, -.6, .55, .2, 0, '#fff'); ell(g, 0, -.6, .22, .08, 0, '#c9b99a'); line(g, [[-.5, .1], [.5, .1]], '#cfcfcf', .05); },
  cremedental: (g) => { g.beginPath(); g.moveTo(-.55, -.5); g.bezierCurveTo(-.55, -.9, -.1, -.85, 0, -.62); g.bezierCurveTo(.1, -.85, .55, -.9, .55, -.5); g.bezierCurveTo(.55, -.1, .36, .1, .32, .58); g.bezierCurveTo(.27, .95, .1, .95, .08, .5); g.bezierCurveTo(.05, .3, -.05, .3, -.08, .5); g.bezierCurveTo(-.1, .95, -.27, .95, -.32, .58); g.bezierCurveTo(-.36, .1, -.55, -.1, -.55, -.5); fs(g, '#fff'); line(g, [[.62, -.75], [.62, -.45]], '#2fb7a8', .08); line(g, [[.47, -.6], [.77, -.6]], '#2fb7a8', .08); },
  shampoo: (g) => { rr(g, -.4, -.35, .8, 1.25, .2, '#4aa3df'); rr(g, -.4, .05, .8, .5, .04, '#fff'); rr(g, -.12, -.6, .24, .28, .04, '#2f6fa8'); rr(g, -.12, -.82, .55, .18, .07, '#2f6fa8'); },
  desodorante: (g) => { rr(g, -.32, -.3, .64, 1.2, .14, '#7e8ce0'); rr(g, -.28, -.85, .56, .5, .1, '#d7dbe6'); rr(g, -.32, .15, .64, .3, .02, '#fff'); for (const [x, y] of [[.55, -.7], [.72, -.55], [.62, -.85], [.8, -.78]] as const) circ(g, x, y, .05, '#9aa4b2'); },
  carne: (g) => { ell(g, 0, 0, .85, .62, .15, '#b72b32'); line(g, [[-.5, -.15], [-.1, -.3]], '#f0b0b0', .07); line(g, [[-.4, .2], [0, .05]], '#f0b0b0', .07); circ(g, .3, .05, .2, '#f6e6c8'); },
  frango: (g) => { g.rotate(-.6); ell(g, -.2, 0, .6, .5, 0, '#e8a05a'); ell(g, -.35, -.15, .2, .1, .3, '#f6c58a'); line(g, [[.3, .1], [.85, .1]], OL, .24); line(g, [[.3, .1], [.85, .1]], '#f6ecd8', .14); circ(g, .9, -.02, .1, '#f6ecd8'); circ(g, .9, .22, .1, '#f6ecd8'); },
  linguica: (g) => { const p = (): void => { g.beginPath(); g.arc(0, .35, .7, 1.12 * Math.PI, 1.88 * Math.PI); }; thick(g, p, '#b9532a', '#c8643c', .46); for (const a of [1.3, 1.5, 1.7]) line(g, [[Math.cos(a * Math.PI) * .6, .35 + Math.sin(a * Math.PI) * .6], [Math.cos(a * Math.PI) * .8, .35 + Math.sin(a * Math.PI) * .8]], '#7a2e12', .06); },
  presunto: (g) => { const p = (): void => { g.beginPath(); g.moveTo(-.78, -.1); g.bezierCurveTo(-.72, -.7, .5, -.78, .78, -.2); g.bezierCurveTo(.88, .32, .3, .72, -.3, .62); g.bezierCurveTo(-.68, .52, -.82, .2, -.78, -.1); }; p(); fs(g, '#fcd6d6'); g.save(); g.scale(.8, .8); p(); fs(g, '#f28a8a'); g.restore(); },
  mortadela: (g) => { circ(g, 0, 0, .78, '#f6c0c4'); circ(g, 0, 0, .64, '#e89aa0'); for (const [x, y] of [[-.3, -.2], [.25, -.3], [.1, .15], [-.2, .3], [.4, .2], [-.45, .05]] as const) circ(g, x, y, .09, '#fde0e0'); },
  pilha: (g) => { g.rotate(-.6); rr(g, -.75, -.36, 1.5, .72, .1, '#f2a31b'); rr(g, .75, -.14, .14, .28, .03, '#b8bec6'); rr(g, -.75, -.36, .42, .72, .1, '#33363d'); line(g, [[.1, 0], [.5, 0]], '#fff', .1); line(g, [[.3, -.2], [.3, .2]], '#fff', .1); },
  lampada: (g) => { for (let i = 0; i < 7; i++) { const a = -Math.PI + (i * Math.PI) / 6; line(g, [[Math.cos(a) * .68, -.2 + Math.sin(a) * .68], [Math.cos(a) * .88, -.2 + Math.sin(a) * .88]], '#e0a800', .07); } circ(g, 0, -.2, .5, '#ffe36a'); poly(g, [[-.25, .2], [.25, .2], [.2, .48], [-.2, .48]], '#f4d24a'); rr(g, -.22, .46, .44, .3, .06, '#b0b4ba'); ell(g, -.18, -.3, .08, .15, .5, '#fff8c8'); },
  fone: (g) => { thick(g, () => { g.beginPath(); g.arc(0, 0, .62, Math.PI, 2 * Math.PI); }, '#3b3f48', '#6a707c', .16); rr(g, -.84, -.05, .34, .66, .12, '#3b3f48'); rr(g, .5, -.05, .34, .66, .12, '#3b3f48'); },
  carregador: (g) => { rr(g, -.42, -.1, .84, .8, .16, '#2a6fdb'); rr(g, -.27, -.58, .15, .5, .03, '#cfd4da'); rr(g, .12, -.58, .15, .5, .03, '#cfd4da'); line(g, [[-.12, .25], [.1, .25]], '#fff', .08); },
  ventilador: (g) => { for (let i = 0; i < 4; i++) { g.save(); g.rotate((i * Math.PI) / 2 + .3); ell(g, 0, -.42, .2, .38, 0, '#8ab4f0'); g.restore(); } circ(g, 0, 0, .14, '#3b3f48'); g.save(); g.strokeStyle = OL; g.lineWidth = .08; g.beginPath(); g.arc(0, 0, .85, 0, Math.PI * 2); g.stroke(); g.restore(); },
};

/** Desenha o pictograma do produto centrado em (cx, cy) com raio `r` (px). */
export function drawIcon(g: G, pid: string, cx: number, cy: number, r: number): void {
  g.save(); g.translate(cx, cy); g.scale(r, r);
  g.lineWidth = 0.06; g.lineJoin = 'round'; g.strokeStyle = OL;
  const f = ICONS[pid];
  if (f) f(g);
  else { circ(g, 0, 0, .8, '#fff'); g.fillStyle = OL; g.font = '900 1.2px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(shortName(pid)[0] ?? '?', 0, .05); }
  g.restore();
}

function fitFont(g: G, text: string, maxW: number, size: number, min = 8): number {
  let s = size;
  do { g.font = `900 ${s}px system-ui, Arial, sans-serif`; s -= 2; } while (g.measureText(text).width > maxW && s > min);
  return s + 2;
}
function outlined(g: G, text: string, x: number, y: number, s: number, fill: string, stroke: string): void {
  g.lineJoin = 'round'; g.lineWidth = Math.max(2, s * 0.2); g.strokeStyle = stroke; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y);
}

/** Rótulo completo (fundo na cor do produto, faixa com o nome, disco branco com o pictograma). Preenche (0,0,w,h). */
export function drawLabel(g: G, pid: string, W: number, H: number): void {
  const c = hex(pid);
  const { fw, fh } = labelFrac(pid), w = W * fw, h = H * fh;
  g.fillStyle = css(c); g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const name = shortName(pid), dark = shade(c, 0x000000, 0.55);
  if (w / h < 1.5) {
    const bh = h * 0.25;
    g.fillStyle = dark; g.fillRect(0, 0, w, bh);
    const s = fitFont(g, name, w * 0.92, bh * 0.62);
    g.font = `900 ${s}px system-ui, Arial, sans-serif`; outlined(g, name, w / 2, bh * 0.54, s, '#fff', dark);
    const r = Math.min(w * 0.46, (h - bh) * 0.46), cy = bh + (h - bh) / 2;
    g.fillStyle = 'rgba(255,255,255,0.93)'; g.beginPath(); g.arc(w / 2, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = dark; g.lineWidth = Math.max(2, r * 0.05); g.stroke();
    drawIcon(g, pid, w / 2, cy, r * 0.82);
  } else {
    const r = h * 0.46;
    g.fillStyle = 'rgba(255,255,255,0.93)'; g.beginPath(); g.arc(h / 2, h / 2, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = dark; g.lineWidth = Math.max(2, r * 0.05); g.stroke();
    drawIcon(g, pid, h / 2, h / 2, r * 0.82);
    const tx = h + (w - h) / 2, s = fitFont(g, name, w - h - 8, h * 0.5);
    g.font = `900 ${s}px system-ui, Arial, sans-serif`; outlined(g, name, tx, h * 0.54, s, '#fff', dark);
  }
  g.strokeStyle = shade(c, 0x000000, 0.4); g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
}
