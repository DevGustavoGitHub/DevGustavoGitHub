/**
 * Balanceamento com RITMO HUMANO (docs/qa/economy.md). O bot de src/sim/humanBot.ts joga pela API pública, mas o
 * expediente corre em segundos reais (390 s/dia) com a curva de chegada, a paciência e a fila do npc, e um jogador
 * sozinho que precisa dividir o tempo entre o caixa (bipar, troco, maquininha) e a reposição.
 * Guarda o início do jogo (dias 1–10) com os números atuais de tuning.ts: nem fácil demais para quem joga bem, nem
 * difícil demais para o iniciante. As tabelas completas saem com `npx vitest run tests/balance-human.test.ts --silent=false`.
 */
import { describe, expect, it } from 'vitest';
import { checkoutCart, furnitureStock, placeFromStock } from '../src/sim/api';
import { findSpot, restock as botRestock } from '../src/sim/bot';
import { xpForLevel } from '../src/sim/economy';
import {
  HUMAN_PROFILES, newHumanRun, playHumanDay, simulateHumanOpen, staffServiceSeconds, type HumanDayStats, type HumanProfile,
} from '../src/sim/humanBot';
import { makeRng } from '../src/sim/rng';
import { newGame, type StoreState } from '../src/sim/state';
import { CHECKOUT, EMPLOYEE_TABLE, START_MONEY } from '../src/sim/tuning';

const SEEDS = [3, 11, 29];
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const R = (c: number): string => (c / 100).toFixed(0);

/** Loja no nível `level` com dinheiro de sobra e (do nível 3 em diante) prateleiras de arroz e café, cheia de manhã. */
function levelState(seed: number, level: number): StoreState {
  const s = newGame(seed);
  s.day = 5;
  s.xp = xpForLevel(level);
  s.level = level;
  s.levelAck = level;
  s.money = 300_000;
  if (level >= 3) for (const id of ['arroz', 'cafe']) {
    const spot = findSpot(s, 'shelf')!;
    checkoutCart(s, [{ kind: 'furniture', id: 'shelf', qty: 1 }]);
    placeFromStock(s, furnitureStock(s).length - 1, spot.x, spot.z, 0, id);
  }
  botRestock(s);
  return s;
}

/** Um dia do jogador sozinho, sem viagens de reposição (a loja já está cheia): mede só o caixa. */
function soloDay(key: keyof typeof HUMAN_PROFILES, level: number, seed: number) {
  const s = levelState(seed, level);
  const o = simulateHumanOpen(s, { ...HUMAN_PROFILES[key], trigger: null }, makeRng(seed * 13 + level));
  return { ...o, served: o.arrivals - o.lostQueue - o.lostEmpty - o.vanished, secPerCustomer: o.svcSum / Math.max(1, o.svcN) };
}

interface Run { ds: HumanDayStats[]; bankruptcies: number; neg: number; first: Record<'cashier' | 'exp1' | 'bebidas' | 'l4', number> }
function play(prof: HumanProfile, seed: number, days: number, money = START_MONEY, hook?: (day: number) => void): Run {
  const r = newHumanRun(seed, prof, money);
  const out: Run = { ds: [], bankruptcies: 0, neg: 0, first: { cashier: 0, exp1: 0, bebidas: 0, l4: 0 } };
  for (let d = 1; d <= days; d++) {
    hook?.(d);
    const x = playHumanDay(r);
    out.ds.push(x);
    if (x.money < 0) out.neg++;
    const s = r.state;
    if (!out.first.cashier && s.employees.cashier > 0) out.first.cashier = d;
    if (!out.first.exp1 && s.expansion > 0) out.first.exp1 = d;
    if (!out.first.bebidas && s.licenses.includes('bebidas')) out.first.bebidas = d;
    if (!out.first.l4 && s.level >= 4) out.first.l4 = d;
  }
  out.bankruptcies = r.bankruptcies;
  return out;
}
const servedPct = (ds: HumanDayStats[]): number => (100 * ds.reduce((a, d) => a + d.served, 0)) / Math.max(1, ds.reduce((a, d) => a + d.arrivals, 0));
const netAvg = (ds: HumanDayStats[]): number => avg(ds.map((d) => d.netProfit));

