/**
 * Bot de balanceamento: joga dias inteiros só pela API pública (mesmas chamadas do jogo interativo).
 * Repõe várias vezes ao dia, precifica por mercado × multiplicador e investe (licenças, móveis, caixa, expansão).
 * Usado por tests/balance.test.ts e para calibrar docs/GDD.md §4.
 */
import {
  acceptsPrice, addDirt, arrivalSchedule, assignProduct, buyExpansion, buyFurniture, canPlace, cleanDirt, closeDay,
  completeSale, discardBox, employeeCost, expansionCost, expansionMinLevel, furnitureCatalog, hireOrUpgrade, makeShoppingList,
  orderBoxes, placeUnits, productCapacity, recordLostCustomer, storeBox, takeFromShelf,
} from './api';
import { LICENSES, PRODUCTS, productById, type Category } from './catalog';
import { buyLicense, checkoutCapacity, type DayReport } from './economy';
import { storeBounds } from '../core/layout';
import { marketAverage } from './market';
import { roundPrice } from './money';
import { makeRng } from './rng';
import type { StoreState } from './state';
import type { FurnitureType } from '../core/layout';

export interface BotOptions {
  /** Preço = mercado × priceMult. */
  priceMult: number;
  /** Quantas vezes por dia o jogador repõe as prateleiras. */
  restocks: number;
  /** Compra licenças/móveis/funcionários/expansão quando vale a pena. */
  invest: boolean;
}

export interface DayStats extends DayReport {
  arrivals: number;
  stockouts: number;
  rejected: number;
  lostByCapacity: number;
  level: number;
  money: number;
}

export const defaultBotOptions: BotOptions = { priceMult: 1.12, restocks: 4, invest: true };

const typeFor = (c: Category): FurnitureType => (c === 'bebidas' || c === 'laticinios' ? 'fridge' : c === 'congelados' ? 'freezer' : 'shelf');

export function findSpot(state: StoreState, type: FurnitureType): { x: number; z: number } | null {
  const b = storeBounds(state.expansion);
  for (let z = 0; z < b.depth; z++) for (let x = 0; x < b.width; x++) if (canPlace(state, type, x, z, 0)) return { x, z };
  return null;
}

export function setMarketPrices(state: StoreState, mult: number): void {
  for (const p of PRODUCTS) if (state.licenses.includes(p.category)) state.prices[p.id] = roundPrice(marketAverage(state, p.id) * mult);
}

/** Repõe todas as prateleiras que couberem no caixa; sobras de caixa vão ao depósito se houver espaço. */
export function restock(state: StoreState): void {
  for (const p of [...PRODUCTS].sort((a, b) => b.popularity - a.popularity)) {
    if (!state.licenses.includes(p.category)) continue;
    const cap = productCapacity(state, p.id);
    if (cap === 0) continue;
    const missing = cap - (state.shelf[p.id] ?? 0);
    if (missing <= 0) continue;
    const onSide = state.sidewalk.filter((b) => b.productId === p.id).reduce((a, b) => a + b.units, 0);
    for (let n = Math.ceil(Math.max(0, missing - onSide) / p.boxSize); n > 0; n--) {
      try {
        orderBoxes(state, p.id, n);
        break;
      } catch {
        /* sem caixa suficiente: tenta menos caixas */
      }
    }
    for (let i = 0; i < state.sidewalk.length; i++) {
      if (state.sidewalk[i]!.productId === p.id && state.sidewalk[i]!.units > 0) placeUnits(state, i, 999);
    }
    // caixas vazias -> lixeira; caixas com sobra -> depósito (se der) ou ficam na calçada
    for (let i = state.sidewalk.length - 1; i >= 0; i--) {
      const b = state.sidewalk[i]!;
      if (b.productId !== p.id) continue;
      if (b.units === 0) discardBox(state, i);
      else if (state.storageUnlocked) {
        try { storeBox(state, i); } catch { /* depósito cheio */ }
      }
    }
  }
}

const afford = (state: StoreState, cost: number): boolean => state.money - cost >= 80000 + 6000 * state.level;

