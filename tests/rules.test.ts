import { newGame } from '../src/sim/state';
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
import { type StoreState } from '../src/sim/state';
import { recomputeSlots } from '../src/sim/levels';
import { expose, starterGame } from './helpers';

const rich = (level = 12): StoreState => {
  const s = starterGame(5);
  s.money = 100_000_000;
  s.level = level;
  s.xp = xpForLevel(level);
  s.levelAck = level;
  return s;
};

describe('layout inicial e capacidade', () => {
  it('jogo novo: prateleiras iniciais sem nenhum produto (níveis livres, 0 unidades)', () => {
    const s = newGame();
    const shelves = s.furniture.filter((f) => f.type === 'shelf');
    expect(shelves).toHaveLength(2);
    for (const f of shelves) { expect(f.productId).toBeUndefined(); expect((f.levels ?? []).every((l) => l.productId === undefined && l.units === 0)).toBe(true); }
    expect(Object.values(s.slots).every((n) => n === 0)).toBe(true);
  });
  it('1 caixa + 2 prateleiras de mercearia barata atribuídas, todas em posições válidas, com espaço livre', () => {
    const s = starterGame();
    expect(s.furniture.filter((f) => f.type === 'counter')).toHaveLength(1);
    const shelves = s.furniture.filter((f) => f.type === 'shelf');
    expect(shelves.map((f) => f.productId).sort()).toEqual(['feijao', 'macarrao']);
    expect(canPlace(s, 'shelf', 7, 2, 0)).toBe(true);
    expect(canPlace(s, 'shelf', 10, 2, 0)).toBe(true);
    for (const f of s.furniture) expect(canPlace(s, f.type, f.x, f.z, f.rot, f.id)).toBe(true);
    expect(s.nextFurnitureId).toBeGreaterThan(Math.max(...s.furniture.map((f) => f.id)));
  });
  it('state.slots == recomputo a partir dos móveis; capacidade = níveis etiquetados × slotCapacity', () => {
    const s = starterGame();
    const copy = { ...s.slots };
    recomputeSlots(s);
    expect(s.slots).toEqual(copy);
    expect(s.slots.feijao).toBe(4); // 4 níveis por prateleira, todos etiquetados no início
    expect(productCapacity(s, 'feijao')).toBe(48);
    expect(productCapacity(s, 'macarrao')).toBe(64);
    expect(productCapacity(s, 'arroz')).toBe(0);
    expect(productCapacity(s, 'refri')).toBe(0);
  });
  it('catálogo cobre todos os tipos com custo/nível coerentes', () => {
    const cat = furnitureCatalog();
    expect(cat.map((c) => c.type).sort()).toEqual(['counter', 'decor', 'freezer', 'fridge', 'rack', 'shelf']);
    for (const c of cat) { expect(c.cost).toBeGreaterThan(0); expect(Number.isInteger(c.cost)).toBe(true); }
    expect(cat.find((c) => c.type === 'shelf')!.categories).toEqual(['mercearia', 'limpeza', 'padaria', 'hortifruti', 'higiene', 'eletronicos']);
    expect(cat.find((c) => c.type === 'fridge')!.categories).toEqual(['bebidas', 'laticinios', 'hortifruti', 'frios']);
    expect(cat.find((c) => c.type === 'freezer')!.categories).toEqual(['congelados']);
  });
});

