import type { Cents } from './money';
import { PRODUCTS } from './catalog';
import type { FurnitureType } from '../core/layout';

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
  /** Posição no chão (tiles). Indefinida = o mundo escolhe um ponto livre na zona de entrega. */
  x?: number;
  z?: number;
  /** true enquanto o jogador (ou repositor) a carrega. */
  carried?: boolean;
}

export interface Employees {
  cashier: number; // nível 0 = não contratado
  stocker: number;
  janitor: number;
}

export interface Furniture {
  id: number;
  type: FurnitureType;
  x: number; // canto mínimo (x,z) do footprint, em tiles
  z: number;
  rot: 0 | 90 | 180 | 270;
  /** Produto exposto (shelf/fridge/freezer). */
  productId?: string;
  /** Variante visual (decor / cores). */
  variant?: string;
}

export interface Decor {
  wallColor: string;
  floorColor: string;
  signColor: string;
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
  /** 0..4 — ver storeBounds() em core/layout.ts. */
  expansion: number;
  storageUnlocked: boolean;
  furniture: Furniture[];
  nextFurnitureId: number;
  /** Sujeira no chão (x,z em tiles). O faxineiro/jogador remove. */
  dirt: { x: number; z: number }[];
  decor: Decor;
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
    expansion: 0,
    storageUnlocked: false,
    furniture: [],
    nextFurnitureId: 1,
    dirt: [],
    decor: { wallColor: '#f2e8d5', floorColor: '#c9c4b8', signColor: '#d93a3a' },
  };
}
