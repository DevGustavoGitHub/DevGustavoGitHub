/**
 * Visuais procedurais dos produtos (11 formas feitas à mão + gerador genérico por `shape`/`color`/categoria),
 * a camada instanciada global de itens (prateleiras + caixas abertas) e a camada instanciada de caixas de papelão.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { productById, type Product } from '../sim/catalog';
import { boxGeo, cylGeo, sphGeo, stdMat, planeGeo } from './kit';
import { Batch, type Spec } from './batch';
import { labelCell, labelMaterial, uvToCell, uvToWhite, whiteCell } from './atlas';
import { productColorOf, productShapeOf, type Shape } from './look';

export { CATEGORY_COLOR, categoryColor } from './look';

export interface ProductVisual { geo: THREE.BufferGeometry; w: number; h: number; d: number }

interface PartOpts { sx?: number; sy?: number; sz?: number; rx?: number; ry?: number; rz?: number }
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o: PartOpts = {}): THREE.BufferGeometry {
  const g = geo.clone();
  tmpE.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  tmpQ.setFromEuler(tmpE);
  tmpS.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  tmpP.set(x, y, z);
  g.applyMatrix4(tmpM.compose(tmpP, tmpQ, tmpS));
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return g;
};
const prism = (w: number, r: number): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(r, r, w, 3); g.rotateZ(Math.PI / 2); return g;
};

const builders: Record<string, () => ProductVisual> = {
  // Saco de arroz: corpo creme, faixa verde, "bico" fechado no topo
  arroz: () => ({ w: 0.27, h: 0.36, d: 0.11, geo: merge([
    part(boxGeo(0.26, 0.33, 0.1), 0xf2eddc, 0, 0, 0),
    part(boxGeo(0.265, 0.13, 0.105), 0x2e8b57, 0, 0.1, 0),
    part(boxGeo(0.07, 0.05, 0.1), 0xffffff, 0, 0.14, 0.001, { sx: 1 }),
    part(boxGeo(0.26, 0.03, 0.045), 0xe6dfc9, 0, 0.33, 0),
  ]) }),
  // Feijão: saco menor marrom com faixa amarela
  feijao: () => ({ w: 0.2, h: 0.28, d: 0.08, geo: merge([
    part(boxGeo(0.19, 0.25, 0.075), 0x6a3b1a, 0, 0, 0),
    part(boxGeo(0.195, 0.09, 0.08), 0xf0c23c, 0, 0.08, 0),
    part(boxGeo(0.19, 0.025, 0.035), 0x57300f, 0, 0.25, 0),
  ]) }),
  // Macarrão: pacote chato amarelo com tarja vermelha
  macarrao: () => ({ w: 0.19, h: 0.27, d: 0.06, geo: merge([
    part(boxGeo(0.18, 0.26, 0.055), 0xf4c92f, 0, 0, 0),
    part(boxGeo(0.185, 0.08, 0.06), 0xd8452a, 0, 0.1, 0),
    part(sphGeo(0.035, 8, 6), 0xfff3b0, 0, 0.14, 0.03, { sz: 0.3 }),
  ]) }),
  // Café: tijolo marrom-escuro, faixa vermelha e filete dourado
  cafe: () => ({ w: 0.15, h: 0.21, d: 0.09, geo: merge([
    part(boxGeo(0.14, 0.2, 0.085), 0x4a2a15, 0, 0, 0),
    part(boxGeo(0.145, 0.07, 0.09), 0xc22b2b, 0, 0.07, 0),
    part(boxGeo(0.146, 0.012, 0.091), 0xe3b341, 0, 0.145, 0),
  ]) }),
  // Refrigerante 2L: garrafa escura, rótulo vermelho, tampa vermelha
  refri: () => ({ w: 0.12, h: 0.34, d: 0.12, geo: merge([
    part(cylGeo(0.055, 0.055, 0.25, 10), 0x34190f, 0, 0, 0),
    part(cylGeo(0.058, 0.058, 0.09, 10), 0xd62828, 0, 0.08, 0),
    part(cylGeo(0.022, 0.05, 0.05, 10), 0x34190f, 0, 0.25, 0),
    part(cylGeo(0.024, 0.024, 0.03, 8), 0xd62828, 0, 0.3, 0),
  ]) }),
  // Água 1,5L: garrafa clara, rótulo azul, tampa azul
  agua: () => ({ w: 0.1, h: 0.3, d: 0.1, geo: merge([
    part(cylGeo(0.048, 0.048, 0.22, 10), 0xc4e6f6, 0, 0, 0),
    part(cylGeo(0.05, 0.05, 0.08, 10), 0x1e88e5, 0, 0.07, 0),
    part(cylGeo(0.02, 0.046, 0.04, 10), 0xc4e6f6, 0, 0.22, 0),
    part(cylGeo(0.022, 0.022, 0.025, 8), 0x0d47a1, 0, 0.26, 0),
  ]) }),
  // Leite: caixinha branca com faixa azul e topo em cumeeira
  leite: () => ({ w: 0.1, h: 0.25, d: 0.08, geo: merge([
    part(boxGeo(0.09, 0.19, 0.07), 0xf8f8f4, 0, 0, 0),
    part(boxGeo(0.092, 0.07, 0.072), 0x2f6fd6, 0, 0.06, 0),
    part(prism(0.09, 0.05), 0xe9ece8, 0, 0.19, 0, { sz: 0.7, sy: 1 }),
    part(boxGeo(0.03, 0.02, 0.01), 0xffd34d, 0, 0.14, 0.036),
  ]) }),
  // Queijo: roda amarela com lacre vermelho
  queijo: () => ({ w: 0.2, h: 0.09, d: 0.2, geo: merge([
    part(cylGeo(0.1, 0.1, 0.07, 14), 0xf6c443, 0, 0, 0),
    part(cylGeo(0.103, 0.103, 0.018, 14), 0xd92f2f, 0, 0.03, 0),
    part(cylGeo(0.06, 0.06, 0.004, 12), 0xfff0b8, 0, 0.07, 0),
  ]) }),
  // Pão: saquinho de papel pardo com dois pães aparecendo
  pao: () => ({ w: 0.2, h: 0.2, d: 0.11, geo: merge([
    part(boxGeo(0.19, 0.13, 0.1), 0xd8b684, 0, 0, 0),
    part(sphGeo(0.05, 8, 6), 0xb9722a, -0.05, 0.14, 0, { sx: 1.1, sy: 0.9, sz: 0.9, rz: 0.4 }),
    part(sphGeo(0.05, 8, 6), 0xc98332, 0.05, 0.14, 0, { sx: 1.1, sy: 0.9, sz: 0.9, rz: -0.4 }),
    part(boxGeo(0.12, 0.03, 0.002), 0x8d5a2b, 0, 0.07, 0.051),
  ]) }),
  // Detergente: frasco verde com bico laranja
  detergente: () => ({ w: 0.11, h: 0.25, d: 0.07, geo: merge([
    part(boxGeo(0.1, 0.17, 0.062), 0x3fb64f, 0, 0, 0),
    part(boxGeo(0.102, 0.06, 0.064), 0xfafafa, 0, 0.05, 0),
    part(cylGeo(0.02, 0.04, 0.035, 8), 0x3fb64f, 0, 0.17, 0),
    part(boxGeo(0.02, 0.02, 0.055), 0xf5a623, 0, 0.205, 0.01),
  ]) }),
  // Sorvete: pote cônico creme com tampa rosa
  sorvete: () => ({ w: 0.19, h: 0.15, d: 0.19, geo: merge([
    part(cylGeo(0.095, 0.075, 0.13, 12), 0xfff0d2, 0, 0, 0),
    part(cylGeo(0.098, 0.098, 0.03, 12), 0xf06292, 0, 0.12, 0),
    part(cylGeo(0.097, 0.077, 0.05, 12), 0x8b5a3c, 0, 0.04, 0),
  ]) }),
};


/* ---------- visual genérico por shape/cor (qualquer produto novo do catálogo) ---------- */
const mix = (c: number, to: number, k: number): number => new THREE.Color(c).lerp(new THREE.Color(to), k).getHex();
const cylUp = (rt: number, rb: number, h: number): THREE.BufferGeometry => cylGeo(rt, rb, h, 12);

