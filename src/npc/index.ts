/**
 * Módulo NPC: clientes, funcionários, filas e checkout.
 * Publica ctx.services.npc. Escuta: storeOpened/storeClosing/dayStarted/checkoutResult.
 * Emite: storeEmpty, checkoutRequest {stage:'pay'}, checkout:display, checkout:done, checkoutAvailable,
 * customerComplaint, stateChanged, sfx. Fase 3: caixa sentado (ver checkout.ts) e itens tocáveis via services.pick.
 * Debug/testes: window.__npc (spawnNow, timeScale, stats...).
 */
import type { GameContext, GameModule } from '../core/module';
import type { Vec2, WorldService } from '../core/services';
import { CLOSE_MIN, OPEN_MIN } from '../sim/state';
import * as api from '../sim/api';
import { Agent } from './agent';
import { disposeBubbles } from './bubbles';
import { CheckoutManager } from './checkout';
import { Customer } from './customer';
import { productById } from '../sim/catalog';
import { createFallbackWorld } from './fallbackWorld';
import { type CustomerKind, disposeModels, pickKind } from './model';
import { type AgentLike, type BubbleKey, type Env, clamp, safe } from './shared';
import { Cashier, Janitor, Staff, Stocker, type StaffRole } from './staff';

/** Minutos de jogo das chegadas: base uniforme + picos (manhã, almoço, fim de tarde). */
export function arrivalTimes(n: number, rand: () => number): number[] {
  const comps = [
    { w: 0.25, m: 0, s: 0 }, // uniforme
    { w: 0.2, m: 9.5 * 60, s: 45 },
    { w: 0.3, m: 12.5 * 60, s: 50 },
    { w: 0.25, m: 18 * 60, s: 55 },
  ];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let r = rand();
    let c = comps[0]!;
    for (const k of comps) { r -= k.w; if (r <= 0) { c = k; break; } }
    let t: number;
    if (c.s === 0) t = OPEN_MIN + rand() * (CLOSE_MIN - 40 - OPEN_MIN);
    else {
      const g = Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
      t = c.m + g * c.s;
    }
    out.push(clamp(t, OPEN_MIN, CLOSE_MIN - 30));
  }
  return out.sort((a, b) => a - b);
}

