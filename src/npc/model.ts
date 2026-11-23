/**
 * Pessoas 3D procedurais (arte 100% original), estilizadas com proporções humanas realistas.
 * Cada pessoa: 1 SkinnedMesh (corpo, geometria compartilhada por variante, 4 grupos de material) + cabeça
 * (pele + rosto em CanvasTexture) + cabelo/chapéu/óculos + cesta (itens num InstancedMesh) + sombra.
 * ≈ 6–9 objetos e 10–13 draw calls por pessoa; materiais em cache; animação sem alocação.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PRODUCTS } from '../sim/catalog';
import {
  type BoneName, FORE_ARM, HEAD_OFFSET, type HairStyle, type HatStyle, type Legs, REST, UPPER_ARM,
  bodyGeometry, boneInverses, disposeBodies, glassesGeometry, hairGeometry, hatGeometry, headGeometry, makeBones,
} from './body';
import { FEMALE_FACES, KIND_OUTFIT, MALE_FACES, OUTFITS, type Outfit, UNIFORMS, disposeLooks, faceMaterial, outfitMaterial } from './looks';
import { clamp } from './shared';

export type Pose = 'normal' | 'basket' | 'carry' | 'mop' | 'grab' | 'scan' | 'place' | 'extend' | 'sit' | 'sitScan';
export type Role = 'customer' | 'cashier' | 'stocker' | 'janitor';
export type AgeGroup = 'adult' | 'kid' | 'elder';
/** Tipos de cliente (os especiais são raros e têm visual distinto). */
export type CustomerKind = 'normal' | 'bulk' | 'picky' | 'kid';

export interface PersonSpec {
  role: Role;
  age: AgeGroup;
  sex: 'm' | 'f';
  kind?: CustomerKind;
  seed: number;
  /** altura em metros */
  height: number;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  hat: HatStyle | null;
  hatColor: string;
  glasses: boolean;
  outfit: Outfit;
  legs: Legs;
  pants: string;
  shoes: string;
  face: number;
  basket: string;
}

const SKINS = ['#f3d2b3', '#e6b892', '#d29a6e', '#b07850', '#8a5a3a', '#5e3b26'];
const HAIRS = ['#1b1410', '#2e1d12', '#5a3a1e', '#8a5a2b', '#c8a05a', '#a8432a', '#111111'];
const ELDER_HAIR = ['#d8d8d8', '#b9b9b9', '#efefef'];
const PANTS = ['#2b3a55', '#3d4f7a', '#2a2a2e', '#6b5a45', '#1f4d63', '#4a4f57', '#7a6a55'];
const SHOES = ['#f2f2f2', '#222222', '#5a3a22', '#c0392b', '#3a3f4a'];
const SKIRTS = ['#2a2a2e', '#a33a4a', '#3d4f7a', '#d9a63a'];
const HAT_COLORS = ['#f2c230', '#e67e22', '#2f6fd0', '#c0392b', '#2b2b2b', '#f2f2f2'];
const BASKETS = ['#d24a3a', '#2f7fd0', '#2f9e5b'];
const M_HAIR: HairStyle[] = ['short', 'short', 'buzz', 'side', 'side', 'curly', 'balding', 'ponytail'];
const F_HAIR: HairStyle[] = ['long', 'long', 'ponytail', 'bun', 'bob', 'curly', 'short'];

/* ---------------- caches compartilhados ---------------- */
const mats = new Map<string, THREE.Material>();
const geos: THREE.BufferGeometry[] = [];
function lambert(key: string, color: string, extra?: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  let m = mats.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) { m = new THREE.MeshLambertMaterial({ color, ...extra }); mats.set(key, m); }
  return m;
}
const colorCache = new Map<string, THREE.Color>();
/** Cor do produto (catálogo) como THREE.Color em cache. */
export function productColor(pid: string): THREE.Color {
  let c = colorCache.get(pid);
  if (!c) {
    const p = PRODUCTS.find((x) => x.id === pid);
    let hex = p?.color;
    if (!hex) { let h = 7; for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) >>> 0; hex = `#${new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.55).getHexString()}`; }
    c = new THREE.Color(hex);
    colorCache.set(pid, c);
  }
  return c;
}