/** Constrói o visual de um produto a partir de `shape` + `color` (ou do padrão da categoria). Não depende do id. */
export function genericVisual(p: Pick<Product, 'color' | 'shape' | 'category'>): ProductVisual {
  const c = productColorOf(p), light = mix(c, 0xffffff, 0.62), dark = mix(c, 0x000000, 0.5);
  const shape: Shape = productShapeOf(p);
  switch (shape) {
    case 'bottle': return { w: 0.09, h: 0.25, d: 0.09, geo: merge([
      part(cylUp(0.042, 0.042, 0.17), c, 0, 0, 0),
      part(cylUp(0.044, 0.044, 0.07), light, 0, 0.05, 0),
      part(cylUp(0.018, 0.042, 0.05), c, 0, 0.17, 0),
      part(cylUp(0.02, 0.02, 0.03), dark, 0, 0.22, 0),
    ]) };
    case 'can': return { w: 0.075, h: 0.13, d: 0.075, geo: merge([
      part(cylUp(0.036, 0.036, 0.12), c, 0, 0, 0),
      part(cylUp(0.0375, 0.0375, 0.05), light, 0, 0.035, 0),
      part(cylUp(0.033, 0.033, 0.01), 0xd0d4d8, 0, 0.12, 0),
    ]) };
    case 'bag': return { w: 0.2, h: 0.29, d: 0.075, geo: merge([
      part(boxGeo(0.19, 0.26, 0.068), c, 0, 0, 0),
      part(boxGeo(0.195, 0.07, 0.072), light, 0, 0.09, 0),
      part(boxGeo(0.19, 0.03, 0.04), dark, 0, 0.26, 0),
    ]) };
    case 'tray': {
      const parts = [
        part(boxGeo(0.26, 0.04, 0.18), 0xe9e6df, 0, 0, 0),
        part(boxGeo(0.27, 0.02, 0.19), 0xffffff, 0, 0.035, 0),
      ];
      for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) parts.push(part(sphGeo(0.034, 8, 6), i % 2 ? light : c, -0.07 + i * 0.07, 0.065, -0.04 + r * 0.08, { sy: 0.8 }));
      return { w: 0.27, h: 0.1, d: 0.19, geo: merge(parts) };
    }
    case 'jar': return { w: 0.105, h: 0.13, d: 0.105, geo: merge([
      part(cylUp(0.05, 0.05, 0.1), c, 0, 0, 0),
      part(cylUp(0.0515, 0.0515, 0.04), light, 0, 0.035, 0),
      part(cylUp(0.053, 0.053, 0.03), dark, 0, 0.1, 0),
    ]) };
    default: return { w: 0.16, h: 0.22, d: 0.08, geo: merge([
      part(boxGeo(0.15, 0.2, 0.075), c, 0, 0, 0),
      part(boxGeo(0.155, 0.07, 0.078), light, 0, 0.07, 0),
      part(boxGeo(0.152, 0.02, 0.077), dark, 0, 0.2, 0),
    ]) };
  }
}

