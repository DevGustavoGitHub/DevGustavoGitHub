/**
 * Etiquetas de preço na frente de prateleiras/geladeiras/freezers: ponto com a cor do produto + "R$ 8,70",
 * ou "--" quando o produto está esgotado na prateleira (ou o móvel não tem produto).
 * Um atlas de canvas (uma célula por produto, redesenhada só quando preço/esgotado mudam) e UMA malha fundida
 * com todas as etiquetas (reconstruída só quando os móveis mudam) = 1 draw call.
 */
import * as THREE from 'three';
import type { Furniture } from '../sim/state';
import { PRODUCTS } from '../sim/catalog';
import { canvasTex } from './kit';
import { categoryColor, css } from './look';
import { tagAnchor } from './furniture';
import { footprintOf } from './nav';

const COLS = 6, ROWS = 8, CW = 1024, CH = 512, TW = 0.2, TH = 0.075;
const cellW = Math.floor(CW / COLS), cellH = Math.floor(CH / ROWS);
const brl = (c: number): string => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export class PriceTags {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private cells = new Map<string, number>();
  private sigs = new Map<string, string>();
  private geoKey = '';
  constructor() {
    this.canvas.width = CW; this.canvas.height = CH;
    this.g = this.canvas.getContext('2d')!;
    this.tex = canvasTex(this.canvas); this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: this.tex }));
    this.mesh.name = 'priceTags'; this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
    ['-', ...PRODUCTS.map((p) => p.id)].forEach((k, i) => this.cells.set(k, i));
    this.draw('-', null);
  }
  private uv(key: string): [number, number, number, number] {
    const i = this.cells.get(key) ?? 0;
    const c = i % COLS, r = Math.floor(i / COLS);
    return [(c * cellW + 2) / CW, 1 - ((r + 1) * cellH - 2) / CH, (cellW - 4) / CW, (cellH - 4) / CH];
  }
  private draw(key: string, price: number | null): void {
    const i = this.cells.get(key);
    if (i === undefined) return;
    const g = this.g, x = (i % COLS) * cellW, y = Math.floor(i / COLS) * cellH, w = cellW, h = cellH;
    g.clearRect(x, y, w, h);
    g.fillStyle = '#ffd84d'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 2, y + h - 8, w - 4, 6);
    g.fillStyle = key === '-' ? '#9aa3ad' : css(categoryColor(key));
    g.beginPath(); g.arc(x + 26, y + h / 2 - 1, 14, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#1d2128'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = price === null ? '--' : brl(price);
    let s = 34;
    do { g.font = `900 ${s}px system-ui, Arial, sans-serif`; s -= 2; } while (g.measureText(text).width > w - 58 && s > 10);
    g.fillText(text, x + 26 + (w - 26) / 2 + 6, y + h / 2);
    this.tex.needsUpdate = true;
  }
  /** Redesenha as células cujo preço/esgotado mudou. `price(pid)` em centavos. */
  refresh(pids: Iterable<string>, price: (pid: string) => number, stock: (pid: string) => number): void {
    for (const pid of pids) {
      if (!this.cells.has(pid)) continue;
      const empty = stock(pid) <= 0;
      let p = 0;
      if (!empty) { try { p = price(pid); } catch { p = 0; } }
      const sig = empty ? '-' : String(p);
      if (this.sigs.get(pid) === sig) continue;
      this.sigs.set(pid, sig);
      this.draw(pid, empty ? null : p);
    }
  }
  /** Reconstrói os quads (um por móvel de exposição). */
  rebuild(furniture: readonly Furniture[], hiddenId: number | null): void {
    const list = furniture.filter((f) => f.id !== hiddenId && tagAnchor(f.type));
    const key = list.map((f) => `${f.id}:${f.type}:${f.x}:${f.z}:${f.rot}:${f.productId ?? ''}`).join(',');
    if (key === this.geoKey) return;
    this.geoKey = key;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const f of list) {
      const a = tagAnchor(f.type)!;
      const fp = footprintOf(f);
      const cx = f.x + fp.w / 2, cz = f.z + fp.d / 2, t = (f.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      const [u0, v0, du, dv] = this.uv(f.productId && this.cells.has(f.productId) ? f.productId : '-');
      const base = pos.length / 3;
      for (const [lx, ly, uu, vv] of [[-TW / 2, -TH / 2, 0, 0], [TW / 2, -TH / 2, 1, 0], [TW / 2, TH / 2, 1, 1], [-TW / 2, TH / 2, 0, 1]] as const) {
        const px = a.x + lx, pz = a.z;
        pos.push(cx + px * c + pz * s, a.y + ly, cz - px * s + pz * c);
        uv.push(u0 + uu * du, v0 + vv * dv);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }
  /** Assinaturas atuais (debug/testes): pid → "-" (esgotado) ou preço em centavos. */
  info(): Record<string, string> { return Object.fromEntries(this.sigs); }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.tex.dispose(); }
}
