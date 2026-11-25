/**
 * Bot com RITMO HUMANO (QA de economia, docs/qa/economy.md). Joga pela API pública como bot.ts, mas o expediente corre
 * em SEGUNDOS REAIS e um jogador sozinho divide o tempo entre o caixa e a reposição. Números ESPELHADOS dos módulos de
 * jogo (não importados: a sim não depende de npc/ui/core em runtime) — se mudarem lá, atualize aqui:
 * - dia 08:00–21:00 = 780 min de jogo a 2 min/s → 390 s (core/clock.ts); chegadas até 20:30 (npc/index.ts
 *   arrivalTimes): 25% uniforme, 20% pico 09h30 (σ 45 min), 30% 12h30 (σ 50), 25% 18h00 (σ 55);
 * - clientes simultâneos = customerCapacity (6 no início) e ≤ 18 − funcionários; quem não cabe espera fora e some ao
 *   fechar (npc/index.ts); compras ≈ 8 s + 4 s por item (npc/customer.ts: andar, olhar 0,6–1,5 s, pegar 0,55 s);
 * - paciência 40–60 s (idoso ×1,2, criança ×0,8, atacado ×1,25) corre na fila; fila ≥ 6 desiste (npc/customer.ts);
 * - esteira: 1º item tocável em 0,57 s e depois 1 a cada 0,42 s; funcionário bipa a cada clamp(0,6·seg/itens, 0,22,
 *   1,1) s e cobra após max(0,8, 0,3·seg) s; 1 operador por balcão (npc/checkout.ts); rapidez da gorjeta = 0,5·bipagem
 *   + 0,5·painel (ui/pay.ts: par 3 + 1,1·peças no troco, 6 s na maquininha).
 * Tempos do jogador (toque, troco, viagem de reposição) vêm do perfil (HUMAN_PROFILES), estimados em docs/qa/economy.md.
 * Abastecer antes de abrir e à noite não gasta relógio (o relógio só anda com a loja aberta: core/clock.ts).
 */
import {
  acceptsPrice, basketTotal, buyExpansion, buyUpgrade, checkoutCart, closeDay, completeSale, customerCapacity, discardBox,
  employeeCost, employeeSpeed, expansionCost, expansionMinLevel, furnitureCatalog, furnitureForProduct, furnitureStock,
  hireOrUpgrade, isBankrupt, loanInfo, makeShoppingList, orderBoxes, placeFromStock, placeUnits, plannedArrivals, priceInfo,
  productCapacity, recordLostCustomer, repayLoan, restartAfterBankruptcy, returnToShelf, takeFromShelf, takeLoan,
  upgradeCatalog, type DayReport,
} from './api';
import { findSpot, investMorning, labelStarterShelves, reserve, restock as botRestock, setMarketPrices, type BotMemory } from './bot';
import { LICENSES, PRODUCTS } from './catalog';
import { buyLicense } from './economy';
import { customerCashPayment, optimalChange } from './money';
import { makeRng } from './rng';
import { newGame, type StoreState } from './state';
import type { FurnitureType } from '../core/layout';

/** Segundos reais do expediente (core/clock.ts: 780 min de jogo a 2 min/s). */
export const DAY_SECONDS = 390;
const DT = 0.1;

