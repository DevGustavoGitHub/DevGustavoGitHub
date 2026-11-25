/**
 * QA de sistemas (sim + save): invariantes após sequências longas de ações aleatórias (fuzz com seed), atomicidade das
 * funções que lançam, round-trip do save, migração de saves das Fases 2/3 e saves corrompidos.
 * Cada `it` que falha documenta um problema de docs/qa/systems.md (o teste deve passar quando o bug for corrigido).
 */
import { describe, expect, it } from 'vitest';
import * as api from '../src/sim/api';
import { STORAGE_DEPTH, storeBounds, type FurnitureType } from '../src/core/layout';
import { LICENSES, PRODUCTS, productById } from '../src/sim/catalog';
import { addXp, buyLicense, setPrice, unitsOwned, xpForLevel } from '../src/sim/economy';
import { footprintOf, keepTiles, specOf } from '../src/sim/furniture';
import { makeRng } from '../src/sim/rng';
import { deserialize, load, save, serialize, SAVE_KEY, type KV } from '../src/sim/save';
import { newGame, type StoreState } from '../src/sim/state';
import { SIDEWALK_MAX_BOXES } from '../src/sim/tuning';

/* ---------------- invariantes ---------------- */
const int = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n);
const tkey = (x: number, z: number): number => (z + 64) * 256 + x;

/** Invariantes "duras" do estado (devolve a lista de violações; vazia = ok). */
export function hardViolations(s: StoreState): string[] {
  const v: string[] = [];
  if (!int(s.money)) v.push(`dinheiro não inteiro: ${s.money}`);
  if (!int(s.loan) || s.loan < 0) v.push(`empréstimo inválido: ${s.loan}`);
  const lv: Record<string, number> = {};
  const sl: Record<string, number> = {};
  const ids = new Set<number>();
  for (const f of s.furniture) {
    if (ids.has(f.id)) v.push(`id de móvel repetido ${f.id}`);
    ids.add(f.id);
    (f.levels ?? []).forEach((l, i) => {
      if (!int(l.units) || l.units < 0) v.push(`nível ${f.id}/${i}: unidades ${l.units}`);
      if (l.units > 0 && l.productId === undefined) v.push(`nível ${f.id}/${i}: unidades sem etiqueta`);
      if (l.productId !== undefined) {
        const p = productById(l.productId);
        if (l.units > p.slotCapacity) v.push(`nível ${f.id}/${i}: ${l.units} > capacidade ${p.slotCapacity}`);
        if (!specOf(f.type).categories.includes(p.category)) v.push(`nível ${f.id}/${i}: categoria recusada (${p.id})`);
        lv[p.id] = (lv[p.id] ?? 0) + l.units;
        sl[p.id] = (sl[p.id] ?? 0) + 1;
      }
    });
  }
  if (ids.size && s.nextFurnitureId <= Math.max(...ids)) v.push('nextFurnitureId <= id existente');
  for (const p of PRODUCTS) {
    if ((s.shelf[p.id] ?? 0) !== (lv[p.id] ?? 0)) v.push(`shelf[${p.id}]=${s.shelf[p.id]} ≠ soma dos níveis ${lv[p.id] ?? 0}`);
    if ((s.slots[p.id] ?? 0) !== (sl[p.id] ?? 0)) v.push(`slots[${p.id}]=${s.slots[p.id]} ≠ níveis etiquetados ${sl[p.id] ?? 0}`);
    const st = s.storage[p.id] ?? 0;
    if (!int(st) || st < 0) v.push(`storage[${p.id}]=${st}`);
    const cb = s.costBasis[p.id];
    const owned = unitsOwned(s, p.id);
    if ((cb?.units ?? 0) !== owned) v.push(`costBasis[${p.id}].units=${cb?.units ?? 0} ≠ possuídas ${owned}`);
    if (cb && (!int(cb.avg) || cb.avg < 0)) v.push(`costBasis[${p.id}].avg=${cb.avg}`);
  }
  s.sidewalk.forEach((b, i) => {
    const p = productById(b.productId);
    if (!int(b.units) || b.units < 0 || b.units > p.boxSize) v.push(`caixa ${i} (${b.productId}): ${b.units}/${p.boxSize}`);
  });
  if (s.storageUnlocked && api.storageUsed(s) > api.storageCapacity(s)) v.push(`depósito ${api.storageUsed(s)}/${api.storageCapacity(s)}`);
  const L = s.ledger;
  if (L.happy + L.angry !== L.served + L.lost) v.push('ledger: felizes+irritados ≠ atendidos+perdidos');
  if (s.xp < xpForLevel(s.level) || s.xp >= xpForLevel(s.level + 1)) v.push(`xp ${s.xp} incoerente com nível ${s.level}`);
  if (!(s.reputation >= 1 && s.reputation <= 5)) v.push(`reputação ${s.reputation}`);
  // geometria: limites por tipo e sobreposição
  const b = storeBounds(s.expansion);
  const occ = new Map<number, number>();
  for (const f of s.furniture) {
    const { w, d } = footprintOf(f.type, f.rot);
    const inX = f.x >= 0 && f.x + w <= b.width;
    const inHall = inX && f.z >= 0 && f.z + d <= b.depth;
    const inStorage = s.storageUnlocked && inX && f.z >= -STORAGE_DEPTH && f.z + d <= 0;
    const ok = f.type === 'rack' ? inStorage : f.type === 'decor' ? inHall || inStorage : inHall;
    if (!ok) v.push(`móvel ${f.id} (${f.type}) fora dos limites em (${f.x},${f.z})`);
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const k = tkey(f.x + i, f.z + j);
      if (occ.has(k)) v.push(`móveis ${occ.get(k)} e ${f.id} sobrepostos em (${f.x + i},${f.z + j})`);
      occ.set(k, f.id);
    }
  }
  return v;
}

