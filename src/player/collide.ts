/**
 * Colisão do jogador (círculo/cápsula vista de cima) contra a grade do world (`isWalkable`, 1 tile = 1 m) e as
 * paredes finas que a grade não representa: fachada (z = depth, com a porta) e parede do depósito (z = 0, com a
 * passagem). Também: linha de visada (a mira não atravessa paredes) e altura de obstáculos para o arremesso.
 */
import { DOOR_WIDTH, FURNITURE_FOOTPRINT, SIDEWALK_DEPTH, STORAGE_DEPTH, WALL_HEIGHT, doorX, storeBounds } from '../core/layout';
import type { WorldService } from '../core/services';
import type { Furniture, StoreState } from '../sim/state';

export interface Rect { x0: number; z0: number; x1: number; z1: number; h: number }
export interface P2 { x: number; z: number }

const WALL_T = 0.2;
/** Altura aproximada de cada móvel (para o arremesso passar por cima de móveis baixos). */
const FURN_H: Record<string, number> = { shelf: 1.9, fridge: 2.0, freezer: 0.95, counter: 1.05, rack: 2.1, decor: 1.2 };

export const furnRect = (f: Furniture): { x0: number; z0: number; x1: number; z1: number } => {
  const fp = FURNITURE_FOOTPRINT[f.type];
  const sw = f.rot === 90 || f.rot === 270;
  return { x0: f.x, z0: f.z, x1: f.x + (sw ? fp.d : fp.w), z1: f.z + (sw ? fp.w : fp.d) };
};

export class Collider {
  private wallExp = NaN;
  private wallSto: boolean | null = null;
  private wallList: Rect[] = [];

  constructor(private readonly state: () => StoreState, private readonly world: () => WorldService | undefined) {}

  /** Tile livre (centro do tile). Sem world: regra simples do salão/calçada/depósito e móveis. */
  tileFree(tx: number, tz: number): boolean {
    const w = this.world();
    if (w) return w.isWalkable(tx + 0.5, tz + 0.5);
    const s = this.state();
    const b = storeBounds(s.expansion);
    const zMin = s.storageUnlocked ? -STORAGE_DEPTH : 0;
    const hall = tx >= 0 && tx < b.width && tz >= zMin && tz < b.depth;
    const out = tz >= b.depth && tz < b.depth + SIDEWALK_DEPTH + 2 && tx >= -14 && tx < b.width + 14;
    if (!hall && !out) return false;
    for (const f of s.furniture) {
      const r = furnRect(f);
      if (tx >= r.x0 && tx < r.x1 && tz >= r.z0 && tz < r.z1) return false;
    }
    return true;
  }

  /** Paredes finas (retângulos em planta, altura h). Cache por expansão/depósito. */
  walls(): Rect[] {
    const s = this.state();
    if (s.expansion === this.wallExp && s.storageUnlocked === this.wallSto) return this.wallList; // sem alocar por quadro
    this.wallExp = s.expansion; this.wallSto = s.storageUnlocked;
    const b = storeBounds(s.expansion);
    const gx0 = doorX(b) - DOOR_WIDTH / 2, gx1 = doorX(b) + DOOR_WIDTH / 2;
    const list: Rect[] = [
      { x0: -WALL_T, z0: b.depth, x1: gx0, z1: b.depth + WALL_T, h: WALL_HEIGHT },
      { x0: gx1, z0: b.depth, x1: b.width + WALL_T, z1: b.depth + WALL_T, h: WALL_HEIGHT },
    ];
    if (s.storageUnlocked) {
      list.push({ x0: -WALL_T, z0: -WALL_T, x1: gx0, z1: 0, h: WALL_HEIGHT }, { x0: gx1, z0: -WALL_T, x1: b.width + WALL_T, z1: 0, h: WALL_HEIGHT });
    }
    this.wallList = list;
    return list;
  }

