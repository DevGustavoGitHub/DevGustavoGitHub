/** Funcionários: caixa, repositor e faxineiro. */
import * as api from '../sim/api';
import type { Box } from '../sim/state';
import { STORAGE_DEPTH, storeBounds } from '../core/layout';
import type { Lane } from './checkout';
import { Agent } from './agent';
import { furnitureFor, shelfRoom } from './helpers';
import { Person, staffSpec } from './model';
import { type Env, dist2, safe } from './shared';

export type StaffRole = 'cashier' | 'stocker' | 'janitor';

export abstract class Staff extends Agent {
  /** Ponto de descanso (casa). */
  homeX = 0;
  homeZ = 0;
  constructor(env: Env, readonly role: StaffRole) {
    super(env, new Person(staffSpec(role, env.ctx.rand, Math.floor(env.ctx.rand() * 1000))));
    this.maxSpeed = 1.55;
    this.arriveR = 0.18;
  }
  get level(): number { return this.env.ctx.state.employees[this.role]; }
  setHome(x: number, z: number): void { this.homeX = x; this.homeZ = z; }
  abstract update(dt: number, working: boolean): void;
}

export class Cashier extends Staff {
  lane: Lane | null = null;
  private st: 'idle' | 'toPost' | 'toSeat' | 'seated' = 'idle';
  private laneId = -1;
  constructor(env: Env) { super(env, 'cashier'); this.sepWeight = 0; }
  /** Sentado na cadeira do balcão indicado (pronto para atender). */
  atPost(lane: Lane): boolean { return this.lane === lane && this.st === 'seated'; }
  /** Já começa sentado no posto (ao carregar o jogo). */
  snapToSeat(): void {
    const l = this.lane;
    if (!l) return;
    this.place(l.seat.x, l.seat.z, l.seat.yaw);
    this.faceYaw = l.seat.yaw;
    this.laneId = l.furnitureId;
    this.st = 'seated';
  }
  update(dt: number, _working: boolean): void {
    const lane = this.lane;
    if (!lane) {
      this.st = 'idle'; this.laneId = -1;
      if (this.arrived && this.distTo(this.homeX, this.homeZ) > 0.5) this.moveTo(this.homeX, this.homeZ);
      this.setPose('normal');
      this.step(dt);
      return;
    }
    if (lane.furnitureId !== this.laneId) { this.laneId = lane.furnitureId; this.st = 'idle'; }
    const seat = lane.seat;
    switch (this.st) {
      case 'idle': this.moveTo(lane.operator.x, lane.operator.z); this.st = 'toPost'; break;
      case 'toPost': if (this.arrived) { this.moveTo(seat.x, seat.z, true); this.st = 'toSeat'; } break;
      case 'toSeat':
        if (this.arrived || this.distTo(seat.x, seat.z) < 0.15) { this.place(seat.x, seat.z, seat.yaw); this.faceYaw = seat.yaw; this.st = 'seated'; }
        break;
      case 'seated':
        if (this.distTo(seat.x, seat.z) > 0.35) { this.st = 'idle'; break; } // balcão foi movido
        this.faceYaw = seat.yaw;
        this.person.seatY = seat.y;
        this.setPose(lane.scanning ? 'sitScan' : 'sit', lane.scanning);
        break;
    }
    if (this.st !== 'seated') this.setPose('normal');
    this.step(dt);
  }
}

type SJob = 'idle' | 'toBox' | 'lift' | 'toShelf' | 'open' | 'place' | 'toTrash' | 'toss' | 'toStorage' | 'takeStorage';

/**
 * Repositor: numa viagem recolhe até `cap` caixas (nível 1: 1, nível 2-3: 2, nível 4+: 3) de produtos diferentes
 * e próximas entre si, priorizando os produtos com menor % de estoque na prateleira; depois repõe cada uma
 * e leva as vazias à lixeira de uma vez. Sem caixas na calçada, busca no depósito (também por menor %).
 */
export class Stocker extends Staff {
  job: SJob = 'idle';
  /** Caixas a buscar nesta viagem (ordem de prioridade). */
  private plan: Box[] = [];
  /** Caixas já nas mãos (a primeira é a próxima a repor). */
  private stack: Box[] = [];
  /** Caixas esvaziadas a descartar. */
  private junk: Box[] = [];
  private timer = 0;
  private cooldown = 0;
  private storeCool = 0;
  private furnId = -1;
  private storePids: string[] = [];
  constructor(env: Env) { super(env, 'stocker'); }