describe('canPlace', () => {
  const s = starterGame();
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
    expect(canPlace(s, 'counter', 7, 7, 0)).toBe(false);
    expect(canPlace(s, 'shelf', 8, 6, 0)).toBe(false); // Fase 4 (QA): (9,6) é o tile do operador do balcão (cadeira)
    expect(canPlace(s, 'shelf', 6, 5, 0)).toBe(true);
    expect(canPlace(s, 'shelf', 9, 5, 90)).toBe(false); // 1x2 em z=5..6 inclui o tile do operador (9,6)
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
    const t = starterGame();
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
    const s = starterGame();
    expect(() => buyFurniture(s, 'fridge', 8, 4, 0)).toThrow('Requer nível 2');
    s.level = 3;
    s.money = 100;
    expect(() => buyFurniture(s, 'shelf', 1, 4, 0)).toThrow('Dinheiro insuficiente');
    s.money = 1_000_000;
    expect(() => buyFurniture(s, 'shelf', 1, 2, 0)).toThrow('Posição inválida');
    const before = s.money;
    const f = buyFurniture(s, 'shelf', 1, 4, 0, 'arroz');
    expect(s.money).toBe(before - 20000);
    expect(f.productId).toBe('arroz');
    expect(productCapacity(s, 'arroz')).toBe(32);
    expect(s.slots.arroz).toBe(4);
    buyFurniture(s, 'shelf', 4, 4, 0, 'feijao');
    expect(productCapacity(s, 'feijao')).toBe(96);
    expect(s.slots.feijao).toBe(8);
    const plain = buyFurniture(s, 'shelf', 7, 4, 0); // sem produto: níveis vazios sem etiqueta
    expect(plain.levels).toEqual([{ units: 0 }, { units: 0 }, { units: 0 }, { units: 0 }]);
    expect(plain.productId).toBeUndefined();
  });
  it('categoria/licença validadas na atribuição', () => {
    const s = rich();
    const sh = s.furniture.find((f) => f.type === 'shelf')!;
    expect(() => assignProduct(s, sh.id, 'refri')).toThrow(); // bebida não cabe em prateleira
    const fr = buyFurniture(s, 'fridge', 1, 5, 0);
    expect(() => assignProduct(s, fr.id, 'refri')).toThrow('Categoria não licenciada');
    s.licenses.push('bebidas');
    assignProduct(s, fr.id, 'refri');
    expect(productCapacity(s, 'refri')).toBe(40);
    expect(() => assignProduct(s, s.furniture.find((f) => f.type === 'counter')!.id, 'arroz')).toThrow();
    assignProduct(s, fr.id, undefined);
    expect(productCapacity(s, 'refri')).toBe(0);
  });
  it('vender devolve 50% e move o excedente exposto para a calçada (ou depósito)', () => {
    const s = rich();
    const sh = s.furniture.find((f) => f.productId === 'feijao')!;
    expose(s, 'feijao', 24);
    const before = s.money;
    expect(sellFurniture(s, sh.id)).toBe(10000);
    expect(s.money).toBe(before + 10000);
    expect(s.shelf.feijao).toBe(0);
    expect(s.sidewalk.reduce((a, b) => a + b.units, 0)).toBe(24);
    expect(s.sidewalk.every((b) => b.open === false)).toBe(true); // sobras voltam em caixas fechadas
    expect(s.slots.feijao).toBe(0);
    // com depósito: vai para o depósito
    unlockStorage(s);
    const sh2 = s.furniture.find((f) => f.productId === 'macarrao')!;
    expose(s, 'macarrao', 32);
    sellFurniture(s, sh2.id);
    expect(s.storage.macarrao).toBe(32);
    expect(s.shelf.macarrao).toBe(0);
  });
  it('último caixa não pode ser vendido', () => {
    const s = rich();
    expect(() => sellFurniture(s, s.furniture.find((f) => f.type === 'counter')!.id)).toThrow();
    const c2 = buyFurniture(s, 'counter', 1, 6, 0);
    expect(checkoutCapacity(s)).toBe(45 + 20);
    expect(sellFurniture(s, c2.id)).toBe(50000);
  });
});

