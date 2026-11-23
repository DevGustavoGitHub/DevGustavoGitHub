import { describe, expect, it } from 'vitest';
import { makeNoise, playRecipe, type Rig } from '../src/audio/synth';
import {
  ACTION_FALLBACK, ALL_SFX, DuckPlan, INTERNAL_SFX, PUBLIC_SFX, SFX_SPEC, SfxPolicy, VoiceLimiter, barSeconds,
  generateMelody, generateSong, makeChord, makeRng, mapEvent, melodyPitches, midiToHz, parseSettings, spatialize,
  tipLevel, volumeToGain, type SfxName,
} from '../src/audio/theory';

describe('audio: música', () => {
  it('rng determinístico', () => {
    const a = makeRng(7), b = makeRng(7);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
  it('midiToHz', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(57)).toBeCloseTo(220, 6);
  });
  it('acordes ficam em faixa confortável e têm 4 notas', () => {
    for (const tonic of [0, 2, 5, 7]) for (const deg of [0, 2, 4, 5, 7, 9]) {
      const c = makeChord(tonic, deg);
      expect(c.notes).toHaveLength(4);
      expect(c.bass).toBeGreaterThanOrEqual(36);
      expect(c.bass).toBeLessThan(48);
      for (const n of c.notes) { expect(n).toBeGreaterThanOrEqual(60); expect(n).toBeLessThanOrEqual(75); }
    }
  });
  it('canção é determinística e bem formada', () => {
    const a = generateSong(42), b = generateSong(42);
    expect(a).toEqual(b);
    expect(generateSong(43)).not.toEqual(a);
    for (const ph of a.phrases) {
      expect(ph.chords).toHaveLength(4);
      expect(ph.melody).toHaveLength(4);
      expect(ph.comping).toHaveLength(4);
    }
  });
  it('melodias: notas dentro da escala, do compasso e sem sobreposição', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = generateSong(seed);
      const pitches = new Set(melodyPitches(s.tonic));
      for (const ph of s.phrases) for (const bar of [...ph.melody, ...ph.comping]) {
        expect(bar.length).toBeGreaterThan(0);
        for (const n of bar) {
          expect(n.beat).toBeGreaterThanOrEqual(0);
          expect(n.beat).toBeLessThan(4);
          expect(n.vel).toBeGreaterThan(0);
          expect(n.vel).toBeLessThanOrEqual(1);
        }
      }
      for (const ph of s.phrases) for (const bar of ph.melody) for (const n of bar) expect(pitches.has(n.midi)).toBe(true);
    }
  });
  it('melodia nunca vazia mesmo com rng que nunca sorteia', () => {
    const m = generateMelody(() => 0.999, makeChord(0, 0), 0, { i: 3 });
    expect(m.length).toBeGreaterThan(0);
  });
  it('compasso dura ~3,5 s (tempo relaxado)', () => {
    expect(barSeconds()).toBeGreaterThan(3);
    expect(barSeconds()).toBeLessThan(4.5);
  });
});

