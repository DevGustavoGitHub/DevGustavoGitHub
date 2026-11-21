import { newGame, type StoreState } from './state';

export const SAVE_KEY = 'mercadinho-sim:save:v1';

/** Subconjunto de Storage — injetável para testes e para Capacitor Preferences depois. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const serialize = (s: StoreState): string => JSON.stringify(s);

export function deserialize(raw: string): StoreState {
  const data = JSON.parse(raw) as Partial<StoreState>;
  if (data.version !== 1) throw new Error('Versão de save incompatível');
  // Mescla sobre um jogo novo: saves antigos ganham campos novos com defaults.
  return { ...newGame(data.seed ?? 1), ...data } as StoreState;
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
