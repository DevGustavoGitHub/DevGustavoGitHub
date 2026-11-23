/**
 * Tablet/computador de gestão (Fase 3, visual da referência): cabeçalho azul com o nome da aba, trilho de ícones à
 * esquerda (ponto vermelho = novidade liberada não vista) e painel branco com cartões azul-marinho. O HUD fica visível
 * por cima (o painel começa abaixo dele). Abre por `ui:openTablet {tab?, productId?}`, pelo atalho de carrinho e pelo menu.
 */
import { clear, h } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { markSeen, unseenTabs } from '../unlocks';
import { autoTab } from './auto';
import { decorTab } from './decor';
import { expansionTab } from './expansion';
import { financeTab } from './finance';
import { licensesTab } from './licenses';
import { marketTab, setMarketSub } from './market';
import { pricesTab } from './prices';
import { servicesTab } from './services';
import { staffTab } from './staff';
import { upgradesTab } from './upgrades';

export interface TabApi {
  refresh(): void;
  close(): void;
  goto(id: string): void;
  /** Congela o re-render automático (ex.: tooltip de gráfico visível). Solta sozinho após alguns segundos. */
  hold(v: boolean): void;
  /** productId a destacar nesta renderização (vindo de `ui:openTablet {productId}`). */
  focus: string | null;
}
export interface TabDef {
  id: string;
  label: string;
  title?: string;
  icon: string;
  /** Re-renderiza a cada ~1 s (ex.: finanças com o dia em andamento). */
  live?: boolean;
  /** A aba controla a própria rolagem (layout de altura total). */
  fill?: boolean;
  render(body: HTMLElement, kit: UiKit, api: TabApi): void;
}

export const TABS: TabDef[] = [
  { id: 'market', label: 'Mercado', icon: 'cart', fill: true, render: marketTab },
  { id: 'prices', label: 'Preços', icon: 'tag', render: pricesTab },
  { id: 'auto', label: 'Automático', title: 'Pedido automático', icon: 'clock', render: autoTab },
  { id: 'licenses', label: 'Licenças', icon: 'badge', render: licensesTab },
  { id: 'expansion', label: 'Expansão', title: 'Expansão da loja', icon: 'expand', render: expansionTab },
  { id: 'services', label: 'Serviços', icon: 'wrench', render: servicesTab },
  { id: 'staff', label: 'Equipe', title: 'Funcionários', icon: 'users', render: staffTab },
  { id: 'upgrades', label: 'Melhorias', icon: 'star', render: upgradesTab },
  { id: 'finance', label: 'Finanças', title: 'Finanças e banco', icon: 'bank', live: true, render: financeTab },
  { id: 'decor', label: 'Decoração', icon: 'brush', render: decorTab },
];
const ALIAS: Record<string, string> = {
  storage: 'services', deposito: 'services', employees: 'staff', funcionarios: 'staff', bank: 'finance', banco: 'finance',
  upgrade: 'upgrades', license: 'licenses', expansao: 'expansion', products: 'market', mercado: 'market',
};

export class Tablet {
  private overlay: HTMLElement | null = null;
  private body!: HTMLElement;
  private title!: HTMLElement;
  private tabBtns = new Map<string, HTMLButtonElement>();
  private current = 'market';
  private liveT = 0;
  private api: TabApi;
  onOpen: (() => void) | null = null;
  /** Retorna true para impedir a abertura (ex.: tela de falência). */
  guard: (() => boolean) | null = null;
  /** Avisado quando a aba atual muda (marca novidades vistas). */
  onSeen: (() => void) | null = null;
  private heldUntil = 0;
  /** Produto destacado (`ui:openTablet {productId}`): sobrevive a re-renders por alguns segundos. */
  private focusId: string | null = null;
  private focusUntil = 0;
  private focusScroll = false;

  constructor(private kit: UiKit, private layer: HTMLElement) {
    this.api = {
      refresh: () => this.refresh(), close: () => this.close(), goto: (id) => this.show(id),
      hold: (v) => { this.heldUntil = v ? performance.now() + 6000 : 0; }, focus: null,
    };
    kit.ctx.bus.on('stateChanged', () => this.refresh());
  }

  get isOpen(): boolean { return this.overlay !== null; }
  get tab(): string { return this.current; }

  private resolve(tab?: string): string | undefined {
    if (!tab) return undefined;
    if (tab === 'furniture' || tab === 'moveis') { setMarketSub('furniture'); return 'market'; }
    const id = ALIAS[tab] ?? tab;
    return TABS.some((t) => t.id === id) ? id : undefined;
  }

