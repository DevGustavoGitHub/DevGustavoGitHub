/**
 * Fábrica de móveis procedurais. Convenção local: origem no centro do footprint, frente (clientes) em +z, y para cima.
 * Footprint sem rotação: shelf/fridge/freezer/rack = 2x1 (x por z), counter = 2x2, decor = 1x1.
 * O grupo recebe rotation.y = rot (graus) e é posicionado no centro do footprint rotacionado.
 */
import * as THREE from 'three';
import type { Furniture } from '../sim/state';
import { stdMat, bx, put, boxGeo, cylGeo, sphGeo, icoGeo, coneGeo, planeGeo, makeCanvas, canvasTex, hash01 } from './kit';
import { productVisual, productMat, shelfSignMat, categoryColor } from './products';

export interface FurnitureView {
  group: THREE.Group;
  /** Gaveta da registradora (se counter) — animada pelo mundo no evento 'cash'. */
  drawer?: THREE.Mesh;
  drawerBaseZ?: number;
}

const tint = (c: number, k: number): number => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k).getHex();

const M = {
  frame: () => stdMat(0xe9ecef, { rough: 0.7 }),
  dark: () => stdMat(0x474c57, { rough: 0.7 }),
  steel: () => stdMat(0xb9c2cc, { rough: 0.35, metal: 0.6 }),
  glass: () => stdMat(0xbfe9ff, { opacity: 0.2, rough: 0.1, metal: 0.1 }),
  wood: () => stdMat(0xc9a06a, { rough: 0.8 }),
  woodDark: () => stdMat(0x8b6338, { rough: 0.85 }),
};

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

const dummy = new THREE.Object3D();
function fillItems(parent: THREE.Object3D, pid: string, slots: Slot[], fraction: number): void {
  if (fraction <= 0 || slots.length === 0) return;
  const n = Math.min(slots.length, Math.max(1, Math.round(slots.length * Math.min(1, fraction))));
  const im = new THREE.InstancedMesh(productVisual(pid).geo, productMat(), n);
  for (let i = 0; i < n; i++) {
    const s = slots[i]!;
    dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.ry, 0); dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  }
  im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false;
  parent.add(im);
}

function shelf(f: Furniture, fraction: number): FurnitureView {
  const g = new THREE.Group();
  const pid = f.productId;
  const accent = categoryColor(pid);
  const frame = M.frame(), dark = M.dark();
  const backMat = stdMat(tint(accent, 0.78), { rough: 0.8 });
  const levels = [0.14, 0.54, 0.94];
  bx(g, 1.96, 0.1, 0.92, dark, 0, 0, 0);
  bx(g, 1.9, 1.24, 0.04, backMat, 0, 0.1, -0.45);
  bx(g, 0.06, 1.26, 0.94, frame, -0.97, 0.1, 0);
  bx(g, 0.06, 1.26, 0.94, frame, 0.97, 0.1, 0);
  bx(g, 2.0, 0.05, 0.98, frame, 0, 1.34, 0);
  const lip = stdMat(accent, { rough: 0.6 });
  for (const y of levels) {
    bx(g, 1.9, 0.04, 0.9, frame, 0, y, 0);
    bx(g, 1.9, 0.06, 0.02, lip, 0, y + 0.04, 0.455, { cast: false });
  }
  const sg = shelfSignMat(pid);
  bx(g, 1.96, 0.27, 0.08, [dark, dark, dark, dark, sg, sg], 0, 1.39, 0);
  if (pid) fillItems(g, pid, gridSlots(pid, levels.map((y) => y + 0.04), 1.76, 0.82, -0.02), fraction);
  return { group: g };
}

