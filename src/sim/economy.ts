import { LICENSES, PRODUCTS, productById } from './catalog';
import { buyProbability, customersForDay, pickProduct } from './demand';
import { stockProduct, unstockProduct } from './levels';
import { advanceMarket, marketAverage, sellPrice, wholesale } from './market';
import { roundPrice, type Cents } from './money';
import { rentFor } from './rent';
import { makeRng } from './rng';
import { CHECKOUT, EMPLOYEE_TABLE, HISTORY_DAYS, LOAN, MAX_EMPLOYEE_LEVEL, SALE, type EmployeeRole } from './tuning';
import { emptyLedger, type Ledger, type StoreState } from './state';

/* ---------- Progressão ---------- */

/**
 * XP acumulado necessário para ALCANÇAR o nível n (n>=2): XP_BASE·(n−1)^XP_EXP·(1 + XP_LATE_SLOPE·max(0, n−15)).
 * Fase 3: nível 2 custa só 60 XP (sobe no dia 1 mesmo com a loja pobre); os primeiros níveis vêm mais rápido e do
 * nível ~12 em diante a curva fica ≈ a antiga (nível 15: 14.500 XP; nível 30: 115 mil).
 */
export const xpForLevel = (n: number): number =>
  n <= 1 ? 0 : Math.round(XP_BASE * Math.pow(n - 1, XP_EXP) * (1 + XP_LATE_SLOPE * Math.max(0, n - XP_LATE_FROM)));
export const XP_BASE = 60;
export const XP_EXP = 2.08;
/** Depois do nível 15 a curva fica mais íngreme (fim de jogo: nível ~30 por volta do dia 90-100 com o bot). */
export const XP_LATE_FROM = 15;
export const XP_LATE_SLOPE = 0.05;

/** Juros diários do empréstimo (múltiplo de R$ 0,05, arredondado para cima; 0 se não há dívida). */
export const loanInterest = (owed: Cents): Cents => (owed <= 0 ? 0 : Math.ceil((owed * LOAN.dailyRate) / 5) * 5);

/** Acumula unidades/receita/lucro do produto no dia corrente (state.stats, janela de 30 dias). */
export function recordProductStat(state: StoreState, productId: string, qty: number, revenue: Cents, cogs: Cents): void {
  let e = state.stats[state.stats.length - 1];
  if (!e || e.day !== state.day) {
    e = { day: state.day, p: {} };
    state.stats.push(e);
    while (state.stats.length > HISTORY_DAYS) state.stats.shift();
  }
  const r = (e.p[productId] ??= [0, 0, 0]);
  r[0] += qty;
  r[1] += revenue;
  r[2] += revenue - cogs;
}

export function addXp(state: StoreState, amount: number): void {
  state.xp += amount;
  while (state.xp >= xpForLevel(state.level + 1)) state.level++;
}

export const shelfCapacity = (state: StoreState, id: string): number =>
  (state.slots[id] ?? 0) * productById(id).slotCapacity;

export function unitsOwned(state: StoreState, id: string): number {
  const side = state.sidewalk.filter((b) => b.productId === id).reduce((a, b) => a + b.units, 0);
  return (state.shelf[id] ?? 0) + (state.storage[id] ?? 0) + side;
}

/* ---------- Licenças ---------- */

export function buyLicense(state: StoreState, category: string): void {
  const lic = LICENSES.find((l) => l.id === category);
  if (!lic) throw new Error('Licença inexistente');
  if (state.licenses.includes(lic.id)) throw new Error('Licença já adquirida');
  if (state.level < lic.minLevel) throw new Error(`Requer nível ${lic.minLevel}`);
  if (state.money < lic.cost) throw new Error('Dinheiro insuficiente');
  state.money -= lic.cost;
  state.licenses.push(lic.id);
}

/* ---------- Compra / reposição ---------- */

/** Compra caixas ao preço de atacado do dia. Entrega instantânea na calçada (sem espera artificial). */
export function buyBoxes(state: StoreState, productId: string, boxes: number): Cents {
  const p = productById(productId);
  if (!state.licenses.includes(p.category)) throw new Error('Categoria não licenciada');
  if (!Number.isInteger(boxes) || boxes <= 0) throw new Error('Quantidade inválida');
  const unit = wholesale(state, productId);
  const cost = unit * p.boxSize * boxes;
  if (state.money < cost) throw new Error('Dinheiro insuficiente');
  const units = p.boxSize * boxes;
  const basis = state.costBasis[productId] ?? { units: 0, avg: 0 };
  basis.avg = Math.round((basis.avg * basis.units + unit * units) / (basis.units + units));
  basis.units += units;
  state.costBasis[productId] = basis;
  state.money -= cost;
  state.ledger.purchases += cost;
  for (let i = 0; i < boxes; i++) state.sidewalk.push({ productId, units: p.boxSize, open: false });
  return cost;
}

