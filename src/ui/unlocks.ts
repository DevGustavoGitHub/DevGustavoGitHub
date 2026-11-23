/**
 * Liberações por nível (licenças, móveis, funcionários, melhorias, expansões, depósito, decoração) para a tela de
 * comemoração, e controle de "novidade não vista" (ponto vermelho no HUD e no trilho do tablet).
 * Persistência: localStorage['mercadinho:seen'] = { [aba]: maior nível já visto }.
 */
import * as api from '../sim/api';
import { LICENSES, PRODUCTS } from '../sim/catalog';
import type { StoreState } from '../sim/state';
import { EMPLOYEE_TABLE, EXPANSIONS } from '../sim/tuning';
import { decorSvg, expansionSvg, furnitureSvg, licenseSvg, personSvg, storageSvg, upgradeSvg } from './art';
import { CATEGORY_NAME } from './widgets';

export type UnlockKind = 'license' | 'furniture' | 'employee' | 'upgrade' | 'expansion' | 'storage' | 'decor';
export interface Unlock { key: string; kind: UnlockKind; name: string; level: number; tab: string; icon(size?: number): string }

export const SEEN_KEY = 'mercadinho:seen';
const ROLE_NAME: Record<string, string> = { cashier: 'Caixa', janitor: 'Faxineiro', stocker: 'Repositor' };

const tryv = <T,>(fn: () => T, fb: T): T => { try { return fn(); } catch { return fb; } };

let cache: Unlock[] | null = null;

/** Todas as liberações com nível mínimo > 1 (o que já vem no começo não é "novidade"). */
export function allUnlocks(state: StoreState): Unlock[] {
  if (cache) return cache;
  const out: Unlock[] = [];
  for (const l of LICENSES) {
    if (l.minLevel <= 1) continue;
    const ps = PRODUCTS.filter((p) => p.category === l.id);
    out.push({ key: `lic:${l.id}`, kind: 'license', name: `Licença: ${CATEGORY_NAME[l.id]}`, level: l.minLevel, tab: 'licenses', icon: (s = 64) => licenseSvg(l.id, ps, s) });
  }
  for (const f of tryv(() => api.furnitureCatalog(), [] as api.FurnitureSpec[])) {
    if (f.minLevel <= 1 || f.type === 'decor') continue;
    out.push({ key: `fur:${f.type}`, kind: 'furniture', name: f.name, level: f.minLevel, tab: 'market', icon: (s = 64) => furnitureSvg(f.type, s) });
  }
  for (const d of tryv(() => api.decorCatalog(), [] as api.DecorItem[])) {
    if (d.minLevel <= 1) continue;
    out.push({ key: `dec:${d.id}`, kind: 'decor', name: d.name, level: d.minLevel, tab: 'market', icon: (s = 64) => decorSvg(d.id, s) });
  }
  for (const role of Object.keys(EMPLOYEE_TABLE) as (keyof typeof EMPLOYEE_TABLE)[]) {
    const lv = EMPLOYEE_TABLE[role].minLevel[0];
    if (lv === undefined || lv <= 1) continue;
    out.push({ key: `emp:${role}`, kind: 'employee', name: `Funcionário: ${ROLE_NAME[role] ?? role}`, level: lv, tab: 'staff', icon: (s = 64) => personSvg(role, s) });
  }
  for (const u of tryv(() => api.upgradeCatalog(state), [] as api.UpgradeSpec[])) {
    if (u.minLevel <= 1) continue;
    out.push({ key: `upg:${u.id}`, kind: 'upgrade', name: u.name, level: u.minLevel, tab: 'upgrades', icon: (s = 64) => upgradeSvg(u.id, s) });
  }
  EXPANSIONS.forEach((e, i) => {
    out.push({ key: `exp:${i + 1}`, kind: 'expansion', name: `Expansão da loja ${i + 1}`, level: e.minLevel, tab: 'expansion', icon: (s = 64) => expansionSvg(i + 1, s) });
  });
  const st = tryv(() => api.storageCost(), null);
  if (st && st.minLevel > 1) out.push({ key: 'storage', kind: 'storage', name: 'Depósito', level: st.minLevel, tab: 'services', icon: (s = 64) => storageSvg(s) });
  cache = out.sort((a, b) => a.level - b.level);
  return cache;
}

export const unlocksAt = (state: StoreState, level: number): Unlock[] => allUnlocks(state).filter((u) => u.level === level);
/** Próximo nível (> level) que libera algo, com a lista. */
export function nextUnlocks(state: StoreState, level: number): { level: number; items: Unlock[] } | null {
  const n = allUnlocks(state).find((u) => u.level > level);
  return n ? { level: n.level, items: unlocksAt(state, n.level) } : null;
}

/* ---------------- novidade não vista ---------------- */
type Seen = Record<string, number>;
const TABS = ['market', 'licenses', 'staff', 'upgrades', 'expansion', 'services'];

function readSeen(state: StoreState): Seen {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) return JSON.parse(raw) as Seen;
  } catch { /* privado */ }
  // primeira vez (ou save antigo): nada retroativo
  const s: Seen = {};
  for (const t of TABS) s[t] = state.level;
  writeSeen(s);
  return s;
}
function writeSeen(s: Seen): void { try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* privado */ } }

/** Abas com algo liberado (nível ≤ atual) ainda não visto. */
export function unseenTabs(state: StoreState): Set<string> {
  const seen = readSeen(state);
  const out = new Set<string>();
  for (const u of allUnlocks(state)) if (u.level <= state.level && u.level > (seen[u.tab] ?? state.level)) out.add(u.tab);
  return out;
}
/** Novidades não vistas (para a folha de nível). */
export function unseenItems(state: StoreState): Unlock[] {
  const seen = readSeen(state);
  return allUnlocks(state).filter((u) => u.level <= state.level && u.level > (seen[u.tab] ?? state.level));
}
export function markSeen(state: StoreState, tab: string): void {
  const seen = readSeen(state);
  if ((seen[tab] ?? 0) >= state.level) return;
  seen[tab] = state.level;
  writeSeen(seen);
}
export function markAllSeen(state: StoreState): void {
  const seen = readSeen(state);
  for (const t of TABS) seen[t] = Math.max(seen[t] ?? 0, state.level);
  writeSeen(seen);
}
