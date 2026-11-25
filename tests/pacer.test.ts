import { describe, expect, it } from 'vitest';
import { FramePacer, isFpsCap, type FpsCap } from '../src/core/pacer';

/** Simula `secs` segundos de rAF numa tela de `hz` (jitter determinístico de ±`jit` ms) e devolve os quadros desenhados. */
function run(hz: number, cap: FpsCap, secs = 10, jit = 0): { fps: number; dts: number[]; gaps: number[] } {
  const p = new FramePacer(cap);
  const period = 1000 / hz;
  const dts: number[] = [], gaps: number[] = [];
  let lastDraw = -1;
  let seed = 7;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const n = Math.round(secs * hz);
  for (let i = 0; i <= n; i++) {
    const t = 1000 + i * period + (i > 0 && i < n ? (rnd() - 0.5) * 2 * jit : 0);
    const dt = p.tick(t);
    if (dt === null) continue;
    if (lastDraw >= 0) { dts.push(dt); gaps.push(t - lastDraw); }
    lastDraw = t;
  }
  return { fps: dts.length / secs, dts, gaps };
}

describe('FramePacer (limite de FPS)', () => {
  it('60 Hz com limite 60: desenha todos os quadros, mesmo com jitter de ±3 ms', () => {
    const r = run(60, 60, 10, 3);
    expect(r.fps).toBeGreaterThan(59);
    expect(Math.max(...r.gaps)).toBeLessThan(25);
  });
  it('120 Hz com limite 60: 60 fps cravados, intervalos uniformes', () => {
    const r = run(120, 60, 10, 0.8);
    expect(r.fps).toBeGreaterThan(59);
    expect(r.fps).toBeLessThan(61);
    const avg = r.gaps.reduce((a, b) => a + b, 0) / r.gaps.length;
    expect(avg).toBeCloseTo(1000 / 60, 0);
    expect(Math.max(...r.gaps)).toBeLessThan(20); // nunca pula dois vsyncs seguidos
  });
  it('90 Hz e 144 Hz com limite 60: média de ~60 fps', () => {
    for (const hz of [90, 144]) {
      const r = run(hz, 60, 10, 0.5);
      expect(r.fps).toBeGreaterThan(57);
      expect(r.fps).toBeLessThan(63);
    }
  });
  it('limite 30 em 60 e 120 Hz', () => {
    for (const hz of [60, 120]) {
      const r = run(hz, 30, 10, 0.5);
      expect(r.fps).toBeGreaterThan(29);
      expect(r.fps).toBeLessThan(31);
    }
  });
  it('sem limite: desenha todo callback do rAF', () => {
    expect(run(120, 0, 5).fps).toBeGreaterThan(119);
  });
  it('dt = tempo real desde o último quadro desenhado (soma bate com o tempo decorrido)', () => {
    const r = run(120, 60, 10, 0.5);
    const sum = r.dts.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(10, 1);
  });
  it('pausa longa (aba oculta): dt limitado e sem rajada de quadros depois', () => {
    const p = new FramePacer(60);
    let t = 0;
    for (let i = 0; i < 120; i++) { p.tick(t); t += 1000 / 120; }
    t += 5000;
    expect(p.tick(t)).toBe(0.1);
    let drawn = 0;
    for (let i = 0; i < 120; i++) { t += 1000 / 120; if (p.tick(t) !== null) drawn++; }
    expect(drawn).toBeGreaterThanOrEqual(59);
    expect(drawn).toBeLessThanOrEqual(61);
  });
  it('isFpsCap aceita só 30, 60 e 0', () => {
    expect([30, 60, 0].every(isFpsCap)).toBe(true);
    expect([120, '60', null, undefined, -1].some(isFpsCap)).toBe(false);
  });
});
