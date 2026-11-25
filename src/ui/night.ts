/**
 * Noite (Fase 3): em `storeClosing` mostra o aviso "Nenhum cliente novo virá à noite" (no lugar das missões) e o
 * botão "Terminar o dia". O relatório só abre quando o jogador toca no botão (o index confirma se ainda há clientes).
 */
import { moonSvg } from './art';
import { h, tapOn } from './dom';
import type { Hud } from './hud';
import type { UiKit } from './kit';
import { managerSvg } from './manager';
import type { Missions } from './missions';

export class Night {
  private card: HTMLElement | null = null;
  private btn: HTMLButtonElement | null = null;
  constructor(private kit: UiKit, private hud: Hud, private root: HTMLElement, private missions: Missions, private endDay: () => void) {}
  get active(): boolean { return this.card !== null; }

  show(): void {
    if (this.card) return;
    const time = this.kit.ctx.clock.hhmm;
    // pós-teste: o botão fica DENTRO do aviso da noite (canto superior direito), longe da coluna de ações (SAIR DO
    // CAIXA, arremessar/largar caixa), para não cobrir nada enquanto o jogador arruma a loja antes de virar o dia
    this.btn = h('button', { class: 'endday', id: 'end-day', on: tapOn(() => this.endDay()) },
      h('span', { html: moonSvg(40) }), h('span', null, 'Terminar', h('br'), 'o dia'));
    this.card = h('div', { class: 'mcard night', role: 'status' },
      h('div', { class: 'mc-box' },
        h('div', { class: 'mc-ic' }, h('div', { class: 'night-ic' }, h('b', null, 'Noite'), h('span', null, time))),
        h('div', { class: 'mc-main' }, h('div', { class: 'mc-tx' }, 'Nenhum cliente novo à noite')),
        this.btn),
      h('div', { class: 'mc-face', html: managerSvg('bust') }));
    this.hud.slot.prepend(this.card);
    this.missions.paused = true;
    this.kit.sfx('night');
    this.sync();
  }

  /** Loja vazia: destaca o botão (o relatório continua esperando o toque do jogador). */
  empty(): void {
    if (!this.btn) return;
    this.btn.classList.add('pulse');
    this.kit.toast('Todos os clientes saíram. Toque em "Terminar o dia" quando quiser.', 'info');
  }

  hide(): void {
    this.card?.remove();
    this.btn?.remove();
    this.card = null;
    this.btn = null;
    this.missions.paused = false;
  }

  sync(): void {
    if (this.btn) this.btn.hidden = this.kit.isModalOpen();
  }
}