interface Props {
  basket: THREE.BufferGeometry; bag: THREE.BufferGeometry; item: THREE.BufferGeometry; shadow: THREE.BufferGeometry;
  box: THREE.BufferGeometry; lid: THREE.BufferGeometry; flaps: THREE.BufferGeometry; fill: THREE.BufferGeometry; mop: THREE.BufferGeometry;
  shadowMat: THREE.MeshBasicMaterial; itemMat: THREE.MeshLambertMaterial; cardboard: THREE.MeshLambertMaterial; vcol: THREE.MeshLambertMaterial;
}
let P: Props | null = null;
function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex), n = g.attributes.position!.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function merged(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list)!;
  for (const x of list) x.dispose();
  geos.push(g);
  return g;
}
function props(): Props {
  if (P) return P;
  // cesta: origem na pega (topo da alça); corpo pendurado abaixo
  const basket = merged([
    new THREE.BoxGeometry(0.22, 0.012, 0.32).translate(0, -0.27, 0),
    new THREE.BoxGeometry(0.22, 0.15, 0.012).translate(0, -0.19, 0.16), new THREE.BoxGeometry(0.22, 0.15, 0.012).translate(0, -0.19, -0.16),
    new THREE.BoxGeometry(0.012, 0.15, 0.32).translate(0.11, -0.19, 0), new THREE.BoxGeometry(0.012, 0.15, 0.32).translate(-0.11, -0.19, 0),
    new THREE.TorusGeometry(0.12, 0.008, 4, 12, Math.PI).rotateY(Math.PI / 2).translate(0, -0.12, 0),
  ]);
  const bag = merged([
    paint(new THREE.BoxGeometry(0.24, 0.27, 0.13).translate(0, -0.205, 0), 0xc9a06a),
    paint(new THREE.BoxGeometry(0.245, 0.03, 0.135).translate(0, -0.085, 0), 0xb08850),
    paint(new THREE.TorusGeometry(0.05, 0.006, 4, 10, Math.PI).translate(0, -0.07, 0.04), 0x8a6a40),
    paint(new THREE.TorusGeometry(0.05, 0.006, 4, 10, Math.PI).translate(0, -0.07, -0.04), 0x8a6a40),
  ]);
  const box = merged([new THREE.BoxGeometry(0.42, 0.28, 0.32)]);
  const lid = merged([
    paint(new THREE.BoxGeometry(0.424, 0.012, 0.324).translate(0, 0.146, 0), 0xb88a52),
    paint(new THREE.BoxGeometry(0.43, 0.014, 0.07).translate(0, 0.148, 0), 0xd8c08a),
  ]);
  const flapG = (w: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, 0.006, d);
  const flaps = merged([
    flapG(0.42, 0.15).translate(0, 0, 0.075).rotateX(-0.45).translate(0, 0.14, 0.16).translate(0, 0, 0),
    flapG(0.42, 0.15).translate(0, 0, -0.075).rotateX(0.45).translate(0, 0.14, -0.16),
    flapG(0.15, 0.32).translate(0.075, 0, 0).rotateZ(0.45).translate(0.21, 0.14, 0),
    flapG(0.15, 0.32).translate(-0.075, 0, 0).rotateZ(-0.45).translate(-0.21, 0.14, 0),
  ]);
  const fill = merged([new THREE.BoxGeometry(0.38, 0.03, 0.28).translate(0, 0.11, 0)]);
  const mop = merged([
    paint(new THREE.CylinderGeometry(0.013, 0.013, 1.25, 6).translate(0, 0.66, 0), 0x8a6a45),
    paint(new THREE.BoxGeometry(0.3, 0.035, 0.1).translate(0, 0.05, 0), 0x4a6fa5),
    paint(new THREE.BoxGeometry(0.34, 0.04, 0.14).translate(0, 0.018, 0), 0xe8e4d0),
  ]);
  P = {
    basket, bag, box, lid, flaps, fill, mop,
    item: (() => { const g = new THREE.BoxGeometry(0.075, 0.11, 0.075); geos.push(g); return g; })(),
    shadow: (() => { const g = new THREE.CircleGeometry(0.3, 12).rotateX(-Math.PI / 2).translate(0, 0.012, 0); geos.push(g); return g; })(),
    shadowMat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }),
    itemMat: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    cardboard: new THREE.MeshLambertMaterial({ color: 0xb88a52 }),
    vcol: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
  };
  return P;
}

