/**
 * Fim de dia (Fase 3): resumo no estilo da referência — clientes total/irritados/felizes, rendimento, despesa e lucro,
 * gerente com joinha e "Continue jogando!" — e um "Detalhes" expansível com o relatório completo.
 * Abre só quando o jogador toca em "Terminar o dia" (ou pelo menu de pausa); nunca sozinho em `storeEmpty`.
 */
import * as api from '../sim/api';
import { PRODUCTS } from '../sim/catalog';
import { endDay, shelfCapacity, xpForLevel, type DayReport } from '../sim/economy';
import { billSvg, faceSvg, moonSvg, peopleSvg } from './art';
import { errText, h, isNotImplemented, money } from './dom';
import { icon } from './icons';
import type { UiKit } from './kit';
import { managerSvg } from './manager';
import { badge, kv } from './widgets';

const LAST_KEY = 'mercadinho:lastReport';
const SNAP_KEY = 'mercadinho:daysnap';
interface Snap { day: number; xp: number; level: number }
type Low = { name: string; have: number; cap: number }[];

const readJson = <T,>(k: string): T | null => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : null; } catch { return null; } };
const writeJson = (k: string, v: unknown): void => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privado */ } };

/** Números do resumo (felizes/irritados vêm do sim; relatórios antigos caem em atendidos/perdidos). */
export function summaryOf(r: DayReport): { total: number; happy: number; angry: number; income: number; expense: number; profit: number } {
  const happy = r.happy ?? r.served, angry = r.angry ?? r.lost;
  const income = r.income ?? r.revenue + r.tips, expense = r.expenses ?? r.cogs + r.fixed;
  return { total: happy + angry, happy, angry, income, expense, profit: income - expense };
}

export class Report {
  private el: HTMLElement | null = null;
  /** Chamado depois de "Continue jogando!" (ex.: verificar falência). */
  afterNext: (() => void) | null = null;
  constructor(private kit: UiKit, private layer: HTMLElement) {}
  get isOpen(): boolean { return this.el !== null; }

  /** Marca o início do dia (para calcular XP/nível ganhos). */
  snapshotDay(force = false): void {
    const s = this.kit.ctx.state;
    const snap = readJson<Snap>(SNAP_KEY);
    if (force || !snap || snap.day !== s.day) writeJson(SNAP_KEY, { day: s.day, xp: s.xp, level: s.level } satisfies Snap);
  }

