/** Cliente: máquina de estados completa (chegada → compras → fila → pagamento → saída). */
import * as api from '../sim/api';
import { storeBounds } from '../core/layout';
import type { Lane, CheckoutManager } from './checkout';
import { Agent } from './agent';
import { footprint, furnitureFor, maybeDirt } from './helpers';
import { MAX_BASKET_ITEMS, Person, randomCustomerSpec } from './model';
import { type Env, clamp, safe } from './shared';

export type CState =
  | 'enter1' | 'enter2' | 'basketPick' | 'pickNext' | 'walkShelf' | 'browse' | 'react' | 'grab'
  | 'queue' | 'front' | 'serving' | 'leave1' | 'leave2' | 'leave3' | 'gone';

interface Item { productId: string; qty: number }

export class Customer extends Agent {
  state: CState = 'enter1';
  list: Item[];
  items: Item[] = [];
  /** unidades totais no cesto */
  units = 0;
  timer = 0;
  patience: number;
  waited = 0;
  requestedAt = 0;
  totalT = 0;
  complaints = 0;
  outOfStock = 0;
  lane: Lane | null = null;
  slotIdx = -1;
  method: 'cash' | 'card' = 'cash';
  private entry: Item | null = null;
  private furnId = -1;
  private recorded = false;
  private angry = false;
  private warned = false;
  private baseSpeed: number;

  constructor(env: Env, private mgr: CheckoutManager, person: Person, readonly age: 'adult' | 'kid' | 'elder') {
    super(env, person);
    const r = env.ctx.rand;
    this.list = safe('makeShoppingList', () => api.makeShoppingList(env.ctx.state, r), []).map((i) => ({ ...i }));
    this.patience = (40 + r() * 20) * (age === 'elder' ? 1.2 : 1);
    this.baseSpeed = (age === 'kid' ? 1.35 : age === 'elder' ? 0.85 : 1.15 + r() * 0.35);
    this.maxSpeed = this.baseSpeed;
    this.arriveR = 0.18;
  }

  static spawn(env: Env, mgr: CheckoutManager): Customer {
    const spec = randomCustomerSpec(env.ctx.rand, Math.floor(env.ctx.rand() * 1000));
    const c = new Customer(env, mgr, new Person(spec), spec.age);
    const sp = env.world().spawnPoint();
    const d = env.world().door();
    c.place(sp.x + (env.ctx.rand() - 0.5) * 1.5, sp.z, Math.atan2(d.x - sp.x, d.z - sp.z));
    c.moveTo(d.x + (env.ctx.rand() - 0.5) * 0.6, d.z + 0.5, true);
    return c;
  }

  get gone(): boolean { return this.state === 'gone'; }
  get leaving(): boolean { return this.state === 'leave1' || this.state === 'leave2' || this.state === 'leave3'; }
  penalize(sec: number): void { this.waited += sec; }

  update(dt: number): void {
    this.totalT += dt;
    this.stepState(dt);
    this.step(dt);
    if (this.walked > 9) { this.walked = 0; maybeDirt(this.env, this.x, this.z, 0.05); }
  }

  private waiting(): boolean {
    return (this.state === 'queue' || this.state === 'front') && !(this.lane && this.lane.pending === this);
  }

  private stepState(dt: number): void {
    const w = this.env.world();
    switch (this.state) {
      case 'enter1':
        if (this.arrived) {
          this.env.sfx('door', this.x);
          const d = w.door();
          this.moveTo(d.x + (this.env.ctx.rand() - 0.5) * 0.8, d.z - 1.4);
          this.state = 'enter2';
        }
        break;
      case 'enter2':
        if (this.arrived) { this.state = 'basketPick'; this.timer = 0.5; this.setPose('basket'); this.person.setBasket(true); this.person.setBasketItems([]); }
        break;
      case 'basketPick':
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'pickNext';
        break;
      case 'pickNext':
        this.pickNext();
        break;
      case 'walkShelf':
        if (this.arrived) {
          const f = this.env.ctx.state.furniture.find((x) => x.id === this.furnId);
          if (f) { const fp = footprint(f); this.faceTowards(f.x + fp.w / 2, f.z + fp.d / 2); }
          this.state = 'browse';
          this.timer = (0.6 + this.env.ctx.rand() * 0.9) * (this.age === 'elder' ? 1.4 : 1);
        }
        break;
      case 'browse':
        this.timer -= dt;
        if (this.timer <= 0) this.decide();
        break;
      case 'react':
        this.timer -= dt;
        if (this.timer <= 0) { this.setPose('basket'); this.state = 'pickNext'; }
        break;
      case 'grab':
        this.timer -= dt;
        if (this.timer <= 0) this.takeItem();
        break;
      case 'queue':
      case 'front':
        this.queueStep(dt);
        break;
      case 'serving':
        break;
      case 'leave1':
        if (this.arrived) { const d = w.door(); this.moveTo(d.x, d.z + 0.6, true); this.state = 'leave2'; }
        break;
      case 'leave2':
        if (this.arrived) {
          this.env.sfx('door', this.x);
          const sp = w.spawnPoint();
          this.moveTo(sp.x, sp.z, true);
          this.state = 'leave3';
        }
        break;
      case 'leave3':
        if (this.arrived) this.state = 'gone';
        break;
      case 'gone':
        break;
    }
    if (this.state !== 'gone' && !this.leaving && this.state !== 'enter1' && this.state !== 'enter2' && this.state !== 'basketPick'
      && this.state !== 'queue' && this.state !== 'front' && this.state !== 'serving' && this.totalT > 200) {
      this.toCheckout();
    }
  }

