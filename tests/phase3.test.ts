import { describe, expect, it } from 'vitest';
import {
  assignProduct, buyExpansion, buyFurniture, buyUpgrade, canDropBox, cartTotal, checkoutCart, closeDay, completeSale, customerCapacity,
  dropBox, employeeCost, expansionMinLevel, furnitureCatalog, furnitureForProduct, furnitureStock, orderBoxes, placeFromStock, placeUnits,
  priceInfo, productCapacity, recycleBox, recordLostCustomer, sellFurniture, setBoxOpen, setDecor, storageCost, storageCapacity, storeBox,
  storeFurniture, takeFromStorage, unlockStorage, upgradeCatalog, type CartLine,
} from '../src/sim/api';
import { LICENSES, PRODUCTS } from '../src/sim/catalog';
import { xpForLevel } from '../src/sim/economy';
import { rentFor } from '../src/sim/rent';
import { deserialize, serialize } from '../src/sim/save';
import { DEFAULT_DECOR, type StoreState } from '../src/sim/state';
import { RECYCLE_REWARD, RENT, START_MONEY, UPGRADES } from '../src/sim/tuning';
import { SIDEWALK_DEPTH, storeBounds } from '../src/core/layout';
import { expose, starterGame } from './helpers';

const at = (level: number, money = 100_000_000): StoreState => {
  const s = starterGame(7);
  s.level = level;
  s.xp = xpForLevel(level);
  s.levelAck = level;
  s.money = money;
  return s;
};
const boxCost = (s: StoreState, id: string): number => priceInfo(s, id).wholesale * PRODUCTS.find((p) => p.id === id)!.boxSize;

describe('carrinho do Mercado (cartTotal / checkoutCart)', () => {
  it('total = caixas × unidades × atacado + móveis do catálogo (decor pela variante)', () => {
    const s = at(10);
    const lines: CartLine[] = [
      { kind: 'product', id: 'feijao', qty: 2 },
      { kind: 'furniture', id: 'shelf', qty: 2 },
      { kind: 'furniture', id: 'decor', qty: 1, variant: 'lamp' },
      { kind: 'product', id: 'arroz', qty: 0 },
    ];
    const shelf = furnitureCatalog().find((f) => f.type === 'shelf')!.cost;
    expect(cartTotal(s, lines)).toBe(2 * boxCost(s, 'feijao') + 2 * shelf + 12000);
    expect(cartTotal(s, [])).toBe(0);
    expect(() => cartTotal(s, [{ kind: 'product', id: 'feijao', qty: 1.5 }])).toThrow('Quantidade');
    expect(() => cartTotal(s, [{ kind: 'product', id: 'nada', qty: 1 }])).toThrow('desconhecido');
    expect(() => cartTotal(s, [{ kind: 'furniture', id: 'sofa', qty: 1 }])).toThrow('desconhecido');
  });
  it('compra atômica: caixas FECHADAS na calçada, móveis no estoque de montagem, cobra o total uma vez', () => {
    const s = at(10);
    s.licenses.push('bebidas');
    const lines: CartLine[] = [
      { kind: 'product', id: 'feijao', qty: 2 },
      { kind: 'product', id: 'refri', qty: 1 },
      { kind: 'furniture', id: 'fridge', qty: 1 },
      { kind: 'furniture', id: 'decor', qty: 2, variant: 'banner' },
    ];
    const total = cartTotal(s, lines);
    const m0 = s.money;
    const r = checkoutCart(s, lines);
    expect(r).toEqual({ cost: total, boxes: 3, furniture: 3 });
    expect(s.money).toBe(m0 - total);
    expect(s.sidewalk).toHaveLength(3);
    expect(s.sidewalk.every((b) => b.open === false && b.x === undefined)).toBe(true);
    expect(s.ledger.purchases).toBe(2 * boxCost(s, 'feijao') + boxCost(s, 'refri')); // móveis não são compra de estoque
    expect(furnitureStock(s)).toEqual([{ type: 'fridge' }, { type: 'decor', variant: 'banner' }, { type: 'decor', variant: 'banner' }]);
    furnitureStock(s)[0]!.type = 'rack'; // cópia
    expect(s.furnitureStock[0]!.type).toBe('fridge');
  });
  it('tudo ou nada: licença, nível, dinheiro, calçada, estante sem depósito e carrinho vazio', () => {
    const cases: [string, (s: StoreState) => CartLine[], string][] = [
      ['licença', () => [{ kind: 'product', id: 'feijao', qty: 1 }, { kind: 'product', id: 'leite', qty: 1 }], 'licenciada'],
      ['nível', () => [{ kind: 'product', id: 'feijao', qty: 1 }, { kind: 'furniture', id: 'freezer', qty: 1 }], 'requer nível 10'],
      ['nível decor', () => [{ kind: 'furniture', id: 'decor', qty: 1, variant: 'statue' }], 'requer nível'],
      ['estante', () => [{ kind: 'furniture', id: 'rack', qty: 1 }], 'depósito'],
      ['vazio', () => [{ kind: 'product', id: 'feijao', qty: 0 }], 'vazio'],
      ['calçada', (s) => { for (let i = 0; i < 47; i++) s.sidewalk.push({ productId: 'cafe', units: 1 }); return [{ kind: 'product', id: 'feijao', qty: 2 }]; }, 'Calçada cheia'],
      ['dinheiro', (s) => { s.money = boxCost(s, 'feijao') + 5; return [{ kind: 'product', id: 'feijao', qty: 1 }, { kind: 'furniture', id: 'shelf', qty: 1 }]; }, 'Dinheiro insuficiente'],
    ];
    for (const [name, mk, msg] of cases) {
      const s = at(5);
      const lines = mk(s);
      const before = serialize(s);
      expect(() => checkoutCart(s, lines), name).toThrow(msg);
      expect(serialize(s), name).toBe(before);
    }
  });
});

