/**
 * Aviso "Gire o celular" em retrato (o jogo é só paisagem). Enquanto visível, pausa o relógio e trava o input (modal).
 * Fase 4: não aparece no app nativo (Capacitor trava em `sensorLandscape`) nem quando a paisagem está travada no
 * navegador (tela cheia + `screen.orientation` em paisagem, ou o player avisou `orientation:locked {locked:true}`).
 * Ao virar para retrato espera ~0,35 s antes de mostrar (evita piscar durante a rotação/travamento).
 */
import { phoneRotateSvg } from './art';
import { h } from './dom';
import type { UiKit } from './kit';

const QUERY = '(orientation: portrait) and (max-width: 1024px)';

/** App nativo (Capacitor Android/iOS): a orientação é travada pelo sistema. */
export function isNativeApp(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (!cap) return false;
  try { return cap.isNativePlatform ? cap.isNativePlatform() : (cap.getPlatform?.() ?? 'web') !== 'web'; } catch { return false; }
}

export class RotateWarning {
  private mq: MediaQueryList | null = null;
  private el: HTMLElement;
  private playerLocked = false;
  private timer = 0;
  private shown = false;
  private onChange = (): void => this.sync();
  private offBus: () => void;
  constructor(private kit: UiKit, layer: HTMLElement) {
    this.el = h('div', { class: 'rotate', role: 'alertdialog', 'aria-label': 'Gire o celular' },
      h('span', { html: phoneRotateSvg(150) }), h('h2', null, 'Gire o celular'),
      h('p', null, 'O Mercadinho 3D é jogado na horizontal. Vire o aparelho para continuar.'));
    layer.appendChild(this.el);
    try {
      this.mq = window.matchMedia(QUERY);
      this.mq.addEventListener('change', this.onChange);
    } catch { /* navegador antigo */ }
    document.addEventListener('fullscreenchange', this.onChange);
    try { screen.orientation?.addEventListener('change', this.onChange); } catch { /* sem Screen Orientation API */ }
    this.offBus = kit.ctx.bus.on('orientation:locked', (p?: { locked?: boolean }) => { this.playerLocked = !!p?.locked; this.sync(); });
    this.sync(true);
  }

  /** Paisagem travada: app nativo, ou tela cheia no navegador com a tela em paisagem / trava confirmada pelo player. */
  get locked(): boolean {
    if (isNativeApp()) return true;
    if (!document.fullscreenElement) return false;
    let land = false;
    try { land = (screen.orientation?.type ?? '').startsWith('landscape'); } catch { /* */ }
    return this.playerLocked || land;
  }
  get visible(): boolean { return this.shown; }
  private want(): boolean { return (this.mq?.matches ?? false) && !this.locked; }

  private sync(initial = false): void {
    window.clearTimeout(this.timer);
    if (!this.want()) { this.apply(false); return; }
    if (initial || this.shown) { this.apply(true); return; }
    this.timer = window.setTimeout(() => { if (this.want()) this.apply(true); }, 350);
  }

  private apply(on: boolean): void {
    this.shown = on;
    this.el.classList.toggle('on', on);
    if (on) this.kit.modalOpen('rotate', { pauseClock: true });
    else this.kit.modalClose('rotate');
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.mq?.removeEventListener('change', this.onChange);
    document.removeEventListener('fullscreenchange', this.onChange);
    try { screen.orientation?.removeEventListener('change', this.onChange); } catch { /* */ }
    this.offBus();
  }
}
