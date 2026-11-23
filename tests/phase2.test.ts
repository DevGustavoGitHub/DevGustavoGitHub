import { describe, expect, it } from 'vitest';
import {
  assignProduct, autoOrderRules, buyExpansion, buyFurniture, buyMissing, buyUpgrade, canPlace, carryCapacity, closeDay, completeSale,
  decorCatalog, dayHistory, employeeCost, furnitureCatalog, isBankrupt, loanInfo, orderBoxes, productCapacity, repayLoan,
  restartAfterBankruptcy, runAutoOrders, sellFurniture, setAutoOrder, takeLoan, takeFromShelf, topProducts, unlockStorage, upgradeCatalog,
  expansionCost, expansionMinLevel, storageCost,
} from '../src/sim/api';
import { LICENSES, PRODUCTS } from '../src/sim/catalog';
import { XP_BASE, XP_EXP, addXp, xpForLevel } from '../src/sim/economy';
import { keepTiles } from '../src/sim/furniture';
import { newBot, playDay } from '../src/sim/bot';
import { deserialize, serialize } from '../src/sim/save';
import { newGame, type StoreState } from '../src/sim/state';
import { BANKRUPTCY, EMPLOYEE_TABLE, UPGRADES } from '../src/sim/tuning';
import { storeBounds } from '../src/core/layout';

const at = (level: number, money = 100_000_000): StoreState => {
  const s = newGame(7);
  s.level = level;
  s.xp = xpForLevel(level);
  s.levelAck = level;
  s.money = money;
  return s;
};

describe('empréstimo', () => {
  it('limite cresce com o nível e crédito não passa dele', () => {
    const a = loanInfo(at(1));
    const b = loanInfo(at(20));
    expect(b.maxLoan).toBeGreaterThan(a.maxLoan * 5);
    expect(a.owed).toBe(0);
    expect(a.available).toBe(a.maxLoan);
    const s = at(3, 0);
    takeLoan(s, 100000);
    expect(s.money).toBe(100000);
    expect(loanInfo(s).owed).toBe(100000);
    expect(() => takeLoan(s, loanInfo(s).available + 5)).toThrow('limite');
    expect(() => takeLoan(s, 0)).toThrow();
    expect(() => takeLoan(s, 10.5)).toThrow();
    takeLoan(s, loanInfo(s).available);
    expect(loanInfo(s).available).toBe(0);
  });
  it('juros baixos são cobrados em closeDay e entram no relatório/lucro', () => {
    const s = at(5);
    const rent = s.rent;
    const m0 = s.money;
    takeLoan(s, 200_000);
    const r = closeDay(s);
    expect(r.interest).toBe(loanInfo(s).dailyInterest);
    expect(r.interest!).toBeGreaterThan(0);
    expect(r.interest!).toBeLessThanOrEqual(200_000 * 0.01); // baixo: <= 1% ao dia
    expect(r.interest! % 5).toBe(0);
    expect(r.fixed).toBe(rent + r.interest!);
    expect(s.money).toBe(m0 + 200_000 - rent - r.interest!);
    expect(r.netProfit).toBe(-(rent + r.interest!));
    expect(r.loan).toBe(200_000);
  });
  it('sem dívida não há juros; pagamento parcial e total', () => {
    const s = at(5);
    expect(closeDay(s).interest).toBe(0);
    takeLoan(s, 200000);
    repayLoan(s, 80000);
    expect(s.loan).toBe(120000);
    expect(() => repayLoan(s, 120005)).toThrow('maior que a dívida');
    s.money = 1000;
    expect(() => repayLoan(s, 5000)).toThrow('Dinheiro insuficiente');
    s.money = 400000;
    repayLoan(s, 120000);
    expect(s.loan).toBe(0);
    expect(loanInfo(s).dailyInterest).toBe(0);
  });
});

