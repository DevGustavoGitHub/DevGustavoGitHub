import { sizeTier } from '../core/layout';
import { PRODUCTS } from './catalog';
import { marketAverage, sellPrice } from './market';
import type { StoreState } from './state';

/** Curva de aceitação (Fase 4, mais tolerante perto do mercado): logística centrada em `mid`, mais íngreme acima dele. */
export const DEMAND_CURVE = { mid: 1.3, kBelow: 10, kAbove: 13 };

/**
 * Probabilidade de um cliente aceitar comprar um item dado r = preço/média de mercado.
 * P = 1 / (1 + e^(k·(r − 1,30))), k = 10 abaixo de 1,30 e 13 acima: r=0,8 → 99%, r=1,0 → 95%, r=1,1 → 88%,
 * r=1,2 → 73%, r=1,3 → 50%, r=1,4 → 21%, r=1,5 → 7%, r=1,6 → 2%. Pontos de balanceamento: ver GDD §4.
 */
export function buyProbability(ratio: number): number {
  const d = ratio - DEMAND_CURVE.mid;
  return 1 / (1 + Math.exp((d < 0 ? DEMAND_CURVE.kBelow : DEMAND_CURVE.kAbove) * d));
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

export const EARLY_BASE = [13, 17, 20];

/**
 * Fluxo diário de clientes: cresce com nível (até 30), reputação, tamanho da loja e preço baixo.
 * Início suave (pós-teste 2): base 13/17/20 nos níveis 1/2/3 (a mão dá conta de ~23/dia); do nível 4 (caixa) em diante base = 22 + 4·nível; preço: ±0,4 por unidade de desvio de razão (0,5..1,5); reputação 0,6+0,1·rep; +12% por expansão.
 */
export function customersForDay(state: StoreState, rand: () => number): number {
  const lv = Math.min(30, state.level);
  const base = lv < 4 ? EARLY_BASE[Math.max(1, lv) - 1]! : 22 + 4 * lv;
  const priceMult = Math.min(1.5, Math.max(0.5, 1 + (1 - averagePriceRatio(state)) * 0.4));
  const repMult = 0.6 + 0.1 * state.reputation;
  const sizeMult = 1 + 0.12 * sizeTier(state.expansion); // 1ª expansão (10×8 → 12×10) só dá espaço
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
