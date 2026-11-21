/**
 * Visuais procedurais dos produtos (≈11 formas distintas), rótulos em canvas e a camada instanciada de caixas de papelão.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PRODUCTS, productById, type Category } from '../sim/catalog';
import { boxGeo, cylGeo, sphGeo, stdMat, makeCanvas, canvasTex, planeGeo } from './kit';

export const CATEGORY_COLOR: Record<Category, number> = {
  mercearia: 0xe08a24, bebidas: 0x2a86d6, laticinios: 0x5d8fd9, congelados: 0x22b5c9, padaria: 0xb7742c, limpeza: 0x3fae4f,
};
export const categoryColor = (pid: string | undefined): number => {
  if (!pid) return 0x9aa3ad;
  try { return CATEGORY_COLOR[productById(pid).category]; } catch { return 0x9aa3ad; }
};

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

const cache = new Map<string, ProductVisual>();
export function productVisual(id: string): ProductVisual {
  let v = cache.get(id);
  if (!v) {
    v = (builders[id] ?? (() => ({ w: 0.15, h: 0.2, d: 0.1, geo: merge([part(boxGeo(0.15, 0.2, 0.1), 0xaaaaaa, 0, 0, 0)]) })))();
    cache.set(id, v);
  }
  return v;
}
export const productMat = (): THREE.MeshStandardMaterial => stdMat(0xffffff, { vertexColors: true, rough: 0.55 });

/* ---------- rótulos em canvas ---------- */
const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = '800'): number {
  let s = size;
  do { g.font = `${weight} ${s}px system-ui, sans-serif`; s -= 2; } while (g.measureText(text).width > maxW && s > 12);
  return s;
}

const signCache = new Map<string, THREE.MeshStandardMaterial>();
/** Placa de topo da prateleira com o nome do produto (ou "VAZIO"). */
export function shelfSignMat(pid: string | undefined): THREE.MeshStandardMaterial {
  const key = pid ?? '-';
  let m = signCache.get(key);
  if (m) return m;
  const { c, g } = makeCanvas(512, 96);
  const col = categoryColor(pid);
  g.fillStyle = css(col); g.fillRect(0, 0, 512, 96);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, 512, 12);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const text = pid ? productById(pid).name : 'VAZIO';
  fitText(g, text, 460, 56);
  g.fillText(text, 256, 52);
  m = new THREE.MeshStandardMaterial({ map: canvasTex(c), roughness: 0.6, emissive: col, emissiveIntensity: 0.12 });
  signCache.set(key, m);
  return m;
}