export interface HumanProfile {
  name: string;
  /** Preço = mercado × priceMult; 1 = sugerido (nunca mexe no preço). */
  priceMult: number;
  /** s por toque num item da esteira; s para tocar no dinheiro/cartão estendido. */
  tap: number;
  react: number;
  /** Painel: [leitura+OK, s por peça do troco] e [leitura+OK, s por tecla da maquininha]. */
  cash: [number, number];
  card: [number, number];
  /** Chance de errar no painel (erro: +4 s e −1 de satisfação). */
  mistake: number;
  /** Viagem de reposição: [fixo (computador, levantar/sentar, ida/volta), s por caixa (calçada→nível→largar a vazia)]. */
  trip: [number, number];
  /** Máx. caixas por viagem. */
  tripBoxes: number;
  /** Fração do expediente longe do caixa por distração (pausas de 20 s). */
  distraction: number;
  /** Repõe no expediente quando um produto exposto cai a ≤ trigger × capacidade (null = nunca). */
  trigger: number | null;
  /** Abastecimento sem relógio: 'bot' = bot.restock; 'over' = compra o dobro do que cabe; número = máx. caixas/produto. */
  morning: 'bot' | 'over' | number;
  invest: 'bot' | 'careful' | 'waste' | 'none';
  /** Usa o banco: pega o limite quando o caixa da manhã fica abaixo de R$ 50 (e paga quando sobra). */
  bank: boolean;
}

const BASE: Omit<HumanProfile, 'name'> = {
  priceMult: 1, tap: 0.8, react: 1.2, cash: [2.5, 0.8], card: [2, 0.6], mistake: 0.08, trip: [20, 18], tripBoxes: 3,
  distraction: 0.05, trigger: 0.25, morning: Infinity, invest: 'careful', bank: false,
};

/** Arquétipos de jogador (docs/qa/economy.md §2). */
export const HUMAN_PROFILES: Record<'cuidadoso' | 'desperdicador' | 'eficiente' | 'preguicoso', HumanProfile> = {
  cuidadoso: { ...BASE, name: 'iniciante cuidadoso', tap: 1.0, react: 1.5, cash: [3, 1.0], card: [2.5, 0.8], mistake: 0.12, trip: [25, 22], tripBoxes: 2, distraction: 0.1, trigger: 0, morning: 2 },
  desperdicador: { ...BASE, name: 'desperdiçador', priceMult: 1.25, trigger: 0.2, tripBoxes: 4, morning: 'over', invest: 'waste' },
  eficiente: { ...BASE, name: 'eficiente', priceMult: 1.1, tap: 0.6, react: 0.8, cash: [1.5, 0.6], card: [1.2, 0.4], mistake: 0.04, trip: [14, 15], distraction: 0, trigger: 0.35, morning: 'bot', invest: 'bot' },
  preguicoso: { ...BASE, name: 'preguiçoso', trigger: null },
};

/** Variações de outros módulos para testar propostas (sem mexer neles): duração do dia, paciência, largura dos picos. */
export interface HumanTweaks {
  /** Segundos reais do expediente (padrão 390). */
  daySeconds?: number;
  /** Paciência-base [mín, máx] em s (padrão [40, 60]). */
  patience?: [number, number];
  /** Multiplica o σ dos picos de chegada (padrão 1). */
  sigma?: number;
}

/* ---------- tempo de atendimento ---------- */

/** Instante (s, desde o início da descarga) em que o item i fica tocável na esteira. */
const avail = (i: number): number => 0.57 + 0.42 * i;

/** Jogador: fim da bipagem de `taps` itens e duração (do 1º tocável ao último bipe). */
export function playerScanSeconds(taps: number, tap: number): { end: number; dur: number } {
  let t = 0;
  for (let i = 0; i < taps; i++) t = Math.max(avail(i), t) + tap;
  return { end: t, dur: Math.max(0, t - avail(0)) };
}

/** Jogador: atendimento completo (chegar à esteira, bipar, ir pagar, tocar, painel) sem o tempo do painel. */
export const playerServiceFixed = (taps: number, p: Pick<HumanProfile, 'tap' | 'react'>): number =>
  1.4 + playerScanSeconds(taps, p.tap).end + 0.38 + 0.95 + p.react;

/** Funcionário caixa (`sec` = segundos por ação do nível): atendimento completo de `taps` itens (npc/checkout.ts). */
export function staffServiceSeconds(taps: number, sec: number): number {
  const per = Math.min(1.1, Math.max(0.22, (sec * 0.6) / Math.max(1, taps)));
  let t = Math.max(0.8, avail(0));
  for (let i = 1; i < taps; i++) t = Math.max(t + per, avail(i));
  return 1.4 + t + 0.38 + 0.7 + Math.max(0.8, sec * 0.3);
}

