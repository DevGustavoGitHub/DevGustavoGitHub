/** HUD: dinheiro, nível/XP, hora/dia, reputação, clientes, botões de ação, toasts e level-up. */
import { dailyWages, xpForLevel } from '../sim/economy';
import { h, money } from './dom';
import { icon } from './icons';
import type { UiKit, ToastKind } from './kit';

export interface HudHooks {
  openTablet(): void;
  openMenu(): void;
  endDay(): void;
  attend(): void;
}

interface Prompt { label: string | null; action?: () => void }

export class Hud {
  readonly top: HTMLElement;
  readonly tabletBtn: HTMLButtonElement;
  readonly storeBtn: HTMLButtonElement;
  /** Espaço sob o HUD para cartões extras (tutorial). */
  readonly slot: HTMLElement;
  private moneyEl = h('span', { class: 'money-v' });
  private moneyPill = h('div', { class: 'pill money' }, h('span', { html: icon('coin', 22) }), this.moneyEl);
  private lvlBadge = h('div', { class: 'lvl-badge' }, '1');
  private xpBar = h('i');
  private xpText = h('span');
  private xpPct = h('span');
  private clockEl = h('span');
  private phaseEl = h('span', { class: 'phase' });
  private starsEl = h('span', { class: 'stars' });
  private repNum = h('span');
  private custEl = h('span', null, '0');
  private toasts = h('div', { class: 'toasts' });
  private attendBtn: HTMLButtonElement;
  private interactBtn: HTMLButtonElement;
  private interactLabel = h('span');
  private actions: HTMLElement;
  private prompt: Prompt = { label: null };

  private shownMoney: number;
  private targetMoney: number;
  private lastMoneyVal = NaN;
  private cache = { level: -1, xp: -1, clock: '', phase: '', rep: -1, cust: -1, day: -1 };
  private shownLevel: number;
  private custTimer = 0;
  private lastToast = { text: '', t: 0 };
  private lastComplaint = 0;
  private flashTimer = 0;
  private building = false;
  private lowCash = false;

  constructor(private kit: UiKit, root: HTMLElement, private hooks: HudHooks) {
    const { ctx } = kit;
    this.shownMoney = this.targetMoney = ctx.state.money;
    this.shownLevel = ctx.state.level;

    const level = h('div', { class: 'pill lvl grow' }, this.lvlBadge,
      h('div', { class: 'xp' }, h('div', { class: 'xp-t' }, this.xpText, this.xpPct), h('div', { class: 'xpbar' }, this.xpBar)));
    const clock = h('div', { class: 'pill' }, h('span', { html: icon('clock', 20) }),
      h('span', { style: 'display:flex;flex-direction:column;line-height:1.1' }, this.clockEl, this.phaseEl));
    const rep = h('div', { class: 'pill', title: 'Reputação' }, this.starsEl, this.repNum);
    const cust = h('div', { class: 'pill', title: 'Clientes na loja' }, h('span', { html: icon('users', 20) }), this.custEl);
    const gear = h('button', { class: 'pill gear', 'aria-label': 'Menu', html: icon('gear', 24), on: { click: () => hooks.openMenu() } });
    this.top = h('div', { class: 'mx-top' },
      h('div', { class: 'hud' }, this.moneyPill, level, clock, h('div', { class: 'hud-right' }, rep, cust, gear)),
      (this.slot = h('div', { class: 'hit', style: 'display:contents' })),
      (this.attendBtn = h('button', { class: 'attend-btn', hidden: true, on: { click: () => hooks.attend() } },
        h('span', { html: icon('cart', 22) }), 'Atender cliente')),
      this.toasts);

    this.tabletBtn = h('button', { class: 'fab', 'aria-label': 'Abrir tablet de gestão', html: icon('tablet', 30), on: { click: () => hooks.openTablet() } });
    this.storeBtn = h('button', { class: 'store-btn' });
    this.storeBtn.addEventListener('click', () => this.onStoreBtn());
    this.interactBtn = h('button', { class: 'interact-btn', hidden: true, on: { click: () => this.runPrompt() } },
      h('kbd', null, 'E'), this.interactLabel);
    this.actions = h('div', { class: 'mx-actions' }, this.interactBtn, this.storeBtn, this.tabletBtn);
    root.append(this.top, this.actions);

    const bus = ctx.bus;
    bus.on('toast', (p: { text: string; kind?: ToastKind }) => this.pushToast(p.text, p.kind ?? 'info'));
    bus.on('levelUp', (p: { level: number }) => this.levelUp(p.level));
    bus.on('interact:prompt', (p: Prompt | undefined) => this.setPrompt(p ?? { label: null }));
    bus.on('ui:modal', () => this.syncVisibility());
    bus.on('customerComplaint', (p: { productId: string }) => {
      const now = performance.now();
      if (now - this.lastComplaint < 7000) return;
      this.lastComplaint = now;
      this.pushToast('Um cliente achou o preço alto demais.', 'bad');
      void p;
    });
    // o modo construção do `world` tem barra própria: some com o HUD enquanto ele está ativo
    bus.on('build:start', () => { this.building = true; this.syncVisibility(); });
    bus.on('build:end', () => { this.building = false; this.syncVisibility(); });
    this.render(true);
  }

