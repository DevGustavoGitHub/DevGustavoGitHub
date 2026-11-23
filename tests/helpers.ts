/** Utilitários dos testes da sim (não é arquivo de teste). */
import { expect } from 'vitest';
import { furnitureForProduct, productCapacity } from '../src/sim/api';
import { emptyLevels, stockProduct } from '../src/sim/levels';
import type { StoreState } from '../src/sim/state';

/**
 * Expõe `n` unidades do produto sem caixas (substitui o antigo `s.shelf[id] += n`, que na Fase 4 é derivado dos
 * níveis). Sem espaço nos níveis do produto, cria um expositor fora da grade com todos os níveis etiquetados.
 */
export function expose(s: StoreState, id: string, n: number): void {
  while (productCapacity(s, id) - (s.shelf[id] ?? 0) < n) {
    const type = furnitureForProduct(id);
    s.furniture.push({ id: s.nextFurnitureId++, type, x: 40, z: 40, rot: 0, levels: emptyLevels(type, id) });
  }
  expect(stockProduct(s, id, n)).toBe(n);
}

/** Soma das unidades nos níveis de todos os móveis (fonte da verdade do estoque exposto). */
export function levelUnits(s: StoreState, id: string): number {
  return s.furniture.reduce((a, f) => a + (f.levels ?? []).reduce((b, l) => b + (l.productId === id ? l.units : 0), 0), 0);
}
