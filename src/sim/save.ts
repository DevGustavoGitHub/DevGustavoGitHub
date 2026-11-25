import { FURNITURE_FOOTPRINT, MAX_EXPANSION, STORAGE_DEPTH, storeBounds, type FurnitureType } from '../core/layout';
import type { StockedFurniture } from './api';
import { LICENSES, PRODUCTS, productById } from './catalog';
import { unitsOwned, xpForLevel } from './economy';
import { ensureDesk, footprintOf } from './furniture';
import { migrateLevels, returnUnits, stockProduct } from './levels';
import { MARKET_MAX, MARKET_MIN, wholesale } from './market';
import { roundPrice } from './money';
import { rentFor } from './rent';
import {
  CLOSE_MIN, INITIAL_NEXT_FURNITURE_ID, OPEN_MIN, initialFurniture, newGame, type Box, type Furniture, type SavedDayPhase,
  type StoreState,
} from './state';
import { DIRT, HISTORY_DAYS, MAX_EMPLOYEE_LEVEL, STORE_NAME_MAX, UPGRADES } from './tuning';

export const SAVE_KEY = 'mercadinho-sim:save:v1';
/**
 * Fase 4 (QA): quando o save não pôde ser lido, `load` guarda o texto original em `${SAVE_KEY}:corrupt-<timestamp>` e grava
 * nesta chave `{"key": <chave do backup>, "at": <timestamp>, "error": <mensagem>}`. A UI avisa ("save danificado") e apaga.
 */
export const SAVE_RECOVERED_KEY = 'mercadinho:save-recovered';

/** Subconjunto de Storage — injetável para testes e para Capacitor Preferences depois. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const serialize = (s: StoreState): string => JSON.stringify(s);

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFurnitureType = (t: unknown): t is FurnitureType => typeof t === 'string' && Object.hasOwn(FURNITURE_FOOTPRINT, t);
const PRODUCT_IDS = new Set(PRODUCTS.map((p) => p.id));
const isProduct = (id: unknown): id is string => typeof id === 'string' && PRODUCT_IDS.has(id);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Número finito (aceita texto numérico, ex.: "1000"); senão undefined. */
const toNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};
const intOr = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => {
  const n = toNum(v);
  return n === undefined ? d : Math.min(hi, Math.max(lo, Math.round(n)));
};
const ROTS: readonly number[] = [0, 90, 180, 270];
const PHASES: readonly SavedDayPhase[] = ['prep', 'open', 'closing', 'report'];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const tile = (x: number, z: number): number => (z + 64) * 256 + x;

