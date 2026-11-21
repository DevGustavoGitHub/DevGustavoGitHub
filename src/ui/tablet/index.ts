/** Tablet/computador de gestão: modal com abas reativas ao estado. */
import { clear, h, money } from '../dom';
import { icon } from '../icons';
import { UiKit } from '../kit';
import { marketTab } from './market';
import { pricesTab } from './prices';
import { licensesTab } from './licenses';
import { furnitureTab } from './furniture';
import { expansionTab } from './expansion';
import { staffTab } from './staff';
import { decorTab } from './decor';
import { financeTab } from './finance';

export interface TabApi { refresh(): void; close(): void; goto(id: string): void }
export interface TabDef {
  id: string;
  label: string;
  icon: string;
  /** Re-renderiza a cada ~1 s (ex.: finanças com o dia em andamento). */
  live?: boolean;
  render(body: HTMLElement, kit: UiKit, api: TabApi): void;
}

const TABS: TabDef[] = [
  { id: 'market', label: 'Mercado', icon: 'cart', render: marketTab },
  { id: 'prices', label: 'Preços', icon: 'tag', render: pricesTab },
  { id: 'licenses', label: 'Licenças', icon: 'badge', render: licensesTab },
  { id: 'furniture', label: 'Móveis', icon: 'sofa', render: furnitureTab },
  { id: 'expansion', label: 'Expansão', icon: 'expand', render: expansionTab },
  { id: 'staff', label: 'Equipe', icon: 'users', render: staffTab },
  { id: 'decor', label: 'Decoração', icon: 'brush', render: decorTab },
  { id: 'finance', label: 'Finanças', icon: 'chart', live: true, render: financeTab },
];

export class Tablet {
  private overlay: HTMLElement | null = null;
  private body!: HTMLElement;
  private cash!: HTMLElement;
  private tabBtns = new Map<string, HTMLButtonElement>();
  private current = 'market';
  private liveT = 0;
  private api: TabApi;
  onOpen: (() => void) | null = null;

  constructor(private kit: UiKit, private layer: HTMLElement) {
    this.api = { refresh: () => this.refresh(), close: () => this.close(), goto: (id) => this.show(id) };
    kit.ctx.bus.on('stateChanged', () => this.refresh());
  }

  get isOpen(): boolean { return this.overlay !== null; }

  open(tab?: string): void {
    if (this.overlay) { if (tab) this.show(tab); return; }
    if (this.kit.isModalOpen()) return;
    if (tab) this.current = tab;
    this.cash = h('span', { class: 'cash' });
    this.body = h('div', { class: 'tb-body' });
    const tabs = h('nav', { class: 'tb-tabs', role: 'tablist' });
    for (const t of TABS) {
      const b = h('button', { class: 'tab-btn', role: 'tab', html: `${icon(t.icon, 22)}<span>${t.label}</span>`, on: { click: () => this.show(t.id) } });
      this.tabBtns.set(t.id, b);
      tabs.appendChild(b);
    }
    this.overlay = h('div', { class: 'mx-modal mx-dim', role: 'dialog', 'aria-label': 'Tablet de gestão' },
      h('section', { class: 'tablet' },
        h('header', { class: 'tb-head' }, h('span', { html: icon('tablet', 24) }), h('h2', null, 'Tablet de gestão'), this.cash, UiKit.closeButton(() => this.close())),
        tabs, this.body));
    this.overlay.addEventListener('pointerdown', (e) => { if (e.target === this.overlay) this.close(); });
    this.layer.appendChild(this.overlay);
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
    this.kit.modalClose('tablet');
  }

  show(id: string): void {
    this.current = id;
    for (const [k, b] of this.tabBtns) { b.classList.toggle('on', k === id); b.setAttribute('aria-selected', String(k === id)); }
    this.body.scrollTop = 0;
    this.refresh();
    const btn = this.tabBtns.get(id);
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  refresh(): void {
    if (!this.overlay) return;
    const def = TABS.find((t) => t.id === this.current);
    if (!def) return;
    // não destrói um campo de texto em edição
    if (document.activeElement instanceof HTMLInputElement && this.body.contains(document.activeElement)) return;
    this.cash.textContent = money(this.kit.ctx.state.money);
    const top = this.body.scrollTop;
    clear(this.body);
    try {
      def.render(this.body, this.kit, this.api);
    } catch (e) {
      this.body.appendChild(h('div', { class: 'empty' }, 'Não foi possível montar esta aba.'));
      console.error(e);
    }
    this.body.scrollTop = top;
  }

  update(dt: number): void {
    if (!this.overlay) return;
    this.liveT += dt;
    if (this.liveT >= 1) {
      this.liveT = 0;
      this.cash.textContent = money(this.kit.ctx.state.money);
      if (TABS.find((t) => t.id === this.current)?.live) this.refresh();
    }
  }
}
