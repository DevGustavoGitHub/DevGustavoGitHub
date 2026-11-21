/**
 * Números de balanceamento centralizados (documentados em docs/GDD.md §4).
 * Dinheiro em centavos. Mudou aqui => rode `npx vitest run` (tests/balance.test.ts valida a progressão).
 */
import type { Cents } from './money';

/** Expansão do salão: índice 0 = 1ª expansão (expansion 0→1). Até 6 níveis (layout.MAX_EXPANSION). */
export const EXPANSIONS: { cost: Cents; minLevel: number }[] = [
  { cost: 450000, minLevel: 4 },
  { cost: 1600000, minLevel: 8 },
  { cost: 3500000, minLevel: 13 },
  { cost: 7000000, minLevel: 19 },
  { cost: 14000000, minLevel: 24 },
  { cost: 26000000, minLevel: 29 },
];

/** Aluguel diário extra por nível de expansão. */
export const RENT_PER_EXPANSION: Cents = 5000;

/** Depósito: custo, nível mínimo, capacidade-base (caixas) e capacidade por estante (rack). */
export const STORAGE = { cost: 400000 as Cents, minLevel: 3, baseBoxes: 6, rackBoxes: 8 };

export type EmployeeRole = 'cashier' | 'stocker' | 'janitor';
export const MAX_EMPLOYEE_LEVEL = 5;

/** Tabelas por NÍVEL DESTINO (índice 0 = nível 1). cost = contratar/evoluir até aquele nível. */
export const EMPLOYEE_TABLE: Record<EmployeeRole, { cost: Cents[]; minLevel: number[]; wage: Cents[]; seconds: number[] }> = {
  cashier: {
    cost: [25000, 45000, 80000, 140000, 230000],
    minLevel: [4, 7, 11, 15, 20],
    wage: [12000, 15000, 19000, 24000, 30000],
    seconds: [10, 8, 6.5, 5, 4],
  },
  stocker: {
    cost: [18000, 35000, 65000, 110000, 180000],
    minLevel: [5, 8, 12, 16, 21],
    wage: [10000, 13000, 17000, 22000, 28000],
    seconds: [7, 5.5, 4.5, 3.5, 2.5],
  },
  janitor: {
    cost: [12000, 22000, 40000, 70000, 120000],
    minLevel: [3, 6, 10, 14, 19],
    wage: [8000, 10000, 13000, 17000, 22000],
    seconds: [9, 7, 5.5, 4.5, 3.5],
  },
};

/** Throughput manual do jogador (clientes/dia) e do caixa contratado; +25% por nível do caixa. */
export const CHECKOUT = { manual: 45, cashierBase: 40, cashierLevelBonus: 0.25, extraCounter: 20 };

/** Vendas. */
export const SALE = {
  xpPerCustomer: 2,
  xpSpeedBonus: 0.5, // × unidades × speed
  tipMax: 0.08, // gorjeta máxima = 8% do total (speed=1, satisfação 5)
  repAlpha: 0.04, // peso de cada cliente na média móvel de reputação
};

export const DIRT = { cap: 12, freeSpots: 3, penaltyPerSpot: 0.06, penaltyMax: 0.5 };

export const SELL_REFUND = 0.5;
export const SIDEWALK_MAX_BOXES = 48;

export const DECOR_CHANGE_COST: Cents = 1000; // por campo de cor alterado
export const STORE_NAME_MAX = 24;

/** Empréstimo: limite = base + porNível × nível; juros diários (% do saldo devedor) cobrados em closeDay. */
export const LOAN = { base: 100000 as Cents, perLevel: 120000 as Cents, dailyRate: 0.004 };

/** Falência: caixa abaixo do piso, sem crédito e sem estoque (liquidado a `stockRecovery` do custo) que cubra o rombo. */
export const BANKRUPTCY = { floor: 0 as Cents, stockRecovery: 0.5, restartMoney: 300000 as Cents };

/** Melhorias permanentes. Dolly: carrega até 3 caixas (1 sem ela). */
export const UPGRADES = {
  dolly: { name: 'Carrinho de carga', description: 'Carregue até 3 caixas de uma vez em vez de 1.', cost: 600000 as Cents, minLevel: 6, carry: 3 },
};
export const BASE_CARRY = 1;

/** Dias guardados em history/stats (persistidos no save). */
export const HISTORY_DAYS = 30;

/** Decoração: variantes visuais (id = Furniture.variant) e preço. O world desenha as que reconhece (fallback: planta). */
export const DECOR_ITEMS: { id: string; name: string; cost: Cents; minLevel: number }[] = [
  { id: 'plant', name: 'Planta', cost: 8000, minLevel: 1 },
  { id: 'banner', name: 'Faixa promocional', cost: 8000, minLevel: 1 },
  { id: 'lamp', name: 'Luminária de pé', cost: 12000, minLevel: 4 },
  { id: 'tree', name: 'Árvore ornamental', cost: 20000, minLevel: 8 },
  { id: 'rug', name: 'Tapete', cost: 15000, minLevel: 6 },
  { id: 'poster', name: 'Cartaz de ofertas', cost: 10000, minLevel: 5 },
  { id: 'fountain', name: 'Fonte decorativa', cost: 60000, minLevel: 18 },
  { id: 'statue', name: 'Estátua do fundador', cost: 120000, minLevel: 26 },
];
