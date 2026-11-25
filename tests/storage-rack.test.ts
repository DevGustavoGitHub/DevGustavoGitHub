import { describe, expect, it } from 'vitest';
import { orderBoxes, stashBox, storageUsed, takeStorageBox } from '../src/sim/api';
import { productById } from '../src/sim/catalog';
import { newGame } from '../src/sim/state';

const rich = () => { const s = newGame(9); s.money = 10_000_000; s.level = 10; s.storageUnlocked = true; return s; };
const carry = (s: ReturnType<typeof newGame>, pid: string, units: number): number => { s.sidewalk.push({ productId: pid, units, open: true, carried: true }); return s.sidewalk.length - 1; };

describe('depósito pela estante (pós-teste 3)', () => {
  it('guardar completa a caixa incompleta; se couber tudo, a caixa da mão fica vazia na mão', () => {
    const s = rich();
    const bs = productById('feijao').boxSize; // 12
    s.storage.feijao = bs + 5; // 1 cheia + 1 incompleta (5)
    const i = carry(s, 'feijao', 7);
    const r = stashBox(s, i);
    expect(r).toEqual({ stored: 7, leftEmpty: true });
    expect(s.storage.feijao).toBe(2 * bs);
    expect(s.sidewalk[i]).toMatchObject({ productId: 'feijao', units: 0, carried: true });
  });
  it('se sobrar, a caixa inteira entra (o resto vira a nova incompleta) e sai da mão', () => {
    const s = rich();
    const bs = productById('feijao').boxSize;
    s.storage.feijao = bs + 5;
    const n0 = s.sidewalk.length;
    const i = carry(s, 'feijao', bs);
    const r = stashBox(s, i);
    expect(r).toEqual({ stored: bs, leftEmpty: false });
    expect(s.storage.feijao).toBe(2 * bs + 5);
    expect(s.sidewalk.length).toBe(n0);
  });
  it('produto sem caixa incompleta: guarda a caixa inteira', () => {
    const s = rich();
    const i = carry(s, 'arroz', 3);
    expect(stashBox(s, i).leftEmpty).toBe(false);
    expect(s.storage.arroz).toBe(3);
  });
  it('retirar escolhe o produto e traz a caixa da frente (incompleta primeiro), fechada', () => {
    const s = rich();
    const bs = productById('cafe').boxSize;
    s.storage.cafe = 2 * bs + 4; s.storage.arroz = 6;
    expect(takeStorageBox(s, 'cafe', true)).toBe(4);
    expect(s.sidewalk[s.sidewalk.length - 1]).toMatchObject({ productId: 'cafe', units: 4, open: false, carried: true });
    expect(takeStorageBox(s, 'cafe', true)).toBe(bs);
    expect(s.storage.cafe).toBe(bs);
    expect(s.storage.arroz).toBe(6);
    expect(() => takeStorageBox(s, 'leite', true)).toThrow('Sem estoque');
  });
  it('completar a incompleta não ocupa caixa nova do depósito', () => {
    const s = rich();
    orderBoxes(s, 'feijao', 1);
    const bs = productById('feijao').boxSize;
    s.storage.feijao = 5;
    const used = storageUsed(s);
    stashBox(s, carry(s, 'feijao', bs - 5));
    expect(storageUsed(s)).toBe(used);
  });
});