/** Tiles reservados (antessala da porta e passagem do depósito) ocupados por móveis. */
export function blockedReserved(s: StoreState): string[] {
  const occ = new Map<number, Furniture2>();
  for (const f of s.furniture) {
    const { w, d } = footprintOf(f.type, f.rot);
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) occ.set(tkey(f.x + i, f.z + j), f);
  }
  const out: string[] = [];
  for (const [x, z] of keepTiles(s)) {
    const f = occ.get(tkey(x, z));
    if (f) out.push(`tile reservado (${x},${z}) ocupado por ${f.type} #${f.id}`);
  }
  return out;
}
type Furniture2 = StoreState['furniture'][number];

/** Invariante "suave": a calçada não deveria passar do limite de caixas que o próprio jogo impõe às compras. */
const sidewalkOver = (s: StoreState): boolean => s.sidewalk.length > SIDEWALK_MAX_BOXES;

/** JSON canônico (chaves ordenadas) para comparar estados sem depender da ordem das chaves. */
function canon(x: unknown): string {
  return JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
}
const totalUnits = (s: StoreState): Record<string, number> => Object.fromEntries(PRODUCTS.map((p) => [p.id, unitsOwned(s, p.id)]).filter(([, n]) => (n as number) > 0));

/* ---------------- fuzz ---------------- */
const TYPES: FurnitureType[] = ['shelf', 'fridge', 'freezer', 'counter', 'rack', 'decor'];
const ROTS = [0, 90, 180, 270] as const;
const ROLES = ['cashier', 'stocker', 'janitor'] as const;
const UPG = ['dolly', 'tipjar', 'capacity', 'recycler'] as const;

interface FuzzReport { steps: number; errors: Record<string, number>; crashes: string[]; partial: string[]; hard: string[]; reserved: string[]; roundTrip: string[]; sidewalkOver: number; overBy: Record<string, number>; bankruptcies: number; days: number; maxExpansion: number; ops: Record<string, number> }

