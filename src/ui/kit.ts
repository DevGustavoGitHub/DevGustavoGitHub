/** Utilidades compartilhadas por todas as telas da UI. */
import type { GameContext } from '../core/module';
import { SettingsStore } from './settings';
import { clear, errText, h } from './dom';
import { icon } from './icons';

export type ToastKind = 'info' | 'good' | 'bad';
export type SfxName = 'scan' | 'cash' | 'coin' | 'card' | 'pop' | 'error' | 'levelup' | 'door' | 'step' | 'box' | 'trash' | 'buy';

export interface ConfirmOpts { title: string; text: string; ok?: string; cancel?: string; danger?: boolean }

/** Kit: tudo que as telas precisam (estado, toasts, som, modais, confirmação). */
export class UiKit {
  readonly settings: SettingsStore;
  /** Dica do tutorial mostrada no topo do tablet (null = nenhuma). */
  tutorialHint: { tab: string; text: string } | null = null;
  private modals = new Set<string>();
  private pausedBy = new Set<string>();
  private layer!: HTMLElement;
  /** Fecha o modal mais recente com Esc. */
  private closers = new Map<string, () => void>();
  constructor(readonly ctx: GameContext) {
    this.settings = new SettingsStore(ctx.bus);
  }
  attachLayer(layer: HTMLElement): void { this.layer = layer; }

  toast(text: string, kind: ToastKind = 'info'): void { this.ctx.bus.emit('toast', { text, kind }); }
  sfx(name: SfxName, pan?: number): void { this.ctx.bus.emit('sfx', { name, pan }); }

  /** Executa uma ação do jogador que muda estado: captura erro → toast; emite stateChanged ao dar certo. */
  act<T>(what: string, fn: () => T, okMsg?: string, sound: SfxName = 'buy'): T | undefined {
    try {
      const r = fn();
      if (okMsg) this.toast(okMsg, 'good');
      this.sfx(sound);
      this.ctx.bus.emit('stateChanged', { what });
      this.ctx.save();
      return r;
    } catch (e) {
      this.toast(errText(e), 'bad');
      this.sfx('error');
      this.settings.buzz(40);
      return undefined;
    }
  }

  /** Registra modal aberto/fechado; emite `ui:modal` nas transições 0↔1. `pauseClock` congela o relógio. */
  modalOpen(id: string, opts: { pauseClock?: boolean; onEsc?: () => void } = {}): void {
    const was = this.modals.size;
    this.modals.add(id);
    if (opts.onEsc) this.closers.set(id, opts.onEsc);
    if (opts.pauseClock) { this.pausedBy.add(id); this.ctx.clock.paused = true; }
    if (was === 0) this.ctx.bus.emit('ui:modal', { open: true });
  }
  modalClose(id: string): void {
    if (!this.modals.delete(id)) return;
    this.closers.delete(id);
    if (this.pausedBy.delete(id) && this.pausedBy.size === 0) this.ctx.clock.paused = false;
    if (this.modals.size === 0) this.ctx.bus.emit('ui:modal', { open: false });
  }
  isModalOpen(id?: string): boolean { return id ? this.modals.has(id) : this.modals.size > 0; }
  escape(): void {
    const last = [...this.closers.keys()].pop();
    if (last) this.closers.get(last)?.();
  }

  /** Diálogo de confirmação sobre tudo. */
  confirm(o: ConfirmOpts): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (v: boolean): void => { back.remove(); resolve(v); };
      const back = h('div', { class: 'mx-modal mx-dim mx-z-confirm', role: 'alertdialog' },
        h('div', { class: 'mx-dialog' },
          h('h3', null, o.title),
          h('p', null, o.text),
          h('div', { class: 'mx-row mx-end' },
            h('button', { class: 'btn ghost', on: { click: () => done(false) } }, o.cancel ?? 'Cancelar'),
            h('button', { class: `btn ${o.danger ? 'danger' : 'primary'}`, on: { click: () => done(true) } }, o.ok ?? 'Confirmar'))));
      this.layer.appendChild(back);
    });
  }

  /** Cabeçalho padrão de modal com botão fechar de 48px. */
  static closeButton(onClick: () => void): HTMLButtonElement {
    return h('button', { class: 'icon-btn', 'aria-label': 'Fechar', html: icon('close'), on: { click: onClick } });
  }
}

export { clear };
