/** Tela de falência: explica o que aconteceu, o que é mantido e oferece o recomeço guiado. */
import * as api from '../sim/api';
import { h, money } from './dom';
import { icon } from './icons';
import type { UiKit } from './kit';
import { safe } from './safe';

export class Bankruptcy {
  private el: HTMLElement | null = null;
  constructor(private kit: UiKit, private layer: HTMLElement) {}
  get isOpen(): boolean { return this.el !== null; }

  /** Verifica `api.isBankrupt` e mostra a tela se for o caso. Retorna true quando a loja está falida. */
  check(): boolean {
    if (this.el) return true;
    const r = safe(() => api.isBankrupt(this.kit.ctx.state), false);
    if (r.v) this.show();
    return r.v;
  }

  private show(): void {
    const { ctx } = this.kit;
    const s = ctx.state;
    const loan = safe(() => api.loanInfo(s), null).v;
    const restart = h('button', { class: 'btn primary', id: 'bk-restart', on: { click: () => this.restart() } }, h('span', { html: icon('sun', 22) }), 'Recomeçar');
    this.el = h('div', { class: 'mx-modal bankrupt', role: 'alertdialog', 'aria-label': 'Falência', 'aria-modal': 'true' },
      h('div', { class: 'bk-card' },
        h('div', { class: 'bk-ico', html: icon('bank', 34) }),
        h('h2', null, `${s.storeName} faliu`),
        h('p', null, 'O caixa acabou, não há mais crédito no banco e o estoque não cobre o que a loja deve. Acontece com muito comerciante: o importante é o que se aprende. Dá para recomeçar sem perder o que você conquistou.'),
        h('div', { class: 'bk-cols' },
          h('div', { class: 'bk-box' }, h('h4', null, 'Situação'),
            h('ul', null,
              h('li', null, `Caixa: ${money(s.money)}`),
              loan ? h('li', null, `Dívida: ${money(loan.owed)}`) : null,
              h('li', null, `Dia ${s.day}`))),
          h('div', { class: 'bk-box' }, h('h4', null, 'O que você mantém'),
            h('ul', null,
              h('li', null, `Nível ${s.level}`),
              h('li', null, `${s.licenses.length} ${s.licenses.length > 1 ? 'licenças' : 'licença'}`),
              h('li', null, 'Decoração e nome da loja'),
              h('li', null, 'Melhorias compradas'))),
          h('div', { class: 'bk-box' }, h('h4', null, 'O que volta ao começo'),
            h('ul', null,
              h('li', null, 'Dívida zerada'),
              h('li', null, 'Estoque, funcionários e expansões'),
              h('li', null, 'Layout inicial da loja')))),
        h('p', null, 'No recomeço a dívida é zerada e você recebe um capital inicial menor que o do primeiro dia. O jogo salvo não é apagado.'),
        restart));
    this.layer.appendChild(this.el);
    this.kit.modalOpen('bankrupt', { pauseClock: true });
    this.kit.sfx('error');
    this.kit.settings.buzz([60, 40, 60]);
  }

  private restart(): void {
    const { ctx } = this.kit;
    const ok = this.kit.act('bankruptcy', () => api.restartAfterBankruptcy(ctx.state), undefined, 'levelup');
    if (ok === undefined && safe(() => api.isBankrupt(ctx.state), false).v) return; // falhou: continua na tela
    this.el?.remove();
    this.el = null;
    this.kit.modalClose('bankrupt');
    if (ctx.clock.phase !== 'prep') ctx.clock.startNextDay();
    ctx.save();
    this.kit.toast('Novo começo! Reponha as prateleiras e abra a loja quando quiser.', 'good');
  }
}
