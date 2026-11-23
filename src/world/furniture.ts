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
import { signCell, uvToCell } from './atlas';
import { productVisual, categoryColor, pushMatrix } from './products';

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

interface Slot { x: number; y: number; z: number; ry: number }
/** Gera slots (prateleira em níveis) preenchendo primeiro a fileira da frente, distribuído entre os níveis. */
function gridSlots(pid: string, levelsY: number[], width: number, depth: number, zCenter: number, maxRows = 3): Slot[] {
  const v = productVisual(pid);
  const cols = Math.max(1, Math.floor(width / (v.w + 0.015)));
  const rows = Math.max(1, Math.min(maxRows, Math.floor(depth / (v.d + 0.015))));
  const px = width / cols, pz = depth / rows;
  const out: Slot[] = [];
  const total = levelsY.length * cols * rows;
  for (let k = 0; k < total; k++) {
    const lvl = k % levelsY.length, idx = Math.floor(k / levelsY.length);
    const col = idx % cols, row = Math.floor(idx / cols);
    out.push({
      x: -width / 2 + (col + 0.5) * px + (hash01(k, 1) - 0.5) * 0.01,
      y: levelsY[lvl]!,
      z: zCenter + depth / 2 - (row + 0.5) * pz,
      ry: (hash01(k, 2) - 0.5) * 0.2,
    });
  }
  return out;
}

const SHELF_LEVELS = [0.14, 0.54, 0.94];
const FRIDGE_LEVELS = [0.2, 0.62, 1.04, 1.46];
/** Slots de exibição do móvel (coordenadas locais) ou [] se não exibe produto. */
function slotsOf(f: Furniture): Slot[] {
  const pid = f.productId;
  if (!pid) return [];
  switch (f.type) {
    case 'shelf': return gridSlots(pid, SHELF_LEVELS.map((y) => y + 0.04), 1.76, 0.82, -0.02);
    case 'fridge': return gridSlots(pid, FRIDGE_LEVELS.map((y) => y + 0.013), 1.74, 0.8, -0.02);
    case 'freezer': {
      const v = productVisual(pid);
      const ly = [0.22]; if (v.h * 2 < 0.5) ly.push(0.22 + v.h);
      return gridSlots(pid, ly, 1.74, 0.76, 0, 4);
    }
    default: return [];
  }
}
const slotCache = new Map<string, Slot[]>();
function cachedSlots(f: Furniture): Slot[] {
  const key = `${f.type}|${f.productId ?? ''}`;
  let s = slotCache.get(key);
  if (!s) { s = slotsOf(f); slotCache.set(key, s); }
  return s;
}

const dummy = new THREE.Object3D();
const W = new THREE.Matrix4(), L = new THREE.Matrix4();
/** Matrizes de mundo dos itens expostos (n proporcional à fração de estoque). `cx/cz` = centro do footprint (tiles). */
export function furnitureItems(f: Furniture, fraction: number, cx: number, cz: number): number[] {
  const out: number[] = [];
  const slots = cachedSlots(f);
  if (fraction <= 0 || slots.length === 0) return out;
  const n = Math.min(slots.length, Math.max(1, Math.round(slots.length * Math.min(1, fraction))));
  dummy.position.set(cx, 0.01, cz); dummy.rotation.set(0, (f.rot * Math.PI) / 180, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
  W.copy(dummy.matrix);
  for (let i = 0; i < n; i++) {
    const s = slots[i]!;
    dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.ry, 0); dummy.updateMatrix();
    L.multiplyMatrices(W, dummy.matrix);
    pushMatrix(out, L);
  }
  return out;
}

/** Placa com o nome do produto (atlas): frente (+z) e, opcionalmente, verso. */
function sign(b: Batch, pid: string | undefined, w: number, h: number, x: number, y: number, z: number, back = false): void {
  const c = signCell(pid);
  b.add(uvToCell(planeGeo(w, h).clone(), c), ['sign', 0xffffff], x, y, z);
  if (back) b.add(uvToCell(planeGeo(w, h).clone(), c), ['sign', 0xffffff], x, y, -z, { ry: Math.PI });
}