const cache = new Map<string, ProductVisual>();
export function productVisual(id: string): ProductVisual {
  let v = cache.get(id);
  if (!v) {
    const hand = builders[id];
    if (hand) v = hand();
    else {
      let p: Product | null = null;
      try { p = productById(id); } catch { /* id desconhecido */ }
      v = p ? genericVisual(p) : genericVisual({ category: '?' as Product['category'], shape: 'box', color: '#aaaaaa' });
    }
    cache.set(id, v);
  }
  return v;
}
export const productMat = (): THREE.MeshStandardMaterial => stdMat(0xffffff, { vertexColors: true, rough: 0.55 });

/* ---------- camada global de itens expostos (prateleiras, geladeiras e caixas abertas): 1 InstancedMesh por produto ---------- */
export function pushMatrix(arr: number[], m: THREE.Matrix4): void { const e = m.elements; for (let i = 0; i < 16; i++) arr.push(e[i]!); }
export function growMesh(map: Map<string, THREE.InstancedMesh>, parent: THREE.Object3D, key: string, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cast: boolean): THREE.InstancedMesh {
  let im = map.get(key);
  if (im && im.instanceMatrix.count >= n) return im;
  let cap = Math.max(64, im ? im.instanceMatrix.count * 2 : 64);
  while (cap < n) cap *= 2;
  if (im) { parent.remove(im); im.dispose(); }
  im = new THREE.InstancedMesh(geo, mat, cap);
  im.count = 0; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true;
  parent.add(im); map.set(key, im);
  return im;
}
export class ItemLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private src = new Map<string, Map<string, number[]>>();
  /** Troca os itens de uma origem (`furniture`, `box:floor`...) por matrizes de mundo agrupadas por produto. */
  setSource(name: string, data: Map<string, number[]>): void { this.src.set(name, data); this.flush(); }
  private flush(): void {
    const totals = new Map<string, number>();
    for (const d of this.src.values()) for (const [pid, a] of d) totals.set(pid, (totals.get(pid) ?? 0) + a.length / 16);
    for (const m of this.meshes.values()) m.count = 0;
    for (const [pid, n] of totals) {
      const im = growMesh(this.meshes, this.group, pid, productVisual(pid).geo, productMat(), n, false);
      let k = 0;
      const arr = im.instanceMatrix.array as Float32Array;
      for (const d of this.src.values()) { const a = d.get(pid); if (!a) continue; arr.set(a, k * 16); k += a.length / 16; }
      im.count = n; im.instanceMatrix.needsUpdate = true;
    }
  }
  get count(): number { let n = 0; for (const m of this.meshes.values()) n += m.count; return n; }
  dispose(): void { for (const m of this.meshes.values()) m.dispose(); this.meshes.clear(); this.src.clear(); this.group.clear(); }
}

