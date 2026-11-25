/**
 * Pote de gorjeta no balcão (melhoria 'tipjar'): vidro translúcido + etiqueta + moedas (InstancedMesh) cujo
 * nível acompanha as gorjetas do dia, e um "+R$ X" verde (pool de sprites com canvas próprio) que sobe e some.
 */
import * as THREE from 'three';
import { canvasTex, makeCanvas } from './kit';
import { money } from '../ui/dom';

export const JAR = { x: 0.2, y: 0.92, z: -0.16 };
const R = 0.075, H = 0.17, MAX_COINS = 36, POP_N = 4, POP_T = 1.2;

type Jar = { group: THREE.Group; coins: THREE.InstancedMesh; sum: number; shown: number };
type Pop = { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; tex: THREE.CanvasTexture; c: HTMLCanvasElement; g: CanvasRenderingContext2D; t: number; jar: THREE.Group | null };

export class TipJars {
  private jars = new Map<number, Jar>();
  private pops: Pop[] = [];
  private glassGeo = new THREE.CylinderGeometry(R, R * 0.92, H, 16, 1, true);
  private baseGeo = new THREE.CylinderGeometry(R * 0.92, R * 0.92, 0.008, 16);
  private lidGeo = new THREE.CylinderGeometry(R * 1.04, R * 1.04, 0.02, 16);
  private coinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.006, 10);
  private labelGeo = new THREE.PlaneGeometry(0.1, 0.05);
  private glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe9f2, transparent: true, opacity: 0.28, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  private lidMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.6 });
  private coinMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.35, metalness: 0.6 });
  private labelTex: THREE.CanvasTexture;
  private labelMat: THREE.MeshBasicMaterial;
  private mtx = new THREE.Matrix4();
  private enabled = false;

  constructor() {
    const { c, g } = makeCanvas(128, 64);
    g.fillStyle = '#fff6d6'; g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#e63946'; g.lineWidth = 5; g.strokeRect(3, 3, 122, 58);
    g.fillStyle = '#c1121f'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('GORJETA', 64, 33);
    this.labelTex = canvasTex(c); this.labelMat = new THREE.MeshBasicMaterial({ map: this.labelTex });
    for (let i = 0; i < POP_N; i++) {
      const p = makeCanvas(160, 48);
      const tex = canvasTex(p.c); tex.anisotropy = 1;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.3, 0.09, 1); sprite.visible = false; sprite.renderOrder = 5;
      this.pops.push({ sprite, mat, tex, c: p.c, g: p.g, t: POP_T, jar: null });
    }
  }

  private build(parent: THREE.Object3D): Jar {
    const group = new THREE.Group(); group.name = 'tipjar';
    group.position.set(JAR.x, JAR.y, JAR.z);
    const base = new THREE.Mesh(this.baseGeo, this.glassMat); base.position.y = 0.004;
    const glass = new THREE.Mesh(this.glassGeo, this.glassMat); glass.position.y = H / 2; glass.renderOrder = 3;
    const lid = new THREE.Mesh(this.lidGeo, this.lidMat); lid.position.y = H + 0.01;
    const label = new THREE.Mesh(this.labelGeo, this.labelMat);
    // vira para o assento (ry do monitor aproximado: olha para -z local)
    label.position.set(0.5 > JAR.x ? 0.01 : 0, H / 2, -R - 0.002); label.rotation.y = Math.PI;
    const coins = new THREE.InstancedMesh(this.coinGeo, this.coinMat, MAX_COINS);
    coins.count = 0; coins.frustumCulled = false;
    group.add(base, glass, lid, label, coins);
    parent.add(group);
    return { group, coins, sum: 0, shown: -1 };
  }

  private fill(j: Jar): void {
    const n = Math.min(MAX_COINS, Math.ceil(j.sum / 10));
    if (n === j.shown) return;
    j.shown = n; j.coins.count = n;
    const per = 9, q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / per), k = i % per, a = k * 2.4 + layer * 0.9;
      const r = k === 0 ? 0 : 0.032 + 0.012 * ((k * 7 + layer) % 3) * 0.5;
      p.set(Math.cos(a) * r, 0.012 + layer * 0.011, Math.sin(a) * r);
      e.set(((k * 5 + layer * 3) % 7 - 3) * 0.06, a, ((k * 3 + layer) % 5 - 2) * 0.06);
      q.setFromEuler(e);
      j.coins.setMatrixAt(i, this.mtx.compose(p, q, s));
    }
    j.coins.instanceMatrix.needsUpdate = true;
  }

  /** Cria/remove potes conforme a melhoria e os balcões existentes. `groups`: id do balcão → grupo do móvel. */
  sync(owned: boolean, groups: Map<number, THREE.Object3D>): void {
    this.enabled = owned;
    for (const [id, j] of this.jars) {
      const g = groups.get(id);
      if (!owned || !g) { j.group.parent?.remove(j.group); j.coins.dispose(); this.jars.delete(id); continue; }
      if (j.group.parent !== g) g.add(j.group);
    }
    if (!owned) return;
    for (const [id, g] of groups) if (!this.jars.has(id)) this.fill(this.jars.set(id, this.build(g)).get(id)!);
  }

  resetDay(): void { for (const j of this.jars.values()) { j.sum = 0; this.fill(j); } }

  tip(counterId: number | undefined, cents: number): void {
    if (!this.enabled || !(cents > 0)) return;
    const j = (counterId !== undefined ? this.jars.get(counterId) : undefined) ?? this.jars.values().next().value as Jar | undefined;
    if (!j) return;
    j.sum += cents; this.fill(j);
    const p = this.pops.find((q) => q.t >= POP_T) ?? this.pops.reduce((a, b) => (a.t > b.t ? a : b));
    p.g.clearRect(0, 0, 160, 48);
    p.g.font = 'bold 30px sans-serif'; p.g.textAlign = 'center'; p.g.textBaseline = 'middle';
    p.g.lineWidth = 6; p.g.strokeStyle = 'rgba(0,40,10,0.85)'; p.g.strokeText(money(cents, { sign: true }), 80, 25);
    p.g.fillStyle = '#4cff7a'; p.g.fillText(money(cents, { sign: true }), 80, 25);
    p.tex.needsUpdate = true;
    j.group.add(p.sprite); p.jar = j.group; p.t = 0; p.sprite.visible = true;
    p.sprite.position.set(0, H + 0.12, 0); p.mat.opacity = 1;
  }

  update(dt: number): void {
    for (const p of this.pops) {
      if (!p.sprite.visible) continue;
      p.t += dt;
      if (p.t >= POP_T) { p.sprite.visible = false; p.jar?.remove(p.sprite); p.jar = null; continue; }
      const k = p.t / POP_T;
      p.sprite.position.y = H + 0.12 + k * 0.22;
      p.mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }

  dispose(): void {
    this.sync(false, new Map());
    for (const p of this.pops) { p.sprite.parent?.remove(p.sprite); p.tex.dispose(); p.mat.dispose(); }
    for (const o of [this.glassGeo, this.baseGeo, this.lidGeo, this.coinGeo, this.labelGeo, this.glassMat, this.lidMat, this.coinMat, this.labelTex, this.labelMat]) o.dispose();
  }
}