/** Escalares e objetos simples (números finitos/inteiros nas faixas válidas, produtos/licenças/melhorias do catálogo). */
function sanitizeFields(s: StoreState, d: Raw, base: StoreState): void {
  s.version = 1;
  s.seed = intOr(d.seed, 1);
  s.day = intOr(d.day, 1, 1);
  s.money = intOr(d.money, 0);
  s.level = intOr(d.level, 1, 1, 999);
  const xp = toNum(d.xp);
  s.xp = xp === undefined || xp < 0 ? xpForLevel(s.level) : Math.round(xp);
  s.reputation = Math.min(5, Math.max(1, toNum(d.reputation) ?? base.reputation));
  s.levelAck = d.levelAck === undefined ? s.level : intOr(d.levelAck, s.level, 0);
  s.loan = intOr(d.loan, 0, 0);
  s.bankruptcies = intOr(d.bankruptcies, 0, 0);
  s.expansion = intOr(d.expansion, 0, 0, MAX_EXPANSION);
  // pós-teste 3: salão inicial menor — save da tabela antiga mantém o tamanho (expansão 0 antiga = 12×10 = expansão 1 nova)
  if (d.sizeVersion !== 2) s.expansion = Math.min(MAX_EXPANSION, s.expansion + 1);
  s.sizeVersion = 2;
  s.storageUnlocked = d.storageUnlocked === true;
  s.storeName = typeof d.storeName === 'string' && d.storeName.trim() ? d.storeName.trim().slice(0, STORE_NAME_MAX) : base.storeName;
  const lic = (Array.isArray(d.licenses) ? d.licenses : []).filter((x): x is string => typeof x === 'string' && LICENSES.some((l) => l.id === x));
  if (!lic.includes('mercearia')) lic.unshift('mercearia');
  s.licenses = [...new Set(lic)];
  s.upgrades = [...new Set((Array.isArray(d.upgrades) ? d.upgrades : []).filter((x): x is string => typeof x === 'string' && Object.hasOwn(UPGRADES, x)))];
  const m = isObj(d.market) ? d.market : {};
  s.market = Object.fromEntries(PRODUCTS.map((p) => [p.id, Math.min(MARKET_MAX, Math.max(MARKET_MIN, toNum(m[p.id]) ?? 1))]));
  const perProduct = <T>(v: unknown, f: (x: unknown) => T | undefined): Record<string, T> => {
    const out: Record<string, T> = {};
    if (isObj(v)) for (const [k, x] of Object.entries(v)) { const y = isProduct(k) ? f(x) : undefined; if (y !== undefined) out[k] = y; }
    return out;
  };
  s.prices = perProduct(d.prices, (x) => { const n = toNum(x); return n !== undefined && n > 0 ? roundPrice(n) : undefined; });
  s.storage = perProduct(d.storage, (x) => intOr(x, 0, 0));
  s.costBasis = perProduct(d.costBasis, (x) => (isObj(x) ? { units: intOr(x.units, 0, 0), avg: intOr(x.avg, 0, 0) } : undefined));
  s.autoOrders = perProduct(d.autoOrders, (x) =>
    isObj(x) && toNum(x.minUnits) !== undefined && toNum(x.boxes) !== undefined
      ? { minUnits: intOr(x.minUnits, 0, 0, 9999), boxes: intOr(x.boxes, 1, 1, 24) } : undefined);
  const e = isObj(d.employees) ? d.employees : {};
  s.employees = { cashier: intOr(e.cashier, 0, 0, MAX_EMPLOYEE_LEVEL), stocker: intOr(e.stocker, 0, 0, MAX_EMPLOYEE_LEVEL), janitor: intOr(e.janitor, 0, 0, MAX_EMPLOYEE_LEVEL) };
  if (s.employees.cashier > 0 && toNum(e.cashierCount) !== undefined) s.employees.cashierCount = intOr(e.cashierCount, 1, 1, 4);
  // ledger: inteiros >= 0; Fase 3 sem happy/angry => atendidos contam felizes e perdidos irritados
  const l = isObj(d.ledger) ? d.ledger : {};
  const L = s.ledger;
  for (const k of ['revenue', 'tips', 'cogs', 'purchases', 'served', 'lost'] as const) L[k] = intOr(l[k], 0, 0);
  const oldLedger = l.happy === undefined && l.angry === undefined;
  L.happy = oldLedger ? L.served : intOr(l.happy, 0, 0);
  L.angry = oldLedger ? L.lost : intOr(l.angry, 0, 0);
  L.recycled = intOr(l.recycled, 0, 0);
  L.recycleIncome = intOr(l.recycleIncome, 0, 0);
  const dc = isObj(d.decor) ? d.decor : {};
  for (const k of ['wallColor', 'floorColor', 'signColor'] as const) {
    const v = dc[k];
    s.decor[k] = typeof v === 'string' && COLOR.test(v) ? v : base.decor[k];
  }
  s.dirt = (Array.isArray(d.dirt) ? d.dirt : []).filter((p): p is { x: number; z: number } => isObj(p) && finite(p.x) && finite(p.z))
    .slice(0, DIRT.cap).map((p) => ({ x: p.x, z: p.z }));
  s.history = (Array.isArray(d.history) ? d.history : []).filter(isObj).slice(-HISTORY_DAYS) as unknown as StoreState['history'];
  s.stats = (Array.isArray(d.stats) ? d.stats : []).flatMap((x) => {
    if (!isObj(x) || !Number.isInteger(x.day)) return [];
    const p = perProduct(x.p, (t) => (Array.isArray(t) && t.length === 3 && t.every(finite) ? (t as [number, number, number]) : undefined));
    return [{ day: x.day as number, p }];
  }).slice(-HISTORY_DAYS);
  const c = isObj(d.clock) ? d.clock : {};
  const phase = PHASES.find((ph) => ph === c.phase) ?? 'prep';
  s.clock = { minute: phase === 'prep' ? OPEN_MIN : Math.min(CLOSE_MIN, Math.max(OPEN_MIN, toNum(c.minute) ?? OPEN_MIN)), phase };
}

/** Caixas: produto do catálogo, unidades inteiras (acima de boxSize vira mais caixas), x/z/rot numéricos, flags booleanas. */
function sanitizeBoxes(d: Raw): Box[] {
  const out: Box[] = [];
  for (const b of Array.isArray(d.sidewalk) ? d.sidewalk : []) {
    if (!isObj(b) || !isProduct(b.productId)) continue; // caixa de produto que saiu do catálogo: descartada
    const p = productById(b.productId);
    const units = intOr(b.units, 0, 0);
    const box = { ...b, productId: p.id, units: Math.min(units, p.boxSize) } as Box & Raw;
    for (const k of ['x', 'z', 'rot'] as const) if (box[k] !== undefined && !finite(box[k])) delete box[k];
    for (const k of ['carried', 'open'] as const) if (box[k] !== undefined && typeof box[k] !== 'boolean') delete box[k];
    out.push(box);
    for (let rest = units - box.units; rest > 0; rest -= p.boxSize) out.push({ productId: p.id, units: Math.min(p.boxSize, rest), open: false });
  }
  return out;
}