const labelCache = new Map<string, THREE.MeshStandardMaterial>();
/** Etiqueta colada na caixa de papelão. */
export function boxLabelMat(pid: string): THREE.MeshStandardMaterial {
  let m = labelCache.get(pid);
  if (m) return m;
  const { c, g } = makeCanvas(256, 128);
  g.fillStyle = '#fbfaf4'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = css(categoryColor(pid)); g.fillRect(0, 0, 256, 26);
  g.fillStyle = '#222'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let name = pid;
  try { name = productById(pid).name; } catch { /* id desconhecido */ }
  const words = name.split(' ');
  const l1 = words.length > 1 ? words.slice(0, -1).join(' ') : name;
  const l2 = words.length > 1 ? words[words.length - 1]! : '';
  const s = fitText(g, l1.length > l2.length ? l1 : l2 || l1, 220, 40);
  g.font = `800 ${s}px system-ui, sans-serif`;
  g.fillText(l1, 128, l2 ? 58 : 72);
  if (l2) g.fillText(l2, 128, 58 + s);
  // código de barras decorativo
  g.fillStyle = '#222';
  for (let i = 0; i < 28; i++) g.fillRect(24 + i * 7, 104, (i * 7) % 3 === 0 ? 3 : 2, 16);
  m = new THREE.MeshStandardMaterial({ map: canvasTex(c), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  labelCache.set(pid, m);
  return m;
}

/* ---------- caixas de papelão (instanciadas) ---------- */
export const BOX_W = 0.46, BOX_H = 0.32, BOX_D = 0.34;
export interface BoxInst { pid: string; x: number; y: number; z: number; ry: number; open: boolean; fill: number }

/** Camada instanciada de caixas: poucas draw calls independentemente da quantidade. */
export class BoxLayer {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private tape: THREE.InstancedMesh;
  private flapFB: THREE.InstancedMesh;
  private flapLR: THREE.InstancedMesh;
  private labels = new Map<string, THREE.InstancedMesh>();
  private items = new Map<string, THREE.InstancedMesh>();
  private dummy = new THREE.Object3D();
  private P = new THREE.Matrix4();
  private C = new THREE.Matrix4();
  constructor(private cap = 160) {
    const kraft = stdMat(0xc99a5c, { rough: 0.95 });
    const kraftDark = stdMat(0xb4854a, { rough: 0.95 });
    const tapeM = stdMat(0xe9d6a8, { rough: 0.7 });
    this.body = this.mk(boxGeo(BOX_W, BOX_H, BOX_D), kraft, cap, true);
    this.tape = this.mk(boxGeo(0.07, 0.004, BOX_D + 0.004), tapeM, cap, false);
    this.flapFB = this.mk(boxGeo(BOX_W, 0.012, BOX_D / 2), kraftDark, cap * 2, false);
    this.flapLR = this.mk(boxGeo(BOX_W / 2, 0.012, BOX_D), kraftDark, cap * 2, false);
    for (const p of PRODUCTS) {
      this.labels.set(p.id, this.mk(planeGeo(0.3, 0.15), boxLabelMat(p.id), cap, false));
      this.items.set(p.id, this.mk(productVisual(p.id).geo, productMat(), cap * 4, true));
    }
  }
  private mk(g: THREE.BufferGeometry, m: THREE.Material, n: number, cast: boolean): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(g, m, n);
    im.count = 0; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true;
    this.group.add(im);
    return im;
  }
  private set(im: THREE.InstancedMesh, P: THREE.Matrix4, lx: number, ly: number, lz: number, rx = 0, ry = 0, rz = 0): void {
    if (im.count >= im.instanceMatrix.count) return;
    this.dummy.position.set(lx, ly, lz); this.dummy.rotation.set(rx, ry, rz); this.dummy.updateMatrix();
    this.C.multiplyMatrices(P, this.dummy.matrix);
    im.setMatrixAt(im.count++, this.C);
  }
  update(list: BoxInst[]): void {
    const all = [this.body, this.tape, this.flapFB, this.flapLR, ...this.labels.values(), ...this.items.values()];
    for (const m of all) m.count = 0;
    for (const b of list.slice(0, this.cap)) {
      this.dummy.position.set(b.x, b.y, b.z); this.dummy.rotation.set(0, b.ry, 0); this.dummy.updateMatrix();
      this.P.copy(this.dummy.matrix);
      this.set(this.body, this.P, 0, 0, 0);
      const lab = this.labels.get(b.pid);
      if (lab) this.set(lab, this.P, 0, BOX_H * 0.5, BOX_D / 2 + 0.003);
      if (!b.open) {
        this.set(this.tape, this.P, 0, BOX_H + 0.002, 0);
      } else {
        const a = 1.1; // flaps abertos
        const Lfb = BOX_D / 2, Llr = BOX_W / 2;
        this.set(this.flapFB, this.P, 0, BOX_H + Math.sin(a) * Lfb / 2, BOX_D / 2 + Math.cos(a) * Lfb / 2, -a);
        this.set(this.flapFB, this.P, 0, BOX_H + Math.sin(a) * Lfb / 2, -(BOX_D / 2 + Math.cos(a) * Lfb / 2), a);
        this.set(this.flapLR, this.P, BOX_W / 2 + Math.cos(a) * Llr / 2, BOX_H + Math.sin(a) * Llr / 2, 0, 0, 0, a);
        this.set(this.flapLR, this.P, -(BOX_W / 2 + Math.cos(a) * Llr / 2), BOX_H + Math.sin(a) * Llr / 2, 0, 0, 0, -a);
        const it = this.items.get(b.pid);
        const n = b.fill > 0 ? Math.max(1, Math.round(b.fill * 4)) : 0;
        if (it && n) {
          const v = productVisual(b.pid);
          const slots: [number, number][] = [[-0.11, -0.07], [0.11, -0.07], [-0.11, 0.08], [0.11, 0.08]];
          for (let i = 0; i < n; i++) this.set(it, this.P, slots[i]![0], BOX_H - Math.min(0.13, v.h * 0.55), slots[i]![1], 0, (i % 2) * 0.5);
        }
      }
    }
    for (const m of all) { m.instanceMatrix.needsUpdate = true; }
  }
  /** Quantidade de caixas desenhadas (debug/testes). */
  get count(): number { return this.body.count; }
  dispose(): void {
    this.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
  }
}
