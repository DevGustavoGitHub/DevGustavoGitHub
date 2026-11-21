/** Regras de móveis: catálogo, colisão, caminho livre, capacidade. api.ts expõe estas funções. */
import { FURNITURE_FOOTPRINT, STORAGE_DEPTH, doorX, storeBounds, type FurnitureType } from '../core/layout';
import type { FurnitureSpec } from './api';
import { PRODUCTS, productById } from './catalog';
import { STORAGE } from './tuning';
import type { Furniture, StoreState } from './state';

export type Rot = 0 | 90 | 180 | 270;

const CATALOG: FurnitureSpec[] = [
  { type: 'shelf', name: 'Prateleira', cost: 35000, minLevel: 1, slots: 2, categories: ['mercearia', 'limpeza', 'padaria'] },
  { type: 'fridge', name: 'Geladeira', cost: 90000, minLevel: 3, slots: 3, categories: ['bebidas', 'laticinios'] },
  { type: 'freezer', name: 'Freezer', cost: 180000, minLevel: 10, slots: 3, categories: ['congelados'] },
  { type: 'counter', name: 'Caixa registradora', cost: 120000, minLevel: 3, slots: 0, categories: [] },
  /** rack: `slots` = nº de caixas que a estante guarda no depósito. */
  { type: 'rack', name: 'Estante do depósito', cost: 60000, minLevel: 3, slots: STORAGE.rackBoxes, categories: [] },
  { type: 'decor', name: 'Decoração', cost: 8000, minLevel: 1, slots: 0, categories: [] },
];

export const furnitureCatalog = (): FurnitureSpec[] => CATALOG.map((s) => ({ ...s, categories: [...s.categories] }));

export function specOf(type: FurnitureType): FurnitureSpec {
  const s = CATALOG.find((c) => c.type === type);
  if (!s) throw new Error('Tipo de móvel desconhecido');
  return s;
}

export const isDisplay = (t: FurnitureType): boolean => t === 'shelf' || t === 'fridge' || t === 'freezer';

export function footprintOf(type: FurnitureType, rot: Rot): { w: number; d: number } {
  const f = FURNITURE_FOOTPRINT[type];
  return rot === 90 || rot === 270 ? { w: f.d, d: f.w } : { w: f.w, d: f.d };
}

/** Abertura (2 tiles) entre o salão e a sala de estoque, alinhada à porta: x em [x0, x1). */
export function storagePassage(expansion: number): { x0: number; x1: number } {
  const dx = doorX(storeBounds(expansion));
  return { x0: dx - 1, x1: dx + 1 };
}

/* ---------- capacidade ---------- */

export function recomputeSlots(state: StoreState): void {
  for (const p of PRODUCTS) state.slots[p.id] = 0;
  for (const f of state.furniture) {
    if (!f.productId || !isDisplay(f.type)) continue;
    state.slots[f.productId] = (state.slots[f.productId] ?? 0) + specOf(f.type).slots;
  }
}

export function productCapacity(state: StoreState, productId: string): number {
  const slots = state.furniture.reduce(
    (a, f) => (f.productId === productId && isDisplay(f.type) ? a + specOf(f.type).slots : a),
    0,
  );
  return slots * productById(productId).slotCapacity;
}

export function storageCapacity(state: StoreState): number {
  if (!state.storageUnlocked) return 0;
  return STORAGE.baseBoxes + state.furniture.reduce((a, f) => (f.type === 'rack' ? a + specOf('rack').slots : a), 0);
}

export function storageUsed(state: StoreState): number {
  let n = 0;
  for (const [id, units] of Object.entries(state.storage)) if (units > 0) n += Math.ceil(units / productById(id).boxSize);
  return n;
}

/**
 * Chamar após qualquer mudança em móveis/atribuições: recalcula state.slots e devolve o excedente exposto
 * (unidades acima da nova capacidade) para o depósito (se couber) ou para caixas na calçada.
 */
export function reconcile(state: StoreState): void {
  recomputeSlots(state);
  for (const p of PRODUCTS) {
    const have = state.shelf[p.id] ?? 0;
    const cap = productCapacity(state, p.id);
    if (have <= cap) continue;
    const excess = have - cap;
    state.shelf[p.id] = cap;
    const stored = state.storage[p.id] ?? 0;
    const extraBoxes = Math.ceil((stored + excess) / p.boxSize) - Math.ceil(stored / p.boxSize);
    if (state.storageUnlocked && storageUsed(state) + extraBoxes <= storageCapacity(state)) {
      state.storage[p.id] = stored + excess;
    } else {
      let rest = excess;
      while (rest > 0) {
        const n = Math.min(p.boxSize, rest);
        state.sidewalk.push({ productId: p.id, units: n });
        rest -= n;
      }
    }
  }
}

