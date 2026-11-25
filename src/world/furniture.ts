/**
 * Fábrica de móveis procedurais. Convenção local: origem no centro do footprint, frente (clientes) em +z, y para cima.
 * Footprint sem rotação: shelf/fridge/freezer/rack = 2x1 (x por z), counter = 2x2, decor = 1x1.
 * Cada móvel é construído como geometria FUNDIDA por tipo de material (Batch): poucos draw calls, e o resultado é cacheado
 * por (tipo, produto, variante). Os itens expostos são matrizes para a ItemLayer global (instanciada).
 */
import * as THREE from 'three';
import type { Furniture } from '../sim/state';
import type { FurnitureType } from '../core/layout';
import { boxGeo, cylGeo, sphGeo, icoGeo, coneGeo, planeGeo, hash01 } from './kit';
import { DECAL } from './tex';
import { Batch, meshesOf, type Kind, type Spec } from './batch';
import { uvToCell } from './atlas';
import { productVisual, pushMatrix } from './products';
import { LICENSES, productById } from '../sim/catalog';
import { furnitureCatalog } from '../sim/api';

export interface FurnitureView {
  group: THREE.Group;
  /** Gaveta da registradora (se counter) — animada pelo mundo no evento 'cash'. */
  drawer?: THREE.Mesh;
  drawerBaseZ?: number;
}

const tint = (c: number, k: number): number => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k).getHex();
const matte = (c: number): Spec => ['matte', c];
const metal = (c: number): Spec => ['metal', c];
const glow = (c: number): Spec => ['glow', c];
const FRAME = matte(0xe9ecef), DARK = matte(0x474c57), STEEL = metal(0xb9c2cc), GLASS: Spec = ['glass', 0xbfe9ff];
const WOOD = matte(0xc9a06a);

/* ---------------- FASE 4: níveis (prateleiras) por móvel ----------------
 * Cada nível de shelf/fridge/freezer tem produto e quantidade próprios (Furniture.levels; reserva: modelo antigo).
 * Índice do nível: shelf/fridge = de CIMA para baixo (0 = prateleira de cima); freezer = cestos da ESQUERDA para a
 * direita, vistos da frente (−x local → +x). Quantidade = levels.length (reserva: FurnitureSpec.slots do tipo).
 * `levelGeoms` é a fonte única das alturas/regiões: desenho das tábuas, itens, etiquetas, destaque e levelAt. */
export type DisplayType = 'shelf' | 'fridge' | 'freezer';
export const isDisplayType = (t: string): t is DisplayType => t === 'shelf' || t === 'fridge' || t === 'freezer';
export const MAX_LEVELS = 6;
export interface LevelGeom {
  /** Região local do nível [cx, cy, cz, w, h, d] (contorno de destaque e levelAt). */
  box: SBox;
  /** y local da BASE da tábua do nível (shelf/fridge; freezer = fundo). */
  board: number;
  /** Área útil dos itens: centro x/z, largura, profundidade, piso (y) e altura livre. */
  x: number; z: number; w: number; d: number; floor: number; clear: number;
  /** Centro da etiqueta de preço (local, frente +z). */
  tag: readonly [number, number, number];
}
const SHELF_Y0 = 0.1, SHELF_TOP = 1.34, FRIDGE_Y0 = 0.2, FRIDGE_TOP = 1.78, FREEZER_W = 1.8;
const geomCache = new Map<string, LevelGeom[]>();
/** Geometria dos `n` níveis de um tipo de exposição ([] para os demais tipos). */
export function levelGeoms(type: FurnitureType, n: number): LevelGeom[] {
  if (!isDisplayType(type) || !(n >= 1)) return [];
  n = Math.min(MAX_LEVELS, Math.floor(n));
  const key = `${type}|${n}`;
  let out = geomCache.get(key);
  if (out) return out;
  out = [];
  if (type === 'freezer') {
    const cw = FREEZER_W / n;
    for (let i = 0; i < n; i++) {
      const x0 = -FREEZER_W / 2 + i * cw, x1 = x0 + cw, bx0 = i === 0 ? -1 : x0, bx1 = i === n - 1 ? 1 : x1;
      out.push({ box: [(bx0 + bx1) / 2, 0.39, 0, bx1 - bx0, 0.78, 0.98], board: 0.2, x: (x0 + x1) / 2, z: 0, w: cw - 0.06, d: 0.76, floor: 0.22, clear: 0.48, tag: [(x0 + x1) / 2, 0.57, 0.488] });
    }
  } else {
    const sh = type === 'shelf';
    const y0 = sh ? SHELF_Y0 : FRIDGE_Y0, top = sh ? SHELF_TOP : FRIDGE_TOP, step = (top - y0) / n, th = sh ? 0.04 : 0.025;
    for (let i = 0; i < n; i++) {
      const k = n - 1 - i; // k = de baixo para cima
      const board = y0 + k * step, next = k === n - 1 ? top : y0 + (k + 1) * step, lo = k === 0 ? (sh ? 0.1 : 0.14) : board;
      out.push({
        box: [0, (lo + next) / 2, 0, 1.96, next - lo, sh ? 0.96 : 0.98], board,
        x: 0, z: -0.02, w: sh ? 1.76 : 1.74, d: sh ? 0.82 : 0.8, floor: board + th, clear: next - board - th - 0.02,
        tag: sh ? [0, board + 0.07, 0.478] : [-0.5, board + 0.045, 0.512],
      });
    }
  }
  geomCache.set(key, out);
  return out;
}
/** Alturas (y local da base da tábua) dos níveis, na ordem dos índices (shelf/fridge: de cima para baixo). */
export const levelHeights = (type: FurnitureType, n: number): number[] => levelGeoms(type, n).map((g) => g.board);
/** Nível que contém o ponto LOCAL do móvel (x,y,z; frente +z); null fora do móvel/tipo sem níveis. */
export function levelIndexAt(type: FurnitureType, n: number, x: number, y: number, z: number): number | null {
  const g = levelGeoms(type, n);
  if (!g.length || Math.abs(x) > 1.12 || Math.abs(z) > 0.66 || y < -0.05) return null;
  if (type === 'freezer') {
    if (y > 1.0) return null;
    return Math.max(0, Math.min(g.length - 1, Math.floor(((x + FREEZER_W / 2) / FREEZER_W) * g.length)));
  }
  if (y > (type === 'shelf' ? 1.75 : 2.15)) return null;
  for (let i = 0; i < g.length; i++) if (y >= g[i]!.board) return i; // do nível de cima para baixo
  return g.length - 1;
}