function shelf(f: Furniture): Batch {
  const b = new Batch();
  const pid = f.productId;
  const accent = categoryColor(pid);
  b.box(1.96, 0.1, 0.92, DARK, 0, 0, 0);
  b.box(1.9, 1.24, 0.04, matte(tint(accent, 0.78)), 0, 0.1, -0.45);
  b.box(0.06, 1.26, 0.94, FRAME, -0.97, 0.1, 0);
  b.box(0.06, 1.26, 0.94, FRAME, 0.97, 0.1, 0);
  b.box(2.0, 0.05, 0.98, FRAME, 0, 1.34, 0);
  for (const y of SHELF_LEVELS) {
    b.box(1.9, 0.04, 0.9, FRAME, 0, y, 0);
    b.box(1.9, 0.06, 0.02, matte(accent), 0, y + 0.04, 0.455);
  }
  b.box(1.96, 0.27, 0.08, DARK, 0, 1.39, 0);
  sign(b, pid, 1.96, 0.27, 0, 1.39 + 0.135, 0.041, true);
  return b;
}

function fridge(f: Furniture): Batch {
  const b = new Batch();
  const body = metal(0x3a4552);
  b.box(2.0, 0.14, 0.98, body, 0, 0, 0);
  b.box(1.9, 1.62, 0.05, matte(0xcfe9f1), 0, 0.14, -0.45);
  b.box(0.07, 1.66, 0.94, body, -0.965, 0.14, 0);
  b.box(0.07, 1.66, 0.94, body, 0.965, 0.14, 0);
  b.box(2.0, 0.28, 1.0, body, 0, 1.78, 0);
  sign(b, f.productId, 2.0, 0.28, 0, 1.78 + 0.14, 0.501);
  b.box(1.8, 0.03, 0.05, glow(0xbdf2ff), 0, 1.76, 0.45);
  for (const y of FRIDGE_LEVELS) b.box(1.86, 0.025, 0.86, matte(0xcfe3ec), 0, y, 0);
  for (const sx of [-0.49, 0.49]) b.box(0.94, 1.56, 0.02, GLASS, sx, 0.16, 0.49);
  for (const x of [-0.98, 0, 0.98]) b.box(0.05, 1.6, 0.05, STEEL, x, 0.14, 0.49);
  for (const x of [-0.1, 0.1]) b.box(0.03, 0.55, 0.05, STEEL, x, 0.55, 0.53);
  return b;
}

function freezer(f: Furniture): Batch {
  const b = new Batch();
  const white = matte(0xe8f1f7);
  b.box(1.9, 0.1, 0.9, matte(0x3b4753), 0, 0, 0);
  b.box(1.98, 0.62, 0.96, white, 0, 0.1, 0);
  b.box(1.98, 0.05, 0.97, matte(0x22b5c9), 0, 0.42, 0);
  b.box(1.8, 0.02, 0.8, matte(0xb7d9e8), 0, 0.2, 0);
  b.box(2.0, 0.05, 0.06, white, 0, 0.72, 0.47);
  b.box(2.0, 0.05, 0.06, white, 0, 0.72, -0.47);
  b.box(0.06, 0.05, 0.98, white, -0.97, 0.72, 0);
  b.box(0.06, 0.05, 0.98, white, 0.97, 0.72, 0);
  b.box(0.06, 0.05, 0.9, white, 0, 0.72, 0);
  for (const sx of [-0.49, 0.49]) b.box(0.9, 0.02, 0.86, GLASS, sx, 0.74, 0);
  b.box(0.5, 0.04, 0.04, STEEL, 0, 0.76, 0.5);
  sign(b, f.productId, 1.1, 0.2, 0, 0.25, 0.482);
  return b;
}

/* ---------------- balcão do caixa (Fase 3) ----------------
 * Local (frente/clientes em +z, footprint [-1,1]²): esteira à esquerda (x<0) correndo de +z (cliente) para −z
 * (scanner); mesa do operador à direita (x>0) com monitor, maquininha, impressora e teclado; gôndola de doces na
 * frente da mesa; cadeira atrás do balcão (fora do footprint, no tile do operador). */
