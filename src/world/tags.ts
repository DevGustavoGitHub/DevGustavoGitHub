/**
 * Etiquetas de preço POR NÍVEL (Fase 4) na frente de prateleiras/geladeiras/freezers: ponto com a cor do produto +
 * "R$ 8,70", ou "--" quando o nível tem sem unidades (só "--": sem foto/nome/preço, mesmo sem produto).
 * Um atlas de canvas (por produto: célula de preço, redesenhada só quando o preço muda, e célula "--") e UMA malha
 * fundida com todas as etiquetas (reconstruída quando móveis/etiquetas/esgotado mudam; poucos quads) = 1 draw call.
 */
import * as THREE from 'three';
import type { Furniture } from '../sim/state';
import { PRODUCTS } from '../sim/catalog';
import { canvasTex } from './kit';
import { categoryColor, css } from './look';
import { drawIcon, shortName } from './labels';
import { levelGeoms } from './furniture';
import { footprintOf } from './nav';

const COLS = 4, CW = 1024, CELL_H = 96, TW = 0.35, TH = 0.131;
const cellW = Math.floor(CW / COLS);
const KEYS = ['-', ...PRODUCTS.flatMap((p) => [p.id, `${p.id}|-`])];
const ROWS = Math.ceil(KEYS.length / COLS);
const CH = 2 ** Math.ceil(Math.log2(ROWS * CELL_H));
const brl = (c: number): string => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Etiqueta de um nível: produto (undefined = sem etiqueta) e se está esgotado (0 unidades). */
export interface TagLevel { pid?: string; empty: boolean }