let specN: Partial<Record<FurnitureType, number>> | null = null;
/** Nº de níveis do tipo pela regra do sim (FurnitureSpec.slots); reserva se o catálogo falhar. */
export function specLevelCount(type: FurnitureType): number {
  if (!specN) {
    specN = { shelf: 2, fridge: 3, freezer: 3 };
    try { for (const s of furnitureCatalog()) if (isDisplayType(s.type) && s.slots > 0) specN[s.type] = s.slots; } catch { /* sim antigo */ }
  }
  return isDisplayType(type) ? Math.min(MAX_LEVELS, Math.max(1, specN[type] ?? 1)) : 0;
}
/** Produto (etiqueta) de cada nível: Furniture.levels; reserva (sem levels) = todos com o produto antigo do móvel. */
export function levelPids(f: Pick<Furniture, 'type' | 'productId' | 'levels'>): (string | undefined)[] {
  if (!isDisplayType(f.type)) return [];
  const lv = Array.isArray(f.levels) ? f.levels : null;
  if (lv && lv.length) return lv.slice(0, MAX_LEVELS).map((l) => (l && typeof l.productId === 'string' && l.productId ? l.productId : undefined));
  return Array.from({ length: specLevelCount(f.type) }, () => f.productId || undefined);
}
/** Chave da placa do móvel: produto único, categoria dominante (níveis misturados) ou '-' (VAZIO). */
export function signKeyOf(pids: readonly (string | undefined)[]): string {
  const set = [...new Set(pids.filter((p): p is string => !!p))];
  if (set.length <= 1) return set[0] ?? '-';
  const count = new Map<string, number>();
  for (const p of pids) { if (!p) continue; let c = '?'; try { c = productById(p).category; } catch { /* */ } count.set(c, (count.get(c) ?? 0) + 1); }
  let best = '?', bn = -1;
  for (const [c, k] of count) if (k > bn) { best = c; bn = k; }
  return LICENSES.some((l) => l.id === best) ? `cat:${best}` : set[0]!;
}

interface Slot { x: number; y: number; z: number; ry: number; s: number }
/** Posições dos itens de UM nível: EXATAMENTE `slotCapacity` do produto (1 item por unidade), fileira da FRENTE primeiro
 *  (esquerda → direita), depois as de trás. Se a capacidade não cabe no nível, reduz a escala (mais colunas/fileiras). */
