/**
 * HUD (Fase 3, layout da referência): no topo central o selo do dia (faixa vermelha "Dia N" + hora), estrela de nível
 * com barra de XP (ponto vermelho = novidade liberada não vista), dinheiro e engrenagem. Sem energia.
 * Embaixo à esquerda, ao lado do joystick do player, o atalho de carrinho (abre o Mercado). Toasts no topo.
 * Os botões de jogo (ação, arremessar, sair do caixa...) são do `player`.
 */
import { dailyWages, xpForLevel } from '../sim/economy';
import { billSvg, cartSvg, gearSvg, starSvg } from './art';
import { h, money, tapOn } from './dom';
import type { ToastKind, UiKit } from './kit';

export interface HudHooks {
  openTablet(tab?: string): void;
  openMenu(): void;
  openLevel(): void;
}

export class Hud {
  readonly top: HTMLElement;
  /** Coluna do canto superior direito (missões, aviso de noite). */
  readonly slot: HTMLElement;
  readonly cartBtn: HTMLButtonElement;
  readonly levelBtn: HTMLButtonElement;
  private hud: HTMLElement;
  private dayB = h('b');
  private timeEl = h('span');
  private badge = h('div', { class: 'day-badge', role: 'status' }, this.dayB, this.timeEl);
  private lvlNum = h('b');
  private xpFill = h('i');
  private dot = h('i', { class: 'dot', hidden: true });
  private moneyEl = h('span', { class: 'money-v' });
  private moneyBtn: HTMLButtonElement;
  private toasts = h('div', { class: 'toasts' });
  private shownMoney: number;
  private lastMoneyVal = NaN;
  private cache = { level: -1, xp: -1, clock: '', day: -1, night: false, low: false };
  private measureT = 0;
  private lastToast = { text: '', t: 0 };
  private lastComplaint = 0;
  private flashTimer = 0;
  private building = false;

  constructor(private kit: UiKit, private root: HTMLElement, hooks: HudHooks) {
    const { ctx } = kit;
    this.shownMoney = ctx.state.money;
    this.levelBtn = h('button', { class: 'hpill lvl3', 'aria-label': 'Nível e novidades', on: tapOn(() => hooks.openLevel()) },
      h('span', { class: 'lvl-star', html: starSvg(42) }, this.lvlNum), h('span', { class: 'xp3' }, this.xpFill), this.dot);
    this.moneyBtn = h('button', { class: 'hpill money3', 'aria-label': 'Dinheiro em caixa (abre Finanças)', on: tapOn(() => hooks.openTablet('finance')) },
      h('span', { html: billSvg(34) }), this.moneyEl);
    const gear = h('button', { class: 'hpill gear3', 'aria-label': 'Menu', html: gearSvg(28), on: tapOn(() => hooks.openMenu()) });
    this.hud = h('div', { class: 'hud hud3' }, h('div', { class: 'hud-l' }), this.badge, h('div', { class: 'hud-r' }, this.levelBtn, this.moneyBtn, gear));
    this.top = h('div', { class: 'mx-top' }, this.hud, this.toasts);
    this.slot = h('div', { class: 'mslot' });
    this.cartBtn = h('button', { class: 'cart-fab', 'aria-label': 'Abrir mercado (computador)', title: 'Mercado (M)', html: cartSvg(30), on: tapOn(() => hooks.openTablet('market')) });
    root.append(this.top, this.slot, this.cartBtn);

    const bus = ctx.bus;
    bus.on('toast', (p: { text: string; kind?: ToastKind }) => this.pushToast(p.text, p.kind ?? 'info'));
    bus.on('ui:modal', () => this.syncVisibility());
    bus.on('customerComplaint', () => {
      const now = performance.now();
      if (now - this.lastComplaint < 7000) return;
      this.lastComplaint = now;
      this.pushToast('Um cliente achou o preço alto demais.', 'bad');
    });
    // posicionamento em 1ª pessoa (world): esconde o atalho de baixo para não competir com a barra COLOCAR/CANCELAR
    bus.on('build:state', (p?: { active: boolean }) => { this.building = !!p?.active; this.syncVisibility(); });
    bus.on('build:start', () => { this.building = true; this.syncVisibility(); });
    bus.on('build:end', () => { this.building = false; this.syncVisibility(); });
    this.render(true);
  }

