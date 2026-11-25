/**
 * Texturas procedurais das pessoas (CanvasTexture, arte 100% original): rostos (olhos, sobrancelhas, boca,
 * barba, batom) e roupas (camiseta, polo, xadrez, terno, regata, jaqueta, moletom, listrada, macacão).
 * Materiais em cache por variante e compartilhados entre todas as pessoas iguais.
 */
import * as THREE from 'three';

const textures: THREE.Texture[] = [];
const faceMats = new Map<string, THREE.MeshLambertMaterial>();
const outfitMats = new Map<string, THREE.MeshLambertMaterial>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  textures.push(t);
  return t;
}
/** Clareia (k>0) ou escurece (k<0) uma cor CSS #rrggbb. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
const TAU = Math.PI * 2;

/* ============================== rostos ============================== */
export interface FacePreset {
  /** 0 redondo, 1 amendoado, 2 semicerrado */
  eyes: 0 | 1 | 2;
  iris: string;
  /** 0 fina, 1 grossa, 2 arqueada, 3 franzida */
  brows: 0 | 1 | 2 | 3;
  /** 0 sorriso, 1 neutra, 2 sorriso aberto, 3 de lado */
  mouth: 0 | 1 | 2 | 3;
  lips: string | null;
  /** 0 sem, 1 por fazer, 2 cheia, 3 cavanhaque, 4 bigode, 5 bigode + queixo */
  beard: 0 | 1 | 2 | 3 | 4 | 5;
  lashes?: boolean;
  blush?: boolean;
  wrinkles?: boolean;
  freckles?: boolean;
  big?: boolean;
}

/** Rostos masculinos 0-7, femininos 8-12, crianças 13-14 (índices usados por model.ts). */
export const FACES: readonly FacePreset[] = [
  { eyes: 0, iris: '#5a3b22', brows: 1, mouth: 0, lips: null, beard: 0 },
  { eyes: 1, iris: '#3d2a1a', brows: 1, mouth: 1, lips: null, beard: 2 },
  { eyes: 1, iris: '#4f6f3a', brows: 3, mouth: 1, lips: null, beard: 1 },
  { eyes: 0, iris: '#3f6fa0', brows: 0, mouth: 2, lips: null, beard: 4 },
  { eyes: 2, iris: '#5a3b22', brows: 1, mouth: 3, lips: null, beard: 3 },
  { eyes: 1, iris: '#6b4a2a', brows: 2, mouth: 0, lips: null, beard: 5 },
  { eyes: 0, iris: '#2f5d7a', brows: 1, mouth: 1, lips: null, beard: 0, freckles: true },
  { eyes: 1, iris: '#5a4a3a', brows: 0, mouth: 0, lips: null, beard: 4, wrinkles: true },
  { eyes: 1, iris: '#4a3020', brows: 2, mouth: 0, lips: '#c2384a', beard: 0, lashes: true, blush: true },
  { eyes: 0, iris: '#3f7a5a', brows: 0, mouth: 2, lips: '#d9707e', beard: 0, lashes: true, freckles: true },
  { eyes: 1, iris: '#2a2a2a', brows: 2, mouth: 1, lips: '#7a2a4a', beard: 0, lashes: true },
  { eyes: 2, iris: '#5a3b22', brows: 0, mouth: 3, lips: '#e0705a', beard: 0, lashes: true, blush: true },
  { eyes: 1, iris: '#4a5a6a', brows: 0, mouth: 0, lips: '#b8606a', beard: 0, lashes: true, wrinkles: true },
  { eyes: 0, iris: '#5a3b22', brows: 0, mouth: 2, lips: null, beard: 0, blush: true, freckles: true, big: true },
  { eyes: 0, iris: '#3f6fa0', brows: 0, mouth: 0, lips: null, beard: 0, blush: true, big: true },
];
export const MALE_FACES = [0, 1, 2, 3, 4, 5, 6] as const;
export const FEMALE_FACES = [8, 9, 10, 11] as const;

