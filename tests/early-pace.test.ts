import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { GameClock } from '../src/core/clock';
import { makeShoppingList } from '../src/sim/api';
import { customersForDay } from '../src/sim/demand';
import { makeRng } from '../src/sim/rng';
import { newGame } from '../src/sim/state';
import { PRODUCTS } from '../src/sim/catalog';

describe('ritmo do início', () => {
  it('chegadas por nível: 1 ≈ 12–14, 2 ≈ 16–18, 3 ≈ 20 e a curva antiga a partir do 4', () => {
    const avgFor = (level: number): number => {
      let t = 0;
      for (let seed = 1; seed <= 40; seed++) { const s = newGame(seed); s.level = level; s.reputation = 4; t += customersForDay(s, makeRng(seed)); }
      return t / 40;
    };
    expect(avgFor(1)).toBeGreaterThan(11.5); expect(avgFor(1)).toBeLessThan(14.5);
    expect(avgFor(2)).toBeGreaterThan(15.5); expect(avgFor(2)).toBeLessThan(18.5);
    expect(avgFor(3)).toBeGreaterThan(18.5); expect(avgFor(3)).toBeLessThan(21.5);
    expect(avgFor(4)).toBeGreaterThan(34);
  });
  it('cesta de 1–3 itens nos níveis 1–2', () => {
    const s = newGame(5);
    for (const p of PRODUCTS) { s.licenses.push(p.category); s.slots[p.id] = 1; }
    for (const lv of [1, 2]) {
      s.level = lv;
      const r = makeRng(9);
      for (let i = 0; i < 200; i++) { const n = makeShoppingList(s, r).length; expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(3); }
    }
  });
  it('placa como pausa: só na fase open, relógio segue, zera ao fechar', () => {
    const bus = new EventBus(); const ev: boolean[] = [];
    bus.on('storeDoors', (e) => ev.push(e.closed));
    const c = new GameClock(bus);
    c.setDoorsClosed(true); expect(c.doorsClosed).toBe(false); // prep: ignora
    c.openStore(); c.setDoorsClosed(true);
    const m = c.minute; c.update(1);
    expect(c.doorsClosed).toBe(true); expect(c.signOpen).toBe(false); expect(c.minute).toBeGreaterThan(m);
    c.setDoorsClosed(false); expect(ev).toEqual([true, false]); expect(c.signOpen).toBe(true);
    c.setDoorsClosed(true); c.closeStore(); expect(c.doorsClosed).toBe(false);
  });
});
