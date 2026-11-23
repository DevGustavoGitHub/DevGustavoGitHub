/**
 * API pública da simulação para os módulos de jogo (world/player/npc/ui/audio).
 * ASSINATURAS CONGELADAS (apenas adições). Todas as funções mutam `state` e lançam Error('mensagem pt-BR') em
 * violação de regra (dinheiro insuficiente, nível baixo, posição inválida...). Dinheiro sempre em centavos.
 * Regras em furniture.ts / economy.ts / tuning.ts; números documentados em docs/GDD.md §4.
 */
import { DOOR_WIDTH, MAX_EXPANSION, SIDEWALK_DEPTH, STORAGE_DEPTH, doorX, storeBounds, type FurnitureType } from '../core/layout';
import { PRODUCTS, productById } from './catalog';
import { buyProbability, customersForDay } from './demand';
import {
  addXp, buyBoxes, checkoutCapacity, dailyWages, endDay, loanInterest, recordProductStat, unitsOwned, type DayReport,
} from './economy';
import {
  canPlace as canPlaceImpl, relocateBlocking, footprintOf, furnitureById, furnitureCost, furnitureCatalog as catalogImpl, isDisplay,
  specOf, storageCapacity as storageCapacityImpl, storageUsed as storageUsedImpl, displayTypeFor, storagePassage,
} from './furniture';
import {
  acceptsProduct, canDisplay, emptyLevels, productCapacity as productCapacityImpl, reconcile, returnUnits, stockProduct, syncShelf,
  unstockProduct,
} from './levels';
import { marketAverage, sellPrice, wholesale } from './market';
import { roundPrice, type Cents } from './money';
import { rentFor } from './rent';
import { makeRng } from './rng';
import { INITIAL_NEXT_FURNITURE_ID, emptyLedger, initialFurniture, type AutoOrderRule, type Decor, type Furniture, type ShelfLevel, type StoreState } from './state';
import { CLOSE_MIN, OPEN_MIN } from './state';
import {
  BANKRUPTCY, BASE_CARRY, CUSTOMER_CAPACITY, DECOR_CHANGE_COST, DECOR_ITEMS, DIRT, DROP, LOAN, UPGRADES, EMPLOYEE_TABLE, EXPANSIONS,
  MAX_EMPLOYEE_LEVEL, SALE, SELL_REFUND, SIDEWALK_MAX_BOXES, STORAGE, STORE_NAME_MAX,
} from './tuning';

export type { DayReport };

/* ---------- Móveis / layout ---------- */
/**
 * `slots`: shelf/fridge/freezer = nº de NÍVEIS do móvel (Fase 4: 4 / 4 / 3; cada nível guarda até slotCapacity unidades
 * de um produto); rack = nº de caixas no depósito.
 */
export interface FurnitureSpec { type: FurnitureType; name: string; cost: Cents; minLevel: number; slots: number; /** categorias aceitas (vazio = qualquer/nenhuma) */ categories: string[] }
export function furnitureCatalog(): FurnitureSpec[] { return catalogImpl(); }
/** Itens de decoração (id = variante passada como 5º argumento de buyFurniture). Preço/nível próprios; `furnitureCatalog()` traz o preço-base. */
export interface DecorItem { id: string; name: string; cost: Cents; minLevel: number }
export function decorCatalog(): DecorItem[] { return DECOR_ITEMS.map((d) => ({ ...d })); }
/** Footprint considerando rotação. Valida limites do salão (storeBounds), colisões, porta e passagem mínima. */
export function canPlace(state: StoreState, type: FurnitureType, x: number, z: number, rot: 0 | 90 | 180 | 270, ignoreId?: number): boolean {
  return canPlaceImpl(state, type, x, z, rot, ignoreId);
}

const DISPLAY_NAMES: Record<string, string> = { shelf: 'prateleira', fridge: 'geladeira', freezer: 'freezer' };

function checkAssign(state: StoreState, type: FurnitureType, productId: string): void {
  if (!isDisplay(type)) throw new Error('Este móvel não expõe produtos');
  const p = productById(productId);
  if (!specOf(type).categories.includes(p.category)) throw new Error(`${p.name} não cabe em ${DISPLAY_NAMES[type] ?? 'este móvel'}`);
  if (!state.licenses.includes(p.category)) throw new Error('Categoria não licenciada');
}

export function buyFurniture(state: StoreState, type: FurnitureType, x: number, z: number, rot: 0 | 90 | 180 | 270, productId?: string): Furniture {
  const spec = specOf(type);
  const decorItem = type === 'decor' && productId !== undefined ? DECOR_ITEMS.find((d) => d.id === productId) : undefined;
  const minLevel = Math.max(spec.minLevel, decorItem?.minLevel ?? 0);
  const cost = furnitureCost(type, type === 'decor' ? productId : undefined);
  if (state.level < minLevel) throw new Error(`Requer nível ${minLevel}`);
  if (state.money < cost) throw new Error('Dinheiro insuficiente');
  if (!canPlaceImpl(state, type, x, z, rot)) throw new Error('Posição inválida');
  if (productId !== undefined && isDisplay(type)) checkAssign(state, type, productId);
  state.money -= cost;
  const f: Furniture = { id: state.nextFurnitureId++, type, x, z, rot };
  // Fase 4: expositor nasce com níveis vazios (sem etiqueta; com `productId`, todos etiquetados com ele)
  if (isDisplay(type)) f.levels = emptyLevels(type, productId);
  else if (type === 'decor' && productId !== undefined) f.variant = productId; // decor: o 5º argumento é a variante visual
  state.furniture.push(f);
  reconcile(state);
  return f;
}

export function moveFurniture(state: StoreState, id: number, x: number, z: number, rot: 0 | 90 | 180 | 270): void {
  const f = furnitureById(state, id);
  if (!canPlaceImpl(state, f.type, x, z, rot, id)) throw new Error('Posição inválida');
  f.x = x;
  f.z = z;
  f.rot = rot;
}

/**
 * Tira o móvel do salão (vender/desmontar): recusa o último balcão e a estante que deixaria o depósito acima da
 * capacidade; as unidades dos níveis voltam ao depósito (se couber) ou viram caixas fechadas na calçada.
 */
