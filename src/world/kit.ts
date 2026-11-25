/**
 * Utilitários de arte procedural: caches de geometria/material, helpers de malha e rastreador de descarte.
 * Tudo que é compartilhado (cache) vive até o fim do jogo; o que é criado por reconstrução (paredes, piso)
 * passa por um Tracker, que libera GPU no próximo rebuild.
 */
import * as THREE from 'three';

type MatOpts = {
  rough?: number; metal?: number; emissive?: number; ei?: number;
  opacity?: number; side?: THREE.Side; flat?: boolean; vertexColors?: boolean; depthWrite?: boolean;
};

/**
 * Superfícies foscas (rugosidade ≥ ROUGH_LAMBERT, sem metal) usam MeshLambertMaterial: o difuso é o mesmo do PBR
 * (BRDF de Lambert por fragmento) e só some um brilho especular quase invisível nessa rugosidade (diferença média
 * < 2 níveis de 255 nas vistas comparadas; docs/PERF.md), com um shader de fragmento bem mais barato no celular.
 */
export const ROUGH_LAMBERT = 0.7;
type AnyMat = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
const matCache = new Map<string, AnyMat>();
/** Material padrão com cache por parâmetros (Lambert se fosco e não metálico; senão Standard). */
export function stdMat(color: number, o: MatOpts = {}): AnyMat {
  const key = `${color}|${o.rough ?? 0.85}|${o.metal ?? 0}|${o.emissive ?? 0}|${o.ei ?? 0}|${o.opacity ?? 1}|${o.side ?? 0}|${o.flat ? 1 : 0}|${o.vertexColors ? 1 : 0}|${o.depthWrite ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    const base = {
      color, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
      flatShading: o.flat ?? false, vertexColors: o.vertexColors ?? false,
      side: o.side ?? THREE.FrontSide,
    };
    m = (o.metal ?? 0) === 0 && (o.rough ?? 0.85) >= ROUGH_LAMBERT
      ? new THREE.MeshLambertMaterial(base)
      : new THREE.MeshStandardMaterial({ ...base, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0 });
    if (o.opacity !== undefined && o.opacity < 1) {
      m.transparent = true; m.opacity = o.opacity; m.depthWrite = o.depthWrite ?? false;
    }
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
/** Caixa com a BASE na origem (y de 0 a h), centrada em x/z. */
export const boxGeo = (w: number, h: number, d: number): THREE.BufferGeometry =>
  cached(`b${w}|${h}|${d}`, () => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; });
/** Cilindro com a base na origem. */
export const cylGeo = (rt: number, rb: number, h: number, seg = 12): THREE.BufferGeometry =>
  cached(`c${rt}|${rb}|${h}|${seg}`, () => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, h / 2, 0); return g; });
export const sphGeo = (r: number, ws = 10, hs = 8): THREE.BufferGeometry =>
  cached(`s${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const coneGeo = (r: number, h: number, seg = 8): THREE.BufferGeometry =>
  cached(`n${r}|${h}|${seg}`, () => { const g = new THREE.ConeGeometry(r, h, seg); g.translate(0, h / 2, 0); return g; });
export const icoGeo = (r: number, detail = 0): THREE.BufferGeometry =>
  cached(`i${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
export const planeGeo = (w: number, h: number): THREE.BufferGeometry =>
  cached(`p${w}|${h}`, () => new THREE.PlaneGeometry(w, h));

export interface MeshOpts { cast?: boolean; recv?: boolean }
/** Cria Mesh, posiciona e adiciona ao pai. */
export function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[],
  x = 0, y = 0, z = 0, o: MeshOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = o.cast ?? true;
  m.receiveShadow = o.recv ?? true;
  parent.add(m);
  return m;
}
export const bx = (p: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, o?: MeshOpts): THREE.Mesh =>
  put(p, boxGeo(w, h, d), mat, x, y, z, o);

/** Rastreia recursos criados em uma construção para descartá-los de uma vez. */
export class Tracker {
  private geos = new Set<THREE.BufferGeometry>();
  private mats = new Set<THREE.Material>();
  private texs = new Set<THREE.Texture>();
  geo<T extends THREE.BufferGeometry>(g: T): T { this.geos.add(g); return g; }
  mat<T extends THREE.Material>(m: T): T { this.mats.add(m); return m; }
  tex<T extends THREE.Texture>(t: T): T { this.texs.add(t); return t; }
  disposeAll(): void {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.texs.forEach((t) => t.dispose());
    this.geos.clear(); this.mats.clear(); this.texs.clear();
  }
}

/** Remove e libera um grupo inteiro de filhos (somente InstancedMesh ganham dispose próprio; geo/mat em cache são preservados). */
export function clearGroup(g: THREE.Object3D): void {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i]!;
    c.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    g.remove(c);
  }
}

/** Escala os UVs de uma geometria (para texturas repetidas por tamanho sem clonar a textura). */
export function scaleUV(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}
export function canvasTex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

/** Hash determinístico 0..1 a partir de inteiros (variações visuais estáveis). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export const hex = (s: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? parseInt(m[1]!, 16) : 0x888888;
};
export const rot2rad = (r: number): number => (r * Math.PI) / 180;

/** Converte coordenada local de um móvel em coordenada de mundo (tiles). Rotação em torno de Y: 0=frente +z, 90=frente +x. */
export function localToWorld(cx: number, cz: number, rot: number, lx: number, lz: number): { x: number; z: number } {
  const t = rot2rad(rot);
  const c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

/** Congela a matriz local de um objeto estático (three não recompõe posição/rotação/escala a cada quadro). */
export function freezeSelf(o: THREE.Object3D): void { o.updateMatrix(); o.matrixAutoUpdate = false; }
/** Congela toda a subárvore, exceto os objetos que se movem (`moving` continuam automáticos; seus filhos podem congelar). */
export function freezeStatic(root: THREE.Object3D, moving: readonly (THREE.Object3D | null | undefined)[] = []): void {
  root.traverse((o) => { if (!moving.includes(o)) freezeSelf(o); });
}