describe('falência', () => {
  it('loja saudável ou com crédito disponível não está falida', () => {
    expect(isBankrupt(newGame())).toBe(false);
    const s = at(10, -100000); // negativo, mas dá para cobrir com crédito
    expect(isBankrupt(s)).toBe(false);
  });
  it('rombo maior que crédito + estoque liquidado = falido; estoque ou crédito salvam', () => {
    const s = at(2, 0);
    const { available } = loanInfo(s);
    s.money = -(available + 5);
    expect(isBankrupt(s)).toBe(true);
    s.money = -available;
    expect(isBankrupt(s)).toBe(false);
  });
  it('estoque cobre dívida', () => {
    const s = at(2, 5_000_000);
    orderBoxes(s, 'arroz', 6); // ~R$ 800 em estoque
    const stockLiq = Math.floor(6 * 6 * 2200 * BANKRUPTCY.stockRecovery);
    s.money = -(loanInfo(s).available + stockLiq - 100);
    expect(isBankrupt(s)).toBe(false);
    s.money = -(loanInfo(s).available + stockLiq + 5000);
    expect(isBankrupt(s)).toBe(true);
  });
  it('é alcançável (preço abusivo, sem investir) e recuperável (recomeço guiado volta a lucrar)', { timeout: 60000 }, () => {
    const s = newGame(5);
    const bot = newBot({ priceMult: 3, invest: false, restocks: 1 });
    let days = 0;
    while (!isBankrupt(s) && days < 400) { playDay(s, bot); days++; }
    expect(isBankrupt(s)).toBe(true);
    expect(days).toBeLessThan(400);
    // sobe nível/licenças para provar que o recomeço mantém progresso
    s.level = 9;
    s.xp = xpForLevel(9);
    s.licenses.push('bebidas');
    s.upgrades.push('dolly');
    const decor = { ...s.decor };
    const level = s.level;
    const day = s.day;
    restartAfterBankruptcy(s);
    expect(isBankrupt(s)).toBe(false);
    expect(s.money).toBe(BANKRUPTCY.restartMoney);
    expect(s.money).toBeLessThanOrEqual(3 * newGame().money); // capital pequeno, como no começo
    expect(s.furnitureStock).toEqual([]);
    expect(s.loan).toBe(0);
    expect(s.level).toBe(level);
    expect(s.day).toBe(day);
    expect(s.licenses).toContain('bebidas');
    expect(s.upgrades).toContain('dolly');
    expect(s.decor).toEqual(decor);
    expect(s.bankruptcies).toBe(1);
    expect(s.expansion).toBe(0);
    expect(s.sidewalk).toHaveLength(0);
    expect(s.furniture.filter((f) => f.type === 'counter')).toHaveLength(1);
    for (const f of s.furniture) expect(canPlace(s, f.type, f.x, f.z, f.rot, f.id)).toBe(true);
    // recomeça jogando normalmente: precisa dar lucro e sair do vermelho
    const net = playDays30(s);
    expect(net).toBeGreaterThan(0);
    expect(isBankrupt(s)).toBe(false);
    expect(s.money).toBeGreaterThan(BANKRUPTCY.restartMoney);
  });
});

function playDays30(s: StoreState): number {
  const bot = newBot();
  let net = 0;
  for (let i = 0; i < 30; i++) net += playDay(s, bot).netProfit;
  return net;
}