export default function create(): GameModule {
  let ctx!: GameContext;
  let fallback: WorldService | null = null;
  const agents: AgentLike[] = [];
  const customers: Customer[] = [];
  const staff: Staff[] = [];
  let mgr!: CheckoutManager;
  const unsub: (() => void)[] = [];
  let sched: number[] = [];
  let schedIdx = 0;
  let schedDay = -1;
  let emptyEmitted = false;
  let syncT = 0;
  let timeScale = 1;
  const stats = { spawned: 0, sold: 0, gaveUp: 0, left: 0, kinds: { normal: 0, bulk: 0, picky: 0, kid: 0 } as Record<CustomerKind, number>, autoOrders: 0 };
  let lastAutoHour = -1;
  let autoBroken = false;
  /** Gancho de teste: substitui api.runAutoOrders (útil enquanto a sim não implementa). */
  let autoImpl: ((s: typeof ctx.state) => { productId: string; boxes: number; cost: number }[]) | null = null;

  const shortName = (id: string): string => {
    const n = safe('productById', () => productById(id).name, id);
    return n.replace(/\s+[\d(].*$/, '');
  };

  /** Pedido automático (sim.runAutoOrders): toast resumindo, sfx buy e stateChanged 'sidewalk'. */
  function runAuto(): { productId: string; boxes: number; cost: number }[] {
    if (autoBroken && !autoImpl) return [];
    let res: { productId: string; boxes: number; cost: number }[] = [];
    try {
      res = (autoImpl ?? api.runAutoOrders)(ctx.state);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('NOT_IMPLEMENTED')) autoBroken = true; // não insiste enquanto a sim não existe
      else console.warn('[npc] runAutoOrders:', msg);
      return [];
    }
    if (!res || res.length === 0) return [];
    const parts = res.map((r) => `${r.boxes} cx ${shortName(r.productId)}`);
    stats.autoOrders += res.length;
    ctx.bus.emit('toast', { text: `Pedido automático: ${parts.join(', ')}`, kind: 'info' });
    ctx.bus.emit('sfx', { name: 'buy' });
    ctx.bus.emit('stateChanged', { what: 'sidewalk' });
    return res;
  }

  /** Dispara na abertura e a cada hora cheia de jogo enquanto aberta. */
  function autoTick(): void {
    if (ctx.clock.phase !== 'open') return;
    const hour = Math.floor(ctx.clock.minute / 60);
    if (hour === lastAutoHour) return;
    lastAutoHour = hour;
    runAuto();
  }

  const env: Env = {
    get ctx() { return ctx; },
    world: () => ctx.services.world ?? (fallback ??= createFallbackWorld(ctx)),
    agents,
    say(a, key: BubbleKey, seconds = 2) { (a as Agent).bubble.show(key, seconds); },
    changed(what) { ctx.bus.emit('stateChanged', { what }); },
    sfx(name, x, z) {
      if (x !== undefined && z !== undefined) { ctx.bus.emit('sfx', { name, x, z }); return; }
      const b = ctx.state.expansion * 4 + 12;
      ctx.bus.emit('sfx', { name, pan: x === undefined ? 0 : clamp((x - b / 2) / (b / 2), -1, 1) * 0.6 });
    },
    nearestWalkable(x, z, out): Vec2 {
      const w = env.world();
      out.x = x; out.z = z;
      if (w.isWalkable(x, z)) return out;
      for (let r = 1; r <= 4; r++) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const px = x + Math.cos(a) * r * 0.7, pz = z + Math.sin(a) * r * 0.7;
          if (w.isWalkable(px, pz)) { out.x = px; out.z = pz; return out; }
        }
      }
      return out;
    },
  };

  /** Limite de clientes simultâneos: min(api.customerCapacity, limite de desempenho ~18 pessoas na cena). */
  const maxCustomers = (): number => {
    const perf = 18 - staff.length;
    const cap = safe('customerCapacity', () => api.customerCapacity(ctx.state), 6 + 2 * ctx.state.expansion);
    return Math.max(1, Math.min(perf, Number.isFinite(cap) ? cap : 6));
  };

  function spawnCustomer(kind?: CustomerKind): boolean {
    if (customers.length >= maxCustomers()) return false;
    const c = Customer.spawn(env, mgr, kind);
    customers.push(c);
    stats.spawned++;
    stats.kinds[c.kind]++;
    return true;
  }

  function buildSchedule(): void {
    schedDay = ctx.state.day;
    const n = safe('plannedArrivals', () => api.plannedArrivals(ctx.state), 0);
    sched = arrivalTimes(n, ctx.rand).filter((t) => t >= ctx.clock.minute - 1);
    schedIdx = 0;
    emptyEmitted = false;
  }

  function homes(): { cashier: Vec2; stocker: Vec2; janitor: Vec2 } {
    const w = env.world();
    const d = w.door();
    const mk = (x: number, z: number): Vec2 => env.nearestWalkable(x, z, { x, z });
    return { cashier: mk(d.x - 2.5, d.z - 1.8), stocker: mk(d.x - 4, d.z - 2.2), janitor: mk(d.x + 4, d.z - 2.2) };
  }

  function syncStaff(initial: boolean): void {
    const roles: StaffRole[] = ['cashier', 'stocker', 'janitor'];
    const h = homes();
    for (const role of roles) {
      const has = staff.find((s) => s.role === role);
      const lvl = ctx.state.employees[role];
      if (lvl > 0 && !has) {
        const s = role === 'cashier' ? new Cashier(env) : role === 'stocker' ? new Stocker(env) : new Janitor(env);
        staff.push(s);
        if (role === 'cashier') mgr.cashier = s as Cashier;
        mgr.refresh();
        const home = h[role];
        s.setHome(home.x, home.z);
        // aparece coerente: sentado no posto (ao carregar) ou entrando pela porta (contratado em jogo)
        if (role === 'cashier' && initial && (s as Cashier).lane) (s as Cashier).snapToSeat();
        else if (initial) s.place(home.x, home.z, 0);
        else { const sp = env.world().spawnPoint(); s.place(sp.x, sp.z, 0); s.moveTo(home.x, home.z); }
      } else if (lvl <= 0 && has) {
        has.remove(); staff.splice(staff.indexOf(has), 1);
        if (role === 'cashier') mgr.cashier = null;
      } else if (has) {
        has.setHome(h[role].x, h[role].z);
      }
    }
    mgr.refresh();
  }

  function tick(h: number): void {
    const phase = ctx.clock.phase;
    if (phase === 'open' && schedDay !== ctx.state.day) buildSchedule();
    if (phase === 'open') autoTick();
    if (phase === 'open') {
      while (schedIdx < sched.length && ctx.clock.minute >= sched[schedIdx]!) {
        if (!spawnCustomer()) break;
        schedIdx++;
      }
    }
    mgr.update(h);
    const working = phase === 'open' || phase === 'closing';
    for (const s of staff) s.update(h, working);
    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i]!;
      c.update(h);
      if (c.gone) {
        c.remove();
        customers.splice(i, 1);
        stats.left++;
      }
    }
    if (phase === 'closing' && customers.length === 0 && !emptyEmitted) {
      emptyEmitted = true;
      ctx.bus.emit('storeEmpty');
    }
  }

  const mod: GameModule = {
    name: 'npc',
    init(c) {
      ctx = c;
      // caixas "carregadas" de um save anterior não têm dono: soltar
      for (const b of ctx.state.sidewalk) if (b.carried && ctx.services.player?.carrying !== b) b.carried = false;
      mgr = new CheckoutManager(env, () => { stats.sold++; });
      ctx.services.npc = { customersInStore: () => customers.length };
      unsub.push(ctx.bus.on('storeOpened', () => {
        emptyEmitted = false;
        if (schedDay !== ctx.state.day) buildSchedule();
        lastAutoHour = Math.floor(ctx.clock.minute / 60);
        runAuto();
      }));
      unsub.push(ctx.bus.on('dayStarted', () => {
        for (const cu of customers) { cu.abort(); cu.remove(); }
        lastAutoHour = -1;
        customers.length = 0; schedDay = -1; sched = []; emptyEmitted = false;
      }));
      unsub.push(ctx.bus.on('checkoutResult', (r) => { if (r) mgr.onResult(r); }));
      syncStaff(true);
      (window as unknown as { __npc: unknown }).__npc = {
        spawnNow: (n = 1, kind?: CustomerKind) => { let k = 0; for (let i = 0; i < n; i++) if (spawnCustomer(kind)) k++; return k; },
        /** Amostra a distribuição de tipos sorteados (não cria clientes). */
        sampleKinds: (n = 1000) => { const o = { normal: 0, bulk: 0, picky: 0, kid: 0 } as Record<CustomerKind, number>; for (let i = 0; i < n; i++) o[pickKind(ctx.rand)]++; return o; },
        runAutoOrders: () => runAuto(),
        setAutoImpl: (f: typeof autoImpl) => { autoImpl = f; autoBroken = false; },
        retryCheckout: () => mgr.retryCheckout(),
        /** Fase 3: estado das esteiras/pagamento, nº de tocáveis registrados e toque simulado. */
        tappables: () => mgr.tappables(),
        tap: () => mgr.debugTap(),
        capacity: () => maxCustomers(),
        /** Estado interno de um cliente para testes. */
        customerInfo: (id: number) => { const c = customers.find((x) => x.id === id); return c ? { kind: c.kind, state: c.state, patience: c.patience, waited: c.waited, cancels: c.cancels, units: c.units, items: c.items.map((i) => ({ ...i })) } : null; },
        get timeScale() { return timeScale; },
        set timeScale(v: number) { timeScale = clamp(v, 0.1, 20); },
        customers: () => customers.map((x) => ({ id: x.id, kind: x.kind, state: x.state, items: x.items.length, bubble: x.bubble.active, x: +x.x.toFixed(1), z: +x.z.toFixed(1) })),
        staff: () => staff.map((s) => ({ role: s.role, x: +s.x.toFixed(1), z: +s.z.toFixed(1), job: (s as { job?: string }).job ?? '' })),
        stats,
        lanes: () => mgr.debug(),
        sync: () => syncStaff(false),
      };
    },
    update(dt) {
      if (ctx.clock.paused) return;
      syncT += dt;
      if (syncT > 1) { syncT = 0; syncStaff(false); }
      if (timeScale > 1) ctx.clock.update(dt * (timeScale - 1));
      const total = dt * timeScale;
      const n = Math.max(1, Math.ceil(total / 0.05));
      const h = total / n;
      for (let i = 0; i < n; i++) tick(h);
    },
    dispose() {
      for (const u of unsub) u();
      unsub.length = 0;
      for (const cu of customers) cu.remove();
      for (const s of staff) s.remove();
      customers.length = 0; staff.length = 0;
      mgr.dispose();
      disposeBubbles();
      disposeModels();
      delete (window as unknown as { __npc?: unknown }).__npc;
      if (ctx.services.npc) delete ctx.services.npc;
    },
  };
  return mod;
}
