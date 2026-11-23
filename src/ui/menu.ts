/** Tela inicial, menu de pausa e opções. */
import { SAVE_KEY } from '../sim/save';
import { h } from './dom';
import { icon } from './icons';
import { UiKit } from './kit';
import { toggle } from './widgets';
import type { FontSize, Quality } from './settings';

export interface MenuHooks {
  endDay(): void;
  replayTutorial(): void;
  onStart(): void;
  /** Fase 3: abrir/fechar a loja (fallback da placa da porta). */
  toggleStore(): void;
  tutorialActive(): boolean;
  skipTutorial(): void;
}

const EXTRA_KEYS = ['mercadinho:tutorial', 'mercadinho:lastReport', 'mercadinho:daysnap', 'mercadinho:seen', 'mercadinho:autoToday'];

export class Menus {
  private title: HTMLElement | null = null;
  private pause: HTMLElement | null = null;
  constructor(private kit: UiKit, private layer: HTMLElement, private hooks: MenuHooks) {}

  get isOpen(): boolean { return this.title !== null || this.pause !== null; }

  private hasSave(): boolean {
    try { return localStorage.getItem(SAVE_KEY) !== null; } catch { return false; }
  }

  showTitle(): void {
    if (this.title) return;
    const save = this.hasSave();
    const start = (): void => { this.title?.remove(); this.title = null; this.kit.modalClose('title'); this.hooks.onStart(); };
    const btns = h('div', { class: 'menu-btns' },
      h('button', { class: 'btn accent', on: { click: start } }, h('span', { html: icon('play', 22) }), save ? 'Continuar' : 'Jogar'),
      save ? h('button', { class: 'btn', on: { click: () => void this.newGame() } }, 'Novo jogo') : null,
      h('button', { class: 'btn ghost', style: 'color:#fff;border-color:rgba(255,255,255,.4)', on: { click: () => this.showOptions() } }, h('span', { html: icon('gear', 22) }), 'Opções'));
    this.title = h('div', { class: 'mx-modal title-screen mx-z-menu', role: 'dialog', 'aria-label': 'Menu inicial' },
      h('div', { class: 'logo' }, h('div', { class: 'mk', html: icon('store', 48) }), h('h1', null, 'Mercadinho ', h('span', null, '3D')), h('p', null, 'Monte, abasteça e administre a sua loja.')),
      btns);
    this.layer.appendChild(this.title);
    this.kit.modalOpen('title', { pauseClock: true });
  }

  showPause(): void {
    if (this.pause || this.title) return;
    if (this.kit.isModalOpen()) return;
    const close = (): void => { this.pause?.remove(); this.pause = null; this.kit.modalClose('pause'); };
    const { clock, state, services } = this.kit.ctx;
    const ph = clock.phase;
    const tut = this.hooks.tutorialActive();
    const rep = state.reputation.toFixed(1).replace('.', ',');
    this.pause = h('div', { class: 'mx-modal mx-dim mx-z-menu', role: 'dialog', 'aria-label': 'Menu' },
      h('div', { class: 'menu-card' },
        h('div', { class: 'mx-row' }, h('h2', { style: 'flex:1' }, 'Pausa'), UiKit.closeButton(close)),
        h('small', { class: 'muted', id: 'pause-info' }, `${state.storeName} · Reputação ${rep} ★ · ${services.npc?.customersInStore() ?? 0} clientes na loja`),
        h('div', { class: 'menu-sub' },
          h('button', { class: 'btn primary block', on: { click: close } }, 'Continuar'),
          ph === 'prep' || ph === 'open' ? h('button', { class: 'btn accent block', id: 'pause-store', on: { click: () => { close(); this.hooks.toggleStore(); } } },
            h('span', { html: icon(ph === 'prep' ? 'store' : 'lock', 20) }), ph === 'prep' ? 'Abrir a loja' : 'Fechar a loja') : null,
          ph === 'report' ? null : h('button', { class: 'btn block', id: 'pause-end', on: { click: () => { close(); this.hooks.endDay(); } } }, h('span', { html: icon('moon', 20) }), 'Terminar o dia'),
          h('button', { class: 'btn block', on: { click: () => this.showOptions() } }, h('span', { html: icon('gear', 20) }), 'Opções'),
          h('button', { class: 'btn block', on: { click: () => { close(); if (tut) this.hooks.skipTutorial(); else this.hooks.replayTutorial(); } } }, h('span', { html: icon('bulb', 20) }), tut ? 'Pular tutorial' : 'Rever tutorial'),
          h('button', { class: 'btn danger block', on: { click: () => void this.newGame() } }, 'Novo jogo'))));
    this.layer.appendChild(this.pause);
    this.kit.modalOpen('pause', { pauseClock: true, onEsc: close });
  }