/* ---------- caixas de papelão (instanciadas, etiqueta no atlas) ---------- */
export const BOX_W = 0.46, BOX_H = 0.32, BOX_D = 0.34;
/** `open` = abas abertas (Box.open); `fill` 0..1 = unidades / boxSize. */
export interface BoxInst { pid: string; x: number; y: number; z: number; ry: number; open: boolean; fill: number }

const KRAFT: Spec = ['matte', 0xc99a5c], KRAFT_D: Spec = ['matte', 0xb4854a], KRAFT_IN: Spec = ['matte', 0x8f6838], TAPE: Spec = ['matte', 0xe9d6a8], SEAM: Spec = ['matte', 0x7a5530];
const FLAP_A = 1.1, FLAP_T = 0.01;
const boxGeoCache = new Map<string, THREE.BufferGeometry>();
function partsToGeo(add: (push: (geo: THREE.BufferGeometry, spec: Spec, x: number, y: number, z: number, o?: { rx?: number; ry?: number; rz?: number }) => void) => void): THREE.BufferGeometry[] {
  const white = whiteCell();
  const parts: THREE.BufferGeometry[] = [];
  add((geo, spec, x, y, z, o = {}) => { const m = new Batch().add(geo, spec, x, y, z, o).build().get('matte')!; uvToWhite(m, white); parts.push(m); });
  return parts;
}
/** Paredes/fundo de uma caixa sem tampa (interior mais escuro) — base comum da caixa aberta e da animável. */
function shellParts(push: (geo: THREE.BufferGeometry, spec: Spec, x: number, y: number, z: number, o?: { rx?: number; ry?: number; rz?: number }) => void): void {
  const t = FLAP_T;
  push(boxGeo(BOX_W, t, BOX_D), KRAFT_D, 0, 0, 0);
  push(boxGeo(BOX_W - 2 * t, 0.003, BOX_D - 2 * t), KRAFT_IN, 0, t, 0);
  for (const s of [-1, 1]) {
    push(boxGeo(BOX_W, BOX_H, t), KRAFT, 0, 0, s * (BOX_D / 2 - t / 2));
    push(boxGeo(t, BOX_H, BOX_D - 2 * t), KRAFT, s * (BOX_W / 2 - t / 2), 0, 0);
    push(boxGeo(BOX_W - 2 * t, BOX_H - 0.012, 0.003), KRAFT_IN, 0, 0.012, s * (BOX_D / 2 - t - 0.0015));
    push(boxGeo(0.003, BOX_H - 0.012, BOX_D - 2 * t - 0.006), KRAFT_IN, s * (BOX_W / 2 - t - 0.0015), 0.012, 0);
  }
}
/** Geometria da caixa (fechada com fita, ou aberta com abas abertas e interior) já com a etiqueta do produto. */
function boxVisual(pid: string, open: boolean): THREE.BufferGeometry {
  const key = `${pid}|${open ? 1 : 0}`;
  let g = boxGeoCache.get(key);
  if (g) return g;
  const parts = partsToGeo((push) => {
    if (!open) {
      push(boxGeo(BOX_W, BOX_H, BOX_D), KRAFT, 0, 0, 0);
      push(boxGeo(BOX_W - 0.02, 0.002, 0.006), SEAM, 0, BOX_H, 0);
      push(boxGeo(BOX_W + 0.004, 0.003, 0.075), TAPE, 0, BOX_H + 0.001, 0);
      for (const s of [-1, 1]) push(boxGeo(0.003, 0.11, 0.075), TAPE, s * (BOX_W / 2 + 0.0015), BOX_H - 0.11, 0);
    } else {
      shellParts(push);
      const a = FLAP_A, Lfb = BOX_D / 2, Llr = 0.15;
      for (const s of [-1, 1]) {
        push(boxGeo(BOX_W, FLAP_T, Lfb), KRAFT_D, 0, BOX_H + (Math.sin(a) * Lfb) / 2 - 0.004, s * (BOX_D / 2 + (Math.cos(a) * Lfb) / 2), { rx: -s * a });
        push(boxGeo(Llr, FLAP_T, BOX_D - 0.02), KRAFT_D, s * (BOX_W / 2 + (Math.cos(a) * Llr) / 2), BOX_H + (Math.sin(a) * Llr) / 2 - 0.004, 0, { rz: s * a, ry: 0 });
      }
    }
  });
  const lab = uvToCell(new Batch().add(planeGeo(0.3, 0.15), ['matte', 0xffffff], 0, BOX_H * 0.48, BOX_D / 2 + 0.003).build().get('matte')!, labelCell(pid));
  parts.push(lab);
  g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  boxGeoCache.set(key, g);
  return g;
}

