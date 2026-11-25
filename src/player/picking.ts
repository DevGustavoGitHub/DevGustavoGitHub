/**
 * Alvos de interação: quando o world ainda não publica `pickGroup`/`highlight`, o player monta proxies invisíveis
 * equivalentes a partir do estado (mesmas regras de PickInfo) e desenha um contorno simples (arestas verdes).
 */
import * as THREE from 'three';
import type { PickInfo, WorldService } from '../core/services';
import { doorX, recycleBinPos, storeBounds, trashBinPos } from '../core/layout';
import type { StoreState } from '../sim/state';
import { furnRect } from './collide';

const FURN_H: Record<string, number> = { shelf: 1.85, fridge: 2.0, freezer: 0.95, counter: 1.05, rack: 2.1, decor: 1.3 };
const BOX_H = 0.34;

/** Local → mundo para um móvel girado (mesma convenção do world: rot 0 frente +z, 90 frente +x). */
export function localToWorld(cx: number, cz: number, rot: number, lx: number, lz: number): { x: number; z: number } {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

/** Sobe na hierarquia até achar `userData.pick`. */
export function pickOf(o: THREE.Object3D | null): { info: PickInfo; obj: THREE.Object3D } | null {
  for (let n = o; n; n = n.parent) {
    const p = n.userData?.pick as PickInfo | undefined;
    if (p && typeof p.kind === 'string') return { info: p, obj: n };
  }
  return null;
}

/** Nó com `userData.pick` (o próprio objeto ou um pai), sem alocar. */
export function pickNode(o: THREE.Object3D | null): THREE.Object3D | null {
  for (let n = o; n; n = n.parent) {
    const p = n.userData?.pick as PickInfo | undefined;
    if (p && typeof p.kind === 'string') return n;
  }
  return null;
}

export class FallbackPicks {
  readonly group = new THREE.Group();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly mat = new THREE.MeshBasicMaterial({ visible: false });
  private readonly pool: THREE.Mesh[] = [];
  private sig = '';

  constructor() { this.group.name = 'player-fallback-picks'; }

  sync(s: StoreState, w: WorldService | undefined): void {
    const counters = w ? w.counters() : [];
    const sig = `${s.expansion}|${s.storageUnlocked}|` + s.furniture.map((f) => `${f.id}:${f.type}:${f.x}:${f.z}:${f.rot}`).join(',') +
      '|' + s.sidewalk.map((b) => (b.carried || b.x == null || b.z == null ? '-' : `${b.x.toFixed(2)},${b.z.toFixed(2)}`)).join(',') +
      '|' + s.dirt.map((d) => `${d.x.toFixed(2)},${d.z.toFixed(2)}`).join(';') + '|' + counters.map((c) => `${c.operator.x},${c.operator.z}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    let n = 0;
    const add = (pick: PickInfo, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): void => {
      let m = this.pool[n];
      if (!m) { m = new THREE.Mesh(this.geo, this.mat); this.pool.push(m); }
      m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(0, ry, 0);
      m.userData.pick = pick;
      if (!m.parent) this.group.add(m);
      n++;
    };
    const b = storeBounds(s.expansion);
    for (const f of s.furniture) {
      const r = furnRect(f);
      const h = FURN_H[f.type] ?? 1.2;
      add({ kind: 'furniture', id: f.id }, (r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0 - 0.06, h, r.z1 - r.z0 - 0.06);
      if (f.type === 'counter') {
        const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
        const pc = localToWorld(cx, cz, f.rot, -0.5, -0.45);
        add({ kind: 'computer' }, pc.x, 1.25, pc.z, 0.5, 0.42, 0.5, (f.rot * Math.PI) / 180);
        const c = counters.find((k) => k.furnitureId === f.id);
        const op = c ? c.operator : localToWorld(cx, cz, f.rot, 0.5, -1.5);
        add({ kind: 'seat', id: f.id }, op.x, 0.5, op.z, 0.55, 1.0, 0.55);
      }
    }
    const placed: { x: number; z: number }[] = [];
    s.sidewalk.forEach((bx, i) => {
      if (bx.carried || bx.x == null || bx.z == null) return;
      let lvl = 0;
      for (const o of placed) if (Math.abs(o.x - bx.x) < 0.3 && Math.abs(o.z - bx.z) < 0.3) lvl++;
      placed.push({ x: bx.x, z: bx.z });
      add({ kind: 'box', id: i }, bx.x, BOX_H / 2 + lvl * BOX_H, bx.z, 0.54, BOX_H, 0.46, bx.rot ?? 0);
    });
    s.dirt.forEach((d, i) => add({ kind: 'dirt', id: i }, d.x, 0.02, d.z, 0.62, 0.04, 0.62));
    const tb = w ? w.trashBin() : trashBinPos(b);
    add({ kind: 'trash' }, tb.x, 0.55, tb.z, 0.75, 1.1, 0.75);
    if (s.upgrades.includes('recycler')) { const rb = w?.recycleBin ? w.recycleBin() : recycleBinPos(b); add({ kind: 'recycle' }, rb.x, 0.55, rb.z, 0.75, 1.1, 0.75); }
    add({ kind: 'sign' }, doorX(b) - 0.5, 1.45, b.depth + 0.1, 0.62, 0.36, 0.14);
    if (!s.storageUnlocked) add({ kind: 'storageDoor' }, doorX(b), 1.1, 0.06, 1.6, 2.2, 0.12);
    for (let i = n; i < this.pool.length; i++) this.pool[i]!.removeFromParent();
    this.group.updateMatrixWorld(true);
  }

  dispose(): void {
    this.group.clear();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Contorno de reserva: arestas verdes em volta da caixa envolvente do alvo (só sem `world.highlight`). */
export class FallbackHighlight {
  private readonly lines: THREE.LineSegments;
  private readonly box = new THREE.Box3();
  private readonly v = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2bd94a, transparent: true, opacity: 0.95 }));
    this.lines.visible = false;
    this.lines.raycast = () => {};
    this.lines.name = 'player-fallback-highlight';
    scene.add(this.lines);
  }

  show(obj: THREE.Object3D | null): void {
    if (!obj) { this.lines.visible = false; return; }
    obj.updateWorldMatrix(true, false);
    this.box.setFromObject(obj);
    if (this.box.isEmpty()) { this.lines.visible = false; return; }
    this.box.expandByScalar(0.03);
    this.box.getCenter(this.lines.position);
    this.box.getSize(this.v);
    this.lines.scale.set(Math.max(0.01, this.v.x), Math.max(0.01, this.v.y), Math.max(0.01, this.v.z));
    this.lines.visible = true;
  }

  setColor(hex: number): void { (this.lines.material as THREE.LineBasicMaterial).color.setHex(hex); }

  dispose(): void {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
