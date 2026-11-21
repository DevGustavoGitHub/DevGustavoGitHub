import * as THREE from 'three';
import type { GameContext, GameModule } from '../core/module';
import type { PlayerService, Vec2 } from '../core/services';
import {
  DOOR_WIDTH, FURNITURE_FOOTPRINT, SIDEWALK_DEPTH, STORAGE_DEPTH,
  deliveryZone, doorX, storeBounds, trashBinPos,
} from '../core/layout';
import type { Box, Furniture } from '../sim/state';
import { productById } from '../sim/catalog';
import * as api from '../sim/api';
import { Avatar, CarryBoxFactory } from './avatar';
import { Input } from './input';

const RADIUS = 0.28;
const WALK_SPEED = 4.2;
const CARRY_SPEED = 3.4;
const ACCEL = 26;
const DECEL = 34;
const PLACE_INTERVAL = 0.12;
const PLACE_RANGE = 1.6;
const PICK_RANGE = 1.5;
const DIRT_RANGE = 1.3;
const EDIT_RANGE = 1.5;
const COUNTER_RANGE = 1.4;
const BIN_RANGE = 2.4;
const STEP_DIST = 0.8;

interface Cand { label: string; run: () => void }

const isStockFurniture = (f: Furniture): boolean => f.type === 'shelf' || f.type === 'fridge' || f.type === 'freezer';

