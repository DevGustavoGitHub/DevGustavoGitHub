/**
 * Comemoração de nível (layout da referência): gerente original comemorando, "Parabéns — Nível N",
 * "Agora disponível" com o que tem minLevel === N, botão "Continue jogando!". Fila para vários níveis seguidos.
 * Também a folha de nível (toque na estrela do HUD): XP, novidades não vistas e o que vem no próximo nível.
 */
import { xpForLevel } from '../sim/economy';
import { emblemSvg, starSvg } from './art';
import { h } from './dom';
import type { UiKit } from './kit';
import { managerSvg } from './manager';
import { markAllSeen, nextUnlocks, unlocksAt, unseenItems, type Unlock } from './unlocks';

const COLORS = ['#ff9330', '#2fcf4a', '#ffd23f', '#1ea0f2', '#f0483e', '#d86fa1'];

export function confetti(into: HTMLElement, n = 26): void {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6, d = 120 + Math.random() * 220;
    into.appendChild(h('i', { class: 'spark', style: `background:${COLORS[i % COLORS.length]};left:50%;top:22%;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d + 160}px;--rot:${Math.random() * 720}deg;animation-duration:${1.2 + Math.random() * 0.8}s` }));
  }
}

function itemEl(u: Unlock, i: number): HTMLElement {
  return h('div', { class: 'c-item', style: `animation-delay:${0.15 + i * 0.08}s` },
    h('span', { class: 'new-tag' }, 'Novo!'), h('div', { class: 'ic', html: u.icon(60) }), h('small', null, u.name));
}

export class Celebrate {
  private queue: number[] = [];
  private el: HTMLElement | null = null;
  private building = false;
  private shownMax: number;
  private queuedAt = 0;
  constructor(private kit: UiKit, private layer: HTMLElement) {
    this.shownMax = kit.ctx.state.level;
    kit.ctx.bus.on('build:state', (p?: { active: boolean }) => { this.building = !!p?.active; });
  }
  get isOpen(): boolean { return this.el !== null; }

  push(level: number): void {
    if (!Number.isFinite(level) || level <= this.shownMax || this.queue.includes(level)) return;
    this.queue.push(level);
    this.queue.sort((a, b) => a - b);
    if (!this.queuedAt) this.queuedAt = performance.now();
  }

  update(): void {
    if (this.el || !this.queue.length || this.building || this.kit.isModalOpen()) return;
    const lv = this.queue.shift();
    if (lv !== undefined) this.show(lv);
  }

  show(level: number): void {
    const { ctx } = this.kit;
    this.shownMax = Math.max(this.shownMax, level);
    const items = unlocksAt(ctx.state, level);
    const nxt = nextUnlocks(ctx.state, level);
    const go = h('button', { class: 'btn-go', on: { click: () => this.next() } }, 'Continue jogando!');
    this.el = h('div', { class: 'mx-modal cele', role: 'dialog', 'aria-label': `Parabéns, nível ${level}` },
      h('div', { class: 'c-face', html: managerSvg('cheer') }),
      h('div', { class: 'c-in' }, h('div', { class: 'c-emb', html: emblemSvg(110) }),
        h('div', { class: 'ribbon' }, h('b', null, 'Parabéns')), h('div', { class: 'rib-tab' }, `Nível ${level}`)),
      h('div', { class: 'c-band' }, h('div', { class: 'c-in' },
        h('h4', null, items.length ? 'Agora disponível' : 'Continue assim!'),
        items.length ? h('div', { class: 'c-items' }, items.map(itemEl))
          : h('div', { class: 'c-none' }, nxt ? `No nível ${nxt.level}: ${nxt.items.map((u) => u.name).join(', ')}.` : 'Você liberou tudo. Agora é crescer!'))),
      h('div', { class: 'c-in' }, go));
    confetti(this.el);
    this.layer.appendChild(this.el);
    this.kit.modalOpen('celebrate', { pauseClock: true, onEsc: () => this.next() });
    // o evento levelUp já toca 'levelup'; a fanfarra só entra se a tela abriu bem depois
    if (performance.now() - this.queuedAt > 1200) this.kit.sfx('celebrate');
    this.queuedAt = 0;
    this.kit.settings.buzz([30, 40, 60]);
    window.setTimeout(() => go.focus({ preventScroll: true }), 50);
  }

  private next(): void {
    this.el?.remove();
    this.el = null;
    this.kit.modalClose('celebrate');
    const lv = this.queue.shift();
    if (lv !== undefined) this.show(lv);
  }
}

/** Folha de nível (estrela do HUD): XP, novidades e próximo nível. Marca tudo como visto. */
export class LevelSheet {
  private el: HTMLElement | null = null;
  constructor(private kit: UiKit, private layer: HTMLElement, private goto: (tab: string) => void) {}
  get isOpen(): boolean { return this.el !== null; }

  open(): void {
    if (this.el || this.kit.isModalOpen()) return;
    const s = this.kit.ctx.state;
    const news = unseenItems(s);
    markAllSeen(s);
    const lo = xpForLevel(s.level), hi = xpForLevel(s.level + 1);
    const pct = Math.max(0, Math.min(1, (s.xp - lo) / Math.max(1, hi - lo)));
    const nxt = nextUnlocks(s, s.level);
    const close = (): void => { this.el?.remove(); this.el = null; this.kit.modalClose('level'); };
    const row = (u: Unlock, isNew: boolean): HTMLElement => h('div', { class: 'urow' },
      h('span', { class: 'ic', html: u.icon(40) }), h('b', null, u.name), isNew ? h('span', { class: 'new-tag' }, 'Novo') : null,
      h('button', { class: 'btn small', on: { click: () => { close(); this.goto(u.tab); } } }, 'Ver'));
    this.el = h('div', { class: 'mx-modal mx-dim lvl-wrap', role: 'dialog', 'aria-label': 'Nível' },
      h('div', { class: 'lvl-sheet' },
        h('div', { class: 'mx-row' }, h('h3', { style: 'flex:1', html: `${starSvg(40)}<span>Nível ${s.level}</span>` }),
          h('button', { class: 'icon-btn', 'aria-label': 'Fechar', on: { click: close } }, '✕')),
        h('div', { class: 'xp3' }, h('i', { style: `width:${(pct * 100).toFixed(1)}%` })),
        h('small', null, `${s.xp - lo} de ${hi - lo} XP para o nível ${s.level + 1}. Venda e atenda rápido para ganhar XP.`),
        news.length ? h('h4', null, 'Novidades liberadas') : null,
        news.length ? h('div', { class: 'ulist' }, news.map((u) => row(u, true))) : null,
        nxt ? h('h4', null, `No nível ${nxt.level}`) : null,
        nxt ? h('div', { class: 'ulist' }, nxt.items.map((u) => h('div', { class: 'urow' }, h('span', { class: 'ic', html: u.icon(40) }), h('b', null, u.name)))) : null));
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) close(); });
    this.layer.appendChild(this.el);
    this.kit.modalOpen('level', { onEsc: close });
    this.kit.sfx('pop');
  }
}
