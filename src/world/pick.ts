/**
 * Alvos de interação em 1ª pessoa (Fase 3): `group` = pickGroup do WorldService (proxies invisíveis:
 * material.visible=false, raycast funciona; userData.pick: PickInfo) e destaque com contorno verde.
 *
 * Contorno: os móveis são uma casca FUNDIDA (sem malha própria), então o destaque usa a silhueta simplificada
 * do alvo (caixas locais): 1) passe de stencil marca a silhueta visível; 2) o casco expandido (largura ~constante
 * em pixels, puxado um pouco para a câmera para aparecer também rente ao chão) só pinta fora dela. Resultado: só o
 * contorno externo, como no jogo de referência (sem linhas internas), 2 draw calls enquanto há destaque.
 * Sem stencil no contexto: casco por faces traseiras (método de core/outline.ts). Cor: OUTLINE_GREEN.
 */
import * as THREE from 'three';
import type { PickInfo } from '../core/services';
import { OUTLINE_GREEN } from '../core/outline';
import type { SBox } from './furniture';

interface Src { info: PickInfo; boxes: readonly SBox[]; matrix: THREE.Matrix4 }
const keyOf = (p: PickInfo): string => `${p.kind}:${p.id ?? ''}`;

const VERT = `uniform float uGrow; uniform float uBias;
void main(){
  vec4 mv0 = modelViewMatrix * vec4(position, 1.0);
  vec3 p = position + normal * (uGrow * max(1.0, -mv0.z));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xyz += normalize(-mv.xyz) * uBias;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }';

/** Caixas da silhueta numa geometria com "normais" de canto (±1,±1,±1): crescer k empurra cada face exatamente k. */
function hullGeometry(boxes: readonly SBox[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const [cx, cy, cz, w, h, d] of boxes) {
    const base = pos.length / 3;
    for (let i = 0; i < 8; i++) {
      const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 4 ? 1 : -1;
      pos.push(cx + (sx * w) / 2, cy + (sy * h) / 2, cz + (sz * d) / 2);
      nor.push(sx, sy, sz);
    }
    // 6 faces (CCW vistas de fora)
    const f = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
    for (const [a, b, c, e] of f) idx.push(base + a!, base + b!, base + c!, base + a!, base + c!, base + e!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Picks {
  /** pickGroup do WorldService. */
  readonly group = new THREE.Group();
  /** Malhas de destaque (fora do pickGroup). */
  readonly fx = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private used = 0;
  private unit = new THREE.BoxGeometry(1, 1, 1);
  private hidden = new THREE.MeshBasicMaterial({ visible: false });
  private srcs = new Map<string, Src>();
  private hullCache = new Map<string, THREE.BufferGeometry>();
  private stencilMesh: THREE.Mesh;
  private hullMesh: THREE.Mesh;
  private ring: THREE.Mesh;
  private cur: PickInfo | null = null;
  private tmp = new THREE.Matrix4();
  private S = new THREE.Matrix4();

  constructor(stencil: boolean) {
    this.group.name = 'pickGroup';
    this.fx.name = 'highlight';
    const uniforms = (grow: number, bias: number): Record<string, THREE.IUniform> => ({ uColor: { value: new THREE.Color(OUTLINE_GREEN) }, uGrow: { value: grow }, uBias: { value: bias } });
    const sMat = new THREE.ShaderMaterial({ uniforms: uniforms(0, 0.04), vertexShader: VERT, fragmentShader: FRAG, colorWrite: false, depthWrite: false });
    sMat.stencilWrite = true; sMat.stencilRef = 1; sMat.stencilFunc = THREE.AlwaysStencilFunc; sMat.stencilZPass = THREE.ReplaceStencilOp;
    const hMat = new THREE.ShaderMaterial({ uniforms: uniforms(0.009, stencil ? 0.12 : 0), vertexShader: VERT, fragmentShader: FRAG, depthWrite: false, side: stencil ? THREE.FrontSide : THREE.BackSide });
    if (stencil) { hMat.stencilWrite = true; hMat.stencilRef = 1; hMat.stencilFunc = THREE.NotEqualStencilFunc; hMat.stencilZPass = THREE.KeepStencilOp; }
    this.stencilMesh = new THREE.Mesh(this.unit, sMat);
    this.hullMesh = new THREE.Mesh(this.unit, hMat);
    for (const [m, o] of [[this.stencilMesh, 10], [this.hullMesh, 11]] as const) { m.renderOrder = o; m.matrixAutoUpdate = false; m.visible = false; m.frustumCulled = false; this.fx.add(m); }
    this.stencilMesh.visible = false;
    if (!stencil) this.stencilMesh.removeFromParent();
    const rg = new THREE.RingGeometry(0.33, 0.39, 32); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: OUTLINE_GREEN, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.ring.visible = false; this.ring.renderOrder = 11; this.fx.add(this.ring);
  }

  /** Começa a reconstrução dos alvos. */
  begin(): void { this.used = 0; this.srcs.clear(); }
  /** Registra um alvo: um proxy por caixa da silhueta (mesma PickInfo) e a fonte do contorno. */
  add(info: PickInfo, boxes: readonly SBox[], matrix: THREE.Matrix4): void {
    this.srcs.set(keyOf(info), { info, boxes, matrix: matrix.clone() });
    for (const [cx, cy, cz, w, h, d] of boxes) {
      let m = this.pool[this.used];
      if (!m) {
        m = new THREE.Mesh(this.unit, this.hidden);
        m.matrixAutoUpdate = false;
        this.pool.push(m);
      }
      this.used++;
      this.S.makeScale(Math.max(0.05, w), Math.max(0.05, h), Math.max(0.05, d)).setPosition(cx, cy, cz);
      m.matrix.multiplyMatrices(matrix, this.S);
      m.matrixWorldNeedsUpdate = true;
      m.userData.pick = info;
      if (m.parent !== this.group) this.group.add(m);
    }
  }
  /** Fim da reconstrução: remove proxies sobrando e reaplica o destaque atual. */
  end(): void {
    for (let i = this.used; i < this.pool.length; i++) { const m = this.pool[i]!; if (m.parent) m.parent.remove(m); }
    this.highlight(this.cur);
  }

  /** Contorno no alvo (null remove). Tolera alvos que deixaram de existir. */
  highlight(p: PickInfo | null): void {
    this.cur = p ? { kind: p.kind, id: p.id } : null;
    const src = p ? this.srcs.get(keyOf(p)) : undefined;
    this.stencilMesh.visible = this.hullMesh.visible = this.ring.visible = false;
    if (!src) return;
    if (src.info.kind === 'dirt') {
      this.ring.position.setFromMatrixPosition(src.matrix); this.ring.position.y = 0.03;
      this.ring.visible = true;
      return;
    }
    const key = src.boxes.map((b) => b.map((n) => n.toFixed(3)).join(',')).join('|');
    let geo = this.hullCache.get(key);
    if (!geo) {
      if (this.hullCache.size > 64) { this.hullCache.forEach((g) => g.dispose()); this.hullCache.clear(); }
      geo = hullGeometry(src.boxes);
      this.hullCache.set(key, geo);
    }
    for (const m of [this.stencilMesh, this.hullMesh]) {
      m.geometry = geo;
      m.matrix.copy(src.matrix);
      m.matrixWorldNeedsUpdate = true;
      m.visible = !!m.parent;
    }
  }
  get current(): PickInfo | null { return this.cur; }
  /** Debug/testes: alvos registrados. */
  list(): PickInfo[] { return [...this.srcs.values()].map((s) => s.info); }
  /** Centro de mundo de um alvo (setas/POI); null se não existe. */
  centerOf(p: PickInfo, out: THREE.Vector3): THREE.Vector3 | null {
    const s = this.srcs.get(keyOf(p));
    if (!s || !s.boxes.length) return null;
    let top = -Infinity;
    for (const b of s.boxes) top = Math.max(top, b[1] + b[4] / 2);
    const b0 = s.boxes[0]!;
    return out.set(b0[0], top, b0[2]).applyMatrix4(s.matrix);
  }
  dispose(): void {
    this.unit.dispose(); this.hidden.dispose();
    this.hullCache.forEach((g) => g.dispose()); this.hullCache.clear();
    (this.stencilMesh.material as THREE.Material).dispose(); (this.hullMesh.material as THREE.Material).dispose();
    this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose();
    this.group.clear(); this.fx.clear();
    void this.tmp;
  }
}
