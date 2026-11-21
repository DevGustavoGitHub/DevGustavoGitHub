import type { GameContext, GameModule } from '../core/module';
import { Music } from './music';
import { makeNoise, playRecipe, type Rig } from './synth';
import {
  DEFAULT_SETTINGS, MAPPED_EVENTS, VoiceLimiter, mapEvent, parseSettings, volumeToGain,
  type AudioSettings, type SfxName,
} from './theory';

const SETTINGS_KEY = 'mercadinho:settings';
const GESTURES = ['pointerdown', 'keydown', 'touchend', 'click'] as const;

type AC = typeof AudioContext;
function audioCtor(): AC | null {
  const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function readStoredSettings(): Partial<AudioSettings> {
  try { return parseSettings(localStorage.getItem(SETTINGS_KEY)); } catch { return {}; }
}

export default function create(): GameModule {
  let game: GameContext | null = null;
  let ac: AudioContext | null = null;
  let rig: Rig | null = null;
  let master: GainNode;
  let sfxBus: GainNode;
  let musicBus: GainNode;
  let ambBus: GainNode;
  let music: Music | null = null;
  let musicTimer: ReturnType<typeof setInterval> | null = null;
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  let settings: AudioSettings = { ...DEFAULT_SETTINGS };
  const limiter = new VoiceLimiter(14);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const offs: (() => void)[] = [];

  const maxVoices = (): number => (settings.quality === 'low' ? 8 : settings.quality === 'medium' ? 11 : 14);

  function applySettings(patch: Partial<AudioSettings>): void {
    settings = { ...settings, ...patch };
    limiter.setMax(maxVoices());
    if (ac) {
      master.gain.setTargetAtTime(volumeToGain(settings.volume), ac.currentTime, 0.05);
      music?.setQuality(settings.quality);
    }
  }

  function build(): void {
    const Ctor = audioCtor();
    if (!Ctor) return;
    try { ac = new Ctor({ latencyHint: 'interactive' }); } catch { ac = null; return; }
    const c = ac;
    master = c.createGain();
    master.gain.value = volumeToGain(settings.volume);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 3;
    comp.attack.value = 0.006; comp.release.value = 0.2;
    master.connect(comp); comp.connect(c.destination);

    sfxBus = c.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = c.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    ambBus = c.createGain(); ambBus.gain.value = 0; ambBus.connect(master);

    // eco leve para dar espaço à música (apenas no barramento da música)
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.28;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 1800;
    const wet = c.createGain(); wet.gain.value = 0.3;
    musicBus.connect(delay); delay.connect(dlp); dlp.connect(fb); fb.connect(delay);
    dlp.connect(wet); wet.connect(master);

    rig = { ctx: c, out: sfxBus, noise: makeNoise(c) };
    music = new Music({ ctx: c, out: musicBus, noise: rig.noise }, ambBus);
    music.setQuality(settings.quality);
    c.addEventListener('statechange', onStateChange);
  }

  function onStateChange(): void {
    // iOS pode "interromper" o contexto (ligação, etc.); o próximo gesto retoma.
  }

  function startMusic(): void {
    if (!ac || !music || musicTimer) return;
    const t = ac.currentTime;
    // começa baixo e sobe devagar (sem estalo)
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(0, t);
    musicBus.gain.linearRampToValueAtTime(0.5, t + 5);
    ambBus.gain.cancelScheduledValues(t);
    ambBus.gain.setValueAtTime(0, t);
    ambBus.gain.linearRampToValueAtTime(0.12, t + 4);
    music.start();
    musicTimer = setInterval(() => { if (ac?.state === 'running') music?.tick(); }, 250);
  }

  function unlock(): void {
    if (hidden) return;
    if (!ac) build();
    if (!ac) return;
    if (ac.state !== 'running') {
      void ac.resume().then(() => { if (ac?.state === 'running') startMusic(); }).catch(() => undefined);
      // iOS: toca um buffer mudo dentro do gesto para destravar a saída
      try {
        const b = ac.createBuffer(1, 1, ac.sampleRate);
        const s = ac.createBufferSource();
        s.buffer = b; s.connect(ac.destination); s.start(0);
      } catch { /* ignore */ }
    } else {
      startMusic();
    }
  }

  function playSfx(name: SfxName, pan = 0): void {
    if (!ac || !rig || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (!limiter.acquire(name, now, 0.5)) return;
    const voice = ac.createGain();
    let tail: AudioNode = voice;
    let panner: StereoPannerNode | null = null;
    if (pan !== 0 && typeof ac.createStereoPanner === 'function') {
      panner = ac.createStereoPanner();
      panner.pan.value = pan;
      voice.connect(panner);
      tail = panner;
    }
    tail.connect(sfxBus);
    const dur = playRecipe(name, { ctx: ac, out: voice, noise: rig.noise }, now + 0.005, game ? game.rand : Math.random);
    const id = setTimeout(() => {
      timers.delete(id);
      voice.disconnect(); panner?.disconnect();
    }, (dur + 0.25) * 1000);
    timers.add(id);
  }

  function onVisibility(): void {
    hidden = document.visibilityState === 'hidden';
    if (!ac) return;
    if (hidden) void ac.suspend().catch(() => undefined);
    else void ac.resume().catch(() => undefined);
  }

  return {
    name: 'audio',
    init(ctx) {
      game = ctx;
      applySettings(readStoredSettings());
      for (const ev of MAPPED_EVENTS) {
        offs.push(ctx.bus.on(ev, (p) => {
          const req = mapEvent(ev, p);
          if (req) playSfx(req.name, req.pan);
        }));
      }
      offs.push(ctx.bus.on('settings:changed', (p) => applySettings(parseSettings(p))));
      for (const g of GESTURES) {
        window.addEventListener(g, unlock, { passive: true, capture: true });
        offs.push(() => window.removeEventListener(g, unlock, { capture: true }));
      }
      document.addEventListener('visibilitychange', onVisibility);
      offs.push(() => document.removeEventListener('visibilitychange', onVisibility));
      ctx.services.audio = {
        get state() { return ac ? ac.state : 'none'; },
        sfx: (name, pan) => { const r = mapEvent('sfx', { name, pan }); if (r) playSfx(r.name, r.pan); },
        setVolume: (v) => applySettings({ volume: v }),
      };
    },
    update() { /* tudo é agendado por timers/currentTime do WebAudio */ },
    dispose() {
      for (const o of offs) o();
      offs.length = 0;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
      music?.stop();
      music = null;
      if (ac) { ac.removeEventListener('statechange', onStateChange); void ac.close().catch(() => undefined); }
      ac = null; rig = null;
      if (game) delete game.services.audio;
    },
  };
}
