import { CLOSE_MIN, OPEN_MIN } from '../sim/state';
import type { EventBus } from './events';

export type DayPhase = 'prep' | 'open' | 'closing' | 'report';
/** 780 min de jogo (08:00-21:00) em ~6,5 min reais com speed 2 min/s. */
export const GAME_MINUTES_PER_SECOND = 2;

export class GameClock {
  minute = OPEN_MIN;
  phase: DayPhase = 'prep';
  paused = false;
  constructor(private bus: EventBus) {}
  /** Jogador abre a loja (começa o expediente). */
  openStore(): void {
    if (this.phase !== 'prep') return;
    this.phase = 'open';
    this.bus.emit('storeOpened');
  }
  /** Fecha: sem novos clientes; quando a loja esvaziar o módulo de NPC emite 'storeEmpty'. */
  closeStore(): void {
    if (this.phase !== 'open') return;
    this.phase = 'closing';
    this.bus.emit('storeClosing');
  }
  /** Chamado quando o relatório do dia é confirmado; volta para a manhã do próximo dia. */
  startNextDay(): void {
    this.minute = OPEN_MIN;
    this.phase = 'prep';
    this.bus.emit('dayStarted');
  }
  update(dt: number): void {
    if (this.paused || this.phase !== 'open') return;
    this.minute += dt * GAME_MINUTES_PER_SECOND;
    if (this.minute >= CLOSE_MIN) {
      this.minute = CLOSE_MIN;
      this.closeStore();
    }
  }
  get hhmm(): string {
    const m = Math.floor(this.minute);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}