const C_BODY = matte(0x7d93c4), C_PANEL = matte(0xd5dae3), C_RED = matte(0xc9252c), C_TOP = matte(0xeef0f3), C_PLINTH = matte(0x3a3e48);
export const BELT_Y = 0.882;
/** Monitor (pose local no balcão): tela w×h a `cy` acima da mesa, virada para o operador. */
export const MONITOR = { x: 0.74, y: 0.92, z: -0.12, ry: Math.atan2(0.5 - 0.74, -1.42 + 0.12), tilt: -0.08, w: 0.56, h: 0.36, cy: 0.41, cz: 0.014 };
/** Maquininha de cartão: face (tela + teclas) w×h no topo do corpo inclinado. */
export const CARDPAD = { x: 0.16, y: 0.92, z: -0.6, ry: Math.atan2(0.5 - 0.16, -1.42 + 0.6), tilt: 0.45, lift: 0.075, w: 0.088, h: 0.176 };
/** Assento do operador (local) e pose dos olhos sentado. */
export const SEAT = { x: 0.5, z: -1.42, eye: [0.5, 1.24, -1.34] as const, look: [-0.02, 0.97, 0.55] as const };
/** Mão do cliente estendendo dinheiro/cartão; scanner; esteira (cliente → scanner). */
export const HANDOFF = [-0.3, 1.12, 0.84] as const;
export const SCANNER = [-0.51, -0.6] as const;
export const BELT_SLOTS: readonly (readonly [number, number])[] = Array.from({ length: 8 }, (_, i) => [-0.51 + (i % 2 ? 0.11 : -0.11), 0.84 - i * 0.157] as const);

const DRAWER = { w: 0.42, h: 0.1, d: 0.36, x: 0.5, y: 0.68, z: -0.7 };
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
/** Matriz local de uma peça do balcão: T(x,y,z)·Ry·Rx. */
export function poseMatrix(out: THREE.Matrix4, x: number, y: number, z: number, ry: number, rx: number): THREE.Matrix4 {
  out.makeTranslation(x, y, z);
  _r.makeRotationY(ry); out.multiply(_r);
  _r.makeRotationX(rx); out.multiply(_r);
  return out;
}
function counter(): Batch {
  const b = new Batch();
  // esteira
  b.box(0.9, 0.07, 1.8, C_PLINTH, -0.51, 0, 0.055);
  b.box(0.88, 0.7, 1.78, C_BODY, -0.51, 0.07, 0.055);
  for (const z of [-0.42, 0.45]) b.box(0.012, 0.42, 0.7, C_PANEL, -0.956, 0.2, z);
  b.box(0.6, 0.42, 0.012, C_PANEL, -0.51, 0.2, 0.948);
  b.box(0.92, 0.1, 1.82, C_RED, -0.51, 0.77, 0.055);
  for (const x of [-0.925, -0.095]) b.box(0.07, 0.04, 1.82, C_TOP, x, 0.87, 0.055);
  b.box(0.76, 0.012, 1.25, matte(0x3f4249), -0.51, 0.87, 0.31);
  for (let i = 0; i < 12; i++) b.box(0.74, 0.003, 0.012, matte(0x34373e), -0.51, 0.882, -0.26 + i * 0.1);
  b.box(0.9, 0.04, 0.04, C_TOP, -0.51, 0.87, 0.95);
  b.box(0.6, 0.025, 0.035, matte(0xffc107), -0.51, 0.882, 0.86);
  b.box(0.78, 0.02, 0.52, matte(0xd9dde3), -0.51, 0.87, -0.6);
  b.box(0.32, 0.006, 0.24, matte(0x1f2a33), SCANNER[0], 0.89, SCANNER[1]);
  b.box(0.26, 0.003, 0.012, glow(0xff2a2a), SCANNER[0], 0.896, SCANNER[1]);
  // mesa do operador
  b.box(1.0, 0.07, 1.16, C_PLINTH, 0.46, 0, -0.28);
  b.box(0.98, 0.72, 1.14, C_BODY, 0.46, 0.07, -0.28);
  b.box(0.012, 0.42, 0.8, C_PANEL, 0.966, 0.2, -0.28);
  b.box(0.6, 0.46, 0.012, matte(0x5c6f99), 0.46, 0.12, -0.856);
  b.box(1.02, 0.1, 1.18, C_RED, 0.46, 0.79, -0.28);
  b.box(1.04, 0.03, 1.2, C_TOP, 0.46, 0.89, -0.28);
  // gôndola de doces virada para a fila
  b.box(0.92, 0.08, 0.58, C_PLINTH, 0.46, 0, 0.645);
  b.box(0.92, 1.1, 0.04, C_TOP, 0.46, 0.08, 0.37);
  for (const x of [0.015, 0.905]) b.box(0.03, 1.1, 0.58, C_TOP, x, 0.08, 0.645);
  b.box(0.92, 0.16, 0.035, matte(0xff7a2e), 0.46, 1.16, 0.37);
  const candy = [0xe63946, 0xffd23f, 0x3a86ff, 0x2fbf71, 0x9b5de5, 0xff7a2e];
  [0.3, 0.6, 0.9].forEach((y, t) => {
    const d = 0.5 - t * 0.12, zc = 0.39 + d / 2;
    b.box(0.86, 0.025, d, C_TOP, 0.46, y, zc);
    b.box(0.86, 0.05, 0.015, matte(0x3a86ff), 0.46, y + 0.02, zc + d / 2);
    for (let i = 0; i < 7; i++) b.box(0.075, 0.1, 0.05, matte(candy[(i + t) % candy.length]!), 0.1 + i * 0.12, y + 0.025, zc + d / 2 - 0.06);
  });
  // impressora de cupom, teclado
  b.box(0.15, 0.11, 0.19, matte(0xe3e6ea), 0.88, 0.92, -0.6);
  b.box(0.1, 0.006, 0.02, matte(0x2b2f36), 0.88, 1.03, -0.53);
  b.box(0.08, 0.12, 0.004, matte(0xffffff), 0.88, 1.03, -0.535, { rx: -0.35 });
  b.box(0.36, 0.025, 0.14, matte(0x2b2f36), 0.5, 0.92, -0.68);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
    const col = c >= 6 ? [0x2fbf71, 0xffc107, 0xe63946][r]! : 0xdfe3e8;
    b.box(0.032, 0.012, 0.03, matte(col), 0.5 - 0.145 + c * 0.0415, 0.945, -0.72 + r * 0.04);
  }
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
  b.box(0.13, 0.04, 0.16, matte(0x2b2f36), CARDPAD.x, 0.92, CARDPAD.z);
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

