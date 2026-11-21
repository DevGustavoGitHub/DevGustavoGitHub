/**
 * Grade de navegação em tiles de 1 m: salão, sala de estoque (se liberada), calçada e faixa de rua para spawn.
 * A* em 8 direções com bloqueio de quinas, paredes (só a porta atravessa) e cache de caminhos.
 */
import { DOOR_WIDTH, FURNITURE_FOOTPRINT, SIDEWALK_DEPTH, STORAGE_DEPTH, type Bounds } from '../core/layout';
import type { Furniture } from '../sim/state';
import type { Vec2 } from '../core/services';

export const footprintOf = (f: { type: Furniture['type']; rot: number }): { w: number; d: number } => {
  const fp = FURNITURE_FOOTPRINT[f.type];
  return f.rot === 90 || f.rot === 270 ? { w: fp.d, d: fp.w } : { w: fp.w, d: fp.d };
};
/** Faixa de rua (tiles) além da calçada onde pedestres podem andar (spawn). */
export const STREET_STRIP = 2;
const MARGIN_X = 14;

export class NavGrid {
  minX = 0; minZ = 0; w = 0; h = 0;
  walk = new Uint8Array(0);
  private b: Bounds = { width: 12, depth: 10 };
  private storage = false;
  private cache = new Map<string, Vec2[] | null>();
  version = 0;

  build(b: Bounds, storage: boolean, furniture: readonly Furniture[], blocked: readonly { x: number; z: number }[]): void {
    this.b = b; this.storage = storage;
    this.minX = -MARGIN_X; this.minZ = -STORAGE_DEPTH;
    this.w = b.width + MARGIN_X * 2;
    this.h = STORAGE_DEPTH + b.depth + SIDEWALK_DEPTH + STREET_STRIP;
    this.walk = new Uint8Array(this.w * this.h);
    for (let z = this.minZ; z < this.minZ + this.h; z++) {
      for (let x = this.minX; x < this.minX + this.w; x++) {
        const hall = x >= 0 && x < b.width && z >= 0 && z < b.depth;
        const stor = storage && x >= 0 && x < b.width && z >= -STORAGE_DEPTH && z < 0;
        const out = z >= b.depth && z < b.depth + SIDEWALK_DEPTH + STREET_STRIP;
        if (hall || stor || out) this.walk[this.idx(x, z)] = 1;
      }
    }
    for (const f of furniture) {
      const fp = footprintOf(f);
      for (let dz = 0; dz < fp.d; dz++) for (let dx = 0; dx < fp.w; dx++) this.block(f.x + dx, f.z + dz);
    }
    for (const t of blocked) this.block(t.x, t.z);
    this.cache.clear();
    this.version++;
  }

  private idx(tx: number, tz: number): number { return (tz - this.minZ) * this.w + (tx - this.minX); }
  private inside(tx: number, tz: number): boolean { return tx >= this.minX && tx < this.minX + this.w && tz >= this.minZ && tz < this.minZ + this.h; }
  private block(tx: number, tz: number): void { if (this.inside(tx, tz)) this.walk[this.idx(tx, tz)] = 0; }
  tileWalkable(tx: number, tz: number): boolean { return this.inside(tx, tz) && this.walk[this.idx(tx, tz)] === 1; }
  isWalkable(x: number, z: number): boolean { return this.tileWalkable(Math.floor(x), Math.floor(z)); }

