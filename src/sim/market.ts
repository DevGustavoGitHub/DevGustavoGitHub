import { roundPrice, type Cents } from './money';
import { PRODUCTS, productById } from './catalog';
import { gauss } from './rng';
import type { StoreState } from './state';

export const MARKET_MIN = 0.75;
export const MARKET_MAX = 1.35;

/** Avança o mercado um dia: reversão à média + choque. */
export function advanceMarket(state: StoreState, rand: () => number): void {
  for (const p of PRODUCTS) {
    const prev = state.market[p.id] ?? 1;
    const next = prev + 0.25 * (1 - prev) + gauss(rand) * 0.06;
    state.market[p.id] = Math.min(MARKET_MAX, Math.max(MARKET_MIN, next));
  }
}

/** Preço de atacado de hoje (por unidade). */
export function wholesale(state: StoreState, productId: string): Cents {
  return roundPrice(productById(productId).baseWholesale * (state.market[productId] ?? 1));
}

/**
 * Preço médio de mercado (varejo). Absorve só metade do choque de atacado:
 * dia de atacado caro => margem do jogador aperta; dia barato => margem alarga.
 */
export function marketAverage(state: StoreState, productId: string): Cents {
  const p = productById(productId);
  const m = state.market[productId] ?? 1;
  return roundPrice(p.baseWholesale * p.markup * (0.5 + 0.5 * m));
}

/** Preço de venda atual; default = preço médio de mercado. */
export function sellPrice(state: StoreState, productId: string): Cents {
  return state.prices[productId] ?? marketAverage(state, productId);
}
