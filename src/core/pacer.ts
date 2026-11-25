/**
 * Ritmo de quadros: limita o jogo a `maxFps` (30/60; 0 = sem limite) pulando callbacks do requestAnimationFrame.
 * Em telas de 90/120/144 Hz o rAF chega mais vezes por segundo do que precisamos; desenhar só a cada ~16,7 ms corta
 * pela metade (ou mais) o trabalho de CPU/GPU, o calor e o estrangulamento térmico.
 *
 * Decisão por quadro (acumulador estável): desenha quando o tempo acumulado já está mais perto do alvo agora do que
 * estaria no próximo vsync (`acc >= intervalo − vsync/2`). Em 60 Hz desenha todos os quadros (mesmo com jitter), em
 * 120 Hz um sim/um não (60 fps cravados), em 90 Hz dois de cada três (média 60). O `dt` devolvido é o tempo REAL desde
 * o último quadro desenhado (física e animações continuam corretas), limitado a `maxDt`.
 */
export const FPS_CAPS = [30, 60, 0] as const;
export type FpsCap = (typeof FPS_CAPS)[number];
export const isFpsCap = (v: unknown): v is FpsCap => v === 30 || v === 60 || v === 0;
export const DEFAULT_FPS_CAP: FpsCap = 60;

export class FramePacer {
  /** Intervalo médio entre callbacks do rAF (≈ período do vsync), em ms. */
  vsync = 1000 / 60;
  /** Quadros desenhados / callbacks recebidos (diagnóstico). */
  drawn = 0;
  ticks = 0;
  private acc = 0;
  private lastTick = -1;
  private lastDraw = -1;
  private cap: FpsCap;
  constructor(maxFps: FpsCap = DEFAULT_FPS_CAP, private maxDt = 0.1) { this.cap = maxFps; }

  get maxFps(): FpsCap { return this.cap; }
  set maxFps(v: FpsCap) { if (isFpsCap(v) && v !== this.cap) { this.cap = v; this.acc = 0; } }
  /** Intervalo alvo entre quadros (ms); 0 = sem limite. */
  get interval(): number { return this.cap > 0 ? 1000 / this.cap : 0; }

  /** Chamado em todo callback do rAF com o timestamp (ms). Devolve o dt (s) se este quadro deve ser desenhado, ou null. */
  tick(now: number): number | null {
    this.ticks++;
    if (this.lastTick < 0) { this.lastTick = now; this.lastDraw = now; this.drawn++; return 0; }
    const d = now - this.lastTick;
    this.lastTick = now;
    if (d <= 0) return null; // timestamp repetido/voltando (raro): ignora
    // estimativa do vsync: média móvel, ignorando pausas (aba oculta, travadas) e quadros quase colados
    if (d > 2 && d < Math.max(40, this.vsync * 2.5)) this.vsync += (d - this.vsync) * 0.1;
    const iv = this.interval;
    if (iv > 0) {
      this.acc += d;
      if (this.acc < iv - this.vsync / 2) return null;
      this.acc -= iv;
      // depois de uma pausa longa não tenta "recuperar" quadros; e nunca fica devendo mais de um intervalo
      if (this.acc > iv) this.acc = 0;
      else if (this.acc < -iv) this.acc = -iv;
    }
    const dt = Math.max(0, Math.min(this.maxDt, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    this.drawn++;
    return dt;
  }
}
