/**
 * O que aparece "na mão" em 1ª pessoa: caixa de papelão (abas animadas, produtos dentro via InstancedMesh), pilha
 * no carrinho (dolly) e o esfregão procedural. Os objetos da mão ficam num `rig` que segue a câmera e são desenhados
 * POR ÚLTIMO e por cima do cenário (o 1º deles limpa a profundidade uma vez por quadro), então nunca entram na parede.
 * A mesma CartonView (materiais opacos) é usada na caixa arremessada que voa pelo mundo.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { productById } from '../sim/catalog';

export const BOX_W = 0.52, BOX_H = 0.34, BOX_D = 0.42;
const T = 0.012; // parede do papelão
const FT = 0.01; // espessura das abas
const OPEN_OUTER = 3.75, OPEN_INNER = 3.6; // abas abertas dobram para fora e para baixo (rad)
const OPEN_TIME = 0.35;
const C_OUT = new THREE.Color('#c8955a'), C_IN = new THREE.Color('#8f6436'), C_RIM = new THREE.Color('#e0b67e');
const CAT_COLOR: Record<string, string> = {
  mercearia: '#d9a441', bebidas: '#d6453d', laticinios: '#5aa6e0', congelados: '#7fd0e6', padaria: '#c9874a', limpeza: '#4fb3a2',
  hortifruti: '#5cb85c', higiene: '#b987d9', frios: '#d9534f', eletronicos: '#5b6b8c',
};

const noRaycast = (): void => {};
let clearedFrame = -1;
/** Primeiro objeto da mão desenhado no quadro limpa a profundidade: a mão fica sempre por cima do cenário. */
const clearDepthOnce = (r: THREE.WebGLRenderer): void => {
  const f = r.info.render.frame;
  if (f !== clearedFrame) { clearedFrame = f; r.clearDepth(); }
};
/** Prepara uma subárvore para a camada da mão (por último, sem sombra, sem raycast, sem culling). */
export function markHeld(o: THREE.Object3D): void {
  o.traverse((n) => {
    n.renderOrder = 1000; // Group → groupOrder 1000 para todos os filhos
    n.frustumCulled = false;
    n.raycast = noRaycast;
    const m = n as THREE.Mesh;
    if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.onBeforeRender = clearDepthOnce; }
  });
}

