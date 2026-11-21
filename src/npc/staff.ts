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
  private posted = false;
  constructor(env: Env) { super(env, 'cashier'); }
  atPost(lane: Lane): boolean { return this.lane === lane && this.posted; }
  update(dt: number, _working: boolean): void {
    const lane = this.lane;
    if (!lane) {
      this.posted = false;
      if (this.arrived && this.distTo(this.homeX, this.homeZ) > 0.5) this.moveTo(this.homeX, this.homeZ);
      this.setPose('normal');
      this.step(dt);
      return;
    }
    const o = lane.operator;
    if (!this.posted) {
      if (!this.moving && this.distTo(o.x, o.z) > 0.3) this.moveTo(o.x, o.z);
      if (!this.moving && this.distTo(o.x, o.z) <= 0.45) this.posted = true;
    } else if (this.distTo(o.x, o.z) > 0.8) {
      this.posted = false; // contador foi movido
    }
    if (this.posted) {
      const q = lane.queue[0];
      if (q) this.faceTowards(q.x, q.z);
      this.setPose(lane.serving ? 'scan' : 'normal', lane.serving !== null);
    } else this.setPose('normal');
    this.step(dt);
  }
}

type SJob = 'idle' | 'toBox' | 'lift' | 'toShelf' | 'place' | 'toTrash' | 'toss' | 'toStorage' | 'takeStorage';

export class Stocker extends Staff {
  job: SJob = 'idle';
  private box: Box | null = null;
  private timer = 0;
  private cooldown = 0;
  private storeCool = 0;
  private furnId = -1;
  constructor(env: Env) { super(env, 'stocker'); }

  private sidewalkIdx(): number { return this.box ? this.env.ctx.state.sidewalk.indexOf(this.box) : -1; }

  private drop(): void {
    if (this.box) { this.box.carried = false; this.env.changed('sidewalk'); }
    this.box = null; this.person.setCarryBox(false); this.setPose('normal');
    this.job = 'idle'; this.cooldown = 1.5;
  }

  private pickJob(): void {
    const { state } = this.env.ctx;
    const player = this.env.ctx.services.player;
    let best: Box | null = null;
    let bd = Infinity;
    for (const b of state.sidewalk) {
      if (b.carried || b.units <= 0 || b === player?.carrying) continue;
      if (shelfRoom(this.env, b.productId) <= 0 || !furnitureFor(this.env, b.productId, this.x, this.z)) continue;
      const d = dist2(this.x, this.z, b.x ?? this.env.world().door().x, b.z ?? this.env.world().door().z + 1);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { this.box = best; this.furnId = -1; this.job = 'toBox'; this.walkToBox(best); return; }
    if (state.storageUnlocked && this.storeCool <= 0) {
      for (const pid of Object.keys(state.storage)) {
        if ((state.storage[pid] ?? 0) > 0 && shelfRoom(this.env, pid) > 0 && furnitureFor(this.env, pid, this.x, this.z)) {
          const sp = this.storagePoint();
          const p = this.env.world().findPath({ x: this.x, z: this.z }, sp);
          if (!p) { this.storeCool = 15; return; }
          this.job = 'toStorage'; this.moveTo(sp.x, sp.z); this.storePid = pid;
          return;
        }
      }
    }
  }
  private storePid = '';
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

  update(dt: number, working: boolean): void {
    this.cooldown -= dt; this.storeCool -= dt;
    const { state } = this.env.ctx;
    const player = this.env.ctx.services.player;
    // caixa sumiu ou o jogador a pegou
    if (this.box && (this.job === 'toBox' || this.job === 'lift') && (!state.sidewalk.includes(this.box) || (this.box.carried && player?.carrying === this.box))) {
      this.box = null; this.job = 'idle'; this.cooldown = 1; this.stop();
    }
    if (this.box && !state.sidewalk.includes(this.box) && this.job !== 'idle') { this.box = null; this.person.setCarryBox(false); this.setPose('normal'); this.job = 'idle'; }
    switch (this.job) {
      case 'idle':
        this.setPose('normal');
        if (working && this.cooldown <= 0 && !this.moving) this.pickJob();
        if (this.job === 'idle' && !this.moving && this.distTo(this.homeX, this.homeZ) > 0.7) this.moveTo(this.homeX, this.homeZ);
        break;
      case 'toBox':
        if (this.arrived) { this.job = 'lift'; this.timer = 0.5; this.setPose('grab'); }
        break;
      case 'lift':
        this.timer -= dt;
        if (this.timer <= 0) {
          const b = this.box!;
          b.carried = true;
          this.person.setCarryBox(true); this.setPose('carry');
          this.env.sfx('box', this.x); this.env.changed('sidewalk');
          this.chooseShelf(b);
        }
        break;
      case 'toShelf':
        if (this.arrived) {
          const f = state.furniture.find((x) => x.id === this.furnId);
          if (f) this.faceTowards(f.x + 0.5, f.z + 0.5);
          this.job = 'place'; this.timer = Math.max(0.8, safe('employeeSpeed', () => api.employeeSpeed('stocker', this.level), 3));
          this.setPose('carry', true);
        }
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
          const idx = this.sidewalkIdx();
          if (idx >= 0) {
            safe('discardBox', () => api.discardBox(state, idx), undefined);
            this.env.sfx('trash', this.x); this.env.changed('sidewalk');
          }
          this.box = null; this.person.setCarryBox(false); this.setPose('normal');
          this.job = 'idle'; this.cooldown = 0.4;
        }
        break;
      case 'toStorage':
        if (this.arrived) { this.job = 'takeStorage'; this.timer = 0.6; this.setPose('grab'); }
        break;
      case 'takeStorage':
        this.timer -= dt;
        if (this.timer <= 0) {
          const before = state.sidewalk.length;
          safe('takeFromStorage', () => api.takeFromStorage(state, this.storePid, true), 0);
          const nb = state.sidewalk.length > before ? state.sidewalk[state.sidewalk.length - 1] : undefined;
          if (nb) {
            nb.carried = true; this.box = nb;
            this.person.setCarryBox(true); this.setPose('carry');
            this.env.sfx('box', this.x); this.env.changed('sidewalk');
            this.chooseShelf(nb);
          } else { this.job = 'idle'; this.cooldown = 3; this.storeCool = 10; this.setPose('normal'); }
        }
        break;
    }
    this.step(dt);
  }

  private chooseShelf(b: Box): void {
    const f = furnitureFor(this.env, b.productId, this.x, this.z);
    const acc = f ? this.env.world().furnitureAccess(f.id) : null;
    if (!f || !acc) { this.drop(); return; }
    this.furnId = f.id;
    this.moveTo(acc.x, acc.z);
    this.job = 'toShelf';
  }

  private placeUnitsNow(): void {
    const b = this.box;
    const { state } = this.env.ctx;
    if (!b) { this.job = 'idle'; return; }
    const idx = this.sidewalkIdx();
    if (idx < 0) { this.box = null; this.person.setCarryBox(false); this.job = 'idle'; return; }
    const room = shelfRoom(this.env, b.productId);
    const n = Math.min(b.units, Math.max(0, room));
    if (n > 0) {
      safe('placeUnits', () => api.placeUnits(state, idx, n), 0);
      this.env.sfx('box', this.x); this.env.changed('shelf');
    }
    if (b.units <= 0) {
      const t = this.env.world().trashBin();
      this.moveTo(t.x, t.z);
      this.job = 'toTrash';
    } else this.drop();
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