export default function create(): GameModule {
  let ctx: GameContext;
  let avatar: Avatar;
  let boxes: CarryBoxFactory;
  let input: Input;
  let svc: PlayerService;
  const offs: (() => void)[] = [];

  // câmera
  let yaw = 0.35, pitch = 0.9, dist = 10;
  let yawT = yaw, pitchT = pitch, distT = dist;
  const lookAt = new THREE.Vector3();
  const tmpObj = new THREE.Object3D();
  const startPos = new THREE.Vector3();
  const startQuat = new THREE.Quaternion();
  const wantPos = new THREE.Vector3();
  let override = false;
  let blend = 1;

  // movimento
  const vel = new THREE.Vector2();
  let faceYaw = 0;
  let stepAcc = 0;
  let speedNow = 0;

  // interação
  let pollT = 0;
  let cur: Cand | null = null;
  let curEdit: Cand | null = null;
  let lastLabel: string | null | undefined;
  let lastEditLabel: string | null | undefined;
  let placing: { box: Box; placed: number; t: number } | null = null;
  let badge: HTMLDivElement;
  let badgeT = 0;
  let carriedMeshFor: Box | null = null;

  /* ---------------- colisão ---------------- */
  const furnRect = (f: Furniture): { x0: number; z0: number; x1: number; z1: number } => {
    const fp = FURNITURE_FOOTPRINT[f.type];
    const sw = f.rot === 90 || f.rot === 270;
    return { x0: f.x, z0: f.z, x1: f.x + (sw ? fp.d : fp.w), z1: f.z + (sw ? fp.w : fp.d) };
  };
  const rectDist = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): number =>
    Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

  const fallbackWalkable = (x: number, z: number): boolean => {
    const b = storeBounds(ctx.state.expansion);
    const zMin = ctx.state.storageUnlocked ? -STORAGE_DEPTH : 0;
    if (x < 0 || x > b.width || z < zMin || z > b.depth + SIDEWALK_DEPTH) return false;
    if (Math.abs(z - b.depth) < 0.15 && Math.abs(x - doorX(b)) > DOOR_WIDTH / 2) return false;
    if (ctx.state.storageUnlocked && Math.abs(z) < 0.15 && Math.abs(x - doorX(b)) > DOOR_WIDTH / 2) return false;
    for (const f of ctx.state.furniture) {
      const r = furnRect(f);
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return false;
    }
    return true;
  };
  const walkable = (x: number, z: number): boolean => {
    const w = ctx.services.world;
    if (!w) return fallbackWalkable(x, z);
    const b = storeBounds(ctx.state.expansion);
    const zMin = ctx.state.storageUnlocked ? -STORAGE_DEPTH : 0;
    if (x < 0.1 || x > b.width - 0.1 || z < zMin + 0.1 || z > b.depth + SIDEWALK_DEPTH - 0.1) return false;
    return w.isWalkable(x, z);
  };
  const SAMPLES = 8;
  const circleOk = (x: number, z: number): boolean => {
    if (!walkable(x, z)) return false;
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * Math.PI * 2;
      if (!walkable(x + Math.cos(a) * RADIUS, z + Math.sin(a) * RADIUS)) return false;
    }
    return true;
  };
  /** Move com deslize; devolve true se saiu do lugar. */
  const moveSlide = (dx: number, dz: number): void => {
    const p = svc.position;
    if (!circleOk(p.x, p.z)) { p.x += dx; p.z += dz; return; } // preso dentro de algo: deixa sair
    if (circleOk(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return; }
    let mx = false, mz = false;
    if (dx !== 0 && circleOk(p.x + dx, p.z)) { p.x += dx; mx = true; }
    if (dz !== 0 && circleOk(p.x, p.z + dz)) { p.z += dz; mz = true; }
    if (!mx) vel.x = 0;
    if (!mz) vel.y = 0;
  };

  const findFree = (x: number, z: number): Vec2 => {
    if (circleOk(x, z)) return { x, z };
    for (let r = 0.5; r <= 5; r += 0.5) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
        if (circleOk(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  };

  /* ---------------- utilidades de ação ---------------- */
  const toastErr = (e: unknown): void =>
    ctx.bus.emit('toast', { text: e instanceof Error ? e.message : String(e), kind: 'bad' });
  const haptic = (ms = 10): void => { try { navigator.vibrate?.(ms); } catch { /* ignora */ } };
  const changed = (what: string): void => ctx.bus.emit('stateChanged', { what });
  const idxOf = (b: Box): number => ctx.state.sidewalk.indexOf(b);
  const aheadPos = (d: number): Vec2 => findFree(svc.position.x + Math.sin(faceYaw) * d, svc.position.z + Math.cos(faceYaw) * d);
  const boxPos = (b: Box): Vec2 => {
    if (b.x != null && b.z != null) return { x: b.x, z: b.z };
    const dz = deliveryZone(storeBounds(ctx.state.expansion));
    return { x: dz.x + dz.w / 2, z: dz.z + dz.d / 2 };
  };
  const capacityOf = (pid: string): number => {
    try { return api.productCapacity(ctx.state, pid); } catch { return Infinity; }
  };
  const nameOf = (pid: string): string => { try { return productById(pid).name; } catch { return pid; } };

  const setCarrying = (b: Box | null): void => {
    svc.carrying = b;
    if (b === carriedMeshFor) return;
    carriedMeshFor = b;
    avatar.attachCarry(b ? boxes.get(b.productId, nameOf(b.productId)) : null);
  };

  const dropBox = (): void => {
    const b = svc.carrying;
    if (!b) return;
    const p = aheadPos(0.9);
    b.carried = false; b.x = p.x; b.z = p.z;
    setCarrying(null);
    placing = null;
    ctx.bus.emit('sfx', { name: 'box' });
    changed('sidewalk');
  };
  const pickBox = (b: Box): void => {
    if (svc.carrying) dropBox();
    b.carried = true;
    setCarrying(b);
    ctx.bus.emit('sfx', { name: 'box' });
    haptic(15);
    changed('sidewalk');
  };

  const showBadge = (text: string): void => {
    badge.textContent = text;
    badge.style.opacity = '1';
    badgeT = 1.4;
  };

  const startPlacing = (b: Box): void => {
    placing = { box: b, placed: 0, t: 0 };
  };

  /* ---------------- candidatos de interação ---------------- */
  const nearestFurniture = (pred: (f: Furniture) => boolean, range: number): Furniture | null => {
    let best: Furniture | null = null, bd = range;
    const p = svc.position;
    for (const f of ctx.state.furniture) {
      if (!pred(f)) continue;
      const d = rectDist(furnRect(f), p.x, p.z);
      if (d <= bd) { bd = d; best = f; }
    }
    return best;
  };

  const evaluate = (): void => {
    cur = null; curEdit = null;
    const st = ctx.state;
    const p = svc.position;
    const carry = svc.carrying;
    const w = ctx.services.world;

    if (carry) {
      // 1) Pôr itens na prateleira
      if (carry.units > 0) {
        const f = nearestFurniture((q) => isStockFurniture(q) && q.productId === carry.productId, PLACE_RANGE);
        if (f && (st.shelf[carry.productId] ?? 0) < capacityOf(carry.productId)) {
          cur = { label: `Repor ${nameOf(carry.productId)} (${carry.units})`, run: () => startPlacing(carry) };
        }
      }
      // 2) Lixeira externa com caixa vazia
      const bin = w ? w.trashBin() : trashBinPos(storeBounds(st.expansion));
      if (!cur && carry.units === 0 && Math.hypot(bin.x - p.x, bin.z - p.z) <= BIN_RANGE) {
        cur = {
          label: 'Jogar caixa fora',
          run: () => {
            try {
              api.discardBox(st, idxOf(carry));
              setCarrying(null);
              ctx.bus.emit('sfx', { name: 'trash' });
              changed('sidewalk');
              haptic(12);
            } catch (e) { toastErr(e); }
          },
        };
      }
      // 3) Guardar no depósito
      if (!cur && st.storageUnlocked && p.z < 0.2) {
        cur = {
          label: 'Guardar no depósito',
          run: () => {
            try {
              api.storeBox(st, idxOf(carry));
              setCarrying(null);
              ctx.bus.emit('sfx', { name: 'box' });
              changed('storage');
            } catch (e) { toastErr(e); }
          },
        };
      }
      // 4) Trocar por outra caixa próxima
      if (!cur) {
        let nb: Box | null = null, nd = PICK_RANGE;
        for (const b of st.sidewalk) {
          if (b === carry || b.carried) continue;
          const bp = boxPos(b), d = Math.hypot(bp.x - p.x, bp.z - p.z);
          if (d <= nd) { nd = d; nb = b; }
        }
        if (nb) { const t = nb; cur = { label: `Trocar: ${nameOf(t.productId)}`, run: () => pickBox(t) }; }
      }
      // 5) Largar
      if (!cur) cur = { label: 'Largar caixa', run: dropBox };
    } else {
      let bestD = Infinity;
      for (const b of st.sidewalk) {
        if (b.carried) continue;
        const bp = boxPos(b), d = Math.hypot(bp.x - p.x, bp.z - p.z);
        if (d <= PICK_RANGE && d < bestD) {
          bestD = d;
          cur = { label: `Pegar ${nameOf(b.productId)} (${b.units})`, run: () => pickBox(b) };
        }
      }
      let di = -1, dd = DIRT_RANGE;
      for (let i = 0; i < st.dirt.length; i++) {
        const dt0 = st.dirt[i]!;
        const d = Math.hypot(dt0.x - p.x, dt0.z - p.z);
        if (d <= dd && d < bestD) { dd = d; di = i; }
      }
      if (di >= 0) {
        const i = di;
        cur = {
          label: 'Limpar',
          run: () => {
            try {
              api.cleanDirt(st, i);
              ctx.bus.emit('sfx', { name: 'pop' });
              changed('dirt');
              haptic(8);
            } catch (e) { toastErr(e); }
          },
        };
        bestD = dd;
      }
      if (!cur && st.storageUnlocked && p.z < 0.2) {
        let pid: string | null = null, ratio = Infinity;
        for (const k of Object.keys(st.storage)) {
          if ((st.storage[k] ?? 0) <= 0) continue;
          const r = (st.shelf[k] ?? 0) / Math.max(1, capacityOf(k));
          if (r < ratio) { ratio = r; pid = k; }
        }
        if (pid) {
          const id = pid;
          cur = {
            label: `Retirar ${nameOf(id)}`,
            run: () => {
              try {
                const idx = api.takeFromStorage(st, id, true);
                const b = st.sidewalk[idx];
                if (b) { b.carried = true; setCarrying(b); ctx.bus.emit('sfx', { name: 'box' }); changed('storage'); }
              } catch (e) { toastErr(e); }
            },
          };
        }
      }
    }

    // Mover móvel
    const ef = nearestFurniture(() => true, EDIT_RANGE);
    if (ef) {
      const id = ef.id;
      curEdit = { label: 'Mover', run: () => ctx.bus.emit('build:edit', { furnitureId: id }) };
      if (!cur) { cur = curEdit; curEdit = null; }
    }
  };

  const publish = (): void => {
    const off = svc.inputLocked || override;
    const l = off ? null : cur?.label ?? null;
    if (l !== lastLabel) {
      lastLabel = l;
      ctx.bus.emit('interact:prompt', l ? { label: l, action: doPrimary } : { label: null });
    }
    const e = off ? null : curEdit?.label ?? null;
    if (e !== lastEditLabel) {
      lastEditLabel = e;
      ctx.bus.emit('interact:secondary', e ? { label: e, action: doSecondary } : { label: null });
    }
  };
  const doPrimary = (): void => {
    if (svc.inputLocked || override) return;
    if (placing) return;
    evaluate();
    cur?.run();
  };
  const doSecondary = (): void => {
    if (svc.inputLocked || override) return;
    evaluate();
    curEdit?.run();
  };

  /* ---------------- reposição contínua ---------------- */
  const tickPlacing = (dt: number): void => {
    if (!placing) return;
    const pl = placing;
    const b = pl.box;
    const f = nearestFurniture((q) => isStockFurniture(q) && q.productId === b.productId, PLACE_RANGE + 0.8);
    if (svc.inputLocked || override || svc.carrying !== b || !f) { placing = null; return; }
    pl.t += dt;
    while (pl.t >= PLACE_INTERVAL && placing) {
      pl.t -= PLACE_INTERVAL;
      let moved = 0;
      try { moved = api.placeUnits(ctx.state, idxOf(b), 1); } catch (e) { toastErr(e); placing = null; break; }
      if (moved <= 0) {
        if (b.units > 0) ctx.bus.emit('toast', { text: 'Prateleira cheia', kind: 'info' });
        placing = null;
        break;
      }
      pl.placed += moved;
      ctx.bus.emit('sfx', { name: 'pop', pan: 0 });
      changed('shelf');
      haptic(5);
      const cap = capacityOf(b.productId);
      showBadge(`+${pl.placed}  ·  ${nameOf(b.productId)} ${ctx.state.shelf[b.productId] ?? 0}${cap === Infinity ? '' : '/' + cap}  ·  caixa: ${b.units}`);
      if (b.units <= 0) { placing = null; evaluate(); }
    }
  };

  /* ---------------- câmera ---------------- */
  const desiredPose = (): void => {
    const cp = Math.cos(pitch);
    wantPos.set(
      lookAt.x + Math.sin(yaw) * cp * dist,
      lookAt.y + Math.sin(pitch) * dist,
      lookAt.z + Math.cos(yaw) * cp * dist,
    );
  };

  const updateCamera = (dt: number): void => {
    const cam = ctx.camera;
    if (override) {
      input.dYaw = input.dPitch = 0; input.zoomMul = 1;
      return;
    }
    if (!input.locked) {
      yawT += input.dYaw;
      pitchT = Math.min(1.3, Math.max(0.28, pitchT + input.dPitch));
      distT = Math.min(18, Math.max(4.5, distT * input.zoomMul));
    }
    input.dYaw = input.dPitch = 0; input.zoomMul = 1;
    const k = 1 - Math.exp(-dt * 14);
    yaw += (yawT - yaw) * k;
    pitch += (pitchT - pitch) * k;
    dist += (distT - dist) * k;
    const kf = 1 - Math.exp(-dt * 9);
    const p = svc.position;
    lookAt.x += (p.x - lookAt.x) * kf;
    lookAt.y += (1.0 - lookAt.y) * kf;
    lookAt.z += (p.z - lookAt.z) * kf;
    desiredPose();
    if (blend < 1) {
      blend = Math.min(1, blend + dt / 0.7);
      const e = blend * blend * (3 - 2 * blend);
      tmpObj.position.copy(wantPos);
      tmpObj.lookAt(lookAt);
      cam.position.lerpVectors(startPos, wantPos, e);
      cam.quaternion.slerpQuaternions(startQuat, tmpObj.quaternion, e);
    } else {
      cam.position.copy(wantPos);
      cam.lookAt(lookAt);
    }
  };

  /* ---------------- módulo ---------------- */
  return {
    name: 'player',
    init(c) {
      ctx = c;
      avatar = new Avatar();
      boxes = new CarryBoxFactory();
      ctx.scene.add(avatar.root);
      input = new Input(ctx.uiRoot, ctx.renderer.domElement);
      input.onAction = () => doPrimary();
      input.onSecondary = () => doSecondary();

      badge = document.createElement('div');
      badge.style.cssText =
        'position:fixed;left:50%;top:22%;transform:translateX(-50%);padding:8px 16px;border-radius:20px;' +
        'background:rgba(20,24,30,.78);color:#fff;font:600 16px system-ui,sans-serif;pointer-events:none;' +
        'opacity:0;transition:opacity .25s;z-index:6;white-space:nowrap';
      ctx.uiRoot.appendChild(badge);

      svc = {
        position: new THREE.Vector3(),
        carrying: null,
        inputLocked: false,
        atCounter: null,
        setAppearance: (col) => avatar.setColors(col),
      };
      ctx.services.player = svc;

      // posição inicial: perto do balcão
      const b = storeBounds(ctx.state.expansion);
      let sx = b.width / 2 + 2.5, sz = b.depth - 3;
      const wc = ctx.services.world?.counters()[0];
      const counter = ctx.state.furniture.find((f) => f.type === 'counter');
      if (wc) { sx = wc.operator.x; sz = wc.operator.z; }
      else if (counter) { const r = furnRect(counter); sx = (r.x0 + r.x1) / 2; sz = r.z1 + 0.9; }
      const s = findFree(sx, sz);
      svc.position.set(s.x, 0, s.z);
      faceYaw = Math.PI; // olhando para o fundo da loja
      avatar.root.rotation.y = faceYaw;
      lookAt.set(s.x, 1, s.z);
      yaw = yawT = 0.35;

      // caixas "carregadas" salvas: soltar perto do jogador
      for (const bx of ctx.state.sidewalk) {
        if (!bx.carried) continue;
        const p = findFree(s.x + 0.8, s.z + 0.5);
        bx.carried = false; bx.x = p.x; bx.z = p.z;
      }

      desiredPose();
      ctx.camera.position.copy(wantPos);
      ctx.camera.lookAt(lookAt);

      offs.push(ctx.bus.on('ui:modal', (e?: { open: boolean }) => {
        svc.inputLocked = !!e?.open;
        input.setLocked(svc.inputLocked);
        if (svc.inputLocked) placing = null;
        vel.set(0, 0);
      }));
      offs.push(ctx.bus.on('camera:override', (e?: { active: boolean }) => {
        const a = !!e?.active;
        if (a === override) return;
        override = a;
        vel.set(0, 0);
        placing = null;
        if (!a) {
          startPos.copy(ctx.camera.position);
          startQuat.copy(ctx.camera.quaternion);
          blend = 0;
          lookAt.set(svc.position.x, 1, svc.position.z);
        }
      }));
    },

    update(dt) {
      const p = svc.position;
      // validade da caixa carregada
      if (svc.carrying && idxOf(svc.carrying) < 0) { svc.carrying = null; placing = null; }
      if (svc.carrying !== carriedMeshFor) setCarrying(svc.carrying);

      input.poll();
      const active = !svc.inputLocked && !override;
      const mx = active ? input.moveX : 0, my = active ? input.moveY : 0;
      const mag = Math.min(1, Math.hypot(mx, my));
      if (active) {
        const sy = Math.sin(yaw), cy = Math.cos(yaw);
        // frente da câmera no plano = (-sin, -cos); direita = (cos, -sin)
        const wx = cy * mx - sy * my;
        const wz = -sy * mx - cy * my;
        const sp = (svc.carrying ? CARRY_SPEED : WALK_SPEED) * mag;
        const l = Math.hypot(wx, wz) || 1;
        const tx = (wx / l) * sp, tz = (wz / l) * sp;
        const a = (mag > 0 ? ACCEL : DECEL) * dt;
        const dx = tx - vel.x, dz = tz - vel.y;
        const dl = Math.hypot(dx, dz);
        if (dl <= a) { vel.x = tx; vel.y = tz; } else { vel.x += (dx / dl) * a; vel.y += (dz / dl) * a; }
        const bx = p.x, bz = p.z;
        moveSlide(vel.x * dt, vel.y * dt);
        speedNow = Math.hypot(p.x - bx, p.z - bz) / Math.max(dt, 1e-4);
        if (mag > 0.1 && speedNow > 0.5) {
          const target = Math.atan2(vel.x, vel.y);
          let d = target - faceYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          faceYaw += d * (1 - Math.exp(-dt * 14));
        }
        stepAcc += speedNow * dt;
        if (stepAcc >= STEP_DIST) { stepAcc = 0; ctx.bus.emit('sfx', { name: 'step' }); }
      } else {
        speedNow = 0;
      }

      avatar.root.position.copy(p);
      avatar.root.rotation.y = faceYaw;
      avatar.animate(dt, speedNow, !!svc.carrying);

      // presença no balcão
      let at: number | null = null;
      const w = ctx.services.world;
      if (w) {
        for (const c of w.counters()) {
          if (Math.hypot(c.operator.x - p.x, c.operator.z - p.z) <= COUNTER_RANGE) { at = c.furnitureId; break; }
        }
      } else {
        const f = nearestFurniture((q) => q.type === 'counter', COUNTER_RANGE);
        at = f ? f.id : null;
      }
      svc.atCounter = at;

      // interação
      pollT -= dt;
      if (pollT <= 0) { pollT = 0.1; evaluate(); publish(); }
      tickPlacing(dt);
      if (badgeT > 0) { badgeT -= dt; if (badgeT <= 0) badge.style.opacity = '0'; }

      updateCamera(dt);
    },

    dispose() {
      for (const o of offs) o();
      input.dispose();
      badge.remove();
      ctx.scene.remove(avatar.root);
      avatar.dispose();
      boxes.dispose();
      if (ctx.services.player === svc) delete ctx.services.player;
    },
  };
}
