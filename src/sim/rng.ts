/** PRNG determinístico (mulberry32). Seed no save => simulação reprodutível e testável. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Aproximação gaussiana (soma de 4 uniformes), média 0, desvio ~0.58. */
export function gauss(rand: () => number): number {
  return (rand() + rand() + rand() + rand() - 2) * 1.0;
}