/** Posições locais (até 6) dos produtos visíveis numa caixa aberta e a altura da camada (divisória). */
export function boxContents(pid: string, fill: number): { slots: [number, number][]; y: number; raised: boolean } {
  const v = productVisual(pid);
  const cols = Math.max(1, Math.min(3, Math.floor((BOX_W - 0.04) / (v.w + 0.01))));
  const rows = Math.max(1, Math.min(2, Math.floor((BOX_D - 0.04) / (v.d + 0.01))));
  const cap = cols * rows;
  const n = fill <= 0 ? 0 : Math.max(1, Math.min(cap, Math.ceil(fill * cap)));
  const raised = fill > 0.5 && v.h < 0.22;
  const y = raised ? Math.max(0.014, BOX_H - v.h * 0.85) : 0.014;
  const slots: [number, number][] = [];
  const px = (BOX_W - 0.03) / cols, pz = (BOX_D - 0.03) / rows;
  for (let i = 0; i < n; i++) slots.push([-(BOX_W - 0.03) / 2 + ((i % cols) + 0.5) * px, -(BOX_D - 0.03) / 2 + (Math.floor(i / cols) + 0.5) * pz]);
  return { slots, y, raised };
}

/** Camada instanciada de caixas (chão + racks): 1 draw call por produto/estado. Itens das abertas vão para a ItemLayer; divisórias de papelão numa InstancedMesh única. */
export class BoxLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private lists = new Map<string, BoxInst[]>();
  private dummy = new THREE.Object3D();
  private P = new THREE.Matrix4();
  private C = new THREE.Matrix4();
  private sep: THREE.InstancedMesh;
  constructor(private items: ItemLayer, private cap = 400) {
    const sg = new Batch().add(new THREE.BoxGeometry(BOX_W - 0.03, 0.004, BOX_D - 0.03), KRAFT_IN).build().get('matte')!;
    uvToWhite(sg, whiteCell());
    this.sep = new THREE.InstancedMesh(sg, labelMaterial(), cap);
    this.sep.count = 0; this.sep.frustumCulled = false; this.sep.receiveShadow = true;
    this.group.add(this.sep);
  }
  /** Atualiza as caixas de uma origem (`floor`, `rack`). */
  setSource(name: string, list: BoxInst[]): void { this.lists.set(name, list.slice(0, this.cap)); this.flush(); }
  private flush(): void {
    for (const m of this.meshes.values()) m.count = 0;
    this.sep.count = 0;
    const need = new Map<string, number>();
    for (const l of this.lists.values()) for (const b of l) { const k = `${b.pid}|${b.open ? 1 : 0}`; need.set(k, (need.get(k) ?? 0) + 1); }
    const mat = labelMaterial();
    for (const [k, n] of need) {
      const [pid, o] = k.split('|') as [string, string];
      growMesh(this.meshes, this.group, k, boxVisual(pid, o === '1'), mat, n, true);
    }
    const itemSrc = new Map<string, Map<string, number[]>>();
    for (const [name, l] of this.lists) {
      const items = new Map<string, number[]>();
      for (const b of l) {
        this.dummy.position.set(b.x, b.y, b.z); this.dummy.rotation.set(0, b.ry, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix();
        this.P.copy(this.dummy.matrix);
        const im = this.meshes.get(`${b.pid}|${b.open ? 1 : 0}`)!;
        im.setMatrixAt(im.count++, this.P);
        if (!b.open || b.fill <= 0) continue;
        const c = boxContents(b.pid, b.fill);
        if (c.raised && this.sep.count < this.cap) {
          this.dummy.position.set(0, c.y - 0.004, 0); this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix();
          this.C.multiplyMatrices(this.P, this.dummy.matrix);
          this.sep.setMatrixAt(this.sep.count++, this.C);
        }
        let arr = items.get(b.pid);
        if (!arr) items.set(b.pid, (arr = []));
        c.slots.forEach(([sx, sz], i) => {
          this.dummy.position.set(sx, c.y, sz); this.dummy.rotation.set(0, (i % 2) * 0.3 - 0.15, 0); this.dummy.updateMatrix();
          this.C.multiplyMatrices(this.P, this.dummy.matrix);
          pushMatrix(arr!, this.C);
        });
      }
      itemSrc.set(name, items);
    }
    for (const m of this.meshes.values()) m.instanceMatrix.needsUpdate = true;
    this.sep.instanceMatrix.needsUpdate = true;
    for (const [name, data] of itemSrc) this.items.setSource(`box:${name}`, data);
  }
  /** Quantidade de caixas desenhadas por origem (debug/testes). */
  countOf(name: string): number { return this.lists.get(name)?.length ?? 0; }
  /** Caixas desenhadas por origem e estado (debug/testes). */
  openCount(name: string): number { return (this.lists.get(name) ?? []).filter((b) => b.open).length; }
  dispose(): void { for (const m of this.meshes.values()) m.dispose(); this.meshes.clear(); this.lists.clear(); this.sep.dispose(); this.group.clear(); }
}

