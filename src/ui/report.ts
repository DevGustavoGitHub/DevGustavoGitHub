/** Relatório de fim de dia. */
import * as api from '../sim/api';
import { PRODUCTS } from '../sim/catalog';
import { dailyWages, endDay, shelfCapacity, xpForLevel, type DayReport } from '../sim/economy';
import { errText, h, isNotImplemented, money } from './dom';
import { icon } from './icons';
import type { UiKit } from './kit';
import { badge, kv } from './widgets';

const LAST_KEY = 'mercadinho:lastReport';
const SNAP_KEY = 'mercadinho:daysnap';
interface Snap { day: number; xp: number; level: number }

const readJson = <T,>(k: string): T | null => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : null; } catch { return null; } };
const writeJson = (k: string, v: unknown): void => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privado */ } };

export class Report {
  private el: HTMLElement | null = null;
  constructor(private kit: UiKit, private layer: HTMLElement) {}
  get isOpen(): boolean { return this.el !== null; }

  /** Marca o início do dia (para calcular XP/nível ganhos). */
  snapshotDay(force = false): void {
    const s = this.kit.ctx.state;
    const snap = readJson<Snap>(SNAP_KEY);
    if (force || !snap || snap.day !== s.day) writeJson(SNAP_KEY, { day: s.day, xp: s.xp, level: s.level } satisfies Snap);
  }

  /** Encerra o dia (api.closeDay) e mostra o relatório. */
  show(): void {
    if (this.el) return;
    const { ctx } = this.kit;
    const s = ctx.state;
    const snap = readJson<Snap>(SNAP_KEY) ?? { day: s.day, xp: s.xp, level: s.level };
    const low = PRODUCTS.filter((p) => s.licenses.includes(p.category) && (s.slots[p.id] ?? 0) > 0)
      .map((p) => ({ name: p.name, have: s.shelf[p.id] ?? 0, cap: shelfCapacity(s, p.id) }))
      .filter((x) => x.have <= x.cap * 0.3);
    const rep0 = s.reputation;
    let rep: DayReport;
    try {
      try { rep = api.closeDay(s); } catch (e) { if (isNotImplemented(e)) rep = endDay(s); else throw e; }
    } catch (e) {
      this.kit.toast(errText(e), 'bad');
      return;
    }
    ctx.clock.phase = 'report';
    ctx.save();
    const prev = readJson<DayReport>(LAST_KEY);
    this.render(rep, prev && prev.day === rep.day - 1 ? prev : null, low, { xp: s.xp - snap.xp, lvl: s.level - snap.level }, rep0);
  }

  private delta(cur: number, prev: number | undefined, fmt: (n: number) => string, goodUp = true): HTMLElement | null {
    if (prev === undefined) return null;
    const d = cur - prev;
    if (d === 0) return null;
    const up = d > 0;
    return h('span', { class: `delta ${up === goodUp ? 'up' : 'down'}` }, `${up ? '▲' : '▼'} ${fmt(Math.abs(d))}`);
  }

  private tips(rep: DayReport, low: { name: string }[]): string[] {
    const s = this.kit.ctx.state;
    const t: string[] = [];
    if (low.length) t.push(`Estoque baixo em ${low.length} ${low.length > 1 ? 'produtos' : 'produto'}. Compre caixas no Mercado e reponha as prateleiras antes de abrir.`);
    if (rep.lost > rep.served) t.push('Mais clientes foram embora do que compraram. Confira estoque e preços: acima de 12% do mercado afasta gente.');
    if (rep.netProfit < 0) t.push('Dia no vermelho. Use "Definir todos pelo sugerido" na aba Preços e revise as despesas fixas.');
    if (s.employees.cashier === 0 && rep.served >= 25) t.push('Você atende muita gente. Contratar um caixa libera seu tempo para repor estoque.');
    if (s.money > 40 * s.rent && s.expansion < 4) t.push('Há bastante caixa parado. Que tal ampliar a loja, comprar uma licença ou mais móveis?');
    if (!t.length) t.push('Bom trabalho! Antes de abrir amanhã, olhe os preços do atacado no Mercado.');
    return t.slice(0, 2);
  }

