/**
 * Blocos de síntese e receitas de SFX. Funciona em qualquer BaseAudioContext
 * (AudioContext ao vivo ou OfflineAudioContext nos testes). Tudo agendado por tempo do contexto.
 */
import type { Rng, SfxName } from './theory';

export interface Rig {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

/** Buffer de ruído rosa (Paul Kellet) mono. */
export function makeNoise(ctx: BaseAudioContext, seconds = 4): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const w = (seed / 4294967296) * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

export interface ToneOpts {
  t: number; f: number; dur: number; gain: number;
  type?: OscillatorType;
  attack?: number;
  /** Se definido: sustenta e faz release linear nos últimos `release` s (pads). Senão decai exponencial. */
  release?: number;
  fEnd?: number;
  lp?: number;
  detune?: number;
}

const MIN_ATTACK = 0.004; // evita cliques

export function tone(rig: Rig, o: ToneOpts): void {
  const { ctx } = rig;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.fEnd) osc.frequency.exponentialRampToValueAtTime(o.fEnd, o.t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const a = Math.min(Math.max(o.attack ?? MIN_ATTACK, MIN_ATTACK), o.dur * 0.5);
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + a);
  if (o.release !== undefined) {
    const r = Math.min(o.release, o.dur - a);
    g.gain.setValueAtTime(o.gain, o.t + o.dur - r);
    g.gain.linearRampToValueAtTime(0, o.t + o.dur);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    g.gain.linearRampToValueAtTime(0, o.t + o.dur + 0.01);
  }
  let node: AudioNode = osc;
  let lp: BiquadFilterNode | null = null;
  if (o.lp) {
    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lp;
    osc.connect(lp);
    node = lp;
  }
  node.connect(g);
  g.connect(rig.out);
  osc.onended = () => { osc.disconnect(); lp?.disconnect(); g.disconnect(); };
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.03);
}

export interface NoiseOpts {
  t: number; dur: number; gain: number;
  type: BiquadFilterType; f: number; fEnd?: number; q?: number;
  attack?: number;
}

export function noiseBurst(rig: Rig, r: Rng, o: NoiseOpts): void {
  const { ctx } = rig;
  const src = ctx.createBufferSource();
  src.buffer = rig.noise;
  const filt = ctx.createBiquadFilter();
  filt.type = o.type;
  filt.frequency.setValueAtTime(o.f, o.t);
  if (o.fEnd) filt.frequency.exponentialRampToValueAtTime(o.fEnd, o.t + o.dur);
  filt.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = Math.min(Math.max(o.attack ?? 0.003, MIN_ATTACK), o.dur * 0.6);
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  g.gain.linearRampToValueAtTime(0, o.t + o.dur + 0.01);
  src.connect(filt); filt.connect(g); g.connect(rig.out);
  src.onended = () => { src.disconnect(); filt.disconnect(); g.disconnect(); };
  const maxOff = Math.max(0, rig.noise.duration - o.dur - 0.05);
  src.start(o.t, r() * maxOff);
  src.stop(o.t + o.dur + 0.03);
}

/** Sino metálico: parciais inarmônicos com decaimentos diferentes. */
export function bell(rig: Rig, t: number, f: number, gain: number, decay: number): void {
  const parts: [number, number, number][] = [[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.22, 0.35], [8.93, 0.1, 0.2]];
  for (const [ratio, g, d] of parts) {
    if (f * ratio > 11000) continue;
    tone(rig, { t, f: f * ratio, dur: decay * d, gain: gain * g * 0.5, attack: 0.002 });
  }
}

export interface CrackleOpts { t: number; dur: number; gain: number; f: number; fEnd?: number; q?: number; rate: number; floor?: number }