/** Geometria + material compartilhados (não descarte): para esteira, cesta e caixa na mão. */
export function makeProductMesh(pid: string): THREE.Mesh {
  const m = new THREE.Mesh(productVisual(pid).geo, productMat());
  m.name = `product:${pid}`;
  m.castShadow = false; m.receiveShadow = false;
  return m;
}

/* ---------- caixa animável (mãos do jogador / repositor) ---------- */
const flapGeoCache = new Map<string, THREE.BufferGeometry>();
function flapGeo(long: boolean): THREE.BufferGeometry {
  const key = long ? 'L' : 'S';
  let g = flapGeoCache.get(key);
  if (g) return g;
  const w = long ? BOX_W : BOX_D - 0.02, L = long ? BOX_D / 2 : 0.15;
  const parts = partsToGeo((push) => {
    push(boxGeo(w, FLAP_T, L), KRAFT_D, 0, -FLAP_T / 2, L / 2);
    if (long) push(boxGeo(w + 0.004, 0.003, 0.036), TAPE, 0, -FLAP_T / 2 - 0.003, L - 0.018); // fechada a aba gira 180°: a fita fica por cima
  });
  g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  flapGeoCache.set(key, g);
  return g;
}
const shellCache = new Map<string, THREE.BufferGeometry>();
function shellGeo(pid: string): THREE.BufferGeometry {
  let g = shellCache.get(pid);
  if (g) return g;
  const parts = partsToGeo((push) => shellParts(push));
  parts.push(uvToCell(new Batch().add(planeGeo(0.3, 0.15), ['matte', 0xffffff], 0, BOX_H * 0.48, BOX_D / 2 + 0.003).build().get('matte')!, labelCell(pid)));
  g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  shellCache.set(pid, g);
  return g;
}
/**
 * Caixa animável (base no chão local, frente +z): `userData.setOpen(t)` (0 = fechada com fita, 1 = aberta; anime
 * em ~0,35 s) e `userData.setUnits(n)` (produtos visíveis por cima). Geometrias/material em cache: não descarte.
 */
