/**
 * Aluguel diário com início tardio (Fase 3). O valor do dia fica em `state.rent` (a UI lê o campo) e é recalculado
 * no início de cada dia (closeDay), ao comprar expansão, no recomeço após falência e ao migrar saves antigos.
 */
import type { Cents } from './money';
import type { StoreState } from './state';
import { RENT } from './tuning';

/** Aluguel cheio da loja (sem rampa): base + por expansão. */
export const fullRent = (expansion: number): Cents => RENT.base + RENT.perExpansion * Math.max(0, Math.floor(expansion));

/**
 * Fração do aluguel cobrada: 0 abaixo do nível RENT.startLevel E antes do dia RENT.startDay; depois sobe 1/rampSteps por
 * nível ou por dia (o que estiver mais adiantado). Com nível 4 / dia 6 (QA economia): nível 4 ou dia 6 → 1/3; nível 5 ou
 * dia 7 → 2/3; nível 6 ou dia 8 → integral.
 */
export function rentFactor(level: number, day: number): number {
  const stage = Math.max(level - RENT.startLevel + 1, day - RENT.startDay + 1);
  return Math.min(1, Math.max(0, stage) / RENT.rampSteps);
}

/** Aluguel que será cobrado no fechamento do dia (múltiplo de R$ 1). */
export const rentFor = (s: Pick<StoreState, 'expansion' | 'level' | 'day'>): Cents =>
  Math.round((fullRent(s.expansion) * rentFactor(s.level, s.day)) / 100) * 100;