/**
 * Move unidades das caixas da calçada para a exposição (níveis do produto, depois níveis livres compatíveis; ver
 * levels.stockProduct), até encher. Caixas esvaziadas somem (lixeira).
 */
export function putOnShelf(state: StoreState, productId: string): number {
  let moved = 0;
  for (const box of state.sidewalk) {
    if (box.productId !== productId || box.units <= 0) continue;
    const n = stockProduct(state, productId, box.units);
    box.units -= n;
    moved += n;
    if (box.units > 0) break; // exposição cheia
  }
  state.sidewalk = state.sidewalk.filter((b) => b.units > 0);
  return moved;
}

export function setPrice(state: StoreState, productId: string, price: Cents): void {
  state.prices[productId] = roundPrice(price);
}

/* ---------- Venda ---------- */

export function recordSale(state: StoreState, productId: string, qty: number): Cents {
  const have = state.shelf[productId] ?? 0;
  if (qty <= 0 || qty > have) throw new Error('Estoque de prateleira insuficiente');
  const price = sellPrice(state, productId);
  const basis = state.costBasis[productId];
  const avg = basis?.avg ?? wholesale(state, productId);
  unstockProduct(state, productId, qty);
  if (basis) basis.units = Math.max(0, basis.units - qty);
  const total = price * qty;
  state.ledger.revenue += total;
  state.ledger.cogs += avg * qty;
  recordProductStat(state, productId, qty, total, avg * qty);
  addXp(state, qty); // 1 XP por unidade vendida
  return total;
}

/* ---------- Funcionários ---------- */

/** Nº de caixas contratados (ausente = 1 se houver caixa). */
export function cashierCount(state: StoreState): number {
  if (state.employees.cashier <= 0) return 0;
  return Math.max(1, Math.min(4, Math.floor(state.employees.cashierCount ?? 1)));
}

export function dailyWages(state: StoreState): Cents {
  let sum = 0;
  for (const role of Object.keys(EMPLOYEE_TABLE) as EmployeeRole[]) {
    const lvl = Math.min(MAX_EMPLOYEE_LEVEL, state.employees[role]);
    if (lvl > 0) sum += (EMPLOYEE_TABLE[role].wage[lvl - 1] ?? 0) * (role === 'cashier' ? cashierCount(state) : 1);
  }
  return sum;
}

/** Clientes/dia que o checkout aguenta: jogador manual + caixa contratado + caixas registradoras extras. */
export function checkoutCapacity(state: StoreState): number {
  const c = state.employees.cashier;
  const counters = state.furniture.filter((f) => f.type === 'counter').length;
  const cashier = c > 0 ? Math.round(CHECKOUT.cashierBase * (1 + CHECKOUT.cashierLevelBonus * (c - 1))) : 0;
  return CHECKOUT.manual + cashier * Math.max(1, cashierCount(state)) + CHECKOUT.extraCounter * Math.max(0, counters - 1);
}

/* ---------- Dia ---------- */

export interface DayReport {
  day: number;
  revenue: Cents;
  tips: Cents;
  cogs: Cents;
  purchases: Cents;
  fixed: Cents;
  /** Lucro contábil = receita + gorjetas − COGS − despesas fixas. Estocar não derruba o lucro. */
  netProfit: Cents;
  /** Variação de caixa real do dia. */
  cashDelta: Cents;
  served: number;
  lost: number;
  reputation: number;
  /** Fase 2: juros do empréstimo cobrados no dia (já incluídos em `fixed`). */
  interest?: Cents;
  /** Fase 2: saldo devedor ao fechar o dia (depois dos juros). */
  loan?: Cents;
  /*
   * Fase 3 (sempre presentes em relatórios novos; opcionais só porque o histórico de saves antigos não os tem).
   * Resumo do dia no estilo do original: clientes total (= served + lost) / irritados / felizes; rendimento, despesa, lucro.
   */
  /** Clientes felizes: vendas com satisfação >= 3. */
  happy?: number;
  /** Clientes irritados: vendas com satisfação < 3 + perdidos/desistentes. happy + angry = served + lost. */
  angry?: number;
  /** Aluguel cobrado neste dia (parte de `fixed`; 0 no começo do jogo). */
  rent?: Cents;
  /** Salários cobrados neste dia (parte de `fixed`). */
  wages?: Cents;
  /** Rendimento = receita + gorjetas. */
  income?: Cents;
  /** Despesa = custo das mercadorias vendidas (COGS) + despesas fixas. income − expenses = netProfit. */
  expenses?: Cents;
  /** Caixas recicladas no dia e quanto renderam (já incluído em `income`). Ausente em saves antigos. */
  recycled?: number;
  recycleIncome?: Cents;
}

