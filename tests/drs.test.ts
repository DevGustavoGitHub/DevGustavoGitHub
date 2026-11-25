import { describe, expect, it } from 'vitest';
import { DynamicResolution, SlowWatch } from '../src/world/drs';
import { autoSteps, wantsAntialias, TIERS } from '../src/world/quality';

/** GPU simulada: ms por quadro = fixo + custo por megapixel × (pixel ratio)² (+ sombra). A CPU leva `work` ms. */
function sim(drs: DynamicResolution, secs: number, gpu: (pr: number, shadow: number) => number, work = 4, target = 1000 / 60): number[] {
  let t = 0;
  const visited: number[] = [];
  while (t < secs * 1000) {
    const s = drs.step;
    const interval = Math.max(target, gpu(s.pr, s.shadow), work);
    t += interval;
    const r = drs.frame(t, interval, work, target);
    if (r !== null) visited.push(r);
  }
  return visited;
}

describe('escada do modo automático', () => {
  it('celular DPR 2,625: 2 → 0,85 e sombras só saem no último degrau', () => {
    const s = autoSteps(2.625, 'mobile');
    expect(s[0]).toEqual({ pr: 2, shadow: 2048 });
    expect(s.map((x) => x.pr)).toEqual([2, 1.75, 1.5, 1.25, 1, 0.85, 0.85]);
    expect(s.slice(0, -1).every((x) => x.shadow > 0)).toBe(true);
    expect(s[s.length - 1]!.shadow).toBe(0);
  });
  it('PC DPR 1: começa em 1; celular fraco: sem sombras', () => {
    expect(autoSteps(1, 'desktop')[0]!.pr).toBe(1);
    expect(autoSteps(2, 'weak').every((x) => x.shadow === 0)).toBe(true);
    expect(autoSteps(1.6, 'desktop')[0]!.pr).toBe(1.6);
  });
  it('MSAA só com pixel ratio efetivo ≤ 1,5', () => {
    expect(wantsAntialias('high', 2.625)).toBe(false);
    expect(wantsAntialias('high', 1)).toBe(true);
    expect(wantsAntialias('medium', 2.625)).toBe(TIERS.medium.antialias);
    expect(wantsAntialias('low', 1)).toBe(false);
    expect(wantsAntialias('auto', 2.625)).toBe(false);
    expect(wantsAntialias('auto', 1)).toBe(true);
  });
});

describe('DynamicResolution', () => {
  const steps = autoSteps(2.625, 'mobile');
  it('GPU no limite em 2×: desce até o degrau que mantém 60 fps e fica lá', () => {
    // 16,7 ms cabem até ~1,5× (6 ms fixos + 4,6 ms/px² → 1,5² = 16,4 ms)
    const d = new DynamicResolution(steps, 0);
    sim(d, 60, (pr) => 6 + 4.6 * pr * pr);
    expect(d.step.pr).toBe(1.5);
    expect(d.step.shadow).toBeGreaterThan(0);
  });
  it('sobra folga: sobe até o topo e não oscila', () => {
    const d = new DynamicResolution(steps, 3); // começa em 1,25
    sim(d, 90, (pr) => 3 + 2 * pr * pr);
    expect(d.index).toBe(0);
    const late = d.log.filter((l) => l.at > 60_000);
    expect(late.length).toBe(0);
  });
  it('subida que não cabe volta e espera mais (sem ficar alternando)', () => {
    const d = new DynamicResolution(steps, 2); // 1,5 cabe, 1,75 não
    sim(d, 120, (pr) => 6 + 4.6 * pr * pr);
    expect(d.step.pr).toBe(1.5);
    const ups = d.log.filter((l) => l.to < l.from).length;
    expect(ups).toBeLessThanOrEqual(4); // espera dobra a cada tentativa frustrada
  });
  it('gargalo de CPU (JS ocupa o quadro todo): não baixa a resolução', () => {
    const d = new DynamicResolution(steps, 0);
    sim(d, 30, () => 10, 30);
    expect(d.index).toBe(0);
  });
  it('aparelho muito lento: chega a desligar as sombras e não as religa', () => {
    const d = new DynamicResolution(steps, 0);
    sim(d, 40, (pr, sh) => 20 + 6 * pr * pr + (sh ? 8 : 0));
    expect(d.step.shadow).toBe(0);
    sim(d, 120, () => 4); // ficou leve (ex.: loja vazia): sobe a resolução, mas sem sombras
    expect(d.step.shadow).toBe(0);
  });
  it('pausas longas (aba oculta) não contam como lentidão', () => {
    const d = new DynamicResolution(steps, 0);
    let t = 0;
    for (let i = 0; i < 40; i++) { t += 1000; d.frame(t, 1000, 1, 1000 / 60); }
    expect(d.index).toBe(0);
  });
});

describe('SlowWatch (dica para qualidade fixa)', () => {
  it('dispara uma vez depois de ~8 s abaixo de 75% do alvo', () => {
    const w = new SlowWatch();
    let t = 0, fired = 0;
    for (let i = 0; i < 600; i++) { t += 40; if (w.frame(t, 40, 1000 / 60)) fired++; }
    expect(fired).toBe(1);
  });
  it('não dispara a 55 fps', () => {
    const w = new SlowWatch();
    let t = 0, fired = 0;
    for (let i = 0; i < 1200; i++) { t += 18; if (w.frame(t, 18, 1000 / 60)) fired++; }
    expect(fired).toBe(0);
  });
});
