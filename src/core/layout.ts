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
export const MAX_EXPANSION = 7;

/**
 * Dimensões do salão de vendas por nível de expansão (0 = inicial). Sempre inteiros.
 * Pós-teste 3: o salão começa MENOR (10×8) para a 1ª expansão valer a pena; ela leva ao antigo tamanho inicial (12×10)
 * e as seguintes seguem a regra antiga (16×12, 20×14, ...). Saves antigos ganham +1 de expansão (mesmo tamanho).
 */
export function storeBounds(expansion: number): Bounds {
  const e = Math.max(0, Math.min(expansion, MAX_EXPANSION));
  if (e === 0) return { width: 10, depth: 8 };
  return { width: 12 + 4 * (e - 1), depth: 10 + 2 * (e - 1) };
}
/** Etapa de tamanho que conta para aluguel, fluxo e capacidade de clientes: a 1ª expansão (10×8 → 12×10) só dá espaço. */
export const sizeTier = (expansion: number): number => Math.max(0, Math.floor(Number.isFinite(expansion) ? expansion : 0) - 1);
/** Sala de estoque (storage room) fica ATRÁS do salão: z de -STORAGE_DEPTH a 0, mesma largura. */
export const STORAGE_DEPTH = 6;

export const doorX = (b: Bounds): number => b.width / 2;
export const doorPos = (b: Bounds): { x: number; z: number } => ({ x: doorX(b), z: b.depth });
/** Onde as caixas entregues aparecem na calçada (lado esquerdo da porta). */
export const deliveryZone = (b: Bounds): { x: number; z: number; w: number; d: number } =>
  ({ x: 1, z: b.depth + 0.5, w: Math.max(3, doorX(b) - 2), d: SIDEWALK_DEPTH - 1 });
/** Lixeira externa (calçada, lado direito da porta). */
export const trashBinPos = (b: Bounds): { x: number; z: number } => ({ x: b.width - 1.5, z: b.depth + 1.5 });

/** Lixeira verde de reciclagem (calçada, lado esquerdo da fachada, oposto à lixeira externa). */
/**
 * Lixeira verde de reciclagem: na calçada, AFASTADA da parede, ao lado da lixeira comum (pós-teste 3 — colada na fachada,
 * o ponto livre mais perto dela ficava DENTRO da loja e os funcionários "jogavam através da parede").
 */
export const recycleBinPos = (b: Bounds): { x: number; z: number } => ({ x: b.width - 2.7, z: b.depth + 1.5 });
/** Onde um funcionário para para usar uma lixeira (sempre do lado da calçada, entre a loja e a lixeira). */
export const binApproach = (bin: { x: number; z: number }): { x: number; z: number } => ({ x: bin.x, z: bin.z - 0.85 });

/** `desk` = mesa do computador: móvel único, fora do catálogo (não se compra, vende nem guarda), só se MOVE. */
export type FurnitureType = 'shelf' | 'fridge' | 'freezer' | 'counter' | 'rack' | 'decor' | 'desk';
export const FURNITURE_FOOTPRINT: Record<FurnitureType, { w: number; d: number }> = {
  shelf: { w: 2, d: 1 }, fridge: { w: 2, d: 1 }, freezer: { w: 2, d: 1 },
  counter: { w: 2, d: 2 }, rack: { w: 2, d: 1 }, decor: { w: 1, d: 1 }, desk: { w: 1, d: 1 },
};