/** Toques no caixa (npc/checkout.ts groupTaps: no máx. ~12 por cliente). */
export const tapsFor = (units: number): number => {
  const per = Math.max(1, Math.ceil(units / 12));
  return Math.ceil(units / per);
};
/** Teclas na maquininha: "23,45" + OK. */
export const keysFor = (total: number): number => `${Math.floor(total / 100)},${String(total % 100).padStart(2, '0')}`.length + 1;

/* ---------- chegadas (npc/index.ts arrivalTimes, em segundos reais) ---------- */
export function arrivalSeconds(n: number, rand: () => number, tw: HumanTweaks = {}): number[] {
  const k = (tw.daySeconds ?? DAY_SECONDS) / 780;
  const sg = tw.sigma ?? 1;
  const comps = [{ w: 0.25, m: 0, s: 0 }, { w: 0.2, m: 570, s: 45 * sg }, { w: 0.3, m: 750, s: 50 * sg }, { w: 0.25, m: 1080, s: 55 * sg }];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let r = rand();
    let c = comps[0]!;
    for (const q of comps) { r -= q.w; if (r <= 0) { c = q; break; } }
    let t: number;
    if (c.s === 0) t = 480 + rand() * (1260 - 40 - 480);
    else t = c.m + Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand()) * c.s;
    out.push((Math.min(1230, Math.max(480, t)) - 480) * k);
  }
  return out.sort((a, b) => a - b);
}

/* ---------- dia com ritmo humano ---------- */

type Kind = 'normal' | 'bulk' | 'picky' | 'kid';
interface Item { productId: string; qty: number }
interface Cust { kind: Kind; patience: number; readyAt: number; list: Item[]; items: Item[]; complaints: number; oos: number; waited: number }
interface Lane { line: Cust[]; cur: Cust | null; until: number; speed: number; mistakes: number; staff: boolean }

export interface HumanOpenStats {
  arrivals: number;
  /** Desistiram na fila (paciência) / saíram sem nada (sem estoque ou caro) / nem entraram (loja cheia até fechar). */
  lostQueue: number;
  lostEmpty: number;
  vanished: number;
  /** Segundos: sentado no caixa, sentado sem ninguém para atender, em viagens de reposição. */
  seated: number;
  idleSeat: number;
  tripTime: number;
  trips: number;
  maxLine: number;
  stockoutItems: number;
  /** Atendimentos feitos pelo jogador e a soma dos segundos gastos neles. */
  svcN: number;
  svcSum: number;
  stockouts: Record<string, number>;
}
export interface HumanDayStats extends DayReport, Omit<HumanOpenStats, 'stockouts'> { level: number; money: number }

const BY_POP = [...PRODUCTS].sort((a, b) => b.popularity - a.popularity);
const displayed = (s: StoreState) => BY_POP.filter((p) => s.licenses.includes(p.category) && productCapacity(s, p.id) > 0);
const onFloor = (s: StoreState, id: string): number => s.sidewalk.reduce((a, b) => (b.productId === id && !b.carried ? a + b.units : a), 0);
const boxCost = (s: StoreState, id: string): number => priceInfo(s, id).wholesale * (PRODUCTS.find((p) => p.id === id)?.boxSize ?? 1);

/** Põe na exposição as caixas do produto que estão no chão e joga fora as vazias. */
function shelveFloor(s: StoreState, id: string): void {
  for (let i = 0; i < s.sidewalk.length; i++) {
    const b = s.sidewalk[i]!;
    if (b.productId === id && b.units > 0 && !b.carried) placeUnits(s, i, 999);
  }
  for (let i = s.sidewalk.length - 1; i >= 0; i--) if (s.sidewalk[i]!.productId === id && s.sidewalk[i]!.units === 0) discardBox(s, i);
}