function removeFurniture(state: StoreState, id: number, rackMsg: string): Furniture {
  const f = furnitureById(state, id);
  if (f.type === 'counter' && state.furniture.filter((x) => x.type === 'counter').length <= 1) {
    throw new Error('A loja precisa de pelo menos um caixa registradora');
  }
  const idx = state.furniture.indexOf(f);
  state.furniture.splice(idx, 1);
  if (f.type === 'rack' && storageUsedImpl(state) > storageCapacityImpl(state)) {
    state.furniture.splice(idx, 0, f);
    throw new Error(rackMsg);
  }
  for (const l of f.levels ?? []) if (l.productId !== undefined) returnUnits(state, l.productId, l.units);
  delete f.levels;
  reconcile(state);
  return f;
}

/** Vende o móvel por 50% do custo; o estoque exposto volta para o depósito/calçada conforme regra do sim. */
export function sellFurniture(state: StoreState, id: number): Cents {
  const f = removeFurniture(state, id, 'Esvazie o depósito antes de vender a estante');
  const refund = Math.round(furnitureCost(f.type, f.variant) * SELL_REFUND);
  state.money += refund;
  return refund;
}

/**
 * Etiqueta os níveis VAZIOS (0 unidades) do shelf/fridge/freezer com o produto (validando tipo do móvel, categoria e
 * licença); `undefined` tira a etiqueta dos níveis vazios. Níveis com unidades mantêm o próprio produto (Fase 4).
 */
export function assignProduct(state: StoreState, furnitureId: number, productId: string | undefined): void {
  const f = furnitureById(state, furnitureId);
  if (!isDisplay(f.type)) throw new Error('Este móvel não expõe produtos');
  if (productId !== undefined) checkAssign(state, f.type, productId);
  reconcile(state); // garante os níveis
  for (const l of f.levels ?? []) {
    if (l.units > 0) continue;
    if (productId === undefined) delete l.productId;
    else l.productId = productId;
  }
  syncShelf(state);
}

/** Capacidade de exposição de um produto = nº de níveis com a etiqueta dele × slotCapacity (state.slots = nº de níveis). */
export function productCapacity(state: StoreState, productId: string): number { return productCapacityImpl(state, productId); }

/** Capacidade do depósito em caixas (0 se bloqueado) e ocupação atual. */
export const storageCapacity = (state: StoreState): number => storageCapacityImpl(state);
export const storageUsed = (state: StoreState): number => storageUsedImpl(state);

/* ---------- Expansão / depósito ---------- */
export function expansionCost(state: StoreState): Cents | null { return EXPANSIONS[state.expansion]?.cost ?? null; }
export function expansionMinLevel(state: StoreState): number | null { return EXPANSIONS[state.expansion]?.minLevel ?? null; }
export function buyExpansion(state: StoreState): void {
  const e = EXPANSIONS[state.expansion];
  if (!e) throw new Error('A loja já está no tamanho máximo');
  if (state.level < e.minLevel) throw new Error(`Requer nível ${e.minLevel}`);
  if (state.money < e.cost) throw new Error('Dinheiro insuficiente');
  state.money -= e.cost;
  state.expansion++;
  state.rent = rentFor(state); // aluguel cheio sobe RENT.perExpansion (já vale para o fechamento de hoje)
  relocateBlocking(state); // a porta muda de lugar: tira móveis da nova antessala/passagem
}
export function storageCost(): { cost: Cents; minLevel: number } { return { cost: STORAGE.cost, minLevel: STORAGE.minLevel }; }
export function unlockStorage(state: StoreState): void {
  if (state.storageUnlocked) throw new Error('Depósito já desbloqueado');
  if (state.level < STORAGE.minLevel) throw new Error(`Requer nível ${STORAGE.minLevel}`);
  if (state.money < STORAGE.cost) throw new Error('Dinheiro insuficiente');
  state.money -= STORAGE.cost;
  state.storageUnlocked = true;
}

/* ---------- Funcionários ---------- */
export type Role = 'cashier' | 'stocker' | 'janitor';
/** Custo de contratar (nível 0→1) ou evoluir (n→n+1); null se no nível máximo. Nível máx. 5. */
export function employeeCost(state: StoreState, role: Role): { cost: Cents; minLevel: number; dailyWage: Cents } | null {
  const lvl = state.employees[role];
  if (lvl >= MAX_EMPLOYEE_LEVEL) return null;
  const t = EMPLOYEE_TABLE[role];
  return { cost: t.cost[lvl] ?? 0, minLevel: t.minLevel[lvl] ?? 99, dailyWage: t.wage[lvl] ?? 0 };
}
export function hireOrUpgrade(state: StoreState, role: Role): void {
  const c = employeeCost(state, role);
  if (!c) throw new Error('Funcionário já está no nível máximo');
  if (state.level < c.minLevel) throw new Error(`Requer nível ${c.minLevel}`);
  if (state.money < c.cost) throw new Error('Dinheiro insuficiente');
  state.money -= c.cost;
  state.employees[role]++;
}
/** Segundos reais que o funcionário leva por ação, por nível (usado pelo módulo npc). Nível é limitado a 1..5. */
export function employeeSpeed(role: Role, level: number): number {
  const lvl = Math.min(MAX_EMPLOYEE_LEVEL, Math.max(1, Math.round(level)));
  return EMPLOYEE_TABLE[role].seconds[lvl - 1] ?? 10;
}
/** Salário diário total (soma dos funcionários contratados). */
export const wagesPerDay = (state: StoreState): Cents => dailyWages(state);

