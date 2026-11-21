import { describe, expect, it } from 'vitest';
import {
  acceptsPrice, addDirt, arrivalSchedule, assignProduct, basketTotal, buyExpansion, buyFurniture, canPlace, cleanDirt, closeDay,
  completeSale, consumeLevelUps, discardBox, employeeCost, employeeSpeed, expansionCost, expansionMinLevel, furnitureCatalog,
  hireOrUpgrade, makeShoppingList, moveFurniture, orderBoxes, placeUnits, plannedArrivals, priceInfo, productCapacity,
  recordLostCustomer, returnToShelf, sellFurniture, setDecor, setStoreName, storageCapacity, storeBox, takeFromShelf,
  takeFromStorage, unlockStorage, storageCost,
} from '../src/sim/api';
import { PRODUCTS } from '../src/sim/catalog';
import { addXp, checkoutCapacity, xpForLevel } from '../src/sim/economy';
import { storeBounds } from '../src/core/layout';
import { deserialize, serialize } from '../src/sim/save';
import { newGame, type StoreState } from '../src/sim/state';
import { recomputeSlots } from '../src/sim/furniture';

const rich = (level = 12): StoreState => {
  const s = newGame(5);
  s.money = 100_000_000;
  s.level = level;
  s.xp = xpForLevel(level);
  s.levelAck = level;
  return s;
};

describe('layout inicial e capacidade', () => {
  it('1 caixa + 4 prateleiras de mercearia atribuídas, todas em posições válidas', () => {
    const s = newGame();
    expect(s.furniture.filter((f) => f.type === 'counter')).toHaveLength(1);
    const shelves = s.furniture.filter((f) => f.type === 'shelf');
    expect(shelves.map((f) => f.productId).sort()).toEqual(['arroz', 'cafe', 'feijao', 'macarrao']);
    for (const f of s.furniture) expect(canPlace(s, f.type, f.x, f.z, f.rot, f.id)).toBe(true);
    expect(s.nextFurnitureId).toBeGreaterThan(Math.max(...s.furniture.map((f) => f.id)));
  });
  it('state.slots == recomputo a partir dos móveis; capacidade = slots × slotCapacity', () => {
    const s = newGame();
    const copy = { ...s.slots };
    recomputeSlots(s);
    expect(s.slots).toEqual(copy);
    expect(productCapacity(s, 'arroz')).toBe(16);
    expect(productCapacity(s, 'refri')).toBe(0);
  });
  it('catálogo cobre todos os tipos com custo/nível coerentes', () => {
    const cat = furnitureCatalog();
    expect(cat.map((c) => c.type).sort()).toEqual(['counter', 'decor', 'freezer', 'fridge', 'rack', 'shelf']);
    for (const c of cat) { expect(c.cost).toBeGreaterThan(0); expect(Number.isInteger(c.cost)).toBe(true); }
    expect(cat.find((c) => c.type === 'shelf')!.categories).toEqual(['mercearia', 'limpeza', 'padaria']);
    expect(cat.find((c) => c.type === 'fridge')!.categories).toEqual(['bebidas', 'laticinios']);
    expect(cat.find((c) => c.type === 'freezer')!.categories).toEqual(['congelados']);
  });
});

