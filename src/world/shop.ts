/**
 * Casca da loja (piso, paredes com recorte, fachada com letreiro, porta de vidro, sala de estoque)
 * e o ambiente externo (céu, rua, calçada, prédios, árvores, postes, carros, nuvens, luz do dia).
 * Toda geometria estática é fundida por material (Batch / paredes por face): poucas dezenas de draw calls no total.
 */
import * as THREE from 'three';
import { CLOSE_MIN, OPEN_MIN, type Decor } from '../sim/state';
import { DOOR_WIDTH, SIDEWALK_DEPTH, STORAGE_DEPTH, WALL_HEIGHT, deliveryZone, trashBinPos, type Bounds } from '../core/layout';
import { Tracker, icoGeo, stdMat, scaleUV, makeCanvas, canvasTex, hex, hash01 } from './kit';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch, kindMaterial, meshesOf, type Spec } from './batch';

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

/** Ajusta opacidade; ao alternar transparent o shader precisa recompilar (define OPAQUE). */
function setOpacity(m: THREE.MeshStandardMaterial, op: number): void {
  const t = op < 0.995;
  m.opacity = op;
  m.depthWrite = op > 0.6;
  if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
}

/* ---------------- Casca da loja ---------------- */
export interface WallFace {
  mats: THREE.MeshStandardMaterial[];
  nx: number; nz: number; cx: number; cz: number;
  fade: number; never: boolean;
}

