/**
 * Corpo humano procedural com esqueleto (1 SkinnedMesh por pessoa; geometria COMPARTILHADA por variante).
 * Proporções realistas (pessoa de referência com 1,75 m, cabeça ≈ 1/7,5 da altura), olhando para +z.
 * Grupos de material do corpo: 0 roupa de cima (atlas tronco|mangas), 1 roupa de baixo, 2 pele, 3 calçado.
 * Cabeça (pele + retalho do rosto), cabelos, chapéus e óculos são malhas rígidas presas ao osso da cabeça.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sleeves } from './looks';

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];
type V3 = readonly [number, number, number];

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  uArmL: 'chest', fArmL: 'uArmL', handL: 'fArmL', uArmR: 'chest', fArmR: 'uArmR', handR: 'fArmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};
/** Posições absolutas de repouso. "L" = lado esquerdo da pessoa (+x). */
export const REST: Record<BoneName, V3> = {
  root: [0, 0, 0], hips: [0, 0.93, 0], spine: [0, 1.0, 0], chest: [0, 1.2, 0], neck: [0, 1.43, 0], head: [0, 1.53, 0],
  uArmL: [0.188, 1.405, 0], fArmL: [0.2, 1.12, 0], handL: [0.207, 0.865, 0.005],
  uArmR: [-0.188, 1.405, 0], fArmR: [-0.2, 1.12, 0], handR: [-0.207, 0.865, 0.005],
  thighL: [0.09, 0.91, 0], shinL: [0.09, 0.5, 0], footL: [0.09, 0.085, 0],
  thighR: [-0.09, 0.91, 0], shinR: [-0.09, 0.5, 0], footR: [-0.09, 0.085, 0],
};
/** Comprimentos usados pela IK do braço (ombro→cotovelo, cotovelo→palma). */
export const UPPER_ARM = 0.285;
export const FORE_ARM = 0.33;
/** Centro da cabeça em relação ao osso da cabeça. */
export const HEAD_OFFSET: V3 = [0, 0.105, 0.01];

const geos: THREE.BufferGeometry[] = [];
const keep = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };

/** Cria os ossos (hierarquia) na pose de repouso. */
export function makeBones(): Record<BoneName, THREE.Bone> {
  const out = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = n;
    const p = PARENT[n];
    const r = REST[n], pr = p ? REST[p] : [0, 0, 0] as V3;
    b.position.set(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2]);
    b.rotation.order = 'XZY';
    out[n] = b;
    if (p) out[p].add(b);
  }
  return out;
}

let inverses: THREE.Matrix4[] | null = null;
/** Inversas de ligação (iguais para todos: mesma pose de repouso). Compartilhadas entre esqueletos (só leitura). */
export function boneInverses(): THREE.Matrix4[] {
  if (inverses) return inverses;
  inverses = BONE_NAMES.map((n) => new THREE.Matrix4().makeTranslation(-REST[n][0], -REST[n][1], -REST[n][2]));
  return inverses;
}

/* ---------------- peças ---------------- */
type Grp = 0 | 1 | 2 | 3;
type UvMode = readonly [number, number, number, number] | null; // [u0,u1,v0,v1] no atlas da roupa

function prep(g: THREE.BufferGeometry, bone: BoneName | ((y: number) => [BoneName, BoneName, number]), uv: UvMode): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const pos = g.attributes.position!;
  for (let i = 0; i < n; i++) {
    if (typeof bone === 'string') { si[i * 4] = BONE_NAMES.indexOf(bone); sw[i * 4] = 1; }
    else {
      const [a, b, w] = bone(pos.getY(i));
      si[i * 4] = BONE_NAMES.indexOf(a); si[i * 4 + 1] = BONE_NAMES.indexOf(b);
      sw[i * 4] = 1 - w; sw[i * 4 + 1] = w;
    }
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const t = g.attributes.uv!;
  if (uv) for (let i = 0; i < t.count; i++) t.setXY(i, uv[0] + t.getX(i) * (uv[1] - uv[0]), uv[2] + t.getY(i) * (uv[3] - uv[2]));
  return g;
}