describe('canPlace', () => {
  const s = newGame();
  it('limites do salão e rotação', () => {
    expect(canPlace(s, 'shelf', -1, 5, 0)).toBe(false);
    expect(canPlace(s, 'shelf', 11, 5, 0)).toBe(false); // 2 de largura estoura
    expect(canPlace(s, 'shelf', 11, 5, 90)).toBe(true); // girada: 1x2
    expect(canPlace(s, 'shelf', 0, 9, 0)).toBe(true);
    expect(canPlace(s, 'shelf', 0, 10, 0)).toBe(false);
    expect(canPlace(s, 'shelf', 0, 9, 90)).toBe(false); // 1x2 em z=9..10
    expect(canPlace(s, 'shelf', 1.5, 5, 0)).toBe(false);
  });
  it('colisão por footprint', () => {
    expect(canPlace(s, 'shelf', 1, 2, 0)).toBe(false);
    expect(canPlace(s, 'shelf', 2, 2, 0)).toBe(false);
    expect(canPlace(s, 'shelf', 1, 3, 0)).toBe(true);
    expect(canPlace(s, 'counter', 7, 6, 0)).toBe(false);
    expect(canPlace(s, 'shelf', 8, 5, 0)).toBe(true);
    expect(canPlace(s, 'shelf', 9, 5, 90)).toBe(false); // 1x2 em z=5..6 encosta no balcão (z=6)
  });
  it('não bloqueia a porta (antessala 2x2)', () => {
    expect(canPlace(s, 'decor', 5, 9, 0)).toBe(false);
    expect(canPlace(s, 'decor', 6, 8, 0)).toBe(false);
    expect(canPlace(s, 'decor', 4, 9, 0)).toBe(true);
    expect(canPlace(s, 'shelf', 4, 8, 0)).toBe(false);
  });
  it('rack só no depósito, depois de desbloqueado; shelf não vai ao depósito', () => {
    expect(canPlace(s, 'rack', 1, -3, 0)).toBe(false);
    const r = rich();
    unlockStorage(r);
    expect(canPlace(r, 'rack', 1, -3, 0)).toBe(true);
    expect(canPlace(r, 'rack', 1, 3, 0)).toBe(false);
    expect(canPlace(r, 'shelf', 1, -3, 0)).toBe(false);
    expect(canPlace(r, 'rack', 5, -1, 0)).toBe(false); // passagem do depósito
    expect(canPlace(r, 'decor', 1, -3, 0)).toBe(true);
  });
  it('não pode isolar móvel (todos precisam de acesso alcançável)', () => {
    const t = newGame();
    // cerca o canto: shelf (1,2) 2x1 -> vizinhos (0,2),(3,2),(1,1),(2,1),(1,3),(2,3)
    const ring: [number, number][] = [[0, 2], [3, 2], [1, 1], [2, 1], [1, 3]];
    for (const [x, z] of ring) t.furniture.push({ id: t.nextFurnitureId++, type: 'decor', x, z, rot: 0 });
    expect(canPlace(t, 'decor', 2, 3, 0)).toBe(false); // fecharia o último acesso
    expect(canPlace(t, 'decor', 9, 1, 0)).toBe(true);
  });
  it('mover usa ignoreId', () => {
    const t = rich();
    const f = t.furniture.find((x) => x.type === 'shelf')!;
    expect(canPlace(t, 'shelf', f.x, f.z, 0)).toBe(false);
    moveFurniture(t, f.id, f.x, f.z + 3, 90);
    expect(f.rot).toBe(90);
    expect(() => moveFurniture(t, f.id, -5, 0, 0)).toThrow('Posição inválida');
  });
  it('expansão aumenta a área válida', () => {
    const t = rich();
    expect(canPlace(t, 'shelf', 13, 5, 0)).toBe(false);
    buyExpansion(t);
    expect(storeBounds(t.expansion).width).toBe(16);
    expect(canPlace(t, 'shelf', 13, 5, 0)).toBe(true);
    expect(canPlace(t, 'decor', 7, 11, 0)).toBe(false); // nova antessala (porta em x=8)
    expect(canPlace(t, 'decor', 3, 11, 0)).toBe(true);
  });
});

describe('comprar, atribuir e vender móveis', () => {
  it('exige nível, dinheiro e posição válida', () => {
    const s = newGame();
    expect(() => buyFurniture(s, 'fridge', 8, 4, 0)).toThrow('Requer nível 3');
    s.level = 3;
    s.money = 100;
    expect(() => buyFurniture(s, 'shelf', 1, 4, 0)).toThrow('Dinheiro insuficiente');
    s.money = 1_000_000;
    expect(() => buyFurniture(s, 'shelf', 1, 2, 0)).toThrow('Posição inválida');
    const before = s.money;
    const f = buyFurniture(s, 'shelf', 1, 4, 0, 'arroz');
    expect(s.money).toBe(before - 35000);
    expect(f.productId).toBe('arroz');
    expect(productCapacity(s, 'arroz')).toBe(32);
    expect(s.slots.arroz).toBe(4);
  });
  it('categoria/licença validadas na atribuição', () => {
    const s = rich();
    const sh = s.furniture.find((f) => f.type === 'shelf')!;
    expect(() => assignProduct(s, sh.id, 'refri')).toThrow(); // bebida não cabe em prateleira
    const fr = buyFurniture(s, 'fridge', 1, 5, 0);
    expect(() => assignProduct(s, fr.id, 'refri')).toThrow('Categoria não licenciada');
    s.licenses.push('bebidas');
    assignProduct(s, fr.id, 'refri');
    expect(productCapacity(s, 'refri')).toBe(30);
    expect(() => assignProduct(s, s.furniture.find((f) => f.type === 'counter')!.id, 'arroz')).toThrow();
    assignProduct(s, fr.id, undefined);
    expect(productCapacity(s, 'refri')).toBe(0);
  });
  it('vender devolve 50% e move o excedente exposto para a calçada (ou depósito)', () => {
    const s = rich();
    const sh = s.furniture.find((f) => f.productId === 'arroz')!;
    s.shelf.arroz = 16;
    const before = s.money;
    expect(sellFurniture(s, sh.id)).toBe(17500);
    expect(s.money).toBe(before + 17500);
    expect(s.shelf.arroz).toBe(0);
    expect(s.sidewalk.reduce((a, b) => a + b.units, 0)).toBe(16);
    expect(s.slots.arroz).toBe(0);
    // com depósito: vai para o depósito
    unlockStorage(s);
    const sh2 = s.furniture.find((f) => f.productId === 'feijao')!;
    s.shelf.feijao = 24;
    sellFurniture(s, sh2.id);
    expect(s.storage.feijao).toBe(24);
  });
  it('último caixa não pode ser vendido', () => {
    const s = rich();
    expect(() => sellFurniture(s, s.furniture.find((f) => f.type === 'counter')!.id)).toThrow();
    const c2 = buyFurniture(s, 'counter', 1, 6, 0);
    expect(checkoutCapacity(s)).toBe(45 + 20);
    expect(sellFurniture(s, c2.id)).toBe(60000);
  });
});