/** Mapeamento do retalho do rosto (ver body.ts): olhos em y≈47, boca em y≈75, queixo em y≈100 (canvas 128). */
function drawFace(g: CanvasRenderingContext2D, p: FacePreset, hair: string): void {
  g.clearRect(0, 0, 128, 128);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const dark = shade(hair, -0.15);
  if (p.blush) {
    for (const s of [-1, 1]) {
      const gr = g.createRadialGradient(64 + s * 22, 63, 1, 64 + s * 22, 63, 11);
      gr.addColorStop(0, 'rgba(235,95,95,0.33)'); gr.addColorStop(1, 'rgba(235,95,95,0)');
      g.fillStyle = gr; g.fillRect(64 + s * 22 - 12, 51, 24, 24);
    }
  }
  if (p.freckles) {
    g.fillStyle = 'rgba(120,60,30,0.45)';
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) { g.beginPath(); g.arc(64 + s * (13 + (i * 7) % 13), 55 + (i * 5) % 9, 0.8, 0, TAU); g.fill(); }
  }
  // barba (antes da boca, para a boca ficar por cima)
  if (p.beard > 0) {
    g.fillStyle = p.beard === 1 ? hexA(dark, 0.38) : dark;
    const jaw = (): void => {
      g.beginPath();
      g.moveTo(26, 50); g.quadraticCurveTo(28, 92, 64, 112); g.quadraticCurveTo(100, 92, 102, 50);
      g.lineTo(94, 52); g.quadraticCurveTo(90, 66, 80, 68); g.lineTo(48, 68); g.quadraticCurveTo(38, 66, 34, 52); g.closePath();
    };
    if (p.beard === 1 || p.beard === 2) { jaw(); g.fill(); }
    if (p.beard === 3 || p.beard === 5) { g.beginPath(); g.ellipse(64, 89, 9, 10, 0, 0, TAU); g.fill(); }
    if (p.beard === 5) { g.lineWidth = 3.2; g.strokeStyle = dark; g.beginPath(); g.moveTo(30, 54); g.quadraticCurveTo(34, 92, 64, 104); g.quadraticCurveTo(94, 92, 98, 54); g.stroke(); }
  }
  // olhos
  const big = p.big ? 1.25 : 1;
  const ew = 6.2 * big, eh = (p.eyes === 0 ? 4.3 : p.eyes === 1 ? 3.5 : 2.5) * big;
  for (const s of [-1, 1]) {
    const cx = 64 + s * 15.5, cy = 47;
    const shape = (): void => {
      g.beginPath();
      if (p.eyes === 1) { g.moveTo(cx - ew, cy + 0.4); g.quadraticCurveTo(cx, cy - eh * 2, cx + ew, cy - 0.4); g.quadraticCurveTo(cx, cy + eh * 1.5, cx - ew, cy + 0.4); }
      else g.ellipse(cx, cy, ew, eh, 0, 0, TAU);
    };
    g.save();
    shape(); g.fillStyle = '#fbfaf5'; g.fill(); g.clip();
    g.fillStyle = p.iris; g.beginPath(); g.arc(cx, cy + 0.5, 3.6 * big, 0, TAU); g.fill();
    g.fillStyle = '#111111'; g.beginPath(); g.arc(cx, cy + 0.5, 1.7 * big, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(cx + 1.3, cy - 0.8, 0.95 * big, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = '#2b1d16'; g.lineWidth = p.lashes ? 2.3 : 1.4;
    g.beginPath();
    if (p.eyes === 1) { g.moveTo(cx - ew, cy + 0.4); g.quadraticCurveTo(cx, cy - eh * 2, cx + ew, cy - 0.4); }
    else g.ellipse(cx, cy, ew, eh, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    if (p.lashes) { g.beginPath(); g.moveTo(cx + s * ew * 0.95, cy - 0.6); g.lineTo(cx + s * (ew + 2.8), cy - 3); g.stroke(); }
  }
  // sobrancelhas
  g.strokeStyle = dark;
  g.lineWidth = p.brows === 1 || p.brows === 3 ? 3 : 1.7;
  for (const s of [-1, 1]) {
    const by = p.brows === 2 ? 36 : 37.5;
    g.beginPath();
    g.moveTo(64 + s * 8, by + (p.brows === 3 ? 2.6 : 0.8));
    g.quadraticCurveTo(64 + s * 15.5, by - (p.brows === 2 ? 3.2 : 1.6), 64 + s * 23, by + (p.brows === 3 ? -0.8 : 1.2));
    g.stroke();
  }
  // nariz (a forma 3D existe; aqui só as narinas)
  g.fillStyle = 'rgba(90,40,30,0.35)';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(64 + s * 3.2, 62.5, 1.4, 0.9, 0, 0, TAU); g.fill(); }
  // boca
  const my = 75;
  if (p.lips) {
    g.fillStyle = p.lips;
    g.beginPath(); g.moveTo(55, my); g.quadraticCurveTo(60, my - 4.2, 64, my - 2.4); g.quadraticCurveTo(68, my - 4.2, 73, my);
    g.quadraticCurveTo(64, my + 6.5, 55, my); g.fill();
  }
  g.strokeStyle = p.lips ? shade(p.lips, -0.45) : '#7a3a30';
  g.lineWidth = 1.7;
  if (p.mouth === 2) {
    g.fillStyle = '#5a1d1d';
    g.beginPath(); g.moveTo(55.5, my - 1); g.quadraticCurveTo(64, my + 10, 72.5, my - 1); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(57.5, my - 1, 13, 2.4);
  } else {
    g.beginPath();
    if (p.mouth === 0) { g.moveTo(56, my - 1); g.quadraticCurveTo(64, my + 5, 72, my - 1); }
    else if (p.mouth === 1) { g.moveTo(57, my); g.quadraticCurveTo(64, my + 1.2, 71, my); }
    else { g.moveTo(57, my + 1); g.quadraticCurveTo(65, my + 2, 72, my - 2.5); }
    g.stroke();
  }
  // bigode por cima do lábio
  if (p.beard === 2 || p.beard === 3 || p.beard === 4 || p.beard === 5) {
    g.fillStyle = dark;
    g.beginPath(); g.moveTo(53, my - 1); g.quadraticCurveTo(58, my - 8, 64, my - 5.5); g.quadraticCurveTo(70, my - 8, 75, my - 1);
    g.quadraticCurveTo(64, my - 3.5, 53, my - 1); g.fill();
  }
  if (p.wrinkles) {
    g.strokeStyle = 'rgba(90,50,40,0.4)'; g.lineWidth = 1;
    for (const y of [22, 27]) { g.beginPath(); g.moveTo(48, y); g.quadraticCurveTo(64, y - 2, 80, y); g.stroke(); }
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(64 + s * 25, 44); g.lineTo(64 + s * 29, 42); g.moveTo(64 + s * 25, 48); g.lineTo(64 + s * 29, 49); g.stroke();
      g.beginPath(); g.moveTo(64 + s * 8, 63); g.quadraticCurveTo(64 + s * 12, 70, 64 + s * 11, 78); g.stroke();
    }
  }
}
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Material do retalho do rosto (transparente; a pele vem da cabeça). Cache por (preset, cor do cabelo). */
export function faceMaterial(preset: number, hair: string): THREE.MeshLambertMaterial {
  const p = FACES[preset] ?? FACES[0]!;
  const key = `${preset}|${p.beard || p.brows ? hair : ''}`;
  let m = faceMats.get(key);
  if (!m) {
    const [c, g] = canvas(128, 128);
    drawFace(g, p, hair);
    m = new THREE.MeshLambertMaterial({ map: texture(c), transparent: true, depthWrite: false });
    faceMats.set(key, m);
  }
  return m;
}