export function makeBoxMesh(pid: string, open: boolean, units?: number): THREE.Group {
  const root = new THREE.Group(); root.name = `box:${pid}`;
  const mat = labelMaterial();
  root.add(new THREE.Mesh(shellGeo(pid), mat));
  const v = productVisual(pid);
  const items = new THREE.InstancedMesh(v.geo, productMat(), 6);
  items.count = 0; items.frustumCulled = false;
  root.add(items);
  const pivots: { p: THREE.Object3D; long: boolean }[] = [];
  for (const [ry, long] of [[0, true], [Math.PI, true], [Math.PI / 2, false], [-Math.PI / 2, false]] as const) {
    const side = new THREE.Group(); side.rotation.y = ry;
    const pivot = new THREE.Group();
    pivot.position.set(0, BOX_H - (long ? 0 : 0.003), long ? BOX_D / 2 : BOX_W / 2);
    pivot.add(new THREE.Mesh(flapGeo(long), mat));
    side.add(pivot); root.add(side);
    pivots.push({ p: pivot, long });
  }
  let size = 12;
  try { size = productById(pid).boxSize; } catch { /* produto desconhecido */ }
  const dm = new THREE.Object3D();
  let shownT = -1;
  const setUnits = (n: number): void => {
    const c = boxContents(pid, Math.max(0, Math.min(1, n / size)));
    items.count = c.slots.length;
    c.slots.forEach(([x, z], i) => { dm.position.set(x, c.y, z); dm.rotation.set(0, (i % 2) * 0.3 - 0.15, 0); dm.updateMatrix(); items.setMatrixAt(i, dm.matrix); });
    items.instanceMatrix.needsUpdate = true;
  };
  const setOpen = (t: number): void => {
    const k = Math.max(0, Math.min(1, t));
    if (k === shownT) return;
    shownT = k;
    const th = Math.PI + (FLAP_A - Math.PI) * k;
    for (const f of pivots) f.p.rotation.x = -th;
    items.visible = k > 0.05;
  };
  root.userData.setOpen = setOpen;
  root.userData.setUnits = setUnits;
  setUnits(units ?? size);
  setOpen(open ? 1 : 0);
  return root;
}

/** Geometria (cache) da caixa fechada/aberta com etiqueta — prévia de `build:box`. */
export { boxVisual as boxGeometry };
