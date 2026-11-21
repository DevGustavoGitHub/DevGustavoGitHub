import * as THREE from 'three';

export interface AvatarColors { skin: string; shirt: string; apron: string; cap: string; pants: string }
export const DEFAULT_COLORS: AvatarColors = {
  skin: '#f0c29c', shirt: '#3b82c4', apron: '#e8e4da', cap: '#d93a3a', pants: '#3a3f55',
};

/** Avatar humanoide low-poly procedural. Frente do modelo = +Z local. */
export class Avatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly mats: Record<keyof AvatarColors | 'shoe' | 'eye', THREE.MeshLambertMaterial>;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly blob: THREE.Mesh;
  private blobTex: THREE.CanvasTexture;
  private phase = 0;
  private idleT = 0;
  private carry = 0; // 0..1 suavizado
  private move = 0; // 0..1 suavizado (intensidade da caminhada)

  constructor(colors: Partial<AvatarColors> = {}) {
    const c = { ...DEFAULT_COLORS, ...colors };
    const m = (hex: string) => new THREE.MeshLambertMaterial({ color: hex });
    this.mats = {
      skin: m(c.skin), shirt: m(c.shirt), apron: m(c.apron), cap: m(c.cap), pants: m(c.pants),
      shoe: m('#2a2a2e'), eye: m('#1c1c22'),
    };
    const box = (w: number, h: number, d: number): THREE.BoxGeometry => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.geos.push(g);
      return g;
    };
    const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const o = new THREE.Mesh(g, mat);
      o.position.set(x, y, z);
      o.castShadow = true;
      return o;
    };

    this.root.add(this.body);
    // Pernas (pivô no quadril, y=0.78)
    const legG = box(0.17, 0.78, 0.2);
    const shoeG = box(0.19, 0.1, 0.3);
    for (const [leg, x] of [[this.legL, -0.12], [this.legR, 0.12]] as const) {
      leg.position.set(x, 0.78, 0);
      leg.add(mesh(legG, this.mats.pants, 0, -0.39, 0));
      leg.add(mesh(shoeG, this.mats.shoe, 0, -0.74, 0.05));
      this.body.add(leg);
    }
    // Tronco
    this.torso = mesh(box(0.5, 0.56, 0.28), this.mats.shirt, 0, 1.06, 0);
    this.body.add(this.torso);
    // Avental (frente) + tira
    this.body.add(mesh(box(0.4, 0.5, 0.04), this.mats.apron, 0, 0.98, 0.16));
    this.body.add(mesh(box(0.52, 0.05, 0.3), this.mats.apron, 0, 1.18, 0));
    // Braços (pivô no ombro, y=1.28)
    const armG = box(0.13, 0.5, 0.14);
    const handG = box(0.12, 0.12, 0.12);
    for (const [arm, x] of [[this.armL, -0.32], [this.armR, 0.32]] as const) {
      arm.position.set(x, 1.3, 0);
      arm.add(mesh(armG, this.mats.shirt, 0, -0.22, 0));
      arm.add(mesh(handG, this.mats.skin, 0, -0.5, 0));
      this.body.add(arm);
    }
    // Cabeça
    this.head.position.set(0, 1.62, 0);
    this.body.add(this.head);
    const headG = box(0.34, 0.34, 0.34);
    this.head.add(mesh(headG, this.mats.skin, 0, 0, 0));
    const eyeG = box(0.05, 0.06, 0.02);
    this.head.add(mesh(eyeG, this.mats.eye, -0.08, 0.02, 0.17), mesh(eyeG, this.mats.eye, 0.08, 0.02, 0.17));
    // Boné
    this.head.add(mesh(box(0.38, 0.12, 0.38), this.mats.cap, 0, 0.19, 0));
    this.head.add(mesh(box(0.3, 0.04, 0.2), this.mats.cap, 0, 0.14, 0.26));
    // Sombra de blob
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.blobTex = new THREE.CanvasTexture(cv);
    const pg = new THREE.PlaneGeometry(1.1, 1.1);
    this.geos.push(pg);
    this.blob = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.02;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
  }

  setColors(c: Partial<AvatarColors>): void {
    for (const k of Object.keys(c) as (keyof AvatarColors)[]) {
      const v = c[k];
      if (v) this.mats[k].color.set(v);
    }
  }

  /** Ponto (local) onde a caixa carregada deve ficar. */
  readonly carryAnchor = new THREE.Group();
  attachCarry(obj: THREE.Object3D | null): void {
    if (!this.carryAnchor.parent) {
      this.carryAnchor.position.set(0, 1.0, 0.42);
      this.body.add(this.carryAnchor);
    }
    this.carryAnchor.clear();
    if (obj) this.carryAnchor.add(obj);
  }

  /** speed em m/s (0 = parado), carrying = mãos ocupadas. */
  animate(dt: number, speed: number, carrying: boolean): void {
    const k = 1 - Math.exp(-dt * 12);
    this.carry += ((carrying ? 1 : 0) - this.carry) * k;
    const mv = Math.min(1, speed / 3.5);
    this.move += (mv - this.move) * k;
    this.phase += dt * (3 + speed * 2.2);
    this.idleT += dt;
    const s = Math.sin(this.phase);
    const swing = 0.85 * this.move;
    this.legL.rotation.x = s * swing;
    this.legR.rotation.x = -s * swing;
    // braços: balançam ao andar; com caixa vão à frente
    const armSwing = 0.7 * this.move * (1 - this.carry);
    const idle = Math.sin(this.idleT * 1.8) * 0.04 * (1 - this.move);
    const raise = -1.35 * this.carry;
    this.armL.rotation.x = -s * armSwing + idle + raise;
    this.armR.rotation.x = s * armSwing - idle + raise;
    this.armL.rotation.z = 0.08 + 0.12 * this.carry * -1;
    this.armR.rotation.z = -0.08 + 0.12 * this.carry;
    // bob + respiração
    this.body.position.y = Math.abs(s) * 0.05 * this.move;
    this.torso.scale.y = 1 + Math.sin(this.idleT * 2.2) * 0.015 * (1 - this.move);
    this.body.rotation.x = 0.06 * this.move - 0.04 * this.carry;
    this.head.rotation.y = Math.sin(this.idleT * 0.7) * 0.15 * (1 - this.move);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const k of Object.keys(this.mats) as (keyof typeof this.mats)[]) this.mats[k].dispose();
    (this.blob.material as THREE.Material).dispose();
    this.blobTex.dispose();
  }
}