  private get cap(): number { return this.level >= 4 ? 3 : this.level >= 2 ? 2 : 1; }

  /** Fração de ocupação da prateleira do produto (0 = vazia). */
  private fill(pid: string): number {
    const have = this.env.ctx.state.shelf[pid] ?? 0;
    const room = shelfRoom(this.env, pid);
    return have / Math.max(1, have + room);
  }

  private release(b: Box): void { b.carried = false; this.env.changed('sidewalk'); }

  private pickJob(): void {
    const { state } = this.env.ctx;
    const player = this.env.ctx.services.player;
    const door = this.env.world().door();
    const cands: Box[] = [];
    for (const b of state.sidewalk) {
      if (b.carried || b.units <= 0 || b === player?.carrying) continue;
      if (shelfRoom(this.env, b.productId) <= 0 || !furnitureFor(this.env, b.productId, this.x, this.z)) continue;
      cands.push(b);
    }
    if (cands.length > 0) {
      // menor % de estoque primeiro; empate: mais perto
      const near = (b: Box): number => dist2(this.x, this.z, b.x ?? door.x, b.z ?? door.z + 1);
      cands.sort((a, b) => (this.fill(a.productId) - this.fill(b.productId)) || (near(a) - near(b)));
      const first = cands[0]!;
      this.plan.length = 0;
      this.plan.push(first);
      for (let i = 1; i < cands.length && this.plan.length < this.cap; i++) {
        const b = cands[i]!;
        if (this.plan.some((p) => p.productId === b.productId)) continue;
        if (dist2(b.x ?? door.x, b.z ?? door.z + 1, first.x ?? door.x, first.z ?? door.z + 1) > 36) continue;
        this.plan.push(b);
      }
      this.job = 'toBox'; this.walkToBox(first);
      return;
    }
    if (state.storageUnlocked && this.storeCool <= 0) {
      const pids = Object.keys(state.storage).filter((pid) => (state.storage[pid] ?? 0) > 0 && shelfRoom(this.env, pid) > 0 && furnitureFor(this.env, pid, this.x, this.z));
      if (pids.length > 0) {
        pids.sort((a, b) => this.fill(a) - this.fill(b));
        const sp = this.storagePoint();
        const p = this.env.world().findPath({ x: this.x, z: this.z }, sp);
        if (!p) { this.storeCool = 15; return; }
        this.storePids = pids.slice(0, this.cap);
        this.job = 'toStorage'; this.moveTo(sp.x, sp.z);
      }
    }
  }
  private tmp = { x: 0, z: 0 };
  private storagePoint(): { x: number; z: number } {
    const b = storeBounds(this.env.ctx.state.expansion);
    return this.env.nearestWalkable(b.width / 2, -Math.min(2, STORAGE_DEPTH / 3), this.tmp);
  }

  private walkToBox(b: Box): void {
    const w = this.env.world();
    const door = w.door();
    this.moveTo(b.x ?? door.x - 2, b.z ?? door.z + 1.2);
  }

