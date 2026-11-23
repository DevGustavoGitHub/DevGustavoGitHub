/**
 * Caixas — Fase 3 (caixa sentado). Cada counter do world vira uma Lane (fila + esteira + pagamento).
 * 1. O cliente da frente chega ao balcão operado (jogador com services.player.seatedAt === counterId, ou o
 *    funcionário caixa sentado no posto) e põe os produtos na esteira: world.makeProductMesh em world.beltSlots,
 *    com addOutline + services.pick.add(mesh, onTap) quando é o jogador.
 * 2. Cada toque bipa um item (sfx scan, item vai para a sacola) e emite checkout:display {mode:'items'}.
 * 3. Tudo bipado → o cliente estende notas (leque) ou cartão em world.handoffPoint (tocável).
 * 4. Toque → checkoutRequest {stage:'pay'}; checkoutResult ok → api.completeSale (bipagem + pagamento),
 *    checkout:done e checkout:display {mode:'idle'}; o cliente agradece e sai.
 * Funcionário: mesmo fluxo sozinho, sem painéis nem toques. Cancelamento: paciência como antes (3x = desiste).
 * Sem world.beltSlots/handoffPoint/seatPose: posições calculadas a partir do balcão (fallback).
 */
import * as THREE from 'three';
import { addOutline, removeOutline } from '../core/outline';
import type { PickService, Vec2 } from '../core/services';
import * as api from '../sim/api';
import { productById } from '../sim/catalog';
import { sellPrice } from '../sim/market';
import { customerCashPayment } from '../sim/money';
import type { Customer } from './customer';
import { footprint } from './helpers';
import { createFallbackPick, type FallbackPick } from './pick';
import { PayProp, disposeProps, fallbackProductMesh } from './props';
import { type Env, clamp, safe } from './shared';

export const PLAYER_SERVE_SEC = 9;
/** Máximo de toques por cliente: acima disso cada item na esteira representa várias unidades. */
const MAX_TAPS = 12;
const PLACE_EVERY = 0.42;
const BELT_SPEED = 0.7;
type Op = 'player' | 'staff' | null;

interface BeltItem {
  obj: THREE.Object3D;
  pid: string;
  /** unidades representadas por este item */
  n: number;
  /** preço unitário (centavos) na hora em que foi posto na esteira */
  unit: number;
  st: 'drop' | 'belt' | 'scan';
  slot: number;
  t: number;
  x: number; y: number; z: number;
  fx: number; fy: number; fz: number;
  tappable: boolean;
  tap: () => void;
}

class Service {
  phase: 'approach' | 'unload' | 'toPay' | 'pay' | 'paying' = 'approach';
  mode: Op = null;
  next = 0;
  readonly belt: (BeltItem | null)[];
  readonly flying: BeltItem[] = [];
  /** total acumulado do que já foi bipado (centavos) */
  total = 0;
  placeT = 0;
  staffT = 0.8;
  t = 0;
  firstAt = -1;
  lastAt = 0;
  payShownAt = -1;
  payTapAt = 0;
  paid = 0;
  reqTotal = 0;
  shown = false;
  pendingT = 0;
  awayT = 0;
  payTap: () => void = () => {};
  constructor(readonly c: Customer, slots: number, readonly method: 'cash' | 'card', readonly taps: { pid: string; n: number }[]) {
    this.belt = new Array<BeltItem | null>(slots).fill(null);
  }
}

/** Agrupa as unidades em "toques" (no máx. ~MAX_TAPS por cliente). */
function groupTaps(items: readonly { productId: string; qty: number }[]): { pid: string; n: number }[] {
  let units = 0;
  for (const it of items) units += it.qty;
  const per = Math.max(1, Math.ceil(units / MAX_TAPS));
  const out: { pid: string; n: number }[] = [];
  for (const it of items) for (let left = it.qty; left > 0;) { const n = Math.min(per, left); out.push({ pid: it.productId, n }); left -= n; }
  return out;
}

export class Lane {
  line: Customer[] = [];
  operator: Vec2 = { x: 0, z: 0 };
  queue: Vec2[] = [];
  scanner: Vec2 = { x: 0, z: 0 };
  /** true se este é o caixa do funcionário contratado. */
  staffed = false;
  svc: Service | null = null;
  slots: THREE.Vector3[] = [];
  readonly handoff = new THREE.Vector3();
  readonly scanPt = new THREE.Vector3();
  readonly bagPt = new THREE.Vector3();
  /** Assento do operador (mundo): posição dos quadris no chão, altura do assento e direção. */
  readonly seat = { x: 0, z: 0, y: 0.5, yaw: 0 };
  geoKey = '';
  geoT = 0;
  prop: PayProp | null = null;
  private readonly slotTmp: Vec2 = { x: 0, z: 0 };