describe('expansão, depósito, funcionários, personalização', () => {
  it('expansão: até 6, custo e nível crescentes, aluguel sobe', () => {
    const s = rich(30);
    const costs: number[] = [];
    const levels: number[] = [];
    const rent0 = s.rent;
    for (let i = 0; i < 6; i++) {
      costs.push(expansionCost(s)!);
      levels.push(expansionMinLevel(s)!);
      buyExpansion(s);
    }
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(6);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(s.expansion).toBe(6);
    expect(storeBounds(s.expansion)).toEqual({ width: 36, depth: 22 });
    expect(storeBounds(99)).toEqual({ width: 36, depth: 22 });
    expect(s.rent).toBeGreaterThan(rent0);
    expect(expansionCost(s)).toBeNull();
    expect(expansionMinLevel(s)).toBeNull();
    expect(() => buyExpansion(s)).toThrow();
    const low = starterGame();
    expect(() => buyExpansion(low)).toThrow('Requer nível');
  });
  it('depósito: nível, capacidade, estantes, caixas', () => {
    const s = starterGame();
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
    const rentToday = s.rent;
    for (const role of ['cashier', 'stocker', 'janitor'] as const) {
      for (let l = 1; l < 5; l++) expect(employeeSpeed(role, l + 1)).toBeLessThan(employeeSpeed(role, l));
    }
    const rep0 = closeDay(s);
    expect(rep0.fixed).toBe(rentToday + 28000);
    expect(rep0.rent).toBe(rentToday);
    expect(rep0.wages).toBe(28000);
  });
  it('contratar exige nível e dinheiro', () => {
    const s = starterGame();
    expect(() => hireOrUpgrade(s, 'stocker')).toThrow('Requer nível');
    s.level = 20;
    s.money = 10;
    expect(() => hireOrUpgrade(s, 'stocker')).toThrow('Dinheiro insuficiente');
  });
  it('personalização', () => {
    const s = starterGame();
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
    const s = starterGame();
    expect(() => orderBoxes(s, 'feijao', 4)).toThrow('Dinheiro insuficiente'); // início pobre: R$ 250 (QA economia) não paga 4 caixas
    s.money = 1_000_000;
    const cost = orderBoxes(s, 'feijao', 3);
    expect(cost).toBeGreaterThan(0);
    expect(s.sidewalk).toHaveLength(3);
    expect(s.sidewalk.every((b) => b.open === false)).toBe(true); // chegam fechadas
    expect(() => orderBoxes(s, 'refri', 1)).toThrow();
    expect(() => orderBoxes(s, 'feijao', 0)).toThrow();
    expect(placeUnits(s, 0, 4)).toBe(4);
    expect(s.shelf.feijao).toBe(4);
    expect(() => discardBox(s, 0)).toThrow('ainda tem');
    expect(placeUnits(s, 0, 99)).toBe(8);
    expect(placeUnits(s, 1, 99)).toBe(12);
    expect(placeUnits(s, 2, 99)).toBe(12);
    expect(s.shelf.feijao).toBe(36);
    expect(s.furniture.find((f) => f.id === 2)!.levels!.map((l) => l.units)).toEqual([12, 12, 12, 0]); // enche nível a nível
    orderBoxes(s, 'feijao', 2);
    expect(placeUnits(s, 3, 99)).toBe(12);
    expect(placeUnits(s, 4, 99)).toBe(0); // capacidade 48 (4 níveis × 12)
    expect(s.shelf.feijao).toBe(48);
    discardBox(s, 0);
    expect(s.sidewalk).toHaveLength(4);
    expect(() => placeUnits(s, 9, 1)).toThrow('inexistente');
    expect(s.costBasis.feijao!.units).toBe(60);
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
    const s = starterGame();
    const r = rng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const list = makeShoppingList(s, r);
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((l) => l.productId)).size).toBe(list.length);
      for (const it of list) {
        seen.add(it.productId);
        expect(['feijao', 'macarrao']).toContain(it.productId);
        expect(it.qty).toBeGreaterThanOrEqual(1);
        expect(it.qty).toBeLessThanOrEqual(3);
      }
    }
    expect(seen.size).toBe(2);
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
    const s = starterGame();
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
    const s = starterGame();
    expose(s, 'feijao', 3);
    expect(takeFromShelf(s, 'feijao', 5)).toBe(3);
    expect(s.shelf.feijao).toBe(0);
    expect(takeFromShelf(s, 'feijao', 1)).toBe(0);
    returnToShelf(s, 'feijao', 2);
    expect(s.shelf.feijao).toBe(2);
    returnToShelf(s, 'feijao', 50); // não cabe tudo (48): o resto vai para a calçada em caixa fechada
    expect(s.shelf.feijao).toBe(48);
    expect(s.sidewalk).toEqual([{ productId: 'feijao', units: 4, open: false }]);
    const p = priceInfo(s, 'arroz').sell;
    expect(basketTotal(s, [{ productId: 'arroz', qty: 2 }, { productId: 'feijao', qty: 1 }])).toBe(2 * p + priceInfo(s, 'feijao').sell);
  });
  it('completeSale: receita, COGS pelo custo médio, XP, gorjeta limitada, reputação', () => {
    const s = starterGame();
    orderBoxes(s, 'feijao', 1);
    placeUnits(s, 0, 12);
    const avg = s.costBasis.feijao!.avg;
    expect(takeFromShelf(s, 'feijao', 2)).toBe(2);
    const price = priceInfo(s, 'feijao').sell;
    const m = s.money;
    const rep = s.reputation;
    const fast = completeSale(s, [{ productId: 'feijao', qty: 2 }], 1, 5);
    expect(fast.total).toBe(2 * price);
    expect(fast.tip).toBeGreaterThan(0);
    expect(fast.tip).toBeLessThanOrEqual(fast.total * 0.1);
    expect(fast.tip % 5).toBe(0);
    expect(s.money).toBe(m + fast.total + fast.tip);
    expect(s.ledger).toMatchObject({ revenue: fast.total, tips: fast.tip, cogs: 2 * avg, served: 1, happy: 1, angry: 0 });
    expect(s.costBasis.feijao!.units).toBe(10);
    expect(s.xp).toBeGreaterThanOrEqual(2 + 2);
    expect(s.reputation).toBeGreaterThan(rep);
    const slow = completeSale(s, [{ productId: 'feijao', qty: 1 }], 0, 5);
    expect(slow.tip).toBe(0);
    const mad = completeSale(s, [{ productId: 'feijao', qty: 1 }], 1, 2);
    expect(mad.tip).toBe(0);
    expect(s.ledger).toMatchObject({ served: 3, happy: 2, angry: 1 });
    expect(() => completeSale(s, [{ productId: 'feijao', qty: 0 }], 1, 5)).toThrow();
  });
  it('recordLostCustomer e reputação ficam em 1..5', () => {
    const s = starterGame();
    for (let i = 0; i < 500; i++) recordLostCustomer(s, 1);
    expect(s.ledger.lost).toBe(500);
    expect(s.ledger.angry).toBe(500);
    expect(s.reputation).toBeGreaterThanOrEqual(1);
    expect(s.reputation).toBeLessThan(1.1);
    for (let i = 0; i < 500; i++) recordLostCustomer(s, 99);
    expect(s.reputation).toBeLessThanOrEqual(5);
  });
  it('sujeira: cap de 12 e efeito pequeno na reputação', () => {
    const s = starterGame();
    for (let i = 0; i < 20; i++) addDirt(s, i, 1);
    expect(s.dirt).toHaveLength(12);
    cleanDirt(s, 99);
    cleanDirt(s, -1);
    expect(s.dirt).toHaveLength(12);
    const clean = starterGame();
    for (let i = 0; i < 40; i++) { recordLostCustomer(s, 4); recordLostCustomer(clean, 4); }
    expect(s.reputation).toBeLessThan(clean.reputation);
    expect(clean.reputation - s.reputation).toBeLessThan(0.5);
    while (s.dirt.length) cleanDirt(s, 0);
    expect(s.dirt).toHaveLength(0);
  });
  it('consumeLevelUps devolve cada nível uma única vez', () => {
    const s = starterGame();
    expect(consumeLevelUps(s)).toEqual([]);
    addXp(s, xpForLevel(4));
    expect(consumeLevelUps(s)).toEqual([2, 3, 4]);
    expect(consumeLevelUps(s)).toEqual([]);
  });
});

