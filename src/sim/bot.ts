/**
 * Bot de balanceamento: joga dias inteiros só pela API pública (mesmas chamadas do jogo interativo).
 * Repõe várias vezes ao dia, precifica por mercado × multiplicador e investe (licenças, móveis, caixa, expansão).
 * Fase 3: começa pobre (START_MONEY, 2 prateleiras), compra caixas em rodízio entre os produtos, guarda uma reserva para
 * repor o estoque e pagar as despesas do dia, e compra móveis pelo carrinho (checkoutCart → placeFromStock).
 * Usado por tests/balance.test.ts e para calibrar docs/GDD.md §4.
 */
import {
  acceptsPrice, addDirt, assignProduct, arrivalSchedule, buyExpansion, buyUpgrade, canPlace, checkoutCart, cleanDirt, closeDay,
  completeSale, discardBox, employeeCost, expansionCost, expansionMinLevel, furnitureCatalog, furnitureForProduct, furnitureStock,
  hireOrUpgrade, loanInfo, makeShoppingList, orderBoxes, placeFromStock, placeUnits, priceInfo, productCapacity, recordLostCustomer,
  storageCapacity, storageCost, storageUsed, storeBox, takeFromShelf, takeFromStorage, unlockStorage, upgradeCatalog, wagesPerDay,
  type UpgradeId,
} from './api';
import { LICENSES, PRODUCTS } from './catalog';
import { buyLicense, checkoutCapacity, type DayReport } from './economy';
import { STORAGE_DEPTH, storeBounds } from '../core/layout';
import { marketAverage } from './market';
import { roundPrice } from './money';
import { makeRng } from './rng';
import { INITIAL_NEXT_FURNITURE_ID, type StoreState } from './state';
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

/**
 * Fase 4: o preço sugerido virou a média de mercado e a curva de aceitação ficou mais tolerante; o bot (jogador
 * razoável) cobra +10%, o ponto de maior lucro da curva nova (o sugerido ×1,0 rende ~85% disso). Ver GDD §4.5.
 */
export const defaultBotOptions: BotOptions = { priceMult: 1.1, restocks: 4, invest: true };

const BY_POPULARITY = [...PRODUCTS].sort((a, b) => b.popularity - a.popularity);

export function findSpot(state: StoreState, type: FurnitureType): { x: number; z: number } | null {
  const b = storeBounds(state.expansion);
  for (let z = 0; z < b.depth; z++) for (let x = 0; x < b.width; x++) if (canPlace(state, type, x, z, 0)) return { x, z };
  return null;
}

function findStorageSpot(state: StoreState): { x: number; z: number } | null {
  const b = storeBounds(state.expansion);
  for (let z = -STORAGE_DEPTH; z < 0; z++) for (let x = 0; x < b.width; x++) if (canPlace(state, 'rack', x, z, 0)) return { x, z };
  return null;
}

export function setMarketPrices(state: StoreState, mult: number): void {
  for (const p of PRODUCTS) if (state.licenses.includes(p.category)) state.prices[p.id] = roundPrice(marketAverage(state, p.id) * mult);
}

/**
 * O jogo novo começa SEM produto nas prateleiras iniciais; o bot (que simula um jogador) etiqueta as sem produto com os
 * dois itens mais baratos da mercearia (feijão, macarrão), como o layout antigo fazia.
 */
export function labelStarterShelves(state: StoreState): void {
  for (const f of state.furniture) {
    if (f.type !== 'shelf' || f.id >= INITIAL_NEXT_FURNITURE_ID) continue;
    if ((f.levels ?? []).some((l) => l.productId !== undefined || l.units > 0)) continue;
    const used = (id: string): boolean => state.furniture.some((g) => (g.levels ?? []).some((l) => l.productId === id));
    const pid = ['feijao', 'macarrao'].find((id) => !used(id));
    if (pid) assignProduct(state, f.id, pid);
  }
}

const unitsOnFloor = (state: StoreState, productId: string): number =>
  state.sidewalk.reduce((a, b) => (b.productId === productId && !b.carried ? a + b.units : a), 0);

