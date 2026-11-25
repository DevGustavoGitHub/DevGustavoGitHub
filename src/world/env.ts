/**
 * Ambiente externo (Fase 3): céu, calçadas, rua com faixas e faixa de estacionamento, área de ENTREGAS pintada,
 * lixeira verde de reciclagem, caçamba cinza (lixeira do jogo, `trashBinPos`), hidrante, ponto de ônibus, bancos,
 * árvores outonais, postes, prédios (UMA malha com cor por vértice), carros estacionados (lote) e em movimento, nuvens.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLOSE_MIN, OPEN_MIN } from '../sim/state';
import { SIDEWALK_DEPTH, STORAGE_DEPTH, deliveryZone, trashBinPos, type Bounds } from '../core/layout';
import { Tracker, icoGeo, stdMat, scaleUV, hash01, planeGeo, freezeStatic } from './kit';
import { Batch, kindMaterial, meshesOf, type Spec } from './batch';
import { uvToCell, type Cell } from './atlas';
import { DECAL, asphaltTex, drawDelivery, paverTex, windowTex } from './tex';

export const ROAD_WIDTH = 10;
/** Faixas (z relativo a depth): carros andando e estacionados. */
export const LANES = { near: SIDEWALK_DEPTH + 3.4, far: SIDEWALK_DEPTH + 6.6, parked: SIDEWALK_DEPTH + 8.9 };

/* ---------------- céu / luz ---------------- */
type Key = [number, number];
const lerpKeys = (keys: Key[], t: number, out: THREE.Color, tmp: THREE.Color): void => {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const k = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0] || 1)));
  out.setHex(a[1]); tmp.setHex(b[1]); out.lerp(tmp, k);
};
const SKY_TOP: Key[] = [[0, 0x5fb2f0], [0.35, 0x3f9bea], [0.7, 0x4f8fd8], [0.88, 0x5b62b0], [1, 0x2c2f66]];
const SKY_HOR: Key[] = [[0, 0xfde7c4], [0.35, 0xd5ecff], [0.7, 0xe8e0d0], [0.88, 0xffb98a], [1, 0xa86a7a]];
const SUN_COL: Key[] = [[0, 0xffd7a0], [0.3, 0xfff4e0], [0.7, 0xffe0b0], [0.9, 0xff9d62], [1, 0xff7a4a]];
const HEM_SKY: Key[] = [[0, 0xcfe4ff], [0.5, 0xcfe4ff], [0.9, 0xa9a4d8], [1, 0x7a78b8]];

const CAR_COLORS = [0xd94f4f, 0x3a7bd5, 0xf2c230, 0x58b368, 0xeeeeee, 0x7a56c2];
/** Carro (lote fosco): carroceria, cabine escura, rodas, faróis. */
function carParts(b: Batch, color: number, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const put = (w: number, h: number, d: number, spec: Spec, lx: number, y: number, lz: number): void => { const [px, pz] = at(lx, lz); b.box(w, h, d, spec, px, y, pz, { ry }); };
  const body: Spec = ['matte', color], dark: Spec = ['matte', 0x273140], wheel: Spec = ['matte', 0x17191d];
  put(3.8, 0.55, 1.7, body, 0, 0.3, 0);
  put(1.9, 0.5, 1.5, dark, -0.2, 0.85, 0);
  put(1.7, 0.04, 1.6, body, -0.2, 1.33, 0);
  for (const lx of [-1.2, 1.2]) for (const lz of [-0.85, 0.85]) { const [px, pz] = at(lx, lz); b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10), wheel, px, 0.36, pz, { rx: Math.PI / 2, ry }); }
  for (const lz of [-0.55, 0.55]) { put(0.06, 0.16, 0.3, ['matte', 0xfff3b0], 1.9, 0.5, lz); put(0.06, 0.14, 0.3, ['matte', 0xd62828], -1.9, 0.5, lz); }
}
function carGeometry(color: number): THREE.BufferGeometry {
  const b = new Batch();
  carParts(b, color, 0, 0, 0);
  return b.build().get('matte')!;
}
function decal(b: Batch, cell: Cell, w: number, h: number, x: number, y: number, z: number, ry = 0): void {
  const g = uvToCell(planeGeo(w, h).clone(), cell);
  b.add(g, ['decal', 0xffffff], x, y, z, { ry });
  g.dispose();
}
/** Silhueta (caixas locais) da caçamba, usada no contorno de destaque. */
export const TRASH_SILHOUETTE: [number, number, number, number, number, number][] = [[0, 0.55, 0, 0.82, 0.95, 0.84], [0, 1.12, -0.12, 0.86, 0.22, 0.66]];

