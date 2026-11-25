import { describe, expect, it } from 'vitest';
import {
  acceptsPrice, buyFurniture, canStockLevel, checkoutCart, furnitureCatalog, furnitureLevels, levelCapacity, locateProduct,
  orderBoxes, placeFromStock, placeUnits, placeUnitsInLevel, priceInfo, pullUnitsFromLevel, sellFurniture, setBoxOpen,
  storeFurniture, suggestedPrice, takeFromLevel, takeFromShelf, unlockStorage,
} from '../src/sim/api';
import { PRODUCTS } from '../src/sim/catalog';
import { buyProbability } from '../src/sim/demand';
import { unitsOwned, xpForLevel } from '../src/sim/economy';
import { makeRng } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { type Furniture, type StoreState } from '../src/sim/state';
import { levelUnits, starterGame } from './helpers';
import { canPlace, moveFurniture, runAutoOrders, setAutoOrder } from '../src/sim/api';
import { load, save, SAVE_KEY, SAVE_RECOVERED_KEY, type KV } from '../src/sim/save';
import { CLOSE_MIN, OPEN_MIN } from '../src/sim/state';

const rich = (level = 12): StoreState => {
  const s = starterGame(4);
  s.money = 100_000_000;
  s.level = level;
  s.xp = xpForLevel(level);
  s.levelAck = level;
  return s;
};
const shelfOf = (s: StoreState, pid: string): Furniture => s.furniture.find((f) => f.type === 'shelf' && f.productId === pid)!;
const units = (s: StoreState, id: number): [string | undefined, number][] => furnitureLevels(s, id).map((l) => [l.productId, l.units]);

/** Invariantes da Fase 4: shelf/slots derivados batem com os níveis e o custo médio cobre exatamente o que se possui. */
function checkDerived(s: StoreState): void {
  for (const p of PRODUCTS) {
    expect(s.shelf[p.id]).toBe(levelUnits(s, p.id));
    expect(s.slots[p.id]).toBe(s.furniture.reduce((a, f) => a + (f.levels ?? []).filter((l) => l.productId === p.id).length, 0));
    expect(s.costBasis[p.id]?.units ?? 0).toBe(unitsOwned(s, p.id));
  }
}

