/**
 * Números de balanceamento centralizados (documentados em docs/GDD.md §4).
 * Dinheiro em centavos. Mudou aqui => rode `npx vitest run` (tests/balance.test.ts valida a progressão).
 *
 * Fase 3: início pobre como no jogo de referência (balcão + 2 prateleiras), aluguel só mais tarde (em rampa) e
 * liberações por nível alinhadas ao original (caixa 4, limpador 6, repositor 8, depósito 5, expansões 3/5/6/7/…,
 * 2ª licença no nível 2).
 * QA de economia (docs/qa/economy.md, bot de ritmo humano em humanBot.ts): R$ 150 → R$ 250, aluguel a partir do nível 4
 * ou do dia 6 (era 3/4) e limite do empréstimo sem a base de R$ 200 — o iniciante fechava o dia 1 com ~43% de clientes
 * irritados e sem caixa para abastecer o dia 2; o jogador eficiente quase não muda (é limitado pelo caixa, não pelo dinheiro).
 */
import type { Cents } from './money';

/** Dinheiro inicial: dá para 3 caixas dos produtos mais baratos (4 não cabem), ~70% da procura do dia 1. */
export const START_MONEY: Cents = 25000;
/** Produtos das 2 prateleiras iniciais (os 2 mais baratos por caixa da mercearia). */
/** Prateleiras iniciais (sem produto: os níveis começam sem etiqueta). */
export const INITIAL_SHELVES: readonly string[] = ['', ''];

/**
 * Aluguel diário = base + porExpansão × expansão, cobrado em closeDay. Começa no nível `startLevel` OU no dia `startDay`
 * (o que vier primeiro) e sobe em `rampSteps` passos (1/3, 2/3, integral). Ver rent.ts.
 * QA economia: nível 4 / dia 6 (era 3 / 4) — o iniciante (≈ 23 clientes/dia no caixa) chega ao nível 3 no dia 3 e
 * pagava aluguel com lucro de ~R$ 100–150/dia; o eficiente chega ao nível 4 no dia 4 e quase não sente a diferença.
 */
export const RENT = { base: 8000 as Cents, perExpansion: 4000 as Cents, startLevel: 4, startDay: 6, rampSteps: 3 };

/** Expansão do salão: índice 0 = 1ª expansão (expansion 0→1). Até 7 níveis (layout.MAX_EXPANSION). */
/**
 * Pós-teste 3 (nível 6 no dia 10 sem conseguir comprar expansão, depósito, laticínios, capacidade nem carrinho): preços do
 * meio do jogo ~½ a ⅓ dos anteriores (1ª expansão R$ 1.500 → 800, 2ª 4.500 → 2.000, 3ª 11.000 → 4.500) — com lucro de
 * ~R$ 300–550/dia nos níveis 4–6 (bot cuidadoso), cada compra custa ~2–5 dias de economia em vez de 5–15.
 */
export const EXPANSIONS: { cost: Cents; minLevel: number }[] = [
  { cost: 50000, minLevel: 2 }, // pós-teste 3: 10×8 → 12×10 (o salão começa menor)
  { cost: 80000, minLevel: 3 },
  { cost: 200000, minLevel: 5 },
  { cost: 450000, minLevel: 6 },
  { cost: 1000000, minLevel: 7 },
  { cost: 5500000, minLevel: 15 },
  { cost: 14000000, minLevel: 28 },
];

/** Depósito: custo, nível mínimo, capacidade-base (caixas) e capacidade por estante (rack). */
export const STORAGE = { cost: 120000 as Cents, minLevel: 5, baseBoxes: 6, rackBoxes: 8 }; // pós-teste 3: R$ 2.500 → 1.200

export type EmployeeRole = 'cashier' | 'stocker' | 'janitor';
export const MAX_EMPLOYEE_LEVEL = 5;

