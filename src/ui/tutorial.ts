/** Tutorial guiado curto de primeiro uso. Avança sozinho conforme o jogador age. */
import { h } from './dom';
import type { Hud } from './hud';
import type { UiKit } from './kit';

const KEY = 'mercadinho:tutorial';

interface Step { title: string; text: string; done: () => boolean; glow?: () => HTMLElement | null; tablet?: boolean }

export class Tutorial {
  private card: HTMLElement | null = null;
  private i = 0;
  private flags = { tablet: false, opened: false, served: false };
  private t = 0;
  private glowEl: HTMLElement | null = null;
  private steps: Step[];

  constructor(private kit: UiKit, private hud: Hud) {
    const { ctx } = kit;
    const s = ctx.state;
    this.steps = [
      { title: 'Abra o tablet', text: 'Toque no botão do tablet (canto inferior direito) para gerir a loja.', done: () => this.flags.tablet, glow: () => hud.tabletBtn },
      { title: 'Compre caixas', text: 'Na aba Mercado, escolha um produto e toque em Comprar. As caixas chegam na calçada.', done: () => s.sidewalk.length > 0 || Object.values(s.shelf).some((n) => n > 0), tablet: true },
      { title: 'Pegue uma caixa', text: 'Feche o tablet, vá até a calçada e pegue uma caixa com o botão de interação.', done: () => ctx.services.player?.carrying != null || Object.values(s.shelf).some((n) => n > 0) },
      { title: 'Abasteça a prateleira', text: 'Leve a caixa até a prateleira do produto e toque no botão de interação para colocar.', done: () => Object.values(s.shelf).some((n) => n > 0) },
      { title: 'Defina os preços', text: 'No tablet, aba Preços, use "Definir todos pelo sugerido" ou ajuste cada produto.', done: () => Object.keys(s.prices).length > 0, tablet: true },
      { title: 'Abra a loja', text: 'Quando estiver pronto, toque em Abrir loja.', done: () => this.flags.opened || ctx.clock.phase !== 'prep', glow: () => hud.storeBtn },
      { title: 'Atenda no caixa', text: 'Quando um cliente chegar ao caixa, toque em Atender cliente: bipe os itens e dê o troco certo.', done: () => this.flags.served },
    ];
    ctx.bus.on('storeOpened', () => { this.flags.opened = true; });
    ctx.bus.on('checkoutResult', (p: { ok: boolean }) => { if (p.ok) this.flags.served = true; });
  }

  noteTabletOpened(): void { this.flags.tablet = true; }

  static seen(): boolean {
    try { return localStorage.getItem(KEY) === 'done'; } catch { return true; }
  }

  start(force = false): void {
    if (this.card) return;
    if (!force && Tutorial.seen()) return;
    if (!force && this.kit.ctx.state.day > 1) { this.finish(); return; }
    this.i = 0;
    this.flags = { tablet: false, opened: false, served: false };
    this.card = h('div', { class: 'tut', role: 'status' });
    this.hud.slot.appendChild(this.card);
    this.render();
  }

  private finish(): void {
    try { localStorage.setItem(KEY, 'done'); } catch { /* privado */ }
    this.card?.remove();
    this.card = null;
    this.setGlow(null);
    this.kit.tutorialHint = null;
  }

  private setGlow(el: HTMLElement | null): void {
    if (this.glowEl === el) return;
    this.glowEl?.classList.remove('tut-glow');
    this.glowEl = el;
    el?.classList.add('tut-glow');
  }

  private render(): void {
    const c = this.card;
    const step = this.steps[this.i];
    if (!c || !step) return;
    c.replaceChildren(
      h('span', { class: 'n' }, String(this.i + 1)),
      h('div', { class: 'tx' }, h('b', null, step.title), step.text),
      h('button', { class: 'skip', on: { click: () => this.finish() } }, 'Pular'));
    this.setGlow(step.glow?.() ?? null);
    this.kit.tutorialHint = step.tablet ? `${step.title}: ${step.text}` : null;
  }

  update(dt: number): void {
    if (!this.card) return;
    this.t += dt;
    if (this.t < 0.3) return;
    this.t = 0;
    const step = this.steps[this.i];
    if (step?.done()) {
      this.i++;
      if (this.i >= this.steps.length) {
        this.kit.toast('Tutorial concluído. Boas vendas!', 'good');
        this.finish();
        return;
      }
      this.render();
    }
    // esconde o cartão atrás de modais
    this.card.style.display = this.kit.isModalOpen() ? 'none' : '';
  }
}
