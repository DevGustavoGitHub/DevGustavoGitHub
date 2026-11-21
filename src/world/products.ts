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
export interface BoxInst { pid: string; x: number; y: number; z: number; ry: number; open: boolean; fill: number }

const KRAFT: Spec = ['matte', 0xc99a5c], KRAFT_D: Spec = ['matte', 0xb4854a], TAPE: Spec = ['matte', 0xe9d6a8];
const boxGeoCache = new Map<string, THREE.BufferGeometry>();
/** Geometria da caixa (fechada ou aberta) já com a etiqueta do produto: tudo num único mesh. */
function boxVisual(pid: string, open: boolean): THREE.BufferGeometry {
  const key = `${pid}|${open ? 1 : 0}`;
  let g = boxGeoCache.get(key);
  if (g) return g;
  const white = whiteCell();
  const parts: THREE.BufferGeometry[] = [];
  const push = (geo: THREE.BufferGeometry, spec: Spec, x: number, y: number, z: number, o: { rx?: number; rz?: number } = {}): void => {
    const b = new Batch().add(geo, spec, x, y, z, o);
    const m = b.build().get('matte')!;
    uvToWhite(m, white); parts.push(m);
  };
  push(boxGeo(BOX_W, BOX_H, BOX_D), KRAFT, 0, 0, 0);
  if (!open) push(boxGeo(0.07, 0.004, BOX_D + 0.004), TAPE, 0, BOX_H + 0.002, 0);
  else {
    const a = 1.1, Lfb = BOX_D / 2, Llr = BOX_W / 2;
    push(boxGeo(BOX_W, 0.012, BOX_D / 2), KRAFT_D, 0, BOX_H + Math.sin(a) * Lfb / 2, BOX_D / 2 + Math.cos(a) * Lfb / 2, { rx: -a });
    push(boxGeo(BOX_W, 0.012, BOX_D / 2), KRAFT_D, 0, BOX_H + Math.sin(a) * Lfb / 2, -(BOX_D / 2 + Math.cos(a) * Lfb / 2), { rx: a });
    push(boxGeo(BOX_W / 2, 0.012, BOX_D), KRAFT_D, BOX_W / 2 + Math.cos(a) * Llr / 2, BOX_H + Math.sin(a) * Llr / 2, 0, { rz: a });
    push(boxGeo(BOX_W / 2, 0.012, BOX_D), KRAFT_D, -(BOX_W / 2 + Math.cos(a) * Llr / 2), BOX_H + Math.sin(a) * Llr / 2, 0, { rz: -a });
  }
  const lab = uvToCell(new Batch().add(planeGeo(0.3, 0.15), ['matte', 0xffffff], 0, BOX_H * 0.5, BOX_D / 2 + 0.003).build().get('matte')!, labelCell(pid));
  parts.push(lab);
  g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  boxGeoCache.set(key, g);
  return g;
}

/** Camada instanciada de caixas (chão + racks): 1 draw call por produto/estado (fechada/aberta). Itens das abertas vão para a ItemLayer. */
export class BoxLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private lists = new Map<string, BoxInst[]>();
  private dummy = new THREE.Object3D();
  private P = new THREE.Matrix4();
  private C = new THREE.Matrix4();
  constructor(private items: ItemLayer, private cap = 400) {}
  /** Atualiza as caixas de uma origem (`floor`, `rack`). */
  setSource(name: string, list: BoxInst[]): void { this.lists.set(name, list.slice(0, this.cap)); this.flush(name); }
  private flush(changed: string): void {
    for (const m of this.meshes.values()) m.count = 0;
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
        this.dummy.position.set(b.x, b.y, b.z); this.dummy.rotation.set(0, b.ry, 0); this.dummy.updateMatrix();
        this.P.copy(this.dummy.matrix);
        const im = this.meshes.get(`${b.pid}|${b.open ? 1 : 0}`)!;
        im.setMatrixAt(im.count++, this.P);
        if (b.open && b.fill > 0) {
          const n = Math.max(1, Math.round(b.fill * 4));
          const v = productVisual(b.pid);
          const slots: [number, number][] = [[-0.11, -0.07], [0.11, -0.07], [-0.11, 0.08], [0.11, 0.08]];
          let arr = items.get(b.pid);
          if (!arr) items.set(b.pid, (arr = []));
          for (let i = 0; i < n; i++) {
            this.dummy.position.set(slots[i]![0], BOX_H - Math.min(0.13, v.h * 0.55), slots[i]![1]); this.dummy.rotation.set(0, (i % 2) * 0.5, 0); this.dummy.updateMatrix();
            this.C.multiplyMatrices(this.P, this.dummy.matrix);
            pushMatrix(arr, this.C);
          }
        }
      }
      itemSrc.set(name, items);
    }
    for (const m of this.meshes.values()) m.instanceMatrix.needsUpdate = true;
    void changed;
    for (const [name, data] of itemSrc) this.items.setSource(`box:${name}`, data);
  }
  /** Quantidade de caixas desenhadas por origem (debug/testes). */
  countOf(name: string): number { return this.lists.get(name)?.length ?? 0; }
  dispose(): void { for (const m of this.meshes.values()) m.dispose(); this.meshes.clear(); this.lists.clear(); this.group.clear(); }
}