describe('pedidos automáticos', () => {
  it('regras: só licenciados, validação e remoção', () => {
    const s = at(5);
    expect(() => setAutoOrder(s, 'refri', { minUnits: 10, boxes: 1 })).toThrow('não licenciada');
    expect(() => setAutoOrder(s, 'nada', { minUnits: 10, boxes: 1 })).toThrow('desconhecido');
    expect(() => setAutoOrder(s, 'arroz', { minUnits: -1, boxes: 1 })).toThrow();
    expect(() => setAutoOrder(s, 'arroz', { minUnits: 10, boxes: 0 })).toThrow();
    expect(() => setAutoOrder(s, 'arroz', { minUnits: 10, boxes: 1.5 })).toThrow();
    setAutoOrder(s, 'arroz', { minUnits: 10, boxes: 2 });
    expect(autoOrderRules(s)).toEqual({ arroz: { minUnits: 10, boxes: 2 } });
    autoOrderRules(s).arroz!.boxes = 99; // cópia
    expect(s.autoOrders.arroz!.boxes).toBe(2);
    setAutoOrder(s, 'arroz', null);
    expect(autoOrderRules(s)).toEqual({});
  });
  it('compra só quando (prateleira+depósito+calçada) < mínimo e há dinheiro', () => {
    const s = at(5);
    setAutoOrder(s, 'arroz', { minUnits: 20, boxes: 2 });
    setAutoOrder(s, 'feijao', { minUnits: 5, boxes: 1 });
    s.shelf.feijao = 5; // no limite: não compra
    const m0 = s.money;
    const bought = runAutoOrders(s);
    expect(bought.map((b) => b.productId)).toEqual(['arroz']);
    expect(bought[0]!.boxes).toBe(2);
    expect(m0 - s.money).toBe(bought[0]!.cost);
    expect(s.sidewalk.filter((b) => b.productId === 'arroz')).toHaveLength(2);
    expect(runAutoOrders(s)).toHaveLength(1); // 12 unidades na calçada < 20: pede de novo
    expect(runAutoOrders(s)).toEqual([]); // 24 >= 20
  });
  it('conta depósito e calçada; respeita dinheiro e calçada cheia sem lançar', () => {
    const s = at(5, 1000);
    setAutoOrder(s, 'arroz', { minUnits: 10, boxes: 1 });
    expect(runAutoOrders(s)).toEqual([]); // sem dinheiro
    expect(s.money).toBe(1000);
    s.money = 100_000_000;
    s.storage.arroz = 10; // depósito já cobre
    expect(runAutoOrders(s)).toEqual([]);
    s.storage.arroz = 0;
    for (let i = 0; i < 48; i++) s.sidewalk.push({ productId: 'cafe', units: 10 });
    expect(runAutoOrders(s)).toEqual([]); // calçada cheia
  });
});

describe('buyMissing', () => {
  it('enche prateleiras (licenciadas e com móvel) em caixas inteiras', () => {
    const s = at(5);
    const r = buyMissing(s);
    expect(r.boxes).toBeGreaterThan(0);
    expect(s.money).toBe(100_000_000 - r.cost);
    for (const id of ['arroz', 'feijao', 'macarrao', 'cafe']) {
      const have = s.sidewalk.filter((b) => b.productId === id).reduce((a, b) => a + b.units, 0);
      expect(have).toBeGreaterThanOrEqual(productCapacity(s, id));
    }
    expect(s.sidewalk.some((b) => b.productId === 'refri')).toBe(false);
    expect(buyMissing(s)).toEqual({ cost: 0, boxes: 0 }); // já cheio
  });
  it('fillRatio parcial e orçamento limitado', () => {
    const half = at(5);
    const full = at(5);
    const rh = buyMissing(half, 0.5);
    const rf = buyMissing(full, 1);
    expect(rh.boxes).toBeLessThan(rf.boxes);
    const poor = at(5, 20000);
    const rp = buyMissing(poor);
    expect(rp.cost).toBeLessThanOrEqual(20000);
    expect(poor.money).toBeGreaterThanOrEqual(0);
    expect(rp.boxes).toBeGreaterThan(0);
  });
});

describe('melhorias (dolly)', () => {
  it('caro, mas acessível por volta do nível 6; carryCapacity 1 → 3', () => {
    const s = at(5, 10_000_000);
    const d = upgradeCatalog(s).find((u) => u.id === 'dolly')!;
    expect(d.owned).toBe(false);
    expect(d.minLevel).toBe(6);
    expect(d.cost).toBeGreaterThanOrEqual(400000);
    expect(d.cost).toBeLessThanOrEqual(800000);
    expect(carryCapacity(s)).toBe(1);
    expect(() => buyUpgrade(s, 'dolly')).toThrow('Requer nível 6');
    s.level = 6;
    s.money = d.cost - 5;
    expect(() => buyUpgrade(s, 'dolly')).toThrow('Dinheiro insuficiente');
    s.money = d.cost;
    buyUpgrade(s, 'dolly');
    expect(s.money).toBe(0);
    expect(carryCapacity(s)).toBe(UPGRADES.dolly.carry);
    expect(carryCapacity(s)).toBe(3);
    expect(upgradeCatalog(s).find((u) => u.id === 'dolly')!.owned).toBe(true);
    expect(() => buyUpgrade(s, 'dolly')).toThrow('já adquirida');
  });
});