/* ============================== roupas ============================== */
export type OutfitStyle = 'tee' | 'polo' | 'plaid' | 'suit' | 'tank' | 'jacket' | 'hoodie' | 'stripes' | 'coverall';
export type Sleeves = 'long' | 'short' | 'none';
export interface Outfit { style: OutfitStyle; base: string; accent: string; sleeves: Sleeves; badge?: boolean }

export const OUTFITS: readonly Outfit[] = [
  { style: 'tee', base: '#d94f4f', accent: '#ffffff', sleeves: 'short' },
  { style: 'tee', base: '#2fa6a6', accent: '#ffe28a', sleeves: 'short' },
  { style: 'tee', base: '#f2f2ee', accent: '#3f7fd0', sleeves: 'short' },
  { style: 'tee', base: '#e8b93a', accent: '#5a3b1e', sleeves: 'short' },
  { style: 'plaid', base: '#b8322c', accent: '#2a1b1b', sleeves: 'long' },
  { style: 'plaid', base: '#2f5d9e', accent: '#13213a', sleeves: 'long' },
  { style: 'plaid', base: '#3f7d4a', accent: '#1c2e1f', sleeves: 'short' },
  { style: 'suit', base: '#2b2f36', accent: '#2e9e4f', sleeves: 'long' },
  { style: 'suit', base: '#1f2a44', accent: '#c0392b', sleeves: 'long' },
  { style: 'tank', base: '#f4f4f4', accent: '#c9c9c9', sleeves: 'none' },
  { style: 'tank', base: '#2b2b2e', accent: '#5a5a5e', sleeves: 'none' },
  { style: 'tank', base: '#ef7c6b', accent: '#ffffff', sleeves: 'none' },
  { style: 'jacket', base: '#3d6fa8', accent: '#f2f2ee', sleeves: 'long' },
  { style: 'jacket', base: '#5b3a29', accent: '#9aa3ab', sleeves: 'long' },
  { style: 'hoodie', base: '#8a8f98', accent: '#2b2b2b', sleeves: 'long' },
  { style: 'hoodie', base: '#7a4bb0', accent: '#e9dcff', sleeves: 'long' },
  { style: 'polo', base: '#26466d', accent: '#f2f2ee', sleeves: 'short' },
  { style: 'stripes', base: '#f5f2ea', accent: '#1f3b70', sleeves: 'long' },
];
export const KIND_OUTFIT = {
  bulk: { style: 'tee', base: '#ff7a00', accent: '#fff3d6', sleeves: 'short' },
  picky: { style: 'polo', base: '#6a2c91', accent: '#f2c230', sleeves: 'short' },
  kid: { style: 'tee', base: '#ffe03a', accent: '#e8473b', sleeves: 'short' },
} as const satisfies Record<string, Outfit>;
export const UNIFORMS = {
  cashier: { style: 'polo', base: '#d33b3b', accent: '#ffffff', sleeves: 'short', badge: true },
  stocker: { style: 'polo', base: '#2f6fd0', accent: '#ffffff', sleeves: 'short', badge: true },
  janitor: { style: 'coverall', base: '#2f9e5b', accent: '#f2f2ee', sleeves: 'long', badge: true },
} as const satisfies Record<string, Outfit>;

