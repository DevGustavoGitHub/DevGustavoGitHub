import type * as THREE from 'three';
import type { Box } from '../sim/state';

export interface Vec2 { x: number; z: number }

/**
 * FASE 3 — alvo de interação em 1ª pessoa. O world cria proxies invisíveis (raycast) em `pickGroup`,
 * cada um com `userData.pick: PickInfo`. O player faz raycast do centro da tela contra eles.
 */
export interface PickInfo {
  kind: 'furniture' | 'box' | 'dirt' | 'trash' | 'sign' | 'computer' | 'seat' | 'storageDoor' | 'recycle' | 'tipjar';
  /** furnitureId (furniture/seat), índice em state.sidewalk (box), índice em state.dirt (dirt). */
  id?: number;
  /** FASE 4: nível (prateleira) mirado do móvel, calculado pelo player com world.levelAt. */
  level?: number;
}

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
  /** Posição da lixeira verde de reciclagem (interativa quando a melhoria 'recycler' está comprada). */
  recycleBin?(): Vec2;
  /** Porta de entrada. */
  door(): Vec2;
  /** Coloca sujeira visual (a lógica fica em state.dirt). */
  group: THREE.Group;

  /* ---------- FASE 3 (opcionais até o world implementar; consumidores devem tolerar ausência) ---------- */
  /** Proxies invisíveis para raycast, cada filho com userData.pick: PickInfo. Atualizado pelo world. */
  pickGroup?: THREE.Group;
  /** Contorno verde no objeto do alvo (null remove). Chamado pelo player quando o alvo muda. */
  highlight?(pick: PickInfo | null): void;
  /** Pose da câmera sentada no caixa (coordenadas de mundo): posição dos olhos e ponto para onde olha. */
  seatPose?(counterId: number): { pos: THREE.Vector3; look: THREE.Vector3 } | null;
  /** Posições de mundo na esteira, na ordem cliente → scanner (onde o npc pousa os produtos). */
  beltSlots?(counterId: number): THREE.Vector3[];
  /** Ponto de mundo onde o cliente estende dinheiro/cartão para o jogador sentado. */
  handoffPoint?(counterId: number): THREE.Vector3 | null;
  /** Nova malha de um produto (geometria/material compartilhados) para esteira, cesta e caixa na mão. */
  makeProductMesh?(productId: string): THREE.Object3D;
  /** FASE 3 (adendo): caixa de papelão animável igual às do chão. `userData.setOpen(t 0..1)`, `userData.setUnits(n)`. Geometria/material compartilhados. */
  makeBoxMesh?(productId: string, open: boolean, units?: number): THREE.Object3D;
  /** FASE 4: qual nível (prateleira) do móvel contém o ponto de mundo `point` (hit do raycast); null se nenhum. */
  levelAt?(furnitureId: number, point: THREE.Vector3): number | null;
  /** Pontos de interesse para setas do tutorial (mundo). */
  poi?(kind: 'computer' | 'sign' | 'delivery' | 'trash' | 'recycle' | 'storageDoor' | 'counter' | 'furniture', id?: number): THREE.Vector3 | null;
}

/** Publicado pelo módulo `player`. */
export interface PlayerService {
  position: THREE.Vector3;
  /** Caixa na mão (a mesma referência que está em state.sidewalk com carried=true). */
  carrying: Box | null;
  /** Fase 2: todas as caixas carregadas, da base ao topo (LIFO); `carrying` = topo. Até `api.carryCapacity`. */
  carryingAll: Box[];
  /** true enquanto uma UI modal (tablet, checkout, relatório) está aberta — para travar o movimento. */
  inputLocked: boolean;
  /** furnitureId do balcão (caixa) junto do qual o jogador está; null se não está em nenhum. */
  atCounter: number | null;
  /** Personaliza cores do avatar (hex CSS). Opcional. */
  setAppearance?(c: Partial<Record<'skin' | 'shirt' | 'apron' | 'cap' | 'pants', string>>): void;
  /** FASE 3: caixa onde o jogador está SENTADO (null = em pé). `atCounter` passa a espelhar este valor. */
  seatedAt?: number | null;
  /** FASE 3: modo atual da câmera/controle. */
  mode?: 'walk' | 'seated' | 'build';
}

/**
 * FASE 3 — publicado pelo `player`. Objetos tocáveis enquanto sentado no caixa (itens na esteira,
 * dinheiro/cartão na mão do cliente). O player faz raycast do toque contra eles e chama `onTap`.
 */
export interface PickService {
  add(obj: THREE.Object3D, onTap: () => void): void;
  remove(obj: THREE.Object3D): void;
}

/** Publicado pelo módulo `npc`. */
export interface NpcService {
  customersInStore(): number;
}

/** Publicado pelo módulo `audio`. */
export interface AudioService {
  /** 'none' = ainda sem gesto do usuário (AudioContext não criado). */
  readonly state: 'none' | AudioContextState;
  /** Toca um SFX (mesmo que o evento 'sfx'). */
  sfx(name: string, pan?: number): void;
  setVolume(v: number): void;
}

export interface Services {
  pick?: PickService;
  audio?: AudioService;
  world?: WorldService;
  player?: PlayerService;
  npc?: NpcService;
}
