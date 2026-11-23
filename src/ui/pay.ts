/**
 * Painel de pagamento da Fase 3 (à direita, como na referência), aberto por `checkoutRequest` com `stage:'pay'`.
 * Dinheiro: "Dê o troco" com 5 notas (R$ 2, 5, 10, 20, 50) e 5 moedas (R$ 0,05, 0,10, 0,25, 0,50, 1), desfazer, OK, C.
 * Cartão: maquininha com 1–9, apagar, 0, vírgula, OK e C. Emite `checkout:display` (monitor 3D do world) e, no fim,
 * `checkoutResult {customerId, ok, speed, mistakes}` (speed = só o pagamento). Abre como modal (`ui:modal`) para o
 * player não bipar por trás.
 */
import { DRAWER_BILLS, DRAWER_COINS, customerCashPayment, optimalChange, sum, type Cents } from '../sim/money';
import { clamp, h, money } from './dom';
import { icon } from './icons';
import type { UiKit } from './kit';

export interface PayRequest {
  customerId: number;
  counterId?: number;
  items: { productId: string; qty: number }[];
  total: number;
  method: 'cash' | 'card';
  paid?: number;
  stage?: 'pay';
}

/** Gaveta da referência: notas e moedas em ordem crescente (R$ 2…50; R$ 0,05…1). */
const BILLS3: readonly Cents[] = [...DRAWER_BILLS].sort((a, b) => a - b);
const COINS3: readonly Cents[] = [...DRAWER_COINS].sort((a, b) => a - b);
const BILL_C: Record<number, [string, string]> = {
  200: ['#7cc0f0', '#3a7fbf'], 500: ['#b59af0', '#6f55bd'], 1000: ['#f09a9a', '#bd4c4c'], 2000: ['#f0cf62', '#b8921a'], 5000: ['#f6ae66', '#c4741e'],
};
const COIN_C: Record<number, [string, string]> = {
  5: ['#e0b08f', '#a06a4a'], 10: ['#d8dce3', '#8a919e'], 25: ['#e2bb7c', '#9a6a2a'], 50: ['#d9dde4', '#8a919e'], 100: ['#f1d37a', '#b88f1d'],
};
const coinLabel = (d: Cents): string => (d >= 100 ? '1' : (d / 100).toFixed(2).replace('.', ',').replace(/^0/, ''));
const denLabel = (d: Cents): string => (d >= 100 ? `R$ ${d / 100}` : `R$ ${(d / 100).toFixed(2).replace('.', ',')}`);

/** "37,8" → 3780 centavos (NaN se vazio). */
export function parseTyped(t: string): number {
  if (!t) return 0;
  const [i = '0', f = ''] = t.split(',');
  return Number(i || '0') * 100 + Number((f + '00').slice(0, 2));
}

export class PayPanel {
  private el: HTMLElement | null = null;
  private req: PayRequest | null = null;
  private body!: HTMLElement;
  private meter!: HTMLElement;
  private elapsed = 0;
  private mistakes = 0;
  private usedHint = false;
  private picked: Cents[] = [];
  private typed = '';
  private received = 0;
  private due = 0;
  private done = false;
  private doneT = 0;
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private refresh: () => void = () => {};

  constructor(private kit: UiKit, private layer: HTMLElement) {}
  get isOpen(): boolean { return this.el !== null; }

  open(req: PayRequest): void {
    if (this.el) return;
    this.req = req;
    this.elapsed = 0; this.mistakes = 0; this.usedHint = false; this.picked = []; this.typed = ''; this.done = false;
    const cash = req.method === 'cash';
    this.received = cash ? Math.max(req.total, req.paid ?? customerCashPayment(req.total, this.kit.ctx.rand)) : req.total;
    this.due = Math.max(0, Math.round((this.received - req.total) / 5) * 5);
    this.meter = h('i');
    this.body = h('div', { style: 'display:contents' });
    const x = h('button', { class: 'icon-btn', 'aria-label': 'Cancelar pagamento', html: icon('close', 20), on: { click: () => void this.cancel() } });
    const hint = cash ? h('button', { class: 'icon-btn', 'aria-label': 'Dica de troco', title: 'Dica (reduz a gorjeta)', html: icon('bulb', 20), on: { click: () => this.hint() } }) : null;
    this.el = h('section', { class: `pay ${cash ? 'cash' : 'card'}`, role: 'dialog', 'aria-label': cash ? 'Dê o troco' : 'Maquininha', 'data-customer': req.customerId },
      h('div', { class: 'pay-h' }, hint, h('h3', null, cash ? 'Dê o troco' : 'Maquininha'), x),
      h('div', { class: 'pay-speed', title: 'Rapidez (gorjeta)' }, this.meter),
      this.body);
    if (cash) this.renderCash(); else this.renderCard();
    this.layer.appendChild(this.el);
    this.layer.classList.add('hud-over');
    this.kit.modalOpen('pay', { onEsc: () => void this.cancel() });
    window.addEventListener('keydown', this.keyHandler);
    this.kit.sfx('pop');
    this.display();
  }