describe('Fase 4 — modelo de níveis', () => {
  it('níveis por tipo (prateleira 4, geladeira 4, freezer 3); layout inicial etiquetado; móveis novos sem etiqueta', () => {
    const slots = Object.fromEntries(furnitureCatalog().map((c) => [c.type, c.slots]));
    expect(slots).toMatchObject({ shelf: 4, fridge: 4, freezer: 3 });
    const s = rich();
    const fe = shelfOf(s, 'feijao');
    expect(furnitureLevels(s, fe.id)).toEqual([0, 1, 2, 3].map(() => ({ productId: 'feijao', units: 0 })));
    expect(units(s, shelfOf(s, 'macarrao').id).every(([p, n]) => p === 'macarrao' && n === 0)).toBe(true);
    const counter = s.furniture.find((f) => f.type === 'counter')!;
    expect(counter.levels).toBeUndefined();
    expect(furnitureLevels(s, counter.id)).toEqual([]);
    furnitureLevels(s, fe.id)[0]!.units = 99; // cópia
    expect(fe.levels![0]!.units).toBe(0);
    expect(levelCapacity(s, fe.id, 0)).toBe(12);
    expect(levelCapacity(s, fe.id, 0, 'arroz')).toBe(8);
    expect(levelCapacity(s, fe.id, 0, 'refri')).toBe(0); // bebida não cabe em prateleira
    expect(() => levelCapacity(s, fe.id, 4)).toThrow('Nível inexistente');
    const plain = buyFurniture(s, 'shelf', 7, 2, 0);
    expect(plain.levels).toEqual([{ units: 0 }, { units: 0 }, { units: 0 }, { units: 0 }]);
    expect(levelCapacity(s, plain.id, 2)).toBe(0); // sem etiqueta e sem produto informado
    checkoutCart(s, [{ kind: 'furniture', id: 'freezer', qty: 1 }]);
    const fz = placeFromStock(s, 0, 1, 5, 0);
    expect(fz.levels).toEqual([{ units: 0 }, { units: 0 }, { units: 0 }]);
    expect(s.slots.sorvete).toBe(0);
    checkDerived(s);
  });

  it('BUG do teste no celular: feijão na prateleira do macarrão não duplica, não trava e dá para reorganizar', () => {
    const s = starterGame(1);
    s.money = 100_000;
    const fe = shelfOf(s, 'feijao');
    const mac = shelfOf(s, 'macarrao');
    orderBoxes(s, 'feijao', 1); // caixa 0: 12 un.
    orderBoxes(s, 'macarrao', 1); // caixa 1: 20 un.
    setBoxOpen(s, 0, true);
    setBoxOpen(s, 1, true);
    expect(placeUnitsInLevel(s, 1, mac.id, 0, 99)).toBe(16); // nível do macarrão cabe 16
    // o jogador pega o feijão e repõe na prateleira do macarrão
    expect(canStockLevel(s, 0, mac.id, 0)).toBe('other-product'); // nível com macarrão: recusado
    expect(() => placeUnitsInLevel(s, 0, mac.id, 0, 1)).toThrow('outro produto');
    expect(canStockLevel(s, 0, mac.id, 1)).toBe('ok'); // nível vazio (etiqueta de macarrão, 0 un.) aceita feijão
    for (let i = 0; i < 12; i++) expect(placeUnitsInLevel(s, 0, mac.id, 1, 1)).toBe(1); // segurar Repor: 1 un. por vez
    expect(placeUnitsInLevel(s, 0, mac.id, 1, 1)).toBe(0);
    // cada nível guarda o seu produto; nada aparece "duplicado" na prateleira do feijão
    expect(units(s, mac.id)).toEqual([['macarrao', 16], ['feijao', 12], ['macarrao', 0], ['macarrao', 0]]);
    expect(units(s, fe.id).every(([p, n]) => p === 'feijao' && n === 0)).toBe(true);
    expect(s.shelf.feijao).toBe(12); // antes: o estoque somado aparecia nas duas prateleiras
    expect(s.shelf.macarrao).toBe(16);
    expect(locateProduct(s, 'feijao').filter((x) => x.units > 0)).toEqual([{ furnitureId: mac.id, level: 1, units: 12 }]);
    expect(locateProduct(s, 'macarrao').map((x) => x.furnitureId)).toEqual([mac.id, mac.id, mac.id]);
    checkDerived(s);
    // "não consegui mexer mais": com a caixa vazia, Retirar puxa o feijão de volta para a caixa
    expect(canStockLevel(s, 0, mac.id, 1)).toBe('box-empty');
    expect(pullUnitsFromLevel(s, 0, mac.id, 1, 5)).toBe(5);
    expect(pullUnitsFromLevel(s, 0, mac.id, 1, 99)).toBe(7);
    expect(pullUnitsFromLevel(s, 0, mac.id, 1, 1)).toBe(0); // nível vazio
    expect(s.sidewalk[0]).toMatchObject({ productId: 'feijao', units: 12 });
    expect(furnitureLevels(s, mac.id)[1]).toEqual({ productId: 'feijao', units: 0 }); // etiqueta fica ("--")
    checkDerived(s);
    // reorganiza: feijão na prateleira dele; o resto do macarrão no nível liberado (etiqueta de feijão com 0 un.)
    expect(placeUnitsInLevel(s, 0, fe.id, 0, 99)).toBe(12);
    expect(canStockLevel(s, 1, mac.id, 1)).toBe('ok');
    expect(placeUnitsInLevel(s, 1, mac.id, 1, 99)).toBe(4);
    expect(units(s, mac.id)).toEqual([['macarrao', 16], ['macarrao', 4], ['macarrao', 0], ['macarrao', 0]]);
    expect(units(s, fe.id)[0]).toEqual(['feijao', 12]);
    expect(s.shelf.feijao).toBe(12);
    expect(s.shelf.macarrao).toBe(20);
    checkDerived(s);
    // a caixa vazia de macarrão pode virar caixa de feijão e voltar (custo médio não muda: mesmo produto)
    const avg = s.costBasis.feijao!.avg;
    expect(pullUnitsFromLevel(s, 1, fe.id, 0, 3)).toBe(3);
    expect(s.sidewalk[1]).toMatchObject({ productId: 'feijao', units: 3 });
    expect(placeUnitsInLevel(s, 1, fe.id, 0, 99)).toBe(3);
    expect(s.costBasis.feijao!.avg).toBe(avg);
    checkDerived(s);
  });

  it('canStockLevel: precedência box-empty → not-accepted → other-product → full → box-closed → ok', () => {
    const s = rich();
    s.licenses.push('bebidas');
    const fe = shelfOf(s, 'feijao');
    const counter = s.furniture.find((f) => f.type === 'counter')!;
    orderBoxes(s, 'refri', 1); // 0
    orderBoxes(s, 'feijao', 2); // 1, 2
    expect(canStockLevel(s, 0, fe.id, 0)).toBe('not-accepted');
    expect(canStockLevel(s, 1, counter.id, 0)).toBe('not-accepted');
    expect(canStockLevel(s, 1, fe.id, 0)).toBe('box-closed'); // cabe, mas a caixa está fechada
    setBoxOpen(s, 1, true);
    expect(canStockLevel(s, 1, fe.id, 0)).toBe('ok');
    expect(placeUnitsInLevel(s, 2, fe.id, 0, 99)).toBe(12); // a sim não exige caixa aberta (o player exige)
    expect(canStockLevel(s, 1, fe.id, 0)).toBe('full');
    expect(placeUnitsInLevel(s, 1, fe.id, 0, 5)).toBe(0); // cheio
    expect(canStockLevel(s, 2, fe.id, 0)).toBe('box-empty');
    expect(canStockLevel(s, 2, counter.id, 0)).toBe('box-empty');
    expect(() => placeUnitsInLevel(s, 0, fe.id, 1, 1)).toThrow('não cabe');
    expect(() => placeUnitsInLevel(s, 1, counter.id, 0, 1)).toThrow('não expõe');
    expect(() => placeUnitsInLevel(s, 1, fe.id, 1, 0)).toThrow('Quantidade inválida');
    expect(() => canStockLevel(s, 9, fe.id, 0)).toThrow('inexistente');
    expect(() => canStockLevel(s, 1, fe.id, 7)).toThrow('Nível inexistente');
    expect(() => canStockLevel(s, 1, 999, 0)).toThrow('inexistente');
    // caixa com unidades de outro produto não puxa do nível
    expect(() => pullUnitsFromLevel(s, 0, fe.id, 0, 1)).toThrow('outro produto');
    // caixa do mesmo produto recebe até boxSize
    expect(placeUnitsInLevel(s, 1, fe.id, 1, 7)).toBe(7); // caixa 1 fica com 5
    expect(pullUnitsFromLevel(s, 1, fe.id, 0, 99)).toBe(7); // 5 + 7 = 12 (boxSize)
    expect(s.sidewalk[1]!.units).toBe(12);
    checkDerived(s);
  });

  it('placeUnits (repositor) enche os níveis do produto, depois níveis livres compatíveis; nunca níveis de outro produto', () => {
    const s = rich();
    s.licenses.push('bebidas');
    const plain = buyFurniture(s, 'shelf', 7, 2, 0);
    const fr = buyFurniture(s, 'fridge', 1, 5, 0);
    orderBoxes(s, 'arroz', 3); // 3 × 6 un.; nível de arroz cabe 8
    for (let i = 0; i < 3; i++) expect(placeUnits(s, i, 99)).toBe(6);
    expect(units(s, plain.id)).toEqual([['arroz', 8], ['arroz', 8], ['arroz', 2], [undefined, 0]]);
    expect(fr.levels!.every((l) => l.productId === undefined)).toBe(true); // geladeira não aceita mercearia
    expect(levelUnits(s, 'arroz')).toBe(18);
    expect((s.shelf.feijao ?? 0) + (s.shelf.macarrao ?? 0)).toBe(0); // níveis etiquetados (vazios) de outros produtos ficam
    orderBoxes(s, 'refri', 1);
    expect(placeUnits(s, 3, 99)).toBe(6); // geladeira livre recebe a bebida
    expect(units(s, fr.id)[0]).toEqual(['refri', 6]);
    orderBoxes(s, 'agua', 4);
    expect(placeUnits(s, 4, 99)).toBe(12);
    s.sidewalk.splice(4, 1); // (descartada)
    // sem nível do produto e sem nível livre que aceite a categoria
    sellFurniture(s, fr.id);
    expect(() => placeUnits(s, 4, 1)).toThrow('Nenhuma prateleira');
    expect(takeFromShelf(s, 'arroz', 3)).toBe(3); // do nível mais cheio
    expect(units(s, plain.id).slice(0, 3)).toEqual([['arroz', 5], ['arroz', 8], ['arroz', 2]]);
    expect(takeFromLevel(s, plain.id, 2, 5)).toBe(2);
    expect(takeFromLevel(s, plain.id, 2, 1)).toBe(0);
    expect(takeFromLevel(s, 999, 0, 1)).toBe(0); // móvel vendido no caminho: 0, sem lançar
    expect(takeFromLevel(s, plain.id, 0, 1.5)).toBe(0);
    expect(s.shelf.arroz).toBe(13);
  });

  it('vender/desmontar devolve as unidades de cada nível (calçada; depósito se couber)', () => {
    const s = rich();
    const sh = buyFurniture(s, 'shelf', 7, 2, 0);
    orderBoxes(s, 'feijao', 1);
    orderBoxes(s, 'arroz', 1);
    placeUnitsInLevel(s, 0, sh.id, 0, 12);
    placeUnitsInLevel(s, 1, sh.id, 3, 6);
    s.sidewalk.splice(0, 2);
    storeFurniture(s, sh.id);
    expect(s.sidewalk).toEqual([{ productId: 'feijao', units: 12, open: false }, { productId: 'arroz', units: 6, open: false }]);
    expect((s.shelf.feijao ?? 0) + (s.shelf.arroz ?? 0)).toBe(0);
    unlockStorage(s);
    const again = placeFromStock(s, 0, 7, 2, 0);
    s.sidewalk.forEach((_, i) => placeUnitsInLevel(s, i, again.id, i, 99));
    s.sidewalk.length = 0;
    sellFurniture(s, again.id);
    expect(s.storage).toMatchObject({ feijao: 12, arroz: 6 });
    checkDerived(s);
  });

  it('migração: save da Fase 3 (um produto por móvel + estoque somado) distribui o estoque pelos níveis', () => {
    const raw = JSON.parse(serialize(starterGame(6))) as Record<string, unknown>;
    const furniture = raw.furniture as Record<string, unknown>[];
    for (const f of furniture) delete f.levels;
    furniture.push({ id: 4, type: 'shelf', x: 7, z: 2, rot: 0, productId: 'feijao' });
    furniture.push({ id: 5, type: 'fridge', x: 1, z: 5, rot: 0, productId: 'refri' });
    furniture.push({ id: 6, type: 'shelf', x: 4, z: 5, rot: 0 });
    raw.nextFurnitureId = 7;
    raw.licenses = ['mercearia', 'bebidas'];
    raw.shelf = { feijao: 60, macarrao: 70, refri: 3, inexistente: 5 };
    raw.slots = { feijao: 4, macarrao: 2, refri: 3 };
    const s = deserialize(JSON.stringify(raw));
    const byId = (id: number): [string | undefined, number][] => units(s, id);
    expect(byId(2)).toEqual([['feijao', 12], ['feijao', 12], ['feijao', 12], ['feijao', 12]]);
    expect(byId(4)).toEqual([['feijao', 12], ['feijao', 0], ['feijao', 0], ['feijao', 0]]);
    expect(byId(3)).toEqual([['macarrao', 16], ['macarrao', 16], ['macarrao', 16], ['macarrao', 16]]);
    expect(byId(5)).toEqual([['refri', 3], ['refri', 0], ['refri', 0], ['refri', 0]]);
    expect(byId(6)).toEqual([[undefined, 0], [undefined, 0], [undefined, 0], [undefined, 0]]);
    expect(s.sidewalk).toEqual([{ productId: 'macarrao', units: 6, open: false }]); // 70 > 64: sobra vai em caixa
    expect(s.shelf).toMatchObject({ feijao: 60, macarrao: 64, refri: 3 });
    expect(s.shelf.inexistente).toBeUndefined();
    expect(s.slots).toMatchObject({ feijao: 8, macarrao: 4, refri: 4 });
    expect(s.furniture.find((f) => f.id === 6)!.productId).toBeUndefined();
    expect(deserialize(serialize(s))).toEqual(s); // save da Fase 4 volta igual
  });

  it('save com níveis inválidos é saneado (etiqueta recusada/desconhecida, excesso, tamanho errado)', () => {
    const raw = JSON.parse(serialize(starterGame(6))) as Record<string, unknown>;
    const fe = (raw.furniture as Record<string, unknown>[]).find((f) => f.productId === 'feijao')!;
    fe.levels = [{ productId: 'refri', units: 5 }, { productId: 'feijao', units: 30 }, null, { productId: 'xyz', units: 2 }, { units: 4 }];
    const s = deserialize(JSON.stringify(raw));
    expect(units(s, 2)).toEqual([[undefined, 0], ['feijao', 12], [undefined, 0], [undefined, 0]]);
    expect(s.sidewalk.map((b) => [b.productId, b.units])).toEqual([['refri', 5], ['feijao', 12], ['feijao', 6]]);
    expect(s.shelf.feijao).toBe(12);
  });
});

