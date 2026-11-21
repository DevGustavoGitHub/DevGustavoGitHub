/**
 * Humanoides low-poly procedurais (arte 100% original). Geometrias e materiais são compartilhados entre
 * todos os NPCs (caches de módulo); cada pessoa é um grupo de ~10 meshes com articulações simples.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp } from './shared';

export type Pose = 'normal' | 'basket' | 'carry' | 'mop' | 'grab' | 'scan';
export type Role = 'customer' | 'cashier' | 'stocker' | 'janitor';
export type AgeGroup = 'adult' | 'kid' | 'elder';

export interface PersonSpec {
  role: Role;
  age: AgeGroup;
  skin: number;
  hair: number;
  hairStyle: 0 | 1 | 2 | 3; // 0 careca, 1 curto, 2 longo, 3 coque
  shirt: number;
  pants: number;
  height: number; // multiplicador
  seed: number;
}

const SKINS = [0xf2c9a0, 0xe0a97d, 0xc68b5e, 0x9a6540, 0x6f4429, 0xffdcbf];
const HAIRS = [0x1b1410, 0x3a2414, 0x6b4423, 0xb8863b, 0xc4421e, 0x111111, 0xd8c68a];
const SHIRTS = [0xd94f4f, 0x3f7fd0, 0x4caf6a, 0xe8b93a, 0x8e5cc4, 0xf08a3c, 0x2fa6a6, 0xe46fa0, 0xf0f0f0, 0x455a7a];
const PANTS = [0x2b3a55, 0x3a3a3a, 0x6b5a45, 0x1f4d63, 0x5a3b3b, 0x7a7f86];
const ELDER_HAIR = [0xdcdcdc, 0xb8b8b8, 0xf2f2f2];
const UNIFORM: Record<'cashier' | 'stocker' | 'janitor', number> = { cashier: 0xd33b3b, stocker: 0x2f6fd0, janitor: 0x2f9e5b };

/* ---------- caches ---------- */
const geos: THREE.BufferGeometry[] = [];
const mats = new Map<string, THREE.MeshLambertMaterial>();
const track = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };

function material(key: string, color: number, vertexColors = false): THREE.MeshLambertMaterial {
  const k = `${key}:${color}`;
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, vertexColors });
    mats.set(k, m);
  }
  return m;
}

function paint(g: THREE.BufferGeometry, v: number): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  const c = new Float32Array(n * 3).fill(v);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

interface Shared {
  leg: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
  hair: THREE.BufferGeometry[];
  cap: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
  box: THREE.BufferGeometry;
  basket: THREE.BufferGeometry;
  handle: THREE.BufferGeometry;
  mopStick: THREE.BufferGeometry;
  mopHead: THREE.BufferGeometry;
  item: THREE.BufferGeometry;
  shadowMat: THREE.MeshBasicMaterial;
  faceMat: THREE.MeshBasicMaterial;
  cardboard: THREE.MeshLambertMaterial;
  basketMat: THREE.MeshLambertMaterial;
  stickMat: THREE.MeshLambertMaterial;
  mopMat: THREE.MeshLambertMaterial;
}
let S: Shared | null = null;

function shared(): Shared {
  if (S) return S;
  const legA = new THREE.BoxGeometry(0.14, 0.74, 0.16).translate(0, -0.37, 0);
  const shoe = new THREE.BoxGeometry(0.15, 0.08, 0.25).translate(0, -0.76, 0.04);
  const leg = track(mergeGeometries([paint(legA, 1) , paint(shoe, 0.12)])!);
  const torso = track(new THREE.BoxGeometry(0.36, 0.52, 0.21).translate(0, 0.26, 0));
  const arm = track(new THREE.BoxGeometry(0.09, 0.5, 0.09).translate(0, -0.25, 0));
  const head = track(new THREE.SphereGeometry(0.135, 8, 6).scale(1, 1.1, 1).translate(0, 0.15, 0));
  const eyeL = new THREE.BoxGeometry(0.03, 0.04, 0.02).translate(-0.05, 0.17, 0.125);
  const eyeR = new THREE.BoxGeometry(0.03, 0.04, 0.02).translate(0.05, 0.17, 0.125);
  const face = track(mergeGeometries([eyeL, eyeR])!);
  const capShape = new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, 0.16, -0.005);
  const short = track(capShape.clone());
  const longBack = new THREE.BoxGeometry(0.27, 0.3, 0.08).translate(0, 0.07, -0.1);
  const long = track(mergeGeometries([capShape.clone(), longBack])!);
  const bun = new THREE.SphereGeometry(0.06, 6, 5).translate(0, 0.3, -0.1);
  const bunG = track(mergeGeometries([capShape.clone(), bun])!);
  const visor = new THREE.BoxGeometry(0.2, 0.02, 0.12).translate(0, 0.2, 0.15);
  const cap = track(mergeGeometries([capShape.clone().scale(1.03, 1.03, 1.03), visor])!);
  capShape.dispose();
  const shadow = track(new THREE.CircleGeometry(0.32, 10).rotateX(-Math.PI / 2).translate(0, 0.012, 0));
  S = {
    leg, torso, arm, head, face, hair: [short, short, long, bunG], cap, shadow,
    box: track(new THREE.BoxGeometry(0.38, 0.28, 0.3)),
    basket: track(new THREE.BoxGeometry(0.3, 0.14, 0.2)),
    handle: track(new THREE.TorusGeometry(0.1, 0.012, 4, 8, Math.PI).translate(0, 0.07, 0)),
    mopStick: track(new THREE.CylinderGeometry(0.014, 0.014, 1.3, 5).translate(0, 0.65, 0)),
    mopHead: track(new THREE.BoxGeometry(0.26, 0.07, 0.12).translate(0, 0.04, 0)),
    item: track(new THREE.BoxGeometry(0.08, 0.1, 0.08)),
    shadowMat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    faceMat: new THREE.MeshBasicMaterial({ color: 0x1a1210 }),
    cardboard: material('card', 0xb88a52),
    basketMat: material('basket', 0xd24a3a),
    stickMat: material('stick', 0x8a6a45),
    mopMat: material('mop', 0xe8e4d0),
  };
  return S;
}