/**
 * Repõe as prateleiras: primeiro o depósito (estoque comprado barato), depois compra caixas no atacado do dia em
 * rodízio (1 caixa por produto por rodada, mais populares primeiro) — com pouco dinheiro todos recebem algo.
 * Caixas vazias vão para a lixeira; sobras vão ao depósito (se houver espaço) ou ficam na calçada.
 */
export function restock(state: StoreState): void {
  labelStarterShelves(state);
  const items = BY_POPULARITY.filter((p) => state.licenses.includes(p.category) && productCapacity(state, p.id) > 0);
  const need = (id: string): number => productCapacity(state, id) - (state.shelf[id] ?? 0) - unitsOnFloor(state, id);
  for (const p of items) while (need(p.id) > 0 && (state.storage[p.id] ?? 0) > 0) takeFromStorage(state, p.id, false);
  for (let round = 0, bought = true; bought && round < 64; round++) {
    bought = false;
    for (const p of items) {
      if (need(p.id) <= 0) continue;
      try {
        orderBoxes(state, p.id, 1);
        bought = true;
      } catch {
        /* sem dinheiro ou calçada cheia: tenta o próximo */
      }
    }
  }
  for (const p of items) {
    for (let i = 0; i < state.sidewalk.length; i++) {
      const b = state.sidewalk[i]!;
      if (b.productId === p.id && b.units > 0 && !b.carried) placeUnits(state, i, 999);
    }
    // caixas vazias -> lixeira; caixas com sobra -> depósito (se der) ou ficam na calçada
    for (let i = state.sidewalk.length - 1; i >= 0; i--) {
      const b = state.sidewalk[i]!;
      if (b.productId !== p.id || b.carried) continue;
      if (b.units === 0) discardBox(state, i);
      else if (state.storageUnlocked) {
        try { storeBox(state, i); } catch { /* depósito cheio */ }
      }
    }
    // atacado barato (mercado < 0,9): abastece o depósito com até 2 caixas para os dias caros
    if (state.storageUnlocked && (state.market[p.id] ?? 1) < 0.9 && state.money > 2 * reserve(state)) {
      for (let k = 0; k < 2; k++) {
        try { orderBoxes(state, p.id, 1); storeBox(state, state.sidewalk.length - 1); } catch { break; }
      }
    }
  }
}

/** Dinheiro que o bot não gasta em investimentos: despesas fixas do dia + ~1/3 do custo de encher as prateleiras. */
export function reserve(state: StoreState): number {
  let fill = 0;
  for (const p of PRODUCTS) {
    const cap = productCapacity(state, p.id);
    if (cap > 0) fill += cap * priceInfo(state, p.id).wholesale;
  }
  return state.rent + wagesPerDay(state) + loanInfo(state).dailyInterest + Math.round(fill * 0.35) + 2000;
}

/** Compra um móvel pelo carrinho e monta do estoque (como o jogador na Fase 3). */
function buyAndPlace(state: StoreState, type: FurnitureType, productId?: string): boolean {
  const spot = type === 'rack' ? findStorageSpot(state) : findSpot(state, type);
  if (!spot) return false;
  checkoutCart(state, [{ kind: 'furniture', id: type, qty: 1 }]);
  placeFromStock(state, furnitureStock(state).length - 1, spot.x, spot.z, 0, productId);
  return true;
}

export interface BotMemory { stockouts: Record<string, number>; arrivals: number; lostByCapacity: number; lastNet: number }

