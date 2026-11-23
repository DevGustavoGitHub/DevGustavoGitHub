/**
 * FASE 4 — níveis independentes dos expositores (shelf/fridge/freezer). Cada nível tem produto (etiqueta) e unidades
 * próprios; capacidade do nível = `slotCapacity` do produto; nº de níveis = `FurnitureSpec.slots` do tipo.
 *
 * `Furniture.levels` é a FONTE DA VERDADE do estoque exposto. São DERIVADOS (recalculados por `syncShelf`, que toda
 * mutação da sim chama no fim, direto ou via `reconcile`):
 * - `state.shelf[produto]` = soma das unidades dos níveis com a etiqueta do produto;
 * - `state.slots[produto]` = nº de níveis com a etiqueta (com ou sem unidades);
 * - `Furniture.productId` = etiqueta do 1º nível etiquetado (só compatibilidade; ausente se nenhum nível tem etiqueta).
 * Escrever nesses derivados não tem efeito: o próximo `syncShelf` os sobrescreve.
 */
import type { FurnitureType } from '../core/layout';
import { PRODUCTS, productById, type Product } from './catalog';
import { isDisplay, specOf, storageCapacity, storageUsed } from './furniture';
import type { Furniture, ShelfLevel, StoreState } from './state';

const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Nº de níveis do tipo: `FurnitureSpec.slots` para shelf/fridge/freezer, 0 para os demais. */
export const levelCount = (type: FurnitureType): number => (isDisplay(type) ? specOf(type).slots : 0);

/** Níveis vazios para um móvel novo (com etiqueta `productId` em todos, se informado). */
export function emptyLevels(type: FurnitureType, productId?: string): ShelfLevel[] {
  return Array.from({ length: levelCount(type) }, (): ShelfLevel => (productId === undefined ? { units: 0 } : { productId, units: 0 }));
}

/** O móvel expõe a categoria do produto (FurnitureSpec.categories)? */
export const acceptsProduct = (f: { type: FurnitureType }, p: Product): boolean =>
  isDisplay(f.type) && specOf(f.type).categories.includes(p.category);

/** Recalcula os derivados (`state.shelf`, `state.slots`, `Furniture.productId`) a partir dos níveis. */
export function syncShelf(state: StoreState): void {
  // muta no lugar, sem alocar (roda a cada unidade movida; quem guardou a referência continua vendo valores atuais)
  if (typeof state.slots !== 'object' || state.slots === null) state.slots = {};
  if (typeof state.shelf !== 'object' || state.shelf === null) state.shelf = {};
  const { slots, shelf } = state;
  for (const p of PRODUCTS) {
    slots[p.id] = 0;
    shelf[p.id] = 0;
  }
  for (const f of state.furniture) {
    if (!f.levels) continue;
    let main: string | undefined;
    for (const l of f.levels) {
      const id = l.productId;
      if (id === undefined) continue;
      if (main === undefined) main = id;
      slots[id] = (slots[id] ?? 0) + 1;
      shelf[id] = (shelf[id] ?? 0) + l.units;
    }
    if (main === undefined) {
      if (f.productId !== undefined) delete f.productId;
    } else f.productId = main;
  }
}

/** Remove de shelf/slots chaves de produtos que não existem mais no catálogo (saves antigos). */
function pruneDerived(state: StoreState): void {
  for (const rec of [state.slots, state.shelf]) {
    if (typeof rec !== 'object' || rec === null) continue;
    for (const k of Object.keys(rec)) if (!PRODUCT_BY_ID.has(k)) delete rec[k];
  }
}

/** Devolve unidades que saíram da exposição: depósito (se desbloqueado e couber) ou caixas fechadas na calçada. */
export function returnUnits(state: StoreState, productId: string, units: number): void {
  if (units <= 0) return;
  const p = productById(productId);
  const stored = state.storage[p.id] ?? 0;
  const extraBoxes = Math.ceil((stored + units) / p.boxSize) - Math.ceil(stored / p.boxSize);
  if (state.storageUnlocked && storageUsed(state) + extraBoxes <= storageCapacity(state)) {
    state.storage[p.id] = stored + units;
    return;
  }
  for (let rest = units; rest > 0; ) {
    const n = Math.min(p.boxSize, rest);
    state.sidewalk.push({ productId: p.id, units: n, open: false });
    rest -= n;
  }
}

/** Nível livre para qualquer produto aceito: sem etiqueta e sem unidades. */
const isFree = (l: ShelfLevel): boolean => l.productId === undefined && l.units <= 0;

/**
 * Põe até `n` unidades do produto na exposição: primeiro nos níveis com a etiqueta dele (na ordem dos móveis e dos
 * níveis), depois em níveis livres (sem etiqueta) de móveis que aceitam a categoria — que passam a ter a etiqueta.
 * Retorna quantas couberam (o resto continua com quem chamou).
 */