describe('audio: eventos', () => {
  it('todos os sfx públicos (inclusive os da Fase 3) mapeiam para si mesmos', () => {
    for (const name of PUBLIC_SFX) expect(mapEvent('sfx', { name })).toEqual({ name, pan: 0 });
    for (const name of ['throw', 'mop', 'sit', 'stand', 'place', 'sign', 'night', 'celebrate', 'boxOpen', 'boxClose']) {
      expect(mapEvent('sfx', { name })?.name).toBe(name);
    }
  });
  it('pan é limitado a [-1,1] e ignora lixo; x/z opcionais viram posição', () => {
    expect(mapEvent('sfx', { name: 'scan', pan: 5 })?.pan).toBe(1);
    expect(mapEvent('sfx', { name: 'scan', pan: -5 })?.pan).toBe(-1);
    expect(mapEvent('sfx', { name: 'scan', pan: NaN })?.pan).toBe(0);
    expect(mapEvent('sfx', { name: 'place', x: 3, z: 4 })?.at).toEqual({ x: 3, z: 4 });
    expect(mapEvent('sfx', { name: 'place', x: 3, z: NaN })?.at).toBeUndefined();
  });
  it('nome inválido, interno ou payload ausente não toca', () => {
    expect(mapEvent('sfx', { name: 'nope' })).toBeNull();
    for (const name of INTERNAL_SFX) expect(mapEvent('sfx', { name })).toBeNull();
    expect(mapEvent('sfx')).toBeNull();
    expect(mapEvent('sfx', null)).toBeNull();
  });
  it('eventos de jogo', () => {
    expect(mapEvent('levelUp', { level: 2 })).toEqual({ name: 'celebrate', pan: 0, fallback: 3 });
    expect(mapEvent('storeClosing')?.name).toBe('night');
    expect(mapEvent('dayEnded')?.name).toBe('jingle');
    expect(mapEvent('storeOpened')?.name).toBe('bell');
    expect(mapEvent('customerComplaint', {})?.name).toBe('hum');
    expect(mapEvent('toast', { kind: 'bad' })?.name).toBe('error');
    expect(mapEvent('toast', { kind: 'good' })?.name).toBe('pop');
    expect(mapEvent('toast', { kind: 'info' })).toBeNull();
    expect(mapEvent('toast', { text: 'x' })).toBeNull();
    expect(mapEvent('storeEmpty')).toBeNull();
  });
  it('player:action → sons da Fase 3 (derivados, com fallback)', () => {
    const exp: Record<string, string> = { throwBox: 'throw', clean: 'mop', sit: 'sit', stand: 'stand', dropBox: 'place', sign: 'sign' };
    for (const [kind, name] of Object.entries(exp)) {
      expect(mapEvent('player:action', { kind })).toEqual({ name, pan: 0, fallback: ACTION_FALLBACK });
    }
    for (const kind of ['pickBox', 'placeUnits', 'discardBox', 'storeBox', 'takeBox', 'useComputer', 'move', 'constructor', '__proto__', 5]) {
      expect(mapEvent('player:action', { kind })).toBeNull();
    }
    expect(mapEvent('player:action')).toBeNull();
  });
  it('checkout:done → registradora; gorjeta vira intensidade', () => {
    expect(mapEvent('checkout:done', { customerId: 1, counterId: 2, total: 1000, tip: 0, method: 'cash', happy: true }))
      .toEqual({ name: 'register', pan: 0, level: 0 });
    expect(mapEvent('checkout:done', { tip: 150 })?.level).toBeGreaterThan(0);
    expect(mapEvent('checkout:done')?.level).toBe(0);
    expect(tipLevel(0)).toBe(0); expect(tipLevel(-5)).toBe(0); expect(tipLevel(NaN)).toBe(0); expect(tipLevel('9')).toBe(0);
    expect(tipLevel(5)).toBeGreaterThan(0.29);
    expect(tipLevel(100)).toBeLessThan(tipLevel(1000));
    expect(tipLevel(1e9)).toBe(1);
  });
  it('lista completa de sons e especificação para todos', () => {
    expect(ALL_SFX.length).toBe(PUBLIC_SFX.length + INTERNAL_SFX.length);
    expect(new Set(ALL_SFX).size).toBe(ALL_SFX.length);
    for (const n of ALL_SFX) expect(SFX_SPEC[n].dur).toBeGreaterThan(0);
  });
});

