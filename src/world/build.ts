/**
 * Modo construção: câmera aérea própria, grade, fantasma do móvel (verde/vermelho), arrastar, girar, confirmar, vender, cancelar.
 * Protocolo de câmera: ao iniciar emite 'camera:override' {active:true}; ao terminar emite 'camera:override' {active:false} e 'build:end'.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/module';
import { FURNITURE_FOOTPRINT, STORAGE_DEPTH, doorX, DOOR_WIDTH, type Bounds, type FurnitureType } from '../core/layout';
import type { Furniture } from '../sim/state';
import * as api from '../sim/api';
import { productById } from '../sim/catalog';
import type { FurnitureView } from './furniture';

type Rot = 0 | 90 | 180 | 270;

export interface BuildDeps {
  ctx: GameContext;
  root: THREE.Group;
  bounds(): Bounds;
  storageUnlocked(): boolean;
  furniture(): readonly Furniture[];
  buildModel(f: Furniture, fraction: number): FurnitureView;
  hide(id: number | null): void;
}

const brl = (c: number): string => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const errMsg = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('NOT_IMPLEMENTED') ? 'Ainda indisponível nesta versão.' : m;
};
const NAMES: Record<FurnitureType, string> = {
  shelf: 'Prateleira', fridge: 'Geladeira', freezer: 'Freezer', counter: 'Balcão de caixa', rack: 'Rack de depósito', decor: 'Decoração',
};

export class BuildMode {
  active = false;
  private mode: 'buy' | 'edit' = 'buy';
  private type: FurnitureType = 'shelf';
  private productId: string | undefined;
  private editId = 0;
  private x = 0; private z = 0; private rot: Rot = 0;
  private valid = false;
  private apiBroken = false;
  private cost: number | null = null;
  private variant: string | undefined;

  private ghost: THREE.Group | null = null;
  private foot: THREE.Mesh | null = null;
  private grid: THREE.LineSegments | null = null;
  private okMat = new THREE.MeshStandardMaterial({ color: 0x4cd964, transparent: true, opacity: 0.6, emissive: 0x1f8f35, emissiveIntensity: 0.6, depthWrite: false });
  private badMat = new THREE.MeshStandardMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.6, emissive: 0x9b1c1c, emissiveIntensity: 0.6, depthWrite: false });
  private footOk = new THREE.MeshBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.4, depthWrite: false });
  private footBad = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.4, depthWrite: false });

  // câmera
  private target = new THREE.Vector3(); private look = new THREE.Vector3();
  private dist = 24; private yaw = 0; private elev = 1.08;
  private ray = new THREE.Raycaster(); private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2(); private hit = new THREE.Vector3(); private hit2 = new THREE.Vector3();
  private wanted = new THREE.Vector3();
  private ptrs = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; mode: 'ghost' | 'pan' | 'two'; ox: number; oz: number; moved: boolean }>();
  private pinch = { d: 0, a: 0, acc: 0 };

  // UI
  private ui: HTMLDivElement | null = null;
  private info: HTMLDivElement | null = null;
  private offs: (() => void)[] = [];

  constructor(private d: BuildDeps) {}

  /* ---------- ciclo de vida ---------- */
  start(type: FurnitureType, productId?: string, variant?: string): void {
    this.end(false);
    this.mode = 'buy'; this.type = type; this.rot = 0;
    // decor: o 'productId' do evento é a variante visual (mesma convenção de api.buyFurniture)
    this.variant = type === 'decor' ? (variant ?? productId) : variant;
    this.productId = type === 'decor' ? undefined : productId;
    this.begin();
    this.cost = null;
    try { this.cost = api.furnitureCatalog().find((s) => s.type === type)?.cost ?? null; } catch { /* sim ainda não pronto */ }
    // posição inicial: centro do salão
    const b = this.d.bounds();
    const fp = this.footprint();
    this.x = Math.round(b.width / 2 - fp.w / 2) + 2; this.z = Math.round(b.depth / 2 - fp.d / 2);
    if (type === 'rack' && this.d.storageUnlocked()) { this.x = Math.round(b.width / 2 - fp.w / 2) + 2; this.z = -Math.round(STORAGE_DEPTH / 2 + fp.d / 2); }
    this.rebuildGhost(); this.refresh();
  }

  edit(id: number): void {
    const f = this.d.furniture().find((x) => x.id === id);
    if (!f) return;
    this.end(false);
    this.mode = 'edit'; this.editId = id; this.type = f.type; this.productId = f.productId; this.variant = f.variant;
    this.x = f.x; this.z = f.z; this.rot = f.rot; this.cost = null;
    this.d.hide(id);
    this.begin();
    this.rebuildGhost(); this.refresh();
  }

  private begin(): void {
    const { ctx } = this.d;
    this.active = true;
    ctx.bus.emit('camera:override', { active: true });
    this.makeGrid();
    // câmera aérea
    const b = this.d.bounds();
    const zBack = this.d.storageUnlocked() ? -STORAGE_DEPTH : 0;
    this.target.set(b.width / 2, 0, (zBack + b.depth) / 2 + 0.5);
    this.look.copy(this.target);
    this.yaw = 0;
    const fov = THREE.MathUtils.degToRad(ctx.camera.fov), asp = Math.max(0.5, ctx.camera.aspect);
    const t = Math.tan(fov / 2);
    const need = Math.max((b.width / 2 + 1.5) / (t * asp), ((b.depth - zBack) / 2 * Math.sin(this.elev) + 2.5) / t);
    this.dist = THREE.MathUtils.clamp(need * 1.12, 10, 70);
    this.attach();
    this.buildUi();
  }

  /** Encerra o modo. `emit` = false quando só reiniciamos (ex.: novo build:start). */
  end(emit = true): void {
    if (!this.active) return;
    this.active = false;
    this.detach();
    this.d.hide(null);
    this.clearGhost();
    if (this.grid) { this.d.root.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); this.grid = null; }
    this.ui?.remove(); this.ui = null; this.info = null;
    this.ptrs.clear();
    if (emit) {
      this.d.ctx.bus.emit('camera:override', { active: false });
      this.d.ctx.bus.emit('build:end');
    }
  }

  dispose(): void {
    this.end(true);
    this.okMat.dispose(); this.badMat.dispose(); this.footOk.dispose(); this.footBad.dispose();
  }

  /* ---------- geometria / validação ---------- */
  private footprint(): { w: number; d: number } {
    const fp = FURNITURE_FOOTPRINT[this.type];
    return this.rot === 90 || this.rot === 270 ? { w: fp.d, d: fp.w } : { w: fp.w, d: fp.d };
  }

  /** Validador local usado só quando api.canPlace ainda não existe (NOT_IMPLEMENTED). */
  private localCanPlace(): boolean {
    const b = this.d.bounds(); const fp = this.footprint();
    const stor = this.d.storageUnlocked();
    const inHall = this.x >= 0 && this.z >= 0 && this.x + fp.w <= b.width && this.z + fp.d <= b.depth;
    const inStor = stor && this.x >= 0 && this.x + fp.w <= b.width && this.z >= -STORAGE_DEPTH && this.z + fp.d <= 0;
    if (!inHall && !inStor) return false;
    const dx0 = doorX(b) - DOOR_WIDTH / 2, dx1 = doorX(b) + DOOR_WIDTH / 2;
    if (inHall && this.z + fp.d > b.depth - 2 && this.x < dx1 && this.x + fp.w > dx0) return false;
    for (const o of this.d.furniture()) {
      if (this.mode === 'edit' && o.id === this.editId) continue;
      const of = FURNITURE_FOOTPRINT[o.type]; const ow = o.rot === 90 || o.rot === 270 ? of.d : of.w, od = o.rot === 90 || o.rot === 270 ? of.w : of.d;
      if (this.x < o.x + ow && this.x + fp.w > o.x && this.z < o.z + od && this.z + fp.d > o.z) return false;
    }
    return true;
  }

  private validate(): void {
    let ok: boolean;
    try {
      ok = api.canPlace(this.d.ctx.state, this.type, this.x, this.z, this.rot, this.mode === 'edit' ? this.editId : undefined);
      this.apiBroken = false;
    } catch {
      this.apiBroken = true;
      ok = this.localCanPlace();
    }
    this.valid = ok;
  }

  private rebuildGhost(): void {
    this.clearGhost();
    const f: Furniture = { id: -1, type: this.type, x: this.x, z: this.z, rot: this.rot, productId: this.productId, variant: this.variant };
    const view = this.d.buildModel(f, 0);
    view.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.material = this.okMat; }
    });
    const holder = new THREE.Group();
    holder.add(view.group);
    this.ghost = holder; this.d.root.add(holder);
    const fg = new THREE.PlaneGeometry(1, 1); fg.rotateX(-Math.PI / 2);
    this.foot = new THREE.Mesh(fg, this.footOk);
    this.foot.renderOrder = 5;
    this.d.root.add(this.foot);
  }

  private clearGhost(): void {
    if (this.ghost) {
      this.ghost.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
      this.d.root.remove(this.ghost); this.ghost = null;
    }
    if (this.foot) { this.d.root.remove(this.foot); this.foot.geometry.dispose(); this.foot = null; }
  }

  /** Reposiciona fantasma, revalida e atualiza a UI. */
  private refresh(): void {
    this.validate();
    if (!this.ghost || !this.foot) return;
    const fp = this.footprint();
    const cx = this.x + fp.w / 2, cz = this.z + fp.d / 2;
    this.ghost.position.set(cx, 0.02, cz);
    this.ghost.rotation.y = (this.rot * Math.PI) / 180;
    this.foot.position.set(cx, 0.045, cz);
    this.foot.scale.set(fp.w, 1, fp.d);
    const mat = this.valid ? this.okMat : this.badMat;
    this.ghost.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mat; });
    this.foot.material = this.valid ? this.footOk : this.footBad;
    this.updateInfo();
  }

  private makeGrid(): void {
    const b = this.d.bounds();
    const zBack = this.d.storageUnlocked() ? -STORAGE_DEPTH : 0;
    const pts: number[] = [];
    for (let x = 0; x <= b.width; x++) pts.push(x, 0.035, zBack, x, 0.035, b.depth);
    for (let z = zBack; z <= b.depth; z++) pts.push(0, 0.035, z, b.width, 0.035, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }));
    this.grid.renderOrder = 4;
    this.d.root.add(this.grid);
  }

  /* ---------- ações ---------- */
  rotate(): void {
    if (!this.active) return;
    const fp0 = this.footprint();
    const cx = this.x + fp0.w / 2, cz = this.z + fp0.d / 2;
    this.rot = (((this.rot + 90) % 360) as Rot);
    const fp = this.footprint();
    this.x = Math.round(cx - fp.w / 2); this.z = Math.round(cz - fp.d / 2);
    this.rebuildGhost(); this.refresh();
    this.d.ctx.bus.emit('sfx', { name: 'pop' });
  }

  confirm(): void {
    if (!this.active) return;
    const { ctx } = this.d;
    try {
      if (this.mode === 'buy') {
        api.buyFurniture(ctx.state, this.type, this.x, this.z, this.rot, this.type === 'decor' ? this.variant : this.productId);
        ctx.bus.emit('toast', { text: `${NAMES[this.type]} comprada!`, kind: 'good' });
        ctx.bus.emit('sfx', { name: 'buy' });
      } else {
        api.moveFurniture(ctx.state, this.editId, this.x, this.z, this.rot);
        ctx.bus.emit('toast', { text: `${NAMES[this.type]} movida.`, kind: 'info' });
        ctx.bus.emit('sfx', { name: 'pop' });
      }
      ctx.bus.emit('stateChanged', { what: 'furniture' });
      this.end(true);
    } catch (e) {
      ctx.bus.emit('toast', { text: errMsg(e), kind: 'bad' });
      ctx.bus.emit('sfx', { name: 'error' });
    }
  }

  sell(): void {
    if (!this.active || this.mode !== 'edit') return;
    const { ctx } = this.d;
    try {
      const got = api.sellFurniture(ctx.state, this.editId);
      ctx.bus.emit('toast', { text: `${NAMES[this.type]} vendida por ${brl(got)}.`, kind: 'info' });
      ctx.bus.emit('sfx', { name: 'coin' });
      ctx.bus.emit('stateChanged', { what: 'furniture' });
      this.end(true);
    } catch (e) {
      ctx.bus.emit('toast', { text: errMsg(e), kind: 'bad' });
      ctx.bus.emit('sfx', { name: 'error' });
    }
  }

  cancel(): void { this.end(true); }

  /** Testes: posiciona o fantasma diretamente. */
  setPose(x: number, z: number, rot?: Rot): void {
    if (!this.active) return;
    if (rot !== undefined && rot !== this.rot) { this.rot = rot; this.rebuildGhost(); }
    this.x = x; this.z = z; this.refresh();
  }
  /** Distância da câmera ao alvo (zoom do modo construção) — testes. */
  get camDist(): number { return this.dist; }
  /** Posição do fantasma na tela (px) — testes de toque. */
  ghostScreen(): { x: number; y: number } {
    const fp = this.footprint();
    const v = new THREE.Vector3(this.x + fp.w / 2, 0.4, this.z + fp.d / 2).project(this.d.ctx.camera);
    const r = this.d.ctx.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }
  get pose(): { x: number; z: number; rot: Rot; valid: boolean; type: FurnitureType; mode: string } {
    return { x: this.x, z: this.z, rot: this.rot, valid: this.valid, type: this.type, mode: this.mode };
  }

  /* ---------- câmera ---------- */
  update(dt: number): void {
    if (!this.active) return;
    const cam = this.d.ctx.camera;
    const ce = Math.cos(this.elev), se = Math.sin(this.elev);
    this.wanted.set(this.target.x + Math.sin(this.yaw) * ce * this.dist, se * this.dist, this.target.z + Math.cos(this.yaw) * ce * this.dist);
    const k = 1 - Math.exp(-dt * 7);
    cam.position.lerp(this.wanted, k);
    this.look.lerp(this.target, k);
    cam.lookAt(this.look);
    if (this.foot) (this.foot.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.12 * Math.sin(performance.now() / 220);
  }

  private clampTarget(): void {
    const b = this.d.bounds();
    const zBack = this.d.storageUnlocked() ? -STORAGE_DEPTH : 0;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -2, b.width + 2);
    this.target.z = THREE.MathUtils.clamp(this.target.z, zBack - 2, b.depth + 5);
  }

  private groundAt(cx: number, cy: number, out: THREE.Vector3): boolean {
    const el = this.d.ctx.renderer.domElement;
    const r = el.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.d.ctx.camera);
    return this.ray.ray.intersectPlane(this.plane, out) !== null;
  }

  private snapGhostTo(cx: number, cz: number): void {
    const fp = this.footprint();
    const nx = Math.round(cx - fp.w / 2), nz = Math.round(cz - fp.d / 2);
    const b = this.d.bounds();
    const zBack = this.d.storageUnlocked() ? -STORAGE_DEPTH : 0;
    const x = THREE.MathUtils.clamp(nx, 0, Math.max(0, b.width - fp.w));
    const z = THREE.MathUtils.clamp(nz, zBack, Math.max(zBack, b.depth - fp.d));
    if (x !== this.x || z !== this.z) { this.x = x; this.z = z; this.refresh(); }
  }

  /* ---------- entrada ---------- */
  private attach(): void {
    const el = this.d.ctx.renderer.domElement;
    el.style.touchAction = 'none';
    const down = (e: PointerEvent): void => {
      if (!this.active) return;
      el.setPointerCapture?.(e.pointerId);
      const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), mode: 'pan' as 'ghost' | 'pan' | 'two', ox: 0, oz: 0, moved: false };
      if (this.ptrs.size === 0 && this.groundAt(e.clientX, e.clientY, this.hit)) {
        const fp = this.footprint();
        const cx = this.x + fp.w / 2, cz = this.z + fp.d / 2;
        if (Math.abs(this.hit.x - cx) <= fp.w / 2 + 0.6 && Math.abs(this.hit.z - cz) <= fp.d / 2 + 0.6) {
          p.mode = 'ghost'; p.ox = cx - this.hit.x; p.oz = cz - this.hit.z;
        }
      }
      this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        for (const q of this.ptrs.values()) q.mode = 'two';
        this.pinch.d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.pinch.a = Math.atan2(b!.y - a!.y, b!.x - a!.x); this.pinch.acc = 0;
      }
      e.preventDefault();
    };
    const move = (e: PointerEvent): void => {
      const p = this.ptrs.get(e.pointerId);
      if (!p || !this.active) return;
      const px = p.x, py = p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
      if (this.ptrs.size >= 2) {
        const [a, b] = [...this.ptrs.values()];
        const dd = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (this.pinch.d > 0) this.dist = THREE.MathUtils.clamp(this.dist * (this.pinch.d / Math.max(10, dd)), 8, 70);
        this.pinch.d = dd;
        const ang = Math.atan2(b!.y - a!.y, b!.x - a!.x);
        let da = ang - this.pinch.a;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        this.pinch.a = ang; this.pinch.acc += da;
        if (Math.abs(this.pinch.acc) > 0.9) { this.pinch.acc = 0; this.rotate(); }
        return;
      }
      if (p.mode === 'ghost') {
        if (this.groundAt(e.clientX, e.clientY, this.hit)) this.snapGhostTo(this.hit.x + p.ox, this.hit.z + p.oz);
      } else if (p.mode === 'pan' && p.moved) {
        const ok1 = this.groundAt(px, py, this.hit), ok2 = this.groundAt(p.x, p.y, this.hit2);
        if (ok1 && ok2) { this.target.x += this.hit.x - this.hit2.x; this.target.z += this.hit.z - this.hit2.z; this.clampTarget(); }
      }
    };
    const up = (e: PointerEvent): void => {
      const p = this.ptrs.get(e.pointerId);
      this.ptrs.delete(e.pointerId);
      if (!p || !this.active) return;
      if (p.mode === 'pan' && !p.moved && performance.now() - p.t < 400 && this.ptrs.size === 0) {
        if (this.groundAt(e.clientX, e.clientY, this.hit)) this.snapGhostTo(this.hit.x, this.hit.z); // toque coloca o móvel
      }
      if (this.ptrs.size === 1) for (const q of this.ptrs.values()) { q.mode = 'pan'; q.sx = q.x; q.sy = q.y; q.moved = true; }
    };
    const wheel = (e: WheelEvent): void => {
      if (!this.active) return;
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.0012), 8, 70);
    };
    const key = (e: KeyboardEvent): void => {
      if (!this.active) return;
      if (e.key === 'r' || e.key === 'R') { this.rotate(); e.preventDefault(); }
      else if (e.key === 'Enter') { this.confirm(); e.preventDefault(); }
      else if (e.key === 'Escape') { this.cancel(); e.preventDefault(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { this.sell(); e.preventDefault(); }
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    this.offs = [
      () => el.removeEventListener('pointerdown', down), () => el.removeEventListener('pointermove', move),
      () => el.removeEventListener('pointerup', up), () => el.removeEventListener('pointercancel', up),
      () => el.removeEventListener('wheel', wheel), () => window.removeEventListener('keydown', key),
    ];
  }
  private detach(): void { this.offs.forEach((f) => f()); this.offs = []; }

  /* ---------- UI (overlay DOM leve) ---------- */
  private buildUi(): void {
    const root = this.d.ctx.uiRoot;
    const wrap = document.createElement('div');
    wrap.setAttribute('data-world-build', '1');
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;';
    const css = document.createElement('style');
    css.textContent = `
      [data-world-build] .wb-btn{pointer-events:auto;min-width:64px;height:56px;padding:0 16px;border:0;border-radius:16px;font-size:15px;font-weight:700;color:#fff;background:#3b4252;box-shadow:0 3px 10px rgba(0,0,0,.35);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;touch-action:manipulation}
      [data-world-build] .wb-btn small{font-size:11px;font-weight:600;opacity:.8}
      [data-world-build] .wb-btn:active{transform:scale(.96)}
      [data-world-build] .wb-ok{background:#2fa84f}[data-world-build] .wb-bad{background:#d64545}[data-world-build] .wb-sell{background:#c77a1a}
      [data-world-build] .wb-btn[disabled]{opacity:.45}`;
    wrap.appendChild(css);
    this.info = document.createElement('div');
    this.info.style.cssText = 'position:absolute;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:14px;background:rgba(20,24,32,.82);color:#fff;font-size:14px;font-weight:600;text-align:center;max-width:90vw;backdrop-filter:blur(4px)';
    wrap.appendChild(this.info);
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:0;right:0;bottom:calc(14px + env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:0 12px';
    const mk = (label: string, sub: string, cls: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = `wb-btn ${cls}`; b.type = 'button'; b.setAttribute('aria-label', label);
      b.innerHTML = `<span>${label}</span><small>${sub}</small>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      bar.appendChild(b);
      return b;
    };
    mk('Girar', 'R', '', () => this.rotate());
    if (this.mode === 'edit') mk('Vender', 'Del', 'wb-sell', () => this.sell());
    mk('Cancelar', 'Esc', 'wb-bad', () => this.cancel());
    mk('Confirmar', 'Enter', 'wb-ok', () => this.confirm());
    wrap.appendChild(bar);
    root.appendChild(wrap);
    this.ui = wrap;
  }

  private updateInfo(): void {
    if (!this.info) return;
    let label = NAMES[this.type];
    if (this.productId) { try { label += ` - ${productById(this.productId).name}`; } catch { /* */ } }
    const price = this.mode === 'buy' && this.cost !== null ? ` · ${brl(this.cost)}` : '';
    const st = this.valid ? '<span style="color:#7dff9a">posição válida</span>' : '<span style="color:#ff8a8a">posição inválida</span>';
    this.info.innerHTML = `${label}${price}<br><span style="font-weight:500;font-size:12px">${st} · arraste o móvel, toque para posicionar, dois dedos giram</span>`;
  }
}