export class PriceTags {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private cells = new Map<string, number>();
  private sigs = new Map<string, string>();
  private stocked = new Map<string, boolean>();
  private placed: { id: number; level: number; pid: string; empty: boolean }[] = [];
  private geoKey = '';
  constructor() {
    this.canvas.width = CW; this.canvas.height = CH;
    this.g = this.canvas.getContext('2d')!;
    this.tex = canvasTex(this.canvas); this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: this.tex }));
    this.mesh.name = 'priceTags'; this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
    KEYS.forEach((k, i) => this.cells.set(k, i));
    for (const k of KEYS) this.draw(k, null); // preço real chega no 1º refresh
  }
  private uv(key: string): [number, number, number, number] {
    const i = this.cells.get(key) ?? 0;
    const c = i % COLS, r = Math.floor(i / COLS);
    return [(c * cellW + 2) / CW, 1 - ((r + 1) * CELL_H - 2) / CH, (cellW - 4) / CW, (CELL_H - 4) / CH];
  }
  private draw(key: string, price: number | null): void {
    const i = this.cells.get(key);
    if (i === undefined) return;
    const pid = key === '-' ? undefined : key.split('|')[0];
    const g = this.g, x = (i % COLS) * cellW, y = Math.floor(i / COLS) * CELL_H, w = cellW, h = CELL_H;
    g.clearRect(x, y, w, h);
    g.fillStyle = '#ffe600'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = '#e0b800'; g.fillRect(x + 2, y + h - 10, w - 4, 8);
    g.strokeStyle = '#1d2128'; g.lineWidth = 4; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    let tx = x + 12, tw = w - 24;
    if (pid) {
      const t = h - 22, ty = y + 11;
      g.fillStyle = css(categoryColor(pid)); g.fillRect(x + 11, ty, t, t);
      g.strokeStyle = '#1d2128'; g.lineWidth = 3; g.strokeRect(x + 11, ty, t, t);
      g.fillStyle = 'rgba(255,255,255,0.93)'; g.beginPath(); g.arc(x + 11 + t / 2, ty + t / 2, t * 0.45, 0, Math.PI * 2); g.fill();
      drawIcon(g, pid, x + 11 + t / 2, ty + t / 2, t * 0.43);
      tx = x + t + 22; tw = w - t - 34;
    }
    g.fillStyle = '#0b0d10'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const cx = tx + tw / 2;
    if (pid) {
      const nm = shortName(pid);
      let s = 22; do { g.font = `800 ${s}px system-ui, Arial, sans-serif`; s -= 2; } while (g.measureText(nm).width > tw && s > 10);
      g.fillText(nm, cx, y + 21);
    }
    const py = y + (pid ? h * 0.66 : h / 2);
    if (price === null) {
      g.font = '900 54px system-ui, Arial, sans-serif'; g.fillText('--', cx, py);
    } else {
      const num = (price / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      let s = 56;
      do { g.font = `900 ${s}px system-ui, Arial, sans-serif`; const n = g.measureText(num).width; g.font = `900 ${Math.round(s * 0.45)}px system-ui, Arial, sans-serif`; if (n + g.measureText('R$ ').width <= tw) break; s -= 2; } while (s > 14);
      g.font = `900 ${Math.round(s * 0.45)}px system-ui, Arial, sans-serif`; const rw = g.measureText('R$ ').width;
      g.font = `900 ${s}px system-ui, Arial, sans-serif`; const nw = g.measureText(num).width, x0 = cx - (rw + nw) / 2;
      g.textAlign = 'left'; g.fillText(num, x0 + rw, py);
      g.font = `900 ${Math.round(s * 0.45)}px system-ui, Arial, sans-serif`; g.fillText('R$', x0, py - s * 0.14);
    }
    this.tex.needsUpdate = true;
  }
  /** Redesenha as células de preço que mudaram. `price(pid)` em centavos. */
  refresh(pids: Iterable<string>, price: (pid: string) => number): void {
    for (const pid of pids) {
      if (!this.cells.has(pid)) continue;
      let p = 0;
      try { p = price(pid); } catch { p = 0; }
      const sig = String(p);
      if (this.sigs.get(pid) === sig) continue;
      this.sigs.set(pid, sig);
      this.draw(pid, p);
    }
  }
  /** Reconstrói os quads: uma etiqueta por nível com produto (célula de preço, ou "--" se esgotado). */
  rebuild(list: readonly { f: Furniture; levels: readonly TagLevel[] }[]): void {
    const key = list.map(({ f, levels }) => `${f.id}:${f.type}:${f.x}:${f.z}:${f.rot}:${levels.map((l) => (l.pid && !l.empty ? l.pid : '-')).join('/')}`).join(',');
    if (key === this.geoKey) return;
    this.geoKey = key;
    this.placed = []; this.stocked.clear();
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const { f, levels } of list) {
      const geoms = levelGeoms(f.type, levels.length);
      const fp = footprintOf(f);
      const cx = f.x + fp.w / 2, cz = f.z + fp.d / 2, t = (f.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      levels.forEach((l, li) => {
        const a = geoms[li];
        if (!a) return;
        const pid = l.pid ?? '', empty = l.empty || !pid;
        this.placed.push({ id: f.id, level: li, pid, empty });
        if (pid) this.stocked.set(pid, (this.stocked.get(pid) ?? false) || !empty);
        const [u0, v0, du, dv] = this.uv(!empty && this.cells.has(pid) ? pid : '-');
        const base = pos.length / 3;
        for (const [lx, ly, uu, vv] of [[-TW / 2, -TH / 2, 0, 0], [TW / 2, -TH / 2, 1, 0], [TW / 2, TH / 2, 1, 1], [-TW / 2, TH / 2, 0, 1]] as const) {
          const px = a.tag[0] + lx, pz = a.tag[2];
          pos.push(cx + px * c + pz * s, a.tag[1] + ly, cz - px * s + pz * c);
          uv.push(u0 + uu * du, v0 + vv * dv);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }
  /** Debug/testes: por produto exposto → "-" (todos os níveis dele esgotados) ou preço em centavos. */
  info(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [pid, any] of this.stocked) out[pid] = any ? (this.sigs.get(pid) ?? '0') : '-';
    return out;
  }
  /** Debug/testes: etiquetas por nível (móvel, nível, produto, texto). */
  levels(): { id: number; level: number; pid: string; text: string }[] {
    return this.placed.map((p) => ({ id: p.id, level: p.level, pid: p.pid, text: p.empty ? '--' : brl(Number(this.sigs.get(p.pid) ?? 0)) }));
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.tex.dispose(); }
}
