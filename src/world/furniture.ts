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

const DRAWER = { w: 0.36, h: 0.06, d: 0.3, x: 0.62, y: 0.9, z: -0.3 };
function counter(): Batch {
  const b = new Batch();
  const cab = matte(0xdfe5ea), accent = matte(0x3a7bd5), top = matte(0xf5f7f9), dark = matte(0x23262c);
  b.box(1.2, 0.76, 0.62, cab, -0.4, 0, 0.57);
  b.box(1.2, 0.05, 0.64, accent, -0.4, 0.22, 0.575);
  b.box(1.2, 0.03, 0.66, top, -0.4, 0.76, 0.57);
  b.box(1.14, 0.015, 0.44, dark, -0.4, 0.79, 0.57);
  for (let i = 0; i < 9; i++) b.box(0.01, 0.006, 0.44, matte(0x3a3e46), -0.92 + i * 0.13, 0.805, 0.57);
  b.box(1.2, 0.05, 0.04, STEEL, -0.4, 0.79, 0.28);
  b.box(1.2, 0.05, 0.04, STEEL, -0.4, 0.79, 0.86);
  b.box(0.04, 0.12, 0.5, STEEL, 0.17, 0.79, 0.57);
  b.box(0.03, 0.2, 0.03, matte(0x2a2d33), -0.2, 0.79, 0.57);
  b.box(0.5, 0.012, 0.03, matte(0xffc107), -0.2, 0.99, 0.57);
  b.box(0.8, 0.9, 1.6, cab, 0.6, 0, 0.1);
  b.box(0.82, 0.05, 1.62, accent, 0.6, 0.22, 0.1);
  b.box(0.84, 0.04, 1.64, WOOD, 0.6, 0.9, 0.1);
  b.box(0.32, 0.03, 0.22, dark, 0.52, 0.94, 0.62);
  b.box(0.2, 0.006, 0.1, metal(0x111418), 0.52, 0.972, 0.62);
  b.box(0.2, 0.004, 0.012, glow(0xff2a2a), 0.52, 0.98, 0.62);
  b.box(0.4, 0.08, 0.36, metal(0x8f98a3), 0.62, 0.94, -0.3);
  b.box(0.28, 0.2, 0.025, dark, 0.62, 1.0, -0.42, { rx: -0.35 });
  b.box(0.24, 0.15, 0.005, glow(0x7be0a3), 0.62, 1.01, -0.405, { rx: -0.35 });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) b.box(0.05, 0.012, 0.04, matte(0xdce1e6), 0.5 + c * 0.075, 1.02, -0.22 + r * 0.05 - 0.04);
  b.box(0.05, 0.1, 0.05, STEEL, 0.3, 0.94, 0.12);
  b.box(0.1, 0.03, 0.16, dark, 0.3, 1.03, 0.12, { rx: 0.4 });
  b.box(0.07, 0.004, 0.06, glow(0x4fc3f7), 0.3, 1.049, 0.08, { rx: 0.4 });
  b.box(1.0, 0.82, 0.6, cab, -0.5, 0, -0.5);
  b.box(1.04, 0.04, 0.64, WOOD, -0.5, 0.82, -0.5);
  b.box(0.28, 0.22, 0.14, matte(0xf2f2f2), -0.7, 0.86, -0.5);
  b.box(0.28, 0.2, 0.14, matte(0xe9c46a), -0.4, 0.86, -0.5);
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
