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
type ChordQuality = keyof typeof QUALITY;

/** Graus no tom maior -> qualidade. */
const DEGREES: Record<number, ChordQuality> = { 0: 'maj7', 2: 'min7', 4: 'min7', 5: 'maj7', 7: 'sus', 9: 'min7' };

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
  // Fase 3 (1ª pessoa, caixa sentado, placa, noite, comemoração, caixas que abrem/fecham)
  'throw', 'mop', 'sit', 'stand', 'place', 'sign', 'night', 'celebrate', 'boxOpen', 'boxClose',
] as const;
export type PublicSfx = (typeof PUBLIC_SFX)[number];
/** Sons internos disparados por outros eventos (dayEnded, storeOpened, reclamação, checkout:done). */
export const INTERNAL_SFX = ['jingle', 'bell', 'hum', 'register'] as const;
export type SfxName = PublicSfx | (typeof INTERNAL_SFX)[number];
export const ALL_SFX: readonly SfxName[] = [...PUBLIC_SFX, ...INTERNAL_SFX];

export interface SfxRequest {
  name: SfxName;
  pan: number;
  /** Ganho relativo da voz (padrão 1). */
  gain?: number;
  /** Intensidade 0..1 para sons com variação (em 'register': gorjeta). */
  level?: number;
  /**
   * Pedido derivado de outro evento (ex.: `player:action`): não toca se o MESMO som chegou explícito
   * (evento `sfx`) há menos de `fallback` s — quem emite o `sfx` no início da animação não ouve em dobro.
   */
  fallback?: number;
  /** Posição da fonte (tiles = metros): o áudio calcula pan/volume em relação à câmera. */
  at?: { x: number; z: number };
}

const isPublic = (n: unknown): n is PublicSfx => typeof n === 'string' && (PUBLIC_SFX as readonly string[]).includes(n);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampPan = (p: unknown): number => (finite(p) ? Math.max(-1, Math.min(1, p)) : 0);

/** `player:action.kind` → som. Map (não objeto) para `kind` como 'constructor' não casar com o protótipo. */
const ACTION_SFX = new Map<string, SfxName>([
  ['throwBox', 'throw'], ['clean', 'mop'], ['sit', 'sit'], ['stand', 'stand'], ['dropBox', 'place'], ['sign', 'sign'],
]);
/** Janela (s) em que um `sfx` explícito cobre o som derivado (esfregão: a ação só é emitida após ~0,9 s de animação). */
export const ACTION_FALLBACK = 1.5;

/** Gorjeta (centavos) → intensidade 0..1 do brilho/moedas da registradora (0 = sem gorjeta). */
export function tipLevel(tip: unknown): number {
  if (!finite(tip) || tip <= 0) return 0;
  return Math.min(1, 0.3 + 0.6 * Math.log10(1 + tip / 100));
}

