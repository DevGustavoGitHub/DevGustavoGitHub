/** Minigame de checkout: escanear itens e receber (dinheiro com troco ou cartão). */
import { DENOMS, BILLS, COINS, changeDue, customerCashPayment, isCardAmountCorrect, isChangeCorrect, optimalChange, sum, type Cents } from '../sim/money';
import { productById } from '../sim/catalog';
import { sellPrice } from '../sim/market';
import { clamp, h, money, moneyShort } from './dom';
import { icon } from './icons';
import { denomEl } from './denoms';
import type { UiKit } from './kit';

export interface CheckoutRequest {
  customerId: number;
  items: { productId: string; qty: number }[];
  total: number;
  method: 'cash' | 'card';
  paid?: number;
}

type Stage = 'scan' | 'pay' | 'done';

export class Checkout {
  private wrap: HTMLElement | null = null;
  private req: CheckoutRequest | null = null;
  private stage: Stage = 'scan';
  private elapsed = 0;
  private mistakes = 0;
  private usedHint = false;
  private scanned = new Set<number>();
  private picked: Cents[] = [];
  private typed = 0;
  private due = 0;
  private paid = 0;
  private panel!: HTMLElement;
  private stageBody!: HTMLElement;
  private meter!: HTMLElement;
  private bagCount!: HTMLElement;
  private bag!: HTMLElement;
  private doneTimer = 0;
  private hudT = 0;
  private onResize = (): void => this.syncHud();

  constructor(private kit: UiKit, private layer: HTMLElement) {}

  get isOpen(): boolean { return this.wrap !== null; }

  open(req: CheckoutRequest): void {
    if (this.wrap) return;
    this.req = req;
    this.stage = 'scan';
    this.mistakes = 0; this.usedHint = false; this.scanned.clear(); this.picked = []; this.typed = 0;
    this.elapsed = 0;
    this.paid = req.method === 'cash' ? Math.max(req.total, req.paid ?? customerCashPayment(req.total, this.kit.ctx.rand)) : req.total;
    this.due = Math.round((this.paid - req.total) / 5) * 5;

    this.meter = h('i');
    this.bagCount = h('b', null, '0');
    this.bag = h('div', { class: 'ck-bag', 'aria-label': 'Sacola' }, h('span', { html: icon('cart', 26) }), this.bagCount);
    this.stageBody = h('div', { class: 'ck-body' });
    this.panel = h('section', { class: 'ck', role: 'dialog', 'aria-label': 'Caixa' },
      h('header', { class: 'ck-head' },
        h('div', { class: 'ck-title' }, h('b', null, `Cliente ${req.customerId}`), h('small', null, req.method === 'cash' ? 'Pagando em dinheiro' : 'Pagando no cartão')),
        h('div', { class: 'ck-speed', title: 'Rapidez (gorjeta)' }, this.meter),
        this.bag,
        h('button', { class: 'btn ghost small ck-skip', on: { click: () => void this.skip() } }, 'Pular')),
      this.stageBody);
    this.wrap = h('div', { class: 'ck-wrap' }, this.panel);
    this.layer.appendChild(this.wrap);
    this.syncHud();
    window.addEventListener('resize', this.onResize);
    this.kit.modalOpen('checkout');
    this.kit.sfx('pop');
    this.renderScan();
  }