  private prune(list: Box[], needFree: boolean): void {
    const { state } = this.env.ctx;
    const player = this.env.ctx.services.player;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]!;
      if (!state.sidewalk.includes(b) || (needFree && (b.carried || b === player?.carrying))) list.splice(i, 1);
    }
  }

  update(dt: number, working: boolean): void {
    this.cooldown -= dt; this.storeCool -= dt;
    const { state } = this.env.ctx;
    if (this.job !== 'idle') {
      this.prune(this.plan, true); this.prune(this.stack, false); this.prune(this.junk, false);
      if ((this.job === 'toBox' || this.job === 'lift') && this.plan.length === 0) {
        // alvo sumiu (jogador pegou): segue com o que já está nas mãos ou volta ao posto
        this.stop();
        if (this.stack.length > 0) this.nextShelf(); else if (this.junk.length > 0) this.finishTrip(); else { this.job = 'idle'; this.cooldown = 1; this.person.setCarryBox(false); this.setPose('normal'); }
      }
    }
    switch (this.job) {
      case 'idle':
        this.setPose('normal');
        if (working && this.cooldown <= 0 && !this.moving) { this.pickJob(); if (this.job === 'idle') this.cooldown = 0.6; }
        if (this.job === 'idle' && !this.moving && this.distTo(this.homeX, this.homeZ) > 0.7) this.moveTo(this.homeX, this.homeZ);
        break;
      case 'toBox':
        if (this.arrived) { this.job = 'lift'; this.timer = 0.5; this.setPose('grab'); }
        break;
      case 'lift':
        this.timer -= dt;
        if (this.timer <= 0) {
          const b = this.plan.shift()!;
          b.carried = true;
          this.stack.push(b);
          this.person.setCarryBox(true); this.boxVisual(b, !!b.open && b.units > 0); this.setPose('carry');
          this.env.sfx('box', this.x, this.z); this.env.changed('sidewalk');
          if (this.plan.length > 0) { this.job = 'toBox'; this.walkToBox(this.plan[0]!); } else this.nextShelf();
        }
        break;
      case 'toShelf':
        if (this.arrived) {
          const f = state.furniture.find((x) => x.id === this.furnId);
          if (f) this.faceTowards(f.x + 0.5, f.z + 0.5);
          // abre a caixa antes de repor (abas abertas, produtos à vista)
          const b = this.stack[0];
          if (b && !this.person.isCarryOpen) { this.setOpen(b, true); this.job = 'open'; this.timer = 0.4; this.setPose('carry'); }
          else { this.job = 'place'; this.timer = this.placeTime(); this.setPose('carry', true); }
        }
        break;
      case 'open':
        this.timer -= dt;
        if (this.timer <= 0) { this.job = 'place'; this.timer = this.placeTime(); this.setPose('carry', true); }
        break;
      case 'place':
        this.timer -= dt;
        if (this.timer <= 0) this.placeUnitsNow();
        break;
      case 'toTrash':
        if (this.arrived) { this.job = 'toss'; this.timer = 0.6; }
        break;
      case 'toss':
        this.timer -= dt;
        if (this.timer <= 0) {
          for (const b of this.junk) {
            const idx = state.sidewalk.indexOf(b);
            if (idx >= 0) safe('discardBox', () => api.discardBox(state, idx), undefined);
          }
          if (this.junk.length > 0) { this.env.sfx('trash', this.x, this.z); this.env.changed('sidewalk'); }
          this.junk.length = 0;
          this.person.setCarryBox(false); this.setPose('normal');
          this.job = 'idle'; this.cooldown = 0.4;
        }
        break;
      case 'toStorage':
        if (this.arrived) { this.job = 'takeStorage'; this.timer = 0.6; this.setPose('grab'); }
        break;
      case 'takeStorage':
        this.timer -= dt;
        if (this.timer <= 0) {
          for (const pid of this.storePids) {
            if (shelfRoom(this.env, pid) <= 0) continue;
            const before = state.sidewalk.length;
            safe('takeFromStorage', () => api.takeFromStorage(state, pid, true), 0);
            const nb = state.sidewalk.length > before ? state.sidewalk[state.sidewalk.length - 1] : undefined;
            if (nb) { nb.carried = true; this.stack.push(nb); }
          }
          this.storePids.length = 0;
          if (this.stack.length > 0) {
            this.person.setCarryBox(true); this.boxVisual(this.stack[0], false); this.setPose('carry');
            this.env.sfx('box', this.x, this.z); this.env.changed('sidewalk');
            this.nextShelf();
          } else { this.job = 'idle'; this.cooldown = 3; this.storeCool = 10; this.setPose('normal'); }
        }
        break;
    }
    this.step(dt);
  }

  /** Vai à prateleira da próxima caixa nas mãos; sem mais caixas, encerra a viagem. */
  private nextShelf(): void {
    while (this.stack.length > 0) {
      const b = this.stack[0]!;
      const f = furnitureFor(this.env, b.productId, this.x, this.z);
      const acc = f ? this.env.world().furnitureAccess(f.id) : null;
      if (f && acc && shelfRoom(this.env, b.productId) > 0) {
        this.furnId = f.id;
        this.moveTo(acc.x, acc.z);
        this.job = 'toShelf';
        return;
      }
      this.stack.shift();
      this.release(b);
    }
    this.finishTrip();
  }

  /** Fim da viagem: vazias para a lixeira (uma vez) ou volta ao posto. */
  private finishTrip(): void {
    if (this.junk.length > 0) {
      const t = this.env.world().trashBin();
      this.moveTo(t.x, t.z);
      this.job = 'toTrash';
      return;
    }
    this.person.setCarryBox(false); this.setPose('normal');
    this.job = 'idle'; this.cooldown = 0.5;
  }

  private placeUnitsNow(): void {
    const b = this.stack[0];
    const { state } = this.env.ctx;
    if (!b) { this.nextShelf(); return; }
    const idx = state.sidewalk.indexOf(b);
    if (idx < 0) { this.stack.shift(); this.nextShelf(); return; }
    const room = shelfRoom(this.env, b.productId);
    const n = Math.min(b.units, Math.max(0, room));
    if (n > 0) {
      safe('placeUnits', () => api.placeUnits(state, idx, n), 0);
      this.env.sfx('box', this.x, this.z); this.env.changed('shelf');
    }
    this.stack.shift();
    if (b.units <= 0) this.junk.push(b);
    else { this.setOpen(b, false); this.release(b); }
    // visual: próxima caixa fechada; só vazias = caixa aberta e vazia
    if (this.stack.length > 0) this.boxVisual(this.stack[0], !!this.stack[0]!.open);
    else this.boxVisual(b, true);
    this.nextShelf();
  }

  /** Visual da caixa nos braços: a do world (makeBoxMesh) quando existir, senão a própria. */
  private boxVisual(b: Box | undefined, open: boolean): void {
    this.person.setCarryOpen(open, b && b.units > 0 ? b.productId : undefined);
    const w = this.env.world();
    const obj = b && w.makeBoxMesh ? safe('makeBoxMesh', () => w.makeBoxMesh!(b.productId, open, b.units), null) : null;
    this.person.setCarryObject(obj);
  }

  private placeTime(): number { return Math.max(0.8, safe('employeeSpeed', () => api.employeeSpeed('stocker', this.level), 3)); }

  /** Abre/fecha a caixa (api.setBoxOpen) com som e visual. */
  private setOpen(b: Box, open: boolean): void {
    const { state } = this.env.ctx;
    const idx = state.sidewalk.indexOf(b);
    if (idx >= 0) safe('setBoxOpen', () => api.setBoxOpen(state, idx, open), undefined);
    this.env.sfx(open ? 'boxOpen' : 'boxClose', this.x, this.z);
    this.boxVisual(b, open);
    this.env.changed('sidewalk');
  }
}