/* ---------- Personalização ---------- */
export function setStoreName(state: StoreState, name: string): void {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length === 0) throw new Error('O nome não pode ficar vazio');
  if (n.length > STORE_NAME_MAX) throw new Error(`Nome muito longo (máx. ${STORE_NAME_MAX} letras)`);
  state.storeName = n;
}
/** Cada cor alterada custa R$ 10,00. Retorna o custo cobrado (0 se nada mudou). */
export function setDecor(state: StoreState, d: Partial<Decor>): Cents {
  const keys = (['wallColor', 'floorColor', 'signColor'] as const).filter((k) => d[k] !== undefined && d[k] !== state.decor[k]);
  for (const k of keys) if (!/^#[0-9a-fA-F]{6}$/.test(d[k]!)) throw new Error('Cor inválida (use #rrggbb)');
  const cost = keys.length * DECOR_CHANGE_COST;
  if (state.money < cost) throw new Error('Dinheiro insuficiente');
  state.money -= cost;
  for (const k of keys) state.decor[k] = d[k]!.toLowerCase();
  return cost;
}

/* ---------- Caixas / estoque físico ---------- */
/** Compra e cria as caixas em state.sidewalk (x/z indefinidos). Retorna o custo. Alias de economy.buyBoxes com validação. */
export function orderBoxes(state: StoreState, productId: string, boxes: number): Cents {
  if (Number.isInteger(boxes) && boxes > 0 && state.sidewalk.length + boxes > SIDEWALK_MAX_BOXES) {
    throw new Error('Calçada cheia: guarde ou reponha as caixas antes de pedir mais');
  }
  return buyBoxes(state, productId, boxes);
}

function boxAt(state: StoreState, boxIndex: number) {
  const box = state.sidewalk[boxIndex];
  if (!box) throw new Error('Caixa inexistente');
  return box;
}

/**
 * Move até n unidades da caixa para a exposição: enche os níveis com a etiqueta do produto e depois níveis livres
 * (sem etiqueta) de móveis que aceitam a categoria. Retorna quantas moveu (0 = tudo cheio).
 * Fase 4: para repor um nível específico (o que o jogador mira) use `placeUnitsInLevel`.
 */
export function placeUnits(state: StoreState, boxIndex: number, n: number): number {
  const box = boxAt(state, boxIndex);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Quantidade inválida');
  if (!canDisplay(state, box.productId)) throw new Error('Nenhuma prateleira exibe este produto');
  if (box.units <= 0) return 0;
  const moved = stockProduct(state, box.productId, Math.min(n, box.units));
  box.units -= moved;
  return moved;
}

/** Descarta caixa VAZIA (units==0) na lixeira externa. */
export function discardBox(state: StoreState, boxIndex: number): void {
  const box = boxAt(state, boxIndex);
  if (box.units > 0) throw new Error('A caixa ainda tem produtos');
  state.sidewalk.splice(boxIndex, 1);
}

/** Move a caixa (inteira) para o depósito: soma state.storage[productId]; exige storageUnlocked. */
export function storeBox(state: StoreState, boxIndex: number): void {
  if (!state.storageUnlocked) throw new Error('Desbloqueie o depósito primeiro');
  const box = boxAt(state, boxIndex);
  if (box.units <= 0) throw new Error('Caixa vazia: jogue no lixo');
  const p = productById(box.productId);
  const stored = state.storage[box.productId] ?? 0;
  const extra = Math.ceil((stored + box.units) / p.boxSize) - Math.ceil(stored / p.boxSize);
  if (storageUsedImpl(state) + extra > storageCapacityImpl(state)) throw new Error('Depósito cheio: compre mais estantes');
  state.storage[box.productId] = stored + box.units;
  state.sidewalk.splice(boxIndex, 1);
}

/** Retira do depósito 1 caixa de `productId` (cria Box com carried=true se `carry`). Retorna unidades retiradas. */
export function takeFromStorage(state: StoreState, productId: string, carry: boolean): number {
  const have = state.storage[productId] ?? 0;
  if (have <= 0) throw new Error('Sem estoque no depósito');
  const n = Math.min(have, productById(productId).boxSize);
  state.storage[productId] = have - n;
  state.sidewalk.push(carry ? { productId, units: n, open: false, carried: true } : { productId, units: n, open: false });
  return n;
}

/* ---------- Clientes e vendas ---------- */
/** Nº de chegadas previstas hoje (usa customersForDay com o RNG do dia). Chame uma vez ao abrir a loja. */
export function plannedArrivals(state: StoreState): number {
  return customersForDay(state, makeRng(state.seed * 1000 + state.day));
}

/** Minutos do dia (OPEN_MIN..CLOSE_MIN-30) de cada chegada prevista, ordenados; picos no almoço e no fim da tarde. */
export function arrivalSchedule(state: StoreState): number[] {
  const n = plannedArrivals(state);
  const rand = makeRng(state.seed * 1000 + state.day + 500000);
  const span = CLOSE_MIN - 30 - OPEN_MIN;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = rand();
    // mistura: 25% uniforme, 35% pico ~12h30, 40% pico ~18h30 (aprox. gaussiana por soma de uniformes)
    const g = (rand() + rand() + rand() - 1.5) / 1.5; // ~[-1,1]
    const t = r < 0.25 ? rand() * span : r < 0.6 ? 12.5 * 60 - OPEN_MIN + g * 90 : 18.5 * 60 - OPEN_MIN + g * 90;
    out.push(OPEN_MIN + Math.round(Math.min(span, Math.max(0, t))));
  }
  return out.sort((a, b) => a - b);
}

/**
 * Lista de compras (produtos distintos, só categorias licenciadas e com algum nível etiquetado — `state.slots` > 0),
 * sem checar preço/estoque.
 * Pode devolver [] se não houver nada exposto. Nº de itens: 1..(4 + nível/3), até 7 produtos distintos.
 */
export function makeShoppingList(state: StoreState, rand: () => number): { productId: string; qty: number }[] {
  const pool = PRODUCTS.filter((p) => state.licenses.includes(p.category) && (state.slots[p.id] ?? 0) > 0);
  if (pool.length === 0) return [];
  const maxItems = Math.min(pool.length, 7, 3 + Math.floor(state.level / 3));
  const count = Math.min(pool.length, 1 + Math.floor(rand() * (maxItems + 1)));
  const list: { productId: string; qty: number }[] = [];
  const left = [...pool];
  for (let i = 0; i < count && left.length > 0; i++) {
    const total = left.reduce((a, p) => a + p.popularity, 0);
    let r = rand() * total;
    let idx = 0;
    for (let k = 0; k < left.length; k++) {
      r -= left[k]!.popularity;
      if (r <= 0) { idx = k; break; }
      idx = k;
    }
    const [p] = left.splice(idx, 1);
    // variedade: quantidade quase sempre 1-2 (itens caros tendem a 1)
    const qty = rand() < 0.45 ? 1 : rand() < 0.65 ? 2 : 3;
    list.push({ productId: p!.id, qty });
  }
  return list;
}

/** O cliente topa pagar o preço atual? (curva buyProbability). `ratio` devolvido p/ balão de reclamação. */
export function acceptsPrice(state: StoreState, productId: string, rand: () => number): { ok: boolean; ratio: number } {
  const ratio = sellPrice(state, productId) / marketAverage(state, productId);
  return { ok: rand() < buyProbability(ratio), ratio };
}

/**
 * Retira do estoque exposto ao cliente colocar no carrinho (do nível mais cheio do produto). Retorna qtd realmente
 * retirada (pode ser < qty). Fase 4: para tirar de um nível específico use `takeFromLevel`.
 */