  /* ---------------- escanear ---------------- */
  private renderScan(): void {
    const req = this.req;
    if (!req) return;
    const body = this.stageBody;
    body.replaceChildren();
    body.className = 'ck-body scan';
    const belt = h('div', { class: 'belt' });
    req.items.forEach((it, i) => {
      let name = it.productId, price = 0;
      try { name = productById(it.productId).name; price = sellPrice(this.kit.ctx.state, it.productId) * it.qty; } catch { /* produto desconhecido */ }
      const chip = h('button', { class: 'item', 'data-i': i, 'aria-label': `Bipar ${name}` },
        h('span', { class: 'ibox' }, name.slice(0, 1).toUpperCase()),
        h('span', { class: 'it' }, h('b', null, name), h('small', null, `${it.qty} × ${money(price / Math.max(1, it.qty))}`)),
        h('span', { class: 'ip' }, money(price)),
        h('i', { class: 'beam' }));
      chip.addEventListener('click', () => this.scan(i, chip));
      belt.appendChild(chip);
    });
    body.append(
      h('p', { class: 'ck-hint' }, h('span', { html: icon('hand', 18) }), 'Toque em cada item para passar no leitor.'),
      belt,
      h('div', { class: 'ck-foot' }, h('span', { class: 'cnt' }, `0/${req.items.length} itens`), h('b', { class: 'run' }, money(0))));
    if (req.items.length === 0) this.toPay();
  }

  private scan(i: number, chip: HTMLElement): void {
    const req = this.req;
    if (!req || this.stage !== 'scan' || this.scanned.has(i)) return;
    this.scanned.add(i);
    this.kit.sfx('scan');
    this.kit.settings.buzz(12);
    chip.classList.add('scanned');
    this.fly(chip);
    const cnt = this.stageBody.querySelector('.cnt');
    if (cnt) cnt.textContent = `${this.scanned.size}/${req.items.length} itens`;
    const run = this.stageBody.querySelector('.run');
    if (run) {
      let acc = 0;
      this.scanned.forEach((k) => { const it = req.items[k]; if (it) { try { acc += sellPrice(this.kit.ctx.state, it.productId) * it.qty; } catch { /* */ } } });
      run.textContent = money(this.scanned.size === req.items.length ? req.total : acc);
    }
    if (this.scanned.size === req.items.length) window.setTimeout(() => { if (this.stage === 'scan') this.toPay(); }, 520);
  }