function fridge(f: Furniture, fraction: number): FurnitureView {
  const g = new THREE.Group();
  const pid = f.productId;
  const body = stdMat(0x3a4552, { rough: 0.5, metal: 0.3 });
  const inner = stdMat(0xe3f4fa, { rough: 0.6, emissive: 0x9ad8ee, ei: 0.25 });
  const steel = M.steel();
  bx(g, 2.0, 0.14, 0.98, body, 0, 0, 0);
  bx(g, 1.9, 1.62, 0.05, inner, 0, 0.14, -0.45);
  bx(g, 0.07, 1.66, 0.94, body, -0.965, 0.14, 0);
  bx(g, 0.07, 1.66, 0.94, body, 0.965, 0.14, 0);
  const sg = shelfSignMat(pid);
  bx(g, 2.0, 0.28, 1.0, [body, body, body, body, sg, body], 0, 1.78, 0);
  bx(g, 1.8, 0.03, 0.05, stdMat(0xbdf2ff, { emissive: 0x7fe6ff, ei: 1.4 }), 0, 1.76, 0.45, { cast: false });
  const levels = [0.2, 0.62, 1.04, 1.46];
  for (const y of levels) bx(g, 1.86, 0.025, 0.86, stdMat(0xcfe3ec, { rough: 0.5 }), 0, y, 0, { cast: false });
  // portas de vidro + montantes + puxadores
  for (const sx of [-0.49, 0.49]) put(g, boxGeo(0.94, 1.56, 0.02), M.glass(), sx, 0.16, 0.49, { cast: false });
  for (const x of [-0.98, 0, 0.98]) bx(g, 0.05, 1.6, 0.05, steel, x, 0.14, 0.49);
  for (const x of [-0.1, 0.1]) bx(g, 0.03, 0.55, 0.05, steel, x, 0.55, 0.53);
  if (pid) fillItems(g, pid, gridSlots(pid, levels.map((y) => y + 0.013), 1.74, 0.8, -0.02), fraction);
  return { group: g };
}

function freezer(f: Furniture, fraction: number): FurnitureView {
  const g = new THREE.Group();
  const pid = f.productId;
  const white = stdMat(0xe8f1f7, { rough: 0.4 });
  const dark = stdMat(0x3b4753, { rough: 0.6 });
  const accent = stdMat(0x22b5c9, { rough: 0.5 });
  bx(g, 1.9, 0.1, 0.9, dark, 0, 0, 0);
  bx(g, 1.98, 0.62, 0.96, white, 0, 0.1, 0);
  bx(g, 1.98, 0.05, 0.97, accent, 0, 0.42, 0);
  // abertura (bin interno afundado) + rim do vidro
  bx(g, 1.8, 0.02, 0.8, stdMat(0xb7d9e8, { rough: 0.5, emissive: 0x9ad8ee, ei: 0.2 }), 0, 0.2, 0, { cast: false });
  bx(g, 2.0, 0.05, 0.06, white, 0, 0.72, 0.47);
  bx(g, 2.0, 0.05, 0.06, white, 0, 0.72, -0.47);
  bx(g, 0.06, 0.05, 0.98, white, -0.97, 0.72, 0);
  bx(g, 0.06, 0.05, 0.98, white, 0.97, 0.72, 0);
  bx(g, 0.06, 0.05, 0.9, white, 0, 0.72, 0);
  for (const sx of [-0.49, 0.49]) put(g, boxGeo(0.9, 0.02, 0.86), M.glass(), sx, 0.74, 0, { cast: false });
  bx(g, 0.5, 0.04, 0.04, M.steel(), 0, 0.76, 0.5);
  const sg = shelfSignMat(pid);
  put(g, planeGeo(1.1, 0.2), sg, 0, 0.25, 0.482, { cast: false });
  if (pid) {
    const v = productVisual(pid);
    const ly = [0.22]; if (v.h * 2 < 0.5) ly.push(0.22 + v.h);
    fillItems(g, pid, gridSlots(pid, ly, 1.74, 0.76, 0, 4), fraction);
  }
  return { group: g };
}