/** Silhueta (caixas locais) da lixeira de reciclagem. */
export const RECYCLE_SILHOUETTE: [number, number, number, number, number, number][] = [[0, 0.58, 0, 0.78, 1.16, 0.66]];

export class Env {
  readonly group = new THREE.Group();
  /** Tiles bloqueados (árvores, postes, hidrante, lixeiras) na calçada da loja. */
  blocked: { x: number; z: number }[] = [];
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  readonly hemi = new THREE.HemisphereLight(0xcfe4ff, 0xe5d8bd, 0.95);
  private tr = new Tracker();
  private sky: THREE.Mesh | null = null;
  private skyMat: THREE.ShaderMaterial;
  private lampMat = stdMat(0xfff1c2, { emissive: 0xffd36b, ei: 0.2 });
  private bldMat: THREE.MeshLambertMaterial;
  private cars: { g: THREE.Object3D; dir: number; speed: number }[] = [];
  private cloudMesh: THREE.InstancedMesh | null = null;
  private clouds: { x: number; y: number; z: number; parts: { dx: number; dy: number; dz: number; r: number }[] }[] = [];
  private cloudT = 0;
  private recyclerGlow: THREE.Group | null = null;
  private recyclerOn = false;
  /** Visual da lixeira de reciclagem ativada (melhoria 'recycler'). */
  setRecycler(on: boolean): void { this.recyclerOn = on; if (this.recyclerGlow) this.recyclerGlow.visible = on; }
  private b: Bounds = { width: 12, depth: 10 };
  private cTop = new THREE.Color(); private cHor = new THREE.Color(); private tmp = new THREE.Color();
  private lastT = -1;
  private sunT = -1;
  /** Sobe quando o sol muda de posição (o world reenvia o mapa de sombra estático só nessas horas). */
  sunVersion = 0;
  private dm = new THREE.Object3D();

