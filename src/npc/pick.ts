/**
 * PickService de reserva: só é usado se o player ainda não publicou `ctx.services.pick`. Toque/clique curto no
 * canvas → raycast da câmera contra os objetos registrados → onTap. Assim o caixa nunca trava sem o player novo.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/module';
import type { PickService } from '../core/services';

export interface FallbackPick extends PickService { size(): number; dispose(): void }

export function createFallbackPick(ctx: GameContext): FallbackPick {
  const items = new Map<THREE.Object3D, () => void>();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits: THREE.Intersection[] = [];
  let dx = 0, dy = 0, dt = 0;
  const el = ctx.renderer.domElement;
  const down = (e: PointerEvent): void => { dx = e.clientX; dy = e.clientY; dt = performance.now(); };
  const up = (e: PointerEvent): void => {
    if (items.size === 0 || Math.hypot(e.clientX - dx, e.clientY - dy) > 14 || performance.now() - dt > 700) return;
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
    let best: (() => void) | null = null, bd = Infinity;
    for (const [o, fn] of items) {
      hits.length = 0;
      ray.intersectObject(o, true, hits);
      const h = hits[0];
      if (h && h.distance < bd) { bd = h.distance; best = fn; }
    }
    best?.();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  return {
    add: (o, fn) => { items.set(o, fn); },
    remove: (o) => { items.delete(o); },
    size: () => items.size,
    dispose: () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); items.clear(); },
  };
}
