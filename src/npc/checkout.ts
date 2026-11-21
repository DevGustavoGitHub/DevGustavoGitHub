/** Filas e caixas: cada counter do mundo vira uma Lane (fila + esteira). Operador = funcionário ou jogador. */
import * as THREE from 'three';
import type { Vec2 } from '../core/services';
import * as api from '../sim/api';
import { customerCashPayment } from '../sim/money';
import type { Customer } from './customer';
import { itemMesh, productMaterial } from './model';
import { COUNTER_Y, type Env, clamp, safe } from './shared';

export const PLAYER_SERVE_SEC = 9; // estimativa p/ escolher fila

export class Lane {
  line: Customer[] = [];
  operator: Vec2 = { x: 0, z: 0 };
  queue: Vec2[] = [];
  scanner: Vec2 = { x: 0, z: 0 };
  /** true se este é o caixa do funcionário contratado. */
  staffed = false;
  serving: Customer | null = null;
  serveT = 0;
  serveDur = 3;
  scanned = 0;
  pending: Customer | null = null;
  /** Bloqueia novo pedido ao jogador até ele sair do balcão (após cancelar). */
  blockedUntilLeave = false;
  /** Jogador tocou em 'Atender' de novo depois de cancelar: libera novo checkoutRequest imediato. */
  retry = false;
  blockedT = 0;
  /** Há quanto tempo o pedido ao jogador está sem resposta (s). */
  pendingT = 0;
  awayT = 0;
  readonly belt = new THREE.Group();
  private readonly beltItems: THREE.Mesh[] = [];
  private readonly slotTmp: Vec2 = { x: 0, z: 0 };

  constructor(readonly furnitureId: number, scene: THREE.Scene) {
    for (let i = 0; i < 8; i++) {
      const m = itemMesh();
      this.beltItems.push(m);
      this.belt.add(m);
    }
    scene.add(this.belt);
  }

  setGeometry(operator: Vec2, queue: Vec2[], scanner: Vec2): void {
    this.operator = operator; this.queue = queue; this.scanner = scanner;
    this.belt.position.set(scanner.x, COUNTER_Y, scanner.z);
  }

  /** Posição do i-ésimo lugar da fila (objeto reutilizado, não guardar). */
  slot(i: number): Vec2 {
    const q = this.queue;
    if (q.length === 0) { this.slotTmp.x = this.operator.x; this.slotTmp.z = this.operator.z + 1 + i * 0.8; return this.slotTmp; }
    if (i < q.length) return q[i]!;
    const a = q[q.length - 1]!, b = q[Math.max(0, q.length - 2)]!;
    let dx = a.x - b.x, dz = a.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
    const k = i - (q.length - 1);
    this.slotTmp.x = a.x + dx * 0.8 * k; this.slotTmp.z = a.z + dz * 0.8 * k;
    return this.slotTmp;
  }

  showBelt(items: { productId: string; qty: number }[], remaining: number): void {
    let n = 0;
    // direção do lado do cliente
    const q0 = this.queue[0];
    let dx = 0, dz = 1;
    if (q0) { dx = q0.x - this.scanner.x; dz = q0.z - this.scanner.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d; }
    for (let i = 0; i < items.length && n < 8; i++) {
      for (let k = 0; k < Math.min(2, items[i]!.qty) && n < 8; k++) {
        const m = this.beltItems[n]!;
        m.visible = n < remaining;
        if (m.visible) {
          m.material = productMaterial(items[i]!.productId);
          m.position.set(dx * (0.18 + n * 0.1), 0.05, dz * (0.18 + n * 0.1));
        }
        n++;
      }
    }
    for (; n < 8; n++) this.beltItems[n]!.visible = false;
  }

  hideBelt(): void { for (const m of this.beltItems) m.visible = false; }

  dispose(scene: THREE.Scene): void { scene.remove(this.belt); }
}

export interface CashierLike {
  /** Está no posto da lane indicada e operante. */
  atPost(lane: Lane): boolean;
  lane: Lane | null;
}

export class CheckoutManager {
  lanes: Lane[] = [];
  cashier: CashierLike | null = null;
  private availId: number | null = null;
  private acc = 0;
  private refreshT = 0;

  constructor(private env: Env, private onSale: () => void) {
    this.refresh();
  }