export function disposeModels(): void {
  for (const g of geos) g.dispose();
  geos.length = 0;
  for (const m of mats.values()) m.dispose();
  mats.clear();
  if (P) { P.shadowMat.dispose(); P.itemMat.dispose(); P.cardboard.dispose(); P.vcol.dispose(); }
  P = null;
  disposeBodies();
  disposeLooks();
}

export const MAX_BASKET_ITEMS = 6;
const ITEM_SPOTS: readonly [number, number][] = [[-0.05, -0.1], [0.05, -0.1], [-0.05, 0], [0.05, 0], [-0.05, 0.1], [0.05, 0.1]];

/** Sorteia o tipo de cliente: ~5% compra grande, ~6% exigente, ~7% criança. */
export function pickKind(rand: () => number): CustomerKind {
  const r = rand();
  return r < 0.05 ? 'bulk' : r < 0.11 ? 'picky' : r < 0.18 ? 'kid' : 'normal';
}

export function randomCustomerSpec(rand: () => number, seed: number, kind: CustomerKind = 'normal'): PersonSpec {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  const age: AgeGroup = kind === 'kid' ? 'kid' : rand() < 0.16 ? 'elder' : 'adult';
  const sex: 'm' | 'f' = rand() < 0.5 ? 'm' : 'f';
  const hair = age === 'elder' ? pick(ELDER_HAIR) : pick(HAIRS);
  let outfit: Outfit = kind === 'bulk' ? KIND_OUTFIT.bulk : kind === 'picky' ? KIND_OUTFIT.picky : kind === 'kid' ? KIND_OUTFIT.kid : pick(OUTFITS);
  if (sex === 'f' && outfit.style === 'suit' && rand() < 0.5) outfit = pick(OUTFITS);
  let hat: HatStyle | null = null;
  if (kind === 'picky') hat = 'hat';
  else if (age !== 'kid') { const r = rand(); hat = r < 0.07 ? 'helmet' : r < 0.14 ? 'cap' : r < 0.18 ? 'beanie' : null; }
  const legs: Legs = sex === 'f' && age !== 'kid' && rand() < 0.22 ? 'skirt' : (outfit.style === 'tank' || age === 'kid') && rand() < 0.45 ? 'shorts' : 'pants';
  const height = age === 'kid' ? 1.12 + rand() * 0.24 : (sex === 'm' ? 1.68 + rand() * 0.22 : 1.56 + rand() * 0.18) - (age === 'elder' ? 0.05 : 0);
  const face = age === 'kid' ? 13 + Math.floor(rand() * 2) : age === 'elder' ? (sex === 'm' ? 7 : 12) : sex === 'm' ? pick(MALE_FACES) : pick(FEMALE_FACES);
  return {
    role: 'customer', kind, age, sex, seed, height,
    skin: pick(SKINS), hair,
    hairStyle: age === 'elder' && sex === 'm' && rand() < 0.4 ? 'balding' : sex === 'm' ? pick(M_HAIR) : pick(F_HAIR),
    hat, hatColor: kind === 'picky' ? '#f2c230' : pick(HAT_COLORS), glasses: age !== 'kid' && rand() < 0.16,
    outfit, legs, pants: legs === 'skirt' ? pick(SKIRTS) : pick(PANTS), shoes: pick(SHOES), face, basket: pick(BASKETS),
  };
}