/** Tabelas por NÍVEL DESTINO (índice 0 = nível 1). cost = contratar/evoluir até aquele nível. */
export const EMPLOYEE_TABLE: Record<EmployeeRole, { cost: Cents[]; minLevel: number[]; wage: Cents[]; seconds: number[] }> = {
  cashier: {
    cost: [25000, 45000, 80000, 140000, 230000],
    minLevel: [4, 8, 12, 16, 20],
    wage: [8000, 11000, 15000, 20000, 26000], // pós-teste 3: −R$ 20/dia (era 100/130/170/220/280)
    seconds: [10, 8, 6.5, 5, 4],
  },
  stocker: {
    cost: [30000, 50000, 85000, 140000, 220000],
    minLevel: [8, 11, 14, 18, 22],
    wage: [9000, 12000, 16000, 21000, 27000], // pós-teste 3: −R$ 20/dia
    seconds: [7, 5.5, 4.5, 3.5, 2.5],
  },
  janitor: {
    cost: [20000, 35000, 60000, 100000, 160000],
    minLevel: [6, 9, 13, 17, 21],
    wage: [5000, 7000, 10000, 14000, 19000], // pós-teste 3: faxineiro −R$ 30/dia (era 80/100/130/170/220)
    seconds: [9, 7, 5.5, 4.5, 3.5],
  },
};

/** Caixas adicionais (2º..4º): nível mínimo do jogador e custo = custo de contratar o 1º nível do caixa × mult. */
export const EXTRA_CASHIER = { max: 4, minLevel: [9, 14, 19], costMult: [2, 3, 4] };
/** Pós-teste 3: 2º repositor e 2º faxineiro (mesmo nível/salário do 1º), liberados por nível do jogador. */
export const EXTRA_STAFF = { stocker: { minLevel: 12, costMult: 2 }, janitor: { minLevel: 10, costMult: 2 } } as const;

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
/** Pós-teste 3: sem compra — +1 cliente simultâneo a cada 2 níveis (até +10), além das expansões. */
export const CUSTOMER_CAPACITY = { base: 6, perExpansion: 2, perTwoLevels: 1, levelMax: 10 };
/** Saves que tinham a antiga melhoria 'capacity' recebem o valor de volta (ela virou automática). */
export const CAPACITY_REFUND = 60000;

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

/**
 * Empréstimo: limite = base + porNível × nível; juros diários (% do saldo devedor) cobrados em closeDay.
 * QA economia: base 0 (era R$ 200) — no nível 1 o banco dava R$ 600 a 0,4%/dia (4× o dinheiro inicial, quase de graça) e
 * anulava o início pobre; R$ 400 ainda tira o jogador de qualquer aperto (≈ 5 caixas).
 */
export const LOAN = { base: 0 as Cents, perLevel: 40000 as Cents, dailyRate: 0.004 };

/** Falência: caixa abaixo do piso, sem crédito e sem estoque (liquidado a `stockRecovery` do custo) que cubra o rombo. */
export const BANKRUPTCY = { floor: 0 as Cents, stockRecovery: 0.5, restartMoney: 30000 as Cents };

/**
 * Melhorias permanentes (compra única). Dolly: carrega até 3 caixas (1 sem ela). Pote de gorjeta: gorjetas × mult.
 * Capacidade: +`extra` clientes simultâneos (api.customerCapacity).
 */
export const UPGRADES = {
  tipjar: { name: 'Pote de gorjeta', description: 'Clientes satisfeitos deixam gorjetas 50% maiores.', cost: 10000 as Cents, minLevel: 2, mult: 1.5 },
  recycler: { name: 'Lixeira de reciclagem', description: 'Caixas de papelão vazias jogadas na lixeira verde rendem R$ 0,25 cada; o repositor também recicla.', cost: 40000 as Cents, minLevel: 5 },
  dolly: { name: 'Carrinho de carga', description: 'Carregue até 3 caixas de uma vez em vez de 1. O repositor também leva +1 caixa por viagem.', cost: 150000 as Cents, minLevel: 6, carry: 3 }, // pós-teste 3: R$ 5.000 → 1.500
};
export const BASE_CARRY = 1;
/** Crédito por caixa vazia reciclada (melhoria 'recycler'). */
export const RECYCLE_REWARD = 25 as Cents;

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