/* ---------------- geometrias da caixa ---------------- */
function slab(w: number, h: number, d: number, x: number, y: number, z: number, inward: THREE.Vector3 | null, rim: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.getAttribute('normal');
  const col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    let c = C_OUT;
    if (inward && nx * inward.x + ny * inward.y + nz * inward.z > 0.5) c = C_IN;
    else if (rim && ny > 0.5) c = C_RIM;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
interface Geos { body: THREE.BufferGeometry; outer: THREE.BufferGeometry; inner: THREE.BufferGeometry; tape: THREE.BufferGeometry; label: THREE.PlaneGeometry; rail: THREE.BoxGeometry; grip: THREE.BoxGeometry; stick: THREE.CylinderGeometry; head: THREE.BoxGeometry; fringe: THREE.BoxGeometry }
let G: Geos | null = null;
function geos(): Geos {
  if (G) return G;
  const W = BOX_W, H = BOX_H, D = BOX_D;
  const parts = [
    slab(W, T, D, 0, -H / 2 + T / 2, 0, new THREE.Vector3(0, 1, 0), false),
    slab(W, H, T, 0, 0, D / 2 - T / 2, new THREE.Vector3(0, 0, -1), true),
    slab(W, H, T, 0, 0, -D / 2 + T / 2, new THREE.Vector3(0, 0, 1), true),
    slab(T, H, D - 2 * T, -W / 2 + T / 2, 0, 0, new THREE.Vector3(1, 0, 0), true),
    slab(T, H, D - 2 * T, W / 2 - T / 2, 0, 0, new THREE.Vector3(-1, 0, 0), true),
  ];
  const body = mergeGeometries(parts) ?? parts[0]!;
  for (const p of parts) if (p !== body) p.dispose();
  // abas no espaço do pivô (dobradiça na borda de cima): externas (lado comprido) e internas (lado curto)
  const outer = slab(W, FT, D / 2, 0, FT / 2, -D / 4, new THREE.Vector3(0, -1, 0), false);
  const inner = slab(D / 2 - T, FT, D - 2 * T - 0.006, (D / 2 - T) / 2, FT / 2, 0, new THREE.Vector3(0, -1, 0), false);
  const tape = new THREE.BoxGeometry(W + 0.004, FT * 0.5, 0.032);
  tape.translate(0, FT + FT * 0.25, -D / 2 + 0.016);
  G = {
    body, outer, inner, tape, label: new THREE.PlaneGeometry(0.31, 0.135),
    rail: new THREE.BoxGeometry(0.03, 1, 0.03), grip: new THREE.BoxGeometry(0.11, 0.036, 0.04),
    stick: new THREE.CylinderGeometry(0.016, 0.016, 1, 8), head: new THREE.BoxGeometry(0.3, 0.045, 0.11), fringe: new THREE.BoxGeometry(0.33, 0.03, 0.16),
  };
  return G;
}

/* ---------------- rótulos (canvas) ---------------- */
const labelTex = new Map<string, THREE.CanvasTexture>();
function labelTexture(pid: string): THREE.CanvasTexture {
  let t = labelTex.get(pid);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 112;
  const g = c.getContext('2d');
  let name = pid, color = '#888', size = 0;
  try { const p = productById(pid); name = p.name; color = p.color ?? CAT_COLOR[p.category] ?? color; size = p.boxSize; } catch { /* produto desconhecido */ }
  if (g) {
    g.fillStyle = '#c8955a'; g.fillRect(0, 0, 256, 112);
    g.fillStyle = '#f7f1e3';
    g.beginPath(); g.roundRect(6, 6, 244, 100, 12); g.fill();
    g.fillStyle = color; g.beginPath(); g.roundRect(6, 6, 34, 100, [12, 0, 0, 12]); g.fill();
    g.fillStyle = '#23262e';
    let fs = 34;
    g.font = `800 ${fs}px system-ui,sans-serif`;
    while (fs > 16 && g.measureText(name).width > 196) { fs -= 2; g.font = `800 ${fs}px system-ui,sans-serif`; }
    g.textBaseline = 'middle';
    g.fillText(name, 50, size ? 46 : 56);
    if (size) { g.font = '700 19px system-ui,sans-serif'; g.fillStyle = '#6b6252'; g.fillText(`CAIXA · ${size} un.`, 50, 82); }
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelTex.set(pid, t);
  return t;
}

/* ---------------- kits de material (mão × mundo) ---------------- */
export class CartonKit {
  readonly body: THREE.MeshLambertMaterial;
  readonly tape: THREE.MeshLambertMaterial;
  readonly metal: THREE.MeshLambertMaterial;
  readonly red: THREE.MeshLambertMaterial;
  readonly mopStick: THREE.MeshLambertMaterial;
  readonly mopHead: THREE.MeshLambertMaterial;
  readonly mopFringe: THREE.MeshLambertMaterial;
  private labels = new Map<string, THREE.MeshLambertMaterial>();
  private clones = new Map<THREE.Material, THREE.Material>();
  constructor(readonly held: boolean) {
    const m = (p: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ ...p, transparent: held });
    this.body = m({ vertexColors: true });
    this.tape = m({ color: '#efe0b4' });
    this.metal = m({ color: '#59636f' });
    this.red = m({ color: '#d63a3a' });
    this.mopStick = m({ color: '#2f7fd6' });
    this.mopHead = m({ color: '#4a5563' });
    this.mopFringe = m({ color: '#ece8dc' });
  }
  label(pid: string): THREE.MeshLambertMaterial {
    let l = this.labels.get(pid);
    if (!l) { l = new THREE.MeshLambertMaterial({ map: labelTexture(pid), transparent: this.held }); this.labels.set(pid, l); }
    return l;
  }
  /** Material dos produtos: na mão vira cópia "transparente" (opacidade 1) para ser desenhado depois do cenário. */
  item(src: THREE.Material): THREE.Material {
    if (!this.held) return src;
    let c = this.clones.get(src);
    if (!c) { c = src.clone(); c.transparent = true; c.depthWrite = true; this.clones.set(src, c); }
    return c;
  }
  dispose(): void {
    for (const x of [this.body, this.tape, this.metal, this.red, this.mopStick, this.mopHead, this.mopFringe]) x.dispose();
    this.labels.forEach((l) => l.dispose());
    this.clones.forEach((c) => c.dispose());
  }
}

/* ---------------- produtos (molde → instâncias) ---------------- */
interface Part { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; m: THREE.Matrix4 }
interface Tpl { parts: Part[]; size: THREE.Vector3; center: THREE.Vector3; fromWorld: boolean }
interface Layout { cols: number; rows: number; per: number; cells: { x: number; z: number; ry: number }[]; base: THREE.Matrix4; thick: number }

function fallbackProduct(pid: string, own: { dispose(): void }[]): THREE.Object3D {
  let shape = 'box', color = '#9aa0a6';
  try { const p = productById(pid); shape = p.shape ?? 'box'; color = p.color ?? CAT_COLOR[p.category] ?? color; } catch { /* */ }
  let geo: THREE.BufferGeometry;
  switch (shape) {
    case 'bottle': geo = new THREE.CylinderGeometry(0.045, 0.048, 0.25, 10); break;
    case 'can': geo = new THREE.CylinderGeometry(0.038, 0.038, 0.13, 10); break;
    case 'jar': geo = new THREE.CylinderGeometry(0.05, 0.052, 0.13, 10); break;
    case 'bag': geo = new THREE.BoxGeometry(0.2, 0.28, 0.07); break;
    case 'tray': geo = new THREE.BoxGeometry(0.26, 0.08, 0.18); break;
    default: geo = new THREE.BoxGeometry(0.17, 0.23, 0.07);
  }
  // faixa clara de rótulo no meio + topo um pouco mais escuro (cor por vértice)
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.getAttribute('position');
  const base = new THREE.Color(color), band = base.clone().lerp(new THREE.Color('#ffffff'), 0.4), top = base.clone().multiplyScalar(0.8);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = (pos.getY(i) - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
    const c = v > 0.92 ? top : v > 0.38 && v < 0.68 && shape !== 'tray' ? band : base;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  own.push(geo, mat);
  return new THREE.Mesh(geo, mat);
}

const hash = (i: number, k: number): number => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };

export class ProductTemplates {
  private tpls = new Map<string, Tpl>();
  private lays = new Map<string, Layout>();
  private own: { dispose(): void }[] = [];
  constructor(private readonly maker: () => ((pid: string) => THREE.Object3D) | undefined) {}

  get(pid: string): Tpl {
    const mk = this.maker();
    const cached = this.tpls.get(pid);
    if (cached && (cached.fromWorld || !mk)) return cached;
    let obj: THREE.Object3D | null = null;
    let fromWorld = false;
    if (mk) { try { obj = mk(pid); fromWorld = true; } catch { obj = null; } }
    if (!obj) obj = fallbackProduct(pid, this.own);
    obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); obj.scale.set(1, 1, 1);
    obj.updateMatrixWorld(true);
    const parts: Part[] = [];
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || m.userData.isOutline || !m.geometry) return;
      parts.push({ geo: m.geometry, mat: m.material, m: m.matrixWorld.clone() });
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      box.union(tmp);
    });
    if (!parts.length || box.isEmpty()) {
      const fb = fallbackProduct(pid, this.own) as THREE.Mesh;
      fb.updateMatrixWorld(true);
      parts.push({ geo: fb.geometry, mat: fb.material, m: new THREE.Matrix4() });
      fb.geometry.computeBoundingBox(); box.copy(fb.geometry.boundingBox!);
      fromWorld = false;
    }
    const tpl: Tpl = { parts, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), fromWorld };
    this.tpls.set(pid, tpl);
    for (const k of [...this.lays.keys()]) if (k.startsWith(pid + '|')) this.lays.delete(k);
    return tpl;
  }

  /** Grade dentro da caixa: 2 camadas de ceil(boxSize/2) itens, deitados com a frente para cima (achatados ficam em pé). */
  layout(pid: string, tpl: Tpl, boxSize: number): Layout {
    const key = `${pid}|${boxSize}`;
    const hit = this.lays.get(key);
    if (hit) return hit;
    const s3 = tpl.size;
    const flat = s3.y <= Math.min(s3.x, s3.z) * 1.05;
    const orient = new THREE.Matrix4();
    let fx = s3.x, fz = s3.z, th = s3.y;
    if (!flat) { orient.makeRotationX(-Math.PI / 2); fz = s3.y; th = s3.z; }
    const per = Math.max(1, Math.ceil(boxSize / 2));
    const iw = BOX_W - 2 * T - 0.03, id = BOX_D - 2 * T - 0.03;
    let cols = 1, rows = per, best = 0;
    for (let c = 1; c <= per; c++) {
      const r = Math.ceil(per / c);
      const s = Math.min(iw / c / Math.max(fx, 1e-3), id / r / Math.max(fz, 1e-3));
      if (s > best) { best = s; cols = c; rows = r; }
    }
    let s = Math.min(best * 0.9, 1.35, (BOX_H * 0.42) / Math.max(th, 1e-3));
    if (!Number.isFinite(s) || s <= 0) s = 0.5;
    const base = new THREE.Matrix4().makeScale(s, s, s).multiply(orient).multiply(new THREE.Matrix4().makeTranslation(-tpl.center.x, -tpl.center.y, -tpl.center.z));
    const cw = iw / cols, cd = id / rows;
    const cells: Layout['cells'] = [];
    for (let i = 0; i < per; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      cells.push({
        x: -iw / 2 + cw * (c + 0.5) + (hash(i, 1) - 0.5) * cw * 0.12,
        z: -id / 2 + cd * (r + 0.5) + (hash(i, 2) - 0.5) * cd * 0.12,
        ry: (hash(i, 3) - 0.5) * 0.26,
      });
    }
    const lay: Layout = { cols, rows, per, cells, base, thick: th * s };
    this.lays.set(key, lay);
    return lay;
  }

  dispose(): void {
    for (const o of this.own) o.dispose();
    this.own.length = 0;
    this.tpls.clear(); this.lays.clear();
  }
}