/** Abastecimento sem relógio (manhã/noite): rodízio de 1 caixa por produto, do mais barato ao mais caro. */
function morningStock(s: StoreState, prof: HumanProfile): void {
  if (prof.morning === 'bot') { botRestock(s); return; }
  const over = prof.morning === 'over';
  const cap = typeof prof.morning === 'number' ? prof.morning : Infinity;
  const items = displayed(s).sort((a, b) => boxCost(s, a.id) - boxCost(s, b.id));
  const bought: Record<string, number> = {};
  const need = (id: string): number => (over ? 2 : 1) * productCapacity(s, id) - (s.shelf[id] ?? 0) - onFloor(s, id);
  for (let round = 0, any = true; any && round < 64; round++) {
    any = false;
    for (const p of items) {
      if (need(p.id) <= 0 || (bought[p.id] ?? 0) >= cap) continue;
      try { orderBoxes(s, p.id, 1); bought[p.id] = (bought[p.id] ?? 0) + 1; any = true; } catch { /* sem dinheiro */ }
    }
  }
  for (const p of items) shelveFloor(s, p.id);
}

/** Planeja uma viagem de reposição: produtos abaixo do gatilho, caixas do chão primeiro, depois compra. */
function planTrip(s: StoreState, prof: HumanProfile, queue: number): { id: string; boxes: number }[] | null {
  if (prof.trigger === null) return null;
  const low = displayed(s).filter((p) => (s.shelf[p.id] ?? 0) <= prof.trigger! * productCapacity(s, p.id));
  if (low.length === 0) return null;
  // eficiente/desperdiçador esperam a fila zerar, a não ser que algo tenha acabado
  if (prof.trigger > 0 && queue > 0 && !low.some((p) => (s.shelf[p.id] ?? 0) === 0)) return null;
  const plan: { id: string; boxes: number }[] = [];
  let left = prof.tripBoxes;
  for (const p of low) {
    if (left <= 0) break;
    let want = Math.min(left, Math.ceil((productCapacity(s, p.id) - (s.shelf[p.id] ?? 0)) / p.boxSize));
    const floorBoxes = s.sidewalk.filter((b) => b.productId === p.id && b.units > 0 && !b.carried).length;
    let got = Math.min(want, floorBoxes);
    for (want -= got; want > 0; want--) { try { orderBoxes(s, p.id, 1); got++; } catch { break; } }
    if (got > 0) { plan.push({ id: p.id, boxes: got }); left -= got; }
  }
  return plan.length ? plan : null;
}

function shoppingList(s: StoreState, kind: Kind, r: () => number): Item[] {
  const base = (): Item[] => makeShoppingList(s, r).map((i) => ({ ...i }));
  if (kind === 'bulk') {
    const out = base();
    for (const it of base()) if (!out.some((o) => o.productId === it.productId)) out.push(it);
    for (const it of out) it.qty = Math.max(it.qty, 1) + 1 + Math.floor(r() * 3);
    return out;
  }
  if (kind === 'kid') {
    const shown = PRODUCTS.filter((p) => (s.slots[p.id] ?? 0) > 0 && s.licenses.includes(p.category));
    const treats = shown.filter((p) => p.category === 'padaria' || /sorvete|refri|pao/.test(p.id));
    const pool = treats.length ? treats : shown;
    const n = Math.min(pool.length, 1 + Math.floor(r() * 2));
    const out: Item[] = [];
    for (let i = 0; i < n; i++) out.push({ productId: pool.splice(Math.floor(r() * pool.length), 1)[0]!.id, qty: 1 + Math.floor(r() * 2) });
    return out;
  }
  return base();
}

