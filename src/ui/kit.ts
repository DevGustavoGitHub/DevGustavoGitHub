/** Utilidades compartilhadas por todas as telas da UI. */
import type { GameContext } from '../core/module';
import { SettingsStore } from './settings';
import { clear, errText, h } from './dom';
import { icon } from './icons';

export type ToastKind = 'info' | 'good' | 'bad';
export type SfxName = 'scan' | 'cash' | 'coin' | 'card' | 'pop' | 'error' | 'levelup' | 'door' | 'step' | 'box' | 'trash' | 'buy'
  | 'sign' | 'night' | 'celebrate' | 'place' | 'throw' | 'mop' | 'sit' | 'stand' | 'boxOpen' | 'boxClose';

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
  /** Diálogos de confirmação abertos (o topo é o último): `ui:back` cancela o de cima. */
  private confirms: (() => void)[] = [];
  /**
   * Guarda contra clique fantasma (QA): painel/diálogo aberto por um `pointerdown` (o player e o HUD agem no toque)
   * receberia o `click` sintético do MESMO toque. Ao abrir um painel, o próximo clique de ponteiro que não tenha um
   * `pointerdown` novo depois da abertura é descartado na captura da janela, antes de chegar a qualquer botão.
   * Sem janela de tempo (aparelho lento não fura a guarda); teclado/`.click()` programático (`detail 0`) passam.
   */
  private downSeq = 0;
  private armedSeq = -1;
  private onDown = (): void => { this.downSeq++; };
  private onClick = (e: MouseEvent): void => {
    if (this.armedSeq < 0 || e.detail === 0) return;
    if (this.downSeq === this.armedSeq) { e.stopImmediatePropagation(); e.preventDefault(); }
    this.armedSeq = -1;
  };
  constructor(readonly ctx: GameContext) {
    this.settings = new SettingsStore(ctx.bus);
    window.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('click', this.onClick, true);
  }
  attachLayer(layer: HTMLElement): void { this.layer = layer; }
  /** Marca a abertura de um painel (ativa a guarda contra o clique fantasma). */
  armClickGuard(): void { this.armedSeq = this.downSeq; }
  dispose(): void {
    window.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('click', this.onClick, true);
  }

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
    if (!this.modals.has(id)) this.armClickGuard();
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
  /** Modal aberto mais recente (o "de cima"). */
  topModal(): string | undefined { let t: string | undefined; for (const m of this.modals) t = m; return t; }
  /** Fecha o modal `id` pelo seu fechador (Esc/Voltar); false se ele não tem fechador. */
  runCloser(id: string): boolean { const f = this.closers.get(id); if (!f) return false; f(); return true; }
  escape(): void {
    const last = [...this.closers.keys()].pop();
    if (last) this.closers.get(last)?.();
  }
  /** Cancela o diálogo de confirmação de cima (Voltar do Android). */
  closeTopConfirm(): boolean { const f = this.confirms.pop(); if (!f) return false; f(); return true; }

  /** Diálogo de confirmação sobre tudo. */
  confirm(o: ConfirmOpts): Promise<boolean> {
    this.armClickGuard();
    return new Promise((resolve) => {
      const cancel = (): void => done(false);
      const done = (v: boolean): void => {
        if (!back.isConnected) return;
        back.remove();
        this.confirms = this.confirms.filter((f) => f !== cancel);
        resolve(v);
      };
      this.confirms.push(cancel);
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

  /** Aviso com um botão só (ex.: save recuperado). */
  notice(title: string, text: string, ok = 'Entendi'): Promise<void> {
    this.armClickGuard();
    return new Promise((resolve) => {
      const close = (): void => {
        if (!back.isConnected) return;
        back.remove();
        this.confirms = this.confirms.filter((f) => f !== close);
        resolve();
      };
      this.confirms.push(close);
      const back = h('div', { class: 'mx-modal mx-dim mx-z-confirm', role: 'alertdialog', 'aria-label': title },
        h('div', { class: 'mx-dialog' }, h('h3', null, title), h('p', null, text),
          h('div', { class: 'mx-row mx-end' }, h('button', { class: 'btn primary', on: { click: close } }, ok))));
      this.layer.appendChild(back);
    });
  }

  /** Cabeçalho padrão de modal com botão fechar de 48px. */
  static closeButton(onClick: () => void): HTMLButtonElement {
    return h('button', { class: 'icon-btn', 'aria-label': 'Fechar', html: icon('close'), on: { click: onClick } });
  }
}

export { clear };