function fuzz(seed: number, steps: number): FuzzReport {
  const r = makeRng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const ri = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  let s = newGame(seed);
  const rep: FuzzReport = { steps, errors: {}, crashes: [], partial: [], hard: [], reserved: [], roundTrip: [], sidewalkOver: 0, overBy: {}, bankruptcies: 0, days: 0, maxExpansion: 0, ops: {} };
  const licensed = (): string => { const ps = PRODUCTS.filter((p) => s.licenses.includes(p.category)); return (ps.length && r() < 0.9 ? pick(ps) : pick(PRODUCTS)).id; };
  const fid = (): number => (s.furniture.length && r() < 0.92 ? pick(s.furniture).id : ri(0, 99));
  const bidx = (): number => (s.sidewalk.length && r() < 0.92 ? ri(0, s.sidewalk.length - 1) : ri(-1, s.sidewalk.length + 2));
  const pos = (): [number, number, 0 | 90 | 180 | 270] => { const b = storeBounds(s.expansion); return [ri(-1, b.width), ri(s.storageUnlocked ? -STORAGE_DEPTH - 1 : -1, b.depth), pick(ROTS)]; };
  const ops: [number, string, () => unknown][] = [
    [6, 'orderBoxes', () => api.orderBoxes(s, licensed(), ri(1, 4))],
    [3, 'checkoutCart', () => api.checkoutCart(s, [{ kind: 'product', id: licensed(), qty: ri(0, 3) }, ...(r() < 0.5 ? [{ kind: 'furniture' as const, id: pick(TYPES), qty: ri(0, 2), variant: r() < 0.3 ? 'plant' : undefined }] : [])])],
    [4, 'placeFromStock', () => { const [x, z, rot] = pos(); return api.placeFromStock(s, ri(0, s.furnitureStock.length), x, z, rot, r() < 0.3 ? licensed() : undefined); }],
    [2, 'buyFurniture', () => { const [x, z, rot] = pos(); return api.buyFurniture(s, pick(TYPES), x, z, rot, r() < 0.4 ? licensed() : undefined); }],
    [3, 'moveFurniture', () => { const [x, z, rot] = pos(); api.moveFurniture(s, fid(), x, z, rot); }],
    [1, 'sellFurniture', () => api.sellFurniture(s, fid())],
    [1, 'storeFurniture', () => api.storeFurniture(s, fid())],
    [2, 'assignProduct', () => api.assignProduct(s, fid(), r() < 0.8 ? licensed() : undefined)],
    [3, 'placeUnits', () => api.placeUnits(s, bidx(), ri(1, 30))],
    [8, 'placeUnitsInLevel', () => api.placeUnitsInLevel(s, bidx(), fid(), ri(-1, 4), ri(1, 20))],
    [3, 'pullUnitsFromLevel', () => api.pullUnitsFromLevel(s, bidx(), fid(), ri(-1, 4), ri(1, 20))],
    [2, 'canStockLevel', () => api.canStockLevel(s, bidx(), fid(), ri(0, 3))],
    [10, 'cliente', () => { // cliente: retira de níveis e paga (ou desiste e devolve)
      const items: { productId: string; qty: number }[] = [];
      for (let k = ri(1, 4); k > 0; k--) {
        const pid = licensed();
        const spots = api.locateProduct(s, pid).filter((x) => x.units > 0);
        if (!spots.length) continue;
        const sp = pick(spots);
        const got = api.takeFromLevel(s, sp.furnitureId, sp.level, ri(1, 3));
        if (got > 0) items.push({ productId: pid, qty: got });
      }
      if (!items.length) { if (r() < 0.3) api.recordLostCustomer(s, ri(1, 3)); return; }
      if (r() < 0.85) api.completeSale(s, items, r(), 1 + 4 * r());
      else { for (const it of items) api.returnToShelf(s, it.productId, it.qty); api.recordLostCustomer(s, 2); }
    }],
    [2, 'takeFromShelf+venda', () => { const pid = licensed(); const n = api.takeFromShelf(s, pid, ri(1, 3)); if (n > 0) api.completeSale(s, [{ productId: pid, qty: n }], r(), 3); }],
    [3, 'discardBox', () => api.discardBox(s, bidx())],
    [2, 'storeBox', () => api.storeBox(s, bidx())],
    [2, 'takeFromStorage', () => { const ks = Object.keys(s.storage).filter((k) => (s.storage[k] ?? 0) > 0); return api.takeFromStorage(s, ks.length ? pick(ks) : licensed(), r() < 0.5); }],
    [3, 'dropBox', () => { const b = storeBounds(s.expansion); api.dropBox(s, bidx(), -2 + r() * (b.width + 4), -STORAGE_DEPTH + r() * (b.depth + STORAGE_DEPTH + 3), r() * 7); }],
    [2, 'setBoxOpen', () => api.setBoxOpen(s, bidx(), r() < 0.5)],
    [1, 'buyExpansion', () => api.buyExpansion(s)],
    [1, 'unlockStorage', () => api.unlockStorage(s)],
    [1, 'hireOrUpgrade', () => api.hireOrUpgrade(s, pick(ROLES))],
    [1, 'takeLoan', () => api.takeLoan(s, ri(1, 30) * 1000)],
    [1, 'repayLoan', () => api.repayLoan(s, ri(1, 30) * 1000)],
    [1, 'setAutoOrder', () => api.setAutoOrder(s, licensed(), r() < 0.2 ? null : { minUnits: ri(0, 60), boxes: ri(1, 3) })],
    [1, 'runAutoOrders', () => api.runAutoOrders(s)],
    [1, 'buyMissing', () => api.buyMissing(s, r())],
    [1, 'buyUpgrade', () => api.buyUpgrade(s, pick(UPG))],
    [1, 'buyLicense', () => buyLicense(s, pick(LICENSES).id)],
    [1, 'setPrice', () => setPrice(s, licensed(), ri(50, 20000))],
    [1, 'dirt', () => (r() < 0.6 ? api.addDirt(s, r() * 10, r() * 10) : api.cleanDirt(s, ri(-1, 12)))],
    [2, 'closeDay', () => {
      api.closeDay(s);
      rep.days++;
      if (api.isBankrupt(s)) { api.restartAfterBankruptcy(s); rep.bankruptcies++; }
      api.runAutoOrders(s);
    }],
    [1, 'dinheiro/XP (atalho de teste)', () => { s.money += ri(0, 3) * 250000; addXp(s, ri(0, 4000)); s.levelAck = s.level; }],
    [1, 'prejuízo (atalho de teste: leva à falência)', () => { s.money -= ri(1, 8) * 400000; }],
    [2, 'save/load', () => {
      const before = canon(s);
      const t = deserialize(serialize(s));
      const after = canon(t);
      if (before !== after && rep.roundTrip.length < 5) rep.roundTrip.push(firstDiff(JSON.parse(before), JSON.parse(after)));
      s = t;
    }],
  ];
  const total = ops.reduce((a, [w]) => a + w, 0);
  for (let i = 0; i < steps; i++) {
    let x = r() * total;
    let op = ops[0]!;
    for (const o of ops) { x -= o[0]; if (x <= 0) { op = o; break; } }
    const [, name, fn] = op;
    rep.ops[name] = (rep.ops[name] ?? 0) + 1;
    const snap = serialize(s);
    try {
      fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!(e instanceof Error) || e.constructor !== Error) { if (rep.crashes.length < 10) rep.crashes.push(`${name}: ${e instanceof Error ? e.constructor.name : typeof e}: ${msg}`); }
      else rep.errors[`${name}: ${msg}`] = (rep.errors[`${name}: ${msg}`] ?? 0) + 1;
      if (serialize(s) !== snap && rep.partial.length < 10) rep.partial.push(`${name} lançou "${msg}" depois de mudar o estado`);
    }
    for (const h of hardViolations(s)) if (rep.hard.length < 15) rep.hard.push(`passo ${i} (${name}): ${h}`);
    for (const h of blockedReserved(s)) if (rep.reserved.length < 15 && !rep.reserved.some((x) => x.endsWith(h))) rep.reserved.push(`passo ${i} (${name}): ${h}`);
    if (sidewalkOver(s)) { rep.sidewalkOver++; if (JSON.parse(snap).sidewalk.length <= SIDEWALK_MAX_BOXES) rep.overBy[name] = (rep.overBy[name] ?? 0) + 1; }
    rep.maxExpansion = Math.max(rep.maxExpansion, s.expansion);
  }
  return rep;
}