  /* ---------------- dinheiro ---------------- */
  private renderCash(): void {
    const info = h('div', { class: 'pay-info' });
    const den = (d: Cents, bill: boolean): HTMLElement => {
      const [c1, c2] = (bill ? BILL_C[d] : COIN_C[d]) ?? ['#ccc', '#999'];
      const face = bill
        ? h('span', { class: 'bill3', style: `--c1:${c1};--c2:${c2}` }, h('i', null, 'R$'), h('b', null, String(d / 100)))
        : h('span', { class: `coin3${d === 100 ? ' bimetal' : ''}`, style: `--c1:${c1};--c2:${c2}` }, coinLabel(d));
      return h('button', { class: 'pay-den', 'data-den': d, 'aria-label': denLabel(d), on: { click: () => this.give(d) } }, h('small', null, bill ? `R$ ${d / 100}` : d >= 100 ? 'R$ 1' : `${d}¢`), face);
    };
    this.refresh = (): void => {
      const giving = sum(this.picked);
      info.replaceChildren(
        h('div', null, 'Recebido', h('b', null, money(this.received))),
        h('div', null, 'Total', h('b', null, money(this.req?.total ?? 0))),
        h('div', { class: 'chg' }, 'Troco', h('b', { id: 'pay-change' }, money(this.due))),
        h('div', { class: 'giv' }, 'Dando', h('b', { id: 'pay-giving', class: giving > this.due ? 'over' : '' }, money(giving))));
    };
    this.body.append(info,
      h('div', { class: 'pay-row bills' }, BILLS3.map((d) => den(d, true))),
      h('div', { class: 'pay-row coins' }, COINS3.map((d) => den(d, false))),
      h('div', { class: 'pay-act' },
        h('button', { class: 'pk blue', 'aria-label': 'Desfazer', html: icon('undo', 28), on: { click: () => { this.picked.pop(); this.changed(); } } }),
        h('button', { class: 'pk green', id: 'pay-ok', on: { click: () => this.confirmCash() } }, 'OK'),
        h('button', { class: 'pk red', 'aria-label': 'Limpar', on: { click: () => { this.picked = []; this.changed(); } } }, 'C')));
    this.refresh();
  }

  private give(d: Cents): void {
    if (this.done || this.picked.length >= 40) return;
    this.picked.push(d);
    this.kit.sfx('coin');
    this.kit.settings.buzz(8);
    this.changed();
  }

  private hint(): void {
    if (this.done) return;
    this.usedHint = true;
    let txt = 'Pagamento exato: não há troco.';
    try { if (this.due > 0) txt = `Dica: ${optimalChange(this.due).map(denLabel).join(' + ')}`; } catch { /* */ }
    this.kit.toast(txt, 'info');
  }

  private confirmCash(): void {
    if (this.done) return;
    const g = sum(this.picked);
    if (g === this.due) { this.kit.sfx('cash'); this.finish(true); return; }
    this.mistake(g > this.due ? 'Troco a mais! Confira o valor do troco.' : 'Troco incompleto. Confira o valor do troco.');
  }

  /* ---------------- cartão ---------------- */
  private renderCard(): void {
    const screen = h('b', { id: 'pay-typed' });
    this.refresh = (): void => { screen.textContent = `R$ ${this.typed || '0'}`; };
    const key = (label: string, fn: () => void, cls = 'blue', aria?: string, htmlLabel?: string): HTMLElement =>
      h('button', { class: `pk ${cls}`, 'data-key': label, 'aria-label': aria ?? label, html: htmlLabel, on: { click: () => { fn(); this.kit.sfx('pop'); this.kit.settings.buzz(6); this.changed(); } } }, htmlLabel ? null : label);
    const digit = (n: number): HTMLElement => key(String(n), () => this.typeChar(String(n)));
    this.body.append(
      h('div', { class: 'pay-screen' }, h('span', null, 'Total', h('small', { class: 'due-in' }, `cobrar ${money(this.req?.total ?? 0)}`)), screen),
      h('div', { class: 'pay-due' }, `Valor da compra: ${money(this.req?.total ?? 0)}`),
      h('div', { class: 'pay-pad' },
        [1, 2, 3].map(digit), key('⌫', () => { this.typed = this.typed.slice(0, -1); }, 'blue', 'Apagar', icon('backspace', 26)),
        [4, 5, 6].map(digit), key(',', () => this.typeChar(','), 'blue', 'Vírgula'),
        [7, 8, 9].map(digit), digit(0),
        h('button', { class: 'pk green ok', id: 'pay-ok', on: { click: () => this.confirmCard() } }, 'OK'),
        key('C', () => { this.typed = ''; }, 'red', 'Limpar')));
    this.reorderPad();
    this.refresh();
  }