function levelSlotsOf(type: FurnitureType, n: number, i: number, pid: string): Slot[] {
  const L = levelGeoms(type, n)[i];
  if (!L) return [];
  const v = productVisual(pid);
  let cap = 12;
  try { cap = Math.max(1, productById(pid).slotCapacity); } catch { /* produto desconhecido */ }
  let sc = Math.min(1, L.clear / Math.max(0.01, v.h));
  let cols = 1, rows = 1;
  for (let it = 0; it < 14; it++) {
    cols = Math.max(1, Math.floor(L.w / (v.w * sc + 0.01)));
    rows = Math.ceil(cap / cols);
    if (rows * (v.d * sc + 0.01) <= L.d || sc < 0.3) break;
    sc *= 0.92;
  }
  const vh = v.h * sc;
  void vh;
  const px = L.w / cols, pz = L.d / rows;
  const out: Slot[] = [];
  for (let k = 0; k < cap; k++) {
    const row = Math.floor(k / cols), col = k % cols;
    out.push({
      x: L.x - L.w / 2 + (col + 0.5) * px + (hash01(k, 1, i) - 0.5) * 0.008,
      y: L.floor,
      z: L.z + L.d / 2 - (row + 0.5) * pz,
      ry: (hash01(k, 2, i) - 0.5) * 0.2,
      s: sc,
    });
  }
  return out;
}
const slotCache = new Map<string, Slot[]>();
function levelSlots(type: FurnitureType, n: number, i: number, pid: string): Slot[] {
  const key = `${type}|${n}|${i}|${pid}`;
  let s = slotCache.get(key);
  if (!s) { s = levelSlotsOf(type, n, i, pid); slotCache.set(key, s); }
  return s;
}
/** Itens visíveis no nível: 1 por unidade (limitado à capacidade). */
export function levelVisible(type: FurnitureType, n: number, i: number, pid: string | undefined, units: number): number {
  if (!pid || !(units > 0)) return 0;
  return Math.min(levelSlots(type, n, i, pid).length, Math.floor(units));
}

const dummy = new THREE.Object3D();
const W = new THREE.Matrix4(), L = new THREE.Matrix4();
/** Matrizes de mundo dos itens expostos, POR NÍVEL (cada nível só com o seu produto), agrupadas por produto em `out`. */
export function furnitureItems(f: Furniture, levels: readonly { pid?: string; units: number }[], cx: number, cz: number, out: Map<string, number[]>): void {
  const n = levels.length;
  dummy.position.set(cx, 0.01, cz); dummy.rotation.set(0, (f.rot * Math.PI) / 180, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
  W.copy(dummy.matrix);
  for (let i = 0; i < n; i++) {
    const { pid, units } = levels[i]!;
    const k = levelVisible(f.type, n, i, pid, units);
    if (!pid || !k) continue;
    const slots = levelSlots(f.type, n, i, pid);
    let arr = out.get(pid);
    if (!arr) out.set(pid, (arr = []));
    for (let j = 0; j < k; j++) {
      const s = slots[j]!;
      dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.ry, 0); dummy.scale.setScalar(s.s); dummy.updateMatrix();
      L.multiplyMatrices(W, dummy.matrix);
      pushMatrix(arr, L);
    }
  }
  dummy.scale.setScalar(1);
}

function shelf(lv: readonly (string | undefined)[]): Batch {
  const b = new Batch();
  b.box(1.96, 0.1, 0.92, DARK, 0, 0, 0);
  b.box(1.9, 1.24, 0.04, matte(0xdfe3e8), 0, 0.1, -0.45);
  b.box(0.06, 1.26, 0.94, FRAME, -0.97, 0.1, 0);
  b.box(0.06, 1.26, 0.94, FRAME, 0.97, 0.1, 0);
  b.box(2.0, 0.05, 0.98, FRAME, 0, 1.34, 0);
  levelGeoms('shelf', lv.length).forEach((g, i) => {
    b.box(1.9, 0.04, 0.9, FRAME, 0, g.board, 0);
    b.box(1.9, 0.06, 0.02, matte(0xc4cad1), 0, g.board + 0.04, 0.455); // friso neutro
  });
  b.box(1.96, 0.27, 0.08, DARK, 0, 1.39, 0);
  return b;
}

function fridge(lv: readonly (string | undefined)[]): Batch {
  const b = new Batch();
  const body = metal(0xaab3bc);
  b.box(2.0, 0.14, 0.98, body, 0, 0, 0);
  b.box(1.9, 1.62, 0.05, matte(0xcfe9f1), 0, 0.14, -0.45);
  b.box(0.07, 1.66, 0.94, body, -0.965, 0.14, 0);
  b.box(0.07, 1.66, 0.94, body, 0.965, 0.14, 0);
  b.box(2.0, 0.28, 1.0, body, 0, 1.78, 0);
  b.box(1.8, 0.03, 0.05, glow(0xbdf2ff), 0, 1.76, 0.45);
  levelGeoms('fridge', lv.length).forEach((g, i) => {
    b.box(1.86, 0.025, 0.86, matte(0xcfe3ec), 0, g.board, 0);
    b.box(1.86, 0.04, 0.015, matte(0xb8c4cc), 0, g.board + 0.025, 0.425);
  });
  for (const sx of [-0.49, 0.49]) b.box(0.94, 1.56, 0.02, GLASS, sx, 0.16, 0.49);
  for (const x of [-0.98, 0, 0.98]) b.box(0.05, 1.6, 0.05, STEEL, x, 0.14, 0.49);
  for (const x of [-0.1, 0.1]) b.box(0.03, 0.55, 0.05, STEEL, x, 0.55, 0.53);
  return b;
}

