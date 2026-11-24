import { describe, expect, it } from 'vitest';
import { extraCashierInfo, hireExtraCashier, hireOrUpgrade } from '../src/sim/api';
import { cashierCount, checkoutCapacity, dailyWages, xpForLevel } from '../src/sim/economy';
import { deserialize, serialize } from '../src/sim/save';
import { newGame, type StoreState } from '../src/sim/state';
import { EMPLOYEE_TABLE } from '../src/sim/tuning';

const mk = (level: number, counters: number): StoreState => {
  const s = newGame(7);
  s.money = 100_000_000; s.level = level; s.xp = xpForLevel(level); s.levelAck = level;
  s.furniture = s.furniture.filter((f) => f.type !== 'counter');
  for (let i = 0; i < counters; i++) s.furniture.push({ id: 900 + i, type: 'counter', x: 2 + i * 4, z: 2, rot: 0 } as never);
  hireOrUpgrade(s, 'cashier');
  return s;
};

describe('vários caixas', () => {
  it('exige nível e balcão por caixa', () => {
    const s = mk(8, 4);
    expect(extraCashierInfo(s)).toMatchObject({ count: 1, max: 4, nextMinLevel: 9, blockedReason: 'Nível 9' });
    expect(() => hireExtraCashier(s)).toThrow('Requer nível 9');
    s.level = 9;
    const m = s.money;
    const info = extraCashierInfo(s);
    expect(info.blockedReason).toBeUndefined();
    hireExtraCashier(s);
    expect(cashierCount(s)).toBe(2);
    expect(s.money).toBe(m - info.cost!);
    expect(extraCashierInfo(s).nextMinLevel).toBe(14);
    s.level = 14; hireExtraCashier(s); s.level = 19; hireExtraCashier(s);
    expect(cashierCount(s)).toBe(4);
    expect(extraCashierInfo(s)).toMatchObject({ cost: null, blockedReason: 'Máximo de caixas' });
    expect(() => hireExtraCashier(s)).toThrow();
  });
  it('limita por balcões e dinheiro', () => {
    const s = mk(20, 1);
    expect(extraCashierInfo(s).blockedReason).toBe('Monte outro balcão');
    expect(() => hireExtraCashier(s)).toThrow(/balcão/);
    s.furniture.push({ id: 950, type: 'counter', x: 9, z: 9, rot: 0 } as never);
    s.money = 0;
    expect(() => hireExtraCashier(s)).toThrow('Dinheiro insuficiente');
  });
  it('salário e capacidade somam por caixa', () => {
    const s = mk(20, 3);
    const w1 = dailyWages(s), c1 = checkoutCapacity(s);
    hireExtraCashier(s);
    expect(dailyWages(s) - w1).toBe(EMPLOYEE_TABLE.cashier.wage[0]);
    expect(checkoutCapacity(s)).toBeGreaterThan(c1);
  });
  it('migração de save', () => {
    const s = mk(20, 3);
    expect(cashierCount(deserialize(serialize(s)))).toBe(1);
    hireExtraCashier(s);
    expect(deserialize(serialize(s)).employees.cashierCount).toBe(2);
    const raw = JSON.parse(serialize(s)); delete raw.employees.cashierCount;
    expect(cashierCount(deserialize(JSON.stringify(raw)))).toBe(1);
    raw.employees.cashier = 0; raw.employees.cashierCount = 3;
    expect(cashierCount(deserialize(JSON.stringify(raw)))).toBe(0);
  });
});