  private render(r: DayReport, prev: DayReport | null, low: { name: string; have: number; cap: number }[], gain: { xp: number; lvl: number }, rep0: number): void {
    const s = this.kit.ctx.state;
    const wages = Math.max(0, r.fixed - s.rent);
    const stars = (v: number): string => '★'.repeat(Math.round(v)) + '☆'.repeat(5 - Math.round(v));
    const next = h('button', { class: 'btn primary', on: { click: () => this.next(r) } }, h('span', { html: icon('sun', 22) }), 'Próximo dia');
    this.el = h('div', { class: 'mx-modal mx-dim mx-z-report', role: 'dialog', 'aria-label': 'Relatório do dia' },
      h('div', { class: 'report' },
        h('div', { class: 'rp-head' }, h('small', null, 'Fim de expediente'), h('h2', null, `Dia ${r.day} encerrado`),
          h('div', { class: 'rp-big' }, h('b', { class: r.netProfit < 0 ? 'neg' : '' }, money(r.netProfit, { sign: true })), h('span', null, 'lucro líquido do dia'))),
        h('div', { class: 'rp-body' },
          h('div', { class: 'rp-sec' }, h('h4', null, 'Resultado'),
            kv('Receita bruta', h('span', null, money(r.revenue), this.delta(r.revenue, prev?.revenue, money))),
            kv('Gorjetas', money(r.tips)),
            kv('Custo das mercadorias (COGS)', money(-r.cogs)),
            kv('Aluguel', money(-s.rent)),
            kv('Salários', money(-wages)),
            kv('Lucro líquido', h('span', { class: r.netProfit < 0 ? 'bad' : 'good' }, money(r.netProfit, { sign: true }), this.delta(r.netProfit, prev?.netProfit, money)), 'total')),
          h('div', { class: 'rp-sec' }, h('h4', null, 'Caixa'),
            kv('Compras de estoque', money(-r.purchases)),
            kv('Variação de caixa do dia', h('span', { class: r.cashDelta < 0 ? 'bad' : 'good' }, money(r.cashDelta, { sign: true }))),
            kv('Saldo em caixa', money(s.money), 'total')),
          h('div', { class: 'rp-sec' }, h('h4', null, 'Clientes e reputação'),
            kv('Atendidos', h('span', null, String(r.served), this.delta(r.served, prev?.served, String))),
            kv('Perdidos', h('span', null, String(r.lost), this.delta(r.lost, prev?.lost, String, false))),
            kv('Reputação', h('span', null, `${stars(r.reputation)} ${r.reputation.toFixed(1).replace('.', ',')}`, this.delta(r.reputation, prev ? prev.reputation : rep0, (n) => n.toFixed(1).replace('.', ','))))),
          h('div', { class: 'rp-sec' }, h('h4', null, 'Progresso'),
            kv('XP ganho', `+${Math.max(0, gain.xp)} XP`),
            kv('Nível', h('span', null, `Nível ${s.level}`, gain.lvl > 0 ? badge(`+${gain.lvl} subiu!`, 'good') : null)),
            kv('Próximo nível', `${Math.max(0, xpForLevel(s.level + 1) - s.xp)} XP restantes`)),
          low.length ? h('div', { class: 'rp-sec' }, h('h4', null, 'Estoque baixo'),
            h('div', { class: 'low-list' }, low.map((x) => badge(`${x.name}: ${x.have}/${x.cap}`, x.have === 0 ? 'bad' : 'warn')))) : null,
          this.tips(r, low).map((t) => h('div', { class: 'tip', html: `${icon('bulb', 22)}` }, h('span', null, t)))),
        h('div', { class: 'rp-foot' }, next)));
    this.layer.appendChild(this.el);
    this.kit.modalOpen('report', { pauseClock: true });
    this.kit.sfx('cash');
    void dailyWages;
  }

  private next(r: DayReport): void {
    const { ctx } = this.kit;
    writeJson(LAST_KEY, r);
    ctx.clock.startNextDay();
    ctx.save();
    ctx.bus.emit('dayEnded', r);
    this.snapshotDay(true);
    this.el?.remove();
    this.el = null;
    this.kit.modalClose('report');
    this.kit.toast(`Dia ${ctx.state.day} começou. Prepare a loja e abra quando quiser.`, 'info');
  }
}