/** Investimentos da manhã (uma decisão por categoria por dia, simples e conservadora). */
export function investMorning(state: StoreState, mem: { stockouts: Record<string, number>; arrivals: number; lostByCapacity: number; lastNet: number }): void {
  // 0. expansão tem prioridade (loja maior = mais clientes)
  const ec = expansionCost(state);
  const em = expansionMinLevel(state);
  if (ec !== null && em !== null && state.level >= em && afford(state, ec)) buyExpansion(state);
  // Se a expansão já está liberada por nível mas ainda não cabe no caixa, o bot poupa (sem licenças/capacidade extra).
  const saving = ec !== null && state.level >= (em ?? 99) && ec - state.money <= 6 * mem.lastNet;
  // 1. licenças (mais baratas primeiro)
  for (const l of LICENSES) {
    if (saving || state.licenses.includes(l.id) || state.level < l.minLevel || !afford(state, l.cost)) continue;
    buyLicense(state, l.id);
  }
  const buyFurnitureOfType = (type: FurnitureType): boolean => {
    const spec = furnitureCatalog().find((c) => c.type === type)!;
    if (state.level < spec.minLevel || !afford(state, spec.cost)) return false;
    const spot = findSpot(state, type);
    if (!spot) return false;
    buyFurniture(state, type, spot.x, spot.z, 0);
    return true;
  };
  const buyFor = (productId: string): boolean => {
    const cat = productById(productId).category;
    const type = typeFor(cat);
    const spec = furnitureCatalog().find((s) => s.type === type)!;
    if (state.level < spec.minLevel || !afford(state, spec.cost)) return false;
    const spot = findSpot(state, type);
    if (!spot) return false;
    const f = buyFurniture(state, type, spot.x, spot.z, 0);
    assignProduct(state, f.id, productId);
    return true;
  };
  // 2. todo produto licenciado precisa de pelo menos 1 móvel
  for (const p of PRODUCTS) if (state.licenses.includes(p.category) && productCapacity(state, p.id) === 0) buyFor(p.id);
  // 3. mais capacidade onde houve ruptura (no máx. 1 por dia)
  const worst = Object.entries(mem.stockouts).sort((a, b) => b[1] - a[1])[0];
  if (!saving && worst && worst[1] >= 4) buyFor(worst[0]);
  // 4. caixa contratado quando o checkout é o gargalo
  const cc = employeeCost(state, 'cashier');
  if (!saving && cc && state.level >= cc.minLevel && (mem.lostByCapacity > 0 || mem.arrivals > 0.85 * checkoutCapacity(state)) && afford(state, cc.cost + cc.dailyWage * 10)) {
    hireOrUpgrade(state, 'cashier');
  }
  // 5. caixa registradora extra quando o checkout transborda
  if (mem.lostByCapacity > 3) buyFurnitureOfType('counter');
}

export interface Bot {
  opts: BotOptions;
  mem: { stockouts: Record<string, number>; arrivals: number; lostByCapacity: number; lastNet: number };
}
export const newBot = (opts: Partial<BotOptions> = {}): Bot => ({
  opts: { ...defaultBotOptions, ...opts },
  mem: { stockouts: {}, arrivals: 0, lostByCapacity: 0, lastNet: 0 },
});

/** Joga um dia completo (investe, precifica, repõe, atende todos os clientes previstos, fecha o dia). */
export function playDay(state: StoreState, bot: Bot): DayStats {
  const { opts } = bot;
  if (opts.invest) investMorning(state, bot.mem);
  setMarketPrices(state, opts.priceMult);
  restock(state);
  const times = arrivalSchedule(state);
  const capacity = checkoutCapacity(state);
  const rand = makeRng(state.seed * 31 + state.day * 7 + 1);
  const stockouts: Record<string, number> = {};
  let stockoutN = 0;
  let rejected = 0;
  let lostByCapacity = 0;
  const every = Math.max(1, Math.ceil(times.length / Math.max(1, opts.restocks)));
  for (let i = 0; i < times.length; i++) {
    if (i > 0 && i % every === 0) {
      while (state.dirt.length) cleanDirt(state, 0);
      restock(state);
    }
    if (i >= capacity) {
      recordLostCustomer(state, 2);
      lostByCapacity++;
      continue;
    }
    const list = makeShoppingList(state, rand);
    let sat = 4.5;
    const cart: { productId: string; qty: number }[] = [];
    for (const it of list) {
      if ((state.shelf[it.productId] ?? 0) <= 0) {
        sat -= 1;
        stockouts[it.productId] = (stockouts[it.productId] ?? 0) + 1;
        stockoutN++;
        continue;
      }
      const a = acceptsPrice(state, it.productId, rand);
      if (!a.ok) {
        rejected++;
        if (a.ratio > 1.2) sat -= 1;
        continue;
      }
      const got = takeFromShelf(state, it.productId, it.qty);
      if (got < it.qty) sat -= 0.3;
      if (got > 0) cart.push({ productId: it.productId, qty: got });
    }
    if (rand() < 0.08) addDirt(state, rand() * 10, rand() * 8);
    if (cart.length === 0) recordLostCustomer(state, Math.min(sat, 2));
    else {
      const speed = Math.max(0, (0.4 + 0.5 * rand()) * (i > 0.8 * capacity ? 0.7 : 1));
      completeSale(state, cart, speed, Math.max(1, sat));
    }
  }
  const report = closeDay(state);
  bot.mem = { stockouts, arrivals: times.length, lostByCapacity, lastNet: report.netProfit };
  return { ...report, arrivals: times.length, stockouts: stockoutN, rejected, lostByCapacity, level: state.level, money: state.money };
}

export function playDays(state: StoreState, days: number, opts: Partial<BotOptions> = {}): DayStats[] {
  const bot = newBot(opts);
  const out: DayStats[] = [];
  for (let d = 0; d < days; d++) out.push(playDay(state, bot));
  return out;
}
