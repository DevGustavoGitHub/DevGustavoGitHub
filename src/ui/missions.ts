/**
 * Missões do tutorial (Fase 3), no canto superior direito: ícone, barra "0/3", texto e retrato do gerente.
 * Avançam pelos eventos `player:action`, `checkout:done`, `stateChanged {what:'cart'}` e `storeOpened`.
 * Seta 3D amarela sobre o alvo e seta verde na borda quando o alvo está fora de vista (ver guide.ts).
 * Progresso em localStorage['mercadinho:tutorial'] ('done' ou JSON {i, n}).
 */
import * as THREE from 'three';
import { furnitureSvg, productSvg, upgradeSvg } from './art';
import { h } from './dom';
import { Guide, type PoiKind } from './guide';
import type { Hud } from './hud';
import type { UiKit } from './kit';
import { managerSvg } from './manager';
import { PRODUCTS } from '../sim/catalog';
import * as api from '../sim/api';
import { marketAverage, sellPrice } from '../sim/market';
import { icon } from './icons';

const KEY = 'mercadinho:tutorial';
const bagIcon = (): string => productSvg({ category: 'mercearia', color: '#ff9330', shape: 'bag' }, 44);

interface Step {
  id: string;
  text: string;
  goal: number;
  icon(): string;
  /** Alvo da seta (null = sem seta). */
  target(): THREE.Vector3 | null;
  /** Condição de estado que já conclui o passo (checada a cada 0,3 s). */
  auto?(): boolean;
  /** Precisa de clientes (fica parado de noite; de manhã pede para abrir a loja). */
  needsCustomers?: boolean;
  tablet?: { tab: string; text: string };
}

export class Missions {
  private card: HTMLElement | null = null;
  private bar!: HTMLElement;
  private barTx!: HTMLElement;
  private tx!: HTMLElement;
  private ic!: HTMLElement;
  private i = 0;
  private n = 0;
  private counted = new Set<number>();
  private t = 0;
  private stepT = 0;
  private flashUntil = 0;
  private steps: Step[];
  private guide: Guide;
  private boxV = new THREE.Vector3();
  /** Aviso de noite ocupa o lugar do cartão. */
  paused = false;

