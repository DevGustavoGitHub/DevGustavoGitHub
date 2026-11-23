import type { Cents } from './money';

export type Category =
  | 'mercearia' | 'bebidas' | 'laticinios' | 'congelados' | 'padaria' | 'limpeza'
  | 'hortifruti' | 'higiene' | 'frios' | 'eletronicos';

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
  /** Dicas visuais para o módulo world (cor principal CSS e forma). Opcionais: world tem fallback por categoria. */
  color?: string;
  shape?: 'box' | 'bottle' | 'can' | 'bag' | 'tray' | 'jar';
}

/** Fase 3: a 2ª licença sai no nível 2 (como no original); as demais seguem espaçadas até o nível 25. */
export const LICENSES: License[] = [
  { id: 'mercearia', name: 'Mercearia', minLevel: 1, cost: 0 },
  { id: 'bebidas', name: 'Bebidas', minLevel: 2, cost: 40000 },
  { id: 'laticinios', name: 'Laticínios', minLevel: 4, cost: 150000 },
  { id: 'padaria', name: 'Padaria', minLevel: 6, cost: 350000 },
  { id: 'limpeza', name: 'Limpeza', minLevel: 8, cost: 700000 },
  { id: 'congelados', name: 'Congelados', minLevel: 10, cost: 1300000 },
  { id: 'hortifruti', name: 'Hortifrúti', minLevel: 13, cost: 2200000 },
  { id: 'higiene', name: 'Higiene e Beleza', minLevel: 16, cost: 3400000 },
  { id: 'frios', name: 'Açougue e Frios', minLevel: 20, cost: 5200000 },
  { id: 'eletronicos', name: 'Eletrônicos e Utilidades', minLevel: 25, cost: 8500000 },
];