describe('expansão, depósito, funcionários, personalização', () => {
  it('expansão: até 4, custo e nível crescentes, aluguel sobe', () => {
    const s = rich(30);
    const costs: number[] = [];
    const levels: number[] = [];
    const rent0 = s.rent;
    for (let i = 0; i < 4; i++) {
      costs.push(expansionCost(s)!);
      levels.push(expansionMinLevel(s)!);
      buyExpansion(s);
    }
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(4);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(s.expansion).toBe(4);
    expect(s.rent).toBeGreaterThan(rent0);
    expect(expansionCost(s)).toBeNull();
    expect(expansionMinLevel(s)).toBeNull();
    expect(() => buyExpansion(s)).toThrow();
    const low = newGame();
    expect(() => buyExpansion(low)).toThrow('Requer nível');
  });
  it('depósito: nível, capacidade, estantes, caixas', () => {
    const s = newGame();
    expect(() => unlockStorage(s)).toThrow('Requer nível');
    expect(() => storeBox(s, 0)).toThrow();
    const r = rich();
    const { cost } = storageCost();
    const m = r.money;
    unlockStorage(r);
    expect(r.money).toBe(m - cost);
    expect(() => unlockStorage(r)).toThrow();
    const base = storageCapacity(r);
    expect(base).toBeGreaterThan(0);
    buyFurniture(r, 'rack', 1, -3, 0);
    expect(storageCapacity(r)).toBe(base + 8);
    orderBoxes(r, 'arroz', 3);
    storeBox(r, 0);
    expect(r.storage.arroz).toBe(6);
    expect(r.sidewalk).toHaveLength(2);
    expect(takeFromStorage(r, 'arroz', true)).toBe(6);
    expect(r.sidewalk.at(-1)).toMatchObject({ productId: 'arroz', units: 6, carried: true });
    expect(r.storage.arroz).toBe(0);
    expect(() => takeFromStorage(r, 'arroz', false)).toThrow();
  });
  it('depósito cheio e venda de estante ocupada são recusados', () => {
    const r = rich();
    unlockStorage(r);
    const rack = buyFurniture(r, 'rack', 1, -3, 0);
    const cap = storageCapacity(r);
    for (let i = 0; i < cap; i++) { orderBoxes(r, 'arroz', 1); storeBox(r, r.sidewalk.length - 1); }
    orderBoxes(r, 'arroz', 1);
    expect(() => storeBox(r, r.sidewalk.length - 1)).toThrow('Depósito cheio');
    expect(() => sellFurniture(r, rack.id)).toThrow('Esvazie');
  });
  it('funcionários: níveis 1..5, salário e velocidade monotônicos, checkout coerente', () => {
    const s = rich(30);
    let prevWage = 0;
    let prevCap = checkoutCapacity(s);
    for (let lvl = 1; lvl <= 5; lvl++) {
      const c = employeeCost(s, 'cashier')!;
      expect(c.dailyWage).toBeGreaterThan(prevWage);
      prevWage = c.dailyWage;
      hireOrUpgrade(s, 'cashier');
      expect(s.employees.cashier).toBe(lvl);
      expect(checkoutCapacity(s)).toBeGreaterThan(prevCap);
      prevCap = checkoutCapacity(s);
    }
    expect(employeeCost(s, 'cashier')).toBeNull();
    expect(() => hireOrUpgrade(s, 'cashier')).toThrow();
    for (const role of ['cashier', 'stocker', 'janitor'] as const) {
      for (let l = 1; l < 5; l++) expect(employeeSpeed(role, l + 1)).toBeLessThan(employeeSpeed(role, l));
    }
    const rep0 = closeDay(s);
    expect(rep0.fixed).toBe(s.rent + 30000);
  });
  it('contratar exige nível e dinheiro', () => {
    const s = newGame();
    expect(() => hireOrUpgrade(s, 'stocker')).toThrow('Requer nível');
    s.level = 20;
    s.money = 10;
    expect(() => hireOrUpgrade(s, 'stocker')).toThrow('Dinheiro insuficiente');
  });
  it('personalização', () => {
    const s = newGame();
    const m = s.money;
    setStoreName(s, '  Mercado   do Zé ');
    expect(s.storeName).toBe('Mercado do Zé');
    expect(() => setStoreName(s, '   ')).toThrow();
    expect(() => setStoreName(s, 'x'.repeat(40))).toThrow();
    expect(setDecor(s, { wallColor: '#112233' })).toBe(1000);
    expect(setDecor(s, { wallColor: '#112233' })).toBe(0);
    expect(setDecor(s, { wallColor: '#ABCDEF', floorColor: '#000000' })).toBe(2000);
    expect(s.decor.wallColor).toBe('#abcdef');
    expect(s.money).toBe(m - 3000);
    expect(() => setDecor(s, { signColor: 'vermelho' })).toThrow();
  });
});