/** Ruído crepitante (fita adesiva, água): grãos curtos irregulares sobre um chiado de fundo, num só nó de ganho. */
export function crackle(rig: Rig, r: Rng, o: CrackleOpts): void {
  const { ctx } = rig;
  const src = ctx.createBufferSource();
  src.buffer = rig.noise;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = o.q ?? 1.5;
  filt.frequency.setValueAtTime(o.f, o.t);
  if (o.fEnd) filt.frequency.exponentialRampToValueAtTime(o.fEnd, o.t + o.dur);
  const g = ctx.createGain();
  const floor = o.gain * (o.floor ?? 0.25);
  const end = o.t + o.dur;
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(floor, o.t + 0.012);
  let at = o.t + 0.012;
  for (;;) {
    at += (0.4 + r() * 1.2) / o.rate;
    const len = 0.003 + r() * 0.005;
    if (at + 0.002 + len > end - 0.03) break;
    g.gain.setValueAtTime(floor, at);
    g.gain.linearRampToValueAtTime(o.gain * (0.45 + r() * 0.55), at + 0.002);
    g.gain.linearRampToValueAtTime(floor, at + 0.002 + len);
    at += 0.002 + len;
  }
  g.gain.setValueAtTime(floor, end - 0.03);
  g.gain.linearRampToValueAtTime(0, end);
  src.connect(filt); filt.connect(g); g.connect(rig.out);
  src.onended = () => { src.disconnect(); filt.disconnect(); g.disconnect(); };
  src.start(o.t, r() * Math.max(0, rig.noise.duration - o.dur - 0.05));
  src.stop(end + 0.03);
}

export interface CreakOpts { t: number; dur: number; rate: number; rateEnd: number; f: number; q?: number; gain: number }

/** Rangido (atrito "stick-slip"): dente de serra lento num passa-faixa estreito, com a taxa oscilando irregular. */
export function creak(rig: Rig, r: Rng, o: CreakOpts): void {
  const { ctx } = rig;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(o.rate, o.t);
  for (let i = 1; i <= 3; i++) {
    const k = i / 3;
    osc.frequency.linearRampToValueAtTime((o.rate + (o.rateEnd - o.rate) * k) * (0.85 + r() * 0.3), o.t + o.dur * k);
  }
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = o.f; bp.Q.value = o.q ?? 6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + Math.min(0.02, o.dur * 0.3));
  g.gain.setValueAtTime(o.gain, o.t + o.dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  g.gain.linearRampToValueAtTime(0, o.t + o.dur + 0.01);
  osc.connect(bp); bp.connect(g); g.connect(rig.out);
  osc.onended = () => { osc.disconnect(); bp.disconnect(); g.disconnect(); };
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.03);
}

/** Metal (fanfarra): dois dentes de serra desafinados, "escorregada" de afinação e filtro que abre no ataque. */
export function brass(rig: Rig, t: number, f: number, dur: number, gain: number): void {
  const { ctx } = rig;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.8;
  const sus = Math.min(f * 3.5, 6000);
  lp.frequency.setValueAtTime(Math.min(f * 1.2, 3000), t);
  lp.frequency.exponentialRampToValueAtTime(Math.min(f * 7, 9000), t + 0.045);
  lp.frequency.exponentialRampToValueAtTime(sus, t + Math.max(0.06, Math.min(0.2, dur * 0.8)));
  const g = ctx.createGain();
  const rel = Math.min(0.12, dur * 0.4);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.022);
  g.gain.linearRampToValueAtTime(gain * 0.72, t + Math.max(0.03, Math.min(0.16, dur - rel)));
  g.gain.setValueAtTime(gain * 0.72, t + dur - rel);
  g.gain.linearRampToValueAtTime(0, t + dur);
  const oscs = [-7, 7].map((cents) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = cents;
    o.frequency.setValueAtTime(f * 0.985, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.04);
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  });
  lp.connect(g); g.connect(rig.out);
  oscs[1]!.onended = () => { for (const o of oscs) o.disconnect(); lp.disconnect(); g.disconnect(); };
}

/** Rodinhas de cadeira: "tic"s leves; o espaçamento é multiplicado por `accel` a cada tic. */
function casters(rig: Rig, r: Rng, t: number, n: number, gap: number, accel: number, gain: number, p: number): void {
  let at = t, g = gap;
  for (let i = 0; i < n; i++) {
    noiseBurst(rig, r, { t: at, dur: 0.014, gain: gain * (0.7 + r() * 0.3), type: 'bandpass', f: 2300 * p * jit(r, 0.1), q: 2.5 });
    at += g * jit(r, 0.15);
    g *= accel;
  }
}

/** Celesta/caixinha de música: fundamental + oitava + brilho curto. */
function celesta(rig: Rig, t: number, f: number, gain: number, decay: number): void {
  tone(rig, { t, f, dur: decay, gain, attack: 0.005 });
  tone(rig, { t, f: f * 2, dur: decay * 0.45, gain: gain * 0.3, attack: 0.004 });
  if (f * 4 < 11000) tone(rig, { t, f: f * 4.02, dur: 0.12, gain: gain * 0.08, attack: 0.003 });
}