describe('estoque de montagem (placeFromStock / storeFurniture)', () => {
  it('monta sem cobrar de novo, valida posição, atribui produto e guarda a variante', () => {
    const s = at(6);
    checkoutCart(s, [{ kind: 'furniture', id: 'shelf', qty: 1 }, { kind: 'furniture', id: 'decor', qty: 1, variant: 'rug' }]);
    const m0 = s.money;
    expect(() => placeFromStock(s, 5, 7, 2, 0)).toThrow('estoque');
    expect(() => placeFromStock(s, 0, 1, 2, 0)).toThrow('Posição inválida'); // em cima da prateleira do feijão
    expect(() => placeFromStock(s, 0, 7, 2, 0, 'refri')).toThrow(); // bebida não vai na prateleira
    expect(s.furnitureStock).toHaveLength(2);
    const f = placeFromStock(s, 0, 7, 2, 0, 'arroz');
    expect(f).toMatchObject({ type: 'shelf', x: 7, z: 2, rot: 0, productId: 'arroz' });
    expect(s.money).toBe(m0);
    expect(f.levels).toEqual([0, 1, 2, 3].map(() => ({ productId: 'arroz', units: 0 }))); // 4 níveis etiquetados
    expect(productCapacity(s, 'arroz')).toBe(32);
    expect(s.slots.arroz).toBe(4);
    const d = placeFromStock(s, 0, 0, 6, 0);
    expect(d.levels).toBeUndefined(); // decoração não tem níveis
    expect(d.variant).toBe('rug');
    expect(s.furnitureStock).toEqual([]);
    expect(new Set(s.furniture.map((x) => x.id)).size).toBe(s.furniture.length);
  });
  it('desmontar devolve ao estoque; exposto vai para a calçada; regras do último caixa e da estante ocupada', () => {
    const s = at(12);
    const sh = s.furniture.find((f) => f.productId === 'feijao')!;
    expose(s, 'feijao', 20);
    const m0 = s.money;
    storeFurniture(s, sh.id);
    expect(s.money).toBe(m0); // não é venda
    expect(s.furniture.some((f) => f.id === sh.id)).toBe(false);
    expect(s.furnitureStock).toEqual([{ type: 'shelf' }]);
    expect(s.shelf.feijao).toBe(0);
    expect(s.sidewalk.reduce((a, b) => a + b.units, 0)).toBe(20);
    expect(s.sidewalk.map((b) => b.units)).toEqual([12, 8]); // caixas fechadas de até boxSize
    placeFromStock(s, 0, sh.x, sh.z, 0, 'feijao');
    expect(productCapacity(s, 'feijao')).toBe(48);
    expect(() => storeFurniture(s, s.furniture.find((f) => f.type === 'counter')!.id)).toThrow('pelo menos um caixa');
    unlockStorage(s);
    const rack = buyFurniture(s, 'rack', 1, -3, 0);
    for (let i = 0; i < storageCapacity(s); i++) { orderBoxes(s, 'macarrao', 1); storeBox(s, s.sidewalk.length - 1); }
    expect(() => storeFurniture(s, rack.id)).toThrow('Esvazie');
    expect(s.furniture.some((f) => f.id === rack.id)).toBe(true);
  });
});