describe('dia', () => {
  it('plannedArrivals é determinístico e cresce com nível, reputação, preço baixo e tamanho', () => {
    const s = starterGame(9);
    expect(plannedArrivals(s)).toBe(plannedArrivals(s));
    const base = plannedArrivals(s);
    const hi = starterGame(9);
    hi.level = 10;
    expect(plannedArrivals(hi)).toBeGreaterThan(base);
    const rep = starterGame(9);
    rep.reputation = 5;
    expect(plannedArrivals(rep)).toBeGreaterThan(base);
    const big = starterGame(9);
    big.expansion = 2;
    expect(plannedArrivals(big)).toBeGreaterThan(base);
    const cheap = starterGame(9);
    for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) cheap.prices[id] = Math.round((priceInfo(cheap, id).market * 0.7) / 5) * 5;
    const dear = starterGame(9);
    for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) dear.prices[id] = Math.round((priceInfo(dear, id).market * 1.5) / 5) * 5;
    expect(plannedArrivals(cheap)).toBeGreaterThan(plannedArrivals(dear));
  });
  it('arrivalSchedule: mesmo tamanho, ordenado, dentro do expediente', () => {
    const s = starterGame(4);
    const t = arrivalSchedule(s);
    expect(t).toHaveLength(plannedArrivals(s));
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(t[0]!).toBeGreaterThanOrEqual(8 * 60);
    expect(t.at(-1)!).toBeLessThanOrEqual(21 * 60 - 30);
  });
  it('closeDay: cobra o aluguel do dia (grátis no começo) + salários, avança dia, zera ledger', () => {
    const s = starterGame();
    expect(s.rent).toBe(0);
    const m = s.money;
    const day = s.day;
    const rep = closeDay(s);
    expect(rep.fixed).toBe(0);
    expect(rep.rent).toBe(0);
    expect(s.money).toBe(m);
    expect(s.day).toBe(day + 1);
    expect(s.ledger.revenue).toBe(0);
    s.level = 5; // aluguel cheio (rampa encerrada) a partir do próximo dia
    closeDay(s);
    const rent = s.rent;
    expect(rent).toBeGreaterThan(0);
    const m2 = s.money;
    const rep2 = closeDay(s);
    expect(rep2.fixed).toBe(rent);
    expect(s.money).toBe(m2 - rent);
  });
  it('priceInfo: custo = custo médio do estoque quando existe', () => {
    const s = starterGame();
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
    const old = JSON.parse(serialize(starterGame(7))) as Record<string, unknown>;
    delete old.levelAck;
    delete old.furniture;
    delete old.nextFurnitureId;
    delete old.decor;
    old.level = 5;
    old.slots = { arroz: 2, feijao: 2, macarrao: 2, cafe: 2 };
    old.shelf = { feijao: 10, arroz: 3 }; // arroz sem móvel no layout inicial: volta em caixa
    const s = deserialize(JSON.stringify(old));
    expect(s.furniture.filter((f) => f.type === 'shelf')).toHaveLength(2);
    expect(s.furniture.some((f) => f.type === 'counter')).toBe(true);
    expect(s.levelAck).toBe(5);
    expect(consumeLevelUps(s)).toEqual([]);
    // o layout inicial agora não tem produto: todo o estoque exposto do save antigo volta em caixas
    expect(productCapacity(s, 'feijao')).toBe(0);
    expect(s.shelf.feijao ?? 0).toBe(0);
    expect(s.shelf.arroz ?? 0).toBe(0);
    expect(s.sidewalk).toEqual(expect.arrayContaining([{ productId: 'arroz', units: 3, open: false }, { productId: 'feijao', units: 10, open: false }]));
    expect(s.decor.wallColor).toBeTruthy();
    expect(s.nextFurnitureId).toBeGreaterThan(3);
  });
  it('save de versão estranha é rejeitado', () => {
    expect(() => deserialize('{"version":2}')).toThrow();
  });
});
