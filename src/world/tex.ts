/**
 * Texturas procedurais (canvas) da Fase 3: piso de tábuas, tijolos, concreto, calçada, asfalto, janelas de prédio
 * e um ATLAS de decalques (letreiro, pôsteres, placa ABERTO/FECHADO, fita do depósito, placa DEPÓSITO, área de
 * ENTREGAS, anúncio do ponto de ônibus, tela do notebook, símbolos das lixeiras). Todos os decalques usam UM
 * material (1 draw call por malha fundida). Tudo vive até o fim do jogo (cache); arte 100% original.
 */
import * as THREE from 'three';
import { makeCanvas, canvasTex, hash01 } from './kit';
import type { Cell } from './atlas';

/* ---------------- texturas repetidas ---------------- */
const cache = new Map<string, THREE.CanvasTexture>();
function once(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

/** Tábuas de madeira claras (quase brancas: a cor vem de decor.floorColor). 1 tile = 1,2 m, 8 tábuas. */
export const woodTex = (): THREE.CanvasTexture => once('wood', () => {
  const { c, g } = makeCanvas(256, 256);
  g.fillStyle = '#f1ece6'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    const x0 = i * 32;
    const off = Math.floor(hash01(i, 3) * 256);
    for (let s = 0; s < 2; s++) {
      const y0 = (off + s * 128) % 256;
      const v = 232 + Math.floor(hash01(i, s, 7) * 22) - 11;
      g.fillStyle = `rgb(${v},${v - 4},${v - 9})`;
      for (const yy of [y0, y0 - 256]) g.fillRect(x0 + 1, yy, 30, 128);
      g.fillStyle = 'rgba(120,90,60,0.55)';
      for (const yy of [y0, y0 - 256]) g.fillRect(x0 + 1, yy, 30, 2); // junta de topo
    }
    g.fillStyle = 'rgba(160,130,100,0.18)'; // veios
    for (let k = 0; k < 5; k++) {
      const gx = x0 + 4 + Math.floor(hash01(i, k, 11) * 24);
      for (let y = 0; y < 256; y += 4) g.fillRect(gx + Math.round(Math.sin((y + k * 40) / 23) * 1.5), y, 1, 4);
    }
    g.fillStyle = 'rgba(95,70,48,0.6)'; g.fillRect(x0, 0, 1, 256); // fresta entre tábuas
  }
  return canvasTex(c, true);
});

/** Tijolos vermelhos com argamassa clara. 1 tile = 1 m (8 fiadas). */
export const brickTex = (): THREE.CanvasTexture => once('brick', () => {
  const { c, g } = makeCanvas(256, 256);
  g.fillStyle = '#d9cfc3'; g.fillRect(0, 0, 256, 256);
  const cols = ['#b04a34', '#a8432f', '#b9563c', '#9e3e2b', '#b44f38', '#a24834'];
  for (let r = 0; r < 8; r++) {
    const off = r % 2 ? 32 : 0;
    for (let k = -1; k < 5; k++) {
      const x = k * 64 + off, y = r * 32;
      g.fillStyle = cols[Math.floor(hash01(r, k, 5) * cols.length)]!;
      g.fillRect(x + 2, y + 2, 60, 28);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 2, y + 25, 60, 5);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 2, y + 2, 60, 4);
    }
  }
  return canvasTex(c, true);
});

/** Ladrilhos (depósito, concreto claro). */
export const tileTex = (): THREE.CanvasTexture => once('tile', () => {
  const { c, g } = makeCanvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ececec'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#cfcfcf'; g.lineWidth = 3; g.strokeRect(1, 1, 126, 126);
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  return canvasTex(c, true);
});

export const paverTex = (): THREE.CanvasTexture => once('paver', () => {
  const { c, g } = makeCanvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f3f4f6'; g.fillRect(2, 2, 60, 60); g.fillRect(66, 66, 60, 60);
  g.fillStyle = '#e9ebee'; g.fillRect(66, 2, 60, 60); g.fillRect(2, 66, 60, 60);
  return canvasTex(c, true);
});

export const asphaltTex = (): THREE.CanvasTexture => once('asphalt', () => {
  const { c, g } = makeCanvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 420; i++) {
    const v = 200 + Math.floor(hash01(i, 7) * 55) - 28;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(hash01(i, 1) * 128, hash01(i, 2) * 128, 1 + hash01(i, 3) * 2, 1 + hash01(i, 4) * 2);
  }
  return canvasTex(c, true);
});