/* ---------------- caixa de papelão ---------------- */
const ease = (t: number): number => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4();

export class CartonView {
  readonly root = new THREE.Group();
  private readonly flaps: { pivot: THREE.Group; inner: boolean }[] = [];
  private readonly labelMesh: THREE.Mesh;
  private readonly items = new THREE.Group();
  private inst: THREE.InstancedMesh[] = [];
  private pid = '';
  private shown = -1;
  private ref: object | null = null;
  open01 = 0;
  private target = 0;

  constructor(private readonly kit: CartonKit, private readonly tpls: ProductTemplates) {
    const g = geos();
    this.root.add(new THREE.Mesh(g.body, kit.body));
    const W = BOX_W, H = BOX_H, D = BOX_D;
    const mk = (geo: THREE.BufferGeometry, x: number, y: number, z: number, flipY: boolean, inner: boolean, tape: boolean): void => {
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.position.set(x, y, z);
      pivot.rotation.y = flipY ? Math.PI : 0;
      pivot.add(new THREE.Mesh(geo, kit.body));
      if (tape) pivot.add(new THREE.Mesh(g.tape, kit.tape));
      this.root.add(pivot);
      this.flaps.push({ pivot, inner });
    };
    mk(g.outer, 0, H / 2, D / 2, false, false, true);
    mk(g.outer, 0, H / 2, -D / 2, true, false, true);
    mk(g.inner, -W / 2 + T, H / 2 - FT, 0, false, true, false);
    mk(g.inner, W / 2 - T, H / 2 - FT, 0, true, true, false);
    this.labelMesh = new THREE.Mesh(g.label, kit.body);
    this.labelMesh.position.set(0, -0.025, D / 2 + 0.0015);
    this.root.add(this.labelMesh, this.items);
    this.applyFlaps();
    if (kit.held) markHeld(this.root);
  }