export function disposeModels(): void {
  for (const g of geos) g.dispose();
  geos.length = 0;
  for (const m of mats.values()) m.dispose();
  mats.clear();
  if (S) {
    S.shadowMat.dispose();
    S.faceMat.dispose();
  }
  S = null;
}

/** Cor estável por produto (para os itens na cesta/esteira). */
export function productMaterial(productId: string): THREE.MeshLambertMaterial {
  let h = 7;
  for (let i = 0; i < productId.length; i++) h = (h * 31 + productId.charCodeAt(i)) >>> 0;
  const color = new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55).getHex();
  return material('prod', color);
}

export const MAX_BASKET_ITEMS = 6;

/** Gera uma especificação aleatória de cliente. */
export function randomCustomerSpec(rand: () => number, seed: number): PersonSpec {
  const r = rand();
  const age: AgeGroup = r < 0.14 ? 'kid' : r < 0.3 ? 'elder' : 'adult';
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  return {
    role: 'customer',
    age,
    skin: pick(SKINS),
    hair: age === 'elder' ? pick(ELDER_HAIR) : pick(HAIRS),
    hairStyle: age === 'elder' && rand() < 0.3 ? 0 : (Math.floor(rand() * 4) as 0 | 1 | 2 | 3),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    height: age === 'kid' ? 0.62 + rand() * 0.14 : age === 'elder' ? 0.9 + rand() * 0.08 : 0.92 + rand() * 0.16,
    seed,
  };
}

export function staffSpec(role: 'cashier' | 'stocker' | 'janitor', rand: () => number, seed: number): PersonSpec {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  return {
    role, age: 'adult', skin: pick(SKINS), hair: pick(HAIRS), hairStyle: 1, shirt: UNIFORM[role], pants: 0x2b2f3a,
    height: 0.98 + rand() * 0.06, seed,
  };
}

/** Uma pessoa 3D animada. */
export class Person {
  readonly root = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly basket = new THREE.Group();
  private readonly basketItems: THREE.Mesh[] = [];
  private readonly carryBox: THREE.Mesh;
  private readonly mop = new THREE.Group();
  private readonly seed: number;
  readonly scale: number;
  readonly eyeHeight: number;
  pose: Pose = 'normal';
  /** Tempo corrido da ação atual (grab/scan/mop) em segundos. */
  actionT = 0;
  /** Mostra a "ação em curso" (mexendo) mesmo parado. */
  working = false;
  private phase = 0;
  private time = 0;

