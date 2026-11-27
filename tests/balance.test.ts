import { describe, expect, it } from 'vitest';
import { newBot, playDay, playDays, restock, type DayStats } from '../src/sim/bot';
import { employeeCost, expansionMinLevel, isBankrupt, productCapacity, storageCapacity, storageUsed, upgradeCatalog } from '../src/sim/api';
import { LICENSES, PRODUCTS } from '../src/sim/catalog';
import { unitsOwned } from '../src/sim/economy';
import { levelCount, recomputeSlots } from '../src/sim/levels';
import { newGame, type StoreState } from '../src/sim/state';
import { levelUnits } from './helpers';

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
  // Fase 4: níveis são a fonte da verdade; shelf/slots derivados batem; custo médio cobre exatamente o que se possui
  for (const f of s.furniture) {
    expect(f.levels?.length ?? 0).toBe(levelCount(f.type));
    for (const l of f.levels ?? []) {
      expect(Number.isInteger(l.units) && l.units >= 0).toBe(true);
      if (l.productId === undefined) expect(l.units).toBe(0);
      else expect(l.units).toBeLessThanOrEqual(PRODUCTS.find((p) => p.id === l.productId)!.slotCapacity);
    }
  }
  for (const p of PRODUCTS) {
    expect(s.shelf[p.id] ?? 0).toBe(levelUnits(s, p.id));
    expect(s.costBasis[p.id]?.units ?? 0).toBe(unitsOwned(s, p.id));
  }
  const slots = { ...s.slots };
  const shelf = { ...s.shelf };
  recomputeSlots(s);
  expect(s.slots).toEqual(slots);
  expect(s.shelf).toEqual(shelf);
}