describe('audio: limitador de vozes e regras de mixagem', () => {
  it('respeita o máximo e libera quando as vozes terminam', () => {
    const l = new VoiceLimiter(3, 0);
    expect(l.acquire('a', 0, 1)).toBe(true);
    expect(l.acquire('b', 0, 1)).toBe(true);
    expect(l.acquire('c', 0, 2)).toBe(true);
    expect(l.acquire('d', 0.5, 1)).toBe(false);
    expect(l.acquire('d', 1.1, 1)).toBe(true);
    expect(l.active).toBe(2);
  });
  it('rate-limit do mesmo som', () => {
    const l = new VoiceLimiter(10, 0.05);
    expect(l.acquire('scan', 0, 0.1)).toBe(true);
    expect(l.acquire('scan', 0.01, 0.1)).toBe(false);
    expect(l.acquire('coin', 0.01, 0.1)).toBe(true);
    expect(l.acquire('scan', 0.06, 0.1)).toBe(true);
    expect(l.acquire('step', 1, 0.1)).toBe(true);
    expect(l.acquire('step', 1.06, 0.1)).toBe(false);
    expect(l.acquire('step', 1.13, 0.1)).toBe(true);
    expect(l.lastStart('step')).toBe(1.13);
  });
  it('passo tem prioridade baixa: não ocupa as últimas vozes', () => {
    const p = new SfxPolicy(5);
    expect(p.admit({ name: 'cash', pan: 0 }, 0)).toEqual([]);
    expect(p.admit({ name: 'door', pan: 0 }, 0)).toEqual([]);
    expect(p.admit({ name: 'step', pan: 0 }, 0)).toBeNull(); // 2 ocupadas, sobrariam só 2 < reserva 3
    expect(p.admit({ name: 'buy', pan: 0 }, 0)).toEqual([]);
    expect(new SfxPolicy(14).admit({ name: 'step', pan: 0 }, 0)).toEqual([]);
  });
  it('som derivado não duplica o sfx explícito (esfregão: ação chega ~0,9 s depois)', () => {
    const p = new SfxPolicy();
    const derived = mapEvent('player:action', { kind: 'clean' })!;
    expect(p.admit({ name: 'mop', pan: 0 }, 10, true)).toEqual([]);
    expect(p.admit(derived, 10.9)).toBeNull();
    expect(p.admit({ name: 'mop', pan: 0 }, 11.0, true)).toEqual([]); // próxima limpeza logo em seguida
    expect(p.admit(derived, 11.9)).toBeNull();
    // emissor que só manda player:action: todas tocam
    const q = new SfxPolicy();
    expect(q.admit(derived, 0)).toEqual([]);
    expect(q.admit(derived, 1)).toEqual([]);
    expect(q.admit(derived, 2)).toEqual([]);
  });
  it("celebrate substitui levelup (nas duas ordens) e não empilha duas fanfarras", () => {
    const a = new SfxPolicy();
    expect(a.admit({ name: 'levelup', pan: 0 }, 5, true)).toEqual([]);
    expect(a.admit(mapEvent('levelUp')!, 5)).toEqual(['levelup']); // silencia o que já começou
    expect(a.admit({ name: 'levelup', pan: 0 }, 6, true)).toBeNull();
    expect(a.admit(mapEvent('levelUp')!, 6)).toBeNull(); // dois levelUp seguidos ([3,4]) → uma fanfarra
    expect(a.admit({ name: 'levelup', pan: 0 }, 8.5, true)).toEqual([]); // fora da janela
    const b = new SfxPolicy();
    expect(b.admit({ name: 'celebrate', pan: 0 }, 0, true)).toEqual([]);
    expect(b.admit(mapEvent('levelUp')!, 0.2)).toBeNull(); // a tela já emitiu sfx celebrate
  });
  it('placa cobre o sino de storeOpened', () => {
    const p = new SfxPolicy();
    expect(p.admit(mapEvent('storeOpened')!, 0)).toEqual([]);
    expect(p.admit(mapEvent('player:action', { kind: 'sign' })!, 0)).toEqual(['bell']);
    expect(p.admit(mapEvent('storeOpened')!, 0.5)).toBeNull();
  });
});