describe('caixas no chão (dropBox / canDropBox / setBoxOpen)', () => {
  it('ponto caminhável: salão, porta, calçada e depósito (só desbloqueado); nunca parede ou rua', () => {
    const s = at(10);
    const b = storeBounds(s.expansion);
    expect(canDropBox(s, 3.5, 4.2)).toBe(true); // salão (móveis não são checados)
    expect(canDropBox(s, b.width / 2, b.depth)).toBe(true); // vão da porta
    expect(canDropBox(s, 2, b.depth)).toBe(false); // parede da frente
    expect(canDropBox(s, 0.05, 5)).toBe(false); // encostado na parede lateral
    expect(canDropBox(s, -6, b.depth + 1.5)).toBe(true); // calçada, ao lado da fachada
    expect(canDropBox(s, 3, b.depth + SIDEWALK_DEPTH + 0.5)).toBe(false); // rua
    expect(canDropBox(s, 3, -3)).toBe(false); // depósito trancado
    expect(canDropBox(s, Number.NaN, 2)).toBe(false);
    unlockStorage(s);
    expect(canDropBox(s, 3, -3)).toBe(true);
    expect(canDropBox(s, b.width / 2, 0)).toBe(true); // passagem salão ↔ depósito
    expect(canDropBox(s, 2, 0)).toBe(false); // parede entre salão e depósito
    expect(canDropBox(s, 3, -6.5)).toBe(false);
  });
  it('larga a caixa: carried=false, x/z em metros, rotação normalizada; ponto inválido não muda nada', () => {
    const s = at(3);
    orderBoxes(s, 'feijao', 1);
    const box = s.sidewalk[0]!;
    box.carried = true;
    expect(() => dropBox(s, 0, 2, 50)).toThrow();
    expect(box.carried).toBe(true);
    expect(() => dropBox(s, 3, 2, 2)).toThrow('inexistente');
    dropBox(s, 0, 4.25, 3.5, -Math.PI / 2);
    expect(box).toMatchObject({ carried: false, x: 4.25, z: 3.5 });
    expect(box.rot).toBeCloseTo((3 * Math.PI) / 2, 9);
    dropBox(s, 0, 5, 5);
    expect(box.rot).toBeCloseTo((3 * Math.PI) / 2, 9); // sem rot mantém a anterior
  });
  it('abre/fecha (só o flag); repor não exige caixa aberta; depósito devolve caixa fechada; save preserva', () => {
    const s = at(6);
    orderBoxes(s, 'feijao', 2);
    expect(s.sidewalk[0]!.open).toBe(false);
    setBoxOpen(s, 0, true);
    expect(s.sidewalk[0]!.open).toBe(true);
    expect(s.sidewalk[1]!.open).toBe(false);
    expect(() => setBoxOpen(s, 9, true)).toThrow('inexistente');
    expect(placeUnits(s, 1, 3)).toBe(3); // fechada: a sim não bloqueia (o player exige abrir)
    unlockStorage(s);
    storeBox(s, 1);
    takeFromStorage(s, 'feijao', true);
    expect(s.sidewalk.at(-1)).toMatchObject({ open: false, carried: true });
    checkoutCart(s, [{ kind: 'furniture', id: 'shelf', qty: 1 }]);
    const back = deserialize(serialize(s));
    expect(back).toEqual(s);
    expect(back.sidewalk[0]!.open).toBe(true);
    expect(back.furnitureStock).toEqual([{ type: 'shelf' }]);
  });
  it('assignProduct etiqueta os níveis vazios de móvel novo/esgotado (categoria aceita); níveis com unidades ficam', () => {
    const s = at(6);
    s.licenses.push('bebidas', 'laticinios');
    checkoutCart(s, [{ kind: 'furniture', id: 'fridge', qty: 1 }]);
    const fr = placeFromStock(s, 0, 7, 2, 0);
    expect(fr.productId).toBeUndefined();
    expect(fr.levels).toEqual([{ units: 0 }, { units: 0 }, { units: 0 }, { units: 0 }]); // sem etiqueta
    assignProduct(s, fr.id, 'refri');
    expect(productCapacity(s, 'refri')).toBe(40);
    expect(s.shelf.refri ?? 0).toBe(0); // esgotado: troca livre
    assignProduct(s, fr.id, 'leite');
    expect(productCapacity(s, 'refri')).toBe(0);
    expect(productCapacity(s, 'leite')).toBe(48);
    expect(() => assignProduct(s, fr.id, 'feijao')).toThrow('não cabe');
    const sh = s.furniture.find((f) => f.productId === 'macarrao')!;
    assignProduct(s, sh.id, 'arroz'); // macarrão sem estoque exposto
    expect(productCapacity(s, 'arroz')).toBe(32);
    expect(s.sidewalk).toHaveLength(0);
    // com unidades num nível: só os vazios trocam de etiqueta (nada vai para a calçada)
    expose(s, 'arroz', 5);
    assignProduct(s, sh.id, 'cafe');
    expect(sh.levels!.map((l) => l.productId)).toEqual(['arroz', 'cafe', 'cafe', 'cafe']);
    expect(s.shelf.arroz).toBe(5);
    assignProduct(s, sh.id, undefined);
    expect(sh.levels).toEqual([{ productId: 'arroz', units: 5 }, { units: 0 }, { units: 0 }, { units: 0 }]);
    expect(s.sidewalk).toHaveLength(0);
  });
});