export function stockProduct(state: StoreState, productId: string, n: number): number {
  const p = productById(productId);
  let left = Math.max(0, Math.floor(n));
  for (const f of state.furniture) {
    for (const l of f.levels ?? []) {
      if (left <= 0) break;
      if (l.productId !== p.id) continue;
      const k = Math.min(left, p.slotCapacity - l.units);
      if (k > 0) { l.units += k; left -= k; }
    }
  }
  for (const f of state.furniture) {
    if (left <= 0) break;
    if (!f.levels || !acceptsProduct(f, p)) continue;
    for (const l of f.levels) {
      if (left <= 0) break;
      if (!isFree(l)) continue;
      const k = Math.min(left, p.slotCapacity);
      l.productId = p.id;
      l.units = k;
      left -= k;
    }
  }
  syncShelf(state);
  return Math.max(0, Math.floor(n)) - left;
}

/** Retira até `n` unidades do produto da exposição, sempre do nível mais cheio. Retorna quantas saíram. */
export function unstockProduct(state: StoreState, productId: string, n: number): number {
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    let best: ShelfLevel | undefined;
    for (const f of state.furniture) {
      for (const l of f.levels ?? []) if (l.productId === productId && l.units > 0 && (!best || l.units > best.units)) best = l;
    }
    if (!best) break;
    const k = Math.min(left, best.units);
    best.units -= k;
    left -= k;
  }
  syncShelf(state);
  return Math.max(0, Math.floor(n)) - left;
}

/** Há onde expor o produto? (algum nível com a etiqueta dele, ou nível livre num móvel que aceite a categoria) */
export function canDisplay(state: StoreState, productId: string): boolean {
  const p = productById(productId);
  return state.furniture.some((f) => (f.levels ?? []).some((l) => l.productId === p.id || (isFree(l) && acceptsProduct(f, p))));
}

/** Capacidade de exposição do produto = nº de níveis com a etiqueta dele × slotCapacity. */
export function productCapacity(state: StoreState, productId: string): number {
  let levels = 0;
  for (const f of state.furniture) for (const l of f.levels ?? []) if (l.productId === productId) levels++;
  return levels * productById(productId).slotCapacity;
}

/**
 * Saneia os níveis de um móvel: expositor sem `levels` ganha níveis vazios (etiqueta = `productId` legado, se aceito);
 * número de níveis = o do tipo; etiqueta desconhecida/não aceita é removida e unidades acima da capacidade (ou de
 * níveis removidos) voltam ao depósito/calçada. Tipos sem níveis perdem o campo.
 */
function normalizeFurniture(state: StoreState, f: Furniture): void {
  if (!isDisplay(f.type)) {
    if (f.levels !== undefined) delete f.levels;
    return;
  }
  if (!Array.isArray(f.levels)) {
    const legacy = typeof f.productId === 'string' ? PRODUCT_BY_ID.get(f.productId) : undefined;
    f.levels = emptyLevels(f.type, legacy && acceptsProduct(f, legacy) ? legacy.id : undefined);
  }
  const levels = f.levels;
  const want = levelCount(f.type);
  for (let i = 0; i < Math.max(want, levels.length); i++) {
    const raw: unknown = levels[i];
    const l = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ShelfLevel>;
    const p = typeof l.productId === 'string' ? PRODUCT_BY_ID.get(l.productId) : undefined;
    const units = whole(l.units);
    if (i >= want || !p || !acceptsProduct(f, p)) {
      if (p && units > 0) returnUnits(state, p.id, units);
      levels[i] = { units: 0 };
      continue;
    }
    if (units > p.slotCapacity) returnUnits(state, p.id, units - p.slotCapacity);
    levels[i] = { productId: p.id, units: Math.min(units, p.slotCapacity) };
  }
  levels.length = want;
}

/**
 * Chamar após qualquer mudança em móveis/níveis: saneia os níveis de todos os móveis (excedentes voltam ao
 * depósito/calçada) e recalcula os derivados (`syncShelf`).
 */
export function reconcile(state: StoreState): void {
  for (const f of state.furniture) normalizeFurniture(state, f);
  pruneDerived(state);
  syncShelf(state);
}

/** Nome antigo (Fase 1–3) do recálculo de `state.slots`; agora recalcula todos os derivados dos níveis. */
export const recomputeSlots = syncShelf;

/**
 * Migração de saves da Fase 3 (um produto por móvel em `Furniture.productId` + estoque exposto SOMADO por produto em
 * `state.shelf`): cada nível do móvel recebe a etiqueta do produto antigo e o total salvo é distribuído enchendo os
 * níveis do produto na ordem dos móveis; o que não couber vai ao depósito/calçada. Saves que já têm níveis só são
 * saneados (`reconcile`).
 */
export function migrateLevels(state: StoreState, oldShelf: unknown, legacy: boolean): void {
  // cópia antes do reconcile: state.shelf pode ser o próprio objeto salvo e syncShelf o sobrescreve no lugar
  const totals: Record<string, unknown> = typeof oldShelf === 'object' && oldShelf !== null ? { ...oldShelf } : {};
  reconcile(state); // cria os níveis que faltam (etiqueta = productId antigo) e saneia
  if (!legacy) return;
  for (const p of PRODUCTS) {
    let left = whole(totals[p.id]);
    for (const f of state.furniture) {
      for (const l of f.levels ?? []) {
        if (left <= 0) break;
        if (l.productId !== p.id) continue;
        const k = Math.min(left, p.slotCapacity - l.units);
        l.units += k;
        left -= k;
      }
    }
    returnUnits(state, p.id, left);
  }
  syncShelf(state);
}
