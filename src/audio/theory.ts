/**
 * Partes PURAS do áudio (sem WebAudio/DOM): RNG, teoria musical, mapeamento de eventos,
 * limitador de vozes e leitura de configurações. Testadas em tests/audio.test.ts.
 */

export type Rng = () => number;

/** RNG determinístico (mulberry32). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- música

export interface Chord {
  /** Fundamental (MIDI) na oitava do baixo (36..47). */
  bass: number;
  /** Notas do pad/teclado (MIDI, 60..75). */
  notes: number[];
  /** Grau no tom (0..11), só para depuração/testes. */
  degree: number;
}

export interface MelodyNote {
  /** Posição em batidas dentro do compasso, [0, 4). */
  beat: number;
  /** Duração em batidas. */
  dur: number;
  midi: number;
  /** Intensidade 0..1. */
  vel: number;
}

export interface Phrase {
  chords: Chord[];
  /** Uma lista de notas de melodia por compasso. */
  melody: MelodyNote[][];
  /** Notas do "piano" de acompanhamento por compasso. */
  comping: MelodyNote[][];
}

export const BEATS_PER_BAR = 4;
export const TEMPO_BPM = 68;
export const barSeconds = (bpm = TEMPO_BPM): number => (60 / bpm) * BEATS_PER_BAR;

/** Intervalos dos acordes (sete-maior, menor-sete, sus). Suaves, sem dissonância forte. */
const QUALITY = {
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus: [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
} as const;
type Quality = keyof typeof QUALITY;

/** Graus no tom maior -> qualidade. */
const DEGREES: Record<number, Quality> = { 0: 'maj7', 2: 'min7', 4: 'min7', 5: 'maj7', 7: 'sus', 9: 'min7' };

const PROGRESSIONS: number[][] = [
  [0, 9, 5, 7],
  [0, 4, 9, 5],
  [5, 0, 7, 9],
  [0, 5, 2, 7],
  [9, 5, 0, 7],
  [0, 2, 5, 0],
];

/** Tons possíveis (semitons acima de C). Escolhidos por serem confortáveis para alto-falantes de celular. */
const TONICS = [0, 2, 5, 7];

export function makeChord(tonic: number, degree: number): Chord {
  const q = DEGREES[degree] ?? 'maj7';
  const pc = (tonic + degree) % 12;
  const root = 48 + pc; // 48..59
  const ints: readonly number[] = q === 'add9' ? QUALITY.add9 : QUALITY[q];
  // Voicing: fundamental uma oitava acima do baixo + 3 notas superiores; sempre dentro de 60..75.
  const notes = ints.map((i) => root + 12 + i);
  for (let k = 0; k < notes.length; k++) {
    while (notes[k]! > 75) notes[k] = notes[k]! - 12;
  }
  return { bass: root - 12, notes: notes.sort((a, b) => a - b), degree };
}

/** Escala pentatônica maior sobre o tom, de 72 (C5) a 88. */
export function melodyPitches(tonic: number): number[] {
  const out: number[] = [];
  for (let m = 70; m <= 88; m++) {
    const d = (((m - tonic) % 12) + 12) % 12;
    if (d === 0 || d === 2 || d === 4 || d === 7 || d === 9) out.push(m);
  }
  return out;
}

export function generateMelody(rng: Rng, chord: Chord, tonic: number, prevIdx: { i: number }): MelodyNote[] {
  const pitches = melodyPitches(tonic);
  const chordPcs = new Set(chord.notes.map((n) => n % 12));
  const slots = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  const notes: MelodyNote[] = [];
  let i = Math.min(Math.max(prevIdx.i, 0), pitches.length - 1);
  let lastBeat = -10;
  for (const s of slots) {
    const strong = s % 1 === 0;
    const p = s === 0 ? 0.75 : strong ? 0.4 : 0.2;
    if (lastBeat > s - 0.5 + 1e-9 || rng() > p) continue;
    // passeio aleatório curto, com preferência por notas do acorde nos tempos fortes
    let step = Math.floor(rng() * 5) - 2;
    if (step === 0) step = rng() < 0.5 ? 1 : -1;
    let j = Math.min(Math.max(i + step, 0), pitches.length - 1);
    if (strong) {
      for (let k = 0; k < 4; k++) {
        if (chordPcs.has(pitches[j]! % 12)) break;
        j = Math.min(Math.max(j + (rng() < 0.5 ? 1 : -1), 0), pitches.length - 1);
      }
    }
    i = j;
    const dur = strong ? 1 + Math.floor(rng() * 2) : 0.5;
    notes.push({ beat: s, dur, midi: pitches[i]!, vel: 0.45 + rng() * 0.3 });
    lastBeat = s + (dur > 1 ? 1 : 0); // notas longas "ocupam" o próximo tempo
  }
  if (notes.length === 0) notes.push({ beat: 0, dur: 2, midi: pitches[i]!, vel: 0.5 });
  prevIdx.i = i;
  return notes;
}

/** Acompanhamento de "piano" arpejado, suave. */
export function generateComping(rng: Rng, chord: Chord): MelodyNote[] {
  const n = chord.notes;
  const patterns: number[][] = [
    [0, 1.5, 2.5],
    [0, 1, 2, 3],
    [0, 2, 3.5],
  ];
  const beats = patterns[Math.floor(rng() * patterns.length)]!;
  return beats.map((beat, k) => ({
    beat,
    dur: 1.5,
    midi: n[(k + (rng() < 0.3 ? 1 : 0)) % n.length]!,
    vel: 0.3 + rng() * 0.2,
  }));
}

export function generatePhrase(rng: Rng, tonic: number, prog?: number[]): Phrase {
  const degs = prog ?? PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)]!;
  const chords = degs.map((d) => makeChord(tonic, d));
  const prev = { i: 4 };
  return {
    chords,
    melody: chords.map((c) => generateMelody(rng, c, tonic, prev)),
    comping: chords.map((c) => generateComping(rng, c)),
  };
}