export function staffSpec(role: 'cashier' | 'stocker' | 'janitor', rand: () => number, seed: number): PersonSpec {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  const sex: 'm' | 'f' = rand() < 0.5 ? 'm' : 'f';
  const u = UNIFORMS[role];
  return {
    role, age: 'adult', sex, seed, height: sex === 'm' ? 1.72 + rand() * 0.12 : 1.6 + rand() * 0.12,
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: sex === 'm' ? 'short' : 'ponytail',
    hat: role === 'cashier' ? null : 'cap', hatColor: u.base, glasses: false,
    outfit: u, legs: 'pants', pants: role === 'janitor' ? u.base : '#2b2f3a', shoes: '#222222',
    face: sex === 'm' ? pick(MALE_FACES) : pick(FEMALE_FACES), basket: BASKETS[0]!,
  };
}

/* ---------------- pessoa ---------------- */
const tmpM = new THREE.Matrix4();

/** Uma pessoa 3D animada (esqueleto procedural). */
export class Person {
  readonly root = new THREE.Group();
  readonly scale: number;
  readonly eyeHeight: number;
  readonly body: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  private readonly b: Record<BoneName, THREE.Bone>;
  private readonly basket = new THREE.Group();
  private readonly basketMesh: THREE.Mesh;
  private readonly items: THREE.InstancedMesh;
  private bagMesh: THREE.Mesh | null = null;
  private carry: THREE.Group | null = null;
  private carryOpen = false;
  private mop: THREE.Mesh | null = null;
  private readonly seed: number;
  private readonly elder: boolean;
  private readonly kid: boolean;
  pose: Pose = 'normal';
  /** Tempo corrido da ação atual (grab/scan/mop/place) em segundos. */
  actionT = 0;
  /** Mostra a "ação em curso" (mexendo) mesmo parado. */
  working = false;
  /** Altura do assento (m, mundo) para as poses sentadas. */
  seatY = 0.5;
  private reachOn = false;
  private rwx = 0; private rwy = 0; private rwz = 0;
  private phase = 0;
  private time = 0;
  private walkW = 0;
  private readonly hipBase: number;

  constructor(spec: PersonSpec) {
    const pr = props();
    this.seed = spec.seed * 1.37;
    this.kid = spec.age === 'kid';
    this.elder = spec.age === 'elder';
    this.scale = spec.height / 1.75;
    this.b = makeBones();
    this.hipBase = REST.hips[1];
    const mats4 = [
      outfitMaterial(spec.outfit),
      lambert(`low:${spec.pants}`, spec.pants),
      lambert(`skin:${spec.skin}`, spec.skin),
      lambert(`shoe:${spec.shoes}`, spec.shoes),
    ];
    this.body = new THREE.SkinnedMesh(bodyGeometry(spec.sex, spec.outfit.sleeves, spec.legs), mats4);
    this.root.add(this.b.root, this.body);
    this.skeleton = new THREE.Skeleton(Object.values(this.b), boneInverses());
    this.body.bind(this.skeleton, new THREE.Matrix4());
    this.body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.25);

    // cabeça + rosto + cabelo/chapéu/óculos
    const head = new THREE.Mesh(headGeometry(), [mats4[2]!, faceMaterial(spec.face, spec.hair)]);
    head.position.set(HEAD_OFFSET[0], HEAD_OFFSET[1], HEAD_OFFSET[2]);
    if (this.kid) head.scale.setScalar(1.2);
    this.b.head.add(head);
    const longHair = spec.hairStyle === 'long' || spec.hairStyle === 'ponytail' || spec.hairStyle === 'bob';
    const hg = spec.hat && !longHair ? null : hairGeometry(spec.hairStyle);
    if (hg) head.add(new THREE.Mesh(hg, lambert(`hair:${spec.hair}`, spec.hair, { side: THREE.DoubleSide })));
    if (spec.hat) head.add(new THREE.Mesh(hatGeometry(spec.hat), lambert(`hat:${spec.hatColor}`, spec.hatColor)));
    if (spec.glasses) head.add(new THREE.Mesh(glassesGeometry(), lambert('glasses', '#15171a')));