/** Tímpano: queda de afinação grave. */
function boom(rig: Rig, t: number, gain: number, dur: number, k: number): void {
  tone(rig, { t, f: 98 * k, fEnd: 52 * k, dur, gain, attack: 0.005 });
  tone(rig, { t, f: 196 * k, fEnd: 120 * k, dur: dur * 0.4, gain: gain * 0.25, attack: 0.005 });
}

const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** `level` 0..1: intensidade opcional (ex.: gorjeta em 'register'); receitas sem variação ignoram. */
type Recipe = (rig: Rig, t: number, r: Rng, level: number) => number;
const jit = (r: Rng, amt = 0.05): number => 1 + (r() - 0.5) * 2 * amt;

export const RECIPES: Record<SfxName, Recipe> = {
  scan(rig, t, r) {
    const f = 2500 * jit(r, 0.04);
    tone(rig, { t, f, dur: 0.085, gain: 0.22, type: 'square', lp: 5200, attack: 0.004 });
    tone(rig, { t, f: f * 1.5, dur: 0.06, gain: 0.05, type: 'sine' });
    return 0.13;
  },
  cash(rig, t, r) {
    // gaveta: clique + baque + deslize + sino
    noiseBurst(rig, r, { t, dur: 0.05, gain: 0.5, type: 'bandpass', f: 1800, q: 1.2 });
    tone(rig, { t, f: 140, fEnd: 55, dur: 0.12, gain: 0.5 });
    noiseBurst(rig, r, { t: t + 0.06, dur: 0.22, gain: 0.18, type: 'bandpass', f: 500, fEnd: 1400, q: 0.9, attack: 0.03 });
    bell(rig, t + 0.12, 2093 * jit(r, 0.02), 0.28, 0.9);
    return 1.1;
  },
  coin(rig, t, r) {
    const n = 3 + Math.floor(r() * 3);
    let at = t;
    for (let i = 0; i < n; i++) {
      const f = (2700 + r() * 1600) * (i % 2 ? 1.12 : 1);
      tone(rig, { t: at, f, dur: 0.16 + r() * 0.1, gain: 0.12, attack: 0.002 });
      tone(rig, { t: at, f: f * 2.41, dur: 0.07, gain: 0.05, attack: 0.002 });
      at += 0.035 + r() * 0.055;
    }
    return at - t + 0.3;
  },
  card(rig, t, r) {
    const p = jit(r, 0.015);
    // duas notas curtas de "maquininha" + confirmação mais longa
    tone(rig, { t, f: 1568 * p, dur: 0.09, gain: 0.2, type: 'square', lp: 4500 });
    tone(rig, { t: t + 0.14, f: 1568 * p, dur: 0.09, gain: 0.2, type: 'square', lp: 4500 });
    tone(rig, { t: t + 0.29, f: 2093 * p, dur: 0.26, gain: 0.2, type: 'square', lp: 4500 });
    return 0.6;
  },
  pop(rig, t, r) {
    const p = jit(r, 0.12);
    tone(rig, { t, f: 380 * p, fEnd: 820 * p, dur: 0.09, gain: 0.4, attack: 0.004 });
    noiseBurst(rig, r, { t, dur: 0.03, gain: 0.1, type: 'highpass', f: 2500 });
    return 0.14;
  },
  error(rig, t, r) {
    const p = jit(r, 0.04);
    for (const dt of [0, 0.14]) {
      tone(rig, { t: t + dt, f: 95 * p, dur: 0.11, gain: 0.3, type: 'sawtooth', lp: 520 });
      tone(rig, { t: t + dt, f: 100.5 * p, dur: 0.11, gain: 0.3, type: 'square', lp: 520 });
    }
    return 0.3;
  },
  levelup(rig, t, r) {
    const base = 523.25 * jit(r, 0.01);
    const steps = [1, 1.2599, 1.4983, 2, 2.5198];
    steps.forEach((s, i) => {
      const last = i === steps.length - 1;
      const at = t + i * 0.085;
      tone(rig, { t: at, f: base * s, dur: last ? 0.7 : 0.2, gain: 0.2, type: 'triangle', attack: 0.005 });
      tone(rig, { t: at, f: base * s * 2, dur: last ? 0.5 : 0.12, gain: 0.05, attack: 0.005 });
    });
    return 0.85 + 0.3;
  },
  door(rig, t, r) {
    // sino de porta de loja: duas batidas
    const f = 1760 * jit(r, 0.02);
    bell(rig, t, f, 0.3, 1.1);
    bell(rig, t + 0.2, f * 1.19, 0.25, 1.0);
    return 1.5;
  },
  step(rig, t, r) {
    // 1ª pessoa: o passo é do próprio jogador e soa o tempo todo → baixo, abafado, sem transiente
    const p = jit(r, 0.15);
    noiseBurst(rig, r, { t, dur: 0.065, gain: 0.13, type: 'lowpass', f: 430 * p, q: 0.6, attack: 0.008 });
    tone(rig, { t, f: 82 * p, fEnd: 56 * p, dur: 0.06, gain: 0.07, attack: 0.008 });
    noiseBurst(rig, r, { t: t + 0.008, dur: 0.04, gain: 0.02, type: 'bandpass', f: 1900 * p, q: 0.8, attack: 0.01 }); // sola
    return 0.1;
  },
  box(rig, t, r) {
    const p = jit(r, 0.1);
    tone(rig, { t, f: 85 * p, fEnd: 45, dur: 0.16, gain: 0.55 });
    noiseBurst(rig, r, { t, dur: 0.12, gain: 0.4, type: 'bandpass', f: 320 * p, q: 0.8 });
    noiseBurst(rig, r, { t: t + 0.01, dur: 0.06, gain: 0.12, type: 'highpass', f: 3000 });
    return 0.26;
  },
  trash(rig, t, r) {
    const p = jit(r, 0.08);
    noiseBurst(rig, r, { t, dur: 0.1, gain: 0.35, type: 'bandpass', f: 900 * p, q: 1.5 });
    tone(rig, { t, f: 180 * p, fEnd: 110 * p, dur: 0.12, gain: 0.3, type: 'triangle' });
    // tampa metálica
    tone(rig, { t: t + 0.07, f: 430 * p, dur: 0.22, gain: 0.07, type: 'square', lp: 1800 });
    tone(rig, { t: t + 0.07, f: 640 * p, dur: 0.18, gain: 0.05, type: 'square', lp: 1800 });
    noiseBurst(rig, r, { t: t + 0.09, dur: 0.15, gain: 0.12, type: 'bandpass', f: 2200, q: 2 });
    return 0.4;
  },
  buy(rig, t, r) {
    const p = jit(r, 0.015);
    tone(rig, { t, f: 1318.5 * p, dur: 0.1, gain: 0.2, type: 'triangle' });
    bell(rig, t + 0.08, 1975.5 * p, 0.28, 0.7);
    return 0.85;
  },
  jingle(rig, t, r) {
    const base = 349.23 * jit(r, 0.005); // F4
    const seq = [1, 1.2599, 1.4983, 1.8877, 2];
    seq.forEach((s, i) => {
      const at = t + i * 0.17;
      const last = i === seq.length - 1;
      tone(rig, { t: at, f: base * s, dur: last ? 1.2 : 0.35, gain: 0.17, type: 'triangle' });
      bell(rig, at, base * s * 2, 0.1, last ? 1.0 : 0.4);
    });
    return 0.17 * 4 + 1.3;
  },
  bell(rig, t, r) {
    const f = 1568 * jit(r, 0.01);
    bell(rig, t, f, 0.22, 0.9);
    bell(rig, t + 0.16, f * 1.335, 0.2, 1.0);
    return 1.3;
  },
  hum(rig, t, r) {
    const p = jit(r, 0.05);
    tone(rig, { t, f: 220 * p, fEnd: 165 * p, dur: 0.38, gain: 0.22, type: 'triangle', lp: 700, attack: 0.04 });
    tone(rig, { t, f: 110 * p, fEnd: 83 * p, dur: 0.38, gain: 0.15, lp: 500, attack: 0.04 });
    return 0.45;
  },
};

/** Duração máxima conhecida (s), usada para liberar nós/voz e para os testes offline. */
export function playRecipe(name: SfxName, rig: Rig, t: number, r: Rng): number {
  return RECIPES[name](rig, t, r);
}