  constructor(private kit: UiKit, private hud: Hud, layer: HTMLElement) {
    const { ctx } = kit;
    this.guide = new Guide(ctx, layer, () => kit.settings.value.reduceMotion);
    const g = this.guide;
    const s = ctx.state;
    const counter = (): THREE.Vector3 | null => {
      const c = s.furniture.find((f) => f.type === 'counter');
      return c ? g.poi('counter', c.id) : g.poi('counter');
    };
    const poi = (k: PoiKind, id?: number) => (): THREE.Vector3 | null => g.poi(k, id);
    this.steps = [
      { id: 'buy', text: 'Use o computador do balcão e compre caixas de um produto', goal: 1, icon: () => furnitureSvg('counter', 44), target: poi('computer'),
        auto: () => s.sidewalk.length > 0, tablet: { tab: 'market', text: 'Missão: toque em Adicionar num produto e depois em Comprar.' } },
      { id: 'pick', text: 'Pegue a caixa na área de entrega', goal: 1, icon: () => productSvg({ category: 'mercearia', color: '#c9955c', shape: 'box' }, 44),
        target: () => this.boxTarget(), auto: () => (ctx.services.player?.carrying ?? null) !== null },
      { id: 'stock', text: 'Abra a caixa e reponha a prateleira', goal: 2, icon: () => furnitureSvg('shelf', 44), target: () => this.shelfTarget() },
      { id: 'open', text: 'Abra a loja tocando na placa da porta', goal: 1, icon: () => upgradeSvg('capacity', 44), target: poi('sign'),
        auto: () => ctx.clock.phase === 'open' || ctx.clock.phase === 'closing' },
      { id: 'sell3', text: 'Sente no caixa e conclua 3 compras!', goal: 3, icon: bagIcon, target: counter, needsCustomers: true },
      { id: 'trash', text: 'Jogue as caixas vazias no lixo', goal: 1, icon: () => furnitureSvg('rack', 44), target: poi('trash'),
        auto: () => this.stepT > 1.5 && !s.sidewalk.some((b) => b.units <= 0) },
      { id: 'sell5', text: 'Atenda mais 5 clientes', goal: 5, icon: bagIcon, target: counter, needsCustomers: true },
      // QA de economia: o sugerido é a média de mercado; até ~+10% quase ninguém reclama e o lucro sobe
      { id: 'price', text: 'Na aba Preços, suba um preço: até 10% acima do mercado quase ninguém reclama', goal: 1,
        icon: () => `<span style="display:flex;color:#ffd23f">${icon('tag', 40)}</span>`, target: poi('computer'),
        auto: () => PRODUCTS.some((p) => s.licenses.includes(p.category) && s.prices[p.id] !== undefined && sellPrice(s, p.id) > marketAverage(s, p.id) * 1.004),
        tablet: { tab: 'prices', text: 'Missão: até ~10% acima do mercado quase ninguém reclama, e é aí (de +10% a +20%) que o lucro costuma ser maior. Use +0,05 / +0,50.' } },
    ];
    const bus = ctx.bus;
    bus.on('player:action', (p?: { kind?: string }) => {
      const k = p?.kind;
      const id = this.step?.id;
      // "Abra a caixa e reponha": abrir conta 1/2; repor conclui (a caixa pode já estar aberta)
      if (id === 'stock' && k === 'openBox') { if (this.n < 1) this.progress(1); return; }
      if (id === 'stock' && k === 'placeUnits') { this.progress(2); return; }
      if ((id === 'pick' && (k === 'pickBox' || k === 'takeBox')) || (id === 'trash' && k === 'discardBox')) this.progress(1);
    });
    bus.on('stateChanged', (p?: { what?: string; boxes?: number }) => {
      if (this.step?.id === 'buy' && p?.what === 'cart' && (p.boxes ?? 0) > 0) this.progress(1);
    });
    bus.on('storeOpened', () => { if (this.step?.id === 'open') this.progress(1); });
    const sale = (p?: { customerId?: number; ok?: boolean }): void => {
      if (!p || p.ok === false) return;
      const id = this.step?.id;
      if (id !== 'sell3' && id !== 'sell5') return;
      if (typeof p.customerId === 'number') {
        if (this.counted.has(p.customerId)) return;
        this.counted.add(p.customerId);
      }
      this.progress(1);
    };
    bus.on('checkout:done', sale);
    // só `checkout:done` (venda registrada pelo npc) conta: o OK do painel não garante a venda (QA)
  }

  private get step(): Step | undefined { return this.card ? this.steps[this.i] : undefined; }
  get active(): boolean { return this.card !== null; }

  static seen(): boolean { try { return localStorage.getItem(KEY) === 'done'; } catch { return true; } }

  /** Caixa no chão mais próxima do jogador (senão, a área de entrega). */
  private boxTarget(): THREE.Vector3 | null {
    const { state, services } = this.kit.ctx;
    const pp = services.player?.position;
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (const b of state.sidewalk) {
      if (b.carried || b.x === undefined || b.z === undefined) continue;
      const d = pp ? (b.x - pp.x) ** 2 + (b.z - pp.z) ** 2 : 0;
      if (d < bd) { bd = d; best = { x: b.x, z: b.z }; }
    }
    if (best) return this.boxV.set(best.x, 0.75, best.z);
    return this.guide.poi('delivery');
  }

  /** Móvel que expõe o produto da caixa na mão (ou um móvel compatível vazio, ou qualquer prateleira). */
  private shelfTarget(): THREE.Vector3 | null {
    const { state, services } = this.kit.ctx;
    const pid = services.player?.carrying?.productId;
    const disp = state.furniture.filter((f) => f.type === 'shelf' || f.type === 'fridge' || f.type === 'freezer');
    let f = pid ? disp.find((x) => x.productId === pid) : undefined;
    if (!f && pid) {
      const cat = PRODUCTS.find((p) => p.id === pid)?.category;
      let specs: api.FurnitureSpec[] = [];
      try { specs = api.furnitureCatalog(); } catch { /* */ }
      f = disp.find((x) => !x.productId && !!cat && (specs.find((sp) => sp.type === x.type)?.categories.includes(cat) ?? false));
    }
    f ??= disp[0];
    return f ? this.guide.poi('furniture', f.id) : null;
  }

