/**
 * Controles de jogo na tela (dono: player, z-index 30): mira central, botão de AÇÃO grande (mão + rótulo, anel verde
 * quando há alvo), Arremessar / Largar / Abrir-Fechar caixa (com caixa na mão), Mover (secundário) e o botão laranja
 * "Sair do caixa" (sentado). O contêiner não captura toques; só os botões (≥ 48 px) capturam.
 */
import { ICON_BOX_CLOSE, ICON_BOX_OPEN, ICON_DROP, ICON_EXIT, ICON_HAND, ICON_MOVE, ICON_THROW } from './icons';

export type ActState = 'none' | 'ready' | 'disabled';
export interface ControlHandlers {
  actionDown(): void;
  actionUp(): void;
  throwBox(): void;
  dropBox(): void;
  toggleBox(): void;
  secondary(): void;
  exitSeat(): void;
}

const CSS = `
.pl-ctrl{position:fixed;inset:0;pointer-events:none;z-index:30;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --pl-ok:#2bd94a;--pl-okg:rgba(43,217,74,.3);--pl-fs:1;--pl-r:env(safe-area-inset-right,0px);--pl-b:env(safe-area-inset-bottom,0px);-webkit-user-select:none;user-select:none}
.pl-ctrl.cb{--pl-ok:#3d9bff;--pl-okg:rgba(61,155,255,.32)}
.pl-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;
  box-shadow:0 0 0 1.5px rgba(0,0,0,.45);transition:transform .12s;opacity:.95}
.pl-cross.on{transform:scale(1.45)}
.pl-btn{pointer-events:auto;position:relative;border:0;margin:0;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:#fff;background:rgba(28,32,42,.55);box-shadow:inset 0 0 0 3px rgba(255,255,255,.55),0 3px 10px rgba(0,0,0,.25);
  touch-action:none;-webkit-tap-highlight-color:transparent;cursor:pointer;transition:transform .08s,box-shadow .15s,background .15s;outline:none}
.pl-btn:focus-visible{box-shadow:inset 0 0 0 3px #fff,0 0 0 3px #ffd54a}
.pl-btn svg{display:block;pointer-events:none}
.pl-btn.pressed,.pl-btn:active{transform:scale(.93)}
.pl-btn kbd{position:absolute;right:-4px;top:-4px;font:800 11px/1 system-ui,sans-serif;padding:3px 5px;border-radius:6px;background:#fff;color:#1c2030;display:none}
@media (hover:hover) and (pointer:fine){.pl-btn kbd{display:block}}
.pl-acts{position:absolute;inset:0}
.pl-main{position:absolute;right:calc(var(--pl-r) + 26px);bottom:calc(var(--pl-b) + 20px);width:116px;display:flex;flex-direction:column;align-items:center;gap:3px}
.pl-main .pl-btn{width:96px;height:96px}
.pl-main svg{width:58px;height:58px;opacity:.5;transition:opacity .15s}
.pl-main.ready .pl-btn{box-shadow:inset 0 0 0 4px var(--pl-ok),0 0 0 5px var(--pl-okg),0 3px 12px rgba(0,0,0,.3);background:rgba(28,32,42,.62)}
.pl-main.ready svg,.pl-main.disabled svg{opacity:1}
.pl-main.disabled .pl-btn{box-shadow:inset 0 0 0 3px rgba(255,200,140,.75),0 3px 10px rgba(0,0,0,.25)}
.pl-main.disabled svg{opacity:.6}
.pl-lab{font-weight:800;font-size:calc(15px * var(--pl-fs));line-height:1.15;color:#fff;white-space:nowrap;min-height:1.15em;text-align:center;
  text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.7)}
.pl-main.disabled .pl-lab{color:#ffd9a8}
.pl-sm{position:absolute;width:84px;margin-right:-42px;margin-bottom:-30px;display:flex;flex-direction:column;align-items:center;gap:2px}
.pl-sm .pl-btn{width:60px;height:60px}
.pl-sm svg{width:32px;height:32px}
.pl-cap{font-weight:700;font-size:calc(11.5px * var(--pl-fs));line-height:1.1;color:#fff;white-space:nowrap;text-align:center;
  text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.7)}
.pl-sm.busy .pl-btn{opacity:.55}
.pl-exit{position:absolute;right:calc(var(--pl-r) + 14px);top:50%;transform:translateY(-50%);pointer-events:auto;border:0;min-height:58px;padding:0 18px 0 14px;
  border-radius:16px;display:none;align-items:center;gap:10px;color:#fff;font:900 calc(17px * var(--pl-fs))/1.05 system-ui,sans-serif;text-transform:uppercase;
  letter-spacing:.02em;background:linear-gradient(180deg,#ffad33,#f28a00);box-shadow:0 4px 0 #b45f00,0 6px 16px rgba(0,0,0,.25);cursor:pointer;
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;text-align:left;outline:none}
.pl-exit svg{width:30px;height:30px;flex:none}
.pl-exit:active{transform:translateY(calc(-50% + 3px));box-shadow:0 1px 0 #b45f00}
.pl-exit:focus-visible{box-shadow:0 0 0 3px #fff,0 4px 0 #b45f00}
.pl-badge{position:absolute;left:50%;top:21%;transform:translateX(-50%);padding:7px 15px;border-radius:20px;background:rgba(20,24,30,.78);color:#fff;
  font:700 calc(15px * var(--pl-fs)) system-ui,sans-serif;white-space:nowrap;opacity:0;transition:opacity .25s;max-width:92vw;overflow:hidden;text-overflow:ellipsis}
.pl-ctrl.seated .pl-exit{display:flex}
.pl-ctrl.seated .pl-acts,.pl-ctrl.seated .pl-cross,.pl-ctrl.noact .pl-acts,.pl-ctrl.off .pl-acts,.pl-ctrl.off .pl-cross,.pl-ctrl.off .pl-exit{display:none!important}
@keyframes pl-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.pl-main.shake .pl-btn{animation:pl-shake .22s 2}
.pl-ctrl.rm .pl-main.shake .pl-btn{animation:none}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Controls {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly acts: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly mainBtn: HTMLButtonElement;
  private readonly label: HTMLDivElement;
  private readonly cross: HTMLDivElement;
  private readonly badgeEl: HTMLDivElement;
  private readonly slots: Record<'throw' | 'drop' | 'box' | 'move', { wrap: HTMLDivElement; btn: HTMLButtonElement; cap: HTMLDivElement }>;
  private readonly exitBtn: HTMLButtonElement;
  private badgeT = 0;
  private shakeT = 0;
  private lastAct = '';
  private lastSlots = '';
  private boxIsOpen: boolean | null = null;

  constructor(parent: HTMLElement, private readonly h: ControlHandlers) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'pl-ctrl');
    this.root.setAttribute('data-player-controls', '');
    this.cross = el('div', 'pl-cross');
    this.acts = el('div', 'pl-acts');
    this.main = el('div', 'pl-main');
    this.mainBtn = el('button', 'pl-btn pl-act-btn', ICON_HAND + '<kbd>E</kbd>');
    this.mainBtn.type = 'button';
    this.mainBtn.setAttribute('aria-label', 'Ação');
    this.label = el('div', 'pl-lab');
    this.main.append(this.mainBtn, this.label);
    const slot = (name: string, icon: string, cap: string, key: string): { wrap: HTMLDivElement; btn: HTMLButtonElement; cap: HTMLDivElement } => {
      const wrap = el('div', `pl-sm pl-${name}`);
      const btn = el('button', 'pl-btn', icon + `<kbd>${key}</kbd>`);
      btn.type = 'button';
      btn.setAttribute('aria-label', cap);
      const c = el('div', 'pl-cap');
      c.textContent = cap;
      wrap.append(btn, c);
      wrap.style.display = 'none';
      this.acts.appendChild(wrap);
      return { wrap, btn, cap: c };
    };
    this.slots = {
      throw: slot('throw', ICON_THROW, 'Arremessar', 'G'),
      drop: slot('drop', ICON_DROP, 'Largar', 'Q'),
      box: slot('box', ICON_BOX_OPEN, 'Abrir caixa', 'C'),
      move: slot('move', ICON_MOVE, 'Mover', 'F'),
    };
    this.acts.appendChild(this.main);
    this.exitBtn = el('button', 'pl-exit', ICON_EXIT + '<span>Sair do<br>caixa</span>');
    this.exitBtn.type = 'button';
    this.exitBtn.setAttribute('aria-label', 'Sair do caixa');
    this.badgeEl = el('div', 'pl-badge');
    this.root.append(this.cross, this.acts, this.exitBtn, this.badgeEl);
    parent.appendChild(this.root);
    this.layout();

    // ação: pressionar/segurar (Repor repete enquanto segura)
    const b = this.mainBtn;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
      b.classList.add('pressed');
      this.h.actionDown();
    });
    const release = (): void => { if (b.classList.contains('pressed')) { b.classList.remove('pressed'); this.h.actionUp(); } };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); this.h.actionDown(); } });
    b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') this.h.actionUp(); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    this.slots.throw.btn.addEventListener('click', () => this.h.throwBox());
    this.slots.drop.btn.addEventListener('click', () => this.h.dropBox());
    this.slots.box.btn.addEventListener('click', () => this.h.toggleBox());
    this.slots.move.btn.addEventListener('click', () => this.h.secondary());
    this.exitBtn.addEventListener('click', () => this.h.exitSeat());
    for (const s of Object.values(this.slots)) s.btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Posição dos botões pequenos em arco à esquerda/acima do botão de ação (centro em right 84, bottom 94). */
  private layout(): void {
    const put = (s: { wrap: HTMLDivElement }, right: number, bottom: number): void => {
      s.wrap.style.right = `calc(var(--pl-r) + ${right}px)`;
      s.wrap.style.bottom = `calc(var(--pl-b) + ${bottom}px)`;
    };
    put(this.slots.throw, 84, 212);
    put(this.slots.drop, 200, 82);
    put(this.slots.box, 176, 176);
    put(this.slots.move, 292, 82);
  }

  /** Rótulo e estado do botão de ação. */
  setAction(label: string | null, st: ActState): void {
    const key = `${st}|${label ?? ''}`;
    if (key === this.lastAct) return;
    this.lastAct = key;
    this.main.classList.toggle('ready', st === 'ready');
    this.main.classList.toggle('disabled', st === 'disabled');
    this.label.textContent = label ?? '';
    this.mainBtn.setAttribute('aria-label', label ?? 'Ação');
    this.cross.classList.toggle('on', st !== 'none');
  }

  /** Botões extras: caixa na mão (arremessar/largar/abrir-fechar) e secundário (Mover). */
  setExtras(carrying: boolean, open: boolean | null, busy: boolean, secondary: string | null): void {
    const key = `${carrying}|${open}|${busy}|${secondary ?? ''}`;
    if (key === this.lastSlots) return;
    this.lastSlots = key;
    const show = (s: { wrap: HTMLDivElement }, v: boolean): void => { s.wrap.style.display = v ? '' : 'none'; };
    show(this.slots.throw, carrying);
    show(this.slots.drop, carrying);
    show(this.slots.box, carrying && open !== null);
    this.slots.box.wrap.classList.toggle('busy', busy);
    if (open !== null && open !== this.boxIsOpen) {
      this.boxIsOpen = open;
      const txt = open ? 'Fechar caixa' : 'Abrir caixa';
      this.slots.box.btn.innerHTML = (open ? ICON_BOX_CLOSE : ICON_BOX_OPEN) + '<kbd>C</kbd>';
      this.slots.box.btn.setAttribute('aria-label', txt);
      this.slots.box.cap.textContent = txt;
    }
    show(this.slots.move, !!secondary);
    if (secondary) this.slots.move.cap.textContent = secondary;
  }

  /** Visibilidade geral: `off` (modal/câmera tomada) esconde tudo; `noAct` (posicionamento) esconde as ações. */
  setView(v: { off: boolean; noAct: boolean; seated: boolean }): void {
    this.root.classList.toggle('off', v.off);
    this.root.classList.toggle('noact', v.noAct);
    this.root.classList.toggle('seated', v.seated);
  }

  setPrefs(p: { fontScale: number; colorblind: boolean; reduceMotion: boolean }): void {
    this.root.style.setProperty('--pl-fs', String(p.fontScale));
    this.root.classList.toggle('cb', p.colorblind);
    this.root.classList.toggle('rm', p.reduceMotion);
  }

  badge(text: string): void {
    this.badgeEl.textContent = text;
    this.badgeEl.style.opacity = '1';
    this.badgeT = 1.4;
  }

  /** Ação recusada (rótulo desabilitado): balança o botão. */
  denied(): void {
    this.main.classList.remove('shake');
    void this.main.offsetWidth;
    this.main.classList.add('shake');
    this.shakeT = 0.5;
  }

  /** Solta o botão de ação (ex.: modal abriu no meio do toque). */
  release(): void { this.mainBtn.classList.remove('pressed'); }

  update(dt: number): void {
    if (this.badgeT > 0) { this.badgeT -= dt; if (this.badgeT <= 0) this.badgeEl.style.opacity = '0'; }
    if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.main.classList.remove('shake'); }
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