/** Janelas de prédio (mapa de cor e mapa de brilho noturno). */
export function windowTex(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const map = once('win', () => {
    const a = makeCanvas(128, 128);
    a.g.fillStyle = '#ffffff'; a.g.fillRect(0, 0, 128, 128);
    a.g.fillStyle = '#d6d6d6'; a.g.fillRect(0, 118, 128, 10);
    a.g.fillStyle = '#5f7486'; a.g.fillRect(26, 30, 76, 78);
    a.g.fillStyle = '#9cc8e6'; a.g.fillRect(30, 34, 68, 70);
    a.g.fillStyle = '#5f7486'; a.g.fillRect(62, 34, 4, 70); a.g.fillRect(30, 68, 68, 4);
    a.g.fillStyle = 'rgba(255,255,255,0.4)'; a.g.fillRect(32, 36, 14, 30);
    return canvasTex(a.c, true);
  });
  const glow = once('winGlow', () => {
    const b = makeCanvas(128, 128);
    b.g.fillStyle = '#000'; b.g.fillRect(0, 0, 128, 128);
    for (const [x, y] of [[30, 34], [66, 34], [30, 72], [66, 72]] as const) {
      b.g.fillStyle = hash01(x, y) > 0.2 ? '#ffd27a' : '#000'; b.g.fillRect(x, y, 32, 32);
    }
    return canvasTex(b.c, true);
  });
  return { map, glow };
}

/* ---------------- atlas de decalques ---------------- */
const AW = 1024, AH = 1024;
interface Px { x: number; y: number; w: number; h: number }
const R = {
  sign: { x: 0, y: 0, w: 1024, h: 224 },
  posters: [0, 1, 2, 3].map((i) => ({ x: i * 256, y: 224, w: 256, h: 352 })),
  open: { x: 0, y: 576, w: 256, h: 128 },
  closed: { x: 256, y: 576, w: 256, h: 128 },
  plate: { x: 512, y: 576, w: 512, h: 128 },
  tape: { x: 0, y: 704, w: 1024, h: 64 },
  delivery: { x: 0, y: 768, w: 512, h: 256 },
  busAd: { x: 512, y: 768, w: 256, h: 256 },
  laptop: { x: 768, y: 768, w: 256, h: 160 },
  recycle: { x: 768, y: 928, w: 96, h: 96 },
  trash: { x: 864, y: 928, w: 96, h: 96 },
} satisfies Record<string, Px | Px[]>;
const cellOf = (p: Px, inset = 1.5): Cell => ({ u0: (p.x + inset) / AW, v0: 1 - (p.y + p.h - inset) / AH, du: (p.w - inset * 2) / AW, dv: (p.h - inset * 2) / AH });

let atlas: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial } | null = null;

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function fit(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 900): number {
  let s = size;
  do { g.font = `${weight} ${s}px system-ui, "Segoe UI", Arial, sans-serif`; s -= 2; } while (g.measureText(text).width > maxW && s > 8);
  return s + 2;
}
function clip(g: CanvasRenderingContext2D, p: Px, fn: () => void): void {
  g.save(); g.beginPath(); g.rect(p.x, p.y, p.w, p.h); g.clip(); g.translate(p.x, p.y); fn(); g.restore();
}
const center = (g: CanvasRenderingContext2D): void => { g.textAlign = 'center'; g.textBaseline = 'middle'; };