  /* ----- botão da loja ----- */
  private onStoreBtn(): void {
    const { clock } = this.kit.ctx;
    if (clock.phase === 'prep') { clock.openStore(); this.kit.sfx('door'); }
    else if (clock.phase === 'open') void this.kit.confirm({ title: 'Fechar a loja?', text: 'Novos clientes não entram mais. Quando a loja esvaziar, o dia termina.', ok: 'Fechar loja' })
      .then((ok) => { if (ok) clock.closeStore(); });
    else if (clock.phase === 'closing') this.hooks.endDay();
  }

  private syncVisibility(): void {
    const modal = this.kit.isModalOpen();
    this.actions.style.visibility = modal || this.building ? 'hidden' : '';
    this.top.style.visibility = this.building ? 'hidden' : '';
    if (modal) this.interactBtn.hidden = true; else this.setPrompt(this.prompt);
  }

  /* ----- interação contextual ----- */
  private setPrompt(p: Prompt): void {
    this.prompt = p;
    this.interactBtn.hidden = !p.label || this.kit.isModalOpen();
    if (p.label) this.interactLabel.textContent = p.label;
  }
  private runPrompt(): void {
    const a = this.prompt.action;
    if (a) { a(); this.kit.settings.buzz(15); }
  }

  /* ----- checkout ----- */
  setAttend(show: boolean): void {
    this.attendBtn.hidden = !show;
  }

