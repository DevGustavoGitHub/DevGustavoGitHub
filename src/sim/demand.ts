import { PRODUCTS } from './catalog';
import { marketAverage, sellPrice } from './market';
import type { StoreState } from './state';

/**
 * Probabilidade de um cliente aceitar comprar um item dado r = preço/média.
 * Logística centrada em r=1.2: r=0.8 → ~0.96, r=1.0 → ~0.83, r=1.2 → 0.50, r=1.5 → ~0.08.
 * Parâmetros (8, 1.2) são pontos de balanceamento, ver GDD §4.
 */
export function buyProbability(ratio: number): number {
  return 1 / (1 + Math.exp(8 * (ratio - 1.2)))
}

/** Razão média preço/mercado ponderada por popularidade, sobre produtos licenciados. */
export function averagePriceRatio(state: StoreState): number {
  let num = 0;
  let den = 0;
  for (const p of PRODUCTS) {
    if (!state.licenses.includes(p.category)) continue;
    num += (sellPrice(state, p.id) / marketAverage(state, p.id)) * p.popularity;
    den += p.popularity;
  }
  return den === 0 ? 1 : num / den;
}

/**
 * Fluxo diário de clientes: cresce com nível (até 30), reputação, tamanho da loja e preço baixo.
 * base = 16 + 4·nível; preço: ±1,2 por unidade de desvio de razão (0,5..1,5); reputação 0,6+0,1·rep; +12% por expansão.
 */
export function customersForDay(state: StoreState, rand: () => number): number {
  const base = 16 + 4 * Math.min(30, state.level);
  const priceMult = Math.min(1.5, Math.max(0.5, 1 + (1 - averagePriceRatio(state)) * 1.2));
  const repMult = 0.6 + 0.1 * state.reputation;
  const sizeMult = 1 + 0.12 * state.expansion;
  return Math.max(0, Math.round(base * priceMult * repMult * sizeMult * (0.9 + 0.2 * rand())));
}

/** Escolhe um produto licenciado ponderando por popularidade. */
export function pickProduct(state: StoreState, rand: () => number): string | null {
  const pool = PRODUCTS.filter((p) => state.licenses.includes(p.category));
  const total = pool.reduce((a, p) => a + p.popularity, 0);
  if (total === 0) return null;
  let r = rand() * total;
  for (const p of pool) {
    r -= p.popularity;
    if (r <= 0) return p.id;
  }
  return pool[pool.length - 1]?.id ?? null;
}
