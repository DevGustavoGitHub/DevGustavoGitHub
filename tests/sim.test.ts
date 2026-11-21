import { describe, expect, it } from 'vitest';
import { DENOMS, customerCashPayment, isChangeCorrect, optimalChange, roundPrice } from '../src/sim/money';
import { makeRng } from '../src/sim/rng';
import { buyProbability } from '../src/sim/demand';
import { advanceMarket, MARKET_MAX, MARKET_MIN } from '../src/sim/market';
import { autoRestock, buyBoxes, endDay, putOnShelf, setPrice, simulateOpenDay, xpForLevel } from '../src/sim/economy';
import { load, save, type KV } from '../src/sim/save';
import { newGame } from '../src/sim/state';
import { PRODUCTS } from '../src/sim/catalog';

describe('troco', () => {
  it('guloso é ótimo (compara com DP) para todos os valores até R$ 300', () => {
    const N = 30000;
    const dp = new Array<number>(N + 1).fill(Infinity);
    dp[0] = 0;
    for (let a = 5; a <= N; a += 5) for (const d of DENOMS) if (a >= d) dp[a] = Math.min(dp[a]!, dp[a - d]! + 1);
    for (let a = 0; a <= N; a += 5) expect(optimalChange(a).length).toBe(dp[a]);
  });
  it('valida troco do jogador', () => {
    expect(isChangeCorrect([1000, 100, 50], 1150)).toBe(true);
    expect(isChangeCorrect([1000, 100], 1150)).toBe(false);
    expect(isChangeCorrect([777], 777)).toBe(false);
  });
  it('pagamento do cliente nunca é menor que o total e é pagável', () => {
    const r = makeRng(3);
    for (let i = 0; i < 2000; i++) {
      const total = roundPrice(100 + r() * 30000);
      const paid = customerCashPayment(total, r);
      expect(paid).toBeGreaterThanOrEqual(total);
      expect(optimalChange(paid - total).reduce((a, b) => a + b, 0)).toBe(paid - total);
    }
  });
});

describe('mercado', () => {
  it('multiplicadores ficam dentro dos limites por 2000 dias', () => {
    const s = newGame(5);
    const r = makeRng(9);
    for (let d = 0; d < 2000; d++) {
      advanceMarket(s, r);
      for (const v of Object.values(s.market)) {
        expect(v).toBeGreaterThanOrEqual(MARKET_MIN);
        expect(v).toBeLessThanOrEqual(MARKET_MAX);
      }
    }
  });
  it('curva de demanda é monotônica decrescente', () => {
    let prev = 1;
    for (let r = 0.5; r <= 2; r += 0.05) {
      const p = buyProbability(r);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('economia', () => {
  it('compra exige licença e dinheiro; custo médio é ponderado', () => {
    const s = newGame();
    expect(() => buyBoxes(s, 'leite', 1)).toThrow();
    const before = s.money;
    const cost = buyBoxes(s, 'arroz', 2);
    expect(s.money).toBe(before - cost);
    expect(s.costBasis.arroz!.units).toBe(12);
  });
  it('prateleira respeita capacidade e caixas esvaziadas somem', () => {
    const s = newGame();
    buyBoxes(s, 'arroz', 5); // 30 un, capacidade 2 slots * 8 = 16
    expect(putOnShelf(s, 'arroz')).toBe(16);
    expect(s.shelf.arroz).toBe(16);
    expect(s.sidewalk.reduce((a, b) => a + b.units, 0)).toBe(14);
  });
  it('balanceamento: preço justo dá lucro; preço abusivo (+60%) rende bem menos', () => {
    const run = (mult: number) => {
      const s = newGame(11);
      let profit = 0;
      for (let d = 0; d < 30; d++) {
        for (const p of PRODUCTS) if (s.licenses.includes(p.category)) setPrice(s, p.id, 1);
        for (const p of PRODUCTS) {
          if (!s.licenses.includes(p.category)) continue;
          // preço = mercado * mult
          const ref = Math.round(p.baseWholesale * p.markup * (0.5 + 0.5 * (s.market[p.id] ?? 1)));
          setPrice(s, p.id, ref * mult);
        }
        autoRestock(s);
        simulateOpenDay(s);
        profit += endDay(s).netProfit;
      }
      return profit;
    };
    const fair = run(1.0);
    const greedy = run(1.6);
    expect(fair).toBeGreaterThan(0);
    expect(greedy).toBeLessThan(fair * 0.5);
  });
  it('xp por nível é estritamente crescente', () => {
    for (let n = 2; n < 60; n++) expect(xpForLevel(n + 1)).toBeGreaterThan(xpForLevel(n));
  });
});

describe('save', () => {
  it('round-trip preserva o estado', () => {
    const mem = new Map<string, string>();
    const kv: KV = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
    const s = newGame(42);
    buyBoxes(s, 'feijao', 3);
    putOnShelf(s, 'feijao');
    save(kv, s);
    expect(load(kv)).toEqual(s);
  });
  it('save corrompido retorna null', () => {
    const kv: KV = { getItem: () => '{oops', setItem: () => {} };
    expect(load(kv)).toBeNull();
  });
});