  /** Ponto vermelho na estrela (novidade liberada não vista). */
  setDot(v: boolean): void { this.dot.hidden = !v; }

  syncVisibility(): void {
    const modal = this.kit.isModalOpen();
    this.root.classList.toggle('modal-open', modal);
    this.cartBtn.hidden = modal || this.building;
    this.slot.style.visibility = modal ? 'hidden' : '';
  }

  private pushToast(text: string, kind: ToastKind): void {
    const now = performance.now();
    if (text === this.lastToast.text && now - this.lastToast.t < 900) return;
    this.lastToast = { text, t: now };
    const t = h('div', { class: `toast ${kind}`, role: 'status' }, text);
    this.toasts.appendChild(t);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => t.classList.add('out'), kind === 'bad' ? 3400 : 2600);
    window.setTimeout(() => t.remove(), kind === 'bad' ? 3800 : 3000);
  }

  /** Base do HUD em px (painéis à direita e o tablet começam abaixo dela). */
  private measure(): void {
    const r = this.hud.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    const b = Math.ceil(r.bottom - rr.top);
    if (b > 0 && Number.isFinite(b)) this.root.style.setProperty('--hud-b', `${b}px`);
    this.root.classList.toggle('has-card', !!this.slot.querySelector('.mcard:not([hidden])'));
  }

  update(dt: number): void {
    const { state } = this.kit.ctx;
    this.measureT -= dt;
    if (this.measureT <= 0) { this.measureT = 0.5; this.measure(); }
    if (this.shownMoney !== state.money) {
      const diff = state.money - this.shownMoney;
      this.shownMoney = Math.abs(diff) < 3 ? state.money : this.shownMoney + diff * Math.min(1, dt * 7);
      this.flash(diff > 0 ? 'up' : 'down');
    }
    this.render(false);
  }

  private flash(dir: 'up' | 'down'): void {
    const c = this.moneyBtn.classList;
    c.remove('up', 'down'); c.add(dir);
    if (!c.contains('bump')) { c.add('bump'); window.setTimeout(() => c.remove('bump'), 360); }
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => c.remove('up', 'down'), 700);
  }

  private render(force: boolean): void {
    const { state, clock } = this.kit.ctx;
    const c = this.cache;
    const shown = Math.round(this.shownMoney);
    if (force || shown !== this.lastMoneyVal) { this.lastMoneyVal = shown; this.moneyEl.textContent = money(shown); }
    const low = state.money < (state.rent + dailyWages(state)) * 2;
    if (force || low !== c.low) {
      c.low = low;
      this.moneyBtn.classList.toggle('low', low);
      this.moneyBtn.title = low ? 'Caixa baixo: confira o Banco em Finanças' : '';
    }
    if (force || c.level !== state.level || c.xp !== state.xp) {
      c.level = state.level; c.xp = state.xp;
      const lo = xpForLevel(state.level), hi = xpForLevel(state.level + 1);
      const pct = Math.max(0, Math.min(1, (state.xp - lo) / Math.max(1, hi - lo)));
      this.lvlNum.textContent = String(state.level);
      this.xpFill.style.width = `${(pct * 100).toFixed(1)}%`;
      this.levelBtn.setAttribute('aria-label', `Nível ${state.level}: ${state.xp - lo} de ${hi - lo} XP. Ver novidades`);
    }
    const hhmm = clock.hhmm;
    if (force || c.clock !== hhmm || c.day !== state.day) {
      c.clock = hhmm; c.day = state.day;
      this.dayB.textContent = `Dia ${state.day}`;
      this.timeEl.textContent = hhmm;
    }
    const night = clock.phase === 'closing' || clock.phase === 'report';
    if (force || night !== c.night) { c.night = night; this.badge.classList.toggle('night', night); }
  }
}
