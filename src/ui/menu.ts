/** Tela inicial, menu de pausa e opções. */
import { SAVE_KEY, deserialize } from '../sim/save';
import { h } from './dom';
import { icon } from './icons';
import { UiKit } from './kit';
import { toggle } from './widgets';
import { LOOK_MAX, LOOK_MIN, clampLook, type FontSize, type Quality } from './settings';

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

  /** Só um save VÁLIDO conta ("Continuar"); um ilegível é tratado pelo main/sim (cópia + aviso) e aqui vira "Jogar". */
  private hasSave(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      deserialize(raw); // puro (sem gravar): lança se o save for inválido
      return true;
    } catch { return false; }
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
            // no expediente a placa só pausa a entrada de clientes (o dia termina às 21:00 ou em "Terminar o dia")
            h('span', { html: icon(ph === 'prep' || clock.doorsClosed ? 'store' : 'lock', 20) }),
            ph === 'prep' ? 'Abrir a loja' : clock.doorsClosed ? 'Abrir a porta' : 'Fechar a porta (pausar clientes)') : null,
          ph === 'report' ? null : h('button', { class: 'btn block', id: 'pause-end', on: { click: () => { close(); this.hooks.endDay(); } } }, h('span', { html: icon('moon', 20) }), 'Terminar o dia'),
          h('button', { class: 'btn block', on: { click: () => this.showOptions() } }, h('span', { html: icon('gear', 20) }), 'Opções'),
          h('button', { class: 'btn block', on: { click: () => { close(); if (tut) this.hooks.skipTutorial(); else this.hooks.replayTutorial(); } } }, h('span', { html: icon('bulb', 20) }), tut ? 'Pular tutorial' : 'Rever tutorial'),
          h('button', { class: 'btn danger block', on: { click: () => void this.newGame() } }, 'Novo jogo'))));
    this.layer.appendChild(this.pause);
    this.kit.modalOpen('pause', { pauseClock: true, onEsc: close });
  }

  /** Opções: volume, sensibilidade da câmera, qualidade, texto, vibração e acessibilidade. No celular deitado o
   *  cartão vira uma grade de 2 colunas (linhas "rótulo | controle") e cabe sem rolagem (Fase 4). */
  showOptions(): void {
    const st = this.kit.settings;
    const quality: [Quality, string][] = [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']];
    const volOut = h('output', null, `${Math.round(st.value.volume * 100)}%`);
    const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(st.value.volume * 100), 'aria-label': 'Volume' });
    vol.addEventListener('input', () => { volOut.textContent = `${vol.value}%`; st.set({ volume: Number(vol.value) / 100 }); });
    const lookTxt = (v: number): string => `${v.toFixed(1).replace('.', ',')}×`;
    const lookOut = h('output', { id: 'opt-look-v' }, lookTxt(st.value.lookSensitivity));
    const look = h('input', { type: 'range', min: LOOK_MIN, max: LOOK_MAX, step: 0.1, value: st.value.lookSensitivity, 'aria-label': 'Sensibilidade da câmera', id: 'opt-look' });
    look.addEventListener('input', () => { const v = clampLook(Number(look.value)); lookOut.textContent = lookTxt(v); st.set({ lookSensitivity: v }); });
    const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(st.value.haptics), 'aria-label': 'Vibração' });
    sw.addEventListener('click', () => { const v = !st.value.haptics; st.set({ haptics: v }); sw.setAttribute('aria-checked', String(v)); if (v) st.buzz(30); });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Qualidade gráfica' });
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
    /** Linha de opção: rótulo (+ valor) e controle; `inl` = controle na mesma linha do rótulo (interruptores). */
    const row = (label: string, ctl: HTMLElement, o: { out?: HTMLElement; note?: string; inl?: boolean } = {}): HTMLElement =>
      h('div', { class: `opt${o.inl ? ' inl' : ''}`, title: o.note },
        h('div', { class: 'lb' }, h('span', null, label), o.out ?? null, o.inl ? ctl : null),
        o.inl ? null : ctl,
        o.note ? h('small', { class: 'muted' }, o.note) : null);
    const close = (): void => { back.remove(); this.kit.modalClose('options'); };
    const back = h('div', { class: 'mx-modal mx-dim mx-z-confirm', role: 'dialog', 'aria-label': 'Opções' },
      h('div', { class: 'menu-card opt-card' },
        h('div', { class: 'mx-row' }, h('h2', { style: 'flex:1' }, 'Opções'), UiKit.closeButton(close)),
        h('div', { class: 'opt-grid' },
          row('Volume', vol, { out: volOut }),
          row('Sensibilidade da câmera', look, { out: lookOut, note: 'Quanto a câmera gira ao arrastar o dedo ou o mouse.' }),
          row('Qualidade gráfica', seg, { note: 'Baixa economiza bateria em celulares mais simples.' }),
          row('Tamanho do texto', fontSeg),
          row('Vibração', sw, { inl: true }),
          row('Reduzir movimento', swRm, { inl: true, note: 'Desliga animações da interface e o tremor da câmera.' }),
          row('Modo daltônico', swCb, { inl: true, note: 'Troca verde/vermelho por azul/laranja e mostra setas ↑↓ em preços e margens.' }),
          h('button', { class: 'btn primary block opt-back', on: { click: close } }, 'Voltar'))));
    this.layer.appendChild(back);
    this.kit.modalOpen('options', { onEsc: close });
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
