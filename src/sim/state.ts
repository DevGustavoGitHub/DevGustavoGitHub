import type { Cents } from './money';
import { PRODUCTS } from './catalog';

export const OPEN_MIN = 8 * 60;
export const CLOSE_MIN = 21 * 60;

export interface Ledger {
  revenue: Cents;
  tips: Cents;
  cogs: Cents;
  purchases: Cents;
  served: number;
  lost: number; // clientes que saíram sem comprar nada ou desistiram de itens
}

export interface Box {
  productId: string;
  units: number;
}

export interface Employees {
  cashier: number; // nível 0 = não contratado
  stocker: number;
  janitor: number;
}

export interface StoreState {
  version: 1;
  seed: number;
  day: number;
  money: Cents;
  level: number;
  xp: number;
  /** 1..5, média móvel da satisfação dos clientes. */
  reputation: number;
  licenses: string[];
  /** Multiplicador diário de atacado por produto (random walk com reversão à média). */
  market: Record<string, number>;
  prices: Record<string, Cents>;
  slots: Record<string, number>;
  shelf: Record<string, number>;
  storage: Record<string, number>;
  sidewalk: Box[];
  /** Custo médio ponderado das unidades em posse (para COGS). */
  costBasis: Record<string, { units: number; avg: Cents }>;
  employees: Employees;
  rent: Cents;
  ledger: Ledger;
  storeName: string;
}

export const emptyLedger = (): Ledger => ({ revenue: 0, tips: 0, cogs: 0, purchases: 0, served: 0, lost: 0 });

export function newGame(seed = 1): StoreState {
  const market: Record<string, number> = {};
  const slots: Record<string, number> = {};
  for (const p of PRODUCTS) {
    market[p.id] = 1;
    slots[p.id] = 0;
  }
  // Loja inicial: 2 slots para os 4 produtos de mercearia.
  for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) slots[id] = 2;
  return {
    version: 1,
    seed,
    day: 1,
    money: 500000, // R$ 5.000,00
    level: 1,
    xp: 0,
    reputation: 3.5,
    licenses: ['mercearia'],
    market,
    prices: {},
    slots,
    shelf: {},
    storage: {},
    sidewalk: [],
    costBasis: {},
    employees: { cashier: 0, stocker: 0, janitor: 0 },
    rent: 20000, // R$ 200/dia (luz incluída) — ver GDD
    ledger: emptyLedger(),
    storeName: 'Meu Mercadinho',
  };
}
