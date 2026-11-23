/** Aviso "Gire o celular" em retrato (o jogo é só paisagem). Enquanto visível, pausa o relógio e trava o input (modal). */
import { phoneRotateSvg } from './art';
import { h } from './dom';
import type { UiKit } from './kit';

const QUERY = '(orientation: portrait) and (max-width: 1024px)';

export class RotateWarning {
  private mq: MediaQueryList | null = null;
  private onChange = (): void => this.sync();
  constructor(private kit: UiKit, layer: HTMLElement) {
    layer.appendChild(h('div', { class: 'rotate', role: 'alertdialog', 'aria-label': 'Gire o celular' },
      h('span', { html: phoneRotateSvg(150) }), h('h2', null, 'Gire o celular'),
      h('p', null, 'O Mercadinho 3D é jogado na horizontal. Vire o aparelho para continuar.')));
    try {
      this.mq = window.matchMedia(QUERY);
      this.mq.addEventListener('change', this.onChange);
    } catch { /* navegador antigo: só o CSS */ }
    this.sync();
  }
  get visible(): boolean { return this.mq?.matches ?? false; }
  private sync(): void {
    if (this.visible) this.kit.modalOpen('rotate', { pauseClock: true });
    else this.kit.modalClose('rotate');
  }
  dispose(): void { this.mq?.removeEventListener('change', this.onChange); }
}