/** Investimentos da manhã (uma decisão por categoria por dia, simples e conservadora). */
export function investMorning(state: StoreState, mem: BotMemory): void {
  const can = (cost: number): boolean => state.money - cost >= reserve(state);
  const spec = (type: FurnitureType) => furnitureCatalog().find((c) => c.type === type)!;
  const buyFor = (productId: string): boolean => {
    const type = furnitureForProduct(productId);
    const s = spec(type);
    if (state.level < s.minLevel || !can(s.cost)) return false;
    return buyAndPlace(state, type, productId);
  };
  const upgrade = (id: UpgradeId): void => {
    const u = upgradeCatalog(state).find((x) => x.id === id)!;
    if (!u.owned && state.level >= u.minLevel && can(u.cost)) buyUpgrade(state, id);
  };

  // 1. todo produto licenciado precisa de pelo menos 1 móvel (no começo: arroz e café ainda sem prateleira)
  for (const p of BY_POPULARITY) if (state.licenses.includes(p.category) && productCapacity(state, p.id) === 0) buyFor(p.id);
  // 2. pote de gorjeta: barato e permanente
  upgrade('tipjar');
  // 3. licenças (mais baratas primeiro), só quando também cabe o móvel do produto mais popular da categoria
  for (const l of LICENSES) {
    if (state.licenses.includes(l.id) || state.level < l.minLevel) continue;
    const first = BY_POPULARITY.find((p) => p.category === l.id);
    const fcost = first ? spec(furnitureForProduct(first.id)).cost : 0;
    if (!can(l.cost + fcost)) continue;
    buyLicense(state, l.id);
    for (const p of BY_POPULARITY) if (p.category === l.id && productCapacity(state, p.id) === 0) buyFor(p.id);
  }
  // 4. expansão liberada; se faltar pouco (≤ 6 dias de lucro), poupa para ela (adia os itens opcionais abaixo)
  const ec = expansionCost(state);
  const em = expansionMinLevel(state);
  if (ec !== null && em !== null && state.level >= em && can(ec)) buyExpansion(state);
  const ec2 = expansionCost(state);
  const em2 = expansionMinLevel(state);
  const saving = ec2 !== null && state.level >= (em2 ?? 99) && ec2 + reserve(state) - state.money <= 6 * Math.max(0, mem.lastNet);
  // 5. caixa contratado quando o checkout é o gargalo
  const cc = employeeCost(state, 'cashier');
  if (cc && state.level >= cc.minLevel && (mem.lostByCapacity > 0 || mem.arrivals > 0.85 * checkoutCapacity(state)) && can(cc.cost + cc.dailyWage * 10)) {
    hireOrUpgrade(state, 'cashier');
  }
  // 6. mais capacidade onde houve ruptura (no máx. 1 por dia)
  const worst = Object.entries(mem.stockouts).sort((a, b) => b[1] - a[1])[0];
  if (!saving && worst && worst[1] >= 4) buyFor(worst[0]);
  // 7. caixa registradora extra quando o checkout transborda
  if (mem.lostByCapacity > 3) {
    const c = spec('counter');
    if (state.level >= c.minLevel && can(c.cost)) buyAndPlace(state, 'counter');
  }
  // 8. infraestrutura (depósito, estantes, carrinho de carga, repositor, capacidade de clientes)
  if (!saving) investInfra(state, can);
}

function investInfra(state: StoreState, can: (cost: number) => boolean): void {
  const sc = storageCost();
  // o depósito só entra depois da 1ª expansão e de laticínios (não atrasa a progressão inicial)
  const early = state.expansion < 1 || !state.licenses.includes('laticinios');
  if (!state.storageUnlocked && !early && state.level >= sc.minLevel && can(sc.cost)) unlockStorage(state);
  if (state.storageUnlocked && storageUsed(state) >= storageCapacity(state) - 2) {
    const rack = furnitureCatalog().find((c) => c.type === 'rack')!;
    if (state.level >= rack.minLevel && can(rack.cost)) buyAndPlace(state, 'rack');
  }
  for (const id of ['dolly'] as const) {
    const u = upgradeCatalog(state).find((x) => x.id === id)!;
    if (!u.owned && state.level >= u.minLevel && can(u.cost)) buyUpgrade(state, id);
  }
  const st = employeeCost(state, 'stocker');
  if (st && state.employees.stocker === 0 && state.level >= st.minLevel && can(st.cost + st.dailyWage * 20)) hireOrUpgrade(state, 'stocker');
}

export interface Bot {
  opts: BotOptions;
  mem: BotMemory;
}
export const newBot = (opts: Partial<BotOptions> = {}): Bot => ({
  opts: { ...defaultBotOptions, ...opts },
  mem: { stockouts: {}, arrivals: 0, lostByCapacity: 0, lastNet: 0 },
});

/** Joga um dia completo (investe, precifica, repõe, atende todos os clientes previstos, fecha o dia). */
export function playDay(state: StoreState, bot: Bot): DayStats {
  const { opts } = bot;
  labelStarterShelves(state);
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
