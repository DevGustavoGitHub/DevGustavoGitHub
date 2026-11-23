import * as THREE from 'three';
import { EventBus } from './core/events';
import { GameClock } from './core/clock';
import type { GameContext, GameModule } from './core/module';
import { load, save, type KV } from './sim/save';
import { newGame } from './sim/state';
import createWorld from './world';
import createPlayer from './player';
import createNpc from './npc';
import createUi from './ui';
import createAudio from './audio';
import { TIERS, initialTier } from './world/quality';

const kv: KV = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota/privado */ } },
};

const app = document.getElementById('app')!;
// Qualidade inicial (opção salva ou padrão por dispositivo); o world ajusta o resto em tempo real. Antialias só vale no carregamento.
const tier0 = TIERS[initialTier()];
// stencil: contorno de destaque do world (silhueta de móveis fundidos); custo desprezível.
const renderer = new THREE.WebGLRenderer({ antialias: tier0.antialias, powerPreference: 'high-performance', stencil: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier0.pixelRatio));
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec9e8);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(6, 9, 18);

const state = load(kv) ?? newGame(Math.floor(Math.random() * 1e9));
const bus = new EventBus();
const clock = new GameClock(bus);
const ctx: GameContext = {
  state, bus, scene, camera, renderer, clock,
  rand: Math.random,
  uiRoot: document.getElementById('ui-root')!,
  save: () => save(kv, state),
  services: {},
};

// Ordem importa: world cria cenário, player usa o cenário, npc usa grade do world, ui por último.
const modules: GameModule[] = [createWorld(), createPlayer(), createNpc(), createAudio(), createUi()];
for (const m of modules) m.init(ctx);

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

setInterval(() => ctx.save(), 15000); // autosave periódico
bus.on('dayEnded', () => ctx.save());
window.addEventListener('pagehide', () => ctx.save());

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  clock.update(dt);
  for (const m of modules) m.update(dt);
  renderer.render(scene, camera);
});

// Gancho para testes automatizados (Playwright): inspeção e controle do jogo.
(window as any).__game = ctx;

// PWA: service worker só em produção (em dev atrapalha o hot reload).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* sem HTTPS/privado: segue sem offline */ });
  });
}