describe('caixas e estoque físico', () => {
  it('pedir, repor, descartar', () => {
    const s = newGame();
    const cost = orderBoxes(s, 'arroz', 3);
    expect(cost).toBeGreaterThan(0);
    expect(s.sidewalk).toHaveLength(3);
    expect(() => orderBoxes(s, 'refri', 1)).toThrow();
    expect(() => orderBoxes(s, 'arroz', 0)).toThrow();
    expect(placeUnits(s, 0, 4)).toBe(4);
    expect(s.shelf.arroz).toBe(4);
    expect(() => discardBox(s, 0)).toThrow('ainda tem');
    expect(placeUnits(s, 0, 99)).toBe(2);
    expect(placeUnits(s, 1, 99)).toBe(6);
    expect(placeUnits(s, 2, 99)).toBe(4); // capacidade 16
    expect(s.shelf.arroz).toBe(16);
    expect(placeUnits(s, 2, 99)).toBe(0);
    discardBox(s, 0);
    expect(s.sidewalk).toHaveLength(2);
    expect(() => placeUnits(s, 5, 1)).toThrow('inexistente');
    expect(s.costBasis.arroz!.units).toBe(18);
  });
  it('produto sem prateleira não pode ser reposto; calçada tem limite', () => {
    const s = rich();
    s.licenses.push('bebidas');
    orderBoxes(s, 'refri', 1);
    expect(() => placeUnits(s, 0, 1)).toThrow('Nenhuma prateleira');
    expect(() => orderBoxes(s, 'agua', 60)).toThrow('Calçada cheia');
  });
});

