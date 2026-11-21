/**
 * Casca da loja (piso, paredes com recorte, fachada com letreiro, porta de vidro, sala de estoque)
 * e o ambiente externo (céu, rua, calçada, prédios, árvores, postes, carros, nuvens, luz do dia).
 */
import * as THREE from 'three';
import { CLOSE_MIN, OPEN_MIN, type Decor } from '../sim/state';
import { DOOR_WIDTH, SIDEWALK_DEPTH, STORAGE_DEPTH, WALL_HEIGHT, deliveryZone, trashBinPos, type Bounds } from '../core/layout';
import { Tracker, bx, boxGeo, cylGeo, coneGeo, icoGeo, sphGeo, put, stdMat, scaleUV, makeCanvas, canvasTex, hex, hash01 } from './kit';

/* ---------------- texturas compartilhadas (vivem até o fim) ---------------- */
let floorTexture: THREE.CanvasTexture | null = null;
function floorTex(): THREE.CanvasTexture {
  if (floorTexture) return floorTexture;
  const { c, g } = makeCanvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ececec'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#cfcfcf'; g.lineWidth = 3; g.strokeRect(1, 1, 126, 126);
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  floorTexture = canvasTex(c, true);
  return floorTexture;
}
let paverTexture: THREE.CanvasTexture | null = null;
function paverTex(): THREE.CanvasTexture {
  if (paverTexture) return paverTexture;
  const { c, g } = makeCanvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f0f0f0'; g.fillRect(2, 2, 60, 60); g.fillRect(66, 66, 60, 60);
  g.fillStyle = '#e4e4e4'; g.fillRect(66, 2, 60, 60); g.fillRect(2, 66, 60, 60);
  paverTexture = canvasTex(c, true);
  return paverTexture;
}
let asphaltTexture: THREE.CanvasTexture | null = null;
function asphaltTex(): THREE.CanvasTexture {
  if (asphaltTexture) return asphaltTexture;
  const { c, g } = makeCanvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 420; i++) {
    const v = 200 + Math.floor(hash01(i, 7) * 55) - 28;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(hash01(i, 1) * 128, hash01(i, 2) * 128, 1 + hash01(i, 3) * 2, 1 + hash01(i, 4) * 2);
  }
  asphaltTexture = canvasTex(c, true);
  return asphaltTexture;
}
let winTexture: THREE.CanvasTexture | null = null, winGlowTexture: THREE.CanvasTexture | null = null;
function winTex(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  if (winTexture && winGlowTexture) return { map: winTexture, glow: winGlowTexture };
  const a = makeCanvas(128, 128), b = makeCanvas(128, 128);
  a.g.fillStyle = '#ffffff'; a.g.fillRect(0, 0, 128, 128);
  a.g.fillStyle = '#d6d6d6'; a.g.fillRect(0, 118, 128, 10);
  a.g.fillStyle = '#6d8394'; a.g.fillRect(26, 30, 76, 78);
  a.g.fillStyle = '#a5cfe8'; a.g.fillRect(30, 34, 68, 70);
  a.g.fillStyle = '#6d8394'; a.g.fillRect(62, 34, 4, 70); a.g.fillRect(30, 68, 68, 4);
  a.g.fillStyle = 'rgba(255,255,255,0.35)'; a.g.fillRect(32, 36, 14, 30);
  b.g.fillStyle = '#000'; b.g.fillRect(0, 0, 128, 128);
  for (const [x, y] of [[30, 34], [66, 34], [30, 72], [66, 72]] as const) {
    b.g.fillStyle = hash01(x, y) > 0.2 ? '#ffd27a' : '#000'; b.g.fillRect(x, y, 32, 32);
  }
  winTexture = canvasTex(a.c, true); winGlowTexture = canvasTex(b.c, true);
  return { map: winTexture, glow: winGlowTexture };
}

const nightMats: THREE.MeshStandardMaterial[] = [];
const bldMats = new Map<number, THREE.MeshStandardMaterial>();
function bldMat(color: number): THREE.MeshStandardMaterial {
  let m = bldMats.get(color);
  if (!m) {
    const t = winTex();
    m = new THREE.MeshStandardMaterial({ color, map: t.map, roughness: 0.9, emissive: 0xffc866, emissiveMap: t.glow, emissiveIntensity: 0 });
    bldMats.set(color, m); nightMats.push(m);
  }
  return m;
}
function bldGeo(tr: Tracker, w: number, h: number, d: number): THREE.BufferGeometry {
  const g = tr.geo(new THREE.BoxGeometry(w, h, d));
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const spans: [number, number][] = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f]!;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (su === 0) uv.setXY(k, 0.02, 0.02);
      else uv.setXY(k, uv.getX(k) * (Math.max(1, Math.round(su / 3))), uv.getY(k) * Math.max(1, Math.round(sv / 3)));
    }
  }
  return g;
}