  /** Reconstrói/atualiza lanes a partir de world.counters(). Clientes de lanes removidas são devolvidos. */
  refresh(): void {
    const cs = this.env.world().counters();
    const seen = new Set<number>();
    for (const c of cs) {
      seen.add(c.furnitureId);
      let lane = this.lanes.find((l) => l.furnitureId === c.furnitureId);
      if (!lane) { lane = new Lane(c.furnitureId, this.env.ctx.scene); this.lanes.push(lane); }
      lane.setGeometry(c.operator, c.queue, c.scanner);
    }
    for (let i = this.lanes.length - 1; i >= 0; i--) {
      const l = this.lanes[i]!;
      if (seen.has(l.furnitureId)) continue;
      this.lanes.splice(i, 1);
      for (const cu of l.line) cu.laneLost();
      l.dispose(this.env.ctx.scene);
    }
    this.lanes.sort((a, b) => a.furnitureId - b.furnitureId);
    const hasCashier = this.env.ctx.state.employees.cashier > 0;
    for (let i = 0; i < this.lanes.length; i++) this.lanes[i]!.staffed = hasCashier && i === 0;
    if (this.cashier) this.cashier.lane = hasCashier ? (this.lanes[0] ?? null) : null;
  }

  /** Melhor lane para um cliente (menor espera estimada). */
  best(): Lane | null {
    let b: Lane | null = null;
    let bs = Infinity;
    const csec = safe('employeeSpeed', () => api.employeeSpeed('cashier', this.env.ctx.state.employees.cashier), 4);
    for (const l of this.lanes) {
      const s = (l.line.length + 1) * (l.staffed ? csec : PLAYER_SERVE_SEC) + (l.pending ? 0 : 0);
      if (s < bs) { bs = s; b = l; }
    }
    return b;
  }

  private playerAt(l: Lane): boolean {
    const p = this.env.ctx.services.player;
    if (!p) return false;
    if (p.atCounter !== undefined) return p.atCounter === l.furnitureId;
    const dx = p.position.x - l.operator.x, dz = p.position.z - l.operator.z;
    return dx * dx + dz * dz < 1.6 * 1.6;
  }

  update(dt: number): void {
    this.refreshT += dt;
    if (this.refreshT > 0.6) { this.refreshT = 0; this.refresh(); }
    const { ctx } = this.env;
    for (const l of this.lanes) {
      const front = l.line[0];
      // servindo (funcionário)
      if (l.serving) {
        const c = l.serving;
        if (!l.staffed || !this.cashier?.atPost(l)) { /* caixa saiu do posto: pausa */ continue; }
        l.serveT += dt;
        const n = c.items.length > 0 ? Math.min(8, c.units) : 1;
        const frac = clamp(l.serveT / (l.serveDur * 0.75), 0, 1);
        const scanned = Math.floor(frac * n);
        if (scanned > l.scanned) { l.scanned = scanned; this.env.sfx('scan', l.scanner.x); l.showBelt(c.items, n - scanned); }
        if (l.serveT >= l.serveDur) {
          const sec = l.serveDur;
          const speed = clamp(1 - (sec - 1.5) / 9, 0.15, 1);
          this.env.sfx(c.method === 'card' ? 'card' : 'cash', l.scanner.x);
          l.serving = null; l.hideBelt();
          this.remove(l, c);
          c.finishSale(speed, 0);
          this.onSale();
        }
        continue;
      }
      if (!front || front.state !== 'front') continue;
      if (l.staffed) {
        if (!this.cashier?.atPost(l)) continue;
        l.serving = front;
        front.state = 'serving';
        l.serveT = 0; l.scanned = 0;
        l.serveDur = Math.max(1.2, safe('employeeSpeed', () => api.employeeSpeed('cashier', ctx.state.employees.cashier), 4)) * (front.kind === 'bulk' ? 1.6 : 1);
        front.method = ctx.rand() < 0.6 ? 'cash' : 'card';
        l.showBelt(front.items, Math.min(8, front.units));
      }
    }
    this.acc += dt;
    if (this.acc >= 0.2) { this.acc = 0; this.playerFlow(); }
  }