/**
 * Móveis: tipo desconhecido (catálogo mudou / APK mais antigo) é descartado; posição/rotação inválida, fora da área do
 * tipo ou sobreposta volta para o estoque de montagem. Unidades expostas desses móveis vão para `giveBack`. Ids repetidos
 * ou inválidos ganham ids novos. Devolve se o save é anterior aos níveis (Fase 3 ou antes).
 */
function sanitizeFurniture(s: StoreState, d: Raw, giveBack: [string, number][]): boolean {
  const raw = Array.isArray(d.furniture) ? d.furniture : undefined;
  let next = intOr(d.nextFurnitureId, 1, 1);
  if (!raw || (raw.length === 0 && next <= 1)) { // save anterior ao sistema de móveis => layout inicial
    s.furniture = initialFurniture();
    s.nextFurnitureId = Math.max(next, INITIAL_NEXT_FURNITURE_ID);
    return true;
  }
  const legacy = !raw.some((f) => isObj(f) && Array.isArray(f.levels));
  const b = storeBounds(s.expansion);
  const occupied = new Set<number>();
  const ids = new Set<number>();
  const needId: Furniture[] = [];
  const out: Furniture[] = [];
  for (const e of raw) {
    if (!isObj(e)) continue;
    const back = (): void => {
      for (const l of Array.isArray(e.levels) ? e.levels : []) if (isObj(l) && isProduct(l.productId)) giveBack.push([l.productId, intOr(l.units, 0, 0)]);
    };
    if (!isFurnitureType(e.type)) { back(); continue; }
    const type = e.type;
    const variant = typeof e.variant === 'string' ? e.variant : undefined;
    const rot = ROTS.find((r) => r === e.rot) as Furniture['rot'] | undefined;
    const { x, z } = e;
    let ok = rot !== undefined && Number.isInteger(x) && Number.isInteger(z);
    const tiles: number[] = [];
    if (ok) {
      const fx = x as number;
      const fz = z as number;
      const { w, d: dd } = footprintOf(type, rot!);
      const inX = fx >= 0 && fx + w <= b.width;
      const inHall = inX && fz >= 0 && fz + dd <= b.depth;
      const inStorage = s.storageUnlocked && inX && fz >= -STORAGE_DEPTH && fz + dd <= 0;
      ok = type === 'rack' ? inStorage : type === 'decor' ? inHall || inStorage : inHall;
      for (let i = 0; i < w; i++) for (let j = 0; j < dd; j++) tiles.push(tile(fx + i, fz + j));
      if (tiles.some((t) => occupied.has(t))) ok = false;
    }
    if (!ok || (type === 'desk' && out.some((o) => o.type === 'desk'))) { // sem lugar válido: volta para "Para montar"
      if (type === 'desk') continue; // a mesa do computador não vai para o estoque: deserialize a recoloca (ensureDesk)
      back();
      s.furnitureStock.push(variant !== undefined ? { type, variant } : { type });
      continue;
    }
    for (const t of tiles) occupied.add(t);
    const f = { ...e, type, rot } as Furniture & Raw;
    if (variant === undefined) delete f.variant;
    if (f.productId !== undefined && !isProduct(f.productId)) delete f.productId;
    if (f.levels !== undefined && !Array.isArray(f.levels)) delete f.levels;
    if (Number.isInteger(e.id) && (e.id as number) > 0 && !ids.has(e.id as number)) ids.add(e.id as number);
    else needId.push(f);
    out.push(f);
  }
  next = Math.max(next, ...[...ids].map((id) => id + 1));
  for (const f of needId) f.id = next++;
  s.furniture = out;
  s.nextFurnitureId = next;
  return legacy;
}

/** Devolve unidades à exposição (níveis do produto, depois níveis livres) e o resto ao depósito/calçada. */
function restock(s: StoreState, productId: string, n: number): void {
  if (n > 0) returnUnits(s, productId, n - stockProduct(s, productId, n));
}

