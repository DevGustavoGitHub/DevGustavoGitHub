/**
 * Módulo NPC: clientes, funcionários, filas e checkout.
 * Publica ctx.services.npc. Escuta: storeOpened/storeClosing/dayStarted/checkoutResult.
 * Emite: storeEmpty, checkoutRequest {stage:'pay'}, checkout:display, checkout:done, checkoutAvailable,
 * customerComplaint, stateChanged, sfx. Fase 3: caixa sentado (ver checkout.ts) e itens tocáveis via services.pick.
 * Debug/testes: window.__npc (spawnNow, timeScale, stats...).
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '../core/module';
import type { Vec2, WorldService } from '../core/services';
import { CLOSE_MIN, OPEN_MIN, type StoreState } from '../sim/state';
import * as api from '../sim/api';
import { cashierCount } from '../sim/economy';
import { Agent } from './agent';
import { disposeBubbles } from './bubbles';
import { CheckoutManager } from './checkout';
import { Customer } from './customer';
import { productById } from '../sim/catalog';
import { createFallbackWorld } from './fallbackWorld';
import { stockForTest } from './helpers';
import { type CustomerKind, disposeModels, pickKind } from './model';
import { type AgentLike, type BubbleKey, type Env, clamp, safe } from './shared';
import { Cashier, Janitor, Staff, Stocker, type StaffRole } from './staff';

/** RNG determinístico (mulberry32) por (seed, dia): a agenda do dia é a mesma ao recarregar. */
export function dayRand(seed: number, day: number): () => number {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((day | 0) + 1, 0x85ebca6b)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Itens com clientes (cestas, esteira, pagamento): a sim devolve às prateleiras ao carregar um save. */
type HeldState = StoreState & { npcHeld?: { productId: string; qty: number }[] };

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
  /** LOD de animação: frustum da câmera (atualizado 1x por quadro) e esfera de teste reutilizados. */
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const lodSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  const camPos = new THREE.Vector3();
  /** Custo do update do npc (ms acumulados / quadros) para __npc.perf(). */
  const perf = { ms: 0, frames: 0 };
  let autoBroken = false;
  /** Gancho de teste: substitui api.runAutoOrders (útil enquanto a sim não implementa). */
  let autoImpl: ((s: typeof ctx.state) => { productId: string; boxes: number; cost: number }[]) | null = null;

  const shortName = (id: string): string => {
    const n = safe('productById', () => productById(id).name, id);
    return n.replace(/\s+[\d(].*$/, '');
  };

  /** state.npcHeld = soma dos itens de todos os clientes (síncrono: um save a qualquer momento fica coerente). */
  function syncHeld(): void {
    const m = new Map<string, number>();
    for (const c of customers) for (const it of c.items) if (it.qty > 0) m.set(it.productId, (m.get(it.productId) ?? 0) + it.qty);
    const out: { productId: string; qty: number }[] = [];
    for (const [productId, qty] of m) out.push({ productId, qty });
    (ctx.state as HeldState).npcHeld = out;
  }

  /** Pedido automático (sim.runAutoOrders): toast resumindo, sfx buy e stateChanged 'sidewalk'. */
  const lastSkipWarn = new Map<string, number>();
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
    // a sim devolve o que NÃO comprou em `.skipped` (lista não enumerável no array de compras), com motivo e mensagem;
    // avisa no máximo uma vez por hora de jogo por produto, inclusive quando nada foi comprado (ex.: calçada cheia).
    const skipped = (res as unknown as { skipped?: { productId: string; reason?: string; message?: string }[] } | undefined)?.skipped ?? [];
    if (skipped.length > 0) {
      const now = ctx.clock.minute + ctx.state.day * 24 * 60;
      const fresh = skipped.filter((k) => now - (lastSkipWarn.get(k.productId) ?? -Infinity) >= 60);
      if (fresh.length > 0) {
        for (const k of fresh) lastSkipWarn.set(k.productId, now);
        const label = (r?: string): string => (r === 'sidewalk-full' ? 'calçada cheia' : r === 'no-money' ? 'sem dinheiro' : 'não comprado');
        const parts = fresh.map((k) => `${shortName(k.productId)} (${label(k.reason)})`);
        ctx.bus.emit('toast', { text: `Pedido automático não comprou ${parts.join(', ')}`, kind: 'bad' });
      }
    }
    if (!res || res.length === 0) return [];
    // a sim informa o motivo das regras que não compraram (ex.: calçada cheia, sem dinheiro): aviso separado
    // (o prefixo "Pedido automático:" é contrato da UI e fica só para o que foi comprado)
    const why = (r: object): string | null => {
      const o = r as { reason?: unknown; error?: unknown; skipped?: unknown };
      const v = o.reason ?? o.error ?? o.skipped;
      return typeof v === 'string' && v ? v : v === true ? 'não comprado' : null;
    };
    const ok = res.filter((r) => !why(r) && r.boxes > 0);
    const bad = res.filter((r) => why(r));
    if (bad.length > 0) {
      const parts = bad.map((r) => `${shortName(r.productId)} (${why(r)!.replace(/\.$/, '').toLowerCase()})`);
      ctx.bus.emit('toast', { text: `Pedido automático não comprou ${parts.join(', ')}`, kind: 'bad' });
    }
    if (ok.length === 0) return ok;
    const parts = ok.map((r) => `${r.boxes} cx ${shortName(r.productId)}`);
    stats.autoOrders += ok.length;
    ctx.bus.emit('toast', { text: `Pedido automático: ${parts.join(', ')}`, kind: 'info' });
    ctx.bus.emit('sfx', { name: 'buy' });
    ctx.bus.emit('stateChanged', { what: 'sidewalk' });
    return ok;
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
    heldChanged() { syncHeld(); },
    sfx(name, x, z) {
      if (x !== undefined && z !== undefined) { ctx.bus.emit('sfx', { name, x, z }); return; }
      const b = ctx.state.expansion * 4 + 12;
      ctx.bus.emit('sfx', { name, pan: x === undefined ? 0 : clamp((x - b / 2) / (b / 2), -1, 1) * 0.6 });
    },
    lowDetail(x, z) {
      const dx = x - camPos.x, dz = z - camPos.z;
      if (dx * dx + dz * dz > 15 * 15) return true;
      lodSphere.center.set(x, 0.9, z);
      return !frustum.intersectsSphere(lodSphere);
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
    // determinística por (seed, dia) e retomada do minuto atual: ao recarregar no meio do dia (o core restaura
    // clock.minute) as chegadas já ocorridas não se repetem
    const now = ctx.clock.minute;
    sched = arrivalTimes(n, dayRand(ctx.state.seed, ctx.state.day)).filter((t) => t >= now);
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
      const have = staff.filter((s) => s.role === role);
      const want = role === 'cashier' ? cashierCount(ctx.state) : ctx.state.employees[role] > 0 ? 1 : 0;
      while (have.length > want) { const x = have.pop()!; x.remove(); staff.splice(staff.indexOf(x), 1); }
      while (have.length < want) {
        const s = role === 'cashier' ? new Cashier(env) : role === 'stocker' ? new Stocker(env) : new Janitor(env);
        staff.push(s);
        have.push(s);
        if (role === 'cashier') mgr.cashiers = have as Cashier[];
        mgr.refresh();
        const home = h[role];
        const hx = home.x - (have.length - 1) * 0.8;
        s.setHome(hx, home.z);
        // aparece coerente: sentado no posto (ao carregar) ou entrando pela porta (contratado em jogo)
        if (role === 'cashier' && initial && (s as Cashier).lane) (s as Cashier).snapToSeat();
        else if (initial) s.place(hx, home.z, 0);
        else { const sp = env.world().spawnPoint(); s.place(sp.x, sp.z, 0); s.moveTo(hx, home.z); }
      }
      if (role === 'cashier') mgr.cashiers = have as Cashier[];
      have.forEach((s, i) => s.setHome(h[role].x - i * 0.8, h[role].z));
    }
    mgr.refresh();
  }

  function tick(h: number): void {
    const phase = ctx.clock.phase;
    if (phase === 'open' && schedDay !== ctx.state.day) buildSchedule();
    if (phase === 'open') autoTick();
    if (phase === 'open' && !ctx.clock.doorsClosed) {
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
        syncHeld();
      }));
      unsub.push(ctx.bus.on('checkoutResult', (r) => { if (r) mgr.onResult(r); }));
      unsub.push(ctx.bus.on('ui:modal', (m) => mgr.setModal(!!m?.open)));
      syncStaff(true);
      syncHeld(); // a sim já devolveu às prateleiras o que estava com clientes no save
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
        /** Teste (Fase 4): abastece os níveis etiquetados com até n un. (só `productId`, se dado); devolve o total posto. */
        stock: (n = 30, productId?: string) => stockForTest(ctx.state, n, productId),
        /** Teste (Fase 4): onde o cliente encontra o produto (api.locateProduct; null = API de níveis indisponível). */
        locate: (productId: string) => safe('locateProduct', () => api.locateProduct(ctx.state, productId), null),
        /** Agenda de chegadas restante (minutos) e itens com clientes (state.npcHeld). */
        schedule: () => ({ day: schedDay, next: sched.slice(schedIdx), done: schedIdx }),
        /** ms médios de JS do update do npc por quadro desde a última leitura (zera). */
        perf: () => { const r = { ms: +(perf.ms / Math.max(1, perf.frames)).toFixed(3), frames: perf.frames, people: customers.length + staff.length }; perf.ms = 0; perf.frames = 0; return r; },
        held: () => ((ctx.state as HeldState).npcHeld ?? []).map((h) => ({ ...h })),
      };
    },
    update(dt) {
      if (ctx.clock.paused) return;
      const t0 = performance.now();
      const cam = ctx.camera;
      projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      cam.getWorldPosition(camPos);
      syncT += dt;
      if (syncT > 1) { syncT = 0; syncStaff(false); }
      if (timeScale > 1) ctx.clock.update(dt * (timeScale - 1));
      const total = dt * timeScale;
      const n = Math.max(1, Math.ceil(total / 0.05));
      const h = total / n;
      for (let i = 0; i < n; i++) tick(h);
      perf.ms += performance.now() - t0; perf.frames++;
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