  private pickNext(): void {
    const s = this.env.ctx.state;
    // escolhe o próximo item cujo móvel esteja mais perto; descarta os sem móvel
    let bi = -1, bd = Infinity, bf = null as ReturnType<typeof furnitureFor>;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i]!;
      const f = furnitureFor(this.env, it.productId, this.x, this.z);
      if (!f) { this.list.splice(i, 1); this.outOfStock++; continue; }
      const fp = footprint(f);
      const d = (f.x + fp.w / 2 - this.x) ** 2 + (f.z + fp.d / 2 - this.z) ** 2;
      if (d < bd) { bd = d; bi = i; bf = f; }
    }
    void s;
    if (bi < 0 || !bf) { this.toCheckout(); return; }
    this.entry = this.list.splice(bi, 1)[0]!;
    this.furnId = bf.id;
    const acc = this.env.world().furnitureAccess(bf.id);
    if (!acc) { this.outOfStock++; this.state = 'pickNext'; return; }
    this.moveTo(acc.x, acc.z);
    this.state = 'walkShelf';
  }

  private decide(): void {
    const e = this.entry;
    if (!e) { this.state = 'pickNext'; return; }
    const { state, rand, bus } = this.env.ctx;
    const ap = safe('acceptsPrice', () => api.acceptsPrice(state, e.productId, rand), { ok: true, ratio: 1 });
    if (!ap.ok) {
      this.complaints++;
      this.env.say(this, 'caro', 1.8);
      bus.emit('customerComplaint', { customerId: this.id, productId: e.productId, ratio: ap.ratio });
      this.entry = null; this.state = 'react'; this.timer = 1.4;
      return;
    }
    if (this.units >= MAX_BASKET_ITEMS * 3) { this.entry = null; this.state = 'react'; this.timer = 0.2; return; }
    this.state = 'grab';
    this.timer = 0.55;
    this.setPose('grab');
  }

  private takeItem(): void {
    const e = this.entry!;
    this.entry = null;
    const { state } = this.env.ctx;
    const got = safe('takeFromShelf', () => api.takeFromShelf(state, e.productId, e.qty), 0);
    if (got <= 0) {
      this.outOfStock++;
      this.env.say(this, 'semestoque', 1.8);
      this.state = 'react'; this.timer = 1.2; this.setPose('basket');
      return;
    }
    const ex = this.items.find((i) => i.productId === e.productId);
    if (ex) ex.qty += got; else this.items.push({ productId: e.productId, qty: got });
    this.units += got;
    this.refreshBasket();
    this.env.sfx('pop', this.x);
    this.env.changed('shelf');
    maybeDirt(this.env, this.x, this.z, 0.05);
    this.setPose('basket');
    this.state = 'react'; this.timer = 0.25;
  }

  private basketIds: string[] = [];
  private refreshBasket(): void {
    this.basketIds.length = 0;
    for (const it of this.items) for (let k = 0; k < Math.min(2, it.qty) && this.basketIds.length < MAX_BASKET_ITEMS; k++) this.basketIds.push(it.productId);
    this.person.setBasketItems(this.basketIds);
  }

  private toCheckout(): void {
    this.entry = null;
    if (this.items.length === 0) { this.leaveEmpty(); return; }
    const lane = this.mgr.best();
    if (!lane) { this.giveUp('sem caixa'); return; }
    if (lane.line.length >= 6) { this.giveUp('fila'); return; }
    this.lane = lane;
    lane.line.push(this);
    this.slotIdx = -1;
    this.waited = 0;
    this.state = 'queue';
    this.setPose('basket');
  }

  /** A lane foi removida do mundo: escolhe outra. */
  laneLost(): void {
    this.lane = null;
    this.slotIdx = -1;
    if (this.state === 'queue' || this.state === 'front' || this.state === 'serving') this.toCheckout();
  }

  private queueStep(dt: number): void {
    const lane = this.lane;
    if (!lane) { this.toCheckout(); return; }
    const idx = lane.line.indexOf(this);
    if (idx < 0) { this.toCheckout(); return; }
    if (idx !== this.slotIdx) {
      this.slotIdx = idx;
      const s = lane.slot(idx);
      this.moveTo(s.x, s.z);
      if (idx > 0) this.state = 'queue';
    }
    if (idx === 0 && this.state === 'queue' && this.arrived) {
      this.state = 'front';
      const o = lane.operator;
      this.faceTowards(o.x, o.z);
    }
    if (this.waiting()) {
      this.waited += dt;
      if (!this.warned && this.waited > this.patience * 0.6) { this.warned = true; this.env.say(this, 'neutral', 2); }
      if (this.waited > this.patience) {
        this.mgr.remove(lane, this);
        this.giveUp('espera');
      }
    }
  }

  /** Devolve os itens e vai embora bravo. */
  giveUp(_why: string): void {
    const { state } = this.env.ctx;
    for (const it of this.items) safe('returnToShelf', () => api.returnToShelf(state, it.productId, it.qty), undefined);
    if (this.items.length > 0) this.env.changed('shelf');
    this.items.length = 0; this.units = 0;
    this.person.setBasketItems([]);
    this.person.setBasket(false);
    this.lane = null;
    this.angry = true;
    this.env.say(this, this.ctx_rand() < 0.5 ? 'demora' : 'angry', 2.2);
    this.record(1);
    maybeDirt(this.env, this.x, this.z, 0.2);
    this.maxSpeed = this.baseSpeed * 1.3;
    this.depart();
  }

  private ctx_rand(): number { return this.env.ctx.rand(); }

  private leaveEmpty(): void {
    const sat = this.complaints > 0 ? 1 : 2;
    this.env.say(this, this.complaints > 0 ? 'angry' : 'sad', 2);
    this.record(sat);
    this.person.setBasket(false);
    this.depart();
  }

  private record(sat: number): void {
    if (this.recorded) return;
    this.recorded = true;
    safe('recordLostCustomer', () => api.recordLostCustomer(this.env.ctx.state, sat), undefined);
  }

  private depart(): void {
    this.setPose('normal');
    this.lane = null;
    const d = this.env.world().door();
    this.state = 'leave1';
    this.moveTo(d.x, d.z - 1.2);
  }

  /** Pagamento concluído (funcionário ou jogador). */
  finishSale(speed: number, mistakes: number): void {
    const frac = this.waited / this.patience;
    let sat = 5 - mistakes - (frac > 0.75 ? 1.5 : frac > 0.5 ? 1 : frac > 0.25 ? 0.5 : 0) - this.complaints * 0.5 - this.outOfStock * 0.5;
    sat = clamp(Math.round(sat), 1, 5);
    const { state } = this.env.ctx;
    const items = this.items.map((i) => ({ productId: i.productId, qty: i.qty }));
    const res = safe('completeSale', () => api.completeSale(state, items, speed, sat), null);
    this.recorded = true;
    this.env.changed('money');
    this.env.say(this, sat >= 4 ? (res && res.tip > 0 ? 'coin' : 'obrigado') : sat >= 3 ? 'happy' : 'neutral', 2.2);
    this.items.length = 0; this.units = 0;
    this.person.setBasketItems([]);
    this.person.setBasket(false);
    this.depart();
  }

  /** Dispensa o cliente sem mexer na economia (fechamento forçado). */
  abort(): void {
    if (!this.recorded && this.items.length > 0) {
      const { state } = this.env.ctx;
      for (const it of this.items) safe('returnToShelf', () => api.returnToShelf(state, it.productId, it.qty), undefined);
      this.items.length = 0;
      this.env.changed('shelf');
    }
    if (this.lane) this.mgr.remove(this.lane, this);
    this.state = 'gone';
  }

  get isAngry(): boolean { return this.angry; }
  get storeBoundsFor(): ReturnType<typeof storeBounds> { return storeBounds(this.env.ctx.state.expansion); }
}