  /* ----- toasts ----- */
  private pushToast(text: string, kind: ToastKind): void {
    const now = performance.now();
    if (text === this.lastToast.text && now - this.lastToast.t < 900) return;
    this.lastToast = { text, t: now };
    const t = h('div', { class: `toast ${kind}`, role: 'status' }, text);
    this.toasts.appendChild(t);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => t.classList.add('out'), kind === 'bad' ? 3400 : 2600);
    window.setTimeout(() => t.remove(), kind === 'bad' ? 3800 : 3000);
  }

  /* ----- level up ----- */
  private levelUp(level: number): void {
    if (level <= this.shownLevel) return;
    this.shownLevel = level;
    this.pushToast(`Você chegou ao nível ${level}! Confira novas licenças no tablet.`, 'good');
    this.kit.settings.buzz([30, 40, 60]);
    this.lvlBadge.classList.remove('pop'); void this.lvlBadge.offsetWidth; this.lvlBadge.classList.add('pop');
    const ov = h('div', { class: 'levelup' }, h('div', { class: 'burst' }, h('span', null, 'Novo nível'), h('b', null, String(level))));
    const colors = ['#ff9330', '#17866a', '#ffd36a', '#3b7fd4', '#de3f45'];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2, d = 90 + Math.random() * 120;
      const s = h('i', { class: 'spark', style: `background:${colors[i % colors.length]};left:50%;top:50%;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--rot:${Math.random() * 540}deg` });
      ov.appendChild(s);
    }
    this.top.parentElement?.appendChild(ov);
    window.setTimeout(() => ov.classList.add('out'), 1500);
    window.setTimeout(() => ov.remove(), 2100);
  }

  /* ----- atualização ----- */
  update(dt: number): void {
    const { state, clock, services } = this.kit.ctx;
    // detecta level-up mesmo que ninguém emita o evento
    if (state.level > this.shownLevel) this.kit.ctx.bus.emit('levelUp', { level: state.level });
    this.custTimer += dt;
    if (this.custTimer > 0.25) {
      this.custTimer = 0;
      const n = services.npc?.customersInStore() ?? 0;
      if (n !== this.cache.cust) { this.cache.cust = n; this.custEl.textContent = String(n); }
    }
    this.targetMoney = state.money;
    if (this.shownMoney !== this.targetMoney) {
      const diff = this.targetMoney - this.shownMoney;
      this.shownMoney = Math.abs(diff) < 3 ? this.targetMoney : this.shownMoney + diff * Math.min(1, dt * 7);
      this.flash(diff > 0 ? 'up' : 'down');
    }
    this.render(false);
    void clock;
  }

  private flash(dir: 'up' | 'down'): void {
    const c = this.moneyPill.classList;
    c.remove('up', 'down'); c.add(dir);
    if (!c.contains('bump')) { c.add('bump'); window.setTimeout(() => c.remove('bump'), 360); }
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => c.remove('up', 'down'), 700);
  }

  private render(force: boolean): void {
    const { state, clock } = this.kit.ctx;
    const shown = Math.round(this.shownMoney);
    const lowCash = state.money < (state.rent + dailyWages(state)) * 2;
    if (force || lowCash !== this.lowCash) {
      this.lowCash = lowCash;
      this.moneyPill.classList.toggle('low', lowCash);
      this.moneyPill.title = lowCash ? 'Caixa baixo: confira o Banco na aba Finanças' : '';
      this.tabletBtn.classList.toggle('alert', lowCash);
    }
    if (force || shown !== this.lastMoneyVal) { this.lastMoneyVal = shown; this.moneyEl.textContent = money(shown); }
    const c = this.cache;
    if (force || c.level !== state.level || c.xp !== state.xp) {
      c.level = state.level; c.xp = state.xp;
      const lo = xpForLevel(state.level), hi = xpForLevel(state.level + 1);
      const pct = Math.max(0, Math.min(1, (state.xp - lo) / Math.max(1, hi - lo)));
      this.lvlBadge.textContent = String(state.level);
      this.xpBar.style.width = `${(pct * 100).toFixed(1)}%`;
      this.xpText.textContent = `Nível ${state.level}`;
      this.xpPct.textContent = `${state.xp - lo}/${hi - lo} XP`;
    }
    const hhmm = clock.hhmm;
    if (force || c.clock !== hhmm || c.day !== state.day) {
      c.clock = hhmm; c.day = state.day;
      this.clockEl.textContent = hhmm;
      this.phaseEl.textContent = `Dia ${state.day}`;
    }
    if (force || c.phase !== clock.phase) {
      c.phase = clock.phase;
      this.renderStoreBtn();
    }
    const rep = Math.round(state.reputation * 10);
    if (force || c.rep !== rep) {
      c.rep = rep;
      this.repNum.textContent = (rep / 10).toFixed(1).replace('.', ',');
      this.starsEl.replaceChildren(...[0, 1, 2, 3, 4].map((i) => {
        const v = state.reputation - i;
        const s = h('span', { class: v >= 0.75 ? 'on' : v >= 0.25 ? 'on half' : '', html: icon('star', 15) });
        return s;
      }));
    }
  }

  private renderStoreBtn(): void {
    const ph = this.kit.ctx.clock.phase;
    const b = this.storeBtn;
    b.classList.remove('close', 'end', 'pulse');
    b.hidden = ph === 'report';
    if (ph === 'prep') { b.innerHTML = `${icon('store', 24)}Abrir loja`; b.classList.add('pulse'); }
    else if (ph === 'open') { b.innerHTML = `${icon('lock', 22)}Fechar loja`; b.classList.add('close'); }
    else if (ph === 'closing') { b.innerHTML = `${icon('chart', 22)}Encerrar dia`; b.classList.add('end'); }
  }
}
