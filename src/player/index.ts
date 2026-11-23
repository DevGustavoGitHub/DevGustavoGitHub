/**
 * Módulo PLAYER (Fase 3) — só 1ª pessoa. Câmera a 1,6 m (FOV 70), joystick + olhar por deslize/mouse, colisão de
 * cápsula, mira central com raycast em `world.pickGroup` (fallback próprio), tabela de ações do protocolo
 * (docs/CONTRACTS.md, "Fase 3" + "ADENDO"), caixa aberta/fechada na mão, arremesso balístico, largar via `build:box`,
 * esfregão animado, sentar no caixa e PickService (toques nos itens da esteira). Publica `services.player` e
 * `services.pick`; emite `player:action` + `stateChanged` após cada ação.
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '../core/module';
import type { PickInfo, PickService, PlayerService, WorldService } from '../core/services';
import { storeBounds, trashBinPos } from '../core/layout';
import type { Box, Furniture, StoreState } from '../sim/state';
import { productById } from '../sim/catalog';
import * as api from '../sim/api';
import { Input } from './input';
import { Controls } from './controls';
import { Collider, furnRect } from './collide';
import { BOX_H, CartonKit, CartonView, HeldView, ProductTemplates, disposeShared, type HeldBox } from './hands';
import { FallbackHighlight, FallbackPicks, localToWorld, pickOf } from './picking';

const EYE = 1.6, RADIUS = 0.3, FOV = 70;
const WALK = 3.3, CARRY = 2.9, ACCEL = 22, DECEL = 30;
const RANGE = 2.6, RANGE_FAR = 3.5, RANGE_HYST = 0.3;
const PLACE_INTERVAL = 0.12, MOP_TIME = 0.9, STEP_DIST = 0.75;
const BIN_R = 0.8, GRAV = 9.8, DROP_R = 0.26;
const SEAT_YAW = Math.PI / 3;
const PITCH_MIN = -1.35, PITCH_MAX = 1.2;

interface Target { pick: PickInfo; key: string; obj: THREE.Object3D | null; point: THREE.Vector3 | null; dist: number }
interface Act { key: string; label: string; enabled: boolean; hold: boolean; run?: () => boolean | void }
interface Flying { box: Box; view: CartonView; pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; t: number; bounces: number }
interface Seat { counterId: number; pos: THREE.Vector3; yaw0: number; pitch0: number }

const keyOf = (p: PickInfo): string => `${p.kind}:${p.id ?? ''}`;
const isOpen = (b: Box): boolean => b.open === true;
const notImpl = (e: unknown): boolean => e instanceof Error && e.message.startsWith('NOT_IMPLEMENTED');
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export default function create(): GameModule {
  let ctx!: GameContext;
  let svc!: PlayerService;
  let input!: Input;
  let controls!: Controls;
  let collider!: Collider;
  let tpls!: ProductTemplates;
  let held!: HeldView;
  let worldKit!: CartonKit;
  let fbPicks!: FallbackPicks;
  let fbHL!: FallbackHighlight;
  const offs: (() => void)[] = [];

  // câmera e movimento
  let yaw = 0, pitch = -0.35;
  const pos = { x: 0, z: 0 };
  const vel = new THREE.Vector2();
  let walkDist = 0, stepAcc = 0, bobAmp = 0;
  let seat: Seat | null = null;
  let seatYaw = 0, seatPitch = 0;
  const trans = { on: false, t: 0, dur: 0.5, pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  let lookYawFrame = 0, lookPitchFrame = 0;
  let locked = false, override = false, building = false;
  // interação
  const carried: Box[] = []; // base → topo (mesma referência de svc.carryingAll)
  let capNow = 1, capForce: number | null = null;
  let target: Target | null = null;
  let pendKey = '', pendT = 0, lostT = 0, hlKey = '';
  let forced: PickInfo | null = null;
  let primary: Act | null = null, secondary: Act | null = null;
  let pressed = false;
  let holding: { key: string; t: number } | null = null;
  let mopping: { t: number; x: number; z: number } | null = null;
  const flying: Flying[] = [];
  let pendingBox: { box: Box; t: number } | null = null;
  let placingBox: Box | null = null;
  let signCheck = -1;
  const tapTargets = new Map<THREE.Object3D, () => void>();
  const prefs = { reduceMotion: false, haptics: true, fontScale: 1, colorblind: false };
  let catalog: api.FurnitureSpec[] | null = null;
  const heldList: HeldBox[] = [];
  let stickShown = true;

  // temporários (sem alocação por quadro)
  const ray = new THREE.Raycaster();
  const hits: THREE.Intersection[] = [];
  const v2 = new THREE.Vector2();
  const tv = new THREE.Vector3(), tv2 = new THREE.Vector3();
  const box3 = new THREE.Box3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const wantPos = new THREE.Vector3();
  const wantQuat = new THREE.Quaternion();

  /* ---------------- utilidades ---------------- */
  const st = (): StoreState => ctx.state;
  const world = (): WorldService | undefined => ctx.services.world;
  const emit = (n: string, p?: unknown): void => ctx.bus.emit(n, p);
  const changed = (what: string): void => emit('stateChanged', { what });
  const act = (kind: string, extra: { productId?: string; furnitureId?: number } = {}): void => emit('player:action', { kind, ...extra });
  const sfx = (name: string): void => emit('sfx', { name });
  const toast = (text: string, kind: 'info' | 'good' | 'bad' = 'info'): void => emit('toast', { text, kind });
  const toastErr = (e: unknown): void => toast(e instanceof Error ? e.message : String(e), 'bad');
  const haptic = (ms: number): void => { if (!prefs.haptics) return; try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };
  const idxOf = (b: Box): number => st().sidewalk.indexOf(b);
  const nameOf = (pid: string): string => { try { return productById(pid).name; } catch { return pid; } };
  const capOf = (pid: string): number => { try { return api.productCapacity(st(), pid); } catch { return Infinity; } };
  const readCap = (): number => {
    if (capForce != null) return capForce;
    try { const n = api.carryCapacity(st()); return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1; } catch { return 1; }
  };
  const top = (): Box | undefined => carried[carried.length - 1];
  const syncTop = (): void => { svc.carrying = top() ?? null; };
  const removeCarried = (b: Box): void => { const k = carried.indexOf(b); if (k >= 0) carried.splice(k, 1); syncTop(); };
  const toTop = (b: Box): void => {
    const k = carried.indexOf(b);
    if (k >= 0 && k !== carried.length - 1) { carried.splice(k, 1); carried.push(b); syncTop(); }
  };
  const canAct = (): boolean => !seat && !locked && !override && !building && !mopping && !trans.on && !pendingBox && !placingBox;
  const fits = (type: Furniture['type'], pid: string): boolean => {
    try {
      catalog ??= api.furnitureCatalog();
      const spec = catalog.find((c) => c.type === type);
      const p = productById(pid);
      return !!spec && spec.categories.includes(p.category) && st().licenses.includes(p.category);
    } catch { return false; }
  };
  const binPos = (): { x: number; z: number } => { const w = world(); return w ? w.trashBin() : trashBinPos(storeBounds(st().expansion)); };
  const canDrop = (x: number, z: number): boolean => { try { return api.canDropBox(st(), x, z); } catch { return true; } };
  const dropPoint = (x: number, z: number): { x: number; z: number } => collider.findFree(x, z, DROP_R, canDrop);
  /** Larga `b` no chão pela API (`dropBox`); se a sim recusar o ponto, tenta perto do jogador. */
  const putDown = (b: Box, x: number, z: number, rot: number): boolean => {
    for (const p of [{ x, z }, dropPoint(pos.x, pos.z)]) {
      const i = idxOf(b);
      if (i < 0) return false;
      try { api.dropBox(st(), i, p.x, p.z, rot); removeCarried(b); return true; } catch (e) {
        if (notImpl(e)) { b.carried = false; b.x = p.x; b.z = p.z; b.rot = rot; removeCarried(b); return true; }
      }
    }
    toast('Não dá para largar a caixa aqui', 'bad');
    return false;
  };

  /* ---------------- preferências ---------------- */
  const applyPrefs = (p?: { reduceMotion?: unknown; haptics?: unknown; fontSize?: unknown; colorblind?: unknown }): void => {
    if (p) {
      if (typeof p.reduceMotion === 'boolean') prefs.reduceMotion = p.reduceMotion;
      if (typeof p.haptics === 'boolean') prefs.haptics = p.haptics;
      if (typeof p.colorblind === 'boolean') prefs.colorblind = p.colorblind;
      if (typeof p.fontSize === 'string') prefs.fontScale = p.fontSize === 'small' ? 0.9 : p.fontSize === 'large' ? 1.2 : 1;
    }
    controls.setPrefs(prefs);
    fbHL.setColor(prefs.colorblind ? 0x3d9bff : 0x2bd94a);
  };

  /* ---------------- câmera ---------------- */
  const startTrans = (dur: number): void => {
    trans.on = true; trans.t = 0; trans.dur = dur;
    trans.pos.copy(ctx.camera.position); trans.quat.copy(ctx.camera.quaternion);
  };
  const desiredPose = (): void => {
    if (seat) {
      wantPos.copy(seat.pos);
      euler.set(clamp(seat.pitch0 + seatPitch, PITCH_MIN, PITCH_MAX), seat.yaw0 + seatYaw, 0, 'YXZ');
    } else {
      const amp = prefs.reduceMotion ? 0 : bobAmp;
      const ph = (walkDist / STEP_DIST) * Math.PI;
      const lat = Math.sin(ph) * 0.012 * amp;
      wantPos.set(pos.x + Math.cos(yaw) * lat, EYE + (Math.abs(Math.cos(ph)) - 0.6) * 0.035 * amp, pos.z - Math.sin(yaw) * lat);
      euler.set(pitch, yaw, 0, 'YXZ');
    }
    wantQuat.setFromEuler(euler);
  };
  const updateCamera = (dt: number): void => {
    const cam = ctx.camera;
    const f = cam.aspect >= 1 ? FOV
      : clamp(THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / Math.max(0.3, cam.aspect)) * 0.75)), FOV, 100);
    if (Math.abs(f - cam.fov) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
    if (override) return;
    desiredPose();
    if (trans.on) {
      trans.t += dt;
      const e = smooth(trans.t / trans.dur);
      cam.position.lerpVectors(trans.pos, wantPos, e);
      cam.quaternion.slerpQuaternions(trans.quat, wantQuat, e);
      if (trans.t >= trans.dur) trans.on = false;
    } else {
      cam.position.copy(wantPos);
      cam.quaternion.copy(wantQuat);
    }
  };
  const applyLook = (): void => {
    const dy = input.dYaw, dp = input.dPitch;
    input.dYaw = input.dPitch = 0;
    lookYawFrame = lookPitchFrame = 0;
    if (locked || override || trans.on) return;
    if (seat) {
      seatYaw = clamp(seatYaw + dy, -SEAT_YAW, SEAT_YAW);
      seatPitch = clamp(seatPitch + dp, -0.6, 0.5);
    } else {
      yaw = wrapAngle(yaw + dy);
      pitch = clamp(pitch + dp, PITCH_MIN, PITCH_MAX);
    }
    lookYawFrame = dy; lookPitchFrame = dp;
  };
  const updateMove = (dt: number): void => {
    const can = !locked && !override && !mopping && !trans.on;
    const mx = can ? input.moveX : 0, my = can ? input.moveY : 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    // frente = (−sin yaw, −cos yaw); direita = (cos yaw, −sin yaw)
    const wx = -sy * my + cy * mx, wz = -cy * my - sy * mx;
    const l = Math.hypot(wx, wz) || 1;
    const sp = (carried.length ? CARRY : WALK) * mag;
    const tx = (wx / l) * sp, tz = (wz / l) * sp;
    const a = (mag > 0 ? ACCEL : DECEL) * dt;
    const dx = tx - vel.x, dz = tz - vel.y, dl = Math.hypot(dx, dz);
    if (dl <= a) vel.set(tx, tz); else { vel.x += (dx / dl) * a; vel.y += (dz / dl) * a; }
    if (!can) vel.set(0, 0);
    const bx = pos.x, bz = pos.z;
    if (vel.lengthSq() > 1e-8 && dt > 0) {
      collider.move(pos, vel.x * dt, vel.y * dt, RADIUS);
      // contra a parede: fica só a componente que de fato andou (desliza sem "grudar")
      const rx = (pos.x - bx) / dt, rz = (pos.z - bz) / dt;
      if (Math.hypot(rx, rz) < vel.length() * 0.9) vel.set(rx, rz);
    }
    const moved = Math.hypot(pos.x - bx, pos.z - bz);
    const speed = dt > 0 ? moved / dt : 0;
    walkDist += moved;
    bobAmp += ((speed > 0.4 ? Math.min(1, speed / WALK) : 0) - bobAmp) * (1 - Math.exp(-dt * 8));
    stepAcc += moved;
    if (stepAcc >= STEP_DIST) { stepAcc = 0; sfx('step'); }
  };

  /* ---------------- alvo (raycast do centro da tela) ---------------- */
  const pickRoot = (): THREE.Group => {
    const w = world();
    const g = w?.pickGroup;
    if (g && g.children.length) { if (!g.parent) g.updateMatrixWorld(true); return g; }
    fbPicks.sync(st(), w);
    return fbPicks.group;
  };
  const cast = (): Target | null => {
    const cam = ctx.camera;
    v2.set(0, 0);
    ray.setFromCamera(v2, cam);
    ray.near = 0.05;
    ray.far = RANGE_FAR + RANGE_HYST;
    hits.length = 0;
    ray.intersectObject(pickRoot(), true, hits);
    for (const h of hits) {
      const p = pickOf(h.object);
      if (!p) continue;
      const key = keyOf(p.info);
      const far = p.info.kind === 'sign' || p.info.kind === 'computer';
      const lim = (far ? RANGE_FAR : RANGE) + (target?.key === key ? RANGE_HYST : 0);
      if (h.distance > lim) return null; // o mais próximo está longe: nada atrás dele conta
      if (collider.blocked(cam.position.x, cam.position.z, h.point.x, h.point.z)) return null;
      return { pick: p.info, key, obj: p.obj, point: h.point, dist: h.distance };
    }
    return null;
  };
  const highlight = (t: Target | null): void => {
    const w = world();
    if (w?.highlight) {
      try { w.highlight(t ? t.pick : null); } catch { /* world em andamento */ }
      fbHL.show(null);
    } else fbHL.show(t?.obj ?? null);
  };
  const setTarget = (t: Target | null): void => {
    target = t; lostT = 0; pendKey = ''; pendT = 0;
    const k = t?.key ?? '';
    if (k !== hlKey) { hlKey = k; highlight(t); }
  };
  const updateTarget = (dt: number): void => {
    if (forced) {
      const k = keyOf(forced);
      if (target?.key !== k) setTarget({ pick: forced, key: k, obj: null, point: null, dist: 1 });
      return;
    }
    const c = cast();
    const ck = c?.key ?? '';
    if (target && ck === target.key) { target = c; lostT = 0; pendKey = ''; return; }
    if (!c) { if (target) { lostT += dt; if (lostT > 0.16) setTarget(null); } return; }
    if (!target) { setTarget(c); return; } // alvo novo aparece na hora
    if (pendKey !== ck) { pendKey = ck; pendT = 0; }
    pendT += dt;
    if (pendT >= 0.07) setTarget(c); // troca de alvo só se o novo se mantiver (histerese)
  };
  const boxOf = (t: Target): Box | null => {
    const s = st();
    const ok = (o: Box | undefined): o is Box => !!o && !o.carried && o.x != null && o.z != null;
    const b = t.pick.id != null ? s.sidewalk[t.pick.id] : undefined;
    if (ok(b) && (!t.point || Math.hypot(b.x! - t.point.x, b.z! - t.point.z) < 0.9)) return b;
    if (!t.point) return null;
    let best: Box | null = null, bd = 0.9;
    for (const o of s.sidewalk) {
      if (!ok(o)) continue;
      const d = Math.hypot(o.x! - t.point.x, o.z! - t.point.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  const dirtOf = (t: Target): number => {
    const s = st();
    const id = t.pick.id;
    const d = id != null ? s.dirt[id] : undefined;
    if (d && (!t.point || Math.hypot(d.x - t.point.x, d.z - t.point.z) < 0.8)) return id!;
    if (!t.point) return -1;
    let bi = -1, bd = 0.8;
    for (let i = 0; i < s.dirt.length; i++) {
      const o = s.dirt[i]!;
      const dd = Math.hypot(o.x - t.point.x, o.z - t.point.z);
      if (dd < bd) { bd = dd; bi = i; }
    }
    return bi;
  };

  /* ---------------- tabela de ações ---------------- */
  const A = (key: string, label: string, run: () => boolean | void, hold = false): Act => ({ key, label, enabled: true, hold, run });
  const D = (key: string, label: string): Act => ({ key, label, enabled: false, hold: false });

  const stockAct = (f: Furniture, b: Box, assign: boolean): Act => {
    if (!isOpen(b)) return A('open', 'Abrir caixa', () => setOpen(b, true));
    if (!assign && (st().shelf[b.productId] ?? 0) >= capOf(b.productId)) return D('fullshelf', 'Prateleira cheia');
    return A(`stock:${f.id}`, 'Repor', () => placeOne(f, b), true);
  };
  const displayAct = (f: Furniture): Act => {
    const s = st();
    const cur = f.productId;
    let any = false;
    for (let i = carried.length - 1; i >= 0; i--) {
      const b = carried[i]!;
      if (b.units <= 0) continue;
      any = true;
      if (b.productId === cur) return stockAct(f, b, false);
    }
    if (any) {
      if (cur && (s.shelf[cur] ?? 0) > 0) return D('other', 'Outro produto');
      for (let i = carried.length - 1; i >= 0; i--) {
        const b = carried[i]!;
        if (b.units > 0 && fits(f.type, b.productId)) return stockAct(f, b, true);
      }
      return D('nofit', 'Não cabe aqui');
    }
    return A('price', 'Preço', () => { emit('ui:openTablet', cur ? { tab: 'prices', productId: cur } : { tab: 'prices' }); });
  };
  const rackAct = (f: Furniture): Act | null => {
    const t0 = top();
    if (t0 && t0.units > 0) return A('store', 'Guardar', () => storeTop(f));
    if (t0) return D('store-empty', 'Caixa vazia');
    for (const k in st().storage) if ((st().storage[k] ?? 0) > 0) return A('take', 'Retirar', () => takeFrom(f));
    return D('take-none', 'Depósito vazio');
  };
  const staffedId = (): number | null => {
    if ((st().employees.cashier ?? 0) <= 0) return null;
    try { return world()?.counters()[0]?.furnitureId ?? null; } catch { return null; }
  };
  const seatAct = (id: number): Act => {
    if (staffedId() === id) return D('staffed', 'Caixa ocupado');
    if (carried.length) return D('hands', 'Largue a caixa');
    return A(`sit:${id}`, 'Sentar no caixa', () => sit(id));
  };
  const resolve = (): void => {
    primary = null; secondary = null;
    const t = target;
    if (!t || seat) return;
    const s = st();
    switch (t.pick.kind) {
      case 'box': {
        const b = boxOf(t);
        if (b) primary = carried.length < capNow ? A(`pick:${idxOf(b)}`, 'Pegar', () => pickBox(b)) : D('full', 'Mãos cheias');
        return;
      }
      case 'furniture': {
        const f = s.furniture.find((x) => x.id === t.pick.id);
        if (!f) return;
        const mover = carried.length ? null : A('move', 'Mover', () => { emit('build:edit', { furnitureId: f.id }); act('move', { furnitureId: f.id }); });
        if (f.type === 'shelf' || f.type === 'fridge' || f.type === 'freezer') { primary = displayAct(f); secondary = mover; }
        else if (f.type === 'rack') { primary = rackAct(f); secondary = mover; }
        else if (f.type === 'counter') { primary = seatAct(f.id); secondary = mover; }
        else primary = mover;
        return;
      }
      case 'dirt': {
        const i = dirtOf(t);
        if (i >= 0) primary = A('clean', 'Limpar', () => startClean(i));
        return;
      }
      case 'trash': {
        for (let i = carried.length - 1; i >= 0; i--) {
          const b = carried[i]!;
          if (b.units <= 0) { primary = A('trash', 'Jogar fora', () => discard(b)); return; }
        }
        if (carried.length) primary = D('trash-full', 'Só caixa vazia');
        return;
      }
      case 'sign': {
        const ph = ctx.clock.phase;
        if (ph === 'prep' || ph === 'open') primary = A('sign', ph === 'prep' ? 'Abrir loja' : 'Fechar loja', signAct);
        return;
      }
      case 'computer':
        primary = A('pc', 'Usar computador', () => { emit('ui:openTablet', {}); act('useComputer'); });
        return;
      case 'seat':
        if (t.pick.id != null) primary = seatAct(t.pick.id);
        return;
      case 'storageDoor':
        if (!s.storageUnlocked) primary = A('sdoor', 'Depósito (licença)', () => { emit('ui:openTablet', { tab: 'services' }); });
        return;
    }
  };

  /* ---------------- ações ---------------- */
  const pickBox = (b: Box): boolean => {
    if (carried.length >= capNow) { toast(`Mãos cheias (${carried.length}/${capNow})`); return false; }
    b.carried = true;
    carried.push(b);
    syncTop();
    sfx('box'); haptic(15);
    act('pickBox', { productId: b.productId }); changed('sidewalk');
    return true;
  };
  const setOpen = (b: Box, open: boolean): boolean => {
    if (held.busy()) return false;
    toTop(b);
    const i = idxOf(b);
    if (i < 0) return false;
    try { api.setBoxOpen(st(), i, open); } catch (e) {
      if (!notImpl(e)) { toastErr(e); return false; }
      b.open = open;
    }
    sfx(open ? 'boxOpen' : 'boxClose'); haptic(10);
    act(open ? 'openBox' : 'closeBox', { productId: b.productId }); changed('sidewalk');
    return true;
  };
  const toggleTop = (): void => { const b = top(); if (b && canAct()) setOpen(b, !isOpen(b)); };
  const placeOne = (f: Furniture, b: Box): boolean => {
    const s = st();
    if (!carried.includes(b) || !isOpen(b) || b.units <= 0) return false;
    toTop(b);
    try {
      if (f.productId !== b.productId) { api.assignProduct(s, f.id, b.productId); changed('furniture'); }
      const moved = api.placeUnits(s, idxOf(b), 1);
      if (moved <= 0) { toast('Prateleira cheia'); return false; }
    } catch (e) { toastErr(e); return false; }
    sfx('pop'); haptic(5);
    act('placeUnits', { productId: b.productId, furnitureId: f.id }); changed('shelf');
    const cap = capOf(b.productId);
    controls.badge(`${nameOf(b.productId)}  ${s.shelf[b.productId] ?? 0}${cap === Infinity ? '' : '/' + cap}  ·  caixa: ${b.units}`);
    return true;
  };
  const discard = (b: Box): boolean => {
    try { api.discardBox(st(), idxOf(b)); } catch (e) { toastErr(e); return false; }
    removeCarried(b);
    sfx('trash'); haptic(12);
    act('discardBox', { productId: b.productId }); changed('sidewalk');
    return true;
  };
  const storeTop = (f: Furniture): boolean => {
    const b = top();
    if (!b) return false;
    try { api.storeBox(st(), idxOf(b)); } catch (e) { toastErr(e); return false; }
    removeCarried(b);
    sfx('box');
    act('storeBox', { productId: b.productId, furnitureId: f.id }); changed('storage');
    return true;
  };
  const takeFrom = (f: Furniture): boolean => {
    const s = st();
    let pid: string | null = null, ratio = Infinity;
    for (const k of Object.keys(s.storage)) {
      if ((s.storage[k] ?? 0) <= 0) continue;
      const c = capOf(k);
      const r = (s.shelf[k] ?? 0) / Math.max(1, c === Infinity ? 1 : c);
      if (r < ratio) { ratio = r; pid = k; }
    }
    if (!pid) return false;
    try {
      api.takeFromStorage(s, pid, true);
      const b = s.sidewalk[s.sidewalk.length - 1];
      if (!b) return false;
      b.carried = true;
      carried.push(b);
      syncTop();
    } catch (e) { toastErr(e); return false; }
    sfx('box');
    act('takeBox', { productId: pid, furnitureId: f.id }); changed('storage');
    return true;
  };
  const startClean = (i: number): boolean => {
    const d = st().dirt[i];
    if (!d) return false;
    mopping = { t: 0, x: d.x, z: d.z };
    holding = null;
    sfx('mop'); haptic(10);
    return true;
  };
  const tickMop = (dt: number): void => {
    if (!mopping) return;
    mopping.t += dt;
    if (mopping.t < MOP_TIME) return;
    const m = mopping;
    mopping = null;
    const s = st();
    let bi = -1, bd = 0.45;
    for (let i = 0; i < s.dirt.length; i++) {
      const d = s.dirt[i]!;
      const dd = Math.hypot(d.x - m.x, d.z - m.z);
      if (dd < bd) { bd = dd; bi = i; }
    }
    if (bi >= 0) { try { api.cleanDirt(s, bi); } catch (e) { toastErr(e); return; } }
    haptic(8);
    act('clean'); changed('dirt');
  };
  const signAct = (): void => {
    const wasPrep = ctx.clock.phase === 'prep';
    emit('store:sign');
    act('sign');
    if (wasPrep) signCheck = 0; // a UI decide; se ninguém tratar o pedido de abrir, abre direto
  };
  const doSecondary = (): void => {
    if (!canAct()) return;
    resolve();
    if (secondary?.enabled) secondary.run?.();
  };

  /* ---------------- sentar no caixa ---------------- */
  const seatPoseOf = (id: number): Seat | null => {
    const w = world();
    try {
      const p = w?.seatPose?.(id);
      if (p) {
        const dx = p.look.x - p.pos.x, dy = p.look.y - p.pos.y, dz = p.look.z - p.pos.z;
        return { counterId: id, pos: p.pos.clone(), yaw0: Math.atan2(-dx, -dz), pitch0: Math.atan2(dy, Math.hypot(dx, dz)) };
      }
    } catch { /* usa o fallback */ }
    const f = st().furniture.find((x) => x.id === id);
    if (!f) return null;
    const r = furnRect(f), cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const c = w?.counters().find((k) => k.furnitureId === id);
    const op = c ? c.operator : localToWorld(cx, cz, f.rot, 0.5, -1.5);
    const a = (f.rot * Math.PI) / 180, fx = Math.sin(a), fz = Math.cos(a); // frente (lado do cliente)
    return { counterId: id, pos: new THREE.Vector3(op.x + fx * 0.15, 1.22, op.z + fz * 0.15), yaw0: Math.atan2(-fx, -fz), pitch0: -0.36 };
  };
  const sit = (id: number): boolean => {
    if (carried.length) return false;
    const sp = seatPoseOf(id);
    if (!sp) return false;
    startTrans(0.55);
    seat = sp; seatYaw = 0; seatPitch = 0;
    svc.mode = 'seated'; svc.seatedAt = id; svc.atCounter = id;
    svc.position.set(sp.pos.x, 0, sp.pos.z);
    vel.set(0, 0); holding = null; pressed = false;
    input.seated = true; input.reset();
    setTarget(null);
    sfx('sit'); haptic(12);
    act('sit', { furnitureId: id }); changed('player');
    return true;
  };
  const stand = (): void => {
    if (!seat) return;
    const s0 = seat;
    const c = world()?.counters().find((k) => k.furnitureId === s0.counterId);
    const base = c ? c.operator : { x: s0.pos.x, z: s0.pos.z };
    const p = collider.findFree(base.x, base.z, RADIUS);
    pos.x = p.x; pos.z = p.z;
    yaw = wrapAngle(s0.yaw0 + seatYaw);
    pitch = clamp(s0.pitch0 + seatPitch, -0.5, 0.4);
    startTrans(0.45);
    seat = null;
    svc.mode = building ? 'build' : 'walk'; svc.seatedAt = null; svc.atCounter = null;
    svc.position.set(pos.x, 0, pos.z);
    input.seated = false; input.reset();
    sfx('stand');
    act('stand', { furnitureId: s0.counterId }); changed('player');
  };

  /* ---------------- PickService: toques sentado ---------------- */
  const attachedVisible = (o: THREE.Object3D): boolean => {
    let scene = false;
    for (let n: THREE.Object3D | null = o; n; n = n.parent) {
      if (!n.visible) return false;
      if ((n as THREE.Scene).isScene) scene = true;
    }
    return scene;
  };
  const onTap = (x: number, y: number): void => {
    if (!seat || locked || override || tapTargets.size === 0) return;
    const cam = ctx.camera;
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    v2.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v2, cam);
    ray.near = 0.05; ray.far = 40;
    const objs: THREE.Object3D[] = [];
    for (const o of tapTargets.keys()) if (attachedVisible(o)) objs.push(o);
    if (!objs.length) return;
    hits.length = 0;
    ray.intersectObjects(objs, true, hits);
    let chosen: THREE.Object3D | null = null;
    for (const h of hits) {
      for (let n: THREE.Object3D | null = h.object; n && !chosen; n = n.parent) if (tapTargets.has(n)) chosen = n;
      if (chosen) break;
    }
    if (!chosen) { // tolerância: itens pequenos na esteira (≈ 34 px do centro na tela)
      let bd = 34;
      for (const o of objs) {
        box3.setFromObject(o);
        if (box3.isEmpty()) continue;
        box3.getCenter(tv);
        tv2.copy(tv).applyMatrix4(cam.matrixWorldInverse);
        if (tv2.z > -0.05) continue; // atrás da câmera
        tv.project(cam);
        const sx = ((tv.x + 1) / 2) * rect.width + rect.left, sy = ((1 - tv.y) / 2) * rect.height + rect.top;
        const d = Math.hypot(sx - x, sy - y);
        if (d < bd) { bd = d; chosen = o; }
      }
    }
    if (!chosen) return;
    const fn = tapTargets.get(chosen);
    haptic(8);
    try { fn?.(); } catch (e) { console.error('[player] erro no onTap', e); }
  };

  /* ---------------- arremesso ---------------- */
  const throwTop = (): void => {
    if (!canAct() || !carried.length) return;
    const b = top()!;
    const cam = ctx.camera;
    const o = new THREE.Vector3(0, -0.34, -0.62).applyQuaternion(cam.quaternion).add(cam.position);
    const fwd = tv.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const bin = binPos();
    // mira assistida: lixeira mirada, ou o ponto do chão a 1–9 m; senão um arremesso padrão para a frente
    let aim: THREE.Vector3 | null = null;
    if (target?.pick.kind === 'trash') aim = tv2.set(bin.x, 1.05, bin.z);
    else if (fwd.y < -0.03) {
      const t = -cam.position.y / fwd.y;
      const px = cam.position.x + fwd.x * t, pz = cam.position.z + fwd.z * t;
      const d = Math.hypot(px - cam.position.x, pz - cam.position.z);
      if (d >= 1 && d <= 9) aim = tv2.set(px, Math.hypot(px - bin.x, pz - bin.z) < BIN_R ? 1.05 : BOX_H / 2, pz);
    }
    const v = new THREE.Vector3();
    if (aim) {
      const dx = aim.x - o.x, dz = aim.z - o.z, dy = aim.y - o.y;
      const T = clamp(0.36 + Math.hypot(dx, dz) * 0.085, 0.42, 1.05);
      v.set(dx / T, (dy + 0.5 * GRAV * T * T) / T, dz / T);
    } else v.copy(fwd).multiplyScalar(6.5).setY(fwd.y * 6.5 + 2);
    removeCarried(b); // no estado continua carried=true durante o voo: ninguém mexe nela
    const view = new CartonView(worldKit, tpls);
    view.set(b, b.productId, b.units, isOpen(b));
    view.root.position.copy(o);
    view.root.quaternion.copy(cam.quaternion);
    view.root.traverse((n) => { n.castShadow = true; });
    ctx.scene.add(view.root);
    const r = (): number => (Math.random() - 0.5);
    flying.push({ box: b, view, pos: o, vel: v, spin: new THREE.Vector3(r() * 6, r() * 8, r() * 4), t: 0, bounces: 0 });
    sfx('throw'); haptic(18);
  };
  const land = (f: Flying, how: 'bin' | 'floor'): void => {
    f.view.dispose();
    const b = f.box;
    const s = st();
    const i = idxOf(b);
    if (i < 0) return;
    if (how === 'bin' && b.units <= 0) {
      try { api.discardBox(s, i); } catch (e) { toastErr(e); }
      if (!s.sidewalk.includes(b)) {
        sfx('trash');
        act('discardBox', { productId: b.productId }); changed('sidewalk');
        return;
      }
    }
    let x = f.pos.x, z = f.pos.z;
    if (how === 'bin') { // caixa com produtos: bate na lixeira e cai ao lado
      const bin = binPos();
      const dx = pos.x - bin.x, dz = pos.z - bin.z, d = Math.hypot(dx, dz) || 1;
      x = bin.x + (dx / d) * 1.0; z = bin.z + (dz / d) * 1.0;
      if (b.units > 0) toast('A caixa ainda tem produtos: só caixas vazias vão para o lixo', 'info');
    }
    const p = dropPoint(x, z);
    if (!putDown(b, p.x, p.z, f.view.root.rotation.y)) {
      b.carried = true;
      if (!carried.includes(b)) { carried.push(b); syncTop(); }
      return;
    }
    sfx('box');
    act('throwBox', { productId: b.productId }); changed('sidewalk');
  };
  const tickFlying = (dt: number): void => {
    if (!flying.length) return;
    const bin = binPos();
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i]!;
      f.t += dt;
      const n = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / n;
      let done: 'bin' | 'floor' | null = null;
      for (let k = 0; k < n && !done; k++) {
        f.vel.y -= GRAV * h;
        let nx = f.pos.x + f.vel.x * h, ny = f.pos.y + f.vel.y * h, nz = f.pos.z + f.vel.z * h;
        if (Math.hypot(nx - bin.x, nz - bin.z) < BIN_R && ny < 1.3 && f.vel.y < 0) { f.pos.set(nx, ny, nz); done = 'bin'; break; }
        const bottom = ny - BOX_H / 2, prevBottom = f.pos.y - BOX_H / 2;
        const hx = collider.obstacleHeight(nx + Math.sign(f.vel.x) * 0.22, f.pos.z);
        if (hx > bottom && prevBottom < hx - 1e-3) { f.vel.x *= -0.3; nx = f.pos.x; }
        const hz = collider.obstacleHeight(f.pos.x, nz + Math.sign(f.vel.z) * 0.22);
        if (hz > bottom && prevBottom < hz - 1e-3) { f.vel.z *= -0.3; nz = f.pos.z; }
        const hh = collider.obstacleHeight(nx, nz);
        const floor = (hh > 0 && hh < 3 && prevBottom >= hh - 0.05 ? hh : 0) + BOX_H / 2;
        if (ny <= floor) {
          ny = floor;
          if (f.vel.y < -1.4 && f.bounces < 2) { f.vel.y = -f.vel.y * 0.28; f.vel.x *= 0.5; f.vel.z *= 0.5; f.spin.multiplyScalar(0.4); f.bounces++; } else done = 'floor';
        }
        if (collider.indoors(nx, nz) && ny > 2.75) { ny = 2.75; f.vel.y = -Math.abs(f.vel.y) * 0.3; }
        f.pos.set(nx, ny, nz);
      }
      f.view.root.position.copy(f.pos);
      if (!done) {
        f.view.root.rotation.x += f.spin.x * dt;
        f.view.root.rotation.y += f.spin.y * dt;
        f.view.root.rotation.z += f.spin.z * dt;
        if (f.t > 4) done = 'floor';
      }
      if (done) { flying.splice(i, 1); land(f, done); }
    }
  };

  /* ---------------- largar (prévia do world) ---------------- */
  const dropFront = (b: Box): void => {
    const p = dropPoint(pos.x - Math.sin(yaw) * 0.95, pos.z - Math.cos(yaw) * 0.95);
    if (!putDown(b, p.x, p.z, yaw)) return;
    sfx('box');
    act('dropBox', { productId: b.productId }); changed('sidewalk');
  };
  const dropTop = (): void => {
    if (!canAct() || !carried.length) return;
    const b = top()!;
    pendingBox = { box: b, t: 0 };
    holding = null;
    emit('build:box', { boxIndex: idxOf(b) });
    if (building && pendingBox) { placingBox = b; pendingBox = null; } // o world respondeu na hora
    haptic(8);
  };
  const endBuild = (): void => {
    building = false;
    const b = placingBox;
    placingBox = null;
    if (b) {
      if (!b.carried && st().sidewalk.includes(b)) {
        removeCarried(b);
        act('dropBox', { productId: b.productId }); changed('sidewalk');
      } else if (b.carried && st().sidewalk.includes(b) && !carried.includes(b)) { carried.push(b); syncTop(); } // cancelado
    }
    svc.mode = seat ? 'seated' : 'walk';
  };

  /* ---------------- botão de ação (tocar / segurar) ---------------- */
  const actionDown = (): void => {
    pressed = true;
    if (!canAct()) return;
    resolve();
    const a = primary;
    if (!a) return;
    if (!a.enabled) { controls.denied(); sfx('error'); haptic(25); return; }
    const r = a.run?.();
    if (a.hold && r !== false) holding = { key: a.key, t: 0 };
  };
  const actionUp = (): void => { pressed = false; holding = null; };
  const tickHold = (dt: number): void => {
    if (!holding) return;
    if (!pressed || !canAct()) { holding = null; return; }
    holding.t += dt;
    while (holding && holding.t >= PLACE_INTERVAL) {
      holding.t -= PLACE_INTERVAL;
      const a = primary;
      if (!a || a.key !== holding.key || !a.enabled || !a.hold || a.run?.() === false) { holding = null; break; }
      resolve();
    }
  };

  /* ---------------- módulo ---------------- */
  return {
    name: 'player',
    init(c) {
      ctx = c;
      collider = new Collider(() => ctx.state, () => ctx.services.world);
      tpls = new ProductTemplates(() => {
        const w = ctx.services.world;
        return w?.makeProductMesh ? (pid: string) => w.makeProductMesh!(pid) : undefined;
      });
      held = new HeldView(ctx.scene, tpls);
      worldKit = new CartonKit(false);
      fbPicks = new FallbackPicks();
      fbHL = new FallbackHighlight(ctx.scene);
      controls = new Controls(ctx.uiRoot, {
        actionDown, actionUp, throwBox: throwTop, dropBox: dropTop, toggleBox: toggleTop, secondary: doSecondary, exitSeat: stand,
      });
      input = new Input(controls.root, ctx.renderer.domElement);
      input.onActionDown = actionDown;
      input.onActionUp = actionUp;
      input.onThrow = throwTop;
      input.onDrop = dropTop;
      input.onToggleBox = toggleTop;
      input.onSecondary = doSecondary;
      input.onTap = onTap;

      svc = { position: new THREE.Vector3(), carrying: null, carryingAll: carried, inputLocked: false, atCounter: null, seatedAt: null, mode: 'walk' };
      ctx.services.player = svc;
      const pick: PickService = { add: (o, fn) => { tapTargets.set(o, fn); }, remove: (o) => { tapTargets.delete(o); } };
      ctx.services.pick = pick;

      try { prefs.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* sem matchMedia */ }
      try { applyPrefs(JSON.parse(localStorage.getItem('mercadinho:settings') ?? 'null') ?? undefined); } catch { applyPrefs(); }
      capNow = readCap();

      // início: de frente para o balcão (computador à vista), do lado do cliente
      const s = ctx.state, b = storeBounds(s.expansion);
      let sx = b.width / 2, sz = b.depth - 2.5;
      yaw = 0;
      const counter = s.furniture.find((f) => f.type === 'counter');
      if (counter) {
        const r = furnRect(counter), cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
        const a = (counter.rot * Math.PI) / 180, fx = Math.sin(a), fz = Math.cos(a);
        sx = cx + fx * 2.3; sz = cz + fz * 2.3;
        yaw = Math.atan2(fx, fz);
      }
      const p0 = collider.findFree(sx, sz, RADIUS);
      pos.x = p0.x; pos.z = p0.z;
      svc.position.set(pos.x, 0, pos.z);
      // caixas "carregadas" de um save: soltar perto do jogador
      for (const bx of s.sidewalk) {
        if (!bx.carried) continue;
        const p = dropPoint(pos.x + 0.9, pos.z + 0.4);
        putDown(bx, p.x, p.z, 0);
      }
      ctx.camera.fov = FOV;
      ctx.camera.near = 0.05;
      ctx.camera.updateProjectionMatrix();
      desiredPose();
      ctx.camera.position.copy(wantPos);
      ctx.camera.quaternion.copy(wantQuat);

      const on = (n: string, fn: (p?: never) => void): void => { offs.push(ctx.bus.on(n, fn as (p?: unknown) => void)); };
      on('ui:modal', (e?: { open?: boolean }) => {
        locked = !!e?.open;
        svc.inputLocked = locked;
        input.setLocked(locked || override);
        if (locked) { holding = null; pressed = false; controls.release(); vel.set(0, 0); }
      });
      on('camera:override', (e?: { active?: boolean }) => {
        const a = !!e?.active;
        if (a === override) return;
        override = a;
        vel.set(0, 0); holding = null;
        input.setLocked(a || locked);
        if (!a) startTrans(0.6);
      });
      on('build:state', (e?: { active?: boolean; kind?: string }) => {
        if (e?.active) {
          building = true;
          if (pendingBox && (e.kind === 'box' || e.kind === undefined)) { placingBox = pendingBox.box; pendingBox = null; }
          holding = null;
          setTarget(null);
          if (!seat) svc.mode = 'build';
        } else endBuild();
      });
      on('build:end', () => { if (building || placingBox) endBuild(); });
      on('settings:changed', (p?: { reduceMotion?: unknown; haptics?: unknown; fontSize?: unknown; colorblind?: unknown }) => applyPrefs(p));

      const w = window as unknown as { __player?: unknown };
      w.__player = {
        svc, input, controls,
        cam: () => ({ yaw, pitch, seatYaw, seatPitch, eye: ctx.camera.position.toArray(), fov: ctx.camera.fov, mode: svc.mode, trans: trans.on }),
        pos: () => ({ x: pos.x, z: pos.z }),
        teleport: (x: number, z: number, ya?: number, pi?: number) => {
          pos.x = x; pos.z = z;
          if (ya != null) yaw = ya;
          if (pi != null) pitch = clamp(pi, PITCH_MIN, PITCH_MAX);
          vel.set(0, 0); trans.on = false; svc.position.set(x, 0, z);
        },
        look: (ya: number, pi: number) => { yaw = ya; pitch = clamp(pi, PITCH_MIN, PITCH_MAX); },
        /** Aponta a mira para um ponto do mundo (a partir da posição atual dos olhos). */
        lookAt: (x: number, y: number, z: number) => {
          const dx = x - pos.x, dy = y - EYE, dz = z - pos.z;
          yaw = Math.atan2(-dx, -dz); pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), PITCH_MIN, PITCH_MAX);
        },
        target: () => (target ? { kind: target.pick.kind, id: target.pick.id ?? null, dist: +target.dist.toFixed(2) } : null),
        actions: () => ({ primary: primary ? { label: primary.label, enabled: primary.enabled } : null, secondary: secondary?.label ?? null }),
        forceTarget: (p: PickInfo | null) => { forced = p; setTarget(null); },
        press: () => { actionDown(); actionUp(); },
        actionDown, actionUp,
        throwBox: throwTop, dropBox: dropTop, toggleBox: toggleTop, secondary: doSecondary,
        sit: (id?: number) => sit(id ?? st().furniture.find((f) => f.type === 'counter')?.id ?? -1),
        stand,
        capacity: () => capNow,
        forceCap: (n: number | null) => { capForce = n; capNow = readCap(); },
        held: () => held.info(),
        flying: () => flying.length,
        mopping: () => !!mopping,
        tap: (x: number, y: number) => onTap(x, y),
        picks: () => tapTargets.size,
        usingFallback: () => ({ picks: !(world()?.pickGroup?.children.length), highlight: !world()?.highlight, seat: !world()?.seatPose, product: !world()?.makeProductMesh }),
        dropAll: () => { for (const bx of [...carried]) dropFront(bx); },
      };
    },

    update(dtIn) {
      const dt = clamp(dtIn, 0, 0.1);
      const s = ctx.state;
      for (let i = carried.length - 1; i >= 0; i--) {
        const b = carried[i]!;
        if (b === placingBox) continue;
        if (!b.carried || !s.sidewalk.includes(b)) carried.splice(i, 1);
      }
      syncTop();
      capNow = readCap();
      input.actionKeys = !building && !seat;
      input.poll();
      applyLook();
      if (!seat) updateMove(dt);
      updateCamera(dt);
      if (!seat) svc.position.set(pos.x, 0, pos.z);

      tickFlying(dt);
      tickMop(dt);
      if (pendingBox) {
        pendingBox.t += dt;
        if (building) { placingBox = pendingBox.box; pendingBox = null; }
        else if (pendingBox.t > 0.3) { // o world não abriu a prévia: solta à frente
          const b = pendingBox.box;
          pendingBox = null;
          if (carried.includes(b)) dropFront(b);
        }
      }
      if (signCheck >= 0) {
        signCheck += dt;
        if (signCheck > 0.4) {
          signCheck = -1;
          if (ctx.clock.phase === 'prep' && !locked) { ctx.clock.openStore(); sfx('door'); }
        }
      }

      if (canAct() || holding) updateTarget(dt); else if (target || hlKey) setTarget(null);
      resolve();
      tickHold(dt);

      heldList.length = carried.length;
      for (let i = 0; i < carried.length; i++) {
        const b = carried[i]!;
        const h = heldList[i] ?? (heldList[i] = { ref: b, pid: '', units: 0, open: false });
        h.ref = b; h.pid = b.productId; h.units = b.units; h.open = isOpen(b);
      }
      const tb = top();
      held.update(ctx.camera, dt, {
        boxes: heldList, dolly: capNow > 1, hideTop: !!placingBox && placingBox === tb,
        walk: seat ? 0 : bobAmp, lookYaw: lookYawFrame, lookPitch: lookPitchFrame,
        reduce: prefs.reduceMotion, mop: mopping ? mopping.t / MOP_TIME : null,
      });

      const off = locked || override;
      controls.setView({ off, noAct: building || !!mopping || !!pendingBox, seated: !!seat });
      controls.setAction(primary?.label ?? null, primary ? (primary.enabled ? 'ready' : 'disabled') : 'none');
      controls.setExtras(carried.length > 0 && !placingBox, tb ? isOpen(tb) : null, held.busy(), secondary?.label ?? null);
      const showStick = !seat && !off;
      if (showStick !== stickShown) { stickShown = showStick; input.setStickVisible(showStick); }
      controls.update(dt);
    },

    dispose() {
      for (const o of offs) o();
      setTarget(null);
      for (const f of flying) f.view.dispose();
      flying.length = 0;
      input.dispose();
      controls.dispose();
      held.dispose();
      worldKit.dispose();
      tpls.dispose();
      fbPicks.dispose();
      fbHL.dispose();
      disposeShared();
      tapTargets.clear();
      delete (window as unknown as { __player?: unknown }).__player;
      if (ctx.services.player === svc) delete ctx.services.player;
      if (ctx.services.pick) delete ctx.services.pick;
    },
  };
}