  /** Ponto livre para o centro de um círculo de raio r? */
  circleFree(x: number, z: number, r: number): boolean {
    for (let tz = Math.floor(z - r); tz <= Math.floor(z + r); tz++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (this.tileFree(tx, tz)) continue;
        if (overlap(x, z, r, tx, tz, tx + 1, tz + 1)) return false;
      }
    }
    for (const w of this.walls()) if (overlap(x, z, r, w.x0, w.z0, w.x1, w.z1)) return false;
    return true;
  }

  /** Empurra o círculo para fora de tiles bloqueados e paredes (desliza ao longo delas). Muta `p`. */
  resolve(p: P2, r: number): void {
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (let tz = Math.floor(p.z - r); tz <= Math.floor(p.z + r); tz++) {
        for (let tx = Math.floor(p.x - r); tx <= Math.floor(p.x + r); tx++) {
          if (!this.tileFree(tx, tz) && pushOut(p, r, tx, tz, tx + 1, tz + 1)) moved = true;
        }
      }
      for (const w of this.walls()) if (pushOut(p, r, w.x0, w.z0, w.x1, w.z1)) moved = true;
      if (!moved) break;
    }
  }

  /** Move com sub-passos (no máx. 0,12 m) para nunca atravessar paredes finas. */
  move(p: P2, dx: number, dz: number, r: number): void {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
    for (let i = 0; i < n; i++) {
      p.x += dx / n; p.z += dz / n;
      this.resolve(p, r);
    }
  }

  /** Ponto livre mais próximo (espiral), ou o próprio ponto se nada servir. */
  findFree(x: number, z: number, r: number, ok?: (x: number, z: number) => boolean): P2 {
    const good = (a: number, b: number): boolean => this.circleFree(a, b, r) && (!ok || ok(a, b));
    if (good(x, z)) return { x, z };
    for (let rad = 0.25; rad <= 5; rad += 0.25) {
      const n = Math.max(8, Math.round(rad * 10));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const nx = x + Math.cos(a) * rad, nz = z + Math.sin(a) * rad;
        if (good(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }

  /** A linha (em planta) de a até b cruza uma parede fina? Ignora o trecho final perto do alvo (alvo na parede). */
  blocked(ax: number, az: number, bx: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) return false;
    const k = Math.max(0, (len - 0.3) / len); // o alvo pode estar encostado/pendurado na parede
    const ex = ax + (bx - ax) * k, ez = az + (bz - az) * k;
    for (const w of this.walls()) if (segRect(ax, az, ex, ez, w)) return true;
    return false;
  }

  /** Altura do obstáculo em (x,z) para o arremesso: 0 livre, altura do móvel, ou parede/limite (alto). */
  obstacleHeight(x: number, z: number): number {
    for (const w of this.walls()) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) return w.h;
    const tx = Math.floor(x), tz = Math.floor(z);
    if (this.tileFree(tx, tz)) return 0;
    for (const f of this.state().furniture) {
      const r = furnRect(f);
      if (tx >= r.x0 && tx < r.x1 && tz >= r.z0 && tz < r.z1) return FURN_H[f.type] ?? 1.5;
    }
    const b = storeBounds(this.state().expansion);
    if (z >= b.depth) return 0; // props finos da calçada (poste, árvore): o tile inteiro bloquearia demais o arremesso
    return 99;
  }

  /** Dentro do prédio (para o teto)? */
  indoors(x: number, z: number): boolean {
    const s = this.state();
    const b = storeBounds(s.expansion);
    return x > 0 && x < b.width && z < b.depth && z > (s.storageUnlocked ? -STORAGE_DEPTH : 0);
  }
}

function overlap(x: number, z: number, r: number, x0: number, z0: number, x1: number, z1: number): boolean {
  const cx = Math.min(Math.max(x, x0), x1), cz = Math.min(Math.max(z, z0), z1);
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r - 1e-9;
}

function pushOut(p: P2, r: number, x0: number, z0: number, x1: number, z1: number): boolean {
  const cx = Math.min(Math.max(p.x, x0), x1), cz = Math.min(Math.max(p.z, z0), z1);
  const dx = p.x - cx, dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    p.x += dx * k; p.z += dz * k;
    return true;
  }
  // centro dentro do retângulo: sai pela borda mais próxima
  const l = p.x - x0, rr = x1 - p.x, t = p.z - z0, bb = z1 - p.z;
  const m = Math.min(l, rr, t, bb);
  if (m === l) p.x = x0 - r; else if (m === rr) p.x = x1 + r; else if (m === t) p.z = z0 - r; else p.z = z1 + r;
  return true;
}

/** Segmento × retângulo (método das lajes). */
function segRect(ax: number, az: number, bx: number, bz: number, w: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, ax - w.x0) && clip(dx, w.x1 - ax) && clip(-dz, az - w.z0) && clip(dz, w.z1 - az) && t0 <= t1;
}
