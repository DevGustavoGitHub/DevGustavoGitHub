import type * as THREE from 'three';
import type { EventBus } from './events';
import type { StoreState } from '../sim/state';
import type { GameClock } from './clock';
import type { Services } from './services';

export interface GameContext {
  state: StoreState;
  bus: EventBus;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock: GameClock;
  /** RNG não-determinístico para efeitos visuais/NPC. A economia usa src/sim com seed. */
  rand: () => number;
  uiRoot: HTMLElement;
  save: () => void;
  /** Serviços publicados por cada módulo em init() (ex.: ctx.services.world = {...}). */
  services: Services;
}

/** Cada área do projeto exporta `default function create(): GameModule` em src/<area>/index.ts. */
export interface GameModule {
  name: string;
  init(ctx: GameContext): void;
  /** dt em segundos reais (já limitado a 0.1). */
  update(dt: number): void;
  dispose?(): void;
}