  constructor(spec: PersonSpec) {
    const s = shared();
    this.seed = spec.seed * 1.7;
    const kid = spec.age === 'kid';
    this.scale = spec.height * (kid ? 1 : 1);
    this.root.scale.setScalar(this.scale);
    this.eyeHeight = 1.75 * this.scale;

    const pantsMat = material('pants', spec.pants, true);
    this.legL = new THREE.Mesh(s.leg, pantsMat);
    this.legR = new THREE.Mesh(s.leg, pantsMat);
    this.legL.position.set(-0.095, 0.8, 0);
    this.legR.position.set(0.095, 0.8, 0);

    this.upper.position.y = 0.8;
    const torso = new THREE.Mesh(s.torso, material('shirt', spec.shirt));
    const skin = material('skin', spec.skin);
    this.armL.position.set(-0.225, 0.5, 0);
    this.armR.position.set(0.225, 0.5, 0);
    this.armL.add(new THREE.Mesh(s.arm, skin));
    this.armR.add(new THREE.Mesh(s.arm, skin));

    this.head.position.set(0, 0.56, 0);
    this.head.add(new THREE.Mesh(s.head, skin));
    this.head.add(new THREE.Mesh(s.face, s.faceMat));
    if (spec.role === 'customer') {
      if (spec.hairStyle !== 0) this.head.add(new THREE.Mesh(s.hair[spec.hairStyle]!, material('hair', spec.hair)));
    } else {
      this.head.add(new THREE.Mesh(s.cap, material('cap', spec.shirt)));
    }
    if (kid) this.head.scale.setScalar(1.28);

    // cesta
    const bm = new THREE.Mesh(s.basket, s.basketMat);
    const handle = new THREE.Mesh(s.handle, s.basketMat);
    handle.position.y = 0.07;
    this.basket.add(bm, handle);
    for (let i = 0; i < MAX_BASKET_ITEMS; i++) {
      const it = new THREE.Mesh(s.item, productMaterial('x'));
      it.position.set(-0.1 + (i % 3) * 0.1, 0.1, i < 3 ? -0.04 : 0.05);
      it.visible = false;
      this.basket.add(it);
      this.basketItems.push(it);
    }
    this.basket.position.set(0.3, -0.12, 0.1);
    this.basket.visible = false;

    // caixa carregada
    this.carryBox = new THREE.Mesh(s.box, s.cardboard);
    this.carryBox.position.set(0, 0.12, 0.34);
    this.carryBox.visible = false;

    // esfregão
    const stick = new THREE.Mesh(s.mopStick, s.stickMat);
    const mh = new THREE.Mesh(s.mopHead, s.mopMat);
    this.mop.add(stick, mh);
    this.mop.position.set(0.26, -0.8, 0.38);
    this.mop.visible = false;

    this.upper.add(torso, this.armL, this.armR, this.head, this.basket, this.carryBox, this.mop);
    if (spec.age === 'elder') this.upper.rotation.x = 0.13;
    const shadow = new THREE.Mesh(s.shadow, s.shadowMat);
    shadow.scale.setScalar(1);
    this.root.add(this.legL, this.legR, this.upper, shadow);
    // sombras só no chão falso; mesh do corpo não projeta
    this.root.traverse((o) => { o.matrixAutoUpdate = true; });
  }

  setBasket(visible: boolean): void { this.basket.visible = visible; }
  /** Atualiza a visibilidade/cor dos itens da cesta. */
  setBasketItems(productIds: readonly string[]): void {
    for (let i = 0; i < MAX_BASKET_ITEMS; i++) {
      const it = this.basketItems[i]!;
      const pid = productIds[i];
      it.visible = pid !== undefined;
      if (pid !== undefined) it.material = productMaterial(pid);
    }
  }
  setCarryBox(v: boolean): void { this.carryBox.visible = v; }
  setMop(v: boolean): void { this.mop.visible = v; }

  /** speed em m/s reais. Sem alocação. */
  animate(dt: number, speed: number, lookYaw = 0): void {
    this.time += dt;
    const w = clamp(speed / 1.2, 0, 1);
    this.phase += speed * dt * 5.4 / this.scale * 0.8;
    const sw = Math.sin(this.phase) * 0.7 * w;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    const k = Math.min(1, dt * 12);
    let lx = -sw * 0.8, rx = sw * 0.8, lz = 0, rz = 0;
    const t = this.time + this.seed;
    this.actionT += dt;
    switch (this.pose) {
      case 'basket':
        rx = -0.3; rz = -0.04;
        break;
      case 'carry':
        lx = rx = -1.15; lz = 0.2; rz = -0.2;
        break;
      case 'mop': {
        const sway = this.working ? Math.sin(this.actionT * 5) * 0.35 : Math.sin(this.phase) * 0.1 * w;
        lx = -0.9; rx = -1.0; lz = 0.12; rz = -0.12;
        this.mop.rotation.z = lerp(this.mop.rotation.z, sway, k);
        this.mop.position.x = 0.26 + Math.sin(this.actionT * 5) * (this.working ? 0.14 : 0);
        break;
      }
      case 'grab':
        rx = -1.3 + Math.sin(this.actionT * 9) * 0.25; rz = -0.1;
        break;
      case 'scan':
        rx = -0.9 + Math.sin(this.actionT * 7) * 0.35; lx = -0.3;
        break;
      default:
        break;
    }
    if (this.pose !== 'mop') this.mop.rotation.z = lerp(this.mop.rotation.z, 0, k);
    this.armL.rotation.x += (lx - this.armL.rotation.x) * k;
    this.armR.rotation.x += (rx - this.armR.rotation.x) * k;
    this.armL.rotation.z += (lz - this.armL.rotation.z) * k;
    this.armR.rotation.z += (rz - this.armR.rotation.z) * k;
    this.upper.position.y = 0.8 + Math.abs(Math.sin(this.phase)) * 0.03 * w + Math.sin(t * 1.8) * 0.004 * (1 - w);
    this.head.rotation.y = lerp(this.head.rotation.y, lookYaw + Math.sin(t * 0.6) * 0.25 * (1 - w), k);
  }
}

/** Mesh de item de mercadoria (esteira/balcão), compartilha geometria. */
export function itemMesh(): THREE.Mesh {
  const m = new THREE.Mesh(shared().item, productMaterial('x'));
  m.visible = false;
  return m;
}
