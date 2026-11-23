/**
 * Objetos do caixa (arte original): leque de notas de real e cartão (CanvasTexture), com "contorno verde" plano
 * (halo atrás do objeto, já que o casco invertido de core/outline não funciona em objetos finos) e produto de
 * reserva para a esteira quando o world não publica makeProductMesh. Geometrias/materiais compartilhados.
 */
import * as THREE from 'three';
import { OUTLINE_GREEN } from '../core/outline';
import { PRODUCTS } from '../sim/catalog';

const BILLS = [2, 5, 10, 20, 50, 100] as const;
const BILL_COL: Record<number, [string, string]> = {
  2: ['#8fb3d4', '#2f5677'], 5: ['#c4a6e0', '#5b3a82'], 10: ['#ef9a8a', '#8f2f3a'],
  20: ['#f3cd6a', '#8a5a10'], 50: ['#e8b07a', '#7a3f12'], 100: ['#8fd0ec', '#1d6b8f'],
};
const BW = 0.17, BH = 0.08;
const CW = 0.11, CH = 0.07;

interface Shared {
  billTex: THREE.CanvasTexture; billMat: THREE.MeshLambertMaterial; billGeo: Map<number, THREE.BufferGeometry>;
  cardTex: THREE.CanvasTexture; cardMat: THREE.MeshLambertMaterial; cardGeo: THREE.BufferGeometry[];
  haloMat: THREE.MeshBasicMaterial; billHalo: THREE.BufferGeometry; cardHalo: THREE.BufferGeometry;
  prodGeo: Map<string, THREE.BufferGeometry>; prodMat: Map<string, THREE.MeshLambertMaterial>;
}
let S: Shared | null = null;