export const PRODUCTS: Product[] = [
  { id: 'arroz', name: 'Arroz 5kg', category: 'mercearia', baseWholesale: 2200, markup: 1.4, boxSize: 6, slotCapacity: 8, popularity: 5, color: '#e8dfc4', shape: 'bag' },
  { id: 'feijao', name: 'Feijão 1kg', category: 'mercearia', baseWholesale: 600, markup: 1.45, boxSize: 12, slotCapacity: 12, popularity: 5, color: '#7a4a2b', shape: 'bag' },
  { id: 'macarrao', name: 'Macarrão 500g', category: 'mercearia', baseWholesale: 350, markup: 1.5, boxSize: 20, slotCapacity: 16, popularity: 4, color: '#f0c75e', shape: 'bag' },
  { id: 'cafe', name: 'Café 500g', category: 'mercearia', baseWholesale: 1300, markup: 1.35, boxSize: 10, slotCapacity: 10, popularity: 4, color: '#5a3520', shape: 'box' },
  { id: 'refri', name: 'Refrigerante 2L', category: 'bebidas', baseWholesale: 550, markup: 1.5, boxSize: 6, slotCapacity: 10, popularity: 5, color: '#d83a3a', shape: 'bottle' },
  { id: 'agua', name: 'Água 1,5L', category: 'bebidas', baseWholesale: 180, markup: 1.7, boxSize: 12, slotCapacity: 12, popularity: 3, color: '#7ec8f0', shape: 'bottle' },
  { id: 'leite', name: 'Leite 1L', category: 'laticinios', baseWholesale: 400, markup: 1.4, boxSize: 12, slotCapacity: 12, popularity: 5, color: '#f4f4f0', shape: 'box' },
  { id: 'queijo', name: 'Queijo 300g', category: 'laticinios', baseWholesale: 1100, markup: 1.45, boxSize: 8, slotCapacity: 8, popularity: 3, color: '#f2c14e', shape: 'tray' },
  { id: 'pao', name: 'Pão francês (6un)', category: 'padaria', baseWholesale: 300, markup: 1.8, boxSize: 10, slotCapacity: 10, popularity: 4, color: '#d9a066', shape: 'bag' },
  { id: 'detergente', name: 'Detergente', category: 'limpeza', baseWholesale: 180, markup: 1.7, boxSize: 24, slotCapacity: 16, popularity: 3, color: '#3fbf6f', shape: 'bottle' },
  { id: 'sorvete', name: 'Sorvete 2L', category: 'congelados', baseWholesale: 1400, markup: 1.5, boxSize: 6, slotCapacity: 6, popularity: 3, color: '#f5b7c8', shape: 'jar' },
  // Hortifrúti
  { id: 'banana', name: 'Banana (dúzia)', category: 'hortifruti', baseWholesale: 450, markup: 1.7, boxSize: 10, slotCapacity: 12, popularity: 5, color: '#f2d03b', shape: 'tray' },
  { id: 'tomate', name: 'Tomate 1kg', category: 'hortifruti', baseWholesale: 500, markup: 1.7, boxSize: 10, slotCapacity: 10, popularity: 4, color: '#d9382b', shape: 'tray' },
  { id: 'batata', name: 'Batata 1kg', category: 'hortifruti', baseWholesale: 400, markup: 1.6, boxSize: 12, slotCapacity: 12, popularity: 4, color: '#b08a55', shape: 'bag' },
  { id: 'alface', name: 'Alface', category: 'hortifruti', baseWholesale: 200, markup: 1.9, boxSize: 12, slotCapacity: 12, popularity: 3, color: '#5fae45', shape: 'bag' },
  { id: 'maca', name: 'Maçã 1kg', category: 'hortifruti', baseWholesale: 700, markup: 1.6, boxSize: 10, slotCapacity: 10, popularity: 3, color: '#c62f3a', shape: 'tray' },
  // Higiene e beleza
  { id: 'sabonete', name: 'Sabonete', category: 'higiene', baseWholesale: 250, markup: 1.8, boxSize: 24, slotCapacity: 20, popularity: 4, color: '#f4b6d2', shape: 'box' },
  { id: 'papelhig', name: 'Papel higiênico 12un', category: 'higiene', baseWholesale: 1200, markup: 1.5, boxSize: 8, slotCapacity: 8, popularity: 5, color: '#f5f5ee', shape: 'bag' },
  { id: 'cremedental', name: 'Creme dental', category: 'higiene', baseWholesale: 350, markup: 1.7, boxSize: 24, slotCapacity: 16, popularity: 4, color: '#2fb7a8', shape: 'box' },
  { id: 'shampoo', name: 'Shampoo 350ml', category: 'higiene', baseWholesale: 900, markup: 1.6, boxSize: 12, slotCapacity: 10, popularity: 3, color: '#4aa3df', shape: 'bottle' },
  { id: 'desodorante', name: 'Desodorante', category: 'higiene', baseWholesale: 800, markup: 1.7, boxSize: 12, slotCapacity: 10, popularity: 3, color: '#7e8ce0', shape: 'can' },
  // Açougue e frios
  { id: 'carne', name: 'Carne moída 500g', category: 'frios', baseWholesale: 1800, markup: 1.4, boxSize: 8, slotCapacity: 8, popularity: 4, color: '#a3262a', shape: 'tray' },
  { id: 'frango', name: 'Peito de frango 1kg', category: 'frios', baseWholesale: 1300, markup: 1.45, boxSize: 8, slotCapacity: 8, popularity: 4, color: '#f0c9a0', shape: 'tray' },
  { id: 'linguica', name: 'Linguiça 500g', category: 'frios', baseWholesale: 1100, markup: 1.5, boxSize: 10, slotCapacity: 10, popularity: 3, color: '#c8643c', shape: 'tray' },
  { id: 'presunto', name: 'Presunto 200g', category: 'frios', baseWholesale: 900, markup: 1.5, boxSize: 10, slotCapacity: 10, popularity: 4, color: '#f08a8a', shape: 'tray' },
  { id: 'mortadela', name: 'Mortadela 200g', category: 'frios', baseWholesale: 500, markup: 1.7, boxSize: 12, slotCapacity: 12, popularity: 3, color: '#e89aa0', shape: 'tray' },
  // Eletrônicos e utilidades
  { id: 'pilha', name: 'Pilhas AA (4un)', category: 'eletronicos', baseWholesale: 900, markup: 1.8, boxSize: 20, slotCapacity: 16, popularity: 3, color: '#f2a31b', shape: 'box' },
  { id: 'lampada', name: 'Lâmpada LED', category: 'eletronicos', baseWholesale: 700, markup: 1.8, boxSize: 20, slotCapacity: 16, popularity: 3, color: '#fff0a8', shape: 'jar' },
  { id: 'fone', name: 'Fone de ouvido', category: 'eletronicos', baseWholesale: 3500, markup: 1.6, boxSize: 8, slotCapacity: 6, popularity: 2, color: '#3b3f48', shape: 'box' },
  { id: 'carregador', name: 'Carregador USB', category: 'eletronicos', baseWholesale: 4500, markup: 1.6, boxSize: 8, slotCapacity: 6, popularity: 2, color: '#2a6fdb', shape: 'box' },
  { id: 'ventilador', name: 'Ventilador de mesa', category: 'eletronicos', baseWholesale: 12000, markup: 1.35, boxSize: 2, slotCapacity: 4, popularity: 1, color: '#8a94a3', shape: 'box' },
];

export const productById = (id: string): Product => {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`Produto desconhecido: ${id}`);
  return p;
};