/** Peças de parede de uma face: cada caixa vira 6 quadriláteros distribuídos em 3 materiais (interno, externo, topo) numa geometria só. */
class FacePieces {
  private lists: THREE.BufferGeometry[][] = [[], [], []];
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, inIdx: number, outIdx: number): void {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute, nor = g.getAttribute('normal') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) {
      const mi = f === inIdx ? 0 : f === outIdx ? 1 : 2;
      const q = new THREE.BufferGeometry();
      const sl = (a: THREE.BufferAttribute): THREE.BufferAttribute => new THREE.BufferAttribute((a.array as Float32Array).slice(f * 6 * a.itemSize, (f + 1) * 6 * a.itemSize), a.itemSize);
      q.setAttribute('position', sl(pos)); q.setAttribute('normal', sl(nor)); q.setAttribute('uv', sl(uv));
      this.lists[mi]!.push(q);
    }
    g.dispose();
  }
  build(): THREE.BufferGeometry {
    const all = this.lists.flat();
    const merged = mergeGeometries(all, false)!;
    merged.clearGroups();
    let start = 0;
    this.lists.forEach((l, mi) => {
      const count = l.reduce((a, q) => a + q.getAttribute('position').count, 0);
      if (count) merged.addGroup(start, count, mi);
      start += count;
    });
    all.forEach((q) => q.dispose());
    return merged;
  }
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
    const sb = new Batch(); // estático fosco: rodapés, tapetes, faixa, ferragens, vidros
    // pisos
    const floorG = tr.geo(new THREE.PlaneGeometry(W, D)); floorG.rotateX(-Math.PI / 2); scaleUV(floorG, W / 2, D / 2);
    this.floorMat = tr.mat(new THREE.MeshStandardMaterial({ color: hex(decor.floorColor), map: floorTex(), roughness: 0.55 }));
    const floor = new THREE.Mesh(floorG, this.floorMat); floor.position.set(W / 2, 0.01, D / 2); floor.receiveShadow = true; g.add(floor);
    if (storage) {
      const sg = tr.geo(new THREE.PlaneGeometry(W, STORAGE_DEPTH)); sg.rotateX(-Math.PI / 2); scaleUV(sg, W / 2, STORAGE_DEPTH / 2);
      const sm = tr.mat(new THREE.MeshStandardMaterial({ color: 0x9aa1a8, map: floorTex(), roughness: 0.8 }));
      const sf = new THREE.Mesh(sg, sm); sf.position.set(W / 2, 0.01, -STORAGE_DEPTH / 2); sf.receiveShadow = true; g.add(sf);
      sb.box(W - 0.4, 0.004, 0.12, ['matte', 0xf2c230], W / 2, 0.016, -0.12); // faixa de corredor amarela
    }
    // paredes
    const zBack = storage ? -STORAGE_DEPTH : 0;
    const wallH = WALL_HEIGHT;
    const mkFace = (nx: number, nz: number, cx: number, cz: number, never = false): { f: WallFace; p: FacePieces } => {
      const inner = tr.mat(new THREE.MeshStandardMaterial({ color: hex(decor.wallColor), roughness: 0.9 }));
      const outer = tr.mat(new THREE.MeshStandardMaterial({ color: 0xe6d3b3, roughness: 0.9 }));
      const cap = tr.mat(new THREE.MeshStandardMaterial({ color: 0x4a4f5a, roughness: 0.8 }));
      this.innerMats.push(inner);
      const f: WallFace = { mats: [inner, outer, cap], nx, nz, cx, cz, fade: 1, never };
      this.faces.push(f);
      return { f, p: new FacePieces() };
    };
    const finish = (fp: { f: WallFace; p: FacePieces }): void => {
      const m = new THREE.Mesh(tr.geo(fp.p.build()), fp.f.mats);
      m.receiveShadow = true; m.castShadow = false;
      g.add(m);
    };
    const t = 0.2;
    const left = mkFace(-1, 0, 0, (zBack + D) / 2);
    left.p.box(-t, 0, 0, wallH, zBack - t, D + t, 0, 1); finish(left);
    const right = mkFace(1, 0, W, (zBack + D) / 2);
    right.p.box(W, W + t, 0, wallH, zBack - t, D + t, 1, 0); finish(right);
    if (!storage) {
      const back = mkFace(0, -1, W / 2, 0);
      back.p.box(-t, W + t, 0, wallH, -t, 0, 4, 5); finish(back);
    } else {
      const back = mkFace(0, -1, W / 2, zBack);
      back.p.box(-t, W + t, 0, wallH, zBack - t, zBack, 4, 5); finish(back);
      const div = mkFace(0, 0, W / 2, 0, true);
      const gx0 = W / 2 - DOOR_WIDTH / 2, gx1 = W / 2 + DOOR_WIDTH / 2;
      div.p.box(-t, gx0, 0, wallH, -t, 0, 4, 5);
      div.p.box(gx1, W + t, 0, wallH, -t, 0, 4, 5);
      div.p.box(gx0, gx1, 2.5, wallH, -t, 0, 4, 5);
      finish(div);
    }
    const front = mkFace(0, 1, W / 2, D);
    this.buildFront(front.f, front.p, W, D, sb, decor, name);
    finish(front);
    // rodapé interno
    const skirt: Spec = ['matte', 0x59606c];
    sb.box(0.04, 0.14, D, skirt, 0.02, 0.01, D / 2);
    sb.box(0.04, 0.14, D, skirt, W - 0.02, 0.01, D / 2);
    sb.box(W, 0.14, 0.04, skirt, W / 2, 0.01, 0.02);
    // tapetes da porta
    sb.box(1.8, 0.02, 0.9, ['matte', 0x7a2e2e], W / 2, 0.01, D - 0.6);
    sb.box(1.8, 0.02, 0.9, ['matte', 0x3b3f47], W / 2, 0.02, D + 0.7);
    for (const m of meshesOf(sb.build(), g, { cast: false })) tr.geo(m.geometry);
    this.setDecor(decor, name);
  }

  private buildFront(face: WallFace, p: FacePieces, W: number, D: number, sb: Batch, decor: Decor, name: string): void {
    const tr = this.tr, g = this.group;
    const t = 0.2;
    const gx0 = W / 2 - DOOR_WIDTH / 2, gx1 = W / 2 + DOOR_WIDTH / 2;
    const z0 = D, z1 = D + t;
    // faixa baixa, faixa alta (cobre a porta) e platibanda
    p.box(-t, gx0, 0, 0.9, z0, z1, 5, 4);
    p.box(gx1, W + t, 0, 0.9, z0, z1, 5, 4);
    p.box(-t, W + t, 2.5, WALL_HEIGHT, z0, z1, 5, 4);
    p.box(-t, W + t, WALL_HEIGHT, WALL_HEIGHT + 1.15, z0, z1, 5, 4);
    // montantes e janelas de cada lado
    const glass: Spec = ['glass', 0xbfe3f5];
    const side = (s: number, e: number, padL: number, padR: number): void => {
      p.box(s, s + padL, 0.9, 2.5, z0, z1, 5, 4);
      p.box(e - padR, e, 0.9, 2.5, z0, z1, 5, 4);
      const inner0 = s + padL, inner1 = e - padR;
      const n = Math.max(1, Math.round((inner1 - inner0) / 3.4));
      const pw = 0.3, ww = (inner1 - inner0 - (n - 1) * pw) / n;
      for (let i = 0; i < n; i++) {
        const x0 = inner0 + i * (ww + pw);
        sb.box(ww, 1.6, 0.04, glass, x0 + ww / 2, 0.9, D + t / 2);
        if (i < n - 1) p.box(x0 + ww, x0 + ww + pw, 0.9, 2.5, z0, z1, 5, 4);
      }
    };
    side(-t, gx0, 0.6, 0.45);
    side(gx1, W + t, 0.45, 0.6);
    // porta de vidro deslizante (cada folha: 1 malha de vidro + 1 de ferragem)
    const frame: Spec = ['metal', 0x8f99a6];
    const mkDoor = (cx: number): THREE.Group => {
      const dg = new THREE.Group();
      const db = new Batch();
      db.box(0.96, 2.3, 0.03, glass, 0, 0, 0);
      db.box(0.96, 0.06, 0.06, frame, 0, 0, 0); db.box(0.96, 0.06, 0.06, frame, 0, 2.28, 0);
      db.box(0.05, 2.3, 0.06, frame, -0.455, 0, 0); db.box(0.05, 2.3, 0.06, frame, 0.455, 0, 0);
      db.box(0.03, 0.5, 0.05, frame, cx < W / 2 ? 0.4 : -0.4, 0.9, 0.04);
      for (const m of meshesOf(db.build(), dg, { cast: false })) tr.geo(m.geometry);
      dg.position.set(cx, 0, D + t + 0.03);
      g.add(dg);
      return dg;
    };
    this.doorBaseL = W / 2 - 0.49; this.doorBaseR = W / 2 + 0.49;
    this.doorL = mkDoor(this.doorBaseL); this.doorR = mkDoor(this.doorBaseR);
    sb.box(DOOR_WIDTH, 0.1, 0.1, frame, W / 2, 2.4, D + t + 0.03 - 0.05 + 0.05);
    // letreiro: caixa escura (lote estático) + placa com a textura do nome
    const sw = Math.min(W - 1.6, 8.5), sh = 0.95;
    this.signCanvas = document.createElement('canvas'); this.signCanvas.width = 1024; this.signCanvas.height = Math.round(1024 * sh / sw);
    const tex = tr.tex(canvasTex(this.signCanvas));
    this.signMat = tr.mat(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 }));
    sb.box(sw, sh, 0.12, ['matte', 0x2b2e35], W / 2, WALL_HEIGHT + 0.58 - sh / 2, D + t + 0.06);
    const board = new THREE.Mesh(tr.geo(new THREE.PlaneGeometry(sw, sh)), this.signMat);
    board.position.set(W / 2, WALL_HEIGHT + 0.58, D + t + 0.122); g.add(board);
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
    void face;
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
      if (f.never) target = 0.14; // divisória salão/estoque: sempre recortada para ver o depósito
      else {
        const out = (cx - f.cx) * f.nx + (cz - f.cz) * f.nz;
        target = this.forceFade || out > 0.4 ? 0.1 : 1;
      }
      f.fade += (target - f.fade) * k;
      const op = Math.abs(f.fade - target) < 0.01 ? target : f.fade;
      for (const m of f.mats) setOpacity(m, op);
    }
    const front = this.faces.find((f) => f.nz === 1 && f.nx === 0);
    const ft = front ? front.fade : 1;
    const softOp = ft >= 0.995 ? 1 : 0.4 + 0.6 * Math.min(1, (ft - 0.1) / 0.9);
    for (const s of this.soft) setOpacity(s.mat, softOp);
    if (this.signMat) this.signMat.emissiveIntensity = 0.12 + night * 0.9;
  }

  private clear(): void {
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

const CAR_COLORS = [0xd94f4f, 0x3a7bd5, 0xf2c230, 0x58b368];
/** Carro numa única malha fosca (cores por vértice). */
function carGeometry(color: number): THREE.BufferGeometry {
  const b = new Batch();
  const body: Spec = ['matte', color], dark: Spec = ['matte', 0x273140], wheel: Spec = ['matte', 0x17191d];
  b.box(3.8, 0.55, 1.7, body, 0, 0.3, 0);
  b.box(1.9, 0.5, 1.5, dark, -0.2, 0.85, 0);
  b.box(1.7, 0.04, 1.6, body, -0.2, 1.33, 0);
  for (const x of [-1.2, 1.2]) for (const z of [-0.85, 0.85]) b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10), wheel, x, 0.36, z, { rx: Math.PI / 2 });
  for (const z of [-0.55, 0.55]) {
    b.box(0.06, 0.16, 0.3, ['matte', 0xfff3b0], 1.9, 0.5, z);
    b.box(0.06, 0.14, 0.3, ['matte', 0xd62828], -1.9, 0.5, z);
  }
  return b.build().get('matte')!;
}

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
  private cars: { g: THREE.Object3D; dir: number; speed: number }[] = [];
  private cloudMesh: THREE.InstancedMesh | null = null;
  private clouds: { x: number; y: number; z: number; parts: { dx: number; dy: number; dz: number; r: number }[] }[] = [];
  private cloudT = 0;
  private b: Bounds = { width: 12, depth: 10 };
  private cTop = new THREE.Color(); private cHor = new THREE.Color(); private tmp = new THREE.Color();
  private lastT = -1;
  private dm = new THREE.Object3D();

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

  /** Muda a resolução do mapa de sombra (0 desliga a sombra do sol). */
  setShadow(size: number): void {
    const on = size > 0;
    this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    if (!on) { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
  }

  rebuild(b: Bounds): void {
    this.clearGeo();
    this.b = b;
    const { width: W, depth: D } = b;
    const tr = this.tr, g = this.group;
    this.blocked = [];
    const cx = W / 2;
    const sb = new Batch(); // estático fosco que só recebe sombra
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
    const curb: Spec = ['matte', 0xbfc3c9];
    sb.box(xw, 0.1, 0.16, curb, xc, 0, roadZ0 + 0.02);
    sb.box(xw, 0.1, 0.16, curb, xc, 0, farZ0 - 0.02);
    // faixas: borda branca contínua, centro amarelo tracejado, zebra
    const white: Spec = ['matte', 0xf3f3ee], yellow: Spec = ['matte', 0xf2c230];
    sb.box(xw, 0.01, 0.12, white, xc, 0.0, roadZ0 + 2);
    sb.box(xw, 0.01, 0.12, white, xc, 0.0, farZ0 - 0.4);
    const nd = Math.floor(xw / 3);
    for (let i = 0; i < nd; i++) sb.box(1.6, 0.01, 0.14, yellow, X0 + 1.5 + i * 3, 0, roadZ0 + 5);
    for (let i = 0; i < 8; i++) sb.box(3.2, 0.012, 0.5, white, -3.5, 0, roadZ0 + 0.5 + i);
    // área de entrega (pintada na calçada)
    const dz = deliveryZone(b);
    const dzc = makeCanvas(256, 128);
    dzc.g.fillStyle = 'rgba(255,255,255,0)'; dzc.g.clearRect(0, 0, 256, 128);
    dzc.g.strokeStyle = '#f2c230'; dzc.g.lineWidth = 8; dzc.g.setLineDash([22, 14]); dzc.g.strokeRect(6, 6, 244, 116);
    dzc.g.setLineDash([]); dzc.g.fillStyle = '#e2b01c'; dzc.g.font = '800 26px system-ui, sans-serif'; dzc.g.textAlign = 'center'; dzc.g.fillText('ENTREGAS', 128, 74);
    const dzt = tr.tex(canvasTex(dzc.c));
    const dzm = tr.mat(new THREE.MeshBasicMaterial({ map: dzt, transparent: true, depthWrite: false, opacity: 0.9 }));
    plane(dz.w, dz.d, dzm, dz.x + dz.w / 2, 0.03, dz.z + dz.d / 2);
    // prédios vizinhos (laterais, mesmo alinhamento da fachada), fundo e do outro lado da rua.
    // Corpos fundidos POR COR (material com janelas); detalhes (platibanda, vitrines, caixa d'água) no lote fosco.
    const pal = [0xe9c9a0, 0xcfe0c3, 0xd9c3e6, 0xf2d6a2, 0xb9d3e8, 0xf0b7a4, 0xd8d8c8, 0xc3dcd2];
    const bodies = new Map<number, THREE.BufferGeometry[]>();
    const bld = (x0: number, x1: number, zFront: number, depth: number, h: number, ci: number, dirFront: 1 | -1, shop: boolean): void => {
      const w = x1 - x0;
      const color = pal[ci % pal.length]!;
      const bg = bldGeo(tr, w, h, depth);
      const px = (x0 + x1) / 2, pz = zFront - dirFront * depth / 2;
      bg.translate(px, 0, pz);
      let l = bodies.get(color);
      if (!l) bodies.set(color, (l = []));
      l.push(bg);
      sb.box(w + 0.3, 0.3, depth + 0.3, ['matte', 0x7d838d], px, h, pz);
      if (shop) {
        sb.box(w - 1.2, 2.9, 0.12, ['metal', 0x35505f], px, 0, zFront + dirFront * 0.03);
        sb.box(w - 0.6, 0.45, 0.25, ['matte', pal[(ci + 3) % pal.length]! ^ 0x303030], px, 3.0, zFront + dirFront * 0.1);
      }
      if (h > 9) sb.add(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 10), ['matte', 0xa6764a], px + w * 0.2, h + 0.3 + 0.7, pz);
    };
    let xl = -0.2;
    for (let i = 0; i < 5; i++) { const w = 9 + Math.floor(hash01(i, 11) * 5); bld(xl - w, xl, D, D + 10, 6 + hash01(i, 12) * 6, i + 1, 1, true); xl -= w + 0.2; }
    let xr = W + 0.2;
    for (let i = 0; i < 5; i++) { const w = 9 + Math.floor(hash01(i, 21) * 5); bld(xr, xr + w, D, D + 10, 6 + hash01(i, 22) * 6, i + 4, 1, true); xr += w + 0.2; }
    const backZ = -STORAGE_DEPTH - 3.4;
    let xb = -34;
    for (let i = 0; xb < W + 34; i++) { const w = 10 + Math.floor(hash01(i, 31) * 6); bld(xb, xb + w, backZ, 12, 8 + hash01(i, 32) * 10, i + 2, 1, false); xb += w + 1; }
    let xf = -60; // lado oposto da rua: fachadas voltadas para a loja
    for (let i = 0; xf < W + 60; i++) {
      const w = 9 + Math.floor(hash01(i, 41) * 6);
      bld(xf, xf + w, farZ0 + SIDEWALK_DEPTH + 0.5, 12, 7 + hash01(i, 42) * 12, i, -1, false);
      xf += w + 0.4;
    }
    for (const [color, list] of bodies) {
      const merged = tr.geo(mergeGeometries(list, false)!);
      const m = new THREE.Mesh(merged, bldMat(color)); m.receiveShadow = true; g.add(m);
      // as geometrias de entrada já foram copiadas para `merged`
      list.forEach((q) => q.dispose());
    }
    // postes (haste/braço no lote fosco; lâmpadas numa malha própria que acende à noite) e lixeira externa
    const pole: Spec = ['metal', 0x2f3540];
    const lamps = new Batch();
    for (const x of [-4.5, W / 2 + 4, W + 4.5]) {
      sb.add(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8).translate(0, 2.1, 0), pole, x, 0.02, D + 2.7);
      sb.box(0.08, 0.08, 1.0, pole, x, 4.15, D + 2.35);
      lamps.box(0.4, 0.12, 0.22, ['matte', 0xfff1c2], x, 4.05, D + 1.95);
      this.blocked.push({ x: Math.floor(x), z: Math.floor(D + 2.7) });
    }
    const lampGeo = lamps.build().get('matte')!;
    const lampMesh = new THREE.Mesh(tr.geo(lampGeo), this.lampMat); g.add(lampMesh);
    const tb = trashBinPos(b);
    sb.box(0.62, 0.95, 0.62, ['matte', 0x2f7d4a], tb.x, 0.02, tb.z);
    sb.box(0.68, 0.1, 0.68, ['matte', 0x1f5c36], tb.x, 0.97, tb.z);
    sb.box(0.2, 0.06, 0.04, ['matte', 0xddeee3], tb.x, 0.6, tb.z + 0.32);
    this.blocked.push({ x: Math.floor(tb.x), z: Math.floor(tb.z) });
    for (const m of meshesOf(sb.build(), g, { cast: false })) tr.geo(m.geometry);
    // árvores: uma malha fundida (as únicas do cenário externo que projetam sombra)
    const treeX = [-6.5, -2.2, W + 2.2, W + 6.5, W / 2 + 7.5, -11];
    const tz = D + 2.4;
    const trees = new Batch();
    treeX.forEach((x, i) => {
      const s = 0.9 + hash01(i, 51) * 0.35;
      trees.add(new THREE.CylinderGeometry(0.12, 0.17, 1.6, 6).translate(0, 0.8, 0), ['flat', 0x6d4a2c], x, 0.02, tz, { ry: i, sx: s, sy: s, sz: s });
      trees.add(icoGeo(1.2, 0), ['flat', 0x4fa85a], x, 2.35 * s, tz, { ry: i, sx: s, sy: s, sz: s });
      trees.add(icoGeo(0.85, 0), ['flat', 0x66bb6a], x + 0.35 * s, 3.2 * s, tz + 0.15, { ry: i, sx: s, sy: s, sz: s });
      this.blocked.push({ x: Math.floor(x), z: Math.floor(tz) });
    });
    for (const m of meshesOf(trees.build(), g, { cast: true })) { tr.geo(m.geometry); m.frustumCulled = false; }
    // carros (1 malha cada, sem sombra)
    this.cars = [];
    for (let i = 0; i < 4; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const car = new THREE.Mesh(tr.geo(carGeometry(CAR_COLORS[i]!)), kindMaterial('matte'));
      car.castShadow = false; car.receiveShadow = false;
      car.position.set(X0 + hash01(i, 61) * (X1 - X0), 0, roadZ0 + (dir > 0 ? 3.4 : 6.6));
      car.rotation.y = dir > 0 ? 0 : Math.PI;
      g.add(car);
      this.cars.push({ g: car, dir, speed: 4 + hash01(i, 62) * 4 });
    }
    // nuvens: uma InstancedMesh (28 esferas achatadas), matrizes atualizadas conforme se movem
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const parts: { dx: number; dy: number; dz: number; r: number }[] = [];
      for (let k = 0; k < 4; k++) parts.push({ dx: k * 2.4 - 3.5, dy: hash01(k, i) * 0.8, dz: hash01(i, 9 + k) * 1.5, r: 2 + hash01(i, k) * 2 });
      this.clouds.push({ x: -80 + hash01(i, 71) * 200, y: 38 + hash01(i, 72) * 14, z: -40 + hash01(i, 73) * 90, parts });
    }
    this.cloudMesh = new THREE.InstancedMesh(icoGeo(1, 0), stdMat(0xffffff, { rough: 1, flat: true, emissive: 0xffffff, ei: 0.35 }), this.clouds.length * 4);
    this.cloudMesh.castShadow = false; this.cloudMesh.receiveShadow = false; this.cloudMesh.frustumCulled = false;
    g.add(this.cloudMesh);
    this.writeClouds();
    // sol e sombra cobrindo a loja
    const R = 0.5 * Math.hypot(W + 8, D + STORAGE_DEPTH + 8) + 2;
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 5; sc.far = 160; sc.updateProjectionMatrix();
    this.sun.target.position.set(W / 2, 0, (D - STORAGE_DEPTH) / 2);
    this.lastT = -1;
  }

  private writeClouds(): void {
    if (!this.cloudMesh) return;
    const o = this.dm;
    o.rotation.set(0, 0, 0);
    let n = 0;
    for (const c of this.clouds) for (const p of c.parts) {
      o.position.set(c.x + p.dx, c.y + p.dy, c.z + p.dz); o.scale.set(p.r, p.r * 0.55, p.r); o.updateMatrix();
      this.cloudMesh.setMatrixAt(n++, o.matrix);
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;
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
    this.cloudT += dt;
    if (this.cloudT > 0.1) { // nuvens: 10 atualizações por segundo bastam (movimento lentíssimo)
      for (const c of this.clouds) { c.x += this.cloudT * 0.8; if (c.x > 140) c.x = -90; }
      this.cloudT = 0; this.writeClouds();
    }
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
    this.cloudMesh = null;
  }
  dispose(): void {
    this.clearGeo();
    this.skyMat.dispose();
    this.sun.shadow.map?.dispose();
  }
}