/* ---------- colocação ---------- */

interface Rect { x: number; z: number; w: number; d: number; type: FurnitureType }

const key = (x: number, z: number): number => (z + 64) * 256 + x;

function rectOf(f: { type: FurnitureType; x: number; z: number; rot: Rot }): Rect {
  const { w, d } = footprintOf(f.type, f.rot);
  return { x: f.x, z: f.z, w, d, type: f.type };
}

export function canPlace(state: StoreState, type: FurnitureType, x: number, z: number, rot: Rot, ignoreId?: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return false;
  if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) return false;
  const b = storeBounds(state.expansion);
  const { w, d } = footprintOf(type, rot);
  if (x < 0 || x + w > b.width) return false;
  // região permitida por tipo
  if (type === 'rack') {
    if (!state.storageUnlocked) return false;
    if (z < -STORAGE_DEPTH || z + d > 0) return false;
  } else if (type === 'decor') {
    const inHall = z >= 0 && z + d <= b.depth;
    const inStorage = state.storageUnlocked && z >= -STORAGE_DEPTH && z + d <= 0;
    if (!inHall && !inStorage) return false;
  } else if (z < 0 || z + d > b.depth) return false;

  const others = state.furniture.filter((f) => f.id !== ignoreId).map(rectOf);
  const all: Rect[] = [...others, { x, z, w, d, type }];
  const occ = new Set<number>();
  for (const r of all) {
    for (let i = 0; i < r.w; i++) {
      for (let j = 0; j < r.d; j++) {
        const k = key(r.x + i, r.z + j);
        if (occ.has(k)) return false; // colisão
        occ.add(k);
      }
    }
  }

  // Antessala da porta (2x2 dentro do salão) e passagem do depósito precisam ficar livres.
  const dx = doorX(b);
  const foyer: [number, number][] = [];
  for (const zz of [b.depth - 1, b.depth - 2]) for (const xx of [dx - 1, dx]) foyer.push([xx, zz]);
  const keep = [...foyer];
  const pass = storagePassage(state.expansion);
  if (state.storageUnlocked) for (const zz of [0, -1]) for (let xx = pass.x0; xx < pass.x1; xx++) keep.push([xx, zz]);
  const mine = new Set<number>();
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) mine.add(key(x + i, z + j));
  for (const [xx, zz] of keep) if (mine.has(key(xx, zz))) return false;

  // Alcançabilidade: BFS a partir da porta; todo móvel (exceto decor) precisa de um vizinho livre alcançado.
  const zmin = state.storageUnlocked ? -STORAGE_DEPTH : 0;
  const inArea = (xx: number, zz: number): boolean => xx >= 0 && xx < b.width && zz >= zmin && zz < b.depth;
  const canStep = (x0: number, z0: number, x1: number, z1: number): boolean => {
    if (!inArea(x1, z1)) return false;
    if ((z0 === 0 && z1 === -1) || (z0 === -1 && z1 === 0)) return x0 >= pass.x0 && x0 < pass.x1;
    return true;
  };
  const seen = new Set<number>();
  const stack: [number, number][] = [[dx - 1, b.depth - 1]];
  seen.add(key(dx - 1, b.depth - 1));
  while (stack.length) {
    const [cx, cz] = stack.pop()!;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + ox;
      const nz = cz + oz;
      const k = key(nx, nz);
      if (seen.has(k) || occ.has(k) || !canStep(cx, cz, nx, nz)) continue;
      seen.add(k);
      stack.push([nx, nz]);
    }
  }
  for (const r of all) {
    if (r.type === 'decor') continue;
    let ok = false;
    for (let i = 0; i < r.w && !ok; i++) {
      for (let j = 0; j < r.d && !ok; j++) {
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = r.x + i + ox;
          const nz = r.z + j + oz;
          if (canStep(r.x + i, r.z + j, nx, nz) && seen.has(key(nx, nz))) ok = true;
        }
      }
    }
    if (!ok) return false;
  }
  return true;
}

export function furnitureById(state: StoreState, id: number): Furniture {
  const f = state.furniture.find((x) => x.id === id);
  if (!f) throw new Error('Móvel inexistente');
  return f;
}
