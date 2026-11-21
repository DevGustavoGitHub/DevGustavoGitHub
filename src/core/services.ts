import type * as THREE from 'three';
import type { Box } from '../sim/state';

export interface Vec2 { x: number; z: number }

/** Publicado pelo módulo `world`. Usado por npc/player. */
export interface WorldService {
  /** Caminho A* na grade (centros de tile, em tiles). null se inalcançável. Evita móveis/paredes. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null;
  isWalkable(x: number, z: number): boolean;
  /** Ponto onde alguém deve ficar para acessar um móvel (frente do shelf/fridge/freezer). */
  furnitureAccess(furnitureId: number): Vec2 | null;
  /** Caixas registradoras: posição do operador e fila (ordem 0 = primeiro da fila). */
  counters(): { furnitureId: number; operator: Vec2; queue: Vec2[]; scanner: Vec2 }[];
  /** Pontos de saída/entrada de clientes (rua). */
  spawnPoint(): Vec2;
  /** Posição da lixeira externa. */
  trashBin(): Vec2;
  /** Porta de entrada. */
  door(): Vec2;
  /** Coloca sujeira visual (a lógica fica em state.dirt). */
  group: THREE.Group;
}

/** Publicado pelo módulo `player`. */
export interface PlayerService {
  position: THREE.Vector3;
  /** Caixa na mão (a mesma referência que está em state.sidewalk com carried=true). */
  carrying: Box | null;
  /** true enquanto uma UI modal (tablet, checkout, relatório) está aberta — para travar o movimento. */
  inputLocked: boolean;
  /** furnitureId do balcão (caixa) junto do qual o jogador está; null se não está em nenhum. */
  atCounter: number | null;
  /** Personaliza cores do avatar (hex CSS). Opcional. */
  setAppearance?(c: Partial<Record<'skin' | 'shirt' | 'apron' | 'cap' | 'pants', string>>): void;
}

/** Publicado pelo módulo `npc`. */
export interface NpcService {
  customersInStore(): number;
}

export interface Services {
  world?: WorldService;
  player?: PlayerService;
  npc?: NpcService;
}