/* ---------------- animação por teclas de cor (céu / luz) ---------------- */
type Key = [number, number];
const lerpKeys = (keys: Key[], t: number, out: THREE.Color, tmp: THREE.Color): void => {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const k = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0] || 1)));
  out.setHex(a[1]); tmp.setHex(b[1]); out.lerp(tmp, k);
};
const SKY_TOP: Key[] = [[0, 0x6cb4ec], [0.35, 0x3f9bea], [0.7, 0x4f8fd8], [0.88, 0x5b62b0], [1, 0x2c2f66]];
const SKY_HOR: Key[] = [[0, 0xfde7c4], [0.35, 0xd5ecff], [0.7, 0xe8e0d0], [0.88, 0xffb98a], [1, 0xa86a7a]];
const SUN_COL: Key[] = [[0, 0xffd7a0], [0.3, 0xfff4e0], [0.7, 0xffe0b0], [0.9, 0xff9d62], [1, 0xff7a4a]];
const HEM_SKY: Key[] = [[0, 0xcfe4ff], [0.5, 0xcfe4ff], [0.9, 0xa9a4d8], [1, 0x7a78b8]];

/* ---------------- Casca da loja ---------------- */
export interface WallFace {
  mats: THREE.MeshStandardMaterial[];
  nx: number; nz: number; cx: number; cz: number;
  fade: number; never: boolean;
}

export class Shop {
  readonly group = new THREE.Group();
  readonly faces: WallFace[] = [];
  private tr = new Tracker();
  private soft: { mat: THREE.MeshStandardMaterial }[] = [];
  private floorMat: THREE.MeshStandardMaterial | null = null;
  private signMat: THREE.MeshStandardMaterial | null = null;
  private signCanvas: HTMLCanvasElement | null = null;
  private innerMats: THREE.MeshStandardMaterial[] = [];
  private doorL: THREE.Object3D | null = null;
  private doorR: THREE.Object3D | null = null;
  private doorBaseL = 0; private doorBaseR = 0;
  private doorOpen = 0;
  private b: Bounds = { width: 12, depth: 10 };
  forceFade = false;

