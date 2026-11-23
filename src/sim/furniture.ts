/** Regras de móveis: catálogo, colisão, caminho livre, capacidade. api.ts expõe estas funções. */
import { FURNITURE_FOOTPRINT, STORAGE_DEPTH, doorX, storeBounds, type FurnitureType } from '../core/layout';
import type { FurnitureSpec } from './api';
import { productById } from './catalog';
import { DECOR_ITEMS, STORAGE } from './tuning';
import type { Cents } from './money';
import type { Furniture, StoreState } from './state';

export type Rot = 0 | 90 | 180 | 270;

/**
 * Fase 4: `slots` dos expositores = nº de NÍVEIS (prateleiras) do móvel, como estantes reais: prateleira 4,
 * geladeira 4 (porta com 4 prateleiras), freezer 3 (cestos). Cada nível guarda um produto (capacidade = slotCapacity).
 */
const CATALOG: FurnitureSpec[] = [
  { type: 'shelf', name: 'Prateleira', cost: 30000, minLevel: 1, slots: 4, categories: ['mercearia', 'limpeza', 'padaria', 'hortifruti', 'higiene', 'eletronicos'] },
  { type: 'fridge', name: 'Geladeira', cost: 50000, minLevel: 2, slots: 4, categories: ['bebidas', 'laticinios', 'hortifruti', 'frios'] },
  { type: 'freezer', name: 'Freezer', cost: 150000, minLevel: 10, slots: 3, categories: ['congelados'] },
  { type: 'counter', name: 'Caixa registradora', cost: 100000, minLevel: 4, slots: 0, categories: [] },
  /** rack: `slots` = nº de caixas que a estante guarda no depósito. */
  { type: 'rack', name: 'Estante do depósito', cost: 50000, minLevel: STORAGE.minLevel, slots: STORAGE.rackBoxes, categories: [] },
  { type: 'decor', name: 'Decoração', cost: 8000, minLevel: 1, slots: 0, categories: [] },
];

export const furnitureCatalog = (): FurnitureSpec[] => CATALOG.map((s) => ({ ...s, categories: [...s.categories] }));

/** Móvel expositor mais barato que aceita a categoria (prateleira < geladeira < freezer). */
export function displayTypeFor(category: string): FurnitureType {
  const opts = CATALOG.filter((c) => isDisplay(c.type) && c.categories.includes(category)).sort((a, b) => a.cost - b.cost);
  const t = opts[0]?.type;
  if (!t) throw new Error('Nenhum móvel expõe esta categoria');
  return t;
}

/** Custo de compra/venda: decor depende da variante (DECOR_ITEMS); demais tipos usam o catálogo. */
export function furnitureCost(type: FurnitureType, variant?: string): Cents {
  if (type === 'decor' && variant !== undefined) {
    const d = DECOR_ITEMS.find((x) => x.id === variant);
    if (d) return d.cost;
  }
  return specOf(type).cost;
}

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

/* ---------- capacidade (exposição por níveis: levels.ts) ---------- */

export function storageCapacity(state: StoreState): number {
  if (!state.storageUnlocked) return 0;
  return STORAGE.baseBoxes + state.furniture.reduce((a, f) => (f.type === 'rack' ? a + specOf('rack').slots : a), 0);
}

