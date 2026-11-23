/**
 * Setas do tutorial: seta 3D amarela (malha simples, reaproveitada) quicando sobre o alvo e seta verde na borda da
 * tela quando o alvo está fora de vista. Alvos vêm de `world.poi` (fallback calculado pelo layout).
 */
import * as THREE from 'three';
import { FURNITURE_FOOTPRINT, deliveryZone, doorPos, storeBounds, trashBinPos } from '../core/layout';
import type { GameContext } from '../core/module';
import { addOutline } from '../core/outline';
import { h } from './dom';

export type PoiKind = 'computer' | 'sign' | 'delivery' | 'trash' | 'storageDoor' | 'counter' | 'furniture';

export class Guide {
  private arrow = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private mat = new THREE.MeshBasicMaterial({ color: 0xffd21f });
  private edge: HTMLElement;
  private target = new THREE.Vector3();
  private has = false;
  private t = 0;
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private rel = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(private ctx: GameContext, layer: HTMLElement, private reduceMotion: () => boolean) {
    const cone = new THREE.ConeGeometry(0.24, 0.36, 18);
    const shaft = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 14);
    this.geos.push(cone, shaft);
    const head = new THREE.Mesh(cone, this.mat);
    head.rotation.x = Math.PI; // ponta para baixo, em y = 0
    head.position.y = 0.18;
    const body = new THREE.Mesh(shaft, this.mat);
    body.position.y = 0.36 + 0.2;
    this.arrow.add(head, body);
    addOutline(this.arrow, 0xd6401a, 0.028);
    this.arrow.traverse((o) => { o.raycast = () => {}; o.renderOrder = 5; });
    this.arrow.visible = false;
    this.arrow.name = 'ui-guide-arrow';
    ctx.scene.add(this.arrow);
    this.edge = h('div', { class: 'edge-arrow', 'aria-hidden': 'true',
      html: '<svg viewBox="0 0 46 46" width="46" height="46"><circle cx="23" cy="23" r="20" fill="rgba(20,30,44,.55)"/><path d="M14 11l20 12-20 12 5-12z" fill="#2fdc4a" stroke="#0e6b22" stroke-width="2.5" stroke-linejoin="round"/></svg>' });
    layer.appendChild(this.edge);
  }

  /** Ponto de interesse em coordenadas de mundo (world.poi; senão, calculado pelo layout). */
  poi(kind: PoiKind, id?: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const w = this.ctx.services.world;
    try {
      const p = w?.poi?.(kind, id);
      if (p) return out.copy(p);
    } catch { /* world em desenvolvimento */ }
    const s = this.ctx.state;
    const b = storeBounds(s.expansion);
    const furnCenter = (fid?: number, type?: string): THREE.Vector3 | null => {
      const f = s.furniture.find((x) => (fid !== undefined ? x.id === fid : x.type === type));
      if (!f) return null;
      const fp = FURNITURE_FOOTPRINT[f.type];
      const rotated = f.rot === 90 || f.rot === 270;
      const wd = rotated ? fp.d : fp.w, dd = rotated ? fp.w : fp.d;
      return out.set(f.x + wd / 2, f.type === 'counter' ? 1.3 : 1.9, f.z + dd / 2);
    };
    switch (kind) {
      case 'computer': case 'counter': return furnCenter(kind === 'counter' ? id : undefined, 'counter');
      case 'furniture': return furnCenter(id);
      case 'sign': { const d = doorPos(b); return out.set(d.x + 1.3, 2.2, d.z); }
      case 'delivery': { const z = deliveryZone(b); return out.set(z.x + z.w / 2, 0.9, z.z + z.d / 2); }
      case 'trash': { const t = trashBinPos(b); return out.set(t.x, 1.3, t.z); }
      case 'storageDoor': return out.set(b.width / 2, 1.9, 0);
      default: return null;
    }
  }

  set(p: THREE.Vector3 | null): void {
    this.has = !!p;
    if (p) this.target.copy(p);
  }

  update(dt: number, show: boolean, edgeOnly = false): void {
    const vis = show && this.has;
    this.arrow.visible = vis && !edgeOnly;
    if (!vis) { this.edge.style.display = 'none'; return; }
    this.t += dt;
    const bob = this.reduceMotion() ? 0 : Math.sin(this.t * 3.2) * 0.12;
    const baseY = this.target.y < 0.5 ? 1.05 : this.target.y + 0.2;
    this.arrow.position.set(this.target.x, baseY + bob, this.target.z);
    if (!this.reduceMotion()) this.arrow.rotation.y += dt * 1.6;
    this.placeEdge();
  }

  /** Seta verde na borda quando o alvo está fora da tela (ou atrás da câmera). */
  private placeEdge(): void {
    const cam = this.ctx.camera;
    this.tmp.copy(this.target);
    this.tmp.y = Math.max(this.tmp.y, 0.8);
    this.v.copy(this.tmp).project(cam);
    cam.getWorldDirection(this.fwd);
    const front = this.rel.copy(this.tmp).sub(cam.position).dot(this.fwd) > 0;
    let x = this.v.x, y = this.v.y;
    if (front && Math.abs(x) < 0.92 && Math.abs(y) < 0.88) { this.edge.style.display = 'none'; return; }
    if (!front) { x = -x; y = -y; if (Math.abs(x) + Math.abs(y) < 1e-3) y = -1; }
    const W = window.innerWidth, H = window.innerHeight;
    const dx = x * W / 2, dy = -y * H / 2;
    const top = 92, bottom = 70, side = 34;
    const hw = W / 2 - side, hh = Math.max(40, Math.min(H / 2 - top, H / 2 - bottom));
    const k = Math.min(hw / Math.max(1e-3, Math.abs(dx)), hh / Math.max(1e-3, Math.abs(dy)));
    const px = W / 2 + dx * k, py = H / 2 + dy * k;
    const ang = Math.atan2(dy, dx);
    this.edge.style.display = 'block';
    this.edge.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) rotate(${ang.toFixed(3)}rad)`;
  }

  dispose(): void {
    this.ctx.scene.remove(this.arrow);
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
    this.edge.remove();
  }
}