  /** Teclado 3 colunas (1-9 / ⌫ 0 , / OK C) ou 4 colunas em telas baixas (o CSS decide a grade; aqui a ordem). */
  private reorderPad(): void {
    const pad = this.el?.querySelector('.pay-pad') ?? this.body.querySelector('.pay-pad');
    if (!pad) return;
    const k = (s: string): Element | null => pad.querySelector(`[data-key="${s}"]`);
    const ok = pad.querySelector('#pay-ok');
    const four = window.innerHeight <= 420;
    const order = four
      ? ['1', '2', '3', '⌫', '4', '5', '6', ',', '7', '8', '9', '0', 'C', 'OK']
      : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ',', 'OK', 'C'];
    for (const s of order) { const e = s === 'OK' ? ok : k(s); if (e) pad.appendChild(e); }
  }

  private typeChar(c: string): void {
    if (this.done) return;
    const t = this.typed;
    if (c === ',') { if (!t.includes(',')) this.typed = (t || '0') + ','; return; }
    const [i = '', f] = t.split(',');
    if (f !== undefined) { if (f.length < 2) this.typed = t + c; return; }
    if (i.length >= 6) return;
    this.typed = i === '0' ? c : t + c;
  }

  private confirmCard(): void {
    if (this.done) return;
    if (parseTyped(this.typed) === this.req?.total) { this.kit.sfx('card'); this.finish(true); return; }
    this.typed = '';
    this.mistake('Valor diferente do total da compra. Digite de novo.');
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.el || this.done || this.req?.method !== 'card') {
      if (this.el && !this.done && e.key === 'Enter') { e.preventDefault(); this.confirmCash(); }
      return;
    }
    if (/^[0-9]$/.test(e.key)) this.typeChar(e.key);
    else if (e.key === ',' || e.key === '.') this.typeChar(',');
    else if (e.key === 'Backspace') this.typed = this.typed.slice(0, -1);
    else if (e.key === 'Enter') { e.preventDefault(); this.confirmCard(); return; }
    else return;
    e.preventDefault();
    this.changed();
  }

  /* ---------------- comum ---------------- */
  private changed(): void { this.refresh(); this.display(); }

  /** Monitor 3D do balcão (world) a partir do último `checkout:display`. */
  private display(): void {
    const r = this.req;
    if (!r) return;
    const base = { counterId: r.counterId ?? null, customerId: r.customerId, total: r.total };
    if (r.method === 'cash') this.kit.ctx.bus.emit('checkout:display', { ...base, mode: 'cash', received: this.received, change: this.due, giving: sum(this.picked) });
    else this.kit.ctx.bus.emit('checkout:display', { ...base, mode: 'card', typed: parseTyped(this.typed), typedText: this.typed });
  }

  private mistake(msg: string): void {
    this.mistakes++;
    this.kit.sfx('error');
    this.kit.settings.buzz([40, 30, 40]);
    this.kit.toast(msg, 'bad');
    const el = this.el;
    if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    this.changed();
  }

  private speed(): number {
    const r = this.req;
    if (!r) return 0;
    let pieces = 1;
    try { pieces = r.method === 'cash' ? Math.max(1, optimalChange(this.due).length) : 4; } catch { /* */ }
    const par = r.method === 'cash' ? 3 + 1.1 * pieces : 6;
    const fast = par * 0.75, slow = par * 2.6;
    const v = 1 - clamp((this.elapsed - fast) / (slow - fast), 0, 1);
    return this.usedHint ? Math.min(v, 0.6) : v;
  }

  private finish(ok: boolean): void {
    const r = this.req;
    if (!r || this.done) return;
    this.done = true;
    const speed = ok ? Math.round(this.speed() * 100) / 100 : 0;
    this.kit.ctx.bus.emit('checkoutResult', { customerId: r.customerId, ok, speed, mistakes: this.mistakes });
    if (!ok) { this.close(); return; }
    this.kit.settings.buzz([20, 30, 20]);
    this.body.replaceChildren(h('div', { class: 'pay-done' }, h('span', { html: icon('check', 48) }), 'Pago!'));
    this.doneT = window.setTimeout(() => this.close(), 650);
  }

  private async cancel(): Promise<void> {
    if (this.done || !this.el) return;
    const ok = await this.kit.confirm({ title: 'Cancelar o pagamento?', text: 'O cliente continua no caixa, mas fica irritado. Toque de novo no dinheiro ou cartão para retomar.', ok: 'Cancelar pagamento', cancel: 'Voltar', danger: true });
    if (ok && !this.done) this.finish(false);
  }

  close(): void {
    window.clearTimeout(this.doneT);
    window.removeEventListener('keydown', this.keyHandler);
    this.el?.remove();
    this.el = null;
    this.req = null;
    this.layer.classList.remove('hud-over');
    this.kit.modalClose('pay');
  }

  update(dt: number): void {
    if (!this.el || this.done) return;
    this.elapsed += dt;
    const sp = this.speed();
    this.meter.style.width = `${(sp * 100).toFixed(0)}%`;
    const cb = this.kit.settings.value.colorblind;
    this.meter.style.background = sp > 0.66 ? (cb ? '#4a9bff' : '#3ddc8e') : sp > 0.33 ? '#ffc94d' : (cb ? '#ff8a1f' : '#ff6368');
  }
}