export function storageUsed(state: StoreState): number {
  let n = 0;
  for (const [id, units] of Object.entries(state.storage)) if (units > 0) n += Math.ceil(units / productById(id).boxSize);
  return n;
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
  const keep = keepTiles(state);
  const pass = storagePassage(state.expansion);
  const mine = new Set<number>();
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) mine.add(key(x + i, z + j));
  for (const [xx, zz] of keep) if (mine.has(key(xx, zz))) return false;

  // Alcançabilidade: BFS a partir da porta; todo móvel (exceto decor) precisa de um vizinho livre alcançado.
  // Móveis que JÁ estavam inalcançáveis sem o novo (ex.: porta mudou de lugar numa expansão) não bloqueiam novas compras.
  const zmin = state.storageUnlocked ? -STORAGE_DEPTH : 0;
  const inArea = (xx: number, zz: number): boolean => xx >= 0 && xx < b.width && zz >= zmin && zz < b.depth;
  const canStep = (x0: number, z0: number, x1: number, z1: number): boolean => {
    if (!inArea(x1, z1)) return false;
    if ((z0 === 0 && z1 === -1) || (z0 === -1 && z1 === 0)) return x0 >= pass.x0 && x0 < pass.x1;
    return true;
  };
  const unreachable = (rects: Rect[], occupied: Set<number>): Set<Rect> => {
    const seen = new Set<number>();
    const stack: [number, number][] = [[dx - 1, b.depth - 1]];
    seen.add(key(dx - 1, b.depth - 1));
    while (stack.length) {
      const [cx, cz] = stack.pop()!;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + ox;
        const nz = cz + oz;
        const k = key(nx, nz);
        if (seen.has(k) || occupied.has(k) || !canStep(cx, cz, nx, nz)) continue;
        seen.add(k);
        stack.push([nx, nz]);
      }
    }
    const bad = new Set<Rect>();
    for (const r of rects) {
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
      if (!ok) bad.add(r);
    }
    return bad;
  };
  const added = all[all.length - 1]!;
  const after = unreachable(all, occ);
  if (after.size === 0) return true;
  if (after.has(added)) return false;
  // algum móvel antigo ficou inalcançável: só aceita se já estava assim antes (sem o novo)
  const occBefore = new Set<number>();
  for (const r of others) for (let i = 0; i < r.w; i++) for (let j = 0; j < r.d; j++) occBefore.add(key(r.x + i, r.z + j));
  const before = unreachable(others, occBefore);
  for (const r of after) if (!before.has(r)) return false;
  return true;
}

/** Tiles que devem ficar livres: antessala 2×2 da porta e (com depósito) a passagem de 2 tiles em z = −1 e 0. */
export function keepTiles(state: StoreState): [number, number][] {
  const b = storeBounds(state.expansion);
  const dx = doorX(b);
  const keep: [number, number][] = [];
  for (const zz of [b.depth - 1, b.depth - 2]) for (const xx of [dx - 1, dx]) keep.push([xx, zz]);
  const pass = storagePassage(state.expansion);
  if (state.storageUnlocked) for (const zz of [0, -1]) for (let xx = pass.x0; xx < pass.x1; xx++) keep.push([xx, zz]);
  return keep;
}

/**
 * Após uma expansão a porta muda de lugar: móveis que caíram na nova antessala/passagem são movidos para o
 * ponto válido mais próximo (mesma rotação, ou girados). Sem lugar válido, o móvel fica onde está.
 */
export function relocateBlocking(state: StoreState): void {
  const keep = new Set(keepTiles(state).map(([x, z]) => key(x, z)));
  const b = storeBounds(state.expansion);
  for (const f of [...state.furniture]) {
    const { w, d } = footprintOf(f.type, f.rot);
    let hit = false;
    for (let i = 0; i < w && !hit; i++) for (let j = 0; j < d && !hit; j++) if (keep.has(key(f.x + i, f.z + j))) hit = true;
    if (!hit) continue;
    const zLo = f.type === 'rack' ? -STORAGE_DEPTH : 0;
    const zHi = f.type === 'rack' ? 0 : b.depth;
    let best: { x: number; z: number; rot: Rot; dist: number } | null = null;
    for (const rot of [f.rot, ...([0, 90, 180, 270] as Rot[]).filter((r) => r !== f.rot)]) {
      for (let z = zLo; z < zHi; z++) {
        for (let x = 0; x < b.width; x++) {
          const dist = Math.abs(x - f.x) + Math.abs(z - f.z) + (rot === f.rot ? 0 : 3);
          if (best && dist >= best.dist) continue;
          if (canPlace(state, f.type, x, z, rot, f.id)) best = { x, z, rot, dist };
        }
      }
    }
    if (best) { f.x = best.x; f.z = best.z; f.rot = best.rot; }
  }
}

export function furnitureById(state: StoreState, id: number): Furniture {
  const f = state.furniture.find((x) => x.id === id);
  if (!f) throw new Error('Móvel inexistente');
  return f;
}
