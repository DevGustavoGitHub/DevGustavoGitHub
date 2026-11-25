import { CLOSE_MIN, OPEN_MIN } from '../sim/state';
import type { EventBus } from './events';

export type DayPhase = 'prep' | 'open' | 'closing' | 'report';
/** 780 min de jogo (08:00-21:00) em ~6,5 min reais com speed 2 min/s. */
export const GAME_MINUTES_PER_SECOND = 2;

export class GameClock {
  minute = OPEN_MIN;
  phase: DayPhase = 'prep';
  paused = false;
  /**
   * Pausa de entrada (placa FECHADO durante o expediente): sem clientes novos, o dia e o relógio seguem. Só vale na fase
   * 'open'; zera ao fechar/terminar o dia. Evento `storeDoors {closed}` (+ `stateChanged {what:'doors'}`).
   * Para o visual da placa use `signOpen` (= aberta de fato: fase 'open' e portas abertas).
   */
  doorsClosed = false;
  get signOpen(): boolean { return this.phase === 'open' && !this.doorsClosed; }
  /** Pausa/retoma a entrada de clientes novos (só na fase 'open'). */
  setDoorsClosed(closed: boolean): void {
    if (this.phase !== 'open' || this.doorsClosed === closed) return;
    this.doorsClosed = closed;
    this.bus.emit('storeDoors', { closed });
    this.bus.emit('stateChanged', { what: 'doors' });
  }
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
    this.doorsClosed = false;
    this.bus.emit('storeClosing');
  }
  /** Chamado quando o relatório do dia é confirmado; volta para a manhã do próximo dia. */
  startNextDay(): void {
    this.minute = OPEN_MIN;
    this.phase = 'prep';
    this.doorsClosed = false;
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