  /** Encerra o dia (api.closeDay) e mostra o resumo. */
  show(): void {
    if (this.el) return;
    const { ctx } = this.kit;
    const s = ctx.state;
    const snap = readJson<Snap>(SNAP_KEY) ?? { day: s.day, xp: s.xp, level: s.level };
    const low: Low = PRODUCTS.filter((p) => s.licenses.includes(p.category) && (s.slots[p.id] ?? 0) > 0)
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

  private render(r: DayReport, prev: DayReport | null, low: Low, gain: { xp: number; lvl: number }, rep0: number): void {
    const m = summaryOf(r);
    const stat = (svg: string, label: string, v: number, id: string): HTMLElement =>
      h('div', { id }, h('span', { html: svg }), h('span', null, h('small', null, label), h('b', null, String(v))));
    const line = (k: string, v: number, cls: string, id: string): HTMLElement[] => [
      h('span', { class: 'k' }, k), h('span', { class: `v ${cls}`, id }, h('span', { html: billSvg(34) }), money(v))];
    const go = h('button', { class: 'btn-go', id: 'sum-next', on: { click: () => this.next(r) } }, 'Continue jogando!');
    const det = h('button', { class: 'btn-det', id: 'sum-details', 'aria-expanded': 'false' }, 'Detalhes ▾');
    this.el = h('div', { class: 'mx-modal cele summary', role: 'dialog', 'aria-label': `Resumo do dia ${r.day}` },
      h('div', { class: 'c-face', html: managerSvg('thumbs') }),
      h('div', { class: 'c-in' }, h('div', { class: 'c-emb', html: moonSvg(110) }),
        h('div', { class: 'ribbon' }, h('b', null, `Dia ${r.day} concluído`)), h('div', { class: 'rib-tab' }, 'Resumo')),
      h('div', { class: 'c-in' }, h('div', { class: 'sum-stats' },
        stat(peopleSvg(40), 'Total', m.total, 'sum-total'), stat(faceSvg('angry', 40), 'Irritados', m.angry, 'sum-angry'), stat(faceSvg('happy', 40), 'Felizes', m.happy, 'sum-happy'))),
      h('div', { class: 'c-band' }, h('div', { class: 'c-in' }, h('div', { class: 'sum-money' },
        line('Rendimento:', m.income, 'pos', 'sum-income'), line('Despesa:', m.expense, 'neg', 'sum-expense'), h('hr'),
        line('Lucro total:', m.profit, m.profit < 0 ? 'neg' : 'pos', 'sum-profit')))),
      h('div', { class: 'c-in' }, h('div', { class: 'c-foot' }, go, det)));
    let sheet: HTMLElement | null = null;
    det.addEventListener('click', () => {
      if (sheet) { sheet.remove(); sheet = null; det.setAttribute('aria-expanded', 'false'); return; }
      const close = (): void => { sheet?.remove(); sheet = null; det.setAttribute('aria-expanded', 'false'); };
      sheet = h('section', { class: 'sum-sheet', role: 'region', 'aria-label': 'Detalhes do dia' },
        h('div', { class: 'ss-head' }, h('h3', null, `Detalhes do dia ${r.day}`), h('button', { class: 'icon-btn', 'aria-label': 'Fechar detalhes', html: icon('close'), on: { click: close } })),
        this.details(r, prev, low, gain, rep0),
        h('div', { class: 'rp-foot' }, h('button', { class: 'btn primary', on: { click: () => this.next(r) } }, h('span', { html: icon('sun', 22) }), 'Continue jogando!')));
      this.el?.appendChild(sheet);
      det.setAttribute('aria-expanded', 'true');
    });
    this.layer.appendChild(this.el);
    this.kit.modalOpen('report', { pauseClock: true });
    this.kit.sfx('cash');
  }

  private delta(cur: number, prev: number | undefined, fmt: (n: number) => string, goodUp = true): HTMLElement | null {
    if (prev === undefined) return null;
    const d = cur - prev;
    if (d === 0) return null;
    const up = d > 0;
    return h('span', { class: `delta ${up === goodUp ? 'up' : 'down'}` }, `${up ? '▲' : '▼'} ${fmt(Math.abs(d))}`);
  }

  private tips(rep: DayReport, low: Low): string[] {
    const s = this.kit.ctx.state;
    const t: string[] = [];
    if (low.length) t.push(`Estoque baixo em ${low.length} ${low.length > 1 ? 'produtos' : 'produto'}. Compre caixas no Mercado e reponha as prateleiras antes de abrir.`);
    if (rep.lost > rep.served) t.push('Mais clientes foram embora do que compraram. Confira estoque e preços: mais de 10% acima do mercado afasta gente.');
    if (rep.netProfit < 0) t.push('Dia no vermelho. Use "Definir todos no sugerido" na aba Preços e revise as despesas fixas.');
    if (s.employees.cashier === 0 && rep.served >= 25) t.push('Você atende muita gente. Contratar um caixa libera seu tempo para repor estoque.');
    if (s.money > Math.max(40 * s.rent, 500000)) t.push('Há bastante caixa parado. Que tal ampliar a loja, comprar uma licença ou mais móveis?');
    if (!t.length) t.push('Bom trabalho! Antes de abrir amanhã, confira os preços do atacado no Mercado.');
    return t.slice(0, 2);
  }

  /** Relatório completo (o mesmo da Fase 2), mostrado em "Detalhes". */
  private details(r: DayReport, prev: DayReport | null, low: Low, gain: { xp: number; lvl: number }, rep0: number): HTMLElement {
    const s = this.kit.ctx.state;
    const rent = r.rent ?? Math.max(0, r.fixed - (r.wages ?? 0) - (r.interest ?? 0));
    const wages = r.wages ?? Math.max(0, r.fixed - rent - (r.interest ?? 0));
    const stars = (v: number): string => '★'.repeat(Math.round(v)) + '☆'.repeat(5 - Math.round(v));
    const m = summaryOf(r);
    return h('div', { class: 'rp-body' },
      h('div', { class: 'rp-sec' }, h('h4', null, 'Resultado'),
        kv('Receita bruta', h('span', null, money(r.revenue), this.delta(r.revenue, prev?.revenue, money))),
        kv('Gorjetas', money(r.tips)),
        kv('Custo das mercadorias (COGS)', money(-r.cogs)),
        kv('Aluguel', money(-rent)),
        kv('Salários', money(-wages)),
        r.interest ? kv('Juros do empréstimo', money(-r.interest)) : null,
        kv('Lucro líquido', h('span', { class: r.netProfit < 0 ? 'bad' : 'good' }, money(r.netProfit, { sign: true }), this.delta(r.netProfit, prev?.netProfit, money)), 'total')),
      h('div', { class: 'rp-sec' }, h('h4', null, 'Caixa'),
        kv('Compras de estoque', money(-r.purchases)),
        kv('Variação de caixa do dia', h('span', { class: r.cashDelta < 0 ? 'bad' : 'good' }, money(r.cashDelta, { sign: true }))),
        kv('Saldo em caixa', money(s.money), 'total')),
      h('div', { class: 'rp-sec' }, h('h4', null, 'Clientes e reputação'),
        kv('Atendidos', h('span', null, String(r.served), this.delta(r.served, prev?.served, String))),
        kv('Perdidos', h('span', null, String(r.lost), this.delta(r.lost, prev?.lost, String, false))),
        kv('Felizes / irritados', `${m.happy} / ${m.angry}`),
        kv('Reputação', h('span', null, `${stars(r.reputation)} ${r.reputation.toFixed(1).replace('.', ',')}`, this.delta(r.reputation, prev ? prev.reputation : rep0, (n) => n.toFixed(1).replace('.', ','))))),
      h('div', { class: 'rp-sec' }, h('h4', null, 'Progresso'),
        kv('XP ganho', `+${Math.max(0, gain.xp)} XP`),
        kv('Nível', h('span', null, `Nível ${s.level}`, gain.lvl > 0 ? badge(`+${gain.lvl} subiu!`, 'good') : null)),
        kv('Próximo nível', `${Math.max(0, xpForLevel(s.level + 1) - s.xp)} XP restantes`)),
      low.length ? h('div', { class: 'rp-sec' }, h('h4', null, 'Estoque baixo'),
        h('div', { class: 'low-list' }, low.map((x) => badge(`${x.name}: ${x.have}/${x.cap}`, x.have === 0 ? 'bad' : 'warn')))) : null,
      this.tips(r, low).map((t) => h('div', { class: 'tip', html: `${icon('bulb', 22)}` }, h('span', null, t))));
  }

  private next(r: DayReport): void {
    const { ctx } = this.kit;
    if (!this.el) return;
    writeJson(LAST_KEY, r);
    ctx.clock.startNextDay();
    ctx.save();
    ctx.bus.emit('dayEnded', r);
    this.snapshotDay(true);
    this.el.remove();
    this.el = null;
    this.kit.modalClose('report');
    this.kit.toast(`Dia ${ctx.state.day} começou. Prepare a loja e abra pela placa da porta.`, 'info');
    this.afterNext?.();
  }
}
