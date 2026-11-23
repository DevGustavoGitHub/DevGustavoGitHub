import { FURNITURE_FOOTPRINT, type FurnitureType } from '../core/layout';
import type { StockedFurniture } from './api';
import { migrateLevels } from './levels';
import { rentFor } from './rent';
import { INITIAL_NEXT_FURNITURE_ID, initialFurniture, newGame, type Furniture, type StoreState } from './state';

export const SAVE_KEY = 'mercadinho-sim:save:v1';

/** Subconjunto de Storage — injetável para testes e para Capacitor Preferences depois. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const serialize = (s: StoreState): string => JSON.stringify(s);

const isFurnitureType = (t: unknown): t is FurnitureType => typeof t === 'string' && Object.hasOwn(FURNITURE_FOOTPRINT, t);
const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);

/**
 * Mescla sobre um jogo novo (saves antigos ganham campos novos) e migra:
 * - sem móveis (save anterior ao sistema de móveis) => layout inicial;
 * - state.slots sempre recalculado a partir dos móveis (fonte da verdade);
 * - levelAck ausente => nível atual (não dispara avisos antigos);
 * - Fase 2: loan/autoOrders/upgrades/history/stats/bankruptcies ausentes => defaults.
 * - Fase 3: furnitureStock ausente => [] (entradas inválidas descartadas); ledger sem happy/angry => atendidos contam
 *   como felizes e perdidos como irritados; Box.open inválido => removido (ausente = fechada); save anterior à Fase 3
 *   => aluguel recalculado no modelo novo (rent.ts). A decoração salva é mantida (só saves sem decor ganham a paleta nova).
 * - Fase 4: `Furniture.levels` (levels.migrateLevels): saves sem níveis ganham níveis etiquetados com o produto antigo
 *   do móvel e o estoque exposto somado é distribuído por eles (sobra → depósito/calçada); shelf/slots recalculados.
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
    s.nextFurnitureId = Math.max(s.nextFurnitureId, INITIAL_NEXT_FURNITURE_ID);
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
  // Fase 3
  const phase3 = Array.isArray(data.furnitureStock);
  s.furnitureStock = phase3
    ? (data.furnitureStock as unknown[]).flatMap((e): StockedFurniture[] => {
        if (typeof e !== 'object' || e === null) return [];
        const { type, variant } = e as { type?: unknown; variant?: unknown };
        if (!isFurnitureType(type)) return [];
        return [typeof variant === 'string' ? { type, variant } : { type }];
      })
    : [];
  const oldLedger = data.ledger as Partial<StoreState['ledger']> | undefined;
  if (oldLedger && oldLedger.happy === undefined && oldLedger.angry === undefined) {
    s.ledger.happy = count(oldLedger.served);
    s.ledger.angry = count(oldLedger.lost);
  }
  s.ledger.happy = count(s.ledger.happy);
  s.ledger.angry = count(s.ledger.angry);
  if (!Array.isArray(s.sidewalk)) s.sidewalk = [];
  for (const b of s.sidewalk) if (b.open !== undefined && typeof b.open !== 'boolean') delete b.open;
  if (!phase3 || !Number.isFinite(s.rent) || s.rent < 0) s.rent = rentFor(s);
  // Fase 4: níveis por móvel. Save sem nenhum nível (Fase 3 ou anterior): etiqueta os níveis com Furniture.productId e
  // distribui o estoque exposto somado (data.shelf) pelos níveis; com níveis, só saneia. shelf/slots são derivados.
  if (typeof s.storage !== 'object' || s.storage === null || Array.isArray(s.storage)) s.storage = {};
  const legacyLevels = !(Array.isArray(data.furniture) && data.furniture.some((f) => Array.isArray((f as Partial<Furniture> | null)?.levels)));
  migrateLevels(s, data.shelf, legacyLevels);
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