  showOptions(): void {
    const st = this.kit.settings;
    const quality: [Quality, string][] = [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']];
    const volOut = h('output', null, `${Math.round(st.value.volume * 100)}%`);
    const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(st.value.volume * 100), 'aria-label': 'Volume' });
    vol.addEventListener('input', () => { volOut.textContent = `${vol.value}%`; st.set({ volume: Number(vol.value) / 100 }); });
    const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(st.value.haptics), 'aria-label': 'Vibração' });
    sw.addEventListener('click', () => { const v = !st.value.haptics; st.set({ haptics: v }); sw.setAttribute('aria-checked', String(v)); if (v) st.buzz(30); });
    const seg = h('div', { class: 'seg' });
    const paint = (): void => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === st.value.quality));
    for (const [q, label] of quality) seg.appendChild(h('button', { class: 'btn', 'data-q': q, on: { click: () => { st.set({ quality: q }); paint(); } } }, label));
    paint();
    const fontSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tamanho do texto' });
    const sizes: [FontSize, string][] = [['small', 'P'], ['medium', 'M'], ['large', 'G']];
    const paintF = (): void => fontSeg.querySelectorAll('button').forEach((b) => { const on = b.dataset.f === st.value.fontSize; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    for (const [f, label] of sizes) fontSeg.appendChild(h('button', { class: 'btn', 'data-f': f, 'aria-label': `Texto ${f === 'small' ? 'pequeno' : f === 'large' ? 'grande' : 'médio'}`, style: `font-size:${f === 'small' ? 14 : f === 'large' ? 20 : 17}px`, on: { click: () => { st.set({ fontSize: f }); paintF(); } } }, label));
    paintF();
    const swRm = toggle(st.value.reduceMotion, 'Reduzir movimento', (v) => { st.set({ reduceMotion: v }); swRm.setAttribute('aria-checked', String(v)); });
    const swCb = toggle(st.value.colorblind, 'Modo daltônico', (v) => { st.set({ colorblind: v }); swCb.setAttribute('aria-checked', String(v)); });
    const back = h('div', { class: 'mx-modal mx-dim mx-z-confirm', role: 'dialog', 'aria-label': 'Opções' },
      h('div', { class: 'menu-card' },
        h('div', { class: 'mx-row' }, h('h2', { style: 'flex:1' }, 'Opções'), UiKit.closeButton(() => back.remove())),
        h('div', { class: 'opt' }, h('label', null, 'Volume', volOut), vol),
        h('div', { class: 'opt' }, h('div', { class: 'lb' }, h('span', null, 'Vibração'), sw)),
        h('div', { class: 'opt' }, h('div', { class: 'lb' }, 'Qualidade gráfica'), seg, h('small', { class: 'muted' }, 'Baixa economiza bateria em celulares mais simples.')),
        h('div', { class: 'opt' }, h('div', { class: 'lb' }, 'Tamanho do texto'), fontSeg),
        h('div', { class: 'opt' }, h('div', { class: 'lb' }, h('span', null, 'Reduzir movimento'), swRm), h('small', { class: 'muted' }, 'Desliga animações da interface e o tremor da câmera.')),
        h('div', { class: 'opt' }, h('div', { class: 'lb' }, h('span', null, 'Modo daltônico'), swCb), h('small', { class: 'muted' }, 'Troca verde/vermelho por azul/laranja e mostra setas ↑↓ em preços e margens.')),
        h('button', { class: 'btn primary block', on: { click: () => back.remove() } }, 'Voltar')));
    this.layer.appendChild(back);
  }

  async newGame(): Promise<void> {
    const ok = await this.kit.confirm({ title: 'Começar um novo jogo?', text: 'O progresso salvo será apagado e não poderá ser recuperado.', ok: 'Apagar e recomeçar', danger: true });
    if (!ok) return;
    try { localStorage.removeItem(SAVE_KEY); for (const k of EXTRA_KEYS) localStorage.removeItem(k); } catch { /* privado */ }
    // impede o autosave do main (intervalo / pagehide) de regravar o estado antigo durante o reload
    this.kit.ctx.save = () => {};
    location.reload();
  }
}