function drawBill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number): void {
  const [light, dark] = BILL_COL[v]!;
  g.fillStyle = light; g.fillRect(x, y, w, h);
  g.strokeStyle = dark; g.lineWidth = 6; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
  g.globalAlpha = 0.25; g.fillStyle = dark;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(x + w * 0.62, y + h / 2, 10 + i * 6, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = dark; g.stroke(); }
  g.globalAlpha = 1;
  g.fillStyle = dark; g.beginPath(); g.arc(x + w * 0.62, y + h / 2, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = light; g.beginPath(); g.arc(x + w * 0.62, y + h / 2, 19, 0, Math.PI * 2); g.fill();
  g.fillStyle = dark; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('★', x + w * 0.62, y + h / 2 + 1);
  g.font = 'bold 46px sans-serif'; g.textAlign = 'left';
  g.fillText(String(v), x + 18, y + 38);
  g.font = 'bold 22px sans-serif';
  g.fillText('REAIS', x + 18, y + h - 26);
  g.textAlign = 'right'; g.font = 'bold 30px sans-serif';
  g.fillText(String(v), x + w - 16, y + h - 24);
}
function drawCard(g: CanvasRenderingContext2D, y: number, c1: string, c2: string): void {
  const gr = g.createLinearGradient(0, y, 256, y + 160);
  gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr;
  g.beginPath(); g.roundRect(0, y, 256, 160, 18); g.fill();
  g.globalAlpha = 0.18; g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(210, y + 20, 110, 70, -0.5, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.fillStyle = '#e8c45a'; g.beginPath(); g.roundRect(26, y + 52, 44, 34, 6); g.fill();
  g.strokeStyle = '#b08a2a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(26, y + 69); g.lineTo(70, y + 69); g.moveTo(48, y + 52); g.lineTo(48, y + 86); g.stroke();
  g.strokeStyle = '#ffffff'; g.lineWidth = 3;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(88, y + 69, 8 + i * 7, -0.7, 0.7); g.stroke(); }
  g.fillStyle = '#ffffff'; g.font = 'bold 20px monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('•••• •••• •••• 4821', 24, y + 116);
  g.font = 'bold 16px sans-serif'; g.fillText('CRÉDITO', 24, y + 26);
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(220, y + 132, 13, 0, Math.PI * 2); g.fill();
  g.fillStyle = c1; g.beginPath(); g.arc(220, y + 132, 7, 0, Math.PI * 2); g.fill();
}
function uvRect(geo: THREE.BufferGeometry, u0: number, v0: number, u1: number, v1: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

function shared(): Shared {
  if (S) return S;
  const bc = document.createElement('canvas'); bc.width = 768; bc.height = 256;
  const bg = bc.getContext('2d')!;
  const billGeo = new Map<number, THREE.BufferGeometry>();
  BILLS.forEach((v, i) => {
    const cx = (i % 3) * 256, cy = Math.floor(i / 3) * 128;
    drawBill(bg, cx, cy, 256, 120, v);
    // pivô na base central (pega da mão)
    const g = new THREE.PlaneGeometry(BW, BH).translate(0, BH / 2 - 0.012, 0);
    uvRect(g, cx / 768, 1 - (cy + 120) / 256, (cx + 256) / 768, 1 - cy / 256);
    billGeo.set(v, g);
  });
  const billTex = new THREE.CanvasTexture(bc); billTex.colorSpace = THREE.SRGBColorSpace; billTex.anisotropy = 4;
  const cc = document.createElement('canvas'); cc.width = 256; cc.height = 480;
  const cg = cc.getContext('2d')!;
  const cols: [string, string][] = [['#2f6fd0', '#173a7a'], ['#2f9e5b', '#145a32'], ['#3a3a42', '#111116']];
  const cardGeo = cols.map(([a, b], i) => {
    drawCard(cg, i * 160, a, b);
    return uvRect(new THREE.PlaneGeometry(CW, CH).translate(CW / 2 - 0.018, CH / 2 - 0.012, 0), 0, 1 - (i * 160 + 160) / 480, 1, 1 - (i * 160) / 480);
  });
  const cardTex = new THREE.CanvasTexture(cc); cardTex.colorSpace = THREE.SRGBColorSpace; cardTex.anisotropy = 4;
  const pad = 0.012;
  S = {
    billTex, billGeo, billMat: new THREE.MeshLambertMaterial({ map: billTex, side: THREE.DoubleSide, emissive: 0x222222 }),
    cardTex, cardGeo, cardMat: new THREE.MeshLambertMaterial({ map: cardTex, side: THREE.DoubleSide, emissive: 0x222222 }),
    haloMat: new THREE.MeshBasicMaterial({ color: OUTLINE_GREEN, side: THREE.DoubleSide }),
    billHalo: new THREE.PlaneGeometry(BW + pad, BH + pad).translate(0, BH / 2 - 0.012, 0),
    cardHalo: new THREE.PlaneGeometry(CW + pad, CH + pad).translate(CW / 2 - 0.018, CH / 2 - 0.012, 0),
    prodGeo: new Map(), prodMat: new Map(),
  };
  return S;
}

/** Composição das notas do leque para `paid` (centavos): 2–5 notas sempre que possível. */
export function fanBills(paid: number): number[] {
  let rest = Math.max(2, Math.round(paid / 100));
  const out: number[] = [];
  for (const d of [100, 50, 20, 10, 5, 2]) while (rest >= d && out.length < 5) { out.push(d); rest -= d; }
  if (out.length === 1) {
    const split: Record<number, number[]> = { 100: [50, 20, 20, 10], 50: [20, 20, 10], 20: [10, 5, 5], 10: [5, 5], 5: [2, 2], 2: [2] };
    return split[out[0]!] ?? out;
  }
  return out;
}

/** Notas em leque OU cartão na mão do cliente. Frente para +z (use lookAt para virar para o operador). */
export class PayProp {
  readonly group = new THREE.Group();
  private readonly bills: THREE.Mesh[] = [];
  private readonly halos: THREE.Mesh[] = [];
  private readonly card: THREE.Mesh;
  private readonly cardHalo: THREE.Mesh;
  constructor() {
    const s = shared();
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(s.billGeo.get(20)!, s.billMat);
      const h = new THREE.Mesh(s.billHalo, s.haloMat);
      h.renderOrder = -1;
      this.bills.push(b); this.halos.push(h);
      this.group.add(b, h);
    }
    this.card = new THREE.Mesh(s.cardGeo[0]!, s.cardMat);
    this.cardHalo = new THREE.Mesh(s.cardHalo, s.haloMat);
    this.cardHalo.position.z = -0.003;
    this.group.add(this.card, this.cardHalo);
    this.group.visible = false;
    this.group.name = 'npc-pay';
    this.group.userData.npcPay = true;
  }
  /** Mostra notas (cash: `paid` em centavos) ou cartão (variante de cor pela semente). */
  show(method: 'cash' | 'card', paid: number, seed: number): void {
    const s = shared();
    const list = method === 'cash' ? fanBills(paid) : [];
    const n = list.length;
    for (let i = 0; i < 5; i++) {
      const b = this.bills[i]!, h = this.halos[i]!;
      const on = i < n;
      b.visible = on; h.visible = on;
      if (!on) continue;
      b.geometry = s.billGeo.get(list[i]!) ?? s.billGeo.get(20)!;
      const a = (i - (n - 1) / 2) * 0.24;
      b.rotation.set(0, 0, -a); h.rotation.set(0, 0, -a);
      b.position.set(0, 0, 0.0015 * i);
      h.position.set(0, 0, -0.004);
    }
    this.card.visible = method === 'card';
    this.cardHalo.visible = method === 'card';
    if (method === 'card') this.card.geometry = s.cardGeo[Math.abs(Math.floor(seed)) % s.cardGeo.length]!;
    this.group.visible = true;
  }
  setHalo(on: boolean): void {
    for (let i = 0; i < 5; i++) this.halos[i]!.visible = on && this.bills[i]!.visible;
    this.cardHalo.visible = on && this.card.visible;
  }
  hide(): void { this.group.visible = false; }
}

/* ---------------- produto de reserva ---------------- */
function productGeo(shape: string): THREE.BufferGeometry {
  const s = shared();
  let g = s.prodGeo.get(shape);
  if (g) return g;
  switch (shape) {
    case 'bottle': g = new THREE.CylinderGeometry(0.04, 0.045, 0.2, 10).translate(0, 0.1, 0); break;
    case 'can': g = new THREE.CylinderGeometry(0.034, 0.034, 0.11, 12).translate(0, 0.055, 0); break;
    case 'jar': g = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12).translate(0, 0.06, 0); break;
    case 'tray': g = new THREE.BoxGeometry(0.16, 0.05, 0.12).translate(0, 0.025, 0); break;
    case 'bag': g = new THREE.CapsuleGeometry(0.05, 0.1, 3, 8).scale(1.3, 1, 0.6).translate(0, 0.1, 0); break;
    default: g = new THREE.BoxGeometry(0.11, 0.15, 0.07).translate(0, 0.075, 0); break;
  }
  s.prodGeo.set(shape, g);
  return g;
}
/** Malha simples do produto (origem na base), quando o world não fornece makeProductMesh. */
export function fallbackProductMesh(productId: string): THREE.Object3D {
  const s = shared();
  const p = PRODUCTS.find((x) => x.id === productId);
  const color = p?.color ?? '#9aa3ab';
  let m = s.prodMat.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); s.prodMat.set(color, m); }
  return new THREE.Mesh(productGeo(p?.shape ?? 'box'), m);
}

export function disposeProps(): void {
  if (!S) return;
  S.billTex.dispose(); S.billMat.dispose(); S.cardTex.dispose(); S.cardMat.dispose(); S.haloMat.dispose();
  for (const g of S.billGeo.values()) g.dispose();
  for (const g of S.cardGeo) g.dispose();
  S.billHalo.dispose(); S.cardHalo.dispose();
  for (const g of S.prodGeo.values()) g.dispose();
  for (const m of S.prodMat.values()) m.dispose();
  S = null;
}
