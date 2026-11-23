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
      const pid = l.productId ?? (i === 0 ? f.productId : undefined);
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
