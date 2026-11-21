/** Todo dinheiro é inteiro em centavos. Nunca usar float para valores monetários. */
export type Cents = number;

/** Cédulas e moedas (BRL). Preços são sempre múltiplos de 5 centavos, então não existe moeda de 1c. */
export const BILLS: readonly Cents[] = [20000, 10000, 5000, 2000, 1000, 500, 200];
export const COINS: readonly Cents[] = [100, 50, 25, 10, 5];
export const DENOMS: readonly Cents[] = [...BILLS, ...COINS];

export const PRICE_STEP: Cents = 5;

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function roundPrice(c: number): Cents {
  return Math.max(PRICE_STEP, Math.round(c / PRICE_STEP) * PRICE_STEP);
}

export function changeDue(paid: Cents, total: Cents): Cents {
  if (paid < total) throw new Error('Pagamento menor que o total');
  return paid - total;
}

/** Troco com o menor número de peças (guloso é ótimo para este conjunto de denominações). */
export function optimalChange(amount: Cents): Cents[] {
  if (amount < 0 || amount % PRICE_STEP !== 0) throw new Error('Valor de troco inválido');
  const out: Cents[] = [];
  let rest = amount;
  for (const d of DENOMS) {
    while (rest >= d) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}

/** Valida o troco montado pelo jogador (soma exata, apenas denominações válidas). */
export function isChangeCorrect(picked: readonly Cents[], due: Cents): boolean {
  return picked.every((p) => DENOMS.includes(p)) && sum(picked) === due;
}

/** Cartão: o valor digitado tem que ser exatamente o total. */
export function isCardAmountCorrect(typed: Cents, total: Cents): boolean {
  return typed === total;
}

/** Quanto o cliente entrega em dinheiro: arredonda o total para cima até uma cédula "natural". */
export function customerCashPayment(total: Cents, rand: () => number): Cents {
  if (total % 100 === 0 && rand() < 0.15) return total; // paga exato
  const steps = [1000, 2000, 5000, 10000];
  const step = steps[Math.floor(rand() * steps.length)] ?? 1000;
  return Math.ceil(total / step) * step;
}
