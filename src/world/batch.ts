/**
 * Fusão de geometria estática por "tipo de material". Cada parte vira vértices coloridos (atributo `color`),
 * então tudo que é opaco e fosco cabe em UM material (1 draw call), em vez de um Mesh por peça.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeo } from './kit';
import { signMaterial } from './atlas';
import { decalMaterial } from './tex';

export type Kind = 'matte' | 'flat' | 'metal' | 'glass' | 'glow' | 'sign' | 'decal';
export type Spec = readonly [Kind, number];

const mats = new Map<Kind, THREE.Material>();
/** Materiais compartilhados (vivem até o fim do jogo). */
export function kindMaterial(k: Kind): THREE.Material {
  let m = mats.get(k);
  if (m) return m;
  switch (k) {
    // foscos: Lambert (mesmo difuso do PBR; ver ROUGH_LAMBERT em kit.ts). Metal e vidro continuam PBR (brilho visível).
    case 'matte': m = new THREE.MeshLambertMaterial({ vertexColors: true }); break;
    case 'flat': m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }); break;
    case 'metal': m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.55 }); break;
    case 'glass': m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }); break;
    case 'glow': m = new THREE.MeshBasicMaterial({ vertexColors: true }); break;
    case 'decal': m = decalMaterial(); break;
    default: m = signMaterial();
  }
  mats.set(k, m);
  return m;
}

export interface PartOpts { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();

/** Normaliza para o conjunto de atributos comum (position, normal, uv, color), sem índice. */
function prepare(geo: THREE.BufferGeometry, color: number | null): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  if (color !== null) {
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

export class Batch {
  private lists = new Map<Kind, THREE.BufferGeometry[]>();
  private push(kind: Kind, g: THREE.BufferGeometry): void {
    let l = this.lists.get(kind);
    if (!l) this.lists.set(kind, (l = []));
    l.push(g);
  }
  /** Adiciona geometria (copiada) transformada por posição/rotação/escala, com cor de vértice. */
  add(geo: THREE.BufferGeometry, spec: Spec, x = 0, y = 0, z = 0, o: PartOpts = {}): this {
    const g = prepare(geo, spec[0] === 'sign' || spec[0] === 'decal' ? 0xffffff : spec[1]);
    E.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0); Q.setFromEuler(E);
    S.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1); P.set(x, y, z);
    g.applyMatrix4(M.compose(P, Q, S));
    this.push(spec[0], g);
    return this;
  }
  /** Caixa com a BASE em y (como `bx` do kit). */
  box(w: number, h: number, d: number, spec: Spec, x: number, y: number, z: number, o: PartOpts = {}): this {
    return this.add(boxGeo(w, h, d), spec, x, y, z, o);
  }
  /** Acrescenta um conjunto já construído (build) transformado por `matrix` (geometrias de entrada intactas). */
  merge(geos: Map<Kind, THREE.BufferGeometry>, matrix: THREE.Matrix4): this {
    for (const [k, g] of geos) { const c = g.clone(); c.applyMatrix4(matrix); this.push(k, c); }
    return this;
  }
  /** Funde cada tipo em uma única geometria (as partes são descartadas). */
  build(): Map<Kind, THREE.BufferGeometry> {
    const out = new Map<Kind, THREE.BufferGeometry>();
    for (const [k, l] of this.lists) {
      if (!l.length) continue;
      const g = mergeGeometries(l, false);
      l.forEach((p) => p.dispose());
      if (g) out.set(k, g);
    }
    this.lists.clear();
    return out;
  }
}

/** Funde vários conjuntos locais já construídos aplicando uma matriz a cada um (geometrias de entrada não são alteradas). */
export function combine(items: { geos: Map<Kind, THREE.BufferGeometry>; matrix: THREE.Matrix4 }[]): Map<Kind, THREE.BufferGeometry> {
  const lists = new Map<Kind, THREE.BufferGeometry[]>();
  for (const it of items) for (const [k, g] of it.geos) {
    const c = g.clone(); c.applyMatrix4(it.matrix);
    let l = lists.get(k);
    if (!l) lists.set(k, (l = []));
    l.push(c);
  }
  const out = new Map<Kind, THREE.BufferGeometry>();
  for (const [k, l] of lists) {
    const g = mergeGeometries(l, false);
    l.forEach((p) => p.dispose());
    if (g) out.set(k, g);
  }
  return out;
}

/** Cria os Mesh de um conjunto fundido dentro de `parent`. Shadow: só tipos opacos (não vidro/brilho/placa). */
export function meshesOf(geos: Map<Kind, THREE.BufferGeometry>, parent: THREE.Object3D, o: { cast?: boolean; recv?: boolean; order?: number } = {}): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const [k, g] of geos) {
    const m = new THREE.Mesh(g, kindMaterial(k));
    m.castShadow = (o.cast ?? true) && (k === 'matte' || k === 'flat' || k === 'metal');
    m.receiveShadow = (o.recv ?? true) && k !== 'glow';
    m.frustumCulled = true;
    if (o.order !== undefined) m.renderOrder = o.order;
    parent.add(m); out.push(m);
  }
  return out;
}
export const disposeGeos = (geos: Iterable<THREE.BufferGeometry>): void => { for (const g of geos) g.dispose(); };