describe('clientes e vendas', () => {
  const rng = (seed: number) => { let a = seed; return () => (a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296; };
  it('lista de compras: só licenciados e expostos, produtos distintos, quantidades pequenas', () => {
    const s = newGame();
    const r = rng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const list = makeShoppingList(s, r);
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((l) => l.productId)).size).toBe(list.length);
      for (const it of list) {
        seen.add(it.productId);
        expect(['arroz', 'feijao', 'macarrao', 'cafe']).toContain(it.productId);
        expect(it.qty).toBeGreaterThanOrEqual(1);
        expect(it.qty).toBeLessThanOrEqual(3);
      }
    }
    expect(seen.size).toBe(4);
    s.furniture = s.furniture.filter((f) => f.type !== 'shelf');
    recomputeSlots(s);
    expect(makeShoppingList(s, r)).toEqual([]);
  });
  it('popularidade pesa na escolha', () => {
    const s = rich();
    s.licenses = PRODUCTS.map((p) => p.category).filter((c, i, a) => a.indexOf(c) === i);
    const r = rng(2);
    const count: Record<string, number> = {};
    s.slots = Object.fromEntries(PRODUCTS.map((p) => [p.id, 1]));
    for (let i = 0; i < 4000; i++) for (const it of makeShoppingList(s, r)) count[it.productId] = (count[it.productId] ?? 0) + 1;
    expect(count.arroz!).toBeGreaterThan(count.sorvete!);
  });
  it('acceptsPrice reflete a curva', () => {
    const s = newGame();
    const r = rng(3);
    const base = priceInfo(s, 'arroz').market;
    s.prices.arroz = base;
    let okFair = 0;
    for (let i = 0; i < 2000; i++) if (acceptsPrice(s, 'arroz', r).ok) okFair++;
    s.prices.arroz = Math.round((base * 1.6) / 5) * 5;
    let okHigh = 0;
    let ratio = 0;
    for (let i = 0; i < 2000; i++) { const a = acceptsPrice(s, 'arroz', r); if (a.ok) okHigh++; ratio = a.ratio; }
    expect(okFair).toBeGreaterThan(okHigh * 5);
    expect(ratio).toBeCloseTo(1.6, 1);
  });
  it('takeFromShelf / returnToShelf / basketTotal', () => {
    const s = newGame();
    s.shelf.arroz = 3;
    expect(takeFromShelf(s, 'arroz', 5)).toBe(3);
    expect(s.shelf.arroz).toBe(0);
    expect(takeFromShelf(s, 'arroz', 1)).toBe(0);
    returnToShelf(s, 'arroz', 2);
    expect(s.shelf.arroz).toBe(2);
    const p = priceInfo(s, 'arroz').sell;
    expect(basketTotal(s, [{ productId: 'arroz', qty: 2 }, { productId: 'feijao', qty: 1 }])).toBe(2 * p + priceInfo(s, 'feijao').sell);
  });
  it('completeSale: receita, COGS pelo custo médio, XP, gorjeta limitada, reputação', () => {
    const s = newGame();
    orderBoxes(s, 'arroz', 1);
    placeUnits(s, 0, 6);
    const avg = s.costBasis.arroz!.avg;
    expect(takeFromShelf(s, 'arroz', 2)).toBe(2);
    const price = priceInfo(s, 'arroz').sell;
    const m = s.money;
    const rep = s.reputation;
    const fast = completeSale(s, [{ productId: 'arroz', qty: 2 }], 1, 5);
    expect(fast.total).toBe(2 * price);
    expect(fast.tip).toBeGreaterThan(0);
    expect(fast.tip).toBeLessThanOrEqual(fast.total * 0.1);
    expect(fast.tip % 5).toBe(0);
    expect(s.money).toBe(m + fast.total + fast.tip);
    expect(s.ledger).toMatchObject({ revenue: fast.total, tips: fast.tip, cogs: 2 * avg, served: 1 });
    expect(s.costBasis.arroz!.units).toBe(4);
    expect(s.xp).toBeGreaterThanOrEqual(2 + 2);
    expect(s.reputation).toBeGreaterThan(rep);
    const slow = completeSale(s, [{ productId: 'arroz', qty: 1 }], 0, 5);
    expect(slow.tip).toBe(0);
    const mad = completeSale(s, [{ productId: 'arroz', qty: 1 }], 1, 2);
    expect(mad.tip).toBe(0);
    expect(() => completeSale(s, [{ productId: 'arroz', qty: 0 }], 1, 5)).toThrow();
  });
  it('recordLostCustomer e reputação ficam em 1..5', () => {
    const s = newGame();
    for (let i = 0; i < 500; i++) recordLostCustomer(s, 1);
    expect(s.ledger.lost).toBe(500);
    expect(s.reputation).toBeGreaterThanOrEqual(1);
    expect(s.reputation).toBeLessThan(1.1);
    for (let i = 0; i < 500; i++) recordLostCustomer(s, 99);
    expect(s.reputation).toBeLessThanOrEqual(5);
  });
  it('sujeira: cap de 12 e efeito pequeno na reputação', () => {
    const s = newGame();
    for (let i = 0; i < 20; i++) addDirt(s, i, 1);
    expect(s.dirt).toHaveLength(12);
    cleanDirt(s, 99);
    cleanDirt(s, -1);
    expect(s.dirt).toHaveLength(12);
    const clean = newGame();
    for (let i = 0; i < 40; i++) { recordLostCustomer(s, 4); recordLostCustomer(clean, 4); }
    expect(s.reputation).toBeLessThan(clean.reputation);
    expect(clean.reputation - s.reputation).toBeLessThan(0.5);
    while (s.dirt.length) cleanDirt(s, 0);
    expect(s.dirt).toHaveLength(0);
  });
  it('consumeLevelUps devolve cada nível uma única vez', () => {
    const s = newGame();
    expect(consumeLevelUps(s)).toEqual([]);
    addXp(s, xpForLevel(4));
    expect(consumeLevelUps(s)).toEqual([2, 3, 4]);
    expect(consumeLevelUps(s)).toEqual([]);
  });
});

