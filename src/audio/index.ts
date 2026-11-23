import type { GameContext, GameModule } from '../core/module';
import { Music } from './music';
import { makeNoise, playRecipe, type Rig } from './synth';
import {
  DEFAULT_SETTINGS, DuckPlan, MAPPED_EVENTS, SfxPolicy, mapEvent, parseSettings, spatialize, volumeToGain,
  type AudioSettings, type SfxName, type SfxRequest,
} from './theory';

const SETTINGS_KEY = 'mercadinho:settings';
const GESTURES = ['pointerdown', 'keydown', 'touchend', 'click'] as const;
/** Nível da música no barramento (o ducking multiplica por cima, num nó próprio). */
const MUSIC_LEVEL = 0.5;
/** Vinhetas que abaixam a música enquanto tocam (evita choque de tonalidade com a trilha). */
const DUCKERS: ReadonlySet<SfxName> = new Set<SfxName>(['night', 'celebrate', 'jingle']);
/** Venda num balcão que não é o do jogador (funcionário): um pouco mais baixa, além da distância. */
const OTHER_COUNTER_GAIN = 0.8;

interface Voice { name: SfxName; node: GainNode; start: number; level: number; faded: boolean }
interface LogEntry { name: SfxName; at: number; pan: number; gain: number; level: number }