/**
 * Mescla sobre um jogo novo (saves antigos ganham campos novos), SANEIA e migra:
 * - números inválidos (NaN salvo vira null no JSON, texto, negativos, não inteiros) => valor válido/padrão; objetos
 *   null/errados => padrão; produtos, licenças e melhorias fora do catálogo são removidos (caixas e depósito também);
 * - móveis: tipo desconhecido descartado (unidades devolvidas), posição inválida/sobreposta => estoque de montagem;
 * - sem móveis (save anterior ao sistema de móveis) => layout inicial; levelAck ausente => nível atual;
 * - Fase 2/3: campos ausentes => defaults; ledger sem happy/angry => atendidos felizes e perdidos irritados; Box.open
 *   inválido removido (ausente = fechada); save anterior à Fase 3 => aluguel recalculado (rent.ts);
 * - Fase 4: níveis (levels.migrateLevels: saves sem níveis distribuem o estoque somado), `clock` ausente/ inválido =>
 *   preparação às 08:00, `npcHeld` (cestas dos clientes) devolvido à exposição e zerado, e `costBasis.units` =
 *   unidades possuídas (custo médio coerente mesmo com saves antigos que perderam itens das cestas).
 * Lança só para JSON ilegível ou versão diferente de 1.
 */
export function deserialize(raw: string): StoreState {
  const data: unknown = JSON.parse(raw);
  if (!isObj(data) || data.version !== 1) throw new Error('Versão de save incompatível');
  const base = newGame(intOr(data.seed, 1));
  const s = { ...base, ...data, ledger: { ...base.ledger }, decor: { ...base.decor } } as StoreState;
  sanitizeFields(s, data, base);
  s.sidewalk = sanitizeBoxes(data);
  // Fase 3: estoque de montagem (entradas inválidas descartadas)
  const phase3 = Array.isArray(data.furnitureStock);
  s.furnitureStock = (phase3 ? (data.furnitureStock as unknown[]) : []).flatMap((e): StockedFurniture[] => {
    if (!isObj(e) || !isFurnitureType(e.type) || e.type === 'desk') return [];
    return [typeof e.variant === 'string' ? { type: e.type, variant: e.variant } : { type: e.type }];
  });
  const giveBack: [string, number][] = [];
  const legacyLevels = sanitizeFurniture(s, data, giveBack);
  ensureDesk(s); // saves anteriores à mesa móvel (ou com a mesa inválida) ganham a mesa colada ao balcão
  const rent = toNum(data.rent);
  s.rent = !phase3 || rent === undefined || rent < 0 ? rentFor(s) : Math.round(rent);
  // Fase 4: níveis (fonte da verdade); shelf/slots são derivados (recalculados por migrateLevels)
  s.shelf = {};
  s.slots = {};
  migrateLevels(s, data.shelf, legacyLevels);
  for (const [pid, n] of giveBack) restock(s, pid, n);
  // cestas/esteira dos clientes no momento do save: os clientes não voltam, os itens voltam à exposição
  if (Array.isArray(data.npcHeld)) {
    for (const h of data.npcHeld) if (isObj(h) && isProduct(h.productId)) restock(s, h.productId, intOr(h.qty, 0, 0));
    s.npcHeld = [];
  } else delete s.npcHeld;
  // custo médio cobre exatamente o que se possui (exposição + depósito + calçada)
  for (const p of PRODUCTS) {
    const owned = unitsOwned(s, p.id);
    const basis = s.costBasis[p.id];
    if (basis) basis.units = owned;
    else if (owned > 0) s.costBasis[p.id] = { units: owned, avg: wholesale(s, p.id) };
  }
  return s;
}

export function save(kv: KV, s: StoreState): void {
  kv.setItem(SAVE_KEY, serialize(s));
}

/**
 * Carrega o save; null se não há save ou se ele é ilegível. Ilegível: antes de devolver null guarda o texto original em
 * `${SAVE_KEY}:corrupt-<timestamp>` (uma vez por conteúdo) e grava SAVE_RECOVERED_KEY, para a UI avisar — assim o
 * autosave do jogo novo não apaga o único exemplar do save antigo.
 */
export function load(kv: KV): StoreState | null {
  const raw = kv.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch (e) {
    try {
      const prev = kv.getItem(SAVE_RECOVERED_KEY);
      const prevKey: unknown = prev ? (JSON.parse(prev) as Raw | null)?.key : undefined;
      if (typeof prevKey !== 'string' || kv.getItem(prevKey) !== raw) {
        const at = Date.now();
        const key = `${SAVE_KEY}:corrupt-${at}`;
        kv.setItem(key, raw);
        kv.setItem(SAVE_RECOVERED_KEY, JSON.stringify({ key, at, error: e instanceof Error ? e.message : String(e) }));
      }
    } catch {
      /* armazenamento cheio ou chave de aviso ilegível: segue sem backup */
    }
    return null; // o chamador decide (novo jogo + aviso)
  }
}
