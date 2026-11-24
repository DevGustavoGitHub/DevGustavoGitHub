/** Cliente: máquina de estados completa (chegada → compras → fila → pagamento → saída). */
import * as api from '../sim/api';
import type { Lane, CheckoutManager } from './checkout';
import { Agent } from './agent';
import { footprint, furnitureFor, locate, maybeDirt } from './helpers';
import type { Furniture } from '../sim/state';
import { PRODUCTS } from '../sim/catalog';
import { sellPrice, marketAverage } from '../sim/market';
import { type CustomerKind, MAX_BASKET_ITEMS, Person, type PersonSpec, pickKind, randomCustomerSpec } from './model';
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
  /** FASE 4: nível alvo no móvel (-1 = sem API de níveis → takeFromShelf). */
  private level = -1;
  /** Trocas de móvel (nível esvaziou no caminho) e tentativas de retirada do item atual. */
  private hops = 0;
  private tries = 0;
  /** O preço do item atual já foi avaliado (não sorteia de novo ao trocar de nível/móvel). */
  private priced = false;
  private recorded = false;
  private angry = false;
  private warned = false;
  private baseSpeed: number;

  /** Cancelamentos do minigame de checkout (máx. 3, depois desiste). */
  cancels = 0;
  readonly age: 'adult' | 'kid' | 'elder';
  private announced = false;

  constructor(env: Env, private mgr: CheckoutManager, person: Person, spec: PersonSpec, readonly kind: CustomerKind = 'normal') {
    super(env, person);
    const age = spec.age;
    this.age = age;
    const r = env.ctx.rand;
    this.list = this.buildList(r);
    // QA economia: 50–75 s enquanto não há caixa contratado (jogador sozinho), 40–60 s com caixa
    const solo = env.ctx.state.employees.cashier <= 0;
    this.patience = (solo ? 50 + r() * 25 : 40 + r() * 20) * (age === 'elder' ? 1.2 : 1) * (kind === 'kid' ? 0.8 : kind === 'bulk' ? 1.25 : 1);
    this.baseSpeed = (age === 'kid' ? 1.6 : age === 'elder' ? 0.85 : 1.15 + r() * 0.35);
    this.maxSpeed = this.baseSpeed;
    this.arriveR = 0.18;
  }

  /** Lista de compras conforme o tipo: bulk = o dobro de itens e quantidades maiores; kid = doces/pão (1-2 itens). */
  private buildList(r: () => number): Item[] {
    const { state } = this.env.ctx;
    const base = (): Item[] => safe('makeShoppingList', () => api.makeShoppingList(state, r), []).map((i) => ({ ...i }));
    if (this.kind === 'bulk') {
      const out = base();
      for (const it of base()) { const e = out.find((o) => o.productId === it.productId); if (!e) out.push(it); }
      for (const it of out) it.qty = Math.max(it.qty, 1) + 1 + Math.floor(r() * 3);
      return out;
    }
    if (this.kind === 'kid') {
      const treats = PRODUCTS.filter((p) => (state.slots[p.id] ?? 0) > 0 && state.licenses.includes(p.category)
        && (p.category === 'padaria' || /doce|bala|choco|biscoit|bolo|sorvete|suco|refri|pao/i.test(p.id)));
      const pool = treats.length > 0 ? treats : PRODUCTS.filter((p) => (state.slots[p.id] ?? 0) > 0 && state.licenses.includes(p.category));
      const n = Math.min(pool.length, 1 + Math.floor(r() * 2));
      const out: Item[] = [];
      for (let i = 0; i < n; i++) {
        const k = Math.floor(r() * pool.length);
        const p = pool.splice(k, 1)[0]!;
        out.push({ productId: p.id, qty: 1 + Math.floor(r() * 2) });
      }
      return out;
    }
    return base();
  }

  static spawn(env: Env, mgr: CheckoutManager, forced?: CustomerKind): Customer {
    const kind = forced ?? pickKind(env.ctx.rand);
    const spec = randomCustomerSpec(env.ctx.rand, Math.floor(env.ctx.rand() * 1000), kind);
    const c = new Customer(env, mgr, new Person(spec), spec, kind);
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
    if (this.walked > 9) { this.walked = 0; maybeDirt(this.env, this.x, this.z, this.kind === 'kid' ? 0.2 : 0.05); }
  }

  private waiting(): boolean {
    return this.state === 'queue' || this.state === 'front';
  }

  /** Paciência corre (fila, ou no balcão sem ninguém atendendo). true = esgotou. */
  tickPatience(dt: number): boolean {
    this.waited += dt;
    if (!this.warned && this.waited > this.patience * 0.6) { this.warned = true; this.env.say(this, 'neutral', 2); }
    return this.waited > this.patience;
  }

  private stepState(dt: number): void {
    const w = this.env.world();
    switch (this.state) {
      case 'enter1':
        if (this.arrived) {
          this.env.sfx('door', this.x, this.z);
          const d = w.door();
          this.moveTo(d.x + (this.env.ctx.rand() - 0.5) * 0.8, d.z - 1.4);
          this.state = 'enter2';
        }
        break;
      case 'enter2':
        if (this.arrived) { this.announce(); this.state = 'basketPick'; this.timer = 0.5; this.setPose('basket'); this.person.setBasket(true); this.person.setBasketItems([]); }
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
          this.timer = (0.6 + this.env.ctx.rand() * 0.9) * (this.age === 'elder' ? 1.4 : this.kind === 'kid' ? 0.55 : 1);
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
          this.env.sfx('door', this.x, this.z);
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
    const st = this.state;
    if (this.totalT > 200 && (st === 'pickNext' || st === 'walkShelf' || st === 'browse' || st === 'react')) this.toCheckout();
  }

  private announce(): void {
    if (this.announced) return;
    this.announced = true;
    if (this.kind === 'bulk') this.env.say(this, 'bulk', 2.4);
    else if (this.kind === 'picky') this.env.say(this, 'picky', 2.4);
    else if (this.kind === 'kid') this.env.say(this, 'kid', 2.4);
  }

  /** O pagamento foi cancelado na UI: feedback e menos paciência. true = 3º cancelamento (o caixa o despacha). */
  onCheckoutCancel(): boolean {
    this.cancels++;
    this.patience = Math.max(12, this.patience * 0.85);
    this.waited += 4;
    if (this.cancels >= 3) return true;
    this.env.say(this, this.cancels === 1 ? 'oops' : 'angry', 2.2);
    return false;
  }

  /** Cesta mostra o que ainda não foi posto na esteira. */
  refreshBasketFrom(taps: readonly { pid: string }[], from: number): void {
    this.basketIds.length = 0;
    for (let i = from; i < taps.length && this.basketIds.length < MAX_BASKET_ITEMS; i++) this.basketIds.push(taps[i]!.pid);
    this.person.setBasketItems(this.basketIds);
  }

  private furniture(id: number): Furniture | null {
    const list = this.env.ctx.state.furniture;
    for (let i = 0; i < list.length; i++) if (list[i]!.id === id) return list[i]!;
    return null;
  }

  /**
   * Onde pegar o produto: o nível COM unidades mais próximo (api.locateProduct); sem nenhum com unidades, um nível
   * etiquetado (o cliente vai até lá e mostra "Sem estoque"). Sem a API de níveis: móvel do produto (level -1).
   */
  private findSpot(pid: string, skipF = -1): { f: Furniture; level: number; units: number } | null {
    const spots = locate(this.env, pid);
    if (!spots) {
      const f = furnitureFor(this.env, pid, this.x, this.z);
      return f && f.id !== skipF ? { f, level: -1, units: this.env.ctx.state.shelf[pid] ?? 0 } : null;
    }
    let best: { f: Furniture; level: number; units: number } | null = null;
    let bd = Infinity;
    for (const s of spots) {
      if (s.furnitureId === skipF) continue;
      const f = this.furniture(s.furnitureId);
      if (!f) continue;
      const fp = footprint(f);
      const d = (f.x + fp.w / 2 - this.x) ** 2 + (f.z + fp.d / 2 - this.z) ** 2;
      const has = s.units > 0, bestHas = !!best && best.units > 0;
      if (best && (bestHas && !has || (has === bestHas && d >= bd))) continue;
      best = { f, level: s.level, units: s.units }; bd = d;
    }
    return best;
  }

  private pickNext(): void {
    // escolhe o próximo item cujo móvel esteja mais perto; descarta os sem móvel
    let bi = -1, bd = Infinity;
    let bs: { f: Furniture; level: number; units: number } | null = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i]!;
      const sp = this.findSpot(it.productId);
      if (!sp) { this.list.splice(i, 1); this.outOfStock++; continue; }
      const fp = footprint(sp.f);
      const d = (sp.f.x + fp.w / 2 - this.x) ** 2 + (sp.f.z + fp.d / 2 - this.z) ** 2;
      if (d < bd) { bd = d; bi = i; bs = sp; }
    }
    if (bi < 0 || !bs) { this.toCheckout(); return; }
    this.entry = this.list.splice(bi, 1)[0]!;
    this.furnId = bs.f.id;
    this.level = bs.level;
    this.hops = 0; this.tries = 0; this.priced = false;
    const acc = this.env.world().furnitureAccess(bs.f.id);
    if (!acc) { this.entry = null; this.outOfStock++; this.state = 'pickNext'; return; }
    this.moveTo(acc.x, acc.z);
    this.state = 'walkShelf';
  }

  /**
   * O nível alvo ainda tem unidades? Se esvaziou no caminho: outro nível do mesmo móvel, outro móvel (até 2 trocas)
   * ou desiste do item com o balão "Sem estoque". true = pode pegar aqui (this.level atualizado).
   */
  private ensureUnits(e: Item): boolean {
    if (this.level < 0) return true; // sem API de níveis: takeFromShelf decide
    const spots = locate(this.env, e.productId);
    if (!spots) { this.level = -1; return true; }
    let alt = -1, altU = 0;
    for (const s of spots) {
      if (s.furnitureId !== this.furnId || s.units <= 0) continue;
      if (s.level === this.level) return true;
      if (s.units > altU) { alt = s.level; altU = s.units; }
    }
    if (alt >= 0) { this.level = alt; return true; }
    if (this.hops < 2) {
      const sp = this.findSpot(e.productId, this.furnId);
      const acc = sp && sp.units > 0 ? this.env.world().furnitureAccess(sp.f.id) : null;
      if (sp && acc) {
        this.hops++;
        this.furnId = sp.f.id; this.level = sp.level;
        this.setPose('basket');
        this.moveTo(acc.x, acc.z);
        this.state = 'walkShelf';
        return false;
      }
    }
    this.noStock();
    return false;
  }

  private noStock(): void {
    this.entry = null;
    this.outOfStock++;
    this.env.say(this, 'semestoque', 1.8);
    this.state = 'react'; this.timer = 1.2; this.setPose('basket');
  }

  private decide(): void {
    const e = this.entry;
    if (!e) { this.state = 'pickNext'; return; }
    if (!this.ensureUnits(e)) return;
    if (!this.priced) {
      this.priced = true;
      const { state, rand, bus } = this.env.ctx;
      const ap = safe('acceptsPrice', () => api.acceptsPrice(state, e.productId, rand), { ok: true, ratio: 1 });
      const real = safe('ratio', () => sellPrice(state, e.productId) / marketAverage(state, e.productId), ap.ratio);
      const ratio = Number.isFinite(real) ? real : Number.isFinite(ap.ratio) ? ap.ratio : 1;
      // exigente: rejeita qualquer preço acima de 1,10x o mercado (limite exato, sem sorteio) e reclama em dobro
      const pickyNo = this.kind === 'picky' && ratio > 1.1;
      if (pickyNo || !ap.ok) {
        // FASE 4: só reclama ("Caro!" + customerComplaint) se o preço estiver mesmo acima do mercado (> 1,05);
        // perto do preço de mercado o cliente apenas deixa o item na prateleira, sem balão
        if (pickyNo || ratio > 1.05) {
          this.complaints += pickyNo ? 2 : 1;
          this.env.say(this, pickyNo ? 'pickyno' : 'caro', pickyNo ? 2.6 : 1.8);
          bus.emit('customerComplaint', { customerId: this.id, productId: e.productId, ratio: pickyNo ? ratio * 1.15 : ratio });
          this.entry = null; this.state = 'react'; this.timer = 1.4;
        } else {
          this.entry = null; this.state = 'react'; this.timer = 0.6;
        }
        return;
      }
    }
    if (this.units >= MAX_BASKET_ITEMS * (this.kind === 'bulk' ? 6 : 3)) { this.entry = null; this.state = 'react'; this.timer = 0.2; return; }
    this.state = 'grab';
    this.timer = 0.55;
    this.setPose('grab');
  }

  /**
   * Retira do nível alvo e completa com outros níveis do mesmo móvel. Só retira de níveis que AINDA têm a etiqueta do
   * produto (takeFromLevel tira o produto atual do nível; o jogador pode ter trocado no caminho). -1 = API indisponível.
   */
  private takeLevels(e: Item): number {
    const { state } = this.env.ctx;
    const spots = locate(this.env, e.productId);
    if (!spots) return -1;
    const here = spots.filter((s) => s.furnitureId === this.furnId && s.units > 0)
      .sort((a, b) => (a.level === this.level ? -1 : b.level === this.level ? 1 : b.units - a.units));
    let got = 0;
    for (const s of here) {
      if (got >= e.qty) break;
      got += Math.max(0, safe('takeFromLevel', () => api.takeFromLevel(state, s.furnitureId, s.level, Math.min(e.qty - got, s.units)), 0));
    }
    return got;
  }

  private takeItem(): void {
    const e = this.entry;
    if (!e) { this.state = 'pickNext'; return; }
    const { state } = this.env.ctx;
    let got = this.level >= 0 ? this.takeLevels(e) : -1;
    if (got < 0) { this.level = -1; got = safe('takeFromShelf', () => api.takeFromShelf(state, e.productId, e.qty), 0); }
    if (got <= 0) {
      // o nível esvaziou enquanto o cliente pegava: outro nível/móvel (sem rever o preço) ou "Sem estoque"
      if (this.level >= 0 && ++this.tries < 4) {
        if (this.ensureUnits(e)) { this.state = 'grab'; this.timer = 0.35; }
        return; // senão ensureUnits já mandou a outro móvel ou desistiu ("Sem estoque")
      }
      this.noStock();
      return;
    }
    this.entry = null;
    const ex = this.items.find((i) => i.productId === e.productId);
    if (ex) ex.qty += got; else this.items.push({ productId: e.productId, qty: got });
    this.units += got;
    this.env.heldChanged();
    this.refreshBasket();
    this.env.sfx('pop', this.x, this.z);
    this.env.changed('shelf');
    maybeDirt(this.env, this.x, this.z, this.kind === 'kid' ? 0.3 : 0.05);
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
    if (this.waiting() && this.tickPatience(dt)) {
      this.mgr.remove(lane, this);
      this.giveUp('espera');
    }
  }

  /** Devolve os itens e vai embora bravo. */
  giveUp(_why: string): void {
    const { state } = this.env.ctx;
    const had = this.items.length > 0;
    for (const it of this.items) safe('returnToShelf', () => api.returnToShelf(state, it.productId, it.qty), undefined);
    this.items.length = 0; this.units = 0;
    this.env.heldChanged(); // antes do evento: um save síncrono não vê os itens na prateleira E com o cliente
    if (had) this.env.changed('shelf');
    this.person.setBasketItems([]);
    this.person.setBasket(false);
    this.person.clearReach();
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
    this.person.clearReach();
    this.setPose('normal');
    this.lane = null;
    const d = this.env.world().door();
    this.state = 'leave1';
    this.moveTo(d.x, d.z - 1.2);
  }

  /** Pagamento concluído (funcionário ou jogador). Devolve total, gorjeta e satisfação (>= 3 = feliz). */
  finishSale(speed: number, mistakes: number): { total: number; tip: number; sat: number } {
    const frac = this.waited / this.patience;
    let sat = 5 - mistakes - (frac > 0.75 ? 1.5 : frac > 0.5 ? 1 : frac > 0.25 ? 0.5 : 0) - this.complaints * 0.5 - this.outOfStock * 0.5;
    if (this.kind === 'picky') sat -= 0.5;
    sat = clamp(Math.round(sat), 1, 5);
    const { state } = this.env.ctx;
    const items = this.items.map((i) => ({ productId: i.productId, qty: i.qty }));
    // compra grande: atendimento rápido rende gorjeta maior (a sim calcula a gorjeta a partir de speed)
    const sp = this.kind === 'bulk' ? (speed >= 0.6 ? Math.min(1, speed * 1.3) : speed * 0.85) : speed;
    const res = safe('completeSale', () => api.completeSale(state, items, sp, sat), null);
    this.recorded = true;
    // vendido: sai de npcHeld ANTES de qualquer evento (um save síncrono não pode ver os itens duas vezes)
    this.items.length = 0; this.units = 0;
    this.env.heldChanged();
    this.env.changed('money');
    this.env.say(this, sat >= 4 ? (res && res.tip > 0 ? 'coin' : 'obrigado') : sat >= 3 ? 'happy' : 'neutral', 2.2);
    this.person.setBasketItems([]);
    this.person.setBag(true);
    this.depart();
    return { total: res?.total ?? 0, tip: res?.tip ?? 0, sat };
  }

  /** Dispensa o cliente sem mexer na economia (fechamento forçado). */
  abort(): void {
    if (!this.recorded && this.items.length > 0) {
      const { state } = this.env.ctx;
      for (const it of this.items) safe('returnToShelf', () => api.returnToShelf(state, it.productId, it.qty), undefined);
      this.items.length = 0;
      this.env.heldChanged();
      this.env.changed('shelf');
    }
    if (this.lane) this.mgr.remove(this.lane, this);
    this.state = 'gone';
  }

  get isAngry(): boolean { return this.angry; }
}
