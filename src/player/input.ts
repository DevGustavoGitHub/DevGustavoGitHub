/**
 * Entrada em 1ª pessoa: joystick à esquerda (fica visível em repouso; segue o dedo se o toque começar longe dele),
 * olhar arrastando na metade direita (ou em qualquer ponto quando sentado), mouse arrastando no desktop, teclado
 * (WASD/setas; E/Espaço ação com segurar; G arremessar; Q largar; C abrir/fechar caixa; F secundário) e toques curtos
 * (`onTap`, usados sentado no caixa). Toques sobre elementos de UI nunca viram olhar/joystick.
 * Multitoque (Fase 4): joystick e olhar são rastreados cada um pelo seu `pointerId` (sem captura e sem
 * `preventDefault` em toques de outros alvos), então um dedo no joystick não impede o toque nos botões.
 */
export class Input {
  /** Eixos de movimento no espaço da tela: x = direita, y = frente (−1..1, comprimento ≤ 1). */
  moveX = 0;
  moveY = 0;
  /** Deltas de olhar acumulados (radianos), consumidos pelo player a cada quadro. */
  dYaw = 0;
  dPitch = 0;
  /** Modal/override: ignora tudo. */
  locked = false;
  /** Sentado: sem joystick; qualquer toque livre olha/toca. */
  seated = false;
  /** Teclas de ação desligadas (modo de posicionamento do world usa R/Enter/Esc/Del). */
  actionKeys = true;
  /** FASE 4: sensibilidade do olhar (toque e mouse), `lookSensitivity` das opções (0,4–2,0; padrão 1). */
  sensitivity = 1;
  onActionDown: () => void = () => {};
  onActionUp: () => void = () => {};
  onThrow: () => void = () => {};
  onDrop: () => void = () => {};
  onToggleBox: () => void = () => {};
  onSecondary: () => void = () => {};
  onTap: (x: number, y: number) => void = () => {};

  private keys = new Set<string>();
  private stickId = -1;
  private sx = 0; // centro atual do joystick
  private sy = 0;
  private lookId = -1;
  private lx = 0;
  private ly = 0;
  private lookDist = 0;
  private lookT0 = 0;
  private lookMouse = false;
  private actionKey = '';
  private readonly wrap: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private readonly R = 58;
  private offs: (() => void)[] = [];

  constructor(parent: HTMLElement, private readonly canvas: HTMLElement) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'pl-joy';
    this.wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    this.base = document.createElement('div');
    this.base.style.cssText =
      `position:absolute;width:${this.R * 2}px;height:${this.R * 2}px;margin:-${this.R}px 0 0 -${this.R}px;border-radius:50%;` +
      'background:rgba(255,255,255,.10);box-shadow:inset 0 0 0 3px rgba(38,42,52,.55),0 2px 10px rgba(0,0,0,.18)';
    this.thumb = document.createElement('div');
    this.thumb.style.cssText =
      `position:absolute;left:${this.R - 29}px;top:${this.R - 29}px;width:58px;height:58px;border-radius:50%;` +
      'background:rgba(38,42,52,.72);box-shadow:0 2px 6px rgba(0,0,0,.3)';
    this.base.appendChild(this.thumb);
    this.wrap.appendChild(this.base);
    parent.appendChild(this.wrap);
    canvas.style.touchAction = 'none';
    this.rest();