  rebuild(b: Bounds, storage: boolean, decor: Decor, name: string): void {
    this.clear();
    this.b = b;
    const { width: W, depth: D } = b;
    const tr = this.tr;
    const g = this.group;
    // pisos
    const floorG = tr.geo(new THREE.PlaneGeometry(W, D)); floorG.rotateX(-Math.PI / 2); scaleUV(floorG, W / 2, D / 2);
    this.floorMat = tr.mat(new THREE.MeshStandardMaterial({ color: hex(decor.floorColor), map: floorTex(), roughness: 0.55 }));
    const floor = new THREE.Mesh(floorG, this.floorMat); floor.position.set(W / 2, 0.01, D / 2); floor.receiveShadow = true; g.add(floor);
    if (storage) {
      const sg = tr.geo(new THREE.PlaneGeometry(W, STORAGE_DEPTH)); sg.rotateX(-Math.PI / 2); scaleUV(sg, W / 2, STORAGE_DEPTH / 2);
      const sm = tr.mat(new THREE.MeshStandardMaterial({ color: 0x9aa1a8, map: floorTex(), roughness: 0.8 }));
      const sf = new THREE.Mesh(sg, sm); sf.position.set(W / 2, 0.01, -STORAGE_DEPTH / 2); sf.receiveShadow = true; g.add(sf);
      // faixa de corredor amarela
      const lane = tr.mat(new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7 }));
      for (const z of [-0.12]) {
        const l = new THREE.Mesh(tr.geo(new THREE.PlaneGeometry(W - 0.4, 0.12).rotateX(-Math.PI / 2)), lane); l.position.set(W / 2, 0.02, z); g.add(l);
      }
    }
    // paredes
    const zBack = storage ? -STORAGE_DEPTH : 0;
    const wallH = WALL_HEIGHT;
    const mkFace = (nx: number, nz: number, cx: number, cz: number, never = false): WallFace => {
      const inner = tr.mat(new THREE.MeshStandardMaterial({ color: hex(decor.wallColor), roughness: 0.9 }));
      const outer = tr.mat(new THREE.MeshStandardMaterial({ color: 0xe6d3b3, roughness: 0.9 }));
      const cap = tr.mat(new THREE.MeshStandardMaterial({ color: 0x4a4f5a, roughness: 0.8 }));
      this.innerMats.push(inner);
      const f: WallFace = { mats: [inner, outer, cap], nx, nz, cx, cz, fade: 1, never };
      this.faces.push(f);
      return f;
    };
    const piece = (f: WallFace, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, inIdx: number, outIdx: number): void => {
      const geo = tr.geo(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
      const arr: THREE.Material[] = [f.mats[2]!, f.mats[2]!, f.mats[2]!, f.mats[2]!, f.mats[2]!, f.mats[2]!];
      arr[inIdx] = f.mats[0]!; arr[outIdx] = f.mats[1]!;
      const m = new THREE.Mesh(geo, arr);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.receiveShadow = true; m.castShadow = false;
      g.add(m);
    };
    const t = 0.2;
    const left = mkFace(-1, 0, 0, (zBack + D) / 2);
    piece(left, -t, 0, 0, wallH, zBack - t, D + t, 0, 1);
    const right = mkFace(1, 0, W, (zBack + D) / 2);
    piece(right, W, W + t, 0, wallH, zBack - t, D + t, 1, 0);
    if (!storage) {
      const back = mkFace(0, -1, W / 2, 0);
      piece(back, -t, W + t, 0, wallH, -t, 0, 4, 5);
    } else {
      const back = mkFace(0, -1, W / 2, zBack);
      piece(back, -t, W + t, 0, wallH, zBack - t, zBack, 4, 5);
      const div = mkFace(0, 0, W / 2, 0, true);
      const gx0 = W / 2 - DOOR_WIDTH / 2, gx1 = W / 2 + DOOR_WIDTH / 2;
      piece(div, -t, gx0, 0, wallH, -t, 0, 4, 5);
      piece(div, gx1, W + t, 0, wallH, -t, 0, 4, 5);
      piece(div, gx0, gx1, 2.5, wallH, -t, 0, 4, 5);
    }
    this.buildFront(mkFace(0, 1, W / 2, D), W, D, piece, decor, name);
    // rodapé interno
    const skirt = stdMat(0x59606c, { rough: 0.8 });
    bx(g, 0.04, 0.14, D, skirt, 0.02, 0.01, D / 2, { cast: false });
    bx(g, 0.04, 0.14, D, skirt, W - 0.02, 0.01, D / 2, { cast: false });
    bx(g, W, 0.14, 0.04, skirt, W / 2, 0.01, 0.02, { cast: false });
    // tapetes da porta
    const mat = stdMat(0x7a2e2e, { rough: 1 });
    bx(g, 1.8, 0.02, 0.9, mat, W / 2, 0.01, D - 0.6, { cast: false });
    bx(g, 1.8, 0.02, 0.9, stdMat(0x3b3f47, { rough: 1 }), W / 2, 0.02, D + 0.7, { cast: false });
    this.setDecor(decor, name);
  }

  private buildFront(face: WallFace, W: number, D: number,
    piece: (f: WallFace, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, i: number, o: number) => void,
    decor: Decor, name: string): void {
    const tr = this.tr, g = this.group;
    const t = 0.2;
    const gx0 = W / 2 - DOOR_WIDTH / 2, gx1 = W / 2 + DOOR_WIDTH / 2;
    const z0 = D, z1 = D + t;
    // faixa baixa, faixa alta (cobre a porta) e platibanda
    piece(face, -t, gx0, 0, 0.9, z0, z1, 5, 4);
    piece(face, gx1, W + t, 0, 0.9, z0, z1, 5, 4);
    piece(face, -t, W + t, 2.5, WALL_HEIGHT, z0, z1, 5, 4);
    piece(face, -t, W + t, WALL_HEIGHT, WALL_HEIGHT + 1.15, z0, z1, 5, 4);
    // montantes e janelas de cada lado
    const glass = stdMat(0xbfe3f5, { opacity: 0.22, rough: 0.05, metal: 0.1 });
    const side = (s: number, e: number, padL: number, padR: number): void => {
      piece(face, s, s + padL, 0.9, 2.5, z0, z1, 5, 4);
      piece(face, e - padR, e, 0.9, 2.5, z0, z1, 5, 4);
      const inner0 = s + padL, inner1 = e - padR;
      const n = Math.max(1, Math.round((inner1 - inner0) / 3.4));
      const pw = 0.3, ww = (inner1 - inner0 - (n - 1) * pw) / n;
      for (let i = 0; i < n; i++) {
        const x0 = inner0 + i * (ww + pw);
        const gm = new THREE.Mesh(tr.geo(new THREE.BoxGeometry(ww, 1.6, 0.04)), glass);
        gm.position.set(x0 + ww / 2, 1.7, D + t / 2); g.add(gm);
        if (i < n - 1) piece(face, x0 + ww, x0 + ww + pw, 0.9, 2.5, z0, z1, 5, 4);
      }
    };
    side(-t, gx0, 0.6, 0.45);
    side(gx1, W + t, 0.45, 0.6);
    // porta de vidro deslizante
    const frame = stdMat(0x8f99a6, { rough: 0.35, metal: 0.6 });
    const mkDoor = (cx: number): THREE.Group => {
      const dg = new THREE.Group();
      put(dg, tr.geo(new THREE.BoxGeometry(0.96, 2.3, 0.03)), glass, 0, 1.15, 0, { cast: false });
      bx(dg, 0.96, 0.06, 0.06, frame, 0, 0, 0); bx(dg, 0.96, 0.06, 0.06, frame, 0, 2.28, 0);
      bx(dg, 0.05, 2.3, 0.06, frame, -0.455, 0, 0); bx(dg, 0.05, 2.3, 0.06, frame, 0.455, 0, 0);
      bx(dg, 0.03, 0.5, 0.05, frame, cx < W / 2 ? 0.4 : -0.4, 0.9, 0.04);
      dg.position.set(cx, 0, D + t + 0.03);
      g.add(dg);
      return dg;
    };
    this.doorBaseL = W / 2 - 0.49; this.doorBaseR = W / 2 + 0.49;
    this.doorL = mkDoor(this.doorBaseL); this.doorR = mkDoor(this.doorBaseR);
    bx(g, DOOR_WIDTH, 0.1, 0.1, frame, W / 2, 2.4, D + t + 0.03);
    // letreiro
    const sw = Math.min(W - 1.6, 8.5), sh = 0.95;
    this.signCanvas = document.createElement('canvas'); this.signCanvas.width = 1024; this.signCanvas.height = Math.round(1024 * sh / sw);
    const tex = tr.tex(canvasTex(this.signCanvas));
    this.signMat = tr.mat(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 }));
    const dark = tr.mat(new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.6 }));
    const board = new THREE.Mesh(tr.geo(new THREE.BoxGeometry(sw, sh, 0.12)), [dark, dark, dark, dark, this.signMat, dark]);
    board.position.set(W / 2, WALL_HEIGHT + 0.58, D + t + 0.06); g.add(board);
    this.soft.push({ mat: this.signMat });
    // toldo listrado sobre a porta
    const aw = tr.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
    const awc = makeCanvas(128, 16);
    for (let i = 0; i < 8; i++) { awc.g.fillStyle = i % 2 ? '#ffffff' : '#d93a3a'; awc.g.fillRect(i * 16, 0, 16, 16); }
    const awt = tr.tex(canvasTex(awc.c, true));
    aw.map = awt; aw.needsUpdate = true;
    this.awningMat = aw; this.awningCanvas = awc.c;
    const ag = tr.geo(new THREE.BoxGeometry(3.2, 0.05, 1.1)); scaleUV(ag, 1, 1);
    const awning = new THREE.Mesh(ag, aw); awning.position.set(W / 2, 2.75, D + t + 0.55); awning.rotation.x = 0.28; awning.castShadow = true; g.add(awning);
    this.soft.push({ mat: aw });
    void decor; void name;
  }
  private awningMat: THREE.MeshStandardMaterial | null = null;
  private awningCanvas: HTMLCanvasElement | null = null;

  /** Cores/nome que reagem ao estado sem reconstruir. */
  setDecor(decor: Decor, name: string): void {
    for (const m of this.innerMats) m.color.set(hex(decor.wallColor));
    this.floorMat?.color.set(hex(decor.floorColor));
    if (this.awningCanvas && this.awningMat?.map) {
      const ag = this.awningCanvas.getContext('2d')!;
      for (let i = 0; i < 8; i++) { ag.fillStyle = i % 2 ? '#ffffff' : decor.signColor; ag.fillRect(i * 16, 0, 16, 16); }
      this.awningMat.map.needsUpdate = true;
    }
    if (this.signCanvas && this.signMat?.map) {
      const cv = this.signCanvas, g = cv.getContext('2d')!;
      const w = cv.width, h = cv.height;
      g.fillStyle = decor.signColor; g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.28)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.2)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let s = Math.floor(h * 0.56);
      const text = (name || 'Mercadinho').toUpperCase();
      do { g.font = `800 ${s}px system-ui, sans-serif`; s -= 4; } while (g.measureText(text).width > w - 120 && s > 20);
      g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 8; g.shadowOffsetY = 4;
      g.fillText(text, w / 2, h / 2 + 4);
      this.signMat.map.needsUpdate = true;
      this.signMat.emissive.set(0xffffff);
    }
  }

  /** Porta desliza ao detectar alguém perto (ou 'sfx door'); paredes ficam translúcidas do lado da câmera. */
  update(dt: number, cam: THREE.Camera, doorWanted: boolean, night: number): void {
    const k = 1 - Math.exp(-dt * 10);
    this.doorOpen += ((doorWanted ? 1 : 0) - this.doorOpen) * (1 - Math.exp(-dt * 7));
    if (this.doorL && this.doorR) {
      this.doorL.position.x = this.doorBaseL - this.doorOpen * 0.95;
      this.doorR.position.x = this.doorBaseR + this.doorOpen * 0.95;
    }
    const cx = cam.position.x, cz = cam.position.z;
    for (const f of this.faces) {
      let target = 1;
      if (!f.never) {
        const out = (cx - f.cx) * f.nx + (cz - f.cz) * f.nz;
        target = this.forceFade || out > 0.4 ? 0.1 : 1;
      }
      f.fade += (target - f.fade) * k;
      const op = Math.abs(f.fade - target) < 0.01 ? target : f.fade;
      for (const m of f.mats) { m.opacity = op; m.transparent = op < 0.995; m.depthWrite = op > 0.6; }
    }
    const front = this.faces.find((f) => f.nz === 1 && f.nx === 0);
    const ft = front ? front.fade : 1;
    const softOp = ft >= 0.995 ? 1 : 0.4 + 0.6 * Math.min(1, (ft - 0.1) / 0.9);
    for (const s of this.soft) { s.mat.opacity = softOp; s.mat.transparent = softOp < 0.995; }
    if (this.signMat) this.signMat.emissiveIntensity = 0.12 + night * 0.9;
  }

  private clear(): void {
    this.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    while (this.group.children.length) this.group.remove(this.group.children[0]!);
    this.tr.disposeAll();
    this.faces.length = 0; this.innerMats.length = 0; this.soft.length = 0;
    this.floorMat = null; this.signMat = null; this.signCanvas = null; this.doorL = null; this.doorR = null; this.awningMat = null; this.awningCanvas = null;
  }
  dispose(): void { this.clear(); }
}

