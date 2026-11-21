/** Entrada: joystick flutuante (toque, metade esquerda), órbita por deslize/arrasto, pinça/roda, teclado. */
export class Input {
  /** Eixos de movimento no espaço da tela: x = direita, y = frente (−1..1, comprimento ≤ 1). */
  moveX = 0;
  moveY = 0;
  /** Acumuladores consumidos pela câmera a cada frame. */
  dYaw = 0;
  dPitch = 0;
  zoomMul = 1;
  locked = false;
  onAction: () => void = () => {};
  onSecondary: () => void = () => {};

  private keys = new Set<string>();
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private cam = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private readonly base: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private readonly wrap: HTMLDivElement;
  private readonly R = 56;
  private offs: (() => void)[] = [];

  constructor(private root: HTMLElement, private canvas: HTMLElement) {
    this.wrap = document.createElement('div');
    this.wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    this.base = document.createElement('div');
    this.base.style.cssText =
      'position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;display:none;' +
      'background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.45);box-shadow:0 2px 10px rgba(0,0,0,.25)';
    this.thumb = document.createElement('div');
    this.thumb.style.cssText =
      'position:absolute;left:28px;top:28px;width:56px;height:56px;border-radius:50%;' +
      'background:rgba(255,255,255,.55);border:2px solid rgba(255,255,255,.9)';
    this.base.appendChild(this.thumb);
    this.wrap.appendChild(this.base);
    root.appendChild(this.wrap);
    canvas.style.touchAction = 'none';

    const on = <K extends keyof WindowEventMap>(t: Window, ev: K, fn: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn, opt);
      this.offs.push(() => t.removeEventListener(ev, fn, opt));
    };
    on(window, 'pointerdown', (e) => this.down(e));
    on(window, 'pointermove', (e) => this.move(e));
    on(window, 'pointerup', (e) => this.up(e));
    on(window, 'pointercancel', (e) => this.up(e));
    on(window, 'blur', () => this.reset());
    on(window, 'wheel', (e) => {
      if (this.locked || !this.isFree(e.target)) return;
      this.zoomMul *= Math.exp(e.deltaY * 0.0012);
      e.preventDefault();
    }, { passive: false });
    on(window, 'keydown', (e) => this.keyDown(e));
    on(window, 'keyup', (e) => { this.keys.delete(e.code); });
    const ctx = (e: Event) => { if (this.isFree(e.target)) e.preventDefault(); };
    on(window, 'contextmenu', ctx);
  }

  /** O alvo é a área livre do jogo (canvas/raiz), não um elemento de UI? */
  private isFree(t: EventTarget | null): boolean {
    return t === this.canvas || t === this.root || t === document.body || t === document.documentElement ||
      (t instanceof HTMLElement && t.id === 'app');
  }

  private reset(): void {
    this.keys.clear();
    this.stickId = -1;
    this.cam.clear();
    this.pinchDist = 0;
    this.moveX = this.moveY = 0;
    this.base.style.display = 'none';
  }

  setLocked(v: boolean): void {
    this.locked = v;
    if (v) this.reset();
  }

  private keyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.locked) return;
    if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
      if (!e.repeat) this.onAction();
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    if (e.code === 'KeyF' && !e.repeat) { this.onSecondary(); return; }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    this.keys.add(e.code);
  }

  private down(e: PointerEvent): void {
    if (this.locked || !this.isFree(e.target)) return;
    const touchy = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touchy && e.clientX < window.innerWidth * 0.5 && this.stickId < 0) {
      this.stickId = e.pointerId;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.style.display = 'block';
      this.thumb.style.transform = 'translate(0,0)';
      return;
    }
    this.cam.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.cam.size === 2) this.pinchDist = this.curPinch();
  }

  private curPinch(): number {
    const it = this.cam.values();
    const a = it.next().value!, b = it.next().value!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickX, dy = e.clientY - this.stickY;
      const len = Math.hypot(dx, dy);
      if (len > this.R) { // base segue o dedo (joystick flutuante)
        const k = (len - this.R) / len;
        this.stickX += dx * k; this.stickY += dy * k;
        this.base.style.left = `${this.stickX}px`;
        this.base.style.top = `${this.stickY}px`;
        dx = e.clientX - this.stickX; dy = e.clientY - this.stickY;
      }
      const l2 = Math.min(1, Math.hypot(dx, dy) / this.R);
      const ang = Math.atan2(dy, dx);
      this.thumb.style.transform = `translate(${Math.cos(ang) * l2 * this.R}px,${Math.sin(ang) * l2 * this.R}px)`;
      const dz = 0.12;
      const mag = l2 < dz ? 0 : (l2 - dz) / (1 - dz);
      this.moveX = Math.cos(ang) * mag;
      this.moveY = -Math.sin(ang) * mag;
      return;
    }
    const p = this.cam.get(e.pointerId);
    if (!p) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { this.cam.delete(e.pointerId); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.cam.size >= 2) {
      const d = this.curPinch();
      if (this.pinchDist > 0 && d > 0) this.zoomMul *= this.pinchDist / d;
      this.pinchDist = d;
      this.dYaw -= dx * 0.003; // com 2 dedos o giro é mais lento
    } else {
      this.dYaw -= dx * 0.0065;
      this.dPitch += dy * 0.005;
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.moveX = this.moveY = 0;
      this.base.style.display = 'none';
    }
    this.cam.delete(e.pointerId);
    this.pinchDist = this.cam.size === 2 ? this.curPinch() : 0;
  }

  /** Atualiza eixos a partir do teclado quando o joystick não está em uso. */
  poll(): void {
    if (this.stickId >= 0 || this.locked) return;
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
