import { PRODUCTS } from '../sim/catalog';
import { syncShelf } from '../sim/levels';
import { FURNITURE_FOOTPRINT, storeBounds } from '../core/layout';
import type { Furniture, StoreState } from '../sim/state';
import * as api from '../sim/api';
import { productById } from '../sim/catalog';
import { shelfCapacity } from '../sim/economy';
import { type Env, dist2, safe } from './shared';

export function footprint(f: Furniture): { w: number; d: number } {
  const fp = FURNITURE_FOOTPRINT[f.type];
  return f.rot === 90 || f.rot === 270 ? { w: fp.d, d: fp.w } : fp;
}

const isDisplay = (f: Furniture): boolean => f.type === 'shelf' || f.type === 'fridge' || f.type === 'freezer';

/** O móvel expõe o produto? Fase 4: algum nível com a etiqueta; sem níveis (save/sim antigos): Furniture.productId. */
export function exposes(f: Furniture, productId: string): boolean {
  const lv = f.levels;
  if (lv && lv.length > 0) { for (let i = 0; i < lv.length; i++) if (lv[i]!.productId === productId) return true; return false; }
  return f.productId === productId;
}

/** Móvel de exposição (shelf/fridge/freezer) mais próximo que expõe o produto; null se nenhum. */
export function furnitureFor(env: Env, productId: string, x: number, z: number): Furniture | null {
  let best: Furniture | null = null;
  let bd = Infinity;
  const list = env.ctx.state.furniture;
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    if (!isDisplay(f) || !exposes(f, productId)) continue;
    const fp = footprint(f);
    const d = dist2(x, z, f.x + fp.w / 2, f.z + fp.d / 2);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/**
 * Espaço livre nos níveis do móvel ETIQUETADOS com o produto (o repositor não troca etiquetas do jogador).
 * -1 = sem níveis/API (usar placeUnits + shelfRoom).
 */
export function levelRoom(env: Env, f: Furniture, productId: string): number {
  const lv = f.levels;
  if (!lv || lv.length === 0) return -1;
  let room = 0;
  for (let i = 0; i < lv.length; i++) {
    const l = lv[i]!;
    if (l.productId !== productId) continue;
    const cap = safe('levelCapacity', () => api.levelCapacity(env.ctx.state, f.id, i), -1);
    if (cap < 0) return -1;
    room += Math.max(0, cap - l.units);
  }
  return room;
}

/** Móvel mais próximo com espaço nos níveis do produto (sem API de níveis: o mais próximo que expõe o produto). */
export function furnitureWithRoom(env: Env, productId: string, x: number, z: number): Furniture | null {
  let best: Furniture | null = null;
  let bd = Infinity;
  const list = env.ctx.state.furniture;
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    if (!isDisplay(f) || !exposes(f, productId)) continue;
    const room = levelRoom(env, f, productId);
    if (room === 0 || (room < 0 && shelfRoom(env, productId) <= 0)) continue;
    const fp = footprint(f);
    const d = dist2(x, z, f.x + fp.w / 2, f.z + fp.d / 2);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/**
 * Repositor: põe as unidades da caixa nos níveis etiquetados do produto NESTE móvel (api.placeUnitsInLevel).
 * Retorna as movidas; -1 = sem níveis/API (o chamador usa placeUnits).
 */
export function stockLevelsHere(env: Env, boxIndex: number, f: Furniture, productId: string): number {
  const lv = f.levels;
  if (!lv || lv.length === 0) return -1;
  const { state } = env.ctx;
  let moved = 0;
  for (let i = 0; i < lv.length; i++) {
    const box = state.sidewalk[boxIndex];
    if (!box || box.units <= 0) break;
    if (lv[i]!.productId !== productId) continue;
    const r = safe('placeUnitsInLevel', () => api.placeUnitsInLevel(state, boxIndex, f.id, i, box.units), -1);
    if (r < 0) return moved > 0 ? moved : -1;
    moved += r;
  }
  return moved;
}

export interface Spot { furnitureId: number; level: number; units: number }
/** FASE 4: níveis com a etiqueta do produto (api.locateProduct); null = API de níveis indisponível (usar takeFromShelf). */
export function locate(env: Env, productId: string): Spot[] | null {
  return safe<Spot[] | null>('locateProduct', () => api.locateProduct(env.ctx.state, productId), null);
}

/**
 * Debug/teste (`__npc.stock`): põe `n` unidades (limitado à capacidade) em cada nível etiquetado — ou no produto legado
 * do móvel — e recalcula o derivado `state.shelf`. Com `productId`, só os níveis desse produto. Nunca usado pela IA.
 */
export function stockForTest(state: StoreState, n: number, productId?: string): number {
  const sums: Record<string, number> = {};
  let total = 0;
  for (const f of state.furniture) {
    if (!isDisplay(f)) continue;
    const lv = f.levels;
    if (!lv || lv.length === 0) {
      if (f.productId && (!productId || f.productId === productId)) { state.shelf[f.productId] = n; total += n; }
      continue;
    }
    for (let i = 0; i < lv.length; i++) {
      const l = lv[i]!;
      // Níveis sem produto (prateleiras iniciais vêm vazias desde o pós-teste): escolhe um produto licenciado
      // aceito pelo móvel, em rodízio por nível, para o gancho de teste conseguir abastecer.
      const pid = l.productId ?? (i === 0 ? f.productId : undefined) ?? productId ?? fallbackProduct(state, f.type, i);
      if (!pid) continue;
      if (!productId || pid === productId) {
        const cap = safe('levelCapacity', () => api.levelCapacity(state, f.id, i, pid), safe('slotCapacity', () => productById(pid).slotCapacity, n));
        l.productId = pid;
        l.units = Math.max(0, Math.min(n, cap));
        total += l.units;
      }
      sums[pid] = (sums[pid] ?? 0) + l.units;
    }
  }
  // níveis com níveis (Fase 4): recalcula TODO o derivado (shelf + slots + f.productId); slots > 0 é o que põe o produto
  // na lista de compras (makeShoppingList), então só somar shelf deixava os clientes sem nada para comprar
  if (state.furniture.some((f) => f.levels && f.levels.length > 0)) safe('syncShelf', () => { syncShelf(state); return true; }, false);
  for (const pid of Object.keys(sums)) state.shelf[pid] = sums[pid]!;
  return total;
}

/** Sorteia sujeira na posição (dentro do salão, com teto de manchas). */
export function maybeDirt(env: Env, x: number, z: number, chance: number): void {
  const { state, rand } = env.ctx;
  if (rand() >= chance || state.dirt.length >= 10) return;
  const b = storeBounds(state.expansion);
  if (x < 0.8 || x > b.width - 0.8 || z < 0.8 || z > b.depth - 1.2) return;
  if (!env.world().isWalkable(x, z)) return;
  if (safe('addDirt', () => { api.addDirt(state, x, z); return true; }, false)) env.changed('dirt');
}

/** Capacidade de prateleira do produto (api com fallback para o cálculo direto). */
export function shelfRoom(env: Env, productId: string): number {
  const { state } = env.ctx;
  const cap = safe('productCapacity', () => api.productCapacity(state, productId), -1);
  const capacity = cap >= 0 ? cap : safe('shelfCapacity', () => shelfCapacity(state, productId), 0);
  return capacity - (state.shelf[productId] ?? 0);
}

/** Produto licenciado aceito pelo tipo de móvel (rodízio por índice) — só para o gancho de teste `__npc.stock`. */
function fallbackProduct(state: StoreState, type: string, i: number): string | undefined {
  let cats: string[] = [];
  try { cats = api.furnitureCatalog().find((s) => s.type === type)?.categories ?? []; } catch { /* sim antiga */ }
  const pool = PRODUCTS.filter((p) => state.licenses.includes(p.category) && (cats.length === 0 || cats.includes(p.category)));
  return pool.length ? pool[i % pool.length]!.id : undefined;
}
