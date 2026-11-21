import type { Cents } from './money';

export type Category = 'mercearia' | 'bebidas' | 'laticinios' | 'congelados' | 'padaria' | 'limpeza';

/** Cada categoria é liberada por uma licença comprada no computador. */
export interface License {
  id: Category;
  name: string;
  minLevel: number;
  cost: Cents;
}

export interface Product {
  id: string;
  name: string;
  category: Category;
  /** Custo de atacado médio (centavos) por unidade. */
  baseWholesale: Cents;
  /** Preço médio de mercado = baseWholesale * markup (antes das flutuações). */
  markup: number;
  boxSize: number;
  /** Unidades por slot de prateleira. */
  slotCapacity: number;
  /** Peso de popularidade na lista de compras do cliente. */
  popularity: number;
}

export const LICENSES: License[] = [
  { id: 'mercearia', name: 'Mercearia', minLevel: 1, cost: 0 },
  { id: 'bebidas', name: 'Bebidas', minLevel: 3, cost: 150000 },
  { id: 'laticinios', name: 'Laticínios', minLevel: 5, cost: 400000 },
  { id: 'padaria', name: 'Padaria', minLevel: 7, cost: 800000 },
  { id: 'limpeza', name: 'Limpeza', minLevel: 9, cost: 1200000 },
  { id: 'congelados', name: 'Congelados', minLevel: 11, cost: 2000000 },
];

export const PRODUCTS: Product[] = [
  { id: 'arroz', name: 'Arroz 5kg', category: 'mercearia', baseWholesale: 2200, markup: 1.4, boxSize: 6, slotCapacity: 8, popularity: 5 },
  { id: 'feijao', name: 'Feijão 1kg', category: 'mercearia', baseWholesale: 600, markup: 1.45, boxSize: 12, slotCapacity: 12, popularity: 5 },
  { id: 'macarrao', name: 'Macarrão 500g', category: 'mercearia', baseWholesale: 350, markup: 1.5, boxSize: 20, slotCapacity: 16, popularity: 4 },
  { id: 'cafe', name: 'Café 500g', category: 'mercearia', baseWholesale: 1300, markup: 1.35, boxSize: 10, slotCapacity: 10, popularity: 4 },
  { id: 'refri', name: 'Refrigerante 2L', category: 'bebidas', baseWholesale: 550, markup: 1.5, boxSize: 6, slotCapacity: 10, popularity: 5 },
  { id: 'agua', name: 'Água 1,5L', category: 'bebidas', baseWholesale: 180, markup: 1.7, boxSize: 12, slotCapacity: 12, popularity: 3 },
  { id: 'leite', name: 'Leite 1L', category: 'laticinios', baseWholesale: 400, markup: 1.4, boxSize: 12, slotCapacity: 12, popularity: 5 },
  { id: 'queijo', name: 'Queijo 300g', category: 'laticinios', baseWholesale: 1100, markup: 1.45, boxSize: 8, slotCapacity: 8, popularity: 3 },
  { id: 'pao', name: 'Pão francês (6un)', category: 'padaria', baseWholesale: 300, markup: 1.8, boxSize: 10, slotCapacity: 10, popularity: 4 },
  { id: 'detergente', name: 'Detergente', category: 'limpeza', baseWholesale: 180, markup: 1.7, boxSize: 24, slotCapacity: 16, popularity: 3 },
  { id: 'sorvete', name: 'Sorvete 2L', category: 'congelados', baseWholesale: 1400, markup: 1.5, boxSize: 6, slotCapacity: 6, popularity: 3 },
];

export const productById = (id: string): Product => {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`Produto desconhecido: ${id}`);
  return p;
};