function freezer(lv: readonly (string | undefined)[]): Batch {
  const b = new Batch();
  const white = matte(0xe8f1f7);
  b.box(1.9, 0.1, 0.9, matte(0x3b4753), 0, 0, 0);
  b.box(1.98, 0.62, 0.96, white, 0, 0.1, 0);
  b.box(1.98, 0.05, 0.97, matte(0x22b5c9), 0, 0.42, 0);
  b.box(1.8, 0.02, 0.8, matte(0xb7d9e8), 0, 0.2, 0);
  const g = levelGeoms('freezer', lv.length);
  g.forEach((c, i) => {
    if (i > 0) b.box(0.02, 0.46, 0.8, matte(0xd5e6ef), c.x - (c.w + 0.06) / 2, 0.22, 0); // divisória entre cestos
    b.box(c.w + 0.04, 0.03, 0.012, matte(0xc9d6de), c.x, 0.66, 0.392); // friso neutro do cesto
  });
  b.box(2.0, 0.05, 0.06, white, 0, 0.72, 0.47);
  b.box(2.0, 0.05, 0.06, white, 0, 0.72, -0.47);
  b.box(0.06, 0.05, 0.98, white, -0.97, 0.72, 0);
  b.box(0.06, 0.05, 0.98, white, 0.97, 0.72, 0);
  b.box(0.06, 0.05, 0.9, white, 0, 0.72, 0);
  for (const sx of [-0.49, 0.49]) b.box(0.9, 0.02, 0.86, GLASS, sx, 0.74, 0);
  b.box(0.5, 0.04, 0.04, STEEL, 0, 0.76, 0.5);
  return b;
}

/* ---------------- balcão do caixa (reto, como no jogo original) ----------------
 * Local (frente/clientes em +z, footprint [-1,1]²): balcão comprido ocupando a fileira de TRÁS (z −0,8…0, 1,96 m),
 * tampo cinza-claro, faixa vermelha contínua, corpo azul-claro com painéis. Esteira embutida no tampo à ESQUERDA (x<0,
 * lado do cliente, corre de −x para o scanner em x≈−0,1); registradora/teclado/impressora/monitor/maquininha à DIREITA
 * (ponta do operador). Cadeira atrás (tile do operador, fora do footprint). A fileira da frente do footprint fica livre
 * (a fila começa nela). */
const C_BODY = matte(0x93b4ea), C_PANEL = matte(0xb9bfcc), C_FRAME = matte(0x6f8ccb), C_RED = matte(0xc4161c), C_TOP = matte(0xd6d9df), C_PLINTH = matte(0x3a3e48);
export const BELT_Y = 0.892;
const CZ = -0.4; // centro do balcão em z (profundidade 0,8)
/** Monitor (pose local no balcão): tela w×h a `cy` acima da mesa, virada para o operador. */
export const MONITOR = { x: 0.66, y: 0.9, z: -0.38, ry: Math.atan2(0.5 - 0.66, -1.42 + 0.38), tilt: -0.08, w: 0.56, h: 0.36, cy: 0.41, cz: 0.014 };
/** Maquininha de cartão: face (tela + teclas) w×h no topo do corpo inclinado. */
export const CARDPAD = { x: 0.86, y: 0.9, z: -0.7, ry: Math.atan2(0.5 - 0.86, -1.42 + 0.7), tilt: 0.45, lift: 0.075, w: 0.088, h: 0.176 };
/** Assento do operador (local) e pose dos olhos sentado. */
export const SEAT = { x: 0.5, z: -1.42, eye: [0.5, 1.24, -1.34] as const, look: [-0.2, 0.97, 0.1] as const };
/** Mão do cliente estendendo dinheiro/cartão; scanner; esteira (cliente → scanner, ao longo de x). */
export const HANDOFF = [-0.4, 1.1, 0.12] as const;
export const SCANNER = [-0.1, -0.41] as const;
export const BELT_SLOTS: readonly (readonly [number, number])[] = Array.from({ length: 8 }, (_, i) => [-0.84 + i * 0.085, CZ + 0.01 + (i % 2 ? 0.06 : -0.06)] as const);