function structure(f: Furniture): Batch {
  switch (f.type as FurnitureType) {
    case 'shelf': return shelf(f);
    case 'fridge': return fridge(f);
    case 'freezer': return freezer(f);
    case 'counter': return counter();
    case 'rack': return rack();
    default: return decor(f);
  }
}

/** Geometrias fundidas (espaço local) por (tipo, produto, variante). Vivem até o fim do jogo; são poucas e reutilizadas por todos os móveis iguais. */
const modelCache = new Map<string, Map<Kind, THREE.BufferGeometry>>();
export function furnitureGeos(f: Furniture): Map<Kind, THREE.BufferGeometry> {
  const key = `${f.type}|${f.type === 'decor' ? '' : f.productId ?? ''}|${f.type === 'decor' ? f.variant ?? 'plant' : ''}`;
  let g = modelCache.get(key);
  if (!g) { g = structure(f).build(); modelCache.set(key, g); }
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
  counter: [[-0.51, 0.455, 0.055, 0.92, 0.91, 1.84], [0.46, 0.46, -0.28, 1.04, 0.92, 1.2], [0.46, 0.66, 0.645, 0.94, 1.32, 0.6], [0.74, 1.34, -0.12, 0.64, 0.46, 0.14]],
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

/** Âncora local da etiqueta de preço (frente +z) por tipo; null se o móvel não expõe produto. */
export function tagAnchor(type: FurnitureType): { x: number; y: number; z: number } | null {
  switch (type) {
    case 'shelf': return { x: 0, y: 1.012, z: 0.478 };
    case 'fridge': return { x: 0, y: 1.6, z: 0.535 };
    case 'freezer': return { x: 0.72, y: 0.36, z: 0.488 };
    default: return null;
  }
}
