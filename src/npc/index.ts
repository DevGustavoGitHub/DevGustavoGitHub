/**
 * Módulo NPC: clientes, funcionários, filas e checkout.
 * Publica ctx.services.npc. Escuta: storeOpened/storeClosing/dayStarted/checkoutResult.
 * Emite: storeEmpty, checkoutRequest, checkoutAvailable, customerComplaint, stateChanged, sfx.
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
import { createFallbackWorld } from './fallbackWorld';
import { disposeModels } from './model';
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
  const stats = { spawned: 0, sold: 0, gaveUp: 0, left: 0 };

  const env: Env = {
    get ctx() { return ctx; },
    world: () => ctx.services.world ?? (fallback ??= createFallbackWorld(ctx)),
    agents,
    say(a, key: BubbleKey, seconds = 2) { (a as Agent).bubble.show(key, seconds); },
    changed(what) { ctx.bus.emit('stateChanged', { what }); },
    sfx(name, x) {
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

  const maxCustomers = (): number => Math.min(14, 10 + ctx.state.expansion, 16 - staff.length);

  function spawnCustomer(): boolean {
    if (customers.length >= maxCustomers()) return false;
    customers.push(Customer.spawn(env, mgr));
    stats.spawned++;
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
        const lane = role === 'cashier' ? mgr.lanes[0] : undefined;
        const home = h[role];
        s.setHome(home.x, home.z);
        const px = lane ? lane.operator.x : home.x, pz = lane ? lane.operator.z : home.z;
        // aparece coerente: no posto (ao carregar) ou entrando pela porta (contratado em jogo)
        if (initial || lane) s.place(px, pz, 0); else { const sp = env.world().spawnPoint(); s.place(sp.x, sp.z, 0); s.moveTo(home.x, home.z); }
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
      unsub.push(ctx.bus.on('storeOpened', () => { emptyEmitted = false; if (schedDay !== ctx.state.day) buildSchedule(); }));
      unsub.push(ctx.bus.on('dayStarted', () => {
        for (const cu of customers) { cu.abort(); cu.remove(); }
        customers.length = 0; schedDay = -1; sched = []; emptyEmitted = false;
      }));
      unsub.push(ctx.bus.on('checkoutResult', (r) => { if (r) mgr.onResult(r); }));
      syncStaff(true);
      (window as unknown as { __npc: unknown }).__npc = {
        spawnNow: (n = 1) => { let k = 0; for (let i = 0; i < n; i++) if (spawnCustomer()) k++; return k; },
        get timeScale() { return timeScale; },
        set timeScale(v: number) { timeScale = clamp(v, 0.1, 20); },
        customers: () => customers.map((x) => ({ id: x.id, state: x.state, items: x.items.length, x: +x.x.toFixed(1), z: +x.z.toFixed(1) })),
        staff: () => staff.map((s) => ({ role: s.role, x: +s.x.toFixed(1), z: +s.z.toFixed(1), job: (s as { job?: string }).job ?? '' })),
        stats,
        lanes: () => mgr.lanes.map((l) => ({ id: l.furnitureId, line: l.line.length, staffed: l.staffed })),
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