function counter(): FurnitureView {
  const g = new THREE.Group();
  const cab = stdMat(0xdfe5ea, { rough: 0.6 });
  const accent = stdMat(0x3a7bd5, { rough: 0.5 });
  const top = stdMat(0xf5f7f9, { rough: 0.35 });
  const dark = stdMat(0x23262c, { rough: 0.6 });
  const steel = M.steel();
  // módulo da esteira (lado do cliente)
  bx(g, 1.2, 0.76, 0.62, cab, -0.4, 0, 0.57);
  bx(g, 1.2, 0.05, 0.64, accent, -0.4, 0.22, 0.575, { cast: false });
  bx(g, 1.2, 0.03, 0.66, top, -0.4, 0.76, 0.57);
  bx(g, 1.14, 0.015, 0.44, dark, -0.4, 0.79, 0.57, { cast: false });
  for (let i = 0; i < 9; i++) bx(g, 0.01, 0.006, 0.44, stdMat(0x3a3e46), -0.92 + i * 0.13, 0.805, 0.57, { cast: false });
  bx(g, 1.2, 0.05, 0.04, steel, -0.4, 0.79, 0.28);
  bx(g, 1.2, 0.05, 0.04, steel, -0.4, 0.79, 0.86);
  bx(g, 0.04, 0.12, 0.5, steel, 0.17, 0.79, 0.57); // batente antes do scanner
  bx(g, 0.03, 0.2, 0.03, stdMat(0x2a2d33), -0.2, 0.79, 0.57); // divisor de compras
  bx(g, 0.5, 0.012, 0.03, stdMat(0xffc107), -0.2, 0.99, 0.57, { cast: false });
  // mesa do operador
  bx(g, 0.8, 0.9, 1.6, cab, 0.6, 0, 0.1);
  bx(g, 0.82, 0.05, 1.62, accent, 0.6, 0.22, 0.1, { cast: false });
  bx(g, 0.84, 0.04, 1.64, M.wood(), 0.6, 0.9, 0.1);
  // scanner (vidro + feixe vermelho)
  bx(g, 0.32, 0.03, 0.22, dark, 0.52, 0.94, 0.62);
  bx(g, 0.2, 0.006, 0.1, stdMat(0x111418, { rough: 0.1, metal: 0.4 }), 0.52, 0.972, 0.62, { cast: false });
  bx(g, 0.2, 0.004, 0.012, stdMat(0xff2a2a, { emissive: 0xff2020, ei: 2 }), 0.52, 0.98, 0.62, { cast: false });
  // registradora: base, tela inclinada, teclado, gaveta
  const reg = bx(g, 0.4, 0.08, 0.36, stdMat(0x8f98a3, { rough: 0.4, metal: 0.3 }), 0.62, 0.94, -0.3);
  reg.castShadow = true;
  const scr = bx(g, 0.28, 0.2, 0.025, dark, 0.62, 1.0, -0.42);
  scr.rotation.x = -0.35;
  bx(g, 0.24, 0.15, 0.005, stdMat(0x7be0a3, { emissive: 0x39d98a, ei: 1.1 }), 0.62, 1.01, -0.405, { cast: false }).rotation.x = -0.35;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) bx(g, 0.05, 0.012, 0.04, stdMat(0xdce1e6), 0.5 + c * 0.075, 1.02, -0.22 + r * 0.05 - 0.04, { cast: false });
  const drawer = bx(g, 0.36, 0.06, 0.3, stdMat(0x6b7480, { rough: 0.5 }), 0.62, 0.9, -0.3, { cast: false });
  // maquininha de cartão no suporte
  bx(g, 0.05, 0.1, 0.05, steel, 0.3, 0.94, 0.12);
  const cm = bx(g, 0.1, 0.03, 0.16, dark, 0.3, 1.03, 0.12);
  cm.rotation.x = 0.4;
  bx(g, 0.07, 0.004, 0.06, stdMat(0x4fc3f7, { emissive: 0x29b6f6, ei: 1.3 }), 0.3, 1.049, 0.08, { cast: false }).rotation.x = 0.4;
  // bancada de embalar (sacolas)
  bx(g, 1.0, 0.82, 0.6, cab, -0.5, 0, -0.5);
  bx(g, 1.04, 0.04, 0.64, M.wood(), -0.5, 0.82, -0.5);
  bx(g, 0.28, 0.22, 0.14, stdMat(0xf2f2f2), -0.7, 0.86, -0.5);
  bx(g, 0.28, 0.2, 0.14, stdMat(0xe9c46a), -0.4, 0.86, -0.5);
  return { group: g, drawer, drawerBaseZ: -0.3 };
}

/** Posição local do slot i (0..23) de uma caixa em um rack. */
export function rackSlot(i: number): { x: number; y: number; z: number } {
  const lvl = Math.floor(i / 8), r = i % 8;
  const row = Math.floor(r / 4), col = r % 4;
  return { x: -0.69 + col * 0.46, y: 0.1 + lvl * 0.52 + 0.11, z: row === 0 ? 0.2 : -0.2 };
}
export const RACK_SLOTS = 24;

