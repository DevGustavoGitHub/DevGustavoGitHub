/**
 * Atlas de texturas (um CanvasTexture e um material por atlas): placas de prateleira e etiquetas das caixas.
 * Trocar N texturas/materiais por 1 permite fundir geometria e instanciar sem multiplicar draw calls.
 */
import * as THREE from 'three';
import { PRODUCTS, productById } from '../sim/catalog';
import { makeCanvas, canvasTex } from './kit';
import { categoryColor, css } from './look';

export interface Cell { u0: number; v0: number; du: number; dv: number }

class Atlas {
  readonly tex: THREE.CanvasTexture;
  private cells = new Map<string, Cell>();
  readonly white: Cell;
  constructor(keys: string[], private cols: number, cellW: number, cellH: number, draw: (g: CanvasRenderingContext2D, key: string, w: number, h: number) => void) {
    const all = ['\0white', ...keys];
    const rows = Math.ceil(all.length / cols);
    const h = Math.max(24, Math.min(cellH, Math.floor(2048 / rows)));
    const { c, g } = makeCanvas(cellW * cols, h * rows);
    all.forEach((k, i) => {
      const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * h;
      g.save(); g.translate(cx, cy); g.beginPath(); g.rect(0, 0, cellW, h); g.clip();
      if (i === 0) { g.fillStyle = '#fff'; g.fillRect(0, 0, cellW, h); } else draw(g, k, cellW, h);
      g.restore();
      this.cells.set(k, { u0: (i % cols) / cols, v0: 1 - (Math.floor(i / cols) + 1) / rows, du: 1 / cols, dv: 1 / rows });
    });
    this.white = this.cells.get('\0white')!;
    this.tex = canvasTex(c);
  }
  cell(key: string): Cell { return this.cells.get(key) ?? this.cells.get('\0white')!; }
  dispose(): void { this.tex.dispose(); }
}

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = '800'): number {
  let s = size;
  do { g.font = `${weight} ${s}px system-ui, sans-serif`; s -= 2; } while (g.measureText(text).width > maxW && s > 8);
  return s;
}

/** Remapeia os UVs (0..1) de uma geometria para uma célula do atlas. */
export function uvToCell(g: THREE.BufferGeometry, c: Cell): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, c.u0 + uv.getX(i) * c.du, c.v0 + uv.getY(i) * c.dv);
  uv.needsUpdate = true;
  return g;
}
/** Aponta todos os UVs para o centro da célula branca (cor = só vértice). */
export function uvToWhite(g: THREE.BufferGeometry, c: Cell): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const u = c.u0 + c.du * 0.5, v = c.v0 + c.dv * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  uv.needsUpdate = true;
  return g;
}

/* ---- placas de topo de prateleira ---- */
let signs: Atlas | null = null;
let signMat: THREE.MeshStandardMaterial | null = null;
const signAtlas = (): Atlas => signs ??= new Atlas(['-', ...PRODUCTS.map((p) => p.id)], 2, 512, 96, (g, key, w, h) => {
  const pid = key === '-' ? undefined : key;
  g.fillStyle = css(categoryColor(pid)); g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, w, h * 0.125);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let text = 'VAZIO';
  if (pid) { try { text = productById(pid).name; } catch { text = pid; } }
  fitText(g, text, w * 0.9, h * 0.58);
  g.fillText(text, w / 2, h * 0.54);
});
export const signCell = (pid: string | undefined): Cell => signAtlas().cell(pid ?? '-');
export function signMaterial(): THREE.MeshStandardMaterial {
  if (!signMat) {
    const a = signAtlas();
    signMat = new THREE.MeshStandardMaterial({ map: a.tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: a.tex, emissiveIntensity: 0.14 });
  }
  return signMat;
}

/* ---- etiquetas das caixas de papelão ---- */
let labels: Atlas | null = null;
let labelMat: THREE.MeshStandardMaterial | null = null;
const labelAtlas = (): Atlas => labels ??= new Atlas(PRODUCTS.map((p) => p.id), 4, 256, 128, (g, pid, w, h) => {
  g.fillStyle = '#fbfaf4'; g.fillRect(0, 0, w, h);
  g.fillStyle = css(categoryColor(pid)); g.fillRect(0, 0, w, h * 0.2);
  g.fillStyle = '#222'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let name = pid;
  try { name = productById(pid).name; } catch { /* id desconhecido */ }
  const words = name.split(' ');
  const l1 = words.length > 1 ? words.slice(0, -1).join(' ') : name;
  const l2 = words.length > 1 ? words[words.length - 1]! : '';
  const s = fitText(g, l1.length > l2.length ? l1 : l2 || l1, w * 0.86, h * 0.31);
  g.font = `800 ${s}px system-ui, sans-serif`;
  g.fillText(l1, w / 2, l2 ? h * 0.45 : h * 0.56);
  if (l2) g.fillText(l2, w / 2, h * 0.45 + s);
  g.fillStyle = '#222';
  for (let i = 0; i < 28; i++) g.fillRect(w * 0.094 + i * (w * 0.027), h * 0.81, (i * 7) % 3 === 0 ? w * 0.012 : w * 0.008, h * 0.125);
});
export const labelCell = (pid: string): Cell => labelAtlas().cell(pid);
export const whiteCell = (): Cell => labelAtlas().white;
export function labelMaterial(): THREE.MeshStandardMaterial {
  return labelMat ??= new THREE.MeshStandardMaterial({ map: labelAtlas().tex, vertexColors: true, roughness: 0.85 });
}