/** Expediente inteiro em segundos reais (sem investir/abastecer: ver playHumanDay). */
export function simulateHumanOpen(s: StoreState, prof: HumanProfile, rand: () => number, tw: HumanTweaks = {}): HumanOpenStats {
  const daySec = tw.daySeconds ?? DAY_SECONDS;
  const [pMin, pMax] = tw.patience ?? [40, 60];
  const times = arrivalSeconds(plannedArrivals(s), rand, tw);
  const counters = Math.max(1, s.furniture.filter((f) => f.type === 'counter').length);
  const lanes: Lane[] = Array.from({ length: counters }, () => ({ line: [], cur: null, until: 0, speed: 0, mistakes: 0, staff: false }));
  const cashier = s.employees.cashier;
  const staffN = (cashier > 0 ? 1 : 0) + (s.employees.stocker > 0 ? 1 : 0) + (s.employees.janitor > 0 ? 1 : 0);
  const cap = Math.max(1, Math.min(18 - staffN, customerCapacity(s)));
  // funcionário no balcão 0; o jogador senta no 1 se houver (com 1 balcão e caixa contratado, o jogador só repõe)
  if (cashier > 0) lanes[0]!.staff = true;
  const playerLane = cashier > 0 ? (counters > 1 ? 1 : -1) : 0;
  const breaks = Array.from({ length: Math.round((prof.distraction * daySec) / 20) }, () => 20 + rand() * (daySec - 50)).sort((a, b) => a - b);
  const shopping: Cust[] = [];
  const st: HumanOpenStats = {
    arrivals: times.length, lostQueue: 0, lostEmpty: 0, vanished: 0, seated: 0, idleSeat: 0, tripTime: 0, trips: 0, maxLine: 0,
    stockoutItems: 0, svcN: 0, svcSum: 0, stockouts: {},
  };
  let next = 0;
  let inStore = 0;
  let player: { mode: 'seat' | 'trip' | 'away' | 'idle'; until: number; plan?: { id: string; boxes: number }[] } = { mode: 'away', until: 6 };
  const sec = cashier > 0 ? employeeSpeed('cashier', cashier) : 10;
  const exits: number[] = []; // quem sai ainda anda até a porta (~4 s) e ocupa a vaga
  let now = 0;
  const leave = (): void => { exits.push(now + 4); };
  const giveUp = (c: Cust): void => {
    for (const it of c.items) returnToShelf(s, it.productId, it.qty);
    recordLostCustomer(s, 1);
    st.lostQueue++;
    leave();
  };
  const start = (l: Lane, t: number): void => {
    const c = l.line.shift()!;
    l.cur = c;
    const taps = tapsFor(c.items.reduce((a, i) => a + i.qty, 0));
    if (l.staff) {
      const k = sec * (c.kind === 'bulk' ? 1.6 : 1);
      l.until = t + staffServiceSeconds(taps, k);
      l.speed = Math.min(1, Math.max(0.15, 1 - (k - 1.5) / 9));
      l.mistakes = 0;
      return;
    }
    const scan = playerScanSeconds(taps, prof.tap);
    const total = basketTotal(s, c.items);
    const cash = rand() < 0.6;
    let pieces = 0;
    if (cash) { try { pieces = optimalChange(customerCashPayment(total, rand) - total).length; } catch { pieces = 3; } }
    let pay = cash ? prof.cash[0] + prof.cash[1] * pieces : prof.card[0] + prof.card[1] * keysFor(total);
    l.mistakes = rand() < prof.mistake ? 1 : 0;
    pay += 4 * l.mistakes;
    const par = cash ? 3 + 1.1 * Math.max(1, pieces) : 6;
    const paySp = 1 - Math.min(1, Math.max(0, (pay - 0.75 * par) / (1.85 * par)));
    const scanSp = Math.min(1, Math.max(0.1, 1 - ((scan.dur + prof.react) / Math.max(1, taps) - 0.6) / 2.4));
    const sp = 0.5 * scanSp + 0.5 * paySp;
    l.speed = c.kind === 'bulk' ? (sp >= 0.6 ? Math.min(1, sp * 1.3) : sp * 0.85) : sp;
    const dur = playerServiceFixed(taps, prof) + pay;
    l.until = t + dur;
    st.svcN++;
    st.svcSum += dur;
  };
  const finish = (l: Lane): void => {
    const c = l.cur!;
    l.cur = null;
    const frac = c.waited / c.patience;
    const sat = Math.round(5 - l.mistakes - (frac > 0.75 ? 1.5 : frac > 0.5 ? 1 : frac > 0.25 ? 0.5 : 0) - 0.5 * c.complaints - 0.5 * c.oos - (c.kind === 'picky' ? 0.5 : 0));
    completeSale(s, c.items, l.speed, Math.min(5, Math.max(1, sat)));
    leave();
  };
  const bestLane = (): Lane => {
    let best = lanes[0]!;
    let bs = Infinity;
    lanes.forEach((l, i) => {
      const manned = l.staff || (player.mode === 'seat' && i === playerLane);
      const est = (l.line.length + (l.cur ? 1 : 0) + 1) * (l.staff ? sec + 3 : 9) + (manned ? 0 : 12);
      if (est < bs) { bs = est; best = l; }
    });
    return best;
  };

  for (let t = 0; t < daySec + 600; t += DT) {
    now = t;
    const open = t < daySec;
    for (let i = exits.length - 1; i >= 0; i--) if (exits[i]! <= t) { exits.splice(i, 1); inStore--; }
    // chegadas (limite de simultâneos: o excedente espera do lado de fora)
    while (open && next < times.length && times[next]! <= t && inStore < cap) {
      next++;
      inStore++;
      const kr = rand();
      const kind: Kind = kr < 0.05 ? 'bulk' : kr < 0.11 ? 'picky' : kr < 0.18 ? 'kid' : 'normal';
      const elder = kind !== 'kid' && rand() < 0.16;
      const list = shoppingList(s, kind, rand);
      const patience = (pMin + rand() * (pMax - pMin)) * (elder ? 1.2 : 1) * (kind === 'kid' ? 0.8 : kind === 'bulk' ? 1.25 : 1);
      shopping.push({ kind, patience, readyAt: t + (8 + 4 * list.length * (elder ? 1.25 : 1)) * (0.8 + 0.4 * rand()), list, items: [], complaints: 0, oos: 0, waited: 0 });
    }
    if (!open && next < times.length) { st.vanished += times.length - next; next = times.length; }
    // fim das compras: pega os itens; sem nada → vai embora; senão entra na fila
    for (let i = shopping.length - 1; i >= 0; i--) {
      const c = shopping[i]!;
      if (c.readyAt > t) continue;
      shopping.splice(i, 1);
      let units = 0;
      for (const it of c.list) {
        if ((s.shelf[it.productId] ?? 0) <= 0) { c.oos++; st.stockoutItems++; st.stockouts[it.productId] = (st.stockouts[it.productId] ?? 0) + 1; continue; }
        const a = acceptsPrice(s, it.productId, rand);
        const pickyNo = c.kind === 'picky' && a.ratio > 1.1;
        if (pickyNo || !a.ok) { if (pickyNo || a.ratio > 1.05) c.complaints += pickyNo ? 2 : 1; continue; }
        if (units >= (c.kind === 'bulk' ? 36 : 18)) continue;
        const got = takeFromShelf(s, it.productId, it.qty);
        if (got > 0) { c.items.push({ productId: it.productId, qty: got }); units += got; }
      }
      if (c.items.length === 0) { recordLostCustomer(s, c.complaints > 0 ? 1 : 2); st.lostEmpty++; leave(); continue; }
      const l = bestLane();
      if (l.line.length >= 6) { giveUp(c); continue; }
      l.line.push(c);
    }
    // jogador: volta de viagem/pausa; só sai do caixa entre um cliente e outro
    if ((player.mode === 'trip' || player.mode === 'away') && t >= player.until) {
      if (player.plan) for (const p of player.plan) shelveFloor(s, p.id);
      player = { mode: playerLane >= 0 ? 'seat' : 'idle', until: 0 };
    }
    const myLane = playerLane >= 0 ? lanes[playerLane]! : null;
    if ((player.mode === 'seat' && !myLane!.cur) || player.mode === 'idle') {
      if (breaks.length && breaks[0]! <= t && player.mode === 'seat') {
        breaks.shift();
        player = { mode: 'away', until: t + 20 };
      } else if (open || shopping.length + lanes.reduce((a, l) => a + l.line.length, 0) > 0) {
        const plan = planTrip(s, prof, myLane ? myLane.line.length : 0);
        if (plan) {
          const boxes = plan.reduce((a, p) => a + p.boxes, 0);
          player = { mode: 'trip', until: t + prof.trip[0] + prof.trip[1] * boxes, plan };
          st.trips++;
        }
      }
    }
    if (player.mode === 'seat') {
      st.seated += DT;
      if (!myLane!.cur && myLane!.line.length === 0) st.idleSeat += DT;
    }
    if (player.mode === 'trip') st.tripTime += DT;
    // caixas: terminar, começar, paciência
    lanes.forEach((l, i) => {
      if (l.cur && t >= l.until) finish(l);
      const manned = l.staff || (player.mode === 'seat' && i === playerLane);
      if (!l.cur && manned && l.line.length > 0) start(l, t);
      st.maxLine = Math.max(st.maxLine, l.line.length);
      for (let k = l.line.length - 1; k >= 0; k--) {
        const c = l.line[k]!;
        c.waited += DT;
        if (c.waited > c.patience) { l.line.splice(k, 1); giveUp(c); }
      }
    });
    if (!open && inStore - exits.length <= 0 && player.mode !== 'trip') break;
  }
  return st;
}