describe('ritmo humano: tempo por cliente e capacidade do jogador sozinho', () => {
  it('atendimento: iniciante ~15–19 s/cliente, eficiente ~10–11 s; caixa contratado nível 1 ~8–12 s e mais rápido a cada nível', () => {
    const careful = avg(SEEDS.map((seed) => soloDay('cuidadoso', 4, seed).secPerCustomer));
    const fast = avg(SEEDS.map((seed) => soloDay('eficiente', 4, seed).secPerCustomer));
    expect(careful).toBeGreaterThan(14);
    expect(careful).toBeLessThan(21);
    expect(fast).toBeGreaterThan(8.5);
    expect(fast).toBeLessThan(12.5);
    const secs = EMPLOYEE_TABLE.cashier.seconds;
    expect(staffServiceSeconds(3, secs[0]!)).toBeGreaterThan(7);
    expect(staffServiceSeconds(5, secs[0]!)).toBeLessThan(12);
    for (let i = 1; i < secs.length; i++) expect(staffServiceSeconds(5, secs[i]!)).toBeLessThan(staffServiceSeconds(5, secs[i - 1]!));
  });
  it('sozinho no caixa, o jogador satura abaixo de CHECKOUT.manual: iniciante ~23 clientes/dia, eficiente ~36', () => {
    const lines: string[] = [];
    for (const level of [1, 3, 5]) {
      const c = SEEDS.map((seed) => soloDay('cuidadoso', level, seed));
      const e = SEEDS.map((seed) => soloDay('eficiente', level, seed));
      lines.push(`L${level}: chegadas ${avg(c.map((x) => x.arrivals)).toFixed(1)} | iniciante ${avg(c.map((x) => x.served)).toFixed(1)} (fila ${avg(c.map((x) => x.lostQueue)).toFixed(1)}) | eficiente ${avg(e.map((x) => x.served)).toFixed(1)} (fila ${avg(e.map((x) => x.lostQueue)).toFixed(1)})`);
      if (level === 5) {
        const cs = avg(c.map((x) => x.served));
        const es = avg(e.map((x) => x.served));
        expect(cs).toBeGreaterThan(18);
        expect(cs).toBeLessThan(28);
        expect(es).toBeGreaterThan(31);
        expect(es).toBeLessThan(41);
        expect(es).toBeLessThan(CHECKOUT.manual); // a sim supõe 45/dia: humano real fica abaixo (docs/qa/economy.md)
      }
    }
    console.log(lines.join('\n'));
  });
});