  private doorTile(tx: number): boolean {
    const x0 = this.b.width / 2 - DOOR_WIDTH / 2;
    return tx >= x0 && tx < x0 + DOOR_WIDTH;
  }
  /** Passo ortogonal permitido (tiles de destino andáveis e parede só atravessada na porta). */
  private step(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.tileWalkable(bx, bz)) return false;
    if (bx === ax) {
      const lo = Math.min(az, bz);
      if (lo === this.b.depth - 1 && !this.doorTile(ax)) return false; // parede da frente (z = depth)
      if (this.storage && lo === -1 && !this.doorTile(ax)) return false; // parede entre salão e estoque (z = 0)
    }
    return true;
  }

  nearestWalkable(tx: number, tz: number, r = 3): { x: number; z: number } | null {
    if (this.tileWalkable(tx, tz)) return { x: tx, z: tz };
    let best: { x: number; z: number } | null = null, bd = 1e9;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (!this.tileWalkable(tx + dx, tz + dz)) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = { x: tx + dx, z: tz + dz }; }
    }
    return best;
  }

  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const s = this.nearestWalkable(Math.floor(from.x), Math.floor(from.z));
    const g = this.nearestWalkable(Math.floor(to.x), Math.floor(to.z));
    if (!s || !g) return null;
    const key = `${s.x},${s.z}>${g.x},${g.z}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit ? hit.map((p) => ({ x: p.x, z: p.z })) : null;
    const res = this.astar(s.x, s.z, g.x, g.z);
    if (this.cache.size > 600) this.cache.clear();
    this.cache.set(key, res);
    return res ? res.map((p) => ({ x: p.x, z: p.z })) : null;
  }

  private astar(sx: number, sz: number, gx: number, gz: number): Vec2[] | null {
    if (sx === gx && sz === gz) return [{ x: gx + 0.5, z: gz + 0.5 }];
    const W = this.w, N = this.w * this.h;
    const gs = new Float32Array(N).fill(Infinity);
    const par = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap: number[] = [], hf: number[] = [];
    const push = (i: number, f: number): void => {
      heap.push(i); hf.push(f);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (hf[p]! <= hf[c]!) break;
        [heap[p], heap[c]] = [heap[c]!, heap[p]!]; [hf[p], hf[c]] = [hf[c]!, hf[p]!]; c = p;
      }
    };
    const pop = (): number => {
      const top = heap[0]!;
      const li = heap.pop()!, lf = hf.pop()!;
      if (heap.length) {
        heap[0] = li; hf[0] = lf;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && hf[l]! < hf[m]!) m = l;
          if (r < heap.length && hf[r]! < hf[m]!) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c]!, heap[m]!]; [hf[m], hf[c]] = [hf[c]!, hf[m]!]; c = m;
        }
      }
      return top;
    };
    const hh = (x: number, z: number): number => {
      const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const si = this.idx(sx, sz), gi = this.idx(gx, gz);
    gs[si] = 0; push(si, hh(sx, sz));
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === gi) break;
      const cx = (cur % W) + this.minX, cz = Math.floor(cur / W) + this.minZ;
      for (const [dx, dz] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.step(cx, cz, nx, nz) && !(dx !== 0 && dz !== 0)) continue;
        if (dx !== 0 && dz !== 0) {
          if (!this.step(cx, cz, nx, cz) || !this.step(nx, cz, nx, nz) || !this.step(cx, cz, cx, nz) || !this.step(cx, nz, nx, nz)) continue;
        }
        const ni = this.idx(nx, nz);
        if (closed[ni]) continue;
        const ng = gs[cur]! + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (ng < gs[ni]!) { gs[ni] = ng; par[ni] = cur; push(ni, ng + hh(nx, nz)); }
      }
    }
    if (par[gi] === -1) return null;
    const pts: Vec2[] = [];
    for (let i = gi; i !== si && i !== -1; i = par[i]!) pts.push({ x: (i % W) + this.minX + 0.5, z: Math.floor(i / W) + this.minZ + 0.5 });
    pts.reverse();
    // remove pontos colineares
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = out.length ? out[out.length - 1]! : { x: sx + 0.5, z: sz + 0.5 };
      const nxt = pts[i + 1];
      const p = pts[i]!;
      if (nxt && Math.abs((p.x - prev.x) * (nxt.z - p.z) - (p.z - prev.z) * (nxt.x - p.x)) < 1e-6) continue;
      out.push(p);
    }
    return out;
  }
}