/** Cilindro com perfil [y, rx, rzFrente, rzTrás] (absoluto), frente no meio do u. */
function profiled(prof: readonly (readonly [number, number, number, number])[], radial = 16, rows = 12, closedBottom = true): THREE.BufferGeometry {
  const y0 = prof[0]![0], y1 = prof[prof.length - 1]![0];
  const g = new THREE.CylinderGeometry(1, 1, y1 - y0, radial, rows, !closedBottom, Math.PI, Math.PI * 2);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + (y0 + y1) / 2;
    let k = 0;
    while (k < prof.length - 2 && y > prof[k + 1]![0]) k++;
    const a = prof[k]!, b = prof[k + 1]!;
    const t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0] || 1)));
    const s = t * t * (3 - 2 * t);
    const rx = a[1] + (b[1] - a[1]) * s;
    const z = pos.getZ(i);
    const rz = z > 0 ? a[2] + (b[2] - a[2]) * s : a[3] + (b[3] - a[3]) * s;
    pos.setXYZ(i, pos.getX(i) * rx, y, z * rz);
  }
  g.computeVertexNormals();
  return g;
}

const TORSO_M = [[0.96, 0.15, 0.1, 0.1], [1.05, 0.146, 0.098, 0.097], [1.16, 0.158, 0.108, 0.104], [1.28, 0.174, 0.118, 0.11], [1.37, 0.18, 0.112, 0.108], [1.425, 0.168, 0.1, 0.1], [1.47, 0.1, 0.07, 0.07]] as const;
const TORSO_F = [[0.96, 0.158, 0.103, 0.105], [1.07, 0.128, 0.09, 0.09], [1.18, 0.136, 0.104, 0.094], [1.28, 0.152, 0.128, 0.1], [1.36, 0.156, 0.11, 0.098], [1.42, 0.155, 0.096, 0.096], [1.46, 0.095, 0.068, 0.068]] as const;
const PELVIS_M = [[0.83, 0.11, 0.08, 0.08], [0.87, 0.145, 0.1, 0.104], [0.93, 0.152, 0.104, 0.112], [0.985, 0.15, 0.1, 0.102]] as const;
const PELVIS_F = [[0.83, 0.12, 0.085, 0.09], [0.87, 0.158, 0.104, 0.115], [0.93, 0.166, 0.104, 0.12], [0.985, 0.158, 0.1, 0.104]] as const;

function capsule(r: number, len: number, x: number, yMid: number, z = 0, radial = 10): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 3, radial, 2).translate(x, yMid, z);
}
function hand(side: number): THREE.BufferGeometry {
  const palm = new THREE.CapsuleGeometry(0.032, 0.07, 3, 8).scale(0.62, 1, 1.12).translate(0, -0.075, 0.004);
  const thumb = new THREE.CapsuleGeometry(0.012, 0.035, 2, 6).rotateX(-0.5).translate(-side * 0.006, -0.06, 0.04);
  const g = mergeGeometries([palm, thumb])!;
  palm.dispose(); thumb.dispose();
  return g;
}
function shoe(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.1, 0.075, 0.255, 1, 1, 3).translate(0, 0.0375, 0.04);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    if (z > 0.1 && y > 0.04) p.setY(i, y - 0.025);
    if (z < -0.05) p.setX(i, p.getX(i) * 0.9);
  }
  g.computeVertexNormals();
  return g;
}

export type Legs = 'pants' | 'shorts' | 'skirt';
const bodyCache = new Map<string, THREE.BufferGeometry>();