  get animating(): boolean { return Math.abs(this.open01 - this.target) > 1e-3; }

  /** Produtos visíveis dentro (0 se fechada). */
  itemCount(): number { return this.items.visible ? (this.inst[0]?.count ?? 0) : 0; }

  /** Atualiza produto/unidades/abertura. Mesma caixa (`ref`) e `open` mudou → anima; caixa nova → sem animação. */
  set(ref: object, pid: string, units: number, open: boolean): void {
    const fresh = ref !== this.ref;
    this.ref = ref;
    this.target = open ? 1 : 0;
    if (fresh) this.open01 = this.target;
    if (pid !== this.pid) {
      this.pid = pid;
      this.labelMesh.material = this.kit.label(pid);
      this.rebuildItems();
    }
    if (units !== this.shown) this.placeItems(units);
    if (fresh) this.applyFlaps();
  }

  private rebuildItems(): void {
    for (const m of this.inst) { this.items.remove(m); m.dispose(); }
    this.inst = [];
    const tpl = this.tpls.get(this.pid);
    let size = 12;
    try { size = productById(this.pid).boxSize; } catch { /* */ }
    const cap = Math.max(1, Math.ceil(size / 2)) * 2;
    for (const p of tpl.parts) {
      const mat = Array.isArray(p.mat) ? p.mat.map((x) => this.kit.item(x)) : this.kit.item(p.mat);
      const im = new THREE.InstancedMesh(p.geo, mat, cap);
      im.count = 0;
      im.frustumCulled = false;
      this.inst.push(im);
      this.items.add(im);
    }
    if (this.kit.held) markHeld(this.items);
    this.shown = -1;
  }