function drawStatic(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, AW, AH);
  // pôsteres originais
  const posters: ((w: number, h: number) => void)[] = [
    (w, h) => { // OFERTAS
      g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e63946'; g.fillRect(0, 0, w, 70); center(g); g.fillStyle = '#fff'; fit(g, 'OFERTAS', w - 30, 48); g.fillText('OFERTAS', w / 2, 37);
      g.strokeStyle = '#33415c'; g.lineWidth = 7; g.lineJoin = 'round'; // carrinho
      g.beginPath(); g.moveTo(40, 110); g.lineTo(70, 110); g.lineTo(95, 205); g.lineTo(205, 205); g.lineTo(222, 135); g.lineTo(80, 135); g.stroke();
      for (const [x, col] of [[98, '#3a86ff'], [132, '#2fbf71'], [166, '#ff7a2e']] as const) { g.fillStyle = col; g.fillRect(x, 145 - (x % 3) * 6, 30, 52); }
      g.fillStyle = '#33415c'; g.beginPath(); g.arc(110, 225, 11, 0, 7); g.arc(190, 225, 11, 0, 7); g.fill();
      g.fillStyle = '#e63946'; fit(g, 'ATÉ 30%', w - 30, 54); g.fillText('ATÉ 30%', w / 2, 282);
      g.fillStyle = '#33415c'; fit(g, 'DE DESCONTO', w - 40, 26, 800); g.fillText('DE DESCONTO', w / 2, 322);
    },
    (w, h) => { // HORTIFRÚTI
      g.fillStyle = '#c9eeb0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2d6a4f'; center(g); fit(g, 'FRUTAS E', w - 30, 40); g.fillText('FRUTAS E', w / 2, 38); g.fillText('VERDURAS', w / 2, 80);
      for (const [x, y] of [[70, 170], [128, 150], [186, 170], [100, 215], [160, 215]] as const) {
        g.fillStyle = '#d62839'; g.beginPath(); g.arc(x, y, 27, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(x - 9, y - 9, 7, 0, 7); g.fill();
        g.fillStyle = '#40916c'; g.beginPath(); g.ellipse(x + 6, y - 28, 9, 5, -0.5, 0, 7); g.fill();
      }
      g.strokeStyle = '#f4c430'; g.lineWidth = 16; g.lineCap = 'round'; g.beginPath(); g.arc(128, 215, 75, 0.35, 1.25); g.stroke();
      g.fillStyle = '#2d6a4f'; fit(g, 'FRESQUINHAS!', w - 30, 34); g.fillText('FRESQUINHAS!', w / 2, 318);
    },
    (w, h) => { // PÃO
      g.fillStyle = '#ffb347'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#7b3f00'; center(g); fit(g, 'PÃO', w - 30, 64); g.fillText('PÃO', w / 2, 46);
      fit(g, 'QUENTINHO', w - 30, 40); g.fillText('QUENTINHO', w / 2, 96);
      for (const [x, y, s] of [[90, 180, 1], [168, 190, 0.9], [128, 235, 1.1]] as const) {
        g.fillStyle = '#c46a1c'; g.beginPath(); g.ellipse(x, y, 55 * s, 26 * s, -0.15, 0, 7); g.fill();
        g.strokeStyle = '#f6d7a7'; g.lineWidth = 5;
        for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(x + k * 20 * s - 6, y + 10 * s); g.lineTo(x + k * 20 * s + 8, y - 12 * s); g.stroke(); }
      }
      g.fillStyle = '#7b3f00'; fit(g, 'TODO DIA', w - 40, 32); g.fillText('TODO DIA', w / 2, 315);
    },
    (w, h) => { // LEVE 3 PAGUE 2
      g.fillStyle = '#3a86ff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd23f';
      for (const [x, y, r] of [[40, 40, 16], [220, 60, 12], [36, 300, 12], [222, 290, 18]] as const) {
        g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr2 = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } g.fill();
      }
      g.fillStyle = '#fff'; center(g); fit(g, 'LEVE', w - 40, 56); g.fillText('LEVE', w / 2, 95);
      g.fillStyle = '#ffd23f'; g.font = '900 120px system-ui, Arial, sans-serif'; g.fillText('3', w / 2 - 50, 180); g.fillText('2', w / 2 + 50, 262);
      g.fillStyle = '#fff'; fit(g, 'PAGUE', 110, 34); g.fillText('PAGUE', 70, 262);
    },
  ];
  R.posters.forEach((p, i) => clip(g, p, () => posters[i]!(p.w, p.h)));
  // placa ABERTO / FECHADO
  const doorSign = (p: Px, bg: string, text: string): void => clip(g, p, () => {
    g.fillStyle = '#ffffff'; rr(g, 4, 4, p.w - 8, p.h - 8, 22); g.fill();
    g.fillStyle = bg; rr(g, 12, 12, p.w - 24, p.h - 24, 16); g.fill();
    center(g); g.fillStyle = '#fff'; fit(g, text, p.w - 50, 64); g.fillText(text, p.w / 2, p.h / 2 + 3);
  });
  doorSign(R.open, '#23a455', 'ABERTO');
  doorSign(R.closed, '#d62839', 'FECHADO');
  clip(g, R.plate, () => { // placa DEPÓSITO
    const { w, h } = R.plate;
    g.fillStyle = '#9aa3ad'; rr(g, 2, 2, w - 4, h - 4, 14); g.fill();
    g.fillStyle = '#e4e8ec'; rr(g, 12, 12, w - 24, h - 24, 10); g.fill();
    g.fillStyle = '#5b6470'; for (const [x, y] of [[24, 24], [w - 24, 24], [24, h - 24], [w - 24, h - 24]] as const) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    center(g); g.fillStyle = '#3d4450'; fit(g, 'DEPÓSITO', w - 90, 80); g.fillText('DEPÓSITO', w / 2, h / 2 + 4);
  });
  clip(g, R.tape, () => { // fita de interdição
    const { w, h } = R.tape;
    g.fillStyle = '#d62828'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d1d1f'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    center(g); g.fillStyle = '#fff'; g.font = '900 30px system-ui, Arial, sans-serif';
    g.fillText('DEPÓSITO FECHADO  •  COMPRE A LICENÇA  •  DEPÓSITO FECHADO', w / 2, h / 2 + 1);
  });
  clip(g, R.busAd, () => { // anúncio do ponto de ônibus
    const { w, h } = R.busAd;
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ff8fab'); gr.addColorStop(1, '#ffc8dd');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e09f3e'; g.beginPath(); g.moveTo(98, 150); g.lineTo(158, 150); g.lineTo(128, 236); g.fill();
    for (const [x, y, col] of [[110, 128, '#fff1e6'], [146, 128, '#a0c4ff'], [128, 100, '#ffadad']] as const) { g.fillStyle = col; g.beginPath(); g.arc(x, y, 26, 0, 7); g.fill(); }
    center(g); g.fillStyle = '#7b2cbf'; fit(g, 'SORVETE', w - 30, 44); g.fillText('SORVETE', w / 2, 36);
    fit(g, 'GELADINHO', w - 40, 28); g.fillText('GELADINHO', w / 2, 70);
  });
  clip(g, R.laptop, () => { // tela do notebook (painel de gestão)
    const { w, h } = R.laptop;
    g.fillStyle = '#eef4fb'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f7bd9'; g.fillRect(0, 0, w, 30);
    g.fillStyle = '#fff'; g.font = '800 17px system-ui, Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('MERCADINHO', 10, 16);
    const cols = ['#ff7a2e', '#2fbf71', '#3a86ff', '#e63946', '#ffd23f', '#9b5de5'];
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
      const x = 12 + k * 80, y = 40 + r * 58;
      g.fillStyle = '#fff'; rr(g, x, y, 70, 50, 6); g.fill();
      g.fillStyle = cols[r * 3 + k]!; g.fillRect(x + 8, y + 8, 24, 24);
      g.fillStyle = '#9aa3ad'; g.fillRect(x + 38, y + 12, 24, 5); g.fillRect(x + 38, y + 24, 18, 5);
    }
    g.fillStyle = '#23a455'; rr(g, w - 70, h - 22, 60, 16, 5); g.fill();
  });
  const pict = (p: Px, draw: (s: number) => void): void => clip(g, p, () => { g.fillStyle = '#fff'; g.strokeStyle = '#fff'; draw(p.w); });
  pict(R.recycle, (s) => { // três setas em triângulo
    g.lineWidth = 9; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2, a2 = a + (Math.PI * 2) / 3;
      const r = s * 0.33, cx = s / 2, cy = s / 2 + 4;
      const x1 = cx + Math.cos(a) * r, y1 = cy + Math.sin(a) * r, x2 = cx + Math.cos(a2) * r, y2 = cy + Math.sin(a2) * r;
      const mx = x1 + (x2 - x1) * 0.72, my = y1 + (y2 - y1) * 0.72;
      g.beginPath(); g.moveTo(x1 + (x2 - x1) * 0.18, y1 + (y2 - y1) * 0.18); g.lineTo(mx, my); g.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      g.beginPath(); g.moveTo(mx + Math.cos(ang) * 12, my + Math.sin(ang) * 12);
      g.lineTo(mx + Math.cos(ang + 2.4) * 13, my + Math.sin(ang + 2.4) * 13); g.lineTo(mx + Math.cos(ang - 2.4) * 13, my + Math.sin(ang - 2.4) * 13); g.fill();
    }
  });
  pict(R.trash, (s) => { // boneco jogando lixo
    g.beginPath(); g.arc(s * 0.32, s * 0.2, 8, 0, 7); g.fill();
    g.lineWidth = 8; g.lineCap = 'round';
    g.beginPath(); g.moveTo(s * 0.32, s * 0.3); g.lineTo(s * 0.32, s * 0.6); g.moveTo(s * 0.32, s * 0.6); g.lineTo(s * 0.22, s * 0.85); g.moveTo(s * 0.32, s * 0.6); g.lineTo(s * 0.4, s * 0.85);
    g.moveTo(s * 0.32, s * 0.38); g.lineTo(s * 0.52, s * 0.46); g.stroke();
    g.fillRect(s * 0.58, s * 0.55, s * 0.26, s * 0.32); g.fillRect(s * 0.55, s * 0.5, s * 0.32, 5);
  });
}