const DRAWER = { w: 0.42, h: 0.1, d: 0.36, x: 0.45, y: 0.68, z: -0.595 };
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
/** Matriz local de uma peça do balcão: T(x,y,z)·Ry·Rx. */
export function poseMatrix(out: THREE.Matrix4, x: number, y: number, z: number, ry: number, rx: number): THREE.Matrix4 {
  out.makeTranslation(x, y, z);
  _r.makeRotationY(ry); out.multiply(_r);
  _r.makeRotationX(rx); out.multiply(_r);
  return out;
}
/** Caixa com cantos verticais arredondados (raio r) em planta. */
function rbox(b: Batch, w: number, h: number, d: number, spec: Spec, x: number, y: number, z: number, r: number): void {
  b.box(w - 2 * r, h, d, spec, x, y, z); b.box(w, h, d - 2 * r, spec, x, y, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cylGeo(r, r, h, 10), spec, x + sx * (w / 2 - r), y, z + sz * (d / 2 - r));
}
/** Placa retangular arredondada na face voltada para ±z (cantos em xy), espessura t a partir de zf. */
function rpanel(b: Batch, w: number, h: number, spec: Spec, x: number, y: number, zf: number, dir: 1 | -1, r: number, t = 0.012): void {
  const z0 = dir > 0 ? zf : zf - t;
  b.box(w - 2 * r, h, t, spec, x, y, z0 + t / 2); b.box(w, h - 2 * r, t, spec, x, y + r, z0 + t / 2);
  for (const sx of [-1, 1]) for (const sy of [0, 1]) b.add(cylGeo(r, r, t, 8), spec, x + sx * (w / 2 - r), y + r + sy * (h - 2 * r), z0, { rx: Math.PI / 2 });
}
function counter(): Batch {
  const b = new Batch();
  // rodapé escuro, corpo azul-claro, faixa vermelha contínua
  b.box(1.9, 0.07, 0.72, C_PLINTH, 0, 0, CZ);
  rbox(b, 1.94, 0.71, 0.78, C_BODY, 0, 0.07, CZ, 0.07);
  rbox(b, 1.98, 0.1, 0.82, C_RED, 0, 0.78, CZ, 0.08);
  // painéis arredondados cinza (frente: 2; laterais; trás)
  const zF = CZ + 0.39, zB = CZ - 0.39;
  for (const x of [-0.5, 0.5]) { rpanel(b, 0.8, 0.5, C_FRAME, x, 0.14, zF - 0.002, 1, 0.07, 0.008); rpanel(b, 0.72, 0.42, C_PANEL, x, 0.18, zF - 0.002, 1, 0.06, 0.014); }
  rpanel(b, 0.56, 0.5, C_FRAME, 0.5, 0.14, zB + 0.002, -1, 0.07, 0.008); // lado do operador: vão escuro
  b.box(0.5, 0.42, 0.01, matte(0x2f3342), 0.5, 0.18, zB - 0.004);
  for (const sx of [-1, 1]) {
    b.box(0.01, 0.5, 0.58, C_FRAME, sx * 0.973, 0.14, CZ);
    b.box(0.014, 0.42, 0.5, C_PANEL, sx * 0.977, 0.18, CZ);
  }
  // tampo: placa cinza-clara de cantos arredondados + borda elevada deixando a esteira embutida
  rbox(b, 1.98, 0.016, 0.82, C_TOP, 0, 0.87, CZ, 0.07);
  const BX0 = -0.9, BX1 = 0.0, BZ0 = CZ - 0.31, BZ1 = CZ + 0.31;
  rbox(b, 0.08, 0.014, 0.82, C_TOP, -0.95, 0.886, CZ, 0.04);
  b.box(BX1 - BX0, 0.014, BZ0 - (CZ - 0.41), C_TOP, (BX0 + BX1) / 2, 0.886, (BZ0 + CZ - 0.41) / 2);
  b.box(BX1 - BX0, 0.014, CZ + 0.41 - BZ1, C_TOP, (BX0 + BX1) / 2, 0.886, (BZ1 + CZ + 0.41) / 2);
  b.box(0.5, 0.014, 0.82, C_TOP, 0.25, 0.886, CZ);
  rbox(b, 0.5, 0.014, 0.82, C_TOP, 0.73, 0.886, CZ, 0.07);
  // esteira (plano escuro + roletes) e scanner
  b.box(BX1 - BX0 - 0.02, 0.004, BZ1 - BZ0 - 0.02, matte(0x3f4249), (BX0 + BX1) / 2, 0.886, CZ);
  for (let i = 0; i < 12; i++) b.box(0.012, 0.003, BZ1 - BZ0 - 0.04, matte(0x34373e), BX0 + 0.06 + i * 0.07, 0.89, CZ);
  b.box(0.02, 0.006, BZ1 - BZ0, matte(0xffc107), BX0 + 0.012, 0.886, CZ);
  b.box(0.2, 0.006, 0.3, matte(0x1f2a33), SCANNER[0], 0.89, CZ);
  b.box(0.012, 0.003, 0.26, glow(0xff2a2a), SCANNER[0], 0.896, CZ);
  // base da registradora + teclado
  b.box(0.5, 0.045, 0.26, matte(0x5a5a74), 0.42, 0.9, -0.62);
  b.box(0.4, 0.022, 0.17, matte(0x2b2f36), 0.42, 0.945, -0.66);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
    const col = c >= 6 ? [0x2fbf71, 0xffc107, 0xe63946][r]! : 0xdfe3e8;
    b.box(0.032, 0.012, 0.03, matte(col), 0.42 - 0.145 + c * 0.0415, 0.967, -0.72 + r * 0.04);
  }
  // impressora de cupom
  b.box(0.15, 0.11, 0.16, matte(0xe3e6ea), 0.25, 0.9, -0.42);
  b.box(0.1, 0.006, 0.02, matte(0x2b2f36), 0.25, 1.01, -0.36);
  b.box(0.08, 0.12, 0.004, matte(0xffffff), 0.25, 1.01, -0.365, { rx: -0.35 });
  // monitor (pé, haste, moldura) — a tela é uma malha própria (screens.ts)
  const mon = new Batch();
  mon.box(0.24, 0.02, 0.18, matte(0x2b2f36), 0, 0, -0.03);
  mon.box(0.05, 0.24, 0.04, matte(0xd5d9df), 0, 0.02, -0.05);
  mon.box(MONITOR.w + 0.06, MONITOR.h + 0.06, 0.05, matte(0xe7eaee), 0, MONITOR.cy - (MONITOR.h + 0.06) / 2, -0.017);
  mon.box(0.4, 0.26, 0.06, matte(0xd5d9df), 0, MONITOR.cy - 0.13, -0.07);
  mon.box(0.03, 0.012, 0.004, glow(0xff3b3b), 0, MONITOR.cy - MONITOR.h / 2 - 0.022, 0.009);
  b.merge(mon.build(), poseMatrix(_m, MONITOR.x, MONITOR.y, MONITOR.z, MONITOR.ry, MONITOR.tilt));
  // maquininha: berço + corpo inclinado (a face é desenhada em screens.ts)
  const cp = new Batch();
  cp.box(0.11, 0.028, 0.2, matte(0x3a3f48), 0, -0.014, 0);
  cp.box(0.1, 0.01, 0.04, matte(0x23262c), 0, 0.012, -0.09);
  b.box(0.13, 0.04, 0.16, matte(0x2b2f36), CARDPAD.x, CARDPAD.y, CARDPAD.z);
  b.merge(cp.build(), poseMatrix(_m, CARDPAD.x, CARDPAD.y + CARDPAD.lift, CARDPAD.z, CARDPAD.ry, CARDPAD.tilt));
  return b;
}