    // cesta na mão direita (itens num InstancedMesh)
    this.basketMesh = new THREE.Mesh(pr.basket, lambert(`basket:${spec.basket}`, spec.basket));
    this.items = new THREE.InstancedMesh(pr.item, pr.itemMat, MAX_BASKET_ITEMS);
    this.items.count = 0;
    this.items.frustumCulled = false;
    for (let i = 0; i < MAX_BASKET_ITEMS; i++) {
      const s = ITEM_SPOTS[i]!;
      tmpM.makeRotationY((i * 0.7) % 0.5).setPosition(s[0], -0.2, s[1]);
      this.items.setMatrixAt(i, tmpM);
    }
    this.basket.add(this.basketMesh, this.items);
    this.basket.position.set(0, -0.08, 0.01);
    if (spec.kind === 'bulk') this.basket.scale.setScalar(1.45);
    else if (this.kid) this.basket.scale.setScalar(0.8);
    this.basket.visible = false;
    this.b.handR.add(this.basket);

    const shadow = new THREE.Mesh(pr.shadow, pr.shadowMat);
    this.root.add(shadow);
    this.root.scale.setScalar(this.scale);
    this.eyeHeight = (REST.head[1] + HEAD_OFFSET[1] * (this.kid ? 1.2 : 1)) * this.scale;
  }

  setBasket(visible: boolean): void {
    this.basket.visible = visible;
    this.basketMesh.visible = true;
    this.items.visible = true;
    if (this.bagMesh) this.bagMesh.visible = false;
  }
  /** Mostra a sacola de compras no lugar da cesta (cliente saindo depois de pagar). */
  setBag(visible: boolean): void {
    if (visible && !this.bagMesh) { const pr = props(); this.bagMesh = new THREE.Mesh(pr.bag, pr.vcol); this.basket.add(this.bagMesh); }
    if (this.bagMesh) this.bagMesh.visible = visible;
    this.basketMesh.visible = !visible;
    this.items.visible = !visible;
    if (visible) this.basket.visible = true;
  }
  /** Itens visíveis na cesta (cor por produto). */
  setBasketItems(productIds: readonly string[]): void {
    const n = Math.min(MAX_BASKET_ITEMS, productIds.length);
    for (let i = 0; i < n; i++) this.items.setColorAt(i, productColor(productIds[i]!));
    this.items.count = n;
    if (this.items.instanceColor) this.items.instanceColor.needsUpdate = true;
  }
  /** Caixa de papelão nos braços (repositor). */
  setCarryBox(v: boolean): void {
    if (v && !this.carry) {
      const pr = props();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(pr.box, pr.cardboard));
      const lid = new THREE.Mesh(pr.lid, pr.vcol); lid.name = 'lid';
      const flaps = new THREE.Mesh(pr.flaps, pr.cardboard); flaps.name = 'flaps';
      const fill = new THREE.Mesh(pr.fill, pr.itemMat); fill.name = 'fill';
      g.add(lid, flaps, fill);
      g.position.set(0, -0.06, 0.3);
      this.b.chest.add(g);
      this.carry = g;
      this.setCarryOpen(false);
    }
    if (this.carry) this.carry.visible = v;
  }
  /** Abas abertas (com os produtos à vista) ou fechadas com fita. */
  setCarryOpen(open: boolean, productId?: string): void {
    this.carryOpen = open;
    const g = this.carry;
    if (!g) return;
    const lid = g.getObjectByName('lid'), flaps = g.getObjectByName('flaps'), fill = g.getObjectByName('fill') as THREE.Mesh | undefined;
    if (lid) lid.visible = !open;
    if (flaps) flaps.visible = open;
    if (fill) {
      fill.visible = open && productId !== undefined;
      if (productId) fill.material = lambert(`fill:${productId}`, `#${productColor(productId).getHexString()}`);
    }
  }
  get isCarryOpen(): boolean { return this.carryOpen; }
  setMop(v: boolean): void {
    if (v && !this.mop) {
      const pr = props();
      this.mop = new THREE.Mesh(pr.mop, pr.vcol);
      this.mop.position.set(-0.2, 0, 0.42);
      this.root.add(this.mop);
    }
    if (this.mop) this.mop.visible = v;
  }
  /** Alvo (mundo) da mão direita nas poses 'extend'/'place'. */
  setReach(x: number, y: number, z: number): void { this.reachOn = true; this.rwx = x; this.rwy = y; this.rwz = z; }
  clearReach(): void { this.reachOn = false; }

  private sr(b: THREE.Bone, x: number, y: number, z: number, k: number): void {
    b.rotation.x += (x - b.rotation.x) * k;
    b.rotation.y += (y - b.rotation.y) * k;
    b.rotation.z += (z - b.rotation.z) * k;
  }

  /** speed em m/s reais. Sem alocação. */
  animate(dt: number, speed: number, lookYaw = 0): void {
    this.time += dt;
    this.actionT += dt;
    const B = this.b;
    const pose = this.pose;
    const sitting = pose === 'sit' || pose === 'sitScan';
    const wTarget = sitting ? 0 : clamp(speed / 1.2, 0, 1);
    this.walkW += (wTarget - this.walkW) * Math.min(1, dt * 8);
    const W = this.walkW;
    this.phase += dt * speed * (this.kid ? 6.2 : 4.6) / this.scale;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const t = this.time + this.seed;
    const k = 1 - Math.exp(-dt * 18);
    const idle = 1 - W;
    // pernas
    const A = 0.55 * W;
    let thL = -s * A, thR = s * A;
    let shL = 0.05 + Math.max(0, c) * 1.0 * W, shR = 0.05 + Math.max(0, -c) * 1.0 * W;
    let ftL = -(thL + shL) * 0.55, ftR = -(thR + shR) * 0.55;
    let hipY = this.hipBase - 0.022 * W + 0.026 * W * Math.abs(c);
    // tronco
    let spX = this.elder ? 0.1 : 0.02, spY = s * 0.07 * W, chX = Math.sin(t * 1.6) * 0.014 * idle, chY = -s * 0.09 * W;
    let hipZ = c * 0.03 * W + Math.sin(t * 0.4) * 0.02 * idle;
    // braços (balanço oposto às pernas)
    let uLx = s * 0.42 * W, uLz = 0.07, fLx = -0.12 - 0.25 * W;
    let uRx = -s * 0.42 * W, uRz = -0.07, fRx = -0.12 - 0.25 * W;
    let uRy = 0, hRx = 0;
    let headY = lookYaw + Math.sin(t * 0.5) * 0.3 * idle * (this.kid ? 1.4 : 1), headX = 0;
    switch (pose) {
      case 'basket':
        uRx = -0.06 - s * 0.12 * W; uRz = -0.2; fRx = -0.3;
        break;
      case 'carry':
        uLx = uRx = -0.85; uLz = -0.12; uRz = 0.12; fLx = fRx = -0.9;
        if (this.working) { const w = Math.sin(this.actionT * 6) * 0.12; uRx += w; uLx -= w; spX += 0.12; }
        break;
      case 'mop': {
        const sw = this.working ? Math.sin(this.actionT * 4.6) : 0;
        uRx = -0.5 + sw * 0.08; uRz = -0.05 + sw * 0.18; fRx = -0.65;
        uLx = -1.0; uLz = 0.42 + sw * 0.12; fLx = -0.75;
        spY += sw * 0.14; spX += 0.1;
        if (this.mop) {
          this.mop.rotation.x = -0.52;
          this.mop.rotation.y += ((sw * 0.5) - this.mop.rotation.y) * k;
          this.mop.position.x = -0.2 + sw * 0.1;
        }
        break;
      }
      case 'grab':
        uRx = -1.35 + Math.sin(this.actionT * 9) * 0.22; uRz = -0.12; fRx = -0.25;
        break;
      case 'scan':
        uRx = -0.9 + Math.sin(this.actionT * 7) * 0.3; fRx = -0.6; uLx = -0.5; fLx = -0.8;
        break;
      case 'sit':
      case 'sitScan':
        hipY = (this.seatY + 0.075) / this.scale + 0.02;
        thL = thR = -1.5; shL = shR = 1.5; ftL = ftR = 0;
        spX = 0.06; uLx = uRx = -0.5; uLz = 0.1; uRz = -0.1; fLx = fRx = -0.85;
        if (pose === 'sitScan') {
          const a = Math.sin(this.actionT * 6.5);
          uRx = -0.8 + a * 0.18; uRz = -0.2 + a * 0.22; fRx = -0.7; spY = a * 0.08; headY = a * 0.15;
        }
        break;
      default:
        break;
    }
    // IK simples de 2 ossos do braço direito até o alvo (pagar / pôr na esteira)
    if (this.reachOn && (pose === 'extend' || pose === 'place')) {
      const g = this.root.parent;
      if (g) {
        const h = g.rotation.y, ch = Math.cos(h), shh = Math.sin(h);
        const wx = this.rwx - g.position.x, wz = this.rwz - g.position.z;
        const lx = (wx * ch - wz * shh) / this.scale, lz = (wx * shh + wz * ch) / this.scale, ly = this.rwy / this.scale;
        if (pose === 'place') spX += 0.22;
        const dx = lx - REST.uArmR[0], dy = ly - (REST.uArmR[1] - (pose === 'place' ? 0.05 : 0)), dz = lz - REST.uArmR[2] - (pose === 'place' ? 0.08 : 0);
        const d = Math.max(0.12, Math.sqrt(dx * dx + dy * dy + dz * dz));
        const a = UPPER_ARM, bL = FORE_ARM, cc = Math.min(a + bL - 0.002, d);
        const alpha = Math.acos(clamp((a * a + cc * cc - bL * bL) / (2 * a * cc), -1, 1));
        const gamma = Math.acos(clamp((a * a + bL * bL - cc * cc) / (2 * a * bL), -1, 1));
        uRx = Math.atan2(-dz, -dy) + alpha; uRz = Math.asin(clamp(dx / d, -1, 1)); fRx = -(Math.PI - gamma); uRy = 0;
        if (pose === 'place') { const o = Math.sin(this.actionT * 7) * 0.12; uRx += o; }
        hRx = -0.3;
        headX = 0.12;
      }
    }
    // aplica (suavizado)
    this.sr(B.thighL, thL, 0, 0, k); this.sr(B.thighR, thR, 0, 0, k);
    this.sr(B.shinL, shL, 0, 0, k); this.sr(B.shinR, shR, 0, 0, k);
    this.sr(B.footL, ftL, 0, 0, k); this.sr(B.footR, ftR, 0, 0, k);
    this.sr(B.hips, 0, s * 0.08 * W, hipZ, k);
    B.hips.position.y += (hipY - B.hips.position.y) * k;
    this.sr(B.spine, spX, spY, 0, k); this.sr(B.chest, chX, chY, 0, k);
    this.sr(B.uArmL, uLx, 0, uLz, k); this.sr(B.fArmL, fLx, 0, 0, k);
    this.sr(B.uArmR, uRx, uRy, uRz, k); this.sr(B.fArmR, fRx, 0, 0, k);
    this.sr(B.handR, hRx, 0, 0, k);
    this.sr(B.head, headX, headY - chY - spY, 0, k);
    // cesta sempre "pendurada" na vertical
    if (this.basket.visible) {
      this.basket.rotation.x = -(B.uArmR.rotation.x + B.fArmR.rotation.x + B.handR.rotation.x + B.spine.rotation.x);
      this.basket.rotation.z = -B.uArmR.rotation.z;
    }
  }

  dispose(): void {
    this.skeleton.dispose();
    this.items.dispose();
  }
}