describe('audio: espacialização e ducking', () => {
  const lis = { x: 0, z: 0, fx: 0, fz: -1 }; // câmera Three olhando para -Z: direita = +X
  it('pan pela direção do olhar, volume pela distância', () => {
    expect(spatialize({ x: 0, z: -5 }, lis).pan).toBeCloseTo(0, 6);
    expect(spatialize({ x: 4, z: 0 }, lis).pan).toBeGreaterThan(0.5);
    expect(spatialize({ x: -4, z: 0 }, lis).pan).toBeLessThan(-0.5);
    expect(spatialize({ x: 4, z: 0 }, { x: 0, z: 0, fx: 0, fz: 1 }).pan).toBeLessThan(-0.5); // virou de costas
    expect(spatialize({ x: 1, z: 0 }, lis).gain).toBe(1);
    expect(spatialize({ x: 20, z: 0 }, lis).gain).toBeLessThan(0.5);
    expect(spatialize({ x: 1e6, z: 0 }, lis).gain).toBe(0.2);
    expect(spatialize({ x: NaN, z: 0 }, lis)).toEqual({ pan: 0, gain: 1 });
  });
  it('ducking contínuo: abaixa, segura, volta; estender não dá salto', () => {
    const d = new DuckPlan(0.3, 0.15, 1.2);
    expect(d.valueAt(0)).toBe(1);
    const pts = d.duck(10, 12);
    expect(pts[0]).toEqual({ t: 10, v: 1 });
    expect(d.valueAt(11)).toBeCloseTo(0.3, 6);
    expect(d.valueAt(12.6)).toBeCloseTo(0.65, 6);
    expect(d.valueAt(20)).toBe(1);
    const mid = d.valueAt(12.6);
    expect(d.duck(12.6, 13)[0]).toEqual({ t: 12.6, v: mid }); // novo ducking parte do valor atual
    expect(d.duck(12.7, 12.8)[2]!.t).toBe(13); // não encurta o anterior
  });
});