/**
 * Atlas 256x128: metade esquerda = tronco (x=64 é o meio da frente; topo = ombros), metade direita = mangas
 * (base = punho). Lado esquerdo da pessoa fica em x>64.
 */
function drawOutfit(g: CanvasRenderingContext2D, o: Outfit): void {
  const { base, accent } = o;
  const dk = shade(base, -0.28);
  g.fillStyle = base; g.fillRect(0, 0, 256, 128);
  const both = (fn: (x0: number) => void): void => { fn(0); fn(128); };
  switch (o.style) {
    case 'plaid':
      both((x0) => {
        g.fillStyle = 'rgba(0,0,0,0.24)';
        for (let x = 0; x < 128; x += 18) g.fillRect(x0 + x, 0, 7, 128);
        for (let y = 2; y < 128; y += 18) g.fillRect(x0, y, 128, 7);
        g.fillStyle = 'rgba(255,255,255,0.22)';
        for (let x = 12; x < 128; x += 18) g.fillRect(x0 + x, 0, 1.5, 128);
        for (let y = 14; y < 128; y += 18) g.fillRect(x0, y, 128, 1.5);
      });
      g.fillStyle = shade(base, -0.35); g.fillRect(63, 0, 2, 128);
      g.fillStyle = '#e8e2d0'; for (let y = 22; y < 120; y += 22) { g.beginPath(); g.arc(66.5, y, 1.6, 0, TAU); g.fill(); }
      collar(g, shade(base, -0.15));
      break;
    case 'suit':
      g.fillStyle = '#f4f4f2'; g.beginPath(); g.moveTo(50, 0); g.lineTo(78, 0); g.lineTo(64, 58); g.closePath(); g.fill();
      g.fillStyle = accent; g.beginPath(); g.moveTo(61, 3); g.lineTo(67, 3); g.lineTo(66, 9); g.lineTo(62, 9); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(62, 9); g.lineTo(66, 9); g.lineTo(68.5, 46); g.lineTo(64, 53); g.lineTo(59.5, 46); g.closePath(); g.fill();
      g.strokeStyle = shade(base, -0.4); g.lineWidth = 3;
      g.beginPath(); g.moveTo(48, 0); g.lineTo(64, 60); g.lineTo(80, 0); g.stroke();
      g.fillStyle = '#1a1a1a'; for (const y of [72, 90]) { g.beginPath(); g.arc(64, y, 2, 0, TAU); g.fill(); }
      g.fillStyle = accent; g.beginPath(); g.moveTo(80, 36); g.lineTo(90, 36); g.lineTo(84, 42); g.closePath(); g.fill();
      g.strokeStyle = shade(base, -0.35); g.lineWidth = 1.5; g.strokeRect(78, 37, 13, 2);
      g.fillStyle = '#f4f4f2'; g.fillRect(128, 118, 128, 10);
      break;
    case 'tank':
      g.fillStyle = dk; g.beginPath(); g.ellipse(64, 0, 17, 13, 0, 0, Math.PI); g.fill();
      g.fillStyle = base; g.beginPath(); g.ellipse(64, 0, 15, 11, 0, 0, Math.PI); g.fill();
      g.fillStyle = shade(base, -0.5); g.globalAlpha = 0.25; g.beginPath(); g.ellipse(64, 0, 15, 11, 0, 0, Math.PI); g.fill(); g.globalAlpha = 1;
      g.fillStyle = shade(base, -0.12); g.fillRect(0, 120, 128, 8);
      break;
    case 'jacket':
      g.fillStyle = accent; g.fillRect(52, 0, 24, 128);
      g.strokeStyle = shade(base, -0.4); g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(52, 0); g.lineTo(52, 128); g.moveTo(76, 0); g.lineTo(76, 128); g.stroke();
      g.fillStyle = dk; g.fillRect(34, 84, 14, 4); g.fillRect(80, 84, 14, 4);
      g.beginPath(); g.moveTo(40, 0); g.lineTo(52, 0); g.lineTo(52, 22); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(88, 0); g.lineTo(76, 0); g.lineTo(76, 22); g.closePath(); g.fill();
      g.fillStyle = shade(base, -0.18); g.fillRect(0, 118, 128, 10); g.fillRect(128, 116, 128, 12);
      break;
    case 'hoodie':
      g.fillStyle = dk; g.fillRect(0, 0, 128, 9);
      g.fillStyle = shade(base, -0.4); g.beginPath(); g.ellipse(64, 0, 12, 7, 0, 0, Math.PI); g.fill();
      g.strokeStyle = accent; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(59, 6); g.lineTo(58, 34); g.moveTo(69, 6); g.lineTo(70, 34); g.stroke();
      g.fillStyle = shade(base, -0.12); g.beginPath(); g.moveTo(44, 84); g.lineTo(84, 84); g.lineTo(90, 114); g.lineTo(38, 114); g.closePath(); g.fill();
      g.strokeStyle = dk; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = dk; g.fillRect(0, 118, 128, 10); g.fillRect(128, 114, 128, 14);
      break;
    case 'stripes':
      both((x0) => { g.fillStyle = accent; for (let y = 4; y < 128; y += 14) g.fillRect(x0, y, 128, 7); });
      g.fillStyle = accent; g.beginPath(); g.ellipse(64, 0, 12, 7, 0, 0, Math.PI); g.fill();
      break;
    case 'coverall':
      g.fillStyle = shade(base, -0.35); g.fillRect(63, 0, 2, 128);
      g.fillStyle = dk; g.fillRect(76, 26, 14, 12);
      g.fillStyle = dk; g.fillRect(0, 116, 128, 6);
      collar(g, shade(base, -0.15));
      if (o.badge) badge(g, accent, base);
      g.fillStyle = dk; g.fillRect(128, 116, 128, 12);
      break;
    case 'polo':
      g.fillStyle = shade(base, -0.15); g.fillRect(60, 0, 8, 30);
      g.fillStyle = accent; for (const y of [10, 20]) { g.beginPath(); g.arc(64, y, 1.6, 0, TAU); g.fill(); }
      collar(g, shade(base, 0.12));
      if (o.badge) badge(g, accent, base);
      g.fillStyle = accent; g.fillRect(128, 118, 128, 6);
      g.fillStyle = shade(base, -0.12); g.fillRect(0, 121, 128, 7);
      break;
    case 'tee':
    default:
      g.fillStyle = dk; g.beginPath(); g.ellipse(64, 0, 12, 8, 0, 0, Math.PI); g.fill();
      g.fillStyle = base; g.beginPath(); g.ellipse(64, 0, 10, 6, 0, 0, Math.PI); g.fill();
      // estampa simples original: círculo com faixa
      g.fillStyle = accent; g.beginPath(); g.arc(64, 46, 11, 0, TAU); g.fill();
      g.fillStyle = base; g.fillRect(53, 44, 22, 4);
      g.fillStyle = shade(base, -0.12); g.fillRect(0, 121, 128, 7); g.fillRect(128, 114, 128, 14);
      break;
  }
}
function collar(g: CanvasRenderingContext2D, c: string): void {
  g.fillStyle = c;
  g.beginPath(); g.moveTo(50, 0); g.lineTo(64, 0); g.lineTo(58, 12); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(78, 0); g.lineTo(64, 0); g.lineTo(70, 12); g.closePath(); g.fill();
}
function badge(g: CanvasRenderingContext2D, c: string, base: string): void {
  g.fillStyle = c; g.fillRect(80, 30, 15, 9);
  g.fillStyle = shade(base, -0.2); g.fillRect(80, 30, 4, 9);
}

