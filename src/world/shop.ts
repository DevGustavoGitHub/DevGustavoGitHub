/**
 * Casca da loja em 1ª pessoa (Fase 3): piso de tábuas, paredes OPACAS (uma malha, um grupo por material),
 * teto com luminárias, rodapé, fachada de tijolos com vitrines, toldos listrados, letreiro com o nome, pôsteres,
 * porta de vidro deslizante com placa ABERTO/FECHADO e porta do depósito (com fita enquanto trancado).
 * Ambiente externo: env.ts. Decalques: atlas único (tex.ts).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Decor } from '../sim/state';
import { DOOR_WIDTH, STORAGE_DEPTH, WALL_HEIGHT, type Bounds } from '../core/layout';
import { Tracker, scaleUV, hex, planeGeo } from './kit';
import { Batch, meshesOf, type Spec } from './batch';
import { uvToCell, type Cell } from './atlas';
import { DECAL, brickTex, decalMaterial, drawSign, tileTex, woodTex } from './tex';

/** Compatibilidade: o ambiente externo mudou para env.ts. */
export { Env, ROAD_WIDTH } from './env';

/** Medidas da fachada (metros). */
export const FACADE = { t: 0.2, sill: 0.55, winTop: 2.45, doorTop: 2.45, band0: WALL_HEIGHT, band1: 4.2, pierDoor: 0.7, pierCorner: 0.55, pierMid: 0.9 };

const M_IN = 0, M_OUT = 1, M_TRIM = 2, M_BRICK = 3, M_STORE = 4, M_BAND = 5;
/** Paredes por face com UV planar em metros: [+x, -x, +y, -y, +z, -z] → material. */
class WallBuilder {
  private lists: THREE.BufferGeometry[][] = [[], [], [], [], [], []];
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, f: readonly number[]): void {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    for (let face = 0; face < 6; face++) {
      const P = new Float32Array(18), N = new Float32Array(18), U = new Float32Array(12);
      for (let v = 0; v < 6; v++) {
        const i = face * 6 + v;
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
        N[v * 3] = nor.getX(i); N[v * 3 + 1] = nor.getY(i); N[v * 3 + 2] = nor.getZ(i);
        U[v * 2] = face < 2 ? z : x; U[v * 2 + 1] = face === 2 || face === 3 ? z : y;
      }
      const q = new THREE.BufferGeometry();
      q.setAttribute('position', new THREE.BufferAttribute(P, 3));
      q.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      q.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      this.lists[f[face]!]!.push(q);
    }
    g.dispose();
  }
  build(): THREE.BufferGeometry {
    const all = this.lists.flat();
    const merged = mergeGeometries(all, false)!;
    merged.clearGroups();
    let start = 0;
    this.lists.forEach((l, mi) => {
      const count = l.length * 6;
      if (count) merged.addGroup(start, count, mi);
      start += count;
    });
    all.forEach((q) => q.dispose());
    return merged;
  }
}

/** Plano de decalque (célula do atlas) virado para +z antes da rotação. */
function decal(b: Batch, cell: Cell, w: number, h: number, x: number, y: number, z: number, ry = 0, rz = 0): void {
  const g = uvToCell(planeGeo(w, h).clone(), cell);
  b.add(g, ['decal', 0xffffff], x, y, z, { ry, rz });
  g.dispose();
}
/** Caixa centrada (BoxGeometry) adicionada ao lote e descartada. */
function cbox(b: Batch, w: number, h: number, d: number, spec: Spec, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number } = {}): void {
  const g = new THREE.BoxGeometry(w, h, d);
  b.add(g, spec, x, y, z, o);
  g.dispose();
}

export interface PickBox { x: number; y: number; z: number; w: number; h: number; d: number }