describe('capacidade, melhorias e móvel exigido', () => {
  it('customerCapacity cresce com expansão e com a melhoria capacity', () => {
    const s = at(30);
    expect(customerCapacity(s)).toBe(6);
    buyExpansion(s); // pós-teste 3: a 1ª (10×8 → 12×10) só dá espaço
    expect(customerCapacity(s)).toBe(6);
    buyExpansion(s);
    buyExpansion(s);
    expect(customerCapacity(s)).toBe(10);
    buyUpgrade(s, 'capacity');
    expect(customerCapacity(s)).toBe(10 + UPGRADES.capacity.extra);
    s.expansion = 99;
    expect(customerCapacity(s)).toBe(6 + 2 * 6 + UPGRADES.capacity.extra);
  });
  it('catálogo de melhorias em ordem de nível: pote de gorjeta (2), capacidade (4), carrinho (6)', () => {
    const cat = upgradeCatalog(starterGame());
    expect(cat.map((u) => [u.id, u.minLevel])).toEqual([['tipjar', 2], ['capacity', 4], ['recycler', 5], ['dolly', 6]]);
    for (const u of cat) expect(u.cost).toBeGreaterThan(0);
    expect(() => buyUpgrade(at(1), 'tipjar')).toThrow('Requer nível 2');
    expect(() => buyUpgrade(at(3), 'capacity')).toThrow('Requer nível 4');
  });
  it('pote de gorjeta: mesma venda rende gorjeta 50% maior (teto 12%)', () => {
    const tipFor = (jar: boolean): { total: number; tip: number } => {
      const s = at(5);
      if (jar) buyUpgrade(s, 'tipjar');
      s.shelf.arroz = 10;
      return completeSale(s, [{ productId: 'arroz', qty: 10 }], 1, 5);
    };
    const a = tipFor(false);
    const b = tipFor(true);
    expect(b.total).toBe(a.total);
    expect(b.tip).toBeGreaterThan(a.tip);
    expect(Math.abs(b.tip - a.tip * 1.5)).toBeLessThanOrEqual(5);
    expect(b.tip).toBeLessThanOrEqual(b.total * 0.12);
  });
  it('furnitureForProduct: prateleira, geladeira ou freezer conforme a categoria', () => {
    expect(furnitureForProduct('feijao')).toBe('shelf');
    expect(furnitureForProduct('refri')).toBe('fridge');
    expect(furnitureForProduct('leite')).toBe('fridge');
    expect(furnitureForProduct('carne')).toBe('fridge');
    expect(furnitureForProduct('sorvete')).toBe('freezer');
    expect(furnitureForProduct('banana')).toBe('shelf');
    expect(() => furnitureForProduct('nada')).toThrow();
    for (const p of PRODUCTS) expect(furnitureCatalog().find((f) => f.type === furnitureForProduct(p.id))!.categories).toContain(p.category);
  });
});