/** Geometria do corpo (sexo, mangas, pernas), cacheada. Grupos: 0 roupa, 1 baixo, 2 pele, 3 calçado. */
export function bodyGeometry(sex: 'm' | 'f', sleeves: Sleeves, legs: Legs): THREE.BufferGeometry {
  const key = `${sex}${sleeves}${legs}`;
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const parts: THREE.BufferGeometry[][] = [[], [], [], []];
  const add = (grp: Grp, g: THREE.BufferGeometry, bone: Parameters<typeof prep>[1], uv: UvMode = null): void => { parts[grp]!.push(prep(g, bone, uv)); };
  const TORSO_UV = [0, 0.5, 0, 1] as const;
  add(0, profiled(sex === 'f' ? TORSO_F : TORSO_M), (y) => ['spine', 'chest', Math.min(1, Math.max(0, (y - 1.05) / 0.25))], TORSO_UV);
  add(1, profiled(sex === 'f' ? PELVIS_F : PELVIS_M, 14, 4), 'hips');
  add(2, new THREE.CylinderGeometry(0.05, 0.057, 0.15, 10).translate(0, 1.49, -0.005), 'neck');
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const ua = `uArm${L}` as BoneName, fa = `fArm${L}` as BoneName, hb = `hand${L}` as BoneName;
    const th = `thigh${L}` as BoneName, sh = `shin${L}` as BoneName, ft = `foot${L}` as BoneName;
    const ax = s * (sex === 'f' ? 0.18 : 0.188);
    const sleeve = sleeves !== 'none';
    add(sleeve ? 0 : 2, new THREE.SphereGeometry(0.056, 10, 8).scale(1, 0.95, 0.95).translate(ax, 1.39, 0), ua, sleeve ? [0.5, 1, 0.75, 1] : null);
    if (sleeves === 'long') add(0, capsule(0.046, 0.2, ax + s * 0.006, 1.262), ua, [0.5, 1, 0.5, 1]);
    else add(2, capsule(sex === 'f' ? 0.041 : 0.045, 0.2, ax + s * 0.006, 1.262), ua);
    if (sleeves === 'short') add(0, new THREE.CylinderGeometry(0.058, 0.055, 0.14, 12).translate(ax + s * 0.003, 1.33, 0), ua, [0.5, 1, 0, 0.5]);
    if (sleeves === 'long') add(0, capsule(0.04, 0.19, ax + s * 0.015, 0.993), fa, [0.5, 1, 0, 0.5]);
    else add(2, capsule(sex === 'f' ? 0.035 : 0.038, 0.19, ax + s * 0.015, 0.993), fa);
    add(2, hand(s).translate(ax + s * 0.019, 0.865, 0.005), hb);
    const tr = sex === 'f' ? 0.074 : 0.075;
    if (legs === 'pants') {
      add(1, capsule(tr, 0.33, s * 0.09, 0.705), th);
      add(1, capsule(0.057, 0.34, s * 0.09, 0.29), sh);
    } else {
      add(2, capsule(tr - 0.004, 0.33, s * 0.09, 0.705), th);
      add(2, capsule(0.052, 0.34, s * 0.09, 0.29), sh);
      if (legs === 'shorts') add(1, new THREE.CylinderGeometry(0.086, 0.083, 0.25, 12).translate(s * 0.09, 0.79, 0), th);
    }
    add(3, shoe().translate(s * 0.09, 0, 0), ft);
  }
  if (legs === 'skirt') add(1, new THREE.CylinderGeometry(0.17, 0.235, 0.44, 16, 1, true).scale(1, 1, 0.82).translate(0, 0.79, 0), 'hips');
  const merged: THREE.BufferGeometry[] = parts.map((list) => {
    const m = mergeGeometries(list)!;
    for (const g of list) g.dispose();
    return m;
  });
  const out = keep(mergeGeometries(merged, true)!);
  for (const g of merged) g.dispose();
  out.computeBoundingSphere();
  bodyCache.set(key, out);
  return out;
}

