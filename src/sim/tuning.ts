/**
 * Números de balanceamento centralizados (documentados em docs/GDD.md §4).
 * Dinheiro em centavos. Mudou aqui => rode `npx vitest run` (tests/balance.test.ts valida a progressão).
 *
 * Fase 3: início pobre como no jogo de referência (R$ 150, balcão + 2 prateleiras), aluguel só a partir do nível 3
 * ou do dia 4 (em rampa) e liberações por nível alinhadas ao original (caixa 4, limpador 6, repositor 8, depósito 5,
 * expansões 3/5/6/7/…, 2ª licença no nível 2).
 */
import type { Cents } from './money';

/** Dinheiro inicial (dá para 1–2 caixas dos produtos mais baratos). */
export const START_MONEY: Cents = 15000;
/** Produtos das 2 prateleiras iniciais (os 2 mais baratos por caixa da mercearia). */
export const INITIAL_SHELVES: readonly string[] = ['feijao', 'macarrao'];

/**
 * Aluguel diário = base + porExpansão × expansão, cobrado em closeDay. Começa no nível `startLevel` OU no dia `startDay`
 * (o que vier primeiro) e sobe em `rampSteps` passos (1/3, 2/3, integral). Ver rent.ts.
 */
export const RENT = { base: 8000 as Cents, perExpansion: 4000 as Cents, startLevel: 3, startDay: 4, rampSteps: 3 };

/** Expansão do salão: índice 0 = 1ª expansão (expansion 0→1). Até 6 níveis (layout.MAX_EXPANSION). */
export const EXPANSIONS: { cost: Cents; minLevel: number }[] = [
  { cost: 150000, minLevel: 3 },
  { cost: 450000, minLevel: 5 },
  { cost: 1100000, minLevel: 6 },
  { cost: 2600000, minLevel: 7 },
  { cost: 7500000, minLevel: 15 },
  { cost: 18000000, minLevel: 24 },
];

/** Depósito: custo, nível mínimo, capacidade-base (caixas) e capacidade por estante (rack). */
export const STORAGE = { cost: 250000 as Cents, minLevel: 5, baseBoxes: 6, rackBoxes: 8 };

export type EmployeeRole = 'cashier' | 'stocker' | 'janitor';
export const MAX_EMPLOYEE_LEVEL = 5;

/** Tabelas por NÍVEL DESTINO (índice 0 = nível 1). cost = contratar/evoluir até aquele nível. */
export const EMPLOYEE_TABLE: Record<EmployeeRole, { cost: Cents[]; minLevel: number[]; wage: Cents[]; seconds: number[] }> = {
  cashier: {
    cost: [25000, 45000, 80000, 140000, 230000],
    minLevel: [4, 8, 12, 16, 20],
    wage: [10000, 13000, 17000, 22000, 28000],
    seconds: [10, 8, 6.5, 5, 4],
  },
  stocker: {
    cost: [30000, 50000, 85000, 140000, 220000],
    minLevel: [8, 11, 14, 18, 22],
    wage: [11000, 14000, 18000, 23000, 29000],
    seconds: [7, 5.5, 4.5, 3.5, 2.5],
  },
  janitor: {
    cost: [20000, 35000, 60000, 100000, 160000],
    minLevel: [6, 9, 13, 17, 21],
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
  tipMax: 0.08, // gorjeta máxima = 8% do total (speed=1, satisfação 5); × TIPJAR.mult com o pote de gorjeta
  repAlpha: 0.04, // peso de cada cliente na média móvel de reputação
  /** Venda com satisfação >= happyMin conta como cliente feliz; abaixo disso (e perdidos/desistentes), irritado. */
  happyMin: 3,
};

/** Clientes simultâneos na loja (api.customerCapacity): base + por expansão + melhoria 'capacity'. */
export const CUSTOMER_CAPACITY = { base: 6, perExpansion: 2 };

export const DIRT = { cap: 12, freeSpots: 3, penaltyPerSpot: 0.06, penaltyMax: 0.5 };

export const SELL_REFUND = 0.5;
export const SIDEWALK_MAX_BOXES = 48;

/**
 * Largar caixa (api.dropBox, metros): folga das paredes para o centro da caixa e quanto a calçada se estende para os
 * lados da fachada (a navegação do world vai 14 m para cada lado).
 */
export const DROP = { wallMargin: 0.15, sidewalkSide: 14 };

export const DECOR_CHANGE_COST: Cents = 1000; // por campo de cor alterado
export const STORE_NAME_MAX = 24;

/** Empréstimo: limite = base + porNível × nível; juros diários (% do saldo devedor) cobrados em closeDay. */
export const LOAN = { base: 20000 as Cents, perLevel: 40000 as Cents, dailyRate: 0.004 };

/** Falência: caixa abaixo do piso, sem crédito e sem estoque (liquidado a `stockRecovery` do custo) que cubra o rombo. */
export const BANKRUPTCY = { floor: 0 as Cents, stockRecovery: 0.5, restartMoney: 30000 as Cents };

/**
 * Melhorias permanentes (compra única). Dolly: carrega até 3 caixas (1 sem ela). Pote de gorjeta: gorjetas × mult.
 * Capacidade: +`extra` clientes simultâneos (api.customerCapacity).
 */
export const UPGRADES = {
  tipjar: { name: 'Pote de gorjeta', description: 'Clientes satisfeitos deixam gorjetas 50% maiores.', cost: 30000 as Cents, minLevel: 2, mult: 1.5 },
  capacity: { name: 'Capacidade de clientes', description: 'Mais 4 clientes podem estar na loja ao mesmo tempo.', cost: 150000 as Cents, minLevel: 4, extra: 4 },
  dolly: { name: 'Carrinho de carga', description: 'Carregue até 3 caixas de uma vez em vez de 1.', cost: 500000 as Cents, minLevel: 6, carry: 3 },
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
  { id: 'statue', name: 'Estátua do fundador', cost: 120000, minLevel: 27 },
];