describe('histórico e produtos mais vendidos', () => {
  const sellSome = (s: StoreState, id: string, qty: number): void => {
    s.shelf[id] = (s.shelf[id] ?? 0) + qty;
    expect(takeFromShelf(s, id, qty)).toBe(qty);
    completeSale(s, [{ productId: id, qty }], 0.5, 4);
  };
  it('closeDay guarda até 30 relatórios (os mais recentes)', () => {
    const s = newGame(2);
    for (let i = 0; i < 40; i++) closeDay(s);
    const h = dayHistory(s);
    expect(h).toHaveLength(30);
    expect(h[0]!.day).toBe(11);
    expect(h[29]!.day).toBe(40);
  });
  it('topProducts agrega unidades/receita/lucro por produto e ordena por lucro', () => {
    const s = at(5);
    sellSome(s, 'arroz', 2);
    sellSome(s, 'feijao', 5);
    sellSome(s, 'arroz', 1);
    closeDay(s);
    sellSome(s, 'cafe', 1);
    const top = topProducts(s, 7);
    const arroz = top.find((t) => t.productId === 'arroz')!;
    expect(arroz.units).toBe(3);
    expect(arroz.revenue).toBeGreaterThan(0);
    expect(arroz.profit).toBeGreaterThan(0);
    expect(arroz.profit).toBeLessThan(arroz.revenue);
    expect(top.map((t) => t.productId).sort()).toEqual(['arroz', 'cafe', 'feijao']);
    for (let i = 1; i < top.length; i++) expect(top[i - 1]!.profit).toBeGreaterThanOrEqual(top[i]!.profit);
    // janela: 1 dia só enxerga ontem + hoje (day atual = 2; ontem = 1)
    for (let i = 0; i < 10; i++) closeDay(s);
    expect(topProducts(s, 7)).toEqual([]);
    expect(topProducts(s, 30).length).toBe(3);
  });
  it('stats ficam limitados a 30 dias e o save continua pequeno', { timeout: 60000 }, () => {
    const s = newGame(3);
    const bot = newBot();
    for (let i = 0; i < 45; i++) playDay(s, bot);
    expect(s.stats.length).toBeLessThanOrEqual(30);
    expect(s.history.length).toBe(30);
    expect(serialize(s).length).toBeLessThan(60_000);
  });
});

describe('save: migração e persistência', () => {
  it('save antigo (sem campos da fase 2) carrega com defaults e novos produtos', () => {
    const old = JSON.parse(serialize(newGame(9))) as Record<string, unknown>;
    for (const k of ['loan', 'autoOrders', 'upgrades', 'history', 'stats', 'bankruptcies']) delete old[k];
    const market = old.market as Record<string, number>;
    for (const p of PRODUCTS.filter((x) => x.category === 'hortifruti')) delete market[p.id];
    const s = deserialize(JSON.stringify(old));
    expect(s.loan).toBe(0);
    expect(s.autoOrders).toEqual({});
    expect(s.upgrades).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.stats).toEqual([]);
    expect(s.market.banana).toBe(1);
    expect(carryCapacity(s)).toBe(1);
    expect(loanInfo(s).owed).toBe(0);
  });
  it('round-trip preserva empréstimo, regras, melhorias, histórico e estatísticas', () => {
    const s = at(8);
    takeLoan(s, 300000);
    setAutoOrder(s, 'arroz', { minUnits: 7, boxes: 3 });
    buyUpgrade(s, 'dolly');
    s.shelf.arroz = 5;
    takeFromShelf(s, 'arroz', 3);
    completeSale(s, [{ productId: 'arroz', qty: 3 }], 0.5, 4);
    closeDay(s);
    expect(deserialize(serialize(s))).toEqual(s);
  });
  it('save corrompido nos campos novos é saneado', () => {
    const raw = JSON.parse(serialize(newGame())) as Record<string, unknown>;
    Object.assign(raw, { loan: 'x', autoOrders: [], upgrades: 5, history: null, stats: {} });
    const s = deserialize(JSON.stringify(raw));
    expect(s.loan).toBe(0);
    expect(s.autoOrders).toEqual({});
    expect(s.upgrades).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.stats).toEqual([]);
  });
});

