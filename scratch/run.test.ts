import { it } from 'vitest';
import { newGame } from '../src/sim/state';
import { playDays } from '../src/sim/bot';
it('trace', () => {
  for (const mult of [1.12]) {
    const s = newGame(11);
    const st = playDays(s, 40, { priceMult: mult });
    console.log('mult', mult);
    st.forEach((d) => console.log(d.day, 'L'+d.level, 'arr', d.arrivals, 'srv', d.served, 'lost', d.lost, 'so', d.stockouts, 'rej', d.rejected, 'net', Math.round(d.netProfit/100), 'cash', Math.round(d.money/100), 'rep', d.reputation.toFixed(2), 'exp', s.expansion, 'lic', s.licenses.length, 'cash/emp', s.employees.cashier));
  }
});