function ensureAtlas(): NonNullable<typeof atlas> {
  if (atlas) return atlas;
  const { c, g } = makeCanvas(AW, AH);
  drawStatic(g);
  const tex = canvasTex(c);
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.75, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14 });
  atlas = { c, g, tex, mat };
  drawSign('Mercadinho', '#d8342c', 7.5);
  drawDelivery(2);
  return atlas;
}

/** Material único dos decalques (alphaTest: recortes sem ordenação de transparência). */
export const decalMaterial = (): THREE.MeshStandardMaterial => ensureAtlas().mat;

export const DECAL = {
  posters: (): Cell[] => { ensureAtlas(); return R.posters.map((p) => cellOf(p)); },
  open: (): Cell => cellOf(R.open), closed: (): Cell => cellOf(R.closed),
  plate: (): Cell => cellOf(R.plate), tape: (): Cell => cellOf(R.tape),
  busAd: (): Cell => cellOf(R.busAd), laptop: (): Cell => cellOf(R.laptop),
  recycle: (): Cell => cellOf(R.recycle), trash: (): Cell => cellOf(R.trash),
};

/** Redesenha o letreiro (nome + cor) para a proporção dada; devolve a célula a mapear. */
export function drawSign(name: string, color: string, aspect: number): Cell {
  const a = atlas ?? ensureAtlas();
  const h = Math.max(60, Math.min(R.sign.h, Math.round(R.sign.w / Math.max(1, aspect))));
  const p: Px = { x: 0, y: 0, w: R.sign.w, h };
  const g = a.g;
  g.clearRect(0, 0, R.sign.w, R.sign.h);
  clip(g, p, () => {
    g.fillStyle = color; g.fillRect(0, 0, p.w, h);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = gr; g.fillRect(0, 0, p.w, h);
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(5, h * 0.06); rr(g, h * 0.09, h * 0.09, p.w - h * 0.18, h - h * 0.18, h * 0.12); g.stroke();
    const text = (name || 'Mercadinho').toUpperCase();
    center(g); g.fillStyle = '#fff';
    const s = fit(g, text, p.w - h * 0.6, Math.floor(h * 0.6));
    g.font = `900 ${s}px system-ui, "Segoe UI", Arial, sans-serif`;
    g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
    g.fillText(text, p.w / 2, h / 2 + s * 0.04);
  });
  a.tex.needsUpdate = true;
  return cellOf(p, 1);
}

/** Área de entregas pintada no chão (proporção w/d da zona; texto compensado para não esticar). */
export function drawDelivery(aspect: number): Cell {
  const a = atlas ?? ensureAtlas();
  const p = R.delivery, g = a.g;
  g.clearRect(p.x, p.y, p.w, p.h);
  clip(g, p, () => {
    const w = p.w, h = p.h;
    g.fillStyle = '#4a4f58'; rr(g, 4, 4, w - 8, h - 8, 18); g.fill();
    g.setLineDash([26, 16]); g.strokeStyle = '#f2c230'; g.lineWidth = 9; rr(g, 16, 16, w - 32, h - 32, 12); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(w / 2, h / 2); g.scale(2 / Math.max(1, aspect), 1);
    center(g); g.lineWidth = 6; g.strokeStyle = '#2f333a'; g.fillStyle = '#e8ebef';
    const s = fit(g, 'ENTREGAS', (w - 60) * Math.max(1, aspect) / 2, 92);
    g.font = `900 ${s}px system-ui, Arial, sans-serif`;
    g.strokeText('ENTREGAS', 0, 6); g.fillText('ENTREGAS', 0, 6);
    g.restore();
  });
  a.tex.needsUpdate = true;
  return cellOf(p, 3);
}