describe('conteúdo de fim de jogo', () => {
  it('novas categorias: 3 a 5 produtos cada, com cor e forma, coerentes', () => {
    for (const c of ['hortifruti', 'higiene', 'frios', 'eletronicos'] as const) {
      const ps = PRODUCTS.filter((p) => p.category === c);
      expect(ps.length).toBeGreaterThanOrEqual(3);
      expect(ps.length).toBeLessThanOrEqual(5);
      expect(LICENSES.some((l) => l.id === c)).toBe(true);
    }
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
    for (const p of PRODUCTS) {
      expect(p.color, p.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['box', 'bottle', 'can', 'bag', 'tray', 'jar']).toContain(p.shape);
      expect(p.markup).toBeGreaterThan(1.2);
      expect(p.markup).toBeLessThan(2.1);
      expect(p.boxSize).toBeGreaterThanOrEqual(2);
      expect(p.slotCapacity).toBeGreaterThanOrEqual(3);
      expect(p.popularity).toBeGreaterThan(0);
      expect(Number.isInteger(p.baseWholesale) && p.baseWholesale % 5 === 0).toBe(true);
    }
  });
  it('toda categoria tem licença e um móvel que a exponha; licenças custam mais conforme o nível', () => {
    const cats = new Set(PRODUCTS.map((p) => p.category));
    for (const c of cats) {
      expect(LICENSES.some((l) => l.id === c), c).toBe(true);
      expect(furnitureCatalog().some((f) => f.categories.includes(c)), c).toBe(true);
    }
    const sorted = [...LICENSES].sort((a, b) => a.minLevel - b.minLevel);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.cost).toBeGreaterThan(sorted[i - 1]!.cost);
    expect(Math.max(...LICENSES.map((l) => l.minLevel))).toBeGreaterThanOrEqual(24);
    expect(Math.max(...LICENSES.map((l) => l.minLevel))).toBeLessThanOrEqual(30);
  });
  it('produtos novos podem ser comprados, expostos e vendidos', () => {
    const s = at(26);
    for (const l of LICENSES) if (!s.licenses.includes(l.id)) s.licenses.push(l.id);
    s.expansion = 3;
    for (const [id, type] of [['banana', 'shelf'], ['papelhig', 'shelf'], ['carne', 'fridge'], ['fone', 'shelf']] as const) {
      let placed = false;
      for (let z = 0; z < 16 && !placed; z++) for (let x = 0; x < 24 && !placed; x++) {
        if (canPlace(s, type, x, z, 0)) { const f = buyFurniture(s, type, x, z, 0); assignProduct(s, f.id, id); placed = true; }
      }
      expect(placed, id).toBe(true);
      orderBoxes(s, id, 1);
    }
    expect(() => assignProduct(s, s.furniture.find((f) => f.productId === 'carne')!.id, 'banana')).not.toThrow(); // geladeira aceita hortifruti
    expect(() => assignProduct(s, s.furniture.find((f) => f.productId === 'fone')!.id, 'carne')).toThrow('não cabe');
  });
  it('progressão não trava: sempre há algo novo a destravar até o nível ~30 (lacunas ≤ 3 níveis)', () => {
    const levels = new Set<number>();
    for (const l of LICENSES) levels.add(l.minLevel);
    for (const f of furnitureCatalog()) levels.add(f.minLevel);
    for (const d of decorCatalog()) levels.add(d.minLevel);
    for (const role of Object.keys(EMPLOYEE_TABLE) as (keyof typeof EMPLOYEE_TABLE)[]) for (const l of EMPLOYEE_TABLE[role].minLevel) levels.add(l);
    levels.add(storageCost().minLevel);
    for (const u of upgradeCatalog(newGame())) levels.add(u.minLevel);
    const s = newGame();
    const exp: number[] = [];
    for (let i = 0; i < 6; i++) { exp.push(expansionMinLevel(s)!); s.expansion++; }
    exp.forEach((l) => levels.add(l));
    expect(expansionCost(s)).toBeNull();
    const sorted = [...levels].sort((a, b) => a - b);
    expect(sorted[sorted.length - 1]).toBeGreaterThanOrEqual(28);
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(30);
    for (let l = 1; l < 28; l++) expect(sorted.some((x) => x > l && x <= l + 3), `nível ${l}`).toBe(true);
    // Fase 3: expansões 1–4 nos níveis 3, 5, 6 e 7 (como no original); 5 e 6 ficam como metas de fim de jogo
    expect(exp.slice(0, 4)).toEqual([3, 5, 6, 7]);
    expect(exp[4]).toBeGreaterThan(exp[3]!);
    expect(exp[5]).toBeGreaterThan(exp[4]!);
    expect(exp[5]).toBeLessThanOrEqual(30);
  });
  it('XP: nível ~30 exige bem mais que o ritmo inicial, e a curva continua crescente', () => {
    expect(xpForLevel(2)).toBe(60); // Fase 3: nível 2 no 1º dia mesmo com a loja pobre
    expect(xpForLevel(15)).toBe(Math.round(XP_BASE * Math.pow(14, XP_EXP)));
    expect(xpForLevel(30)).toBeGreaterThan(Math.round(XP_BASE * Math.pow(29, XP_EXP)) * 1.5);
    for (let n = 2; n < 60; n++) expect(xpForLevel(n + 1)).toBeGreaterThan(xpForLevel(n));
    const s = newGame();
    addXp(s, xpForLevel(30));
    expect(s.level).toBe(30);
  });
});

