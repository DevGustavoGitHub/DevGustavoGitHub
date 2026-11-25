import { describe, expect, it } from 'vitest';
import { storeBounds, sizeTier } from '../src/core/layout';
import { buyExpansion, canPlace, customerCapacity } from '../src/sim/api';
import { rentFor } from '../src/sim/rent';
import { deserialize, serialize } from '../src/sim/save';
import { newGame } from '../src/sim/state';

describe('salão inicial menor (pós-teste 3)', () => {
  it('jogo novo começa em 10×8 com o layout inicial válido; a 1ª expansão leva a 12×10', () => {
    const s = newGame(3);
    expect(storeBounds(s.expansion)).toEqual({ width: 10, depth: 8 });
    for (const f of s.furniture) expect(canPlace(s, f.type, f.x, f.z, f.rot, f.id), `${f.type}@${f.x},${f.z}`).toBe(true);
    s.level = 3; s.money = 1_000_000;
    buyExpansion(s);
    expect(storeBounds(s.expansion)).toEqual({ width: 12, depth: 10 });
    expect(sizeTier(s.expansion)).toBe(0); // mesmo aluguel/fluxo/capacidade do antigo salão inicial
  });
  it('save antigo (sem sizeVersion) mantém o tamanho: expansão +1, móveis no lugar, mesmo aluguel e capacidade', () => {
    const old = newGame(5);
    old.expansion = 0; // tabela antiga: 0 = 12×10
    const raw = JSON.parse(serialize(old)) as Record<string, unknown>;
    delete raw.sizeVersion;
    // layout antigo do salão 12×10 (balcão em (8,7), mesa em (10,7))
    raw.furniture = (raw.furniture as { type: string; x: number; z: number }[]).map((f) => (f.type === 'counter' ? { ...f, x: 8, z: 7 } : f.type === 'desk' ? { ...f, x: 10, z: 7 } : f));
    const s = deserialize(JSON.stringify(raw));
    expect(s.expansion).toBe(1);
    expect(s.sizeVersion).toBe(2);
    expect(storeBounds(s.expansion)).toEqual({ width: 12, depth: 10 });
    expect(s.furniture.find((f) => f.type === 'counter')).toMatchObject({ x: 8, z: 7 });
    expect(s.furnitureStock).toEqual([]);
    expect(customerCapacity(s)).toBe(6);
    expect(rentFor({ expansion: s.expansion, level: 9, day: 30 })).toBe(rentFor({ expansion: 0, level: 9, day: 30 }));
    // o save novo volta igual (não soma de novo)
    expect(deserialize(serialize(s)).expansion).toBe(1);
  });
});
