/** Utilidades e tipos compartilhados do módulo NPC. Sem alocações em funções chamadas por frame. */
import type { GameContext } from '../core/module';
import type { Vec2, WorldService } from '../core/services';

export const COUNTER_Y = 0.95;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** Interpola ângulos pelo caminho mais curto. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export const dist2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

const warned = new Set<string>();
/** Executa uma chamada à api/sim sem derrubar a IA; avisa uma única vez por rótulo. */
export function safe<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    if (!warned.has(label)) {
      warned.add(label);
      console.warn(`[npc] ${label}:`, e instanceof Error ? e.message : e);
    }
    return fallback;
  }
}

export type BubbleKey = 'caro' | 'obrigado' | 'semestoque' | 'demora' | 'oops' | 'happy' | 'angry' | 'neutral' | 'sad' | 'coin' | 'bulk' | 'picky' | 'pickyno' | 'kid';

/** Ambiente comum entregue aos agentes. */
export interface Env {
  ctx: GameContext;
  world(): WorldService;
  /** Todos os agentes ativos (para separação). */
  agents: AgentLike[];
  say(a: AgentLike, key: BubbleKey, seconds?: number): void;
  /** Emite stateChanged. */
  changed(what: string): void;
  /** Itens nas cestas/esteira mudaram (pegou, devolveu, vendeu): atualiza state.npcHeld na hora. */
  heldChanged(): void;
  /** SFX posicional: com x/z (metros) o áudio calcula pan/volume em relação à câmera. */
  sfx(name: string, x?: number, z?: number): void;
  nearestWalkable(x: number, z: number, out: Vec2): Vec2;
}

export interface AgentLike {
  x: number;
  z: number;
  id: number;
  /** Raio de separação (ignorado quando 0). */
  sepWeight: number;
}
