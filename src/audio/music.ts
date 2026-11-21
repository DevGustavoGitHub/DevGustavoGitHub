/**
 * Música procedural calma + ambiente de rua/loja. Agendamento por currentTime com lookahead.
 */
import { tone, type Rig } from './synth';
import {
  TEMPO_BPM, barSeconds, generateSong, makeRng, midiToHz,
  type MelodyNote, type Phrase, type Quality, type Rng, type Song,
} from './theory';

const LOOKAHEAD = 3.6; // s

/** Teclado elétrico sintético: corpo senoidal + "tine" curto. */
export function epiano(rig: Rig, t: number, midi: number, vel: number, dur: number, gain = 0.1): void {
  const f = midiToHz(midi);
  tone(rig, { t, f, dur, gain: gain * vel, attack: 0.006 });
  tone(rig, { t, f: f * 2, dur: dur * 0.35, gain: gain * vel * 0.28, attack: 0.004 });
  tone(rig, { t, f: f * 4.01, dur: 0.09, gain: gain * vel * 0.1, attack: 0.003 });
}

export interface BarOpts { quality: Quality; melody: boolean }

/** Agenda UM compasso (pad + baixo + piano + melodia) começando em t. Puro em relação ao rig. */
export function scheduleBar(
  rig: Rig, t: number, phrase: Phrase, barInPhrase: number, r: Rng, opts: BarOpts, bpm = TEMPO_BPM,
): void {
  const beat = 60 / bpm;
  const bar = barSeconds(bpm);
  const chord = phrase.chords[barInPhrase % phrase.chords.length]!;
  // humanização: desvio de ±14 ms
  const hz = (): number => (r() - 0.5) * 0.028;

  // pad: triângulos com lowpass, ataque lento e cauda sobreposta ao compasso seguinte
  const padVoices = opts.quality === 'low' ? chord.notes.slice(0, 3) : chord.notes;
  for (const n of padVoices) {
    tone(rig, {
      t, f: midiToHz(n), dur: bar + 1.6, gain: 0.03, type: 'triangle', attack: 1.0, release: 1.8,
      lp: 1000, detune: (r() - 0.5) * 12,
    });
  }
  // baixo leve: tempo 1 e uma nota discreta no tempo 3.5
  tone(rig, { t: t + hz() + 0.01, f: midiToHz(chord.bass), dur: beat * 3, gain: 0.17, attack: 0.02 });
  if (r() < 0.7) {
    tone(rig, { t: t + beat * 2.5 + hz(), f: midiToHz(chord.bass + 7), dur: beat * 1.5, gain: 0.09, attack: 0.02 });
  }
  // piano de acompanhamento
  for (const n of phrase.comping[barInPhrase % phrase.comping.length]!) {
    epiano(rig, Math.max(t, t + n.beat * beat + hz()), n.midi, n.vel * (0.8 + r() * 0.4), n.dur * beat * 1.4, 0.08);
  }
  // melodia esparsa
  if (opts.melody) {
    for (const n of phrase.melody[barInPhrase % phrase.melody.length]! as MelodyNote[]) {
      epiano(rig, Math.max(t, t + n.beat * beat + hz()), n.midi, n.vel * (0.85 + r() * 0.3), n.dur * beat * 1.8, 0.07);
    }
  }
}

export class Music {
  private song: Song;
  private rng: Rng;
  private nextBar = 0;
  private barCount = 0;
  private running = false;
  private quality: Quality = 'high';
  private ambSrc: AudioBufferSourceNode[] = [];
  private ambNodes: AudioNode[] = [];
  private murmur: GainNode[] = [];
  private nextMurmur = 0;

  constructor(private rig: Rig, private ambOut: AudioNode, seed = Math.floor(Math.random() * 1e9)) {
    this.song = generateSong(seed);
    this.rng = makeRng(seed ^ 0x9e3779b9);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const m = q === 'low' ? 0 : 1;
    // murmúrio desligado em "low" (poupa CPU/ruído)
    for (const g of this.murmur) g.gain.setTargetAtTime(m * 0.0, this.rig.ctx.currentTime, 0.3);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextBar = this.rig.ctx.currentTime + 0.15;
    this.startAmbience();
    this.tick();
  }

  stop(): void {
    this.running = false;
    for (const s of this.ambSrc) { try { s.stop(); } catch { /* já parado */ } s.disconnect(); }
    for (const n of this.ambNodes) n.disconnect();
    this.ambSrc = []; this.ambNodes = []; this.murmur = [];
  }

  /** Chamado em intervalo curto (setInterval). */
  tick(): void {
    if (!this.running) return;
    const ctx = this.rig.ctx;
    const now = ctx.currentTime;
    if (this.nextBar < now) this.nextBar = now + 0.05;
    while (this.nextBar < now + LOOKAHEAD) {
      const idx = Math.floor(this.barCount / 4) % this.song.order.length;
      const phrase = this.song.phrases[this.song.order[idx]!]!;
      scheduleBar(this.rig, this.nextBar, phrase, this.barCount % 4, this.rng, {
        quality: this.quality, melody: true,
      });
      this.barCount++;
      this.nextBar += barSeconds();
    }
    this.modulateAmbience(now);
  }

  private startAmbience(): void {
    const { ctx, noise } = this.rig;
    const mk = (type: BiquadFilterType, f: number, q: number, gain: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.loopStart = 0.2; src.loopEnd = noise.duration - 0.2;
      const filt = ctx.createBiquadFilter();
      filt.type = type; filt.frequency.value = f; filt.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filt); filt.connect(g); g.connect(this.ambOut);
      src.start(0, this.rng() * 2);
      this.ambSrc.push(src);
      this.ambNodes.push(filt, g);
      return g;
    };
    mk('lowpass', 240, 0.7, 0.9); // rumor de rua
    this.murmur = [mk('bandpass', 650, 0.8, 0.0), mk('bandpass', 1500, 1.3, 0.0)]; // murmúrio de gente
    this.nextMurmur = 0;
  }

  private modulateAmbience(now: number): void {
    if (now < this.nextMurmur || this.murmur.length === 0) return;
    this.nextMurmur = now + 1.2 + this.rng() * 2.5;
    const on = this.quality === 'low' ? 0 : 1;
    this.murmur.forEach((g, i) => {
      g.gain.setTargetAtTime(on * (0.05 + this.rng() * 0.4) * (i === 0 ? 0.8 : 0.35), now, 0.7);
    });
  }
}