  private fly(chip: HTMLElement): void {
    const a = chip.getBoundingClientRect(), b = this.bag.getBoundingClientRect();
    const ghost = h('span', { class: 'ghost-item', style: `left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px` });
    this.wrap?.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = ghost.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.12)`, opacity: 0.2 }], { duration: 420, easing: 'cubic-bezier(.5,0,.8,.4)' });
    anim.onfinish = () => {
      ghost.remove();
      this.bagCount.textContent = String(this.scanned.size);
      this.bag.classList.remove('bump'); void this.bag.offsetWidth; this.bag.classList.add('bump');
    };
  }

  /* ---------------- pagamento ---------------- */
  private toPay(): void {
    if (!this.req || this.stage !== 'scan') return;
    this.stage = 'pay';
    if (this.req.method === 'cash') this.renderCash(); else this.renderCard();
  }

  private amountBox(label: string, value: string, cls = ''): HTMLElement {
    return h('div', { class: `amt ${cls}` }, h('small', null, label), h('b', null, value));
  }

  private renderCash(): void {
    const body = this.stageBody;
    body.replaceChildren();
    body.className = 'ck-body pay cash';
    const tray = h('div', { class: 'tray' });
    const trayTotal = h('b', { class: 'tt' });
    const hint = h('div', { class: 'hint-line', hidden: true });
    const send = h('button', { class: 'btn primary ck-ok' }, h('span', { html: icon('check', 22) }), 'Entregar troco');
    const redraw = (): void => {
      tray.replaceChildren(...(this.picked.length ? this.picked.map((d, i) => denomEl(d, { mini: true, onClick: () => { this.picked.splice(i, 1); redraw(); } })) : [h('span', { class: 'placeholder' }, 'Toque nas cédulas e moedas para montar o troco')]));
      const t = sum(this.picked);
      trayTotal.textContent = money(t);
      trayTotal.className = `tt ${t > this.due ? 'over' : t === this.due ? 'ok' : ''}`;
    };
    const mk = (list: readonly Cents[]): HTMLElement[] => list.map((d) => denomEl(d, { onClick: () => { this.picked.push(d); this.kit.sfx('coin'); this.kit.settings.buzz(8); redraw(); } }));
    send.addEventListener('click', () => this.deliverChange(tray, send));
    body.append(
      h('div', { class: 'col l' },
        h('div', { class: 'amts' }, this.amountBox('Total', money(this.req?.total ?? 0)), this.amountBox('Recebido', money(this.paid)), this.amountBox('Troco devido', money(this.due), 'due')),
        h('div', { class: 'tray-wrap' }, h('div', { class: 'tray-h' }, h('span', null, 'Troco montado'), trayTotal), tray),
        hint,
        h('div', { class: 'ck-actions' },
          h('button', { class: 'btn small', 'aria-label': 'Desfazer', on: { click: () => { this.picked.pop(); redraw(); } } }, h('span', { html: icon('undo', 18) }), 'Desfazer'),
          h('button', { class: 'btn small', on: { click: () => { this.picked = []; redraw(); } } }, 'Limpar'),
          h('button', { class: 'btn small', on: { click: () => this.showHint(hint) } }, h('span', { html: icon('bulb', 18) }), 'Dica')),
        send),
      h('div', { class: 'col r drawer', 'aria-label': 'Gaveta do caixa' },
        h('div', { class: 'drawer-row bills' }, mk(BILLS)),
        h('div', { class: 'drawer-row coins' }, mk(COINS))));
    redraw();
    void DENOMS;
  }

  private showHint(el: HTMLElement): void {
    this.usedHint = true;
    el.hidden = false;
    el.replaceChildren(h('span', null, 'Dica:'), ...(() => { try { return optimalChange(this.due).map((d) => denomEl(d, { mini: true })); } catch { return [h('span', null, moneyShort(this.due))]; } })());
    if (this.due === 0) el.replaceChildren(h('span', null, 'Pagamento exato: não há troco.'));
  }

  private deliverChange(tray: HTMLElement, btn: HTMLButtonElement): void {
    if (this.stage !== 'pay') return;
    if (isChangeCorrect(this.picked, this.due)) {
      this.kit.sfx('cash');
      this.finish(true);
    } else {
      this.fail(tray);
      this.kit.toast(sum(this.picked) > this.due ? 'Troco a mais! Confira o valor devido.' : 'Troco incompleto. Confira o valor devido.', 'bad');
      btn.blur();
    }
  }

  private fail(shaker: HTMLElement): void {
    this.mistakes++;
    this.kit.sfx('error');
    this.kit.settings.buzz([40, 30, 40]);
    shaker.classList.remove('shake'); void shaker.offsetWidth; shaker.classList.add('shake');
    this.panel.classList.remove('shake'); void this.panel.offsetWidth; this.panel.classList.add('shake');
  }

  private renderCard(): void {
    const body = this.stageBody;
    body.replaceChildren();
    body.className = 'ck-body pay card';
    const screen = h('output', { class: 'screen' });
    const redraw = (): void => { screen.textContent = money(this.typed); };
    const key = (label: string | Node, fn: () => void, cls = ''): HTMLElement => h('button', { class: `key ${cls}`, on: { click: () => { fn(); this.kit.sfx('pop'); this.kit.settings.buzz(6); redraw(); } } }, label);
    const digit = (d: number): HTMLElement => key(String(d), () => { if (this.typed < 1e7) this.typed = this.typed * 10 + d; });
    const pad = h('div', { class: 'keypad' },
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit),
      key('C', () => { this.typed = 0; }, 'fn'), digit(0),
      key(h('span', { html: icon('backspace', 24) }), () => { this.typed = Math.floor(this.typed / 10); }, 'fn'));
    const ok = h('button', { class: 'btn primary ck-ok' }, h('span', { html: icon('card', 22) }), 'Cobrar');
    ok.addEventListener('click', () => {
      if (this.stage !== 'pay') return;
      if (isCardAmountCorrect(this.typed, this.req?.total ?? -1)) { this.kit.sfx('card'); this.finish(true); }
      else { this.fail(screen); this.kit.toast('Valor diferente do total. Digite o total da compra.', 'bad'); this.typed = 0; redraw(); }
    });
    body.append(
      h('div', { class: 'col l' },
        h('div', { class: 'amts' }, this.amountBox('Total da compra', money(this.req?.total ?? 0), 'due')),
        h('div', { class: 'reader' }, h('small', null, 'Maquininha — digite o valor'), screen),
        h('p', { class: 'ck-hint' }, 'Os dígitos entram da direita para a esquerda, como na maquininha.'),
        ok),
      h('div', { class: 'col r' }, pad));
    redraw();
  }

  /* ---------------- fim ---------------- */
  private speed(): number {
    const req = this.req;
    if (!req) return 0;
    const n = Math.max(1, req.items.length);
    const par = 4 + 1.6 * n + (req.method === 'cash' ? 7 : 6);
    const fast = par * 0.7, slow = par * 2.4;
    const v = 1 - clamp((this.elapsed - fast) / (slow - fast), 0, 1);
    return this.usedHint ? Math.min(v, 0.6) : v;
  }

  private finish(ok: boolean): void {
    const req = this.req;
    if (!req || this.stage === 'done') return;
    this.stage = 'done';
    const speed = ok ? Math.round(this.speed() * 100) / 100 : 0;
    const mistakes = this.mistakes;
    this.kit.ctx.bus.emit('checkoutResult', { customerId: req.customerId, ok, speed, mistakes });
    this.kit.settings.buzz(ok ? [20, 30, 20] : 30);
    if (!ok) { this.close(); return; }
    this.stageBody.replaceChildren(h('div', { class: 'done' }, h('span', { class: 'big', html: icon('check', 56) }),
      h('b', null, 'Venda concluída!'),
      h('small', null, `Rapidez ${Math.round(speed * 100)}%${mistakes ? ` · ${mistakes} ${mistakes > 1 ? 'erros' : 'erro'}` : ' · sem erros'}`)));
    this.stageBody.className = 'ck-body done-wrap';
    this.doneTimer = window.setTimeout(() => this.close(), 900);
  }

  private async skip(): Promise<void> {
    if (this.stage === 'done') return;
    const ok = await this.kit.confirm({ title: 'Pular este cliente?', text: 'A venda não será concluída e o cliente vai embora insatisfeito.', ok: 'Pular venda', danger: true });
    if (ok && (this.stage as Stage) !== 'done') this.finish(false);
  }

  close(): void {
    window.clearTimeout(this.doneTimer);
    window.removeEventListener('resize', this.onResize);
    this.wrap?.remove();
    this.wrap = null;
    this.req = null;
    this.kit.modalClose('checkout');
  }

  /** Mede a base do HUD (barra superior) para o painel nunca sobrepô-lo, em retrato ou paisagem baixa. */
  private syncHud(): void {
    const wrap = this.wrap;
    const hud = this.layer.querySelector<HTMLElement>('.hud');
    if (!wrap || !hud) return;
    const lr = this.layer.getBoundingClientRect();
    const scale = this.layer.offsetHeight > 0 ? lr.height / this.layer.offsetHeight : 1;
    const bottom = (hud.getBoundingClientRect().bottom - lr.top) / (scale || 1);
    if (Number.isFinite(bottom) && bottom > 0) wrap.style.setProperty('--hud-b', `${Math.ceil(bottom)}px`);
  }

  update(dt: number): void {
    if (!this.wrap || this.stage === 'done') return;
    this.hudT += dt;
    if (this.hudT > 0.5) { this.hudT = 0; this.syncHud(); }
    this.elapsed += dt;
    const sp = this.speed();
    this.meter.style.width = `${(sp * 100).toFixed(0)}%`;
    const cb = this.kit.settings.value.colorblind;
    this.meter.style.background = sp > 0.66 ? (cb ? '#4a9bff' : '#3ddc8e') : sp > 0.33 ? '#ffc94d' : (cb ? '#ff8a1f' : '#ff6368');
  }
}