/* ---------------- cabeça ---------------- */
/** Deforma uma esfera unitária no formato de cabeça (queixo afinado, nuca levemente achatada) com fator f. */
function headShape(g: THREE.BufferGeometry, f: number, bump = 0): THREE.BufferGeometry {
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const jaw = y < 0 ? 1 - 0.3 * y * y : 1;
    const back = z < 0 ? 0.95 : 1;
    let k = f;
    if (bump) k *= 1 + bump * Math.sin(x * 9 + y * 7) * Math.sin(z * 8 - y * 5);
    x *= 0.1 * jaw * k; y *= (y >= 0 ? 0.122 : 0.115) * k; z *= 0.112 * jaw * back * k;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
let headGeo: THREE.BufferGeometry | null = null;
/** Cabeça com 2 grupos: 0 pele (crânio, orelhas, nariz), 1 retalho do rosto (textura). Origem = centro da cabeça. */
export function headGeometry(): THREE.BufferGeometry {
  if (headGeo) return headGeo;
  const skull = headShape(new THREE.SphereGeometry(1, 20, 16), 1);
  const earL = new THREE.SphereGeometry(0.026, 8, 6).scale(0.42, 1, 0.7).translate(0.099, -0.004, -0.008);
  const earR = earL.clone().translate(-0.198, 0, 0);
  const nose = new THREE.SphereGeometry(0.017, 8, 6).scale(0.85, 1.45, 1).translate(0, -0.014, 0.108);
  const skin = mergeGeometries([skull, earL, earR, nose])!;
  const patch = headShape(new THREE.SphereGeometry(1, 18, 14, Math.PI / 2 - 1.2, 2.4, Math.PI * 0.28, Math.PI * 0.6), 1.013);
  headGeo = keep(mergeGeometries([skin, patch], true)!);
  for (const g of [skull, earL, earR, nose, skin, patch]) g.dispose();
  return headGeo;
}

export type HairStyle = 'short' | 'buzz' | 'side' | 'long' | 'ponytail' | 'bun' | 'curly' | 'bob' | 'balding' | 'none';
export type HatStyle = 'helmet' | 'cap' | 'beanie' | 'hat';
const hairCache = new Map<string, THREE.BufferGeometry>();

const shell = (f: number, phiS: number, phiL: number, thS: number, thL: number, bump = 0): THREE.BufferGeometry =>
  headShape(new THREE.SphereGeometry(1, 18, 9, phiS, phiL, thS, thL), f, bump);
const BACK_S = Math.PI / 2 + 0.95, BACK_L = Math.PI * 2 - 1.9;

function mergeOwn(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(list)!;
  for (const g of list) g.dispose();
  return m;
}

/** Cabelo (origem = centro da cabeça). */
export function hairGeometry(style: HairStyle): THREE.BufferGeometry | null {
  if (style === 'none') return null;
  const hit = hairCache.get(style);
  if (hit) return hit;
  const cap = (f = 1.07): THREE.BufferGeometry[] => [shell(f, 0, Math.PI * 2, 0, Math.PI * 0.42), shell(f - 0.01, BACK_S, BACK_L, Math.PI * 0.4, Math.PI * 0.2)];
  let list: THREE.BufferGeometry[];
  switch (style) {
    case 'buzz': list = [shell(1.03, 0, Math.PI * 2, 0, Math.PI * 0.44), shell(1.025, BACK_S, BACK_L, Math.PI * 0.42, Math.PI * 0.17)]; break;
    case 'side': list = [...cap(1.08), new THREE.SphereGeometry(0.06, 10, 6).scale(1.5, 0.55, 1.1).translate(-0.03, 0.115, 0.045)]; break;
    case 'long': list = [...cap(1.07), new THREE.CylinderGeometry(0.113, 0.13, 0.3, 16, 1, true, 0.8, Math.PI * 2 - 1.6).translate(0, -0.12, -0.004)]; break;
    case 'ponytail': list = [...cap(1.06), new THREE.CapsuleGeometry(0.033, 0.15, 3, 8).rotateX(0.35).translate(0, -0.07, -0.13)]; break;
    case 'bun': list = [...cap(1.06), new THREE.SphereGeometry(0.052, 10, 8).translate(0, 0.1, -0.09)]; break;
    case 'curly': list = [shell(1.26, 0, Math.PI * 2, 0, Math.PI * 0.5, 0.07), shell(1.18, BACK_S, BACK_L, Math.PI * 0.45, Math.PI * 0.2, 0.06)]; break;
    case 'bob': list = [...cap(1.08), new THREE.CylinderGeometry(0.116, 0.126, 0.15, 16, 1, true, 0.95, Math.PI * 2 - 1.9).translate(0, -0.04, -0.004)]; break;
    case 'balding': list = [shell(1.04, BACK_S - 0.4, BACK_L + 0.8, Math.PI * 0.36, Math.PI * 0.24)]; break;
    case 'short':
    default: list = cap(1.07); break;
  }
  const g = keep(mergeOwn(list));
  hairCache.set(style, g);
  return g;
}

/** Chapéus/capacete (origem = centro da cabeça). */
export function hatGeometry(style: HatStyle): THREE.BufferGeometry {
  const key = `hat:${style}`;
  const hit = hairCache.get(key);
  if (hit) return hit;
  let list: THREE.BufferGeometry[];
  switch (style) {
    case 'helmet': list = [
      shell(1.2, 0, Math.PI * 2, 0, Math.PI * 0.44).translate(0, 0.012, 0),
      new THREE.CylinderGeometry(0.148, 0.152, 0.012, 22).scale(1, 1, 1.12).translate(0, 0.04, 0.016),
      new THREE.BoxGeometry(0.03, 0.022, 0.2).translate(0, 0.148, 0),
    ]; break;
    case 'cap': list = [
      shell(1.1, 0, Math.PI * 2, 0, Math.PI * 0.44),
      new THREE.CylinderGeometry(0.095, 0.095, 0.01, 16, 1, false, -Math.PI / 2, Math.PI).scale(0.95, 1, 1).rotateX(0.12).translate(0, 0.045, 0.085),
    ]; break;
    case 'beanie': list = [
      shell(1.12, 0, Math.PI * 2, 0, Math.PI * 0.47),
      new THREE.CylinderGeometry(0.119, 0.121, 0.04, 18).translate(0, 0.035, 0.004),
      new THREE.SphereGeometry(0.03, 8, 6).translate(0, 0.152, 0),
    ]; break;
    case 'hat':
    default: list = [
      new THREE.CylinderGeometry(0.084, 0.1, 0.1, 16).translate(0, 0.135, 0),
      new THREE.CylinderGeometry(0.2, 0.2, 0.01, 24).translate(0, 0.088, 0),
    ]; break;
  }
  const g = keep(mergeOwn(list));
  hairCache.set(key, g);
  return g;
}

let glassesGeo: THREE.BufferGeometry | null = null;
/** Óculos escuros (origem = centro da cabeça). */
export function glassesGeometry(): THREE.BufferGeometry {
  if (glassesGeo) return glassesGeo;
  const list: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    list.push(new THREE.CylinderGeometry(0.021, 0.019, 0.006, 14).rotateX(Math.PI / 2).scale(1.25, 1, 1).translate(s * 0.034, 0.002, 0.113));
    list.push(new THREE.BoxGeometry(0.004, 0.006, 0.105).translate(s * 0.094, 0.006, 0.06));
  }
  list.push(new THREE.BoxGeometry(0.022, 0.005, 0.005).translate(0, 0.01, 0.118));
  glassesGeo = keep(mergeOwn(list));
  return glassesGeo;
}

export function disposeBodies(): void {
  for (const g of geos) g.dispose();
  geos.length = 0;
  bodyCache.clear(); hairCache.clear();
  headGeo = null; glassesGeo = null; inverses = null;
}