export function outfitMaterial(o: Outfit): THREE.MeshLambertMaterial {
  const key = `${o.style}|${o.base}|${o.accent}|${o.badge ? 1 : 0}`;
  let m = outfitMats.get(key);
  if (!m) {
    const [c, g] = canvas(256, 128);
    drawOutfit(g, o);
    m = new THREE.MeshLambertMaterial({ map: texture(c) });
    outfitMats.set(key, m);
  }
  return m;
}

/* ============================== materiais de uma passada (desempenho) ==============================
 * Corpo: textura da roupa na parte 0 e cores lisas nas partes 1–3 (calça, pele, calçado) → 1 draw call.
 * Cabeça fundida: pele (0), rosto desenhado sobre a pele (1, a transparência vira mistura no shader: fica opaco),
 * cabelo (2), chapéu (3), óculos (4) → 1 draw call. Um material POR PESSOA (só muda as cores = uniforms) e o mesmo
 * programa de shader para todas (customProgramCacheKey). Não descarte esses materiais ao remover a pessoa: o
 * programa compartilhado seria liberado quando a última saísse e a próxima pessoa recompilaria (travada).
 */
type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };
/** Corpo: parte 0 = textura (roupa); 1, 2, 3 = uPart[0..2] (calça, pele, calçado). */
const BODY_FRAG = `float p = vPart;
vec4 sampledDiffuseColor = texture2D( map, vMapUv );
diffuseColor.rgb *= p < 0.5 ? sampledDiffuseColor.rgb : ( p < 1.5 ? uPart[0] : ( p < 2.5 ? uPart[1] : uPart[2] ) );`;
/** Cabeça: 0 pele = uPart[0]; 1 rosto = textura misturada sobre a pele (alfa); 2 cabelo, 3 chapéu, 4 óculos = uPart[1..3]. */
const HEAD_FRAG = `float p = vPart;
vec4 sampledDiffuseColor = texture2D( map, vMapUv );
vec3 partColor = p < 1.5 ? uPart[0] : ( p < 2.5 ? uPart[1] : ( p < 3.5 ? uPart[2] : uPart[3] ) );
diffuseColor.rgb *= ( p > 0.5 && p < 1.5 ) ? mix( uPart[0], sampledDiffuseColor.rgb, sampledDiffuseColor.a ) : partColor;`;
function partMaterial(key: string, map: THREE.Texture, colors: THREE.Color[], side: THREE.Side, frag: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, side });
  m.onBeforeCompile = (sh: Shader) => {
    sh.uniforms.uPart = { value: colors };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float part;\nvarying float vPart;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPart = part;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uPart[${colors.length}];\nvarying float vPart;`)
      .replace('#include <map_fragment>', frag);
  };
  m.customProgramCacheKey = () => key;
  return m;
}
const colorOf = (hex: string): THREE.Color => new THREE.Color(hex);
/** Corpo de uma pessoa: roupa (textura do conjunto) + calça, pele e calçado (cores). */
export function bodyMaterial(o: Outfit, pants: string, skin: string, shoes: string): THREE.MeshLambertMaterial {
  return partMaterial('npc-body-1', outfitMaterial(o).map!, [colorOf(pants), colorOf(skin), colorOf(shoes)], THREE.FrontSide, BODY_FRAG);
}
/** Cabeça fundida: pele, rosto (textura do preset), cabelo, chapéu e óculos (cores). DoubleSide por causa do cabelo. */
export function headMaterial(face: number, skin: string, hair: string, hat: string): THREE.MeshLambertMaterial {
  return partMaterial('npc-head-1', faceMaterial(face, hair).map!, [colorOf(skin), colorOf(hair), colorOf(hat), colorOf('#15171a')], THREE.DoubleSide, HEAD_FRAG);
}

export function disposeLooks(): void {
  for (const m of faceMats.values()) m.dispose();
  for (const m of outfitMats.values()) m.dispose();
  faceMats.clear(); outfitMats.clear();
  for (const t of textures) t.dispose();
  textures.length = 0;
}