type AC = typeof AudioContext;
function audioCtor(): AC | null {
  const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function readStoredSettings(): Partial<AudioSettings> {
  try { return parseSettings(localStorage.getItem(SETTINGS_KEY)); } catch { return {}; }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export default function create(): GameModule {
  let game: GameContext | null = null;
  let ac: AudioContext | null = null;
  let rig: Rig | null = null;
  let master: GainNode;
  let sfxBus: GainNode;
  let musicBus: GainNode;
  let musicDuck: GainNode;
  let ambBus: GainNode;
  let music: Music | null = null;
  let musicTimer: ReturnType<typeof setInterval> | null = null;
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  let settings: AudioSettings = { ...DEFAULT_SETTINGS };
  const policy = new SfxPolicy(14);
  const ducker = new DuckPlan();
  const voices = new Set<Voice>();
  const log: LogEntry[] = [];
  let foot = 1;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const offs: (() => void)[] = [];

  const maxVoices = (): number => (settings.quality === 'low' ? 8 : settings.quality === 'medium' ? 11 : 14);

  function applySettings(patch: Partial<AudioSettings>): void {
    settings = { ...settings, ...patch };
    policy.limiter.setMax(maxVoices());
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
    musicBus = c.createGain(); musicBus.gain.value = 0;
    musicDuck = c.createGain(); musicDuck.gain.value = 1;
    musicBus.connect(musicDuck); musicDuck.connect(master);
    ambBus = c.createGain(); ambBus.gain.value = 0; ambBus.connect(master);

    // eco leve para dar espaço à música (apenas no barramento da música, depois do ducking)
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.28;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 1800;
    const wet = c.createGain(); wet.gain.value = 0.3;
    musicDuck.connect(delay); delay.connect(dlp); dlp.connect(fb); fb.connect(delay);
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
    musicBus.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + 5);
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

  /** Pan/ganho em relação à câmera (1ª pessoa), lidos de matrixWorld (sem alocar). */
  function fromCamera(at: { x: number; z: number }): { pan: number; gain: number } | null {
    const e = game?.camera?.matrixWorld?.elements;
    if (!e) return null;
    // posição = coluna 3; a câmera olha para -Z local → direção = -(coluna 2)
    return spatialize(at, { x: e[12] ?? 0, z: e[14] ?? 0, fx: -(e[8] ?? 0), fz: -(e[10] ?? 1) });
  }

  /** checkout:done num balcão onde o jogador NÃO está sentado: som no lugar do balcão, um pouco mais baixo. */
  function placeAtCounter(req: SfxRequest, payload: unknown): void {
    const id = (payload as { counterId?: unknown } | null | undefined)?.counterId;
    const s = game?.services;
    if (!finite(id) || !s) return;
    const mine = s.player?.seatedAt ?? s.player?.atCounter ?? null;
    if (mine === id) return;
    try {
      const c = s.world?.counters().find((k) => k.furnitureId === id);
      if (c && finite(c.scanner.x) && finite(c.scanner.z)) {
        req.at = { x: c.scanner.x, z: c.scanner.z };
        req.gain = (req.gain ?? 1) * OTHER_COUNTER_GAIN;
      }
    } catch { /* world indisponível: toca centralizado */ }
  }

  function fadeOut(v: Voice, now: number): void {
    v.faded = true;
    const g = v.node.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(v.level, now);
    // ainda não começou: corta já (sinal é zero); tocando: fade curto, sem estalo
    g.linearRampToValueAtTime(0, now + (v.start > now ? 0.003 : 0.05));
  }

  function duckMusic(now: number, dur: number): void {
    if (!ac || !musicTimer) return;
    const pts = ducker.duck(now, now + Math.max(0.3, dur - 0.4));
    const g = musicDuck.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now); else g.cancelScheduledValues(now);
    g.setValueAtTime(pts[0]!.v, pts[0]!.t);
    for (let i = 1; i < pts.length; i++) g.linearRampToValueAtTime(pts[i]!.v, pts[i]!.t);
  }

  function play(req: SfxRequest, explicit: boolean): void {
    if (!ac || !rig || ac.state !== 'running') return;
    const now = ac.currentTime;
    const silence = policy.admit(req, now, explicit);
    if (!silence) return;
    for (const v of voices) if (!v.faded && silence.includes(v.name)) fadeOut(v, now);
    let pan = req.pan;
    let level = req.gain ?? 1;
    if (req.at) {
      const s = fromCamera(req.at);
      if (s) { pan = s.pan; level *= s.gain; }
    }
    // passos alternam pé esquerdo/direito bem de leve
    if (req.name === 'step' && pan === 0) { foot = -foot; pan = foot * 0.08; }
    const node = ac.createGain();
    node.gain.value = level;
    let panner: StereoPannerNode | null = null;
    if (pan !== 0 && typeof ac.createStereoPanner === 'function') {
      panner = ac.createStereoPanner();
      panner.pan.value = pan;
      node.connect(panner);
      panner.connect(sfxBus);
    } else node.connect(sfxBus);
    const v: Voice = { name: req.name, node, start: now + 0.005, level, faded: false };
    let dur = 3;
    try {
      dur = playRecipe(req.name, { ctx: ac, out: node, noise: rig.noise }, v.start, game ? game.rand : Math.random, req.level ?? 0);
    } finally {
      voices.add(v);
      const id = setTimeout(() => {
        timers.delete(id);
        voices.delete(v);
        node.disconnect(); panner?.disconnect();
      }, (dur + 0.25) * 1000);
      timers.add(id);
    }
    if (DUCKERS.has(req.name)) duckMusic(now, dur);
    log.push({ name: req.name, at: now, pan, gain: level, level: req.level ?? 0 });
    if (log.length > 64) log.shift();
  }

  function onVisibility(): void {
    hidden = document.visibilityState === 'hidden';
    if (!ac) return;
    if (hidden) void ac.suspend().catch(() => undefined);
    else void ac.resume().catch(() => undefined);
  }

  type Debug = { log(): LogEntry[]; clear(): void; voices(): number };
  const debugWin = (): { __audio?: Debug } => window as unknown as { __audio?: Debug };

  return {
    name: 'audio',
    init(ctx) {
      game = ctx;
      applySettings(readStoredSettings());
      for (const ev of MAPPED_EVENTS) {
        offs.push(ctx.bus.on(ev, (p) => {
          const req = mapEvent(ev, p);
          if (!req) return;
          if (ev === 'checkout:done') placeAtCounter(req, p);
          play(req, ev === 'sfx');
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
        sfx: (name, pan) => { const r = mapEvent('sfx', { name, pan }); if (r) play(r, true); },
        setVolume: (v) => applySettings({ volume: v }),
      };
      // depuração/testes: sons realmente tocados (após limitador e substituições)
      debugWin().__audio = { log: () => log.map((e) => ({ ...e })), clear: () => { log.length = 0; }, voices: () => voices.size };
    },
    update() { /* tudo é agendado por timers/currentTime do WebAudio */ },
    dispose() {
      for (const o of offs) o();
      offs.length = 0;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      voices.clear();
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
      music?.stop();
      music = null;
      if (ac) { ac.removeEventListener('statechange', onStateChange); void ac.close().catch(() => undefined); }
      ac = null; rig = null;
      if (game) delete game.services.audio;
      delete debugWin().__audio;
    },
  };
}