function firstDiff(a: unknown, b: unknown, path = ''): string {
  if (canon(a) === canon(b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 120)} → ${JSON.stringify(b)?.slice(0, 120)}`;
}

const SEEDS = [11, 23, 37, 41, 59, 73];
const STEPS = 2500;
const reports = new Map<number, FuzzReport>();
const reportOf = (seed: number): FuzzReport => { let rp = reports.get(seed); if (!rp) { rp = fuzz(seed, STEPS); reports.set(seed, rp); } return rp; };

describe('QA sistemas — fuzz da API da sim (seeds fixas)', () => {
  it('o fuzz exercita o jogo (dias, falências, expansões)', { timeout: 120000 }, () => {
    const all = SEEDS.map(reportOf);
    const sum = all.reduce((a, x) => ({ days: a.days + x.days, bk: a.bk + x.bankruptcies, exp: Math.max(a.exp, x.maxExpansion) }), { days: 0, bk: 0, exp: 0 });
    console.log('[qa-sys] fuzz:', JSON.stringify(sum), 'erros de regra mais comuns:', Object.entries(all[0]!.errors).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(' | '));
    expect(sum.days).toBeGreaterThan(50);
    expect(sum.exp).toBeGreaterThanOrEqual(2);
    expect(sum.bk).toBeGreaterThan(0); // falência → recomeço exercitado
  });
  it('nenhuma função lança erro de programação (TypeError/RangeError) com argumentos aleatórios', () => {
    const crashes = SEEDS.flatMap((sd) => reportOf(sd).crashes.map((c) => `seed ${sd}: ${c}`));
    expect(crashes, crashes.join('\n')).toEqual([]);
  });
  it('funções que lançam erro de regra não deixam o estado pela metade (atomicidade)', () => {
    const partial = SEEDS.flatMap((sd) => reportOf(sd).partial.map((c) => `seed ${sd}: ${c}`));
    expect(partial, partial.join('\n')).toEqual([]);
  });
  it('invariantes duras após cada passo: dinheiro inteiro, unidades ≥ 0, shelf = soma dos níveis, costBasis = possuídas, sem sobreposição', () => {
    const hard = SEEDS.flatMap((sd) => reportOf(sd).hard.map((c) => `seed ${sd}: ${c}`));
    expect(hard, hard.slice(0, 12).join('\n')).toEqual([]);
  });
  it('save → load devolve o MESMO estado (nada some nem duplica)', () => {
    const rt = SEEDS.flatMap((sd) => reportOf(sd).roundTrip.map((c) => `seed ${sd}: ${c}`));
    expect(rt, rt.join('\n')).toEqual([]);
  });
  it('nenhum móvel fica na antessala da porta nem na passagem do depósito', () => {
    const res = SEEDS.flatMap((sd) => reportOf(sd).reserved.map((c) => `seed ${sd}: ${c}`));
    expect(res, res.slice(0, 8).join('\n')).toEqual([]);
  });
  it('compras (orderBoxes/checkoutCart/runAutoOrders/buyMissing) nunca passam a calçada de 48 caixas', () => {
    // Devoluções (retirar do depósito, vender/desmontar móvel abastecido, migração) passam do limite por desenho:
    // as unidades precisam ir para algum lugar. Registrado como observação de baixa severidade em docs/qa/systems.md.
    const by: Record<string, number> = {};
    for (const sd of SEEDS) for (const [k, n] of Object.entries(reportOf(sd).overBy)) by[k] = (by[k] ?? 0) + n;
    console.log('[qa-sys] ações que levaram a calçada acima de 48 caixas:', JSON.stringify(by));
    const purchases = Object.keys(by).filter((k) => /orderBoxes|checkoutCart|runAutoOrders|buyMissing|closeDay/.test(k));
    expect(purchases).toEqual([]);
  });
});

/* ---------------- casos dirigidos ---------------- */
const rich = (level = 12): StoreState => {
  const s = newGame(5);
  s.money = 100_000_000;
  addXp(s, xpForLevel(level));
  s.levelAck = s.level;
  return s;
};

describe('QA sistemas — porta e passagem do depósito', () => {
  it('desbloquear o depósito com uma prateleira encostada no fundo (no vão da passagem) não deixa a passagem bloqueada', () => {
    const s = rich(6);
    // salão 12×10: porta em x=6 → passagem do depósito em x=5..6, z=0 (ainda não reservada antes do depósito)
    expect(api.canPlace(s, 'shelf', 5, 0, 0)).toBe(true);
    api.buyFurniture(s, 'shelf', 5, 0, 0);
    api.unlockStorage(s);
    expect(blockedReserved(s)).toEqual([]);
  });
});

describe('QA sistemas — migração de saves antigos', () => {
  /** Converte um estado da Fase 4 para o formato da Fase 3 (um produto por móvel + estoque somado; sem Box.open etc.). */
  function toPhase3(s: StoreState, phase2 = false): string {
    const raw = JSON.parse(serialize(s)) as Record<string, any>;
    for (const f of raw.furniture as Record<string, any>[]) {
      const main = (f.levels as { productId?: string }[] | undefined)?.find((l) => l.productId)?.productId;
      delete f.levels;
      if (main) f.productId = main; else delete f.productId;
    }
    for (const b of raw.sidewalk as Record<string, any>[]) delete b.open;
    delete raw.furnitureStock;
    delete raw.ledger.happy;
    delete raw.ledger.angry;
    if (phase2) for (const k of ['loan', 'autoOrders', 'upgrades', 'history', 'stats', 'bankruptcies']) delete raw[k];
    return JSON.stringify(raw);
  }
  /** Estado "jogado" com um produto por móvel (formato que a Fase 3 conseguia representar). */
  function played(): StoreState {
    const s = rich(8);
    api.unlockStorage(s);
    s.licenses.push('bebidas', 'laticinios');
    const a = api.buyFurniture(s, 'shelf', 7, 2, 0, 'arroz');
    const g = api.buyFurniture(s, 'fridge', 1, 5, 0, 'refri');
    api.buyFurniture(s, 'rack', 1, -3, 0);
    for (const [pid, n] of [['arroz', 5], ['feijao', 6], ['macarrao', 4], ['refri', 7], ['leite', 3]] as const) api.orderBoxes(s, pid, n);
    for (let i = 0; i < s.sidewalk.length; i++) {
      const b = s.sidewalk[i]!;
      const f = b.productId === 'arroz' ? a : b.productId === 'refri' ? g : s.furniture.find((x) => x.productId === b.productId);
      if (f) for (let l = 0; l < (f.levels?.length ?? 0); l++) try { api.placeUnitsInLevel(s, i, f.id, l, 99); } catch { /* outro produto */ }
    }
    for (let i = s.sidewalk.length - 1; i >= 0; i--) if (s.sidewalk[i]!.units === 0) api.discardBox(s, i);
    api.storeBox(s, s.sidewalk.findIndex((b) => b.productId === 'leite'));
    api.setBoxOpen(s, 0, true);
    api.takeLoan(s, 10000);
    api.checkoutCart(s, [{ kind: 'furniture', id: 'shelf', qty: 1 }]);
    expect(hardViolations(s)).toEqual([]);
    return s;
  }
  it('save da Fase 3 carrega sem erro e sem perder dinheiro, empréstimo nem unidades (exposição + depósito + calçada)', () => {
    const s = played();
    const m = deserialize(toPhase3(s));
    expect(m.money).toBe(s.money);
    expect(m.loan).toBe(s.loan);
    expect(totalUnits(m)).toEqual(totalUnits(s));
    expect(hardViolations(m)).toEqual([]);
  });
  it('save da Fase 2 (sem loan/autoOrders/upgrades/history/stats e sem Fase 3) carrega sem perder dinheiro nem unidades', () => {
    const s = played();
    const m = deserialize(toPhase3(s, true));
    expect(m.money).toBe(s.money);
    expect(totalUnits(m)).toEqual(totalUnits(s));
    expect(hardViolations(m).filter((x) => !x.startsWith('empréstimo'))).toEqual([]);
  });
  it('save da Fase 1/2 sem móveis (estoque só em state.shelf) não perde unidades', () => {
    const s = newGame(3);
    s.money = 123456;
    const raw = JSON.parse(serialize(s)) as Record<string, any>;
    delete raw.furniture; delete raw.nextFurnitureId; delete raw.furnitureStock;
    raw.shelf = { feijao: 30, macarrao: 10, arroz: 14 };
    raw.slots = { feijao: 3, macarrao: 1, arroz: 2 };
    raw.costBasis = { feijao: { units: 30, avg: 600 }, macarrao: { units: 10, avg: 350 }, arroz: { units: 14, avg: 2200 } };
    const m = deserialize(JSON.stringify(raw));
    expect(m.money).toBe(123456);
    expect(totalUnits(m)).toEqual({ feijao: 30, macarrao: 10, arroz: 14 });
    expect(hardViolations(m)).toEqual([]);
  });
  it('migração da Fase 3 com mais estoque que os níveis comportam: a sobra vira caixas na calçada sem perder unidades', () => {
    const s = newGame(8);
    const raw = JSON.parse(toPhase3(s)) as Record<string, any>;
    raw.shelf = { feijao: 48 + 12 * 60, macarrao: 64 };
    raw.costBasis = { feijao: { units: 48 + 720, avg: 600 }, macarrao: { units: 64, avg: 350 } };
    const m = deserialize(JSON.stringify(raw));
    expect(totalUnits(m)).toEqual({ feijao: 768, macarrao: 64 });
    expect(hardViolations(m)).toEqual([]);
    console.log(`[qa-sys] migração com excesso: ${m.sidewalk.length} caixas na calçada (limite de compra ${SIDEWALK_MAX_BOXES})`);
  });
});

describe('QA sistemas — save corrompido', () => {
  const kvOf = (raw: string | null): KV & { data: Record<string, string> } => {
    const data: Record<string, string> = raw === null ? {} : { [SAVE_KEY]: raw };
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  };
  const good = (): string => serialize(rich(6));
  const mutate = (fn: (raw: Record<string, any>) => void): string => { const raw = JSON.parse(good()); fn(raw); return JSON.stringify(raw); };
  /** Estado carregado precisa aguentar as chamadas de todo dia sem erro de programação. */
  const smoke = (s: StoreState): string[] => {
    const out: string[] = [];
    const t = (n: string, f: () => unknown): void => { try { f(); } catch (e) { if (!(e instanceof Error) || e.constructor !== Error) out.push(`${n}: ${(e as Error).message}`); } };
    t('priceInfo', () => PRODUCTS.forEach((p) => { const i = api.priceInfo(s, p.id); if (!Number.isFinite(i.sell) || !Number.isFinite(i.wholesale)) throw new TypeError(`preço NaN (${p.id})`); }));
    t('makeShoppingList', () => api.makeShoppingList(s, makeRng(1)));
    t('isBankrupt', () => api.isBankrupt(s));
    t('buyMissing', () => api.buyMissing(s));
    t('storageUsed', () => api.storageUsed(s));
    t('customerCapacity', () => { if (!Number.isFinite(api.customerCapacity(s))) throw new TypeError('capacidade NaN'); });
    t('closeDay', () => { api.closeDay(s); if (!Number.isFinite(s.money)) throw new TypeError(`dinheiro ${s.money} após closeDay`); });
    return out;
  };
  /** Carrega e devolve as violações (invariantes + chamadas do dia); null = save recusado. */
  const issuesOf = (raw: string): string[] | null => {
    const st = load(kvOf(raw));
    if (!st) return null;
    let hv: string[];
    try { hv = hardViolations(st).slice(0, 2); } catch (e) { hv = [`estado carregado quebra a leitura: ${(e as Error).message}`]; }
    return [...hv, ...smoke(st)];
  };
  const run = (cases: [string, string][]): string[] => cases.flatMap(([name, raw]) => {
    const v = issuesOf(raw);
    return v === null ? [`${name}: recusado (o jogo recomeça do zero)`] : v.map((x) => `${name}: ${x}`);
  });
  it('tipo de móvel desconhecido no save (catálogo mudou / APK mais antigo) é saneado no load — senão o jogo nem abre', () => {
    const raw = mutate((r) => { r.furniture.push({ id: 50, type: 'sofa', x: 7, z: 2, rot: 0 }); r.nextFurnitureId = 51; });
    const st = load(kvOf(raw));
    expect(st).not.toBeNull();
    expect(st!.furniture.map((f) => f.type).filter((t) => !['shelf', 'fridge', 'freezer', 'counter', 'rack', 'decor', 'desk'].includes(t))).toEqual([]);
  });
  it('produto desconhecido no save (catálogo mudou) é removido de calçada/depósito/custo médio', () => {
    const v = run([
      ['caixa de produto inexistente', mutate((r) => { r.sidewalk = [{ productId: 'xyz', units: 3 }]; })],
      ['depósito com produto inexistente', mutate((r) => { r.storageUnlocked = true; r.storage = { xyz: 4 }; r.costBasis = { ...r.costBasis, xyz: { units: 4, avg: 100 } }; })],
    ]);
    expect(v, v.join('\n')).toEqual([]);
  });
  it('campos numéricos/objetos inválidos são saneados (ex.: NaN que vira null no JSON, texto, null)', () => {
    const v = run([
      ['dinheiro null (NaN salvo)', mutate((r) => { r.money = null; })],
      ['dinheiro como texto', mutate((r) => { r.money = '1000'; })],
      ['prices null', mutate((r) => { r.prices = null; })],
      ['costBasis null', mutate((r) => { r.costBasis = null; })],
      ['storage negativo', mutate((r) => { r.storage = { feijao: -5 }; })],
      ['licenses null', mutate((r) => { r.licenses = null; })],
      ['móvel sem x/z', mutate((r) => { r.furniture.push({ id: 50, type: 'shelf', rot: 0 }); r.nextFurnitureId = 51; })],
    ]);
    expect(v, v.join('\n')).toEqual([]);
  });
  it('corrupções já tratadas continuam tratadas (market/employees/history/dirt/expansão/sidewalk com null)', () => {
    const v = run([
      ['market null', mutate((r) => { r.market = null; })],
      ['employees null', mutate((r) => { r.employees = null; })],
      ['history com null', mutate((r) => { r.history = [null]; })],
      ['dirt null', mutate((r) => { r.dirt = null; })],
      ['expansion fora da faixa', mutate((r) => { r.expansion = 99; })],
    ]).filter((x) => !x.includes('recusado'));
    expect(v, v.join('\n')).toEqual([]);
  });
  it('save recusado não é sobrescrito sem aviso: main.ts usa `load(kv) ?? newGame()` e o autosave grava por cima', () => {
    // Reproduz o fluxo do main.ts: save ilegível → jogo novo → primeiro autosave substitui o save antigo.
    const kv = kvOf(good().slice(0, -1)); // 1 caractere a menos (o mesmo vale para `sidewalk: [null]`, que também é recusado)
    const original = kv.data[SAVE_KEY];
    const state = load(kv) ?? newGame(1);
    save(kv, state); // autosave de 15 s / pagehide
    // Esperado: o save original preservado em algum lugar (backup) para recuperação.
    const kept = Object.values(kv.data).some((v) => v === original);
    expect(kept).toBe(true);
  });
});

/* ---------------- fixture para tests/e2e/qa-sys-longrun.e2e.mjs ---------------- */
// QA_FIXTURE=/caminho/busy-save.json npx vitest run tests/qa-sys-sim.test.ts -t fixture
// Sem @types/node no projeto: variável de ambiente e fs são lidos sem os tipos do Node.
const QA_FIXTURE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.QA_FIXTURE;
describe('QA sistemas — fixture', () => {
  it.runIf(!!QA_FIXTURE)('fixture: grava o save da loja movimentada (expansão 2, depósito, 21 móveis, 3 funcionários)', async () => {
    const fsModule = 'node:fs';
    const { writeFileSync } = (await import(/* @vite-ignore */ fsModule)) as { writeFileSync: (path: string, data: string) => void };
    const s = newGame(777);
    s.money = 900_000_000;
    addXp(s, xpForLevel(12)); s.levelAck = s.level;
    for (const c of ['bebidas', 'laticinios', 'padaria', 'limpeza', 'congelados']) buyLicense(s, c);
    api.buyExpansion(s); api.buyExpansion(s);
    api.unlockStorage(s);
    const b = storeBounds(s.expansion);
    const want: [FurnitureType, string][] = [['shelf', 'arroz'], ['shelf', 'cafe'], ['shelf', 'pao'], ['shelf', 'detergente'], ['shelf', 'feijao'], ['shelf', 'macarrao'],
      ['fridge', 'refri'], ['fridge', 'agua'], ['fridge', 'leite'], ['fridge', 'queijo'], ['freezer', 'sorvete'], ['shelf', 'arroz'], ['fridge', 'refri'], ['shelf', 'cafe']];
    for (const [type, pid] of want) {
      let ok = false;
      for (let z = 2; z < b.depth - 3 && !ok; z += 3) for (let x = 1; x < b.width - 2 && !ok; x += 2) if (api.canPlace(s, type, x, z, 0)) { api.buyFurniture(s, type, x, z, 0, pid); ok = true; }
    }
    for (let x = 1; x < b.width - 2; x++) if (api.canPlace(s, 'counter', x, b.depth - 4, 0)) { api.buyFurniture(s, 'counter', x, b.depth - 4, 0); break; }
    for (let i = 0, x = 1; i < 3 && x < b.width - 2; x += 2) if (api.canPlace(s, 'rack', x, -3, 0)) { api.buyFurniture(s, 'rack', x, -3, 0); i++; }
    for (const f of s.furniture) for (let l = 0; l < (f.levels?.length ?? 0); l++) {
      const pid = f.levels![l]!.productId;
      if (!pid) continue; // as 2 prateleiras do jogo novo começam sem produto
      api.orderBoxes(s, pid, 1);
      const i = s.sidewalk.length - 1;
      api.placeUnitsInLevel(s, i, f.id, l, 999);
      if (s.sidewalk[i]!.units === 0) api.discardBox(s, i); else api.storeBox(s, i);
    }
    for (const p of PRODUCTS) if (s.licenses.includes(p.category) && (s.slots[p.id] ?? 0) > 0) api.setAutoOrder(s, p.id, { minUnits: Math.max(20, (s.slots[p.id] ?? 0) * p.slotCapacity), boxes: 2 });
    for (const r of ROLES) api.hireOrUpgrade(s, r);
    api.buyUpgrade(s, 'capacity');
    s.money = 50_000_000;
    expect(hardViolations(s)).toEqual([]);
    writeFileSync(QA_FIXTURE!, serialize(s));
  });
});
