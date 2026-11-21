import { recomputeSlots } from './furniture';
import { initialFurniture, newGame, type StoreState } from './state';

export const SAVE_KEY = 'mercadinho-sim:save:v1';

/** Subconjunto de Storage — injetável para testes e para Capacitor Preferences depois. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const serialize = (s: StoreState): string => JSON.stringify(s);

/**
 * Mescla sobre um jogo novo (saves antigos ganham campos novos) e migra:
 * - sem móveis (save anterior ao sistema de móveis) => layout inicial;
 * - state.slots sempre recalculado a partir dos móveis (fonte da verdade);
 * - levelAck ausente => nível atual (não dispara avisos antigos);
 * - Fase 2: loan/autoOrders/upgrades/history/stats/bankruptcies ausentes => defaults.
 */
export function deserialize(raw: string): StoreState {
  const data = JSON.parse(raw) as Partial<StoreState>;
  if (data.version !== 1) throw new Error('Versão de save incompatível');
  const base = newGame(data.seed ?? 1);
  const s = {
    ...base,
    ...data,
    market: { ...base.market, ...data.market },
    employees: { ...base.employees, ...data.employees },
    ledger: { ...base.ledger, ...data.ledger },
    decor: { ...base.decor, ...data.decor },
  } as StoreState;
  if (!Array.isArray(data.furniture) || (data.furniture.length === 0 && (data.nextFurnitureId ?? 1) <= 1)) {
    s.furniture = initialFurniture();
    s.nextFurnitureId = Math.max(s.nextFurnitureId, 6);
  }
  s.nextFurnitureId = Math.max(s.nextFurnitureId, ...s.furniture.map((f) => f.id + 1));
  if (data.levelAck === undefined) s.levelAck = s.level;
  // Fase 2: saves antigos não têm estes campos (o spread já deu os defaults); sanea tipos inválidos.
  if (!Number.isFinite(s.loan) || s.loan < 0) s.loan = 0;
  if (typeof s.autoOrders !== 'object' || s.autoOrders === null || Array.isArray(s.autoOrders)) s.autoOrders = {};
  if (!Array.isArray(s.upgrades)) s.upgrades = [];
  if (!Array.isArray(s.history)) s.history = [];
  if (!Array.isArray(s.stats)) s.stats = [];
  if (!Number.isFinite(s.bankruptcies)) s.bankruptcies = 0;
  recomputeSlots(s);
  return s;
}

export function save(kv: KV, s: StoreState): void {
  kv.setItem(SAVE_KEY, serialize(s));
}

export function load(kv: KV): StoreState | null {
  const raw = kv.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    return null; // save corrompido: o chamador decide (novo jogo / avisar)
  }
}