/* ---------- investimentos por perfil ---------- */

function buyAndPlace(s: StoreState, type: FurnitureType, productId?: string, variant?: string): boolean {
  const spot = findSpot(s, type);
  if (!spot) return false;
  try {
    checkoutCart(s, [{ kind: 'furniture', id: type, qty: 1, ...(variant ? { variant } : {}) }]);
  } catch { return false; }
  placeFromStock(s, furnitureStock(s).length - 1, spot.x, spot.z, 0, productId);
  return true;
}
const spec = (type: FurnitureType) => furnitureCatalog().find((c) => c.type === type)!;

/** Iniciante cuidadoso/preguiçoso: só compra quando sobra a reserva do bot + R$ 100; 1 móvel novo por dia. */
function investCareful(s: StoreState): void {
  const can = (cost: number): boolean => s.money - cost >= reserve(s) + 10000;
  let furniture = false;
  // licença nova (categoria nova = clientes novos) antes de mais uma prateleira de mercearia
  for (const l of LICENSES) {
    if (furniture || s.licenses.includes(l.id) || s.level < l.minLevel) continue;
    const first = BY_POP.find((p) => p.category === l.id);
    if (!first || !can(l.cost + spec(furnitureForProduct(first.id)).cost)) break;
    buyLicense(s, l.id);
    furniture = buyAndPlace(s, furnitureForProduct(first.id), first.id);
  }
  for (const p of BY_POP) {
    if (furniture || !s.licenses.includes(p.category) || productCapacity(s, p.id) > 0) continue;
    const f = spec(furnitureForProduct(p.id));
    if (s.level >= f.minLevel && can(f.cost)) furniture = buyAndPlace(s, f.type, p.id);
  }
  const tip = upgradeCatalog(s).find((u) => u.id === 'tipjar')!;
  if (!tip.owned && s.level >= tip.minLevel && can(tip.cost)) buyUpgrade(s, 'tipjar');
  const cc = employeeCost(s, 'cashier');
  if (cc && s.employees.cashier === 0 && s.level >= cc.minLevel && can(cc.cost + 3 * cc.dailyWage)) hireOrUpgrade(s, 'cashier');
  const ec = expansionCost(s);
  if (!furniture && ec !== null && s.level >= (expansionMinLevel(s) ?? 99) && can(ec + 30000)) buyExpansion(s);
}

