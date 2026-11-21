/** Mundo mínimo usado apenas se o módulo `world` não publicou serviço (testes isolados). Linhas retas, sem A*. */
import * as THREE from 'three';
import type { GameContext } from '../core/module';
import type { Vec2, WorldService } from '../core/services';
import { FURNITURE_FOOTPRINT, doorPos, storeBounds } from '../core/layout';

export function createFallbackWorld(ctx: GameContext): WorldService {
  const b = () => storeBounds(ctx.state.expansion);
  const foot = (type: keyof typeof FURNITURE_FOOTPRINT, rot: number) => {
    const f = FURNITURE_FOOTPRINT[type];
    return rot === 90 || rot === 270 ? { w: f.d, d: f.w } : f;
  };
  const front = (id: number, off: number): Vec2 | null => {
    const f = ctx.state.furniture.find((x) => x.id === id);
    if (!f) return null;
    const fp = foot(f.type, f.rot);
    const cx = f.x + fp.w / 2, cz = f.z + fp.d / 2;
    if (f.rot === 0) return { x: cx, z: f.z + fp.d + off };
    if (f.rot === 180) return { x: cx, z: f.z - off };
    if (f.rot === 90) return { x: f.x - off, z: cz };
    return { x: f.x + fp.w + off, z: cz };
  };
  return {
    findPath: (_a, to) => [{ x: to.x, z: to.z }],
    isWalkable: () => true,
    furnitureAccess: (id) => front(id, 0.5),
    counters: () => ctx.state.furniture.filter((f) => f.type === 'counter').map((f) => {
      const fp = foot(f.type, f.rot);
      const cx = f.x + fp.w / 2;
      return {
        furnitureId: f.id,
        operator: { x: cx, z: f.z - 0.5 },
        queue: [0, 1, 2, 3, 4, 5].map((i) => ({ x: cx, z: f.z + fp.d + 0.6 + i * 0.8 })),
        scanner: { x: cx, z: f.z + fp.d / 2 },
      };
    }),
    spawnPoint: () => ({ x: b().width * 0.2, z: b().depth + 6 }),
    trashBin: () => ({ x: b().width - 1.5, z: b().depth + 1.5 }),
    door: () => doorPos(b()),
    group: new THREE.Group(),
  };
}