describe('clientes felizes e irritados no relatório', () => {
  it('feliz = venda com satisfação >= 3; irritado = venda < 3 ou perdido; relatório fecha as contas', () => {
    const s = at(5);
    s.shelf.feijao = 20;
    completeSale(s, [{ productId: 'feijao', qty: 2 }], 0.5, 3);
    completeSale(s, [{ productId: 'feijao', qty: 1 }], 0.5, 5);
    completeSale(s, [{ productId: 'feijao', qty: 1 }], 0.5, 2.5);
    recordLostCustomer(s, 1);
    recordLostCustomer(s, 2);
    const r = closeDay(s);
    expect([r.served, r.lost, r.happy, r.angry]).toEqual([3, 2, 2, 3]);
    expect(r.happy! + r.angry!).toBe(r.served + r.lost);
    expect(r.income).toBe(r.revenue + r.tips);
    expect(r.expenses).toBe(r.cogs + r.fixed);
    expect(r.income! - r.expenses!).toBe(r.netProfit);
    expect(r.fixed).toBe(r.rent! + r.wages! + (r.interest ?? 0));
    expect(s.ledger).toMatchObject({ served: 0, lost: 0, happy: 0, angry: 0 });
  });
});

describe('economia de início e liberações por nível (Fase 3)', () => {
  it('dinheiro inicial (QA economia: R$ 250): dá para 3 caixas dos produtos mais baratos, não 4', () => {
    const s = starterGame();
    expect(s.money).toBe(START_MONEY);
    expect(START_MONEY).toBe(25000);
    const cheapest = PRODUCTS.filter((p) => s.licenses.includes(p.category)).map((p) => boxCost(s, p.id)).sort((a, b) => a - b);
    expect(cheapest[0]! + 2 * cheapest[1]!).toBeLessThanOrEqual(s.money); // 3 caixas, qualquer combinação dos 2 baratos
    expect(cheapest[0]! * 4).toBeGreaterThan(s.money); // a 4ª não cabe: as 2 prateleiras não enchem no dia 1
    expect(s.furniture.filter((f) => f.type === 'shelf').map((f) => boxCost(s, f.productId!))).toEqual([cheapest[1], cheapest[0]]);
    expect(s.furnitureStock).toEqual([]);
  });
  it('aluguel só a partir do nível 4 ou do dia 6 (QA economia; era 3/4), em rampa de 3 passos; sobe com a expansão', () => {
    const full = RENT.base;
    const third = Math.round(full / 3 / 100) * 100;
    const twoThirds = Math.round((2 * full) / 3 / 100) * 100;
    expect([RENT.startLevel, RENT.startDay]).toEqual([4, 6]);
    expect(rentFor({ expansion: 0, level: 3, day: 5 })).toBe(0);
    expect(rentFor({ expansion: 0, level: 4, day: 1 })).toBe(third);
    expect(rentFor({ expansion: 0, level: 1, day: 6 })).toBe(third);
    expect(rentFor({ expansion: 0, level: 5, day: 2 })).toBe(twoThirds);
    expect(rentFor({ expansion: 0, level: 1, day: 7 })).toBe(twoThirds);
    expect(rentFor({ expansion: 0, level: 6, day: 1 })).toBe(full);
    expect(rentFor({ expansion: 0, level: 1, day: 8 })).toBe(full);
    expect(rentFor({ expansion: 1, level: 9, day: 30 })).toBe(full); // pós-teste 3: a 1ª expansão (10×8 → 12×10) não sobe o aluguel
    expect(rentFor({ expansion: 3, level: 9, day: 30 })).toBe(full + 2 * RENT.perExpansion);
    const s = starterGame();
    const rents: number[] = [];
    for (let d = 0; d < 9; d++) rents.push(closeDay(s).rent!);
    expect(rents).toEqual([0, 0, 0, 0, 0, third, twoThirds, full, full]);
    const e = at(5);
    const r0 = e.rent;
    buyExpansion(e);
    expect(e.rent).toBe(rentFor(e));
    expect(e.rent).toBeGreaterThan(r0);
  });
  it('liberações alinhadas ao original', () => {
    const lic = Object.fromEntries(LICENSES.map((l) => [l.id, l.minLevel]));
    expect(lic.mercearia).toBe(1);
    expect(lic.bebidas).toBe(2); // 2ª licença no nível 2
    expect(furnitureCatalog().find((f) => f.type === 'fridge')!.minLevel).toBeLessThanOrEqual(2); // e o móvel dela
    const s = starterGame();
    expect(employeeCost(s, 'cashier')!.minLevel).toBe(4);
    expect(employeeCost(s, 'janitor')!.minLevel).toBe(6);
    expect(employeeCost(s, 'stocker')!.minLevel).toBe(8);
    expect(storageCost().minLevel).toBe(5);
    const exp: number[] = [];
    for (let i = 0; i < 7; i++) { exp.push(expansionMinLevel(s)!); s.expansion++; }
    expect(exp.slice(0, 5)).toEqual([2, 3, 5, 6, 7]); // pós-teste 3: nova 1ª expansão (10×8 → 12×10) no nível 2
  });
  it('paleta padrão (paredes azul-claro, piso de madeira quente, letreiro vermelho); saves mantêm a escolha', () => {
    const s = starterGame();
    expect(s.decor).toEqual(DEFAULT_DECOR);
    const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [wr, wg, wb] = rgb(s.decor.wallColor);
    expect(wb).toBeGreaterThan(wr!);
    expect(wr! + wg! + wb!).toBeGreaterThan(3 * 170); // claro
    const [fr, fg, fb] = rgb(s.decor.floorColor);
    expect(fr! > fg! && fg! > fb!).toBe(true); // madeira: tons quentes
    const [sr, sg, sb] = rgb(s.decor.signColor);
    expect(sr! > 2 * sg! && sr! > 2 * sb!).toBe(true);
    setDecor(s, { wallColor: '#112233' });
    expect(deserialize(serialize(s)).decor.wallColor).toBe('#112233');
  });
});

