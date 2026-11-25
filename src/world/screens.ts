/**
 * Monitor LCD e face da maquininha de cada balcão, dirigidos pelo evento `checkout:display`
 * ({counterId, mode:'idle'|'items'|'cash'|'card', lastItem?, total?, received?, change?, giving?, typed?}).
 * Uma CanvasTexture por balcão (monitor + maquininha na mesma textura) e uma malha (2 quads) = 1 draw call;
 * o canvas só é redesenhado quando o conteúdo muda.
 */
import * as THREE from 'three';
import { CARDPAD, MONITOR, poseMatrix } from './furniture';
import { canvasTex } from './kit';

export interface Display {
  counterId?: number;
  mode?: 'idle' | 'items' | 'cash' | 'card';
  lastItem?: { name?: string; price?: number };
  total?: number; received?: number; change?: number; giving?: number; typed?: number | string;
}

const CW = 512, CH = 512, MON_H = 320; // monitor 512×320; maquininha 96×192 em (0, 320)
const PAD = { x: 0, y: MON_H, w: 96, h: 192 };
const brl = (c: number | undefined): string => `R$ ${((Number.isFinite(c) ? (c as number) : 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const typedText = (t: number | string | undefined, fallback: number | undefined): string => {
  if (typeof t === 'number') return brl(t);
  if (typeof t === 'string' && t.length) return `R$ ${t}`;
  return brl(fallback ?? 0);
};
const FONT = '"Courier New", Courier, monospace';

interface Screen { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; mesh: THREE.Mesh; sig: string }

let quadGeo: THREE.BufferGeometry | null = null;
/** Geometria local (no grupo do balcão) com os dois quads: tela do monitor e face da maquininha. */
function screenGeometry(): THREE.BufferGeometry {
  if (quadGeo) return quadGeo;
  const m = new THREE.Matrix4(), off = new THREE.Matrix4();
  const mon = new THREE.PlaneGeometry(MONITOR.w, MONITOR.h);
  mon.applyMatrix4(off.makeTranslation(0, MONITOR.cy, MONITOR.cz));
  mon.applyMatrix4(poseMatrix(m, MONITOR.x, MONITOR.y, MONITOR.z, MONITOR.ry, MONITOR.tilt));
  const uvM = mon.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uvM.count; i++) uvM.setXY(i, uvM.getX(i), 1 - MON_H / CH + uvM.getY(i) * (MON_H / CH));
  const pad = new THREE.PlaneGeometry(CARDPAD.w, CARDPAD.h);
  pad.rotateX(-Math.PI / 2); // deitada no topo do corpo, "cima" do desenho para o lado oposto ao operador
  pad.rotateY(Math.PI);
  pad.translate(0, 0.0016, 0.004);
  pad.applyMatrix4(poseMatrix(m, CARDPAD.x, CARDPAD.y + CARDPAD.lift, CARDPAD.z, CARDPAD.ry, CARDPAD.tilt));
  const uvP = pad.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uvP.count; i++) uvP.setXY(i, (PAD.x + uvP.getX(i) * PAD.w) / CW, 1 - (PAD.y + PAD.h) / CH + uvP.getY(i) * (PAD.h / CH));
  const g = new THREE.BufferGeometry();
  const merge = (a: THREE.BufferGeometry, b: THREE.BufferGeometry, name: string, size: number): void => {
    const A = a.getAttribute(name).array as Float32Array, B = b.getAttribute(name).array as Float32Array;
    const out = new Float32Array(A.length + B.length); out.set(A); out.set(B, A.length);
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  };
  merge(mon, pad, 'position', 3); merge(mon, pad, 'uv', 2); merge(mon, pad, 'normal', 3);
  const ia = Array.from(mon.index!.array), ib = Array.from(pad.index!.array).map((i) => i + 4);
  g.setIndex([...ia, ...ib]);
  mon.dispose(); pad.dispose();
  quadGeo = g;
  return g;
}

export class CheckoutScreens {
  private by = new Map<number, Screen>();
  private disp = new Map<number, Display>();

  /** Garante uma tela por balcão (anexada ao grupo do balcão) e descarta as de balcões removidos. */
  attach(counterId: number, parent: THREE.Object3D): void {
    let s = this.by.get(counterId);
    if (!s) {
      const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;
      const g = canvas.getContext('2d')!;
      const tex = canvasTex(canvas); tex.anisotropy = 2;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const mesh = new THREE.Mesh(screenGeometry(), mat);
      mesh.name = `screen:${counterId}`; mesh.renderOrder = 2;
      s = { canvas, g, tex, mat, mesh, sig: '' };
      this.by.set(counterId, s);
      this.redraw(counterId, s);
    }
    if (s.mesh.parent !== parent) parent.add(s.mesh);
  }
  prune(alive: Set<number>): void {
    for (const [id, s] of this.by) {
      if (alive.has(id)) continue;
      s.mesh.parent?.remove(s.mesh); s.tex.dispose(); s.mat.dispose();
      this.by.delete(id); this.disp.delete(id);
    }
  }
  /** Aplica um `checkout:display`. Sem counterId: primeiro balcão conhecido. */
  set(p: Display, fallbackId: number | undefined): void {
    const id = Number.isFinite(p?.counterId) ? (p.counterId as number) : fallbackId;
    if (id === undefined) return;
    this.disp.set(id, { ...p });
    const s = this.by.get(id);
    if (s) this.redraw(id, s);
  }
  get(id: number): Display { return this.disp.get(id) ?? { mode: 'idle' }; }
  /** Texto atual (debug/testes). */
  info(): { id: number; sig: string }[] { return [...this.by].map(([id, s]) => ({ id, sig: s.sig })); }

  private redraw(id: number, s: Screen): void {
    const d = this.disp.get(id) ?? { mode: 'idle' as const };
    const sig = JSON.stringify(d);
    if (sig === s.sig) return;
    s.sig = sig;
    const g = s.g;
    // fundo LCD
    g.fillStyle = '#14171c'; g.fillRect(0, 0, CW, MON_H);
    const vg = g.createRadialGradient(CW / 2, MON_H / 2, 40, CW / 2, MON_H / 2, CW * 0.65);
    vg.addColorStop(0, 'rgba(70,90,110,0.18)'); vg.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = vg; g.fillRect(0, 0, CW, MON_H);
    g.fillStyle = 'rgba(255,255,255,0.025)'; for (let y = 0; y < MON_H; y += 4) g.fillRect(0, y, CW, 1);
    const txt = (t: string, x: number, y: number, size: number, color = '#e8eef2', align: CanvasTextAlign = 'center', maxW = CW - 40): void => {
      g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = color;
      let sz = size;
      do { g.font = `700 ${sz}px ${FONT}`; sz -= 2; } while (g.measureText(t).width > maxW && sz > 10);
      g.fillText(t, x, y);
    };
    const line = (y: number): void => { g.fillStyle = '#e8eef2'; g.fillRect(40, y, CW - 80, 4); };
    const mode = d.mode ?? 'idle';
    if (mode === 'cash') {
      txt('PAGAMENTO EM DINHEIRO', CW / 2, 40, 30);
      txt('RECEBIDO:', 40, 92, 24, '#b9c3cc', 'left', 220); txt(brl(d.received), CW - 40, 92, 26, '#e8eef2', 'right', 230);
      txt('TOTAL:', 40, 128, 24, '#b9c3cc', 'left', 220); txt(brl(d.total), CW - 40, 128, 26, '#e8eef2', 'right', 230);
      line(152);
      txt('TROCO:', 40, 190, 34, '#e8eef2', 'left', 200); txt(brl(d.change), CW - 40, 190, 38, '#ffe14d', 'right', 260);
      line(222);
      txt('DANDO:', 40, 262, 34, '#e8eef2', 'left', 200); txt(brl(d.giving), CW - 40, 262, 38, (d.giving ?? 0) === (d.change ?? 0) ? '#5cff7a' : '#ff5252', 'right', 260);
    } else if (mode === 'card') {
      txt('PAGAMENTO NO CARTÃO', CW / 2, 42, 32);
      line(80);
      txt('TOTAL:', 40, 128, 38, '#e8eef2', 'left', 200); txt(brl(d.total), CW - 40, 128, 42, '#e8eef2', 'right', 280);
      line(170);
      txt('DIGITE O VALOR', CW / 2, 220, 28, '#b9c3cc');
      txt('NA MAQUININHA', CW / 2, 260, 28, '#b9c3cc');
    } else {
      if (mode === 'items' && d.lastItem) {
        txt(String(d.lastItem.name ?? '').toUpperCase(), 32, 56, 28, '#9aa6b1', 'left', CW - 220);
        txt(brl(d.lastItem.price), CW - 32, 56, 28, '#9aa6b1', 'right', 190);
      }
      txt('TOTAL', CW / 2, 150, 76);
      txt(brl(mode === 'items' ? d.total : 0), CW / 2, 240, 76);
    }
    // maquininha: tela + teclado (desenhado)
    const p = PAD;
    g.fillStyle = '#2b2f36'; g.fillRect(p.x, p.y, p.w, p.h);
    g.fillStyle = '#cfd8c8'; g.fillRect(p.x + 8, p.y + 8, p.w - 16, 44);
    g.fillStyle = '#2b3a2b'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 10px ${FONT}`; g.fillText('TOTAL', p.x + p.w / 2, p.y + 18);
    const shown = mode === 'card' ? typedText(d.typed, 0) : brl(mode === 'idle' ? 0 : d.total);
    let fs = 15; do { g.font = `700 ${fs}px ${FONT}`; fs--; } while (g.measureText(shown).width > p.w - 20 && fs > 7);
    g.fillText(shown, p.x + p.w / 2, p.y + 37);
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '<', '0', ','];
    keys.forEach((k, i) => {
      const cx = p.x + 10 + (i % 3) * 27, cy = p.y + 60 + Math.floor(i / 3) * 24;
      g.fillStyle = '#2f8fe0'; g.fillRect(cx, cy, 22, 19);
      g.fillStyle = '#fff'; g.font = `700 12px ${FONT}`; g.fillText(k, cx + 11, cy + 10);
    });
    g.fillStyle = '#2fbf4a'; g.fillRect(p.x + 10, p.y + 158, 49, 22);
    g.fillStyle = '#e23b3b'; g.fillRect(p.x + 64, p.y + 158, 22, 22);
    g.fillStyle = '#fff'; g.font = `700 12px ${FONT}`; g.fillText('OK', p.x + 34, p.y + 169); g.fillText('C', p.x + 75, p.y + 169);
    s.tex.needsUpdate = true;
  }

  dispose(): void { this.prune(new Set()); }
}
