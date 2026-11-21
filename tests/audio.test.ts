import { describe, expect, it } from 'vitest';
import {
  ALL_SFX, PUBLIC_SFX, VoiceLimiter, barSeconds, generateMelody, generateSong, makeChord, makeRng,
  mapEvent, melodyPitches, midiToHz, parseSettings, volumeToGain,
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
  it('todos os sfx públicos mapeiam para si mesmos', () => {
    for (const name of PUBLIC_SFX) expect(mapEvent('sfx', { name })).toEqual({ name, pan: 0 });
  });
  it('pan é limitado a [-1,1] e ignora lixo', () => {
    expect(mapEvent('sfx', { name: 'scan', pan: 5 })?.pan).toBe(1);
    expect(mapEvent('sfx', { name: 'scan', pan: -5 })?.pan).toBe(-1);
    expect(mapEvent('sfx', { name: 'scan', pan: NaN })?.pan).toBe(0);
  });
  it('nome inválido ou payload ausente não toca', () => {
    expect(mapEvent('sfx', { name: 'nope' })).toBeNull();
    expect(mapEvent('sfx')).toBeNull();
    expect(mapEvent('sfx', null)).toBeNull();
  });
  it('eventos de jogo', () => {
    expect(mapEvent('levelUp', { level: 2 })?.name).toBe('levelup');
    expect(mapEvent('dayEnded')?.name).toBe('jingle');
    expect(mapEvent('storeOpened')?.name).toBe('bell');
    expect(mapEvent('customerComplaint', {})?.name).toBe('hum');
    expect(mapEvent('toast', { kind: 'bad' })?.name).toBe('error');
    expect(mapEvent('toast', { kind: 'good' })?.name).toBe('pop');
    expect(mapEvent('toast', { kind: 'info' })).toBeNull();
    expect(mapEvent('toast', { text: 'x' })).toBeNull();
    expect(mapEvent('storeClosing')).toBeNull();
  });
  it('lista completa de sons', () => {
    expect(ALL_SFX.length).toBe(PUBLIC_SFX.length + 3);
  });
});

describe('audio: limitador de vozes', () => {
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
  });
});

describe('audio: configurações', () => {
  it('parse tolerante', () => {
    expect(parseSettings('{"volume":0.3,"haptics":true,"quality":"low"}')).toEqual({ volume: 0.3, quality: 'low' });
    expect(parseSettings({ volume: 7 })).toEqual({ volume: 1 });
    expect(parseSettings({ volume: 'x', quality: 'ultra' })).toEqual({});
    expect(parseSettings('lixo{')).toEqual({});
    expect(parseSettings(null)).toEqual({});
  });
  it('curva de volume monotônica, 0 -> mudo', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(0.5)).toBeLessThan(volumeToGain(0.8));
    expect(volumeToGain(2)).toBeLessThanOrEqual(0.9);
  });
});
