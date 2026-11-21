/** Balões de fala como Sprites (CanvasTexture em cache, compartilhados). Ícones de humor desenhados no canvas (sem fontes de emoji). */
import * as THREE from 'three';
import type { BubbleKey } from './shared';

interface Def { text?: string; color: string; mood?: 'happy' | 'angry' | 'neutral' | 'sad' | 'coin' }
const DEFS: Record<BubbleKey, Def> = {
  caro: { text: 'Caro!', color: '#c62828' },
  obrigado: { text: 'Obrigado!', color: '#2e7d32' },
  semestoque: { text: 'Sem estoque', color: '#6d4c41' },
  demora: { text: 'Que demora!', color: '#c62828' },
  oops: { text: 'Opa!', color: '#ef6c00' },
  happy: { color: '#2e7d32', mood: 'happy' },
  angry: { color: '#c62828', mood: 'angry' },
  neutral: { color: '#8d6e63', mood: 'neutral' },
  sad: { color: '#5c6bc0', mood: 'sad' },
  coin: { color: '#f9a825', mood: 'coin' },
  bulk: { text: 'Compra grande!', color: '#e65100' },
  picky: { text: 'Hmm, preços...', color: '#6a2c91' },
  pickyno: { text: 'Absurdo!', color: '#8e0000' },
  kid: { text: 'Doces!', color: '#d81b60' },
};

const cache = new Map<BubbleKey, THREE.SpriteMaterial>();
const textures: THREE.CanvasTexture[] = [];

function draw(def: Def): THREE.CanvasTexture {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const bw = def.text ? 240 : 110;
  const x0 = (w - bw) / 2, y0 = 8, bh = 86;
  g.fillStyle = '#ffffff';
  g.strokeStyle = def.color;
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(x0, y0, bw, bh, 22);
  g.fill();
  g.stroke();
  // rabinho
  g.beginPath();
  g.moveTo(w / 2 - 12, y0 + bh - 2);
  g.lineTo(w / 2, y0 + bh + 22);
  g.lineTo(w / 2 + 12, y0 + bh - 2);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.beginPath();
  g.moveTo(w / 2 - 12, y0 + bh);
  g.lineTo(w / 2, y0 + bh + 22);
  g.lineTo(w / 2 + 12, y0 + bh);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(w / 2 - 10, y0 + bh - 6, 20, 8);
  if (def.text) {
    g.fillStyle = def.color;
    g.font = 'bold 46px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(def.text, w / 2, y0 + bh / 2 + 2, bw - 24);
  } else {
    const cx = w / 2, cy = y0 + bh / 2, r = 30;
    g.lineWidth = 5;
    g.strokeStyle = def.color;
    g.fillStyle = def.mood === 'coin' ? '#ffd54f' : def.mood === 'angry' ? '#ef9a9a' : '#fff3c4';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = def.color;
    g.lineCap = 'round';
    if (def.mood === 'coin') {
      g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('$', cx, cy + 2);
    } else {
      g.beginPath(); g.arc(cx - 11, cy - 8, 4, 0, 7); g.arc(cx + 11, cy - 8, 4, 0, 7); g.fill();
      g.beginPath();
      if (def.mood === 'happy') g.arc(cx, cy + 2, 14, 0.15 * Math.PI, 0.85 * Math.PI);
      else if (def.mood === 'sad') g.arc(cx, cy + 20, 13, 1.15 * Math.PI, 1.85 * Math.PI);
      else if (def.mood === 'angry') {
        g.moveTo(cx - 20, cy - 18); g.lineTo(cx - 5, cy - 12);
        g.moveTo(cx + 20, cy - 18); g.lineTo(cx + 5, cy - 12);
        g.moveTo(cx - 12, cy + 14); g.lineTo(cx + 12, cy + 14);
      } else { g.moveTo(cx - 11, cy + 12); g.lineTo(cx + 11, cy + 12); }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.push(tex);
  return tex;
}

export function bubbleMaterial(key: BubbleKey): THREE.SpriteMaterial {
  let m = cache.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: draw(DEFS[key]), transparent: true, depthWrite: false });
    cache.set(key, m);
  }
  return m;
}

export function disposeBubbles(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  for (const t of textures) t.dispose();
  textures.length = 0;
}

/** Sprite reutilizável por agente; pop-in/out por escala. */
export class Bubble {
  readonly sprite = new THREE.Sprite(bubbleMaterial('happy'));
  private t = 0;
  private life = 0;
  private wide = false;
  constructor(y: number) {
    this.sprite.position.y = y;
    this.sprite.center.set(0.5, 0);
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
  }
  show(key: BubbleKey, seconds: number): void {
    this.sprite.material = bubbleMaterial(key);
    this.wide = DEFS[key].text !== undefined;
    this.t = 0;
    this.life = seconds;
    this.sprite.visible = true;
  }
  update(dt: number): void {
    if (!this.sprite.visible) return;
    this.t += dt;
    const inK = Math.min(1, this.t / 0.18);
    const outK = Math.min(1, Math.max(0, (this.life - this.t) / 0.25));
    const k = inK * outK * (1 + 0.12 * Math.sin(Math.min(1, this.t / 0.18) * Math.PI));
    const s = 1.15 * k;
    this.sprite.scale.set(s * 2, s, 1);
    if (this.t >= this.life) this.sprite.visible = false;
  }
  get active(): boolean { return this.sprite.visible; }
}