/**
 * Simula o expediente inteiro sem UI (usado em testes de balanceamento e para
 * fast-forward). O jogo interativo chama as mesmas funções cliente a cliente.
 */
export function simulateOpenDay(state: StoreState): void {
  const rand = makeRng(state.seed * 1000 + state.day);
  const arrivals = customersForDay(state, rand);
  const capacity = checkoutCapacity(state);
  let satSum = 0;
  let satN = 0;
  for (let i = 0; i < arrivals; i++) {
    if (i >= capacity) {
      state.ledger.lost++;
      state.ledger.angry++;
      satSum += 2;
      satN++;
      continue;
    }
    const items = 1 + Math.floor(rand() * 6);
    let bought = 0;
    let basketTotal = 0;
    let sat = 4.5;
    for (let k = 0; k < items; k++) {
      const id = pickProduct(state, rand);
      if (!id) break;
      const ratio = sellPrice(state, id) / marketAverage(state, id);
      const stock = state.shelf[id] ?? 0;
      if (stock <= 0) {
        sat -= 1;
        continue;
      }
      if (rand() < buyProbability(ratio)) {
        const qty = Math.min(stock, 1 + Math.floor(rand() * 3));
        basketTotal += recordSale(state, id, qty);
        bought++;
      } else if (ratio > 1.2) {
        sat -= 1.5;
      }
    }
    if (bought === 0) {
      state.ledger.lost++;
      state.ledger.angry++;
      sat = Math.min(sat, 2);
    } else {
      state.ledger.served++;
      if (sat >= SALE.happyMin) state.ledger.happy++;
      else state.ledger.angry++;
      if (sat >= 4) {
        const tip = roundPrice(basketTotal * 0.03);
        state.ledger.tips += tip;
        state.money += tip;
      }
    }
    satSum += Math.max(1, Math.min(5, sat));
    satN++;
  }
  // Receita entra no caixa ao final (equivalente a somar venda a venda).
  state.money += state.ledger.revenue;
  if (satN > 0) state.reputation = Math.min(5, Math.max(1, state.reputation * 0.8 + (satSum / satN) * 0.2));
}

/**
 * Fecha o dia: cobra despesas fixas (aluguel do dia em `state.rent` + salários + juros), gera relatório, avança mercado
 * e calendário e recalcula o aluguel do dia seguinte (rent.ts: rampa a partir do nível 4 ou do dia 6).
 */
export function endDay(state: StoreState): DayReport {
  const l: Ledger = state.ledger;
  const interest = loanInterest(state.loan);
  const rent = Math.max(0, Math.round(state.rent));
  const wages = dailyWages(state);
  const fixed = rent + wages + interest;
  state.money -= fixed;
  const income = l.revenue + l.tips + l.recycleIncome;
  const expenses = l.cogs + fixed;
  const report: DayReport = {
    day: state.day,
    revenue: l.revenue,
    tips: l.tips,
    cogs: l.cogs,
    purchases: l.purchases,
    fixed,
    netProfit: income - expenses,
    cashDelta: income - l.purchases - fixed,
    served: l.served,
    lost: l.lost,
    reputation: state.reputation,
    interest,
    loan: state.loan,
    happy: l.happy,
    angry: l.angry,
    rent,
    wages,
    income,
    expenses,
    recycled: l.recycled,
    recycleIncome: l.recycleIncome,
  };
  state.history.push(report);
  while (state.history.length > HISTORY_DAYS) state.history.shift();
  state.day++;
  state.ledger = emptyLedger();
  state.rent = rentFor(state);
  advanceMarket(state, makeRng(state.seed * 7919 + state.day));
  return report;
}

/** Bot de reposição para testes: enche todas as prateleiras licenciadas que couberem no caixa. */
export function autoRestock(state: StoreState): void {
  for (const p of PRODUCTS) {
    if (!state.licenses.includes(p.category)) continue;
    const cap = shelfCapacity(state, p.id);
    const missing = cap - (state.shelf[p.id] ?? 0);
    const boxes = Math.ceil(missing / p.boxSize);
    for (let b = boxes; b > 0; b--) {
      try {
        buyBoxes(state, p.id, b);
        break;
      } catch {
        /* sem caixa suficiente: tenta menos caixas */
      }
    }
    putOnShelf(state, p.id);
  }
}
