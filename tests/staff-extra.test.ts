import { describe, expect, it } from 'vitest';
import { extraStaffInfo, hireExtraStaff, hireOrUpgrade } from '../src/sim/api';
import { dailyWages, staffCount } from '../src/sim/economy';
import { deserialize, serialize } from '../src/sim/save';
import { EMPLOYEE_TABLE, EXTRA_STAFF } from '../src/sim/tuning';
import { newGame } from '../src/sim/state';

describe('2º repositor e 2º faxineiro (pós-teste 3)', () => {
  it('liberados por nível, custam 2× a contratação e pagam salário em dobro; save guarda', () => {
    const s = newGame(1); s.money = 10_000_000; s.level = 9;
    hireOrUpgrade(s, 'janitor');
    expect(extraStaffInfo(s, 'janitor').blockedReason).toBe(`Nível ${EXTRA_STAFF.janitor.minLevel}`);
    expect(() => hireExtraStaff(s, 'janitor')).toThrow('Requer nível');
    s.level = 12;
    hireOrUpgrade(s, 'stocker');
    const m0 = s.money, w0 = dailyWages(s);
    hireExtraStaff(s, 'janitor');
    hireExtraStaff(s, 'stocker');
    expect(m0 - s.money).toBe(2 * EMPLOYEE_TABLE.janitor.cost[0]! + 2 * EMPLOYEE_TABLE.stocker.cost[0]!);
    expect(staffCount(s, 'janitor')).toBe(2);
    expect(staffCount(s, 'stocker')).toBe(2);
    expect(dailyWages(s) - w0).toBe(EMPLOYEE_TABLE.janitor.wage[0]! + EMPLOYEE_TABLE.stocker.wage[0]!);
    expect(extraStaffInfo(s, 'stocker').blockedReason).toBe('Máximo: 2');
    const t = deserialize(serialize(s));
    expect(staffCount(t, 'janitor')).toBe(2);
    expect(staffCount(t, 'stocker')).toBe(2);
  });
});