/** Cadeira do operador (local: assento centrado, frente +z). */
function chair(): Batch {
  const b = new Batch();
  const dark = matte(0x2b2f36), blue = matte(0x2f6fd6);
  for (let i = 0; i < 5; i++) b.add(boxGeo(0.04, 0.035, 0.3), dark, Math.sin((i / 5) * Math.PI * 2) * 0.14, 0.03, Math.cos((i / 5) * Math.PI * 2) * 0.14, { ry: (i / 5) * Math.PI * 2 });
  for (let i = 0; i < 5; i++) b.add(sphGeo(0.03, 6, 4), dark, Math.sin((i / 5) * Math.PI * 2) * 0.28, 0.03, Math.cos((i / 5) * Math.PI * 2) * 0.28);
  b.add(cylGeo(0.03, 0.03, 0.36, 8), STEEL, 0, 0.06, 0);
  b.box(0.48, 0.08, 0.46, blue, 0, 0.42, 0);
  b.box(0.05, 0.32, 0.04, STEEL, 0, 0.46, -0.21);
  b.box(0.46, 0.46, 0.07, blue, 0, 0.64, -0.25);
  for (const x of [-0.25, 0.25]) { b.box(0.04, 0.18, 0.04, dark, x, 0.5, -0.02); b.box(0.06, 0.03, 0.26, dark, x, 0.68, -0.02); }
  return b;
}

/** Balcão lateral do computador (local: encostado na parede em −z, frente +z): notebook, caneca, bloco, planta. */
export const DESK_SIZE = { w: 1.0, d: 0.56 };
function desk(): Batch {
  const b = new Batch();
  b.box(0.98, 0.06, 0.54, C_PLINTH, 0, 0, 0);
  b.box(0.96, 0.72, 0.52, C_BODY, 0, 0.06, 0);
  for (const x of [-0.24, 0.24]) b.box(0.36, 0.5, 0.012, C_PANEL, x, 0.14, 0.266);
  b.box(0.98, 0.09, 0.54, C_RED, 0, 0.78, 0);
  b.box(1.0, 0.03, 0.56, C_TOP, 0, 0.87, 0);
  // notebook
  b.box(0.36, 0.018, 0.25, matte(0x5b6270), -0.08, 0.9, 0.05);
  b.box(0.3, 0.004, 0.11, matte(0x2b2f36), -0.08, 0.918, 0.07);
  const lidA = -0.26, hz = 0.05 - 0.125, cy = 0.918 + 0.12 * Math.cos(lidA), cz = hz + 0.12 * Math.sin(lidA);
  b.add(new THREE.BoxGeometry(0.36, 0.24, 0.012), matte(0x4b5260), -0.08, cy, cz, { rx: lidA });
  const nrm = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), lidA);
  b.add(uvToCell(planeGeo(0.32, 0.2).clone(), DECAL.laptop()), ['decal', 0xffffff], -0.08 + nrm.x * 0.0075, cy + nrm.y * 0.0075, cz + nrm.z * 0.0075, { rx: lidA });
  // caneca, bloco de notas e plantinha
  b.add(cylGeo(0.042, 0.038, 0.1, 12), matte(0xd9822b), 0.3, 0.9, 0.08);
  b.add(cylGeo(0.036, 0.036, 0.004, 12), matte(0x3b2416), 0.3, 0.995, 0.08);
  b.box(0.02, 0.05, 0.012, matte(0xd9822b), 0.35, 0.93, 0.08);
  b.box(0.12, 0.006, 0.16, matte(0xfff3b0), 0.18, 0.9, -0.12, { ry: 0.2 });
  b.add(cylGeo(0.05, 0.04, 0.07, 10), matte(0xc8693a), 0.4, 0.9, -0.16);
  b.add(sphGeo(0.06, 7, 5), ['flat', 0x4fa85a], 0.4, 1.0, -0.16);
  return b;
}