/** Mapeia um evento do EventBus para um som (ou null se não há som). */
export function mapEvent(event: string, payload?: unknown): SfxRequest | null {
  const p = (payload ?? {}) as { name?: unknown; pan?: unknown; kind?: unknown; x?: unknown; z?: unknown; tip?: unknown };
  switch (event) {
    case 'sfx': {
      if (!isPublic(p.name)) return null;
      const req: SfxRequest = { name: p.name, pan: clampPan(p.pan) };
      if (finite(p.x) && finite(p.z)) req.at = { x: p.x, z: p.z };
      return req;
    }
    // a tela de nível toca a fanfarra (substitui 'levelup', ver SUPERSEDE)
    case 'levelUp': return { name: 'celebrate', pan: 0, fallback: 3 };
    case 'storeClosing': return { name: 'night', pan: 0, fallback: 3 };
    case 'checkout:done': return { name: 'register', pan: 0, level: tipLevel(p.tip) };
    case 'player:action': {
      const name = typeof p.kind === 'string' ? ACTION_SFX.get(p.kind) : undefined;
      return name ? { name, pan: 0, fallback: ACTION_FALLBACK } : null;
    }
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
export const MAPPED_EVENTS = [
  'sfx', 'levelUp', 'storeClosing', 'checkout:done', 'player:action', 'dayEnded', 'storeOpened', 'customerComplaint', 'toast',
] as const;

// ---------------------------------------------------------------- limitador de vozes

export interface SfxSpec {
  /** Duração nominal (s, ≥ a da receita): reserva a voz no limitador. */
  dur: number;
  /** Intervalo mínimo entre dois disparos do mesmo som (s). */
  gap?: number;
  /** Prioridade baixa: só toca se sobrarem vozes livres (passos não roubam vozes de sons importantes). */
  low?: boolean;
}
export const SFX_SPEC: Record<SfxName, SfxSpec> = {
  scan: { dur: 0.13 }, cash: { dur: 1.1 }, coin: { dur: 0.75 }, card: { dur: 0.6 }, pop: { dur: 0.14 },
  error: { dur: 0.3 }, levelup: { dur: 1.15, gap: 0.5 }, door: { dur: 1.5 }, step: { dur: 0.1, gap: 0.12, low: true },
  box: { dur: 0.26 }, trash: { dur: 0.4 }, buy: { dur: 0.85 },
  throw: { dur: 0.5, gap: 0.15 }, mop: { dur: 0.95, gap: 0.3 }, sit: { dur: 0.6, gap: 0.4 }, stand: { dur: 0.62, gap: 0.4 },
  place: { dur: 0.36, gap: 0.12 }, sign: { dur: 1.0, gap: 0.4 }, night: { dur: 2.5, gap: 3 }, celebrate: { dur: 2.0, gap: 2.5 },
  boxOpen: { dur: 0.38, gap: 0.15 }, boxClose: { dur: 0.58, gap: 0.15 },
  jingle: { dur: 2.0, gap: 1 }, bell: { dur: 1.3, gap: 0.3 }, hum: { dur: 0.45 }, register: { dur: 1.6, gap: 0.08 },
};
/** Vozes guardadas para sons normais quando um som de prioridade baixa pede vez. */
export const LOW_PRIORITY_RESERVE = 3;

/**
 * Quem cobre quem: ao tocar a chave, silencia (fade curto) os sons `over` iniciados há menos de `window` s
 * e bloqueia novos `over` pelo mesmo tempo. Nunca tocam os dois por cima.
 */
export const SUPERSEDE: Partial<Record<SfxName, { over: readonly SfxName[]; window: number }>> = {
  celebrate: { over: ['levelup'], window: 3 },
  // a placa já tem sininho: abrir a loja pela placa não toca também o sino de `storeOpened`
  sign: { over: ['bell'], window: 1.5 },
};
const SUPERSEDERS = Object.keys(SUPERSEDE) as SfxName[];

/** Limita sons simultâneos e a taxa de repetição do mesmo som. */
export class VoiceLimiter {
  private ends: number[] = [];
  private last = new Map<string, number>();
  constructor(public max = 14, private minGap = 0.035) {}
  setMax(n: number): void { this.max = n; }
  /** true se o som pode tocar agora (e registra a voz). `reserve` = vozes que precisam sobrar livres. */
  acquire(name: string, now: number, dur: number, gap?: number, reserve = 0): boolean {
    const g = gap ?? (name === 'step' ? 0.12 : this.minGap);
    const l = this.last.get(name);
    if (l !== undefined && now - l < g) return false;
    this.ends = this.ends.filter((e) => e > now);
    if (this.ends.length >= this.max - reserve) return false;
    this.ends.push(now + dur);
    this.last.set(name, now);
    return true;
  }
  /** Momento do último disparo aceito deste som. */
  lastStart(name: string): number | undefined { return this.last.get(name); }
  get active(): number { return this.ends.length; }
}

/** Regras de mixagem: limitador + substituições + pedidos derivados (fallback). Puro (testável). */
export class SfxPolicy {
  readonly limiter: VoiceLimiter;
  private explicitAt = new Map<SfxName, number>();
  constructor(max = 14) { this.limiter = new VoiceLimiter(max); }
  private recent(name: SfxName, now: number, window: number): boolean {
    const l = this.limiter.lastStart(name);
    return l !== undefined && now - l < window;
  }
  /**
   * Decide se `req` toca em `now`. null = não toca; senão, a lista de sons em andamento a silenciar.
   * `explicit` = veio do evento `sfx` (ou `services.audio.sfx`).
   */
  admit(req: SfxRequest, now: number, explicit = false): SfxName[] | null {
    const { name } = req;
    if (explicit) this.explicitAt.set(name, now);
    else if (req.fallback !== undefined) {
      const e = this.explicitAt.get(name);
      if (e !== undefined && now - e < req.fallback) return null;
    }
    for (const k of SUPERSEDERS) {
      const rule = SUPERSEDE[k]!;
      if (rule.over.includes(name) && this.recent(k, now, rule.window)) return null;
    }
    const spec = SFX_SPEC[name];
    if (!this.limiter.acquire(name, now, spec.dur, spec.gap, spec.low ? LOW_PRIORITY_RESERVE : 0)) return null;
    const rule = SUPERSEDE[name];
    return rule ? rule.over.filter((n) => this.recent(n, now, rule.window)) : [];
  }
}

// ---------------------------------------------------------------- espacialização e ducking

export interface Listener { x: number; z: number; /** direção do olhar no plano */ fx: number; fz: number }

/** Pan/ganho de uma fonte (metros, plano XZ) para o ouvinte (câmera em 1ª pessoa). Perto = centro e volume cheio. */
export function spatialize(src: { x: number; z: number }, lis: Listener): { pan: number; gain: number } {
  const dx = src.x - lis.x, dz = src.z - lis.z;
  const d = Math.hypot(dx, dz);
  const fl = Math.hypot(lis.fx, lis.fz);
  if (!Number.isFinite(d) || !Number.isFinite(fl)) return { pan: 0, gain: 1 };
  let pan = 0;
  if (d > 1e-6 && fl > 1e-6) {
    // projeção no vetor "direita" do olhar: (-fz, fx) (câmera Three olha para -Z, direita = +X)
    const side = (dx * -lis.fz + dz * lis.fx) / (d * fl);
    pan = Math.max(-0.85, Math.min(0.85, side * 0.85 * Math.min(1, d / 1.5)));
  }
  const gain = Math.max(0.2, Math.min(1, 1 / (1 + Math.max(0, d - 2) / 6)));
  return { pan, gain };
}

/**
 * Plano do "ducking" da música sob vinhetas (noite, comemoração, fim do dia): curva linear por partes
 * calculada aqui, sem ler AudioParam.value (que não é confiável em todos os navegadores durante automação).
 */
export class DuckPlan {
  private pts: { t: number; v: number }[] = [];
  constructor(readonly low = 0.3, readonly fall = 0.15, readonly rise = 1.2) {}
  valueAt(t: number): number {
    const p = this.pts;
    if (p.length === 0) return 1;
    if (t <= p[0]!.t) return p[0]!.v;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!, b = p[i]!;
      if (t <= b.t) return b.t > a.t ? a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t)) : b.v;
    }
    return p[p.length - 1]!.v;
  }
  /** Abaixa de agora até `until` (estende um ducking em andamento). Pontos: o 1º com setValueAtTime, os demais com linearRamp. */
  duck(now: number, until: number): readonly { t: number; v: number }[] {
    const cur = this.valueAt(now);
    const prevHold = this.pts.length === 4 ? this.pts[2]!.t : -Infinity;
    const hold = Math.max(until, prevHold, now + this.fall);
    this.pts = [{ t: now, v: cur }, { t: now + this.fall, v: this.low }, { t: hold, v: this.low }, { t: hold + this.rise, v: 1 }];
    return this.pts;
  }
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