export function takeFromShelf(state: StoreState, productId: string, qty: number): number {
  if (!Number.isInteger(qty) || qty <= 0) return 0;
  return unstockProduct(state, productId, qty);
}
/** Devolve à exposição (níveis do produto, depois níveis livres); o que não couber vai para o depósito/calçada. */
export function returnToShelf(state: StoreState, productId: string, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) return;
  returnUnits(state, productId, qty - stockProduct(state, productId, qty));
}
/** Total do carrinho ao preço de venda atual. */
export function basketTotal(state: StoreState, items: { productId: string; qty: number }[]): Cents {
  return items.reduce((a, it) => a + sellPrice(state, it.productId) * it.qty, 0);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Penalidade de satisfação por sujeira acumulada (pequena). */
export function dirtPenalty(state: StoreState): number {
  return Math.min(DIRT.penaltyMax, Math.max(0, state.dirt.length - DIRT.freeSpots) * DIRT.penaltyPerSpot);
}

function updateReputation(state: StoreState, satisfaction: number): void {
  const sat = clamp(satisfaction - dirtPenalty(state), 1, 5);
  state.reputation = clamp(state.reputation * (1 - SALE.repAlpha) + sat * SALE.repAlpha, 1, 5);
}

/**
 * Fecha a venda: receita, COGS, XP, gorjeta, reputação do cliente. `speed` 0..1 (1 = muito rápido) escala a gorjeta;
 * `satisfaction` 1..5. Dinheiro entra no caixa imediatamente. Retorna {total, tip}.
 * As unidades já devem ter saído da prateleira (takeFromShelf). Gorjeta ≤ 8% do total (≤ 12% com o pote de gorjeta).
 * Fase 3: satisfação >= 3 conta cliente feliz (`ledger.happy`); abaixo disso, irritado (`ledger.angry`).
 */
export function completeSale(state: StoreState, items: { productId: string; qty: number }[], speed: number, satisfaction: number): { total: Cents; tip: Cents } {
  let total = 0;
  let cogs = 0;
  let units = 0;
  for (const it of items) {
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error('Quantidade inválida no carrinho');
    productById(it.productId);
  }
  for (const it of items) {
    const rev = sellPrice(state, it.productId) * it.qty;
    const basis = state.costBasis[it.productId];
    const cost = (basis && basis.avg > 0 ? basis.avg : wholesale(state, it.productId)) * it.qty;
    total += rev;
    cogs += cost;
    recordProductStat(state, it.productId, it.qty, rev, cost);
    if (basis) basis.units = Math.max(0, basis.units - it.qty);
    units += it.qty;
  }
  const sp = clamp(Number.isFinite(speed) ? speed : 0, 0, 1);
  const sat = clamp(Number.isFinite(satisfaction) ? satisfaction : 3, 1, 5);
  const tipFactor = clamp((sat - 2) / 3, 0, 1) * sp;
  const jar = state.upgrades.includes('tipjar') ? UPGRADES.tipjar.mult : 1;
  const tip = Math.floor((total * SALE.tipMax * jar * tipFactor) / 5) * 5;
  state.money += total + tip;
  state.ledger.revenue += total;
  state.ledger.tips += tip;
  state.ledger.cogs += cogs;
  state.ledger.served++;
  if (sat >= SALE.happyMin) state.ledger.happy++;
  else state.ledger.angry++;
  addXp(state, units + SALE.xpPerCustomer + Math.round(units * SALE.xpSpeedBonus * sp));
  updateReputation(state, sat);
  return { total, tip };
}

/** Registra cliente que foi embora sem comprar / desistiu (afeta reputação, ledger.lost e ledger.angry). */
export function recordLostCustomer(state: StoreState, satisfaction: number): void {
  state.ledger.lost++;
  state.ledger.angry++;
  updateReputation(state, Number.isFinite(satisfaction) ? satisfaction : 2);
}

/** Níveis ganhos desde a última chamada (ex.: [3,4]); a UI chama após vendas para tocar `levelUp`/mostrar o aviso. */
export function consumeLevelUps(state: StoreState): number[] {
  const out: number[] = [];
  for (let l = state.levelAck + 1; l <= state.level; l++) out.push(l);
  state.levelAck = Math.max(state.levelAck, state.level);
  return out;
}

/* ---------- Sujeira ---------- */
/** Acrescenta uma mancha (máx. 12; acima disso é ignorada). */
export function addDirt(state: StoreState, x: number, z: number): void {
  if (state.dirt.length >= DIRT.cap) return;
  state.dirt.push({ x, z });
}
/** Remove a mancha (índice inválido é ignorado: dois faxineiros podem disputar a mesma). */
export function cleanDirt(state: StoreState, index: number): void {
  if (Number.isInteger(index) && index >= 0 && index < state.dirt.length) state.dirt.splice(index, 1);
}

/* ---------- Dia ---------- */
/** Encerra o dia: paga aluguel+salários, gera DayReport, avança mercado/dia, limpa ledger. (wrapper de economy.endDay) */
export function closeDay(state: StoreState): DayReport {
  return endDay(state);
}
/** Preço de atacado/mercado/venda do dia para exibição na UI. `cost` = custo médio do estoque (ou atacado se não há). */
export function priceInfo(state: StoreState, productId: string): { wholesale: Cents; market: Cents; sell: Cents; cost: Cents } {
  const w = wholesale(state, productId);
  const basis = state.costBasis[productId];
  return { wholesale: w, market: marketAverage(state, productId), sell: sellPrice(state, productId), cost: basis && basis.units > 0 ? basis.avg : w };
}
/** Preço sugerido = média de mercado do dia (Fase 4: ×1,00, não mais +12%; múltiplo de R$ 0,05). */
export const suggestedPrice = (state: StoreState, productId: string): Cents => roundPrice(marketAverage(state, productId));

export { checkoutCapacity, footprintOf, STORAGE_DEPTH };

/* =====================================================================
 * FASE 2 — assinaturas CONGELADAS (o agente `sim` implementa; demais programam contra elas).
 * StoreState ganha (o sim cria defaults + migração em deserialize): loan, autoOrders, upgrades, history.
 * ===================================================================== */

/* ---------- Empréstimo e falência ---------- */
export interface LoanInfo { owed: Cents; maxLoan: Cents; available: Cents; dailyInterest: Cents }
const maxLoanFor = (state: StoreState): Cents => LOAN.base + LOAN.perLevel * Math.max(1, state.level);
/** Empréstimo com juros baixos diários; limite cresce com o nível. Falha se acima do limite. */
export function loanInfo(state: StoreState): LoanInfo {
  const maxLoan = maxLoanFor(state);
  return { owed: state.loan, maxLoan, available: Math.max(0, maxLoan - state.loan), dailyInterest: loanInterest(state.loan) };
}
const validAmount = (n: number): boolean => Number.isInteger(n) && n > 0;
export function takeLoan(state: StoreState, amount: Cents): void {
  if (!validAmount(amount)) throw new Error('Valor inválido');
  if (amount > loanInfo(state).available) throw new Error('Acima do limite de crédito');
  state.loan += amount;
  state.money += amount;
}
/** Paga parte ou toda a dívida (até o saldo devedor). */
export function repayLoan(state: StoreState, amount: Cents): void {
  if (!validAmount(amount)) throw new Error('Valor inválido');
  if (amount > state.loan) throw new Error('Valor maior que a dívida');
  if (amount > state.money) throw new Error('Dinheiro insuficiente');
  state.loan -= amount;
  state.money -= amount;
}
/** Valor de liquidação do estoque (custo médio × `stockRecovery`) — o que daria para levantar vendendo tudo. */
function stockLiquidation(state: StoreState): Cents {
  let v = 0;
  for (const p of PRODUCTS) {
    const n = unitsOwned(state, p.id);
    if (n <= 0) continue;
    const b = state.costBasis[p.id];
    v += n * (b && b.avg > 0 ? b.avg : wholesale(state, p.id));
  }
  return Math.floor(v * BANKRUPTCY.stockRecovery);
}
/** Falido = caixa abaixo do piso permitido, sem empréstimo disponível e sem estoque que cubra a dívida. */
export function isBankrupt(state: StoreState): boolean {
  if (state.money >= BANKRUPTCY.floor) return false;
  const shortfall = BANKRUPTCY.floor - state.money;
  return shortfall > loanInfo(state).available + stockLiquidation(state);
}
/**
 * Recomeço guiado: mantém nível, XP, licenças, melhorias, decoração, nome e histórico; zera dívida, estoque,
 * funcionários, expansões, depósito, móveis por montar e layout (volta ao inicial) e devolve um capital pequeno
 * (BANKRUPTCY.restartMoney). O aluguel é recalculado para a loja sem expansões (mesma regra de nível/dia de rent.ts).
 */
export function restartAfterBankruptcy(state: StoreState): void {
  state.money = BANKRUPTCY.restartMoney;
  state.loan = 0;
  state.autoOrders = {};
  state.prices = {};
  state.shelf = {};
  state.storage = {};
  state.sidewalk = [];
  state.costBasis = {};
  state.employees = { cashier: 0, stocker: 0, janitor: 0 };
  state.expansion = 0;
  state.storageUnlocked = false;
  state.furniture = initialFurniture();
  state.nextFurnitureId = INITIAL_NEXT_FURNITURE_ID;
  state.furnitureStock = [];
  state.dirt = [];
  state.ledger = emptyLedger();
  state.rent = rentFor(state);
  state.reputation = Math.max(state.reputation, 3);
  state.bankruptcies++;
  reconcile(state);
}

/* ---------- Pedidos automáticos e atalhos ---------- */
export type { AutoOrderRule };
/** null remove a regra. Só produtos licenciados. */
export function setAutoOrder(state: StoreState, productId: string, rule: AutoOrderRule | null): void {
  const p = productById(productId);
  if (rule === null) { delete state.autoOrders[productId]; return; }
  if (!state.licenses.includes(p.category)) throw new Error('Categoria não licenciada');
  if (!Number.isInteger(rule.minUnits) || rule.minUnits < 0 || rule.minUnits > 9999) throw new Error('Estoque mínimo inválido');
  if (!Number.isInteger(rule.boxes) || rule.boxes < 1 || rule.boxes > 24) throw new Error('Quantidade de caixas inválida (1 a 24)');
  state.autoOrders[productId] = { minUnits: rule.minUnits, boxes: rule.boxes };
}
export function autoOrderRules(state: StoreState): Record<string, AutoOrderRule> {
  const out: Record<string, AutoOrderRule> = {};
  for (const [k, v] of Object.entries(state.autoOrders)) out[k] = { ...v };
  return out;
}
/** Para cada regra com (shelf+storage+sidewalk) < minUnits, compra `boxes` caixas se houver dinheiro. Retorna o que comprou. */
export function runAutoOrders(state: StoreState): { productId: string; boxes: number; cost: Cents }[] {
  const out: { productId: string; boxes: number; cost: Cents }[] = [];
  for (const p of PRODUCTS) {
    const rule = state.autoOrders[p.id];
    if (!rule || !state.licenses.includes(p.category)) continue;
    if (unitsOwned(state, p.id) >= rule.minUnits) continue;
    try {
      out.push({ productId: p.id, boxes: rule.boxes, cost: orderBoxes(state, p.id, rule.boxes) });
    } catch {
      /* sem dinheiro ou calçada cheia: pula esta regra */
    }
  }
  return out;
}
/** Compra o necessário para encher cada prateleira até `fillRatio` (default 1). Só licenciados com móvel atribuído. */
export function buyMissing(state: StoreState, fillRatio = 1): { cost: Cents; boxes: number } {
  const ratio = clamp(Number.isFinite(fillRatio) ? fillRatio : 1, 0, 1);
  let cost = 0;
  let boxes = 0;
  for (const p of [...PRODUCTS].sort((a, b) => b.popularity - a.popularity)) {
    if (!state.licenses.includes(p.category)) continue;
    const cap = productCapacityImpl(state, p.id);
    if (cap === 0) continue;
    let need = Math.ceil((cap * ratio - unitsOwned(state, p.id)) / p.boxSize);
    const room = SIDEWALK_MAX_BOXES - state.sidewalk.length;
    need = Math.min(need, room);
    while (need > 0) {
      try {
        cost += orderBoxes(state, p.id, need);
        boxes += need;
        break;
      } catch {
        need--; // sem dinheiro para tudo: compra o que der
      }
    }
  }
  return { cost, boxes };
}

/* ---------- Melhorias (upgrades) ---------- */
/** Fase 3: + 'tipjar' (pote de gorjeta, nível 2) e 'capacity' (capacidade de clientes, nível 4). Catálogo em ordem de nível. */
export type UpgradeId = 'dolly' | 'tipjar' | 'capacity';
export interface UpgradeSpec { id: UpgradeId; name: string; description: string; cost: Cents; minLevel: number; owned: boolean }
export function upgradeCatalog(state: StoreState): UpgradeSpec[] {
  return (Object.keys(UPGRADES) as UpgradeId[]).map((id) => ({
    id, name: UPGRADES[id].name, description: UPGRADES[id].description, cost: UPGRADES[id].cost, minLevel: UPGRADES[id].minLevel,
    owned: state.upgrades.includes(id),
  }));
}
export function buyUpgrade(state: StoreState, id: UpgradeId): void {
  const u = UPGRADES[id];
  if (!u) throw new Error('Melhoria inexistente');
  if (state.upgrades.includes(id)) throw new Error('Melhoria já adquirida');
  if (state.level < u.minLevel) throw new Error(`Requer nível ${u.minLevel}`);
  if (state.money < u.cost) throw new Error('Dinheiro insuficiente');
  state.money -= u.cost;
  state.upgrades.push(id);
}
/** Quantas caixas o jogador carrega ao mesmo tempo: 1 sem melhoria; 3 com dolly. */
export function carryCapacity(state: StoreState): number {
  return state.upgrades.includes('dolly') ? UPGRADES.dolly.carry : BASE_CARRY;
}

/* ---------- Estatísticas ---------- */
/** Últimos 30 relatórios de dia (closeDay acrescenta). */
export function dayHistory(state: StoreState): DayReport[] { return state.history.map((r) => ({ ...r })); }
/** Ranking por lucro dos últimos `days` dias (default 7; máx. 30): dias fechados + o dia em andamento. */
export function topProducts(state: StoreState, days = 7): { productId: string; units: number; revenue: Cents; profit: Cents }[] {
  const from = state.day - Math.max(1, Math.min(30, Math.round(days)));
  const acc = new Map<string, { productId: string; units: number; revenue: Cents; profit: Cents }>();
  for (const e of state.stats) {
    if (e.day < from) continue;
    for (const [productId, [units, revenue, profit]] of Object.entries(e.p)) {
      const r = acc.get(productId) ?? { productId, units: 0, revenue: 0, profit: 0 };
      r.units += units;
      r.revenue += revenue;
      r.profit += profit;
      acc.set(productId, r);
    }
  }
  return [...acc.values()].sort((a, b) => b.profit - a.profit || b.units - a.units);
}

/* =====================================================================
 * FASE 3 — assinaturas CONGELADAS (o agente `sim` implementa; demais programam contra elas).
 * StoreState ganhou (defaults em newGame + migração em deserialize): furnitureStock; Box.open; Ledger.happy/angry.
 * UpgradeId ganhou 'tipjar' | 'capacity'. Adições: canDropBox (validação da prévia de caixa), setBoxOpen (adendo).
 * ===================================================================== */

/** Linha do carrinho do Mercado. produto: id do catálogo, qty = nº de CAIXAS. móvel: id = FurnitureType, qty = unidades. */
export interface CartLine { kind: 'product' | 'furniture'; id: string; qty: number; variant?: string }

const FURNITURE_TYPES: readonly FurnitureType[] = ['shelf', 'fridge', 'freezer', 'counter', 'rack', 'decor'];
const asFurnitureType = (id: string): FurnitureType => {
  const t = FURNITURE_TYPES.find((x) => x === id);
  if (!t) throw new Error('Tipo de móvel desconhecido');
  return t;
};
const decorItemOf = (variant: string | undefined) => (variant === undefined ? undefined : DECOR_ITEMS.find((d) => d.id === variant));

/** Valida a linha (tipo, id, quantidade inteira >= 0) e devolve o custo a preço de hoje. Linhas com qty 0 custam 0. */
function cartLineCost(state: StoreState, l: CartLine): Cents {
  if (typeof l !== 'object' || l === null) throw new Error('Item do carrinho inválido');
  if (!Number.isInteger(l.qty) || l.qty < 0) throw new Error('Quantidade inválida');
  if (l.kind === 'product') {
    const p = productById(l.id);
    return wholesale(state, p.id) * p.boxSize * l.qty;
  }
  if (l.kind === 'furniture') {
    const type = asFurnitureType(l.id);
    return furnitureCost(type, type === 'decor' ? l.variant : undefined) * l.qty;
  }
  throw new Error('Item do carrinho inválido');
}

/** Total do carrinho a preço de hoje (produtos: caixas × boxSize × atacado; móveis: custo do catálogo). */
export function cartTotal(state: StoreState, lines: CartLine[]): Cents {
  return lines.reduce((a, l) => a + cartLineCost(state, l), 0);
}
/**
 * Compra atômica (tudo ou nada; valida licença, nível e dinheiro). Produtos viram caixas na calçada
 * (entrega instantânea); móveis vão para o estoque de montagem (`furnitureStock`), montados depois em 1ª pessoa.
 * Também recusa: carrinho vazio, calçada sem espaço para as caixas (SIDEWALK_MAX_BOXES) e estante sem depósito.
 * Caixas chegam FECHADAS; `variant` só vale para decoração (preço/nível da variante, como buyFurniture).
 */
export function checkoutCart(state: StoreState, lines: CartLine[]): { cost: Cents; boxes: number; furniture: number } {
  if (!Array.isArray(lines)) throw new Error('Carrinho inválido');
  // 1) valida tudo antes de mudar qualquer coisa
  let cost = 0;
  let furnitureCostSum = 0;
  let boxes = 0;
  let furniture = 0;
  for (const l of lines) {
    const c = cartLineCost(state, l);
    cost += c;
    if (l.qty === 0) continue;
    if (l.kind === 'product') {
      const p = productById(l.id);
      if (!state.licenses.includes(p.category)) throw new Error(`${p.name}: categoria não licenciada`);
      boxes += l.qty;
    } else {
      const type = asFurnitureType(l.id);
      const spec = specOf(type);
      const minLevel = Math.max(spec.minLevel, type === 'decor' ? decorItemOf(l.variant)?.minLevel ?? 0 : 0);
      if (state.level < minLevel) throw new Error(`${spec.name}: requer nível ${minLevel}`);
      if (type === 'rack' && !state.storageUnlocked) throw new Error('Desbloqueie o depósito antes de comprar estantes');
      furniture += l.qty;
      furnitureCostSum += c;
    }
  }
  if (boxes + furniture === 0) throw new Error('Carrinho vazio');
  if (boxes > 0 && state.sidewalk.length + boxes > SIDEWALK_MAX_BOXES) {
    throw new Error('Calçada cheia: guarde ou reponha as caixas antes de pedir mais');
  }
  if (state.money < cost) throw new Error('Dinheiro insuficiente');
  // 2) aplica (cada passo já foi validado: não lança)
  for (const l of lines) {
    if (l.qty === 0) continue;
    if (l.kind === 'product') {
      buyBoxes(state, l.id, l.qty);
    } else {
      const type = asFurnitureType(l.id);
      const item: StockedFurniture = type === 'decor' && l.variant !== undefined ? { type, variant: l.variant } : { type };
      for (let i = 0; i < l.qty; i++) state.furnitureStock.push({ ...item });
    }
  }
  state.money -= furnitureCostSum;
  return { cost, boxes, furniture };
}
export interface StockedFurniture { type: FurnitureType; variant?: string }
/** Cópia do estoque de montagem (índices = os de placeFromStock / build:start {stockIndex}). */
export function furnitureStock(state: StoreState): StockedFurniture[] { return state.furnitureStock.map((f) => ({ ...f })); }
/** Monta um móvel do estoque (sem cobrar de novo). Mesma validação de canPlace. Remove do estoque. */
export function placeFromStock(state: StoreState, index: number, x: number, z: number, rot: 0 | 90 | 180 | 270, productId?: string): Furniture {
  const item = Number.isInteger(index) ? state.furnitureStock[index] : undefined;
  if (!item) throw new Error('Móvel inexistente no estoque');
  if (!canPlaceImpl(state, item.type, x, z, rot)) throw new Error('Posição inválida');
  if (productId !== undefined && isDisplay(item.type)) checkAssign(state, item.type, productId);
  state.furnitureStock.splice(index, 1);
  const f: Furniture = { id: state.nextFurnitureId++, type: item.type, x, z, rot };
  // Fase 4: níveis vazios sem etiqueta (com `productId`, todos etiquetados com ele)
  if (isDisplay(item.type)) f.levels = emptyLevels(item.type, productId);
  if (item.variant !== undefined) f.variant = item.variant;
  state.furniture.push(f);
  reconcile(state);
  return f;
}
/** Desmonta um móvel montado de volta para o estoque (alternativa a vender); estoque exposto vai para depósito/calçada. */
export function storeFurniture(state: StoreState, id: number): void {
  const f = removeFurniture(state, id, 'Esvazie o depósito antes de desmontar a estante');
  state.furnitureStock.push(f.variant !== undefined ? { type: f.type, variant: f.variant } : { type: f.type });
}

/**
 * Ponto (metros, contínuo) onde uma caixa pode ficar no chão: salão, vão da porta, calçada (z de depth a
 * depth + SIDEWALK_DEPTH, até DROP.sidewalkSide m para os lados da fachada) e, com depósito, a sala de estoque e a
 * passagem. Mantém DROP.wallMargin das paredes. Não checa móveis (o world ajusta a prévia).
 */
export function canDropBox(state: StoreState, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const b = storeBounds(state.expansion);
  const m = DROP.wallMargin;
  const inX = x >= m && x <= b.width - m;
  if (inX && z >= m && z <= b.depth - m) return true; // salão
  const dx = doorX(b);
  if (x >= dx - DOOR_WIDTH / 2 + m && x <= dx + DOOR_WIDTH / 2 - m && z >= b.depth - m && z <= b.depth + m) return true; // porta
  if (x >= -DROP.sidewalkSide && x <= b.width + DROP.sidewalkSide && z >= b.depth + m && z <= b.depth + SIDEWALK_DEPTH - m) return true; // calçada
  if (state.storageUnlocked) {
    if (inX && z >= -STORAGE_DEPTH + m && z <= -m) return true; // depósito
    const pass = storagePassage(state.expansion);
    if (x >= pass.x0 + m && x <= pass.x1 - m && z >= -m && z <= m) return true; // passagem salão ↔ depósito
  }
  return false;
}
/** Larga a caixa no chão (metros, posição livre): carried=false, define x/z/rot. Valida ponto caminhável (loja, depósito ou calçada). */
export function dropBox(state: StoreState, boxIndex: number, x: number, z: number, rot?: number): void {
  const box = boxAt(state, boxIndex);
  if (!canDropBox(state, x, z)) throw new Error('Não dá para largar a caixa aí');
  box.carried = false;
  box.x = x;
  box.z = z;
  if (rot !== undefined && Number.isFinite(rot)) {
    const tau = Math.PI * 2;
    box.rot = ((rot % tau) + tau) % tau;
  }
}
/** Abre/fecha a caixa (só muda o flag `open`; repor não exige caixa aberta na sim — quem exige é o player). */
export function setBoxOpen(state: StoreState, boxIndex: number, open: boolean): void {
  const box = boxAt(state, boxIndex);
  if (typeof open !== 'boolean') throw new Error('Valor inválido');
  box.open = open;
}
/** Máximo de clientes simultâneos (cresce com expansão e com a melhoria 'capacity'). O npc usa como limite. */
export function customerCapacity(state: StoreState): number {
  const e = clamp(Math.floor(Number.isFinite(state.expansion) ? state.expansion : 0), 0, MAX_EXPANSION);
  return CUSTOMER_CAPACITY.base + CUSTOMER_CAPACITY.perExpansion * e + (state.upgrades.includes('capacity') ? UPGRADES.capacity.extra : 0);
}
/** Tipo de móvel que expõe o produto (para o ícone "móvel exigido" no Mercado). */
export function furnitureForProduct(productId: string): FurnitureType { return displayTypeFor(productById(productId).category); }

/* =====================================================================
 * FASE 4 — níveis independentes por móvel; preço sugerido. Assinaturas CONGELADAS (o agente `sim` implementa).
 * Fonte da verdade do estoque exposto: Furniture.levels. state.shelf[produto] e state.slots viram DERIVADOS
 * (o sim recalcula após cada mutação) e continuam válidos para leitura por ui/npc/world.
 * ===================================================================== */
export type LevelCheck = 'ok' | 'other-product' | 'not-accepted' | 'full' | 'box-empty' | 'box-closed';

/** Nível `level` do móvel (lança 'Nível inexistente' fora de 0..níveis−1). */
function levelOf(f: Furniture, level: number): ShelfLevel {
  const l = Number.isInteger(level) ? f.levels?.[level] : undefined;
  if (!l) throw new Error('Nível inexistente');
  return l;
}
/** Expositor com níveis (lança para balcão/estante/decoração). */
function displayOf(state: StoreState, furnitureId: number): Furniture & { levels: ShelfLevel[] } {
  const f = furnitureById(state, furnitureId);
  if (!f.levels) throw new Error('Este móvel não expõe produtos');
  return f as Furniture & { levels: ShelfLevel[] };
}
const notAcceptedMsg = (f: Furniture, name: string): string => `${name} não cabe em ${DISPLAY_NAMES[f.type] ?? 'este móvel'}`;

/** Níveis do móvel (cópia somente leitura; vazio para tipos sem níveis). Móvel inexistente lança. */
export function furnitureLevels(state: StoreState, furnitureId: number): ShelfLevel[] {
  return (furnitureById(state, furnitureId).levels ?? []).map((l) => ({ ...l }));
}
/**
 * Unidades que cabem no nível (capacidade TOTAL, não o espaço livre) para o produto: o do nível, ou `productId` se
 * informado. 0 se o nível não tem etiqueta (e nenhum `productId`) ou se o móvel não aceita a categoria.
 */
export function levelCapacity(state: StoreState, furnitureId: number, level: number, productId?: string): number {
  const f = displayOf(state, furnitureId);
  const pid = productId ?? levelOf(f, level).productId;
  if (productId !== undefined) levelOf(f, level); // valida o índice mesmo com productId
  if (pid === undefined) return 0;
  const p = productById(pid);
  return acceptsProduct(f, p) ? p.slotCapacity : 0;
}
/**
 * Pode repor a caixa `boxIndex` no nível? Precedência: 'box-empty' (caixa sem unidades — o player oferece Retirar se o
 * nível tem unidades) → 'not-accepted' (móvel sem níveis ou categoria recusada) → 'other-product' (nível com OUTRO
 * produto e unidades) → 'full' (mesmo produto, nível cheio) → 'box-closed' (todo o resto ok, falta abrir a caixa) → 'ok'.
 * Caixa/móvel/nível inexistentes lançam.
 */
export function canStockLevel(state: StoreState, boxIndex: number, furnitureId: number, level: number): LevelCheck {
  const box = boxAt(state, boxIndex);
  const f = furnitureById(state, furnitureId);
  if (box.units <= 0) {
    if (f.levels) levelOf(f, level);
    return 'box-empty';
  }
  if (!f.levels) return 'not-accepted';
  const l = levelOf(f, level);
  const p = productById(box.productId);
  if (!acceptsProduct(f, p)) return 'not-accepted';
  if (l.productId !== undefined && l.productId !== p.id && l.units > 0) return 'other-product';
  if (l.productId === p.id && l.units >= p.slotCapacity) return 'full';
  if (box.open !== true) return 'box-closed';
  return 'ok';
}
/**
 * Move até n unidades da caixa para o nível. Nível sem produto (ou com outro produto e 0 un.) passa a ser do produto
 * da caixa. Retorna movidas (0 = caixa vazia ou nível cheio). Lança: categoria recusada, nível com outro produto e
 * unidades, quantidade inválida, caixa/móvel/nível inexistentes. Não exige caixa aberta (quem exige é o player).
 */
export function placeUnitsInLevel(state: StoreState, boxIndex: number, furnitureId: number, level: number, n: number): number {
  const box = boxAt(state, boxIndex);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Quantidade inválida');
  const f = displayOf(state, furnitureId);
  const l = levelOf(f, level);
  const p = productById(box.productId);
  if (!acceptsProduct(f, p)) throw new Error(notAcceptedMsg(f, p.name));
  const same = l.productId === p.id;
  if (!same && l.productId !== undefined && l.units > 0) throw new Error('Este nível tem outro produto');
  const have = same ? l.units : 0;
  const moved = Math.min(n, box.units, p.slotCapacity - have);
  if (moved <= 0) return 0;
  l.productId = p.id;
  l.units = have + moved;
  box.units -= moved;
  syncShelf(state);
  return moved;
}
/**
 * Puxa até n unidades do nível para a caixa: caixa vazia passa a ser do produto do nível; caixa do mesmo produto recebe
 * até boxSize. O nível mantém a etiqueta (com 0 un. aceita outro produto). Retorna movidas (0 = nível vazio ou caixa
 * cheia). Lança: caixa com unidades de outro produto, quantidade inválida, caixa/móvel/nível inexistentes.
 * O custo médio (costBasis) não muda: as unidades continuam do mesmo produto.
 */
export function pullUnitsFromLevel(state: StoreState, boxIndex: number, furnitureId: number, level: number, n: number): number {
  const box = boxAt(state, boxIndex);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Quantidade inválida');
  const l = levelOf(displayOf(state, furnitureId), level);
  if (l.productId === undefined || l.units <= 0) return 0;
  if (box.units > 0 && box.productId !== l.productId) throw new Error('A caixa tem outro produto');
  const p = productById(l.productId);
  const inBox = Math.max(0, box.units);
  const moved = Math.min(n, l.units, p.boxSize - inBox);
  if (moved <= 0) return 0;
  box.productId = p.id;
  box.units = inBox + moved;
  l.units -= moved;
  syncShelf(state);
  return moved;
}
/**
 * Cliente retira do nível (unidades do produto ATUAL do nível: confira `furnitureLevels(...)[level].productId` ou o
 * resultado de `locateProduct`). Retorna qtd retirada; 0 para qtd inválida ou móvel/nível que não existe mais.
 */
export function takeFromLevel(state: StoreState, furnitureId: number, level: number, qty: number): number {
  if (!Number.isInteger(qty) || qty <= 0 || !Number.isInteger(level)) return 0;
  const l = state.furniture.find((f) => f.id === furnitureId)?.levels?.[level];
  if (!l || l.productId === undefined || l.units <= 0) return 0;
  const n = Math.min(qty, l.units);
  l.units -= n;
  syncShelf(state);
  return n;
}
/** Onde o produto está exposto (níveis com etiqueta do produto, com ou sem unidades), na ordem dos móveis e níveis. */
export function locateProduct(state: StoreState, productId: string): { furnitureId: number; level: number; units: number }[] {
  const out: { furnitureId: number; level: number; units: number }[] = [];
  for (const f of state.furniture) {
    (f.levels ?? []).forEach((l, level) => {
      if (l.productId === productId) out.push({ furnitureId: f.id, level, units: l.units });
    });
  }
  return out;
}
// suggestedPrice (seção de preços, acima) na FASE 4 é a MÉDIA DE MERCADO (×1,00), não +12%.
