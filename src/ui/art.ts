/**
 * Arte procedural ORIGINAL em SVG (strings estáticas, sem assets): produtos (cor/forma do catálogo), móveis,
 * funcionários, melhorias, expansões e pequenos ícones do HUD. Nada copiado do jogo de referência.
 */
import type { FurnitureType } from '../core/layout';
import type { Category, Product } from '../sim/catalog';

export const CATEGORY_COLOR: Record<Category, string> = {
  mercearia: '#d9a441', bebidas: '#3b7fd4', laticinios: '#5fb4d6', congelados: '#7b8ff0', padaria: '#c9803f', limpeza: '#35a891',
  hortifruti: '#5aa33a', higiene: '#d86fa1', frios: '#c8543f', eletronicos: '#6b6f80',
};
type Shape = NonNullable<Product['shape']>;
const DEFAULT_SHAPE: Record<Category, Shape> = {
  mercearia: 'bag', bebidas: 'bottle', laticinios: 'box', congelados: 'jar', padaria: 'bag', limpeza: 'bottle',
  hortifruti: 'tray', higiene: 'box', frios: 'tray', eletronicos: 'box',
};

/* ---------------- cor ---------------- */
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1] ?? '999999', 16) : 0x999999;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** amt < 0 escurece, > 0 clareia (−1..1). */
export function shade(hex: string, amt: number): string {
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `#${rgb(hex).map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

const OL = 'stroke="rgba(12,18,30,.55)" stroke-width="1.6" stroke-linejoin="round"';
const svg = (body: string, size: number, cls: string, vb = '0 0 64 64'): string =>
  `<svg class="${cls}" viewBox="${vb}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;

/* ---------------- produtos ---------------- */
export function productColor(p: Pick<Product, 'category' | 'color'>): string {
  return p.color ?? CATEGORY_COLOR[p.category] ?? '#9aa3ad';
}

/** Ícone do produto desenhado a partir de `color` e `shape` do catálogo (fallback por categoria). */
export function productSvg(p: Pick<Product, 'category' | 'color' | 'shape'>, size = 56): string {
  const c = productColor(p);
  const shape: Shape = p.shape ?? DEFAULT_SHAPE[p.category] ?? 'box';
  const d = shade(c, -0.3), l = shade(c, 0.35);
  const ink = luminance(c) > 0.82 ? shade(c, -0.45) : d; // produtos claros (leite, papel) ganham faixa mais escura
  let b = '';
  switch (shape) {
    case 'bottle':
      b = `<path d="M27 5h10v8H27z" fill="${ink}" ${OL}/>
        <path d="M28 13h8v5c0 2.5 6.5 4 6.5 9.5V54a4 4 0 0 1-4 4h-13a4 4 0 0 1-4-4V27.5c0-5.5 6.5-7 6.5-9.5z" fill="${c}" ${OL}/>
        <rect x="21.5" y="33" width="21" height="13" fill="#fff" opacity=".93"/><rect x="21.5" y="33" width="21" height="3.2" fill="${ink}"/>
        <path d="M26 25v25" stroke="#fff" stroke-opacity=".5" stroke-width="2.6" stroke-linecap="round"/>`;
      break;
    case 'can':
      b = `<path d="M19 14v38c0 3.300 5.800 5.500 13 5.500S45 55.300 45 52V14" fill="${c}" ${OL}/>
        <ellipse cx="32" cy="14" rx="13" ry="4.800" fill="${l}" ${OL}/>
        <rect x="19" y="27" width="26" height="15" fill="#fff" opacity=".9"/><rect x="19" y="27" width="26" height="3" fill="${ink}"/>
        <ellipse cx="35" cy="13.400" rx="3.200" ry="1.300" fill="${d}"/>
        <path d="M23.500 20v31" stroke="#fff" stroke-opacity=".42" stroke-width="2.600" stroke-linecap="round"/>`;
      break;
    case 'bag':
      b = `<path d="M18 17h28l2 6c2.300 8 3.200 15.500 3.200 23 0 7.500-3.300 12-8.200 12H21c-4.900 0-8.200-4.500-8.200-12 0-7.500.9-15 3.200-23z" fill="${c}" ${OL}/>
        <path d="M18 17l2.300-5.500 2.500 5.500 2.500-5.500 2.500 5.500 2.500-5.500 2.500 5.500 2.500-5.500 2.500 5.500 2.500-5.500 2.500 5.500 2.500-5.500 2 5.500z" fill="${d}" ${OL}/>
        <ellipse cx="32" cy="38.500" rx="10.500" ry="8.500" fill="#fff" opacity=".92"/><circle cx="32" cy="38.500" r="4.200" fill="${ink}"/>
        <path d="M19.500 26c-1 6-1.200 12-.6 18" stroke="#fff" stroke-opacity=".45" stroke-width="2.400" stroke-linecap="round" fill="none"/>`;
      break;
    case 'tray':
      b = `<circle cx="21" cy="37" r="9.500" fill="${c}" ${OL}/><circle cx="43" cy="37" r="9.500" fill="${shade(c, -0.12)}" ${OL}/>
        <circle cx="32" cy="32" r="10.500" fill="${shade(c, 0.08)}" ${OL}/>
        <circle cx="28.500" cy="28.500" r="3" fill="#fff" opacity=".45"/><circle cx="18" cy="34" r="2.200" fill="#fff" opacity=".4"/>
        <path d="M7 41h50l-4.500 14h-41z" fill="#eef2f5" ${OL}/><path d="M8 41h48" stroke="#cfd6dd" stroke-width="3"/>
        <path d="M13 27Q32 14 51 27" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none"/>`;
      break;
    case 'jar':
      b = `<rect x="18" y="9" width="28" height="11" rx="3" fill="${ink}" ${OL}/>
        <path d="M16.500 20h31v32a6 6 0 0 1-6 6h-19a6 6 0 0 1-6-6z" fill="${c}" ${OL}/>
        <rect x="16.500" y="30" width="31" height="14" fill="#fff" opacity=".92"/><rect x="16.500" y="30" width="31" height="3" fill="${ink}"/>
        <path d="M21.500 24v28" stroke="#fff" stroke-opacity=".45" stroke-width="2.600" stroke-linecap="round"/>`;
      break;
    default: // box
      b = `<path d="M13 24l10-9h29l-10 9z" fill="${l}" ${OL}/>
        <path d="M42 24l10-9v34l-10 9z" fill="${d}" ${OL}/>
        <rect x="13" y="24" width="29" height="34" fill="${c}" ${OL}/>
        <rect x="16" y="33" width="23" height="13" rx="2" fill="#fff" opacity=".92"/><rect x="16" y="33" width="23" height="3.500" fill="${ink}"/>
        <circle cx="27.500" cy="41.500" r="2.600" fill="${ink}"/>`;
  }
  return svg(b, size, 'pic');
}

/* ---------------- móveis ---------------- */
const MINI_GOODS = ['#e8724a', '#f2c14e', '#5aa33a', '#3b7fd4', '#d86fa1'];

/** Ícone do móvel (decor: `variant`). */
export function furnitureSvg(type: FurnitureType | string, size = 56, variant?: string): string {
  let b = '';
  switch (type) {
    case 'shelf': {
      b = `<rect x="12" y="7" width="40" height="46" rx="2" fill="#e3edf5" ${OL}/>
        <rect x="8" y="6" width="6" height="52" rx="2" fill="#93a9bd" ${OL}/><rect x="50" y="6" width="6" height="52" rx="2" fill="#93a9bd" ${OL}/>`;
      [20, 34, 48].forEach((y, r) => {
        for (let i = 0; i < 4; i++) {
          const col = MINI_GOODS[(i + r * 2) % MINI_GOODS.length] ?? '#ccc';
          b += `<rect x="${16 + i * 8.6}" y="${y - 8}" width="6.400" height="8" rx="1.200" fill="${col}" stroke="rgba(12,18,30,.4)" stroke-width="1"/>`;
        }
        b += `<rect x="10" y="${y}" width="44" height="4" rx="1" fill="#bcd0e0" ${OL}/>`;
      });
      b += `<rect x="9" y="53" width="46" height="6" rx="1.500" fill="#7f95aa" ${OL}/>`;
      break;
    }
    case 'fridge':
      b = `<rect x="11" y="3" width="42" height="58" rx="4" fill="#eef3f7" ${OL}/>
        <rect x="11" y="3" width="42" height="9" rx="4" fill="#2f8fe0" ${OL}/>
        <rect x="15.500" y="15" width="33" height="41" rx="2" fill="#c4ebff" stroke="#6fb1d6" stroke-width="1.600"/>
        <path d="M16 28h32M16 41h32" stroke="#8fc6e4" stroke-width="2"/>
        <rect x="19" y="18.500" width="5" height="9" rx="1.500" fill="#d83a3a"/><rect x="27" y="18.500" width="5" height="9" rx="1.500" fill="#f4f4f0" stroke="#9aa" stroke-width=".8"/>
        <rect x="35" y="18.500" width="5" height="9" rx="1.500" fill="#3fbf6f"/><rect x="19" y="31.500" width="8" height="8.500" rx="1.500" fill="#f2c14e"/>
        <rect x="30" y="31.500" width="8" height="8.500" rx="1.500" fill="#5fb4d6"/><rect x="21" y="44.500" width="12" height="9" rx="1.500" fill="#f08a8a"/>
        <rect x="44" y="27" width="2.800" height="14" rx="1.400" fill="#73808e"/>
        <path d="M18 17l6 0M18 17l-0 8" stroke="#fff" stroke-opacity=".7" stroke-width="1.600" stroke-linecap="round"/>`;
      break;
    case 'freezer':
      b = `<path d="M5 31h54v22a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z" fill="#eef3f7" ${OL}/>
        <rect x="5" y="41" width="54" height="4" fill="#5fb4d6"/>
        <path d="M9 21h46l4 10H5z" fill="#c4ebff" ${OL}/>
        <rect x="13" y="22.500" width="9" height="6" rx="2" fill="#f5b7c8"/><rect x="24" y="22.500" width="9" height="6" rx="2" fill="#8b5a3c"/>
        <rect x="35" y="22.500" width="9" height="6" rx="2" fill="#f2d03b"/><rect x="46" y="22.500" width="7" height="6" rx="2" fill="#7b8ff0"/>
        <path d="M12 24l8 6M30 23l9 7" stroke="#fff" stroke-opacity=".75" stroke-width="1.600" stroke-linecap="round"/>`;
      break;
    case 'counter':
      b = `<rect x="5" y="31" width="54" height="26" rx="3" fill="#e2e9f1" ${OL}/>
        <rect x="5" y="31" width="54" height="5" fill="#d93a3a"/>
        <rect x="4" y="26" width="56" height="6" rx="2" fill="#cdd7e1" ${OL}/>
        <rect x="27" y="27.500" width="30" height="3" rx="1.500" fill="#3a3f4a"/>
        <rect x="9" y="10" width="19" height="13" rx="2" fill="#2b2f38" ${OL}/><rect x="11.500" y="12.500" width="14" height="8" rx="1" fill="#5fe0a0"/>
        <rect x="16" y="23" width="5" height="3.500" fill="#9aa6b2"/>
        <rect x="11" y="40" width="16" height="12" rx="2" fill="#c9d3dd" ${OL}/><rect x="33" y="40" width="20" height="12" rx="2" fill="#c9d3dd" ${OL}/>`;
      break;
    case 'rack': {
      b = `<rect x="7" y="5" width="5" height="54" rx="1.500" fill="#77879a" ${OL}/><rect x="52" y="5" width="5" height="54" rx="1.500" fill="#77879a" ${OL}/>`;
      [22, 40, 57].forEach((y, r) => {
        for (let i = 0; i < 3; i++) {
          if ((r + i) % 4 === 3) continue;
          const x = 14 + i * 12.500;
          b += `<rect x="${x}" y="${y - 12}" width="11" height="12" rx="1" fill="#c9955c" stroke="rgba(12,18,30,.45)" stroke-width="1.200"/><rect x="${x + 4.300}" y="${y - 12}" width="2.400" height="12" fill="#e9c58f"/>`;
        }
        b += `<rect x="9" y="${y}" width="46" height="3.500" rx="1" fill="#9aa6b2" ${OL}/>`;
      });
      break;
    }
    case 'decor':
      return decorSvg(variant ?? 'plant', size);
    default:
      b = `<rect x="10" y="14" width="44" height="40" rx="6" fill="#cdd7e1" ${OL}/>`;
  }
  return svg(b, size, 'fic');
}

export function decorSvg(variant: string, size = 56): string {
  let b = '';
  switch (variant) {
    case 'tree':
      b = `<rect x="29" y="38" width="6" height="16" rx="2" fill="#8a5a36" ${OL}/>
        <circle cx="32" cy="24" r="16" fill="#3e9b47" ${OL}/><circle cx="24" cy="30" r="9" fill="#4fae55"/><circle cx="40" cy="28" r="9" fill="#35883e"/>
        <path d="M20 54h24l-3 6H23z" fill="#b5653a" ${OL}/>`;
      break;
    case 'banner':
      b = `<rect x="14" y="4" width="4" height="56" rx="2" fill="#7d8a99" ${OL}/>
        <path d="M18 8h34l-7 11 7 11H18z" fill="#e8463c" ${OL}/><path d="M23 15h18M23 21h13" stroke="#ffe07a" stroke-width="3" stroke-linecap="round"/>`;
      break;
    case 'lamp':
      b = `<path d="M20 22h24l-6-15H26z" fill="#ffd36a" ${OL}/><rect x="30.500" y="22" width="3" height="32" fill="#5d6773"/>
        <ellipse cx="32" cy="57" rx="11" ry="3.500" fill="#5d6773" ${OL}/><path d="M18 26l-4 6M46 26l4 6M32 27v4" stroke="#ffd36a" stroke-width="2" stroke-linecap="round"/>`;
      break;
    case 'rug':
      b = `<rect x="6" y="18" width="52" height="30" rx="4" fill="#c2453f" ${OL}/><rect x="11" y="23" width="42" height="20" rx="2" fill="none" stroke="#f2c14e" stroke-width="2.500"/>
        <path d="M32 26l7 7-7 7-7-7z" fill="#f2c14e"/><path d="M6 22h-3M6 28h-3M6 34h-3M6 40h-3M61 22h-3M61 28h-3M61 34h-3M61 40h-3" stroke="#f2c14e" stroke-width="2"/>`;
      break;
    case 'poster':
      b = `<rect x="12" y="6" width="40" height="52" rx="2" fill="#fff6d8" ${OL}/><rect x="16" y="10" width="32" height="12" fill="#e8463c"/>
        <text x="32" y="44" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="20" fill="#e8463c">%</text>
        <path d="M18 50h28" stroke="#c9b98a" stroke-width="2.500" stroke-linecap="round"/>`;
      break;
    case 'fountain':
      b = `<ellipse cx="32" cy="50" rx="24" ry="7" fill="#9fb4c6" ${OL}/><path d="M8 50v4c0 3.900 10.700 7 24 7s24-3.100 24-7v-4" fill="#7f95aa" ${OL}/>
        <rect x="29" y="22" width="6" height="26" fill="#b7c6d3" ${OL}/><path d="M32 22c-8-12-18-6-18 6M32 22c8-12 18-6 18 6" stroke="#4aa3df" stroke-width="3" fill="none" stroke-linecap="round"/>
        <ellipse cx="32" cy="49" rx="18" ry="4" fill="#7ec8f0"/>`;
      break;
    case 'statue':
      b = `<rect x="18" y="44" width="28" height="14" rx="2" fill="#9aa6b2" ${OL}/><rect x="14" y="56" width="36" height="5" rx="1.500" fill="#7f8c99" ${OL}/>
        <path d="M22 44c0-8 4.500-12 10-12s10 4 10 12z" fill="#c9cfd6" ${OL}/><circle cx="32" cy="22" r="9" fill="#c9cfd6" ${OL}/>
        <path d="M25 18c3-6 11-6 14 0" stroke="#aab3bd" stroke-width="3" fill="none"/>`;
      break;
    default: // plant
      b = `<path d="M20 40h24l-3 18H23z" fill="#c0703f" ${OL}/><rect x="18" y="36" width="28" height="6" rx="2" fill="#a85f34" ${OL}/>
        <path d="M32 36C30 26 22 20 14 20c2 8 8 14 18 16zM32 36c2-10 10-16 18-16-2 8-8 14-18 16zM32 36c-3-10 0-20 0-28 4 8 4 18 0 28z" fill="#4fae55" ${OL}/>`;
  }
  return svg(b, size, 'fic');
}

/* ---------------- pessoas (funcionários) ---------------- */
const ROLE_LOOK: Record<string, { shirt: string; skin: string; hair: string; extra: string }> = {
  cashier: { shirt: '#3b7fd4', skin: '#e0ac7e', hair: '#5b3a24', extra: 'tie' },
  janitor: { shirt: '#2f9e8f', skin: '#a8714c', hair: '#2b2b2b', extra: 'cap' },
  stocker: { shirt: '#f08c2e', skin: '#c98c5f', hair: '#1f1a17', extra: 'box' },
};
export function personSvg(role: string, size = 56): string {
  const k = ROLE_LOOK[role] ?? ROLE_LOOK.cashier!;
  const sh = shade(k.shirt, -0.25);
  let b = `<path d="M10 64c1-14 9-20 22-20s21 6 22 20z" fill="${k.shirt}" ${OL}/>
    <path d="M26 44l6 7 6-7" fill="none" stroke="${sh}" stroke-width="2.500" stroke-linejoin="round"/>
    <rect x="28" y="36" width="8" height="9" fill="${k.skin}"/>
    <circle cx="32" cy="26" r="12" fill="${k.skin}" ${OL}/>
    <circle cx="27.500" cy="26" r="1.700" fill="#2a1d16"/><circle cx="36.500" cy="26" r="1.700" fill="#2a1d16"/>
    <path d="M27.500 31.500q4.500 3.500 9 0" stroke="#7a3b2b" stroke-width="1.800" fill="none" stroke-linecap="round"/>`;
  if (k.extra === 'cap') b += `<path d="M19.500 23c0-8 5.500-12 12.500-12s12.500 4 12.500 12z" fill="${sh}" ${OL}/><path d="M42 22h8" stroke="${sh}" stroke-width="3.500" stroke-linecap="round"/>`;
  else b += `<path d="M20 25c0-9 5.500-13 12-13s12 4 12 13c-3-5-7-6-12-6s-9 1-12 6z" fill="${k.hair}" ${OL}/>`;
  if (k.extra === 'tie') b += `<path d="M30.500 47h3l1 8-2.500 3-2.500-3z" fill="#e8463c"/>`;
  if (k.extra === 'box') b += `<rect x="38" y="48" width="14" height="11" rx="1.500" fill="#c9955c" ${OL}/><rect x="43.700" y="48" width="2.600" height="11" fill="#e9c58f"/>`;
  return svg(b, size, 'pic');
}

/* ---------------- melhorias, expansão, depósito ---------------- */
export function upgradeSvg(id: string, size = 56): string {
  let b = '';
  switch (id) {
    case 'dolly':
      b = `<rect x="22" y="10" width="20" height="16" rx="1.500" fill="#c9955c" ${OL}/><rect x="20" y="26" width="24" height="18" rx="1.500" fill="#d6a46b" ${OL}/>
        <path d="M16 6v44h30" fill="none" stroke="#4a5a6e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="20" cy="54" r="5.500" fill="#2b2f38" ${OL}/><circle cx="42" cy="54" r="5.500" fill="#2b2f38" ${OL}/>`;
      break;
    case 'tipjar':
      b = `<rect x="20" y="10" width="24" height="7" rx="2" fill="#8a94a3" ${OL}/>
        <path d="M17 17h30v34a7 7 0 0 1-7 7H24a7 7 0 0 1-7-7z" fill="#cdeefa" fill-opacity=".85" ${OL}/>
        <circle cx="27" cy="47" r="6" fill="#f1d37a" ${OL}/><circle cx="37" cy="44" r="6" fill="#e3c26a" ${OL}/><circle cx="32" cy="36" r="6" fill="#f1d37a" ${OL}/>
        <text x="32" y="28" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="9" fill="#17866a">R$</text>`;
      break;
    case 'capacity':
      b = `<circle cx="20" cy="22" r="7" fill="#e0ac7e" ${OL}/><path d="M8 48c1-10 5.500-14 12-14s11 4 12 14z" fill="#3b7fd4" ${OL}/>
        <circle cx="36" cy="20" r="7" fill="#a8714c" ${OL}/><path d="M24 46c1-10 5.500-14 12-14s11 4 12 14z" fill="#f08c2e" ${OL}/>
        <circle cx="50" cy="44" r="10" fill="#2fd14a" ${OL}/><path d="M50 38v12M44 44h12" stroke="#fff" stroke-width="3.500" stroke-linecap="round"/>`;
      break;
    case 'recycler':
      b = `<path d="M16 20h32l-3 34H19z" fill="#2fa84f" ${OL}/><rect x="13" y="14" width="38" height="8" rx="2" fill="#38c15e" ${OL}/>
        <path d="M32 28l5 8h-3l-2-3-2 3h-3zM28 44l-5-2 2-3M36 44l5-2-2-3" fill="none" stroke="#fff" stroke-width="2.500" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    default:
      b = `<path d="M32 6l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 23l16-2z" fill="#ffd23f" ${OL}/>`;
  }
  return svg(b, size, 'pic');
}

export function expansionSvg(n: number, size = 56): string {
  const b = `<path d="M6 40l26-14 26 14-26 14z" fill="#cfd8e1" ${OL}/><path d="M6 40v6l26 14v-6zM58 40v6L32 60v-6z" fill="#8a96a3" ${OL}/>
    <path d="M32 26l13 7-13 7-13-7z" fill="#2fd14a" ${OL}/>
    <path d="M32 8v12M26 14l6-6 6 6" stroke="#1ea0f2" stroke-width="3.500" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="50" y="16" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="13" fill="#1ea0f2">${n}</text>`;
  return svg(b, size, 'pic');
}

export function storageSvg(size = 56): string {
  const b = `<rect x="8" y="12" width="48" height="44" rx="3" fill="#8a96a3" ${OL}/>
    <path d="M12 18h40M12 24h40M12 30h40M12 36h40M12 42h40M12 48h40" stroke="#6e7a88" stroke-width="2"/>
    <rect x="22" y="30" width="20" height="26" fill="#56606c" ${OL}/>
    <rect x="12" y="44" width="10" height="9" rx="1" fill="#c9955c" ${OL}/><rect x="44" y="40" width="10" height="13" rx="1" fill="#d6a46b" ${OL}/>`;
  return svg(b, size, 'pic');
}

export function licenseSvg(cat: Category, products: Pick<Product, 'category' | 'color' | 'shape'>[], size = 72): string {
  const ps = products.slice(0, 3);
  const pos = [[-14, 6, 0.85], [14, 6, 0.85], [0, -2, 1]] as const;
  let inner = `<circle cx="32" cy="32" r="30" fill="${shade(CATEGORY_COLOR[cat], 0.55)}" opacity=".35"/>`;
  ps.forEach((p, i) => {
    const [dx, dy, s] = pos[i] ?? [0, 0, 1];
    const sz = 40 * s;
    inner += `<g transform="translate(${32 + dx - sz / 2} ${32 + dy - sz / 2}) scale(${sz / 64})">${productSvg(p, 64).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
  });
  return svg(inner, size, 'pic');
}

/* ---------------- HUD / resumo ---------------- */
export function starSvg(size = 40): string {
  return svg(`<path d="M32 3l8.600 17.600 19.400 2.800-14 13.600 3.300 19.300L32 47.200 14.700 56.300 18 37 4 23.400l19.400-2.800z" fill="#1ea0f2" stroke="#fff" stroke-width="3.500" stroke-linejoin="round"/>
    <path d="M32 9l6.500 13.300" stroke="#8fd3ff" stroke-width="3" stroke-linecap="round"/>`, size, 'star-ic');
}
export function billSvg(size = 30): string {
  return svg(`<rect x="3" y="14" width="58" height="36" rx="5" fill="#45c35c" stroke="#1d7a33" stroke-width="3"/>
    <rect x="9" y="20" width="46" height="24" rx="3" fill="none" stroke="#bff3c8" stroke-width="2.200"/>
    <circle cx="32" cy="32" r="8.500" fill="#2a9a44"/><text x="32" y="36.500" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="11.500" fill="#e9ffe9">R$</text>`, size, 'bill-ic');
}
export function gearSvg(size = 28): string {
  return svg(`<path d="M27.500 4h9l1.600 7.200a21 21 0 0 1 5.300 2.200l6.200-4 6.400 6.400-4 6.200a21 21 0 0 1 2.200 5.300L62 28.500v9l-7.200 1.600a21 21 0 0 1-2.200 5.300l4 6.200-6.400 6.400-6.200-4a21 21 0 0 1-5.300 2.200L37 62h-9l-1.600-7.200a21 21 0 0 1-5.300-2.200l-6.200 4-6.400-6.400 4-6.200a21 21 0 0 1-2.200-5.300L2 37v-9l7.200-1.600a21 21 0 0 1 2.200-5.300l-4-6.200 6.400-6.400 6.200 4a21 21 0 0 1 5.300-2.200z" fill="#e9f4ff" stroke="#1ea0f2" stroke-width="3"/>
    <circle cx="32.500" cy="32.500" r="9.500" fill="#1ea0f2"/>`, size, 'gear-ic', '0 0 65 65');
}
export function cartSvg(size = 30): string {
  return svg(`<path d="M5 9h8l6 30h30l6-21H16" fill="none" stroke="currentColor" stroke-width="5.500" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="23" cy="52" r="5" fill="currentColor"/><circle cx="46" cy="52" r="5" fill="currentColor"/>`, size, 'cart-ic');
}
export function moonSvg(size = 120): string {
  return svg(`<circle cx="60" cy="48" r="44" fill="#ffd96a" opacity=".22"/>
    <path d="M70 12a36 36 0 1 0 30 52A30 30 0 0 1 70 12z" fill="#ffd23f" stroke="#e8a913" stroke-width="3"/>
    <ellipse cx="40" cy="92" rx="22" ry="12" fill="#fff"/><ellipse cx="62" cy="88" rx="20" ry="15" fill="#fff"/><ellipse cx="84" cy="94" rx="18" ry="10" fill="#f1f5fb"/>
    <circle cx="20" cy="24" r="2.500" fill="#fff"/><circle cx="104" cy="22" r="2" fill="#fff"/><circle cx="110" cy="58" r="2.500" fill="#fff"/>`, size, 'moon-ic', '0 0 120 110');
}
/** Emblema de comemoração (estrela + sacola) — original. */
export function emblemSvg(size = 120): string {
  return svg(`<circle cx="60" cy="56" r="48" fill="#ffe27a" opacity=".25"/>
    <path d="M30 52h60l-6 40a6 6 0 0 1-6 5H42a6 6 0 0 1-6-5z" fill="#ff9330" stroke="#c4600f" stroke-width="3"/>
    <path d="M44 52c0-12 7-20 16-20s16 8 16 20" fill="none" stroke="#c4600f" stroke-width="5" stroke-linecap="round"/>
    <path d="M60 4l7 14 15.500 2.300-11.200 10.900 2.600 15.400L60 39.300 46.100 46.600l2.600-15.400L37.500 20.300 53 18z" fill="#ffd23f" stroke="#e8a913" stroke-width="3" stroke-linejoin="round"/>
    <path d="M46 68h28M50 80h20" stroke="#ffe2b8" stroke-width="4" stroke-linecap="round"/>`, size, 'emb-ic', '0 0 120 100');
}
export function faceSvg(kind: 'happy' | 'angry', size = 40): string {
  const angry = kind === 'angry';
  const fill = angry ? '#ff5a4a' : '#ffd23f';
  const b = `<circle cx="32" cy="32" r="28" fill="${fill}" stroke="${angry ? '#b8261b' : '#d99a0b'}" stroke-width="3"/>
    ${angry ? '<path d="M16 22l12 6M48 22l-12 6" stroke="#5a120b" stroke-width="4" stroke-linecap="round"/>' : ''}
    <ellipse cx="23" cy="30" rx="4" ry="5.500" fill="#3a2410"/><ellipse cx="41" cy="30" rx="4" ry="5.500" fill="#3a2410"/>
    ${angry ? '<path d="M20 48q12-10 24 0" stroke="#5a120b" stroke-width="4" fill="none" stroke-linecap="round"/>'
    : '<path d="M17 38q15 18 30 0z" fill="#7a2d12"/><path d="M20 39q12 6 24 0" stroke="#fff" stroke-width="3" fill="none"/>'}`;
  return svg(b, size, 'face-ic');
}
export function peopleSvg(size = 40): string {
  return svg(`<circle cx="22" cy="22" r="9" fill="#e0ac7e" stroke="#7a4b2c" stroke-width="2"/><path d="M6 56c1-14 7-19 16-19s15 5 16 19z" fill="#1ea0f2" stroke="#0b6db8" stroke-width="2"/>
    <circle cx="43" cy="24" r="8" fill="#b97b52" stroke="#5e3a20" stroke-width="2"/><path d="M29 56c1-12 6-17 14-17s13 5 14 17z" fill="#ff7a59" stroke="#b8452b" stroke-width="2"/>
    <path d="M13 18c2-7 16-8 18 0" stroke="#5b3a24" stroke-width="4" fill="none"/><path d="M35 20c2-7 14-7 16 0" stroke="#1f1a17" stroke-width="4" fill="none"/>`, size, 'ppl-ic');
}
export function phoneRotateSvg(size = 120): string {
  return svg(`<g class="ph"><rect x="38" y="12" width="44" height="80" rx="8" fill="#22303f" stroke="#fff" stroke-width="4"/>
    <rect x="44" y="22" width="32" height="56" rx="3" fill="#1ea0f2"/><circle cx="60" cy="85" r="3" fill="#fff"/></g>
    <path d="M100 40a40 40 0 0 1 0 40" stroke="#ffd23f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M100 80l-9-1 6-7" fill="#ffd23f" stroke="#ffd23f" stroke-width="3" stroke-linejoin="round"/>`, size, 'rot-ic', '0 0 120 104');
}