describe('decoração e expansões novas', () => {
  it('itens de decoração têm preço/nível próprios e reembolso proporcional', () => {
    const s = at(30);
    const cat = decorCatalog();
    expect(cat.length).toBeGreaterThanOrEqual(8);
    for (const id of ['plant', 'tree', 'banner', 'lamp']) expect(cat.some((d) => d.id === id)).toBe(true);
    const fountain = cat.find((d) => d.id === 'fountain')!;
    const m0 = s.money;
    const f = buyFurniture(s, 'decor', 2, 5, 0, 'fountain');
    expect(f.variant).toBe('fountain');
    expect(m0 - s.money).toBe(fountain.cost);
    expect(sellFurniture(s, f.id)).toBe(Math.round(fountain.cost / 2));
    const low = at(2);
    expect(() => buyFurniture(low, 'decor', 2, 5, 0, 'fountain')).toThrow('Requer nível');
    const m1 = low.money;
    buyFurniture(low, 'decor', 2, 5, 0, 'plant');
    expect(m1 - low.money).toBe(furnitureCatalog().find((c) => c.type === 'decor')!.cost);
  });
  it('expansões 5 e 6 ampliam o salão e a porta nunca fica bloqueada por móveis antigos', () => {
    const s = at(30);
    unlockStorage(s);
    // móvel exatamente onde ficará a nova antessala/passagem depois de cada expansão
    for (let i = 0; i < 6; i++) {
      const next = storeBounds(s.expansion + 1);
      const dx = next.width / 2;
      for (const [x, z] of [[dx - 1, 0], [dx - 1, next.depth - 2]] as const) {
        const cur = storeBounds(s.expansion);
        if (x + 2 <= cur.width && z < cur.depth && canPlace(s, 'decor', x, z, 0)) buyFurniture(s, 'decor', x, z, 0, 'plant');
      }
      if (canPlace(s, 'shelf', dx - 1, 0, 0)) assignProduct(s, buyFurniture(s, 'shelf', dx - 1, 0, 0).id, 'arroz');
      buyExpansion(s);
      const keep = new Set(keepTiles(s).map(([x, z]) => `${x},${z}`));
      for (const f of s.furniture) {
        const w = f.rot === 90 || f.rot === 270 ? (f.type === 'counter' ? 2 : 1) : (f.type === 'decor' ? 1 : 2);
        const d = f.rot === 90 || f.rot === 270 ? (f.type === 'decor' ? 1 : 2) : (f.type === 'counter' ? 2 : 1);
        for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) expect(keep.has(`${f.x + a},${f.z + b}`), `f${f.id} exp${s.expansion}`).toBe(false);
      }
      expect(canPlace(s, 'shelf', 0, storeBounds(s.expansion).depth - 1, 0)).toBe(true);
    }
    expect(storeBounds(s.expansion)).toEqual({ width: 36, depth: 22 });
  });
  it('contratar nível alto de repositor continua exigindo nível', () => {
    expect(employeeCost(newGame(), 'stocker')!.minLevel).toBe(8);
  });
});