  /** Disponibilidade e pedido de checkout ao jogador. */
  private playerFlow(): void {
    const { bus } = this.env.ctx;
    let availLane: Lane | null = null;
    const p = this.env.ctx.services.player;
    let bd = Infinity;
    for (const l of this.lanes) {
      // pedido sem resposta (jogador saiu do balcão ou a UI descartou): libera o cliente para não travar a fila
      if (l.pending) {
        l.pendingT += 0.2;
        l.awayT = this.playerAt(l) ? 0 : l.awayT + 0.2;
        if (l.awayT > 1.5 || l.pendingT > 90) { l.pending = null; l.pendingT = 0; l.awayT = 0; l.hideBelt(); }
      }
      if (l.staffed) continue;
      const front = l.line[0];
      if (l.blockedUntilLeave && !this.playerAt(l)) l.blockedUntilLeave = false;
      if (l.blockedUntilLeave && l.retry && !l.pending) { l.blockedUntilLeave = false; }
      if (!front || front.state !== 'front') l.retry = false;
      if (!front || front.state !== 'front') continue;
      let d = 0;
      if (p) { const dx = p.position.x - l.operator.x, dz = p.position.z - l.operator.z; d = dx * dx + dz * dz; }
      if (this.playerAt(l)) d = -1;
      if (d < bd) { bd = d; availLane = l; }
    }
    const id = availLane ? availLane.line[0]!.id : null;
    if (id !== this.availId) { this.availId = id; bus.emit('checkoutAvailable', { customerId: id }); }
    if (availLane && !availLane.pending && !availLane.blockedUntilLeave && this.playerAt(availLane) && !p?.inputLocked) {
      const c = availLane.line[0]!;
      c.method = this.env.ctx.rand() < 0.6 ? 'cash' : 'card';
      const total = safe('basketTotal', () => api.basketTotal(this.env.ctx.state, c.items), 0);
      const paid = c.method === 'cash' ? customerCashPayment(total, this.env.ctx.rand) : undefined;
      availLane.pending = c;
      availLane.pendingT = 0; availLane.awayT = 0;
      availLane.retry = false;
      c.requestedAt = c.waited;
      availLane.showBelt(c.items, Math.min(8, c.units));
      const payload: { customerId: number; items: { productId: string; qty: number }[]; total: number; method: 'cash' | 'card'; paid?: number } = {
        customerId: c.id, items: c.items.map((i) => ({ productId: i.productId, qty: i.qty })), total, method: c.method,
      };
      if (paid !== undefined) payload.paid = paid;
      bus.emit('checkoutRequest', payload);
    }
  }

  /** Resultado do minigame de checkout (UI). */
  onResult(r: { customerId: number; ok: boolean; speed: number; mistakes: number }): void {
    for (const l of this.lanes) {
      const c = l.pending;
      if (!c || c.id !== r.customerId) continue;
      l.pending = null;
      if (r.ok) {
        l.hideBelt();
        this.remove(l, c);
        c.finishSale(clamp(r.speed, 0, 1), Math.max(0, r.mistakes));
        this.onSale();
      } else {
        // cancelar: o cliente reclama, perde paciência e fica esperando; novo toque em 'Atender' reabre
        l.blockedUntilLeave = true;
        l.retry = false;
        l.hideBelt();
        c.onCheckoutCancel();
        if (c.state === 'front' || c.state === 'queue') this.env.ctx.bus.emit('toast', { text: 'Cliente esperando: toque em Atender para tentar de novo', kind: 'info' });
      }
      return;
    }
  }

  /** O jogador tocou em 'Atender' após cancelar: permite novo pedido na próxima varredura (<=0,2 s). */
  retryCheckout(): boolean {
    let any = false;
    for (const l of this.lanes) {
      if (l.staffed || l.pending || !l.blockedUntilLeave || l.line[0]?.state !== 'front') continue;
      l.retry = true; any = true;
    }
    if (any) this.acc = 0.2;
    return any;
  }

  /** Remove um cliente da fila (atendido, desistiu ou lane perdida). */
  remove(l: Lane, c: Customer): void {
    const i = l.line.indexOf(c);
    if (i >= 0) l.line.splice(i, 1);
    if (l.pending === c) l.pending = null;
    if (l.serving === c) { l.serving = null; l.hideBelt(); }
    if (l.line.length === 0 || i === 0) l.hideBelt();
  }

  /** Lane atual onde o jogador/funcionário opera (para animação do caixa). */
  isScanning(l: Lane): boolean { return l.serving !== null; }

  dispose(): void {
    for (const l of this.lanes) l.dispose(this.env.ctx.scene);
    this.lanes.length = 0;
  }
}