export class Shop {
  readonly group = new THREE.Group();
  private tr = new Tracker();
  private floorMat: THREE.MeshStandardMaterial | null = null;
  private innerMat: THREE.MeshStandardMaterial | null = null;
  private decalGeo: THREE.BufferGeometry | null = null;
  private doorL: THREE.Object3D | null = null;
  private doorR: THREE.Object3D | null = null;
  private doorBaseL = 0; private doorBaseR = 0;
  private doorOpen = 0;
  private signOpen: boolean | null = null;
  private signColor = '';
  private b: Bounds = { width: 12, depth: 10 };
  /** Placa ABERTO/FECHADO (pick 'sign') e porta do depósito trancada (pick 'storageDoor'; null se liberado). */
  signBox: PickBox = { x: 0, y: 0, z: 0, w: 0, h: 0, d: 0 };
  storageDoorBox: PickBox | null = null;

  rebuild(b: Bounds, storage: boolean, decor: Decor, name: string): void {
    this.clear();
    this.b = b;
    this.signColor = decor.signColor;
    const { width: W, depth: D } = b;
    const H = WALL_HEIGHT, t = FACADE.t;
    const tr = this.tr, g = this.group;
    const sb = new Batch();
    /* ---- placa ABERTO/FECHADO: PRIMEIROS decalques (vértices 0..11, trocados em setOpenSign) ---- */
    const gx0 = W / 2 - DOOR_WIDTH / 2, gx1 = W / 2 + DOOR_WIDTH / 2;
    const sx = gx1 + FACADE.pierDoor / 2, sy = 1.5;
    decal(sb, DECAL.closed(), 0.52, 0.26, sx, sy, D + t + 0.006);
    decal(sb, DECAL.closed(), 0.52, 0.26, sx, sy, D - 0.006, Math.PI);
    this.signBox = { x: sx, y: sy, z: D + t / 2, w: 0.6, h: 0.34, d: t + 0.06 };
    /* ---- pisos ---- */
    const floorG = tr.geo(new THREE.PlaneGeometry(W, D)); floorG.rotateX(-Math.PI / 2); scaleUV(floorG, W / 1.2, D / 1.2);
    this.floorMat = tr.mat(new THREE.MeshStandardMaterial({ color: hex(decor.floorColor), map: woodTex(), roughness: 0.72 }));
    const floor = new THREE.Mesh(floorG, this.floorMat); floor.position.set(W / 2, 0.01, D / 2); floor.receiveShadow = true; g.add(floor);
    const zBack = storage ? -STORAGE_DEPTH : 0;
    if (storage) {
      const sg = tr.geo(new THREE.PlaneGeometry(W, STORAGE_DEPTH + t)); sg.rotateX(-Math.PI / 2); scaleUV(sg, W / 2, (STORAGE_DEPTH + t) / 2);
      const sm = tr.mat(new THREE.MeshStandardMaterial({ color: 0xaab1b9, map: tileTex(), roughness: 0.85 }));
      const sf = new THREE.Mesh(sg, sm); sf.position.set(W / 2, 0.01, -(STORAGE_DEPTH + t) / 2); sf.receiveShadow = true; g.add(sf);
      sb.box(W - 0.4, 0.004, 0.12, ['matte', 0xf2c230], W / 2, 0.016, -0.42);
    }
    /* ---- teto com luminárias ---- */
    const ceilMat = tr.mat(new THREE.MeshStandardMaterial({ color: 0xf5f6f8, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.24 }));
    const ceilG = tr.geo(new THREE.PlaneGeometry(W + 0.02, D - zBack + 0.02)); ceilG.rotateX(Math.PI / 2);
    const ceil = new THREE.Mesh(ceilG, ceilMat); ceil.position.set(W / 2, H, (D + zBack) / 2); g.add(ceil);
    for (let x = 1.5; x < W - 0.5; x += 3) for (let z = zBack + 1.25; z < D - 0.4; z += 2.5) {
      if (Math.abs(z) < 0.5) continue;
      sb.box(1.2, 0.03, 0.42, ['matte', 0xd9dde2], x, H - 0.035, z);
      sb.box(1.1, 0.012, 0.34, ['glow', 0xfffdf0], x, H - 0.047, z);
    }
    /* ---- paredes (uma malha) ---- */
    const wb = new WallBuilder();
    const T = M_TRIM;
    wb.box(-t, 0, 0, H, 0, D, [M_IN, M_OUT, T, T, T, T]);
    wb.box(W, W + t, 0, H, 0, D, [M_OUT, M_IN, T, T, T, T]);
    if (!storage) {
      wb.box(-t, W + t, 0, H, -t, 0, [T, T, T, T, M_IN, M_OUT]);
    } else {
      wb.box(-t, 0, 0, H, zBack, 0, [M_STORE, M_OUT, T, T, T, T]);
      wb.box(W, W + t, 0, H, zBack, 0, [M_OUT, M_STORE, T, T, T, T]);
      wb.box(-t, W + t, 0, H, zBack - t, zBack, [T, T, T, T, M_STORE, M_OUT]);
      const px0 = W / 2 - DOOR_WIDTH / 2, px1 = W / 2 + DOOR_WIDTH / 2;
      wb.box(0, px0, 0, H, -t, 0, [T, T, T, T, M_IN, M_STORE]);
      wb.box(px1, W, 0, H, -t, 0, [T, T, T, T, M_IN, M_STORE]);
      wb.box(px0, px1, 2.5, H, -t, 0, [T, T, T, T, M_IN, M_STORE]);
    }
    this.buildFront(wb, sb, W, D, decor, name);
    const mats = [
      this.innerMat = tr.mat(new THREE.MeshStandardMaterial({ color: hex(decor.wallColor), roughness: 0.92, emissive: hex(decor.wallColor), emissiveIntensity: 0.12 })),
      tr.mat(new THREE.MeshStandardMaterial({ color: 0xe3d5bf, roughness: 0.92 })),
      tr.mat(new THREE.MeshStandardMaterial({ color: 0x3b4250, roughness: 0.7 })),
      tr.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, map: brickTex(), roughness: 0.95 })),
      tr.mat(new THREE.MeshStandardMaterial({ color: 0xd6dbe1, roughness: 0.92, emissive: 0xd6dbe1, emissiveIntensity: 0.08 })),
      tr.mat(new THREE.MeshStandardMaterial({ color: 0x74c255, roughness: 0.85 })),
    ];
    const walls = new THREE.Mesh(tr.geo(wb.build()), mats);
    walls.receiveShadow = true; g.add(walls);
    /* ---- rodapé (madeira escura) ---- */
    const skirt: Spec = ['matte', 0x8b5a3c];
    sb.box(0.03, 0.12, D, skirt, 0.015, 0.01, D / 2);
    sb.box(0.03, 0.12, D, skirt, W - 0.015, 0.01, D / 2);
    if (storage) {
      const p0 = W / 2 - DOOR_WIDTH / 2;
      sb.box(p0, 0.12, 0.03, skirt, p0 / 2, 0.01, 0.015);
      sb.box(p0, 0.12, 0.03, skirt, W - p0 / 2, 0.01, 0.015);
    } else sb.box(W, 0.12, 0.03, skirt, W / 2, 0.01, 0.015);
    sb.box(gx0, 0.12, 0.03, skirt, gx0 / 2, 0.01, D - 0.015);
    sb.box(W - gx1, 0.12, 0.03, skirt, (W + gx1) / 2, 0.01, D - 0.015);
    /* ---- tapetes e soleira ---- */
    sb.box(1.8, 0.02, 0.9, ['matte', 0x8a2f2f], W / 2, 0.01, D - 0.6);
    sb.box(DOOR_WIDTH, 0.02, t, ['metal', 0x9aa3ad], W / 2, 0.005, D + t / 2);
    sb.box(1.8, 0.02, 0.9, ['matte', 0x3b3f47], W / 2, 0.02, D + t + 0.7);
    /* ---- porta do depósito (fita enquanto trancado) ---- */
    this.buildStorageDoor(sb, W, storage);
    for (const m of meshesOf(sb.build(), g, { cast: false })) {
      tr.geo(m.geometry);
      if (m.material === decalMaterial()) { this.decalGeo = m.geometry; m.renderOrder = 2; }
    }
    this.signOpen = null;
  }

  private buildFront(wb: WallBuilder, sb: Batch, W: number, D: number, decor: Decor, name: string): void {
    const F = FACADE, t = F.t, z0 = D, z1 = D + t;
    const gx0 = W / 2 - DOOR_WIDTH / 2, gx1 = W / 2 + DOOR_WIDTH / 2;
    const FRONT = [M_TRIM, M_TRIM, M_TRIM, M_TRIM, M_BRICK, M_IN] as const;
    // vãos: porta + vitrines distribuídas de cada lado (pilares com pôsteres entre elas)
    const open: { x0: number; x1: number; y0: number; y1: number; door?: boolean }[] = [{ x0: gx0, x1: gx1, y0: 0, y1: F.doorTop, door: true }];
    for (const [a, b] of [[-t + F.pierCorner, gx0 - F.pierDoor], [gx1 + F.pierDoor, W + t - F.pierCorner]] as const) {
      const L = b - a;
      if (L < 0.8) continue;
      const n = Math.max(1, Math.round(L / 3.2));
      const ww = (L - (n - 1) * F.pierMid) / n;
      for (let i = 0; i < n; i++) open.push({ x0: a + i * (ww + F.pierMid), x1: a + i * (ww + F.pierMid) + ww, y0: F.sill, y1: F.winTop });
    }
    open.sort((p, q) => p.x0 - q.x0);
    let x = -t;
    const piers: { x0: number; x1: number }[] = [];
    for (const o of open) {
      wb.box(x, o.x0, 0, F.band0, z0, z1, FRONT);
      piers.push({ x0: x, x1: o.x0 });
      if (o.y0 > 0) wb.box(o.x0, o.x1, 0, o.y0, z0, z1, FRONT);
      wb.box(o.x0, o.x1, o.y1, F.band0, z0, z1, FRONT);
      x = o.x1;
    }
    wb.box(x, W + t, 0, F.band0, z0, z1, FRONT);
    piers.push({ x0: x, x1: W + t });
    wb.box(-t, W + t, F.band0, F.band1, z0, z1, [M_TRIM, M_TRIM, M_TRIM, M_TRIM, M_BAND, M_IN]);
    sb.box(W + 2 * t + 0.12, 0.14, t + 0.22, ['matte', 0x4a5260], W / 2, F.band1, D + t / 2 + 0.05);
    sb.box(W + 2 * t + 0.04, 0.07, 0.08, ['matte', 0xe8e4dc], W / 2, F.band0 - 0.04, z1 + 0.04);
    // vitrines: vidro, caixilhos escuros, peitoril
    const frame: Spec = ['matte', 0x353b47], glass: Spec = ['glass', 0xbfe3f5];
    const zc = D + t / 2;
    for (const o of open) {
      if (o.door) continue;
      const w = o.x1 - o.x0, h = o.y1 - o.y0, cx = (o.x0 + o.x1) / 2;
      sb.box(w, h, 0.02, glass, cx, o.y0, zc);
      sb.box(0.07, h, 0.12, frame, o.x0 + 0.035, o.y0, zc);
      sb.box(0.07, h, 0.12, frame, o.x1 - 0.035, o.y0, zc);
      sb.box(w, 0.07, 0.12, frame, cx, o.y1 - 0.07, zc);
      sb.box(w, 0.07, 0.12, frame, cx, o.y0, zc);
      sb.box(w, 0.05, 0.12, frame, cx, 1.98, zc);
      const n = Math.max(1, Math.round(w / 1.3));
      for (let k = 1; k < n; k++) sb.box(0.06, h, 0.11, frame, o.x0 + (k * w) / n, o.y0, zc);
      sb.box(w + 0.12, 0.05, 0.16, ['matte', 0xe8e4dc], cx, o.y0 - 0.05, z1 + 0.02);
      this.awning(sb, o.x0 - 0.12, o.x1 + 0.12, z1, decor.signColor);
    }
    // porta: batentes e travessa
    const met: Spec = ['metal', 0x707a88];
    sb.box(0.08, F.doorTop, t + 0.04, met, gx0 + 0.04, 0, zc);
    sb.box(0.08, F.doorTop, t + 0.04, met, gx1 - 0.04, 0, zc);
    sb.box(DOOR_WIDTH, 0.1, 0.12, met, W / 2, F.doorTop - 0.08, z1 + 0.03);
    this.awning(sb, gx0 - 0.3, gx1 + 0.3, z1, decor.signColor);
    // folhas deslizantes (vidro + perfil)
    const mkDoor = (cx: number, handle: number): THREE.Group => {
      const dg = new THREE.Group();
      const db = new Batch();
      const fr: Spec = ['matte', 0x3b4250];
      db.box(0.96, 2.32, 0.03, glass, 0, 0.04, 0);
      db.box(0.96, 0.07, 0.06, fr, 0, 0.02, 0); db.box(0.96, 0.07, 0.06, fr, 0, 2.3, 0);
      db.box(0.06, 2.35, 0.06, fr, -0.45, 0.02, 0); db.box(0.06, 2.35, 0.06, fr, 0.45, 0.02, 0);
      db.box(0.035, 0.5, 0.05, ['metal', 0xc0c7d0], handle, 0.85, 0.045);
      db.box(0.035, 0.5, 0.05, ['metal', 0xc0c7d0], handle, 0.85, -0.045);
      for (const m of meshesOf(db.build(), dg, { cast: false })) this.tr.geo(m.geometry);
      dg.position.set(cx, 0, z1 + 0.035);
      this.group.add(dg);
      return dg;
    };
    this.doorBaseL = W / 2 - 0.49; this.doorBaseR = W / 2 + 0.49;
    this.doorL = mkDoor(this.doorBaseL, 0.4); this.doorR = mkDoor(this.doorBaseR, -0.4);
    // letreiro sobre a faixa verde
    const sw = Math.min(W - 2.2, 7.4), sh = 0.86, syc = (F.band0 + F.band1) / 2;
    sb.box(sw + 0.16, sh + 0.16, 0.06, ['matte', 0xffffff], W / 2, syc - (sh + 0.16) / 2, z1 + 0.03);
    decal(sb, drawSign(name, decor.signColor, sw / sh), sw, sh, W / 2, syc, z1 + 0.062);
    // pôsteres nos pilares (o pilar à direita da porta leva a placa ABERTO/FECHADO)
    const posters = DECAL.posters();
    let k = 0;
    for (const p of piers) {
      const w = p.x1 - p.x0, cx = (p.x0 + p.x1) / 2;
      if (w < 0.66 || Math.abs(cx - (gx1 + F.pierDoor / 2)) < 0.05) continue;
      decal(sb, posters[k++ % posters.length]!, 0.58, 0.8, cx, 1.45, z1 + 0.004);
    }
  }

  private awning(sb: Batch, xa: number, xb: number, z1: number, color: string): void {
    const len = 0.9, drop = 0.36, yTop = 2.78, ang = Math.atan2(drop, len), L = Math.hypot(len, drop);
    const n = Math.max(3, Math.round((xb - xa) / 0.24)), sw = (xb - xa) / n;
    const red = hex(color);
    for (let i = 0; i < n; i++) {
      const col = i % 2 ? 0xffffff : red, x = xa + (i + 0.5) * sw;
      cbox(sb, sw, 0.035, L, ['matte', col], x, yTop - drop / 2, z1 + len / 2, { rx: ang });
      cbox(sb, sw, 0.18, 0.025, ['matte', col], x, yTop - drop - 0.08, z1 + len);
    }
    for (const xe of [xa, xb]) cbox(sb, 0.03, 0.2, L * 0.98, ['matte', red], xe, yTop - drop / 2 - 0.06, z1 + len / 2, { rx: ang });
  }

  private buildStorageDoor(sb: Batch, W: number, storage: boolean): void {
    const cx = W / 2, met: Spec = ['metal', 0x8a94a3];
    if (!storage) {
      sb.box(0.09, 2.3, 0.1, met, cx - 0.7, 0, 0.05);
      sb.box(0.09, 2.3, 0.1, met, cx + 0.7, 0, 0.05);
      sb.box(1.49, 0.09, 0.1, met, cx, 2.25, 0.05);
      sb.box(1.32, 2.24, 0.05, ['matte', 0x52637a], cx, 0.01, 0.03);
      sb.box(1.2, 0.03, 0.06, ['matte', 0x435267], cx, 1.15, 0.05);
      sb.box(0.06, 0.24, 0.05, ['metal', 0xc0c7d0], cx + 0.48, 0.95, 0.08);
      sb.box(1.26, 0.2, 0.02, ['metal', 0x9aa3ad], cx, 0.03, 0.06);
      decal(sb, DECAL.tape(), 1.75, 0.15, cx, 1.28, 0.075, 0, 0.1);
      decal(sb, DECAL.tape(), 1.75, 0.15, cx, 0.86, 0.08, 0, -0.08);
      decal(sb, DECAL.plate(), 0.9, 0.225, cx, 2.62, 0.012);
      this.storageDoorBox = { x: cx, y: 1.15, z: 0.06, w: 1.5, h: 2.34, d: 0.16 };
    } else {
      const x0 = cx - DOOR_WIDTH / 2, x1 = cx + DOOR_WIDTH / 2;
      sb.box(0.08, 2.5, 0.06, met, x0 + 0.04, 0, 0.03);
      sb.box(0.08, 2.5, 0.06, met, x1 - 0.04, 0, 0.03);
      sb.box(DOOR_WIDTH, 0.08, 0.06, met, cx, 2.46, 0.03);
      decal(sb, DECAL.plate(), 0.9, 0.225, cx, 2.76, 0.012);
      this.storageDoorBox = null;
    }
  }

  /** Cores (parede/piso) sem reconstruir; devolve true se a cor do letreiro/toldos mudou (precisa rebuild). */
  setDecor(decor: Decor): boolean {
    this.innerMat?.color.set(hex(decor.wallColor));
    this.innerMat?.emissive.set(hex(decor.wallColor));
    this.floorMat?.color.set(hex(decor.floorColor));
    return decor.signColor !== this.signColor;
  }

  /** Troca a placa da porta (UV dos 12 primeiros vértices do decalque). */
  setOpenSign(open: boolean): void {
    if (this.signOpen === open || !this.decalGeo) return;
    this.signOpen = open;
    const c = open ? DECAL.open() : DECAL.closed();
    const uv = this.decalGeo.getAttribute('uv') as THREE.BufferAttribute;
    // planeGeo (2 triângulos, não indexado após o lote): UVs originais 0/1 → célula
    const base = [[0, 1], [0, 0], [1, 1], [0, 0], [1, 0], [1, 1]];
    for (let q = 0; q < 2; q++) for (let v = 0; v < 6; v++) {
      const [u, w] = base[v]!;
      uv.setXY(q * 6 + v, c.u0 + u! * c.du, c.v0 + w! * c.dv);
    }
    uv.needsUpdate = true;
  }

  /** Porta desliza com alguém perto (ou 'sfx door'); letreiro/pôsteres brilham à noite. */
  update(dt: number, doorWanted: boolean, night: number): void {
    this.doorOpen += ((doorWanted ? 1 : 0) - this.doorOpen) * (1 - Math.exp(-dt * 7));
    if (this.doorL && this.doorR) {
      this.doorL.position.x = this.doorBaseL - this.doorOpen * 0.95;
      this.doorR.position.x = this.doorBaseR + this.doorOpen * 0.95;
    }
    decalMaterial().emissiveIntensity = 0.14 + night * 0.55;
  }

  get bounds(): Bounds { return this.b; }

  private clear(): void {
    while (this.group.children.length) this.group.remove(this.group.children[0]!);
    this.tr.disposeAll();
    this.floorMat = null; this.innerMat = null; this.decalGeo = null; this.doorL = null; this.doorR = null;
  }
  dispose(): void { this.clear(); }
}