describe('início do jogo (dias 1–10) com o dinheiro inicial atual', () => {
  const careful = SEEDS.map((seed) => play(HUMAN_PROFILES.cuidadoso, seed, 30));
  const lazy = SEEDS.map((seed) => play(HUMAN_PROFILES.preguicoso, seed, 30));
  const fast = SEEDS.map((seed) => play(HUMAN_PROFILES.eficiente, seed, 30));
  const waste = SEEDS.map((seed) => play(HUMAN_PROFILES.desperdicador, seed, 30));
  const table = (name: string, rs: Run[]): string =>
    `${name}: d1 felizes/irritados ${rs.map((r) => `${r.ds[0]!.happy}/${r.ds[0]!.angry}`).join(' ')} | caixa fim d1 ${rs.map((r) => R(r.ds[0]!.money)).join('/')} | atendidos% 1-10 ${avg(rs.map((r) => servedPct(r.ds.slice(0, 10)))).toFixed(0)} | lucro/dia 1-10 ${R(avg(rs.map((r) => netAvg(r.ds.slice(0, 10)))))} 11-20 ${R(avg(rs.map((r) => netAvg(r.ds.slice(10, 20)))))} | L4 ${rs.map((r) => r.first.l4).join('/')} caixa ${rs.map((r) => r.first.cashier || '-').join('/')} bebidas ${rs.map((r) => r.first.bebidas || '-').join('/')} exp1 ${rs.map((r) => r.first.exp1 || '-').join('/')} | dias<0 ${rs.map((r) => r.neg).join('/')} falências ${rs.map((r) => r.bankruptcies).join('/')}`;

  it('iniciante cuidadoso: dia 1 com mais felizes que irritados, caixa para abastecer o dia 2 e ~65–75% atendidos', () => {
    console.log([table('cuidadoso', careful), table('preguiçoso', lazy), table('eficiente', fast), table('desperdiçador', waste)].join('\n'));
    for (const r of careful) {
      const d1 = r.ds[0]!;
      expect(d1.happy!).toBeGreaterThan(d1.angry!);
      expect(d1.netProfit).toBeGreaterThan(0);
      expect(d1.money).toBeGreaterThanOrEqual(8_000); // ~1–2 caixas baratas na manhã do dia 2 (era 12.000: com 13 clientes no nível 1, em vez de ~26, o dia 1 rende menos de propósito)
      expect(r.neg).toBe(0);
      expect(r.bankruptcies).toBe(0);
      expect(r.first.cashier).toBeGreaterThan(0);
      expect(r.first.cashier).toBeLessThanOrEqual(16);
    }
    const pct = avg(careful.map((r) => servedPct(r.ds.slice(0, 10))));
    expect(pct).toBeGreaterThan(60);
    expect(pct).toBeLessThan(85); // pós-teste 3: capacidade de clientes cresce com o nível → menos perdidos
  });
  it('preguiçoso (só abastece sem relógio) sobrevive, mas rende bem menos que o eficiente', () => {
    for (const r of lazy) {
      expect(r.bankruptcies).toBe(0);
      expect(netAvg(r.ds.slice(0, 10))).toBeGreaterThan(0);
    }
    expect(avg(fast.map((r) => netAvg(r.ds.slice(0, 10))))).toBeGreaterThan(1.8 * avg(lazy.map((r) => netAvg(r.ds.slice(0, 10)))));
  });
  // pós-teste 3: a 1ª expansão agora é a pequena (10×8 → 12×10, R$ 500, nível 2) e entra cedo de propósito
  it('eficiente não fica fácil demais: caixa contratado só a partir do dia 6, expansão 1 a partir do dia 3, nível ≤ 8 no dia 10', () => {
    for (const r of fast) {
      expect(r.first.cashier).toBeGreaterThanOrEqual(6);
      expect(r.first.exp1 === 0 || r.first.exp1 >= 3).toBe(true);
      expect(r.ds[9]!.level).toBeLessThanOrEqual(8);
      expect(r.bankruptcies).toBe(0);
    }
    const net = avg(fast.map((r) => netAvg(r.ds.slice(0, 10))));
    expect(net).toBeGreaterThan(40_000);
    expect(net).toBeLessThan(90_000);
  });
  // pós-teste 3: com o salão inicial menor, a 1ª expansão (R$ 500, nível 2) entra cedo e o dinheiro inicial pesa um pouco mais
  it('dinheiro inicial pouco muda o eficiente (o caixa é o limite): R$ 150 x R$ 300 diferem < 25% nos dias 1–10', () => {
    const at = (money: number): number => avg(SEEDS.map((seed) => netAvg(play(HUMAN_PROFILES.eficiente, seed, 10, money).ds)));
    const lo = at(15_000);
    const hi = at(30_000);
    expect(Math.abs(hi - lo) / lo).toBeLessThan(0.25);
  });
  it('desperdiçador (×1,25, planta no dia 1, móvel antes do estoque) sente o erro mas não quebra', () => {
    for (const r of waste) {
      expect(r.bankruptcies).toBe(0);
      expect(r.ds[29]!.level).toBeGreaterThanOrEqual(8);
    }
    // e quem erra feio por 2 dias (preço ×1,6) se recupera sem falir
    for (const seed of SEEDS) {
      const prof: HumanProfile = { ...HUMAN_PROFILES.cuidadoso };
      const r = play(prof, seed, 20, START_MONEY, (d) => { prof.priceMult = d === 3 || d === 4 ? 1.6 : 1; });
      expect(r.bankruptcies).toBe(0);
      const base = careful[SEEDS.indexOf(seed)]!;
      expect(netAvg(r.ds.slice(10, 20))).toBeGreaterThan(0.6 * netAvg(base.ds.slice(10, 20)));
    }
  });
  it('preço com ritmo humano: ×1,0–×1,3 lucram, ×1,6 dá prejuízo (curva da Fase 4 vista por quem atende no caixa)', { timeout: 120000 }, () => {
    const lines: string[] = [];
    const net: Record<string, number> = {};
    for (const key of ['cuidadoso', 'eficiente'] as const) {
      for (const mult of [1, 1.1, 1.2, 1.3, 1.6]) {
        const rs = SEEDS.map((seed) => play({ ...HUMAN_PROFILES[key], priceMult: mult }, seed, 20));
        net[`${key}${mult}`] = avg(rs.map((r) => netAvg(r.ds)));
        lines.push(`${key} ×${mult}: lucro/dia 1-20 ${R(net[`${key}${mult}`]!)} | atendidos% ${avg(rs.map((r) => servedPct(r.ds))).toFixed(0)} | rep ${avg(rs.map((r) => avg(r.ds.map((d) => d.reputation)))).toFixed(2)} | nível d20 ${avg(rs.map((r) => r.ds[19]!.level)).toFixed(1)}`);
      }
      for (const mult of [1, 1.1, 1.2, 1.3]) expect(net[`${key}${mult}`]!).toBeGreaterThan(0);
      expect(net[`${key}1.6`]!).toBeLessThan(0);
    }
    console.log(lines.join('\n'));
  });
  it('banco não vira atalho: pegar o limite quando o caixa aperta rende < 1,3× o lucro dos dias 1–10', () => {
    for (const [key, base] of [['cuidadoso', careful], ['eficiente', fast]] as const) {
      const bank = SEEDS.map((seed) => play({ ...HUMAN_PROFILES[key], bank: true }, seed, 10));
      const withBank = avg(bank.map((r) => netAvg(r.ds)));
      const without = avg(base.map((r) => netAvg(r.ds.slice(0, 10))));
      expect(withBank).toBeLessThan(1.3 * without);
    }
  });
});