/** Cache de caixas carregadas (mesh com etiqueta por produto). */
export class CarryBoxFactory {
  private geo = new THREE.BoxGeometry(0.52, 0.34, 0.42);
  private side = new THREE.MeshLambertMaterial({ color: '#c9975b' });
  private tex = new Map<string, THREE.CanvasTexture>();
  private labelMats = new Map<string, THREE.MeshLambertMaterial>();
  private mesh: THREE.Mesh | null = null;
  private cur = '';

  private label(productId: string, text: string): THREE.MeshLambertMaterial {
    let m = this.labelMats.get(productId);
    if (m) return m;
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 96;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#c9975b';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#f6f1e6';
    g.fillRect(14, 18, 100, 60);
    g.fillStyle = '#d93a3a';
    g.fillRect(14, 18, 100, 12);
    g.fillStyle = '#222';
    g.font = 'bold 15px system-ui,sans-serif';
    g.textAlign = 'center';
    const words = text.split(' ');
    g.fillText(words[0] ?? '', 64, 54, 92);
    if (words[1]) g.fillText(words[1], 64, 72, 92);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    this.tex.set(productId, t);
    m = new THREE.MeshLambertMaterial({ map: t });
    this.labelMats.set(productId, m);
    return m;
  }

  /** Retorna a malha (única, reaproveitada) configurada para o produto, ou null. */
  get(productId: string | null, name = ''): THREE.Mesh | null {
    if (!productId) return null;
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(this.geo, [this.side, this.side, this.side, this.side, this.side, this.side]);
      this.mesh.castShadow = true;
    }
    if (this.cur !== productId) {
      const l = this.label(productId, name || productId);
      const mats = this.mesh.material as THREE.Material[];
      mats[4] = l; // +z
      mats[5] = l; // -z
      this.cur = productId;
    }
    return this.mesh;
  }

  dispose(): void {
    this.geo.dispose();
    this.side.dispose();
    this.tex.forEach((t) => t.dispose());
    this.labelMats.forEach((m) => m.dispose());
  }
}