/** Posição local do slot i (0..23) de uma caixa em um rack. */
export function rackSlot(i: number): { x: number; y: number; z: number } {
  const lvl = Math.floor(i / 8), r = i % 8;
  const row = Math.floor(r / 4), col = r % 4;
  return { x: -0.69 + col * 0.46, y: 0.1 + lvl * 0.52 + 0.11, z: row === 0 ? 0.2 : -0.2 };
}
export const RACK_SLOTS = 24;

function rack(): Batch {
  const b = new Batch();
  const post = metal(0x2d5ea8), beam = matte(0xe5791c), plank = matte(0xb88a55);
  for (const sx of [-0.96, 0.96]) for (const sz of [-0.43, 0.43]) b.box(0.07, 1.7, 0.07, post, sx, 0, sz);
  for (const y of [0.1, 0.62, 1.14, 1.64]) {
    b.box(1.95, 0.09, 0.05, beam, 0, y, 0.43);
    b.box(1.95, 0.09, 0.05, beam, 0, y, -0.43);
    if (y < 1.6) b.box(1.86, 0.03, 0.84, plank, 0, y + 0.09, 0);
  }
  return b;
}

function bannerBatch(b: Batch): void {
  // faixa de oferta: textura própria ficaria como material extra; aqui vira cartaz em cores sólidas (laranja + faixa clara)
  b.box(0.44, 1.2, 0.02, matte(0xff7a2e), 0, 0.5, 0.02);
  b.box(0.38, 0.22, 0.024, matte(0xffd23f), 0, 0.82, 0.021);
  b.box(0.3, 0.5, 0.026, matte(0xffffff), 0, 0.98 - 0.5, 0.022);
  b.box(0.14, 0.34, 0.03, matte(0xe0361f), 0, 0.58, 0.023);
}

function decor(f: Furniture): Batch {
  const b = new Batch();
  const v = f.variant ?? 'plant';
  const leaf = [0x3f9d4f, 0x57b861, 0x2f8142].map((c): Spec => ['flat', c]);
  const pot = matte(0xc8693a);
  if (v === 'banner') {
    b.box(0.5, 0.04, 0.2, DARK, 0, 0, 0);
    b.box(0.04, 1.75, 0.04, STEEL, 0, 0.04, 0);
    bannerBatch(b);
  } else if (v === 'lamp') {
    b.box(0.34, 0.04, 0.34, DARK, 0, 0, 0);
    b.add(cylGeo(0.02, 0.02, 1.6, 6), STEEL, 0, 0.04, 0);
    b.add(cylGeo(0.12, 0.2, 0.28, 10), glow(0xfff1c2), 0, 1.5, 0);
  } else if (v === 'tree') {
    b.add(cylGeo(0.26, 0.22, 0.34, 10), pot, 0, 0, 0);
    b.add(cylGeo(0.05, 0.07, 0.9, 6), matte(0x6d4a2c), 0, 0.3, 0);
    b.add(icoGeo(0.42, 0), leaf[0]!, 0, 1.35, 0);
    b.add(icoGeo(0.3, 0), leaf[1]!, 0.22, 1.1, 0.12);
    b.add(icoGeo(0.28, 0), leaf[2]!, -0.2, 1.2, -0.1);
    b.add(icoGeo(0.24, 0), leaf[1]!, 0.02, 1.72, 0.05);
  } else {
    b.add(cylGeo(0.22, 0.16, 0.3, 10), pot, 0, 0, 0);
    b.add(cylGeo(0.2, 0.2, 0.02, 10), matte(0x4a3320), 0, 0.29, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(coneGeo(0.1, 0.5, 5), leaf[i % 3]!, Math.cos(a) * 0.13, 0.3, Math.sin(a) * 0.13, { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 });
    }
    b.add(sphGeo(0.14, 7, 5), leaf[1]!, 0, 0.68, 0);
  }
  return b;
}