// ---------------------------------------------------------------- mini WebAudio offline (Node não tem)
// Subconjunto usado pelas receitas: AudioParam (set/linear/exponential, semântica da especificação), oscilador,
// ganho, biquad (RBJ, Q em dB no lowpass/highpass como no WebAudio), buffer source e destino.
type Ev = { k: 'set' | 'lin' | 'exp'; t: number; v: number };
class FParam {
  ev: Ev[] = [];
  constructor(public value: number) {}
  private add(k: Ev['k'], v: number, t: number): this {
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) throw new RangeError(`automação inválida ${k} ${v} @ ${t}`);
    if (k === 'exp' && v <= 0) throw new RangeError('exponentialRamp exige valor > 0');
    let i = this.ev.length;
    while (i > 0 && this.ev[i - 1]!.t > t) i--;
    this.ev.splice(i, 0, { k, t, v });
    return this;
  }
  setValueAtTime(v: number, t: number): this { return this.add('set', v, t); }
  linearRampToValueAtTime(v: number, t: number): this { return this.add('lin', v, t); }
  exponentialRampToValueAtTime(v: number, t: number): this { return this.add('exp', v, t); }
  cancelScheduledValues(t: number): this { this.ev = this.ev.filter((e) => e.t < t); return this; }
  at(t: number): number {
    let pt = 0, pv = this.value;
    for (const e of this.ev) {
      if (e.t > t) {
        if (e.k === 'set' || e.t <= pt) return pv;
        const x = (t - pt) / (e.t - pt);
        return e.k === 'lin' ? pv + (e.v - pv) * x : pv > 0 ? pv * Math.pow(e.v / pv, x) : pv;
      }
      pt = e.t; pv = e.v;
    }
    return pv;
  }
  curve(n: number, sr: number): Float32Array {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.at(i / sr);
    return out;
  }
}
class FNode {
  outs = new Set<FNode>();
  connect<T extends FNode>(d: T): T { this.outs.add(d); return d; }
  disconnect(): void { this.outs.clear(); }
  process(x: Float32Array, _n: number, _sr: number): Float32Array { return x; }
}
class FGain extends FNode {
  gain = new FParam(1);
  override process(x: Float32Array, n: number, sr: number): Float32Array {
    const g = this.gain.curve(n, sr);
    for (let i = 0; i < n; i++) x[i]! *= g[i]!;
    return x;
  }
}
class FSource extends FNode {
  t0 = NaN; t1 = Infinity; off = 0;
  onended: (() => void) | null = null;
  start(t = 0, off = 0): void { this.t0 = t; this.off = off; }
  stop(t = 0): void { this.t1 = t; }
  range(n: number, sr: number): [number, number] { return [Math.max(0, Math.ceil(this.t0 * sr)), Math.min(n, Math.ceil(this.t1 * sr))]; }
}
class FOsc extends FSource {
  type: OscillatorType = 'sine';
  frequency = new FParam(440);
  detune = new FParam(0);
  override process(_x: Float32Array, n: number, sr: number): Float32Array {
    const out = new Float32Array(n), f = this.frequency.curve(n, sr), d = this.detune.curve(n, sr);
    const [a, b] = this.range(n, sr);
    let ph = 0;
    for (let i = a; i < b; i++) {
      const x = ph - Math.floor(ph);
      out[i] = this.type === 'sine' ? Math.sin(2 * Math.PI * x) : this.type === 'square' ? (x < 0.5 ? 1 : -1)
        : this.type === 'sawtooth' ? 2 * x - 1 : 1 - 4 * Math.abs(x - 0.5);
      ph += (f[i]! * Math.pow(2, d[i]! / 1200)) / sr;
    }
    return out;
  }
}
class FBufSrc extends FSource {
  buffer: { getChannelData(c: number): Float32Array } | null = null;
  override process(_x: Float32Array, n: number, sr: number): Float32Array {
    const out = new Float32Array(n), d = this.buffer!.getChannelData(0);
    const [a, b] = this.range(n, sr), k0 = Math.round(this.off * sr);
    for (let i = a; i < b && k0 + i - a < d.length; i++) out[i] = d[k0 + i - a]!;
    return out;
  }
}
class FBiquad extends FNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FParam(350);
  Q = new FParam(1);
  override process(x: Float32Array, n: number, sr: number): Float32Array {
    if (this.type !== 'lowpass' && this.type !== 'highpass' && this.type !== 'bandpass') throw new Error('filtro ' + this.type);
    const f = this.frequency.curve(n, sr), q = this.Q.curve(n, sr), out = new Float32Array(n);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    for (let i = 0; i < n; i++) {
      if ((i & 15) === 0) {
        const w = (2 * Math.PI * Math.min(Math.max(f[i]!, 10), sr * 0.49)) / sr, cw = Math.cos(w), sw = Math.sin(w);
        const al = this.type === 'bandpass' ? sw / (2 * Math.max(q[i]!, 1e-4)) : sw / (2 * Math.pow(10, q[i]! / 20));
        const a0 = 1 + al;
        if (this.type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; } else {
          const s = this.type === 'lowpass' ? 1 - cw : 1 + cw;
          b0 = s / 2; b1 = this.type === 'lowpass' ? s : -s; b2 = s / 2;
        }
        b0 /= a0; b1 /= a0; b2 /= a0; a1 = (-2 * cw) / a0; a2 = (1 - al) / a0;
      }
      const y = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]!; y2 = y1; y1 = y; out[i] = y;
    }
    return out;
  }
}
class FCtx {
  readonly nodes: FNode[] = [];
  readonly destination = this.reg(new FNode());
  readonly currentTime = 0;
  constructor(readonly sampleRate: number) {}
  private reg<T extends FNode>(nd: T): T { this.nodes.push(nd); return nd; }
  createGain(): FGain { return this.reg(new FGain()); }
  createOscillator(): FOsc { return this.reg(new FOsc()); }
  createBiquadFilter(): FBiquad { return this.reg(new FBiquad()); }
  createBufferSource(): FBufSrc { return this.reg(new FBufSrc()); }
  createBuffer(_ch: number, n: number, sr: number): { length: number; sampleRate: number; duration: number; getChannelData(c: number): Float32Array } {
    const d = new Float32Array(n);
    return { length: n, sampleRate: sr, duration: n / sr, getChannelData: () => d };
  }
  render(n: number): Float32Array {
    const ins = new Map<FNode, FNode[]>();
    for (const nd of this.nodes) for (const o of nd.outs) ins.set(o, [...(ins.get(o) ?? []), nd]);
    const memo = new Map<FNode, Float32Array>(), busy = new Set<FNode>();
    const pull = (nd: FNode): Float32Array => {
      const m = memo.get(nd);
      if (m) return m;
      if (busy.has(nd)) throw new Error('ciclo no grafo');
      busy.add(nd);
      const sum = new Float32Array(n);
      for (const src of ins.get(nd) ?? []) { const x = pull(src); for (let k = 0; k < n; k++) sum[k]! += x[k]!; }
      const r = nd.process(sum, n, this.sampleRate);
      memo.set(nd, r);
      busy.delete(nd);
      return r;
    };
    return pull(this.destination);
  }
}