  constructor(readonly furnitureId: number) {}

  setGeometry(operator: Vec2, queue: Vec2[], scanner: Vec2): void {
    this.operator = operator; this.queue = queue; this.scanner = scanner;
  }

  /** Posição do i-ésimo lugar da fila (objeto reutilizado, não guardar). */
  slot(i: number): Vec2 {
    const q = this.queue;
    if (q.length === 0) { this.slotTmp.x = this.operator.x; this.slotTmp.z = this.operator.z + 2.5 + i * 0.8; return this.slotTmp; }
    if (i < q.length) return q[i]!;
    const a = q[q.length - 1]!, b = q[Math.max(0, q.length - 2)]!;
    let dx = a.x - b.x, dz = a.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
    const k = i - (q.length - 1);
    this.slotTmp.x = a.x + dx * 0.8 * k; this.slotTmp.z = a.z + dz * 0.8 * k;
    return this.slotTmp;
  }

  /** O funcionário está bipando agora (animação). */
  get scanning(): boolean { return this.svc !== null && this.svc.mode === 'staff' && (this.svc.phase === 'unload' || this.svc.phase === 'pay'); }
}

export interface CashierLike {
  /** Está sentado no posto da lane indicada e operante. */
  atPost(lane: Lane): boolean;
  lane: Lane | null;
}

const tmpV = new THREE.Vector3();

export class CheckoutManager {
  lanes: Lane[] = [];
  cashier: CashierLike | null = null;
  private availId: number | null = null;
  private acc = 0;
  private refreshT = 0;
  private clock = 0;
  private fbPick: FallbackPick | null = null;
  private readonly regs = new Map<THREE.Object3D, PickService>();
  private readonly pool = new Map<string, THREE.Object3D[]>();
  private readonly tmp: Vec2 = { x: 0, z: 0 };

  constructor(private env: Env, private onSale: () => void) {
    this.refresh();
  }

  /* ---------------- geometria das lanes ---------------- */
  /** Reconstrói/atualiza lanes a partir de world.counters(). Clientes de lanes removidas escolhem outra. */
  refresh(): void {
    const cs = safe('counters', () => this.env.world().counters(), []);
    const seen = new Set<number>();
    for (const c of cs) {
      seen.add(c.furnitureId);
      let lane = this.lanes.find((l) => l.furnitureId === c.furnitureId);
      if (!lane) { lane = new Lane(c.furnitureId); this.lanes.push(lane); }
      lane.setGeometry(c.operator, c.queue, c.scanner);
      this.laneGeometry(lane);
    }
    for (let i = this.lanes.length - 1; i >= 0; i--) {
      const l = this.lanes[i]!;
      if (seen.has(l.furnitureId)) continue;
      this.lanes.splice(i, 1);
      if (l.svc) { this.clear(l, l.svc); l.svc = null; }
      for (const cu of l.line.slice()) cu.laneLost();
      l.line.length = 0;
      if (l.prop) this.env.ctx.scene.remove(l.prop.group);
    }
    this.lanes.sort((a, b) => a.furnitureId - b.furnitureId);
    // caixa contratado: balcão de menor id em que o jogador não está sentado
    const hasCashier = this.env.ctx.state.employees.cashier > 0;
    const seat = this.playerSeat();
    let staffed: Lane | null = null;
    if (hasCashier) {
      const cur = this.cashier?.lane ?? null;
      staffed = cur && this.lanes.includes(cur) && cur.furnitureId !== seat ? cur : (this.lanes.find((l) => l.furnitureId !== seat) ?? null);
    }
    for (const l of this.lanes) l.staffed = l === staffed;
    if (this.cashier) this.cashier.lane = staffed;
  }