/** Desperdiçador: planta no dia 1, móvel/licença/expansão/caixa assim que dá (sem reserva, móvel antes do estoque). */
function investWaste(s: StoreState): void {
  if (s.day === 1 && s.money >= 8000) buyAndPlace(s, 'decor', undefined, 'plant');
  for (const p of BY_POP) {
    if (!s.licenses.includes(p.category) || productCapacity(s, p.id) > 0) continue;
    const f = spec(furnitureForProduct(p.id));
    if (s.level >= f.minLevel && s.money >= f.cost) buyAndPlace(s, f.type, p.id);
  }
  for (const l of LICENSES) if (!s.licenses.includes(l.id) && s.level >= l.minLevel && s.money >= l.cost) buyLicense(s, l.id);
  const cc = employeeCost(s, 'cashier');
  if (cc && s.employees.cashier === 0 && s.level >= cc.minLevel && s.money >= cc.cost) hireOrUpgrade(s, 'cashier');
  const ec = expansionCost(s);
  if (ec !== null && s.level >= (expansionMinLevel(s) ?? 99) && s.money >= ec) buyExpansion(s);
}

function useBank(s: StoreState): void {
  const li = loanInfo(s);
  if (s.money < 5000 && li.available > 0) takeLoan(s, li.available);
  else if (s.loan > 0 && s.money > 3 * s.loan + reserve(s)) repayLoan(s, s.loan);
}

