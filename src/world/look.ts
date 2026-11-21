/** Cores e formas de apresentação dos produtos (sem Three): categoria -> cor, shape -> forma, com fallback para qualquer produto novo. */
import { productById, type Product } from '../sim/catalog';
import { hex } from './kit';

export type Shape = 'box' | 'bottle' | 'can' | 'bag' | 'tray' | 'jar';
export const SHAPES: readonly Shape[] = ['box', 'bottle', 'can', 'bag', 'tray', 'jar'];

/** Cor de destaque por categoria (string aberta: o sim pode criar categorias novas sem quebrar o world). */
export const CATEGORY_COLOR: Record<string, number> = {
  mercearia: 0xe08a24, bebidas: 0x2a86d6, laticinios: 0x5d8fd9, congelados: 0x22b5c9, padaria: 0xb7742c, limpeza: 0x3fae4f,
  hortifruti: 0x58b947, higiene: 0xb26ad8, frios: 0xe0607e, acougue: 0xc4373b, carnes: 0xc4373b, eletronicos: 0x4b5cc4,
};
/** Forma padrão por categoria quando o produto não declara `shape`. */
export const CATEGORY_SHAPE: Record<string, Shape> = {
  mercearia: 'bag', bebidas: 'bottle', laticinios: 'box', congelados: 'jar', padaria: 'bag', limpeza: 'bottle',
  hortifruti: 'tray', higiene: 'bottle', frios: 'tray', acougue: 'tray', carnes: 'tray', eletronicos: 'box',
};
const FALLBACK_COLOR = 0x9aa3ad;

const asShape = (s: unknown): Shape | undefined => (SHAPES as readonly unknown[]).includes(s) ? (s as Shape) : undefined;

export const categoryColorOf = (category: string | undefined): number => (category && CATEGORY_COLOR[category]) || FALLBACK_COLOR;
/** Cor principal do produto: `color` do catálogo, senão a da categoria. */
export function productColorOf(p: Pick<Product, 'color' | 'category'>): number {
  if (p.color && /^#?[0-9a-f]{6}$/i.test(p.color.trim())) return hex(p.color);
  return categoryColorOf(p.category);
}
export function productShapeOf(p: Pick<Product, 'shape' | 'category'>): Shape {
  return asShape(p.shape) ?? CATEGORY_SHAPE[p.category] ?? 'box';
}
/** Cor de destaque para um id de produto (ou cinza neutro sem produto/desconhecido). */
export function categoryColor(pid: string | undefined): number {
  if (!pid) return FALLBACK_COLOR;
  try { return productColorOf(productById(pid)); } catch { return FALLBACK_COLOR; }
}
export const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
