/**
 * Posicionamento em 1ª PESSOA (Fase 3): a prévia segue o ponto onde o raio do centro da câmera cruza o chão.
 * Móveis: grade + fantasma verde/vermelho (api.canPlace). Caixas: prévia ciano/vermelha em ponto livre
 * (api.canDropBox + sem móvel), refletindo aberta/fechada. O jogador continua andando e olhando (sem camera:override).
 * Barra DOM (centro, embaixo, z-index 35): ⟲ COLOCAR ⟳ e CANCELAR (+ VENDER e GUARDAR no modo editar).
 * Eventos: `build:state {active, kind, placed?}` no início e no fim, depois `build:end {kind, placed}`.
 * Início: build:start {type, productId?, variant?, stockIndex?} | build:edit {furnitureId} | build:box {boxIndex}.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from '../core/module';
import { FURNITURE_FOOTPRINT, STORAGE_DEPTH, type Bounds, type FurnitureType } from '../core/layout';
import type { Box, Furniture, StoreState } from '../sim/state';
import * as api from '../sim/api';
import { productById } from '../sim/catalog';
import { chairGeos, furnitureGeos, levelCountOf, SEAT } from './furniture';
import { BOX_D, BOX_W, boxGeometry } from './products';

type Rot = 0 | 90 | 180 | 270;
export type BuildKind = 'furniture' | 'box';

export interface BuildDeps {
  ctx: GameContext;
  root: THREE.Group;
  bounds(): Bounds;
  storageUnlocked(): boolean;
  furniture(): readonly Furniture[];
  /** Esconde o móvel em edição (null mostra todos). */
  hide(id: number | null): void;
  /** Tile andável (grade de navegação: móveis bloqueiam). */
  walkable(x: number, z: number): boolean;
  /** Altura da pilha de caixas no ponto (empilhamento automático < 0,3 m), ignorando `self`. */
  stackHeight(x: number, z: number, self: Box | null): number;
}

const brl = (c: number): string => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const errMsg = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('NOT_IMPLEMENTED') ? 'Ainda indisponível nesta versão.' : m;
};
const NAMES: Record<FurnitureType, string> = {
  shelf: 'Prateleira', fridge: 'Geladeira', freezer: 'Freezer', counter: 'Caixa registradora', rack: 'Estante do depósito', decor: 'Decoração',
};
const FEM: Record<FurnitureType, boolean> = { shelf: true, fridge: true, freezer: false, counter: true, rack: true, decor: true };
/** Para onde foram as unidades expostas ao vender/guardar (diferença do depósito e das caixas novas na calçada). */
interface Moves { storage: number; sidewalk: number; boxes: number }
const stockSnap = (s: StoreState): { storage: Record<string, number>; n: number } => ({ storage: { ...s.storage }, n: s.sidewalk.length });
function stockMoves(b: { storage: Record<string, number>; n: number }, s: StoreState): Moves {
  let storage = 0;
  for (const k of Object.keys(s.storage)) storage += Math.max(0, (s.storage[k] ?? 0) - (b.storage[k] ?? 0));
  const added = s.sidewalk.slice(b.n);
  return { storage, sidewalk: added.reduce((a, x) => a + x.units, 0), boxes: added.length };
}
const un = (n: number): string => `${n} un.`;
/** "17 un. vão para o depósito e 5 un. voltam em 1 caixa na calçada (ENTREGAS)." (`future` = pergunta de confirmação). */
function movesText(m: Moves, future: boolean): string {
  const parts: string[] = [];
  if (m.storage > 0) parts.push(`${un(m.storage)} ${future ? 'vão' : 'foram'} para o depósito`);
  if (m.sidewalk > 0) parts.push(`${un(m.sidewalk)} ${future ? 'voltam' : 'voltaram'} em ${m.boxes} caixa${m.boxes === 1 ? '' : 's'} na calçada (ENTREGAS)`);
  return parts.length ? `${parts.join(' e ')}.` : '';
}
const ghostCache = new Map<string, THREE.BufferGeometry>();
/** Fantasma: todas as geometrias do móvel numa só (1 draw call), cadeira incluída no balcão. */
function ghostGeometry(f: Furniture): THREE.BufferGeometry {
  const key = `${f.type}|${levelCountOf(f)}|${f.variant ?? ''}`; // Fase 4: tábuas = nº de níveis (cores não importam no fantasma)
  let g = ghostCache.get(key);
  if (g) return g;
  const parts: THREE.BufferGeometry[] = [];
  for (const geo of furnitureGeos(f).values()) parts.push(geo.clone());
  if (f.type === 'counter') for (const geo of chairGeos().values()) parts.push(geo.clone().translate(SEAT.x, 0, SEAT.z));
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal') p.deleteAttribute(k);
  g = mergeGeometries(parts, false) ?? new THREE.BoxGeometry(1, 1, 1);
  parts.forEach((p) => p.dispose());
  ghostCache.set(key, g);
  return g;
}

