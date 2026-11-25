import * as THREE from 'three';
import { EventBus } from './core/events';
import { GameClock } from './core/clock';
import type { GameContext, GameModule } from './core/module';
import { SAVE_KEY, load, save, type KV } from './sim/save';
import { CLOSE_MIN, OPEN_MIN, newGame } from './sim/state';
import createWorld from './world';
import createPlayer from './player';
import createNpc from './npc';
import createUi from './ui';
import createAudio from './audio';
import { initialQuality, startPixelRatio, wantsAntialias } from './world/quality';
import { DEFAULT_FPS_CAP, FramePacer, isFpsCap } from './core/pacer';
import { warmUp } from './core/warm';

const kv: KV = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota/privado */ } },
};

const app = document.getElementById('app')!;
// Qualidade inicial (opção salva ou "auto"); o world ajusta o resto em tempo real. Antialias (MSAA) só vale no
// carregamento e só é ligado com pixel ratio efetivo ≤ 1,5 (world/quality.ts: wantsAntialias).
const q0 = initialQuality();
// stencil: contorno de destaque do world (silhueta de móveis fundidos); custo desprezível.
const renderer = new THREE.WebGLRenderer({ antialias: wantsAntialias(q0), powerPreference: 'high-performance', stencil: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, startPixelRatio(q0)));
renderer.shadowMap.enabled = true;
// mapa de sombra estático: o world pede `needsUpdate` só quando o sol anda ou o cenário que projeta sombra muda
renderer.shadowMap.autoUpdate = false;
app.appendChild(renderer.domElement);

/** Limite de FPS do jogador ('mercadinho:settings'.maxFps: 30, 60 ou 0 = sem limite; padrão 60). */
function storedFpsCap(): 30 | 60 | 0 {
  try { const v = (JSON.parse(localStorage.getItem('mercadinho:settings') ?? '{}') as { maxFps?: unknown }).maxFps; return isFpsCap(v) ? v : DEFAULT_FPS_CAP; } catch { return DEFAULT_FPS_CAP; }
}
const pacer = new FramePacer(storedFpsCap());

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec9e8);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(6, 9, 18);

const rawSave = kv.getItem(SAVE_KEY);
const state = load(kv) ?? newGame(Math.floor(Math.random() * 1e9));
const bus = new EventBus();
const clock = new GameClock(bus);
// Restaura a hora do dia salva (antes do init dos módulos, que leem clock.phase/minute). 'report' significa que o dia
// já foi fechado (closeDay aplicado): volta para a manhã do dia seguinte, nunca reabre o mesmo dia.
if (state.clock) {
  const { minute, phase } = state.clock;
  if (phase === 'report') { clock.minute = OPEN_MIN; clock.phase = 'prep'; }
  else {
    clock.minute = Math.min(CLOSE_MIN, Math.max(OPEN_MIN, Number.isFinite(minute) ? minute : OPEN_MIN));
    clock.phase = phase;
  }
}
const ctx: GameContext = {
  state, bus, scene, camera, renderer, clock,
  rand: Math.random,
  uiRoot: document.getElementById('ui-root')!,
  save: () => { state.clock = { minute: clock.minute, phase: clock.phase }; save(kv, state); },
  services: {},
  frame: { workMs: 0, targetMs: pacer.interval || 1000 / 60, maxFps: pacer.maxFps, hold: 0 },
};
const frame = ctx.frame!;

// Ordem importa: world cria cenário, player usa o cenário, npc usa grade do world, ui por último.
const modules: GameModule[] = [createWorld(), createPlayer(), createNpc(), createAudio(), createUi()];
const BOOT_RETRY = 'mercadinho:boot-retry';
try {
  for (const m of modules) m.init(ctx);
  try { sessionStorage.removeItem(BOOT_RETRY); } catch { /* sem sessionStorage */ }
} catch (err) {
  // Save incompatível (ex.: APK mais antigo instalado sobre um save mais novo) não pode travar o jogo para sempre:
  // guarda uma cópia do save, recomeça do zero uma única vez e avisa a UI (chave 'mercadinho:save-recovered').
  console.error('[boot] falha ao iniciar com o save atual', err);
  let retried = false;
  try { retried = sessionStorage.getItem(BOOT_RETRY) === '1'; } catch { /* idem */ }
  if (rawSave && !retried) {
    kv.setItem(`${SAVE_KEY}:backup-${Date.now()}`, rawSave);
    kv.setItem('mercadinho:save-recovered', String(Date.now()));
    try { localStorage.removeItem(SAVE_KEY); sessionStorage.setItem(BOOT_RETRY, '1'); } catch { /* idem */ }
    location.reload();
  }
  throw err;
}

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Pré-compila os shaders da cena e dos objetos que só aparecem depois (clientes, caixa na mão...) sem travar: o render
// espera (a tela inicial já está por cima) e os updates seguem.
void warmUp(ctx, { scene: true, hold: true });

bus.on('settings:changed', (p?: { maxFps?: unknown }) => {
  if (!isFpsCap(p?.maxFps)) return;
  pacer.maxFps = p.maxFps;
  frame.maxFps = pacer.maxFps; frame.targetMs = pacer.interval || 1000 / 60;
});

setInterval(() => ctx.save(), 15000); // autosave periódico
bus.on('dayEnded', () => ctx.save());
window.addEventListener('pagehide', () => ctx.save());
// No Android (WebView) minimizar o app não dispara pagehide: salva também ao ficar oculto.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ctx.save(); });

// Laço: o pacer pula callbacks do rAF além do limite de FPS (telas de 90/120 Hz) e entrega o dt real desde o último
// quadro desenhado (limitado a 0,1 s), então física e animações não mudam com o limite.
renderer.setAnimationLoop((now) => {
  const dt = pacer.tick(now);
  if (dt === null) return;
  const t0 = performance.now();
  clock.update(dt);
  for (const m of modules) m.update(dt);
  if (frame.hold <= 0) renderer.render(scene, camera);
  frame.workMs = performance.now() - t0;
});

// Gancho para testes automatizados (Playwright): inspeção e controle do jogo.
(window as any).__game = ctx;
(window as any).__pacer = pacer;

import './native'; // app Android (Capacitor): pause/voltar/sair

// PWA: service worker só em produção (em dev atrapalha o hot reload).
if ('serviceWorker' in navigator && import.meta.env.PROD && !(window as any).Capacitor) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* sem HTTPS/privado: segue sem offline */ });
  });
}