describe('dia', () => {
  it('plannedArrivals é determinístico e cresce com nível, reputação, preço baixo e tamanho', () => {
    const s = newGame(9);
    expect(plannedArrivals(s)).toBe(plannedArrivals(s));
    const base = plannedArrivals(s);
    const hi = newGame(9);
    hi.level = 10;
    expect(plannedArrivals(hi)).toBeGreaterThan(base);
    const rep = newGame(9);
    rep.reputation = 5;
    expect(plannedArrivals(rep)).toBeGreaterThan(base);
    const big = newGame(9);
    big.expansion = 2;
    expect(plannedArrivals(big)).toBeGreaterThan(base);
    const cheap = newGame(9);
    for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) cheap.prices[id] = Math.round((priceInfo(cheap, id).market * 0.7) / 5) * 5;
    const dear = newGame(9);
    for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) dear.prices[id] = Math.round((priceInfo(dear, id).market * 1.5) / 5) * 5;
    expect(plannedArrivals(cheap)).toBeGreaterThan(plannedArrivals(dear));
  });
  it('arrivalSchedule: mesmo tamanho, ordenado, dentro do expediente', () => {
    const s = newGame(4);
    const t = arrivalSchedule(s);
    expect(t).toHaveLength(plannedArrivals(s));
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(t[0]!).toBeGreaterThanOrEqual(8 * 60);
    expect(t.at(-1)!).toBeLessThanOrEqual(21 * 60 - 30);
  });
  it('closeDay: aluguel + salários, avança dia, zera ledger', () => {
    const s = newGame();
    const m = s.money;
    const day = s.day;
    const rep = closeDay(s);
    expect(rep.fixed).toBe(s.rent);
    expect(s.money).toBe(m - s.rent);
    expect(s.day).toBe(day + 1);
    expect(s.ledger.revenue).toBe(0);
  });
  it('priceInfo: custo = custo médio do estoque quando existe', () => {
    const s = newGame();
    const w = priceInfo(s, 'arroz');
    expect(w.cost).toBe(w.wholesale);
    expect(w.market).toBeGreaterThan(w.wholesale);
    orderBoxes(s, 'arroz', 1);
    s.market.arroz = 1.3;
    expect(priceInfo(s, 'arroz').cost).toBe(s.costBasis.arroz!.avg);
  });
});

describe('save', () => {
  it('round-trip com móveis, depósito e funcionários', () => {
    const s = rich();
    unlockStorage(s);
    buyFurniture(s, 'rack', 1, -3, 0);
    hireOrUpgrade(s, 'janitor');
    orderBoxes(s, 'arroz', 2);
    storeBox(s, 0);
    setStoreName(s, 'Loja Teste');
    expect(deserialize(serialize(s))).toEqual(s);
  });
  it('migra save antigo (sem móveis, sem levelAck) e recalcula slots', () => {
    const old = JSON.parse(serialize(newGame(7))) as Record<string, unknown>;
    delete old.levelAck;
    delete old.furniture;
    delete old.nextFurnitureId;
    delete old.decor;
    old.level = 5;
    old.slots = { arroz: 2, feijao: 2, macarrao: 2, cafe: 2 };
    const s = deserialize(JSON.stringify(old));
    expect(s.furniture.filter((f) => f.type === 'shelf')).toHaveLength(4);
    expect(s.furniture.some((f) => f.type === 'counter')).toBe(true);
    expect(s.levelAck).toBe(5);
    expect(consumeLevelUps(s)).toEqual([]);
    expect(productCapacity(s, 'arroz')).toBe(16);
    expect(s.slots.arroz).toBe(2);
    expect(s.decor.wallColor).toBeTruthy();
    expect(s.nextFurnitureId).toBeGreaterThan(5);
  });
  it('save de versão estranha é rejeitado', () => {
    expect(() => deserialize('{"version":2}')).toThrow();
  });
});