export class BuildMode {
  active = false;
  private kind: BuildKind = 'furniture';
  private mode: 'stock' | 'buy' | 'edit' | 'box' = 'buy';
  private type: FurnitureType = 'shelf';
  private productId: string | undefined;
  private variant: string | undefined;
  private levels: Furniture['levels'];
  private stockIndex = -1;
  private editId = 0;
  private box: Box | null = null;
  private x = 0; private z = 0; private rot: Rot = 0;
  private bx = 0; private bz = 0; private by = 0; private brot = 0;
  private valid = false;
  /** VENDER aguardando confirmação. */
  private asking = false;
  private cost: number | null = null;

  private ghost: THREE.Mesh | null = null;
  private foot: THREE.Mesh | null = null;
  private grid: THREE.LineSegments | null = null;
  private okMat = new THREE.MeshStandardMaterial({ color: 0x4cd964, transparent: true, opacity: 0.55, emissive: 0x1f8f35, emissiveIntensity: 0.7, depthWrite: false });
  private badMat = new THREE.MeshStandardMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.55, emissive: 0x9b1c1c, emissiveIntensity: 0.7, depthWrite: false });
  private boxOk = new THREE.MeshBasicMaterial({ color: 0x18e4ff, transparent: true, opacity: 0.72, depthWrite: false });
  private footOk = new THREE.MeshBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.4, depthWrite: false });
  private footBad = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.4, depthWrite: false });
  private footBox = new THREE.MeshBasicMaterial({ color: 0x18e4ff, transparent: true, opacity: 0.35, depthWrite: false });
  private footGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  private ray = new THREE.Raycaster();
  private dir = new THREE.Vector3(); private org = new THREE.Vector3();
  private pulse = 0;
  private ap = { x: 0, z: 0 };

  private ui: HTMLDivElement | null = null;
  private info: HTMLDivElement | null = null;
  private placeBtn: HTMLButtonElement | null = null;
  private offKey: (() => void) | null = null;

  constructor(private d: BuildDeps) {}

  /* ---------- ciclo de vida ---------- */
  /** Móvel novo: do estoque de montagem (`stockIndex`) ou compra direta (legado). */
  start(p: { type: FurnitureType; productId?: string; variant?: string; stockIndex?: number }): void {
    this.end(false);
    const { ctx } = this.d;
    let type = p.type;
    let variant = type === 'decor' ? (p.variant ?? p.productId) : p.variant;
    this.stockIndex = -1;
    if (p.stockIndex !== undefined && Number.isInteger(p.stockIndex)) {
      this.stockIndex = p.stockIndex;
      try {
        const it = api.furnitureStock(ctx.state)[p.stockIndex];
        if (it) { type = it.type; if (it.variant !== undefined) variant = it.variant; }
      } catch { /* sim antigo */ }
    }
    if (!FURNITURE_FOOTPRINT[type]) return;
    this.kind = 'furniture'; this.mode = this.stockIndex >= 0 ? 'stock' : 'buy';
    this.type = type; this.variant = variant; this.productId = type === 'decor' ? undefined : p.productId; this.levels = undefined;
    this.rot = 0; this.cost = null;
    if (this.mode === 'buy') { try { this.cost = api.furnitureCatalog().find((s) => s.type === type)?.cost ?? null; } catch { /* */ } }
    this.begin();
  }

  edit(id: number): void {
    const f = this.d.furniture().find((x) => x.id === id);
    if (!f) return;
    this.end(false);
    this.kind = 'furniture'; this.mode = 'edit'; this.editId = id;
    this.type = f.type; this.productId = f.productId; this.variant = f.variant; this.levels = f.levels;
    this.x = f.x; this.z = f.z; this.rot = f.rot; this.cost = null;
    this.d.hide(id);
    this.begin();
  }

  /** Largar a caixa carregada `boxIndex` (state.sidewalk) com prévia. */
  startBox(boxIndex: number): void {
    const b = this.d.ctx.state.sidewalk[boxIndex];
    if (!b) return;
    this.end(false);
    this.kind = 'box'; this.mode = 'box'; this.box = b;
    this.brot = Number.isFinite(b.rot) ? (b.rot as number) : 0;
    this.begin();
  }

  private begin(): void {
    const { ctx } = this.d;
    this.active = true;
    this.makePreview();
    if (this.kind === 'furniture') this.makeGrid();
    this.buildUi();
    this.attachKeys();
    this.update(0, true);
    ctx.bus.emit('build:state', { active: true, kind: this.kind });
  }

  /** Encerra o modo. `emit` = false quando só reiniciamos (ex.: novo build:start). */
  end(emit = true, placed = false): void {
    if (!this.active) return;
    this.active = false;
    this.offKey?.(); this.offKey = null;
    if (this.mode === 'edit') this.d.hide(null);
    this.clearPreview();
    if (this.grid) { this.d.root.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); this.grid = null; }
    this.ui?.remove(); this.ui = null; this.info = null; this.placeBtn = null; this.asking = false;
    const kind = this.kind;
    this.box = null;
    if (emit) {
      this.d.ctx.bus.emit('build:state', { active: false, kind, placed });
      this.d.ctx.bus.emit('build:end', { kind, placed });
    }
  }

  dispose(): void {
    this.end(true);
    for (const m of [this.okMat, this.badMat, this.boxOk, this.footOk, this.footBad, this.footBox]) m.dispose();
    this.footGeo.dispose();
  }

  /* ---------- prévia ---------- */
  private footprint(): { w: number; d: number } {
    const fp = FURNITURE_FOOTPRINT[this.type];
    return this.rot === 90 || this.rot === 270 ? { w: fp.d, d: fp.w } : { w: fp.w, d: fp.d };
  }
  private makePreview(): void {
    this.clearPreview();
    if (this.kind === 'box' && this.box) {
      this.ghost = new THREE.Mesh(boxGeometry(this.box.productId, this.box.open === true), this.boxOk);
      this.foot = new THREE.Mesh(this.footGeo, this.footBox);
      this.foot.scale.set(BOX_W + 0.08, 1, BOX_D + 0.08);
    } else {
      const f: Furniture = { id: -1, type: this.type, x: 0, z: 0, rot: 0, productId: this.productId, variant: this.variant, levels: this.levels };
      this.ghost = new THREE.Mesh(ghostGeometry(f), this.okMat);
      this.foot = new THREE.Mesh(this.footGeo, this.footOk);
    }
    for (const m of [this.ghost, this.foot]) { m.renderOrder = 5; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; this.d.root.add(m); }
  }
  private clearPreview(): void {
    if (this.ghost) { this.d.root.remove(this.ghost); this.ghost = null; }
    if (this.foot) { this.d.root.remove(this.foot); this.foot = null; }
  }
  private makeGrid(): void {
    const b = this.d.bounds();
    const zBack = this.d.storageUnlocked() ? -STORAGE_DEPTH : 0;
    const pts: number[] = [];
    for (let x = 0; x <= b.width; x++) pts.push(x, 0.025, zBack, x, 0.025, b.depth);
    for (let z = zBack; z <= b.depth; z++) pts.push(0, 0.025, z, b.width, 0.025, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false }));
    this.grid.renderOrder = 4; this.grid.frustumCulled = false;
    this.d.root.add(this.grid);
  }

  /** Validação + posição do fantasma + texto. */
  private refresh(): void {
    const { ctx } = this.d;
    if (this.kind === 'box') {
      let ok = false;
      try { ok = api.canDropBox(ctx.state, this.bx, this.bz); } catch { ok = false; }
      if (ok) {
        const c = Math.cos(this.brot), s = Math.sin(this.brot);
        for (const [lx, lz] of [[0, 0], [0.2, 0.14], [-0.2, 0.14], [0.2, -0.14], [-0.2, -0.14]] as const) {
          if (!this.d.walkable(this.bx + lx * c + lz * s, this.bz - lx * s + lz * c)) { ok = false; break; }
        }
      }
      this.valid = ok;
      this.by = ok ? this.d.stackHeight(this.bx, this.bz, this.box) : 0;
      if (this.ghost && this.foot) {
        this.ghost.position.set(this.bx, this.by + 0.005, this.bz); this.ghost.rotation.y = this.brot;
        this.foot.position.set(this.bx, 0.03, this.bz); this.foot.rotation.y = this.brot;
        this.ghost.material = ok ? this.boxOk : this.badMat;
        this.foot.material = ok ? this.footBox : this.footBad;
      }
    } else {
      let ok = false;
      try { ok = api.canPlace(ctx.state, this.type, this.x, this.z, this.rot, this.mode === 'edit' ? this.editId : undefined); } catch { ok = false; }
      if (ok && this.mode === 'stock') { try { ok = !!api.furnitureStock(ctx.state)[this.stockIndex]; } catch { /* */ } }
      this.valid = ok;
      const fp = this.footprint();
      const cx = this.x + fp.w / 2, cz = this.z + fp.d / 2;
      if (this.ghost && this.foot) {
        this.ghost.position.set(cx, 0.02, cz); this.ghost.rotation.y = (this.rot * Math.PI) / 180;
        this.ghost.material = ok ? this.okMat : this.badMat;
        this.foot.position.set(cx, 0.035, cz); this.foot.scale.set(fp.w, 1, fp.d);
        this.foot.material = ok ? this.footOk : this.footBad;
      }
    }
    this.updateInfo();
  }

  /** Ponto do chão sob a mira (centro da tela), limitado a [min, max] m na horizontal. */
  private aim(min: number, max: number): { x: number; z: number } {
    const cam = this.d.ctx.camera;
    cam.getWorldPosition(this.org);
    cam.getWorldDirection(this.dir);
    const hx = this.dir.x, hz = this.dir.z, hl = Math.hypot(hx, hz) || 1;
    let dist = max;
    if (this.dir.y < -0.02) dist = Math.min(max, (this.org.y / -this.dir.y) * hl);
    dist = Math.max(min, dist);
    this.ap.x = this.org.x + (hx / hl) * dist; this.ap.z = this.org.z + (hz / hl) * dist;
    return this.ap;
  }

  update(dt: number, force = false): void {
    if (!this.active) return;
    if (this.kind === 'box') {
      const p = this.aim(0.75, 3.5);
      if (force || Math.abs(p.x - this.bx) > 0.01 || Math.abs(p.z - this.bz) > 0.01) { this.bx = p.x; this.bz = p.z; this.refresh(); }
    } else {
      const fp = this.footprint();
      const p = this.aim(0.9 + Math.max(fp.w, fp.d) / 2, 7);
      const nx = Math.round(p.x - fp.w / 2), nz = Math.round(p.z - fp.d / 2);
      if (force || nx !== this.x || nz !== this.z) { this.x = nx; this.z = nz; this.refresh(); }
    }
    this.pulse += dt;
    if (this.foot) (this.foot.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.12 * Math.sin(this.pulse * 4.5);
  }

  /* ---------- ações ---------- */
  rotate(dir: 1 | -1 = 1): void {
    if (!this.active) return;
    if (this.kind === 'box') { this.brot = (this.brot + dir * (Math.PI / 8) + Math.PI * 2) % (Math.PI * 2); this.refresh(); }
    else {
      const fp0 = this.footprint();
      const cx = this.x + fp0.w / 2, cz = this.z + fp0.d / 2;
      this.rot = (((this.rot + dir * 90 + 360) % 360) as Rot);
      const fp = this.footprint();
      this.x = Math.round(cx - fp.w / 2); this.z = Math.round(cz - fp.d / 2);
      this.refresh();
    }
    this.d.ctx.bus.emit('sfx', { name: 'pop' });
  }

  confirm(): void {
    if (!this.active) return;
    const { ctx } = this.d;
    const bus = ctx.bus;
    try {
      if (this.kind === 'box') {
        const idx = this.box ? ctx.state.sidewalk.indexOf(this.box) : -1;
        if (idx < 0) { bus.emit('toast', { text: 'A caixa não está mais na mão.', kind: 'bad' }); this.end(true); return; }
        if (!this.valid) throw new Error('Não dá para largar a caixa aí');
        api.dropBox(ctx.state, idx, this.bx, this.bz, this.brot);
        bus.emit('sfx', { name: 'place' });
        bus.emit('stateChanged', { what: 'sidewalk' });
        this.end(true, true);
        return;
      }
      const name = NAMES[this.type], a = FEM[this.type] ? 'a' : 'o';
      if (this.mode === 'stock') {
        api.placeFromStock(ctx.state, this.stockIndex, this.x, this.z, this.rot, this.productId);
        bus.emit('toast', { text: `${name} montad${a}!`, kind: 'good' });
        bus.emit('sfx', { name: 'place' });
      } else if (this.mode === 'buy') {
        api.buyFurniture(ctx.state, this.type, this.x, this.z, this.rot, this.type === 'decor' ? this.variant : this.productId);
        bus.emit('toast', { text: `${name} comprad${a}!`, kind: 'good' });
        bus.emit('sfx', { name: 'buy' });
      } else {
        api.moveFurniture(ctx.state, this.editId, this.x, this.z, this.rot);
        bus.emit('toast', { text: `${name} movid${a}.`, kind: 'info' });
        bus.emit('sfx', { name: 'place' });
      }
      bus.emit('stateChanged', { what: 'furniture' });
      this.end(true, true);
    } catch (e) {
      bus.emit('toast', { text: errMsg(e), kind: 'bad' });
      bus.emit('sfx', { name: 'error' });
    }
  }

  /** VENDER: 1º toque pede confirmação (valor e destino dos produtos, simulados numa cópia do estado); 2º vende. */
  sell(): void {
    if (!this.active || this.mode !== 'edit') return;
    if (this.asking) { this.doSell(); return; }
    const { ctx } = this.d;
    let refund = 0, moves: Moves = { storage: 0, sidewalk: 0, boxes: 0 };
    try {
      const copy: StoreState = typeof structuredClone === 'function' ? structuredClone(ctx.state) : JSON.parse(JSON.stringify(ctx.state));
      const before = stockSnap(copy);
      refund = api.sellFurniture(copy, this.editId);
      moves = stockMoves(before, copy);
    } catch (e) {
      ctx.bus.emit('toast', { text: errMsg(e), kind: 'bad' });
      ctx.bus.emit('sfx', { name: 'error' });
      return;
    }
    const dest = movesText(moves, true);
    this.ask(`Vender ${FEM[this.type] ? 'a' : 'o'} ${NAMES[this.type].toLowerCase()} por ${brl(refund)}? (metade do preço)${dest ? ` ${dest}` : ''}`);
  }
  private doSell(): void {
    const { ctx } = this.d;
    try {
      const before = stockSnap(ctx.state);
      const got = api.sellFurniture(ctx.state, this.editId);
      const dest = movesText(stockMoves(before, ctx.state), false);
      ctx.bus.emit('toast', { text: `${NAMES[this.type]} vendid${FEM[this.type] ? 'a' : 'o'} por ${brl(got)}.${dest ? ` ${dest}` : ''}`, kind: 'info' });
      ctx.bus.emit('sfx', { name: 'coin' });
      ctx.bus.emit('stateChanged', { what: 'furniture' });
      this.end(true, true);
    } catch (e) {
      this.back();
      ctx.bus.emit('toast', { text: errMsg(e), kind: 'bad' });
      ctx.bus.emit('sfx', { name: 'error' });
    }
  }
  /** Troca a barra pela pergunta de confirmação (CONFIRMAR / VOLTAR). */
  private ask(text: string): void {
    if (!this.ui) return;
    this.asking = true;
    for (const r of this.ui.querySelectorAll<HTMLElement>('.wb-row')) r.style.display = 'none';
    if (this.info) { this.info.textContent = text; this.info.classList.add('wb-ask'); }
    const row = document.createElement('div'); row.className = 'wb-row wb-askrow';
    const mk = (label: string, cls: string, aria: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = label; b.setAttribute('aria-label', aria);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      row.appendChild(b);
    };
    mk('VENDER', 'wb-small wb-sell', 'Confirmar venda', () => this.doSell());
    mk('VOLTAR', 'wb-small', 'Voltar', () => this.back());
    this.ui.appendChild(row);
  }
  private back(): void {
    this.asking = false;
    this.ui?.querySelector('.wb-askrow')?.remove();
    this.ui?.querySelectorAll<HTMLElement>('.wb-row').forEach((r) => { r.style.display = ''; });
    this.info?.classList.remove('wb-ask');
    this.updateInfo();
  }

  /** Desmonta o móvel de volta para o estoque de montagem. */
  store(): void {
    if (!this.active || this.mode !== 'edit') return;
    const { ctx } = this.d;
    try {
      const before = stockSnap(ctx.state);
      api.storeFurniture(ctx.state, this.editId);
      const dest = movesText(stockMoves(before, ctx.state), false);
      ctx.bus.emit('toast', { text: `${NAMES[this.type]} guardad${FEM[this.type] ? 'a' : 'o'} no estoque de móveis.${dest ? ` ${dest}` : ''}`, kind: 'info' });
      ctx.bus.emit('sfx', { name: 'box' });
      ctx.bus.emit('stateChanged', { what: 'furniture' });
      this.end(true, true);
    } catch (e) {
      ctx.bus.emit('toast', { text: errMsg(e), kind: 'bad' });
      ctx.bus.emit('sfx', { name: 'error' });
    }
  }

  cancel(): void { if (this.asking) this.back(); else this.end(true, false); }

  /** Testes: estado da prévia. */
  get pose(): { kind: BuildKind; mode: string; x: number; z: number; rot: Rot; bx: number; bz: number; brot: number; valid: boolean; type: FurnitureType } {
    return { kind: this.kind, mode: this.mode, x: this.x, z: this.z, rot: this.rot, bx: this.bx, bz: this.bz, brot: this.brot, valid: this.valid, type: this.type };
  }

  /* ---------- teclado (desktop) ---------- */
  private attachKeys(): void {
    const key = (e: KeyboardEvent): void => {
      if (!this.active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'r' || e.key === 'R') { this.rotate(e.shiftKey ? -1 : 1); e.preventDefault(); }
      else if (e.key === 'Enter') { if (this.asking) this.doSell(); else this.confirm(); e.preventDefault(); }
      else if (e.key === 'Escape') { this.cancel(); e.preventDefault(); }
      else if (e.key === 'Delete') { this.sell(); e.preventDefault(); }
    };
    window.addEventListener('keydown', key);
    this.offKey = () => window.removeEventListener('keydown', key);
  }

  /* ---------- barra DOM ---------- */
  private buildUi(): void {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-world-build', '1');
    wrap.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));z-index:35;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:system-ui,sans-serif;';
    const css = document.createElement('style');
    css.textContent = `
      [data-world-build] button{pointer-events:auto;border:0;cursor:pointer;touch-action:manipulation;font-family:inherit;font-weight:900;color:#fff;letter-spacing:.5px;box-shadow:0 4px 0 rgba(0,0,0,.25),0 6px 14px rgba(0,0,0,.25);-webkit-tap-highlight-color:transparent}
      [data-world-build] button:active{transform:translateY(2px);box-shadow:0 2px 0 rgba(0,0,0,.25)}
      [data-world-build] .wb-row{display:flex;gap:8px;align-items:center}
      [data-world-build] .wb-rot{width:58px;height:54px;border-radius:12px;background:#1e9bf0;font-size:30px;line-height:1}
      [data-world-build] .wb-place{min-width:150px;height:54px;border-radius:12px;background:#22b24c;font-size:24px;padding:0 18px}
      [data-world-build] .wb-place.bad{background:#7d8a80}
      [data-world-build] .wb-small{min-width:104px;height:48px;border-radius:10px;font-size:16px;padding:0 14px;background:#5a6270}
      [data-world-build] .wb-sell{background:#d8862a}[data-world-build] .wb-store{background:#7a56c2}
      [data-world-build] .wb-info{padding:4px 12px;border-radius:10px;background:rgba(20,24,32,.72);color:#fff;font-size:13px;font-weight:700;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis}
      [data-world-build] .wb-info.wb-ask{white-space:normal;text-align:center;font-size:15px;line-height:1.3;max-width:min(92vw,560px);padding:8px 14px;background:rgba(20,24,32,.88)}`;
    wrap.appendChild(css);
    this.info = document.createElement('div');
    this.info.className = 'wb-info';
    wrap.appendChild(this.info);
    const mk = (row: HTMLElement, label: string, cls: string, aria: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = label; b.setAttribute('aria-label', aria);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      row.appendChild(b);
      return b;
    };
    const r1 = document.createElement('div'); r1.className = 'wb-row';
    mk(r1, '⟲', 'wb-rot', 'Girar para a esquerda', () => this.rotate(-1));
    this.placeBtn = mk(r1, 'COLOCAR', 'wb-place', 'Colocar', () => this.confirm());
    mk(r1, '⟳', 'wb-rot', 'Girar para a direita', () => this.rotate(1));
    wrap.appendChild(r1);
    const r2 = document.createElement('div'); r2.className = 'wb-row';
    if (this.mode === 'edit') {
      mk(r2, 'VENDER', 'wb-small wb-sell', 'Vender', () => this.sell());
      mk(r2, 'GUARDAR', 'wb-small wb-store', 'Guardar no estoque', () => this.store());
    }
    mk(r2, 'CANCELAR', 'wb-small', 'Cancelar', () => this.cancel());
    wrap.appendChild(r2);
    this.d.ctx.uiRoot.appendChild(wrap);
    this.ui = wrap;
  }

  private updateInfo(): void {
    if (this.placeBtn) this.placeBtn.classList.toggle('bad', !this.valid);
    if (!this.info || this.asking) return;
    let label: string;
    if (this.kind === 'box' && this.box) {
      let n = this.box.productId;
      try { n = productById(this.box.productId).name; } catch { /* */ }
      label = `Caixa ${this.box.open ? 'aberta' : 'fechada'}${this.box.units <= 0 ? ' (vazia)' : ''} · ${n}`;
    } else {
      label = NAMES[this.type];
      if (this.productId) { try { label += ` · ${productById(this.productId).name}`; } catch { /* */ } }
      if (this.mode === 'buy' && this.cost !== null) label += ` · ${brl(this.cost)}`;
    }
    this.info.textContent = `${label} — ${this.valid ? 'mire no chão e toque em COLOCAR' : 'posição inválida'}`;
  }
}