  constructor(private scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x3f9bea) }, hor: { value: new THREE.Color(0xd5ecff) } },
      vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying float vY; void main(){ float k = smoothstep(-0.05, 0.6, vY); gl_FragColor = vec4(mix(hor, top, k), 1.0);\n#include <colorspace_fragment>\n}',
    });
    const wt = windowTex();
    this.bldMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: wt.map, emissive: 0xffc866, emissiveMap: wt.glow, emissiveIntensity: 0 });
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.intensity = 0.6; // sombras suaves (interior com teto, visual da referência)
    this.group.add(this.sun, this.sun.target, this.hemi);
  }

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
    const block = (x: number, z: number): void => { this.blocked.push({ x: Math.floor(x), z: Math.floor(z) }); };
    const cx = W / 2;
    const sb = new Batch();
    // céu: desenhado DEPOIS dos opacos (teste de profundidade sem escrita) para só pintar os pixels onde ele aparece;
    // antes era o 1º (renderOrder -10) e cobria a tela inteira todo quadro, mesmo dentro da loja (overdraw).
    this.sky = new THREE.Mesh(tr.geo(new THREE.SphereGeometry(170, 24, 12)), this.skyMat);
    this.sky.position.set(cx, 0, D / 2); this.sky.renderOrder = 900; this.sky.frustumCulled = false; g.add(this.sky);
    // chão: grama, calçadas (uma malha), asfalto
    const X0 = -70, X1 = W + 70, xc = (X0 + X1) / 2, xw = X1 - X0;
    const roadZ0 = D + SIDEWALK_DEPTH, farZ0 = roadZ0 + ROAD_WIDTH;
    const plane = (w: number, d: number, x: number, y: number, z: number, su: number, sv: number): THREE.BufferGeometry => {
      const pg = new THREE.PlaneGeometry(w, d); pg.rotateX(-Math.PI / 2); scaleUV(pg, w / su, d / sv); pg.translate(x, y, z); return pg;
    };
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => { const m = new THREE.Mesh(tr.geo(geo), mat); m.receiveShadow = true; g.add(m); return m; };
    mesh(plane(600, 600, cx, -0.03, D / 2, 600, 600), tr.mat(new THREE.MeshLambertMaterial({ color: 0x9fbf88 })));
    const sideA = plane(xw, SIDEWALK_DEPTH, xc, 0.02, D + SIDEWALK_DEPTH / 2, 1, 1), sideB = plane(xw, SIDEWALK_DEPTH, xc, 0.02, farZ0 + SIDEWALK_DEPTH / 2, 1, 1);
    mesh(mergeGeometries([sideA, sideB], false)!, tr.mat(new THREE.MeshLambertMaterial({ color: 0xd3d8de, map: paverTex() })));
    sideA.dispose(); sideB.dispose();
    mesh(plane(xw, ROAD_WIDTH, xc, 0.0, roadZ0 + ROAD_WIDTH / 2, 4, 4), tr.mat(new THREE.MeshLambertMaterial({ color: 0x4b4f57, map: asphaltTex() })));
    // meios-fios e faixas
    const curb: Spec = ['matte', 0xbfc5cc], white: Spec = ['matte', 0xf3f3ee], yellow: Spec = ['matte', 0xf2c230];
    sb.box(xw, 0.12, 0.18, curb, xc, 0, roadZ0 + 0.03);
    sb.box(xw, 0.12, 0.18, curb, xc, 0, farZ0 - 0.03);
    sb.box(xw, 0.012, 0.12, white, xc, 0.0, roadZ0 + 2.0);
    sb.box(xw, 0.012, 0.12, white, xc, 0.0, D + LANES.parked - 1.15);
    const nd = Math.floor(xw / 3);
    for (let i = 0; i < nd; i++) sb.box(1.6, 0.012, 0.14, yellow, X0 + 1.5 + i * 3, 0, roadZ0 + 5);
    for (let i = 0; i < 9; i++) sb.box(3.0, 0.014, 0.55, white, -3.5, 0, roadZ0 + 0.6 + i * 1.08);
    // área de entregas (pintada) — legível vindo da loja
    const dz = deliveryZone(b);
    const dgeo = uvToCell(planeGeo(dz.w, dz.d).clone(), drawDelivery(dz.w / dz.d));
    dgeo.rotateX(-Math.PI / 2); dgeo.rotateY(Math.PI);
    sb.add(dgeo, ['decal', 0xffffff], dz.x + dz.w / 2, 0.028, dz.z + dz.d / 2); dgeo.dispose();
    // prédios: corpos numa malha (cor por vértice + janelas); detalhes no lote fosco
    const pal = [0xe9c9a0, 0xcfe0c3, 0xd9c3e6, 0xf2d6a2, 0xb9d3e8, 0xf0b7a4, 0xd8d8c8, 0xc3dcd2];
    const bodies: THREE.BufferGeometry[] = [];
    const bld = (x0: number, x1: number, zFront: number, depth: number, h: number, ci: number, dirFront: 1 | -1, shop: boolean): void => {
      const w = x1 - x0, color = new THREE.Color(pal[ci % pal.length]!);
      const bg = new THREE.BoxGeometry(w, h, depth); bg.translate(0, h / 2, 0);
      const uv = bg.getAttribute('uv') as THREE.BufferAttribute;
      const spans: [number, number][] = [[depth, h], [depth, h], [0, 0], [0, 0], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) {
        const [su, sv] = spans[f]!;
        for (let i = 0; i < 4; i++) {
          const k = f * 4 + i;
          if (su === 0) uv.setXY(k, 0.02, 0.02);
          else uv.setXY(k, uv.getX(k) * Math.max(1, Math.round(su / 3)), uv.getY(k) * Math.max(1, Math.round(sv / 3)));
        }
      }
      const px = (x0 + x1) / 2, pz = zFront - (dirFront * depth) / 2;
      bg.translate(px, 0, pz);
      const n = bg.getAttribute('position').count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
      bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      bodies.push(bg);
      sb.box(w + 0.3, 0.3, depth + 0.3, ['matte', 0x7d838d], px, h, pz);
      if (shop) {
        sb.box(w - 1.2, 2.9, 0.12, ['matte', 0x35505f], px, 0, zFront + dirFront * 0.03);
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
    let xf = -60;
    for (let i = 0; xf < W + 60; i++) { const w = 9 + Math.floor(hash01(i, 41) * 6); bld(xf, xf + w, farZ0 + SIDEWALK_DEPTH + 0.5, 12, 7 + hash01(i, 42) * 12, i, -1, i % 3 === 0); xf += w + 0.4; }
    const bm = new THREE.Mesh(tr.geo(mergeGeometries(bodies, false)!), this.bldMat); bm.receiveShadow = true; g.add(bm);
    bodies.forEach((q) => q.dispose());
    // postes (lâmpadas acendem à noite)
    const pole: Spec = ['metal', 0x2f3540];
    const lamps = new Batch();
    const post = (x: number, z: number, dir: 1 | -1, nav: boolean): void => {
      sb.add(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8).translate(0, 2.1, 0), pole, x, 0.02, z);
      sb.box(0.08, 0.08, 1.0, pole, x, 4.15, z - dir * 0.35);
      lamps.box(0.4, 0.12, 0.22, ['matte', 0xfff1c2], x, 4.05, z - dir * 0.75);
      if (nav) block(x, z);
    };
    for (const x of [-4.5, W / 2 + 4, W + 4.5]) post(x, D + 2.7, 1, true);
    for (const x of [-9, W / 2 - 2.5, W + 9]) post(x, farZ0 + 0.5, -1, false);
    const lampMesh = new THREE.Mesh(tr.geo(lamps.build().get('matte')!), this.lampMat); g.add(lampMesh);
    // lixeira verde de reciclagem (só existe depois da melhoria 'recycler'; grupo próprio, escondido por padrão)
    const rx = 0.42, rz = D + 0.42;
    const rb = new Batch(), RG: Spec = ['matte', 0x2f9a52], RD: Spec = ['matte', 0x1f7a3b], DK: Spec = ['matte', 0x17301f];
    const BH = 1.0, FEET = 0.07;
    rb.box(0.46, BH, 0.6, RG, rx, FEET, rz); rb.box(0.74, BH, 0.32, RG, rx, FEET, rz);
    for (const dx of [-0.23, 0.23]) for (const dz of [-0.16, 0.16]) rb.add(new THREE.CylinderGeometry(0.14, 0.14, BH, 12).translate(0, BH / 2, 0), RG, rx + dx, FEET, rz + dz);
    rb.add(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12).translate(0, 0.04, 0), RD, rx - 0.23, FEET + BH, rz - 0.16);
    rb.box(0.74, 0.07, 0.62, RD, rx, FEET + BH, rz);                    // tampa
    rb.box(0.5, 0.02, 0.26, DK, rx, FEET + BH + 0.07, rz + 0.04);        // painel/abertura escura em cima
    rb.box(0.4, 0.14, 0.03, DK, rx, 0.78, rz + 0.325);                   // abertura frontal escura
    for (const dx of [-0.26, 0.26]) for (const dz of [-0.2, 0.2]) rb.box(0.1, FEET, 0.1, DK, rx + dx - 0.05, 0, rz + dz - 0.05); // pezinhos
    decal(rb, DECAL.recycle(), 0.36, 0.36, rx, 0.45, rz + 0.33);
    this.recyclerGlow = new THREE.Group(); this.recyclerGlow.name = 'recycleBin';
    for (const m of meshesOf(rb.build(), this.recyclerGlow, { cast: false })) tr.geo(m.geometry);
    this.recyclerGlow.visible = this.recyclerOn; g.add(this.recyclerGlow);
    block(rx, rz);
    // caçamba cinza (lixeira do jogo): corpo, tampa entreaberta, papelão saindo, rodas, pictograma
    const tb = trashBinPos(b);
    const gray: Spec = ['matte', 0x6b7380];
    sb.box(0.78, 0.92, 0.8, gray, tb.x, 0.08, tb.z);
    sb.box(0.84, 0.06, 0.86, ['matte', 0x555c68], tb.x, 0.98, tb.z);
    sb.box(0.84, 0.05, 0.6, ['matte', 0x4b5260], tb.x, 1.12, tb.z - 0.2, { rx: -0.5 });
    sb.box(0.36, 0.3, 0.26, ['matte', 0xc99a5c], tb.x - 0.12, 0.86, tb.z + 0.12, { ry: 0.4, rz: 0.2 });
    sb.box(0.3, 0.26, 0.22, ['matte', 0xb4854a], tb.x + 0.16, 0.88, tb.z + 0.05, { ry: -0.3, rx: 0.25 });
    for (const dx of [-0.3, 0.3]) sb.add(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), ['matte', 0x1d2026], tb.x + dx, 0.08, tb.z - 0.36, { rz: Math.PI / 2 });
    decal(sb, DECAL.trash(), 0.34, 0.34, tb.x, 0.52, tb.z - 0.405, Math.PI);
    decal(sb, DECAL.trash(), 0.34, 0.34, tb.x, 0.52, tb.z + 0.405);
    block(tb.x, tb.z);
    // hidrante
    const hx = W / 2 + 2.6, hz = D + 2.6, red: Spec = ['matte', 0xd23b2e];
    sb.add(new THREE.CylinderGeometry(0.13, 0.15, 0.55, 10).translate(0, 0.275, 0), red, hx, 0.02, hz);
    sb.add(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red, hx, 0.57, hz);
    sb.add(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), red, hx, 0.4, hz, { rz: Math.PI / 2 });
    sb.add(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 10), ['matte', 0xa82c22], hx, 0.02, hz);
    block(hx, hz);
    // ponto de ônibus e bancos (calçada oposta)
    const bx = W / 2 + 8, bz = farZ0 + 1.8, met: Spec = ['metal', 0x55606e];
    for (const dx of [-1.45, 1.45]) sb.box(0.08, 2.4, 0.08, met, bx + dx, 0.02, bz + 0.5);
    sb.box(3.2, 0.08, 1.5, ['matte', 0x3a7bd5], bx, 2.42, bz);
    sb.box(3.0, 1.9, 0.04, ['glass', 0xcfeaf7], bx, 0.35, bz + 0.55);
    sb.box(0.04, 1.9, 1.0, ['glass', 0xcfeaf7], bx + 1.45, 0.35, bz + 0.05);
    decal(sb, DECAL.busAd(), 0.9, 0.9, bx - 0.9, 1.25, bz + 0.52, Math.PI);
    const bench = (x: number, z: number, w: number): void => {
      sb.box(w, 0.06, 0.42, ['matte', 0xc0703a], x, 0.45, z);
      sb.box(w, 0.36, 0.05, ['matte', 0xc0703a], x, 0.55, z + 0.22);
      for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) sb.box(0.06, 0.45, 0.4, ['matte', 0x3b4250], x + dx, 0, z);
    };
    bench(bx, bz + 0.25, 2.0);
    bench(W / 2 - 6, farZ0 + 2.3, 1.8);
    // carros estacionados (lote)
    for (const [i, x] of [-8.5, W / 2 - 1, W + 6.5].entries()) carParts(sb, CAR_COLORS[(i + 3) % CAR_COLORS.length]!, x, D + LANES.parked, i % 2 ? Math.PI : 0);
    // árvores outonais (uma malha; únicas do cenário externo a projetar sombra)
    const trees = new Batch();
    const leaves = [0xf2a33a, 0xe9762b, 0xf5c542, 0xd9582b];
    const tree = (x: number, z: number, i: number, nav: boolean): void => {
      const s = 0.9 + hash01(i, 51) * 0.35;
      trees.add(new THREE.CylinderGeometry(0.12, 0.17, 1.7, 6).translate(0, 0.85, 0), ['flat', 0x6d4a2c], x, 0.02, z, { ry: i, sx: s, sy: s, sz: s });
      trees.add(icoGeo(1.15, 0), ['flat', leaves[i % 4]!], x, 2.4 * s, z, { ry: i, sx: s, sy: s, sz: s });
      trees.add(icoGeo(0.85, 0), ['flat', leaves[(i + 1) % 4]!], x + 0.4 * s, 3.2 * s, z + 0.15, { ry: i, sx: s, sy: s, sz: s });
      trees.add(icoGeo(0.7, 0), ['flat', leaves[(i + 2) % 4]!], x - 0.45 * s, 2.9 * s, z - 0.2, { ry: i, sx: s, sy: s, sz: s });
      sb.box(0.9, 0.02, 0.9, ['matte', 0x5b4634], x, 0.03, z);
      if (nav) block(x, z);
    };
    const nearX = [-11, -6.5, -2.2, W + 2.2, W + 6.5];
    nearX.forEach((x, i) => tree(x, D + 2.4, i, true));
    [-14, -1, W / 2 + 3.5, W + 4, W + 13].forEach((x, i) => tree(x, farZ0 + 1.0, i + 7, false));
    for (const m of meshesOf(trees.build(), g, { cast: true })) { tr.geo(m.geometry); m.frustumCulled = false; }
    for (const m of meshesOf(sb.build(), g, { cast: false })) tr.geo(m.geometry);
    // carros em movimento (1 malha cada)
    this.cars = [];
    for (let i = 0; i < 4; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const car = new THREE.Mesh(tr.geo(carGeometry(CAR_COLORS[i]!)), kindMaterial('matte'));
      car.position.set(X0 + hash01(i, 61) * (X1 - X0), 0, D + (dir > 0 ? LANES.near : LANES.far));
      car.rotation.y = dir > 0 ? 0 : Math.PI;
      g.add(car);
      this.cars.push({ g: car, dir, speed: 4 + hash01(i, 62) * 4 });
    }
    // nuvens
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
    this.lastT = -1; this.sunT = -1; this.sunVersion++;
    freezeStatic(this.group, [this.sun, ...this.cars.map((c) => c.g)]); // só sol (setTime) e carros se movem
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
    // posição do sol em degraus de 0,5% do dia (~4 min de jogo, < 1°): cada passo refaz o mapa de sombra estático
    if (force || this.sunT < 0 || Math.abs(t - this.sunT) >= 0.005) {
      this.sunT = t;
      const ts = t, as = Math.sin(ts * Math.PI), R = 60;
      this.sun.position.set(this.sun.target.position.x + (ts * 2 - 1) * R * 0.8, 14 + 40 * as, this.sun.target.position.z + R * 0.55);
      this.sunVersion++;
    }
    lerpKeys(HEM_SKY, t, this.hemi.color, this.tmp);
    this.hemi.intensity = 1.0 + 0.2 * (1 - arc);
    const night = Math.max(0, Math.min(1, (t - 0.72) / 0.22));
    this.lampMat.emissiveIntensity = 0.2 + night * 2.2;
    this.bldMat.emissiveIntensity = night * 0.9;
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
    if (this.cloudT > 0.1) {
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
    this.cloudMesh = null; this.recyclerGlow = null;
  }
  dispose(): void {
    this.clearGeo();
    this.skyMat.dispose();
    this.bldMat.dispose();
    this.sun.shadow.map?.dispose();
  }
}
