/** Funcionários: caixa, repositor e faxineiro. */
import * as api from '../sim/api';
import type { Box } from '../sim/state';
import { STORAGE_DEPTH, binApproach, recycleBinPos, storeBounds } from '../core/layout';
import type { Lane } from './checkout';
import { Agent } from './agent';
import { furnitureFor, furnitureWithRoom, shelfRoom, stockLevelsHere } from './helpers';
import { productById } from '../sim/catalog';
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

type SJob = 'idle' | 'toBox' | 'lift' | 'toShelf' | 'open' | 'place' | 'toTrash' | 'toss' | 'toStorage' | 'takeStorage' | 'toStoreRoom' | 'storeDrop';

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
  /** A viagem da lixeira vai para a reciclagem (melhoria 'recycler'). */
  private recycling = false;
  private timer = 0;
  private cooldown = 0;
  private storeCool = 0;
  private furnId = -1;
  private storePids: string[] = [];
  /** Pós-teste 3: caixas nas mãos a GUARDAR no depósito (sobra da reposição ou caixas da calçada). */
  private toStore: Box[] = [];
  private binX = 0; private binZ = 0;
  /** Voltando ao posto (pode ser interrompido por uma tarefa nova: não precisa chegar ao posto para trabalhar). */
  private homing = false;
  /** A viagem atual é só para levar caixas da calçada ao depósito. */
  private storeTrip = false;
  constructor(env: Env) { super(env, 'stocker'); }

  /** Cabe no depósito (liberado, com espaço contando as caixas que já estão nas mãos para guardar)? */
  private canStore(b: Box): boolean {
    const { state } = this.env.ctx;
    if (!state.storageUnlocked || b.units <= 0) return false;
    const bs = safe('productById', () => productById(b.productId).boxSize, 0);
    if (!bs) return false;
    const stored = state.storage[b.productId] ?? 0;
    const extra = Math.ceil((stored + b.units) / bs) - Math.ceil(stored / bs);
    const free = safe('storageCapacity', () => api.storageCapacity(state), 0) - safe('storageUsed', () => api.storageUsed(state), 0);
    return extra <= free - this.toStore.length;
  }

  /** Leva as caixas de `toStore` até o depósito (sem caminho: larga onde está). */
  private goStoreRoom(): void {
    const sp = this.storagePoint();
    if (!this.env.world().findPath({ x: this.x, z: this.z }, sp)) {
      for (const b of this.toStore) this.release(b);
      this.toStore.length = 0; this.storeTrip = false; this.storeCool = 15;
      this.finishTrip();
      return;
    }
    this.person.setCarryBox(true); this.boxVisual(this.toStore[0], false); this.setPose('carry');
    this.moveTo(sp.x, sp.z);
    this.job = 'toStoreRoom';
  }

  /** Caixas por viagem: pelo nível do repositor (1 / 2 / 3) e +1 com o carrinho de carga (melhoria 'dolly'; pós-teste 3). */
  private get cap(): number {
    const base = this.level >= 4 ? 3 : this.level >= 2 ? 2 : 1;
    return base + (this.env.ctx.state.upgrades.includes('dolly') ? 1 : 0);
  }

  /**
   * Prioridade de reposição (pós-teste 3, pedido do jogador): o produto com MENOS na exposição somando TODAS as prateleiras
   * dele (ocupação total = unidades ÷ capacidade dos níveis etiquetados; empate: menos unidades). Zerado vem primeiro.
   */
  private need(pid: string): { fill: number; units: number } {
    const { state } = this.env.ctx;
    let units = 0, cap = 0;
    for (const f of state.furniture) {
      const lv = f.levels;
      if (!lv) continue;
      for (let i = 0; i < lv.length; i++) {
        const l = lv[i]!;
        if (l.productId !== pid) continue;
        const c = safe('levelCapacity', () => api.levelCapacity(state, f.id, i), 0);
        if (c > 0) { cap += c; units += Math.min(c, l.units); }
      }
    }
    if (cap > 0) return { fill: units / cap, units };
    const have = state.shelf[pid] ?? 0, room = shelfRoom(this.env, pid);
    return { fill: have / Math.max(1, have + room), units: have };
  }
  private byNeed = (a: string, b: string): number => {
    const x = this.need(a), y = this.need(b);
    return (x.fill - y.fill) || (x.units - y.units);
  };

  private release(b: Box): void { b.carried = false; this.env.changed('sidewalk'); }

  /**
   * Próxima tarefa: escolhe o produto MAIS PRECISADO entre todos que têm estoque (caixa no chão/calçada OU no depósito) e
   * vai buscá-lo onde estiver; completa a viagem com os próximos mais precisados no mesmo lugar (até `cap` caixas).
   * Antes ia primeiro em qualquer caixa do chão, mesmo com um produto zerado que só tinha estoque no depósito.
   */
  private pickJob(): void {
    const { state } = this.env.ctx;
    const player = this.env.ctx.services.player;
    const door = this.env.world().door();
    const floor: Box[] = [];
    for (const b of state.sidewalk) {
      if (b.carried || b.units <= 0 || b === player?.carrying) continue;
      if (shelfRoom(this.env, b.productId) <= 0 || !furnitureFor(this.env, b.productId, this.x, this.z)) continue;
      floor.push(b);
    }
    const storeOk = state.storageUnlocked && this.storeCool <= 0;
    const stored = storeOk ? Object.keys(state.storage).filter((pid) => (state.storage[pid] ?? 0) > 0 && shelfRoom(this.env, pid) > 0 && furnitureFor(this.env, pid, this.x, this.z)) : [];
    const pids = [...new Set([...floor.map((b) => b.productId), ...stored])].sort(this.byNeed);
    const top = pids[0];
    if (top) {
      const near = (b: Box): number => dist2(this.x, this.z, b.x ?? door.x, b.z ?? door.z + 1);
      const onFloor = floor.filter((b) => b.productId === top).sort((a, b) => near(a) - near(b))[0];
      if (onFloor) {
        // caixa do produto mais precisado no chão; leva junto caixas (de outros produtos precisados) que estão perto dela
        this.plan.length = 0;
        this.plan.push(onFloor);
        const rank = new Map(pids.map((p, k) => [p, k]));
        const rest = floor.filter((b) => b !== onFloor).sort((a, b) => (rank.get(a.productId)! - rank.get(b.productId)!) || (near(a) - near(b)));
        for (const b of rest) {
          if (this.plan.length >= this.cap) break;
          if (this.plan.some((q) => q.productId === b.productId)) continue;
          if (dist2(b.x ?? door.x, b.z ?? door.z + 1, onFloor.x ?? door.x, onFloor.z ?? door.z + 1) > 36) continue;
          this.plan.push(b);
        }
        this.job = 'toBox'; this.walkToBox(onFloor);
        return;
      }
      // só no depósito: busca o mais precisado e os próximos que também estão lá
      const sp = this.storagePoint();
      if (!this.env.world().findPath({ x: this.x, z: this.z }, sp)) { this.storeCool = 15; return; }
      this.storePids = pids.filter((p) => stored.includes(p)).slice(0, this.cap);
      this.job = 'toStorage'; this.moveTo(sp.x, sp.z);
      return;
    }
    // pós-teste 3: nada para repor → guarda no depósito as caixas que estão na CALÇADA (fora da loja)
    if (state.storageUnlocked && this.storeCool <= 0) {
      const D = storeBounds(state.expansion).depth;
      const out = state.sidewalk.filter((b) => !b.carried && b.units > 0 && b !== player?.carrying && (b.z === undefined || b.z > D - 0.1) && this.canStore(b));
      if (out.length > 0) {
        const near = (b: Box): number => dist2(this.x, this.z, b.x ?? door.x, b.z ?? door.z + 1);
        out.sort((a, b) => near(a) - near(b));
        this.plan.length = 0;
        for (const b of out) { if (this.plan.length >= this.cap) break; this.plan.push(b); }
        this.storeTrip = true;
        this.job = 'toBox'; this.walkToBox(this.plan[0]!);
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
      this.prune(this.plan, true); this.prune(this.stack, false); this.prune(this.junk, false); this.prune(this.toStore, false);
      if ((this.job === 'toBox' || this.job === 'lift') && this.plan.length === 0) {
        // alvo sumiu (jogador pegou): segue com o que já está nas mãos ou volta ao posto
        this.stop();
        if (this.storeTrip && this.stack.length > 0) { this.toStore.push(...this.stack); this.stack.length = 0; this.goStoreRoom(); }
        else if (this.stack.length > 0) this.nextShelf(); else if (this.junk.length > 0) this.finishTrip(); else { this.storeTrip = false; this.job = 'idle'; this.cooldown = 1; this.person.setCarryBox(false); this.setPose('normal'); }
      }
    }
    switch (this.job) {
      case 'idle':
        this.setPose('normal');
        // pós-teste 3: emenda uma tarefa na outra — procura trabalho também a caminho do posto (sem ir até lá antes)
        if (working && this.cooldown <= 0 && (!this.moving || this.homing)) {
          this.pickJob();
          if (this.job === 'idle') this.cooldown = 0.6; else this.homing = false;
        }
        if (this.job === 'idle' && !this.moving && this.distTo(this.homeX, this.homeZ) > 0.7) { this.moveTo(this.homeX, this.homeZ); this.homing = true; }
        if (this.job === 'idle' && !this.moving) this.homing = false;
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
          if (this.plan.length > 0) { this.job = 'toBox'; this.walkToBox(this.plan[0]!); }
          else if (this.storeTrip) { this.toStore.push(...this.stack); this.stack.length = 0; this.goStoreRoom(); }
          else this.nextShelf();
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
        if (this.arrived) { this.job = 'toss'; this.timer = 0.6; this.faceTowards(this.binX, this.binZ); }
        break;
      case 'toss':
        this.timer -= dt;
        if (this.timer <= 0) {
          let recycled = false;
          for (const b of this.junk) {
            const idx = state.sidewalk.indexOf(b);
            if (idx < 0) continue;
            const got = this.recycling ? safe('recycleBox', () => api.recycleBox(state, idx), 0) : 0;
            if (got > 0) {
              const w = this.env.world(), t = w.recycleBin?.() ?? recycleBinPos(storeBounds(state.expansion));
              this.env.ctx.bus.emit('recycle:done', { x: t.x, z: t.z, amount: got });
              recycled = true;
            } else safe('discardBox', () => api.discardBox(state, idx), undefined);
          }
          if (this.junk.length > 0) { this.env.sfx(recycled ? 'coin' : 'trash', this.x, this.z); this.env.changed('sidewalk'); }
          this.junk.length = 0;
          this.person.setCarryBox(false); this.setPose('normal');
          this.job = 'idle'; this.cooldown = 0;
        }
        break;
      case 'toStorage':
        if (this.arrived) { this.job = 'takeStorage'; this.timer = 0.6; this.setPose('grab'); }
        break;
      case 'toStoreRoom':
        if (this.arrived) { this.job = 'storeDrop'; this.timer = 0.6; this.setPose('grab'); }
        break;
      case 'storeDrop':
        this.timer -= dt;
        if (this.timer <= 0) {
          for (const b of this.toStore) {
            const idx = state.sidewalk.indexOf(b);
            if (idx < 0) continue;
            const ok = safe('storeBox', () => { api.storeBox(state, idx); return true; }, false);
            if (!ok) this.release(b); // depósito encheu no caminho: larga a caixa ali
          }
          this.toStore.length = 0; this.storeTrip = false;
          this.env.sfx('box', this.x, this.z); this.env.changed('storage'); this.env.changed('sidewalk');
          this.person.setCarryBox(false); this.setPose('normal');
          this.finishTrip();
        }
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
      const f = furnitureWithRoom(this.env, b.productId, this.x, this.z);
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

  /** Fim da viagem: sobras para o depósito, vazias para a lixeira (uma vez) ou volta ao posto. */
  private finishTrip(): void {
    if (this.toStore.length > 0) { this.goStoreRoom(); return; }
    if (this.junk.length > 0) {
      const w = this.env.world(), st = this.env.ctx.state;
      this.recycling = st.upgrades.includes('recycler');
      const t = this.recycling ? (w.recycleBin?.() ?? recycleBinPos(storeBounds(st.expansion))) : w.trashBin();
      const a = binApproach(t);
      this.moveTo(a.x, a.z); this.binX = t.x; this.binZ = t.z;
      this.job = 'toTrash';
      return;
    }
    this.person.setCarryBox(false); this.setPose('normal');
    this.job = 'idle'; this.cooldown = 0; // pós-teste 3: já procura a próxima tarefa daqui
  }

  private placeUnitsNow(): void {
    const b = this.stack[0];
    const { state } = this.env.ctx;
    if (!b) { this.nextShelf(); return; }
    const idx = state.sidewalk.indexOf(b);
    if (idx < 0) { this.stack.shift(); this.nextShelf(); return; }
    // FASE 4: abastece os níveis do produto no móvel até onde andou (placeUnitsInLevel); sem níveis/API: placeUnits
    const f = state.furniture.find((x) => x.id === this.furnId);
    let moved = f ? stockLevelsHere(this.env, idx, f, b.productId) : -1;
    if (moved < 0) {
      const n = Math.min(b.units, Math.max(0, shelfRoom(this.env, b.productId)));
      moved = n > 0 ? safe('placeUnits', () => api.placeUnits(state, idx, n), 0) : 0;
    }
    if (moved > 0) { this.env.sfx('box', this.x, this.z); this.env.changed('shelf'); }
    // sobrou e há espaço em outro móvel do produto: leva a mesma caixa até lá
    if (moved > 0 && b.units > 0 && furnitureWithRoom(this.env, b.productId, this.x, this.z)) { this.nextShelf(); return; }
    this.stack.shift();
    if (b.units <= 0) this.junk.push(b);
    else { this.setOpen(b, false); if (this.canStore(b)) this.toStore.push(b); else this.release(b); } // pós-teste 3: sobra vai para o depósito
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

/**
 * Faxineiro (pós-teste 3): limpa a sujeira (prioridade) e, sem sujeira, recolhe as caixas VAZIAS largadas no chão (salão
 * ou calçada) e leva para a lixeira de reciclagem (com a melhoria) ou para a lixeira comum. O repositor cuida só de repor.
 */
export class Janitor extends Staff {
  private job: 'idle' | 'toDirt' | 'mop' | 'toJunk' | 'liftJunk' | 'toBin' | 'tossJunk' = 'idle';
  private facedIn = false;
  private tx2 = 0;
  private tz2 = 0;
  private timer = 0;
  private cooldown = 0;
  private tmp = { x: 0, z: 0 };
  /** Caixas vazias a buscar / nas mãos. */
  private junkPlan: Box[] = [];
  private junk: Box[] = [];
  private recycling = false;
  private binX = 0; private binZ = 0;
  private homing = false;
  constructor(env: Env) { super(env, 'janitor'); }

  private get junkCap(): number { return this.level >= 3 ? 3 : 2; }

  update(dt: number, working: boolean): void {
    this.cooldown -= dt;
    const { state } = this.env.ctx;
    const carrying = this.junk.length > 0;
    this.person.setMop(!carrying);
    if (this.job === 'toJunk' || this.job === 'liftJunk') {
      const player = this.env.ctx.services.player;
      for (let i = this.junkPlan.length - 1; i >= 0; i--) {
        const b = this.junkPlan[i]!;
        if (!state.sidewalk.includes(b) || b.carried || b.units > 0 || b === player?.carrying) this.junkPlan.splice(i, 1);
      }
      if (this.junkPlan.length === 0) { this.stop(); if (this.junk.length > 0) this.goBin(); else { this.job = 'idle'; this.cooldown = 0.5; } }
    }
    for (let i = this.junk.length - 1; i >= 0; i--) if (!state.sidewalk.includes(this.junk[i]!)) this.junk.splice(i, 1);
    switch (this.job) {
      case 'idle':
        this.setPose('mop');
        // pós-teste 3: emenda uma tarefa na outra — também a caminho do posto
        if (working && this.cooldown <= 0 && (!this.moving || this.homing) && state.dirt.length > 0) { this.homing = false; this.pickDirt(); }
        else if (working && this.cooldown <= 0 && (!this.moving || this.homing) && this.pickJunk()) { this.homing = false; }
        else if (!this.moving && this.distTo(this.homeX, this.homeZ) > 0.7) { this.moveTo(this.homeX, this.homeZ); this.homing = true; }
        else if (!this.moving && !this.facedIn) { this.facedIn = true; this.faceTowards(this.homeX, this.homeZ - 3); } // esperando: olha para dentro da loja
        if (this.job === 'idle' && this.cooldown <= 0) this.cooldown = 0.8;
        if (this.moving) this.facedIn = false;
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
          this.job = 'idle'; this.cooldown = 0;
        }
        break;
      case 'toJunk':
        this.setPose(carrying ? 'carry' : 'normal');
        if (this.arrived) { this.job = 'liftJunk'; this.timer = 0.45; this.setPose('grab'); }
        break;
      case 'liftJunk':
        this.timer -= dt;
        if (this.timer <= 0) {
          const b = this.junkPlan.shift();
          if (b) {
            b.carried = true; this.junk.push(b);
            this.person.setCarryBox(true); this.person.setCarryOpen(true, undefined); this.setPose('carry');
            this.env.sfx('box', this.x, this.z); this.env.changed('sidewalk');
          }
          if (this.junkPlan.length > 0) { const n = this.junkPlan[0]!; this.job = 'toJunk'; this.moveTo(n.x ?? this.x, n.z ?? this.z); }
          else this.goBin();
        }
        break;
      case 'toBin':
        this.setPose('carry');
        if (this.arrived) { this.job = 'tossJunk'; this.timer = 0.5; this.faceTowards(this.binX, this.binZ); }
        break;
      case 'tossJunk':
        this.timer -= dt;
        if (this.timer <= 0) {
          let recycled = false;
          for (const b of this.junk) {
            const idx = state.sidewalk.indexOf(b);
            if (idx < 0) continue;
            const got = this.recycling ? safe('recycleBox', () => api.recycleBox(state, idx), 0) : 0;
            if (got > 0) {
              const w = this.env.world(), t = w.recycleBin?.() ?? recycleBinPos(storeBounds(state.expansion));
              this.env.ctx.bus.emit('recycle:done', { x: t.x, z: t.z, amount: got });
              recycled = true;
            } else safe('discardBox', () => api.discardBox(state, idx), undefined);
          }
          if (this.junk.length > 0) { this.env.sfx(recycled ? 'coin' : 'trash', this.x, this.z); this.env.changed('sidewalk'); }
          this.junk.length = 0;
          this.person.setCarryBox(false); this.setPose('mop');
          this.job = 'idle'; this.cooldown = 0;
        }
        break;
    }
    this.step(dt);
  }

  /** Caixas vazias no chão (não carregadas): a mais perto e as próximas dela, até `junkCap`. */
  private pickJunk(): boolean {
    const { state } = this.env.ctx;
    const player = this.env.ctx.services.player;
    const list = state.sidewalk.filter((b) => !b.carried && b.units <= 0 && b !== player?.carrying && b.x !== undefined && b.z !== undefined);
    if (list.length === 0) return false;
    list.sort((a, b) => dist2(this.x, this.z, a.x!, a.z!) - dist2(this.x, this.z, b.x!, b.z!));
    const first = list[0]!;
    this.junkPlan = [first];
    for (let i = 1; i < list.length && this.junkPlan.length < this.junkCap; i++) {
      const b = list[i]!;
      if (dist2(b.x!, b.z!, first.x!, first.z!) <= 25) this.junkPlan.push(b);
    }
    this.job = 'toJunk';
    this.moveTo(first.x!, first.z!);
    return true;
  }

  /** Leva as vazias à reciclagem (melhoria 'recycler') ou à lixeira comum — pela porta (Agent.moveTo). */
  private goBin(): void {
    const w = this.env.world(), st = this.env.ctx.state;
    this.recycling = st.upgrades.includes('recycler');
    const t = this.recycling ? (w.recycleBin?.() ?? recycleBinPos(storeBounds(st.expansion))) : w.trashBin();
    const a = binApproach(t);
    this.moveTo(a.x, a.z); this.binX = t.x; this.binZ = t.z;
    this.job = 'toBin';
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