describe('Fase 4 — preço sugerido e curva de aceitação', () => {
  it('preço sugerido = média de mercado (×1,00)', () => {
    const s = starterGame(3);
    s.market.arroz = 1.3;
    s.market.cafe = 0.8;
    for (const p of PRODUCTS) expect(suggestedPrice(s, p.id)).toBe(priceInfo(s, p.id).market);
  });
  it('curva mais tolerante: ~95% no mercado, 85–90% em +10%, 50% em +30%, quase zero acima de +60%', () => {
    expect(buyProbability(1.0)).toBeGreaterThan(0.94);
    expect(buyProbability(1.0)).toBeLessThan(0.97);
    expect(buyProbability(1.1)).toBeGreaterThanOrEqual(0.85);
    expect(buyProbability(1.1)).toBeLessThanOrEqual(0.9);
    expect(buyProbability(1.3)).toBeCloseTo(0.5, 2);
    expect(buyProbability(1.6)).toBeLessThan(0.03);
    expect(buyProbability(2)).toBeLessThan(0.001);
    expect(buyProbability(0.8)).toBeGreaterThan(0.98);
    const s = starterGame(3);
    const r = makeRng(5);
    s.prices.arroz = suggestedPrice(s, 'arroz');
    let ok = 0;
    for (let i = 0; i < 4000; i++) if (acceptsPrice(s, 'arroz', r).ok) ok++;
    expect(ok / 4000).toBeGreaterThan(0.93); // cliente quase sempre aceita o preço sugerido
  });
});

