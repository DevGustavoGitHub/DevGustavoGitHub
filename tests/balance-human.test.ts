import { describe, it } from 'vitest';
import {
  HUMAN_PROFILES, newHumanRun, playHumanDays, playHumanDay, simulateHumanOpen, staffServiceSeconds, type HumanProfile,
  type HumanDayStats, type HumanTweaks,
} from '../src/sim/humanBot';
import { restock as botRestock, findSpot } from '../src/sim/bot';
import { checkoutCart, placeFromStock, furnitureStock, plannedArrivals } from '../src/sim/api';
import { buyLicense, xpForLevel } from '../src/sim/economy';
import type { FurnitureType } from '../src/core/layout';
import { newGame, type StoreState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { RENT, LOAN } from '../src/sim/tuning';

const R = (c: number): string => (c / 100).toFixed(0);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (x: number): string => x.toFixed(1);
const SEEDS = [3, 11, 29];

function levelState(seed: number, level: number, day: number): StoreState {
  const s = newGame(seed);
  s.day = day;
  s.xp = xpForLevel(level);
  s.level = level;
  s.levelAck = level;
  s.money = 300000;
  if (level >= 3) for (const id of ['arroz', 'cafe']) {
    const spot = findSpot(s, 'shelf')!;
    checkoutCart(s, [{ kind: 'furniture', id: 'shelf', qty: 1 }]);
    placeFromStock(s, furnitureStock(s).length - 1, spot.x, spot.z, 0, id);
  }
  return s;
}

describe('qa explore', () => {
  it('T1 tempos de atendimento do funcionário', () => {
    const rows = [1, 2, 3, 4, 5].map((lv) => `staff L${lv}: ` + [2, 3, 5, 8, 12].map((n) => `${n}it=${f1(staffServiceSeconds(n, [10, 8, 6.5, 5, 4][lv - 1]!))}s`).join(' '));
    console.log(rows.join('\n'));
  });

  it('T2 capacidade do jogador sozinho por nível (loja cheia de manhã)', { timeout: 120000 }, () => {
    const out: string[] = ['perfil | nível | chegadas | atendidos | desistiram fila | sem nada | não entraram | s sentado | s ocioso | s viagens | viagens | s/cliente'];
    for (const key of ['cuidadoso', 'eficiente'] as const) {
      for (const mode of ['repõe', 'sem viagens'] as const) {
        for (let lv = 1; lv <= 6; lv++) {
          const acc: number[][] = [];
          for (const seed of [3, 11, 29, 41, 57]) {
            for (const day of [4, 7]) {
              const s = levelState(seed, lv, day);
              const prof: HumanProfile = { ...HUMAN_PROFILES[key], trigger: mode === 'sem viagens' ? null : HUMAN_PROFILES[key].trigger };
              botRestock(s);
              const o = simulateHumanOpen(s, prof, makeRng(seed * 13 + day));
              acc.push([o.arrivals, o.arrivals - o.lostQueue - o.lostEmpty - o.vanished, o.lostQueue, o.lostEmpty, o.vanished, o.seated, o.idleSeat, o.tripTime, o.trips, o.svcN ? o.svcSum / o.svcN : 0]);
            }
          }
          const m = acc[0]!.map((_, i) => avg(acc.map((r) => r[i]!)));
          out.push(`${key} ${mode} | L${lv} | ${m.map((x) => f1(x)).join(' | ')}`);
        }
      }
    }
    console.log(out.join('\n'));
  });

  const run30 = (prof: HumanProfile, money: number, seed: number, days = 30, tweaks: HumanTweaks = {}, hook?: (d: number, s: StoreState) => void) => {
    const run = newHumanRun(seed, prof, money, tweaks);
    const ds: HumanDayStats[] = [];
    const ms = { l2: 0, l3: 0, l4: 0, l5: 0, l6: 0, bebidas: 0, exp1: 0, cashier: 0, counter2: 0, shelf3: 0, minMoney: Infinity, neg: 0, firstPurchase: 0 };
    for (let d = 1; d <= days; d++) {
      hook?.(d, run.state);
      const r = playHumanDay(run);
      ds.push(r);
      const s = run.state;
      ms.minMoney = Math.min(ms.minMoney, r.money);
      if (r.money < 0) ms.neg++;
      for (const L of [2, 3, 4, 5, 6] as const) if (!ms[`l${L}`] && s.level >= L) ms[`l${L}`] = d;
      if (!ms.bebidas && s.licenses.includes('bebidas')) ms.bebidas = d;
      if (!ms.exp1 && s.expansion >= 1) ms.exp1 = d;
      if (!ms.cashier && s.employees.cashier > 0) ms.cashier = d;
      if (!ms.counter2 && s.furniture.filter((f) => f.type === 'counter').length > 1) ms.counter2 = d;
      if (!ms.shelf3 && s.furniture.filter((f) => f.type === 'shelf').length > 2) ms.shelf3 = d;
    }
    return { ds, ms, run };
  };
  const summary = (label: string, prof: HumanProfile, money: number, tweaks: HumanTweaks = {}, days = 30, hook?: (d: number, s: StoreState) => void): string => {
    const rs = SEEDS.map((seed) => run30(prof, money, seed, days, tweaks, hook));
    const servedPct = (a: number, b: number) => avg(rs.map((r) => {
      const x = r.ds.slice(a, b);
      return (100 * x.reduce((q, d) => q + d.served, 0)) / Math.max(1, x.reduce((q, d) => q + d.arrivals, 0));
    }));
    const net = (a: number, b: number) => avg(rs.map((r) => avg(r.ds.slice(a, b).map((d) => d.netProfit))));
    const day = (k: keyof (typeof rs)[0]['ms']) => rs.map((r) => (r.ms[k] as number) || '-').join('/');
    const d1 = avg(rs.map((r) => r.ds[0]!.served));
    const d1a = avg(rs.map((r) => r.ds[0]!.arrivals));
    return `${label} | ${R(money)} | d1 ${f1(d1)}/${f1(d1a)} | aten% 1-3 ${servedPct(0, 3).toFixed(0)} 1-10 ${servedPct(0, 10).toFixed(0)} | lucro/d 1-3 ${R(net(0, 3))} 1-10 ${R(net(0, 10))} 11-20 ${R(net(10, 20))} 21-30 ${R(net(20, 30))} | L2 ${day('l2')} L3 ${day('l3')} L4 ${day('l4')} L5 ${day('l5')} | 3ªprat ${day('shelf3')} bebidas ${day('bebidas')} caixa ${day('cashier')} exp1 ${day('exp1')} balcão2 ${day('counter2')} | minR$ ${rs.map((r) => R(r.ms.minMoney)).join('/')} dias<0 ${rs.map((r) => r.ms.neg).join('/')} falências ${rs.map((r) => r.run.bankruptcies).join('/')} | nív30 ${rs.map((r) => r.run.state.level).join('/')} R$d30 ${rs.map((r) => R(r.run.state.money)).join('/')}`;
  };

  it('T3 arquétipos x dinheiro inicial (30 dias, 3 sementes)', { timeout: 300000 }, () => {
    const out: string[] = [];
    for (const [k, prof] of Object.entries(HUMAN_PROFILES)) for (const money of [10000, 15000, 20000, 30000]) out.push(summary(k, prof, money));
    console.log(out.join('\n'));
  });

  it('T4 banco: o empréstimo do dia 1 anula o dinheiro inicial?', { timeout: 300000 }, () => {
    const out: string[] = [];
    for (const [k, prof] of Object.entries(HUMAN_PROFILES)) for (const money of [10000, 15000]) out.push(summary(`${k}+banco`, { ...prof, bank: true }, money));
    console.log(out.join('\n'));
  });

  it('T5 recuperação depois de erro (R$ 150)', { timeout: 300000 }, () => {
    const out: string[] = [];
    for (const k of ['cuidadoso', 'eficiente'] as const) {
      const prof = HUMAN_PROFILES[k];
      out.push(summary(`${k} base`, prof, 15000));
      // erro A: no dia 3 gasta tudo (menos R$ 20) em decoração
      out.push(summary(`${k} erroA-decor-d3`, prof, 15000, {}, 30, (d, s) => { if (d === 3) { const v = Math.max(0, s.money - 2000); s.money -= v; } }));
      // erro B: dias 3-4 com preço ×1,6
      const base = prof.priceMult;
      out.push(summary(`${k} erroB-preço1.6-d3-4`, prof, 15000, {}, 30, (d) => { prof.priceMult = d === 3 || d === 4 ? 1.6 : base; }));
      prof.priceMult = base;
      // erro C: dia 3 sem abrir direito (não abastece de manhã e fica 70% do dia fora do caixa)
      const lazyDay: HumanProfile = { ...prof };
      out.push(summary(`${k} erroC-dia3-largado`, lazyDay, 15000, {}, 30, (d) => {
        Object.assign(lazyDay, d === 3 ? { morning: 0, distraction: 0.7, trigger: null } : { morning: prof.morning, distraction: prof.distraction, trigger: prof.trigger });
      }));
    }
    console.log(out.join('\n'));
  });

  it('T6 propostas de outros módulos (10 dias, R$ 150)', { timeout: 300000 }, () => {
    const out: string[] = [];
    const tw: [string, HumanTweaks][] = [['base', {}], ['dia 480s', { daySeconds: 480 }], ['paciência 55-80', { patience: [55, 80] }], ['picos σ×1,6', { sigma: 1.6 }], ['paciência 50-70+σ×1,4', { patience: [50, 70], sigma: 1.4 }]];
    for (const k of ['cuidadoso', 'eficiente'] as const) for (const [name, t] of tw) out.push(summary(`${k} ${name}`, HUMAN_PROFILES[k], 15000, t, 10));
    console.log(out.join('\n'));
  });

  it('T7 variações da sim (mutando constantes em memória)', { timeout: 300000 }, () => {
    const out: string[] = [];
    const save = { ...RENT };
    const saveLoan = { ...LOAN };
    const variants: [string, () => void, number][] = [
      ['base R$150', () => {}, 15000],
      ['R$250', () => {}, 25000],
      ['R$200 aluguel dia6', () => { RENT.startDay = 6; }, 20000],
      ['R$150 aluguel dia6/nív4', () => { RENT.startDay = 6; RENT.startLevel = 4; }, 15000],
      ['R$250 aluguel dia5', () => { RENT.startDay = 5; }, 25000],
    ];
    for (const [name, apply, money] of variants) {
      apply();
      for (const k of ['cuidadoso', 'preguicoso', 'eficiente'] as const) out.push(summary(`${k} ${name}`, HUMAN_PROFILES[k], money, {}, 30));
      Object.assign(RENT, save);
      Object.assign(LOAN, saveLoan);
    }
    console.log(out.join('\n'));
  });

  it('T9 combinações candidatas (5 sementes, 10 e 30 dias)', { timeout: 600000 }, () => {
    const out: string[] = [];
    const save = { ...RENT };
    const combos: [string, number, () => void][] = [
      ['A base 150', 15000, () => {}],
      ['B 250', 25000, () => {}],
      ['C 250+aluguel nív4/dia6', 25000, () => { RENT.startLevel = 4; RENT.startDay = 6; }],
      ['D 200+aluguel nív4/dia6', 20000, () => { RENT.startLevel = 4; RENT.startDay = 6; }],
      ['E 300', 30000, () => {}],
    ];
    const seeds = [3, 11, 29, 41, 57];
    for (const [name, money, apply] of combos) {
      apply();
      for (const [k, prof] of Object.entries(HUMAN_PROFILES)) {
        const rs = seeds.map((seed) => run30(prof, money, seed, 30));
        const pct = (a: number, b: number) => avg(rs.map((r) => { const x = r.ds.slice(a, b); return (100 * x.reduce((q, d) => q + d.served, 0)) / Math.max(1, x.reduce((q, d) => q + d.arrivals, 0)); }));
        const net = (a: number, b: number) => avg(rs.map((r) => avg(r.ds.slice(a, b).map((d) => d.netProfit))));
        const md = (key: 'l4' | 'l5' | 'cashier' | 'bebidas' | 'exp1' | 'shelf3') => { const v = rs.map((r) => r.ms[key]).filter((x) => x > 0).sort((a, b) => a - b); return v.length ? `${v[Math.floor(v.length / 2)]}${v.length < rs.length ? `(${v.length}/5)` : ''}` : '-'; };
        const happy1 = avg(rs.map((r) => r.ds[0]!.happy ?? 0));
        const angry1 = avg(rs.map((r) => r.ds[0]!.angry ?? 0));
        const rep10 = avg(rs.map((r) => avg(r.ds.slice(0, 10).map((d) => d.reputation))));
        out.push(`${name} | ${k} | d1 felizes/irritados ${f1(happy1)}/${f1(angry1)} lucro d1 ${R(avg(rs.map((r) => r.ds[0]!.netProfit)))} caixa fim d1 ${R(avg(rs.map((r) => r.ds[0]!.money)))} | aten% 1-3 ${pct(0, 3).toFixed(0)} 1-10 ${pct(0, 10).toFixed(0)} | lucro/d 1-10 ${R(net(0, 10))} 11-20 ${R(net(10, 20))} | R$ d5 ${R(avg(rs.map((r) => r.ds[4]!.money)))} d10 ${R(avg(rs.map((r) => r.ds[9]!.money)))} | rep1-10 ${rep10.toFixed(2)} | mediana: 3ªprat ${md('shelf3')} L4 ${md('l4')} L5 ${md('l5')} caixa ${md('cashier')} bebidas ${md('bebidas')} exp1 ${md('exp1')} | min R$ ${R(Math.min(...rs.map((r) => r.ms.minMoney)))} dias<0 ${rs.reduce((a, r) => a + r.ms.neg, 0)} falências ${rs.reduce((a, r) => a + r.run.bankruptcies, 0)} | nív d30 ${f1(avg(rs.map((r) => r.run.state.level)))}`);
      }
      Object.assign(RENT, save);
    }
    console.log(out.join('\n'));
  });

  it('T10 detalhe: cuidadoso R$ 150 x R$ 250, semente 11', () => {
    const out: string[] = [];
    for (const money of [15000, 25000]) {
      const { ds, run } = run30(HUMAN_PROFILES.cuidadoso, money, 11, 12);
      out.push(`== cuidadoso R$${money / 100}`);
      for (const d of ds) out.push(`d${d.day} L${d.level} arr${d.arrivals} srv${d.served} filas${d.lostQueue} vazio${d.lostEmpty} fora${d.vanished} viag${d.trips}/${d.tripTime.toFixed(0)}s sent${d.seated.toFixed(0)} ocio${d.idleSeat.toFixed(0)} s/cli${(d.svcSum / Math.max(1, d.svcN)).toFixed(1)} compras${R(d.purchases)} lucro${R(d.netProfit)} caixa${R(d.money)} rep${d.reputation.toFixed(2)} aluguel${R(d.rent ?? 0)} feliz${d.happy}/irrit${d.angry}`);
      out.push(`   prateleiras ${run.state.furniture.filter((f) => f.type === 'shelf').length} lic ${run.state.licenses.join(',')}`);
    }
    console.log(out.join('\n'));
  });

  it('T6b propostas npc/clock com R$ 250 (5 sementes, 10 dias)', { timeout: 600000 }, () => {
    const out: string[] = [];
    const tw: [string, HumanTweaks][] = [['base', {}], ['paciência 50-75', { patience: [50, 75] }], ['dia 450 s', { daySeconds: 450 }], ['picos σ×1,5', { sigma: 1.5 }], ['paciência 50-75 + σ×1,3', { patience: [50, 75], sigma: 1.3 }]];
    const seeds = [3, 11, 29, 41, 57];
    for (const k of ['cuidadoso', 'eficiente'] as const) for (const [name, t] of tw) {
      const rs = seeds.map((seed) => run30(HUMAN_PROFILES[k], 25000, seed, 10, t));
      const tot = (f: (d: HumanDayStats) => number) => avg(rs.map((r) => r.ds.reduce((a, d) => a + f(d), 0) / r.ds.length));
      out.push(`${k} ${name} | aten% ${(100 * tot((d) => d.served) / tot((d) => d.arrivals)).toFixed(0)} | fila/d ${f1(tot((d) => d.lostQueue))} vazio/d ${f1(tot((d) => d.lostEmpty))} fora/d ${f1(tot((d) => d.vanished))} | lucro/d ${R(tot((d) => d.netProfit))} | rep ${tot((d) => d.reputation).toFixed(2)} | nív d10 ${f1(avg(rs.map((r) => r.run.state.level)))} | ocioso s/d ${f1(tot((d) => d.idleSeat))}`);
    }
    console.log(out.join('\n'));
  });

  it('T11 meio de jogo: 1 operador por balcão e um só caixa contratado', { timeout: 600000 }, () => {
    const out: string[] = ['nível | expansão | caixa nív | balcões | chegadas | atendidos | desistiram | sem nada | não entraram'];
    const lic: [number, string, FurnitureType, string[]][] = [[2, 'bebidas', 'fridge', ['refri', 'agua']], [4, 'laticinios', 'fridge', ['leite', 'queijo']], [6, 'padaria', 'shelf', ['pao']], [8, 'limpeza', 'shelf', ['detergente']]];
    for (const [L, cashier] of [[6, 1], [8, 2], [10, 2], [12, 3], [15, 3]] as const) {
      for (const counters of [1, 2]) {
        const acc: number[][] = [];
        for (const seed of [3, 11, 29, 41]) {
          const s = levelState(seed, L, 20);
          s.money = 5_000_000;
          s.expansion = Math.min(4, Math.floor((L - 4) / 2));
          for (const [minL, id, type, prods] of lic) {
            if (L < minL) continue;
            buyLicense(s, id);
            for (const p of prods) { const sp = findSpot(s, type)!; checkoutCart(s, [{ kind: 'furniture', id: type, qty: 1 }]); placeFromStock(s, furnitureStock(s).length - 1, sp.x, sp.z, 0, p); }
          }
          if (counters > 1) { const sp = findSpot(s, 'counter')!; checkoutCart(s, [{ kind: 'furniture', id: 'counter', qty: 1 }]); placeFromStock(s, furnitureStock(s).length - 1, sp.x, sp.z, 0); }
          s.employees.cashier = cashier;
          botRestock(s);
          const o = simulateHumanOpen(s, HUMAN_PROFILES.eficiente, makeRng(seed * 7 + L));
          acc.push([o.arrivals, o.arrivals - o.lostQueue - o.lostEmpty - o.vanished, o.lostQueue, o.lostEmpty, o.vanished]);
        }
        const m = acc[0]!.map((_, i) => avg(acc.map((r) => r[i]!)));
        out.push(`L${L} | exp ${Math.min(4, Math.floor((L - 4) / 2))} | caixa ${cashier} | ${counters} | ${m.map(f1).join(' | ')}`);
      }
    }
    console.log(out.join('\n'));
  });

  it('T8 chegadas por nível', () => {
    const out: string[] = [];
    for (let lv = 1; lv <= 8; lv++) {
      const xs = [1, 2, 3, 4, 5, 6].map((seed) => { const s = levelState(seed, lv, 5); return plannedArrivals(s); });
      out.push(`L${lv}: chegadas ${f1(avg(xs))} (rep 3,5, preço ×1)`);
    }
    console.log(out.join('\n'));
  });
});