  private placeItems(units: number): void {
    this.shown = units;
    if (!this.pid) return;
    const tpl = this.tpls.get(this.pid);
    let size = 12;
    try { size = productById(this.pid).boxSize; } catch { /* */ }
    const lay = this.tpls.layout(this.pid, tpl, size);
    const n = Math.max(0, Math.min(units, lay.per * 2));
    const nLow = n > lay.per ? lay.per : 0, nTop = n - nLow;
    const bottom = -BOX_H / 2 + T;
    const layers = nLow ? 2 : n ? 1 : 0;
    const avail = Math.max(0, BOX_H - T - 0.03 - lay.thick * layers);
    const yLow = bottom + lay.thick / 2 + avail * Math.min(1, units / Math.max(1, size));
    let k = 0;
    const put = (cellIdx: number, y: number): void => {
      const c = lay.cells[cellIdx]!;
      _m.makeTranslation(c.x, y, c.z).multiply(_r.makeRotationY(c.ry)).multiply(lay.base);
      for (let pi = 0; pi < this.inst.length; pi++) this.inst[pi]!.setMatrixAt(k, _t.multiplyMatrices(_m, tpl.parts[pi]!.m));
      k++;
    };
    for (let i = 0; i < nLow; i++) put(i, yLow);
    for (let i = 0; i < nTop; i++) put(i, nLow ? yLow + lay.thick : yLow);
    for (const im of this.inst) { im.count = k; im.instanceMatrix.needsUpdate = true; }
  }

  private applyFlaps(): void {
    const o = this.open01;
    const a = OPEN_OUTER * ease(o / 0.65), b = OPEN_INNER * ease((o - 0.35) / 0.65);
    for (const f of this.flaps) {
      if (f.inner) f.pivot.rotation.z = b; else f.pivot.rotation.x = a;
    }
    this.items.visible = o > 0.2;
  }