describe('save: migração para a Fase 3', () => {
  it('save da Fase 2 (sem furnitureStock/happy/angry/open, aluguel antigo) carrega com defaults e aluguel novo', () => {
    const s = at(9);
    s.expansion = 2;
    s.decor = { wallColor: '#f2e8d5', floorColor: '#c9c4b8', signColor: '#d93a3a' };
    orderBoxes(s, 'feijao', 1);
    const old = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete old.furnitureStock;
    old.rent = 22000;
    old.ledger = { revenue: 100, tips: 0, cogs: 50, purchases: 0, served: 7, lost: 2 };
    for (const b of old.sidewalk as Record<string, unknown>[]) delete b.open;
    const m = deserialize(JSON.stringify(old));
    expect(m.furnitureStock).toEqual([]);
    expect(m.ledger).toMatchObject({ served: 7, lost: 2, happy: 7, angry: 2 });
    expect(m.sidewalk[0]!.open).toBeUndefined(); // ausente = fechada
    expect(m.rent).toBe(rentFor(m));
    expect(m.decor.wallColor).toBe('#f2e8d5'); // escolha do jogador mantida
  });
  it('estoque de montagem corrompido é saneado; round-trip preserva estoque, aluguel e contadores', () => {
    const raw = JSON.parse(serialize(starterGame())) as Record<string, unknown>;
    raw.furnitureStock = [{ type: 'shelf' }, { type: 'sofa' }, null, 5, { type: 'decor', variant: 'tree' }, { type: 'fridge', variant: 7 }];
    const s = deserialize(JSON.stringify(raw));
    expect(s.furnitureStock).toEqual([{ type: 'shelf' }, { type: 'decor', variant: 'tree' }, { type: 'fridge' }]);
    const t = at(4);
    t.ledger.happy = 3;
    t.ledger.angry = 1;
    t.rent = 1234;
    checkoutCart(t, [{ kind: 'furniture', id: 'decor', qty: 1, variant: 'lamp' }]);
    expect(deserialize(serialize(t))).toEqual(t);
  });
  it('vender móvel ainda devolve 50% (o carrinho não mudou as regras antigas)', () => {
    const s = at(10);
    const f = buyFurniture(s, 'shelf', 7, 2, 0);
    expect(sellFurniture(s, f.id)).toBe(furnitureCatalog().find((c) => c.type === 'shelf')!.cost / 2);
  });
});