function rack(): FurnitureView {
  const g = new THREE.Group();
  const post = stdMat(0x2d5ea8, { rough: 0.45, metal: 0.3 });
  const beam = stdMat(0xe5791c, { rough: 0.5 });
  const plank = stdMat(0xb88a55, { rough: 0.85 });
  for (const sx of [-0.96, 0.96]) for (const sz of [-0.43, 0.43]) bx(g, 0.07, 1.7, 0.07, post, sx, 0, sz);
  for (const y of [0.1, 0.62, 1.14, 1.64]) {
    bx(g, 1.95, 0.09, 0.05, beam, 0, y, 0.43);
    bx(g, 1.95, 0.09, 0.05, beam, 0, y, -0.43);
    if (y < 1.6) bx(g, 1.86, 0.03, 0.84, plank, 0, y + 0.09, 0, { cast: false });
  }
  bx(g, 1.9, 0.01, 0.01, post, 0, 0.7, 0.45, { cast: false }).rotation.z = 0.75;
  return { group: g };
}

let bannerMat: THREE.MeshStandardMaterial | null = null;
function banner(): THREE.MeshStandardMaterial {
  if (bannerMat) return bannerMat;
  const { c, g } = makeCanvas(128, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#ff5a3c'); grd.addColorStop(1, '#ffb703');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '800 34px system-ui, sans-serif';
  g.fillText('OFERTA', 64, 70);
  g.font = '800 70px system-ui, sans-serif'; g.fillText('%', 64, 160);
  g.font = '700 22px system-ui, sans-serif'; g.fillText('hoje!', 64, 214);
  bannerMat = new THREE.MeshStandardMaterial({ map: canvasTex(c), roughness: 0.7 });
  return bannerMat;
}

function decor(f: Furniture): FurnitureView {
  const g = new THREE.Group();
  const v = f.variant ?? 'plant';
  const leaf = [stdMat(0x3f9d4f, { flat: true }), stdMat(0x57b861, { flat: true }), stdMat(0x2f8142, { flat: true })];
  const pot = stdMat(0xc8693a, { rough: 0.8 });
  if (v === 'banner') {
    bx(g, 0.5, 0.04, 0.2, M.dark(), 0, 0, 0);
    bx(g, 0.04, 1.75, 0.04, M.steel(), 0, 0.04, 0);
    bx(g, 0.44, 1.2, 0.02, [stdMat(0xffffff), stdMat(0xffffff), stdMat(0xffffff), stdMat(0xffffff), banner(), banner()], 0, 0.5, 0.02);
  } else if (v === 'lamp') {
    bx(g, 0.34, 0.04, 0.34, M.dark(), 0, 0, 0);
    put(g, cylGeo(0.02, 0.02, 1.6, 6), M.steel(), 0, 0.04, 0);
    put(g, cylGeo(0.12, 0.2, 0.28, 10), stdMat(0xfff1c2, { emissive: 0xffd36b, ei: 1.1 }), 0, 1.5, 0, { cast: false });
  } else if (v === 'tree') {
    put(g, cylGeo(0.26, 0.22, 0.34, 10), pot, 0, 0, 0);
    put(g, cylGeo(0.05, 0.07, 0.9, 6), stdMat(0x6d4a2c), 0, 0.3, 0);
    put(g, icoGeo(0.42, 0), leaf[0]!, 0, 1.35, 0);
    put(g, icoGeo(0.3, 0), leaf[1]!, 0.22, 1.1, 0.12);
    put(g, icoGeo(0.28, 0), leaf[2]!, -0.2, 1.2, -0.1);
    put(g, icoGeo(0.24, 0), leaf[1]!, 0.02, 1.72, 0.05);
  } else {
    put(g, cylGeo(0.22, 0.16, 0.3, 10), pot, 0, 0, 0);
    put(g, cylGeo(0.2, 0.2, 0.02, 10), stdMat(0x4a3320), 0, 0.29, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const m = put(g, coneGeo(0.1, 0.5, 5), leaf[i % 3]!, Math.cos(a) * 0.13, 0.3, Math.sin(a) * 0.13);
      m.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    }
    put(g, sphGeo(0.14, 7, 5), leaf[1]!, 0, 0.68, 0);
  }
  return { group: g };
}

export function buildFurniture(f: Furniture, fraction: number): FurnitureView {
  switch (f.type) {
    case 'shelf': return shelf(f, fraction);
    case 'fridge': return fridge(f, fraction);
    case 'freezer': return freezer(f, fraction);
    case 'counter': return counter();
    case 'rack': return rack();
    default: return decor(f);
  }
}
