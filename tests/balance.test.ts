import { describe, expect, it } from 'vitest';
import { newBot, playDay, playDays, type DayStats } from '../src/sim/bot';
import { productCapacity, storageCapacity, storageUsed } from '../src/sim/api';
import { PRODUCTS } from '../src/sim/catalog';
import { recomputeSlots } from '../src/sim/furniture';
import { newGame, type StoreState } from '../src/sim/state';

const SEEDS = [3, 11, 29];
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function checkInvariants(s: StoreState): void {
  expect(Number.isInteger(s.money)).toBe(true);
  expect(Number.isFinite(s.reputation)).toBe(true);
  expect(s.reputation).toBeGreaterThanOrEqual(1);
  expect(s.reputation).toBeLessThanOrEqual(5);
  for (const p of PRODUCTS) {
    const sh = s.shelf[p.id] ?? 0;
    expect(Number.isInteger(sh) && sh >= 0).toBe(true);
    expect(sh).toBeLessThanOrEqual(productCapacity(s, p.id));
    const st = s.storage[p.id] ?? 0;
    expect(Number.isInteger(st) && st >= 0).toBe(true);
    const b = s.costBasis[p.id];
    if (b) { expect(b.units).toBeGreaterThanOrEqual(0); expect(Number.isInteger(b.avg)).toBe(true); }
  }
  for (const b of s.sidewalk) expect(Number.isInteger(b.units) && b.units >= 0).toBe(true);
  expect(s.dirt.length).toBeLessThanOrEqual(12);
  expect(storageUsed(s)).toBeLessThanOrEqual(Math.max(storageCapacity(s), 0));
  const slots = { ...s.slots };
  recomputeSlots(s);
  expect(s.slots).toEqual(slots);
}

describe('balanceamento (bot joga N dias pela API pública)', () => {
  it('preço justo (+10%) é lucrativo; preço abusivo (+60%) quebra', () => {
    for (const seed of SEEDS) {
      const fair = newGame(seed);
      const greedy = newGame(seed);
      const f = playDays(fair, 30, { priceMult: 1.1 });
      const g = playDays(greedy, 30, { priceMult: 1.6 });
      const fNet = sum(f.map((d) => d.netProfit));
      const gNet = sum(g.map((d) => d.netProfit));
      expect(fNet).toBeGreaterThan(100_000); // > R$ 1.000 em 30 dias (na prática dezenas de milhares)
      expect(gNet).toBeLessThan(0);
      expect(greedy.level).toBeLessThan(fair.level);
    }
  });
  it('lucro tem ponto ótimo perto do mercado: +10..15% bate +30% e preços muito baixos não compensam', () => {
    const net = (mult: number): number => sum(SEEDS.map((seed) => sum(playDays(newGame(seed), 30, { priceMult: mult }).map((d) => d.netProfit))));
    const low = net(0.8);
    const fair = net(1.1);
    const high15 = net(1.15);
    const high30 = net(1.3);
    expect(fair).toBeGreaterThan(low);
    expect(high15).toBeGreaterThan(high30);
    expect(fair).toBeGreaterThan(high30 * 1.5);
  });
  it('progressão: nível 2 em ~1-2 dias, bebidas ~dia 3-5, expansão 1 ~dia 8-12', () => {
    for (const seed of SEEDS) {
      const s = newGame(seed);
      const bot = newBot();
      let lvl2 = 0;
      let drinks = 0;
      let exp1 = 0;
      for (let d = 1; d <= 20; d++) {
        playDay(s, bot);
        if (!lvl2 && s.level >= 2) lvl2 = d;
        if (!drinks && s.licenses.includes('bebidas')) drinks = d;
        if (!exp1 && s.expansion >= 1) exp1 = d;
      }
      expect(lvl2).toBeGreaterThanOrEqual(1);
      expect(lvl2).toBeLessThanOrEqual(2);
      expect(drinks).toBeGreaterThanOrEqual(3);
      expect(drinks).toBeLessThanOrEqual(5);
      expect(exp1).toBeGreaterThanOrEqual(8);
      expect(exp1).toBeLessThanOrEqual(13);
    }
  });
  it('economia não explode: lucro/dia cresce com o tempo, mas limitado por nível', () => {
    for (const seed of SEEDS) {
      const s = newGame(seed);
      const st: DayStats[] = playDays(s, 80, {});
      const avg = (a: number, b: number): number => sum(st.slice(a, b).map((d) => d.netProfit)) / (b - a);
      const w1 = avg(0, 10);
      const w2 = avg(25, 35);
      const w3 = avg(65, 80);
      expect(w1).toBeGreaterThan(0);
      expect(w2).toBeGreaterThan(w1 * 2);
      expect(w3).toBeGreaterThan(w2);
      for (const d of st) {
        expect(d.netProfit).toBeLessThan(300 * 100 * d.level + 50_000); // teto ~R$ 300 por nível
        expect(d.revenue).toBeLessThan(d.served * 60_000); // cesta média < R$ 600
      }
      expect(Math.max(...st.map((d) => d.netProfit))).toBeLessThan(1_000_000); // < R$ 10 mil/dia em 80 dias
    }
  });
  it('nenhum estado inválido durante 60 dias (dinheiro inteiro, estoques >= 0, capacidade respeitada)', () => {
    for (const seed of SEEDS) {
      const s = newGame(seed);
      const bot = newBot();
      for (let d = 0; d < 60; d++) {
        playDay(s, bot);
        checkInvariants(s);
      }
    }
  });
  it('invariantes valem também em estratégias extremas', () => {
    for (const mult of [0.5, 2.5]) {
      const s = newGame(8);
      const bot = newBot({ priceMult: mult, restocks: 1 });
      for (let d = 0; d < 20; d++) { playDay(s, bot); checkInvariants(s); }
    }
  });
  it('determinístico por semente', () => {
    const a = playDays(newGame(5), 15);
    const b = playDays(newGame(5), 15);
    expect(a).toEqual(b);
  });
  it('sem investir a loja ainda sobrevive: reposição frequente rende mais que 1x/dia', () => {
    const one = sum(playDays(newGame(11), 15, { invest: false, restocks: 1 }).map((d) => d.netProfit));
    const many = sum(playDays(newGame(11), 15, { invest: false, restocks: 5 }).map((d) => d.netProfit));
    expect(many).toBeGreaterThanOrEqual(one);
  });
});