describe('lixeira de reciclagem', () => {
  it('exige a melhoria, só aceita caixa vazia, credita no caixa e no ledger e entra no rendimento', () => {
    const s = at(5);
    s.sidewalk.push({ productId: 'arroz', units: 0 }, { productId: 'arroz', units: 3 }, { productId: 'arroz', units: 0 });
    expect(() => recycleBox(s, 0)).toThrow();
    expect(UPGRADES.recycler.cost).toBe(40000);
    buyUpgrade(s, 'recycler');
    expect(() => recycleBox(s, 1)).toThrow('Só caixas vazias vão para a reciclagem');
    const m = s.money;
    expect(recycleBox(s, 0)).toBe(RECYCLE_REWARD);
    expect(recycleBox(s, 1)).toBe(RECYCLE_REWARD);
    expect(s.sidewalk.length).toBe(1);
    expect(s.money).toBe(m + 2 * RECYCLE_REWARD);
    expect(s.ledger.recycled).toBe(2);
    const r = closeDay(s);
    expect(r.recycled).toBe(2);
    expect(r.recycleIncome).toBe(2 * RECYCLE_REWARD);
    expect(r.income).toBe(r.revenue + r.tips + 2 * RECYCLE_REWARD);
    expect(s.ledger.recycled).toBe(0);
  });
  it('save sem os campos migra para 0', () => {
    const raw = JSON.parse(serialize(starterGame())) as { ledger: Record<string, unknown> };
    delete raw.ledger.recycled; delete raw.ledger.recycleIncome;
    const s = deserialize(JSON.stringify(raw));
    expect(s.ledger.recycled).toBe(0);
    expect(s.ledger.recycleIncome).toBe(0);
  });
});