describe('balanceamento (bot joga N dias pela API pública)', () => {
  it('preço justo (sugerido = média de mercado) é lucrativo; preço abusivo (+60%) quebra', { timeout: 60000 }, () => {
    for (const seed of SEEDS) {
      const fair = newGame(seed);
      const greedy = newGame(seed);
      const f = playDays(fair, 30, { priceMult: 1.0 });
      const g = playDays(greedy, 30, { priceMult: 1.6 });
      const fNet = sum(f.map((d) => d.netProfit));
      const gNet = sum(g.map((d) => d.netProfit));
      expect(fNet).toBeGreaterThan(100_000); // > R$ 1.000 em 30 dias (na prática dezenas de milhares)
      expect(gNet).toBeLessThan(0);
      expect(greedy.level).toBeLessThan(fair.level);
    }
  });
  it('lucro tem ponto ótimo perto do mercado: ×1,0..×1,15 bate +30% e preços muito baixos não compensam', { timeout: 60000 }, () => {
    const net = (mult: number): number => sum(SEEDS.map((seed) => sum(playDays(newGame(seed), 30, { priceMult: mult }).map((d) => d.netProfit))));
    const low = net(0.8);
    const market = net(1.0);
    const fair = net(1.1);
    const high15 = net(1.15);
    const high30 = net(1.3);
    expect(fair).toBeGreaterThan(low);
    expect(market).toBeGreaterThan(low);
    expect(high15).toBeGreaterThan(high30);
    expect(fair).toBeGreaterThan(high30 * 1.5);
    expect(market).toBeGreaterThan(high30 * 1.5); // o preço sugerido (mercado) rende bem mais que +30%
  });
  it('início pobre: R$ 250 compram 3 caixas baratas (rodízio: 2 de feijão + 1 de macarrão); dia 1 lucra sem aluguel e sobe para o nível 2', () => {
    for (const seed of SEEDS) {
      const s = newGame(seed);
      restock(s); // abertura do dia 1: só cabem 3 caixas (as 2 prateleiras não enchem)
      expect(s.costBasis.feijao?.units).toBe(24);
      expect(s.costBasis.macarrao?.units).toBe(20);
      expect(s.money).toBeGreaterThanOrEqual(0);
      expect(s.money).toBeLessThan(7000); // não sobra para uma 4ª caixa
      const d1 = playDay(newGame(seed), newBot());
      expect(d1.fixed).toBe(0);
      expect(d1.netProfit).toBeGreaterThan(0);
      expect(d1.level).toBe(2);
      expect(d1.happy! + d1.angry!).toBe(d1.served + d1.lost);
      expect(d1.happy!).toBeGreaterThan(d1.angry!);
    }
  });
  // pós-teste 3: mais produtos/licenças baratas disputam o caixa do bot — caixa contratado até o dia 25
  it('progressão: nível 2 no dia 1, 2ª licença ~dia 5-12, expansão 1 ~dia 8-16, caixa contratado até o dia 25', () => {
    for (const seed of SEEDS) {
      const s = newGame(seed);
      const bot = newBot();
      let lvl2 = 0;
      let drinks = 0;
      let exp1 = 0;
      let cashier = 0;
      let minMoney = Infinity;
      for (let d = 1; d <= 25; d++) {
        playDay(s, bot);
        minMoney = Math.min(minMoney, s.money);
        if (!lvl2 && s.level >= 2) lvl2 = d;
        if (!drinks && s.licenses.includes('bebidas')) drinks = d;
        if (!exp1 && s.expansion >= 1) exp1 = d;
        if (!cashier && s.employees.cashier > 0) cashier = d;
      }
      expect(lvl2).toBe(1);
      expect(drinks).toBeGreaterThanOrEqual(5);
      expect(drinks).toBeLessThanOrEqual(12);
      expect(exp1).toBeGreaterThanOrEqual(8);
      expect(exp1).toBeLessThanOrEqual(16);
      expect(cashier).toBeGreaterThan(0);
      expect(minMoney).toBeGreaterThanOrEqual(0);
    }
  });
  it('sem espiral de falência no começo: estratégias razoáveis nunca ficam no vermelho nos primeiros 20 dias', { timeout: 60000 }, () => {
    for (const priceMult of [1, 1.12, 1.25]) {
      for (const restocks of [2, 4]) {
        const s = newGame(17);
        const bot = newBot({ priceMult, restocks });
        for (let d = 0; d < 20; d++) {
          const r = playDay(s, bot);
          expect(r.money, `x${priceMult} r${restocks} dia ${d + 1}`).toBeGreaterThanOrEqual(0);
          expect(isBankrupt(s)).toBe(false);
        }
      }
    }
  });
  it('economia não explode: lucro/dia cresce com o tempo, mas limitado por nível', { timeout: 60000 }, () => {
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
        expect(d.netProfit).toBeLessThan(400 * 100 * d.level + 50_000); // teto ~R$ 400 por nível (pós-teste 3: expansões/licenças mais baratas chegam antes; o teto global de R$ 10 mil/dia abaixo continua)
        expect(d.revenue).toBeLessThan(d.served * 60_000); // cesta média < R$ 600
      }
      expect(Math.max(...st.map((d) => d.netProfit))).toBeLessThan(1_200_000); // < R$ 12 mil/dia em 80 dias (pós-teste 3: preços/salários menores e 7 expansões; bot ótimo ~R$ 11,3 mil)
    }
  });
  it('nenhum estado inválido durante 60 dias (dinheiro inteiro, estoques >= 0, capacidade respeitada)', { timeout: 60000 }, () => {
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

/** Ainda há algo a destravar/comprar (licença, expansão, funcionário, melhoria ou depósito)? */
function somethingLeftToBuy(s: StoreState): boolean {
  if (LICENSES.some((l) => !s.licenses.includes(l.id))) return true;
  if (expansionMinLevel(s) !== null) return true;
  if ((['cashier', 'stocker', 'janitor'] as const).some((r) => employeeCost(s, r) !== null)) return true;
  if (upgradeCatalog(s).some((u) => !u.owned)) return true;
  return !s.storageUnlocked;
}

describe('ritmo de fim de jogo (dias 1–120)', () => {
  it('nível ~30 entre os dias 75 e 120, sempre há o que comprar até lá, estado válido e lucro limitado', { timeout: 90000 }, () => {
    for (const seed of [3, 11]) {
      const s = newGame(seed);
      const bot = newBot();
      let lvl30 = 0;
      const profits: number[] = [];
      for (let d = 1; d <= 120; d++) {
        const r = playDay(s, bot);
        profits.push(r.netProfit);
        checkInvariants(s);
        expect(s.loan).toBe(0);
        expect(s.history.length).toBeLessThanOrEqual(30);
        if (s.level < 30) expect(somethingLeftToBuy(s)).toBe(true);
        if (!lvl30 && s.level >= 30) lvl30 = d;
        expect(r.netProfit).toBeLessThan(1_500_000); // < R$ 15 mil/dia
      }
      expect(lvl30).toBeGreaterThanOrEqual(75);
      expect(lvl30).toBeLessThanOrEqual(120);
      expect(s.licenses.length).toBeGreaterThanOrEqual(LICENSES.length - 2);
      expect(s.expansion).toBeGreaterThanOrEqual(4);
      // o bot usa depósito, repositor e dolly
      expect(s.storageUnlocked).toBe(true);
      expect(s.employees.stocker).toBeGreaterThan(0);
      expect(s.upgrades).toContain('dolly');
      expect(s.upgrades).toContain('tipjar');
      // produtos de fim de jogo realmente vendem: há exposição de categorias novas
      expect(PRODUCTS.some((p) => ['hortifruti', 'higiene'].includes(p.category) && productCapacity(s, p.id) > 0)).toBe(true);
      const avg = (a: number, b: number): number => profits.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
      expect(avg(90, 120)).toBeGreaterThan(avg(40, 70));
    }
  });
});