/* ---------------- Ambiente externo ---------------- */
export const ROAD_LANE_Z = { near: 6.5, far: 9.5 }; // relativo a D + SIDEWALK_DEPTH - 3 ... ver Env
export const ROAD_WIDTH = 8;

export class Env {
  readonly group = new THREE.Group();
  /** Tiles bloqueados por árvores/postes (ix,iz inteiros). */
  blocked: { x: number; z: number }[] = [];
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  readonly hemi = new THREE.HemisphereLight(0xcfe4ff, 0xe5d8bd, 0.95);
  private tr = new Tracker();
  private sky: THREE.Mesh | null = null;
  private skyMat: THREE.ShaderMaterial;
  private lampMat = stdMat(0xfff1c2, { emissive: 0xffd36b, ei: 0.2 });
  private cars: { g: THREE.Group; dir: number; speed: number }[] = [];
  private clouds: THREE.Group[] = [];
  private b: Bounds = { width: 12, depth: 10 };
  private cTop = new THREE.Color(); private cHor = new THREE.Color(); private tmp = new THREE.Color();
  private lastT = -1;

  constructor(private scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x3f9bea) }, hor: { value: new THREE.Color(0xd5ecff) } },
      vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying float vY; void main(){ float k = smoothstep(-0.05, 0.6, vY); gl_FragColor = vec4(mix(hor, top, k), 1.0);\n#include <colorspace_fragment>\n}',
    });
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.group.add(this.sun, this.sun.target, this.hemi);
  }

  rebuild(b: Bounds): void {
    this.clearGeo();
    this.b = b;
    const { width: W, depth: D } = b;
    const tr = this.tr, g = this.group;
    this.blocked = [];
    const cx = W / 2;
    // céu
    this.sky = new THREE.Mesh(tr.geo(new THREE.SphereGeometry(170, 24, 12)), this.skyMat);
    this.sky.position.set(cx, 0, D / 2); this.sky.renderOrder = -10; this.sky.frustumCulled = false; g.add(this.sky);
    // chão
    const plane = (w: number, d: number, mat: THREE.Material, x: number, y: number, z: number, su = 0, sv = 0): THREE.Mesh => {
      const pg = tr.geo(new THREE.PlaneGeometry(w, d)); pg.rotateX(-Math.PI / 2);
      if (su) scaleUV(pg, w / su, d / sv);
      const m = new THREE.Mesh(pg, mat); m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m;
    };
    const grass = tr.mat(new THREE.MeshStandardMaterial({ color: 0x9fbf88, roughness: 1 }));
    plane(600, 600, grass, cx, -0.03, D / 2);
    // calçada (frente), rua e calçada oposta
    const paver = tr.mat(new THREE.MeshStandardMaterial({ color: 0xd8d4cb, map: paverTex(), roughness: 0.95 }));
    const asphalt = tr.mat(new THREE.MeshStandardMaterial({ color: 0x4b4f57, map: asphaltTex(), roughness: 0.95 }));
    const X0 = -70, X1 = W + 70;
    const xc = (X0 + X1) / 2, xw = X1 - X0;
    plane(xw, SIDEWALK_DEPTH, paver, xc, 0.02, D + SIDEWALK_DEPTH / 2, 1, 1);
    const roadZ0 = D + SIDEWALK_DEPTH;
    plane(xw, ROAD_WIDTH, asphalt, xc, 0.0, roadZ0 + ROAD_WIDTH / 2, 4, 4);
    const farZ0 = roadZ0 + ROAD_WIDTH;
    plane(xw, SIDEWALK_DEPTH, paver, xc, 0.02, farZ0 + SIDEWALK_DEPTH / 2, 1, 1);
    // meios-fios
    const curb = stdMat(0xbfc3c9, { rough: 0.9 });
    bx(g, xw, 0.1, 0.16, curb, xc, 0, roadZ0 + 0.02, { cast: false });
    bx(g, xw, 0.1, 0.16, curb, xc, 0, farZ0 - 0.02, { cast: false });
    // faixas: borda branca contínua, centro amarelo tracejado, zebra
    const white = stdMat(0xf3f3ee, { rough: 0.8 }), yellow = stdMat(0xf2c230, { rough: 0.8 });
    bx(g, xw, 0.01, 0.12, white, xc, 0.0, roadZ0 + 2, { cast: false });
    bx(g, xw, 0.01, 0.12, white, xc, 0.0, farZ0 - 0.4, { cast: false });
    const nd = Math.floor(xw / 3);
    const dashes = new THREE.InstancedMesh(boxGeo(1.6, 0.01, 0.14), yellow, nd);
    const dm = new THREE.Object3D();
    for (let i = 0; i < nd; i++) { dm.position.set(X0 + 1.5 + i * 3, 0, roadZ0 + 5); dm.updateMatrix(); dashes.setMatrixAt(i, dm.matrix); }
    dashes.receiveShadow = true; g.add(dashes);
    const zebra = new THREE.InstancedMesh(boxGeo(3.2, 0.012, 0.5), white, 8);
    for (let i = 0; i < 8; i++) { dm.position.set(-3.5, 0, roadZ0 + 0.5 + i); dm.updateMatrix(); zebra.setMatrixAt(i, dm.matrix); }
    zebra.receiveShadow = true; g.add(zebra);
    // área de entrega (pintada na calçada)
    const dz = deliveryZone(b);
    const dzc = makeCanvas(256, 128);
    dzc.g.fillStyle = 'rgba(255,255,255,0)'; dzc.g.clearRect(0, 0, 256, 128);
    dzc.g.strokeStyle = '#f2c230'; dzc.g.lineWidth = 8; dzc.g.setLineDash([22, 14]); dzc.g.strokeRect(6, 6, 244, 116);
    dzc.g.setLineDash([]); dzc.g.fillStyle = '#e2b01c'; dzc.g.font = '800 26px system-ui, sans-serif'; dzc.g.textAlign = 'center'; dzc.g.fillText('ENTREGAS', 128, 74);
    const dzt = tr.tex(canvasTex(dzc.c));
    const dzm = tr.mat(new THREE.MeshBasicMaterial({ map: dzt, transparent: true, depthWrite: false, opacity: 0.9 }));
    plane(dz.w, dz.d, dzm, dz.x + dz.w / 2, 0.03, dz.z + dz.d / 2);
    // prédios vizinhos (laterais, mesmo alinhamento da fachada), fundo e do outro lado da rua
    const pal = [0xe9c9a0, 0xcfe0c3, 0xd9c3e6, 0xf2d6a2, 0xb9d3e8, 0xf0b7a4, 0xd8d8c8, 0xc3dcd2];
    const bld = (x0: number, x1: number, zFront: number, depth: number, h: number, ci: number, dirFront: 1 | -1, shop: boolean): void => {
      const w = x1 - x0;
      const m = new THREE.Mesh(bldGeo(tr, w, h, depth), bldMat(pal[ci % pal.length]!));
      m.position.set((x0 + x1) / 2, 0, zFront - dirFront * depth / 2);
      m.receiveShadow = true; g.add(m);
      const roof = bx(g, w + 0.3, 0.3, depth + 0.3, stdMat(0x7d838d, { rough: 0.9 }), m.position.x, h, m.position.z, { cast: false });
      void roof;
      if (shop) {
        const sf = bx(g, w - 1.2, 2.9, 0.12, stdMat(0x35505f, { rough: 0.2, metal: 0.2 }), m.position.x, 0, zFront + dirFront * 0.03, { cast: false });
        void sf;
        bx(g, w - 0.6, 0.45, 0.25, stdMat(pal[(ci + 3) % pal.length]! ^ 0x303030, { rough: 0.7 }), m.position.x, 3.0, zFront + dirFront * 0.1, { cast: false });
      }
      if (h > 9) {
        put(g, cylGeo(0.9, 0.9, 1.4, 10), stdMat(0xa6764a, { rough: 0.9 }), m.position.x + w * 0.2, h + 0.3, m.position.z, { cast: false });
      }
    };
    let xl = -0.2;
    for (let i = 0; i < 5; i++) { const w = 9 + Math.floor(hash01(i, 11) * 5); bld(xl - w, xl, D, D + 10, 6 + hash01(i, 12) * 6, i + 1, 1, true); xl -= w + 0.2; }
    let xr = W + 0.2;
    for (let i = 0; i < 5; i++) { const w = 9 + Math.floor(hash01(i, 21) * 5); bld(xr, xr + w, D, D + 10, 6 + hash01(i, 22) * 6, i + 4, 1, true); xr += w + 0.2; }
    const backZ = -STORAGE_DEPTH - 3.4;
    let xb = -34;
    for (let i = 0; xb < W + 34; i++) { const w = 10 + Math.floor(hash01(i, 31) * 6); bld(xb, xb + w, backZ, 12, 8 + hash01(i, 32) * 10, i + 2, -1, false); xb += w + 1; }
    let xf = -60; // lado oposto da rua: fachadas voltadas para a loja
    for (let i = 0; xf < W + 60; i++) {
      const w = 9 + Math.floor(hash01(i, 41) * 6);
      bld(xf, xf + w, farZ0 + SIDEWALK_DEPTH + 0.5, 12, 7 + hash01(i, 42) * 12, i, -1, false);
      xf += w + 0.4;
    }
    // árvores (instanciadas) e postes
    const treeX = [-6.5, -2.2, W + 2.2, W + 6.5, W / 2 + 7.5, -11];
    const trunk = new THREE.InstancedMesh(cylGeo(0.12, 0.17, 1.6, 6), stdMat(0x6d4a2c, { rough: 1 }), treeX.length);
    const can1 = new THREE.InstancedMesh(icoGeo(1.2, 0), stdMat(0x4fa85a, { flat: true }), treeX.length);
    const can2 = new THREE.InstancedMesh(icoGeo(0.85, 0), stdMat(0x66bb6a, { flat: true }), treeX.length);
    const tz = D + 2.4;
    treeX.forEach((x, i) => {
      const s = 0.9 + hash01(i, 51) * 0.35;
      dm.rotation.set(0, i, 0); dm.scale.set(s, s, s);
      dm.position.set(x, 0.02, tz); dm.updateMatrix(); trunk.setMatrixAt(i, dm.matrix);
      dm.position.set(x, 2.35 * s, tz); dm.updateMatrix(); can1.setMatrixAt(i, dm.matrix);
      dm.position.set(x + 0.35 * s, 3.2 * s, tz + 0.15); dm.updateMatrix(); can2.setMatrixAt(i, dm.matrix);
      this.blocked.push({ x: Math.floor(x), z: Math.floor(tz) });
    });
    dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1);
    for (const m of [trunk, can1, can2]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; g.add(m); }
    const pole = stdMat(0x2f3540, { rough: 0.5, metal: 0.5 });
    for (const x of [-4.5, W / 2 + 4, W + 4.5]) {
      put(g, cylGeo(0.07, 0.1, 4.2, 8), pole, x, 0.02, D + 2.7);
      bx(g, 0.08, 0.08, 1.0, pole, x, 4.15, D + 2.35);
      put(g, boxGeo(0.4, 0.12, 0.22), this.lampMat, x, 4.05, D + 1.95, { cast: false });
      this.blocked.push({ x: Math.floor(x), z: Math.floor(D + 2.7) });
    }
    // lixeira externa
    const tb = trashBinPos(b);
    const bin = stdMat(0x2f7d4a, { rough: 0.7 }), binD = stdMat(0x1f5c36, { rough: 0.7 });
    bx(g, 0.62, 0.95, 0.62, bin, tb.x, 0.02, tb.z);
    bx(g, 0.68, 0.1, 0.68, binD, tb.x, 0.97, tb.z);
    bx(g, 0.2, 0.06, 0.04, stdMat(0xddeee3), tb.x, 0.6, tb.z + 0.32, { cast: false });
    this.blocked.push({ x: Math.floor(tb.x), z: Math.floor(tb.z) });
    // carros
    this.cars = [];
    const carCols = [0xd94f4f, 0x3a7bd5, 0xf2c230, 0x58b368];
    for (let i = 0; i < 4; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const car = this.makeCar(carCols[i]!);
      car.position.set(X0 + hash01(i, 61) * (X1 - X0), 0, roadZ0 + (dir > 0 ? 3.4 : 6.6));
      car.rotation.y = dir > 0 ? 0 : Math.PI;
      g.add(car);
      this.cars.push({ g: car, dir, speed: 4 + hash01(i, 62) * 4 });
    }
    // nuvens
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Group();
      const cm = stdMat(0xffffff, { rough: 1, flat: true, emissive: 0xffffff, ei: 0.35 });
      for (let k = 0; k < 4; k++) {
        const s = put(c, icoGeo(2 + hash01(i, k) * 2, 0), cm, k * 2.4 - 3.5, hash01(k, i) * 0.8, hash01(i, 9 + k) * 1.5, { cast: false, recv: false });
        s.scale.y = 0.55;
      }
      c.position.set(-80 + hash01(i, 71) * 200, 38 + hash01(i, 72) * 14, -40 + hash01(i, 73) * 90);
      g.add(c); this.clouds.push(c);
    }
    // sol e sombra cobrindo a loja
    const R = 0.5 * Math.hypot(W + 8, D + STORAGE_DEPTH + 8) + 2;
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 5; sc.far = 160; sc.updateProjectionMatrix();
    this.sun.target.position.set(W / 2, 0, (D - STORAGE_DEPTH) / 2);
    this.lastT = -1;
  }

  private makeCar(color: number): THREE.Group {
    const c = new THREE.Group();
    const body = stdMat(color, { rough: 0.4, metal: 0.2 });
    bx(c, 3.8, 0.55, 1.7, body, 0, 0.3, 0);
    bx(c, 1.9, 0.5, 1.5, stdMat(0x273140, { rough: 0.2, metal: 0.4 }), -0.2, 0.85, 0);
    bx(c, 1.7, 0.04, 1.6, body, -0.2, 1.33, 0);
    const wheel = stdMat(0x17191d, { rough: 0.9 });
    for (const x of [-1.2, 1.2]) for (const z of [-0.85, 0.85]) {
      const w = put(c, cylGeo(0.36, 0.36, 0.26, 12), wheel, x, 0.0, z); w.rotation.x = Math.PI / 2; w.position.y = 0.36; w.position.z = z + (z > 0 ? 0.0 : -0.0);
    }
    bx(c, 0.06, 0.16, 0.3, stdMat(0xfff3b0, { emissive: 0xfff0a0, ei: 1 }), 1.9, 0.5, 0.55, { cast: false });
    bx(c, 0.06, 0.16, 0.3, stdMat(0xfff3b0, { emissive: 0xfff0a0, ei: 1 }), 1.9, 0.5, -0.55, { cast: false });
    bx(c, 0.06, 0.14, 0.3, stdMat(0xd62828, { emissive: 0xaa1010, ei: 0.8 }), -1.9, 0.5, 0.55, { cast: false });
    bx(c, 0.06, 0.14, 0.3, stdMat(0xd62828, { emissive: 0xaa1010, ei: 0.8 }), -1.9, 0.5, -0.55, { cast: false });
    return c;
  }

  /** Luz/céu conforme o minuto do relógio (0 = abertura, 1 = fechamento). */
  setTime(minute: number, force = false): number {
    const t = Math.max(0, Math.min(1, (minute - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN)));
    if (!force && Math.abs(t - this.lastT) < 0.002) return this.lastT;
    this.lastT = t;
    lerpKeys(SKY_TOP, t, this.cTop, this.tmp); (this.skyMat.uniforms.top!.value as THREE.Color).copy(this.cTop);
    lerpKeys(SKY_HOR, t, this.cHor, this.tmp); (this.skyMat.uniforms.hor!.value as THREE.Color).copy(this.cHor);
    this.scene.background = this.cHor;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(this.cHor);
    lerpKeys(SUN_COL, t, this.sun.color, this.tmp);
    const arc = Math.sin(t * Math.PI);
    this.sun.intensity = 1.7 + 1.3 * Math.pow(arc, 0.6);
    const R = 60;
    this.sun.position.set(this.sun.target.position.x + (t * 2 - 1) * R * 0.8, 14 + 40 * arc, this.sun.target.position.z + R * 0.55);
    lerpKeys(HEM_SKY, t, this.hemi.color, this.tmp);
    this.hemi.intensity = 1.0 + 0.2 * (1 - arc);
    const night = Math.max(0, Math.min(1, (t - 0.72) / 0.22));
    this.lampMat.emissiveIntensity = 0.2 + night * 2.2;
    for (const m of nightMats) m.emissiveIntensity = night * 0.9;
    return t;
  }
  get night(): number { return Math.max(0, Math.min(1, (this.lastT - 0.72) / 0.22)); }

  update(dt: number): void {
    const X0 = -70, X1 = this.b.width + 70;
    for (const c of this.cars) {
      c.g.position.x += c.dir * c.speed * dt;
      if (c.dir > 0 && c.g.position.x > X1) c.g.position.x = X0;
      if (c.dir < 0 && c.g.position.x < X0) c.g.position.x = X1;
    }
    for (const c of this.clouds) { c.position.x += dt * 0.8; if (c.position.x > 140) c.position.x = -90; }
  }

  private clearGeo(): void {
    const keep = new Set<THREE.Object3D>([this.sun, this.sun.target, this.hemi]);
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const ch = this.group.children[i]!;
      if (keep.has(ch)) continue;
      ch.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
      this.group.remove(ch);
    }
    this.tr.disposeAll();
  }
  dispose(): void {
    this.clearGeo();
    this.skyMat.dispose();
    this.sun.shadow.map?.dispose();
  }
}
void sphGeo; void coneGeo;