export class Janitor extends Staff {
  private job: 'idle' | 'toDirt' | 'mop' = 'idle';
  private tx2 = 0;
  private tz2 = 0;
  private timer = 0;
  private cooldown = 0;
  private tmp = { x: 0, z: 0 };
  constructor(env: Env) { super(env, 'janitor'); }

  update(dt: number, working: boolean): void {
    this.cooldown -= dt;
    const { state } = this.env.ctx;
    this.person.setMop(true);
    switch (this.job) {
      case 'idle':
        this.setPose('mop');
        if (working && this.cooldown <= 0 && !this.moving && state.dirt.length > 0) this.pickDirt();
        else if (!this.moving && this.distTo(this.homeX, this.homeZ) > 0.7) this.moveTo(this.homeX, this.homeZ);
        break;
      case 'toDirt':
        this.setPose('mop');
        if (this.arrived) { this.job = 'mop'; this.timer = Math.max(0.8, safe('employeeSpeed', () => api.employeeSpeed('janitor', this.level), 3)); this.faceTowards(this.tx2, this.tz2); }
        break;
      case 'mop':
        this.setPose('mop', true);
        this.timer -= dt;
        if (this.timer <= 0) {
          let bi = -1, bd = 1.5;
          for (let i = 0; i < state.dirt.length; i++) {
            const d = dist2(state.dirt[i]!.x, state.dirt[i]!.z, this.tx2, this.tz2);
            if (d < bd) { bd = d; bi = i; }
          }
          if (bi >= 0) {
            const i = bi;
            safe('cleanDirt', () => api.cleanDirt(state, i), undefined);
            this.env.changed('dirt');
          }
          this.job = 'idle'; this.cooldown = 0.3;
        }
        break;
    }
    this.step(dt);
  }

  private pickDirt(): void {
    const { state } = this.env.ctx;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < state.dirt.length; i++) {
      const d = dist2(state.dirt[i]!.x, state.dirt[i]!.z, this.x, this.z);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) return;
    const dd = state.dirt[bi]!;
    this.tx2 = dd.x; this.tz2 = dd.z;
    const p = this.env.nearestWalkable(dd.x, dd.z, this.tmp);
    this.moveTo(p.x, p.z);
    this.job = 'toDirt';
  }
}