  open(tab?: string, opts: { productId?: string } = {}): void {
    const id = this.resolve(tab);
    if (tab === 'market' || tab === 'products') setMarketSub('products');
    if (opts.productId) { this.focusId = opts.productId; this.focusUntil = performance.now() + 3000; this.focusScroll = true; }
    if (this.overlay) { this.show(id ?? this.current); return; }
    if (this.kit.isModalOpen()) return;
    if (this.guard?.()) return;
    this.current = id ?? 'market';
    this.body = h('div', { class: 't3-body' });
    this.title = h('h2');
    const rail = h('nav', { class: 't3-rail', role: 'tablist', 'aria-label': 'Seções do computador' });
    for (const t of TABS) {
      const b = h('button', { class: 'rail-btn', role: 'tab', 'aria-label': t.title ?? t.label, title: t.title ?? t.label, 'data-tab': t.id,
        html: `${icon(t.icon, 24)}<span>${t.label}</span>`, on: { click: () => this.show(t.id) } });
      this.tabBtns.set(t.id, b);
      rail.appendChild(b);
    }
    this.overlay = h('div', { class: 'mx-modal mx-dim tb-wrap', role: 'dialog', 'aria-label': 'Computador da loja' },
      h('section', { class: 'tablet t3' }, rail,
        h('div', { class: 't3-panel' },
          h('header', { class: 't3-head' }, this.title, h('button', { class: 't3-x', 'aria-label': 'Fechar', html: icon('close', 30), on: { click: () => this.close() } })),
          this.body)));
    this.overlay.addEventListener('pointerdown', (e) => { if (e.target === this.overlay) this.close(); });
    this.layer.appendChild(this.overlay);
    this.layer.classList.add('hud-over');
    this.kit.modalOpen('tablet', { onEsc: () => this.close() });
    this.kit.sfx('pop');
    this.show(this.current);
    this.onOpen?.();
  }

  close(): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.tabBtns.clear();
    this.layer.classList.remove('hud-over');
    this.kit.modalClose('tablet');
  }

  show(id: string): void {
    const rid = this.resolve(id) ?? this.current;
    this.current = rid;
    this.heldUntil = 0;
    markSeen(this.kit.ctx.state, rid);
    this.onSeen?.();
    const dots = unseenTabs(this.kit.ctx.state);
    for (const [k, b] of this.tabBtns) {
      b.classList.toggle('on', k === rid);
      b.setAttribute('aria-selected', String(k === rid));
      b.querySelector('.dot')?.remove();
      if (dots.has(k)) b.appendChild(h('i', { class: 'dot', 'aria-label': 'Novidade' }));
    }
    this.body.scrollTop = 0;
    this.refresh();
    this.tabBtns.get(rid)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  refresh(): void {
    if (!this.overlay) return;
    if (performance.now() < this.heldUntil) return;
    const def = TABS.find((t) => t.id === this.current);
    if (!def) return;
    // não destrói um campo de texto em edição
    if (document.activeElement instanceof HTMLInputElement && this.body.contains(document.activeElement)) return;
    this.title.textContent = def.title ?? def.label;
    const top = this.body.scrollTop;
    clear(this.body);
    this.body.classList.toggle('fill', !!def.fill);
    const hint = this.kit.tutorialHint;
    if (hint && hint.tab === this.current && !def.fill) this.body.appendChild(h('div', { class: 'banner warn', html: `${icon('bulb', 22)}<span>${hint.text}</span>` }));
    try {
      def.render(this.body, this.kit, this.api);
    } catch (e) {
      this.body.appendChild(h('div', { class: 'empty' }, 'Não foi possível montar esta aba.'));
      console.error(e);
    }
    this.body.scrollTop = top;
    const f = this.focusId;
    if (f && performance.now() < this.focusUntil) {
      this.api.focus = f;
      const el = this.body.querySelector<HTMLElement>(`[data-product="${CSS.escape(f)}"]`);
      if (el) {
        el.classList.add('focus-hl');
        if (this.focusScroll) { this.focusScroll = false; el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
      }
    } else { this.focusId = null; this.api.focus = null; }
  }

  update(dt: number): void {
    if (!this.overlay) return;
    this.liveT += dt;
    if (this.liveT >= 1) {
      this.liveT = 0;
      if (TABS.find((t) => t.id === this.current)?.live) this.refresh();
    }
  }
}