  start(force = false): void {
    if (this.card) return;
    const s = this.kit.ctx.state;
    let saved: { i: number; n: number } | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === 'done' && !force) return;
      if (raw && raw !== 'done') saved = JSON.parse(raw) as { i: number; n: number };
    } catch { /* privado */ }
    if (!force && !saved && s.day > 1) { this.finish(false); return; } // save antigo: não mostra o tutorial
    this.i = force || !saved ? 0 : Math.max(0, Math.min(this.steps.length - 1, saved.i | 0));
    this.n = force || !saved ? 0 : Math.max(0, saved.n | 0);
    this.counted.clear();
    this.stepT = 0;
    this.ic = h('div', { class: 'mc-ic' });
    this.bar = h('i');
    this.barTx = h('span');
    this.tx = h('div', { class: 'mc-tx' });
    this.card = h('div', { class: 'mcard mission', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'mc-box' }, this.ic, h('div', { class: 'mc-main' }, h('div', { class: 'mc-bar' }, this.bar, this.barTx), this.tx)),
      h('div', { class: 'mc-face', html: managerSvg('bust') }));
    this.hud.slot.prepend(this.card);
    this.render();
    this.save();
  }

  /** Pula/encerra o tutorial. */
  finish(toast = true): void {
    try { localStorage.setItem(KEY, 'done'); } catch { /* privado */ }
    this.card?.remove();
    this.card = null;
    this.kit.tutorialHint = null;
    this.guide.set(null);
    this.guide.update(0, false);
    if (toast) this.kit.toast('Tutorial concluído. Boas vendas!', 'good');
  }

  private save(): void { try { localStorage.setItem(KEY, JSON.stringify({ i: this.i, n: this.n })); } catch { /* privado */ } }

  private progress(k: number): void {
    const st = this.step;
    if (!st) return;
    this.n = Math.min(st.goal, this.n + k);
    this.kit.sfx('pop');
    if (this.n >= st.goal) this.advance();
    else { this.render(); this.save(); }
  }

  private advance(): void {
    this.i++;
    this.n = 0;
    this.stepT = 0;
    this.counted.clear();
    if (this.i >= this.steps.length) { this.finish(true); return; }
    this.flashUntil = performance.now() + 700;
    this.card?.classList.add('done');
    this.render();
    this.save();
  }

  private render(): void {
    const st = this.step;
    if (!st || !this.card) return;
    const { clock } = this.kit.ctx;
    const waitOpen = st.needsCustomers && clock.phase === 'prep';
    this.ic.innerHTML = st.icon();
    this.bar.style.width = `${(this.n / st.goal) * 100}%`;
    this.barTx.textContent = `${this.n}/${st.goal}`;
    this.tx.textContent = waitOpen ? 'Abra a loja na placa da porta para receber clientes' : st.text;
    this.kit.tutorialHint = st.tablet ? st.tablet : null;
  }

  update(dt: number): void {
    const st = this.step;
    if (!st || !this.card) { this.guide.update(dt, false); return; }
    const { ctx } = this.kit;
    this.stepT += dt;
    this.t += dt;
    if (this.t >= 0.3) {
      this.t = 0;
      if (st.auto?.()) { this.advance(); return; }
      if (this.flashUntil && performance.now() > this.flashUntil) { this.flashUntil = 0; this.card.classList.remove('done'); }
      this.render();
      const waitOpen = st.needsCustomers && ctx.clock.phase === 'prep';
      this.guide.set(waitOpen ? this.guide.poi('sign') : st.target());
    }
    const night = this.paused || (st.needsCustomers && (ctx.clock.phase === 'closing' || ctx.clock.phase === 'report'));
    const pl = ctx.services.player;
    const seated = pl?.mode === 'seated' || (pl?.seatedAt ?? null) !== null;
    this.card.hidden = this.paused;
    const show = !this.kit.isModalOpen() && !night && !(seated && st.needsCustomers) && !(st.id === 'buy' && this.kit.isModalOpen('tablet'));
    this.guide.update(dt, show);
  }

  dispose(): void { this.guide.dispose(); }
}