/* ---------- dias ---------- */

export interface HumanRun { state: StoreState; prof: HumanProfile; mem: BotMemory; bankruptcies: number; tweaks: HumanTweaks }

export function newHumanRun(seed: number, prof: HumanProfile, startMoney?: number, tweaks: HumanTweaks = {}): HumanRun {
  const state = newGame(seed);
  if (startMoney !== undefined) state.money = startMoney;
  return { state, prof, mem: { stockouts: {}, arrivals: 0, lostByCapacity: 0, lastNet: 0 }, bankruptcies: 0, tweaks };
}

/** Joga um dia: investe (manhã), precifica, abastece sem relógio, expediente com ritmo humano, fecha o dia. */
export function playHumanDay(run: HumanRun): HumanDayStats {
  const { state: s, prof } = run;
  labelStarterShelves(s);
  if (prof.bank) useBank(s);
  if (prof.invest === 'bot') investMorning(s, run.mem);
  else if (prof.invest === 'careful') investCareful(s);
  else if (prof.invest === 'waste') investWaste(s);
  if (prof.priceMult !== 1) setMarketPrices(s, prof.priceMult);
  else s.prices = {}; // preço sugerido = média de mercado do dia (sem preço próprio)
  morningStock(s, prof);
  const open = simulateHumanOpen(s, prof, makeRng(s.seed * 7717 + s.day * 131 + 5), run.tweaks);
  const report = closeDay(s);
  const { stockouts, ...rest } = open;
  run.mem = { stockouts, arrivals: open.arrivals, lostByCapacity: open.lostQueue + open.vanished, lastNet: report.netProfit };
  const out: HumanDayStats = { ...report, ...rest, level: s.level, money: s.money };
  if (isBankrupt(s)) { restartAfterBankruptcy(s); run.bankruptcies++; }
  return out;
}

export function playHumanDays(run: HumanRun, days: number): HumanDayStats[] {
  const out: HumanDayStats[] = [];
  for (let d = 0; d < days; d++) out.push(playHumanDay(run));
  return out;
}
