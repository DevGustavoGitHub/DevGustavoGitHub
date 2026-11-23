import type { Cents } from './money';
import { PRODUCTS } from './catalog';
import type { FurnitureType } from '../core/layout';
import type { DayReport } from './economy';
import type { StockedFurniture } from './api';
import { rentFor } from './rent';
import { INITIAL_SHELVES, START_MONEY } from './tuning';

export const OPEN_MIN = 8 * 60;
export const CLOSE_MIN = 21 * 60;

export interface Ledger {
  revenue: Cents;
  tips: Cents;
  cogs: Cents;
  purchases: Cents;
  served: number;
  lost: number; // clientes que saíram sem comprar nada ou desistiram de itens
  /** Fase 3: vendas com satisfação >= 3 (SALE.happyMin). */
  happy: number;
  /** Fase 3: vendas com satisfação < 3 + clientes perdidos/desistentes (happy + angry = served + lost). */
  angry: number;
}

export interface Box {
  productId: string;
  units: number;
  /** Posição no chão (tiles). Indefinida = o mundo escolhe um ponto livre na zona de entrega. */
  x?: number;
  z?: number;
  /** true enquanto o jogador (ou repositor) a carrega. */
  carried?: boolean;
  /** FASE 3: rotação no chão (radianos), definida ao largar/posicionar a caixa. */
  rot?: number;
  /** FASE 3 (adendo): abas abertas. A caixa chega FECHADA (false); ausente (saves antigos) = fechada. api.setBoxOpen. */
  open?: boolean;
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

/** Regra de pedido automático por produto (ver api.setAutoOrder). */
export interface AutoOrderRule { minUnits: number; boxes: number }

/** Vendas de um dia por produto: `[unidades, receita, lucro]` (só produtos vendidos; mantém o save pequeno). */
export interface DayStatsEntry { day: number; p: Record<string, [number, number, number]> }

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
  /** Aluguel que será cobrado no fechamento de HOJE (rent.ts: 0 no começo, rampa a partir do nível 3 ou do dia 4). */
  rent: Cents;
  ledger: Ledger;
  storeName: string;
  /** 0..MAX_EXPANSION (6) — ver storeBounds() em core/layout.ts. */
  expansion: number;
  storageUnlocked: boolean;
  furniture: Furniture[];
  nextFurnitureId: number;
  /** Sujeira no chão (x,z em tiles). O faxineiro/jogador remove. */
  dirt: { x: number; z: number }[];
  decor: Decor;
  /** Maior nível já "consumido" pela UI (ver consumeLevelUps em api.ts). */
  levelAck: number;
  /** Fase 2: saldo devedor do empréstimo (centavos). */
  loan: Cents;
  /** Fase 2: pedidos automáticos por produto. */
  autoOrders: Record<string, AutoOrderRule>;
  /** Fase 2: melhorias compradas (ver api.UpgradeId). */
  upgrades: string[];
  /** Fase 2: últimos 30 relatórios de dia (closeDay acrescenta). */
  history: DayReport[];
  /** Fase 2: vendas por produto dos últimos 30 dias (base de api.topProducts). */
  stats: DayStatsEntry[];
  /** Fase 2: quantas vezes o jogador recomeçou após falência. */
  bankruptcies: number;
  /** Fase 3: móveis comprados no carrinho e ainda não montados (api.checkoutCart → api.placeFromStock). */
  furnitureStock: StockedFurniture[];
}

/**
 * Layout inicial (Fase 3, como no original): o balcão e 2 prateleiras de mercearia barata já atribuídas (feijão e
 * macarrão) no fundo do salão 12x10. Sobra lugar para mais 2 prateleiras na mesma fileira (x = 7 e 10, z = 2).
 */
export function initialFurniture(): Furniture[] {
  return [
    { id: 1, type: 'counter', x: 8, z: 6, rot: 0 },
    ...INITIAL_SHELVES.map((productId, i): Furniture => ({ id: 2 + i, type: 'shelf', x: 1 + 3 * i, z: 2, rot: 0, productId })),
  ];
}
/** Próximo id livre depois do layout inicial. */
export const INITIAL_NEXT_FURNITURE_ID = 2 + INITIAL_SHELVES.length;

export const emptyLedger = (): Ledger => ({ revenue: 0, tips: 0, cogs: 0, purchases: 0, served: 0, lost: 0, happy: 0, angry: 0 });

/** Paleta padrão de jogo novo (parecida com o original): paredes azul-claro, piso de madeira quente, letreiro vermelho. */
export const DEFAULT_DECOR: Readonly<Decor> = { wallColor: '#bfe1f2', floorColor: '#c48a55', signColor: '#d8342c' };

export function newGame(seed = 1): StoreState {
  const market: Record<string, number> = {};
  const slots: Record<string, number> = {};
  for (const p of PRODUCTS) {
    market[p.id] = 1;
    slots[p.id] = 0;
  }
  // Loja inicial: 2 prateleiras (2 slots cada) para os produtos de INITIAL_SHELVES (ver initialFurniture).
  for (const id of INITIAL_SHELVES) slots[id] = 2;
  const s: StoreState = {
    version: 1,
    seed,
    day: 1,
    money: START_MONEY, // R$ 150,00
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
    rent: 0, // recalculado abaixo (rent.ts): grátis no começo, rampa a partir do nível 3 ou do dia 4
    ledger: emptyLedger(),
    storeName: 'Meu Mercadinho',
    expansion: 0,
    storageUnlocked: false,
    furniture: initialFurniture(),
    nextFurnitureId: INITIAL_NEXT_FURNITURE_ID,
    dirt: [],
    decor: { ...DEFAULT_DECOR },
    levelAck: 1,
    loan: 0,
    autoOrders: {},
    upgrades: [],
    history: [],
    stats: [],
    bankruptcies: 0,
    furnitureStock: [],
  };
  s.rent = rentFor(s);
  return s;
}
