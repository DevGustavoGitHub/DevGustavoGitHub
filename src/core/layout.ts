/**
 * Layout compartilhado por world/player/npc/ui. Unidade: 1 = 1 metro = 1 tile. Y é para cima.
 * Origem (0,0) = canto interior traseiro esquerdo da loja. +x = direita, +z = em direção à RUA.
 * Parede da frente em z = depth. Calçada: depth <= z < depth + SIDEWALK_DEPTH. Rua depois disso.
 * A porta fica centrada em x = width/2 na parede da frente (largura DOOR_WIDTH).
 */
export const SIDEWALK_DEPTH = 3;
export const DOOR_WIDTH = 2;
export const WALL_HEIGHT = 3;

export interface Bounds { width: number; depth: number }

/** Nº máximo de expansões do salão (0..6): 12x10 → 36x22. */
export const MAX_EXPANSION = 6;

/** Dimensões do salão de vendas por nível de expansão (0 = inicial). Sempre inteiros. */
export function storeBounds(expansion: number): Bounds {
  const e = Math.max(0, Math.min(expansion, MAX_EXPANSION));
  return { width: 12 + 4 * e, depth: 10 + 2 * e };
}
/** Sala de estoque (storage room) fica ATRÁS do salão: z de -STORAGE_DEPTH a 0, mesma largura. */
export const STORAGE_DEPTH = 6;

export const doorX = (b: Bounds): number => b.width / 2;
export const doorPos = (b: Bounds): { x: number; z: number } => ({ x: doorX(b), z: b.depth });
/** Onde as caixas entregues aparecem na calçada (lado esquerdo da porta). */
export const deliveryZone = (b: Bounds): { x: number; z: number; w: number; d: number } =>
  ({ x: 1, z: b.depth + 0.5, w: Math.max(3, doorX(b) - 2), d: SIDEWALK_DEPTH - 1 });
/** Lixeira externa (calçada, lado direito da porta). */
export const trashBinPos = (b: Bounds): { x: number; z: number } => ({ x: b.width - 1.5, z: b.depth + 1.5 });

export type FurnitureType = 'shelf' | 'fridge' | 'freezer' | 'counter' | 'rack' | 'decor';
export const FURNITURE_FOOTPRINT: Record<FurnitureType, { w: number; d: number }> = {
  shelf: { w: 2, d: 1 }, fridge: { w: 2, d: 1 }, freezer: { w: 2, d: 1 },
  counter: { w: 2, d: 2 }, rack: { w: 2, d: 1 }, decor: { w: 1, d: 1 },
};