function structure(f: Furniture, lv: readonly (string | undefined)[]): Batch {
  switch (f.type as FurnitureType) {
    case 'shelf': return shelf(lv);
    case 'fridge': return fridge(lv);
    case 'freezer': return freezer(lv);
    case 'counter': return counter();
    case 'rack': return rack();
    default: return decor(f);
  }
}

/** Geometrias fundidas (espaço local) por (tipo, níveis/produtos, variante). Vivem até o fim do jogo; são poucas e reutilizadas por todos os móveis iguais. */
const modelCache = new Map<string, Map<Kind, THREE.BufferGeometry>>();
/** `lv` = produto de cada nível (padrão: `levelPids(f)`); a quantidade de níveis define as tábuas. */
export function furnitureGeos(f: Furniture, lv: readonly (string | undefined)[] = levelPids(f)): Map<Kind, THREE.BufferGeometry> {
  const key = isDisplayType(f.type) ? `${f.type}|${lv.map((p) => p ?? '').join(',')}` : f.type === 'decor' ? `decor|${f.variant ?? 'plant'}` : f.type;
  let g = modelCache.get(key);
  if (!g) { g = structure(f, lv).build(); modelCache.set(key, g); }
  return g;
}

let drawerGeo: THREE.BufferGeometry | null = null;
const drawerMat = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.5 });
/** Gaveta da registradora (Mesh próprio, animado pelo mundo). */
export function makeDrawer(parent: THREE.Object3D): { drawer: THREE.Mesh; baseZ: number } {
  drawerGeo ??= boxGeo(DRAWER.w, DRAWER.h, DRAWER.d);
  const m = new THREE.Mesh(drawerGeo, drawerMat);
  m.position.set(DRAWER.x, DRAWER.y, DRAWER.z);
  m.castShadow = false; m.receiveShadow = false;
  parent.add(m);
  return { drawer: m, baseZ: DRAWER.z };
}

/** Visão independente (fantasma do modo construção): meshes que compartilham as geometrias em cache. */
export function buildFurniture(f: Furniture, _fraction: number): FurnitureView {
  void _fraction;
  const g = new THREE.Group();
  meshesOf(furnitureGeos(f), g);
  if (f.type === 'counter') { const d = makeDrawer(g); return { group: g, drawer: d.drawer, drawerBaseZ: d.baseZ }; }
  return { group: g };
}

/* ---------------- Fase 3: peças avulsas, silhuetas (pick/contorno) e etiquetas ---------------- */
let chairCache: Map<Kind, THREE.BufferGeometry> | null = null;
let deskCache: Map<Kind, THREE.BufferGeometry> | null = null;
export const chairGeos = (): Map<Kind, THREE.BufferGeometry> => (chairCache ??= chair().build());
export const deskGeos = (): Map<Kind, THREE.BufferGeometry> => (deskCache ??= desk().build());

/** Caixa local [cx, cy, cz, w, h, d] (centro e tamanho). */
export type SBox = readonly [number, number, number, number, number, number];
const SIL: Record<string, SBox[]> = {
  shelf: [[0, 0.695, 0, 2.0, 1.39, 0.98], [0, 1.525, 0, 1.96, 0.27, 0.1]],
  fridge: [[0, 1.03, 0, 2.0, 2.06, 1.0]],
  freezer: [[0, 0.39, 0, 2.0, 0.78, 0.98]],
  counter: [[0, 0.45, -0.4, 2.0, 0.9, 0.84], [0.66, 1.19, -0.38, 0.64, 0.6, 0.2]],
  rack: [[0, 0.87, 0, 2.0, 1.75, 0.95]],
  plant: [[0, 0.42, 0, 0.5, 0.85, 0.5]], tree: [[0, 0.95, 0, 0.9, 1.9, 0.9]], banner: [[0, 0.9, 0, 0.52, 1.8, 0.22]], lamp: [[0, 0.88, 0, 0.42, 1.76, 0.42]],
  chair: [[0, 0.27, 0, 0.62, 0.54, 0.62], [0, 0.86, -0.25, 0.48, 0.5, 0.1]],
  desk: [[0, 0.45, 0, 1.0, 0.9, 0.56], [-0.08, 1.03, -0.1, 0.38, 0.27, 0.08]],
};
/** Silhueta simplificada (caixas locais) do móvel: proxies de pick e contorno de destaque. */
export function silhouetteOf(f: Pick<Furniture, 'type' | 'variant'>): SBox[] {
  if (f.type === 'decor') return SIL[f.variant ?? 'plant'] ?? SIL.plant!;
  return SIL[f.type] ?? [[0, 0.5, 0, 1, 1, 1]];
}
export const chairSilhouette = (): SBox[] => SIL.chair!;
export const deskSilhouette = (): SBox[] => SIL.desk!;

/** Nº de níveis desenhados do móvel (levels.length; reserva: FurnitureSpec.slots do tipo). */
export const levelCountOf = (f: Pick<Furniture, 'type' | 'productId' | 'levels'>): number => levelPids(f).length;