describe('Fase 4 — correções do QA (save, relógio, cestas, operador do caixa, pedido automático)', () => {
  const kvOf = (raw?: string): KV & { data: Record<string, string> } => {
    const data: Record<string, string> = raw === undefined ? {} : { [SAVE_KEY]: raw };
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  };
  it('hora/fase do dia persistem; ausente ou inválida = preparação às 08:00', () => {
    const s = starterGame(2);
    expect(s.clock).toEqual({ minute: OPEN_MIN, phase: 'prep' });
    s.clock = { minute: 700.5, phase: 'open' };
    expect(deserialize(serialize(s)).clock).toEqual({ minute: 700.5, phase: 'open' });
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.clock;
    expect(deserialize(JSON.stringify(raw)).clock).toEqual({ minute: OPEN_MIN, phase: 'prep' });
    raw.clock = { minute: 99999, phase: 'closing' };
    expect(deserialize(JSON.stringify(raw)).clock).toEqual({ minute: CLOSE_MIN, phase: 'closing' });
    raw.clock = { minute: null, phase: 'dormindo' };
    expect(deserialize(JSON.stringify(raw)).clock).toEqual({ minute: OPEN_MIN, phase: 'prep' });
  });
  it('itens nas cestas dos clientes (npcHeld) voltam à exposição ao carregar, sem perder unidades nem o custo médio', () => {
    const s = rich();
    const fe = shelfOf(s, 'feijao');
    orderBoxes(s, 'feijao', 1);
    placeUnitsInLevel(s, 0, fe.id, 0, 12);
    expect(takeFromLevel(s, fe.id, 0, 5)).toBe(5); // cliente com 5 na cesta
    s.npcHeld = [{ productId: 'feijao', qty: 5 }, { productId: 'xyz', qty: 2 }, { productId: 'macarrao', qty: -1 }];
    expect(s.costBasis.feijao!.units).toBe(12); // ainda não vendidas
    const t = deserialize(serialize(s));
    expect(t.npcHeld).toEqual([]);
    expect(t.shelf.feijao).toBe(12);
    expect(t.costBasis.feijao).toEqual(s.costBasis.feijao);
    checkDerived(t);
    const u = deserialize(serialize(starterGame(2)));
    expect(u.npcHeld).toBeUndefined();
  });
  it('o tile do operador de cada balcão (cadeira do caixa) fica livre e alcançável: comprar, montar, mover', () => {
    const s = rich();
    expect(canPlace(s, 'shelf', 8, 6, 0)).toBe(false); // (9,6) = operador do balcão (8,7)
    expect(canPlace(s, 'decor', 9, 6, 0)).toBe(false);
    expect(canPlace(s, 'shelf', 6, 5, 0)).toBe(true);
    expect(() => buyFurniture(s, 'shelf', 8, 6, 0)).toThrow('Posição inválida');
    const sh = buyFurniture(s, 'shelf', 6, 5, 0);
    expect(() => moveFurniture(s, sh.id, 9, 6, 90)).toThrow('Posição inválida');
    checkoutCart(s, [{ kind: 'furniture', id: 'decor', qty: 1, variant: 'plant' }]);
    expect(() => placeFromStock(s, 0, 9, 6, 0)).toThrow('Posição inválida');
    // balcão novo: operador dentro do salão e livre; rot 180 → operador em (x, z+2)
    expect(canPlace(s, 'counter', 1, 0, 0)).toBe(false); // operador cairia em z = −1 (fora do salão)
    expect(canPlace(s, 'counter', 1, 6, 0)).toBe(true);
    expect(canPlace(s, 'counter', 0, 3, 180)).toBe(true); // operador (0,5) livre
    buyFurniture(s, 'decor', 0, 5, 0, 'plant');
    expect(canPlace(s, 'counter', 0, 3, 180)).toBe(false); // operador (0,5) ocupado pela planta
    // fechar o último caminho até a cadeira é recusado: (9,6) cercado por (8,6), (10,6), (9,5) e o balcão
    buyFurniture(s, 'decor', 8, 6, 0, 'plant');
    buyFurniture(s, 'decor', 10, 6, 0, 'plant');
    expect(canPlace(s, 'decor', 9, 5, 0)).toBe(false);
    expect(canPlace(s, 'decor', 9, 4, 0)).toBe(true);
  });
  it('save ilegível: backup do texto original + aviso para a UI (uma vez por conteúdo); depois o autosave não apaga o original', () => {
    const kv = kvOf('{"version":1,"money":');
    expect(load(kv)).toBeNull();
    const rec = JSON.parse(kv.data[SAVE_RECOVERED_KEY]!) as { key: string; at: number; error: string };
    expect(rec.key.startsWith(`${SAVE_KEY}:corrupt-`)).toBe(true);
    expect(kv.data[rec.key]).toBe('{"version":1,"money":');
    expect(load(kv)).toBeNull();
    expect(Object.keys(kv.data).filter((k) => k.includes(':corrupt-'))).toHaveLength(1); // não duplica
    save(kv, starterGame(1));
    expect(kv.data[rec.key]).toBe('{"version":1,"money":');
    expect(load(kvOf())).toBeNull(); // sem save: nada de backup
  });
  it('pedido automático informa por que não comprou (calçada cheia / sem dinheiro) sem mudar o array de compras', () => {
    const s = rich();
    setAutoOrder(s, 'arroz', { minUnits: 50, boxes: 2 });
    setAutoOrder(s, 'feijao', { minUnits: 50, boxes: 1 });
    for (let i = 0; i < 47; i++) s.sidewalk.push({ productId: 'macarrao', units: 0 });
    s.costBasis.macarrao = { units: 0, avg: 350 };
    const r = runAutoOrders(s); // 47 + 2 > 48: arroz não cabe; feijão (1 cx) cabe
    expect(r.map((x) => x.productId)).toEqual(['feijao']);
    expect(r.skipped).toEqual([expect.objectContaining({ productId: 'arroz', boxes: 2, reason: 'sidewalk-full' })]);
    s.sidewalk.length = 0;
    s.money = 100;
    const r2 = runAutoOrders(s);
    expect(r2).toEqual([]); // `skipped` não é enumerável: comparações antigas continuam valendo
    expect(r2.skipped.map((x) => x.reason)).toEqual(['no-money', 'no-money']);
    expect(r2.skipped[0]!.message).toContain('Arroz');
  });
});
