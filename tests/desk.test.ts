import { describe, expect, it } from 'vitest';
import * as api from '../src/sim/api';
import { deserialize, serialize } from '../src/sim/save';
import { newGame } from '../src/sim/state';

const desks = (s: ReturnType<typeof newGame>) => s.furniture.filter((f) => f.type === 'desk');

describe('mesa do computador (móvel desk)', () => {
  it('jogo novo tem exatamente uma mesa, colada à ponta do operador do balcão', () => {
    const s = newGame(3);
    expect(desks(s)).toHaveLength(1);
    const c = s.furniture.find((f) => f.type === 'counter')!;
    const d = desks(s)[0]!;
    expect({ x: d.x, z: d.z, rot: d.rot }).toEqual({ x: c.x + 2, z: c.z, rot: c.rot });
    expect(s.nextFurnitureId).toBeGreaterThan(d.id);
  });

  it('não se compra, não se vende nem se guarda; só se move', () => {
    const s = newGame(3);
    const d = desks(s)[0]!;
    expect(api.furnitureCatalog().some((c) => (c.type as string) === 'desk')).toBe(false);
    expect(() => api.sellFurniture(s, d.id)).toThrow(/mesa do computador/);
    expect(() => api.storeFurniture(s, d.id)).toThrow(/mesa do computador/);
    expect(desks(s)).toHaveLength(1);
    expect(s.furnitureStock).toEqual([]);
    expect(api.canPlace(s, 'desk', 0, 5, 90, d.id)).toBe(true);
    api.moveFurniture(s, d.id, 0, 5, 90);
    expect({ x: d.x, z: d.z, rot: d.rot }).toEqual({ x: 0, z: 5, rot: 90 });
    // não sobrepõe outros móveis nem fica fora do salão
    const sh = s.furniture.find((f) => f.type === 'shelf')!;
    expect(api.canPlace(s, 'desk', sh.x, sh.z, 0, d.id)).toBe(false);
    expect(api.canPlace(s, 'desk', 0, -1, 0, d.id)).toBe(false);
    expect(() => api.moveFurniture(s, d.id, sh.x, sh.z, 0)).toThrow();
  });

  it('a mesa ocupa o tile: nenhum móvel pode ser posto em cima dela', () => {
    const s = newGame(3);
    const d = desks(s)[0]!;
    s.level = 10; s.money = 10_000_000;
    expect(api.canPlace(s, 'decor', d.x, d.z, 0)).toBe(false);
    expect(() => api.buyFurniture(s, 'decor', d.x, d.z, 0, 'plant')).toThrow();
  });

  it('save antigo (sem mesa) ganha a mesa ao carregar; save com 2 mesas fica com 1; round-trip estável', () => {
    const s = newGame(4);
    const raw = JSON.parse(serialize(s)) as { furniture: { type: string; id: number; x: number; z: number; rot: number }[] };
    raw.furniture = raw.furniture.filter((f) => f.type !== 'desk');
    const a = deserialize(JSON.stringify(raw));
    expect(desks(a)).toHaveLength(1);
    expect(new Set(a.furniture.map((f) => f.id)).size).toBe(a.furniture.length);
    const two = JSON.parse(serialize(s)) as typeof raw;
    two.furniture.push({ id: 99, type: 'desk', x: 0, z: 5, rot: 90 });
    const b = deserialize(JSON.stringify(two));
    expect(desks(b)).toHaveLength(1);
    expect(b.furnitureStock).toEqual([]);
    expect(deserialize(serialize(b))).toEqual(b);
  });

  it('falência recomeça com a mesa colada ao balcão inicial', () => {
    const s = newGame(5);
    api.moveFurniture(s, desks(s)[0]!.id, 0, 5, 90);
    api.restartAfterBankruptcy(s);
    expect(desks(s)).toHaveLength(1);
    const c = s.furniture.find((f) => f.type === 'counter')!;
    expect(desks(s)[0]!.x).toBe(c.x + 2);
  });
});