  private counterFrame(l: Lane): { cx: number; cz: number; c: number; s: number } | null {
    const f = this.env.ctx.state.furniture.find((x) => x.id === l.furnitureId && x.type === 'counter');
    if (!f) return null;
    const fp = footprint(f);
    const t = (f.rot * Math.PI) / 180;
    return { cx: f.x + fp.w / 2, cz: f.z + fp.d / 2, c: Math.round(Math.cos(t)), s: Math.round(Math.sin(t)) };
  }
  private static local(fr: { cx: number; cz: number; c: number; s: number }, lx: number, lz: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(fr.cx + lx * fr.c + lz * fr.s, y, fr.cz - lx * fr.s + lz * fr.c);
  }

  private laneGeometry(l: Lane): void {
    const key = `${l.operator.x},${l.operator.z},${l.scanner.x.toFixed(2)},${l.scanner.z.toFixed(2)},${l.queue.length}`;
    l.geoT += 0.6;
    if (key === l.geoKey && l.geoT < 3 && l.slots.length > 0) return;
    l.geoKey = key; l.geoT = 0;
    const w = this.env.world();
    const id = l.furnitureId;
    const fr = this.counterFrame(l);
    const q0 = l.queue[0] ?? l.slot(0);
    // esteira (cliente → scanner)
    const ws = w.beltSlots ? safe('beltSlots', () => w.beltSlots!(id), [] as THREE.Vector3[]) : [];
    let slots: THREE.Vector3[];
    if (ws.length >= 2) slots = ws.map((v) => v.clone());
    // fallback = layout local do balcão da Fase 3 (world/furniture.ts: BELT_SLOTS, BELT_Y, HANDOFF, SEAT)
    else if (fr) slots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => CheckoutManager.local(fr, -0.51 + (i % 2 ? 0.11 : -0.11), 0.84 - i * 0.157, 0.882, new THREE.Vector3()));
    else slots = [0, 1, 2, 3, 4, 5].map((i) => { const k = 0.6 * (1 - i / 6); return new THREE.Vector3(l.scanner.x + (q0.x - l.scanner.x) * k, 0.83, l.scanner.z + (q0.z - l.scanner.z) * k); });
    // mantém itens na esteira se o nº de slots mudar
    if (l.svc && l.svc.belt.length !== slots.length) { this.clear(l, l.svc); l.svc.next = 0; l.svc.total = 0; l.svc.phase = 'approach'; l.svc.belt.length = slots.length; l.svc.belt.fill(null); }
    l.slots = slots;
    const hp = w.handoffPoint ? safe('handoffPoint', () => w.handoffPoint!(id), null) : null;
    if (hp) l.handoff.copy(hp);
    else if (fr) CheckoutManager.local(fr, -0.3, 0.84, 1.12, l.handoff);
    else l.handoff.set((l.scanner.x + q0.x) / 2, 1.06, (l.scanner.z + q0.z) / 2);
    const a = slots[slots.length - 1]!, b = slots[0]!;
    let dx = a.x - b.x, dz = a.z - b.z;
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    // item bipado voa até o scanner (counters().scanner, posição nova do world) e some na sacola logo depois
    if (Math.hypot(l.scanner.x - a.x, l.scanner.z - a.z) < 1) l.scanPt.set(l.scanner.x, a.y + 0.07, l.scanner.z);
    else l.scanPt.set(a.x + dx * 0.2, a.y + 0.07, a.z + dz * 0.2);
    l.bagPt.set(l.scanPt.x + dx * 0.3, a.y - 0.03, l.scanPt.z + dz * 0.3);
    const sp = w.seatPose ? safe('seatPose', () => w.seatPose!(id), null) : null;
    if (sp) {
      const sx = sp.look.x - sp.pos.x, sz = sp.look.z - sp.pos.z, sd = Math.hypot(sx, sz) || 1;
      l.seat.x = sp.pos.x - (sx / sd) * 0.1; l.seat.z = sp.pos.z - (sz / sd) * 0.1;
      l.seat.yaw = Math.atan2(sx, sz); l.seat.y = clamp(sp.pos.y - 0.78, 0.38, 0.62);
    } else if (fr) {
      CheckoutManager.local(fr, 0.5, -1.42, 0.46, tmpV);
      l.seat.x = tmpV.x; l.seat.z = tmpV.z; l.seat.y = 0.46;
      CheckoutManager.local(fr, -0.02, 0.55, 0, tmpV);
      l.seat.yaw = Math.atan2(tmpV.x - l.seat.x, tmpV.z - l.seat.z);
    } else {
      l.seat.x = l.operator.x; l.seat.z = l.operator.z; l.seat.y = 0.5;
      l.seat.yaw = Math.atan2(l.handoff.x - l.operator.x, l.handoff.z - l.operator.z);
    }
  }

  /* ---------------- operadores ---------------- */
  /** Balcão onde o jogador está sentado (Fase 3: seatedAt; legado: atCounter). */
  playerSeat(): number | null {
    const p = this.env.ctx.services.player;
    if (!p) return null;
    if (p.seatedAt !== undefined) return p.seatedAt;
    return p.atCounter ?? null;
  }
  private operatorOf(l: Lane, seat: number | null): Op {
    if (l.staffed) return this.cashier?.atPost(l) ? 'staff' : null;
    return seat === l.furnitureId ? 'player' : null;
  }
  private staffSec(s: Service): number {
    return Math.max(1.2, safe('employeeSpeed', () => api.employeeSpeed('cashier', this.env.ctx.state.employees.cashier), 4)) * (s.c.kind === 'bulk' ? 1.6 : 1);
  }

  /** Melhor lane para um cliente (menor espera estimada). */
  best(): Lane | null {
    let b: Lane | null = null;
    let bs = Infinity;
    const seat = this.playerSeat();
    const csec = safe('employeeSpeed', () => api.employeeSpeed('cashier', this.env.ctx.state.employees.cashier), 4) + 3;
    for (const l of this.lanes) {
      const s = (l.line.length + 1) * (l.staffed ? csec : PLAYER_SERVE_SEC) + (l.staffed || seat === l.furnitureId ? 0 : 12);
      if (s < bs) { bs = s; b = l; }
    }
    return b;
  }

  /* ---------------- toque (PickService do player, ou reserva) ---------------- */
  private pickSvc(): PickService {
    return this.env.ctx.services.pick ?? (this.fbPick ??= createFallbackPick(this.env.ctx));
  }
  private pickAdd(o: THREE.Object3D, fn: () => void): void {
    const p = this.pickSvc();
    this.regs.set(o, p);
    safe('pick.add', () => p.add(o, fn), undefined);
  }
  private pickRemove(o: THREE.Object3D): void {
    const p = this.regs.get(o);
    if (!p) return;
    this.regs.delete(o);
    safe('pick.remove', () => p.remove(o), undefined);
  }
  private setTappable(it: BeltItem, on: boolean): void {
    if (it.tappable === on) return;
    it.tappable = on;
    if (on) { addOutline(it.obj); this.pickAdd(it.obj, it.tap); }
    else { removeOutline(it.obj); this.pickRemove(it.obj); }
  }
  private switchMode(l: Lane, s: Service, op: Op): void {
    s.mode = op;
    const on = op === 'player';
    for (const it of s.belt) if (it && it.st === 'belt') this.setTappable(it, on);
    if (s.shown && l.prop) {
      l.prop.setHalo(on);
      if (on) this.pickAdd(l.prop.group, s.payTap); else this.pickRemove(l.prop.group);
    }
  }

  /* ---------------- produtos ---------------- */
  private takeMesh(pid: string): THREE.Object3D {
    const p = this.pool.get(pid)?.pop();
    if (p) return p;
    const w = this.env.world();
    const m = w.makeProductMesh ? safe('makeProductMesh', () => w.makeProductMesh!(pid), null) : null;
    return m ?? fallbackProductMesh(pid);
  }
  private release(it: BeltItem): void {
    this.setTappable(it, false);
    it.obj.parent?.remove(it.obj);
    it.obj.scale.setScalar(1);
    let list = this.pool.get(it.pid);
    if (!list) { list = []; this.pool.set(it.pid, list); }
    if (list.length < 6) list.push(it.obj);
  }

  /* ---------------- ciclo ---------------- */
  update(dt: number): void {
    this.clock += dt;
    this.refreshT += dt;
    if (this.refreshT > 0.6) { this.refreshT = 0; this.refresh(); }
    const seat = this.playerSeat();
    for (const l of this.lanes) {
      const op = this.operatorOf(l, seat);
      const front = l.line[0];
      if (!l.svc && front && front.state === 'front' && op && l.slots.length > 0) this.start(l, front, op);
      if (l.svc) this.step(l, l.svc, op, dt);
    }
    this.acc += dt;
    if (this.acc >= 0.25) { this.acc = 0; this.available(seat); }
  }

  private start(l: Lane, c: Customer, op: Op): void {
    const { ctx } = this.env;
    const s = new Service(c, l.slots.length, ctx.rand() < 0.6 ? 'cash' : 'card', groupTaps(c.items));
    s.payTap = () => this.onPayTap(l, s);
    l.svc = s;
    c.state = 'serving';
    c.method = s.method;
    this.switchMode(l, s, op);
    const p0 = l.slots[0]!;
    const st = this.standNear(l, p0.x, p0.z, 0.62 * c.person.scale + 0.02, this.tmp);
    c.moveTo(st.x, st.z, true);
    ctx.bus.emit('checkout:display', { counterId: l.furnitureId, mode: 'items', total: 0 });
  }

  /** Ponto caminhável a `reach` m do alvo, na direção da fila. */
  private standNear(l: Lane, tx: number, tz: number, reach: number, out: Vec2): Vec2 {
    const q = l.queue[0] ?? l.slot(0);
    const qx = q.x, qz = q.z;
    let ux = qx - tx, uz = qz - tz;
    const d = Math.hypot(ux, uz) || 1; ux /= d; uz /= d;
    const x = tx + ux * reach, z = tz + uz * reach;
    if (this.env.world().isWalkable(x, z) && Math.hypot(x - qx, z - qz) < 1.6) { out.x = x; out.z = z; } else { out.x = qx; out.z = qz; }
    return out;
  }

  private beltEmpty(s: Service): boolean {
    for (let i = 0; i < s.belt.length; i++) if (s.belt[i]) return false;
    return s.flying.length === 0;
  }

  private step(l: Lane, s: Service, op: Op, dt: number): void {
    const c = s.c;
    s.t += dt;
    if (op !== s.mode) this.switchMode(l, s, op);
    // ninguém no caixa: o cliente espera e a paciência corre (com pagamento pendente na UI, não)
    if (!op && s.phase !== 'paying' && c.tickPatience(dt)) { this.giveUp(l, s); return; }
    switch (s.phase) {
      case 'approach':
        if (c.arrived || s.t > 4) { s.phase = 'unload'; s.t = 0; s.placeT = 0.25; c.setPose('place'); }
        break;
      case 'unload': {
        const p0 = l.slots[0]!;
        if (s.next < s.taps.length) {
          c.faceTowards(p0.x, p0.z);
          c.setPose('place');
          c.person.setReach(p0.x, p0.y + 0.08, p0.z);
          s.placeT -= dt;
          if (s.placeT <= 0 && !s.belt[0]) { this.place(l, s); s.placeT = PLACE_EVERY; }
        } else if (c.person.pose === 'place') {
          c.person.clearReach(); c.setPose('normal'); c.person.setBasket(false);
        }
        if (s.mode === 'staff') {
          s.staffT -= dt;
          if (s.staffT <= 0) {
            const it = this.frontItem(s);
            if (it) { this.scan(l, s, it); s.staffT = clamp((this.staffSec(s) * 0.6) / Math.max(1, s.taps.length), 0.22, 1.1); }
          }
        }
        if (s.next >= s.taps.length && this.beltEmpty(s)) {
          s.phase = 'toPay'; s.t = 0;
          const st = this.standNear(l, l.handoff.x, l.handoff.z, 0.5 * c.person.scale + 0.04, this.tmp);
          c.moveTo(st.x, st.z, true);
        }
        break;
      }
      case 'toPay':
        if (c.arrived || s.t > 3) { s.phase = 'pay'; s.t = 0; s.shown = false; }
        break;
      case 'pay':
        if (!s.shown && s.t >= 0.25) this.showPay(l, s);
        if (s.shown) {
          c.faceTowards(l.handoff.x, l.handoff.z);
          if (s.mode === 'staff' && s.t > Math.max(0.8, this.staffSec(s) * 0.3)) this.staffPay(l, s);
        }
        break;
      case 'paying':
        s.pendingT += dt;
        s.awayT = op === 'player' ? 0 : s.awayT + dt;
        // jogador saiu do caixa ou a UI não respondeu: o cliente estende o pagamento de novo (sem castigo)
        if (s.awayT > 1.5 || s.pendingT > 90) { s.phase = 'pay'; s.t = 0; s.shown = false; }
        break;
    }
    if (l.svc === s) this.animate(l, s, dt);
  }

  /** Item mais próximo do scanner já pousado na esteira. */
  private frontItem(s: Service): BeltItem | null {
    for (let i = s.belt.length - 1; i >= 0; i--) { const it = s.belt[i]; if (it && it.st === 'belt') return it; }
    return null;
  }

  private place(l: Lane, s: Service): void {
    const tap = s.taps[s.next++]!;
    const c = s.c;
    const obj = this.takeMesh(tap.pid);
    const unit = safe('sellPrice', () => sellPrice(this.env.ctx.state, tap.pid), 0);
    const h = c.heading;
    const fx = c.x + Math.sin(h) * 0.32, fz = c.z + Math.cos(h) * 0.32, fy = 0.95 * c.person.scale;
    const it: BeltItem = { obj, pid: tap.pid, n: tap.n, unit, st: 'drop', slot: 0, t: 0, x: fx, y: fy, z: fz, fx, fy, fz, tappable: false, tap: () => {} };
    it.tap = () => { if (l.svc === s && s.mode === 'player') this.scan(l, s, it); };
    s.belt[0] = it;
    obj.position.set(fx, fy, fz);
    obj.rotation.set(0, (((c.id * 7 + s.next * 3) % 10) / 10 - 0.5) * 0.7, 0);
    obj.scale.setScalar(1);
    this.env.ctx.scene.add(obj);
    c.refreshBasketFrom(s.taps, s.next);
    this.env.sfx('pop', fx, fz);
  }

  private scan(l: Lane, s: Service, it: BeltItem): void {
    if (it.st !== 'belt' || l.svc !== s) return;
    this.setTappable(it, false);
    const i = s.belt.indexOf(it);
    if (i >= 0) s.belt[i] = null;
    it.st = 'scan'; it.t = 0; it.fx = it.x; it.fy = it.y; it.fz = it.z;
    s.flying.push(it);
    s.total += it.unit * it.n;
    s.lastAt = this.clock;
    this.env.sfx('scan', l.scanner.x, l.scanner.z);
    const name = safe('productById', () => productById(it.pid).name, it.pid);
    this.env.ctx.bus.emit('checkout:display', {
      counterId: l.furnitureId, mode: 'items', lastItem: { name: it.n > 1 ? `${name} ×${it.n}` : name, price: it.unit * it.n }, total: s.total,
    });
  }

  private animate(l: Lane, s: Service, dt: number): void {
    const belt = s.belt, slots = l.slots;
    for (let i = belt.length - 2; i >= 0; i--) {
      const it = belt[i];
      if (it && it.st === 'belt' && !belt[i + 1]) { belt[i + 1] = it; belt[i] = null; it.slot = i + 1; }
    }
    for (let i = 0; i < belt.length; i++) {
      const it = belt[i];
      if (!it) continue;
      const p = slots[Math.min(it.slot, slots.length - 1)]!;
      if (it.st === 'drop') {
        it.t += dt;
        const k = Math.min(1, it.t / 0.32);
        it.x = it.fx + (p.x - it.fx) * k; it.z = it.fz + (p.z - it.fz) * k;
        it.y = it.fy + (p.y - it.fy) * k + Math.sin(k * Math.PI) * 0.12;
        if (k >= 1) {
          it.st = 'belt';
          if (s.firstAt < 0) s.firstAt = this.clock;
          if (s.mode === 'player') this.setTappable(it, true);
        }
      } else {
        const dx = p.x - it.x, dy = p.y - it.y, dz = p.z - it.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz), st = BELT_SPEED * dt;
        if (d <= st) { it.x = p.x; it.y = p.y; it.z = p.z; } else { it.x += (dx / d) * st; it.y += (dy / d) * st; it.z += (dz / d) * st; }
      }
      it.obj.position.set(it.x, it.y, it.z);
    }
    const a = l.scanPt, b = l.bagPt;
    for (let i = s.flying.length - 1; i >= 0; i--) {
      const it = s.flying[i]!;
      it.t += dt;
      if (it.t < 0.14) {
        const k = it.t / 0.14;
        it.x = it.fx + (a.x - it.fx) * k; it.y = it.fy + (a.y - it.fy) * k; it.z = it.fz + (a.z - it.fz) * k;
      } else {
        const k = Math.min(1, (it.t - 0.14) / 0.24);
        it.x = a.x + (b.x - a.x) * k; it.y = a.y + (b.y - a.y) * k; it.z = a.z + (b.z - a.z) * k;
        it.obj.scale.setScalar(1 - 0.85 * k);
      }
      it.obj.position.set(it.x, it.y, it.z);
      if (it.t >= 0.38) { s.flying.splice(i, 1); this.release(it); }
    }
  }

  private newProp(): PayProp {
    const p = new PayProp();
    this.env.ctx.scene.add(p.group);
    return p;
  }

  private showPay(l: Lane, s: Service): void {
    const { ctx } = this.env;
    const c = s.c;
    s.reqTotal = safe('basketTotal', () => api.basketTotal(ctx.state, c.items), s.total);
    if (s.method === 'cash' && s.paid < s.reqTotal) s.paid = customerCashPayment(s.reqTotal, ctx.rand);
    const prop = (l.prop ??= this.newProp());
    prop.show(s.method, s.paid, c.id);
    prop.group.position.copy(l.handoff);
    if (s.mode === 'player') tmpV.copy(ctx.camera.position);
    else tmpV.set(l.seat.x, l.seat.y + 0.75, l.seat.z);
    prop.group.lookAt(tmpV);
    prop.setHalo(s.mode === 'player');
    if (s.mode === 'player') this.pickAdd(prop.group, s.payTap);
    s.shown = true;
    if (s.payShownAt < 0) s.payShownAt = this.clock;
    c.setPose('extend');
    c.person.setReach(l.handoff.x, l.handoff.y, l.handoff.z);
  }

  private hidePay(l: Lane, s: Service): void {
    if (l.prop) { this.pickRemove(l.prop.group); l.prop.hide(); }
    s.shown = false;
    s.c.person.clearReach();
    s.c.setPose('normal');
  }

  private onPayTap(l: Lane, s: Service): void {
    if (l.svc !== s || s.phase !== 'pay' || !s.shown || s.mode !== 'player') return;
    const c = s.c;
    this.hidePay(l, s);
    s.payTapAt = this.clock;
    s.phase = 'paying'; s.pendingT = 0; s.awayT = 0;
    this.env.ctx.bus.emit('checkoutRequest', {
      customerId: c.id, counterId: l.furnitureId, items: c.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      total: s.reqTotal, method: s.method, paid: s.method === 'cash' ? s.paid : s.reqTotal, stage: 'pay',
    });
  }

  /** Velocidade da bipagem + reação ao pagamento (0..1). */
  private scanSpeed(s: Service): number {
    const scan = s.firstAt < 0 ? 0 : Math.max(0, s.lastAt - s.firstAt);
    const react = s.payShownAt < 0 ? 0 : Math.max(0, s.payTapAt - s.payShownAt);
    const per = (scan + react) / Math.max(1, s.taps.length);
    return clamp(1 - (per - 0.6) / 2.4, 0.1, 1);
  }

  private staffPay(l: Lane, s: Service): void {
    // a registradora/moedas tocam no checkout:done (áudio); sem 'cash' extra
    if (s.method === 'card') this.env.sfx('card', l.scanner.x, l.scanner.z);
    this.finish(l, s, clamp(1 - (this.staffSec(s) - 1.5) / 9, 0.15, 1), 0);
  }

  private finish(l: Lane, s: Service, speed: number, mistakes: number): void {
    const c = s.c;
    const staff = s.mode === 'staff';
    this.clear(l, s);
    l.svc = null;
    const i = l.line.indexOf(c);
    if (i >= 0) l.line.splice(i, 1);
    const res = c.finishSale(speed, mistakes);
    const { bus } = this.env.ctx;
    bus.emit('checkout:done', { customerId: c.id, counterId: l.furnitureId, total: res.total || s.reqTotal, tip: res.tip, method: s.method, happy: res.sat >= 3, staff });
    bus.emit('checkout:display', { counterId: l.furnitureId, mode: 'idle' });
    this.onSale();
  }

  private giveUp(l: Lane, s: Service): void {
    const c = s.c;
    this.clear(l, s);
    l.svc = null;
    const i = l.line.indexOf(c);
    if (i >= 0) l.line.splice(i, 1);
    this.env.ctx.bus.emit('checkout:display', { counterId: l.furnitureId, mode: 'idle' });
    c.giveUp('espera');
  }

  /** Remove tudo do atendimento (itens, tocáveis, contornos, notas/cartão). */
  private clear(l: Lane, s: Service): void {
    for (let i = 0; i < s.belt.length; i++) { const it = s.belt[i]; if (it) this.release(it); s.belt[i] = null; }
    for (const it of s.flying) this.release(it);
    s.flying.length = 0;
    if (l.prop) { this.pickRemove(l.prop.group); l.prop.hide(); }
    s.shown = false;
    s.c.person.clearReach();
  }

  /** Resultado do painel de pagamento (UI). */
  onResult(r: { customerId: number; ok: boolean; speed: number; mistakes: number }): void {
    for (const l of this.lanes) {
      const s = l.svc;
      if (!s || s.c.id !== r.customerId) continue;
      if (s.phase !== 'paying') return; // resposta atrasada ou duplicada
      if (r.ok) {
        const pay = clamp(Number.isFinite(r.speed) ? r.speed : 0.5, 0, 1);
        this.finish(l, s, 0.5 * this.scanSpeed(s) + 0.5 * pay, Math.max(0, Math.round(r.mistakes) || 0));
        return;
      }
      // cancelado: o cliente reclama, perde paciência e estende o pagamento de novo; 3 cancelamentos = desiste
      if (s.c.onCheckoutCancel()) { this.giveUp(l, s); return; }
      s.phase = 'pay'; s.t = -1.2; s.shown = false;
      this.env.ctx.bus.emit('toast', { text: 'Cliente esperando: toque no dinheiro/cartão para tentar de novo', kind: 'info' });
      return;
    }
  }

  /** Reapresenta já o pagamento de quem está esperando (debug/teste). */
  retryCheckout(): boolean {
    let any = false;
    for (const l of this.lanes) { const s = l.svc; if (s && s.phase === 'pay' && !s.shown) { s.t = 0.25; any = true; } }
    return any;
  }

  /** Remove um cliente da fila (desistiu, saiu ou lane perdida), limpando o atendimento dele. */
  remove(l: Lane, c: Customer): void {
    if (l.svc && l.svc.c === c) {
      this.clear(l, l.svc);
      l.svc = null;
      this.env.ctx.bus.emit('checkout:display', { counterId: l.furnitureId, mode: 'idle' });
    }
    const i = l.line.indexOf(c);
    if (i >= 0) l.line.splice(i, 1);
  }

  /** checkoutAvailable: cliente esperando num caixa do jogador (dica para ui/player). */
  private available(seat: number | null): void {
    let id: number | null = null;
    for (const l of this.lanes) {
      if (l.staffed) continue;
      const f = l.line[0];
      if (!f || (f.state !== 'front' && f.state !== 'serving')) continue;
      if (id === null || seat === l.furnitureId) id = f.id;
    }
    if (id !== this.availId) { this.availId = id; this.env.ctx.bus.emit('checkoutAvailable', { customerId: id }); }
  }

  /** Para testes/debug. */
  debug(): { id: number; line: number; staffed: boolean; phase: string | null; mode: Op; belt: number; flying: number; shown: boolean; total: number; slots: number }[] {
    return this.lanes.map((l) => {
      const s = l.svc;
      let belt = 0;
      if (s) for (const it of s.belt) if (it) belt++;
      return { id: l.furnitureId, line: l.line.length, staffed: l.staffed, phase: s?.phase ?? null, mode: s?.mode ?? null, belt, flying: s?.flying.length ?? 0, shown: s?.shown ?? false, total: s?.total ?? 0, slots: l.slots.length };
    });
  }
  /** Quantos objetos estão registrados como tocáveis agora. */
  tappables(): number { return this.regs.size; }
  /** Toca (como o player) no 1º item tocável ou no pagamento — debug. */
  debugTap(): boolean {
    for (const l of this.lanes) {
      const s = l.svc;
      if (!s || s.mode !== 'player') continue;
      for (let i = s.belt.length - 1; i >= 0; i--) { const it = s.belt[i]; if (it && it.tappable) { it.tap(); return true; } }
      if (s.shown) { s.payTap(); return true; }
    }
    return false;
  }

  dispose(): void {
    for (const l of this.lanes) {
      if (l.svc) this.clear(l, l.svc);
      l.svc = null;
      if (l.prop) this.env.ctx.scene.remove(l.prop.group);
    }
    this.lanes.length = 0;
    for (const o of [...this.regs.keys()]) this.pickRemove(o);
    this.fbPick?.dispose();
    this.fbPick = null;
    this.pool.clear();
    disposeProps();
  }
}