    const on = <K extends keyof WindowEventMap>(ev: K, fn: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions): void => {
      window.addEventListener(ev, fn, opt);
      this.offs.push(() => window.removeEventListener(ev, fn, opt));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e, true));
    on('pointercancel', (e) => this.up(e, false));
    on('blur', () => this.reset());
    on('resize', () => { if (this.stickId < 0) this.rest(); });
    on('keydown', (e) => this.keyDown(e));
    on('keyup', (e) => this.keyUp(e));
    on('contextmenu', (e) => { if (this.isFree(e.target)) e.preventDefault(); });
  }

  /** Posição de repouso do joystick (canto inferior esquerdo). */
  restPos(): { x: number; y: number } {
    const w = window.innerWidth, h = window.innerHeight;
    return { x: Math.round(Math.min(150, Math.max(96, w * 0.15))), y: Math.round(h - Math.min(122, Math.max(90, h * 0.25))) };
  }
  private rest(): void {
    const p = this.restPos();
    this.sx = p.x; this.sy = p.y;
    this.base.style.left = `${p.x}px`;
    this.base.style.top = `${p.y}px`;
    this.thumb.style.transform = 'translate(0,0)';
  }

  /** O alvo é a área livre do jogo (canvas/raiz), não um elemento de UI? */
  private isFree(t: EventTarget | null): boolean {
    return t === this.canvas || t === document.body || t === document.documentElement ||
      (t instanceof HTMLElement && (t.id === 'app' || t.id === 'ui-root'));
  }

  get stickActive(): boolean { return this.stickId >= 0; }

  /** Mostra/esconde o joystick (sentado, modal, câmera tomada pelo world). */
  setStickVisible(v: boolean): void { this.wrap.style.display = v ? '' : 'none'; }

  reset(): void {
    this.keys.clear();
    if (this.actionKey) { this.actionKey = ''; this.onActionUp(); }
    this.stickId = -1;
    this.lookId = -1;
    this.moveX = this.moveY = 0;
    this.dYaw = this.dPitch = 0;
    this.rest();
  }

  setLocked(v: boolean): void {
    this.locked = v;
    if (v) this.reset();
  }

  private keyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.locked || e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code;
    if (this.actionKeys) {
      if (c === 'KeyE' || c === 'Space') {
        if (c === 'Space') e.preventDefault();
        if (!e.repeat && !this.actionKey) { this.actionKey = c; this.onActionDown(); }
        return;
      }
      if (!e.repeat) {
        if (c === 'KeyG') { this.onThrow(); return; }
        if (c === 'KeyQ') { this.onDrop(); return; }
        if (c === 'KeyC') { this.onToggleBox(); return; }
        if (c === 'KeyF') { this.onSecondary(); return; }
      }
    }
    if (c.startsWith('Arrow')) e.preventDefault();
    this.keys.add(c);
  }

  private keyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.code === this.actionKey) { this.actionKey = ''; this.onActionUp(); }
  }

  private down(e: PointerEvent): void {
    if (this.locked || !this.isFree(e.target)) return;
    const touchy = e.pointerType !== 'mouse';
    if (touchy && !this.seated && e.clientX < window.innerWidth * 0.5 && this.stickId < 0) {
      this.stickId = e.pointerId;
      const r = this.restPos();
      // começou perto do joystick em repouso: ele fica onde está; senão vai para baixo do dedo
      if (Math.hypot(e.clientX - r.x, e.clientY - r.y) > this.R * 1.5) {
        this.sx = e.clientX; this.sy = e.clientY;
        this.base.style.left = `${this.sx}px`;
        this.base.style.top = `${this.sy}px`;
      }
      this.stick(e.clientX, e.clientY);
      return;
    }
    if (this.lookId >= 0) return;
    this.lookId = e.pointerId;
    this.lx = e.clientX; this.ly = e.clientY;
    this.lookDist = 0;
    this.lookT0 = performance.now();
    this.lookMouse = !touchy;
  }

  private stick(x: number, y: number): void {
    let dx = x - this.sx, dy = y - this.sy;
    const len = Math.hypot(dx, dy);
    if (len > this.R) { // a base acompanha o dedo além do raio
      const k = (len - this.R) / len;
      this.sx += dx * k; this.sy += dy * k;
      this.base.style.left = `${this.sx}px`;
      this.base.style.top = `${this.sy}px`;
      dx = x - this.sx; dy = y - this.sy;
    }
    const l2 = Math.min(1, Math.hypot(dx, dy) / this.R);
    const ang = Math.atan2(dy, dx);
    this.thumb.style.transform = `translate(${Math.cos(ang) * l2 * this.R}px,${Math.sin(ang) * l2 * this.R}px)`;
    const dz = 0.12;
    const mag = l2 < dz ? 0 : (l2 - dz) / (1 - dz);
    this.moveX = Math.cos(ang) * mag;
    this.moveY = -Math.sin(ang) * mag;
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) { this.stick(e.clientX, e.clientY); return; }
    if (e.pointerId !== this.lookId) return;
    if (this.lookMouse && e.buttons === 0) { this.lookId = -1; return; }
    const dx = e.clientX - this.lx, dy = e.clientY - this.ly;
    this.lx = e.clientX; this.ly = e.clientY;
    this.lookDist += Math.hypot(dx, dy);
    if (this.locked) return;
    const k = (this.lookMouse ? 0.0042 : 0.0058 * Math.min(1.4, Math.max(0.55, 390 / Math.max(1, window.innerHeight)))) * this.sensitivity;
    this.dYaw -= dx * k;
    this.dPitch -= dy * k;
  }

  private up(e: PointerEvent, real: boolean): void {
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.moveX = this.moveY = 0;
      this.rest();
    }
    if (e.pointerId === this.lookId) {
      this.lookId = -1;
      const quick = performance.now() - this.lookT0 < 380 && this.lookDist < 10;
      if (real && quick && !this.locked) this.onTap(e.clientX, e.clientY);
    }
  }

  /** Atualiza eixos a partir do teclado quando o joystick não está em uso. */
  poll(): void {
    if (this.stickId >= 0) return;
    if (this.locked) { this.moveX = this.moveY = 0; return; }
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const l = Math.hypot(x, y);
    this.moveX = l > 0 ? x / l : 0;
    this.moveY = l > 0 ? y / l : 0;
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.wrap.remove();
  }
}
