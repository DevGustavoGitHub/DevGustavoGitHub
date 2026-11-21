import { FURNITURE_FOOTPRINT, storeBounds } from '../core/layout';
import type { Furniture } from '../sim/state';
import * as api from '../sim/api';
import { shelfCapacity } from '../sim/economy';
import { type Env, dist2, safe } from './shared';

export function footprint(f: Furniture): { w: number; d: number } {
  const fp = FURNITURE_FOOTPRINT[f.type];
  return f.rot === 90 || f.rot === 270 ? { w: fp.d, d: fp.w } : fp;
}

/** Móvel de exposição (shelf/fridge/freezer) mais próximo que expõe o produto; null se nenhum. */
export function furnitureFor(env: Env, productId: string, x: number, z: number): Furniture | null {
  let best: Furniture | null = null;
  let bd = Infinity;
  const list = env.ctx.state.furniture;
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    if (f.productId !== productId || (f.type !== 'shelf' && f.type !== 'fridge' && f.type !== 'freezer')) continue;
    const fp = footprint(f);
    const d = dist2(x, z, f.x + fp.w / 2, f.z + fp.d / 2);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
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