  update(dt: number): void {
    if (!this.animating) return;
    const step = dt / OPEN_TIME;
    this.open01 = this.target > this.open01 ? Math.min(this.target, this.open01 + step) : Math.max(this.target, this.open01 - step);
    this.applyFlaps();
  }

  dispose(): void {
    for (const m of this.inst) m.dispose();
    this.inst = [];
    this.root.removeFromParent();
  }
}

/* ---------------- mão: pilha, carrinho, esfregão ---------------- */
export interface HeldBox { ref: object; pid: string; units: number; open: boolean }
export interface HeldState {
  boxes: HeldBox[];
  dolly: boolean;
  hideTop: boolean;
  walk: number; // 0..1
  lookYaw: number; // delta de olhar do quadro (rad)
  lookPitch: number;
  reduce: boolean;
  mop: number | null; // progresso 0..1 da animação de limpar
}

export class HeldView {
  readonly rig = new THREE.Group();
  private readonly hold = new THREE.Group();
  private readonly stack = new THREE.Group();
  private readonly cartons: CartonView[] = [];
  private readonly dolly = new THREE.Group();
  private readonly rails: THREE.Mesh[] = [];
  private readonly grips: THREE.Mesh[] = [];
  private readonly mop = new THREE.Group();
  private readonly mopStick: THREE.Mesh;
  private readonly mopHead = new THREE.Group();
  readonly kit = new CartonKit(true);
  private raise = 1;
  private topRef: object | null = null;
  private lower = 0;
  private bob = 0;
  private sx = 0;
  private sy = 0;
  private t = 0;
  private readonly a = new THREE.Vector3();
  private readonly h = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly tpls: ProductTemplates) {
    this.rig.name = 'player-hands';
    this.rig.renderOrder = 1000;
    this.hold.position.set(0, -0.47, -0.64);
    this.stack.rotation.x = 0.62;
    this.stack.scale.setScalar(1.08);
    this.hold.add(this.stack);
    this.stack.add(this.dolly);
    const g = geos();
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(g.rail, this.kit.metal);
      r.position.set(sx * (BOX_W / 2 + 0.02), 0, BOX_D / 2 + 0.03);
      const gr = new THREE.Mesh(g.grip, this.kit.red);
      gr.position.set(sx * (BOX_W / 2 + 0.07), 0, BOX_D / 2 + 0.03);
      this.rails.push(r); this.grips.push(gr);
      this.dolly.add(r, gr);
    }
    this.dolly.visible = false;
    this.mopStick = new THREE.Mesh(g.stick, this.kit.mopStick);
    const head = new THREE.Mesh(g.head, this.kit.mopHead);
    const fringe = new THREE.Mesh(g.fringe, this.kit.mopFringe);
    fringe.position.y = -0.035;
    this.mopHead.add(head, fringe);
    this.mop.add(this.mopStick, this.mopHead);
    this.mop.visible = false;
    this.rig.add(this.hold, this.mop);
    markHeld(this.rig);
    scene.add(this.rig);
  }

  /** Caixas visíveis (para testes). */
  info(): { visible: boolean; boxes: number; open: number[]; items: number; dolly: boolean; mop: boolean } {
    const vis = this.cartons.filter((c) => c.root.visible && c.root.parent);
    return {
      visible: this.rig.visible, boxes: vis.length, open: vis.map((c) => +c.open01.toFixed(2)), dolly: this.dolly.visible, mop: this.mop.visible,
      items: vis.reduce((a, c) => a + c.itemCount(), 0),
    };
  }

  /** Alguma aba ainda animando? */
  busy(): boolean { return this.cartons.some((c) => c.root.parent && c.animating); }

  update(cam: THREE.Camera, dt: number, s: HeldState): void {
    this.t += dt;
    const n = s.boxes.length;
    while (this.cartons.length < n) this.cartons.push(new CartonView(this.kit, this.tpls));
    for (let i = 0; i < this.cartons.length; i++) {
      const c = this.cartons[i]!;
      const b = s.boxes[i];
      if (!b) { if (c.root.parent) this.stack.remove(c.root); continue; }
      if (!c.root.parent) this.stack.add(c.root);
      c.set(b.ref, b.pid, b.units, b.open);
      c.update(dt);
      const below = n - 1 - i;
      c.root.position.set(0, -below * (BOX_H + 0.006), 0);
      c.root.rotation.y = below ? (hash(i, 7) - 0.5) * 0.1 : 0;
      c.root.visible = !(s.hideTop && i === n - 1);
    }
    // caixa nova no topo: sobe de baixo da tela
    const top = s.boxes[n - 1]?.ref ?? null;
    if (top !== this.topRef) { if (top) this.raise = 0; this.topRef = top; }
    this.raise = Math.min(1, this.raise + dt / 0.2);
    // carrinho: trilhos laterais da base até acima do topo
    this.dolly.visible = s.dolly && n > 0;
    if (this.dolly.visible) {
      const y0 = -(n - 1) * (BOX_H + 0.006) - BOX_H / 2 - 0.25, y1 = BOX_H / 2 + 0.14;
      for (const r of this.rails) { r.scale.y = y1 - y0; r.position.y = (y0 + y1) / 2; }
      for (const gr of this.grips) gr.position.y = y1;
    }
    // esfregão
    const mopOn = s.mop !== null;
    this.lower += ((mopOn ? 1 : 0) - this.lower) * (1 - Math.exp(-dt * 14));
    this.mop.visible = mopOn;
    if (mopOn) this.animateMop(s.mop ?? 0, s.reduce);
    // balanço (desligado com reduceMotion)
    const walk = s.reduce ? 0 : s.walk;
    this.bob += dt * 8.5 * walk;
    const tx = s.reduce ? 0 : Math.max(-0.05, Math.min(0.05, s.lookYaw * 0.9));
    const ty = s.reduce ? 0 : Math.max(-0.05, Math.min(0.05, -s.lookPitch * 0.9));
    const k = 1 - Math.exp(-dt * 10);
    this.sx += (tx - this.sx) * k; this.sy += (ty - this.sy) * k;
    const breathe = s.reduce ? 0 : Math.sin(this.t * 1.7) * 0.003;
    const r = ease(this.raise);
    this.hold.position.set(
      Math.sin(this.bob) * 0.008 * walk + this.sx,
      -0.47 + Math.abs(Math.cos(this.bob)) * -0.008 * walk + breathe + this.sy - (1 - r) * 0.32 - this.lower * 0.5,
      -0.64,
    );
    this.rig.position.copy(cam.position);
    this.rig.quaternion.copy(cam.quaternion);
    this.rig.visible = n > 0 || mopOn;
  }

  private animateMop(p: number, reduce: boolean): void {
    const inn = ease(p / 0.12), out = ease((1 - p) / 0.12);
    const drop = (1 - Math.min(inn, out)) * 0.55;
    const ph = p * Math.PI * 2 * 3.2;
    const amp = reduce ? 0.05 : 0.11;
    this.a.set(0.3, -0.25 - drop, -0.36);
    this.h.set(Math.sin(ph) * amp, -0.62 - drop, -0.92 + Math.cos(ph * 2) * 0.025);
    this.mopHead.position.copy(this.h);
    this.mopHead.rotation.set(0.25, Math.sin(ph) * 0.22, 0);
    this.dir.subVectors(this.a, this.h);
    const len = this.dir.length();
    this.mopStick.position.addVectors(this.a, this.h).multiplyScalar(0.5);
    this.mopStick.quaternion.setFromUnitVectors(this.up, this.dir.multiplyScalar(1 / Math.max(1e-6, len)));
    this.mopStick.scale.set(1, len, 1);
  }

  dispose(): void {
    for (const c of this.cartons) c.dispose();
    this.rig.removeFromParent();
    this.kit.dispose();
  }
}

/** Libera geometrias e texturas compartilhadas (fim do módulo). */
export function disposeShared(): void {
  if (G) { for (const g of Object.values(G)) (g as THREE.BufferGeometry).dispose(); G = null; }
  labelTex.forEach((t) => t.dispose());
  labelTex.clear();
}