const SR = 24000, T0 = 0.02;
function renderSfx(name: SfxName, seed: number, level = 0) {
  const ctx = new FCtx(SR);
  const voice = ctx.createGain();
  voice.connect(ctx.destination);
  const rig = { ctx, out: voice, noise: makeNoise(ctx as unknown as BaseAudioContext, 2) } as unknown as Rig;
  const dur = playRecipe(name, rig, T0, makeRng(seed), level);
  const n = Math.ceil((T0 + dur + 0.4) * SR);
  const data = ctx.render(n);
  let peak = 0, sum = 0, after = 0, nan = false;
  const a0 = Math.floor(T0 * SR), a1 = Math.ceil((T0 + dur) * SR), rel = Math.ceil((T0 + dur + 0.25) * SR);
  for (let i = 0; i < n; i++) {
    const v = data[i]!;
    if (!Number.isFinite(v)) nan = true;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (i >= a0 && i < a1) sum += v * v;
    if (i >= rel && a > after) after = a;
  }
  // sem estalo: o envelope (produto dos ganhos até o destino) está fechado quando cada fonte liga e desliga
  const pathGain = (nd: FNode, t: number): number => {
    if (nd === ctx.destination) return 1;
    let s = 0;
    for (const o of nd.outs) s += (o instanceof FGain ? o.gain.at(t) : 1) * pathGain(o, t);
    return s;
  };
  let edge = 0, unstopped = 0;
  const sources = ctx.nodes.filter((x): x is FSource => x instanceof FSource);
  for (const s of sources) {
    if (!Number.isFinite(s.t1) || !Number.isFinite(s.t0)) { unstopped++; continue; }
    edge = Math.max(edge, Math.abs(pathGain(s, s.t0)), Math.abs(pathGain(s, s.t1)));
  }
  // nós desconectados: depois do onended de todas as fontes, nada além da voz continua ligado
  for (const s of [...sources].sort((x, y) => x.t1 - y.t1)) s.onended?.();
  const leaked = ctx.nodes.filter((x) => x !== ctx.destination && x !== voice && x.outs.size > 0).length;
  return { dur, data, peak, rms: Math.sqrt(sum / Math.max(1, a1 - a0)), after, nan, edge, unstopped, leaked, nodes: ctx.nodes.length };
}

describe('audio: render offline de todas as receitas', () => {
  const cases: [string, SfxName, number][] = [...ALL_SFX.map((n): [string, SfxName, number] => [n, n, 0]), ['register+gorjeta', 'register', 1]];
  const peaks = new Map<string, number>();
  for (const [label, name, level] of cases) {
    it(label, () => {
      const a = renderSfx(name, 1, level), b = renderSfx(name, 2, level);
      for (const r of [a, b]) {
        expect(r.nan).toBe(false);
        expect(r.peak).toBeGreaterThan(0.05);
        expect(r.peak).toBeLessThan(0.98);
        expect(r.rms).toBeGreaterThan(0.004);
        expect(r.dur).toBeLessThanOrEqual(SFX_SPEC[name].dur + 0.02);
        expect(r.after).toBeLessThan(3e-3); // nada soa depois da liberação da voz (dur + 0,25 s)
        expect(r.edge).toBeLessThan(1e-3);
        expect(r.unstopped).toBe(0);
        expect(r.leaked).toBe(0);
        expect(r.nodes).toBeLessThan(260);
      }
      // variação de afinação/tempo entre disparos
      let diff = 0;
      for (let i = 0; i < Math.min(a.data.length, b.data.length); i++) diff = Math.max(diff, Math.abs(a.data[i]! - b.data[i]!));
      expect(diff).toBeGreaterThan(1e-3);
      peaks.set(label, Math.max(a.peak, b.peak));
    });
  }
  it('passo discreto em 1ª pessoa e fanfarra mais marcante que levelup', () => {
    expect(peaks.get('step')!).toBeLessThan(peaks.get('box')! * 0.5);
    expect(peaks.get('step')!).toBeLessThan(0.16);
    expect(peaks.get('celebrate')!).toBeGreaterThan(peaks.get('levelup')!);
    expect(renderSfx('celebrate', 3).rms).toBeGreaterThan(renderSfx('levelup', 3).rms);
  });
});