export interface Song { tonic: number; phrases: Phrase[]; order: number[] }

/** Estrutura A B A C em loop — soa como uma música, não como aleatoriedade pura. */
export function generateSong(seed: number): Song {
  const rng = makeRng(seed);
  const tonic = TONICS[Math.floor(rng() * TONICS.length)]!;
  const first = Math.floor(rng() * PROGRESSIONS.length);
  const phrases = [0, 1, 2].map((k) =>
    generatePhrase(rng, tonic, PROGRESSIONS[(first + k * 2) % PROGRESSIONS.length]),
  );
  return { tonic, phrases, order: [0, 1, 0, 2] };
}

// ---------------------------------------------------------------- eventos -> sons

export const PUBLIC_SFX = [
  'scan', 'cash', 'coin', 'card', 'pop', 'error', 'levelup', 'door', 'step', 'box', 'trash', 'buy',
] as const;
export type PublicSfx = (typeof PUBLIC_SFX)[number];
/** Sons internos extras disparados por outros eventos. */
export type SfxName = PublicSfx | 'jingle' | 'bell' | 'hum';
export const ALL_SFX: readonly SfxName[] = [...PUBLIC_SFX, 'jingle', 'bell', 'hum'];

export interface SfxRequest { name: SfxName; pan: number }

const isPublic = (n: unknown): n is PublicSfx => typeof n === 'string' && (PUBLIC_SFX as readonly string[]).includes(n);
const clampPan = (p: unknown): number => (typeof p === 'number' && Number.isFinite(p) ? Math.max(-1, Math.min(1, p)) : 0);

/** Mapeia um evento do EventBus para um som (ou null se não há som). */
export function mapEvent(event: string, payload?: unknown): SfxRequest | null {
  const p = (payload ?? {}) as { name?: unknown; pan?: unknown; kind?: unknown };
  switch (event) {
    case 'sfx': return isPublic(p.name) ? { name: p.name, pan: clampPan(p.pan) } : null;
    case 'levelUp': return { name: 'levelup', pan: 0 };
    case 'dayEnded': return { name: 'jingle', pan: 0 };
    case 'storeOpened': return { name: 'bell', pan: 0 };
    case 'customerComplaint': return { name: 'hum', pan: 0 };
    case 'toast':
      if (p.kind === 'bad') return { name: 'error', pan: 0 };
      if (p.kind === 'good') return { name: 'pop', pan: 0 };
      return null;
    default: return null;
  }
}
export const MAPPED_EVENTS = ['sfx', 'levelUp', 'dayEnded', 'storeOpened', 'customerComplaint', 'toast'] as const;

// ---------------------------------------------------------------- limitador de vozes

/** Limita sons simultâneos e a taxa de repetição do mesmo som. */
export class VoiceLimiter {
  private ends: number[] = [];
  private last = new Map<string, number>();
  constructor(public max = 14, private minGap = 0.035) {}
  setMax(n: number): void { this.max = n; }
  /** true se o som pode tocar agora (e registra a voz). */
  acquire(name: string, now: number, dur: number): boolean {
    const gap = name === 'step' ? 0.09 : this.minGap;
    const l = this.last.get(name);
    if (l !== undefined && now - l < gap) return false;
    this.ends = this.ends.filter((e) => e > now);
    if (this.ends.length >= this.max) return false;
    this.ends.push(now + dur);
    this.last.set(name, now);
    return true;
  }
  get active(): number { return this.ends.length; }
}

// ---------------------------------------------------------------- configurações

export type Quality = 'low' | 'medium' | 'high';
export interface AudioSettings { volume: number; quality: Quality }
export const DEFAULT_SETTINGS: AudioSettings = { volume: 0.7, quality: 'high' };

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Curva perceptual: volume do slider (0..1) -> ganho master. */
export const volumeToGain = (v: number): number => Math.pow(clamp01(v), 2) * 0.9;

/** Aceita parcial/inválido; devolve só campos válidos. */
export function parseSettings(raw: unknown): Partial<AudioSettings> {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try { o = JSON.parse(raw); } catch { return {}; }
  }
  if (!o || typeof o !== 'object') return {};
  const r = o as Record<string, unknown>;
  const out: Partial<AudioSettings> = {};
  if (typeof r.volume === 'number' && Number.isFinite(r.volume)) out.volume = clamp01(r.volume);
  if (r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') out.quality = r.quality;
  return out;
}
