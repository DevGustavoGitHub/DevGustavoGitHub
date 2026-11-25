/**
 * Resolução dinâmica (modo de qualidade "auto"): mede o intervalo entre quadros desenhados em janelas de ~1 s e sobe ou
 * desce um degrau da escada (pixel ratio; sombras só no último degrau) com histerese:
 * - desce depois de 2 janelas lentas seguidas (média < 90% do FPS alvo), ou 1 janela muito lenta (< 60%), e só se o
 *   gargalo parece ser a GPU (o JS do quadro ocupa < 75% do intervalo: com a CPU no limite, baixar a resolução não ajuda);
 * - sobe depois de várias janelas boas seguidas (≥ 97% do alvo); se a subida deixa o jogo lento logo em seguida, volta e
 *   dobra a espera antes de tentar de novo (até 60 janelas), para não ficar oscilando;
 * - depois de desligar as sombras (troca de shader) não volta a ligá-las nesta sessão.
 * Puro (sem DOM/three): `tests/drs.test.ts`.
 */
import type { DrsStep } from './quality';

export interface DrsOptions {
  /** Duração de uma janela de medida (ms). */
  windowMs?: number;
  /** Janelas boas seguidas antes da 1ª tentativa de subir. */
  upAfter?: number;
}

export class DynamicResolution {
  index: number;
  /** Histórico de mudanças (debug/testes). */
  readonly log: { at: number; from: number; to: number; fps: number }[] = [];
  private winStart = -1;
  private frames = 0;
  private sumInterval = 0;
  private sumWork = 0;
  private slow = 0;
  private good = 0;
  private settle = 0;
  private upWait: number;
  private lastUpAt = -Infinity;
  private ceiling = 0;
  private readonly windowMs: number;
  constructor(readonly steps: readonly DrsStep[], start: number, o: DrsOptions = {}) {
    this.index = Math.max(0, Math.min(steps.length - 1, start));
    this.windowMs = o.windowMs ?? 1000;
    this.upWait = o.upAfter ?? 6;
    if (steps[this.index]!.shadow === 0) this.ceiling = this.firstShadowless();
  }
  get step(): DrsStep { return this.steps[this.index]!; }
  /** Esquece a janela atual (aba oculta, menu aberto, pausa longa, troca de cena). */
  reset(): void { this.winStart = -1; this.frames = 0; this.sumInterval = 0; this.sumWork = 0; }
  private firstShadowless(): number { const i = this.steps.findIndex((s) => s.shadow === 0); return i < 0 ? 0 : i; }

  /**
   * Um quadro desenhado: `interval` = ms desde o anterior, `work` = ms de JS do quadro (update + render), `target` = ms
   * do FPS alvo (limite do jogador; sem limite = 60 fps). Devolve o novo índice quando muda de degrau, senão null.
   */
  frame(now: number, interval: number, work: number, target: number): number | null {
    if (!(interval > 0) || interval > 250) { this.reset(); return null; } // pausa/travada isolada: não é desempenho
    if (this.winStart < 0) { this.winStart = now; this.frames = 0; this.sumInterval = 0; this.sumWork = 0; return null; }
    this.frames++; this.sumInterval += interval; this.sumWork += Math.max(0, work);
    if (now - this.winStart < this.windowMs || this.frames < 8) return null;
    const avg = this.sumInterval / this.frames, avgWork = this.sumWork / this.frames;
    const ratio = target / avg; // 1 = no alvo
    this.winStart = now; this.frames = 0; this.sumInterval = 0; this.sumWork = 0;
    if (this.settle > 0) { this.settle--; return null; }
    const gpuBound = avgWork < avg * 0.75;
    if (ratio < 0.9) {
      this.good = 0;
      this.slow++;
      const recentUp = now - this.lastUpAt < this.windowMs * 5;
      if (gpuBound && (this.slow >= 2 || ratio < 0.6 || recentUp) && this.index < this.steps.length - 1) {
        if (recentUp) this.upWait = Math.min(60, this.upWait * 2); // a subida não coube: espera mais da próxima vez
        return this.move(this.index + 1, now, 1000 / avg);
      }
      return null;
    }
    this.slow = 0;
    if (ratio >= 0.97) {
      this.good++;
      if (this.good >= this.upWait && this.index > this.ceiling) {
        this.lastUpAt = now;
        return this.move(this.index - 1, now, 1000 / avg);
      }
    } else this.good = 0;
    return null;
  }
  private move(to: number, now: number, fps: number): number {
    const from = this.index;
    this.index = to;
    this.good = 0; this.slow = 0; this.settle = 1;
    if (this.steps[to]!.shadow === 0 && this.steps[from]!.shadow > 0) this.ceiling = to; // sombras não voltam
    this.log.push({ at: Math.round(now), from, to, fps: Math.round(fps) });
    if (this.log.length > 40) this.log.shift();
    return to;
  }
}

/** Dica única para quem escolheu uma qualidade fixa e está com o jogo lento (o automático nunca muda a escolha). */
export class SlowWatch {
  private winStart = -1;
  private frames = 0;
  private sum = 0;
  private slowWins = 0;
  fired = false;
  constructor(private needWindows = 8, private windowMs = 1000) {}
  reset(): void { this.winStart = -1; this.frames = 0; this.sum = 0; }
  /** true uma única vez, depois de `needWindows` janelas seguidas abaixo de 75% do alvo. */
  frame(now: number, interval: number, target: number): boolean {
    if (this.fired) return false;
    if (!(interval > 0) || interval > 250) { this.reset(); return false; }
    if (this.winStart < 0) { this.winStart = now; return false; }
    this.frames++; this.sum += interval;
    if (now - this.winStart < this.windowMs || this.frames < 5) return false;
    const ratio = target / (this.sum / this.frames);
    this.winStart = now; this.frames = 0; this.sum = 0;
    this.slowWins = ratio < 0.75 ? this.slowWins + 1 : 0;
    if (this.slowWins >= this.needWindows) { this.fired = true; return true; }
    return false;
  }
}
