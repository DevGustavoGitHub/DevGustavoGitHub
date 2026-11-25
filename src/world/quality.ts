/**
 * Qualidade gráfica: tiers fixos (low/medium/high) escolhidos pelo jogador e o modo `auto` (padrão de quem nunca
 * escolheu), que ajusta a RESOLUÇÃO em passos (resolução dinâmica, ver drs.ts) antes de cortar sombras.
 * Persistência: localStorage 'mercadinho:settings' (campo `quality`, gravado só pela UI quando o jogador escolhe).
 * O modo automático NUNCA grava a escolha do jogador; ele só guarda o último passo estável em 'mercadinho:drs'
 * (para o próximo carregamento já começar no ponto certo).
 */
export type Tier = 'low' | 'medium' | 'high';
export type Quality = Tier | 'auto';
export interface TierCfg {
  /** Pixel ratio máximo do renderer. */
  pixelRatio: number;
  /** Resolução do mapa de sombra do sol (0 = sem sombras). */
  shadow: number;
  /** MSAA permitido (só vale no carregamento e só com pixel ratio efetivo ≤ AA_MAX_PR; ver `wantsAntialias`). */
  antialias: boolean;
  /** Neblina (near, far): na qualidade baixa o fundo some mais cedo. */
  fog: [number, number];
}
export const TIERS: Record<Tier, TierCfg> = {
  low: { pixelRatio: 1, shadow: 0, antialias: false, fog: [60, 140] },
  medium: { pixelRatio: 1.5, shadow: 1024, antialias: true, fog: [80, 190] },
  high: { pixelRatio: 2, shadow: 2048, antialias: true, fog: [95, 230] },
};
/** Acima deste pixel ratio o MSAA quase não muda a imagem (bordas já suaves) e custa caro (×4 amostras em ~1,5 Mpx). */
export const AA_MAX_PR = 1.5;
export const SETTINGS_KEY = 'mercadinho:settings';
export const DRS_KEY = 'mercadinho:drs';
export const ORDER: Tier[] = ['low', 'medium', 'high'];
export const isTier = (q: unknown): q is Tier => q === 'low' || q === 'medium' || q === 'high';
export const isQuality = (q: unknown): q is Quality => q === 'auto' || isTier(q);

export function isMobileDevice(): boolean {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  } catch { return false; }
}
const dpr = (): number => (typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);

/** Qualidade salva pelo jogador (null se nunca escolheu). Saves antigos com low/medium/high continuam valendo. */
export function storedQuality(): Quality | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const q = (JSON.parse(raw) as { quality?: unknown }).quality;
    return isQuality(q) ? q : null;
  } catch { return null; }
}
/** Compatibilidade: tier fixo salvo (null se automático ou nunca escolheu). */
export function storedTier(): Tier | null { const q = storedQuality(); return isTier(q) ? q : null; }
export const initialQuality = (): Quality => storedQuality() ?? 'auto';

/** Classe do aparelho para o ponto de partida do modo automático (celular fraco começa sem sombras e em 1×). */
export function deviceClass(): 'weak' | 'mobile' | 'desktop' {
  if (!isMobileDevice()) return 'desktop';
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const strong = (nav?.hardwareConcurrency ?? 4) >= 6 && (nav?.deviceMemory ?? 4) >= 4;
  return strong ? 'mobile' : 'weak';
}

/** Um passo da resolução dinâmica: pixel ratio e sombra (0 = desligada). */
export interface DrsStep { pr: number; shadow: number }
/** Escada do modo automático, do melhor para o pior: pixel ratio cai em passos; sombras só saem no último degrau. */
export function autoSteps(devicePr = dpr(), cls = deviceClass()): DrsStep[] {
  const maxPr = Math.min(Math.max(devicePr, 1), 2);
  const prs = [2, 1.75, 1.5, 1.25, 1, 0.85].filter((p) => p <= maxPr + 1e-6);
  if (Math.abs(prs[0]! - maxPr) > 0.01) prs.unshift(Math.round(maxPr * 100) / 100);
  const shadows = cls !== 'weak';
  const steps = prs.map((pr): DrsStep => ({ pr, shadow: shadows ? (pr >= 1.75 ? 2048 : 1024) : 0 }));
  if (shadows) steps.push({ pr: prs[prs.length - 1]!, shadow: 0 });
  return steps;
}
/** Passo inicial do automático: o último estável salvo (se a escada é a mesma) ou um ponto conservador por aparelho. */
export function autoStart(steps: readonly DrsStep[], cls = deviceClass()): number {
  try {
    const raw = localStorage.getItem(DRS_KEY);
    const s = raw ? (JSON.parse(raw) as { pr?: unknown; shadow?: unknown }) : null;
    if (s && typeof s.pr === 'number') {
      const i = steps.findIndex((p) => Math.abs(p.pr - (s.pr as number)) < 0.01 && p.shadow === s.shadow);
      if (i >= 0) return i;
    }
  } catch { /* sem localStorage */ }
  const want = cls === 'desktop' ? 2 : cls === 'mobile' ? 1.5 : 1;
  const i = steps.findIndex((p) => p.pr <= want + 1e-6);
  return i >= 0 ? i : steps.length - 1;
}
export function saveAutoStep(s: DrsStep): void {
  try { localStorage.setItem(DRS_KEY, JSON.stringify({ pr: s.pr, shadow: s.shadow })); } catch { /* modo privado */ }
}

/** Pixel ratio efetivo no carregamento (antes do world assumir). */
export function startPixelRatio(q: Quality, devicePr = dpr()): number {
  if (q !== 'auto') return Math.min(devicePr, TIERS[q].pixelRatio);
  const steps = autoSteps(devicePr);
  return Math.min(devicePr, steps[autoStart(steps)]!.pr);
}
/**
 * MSAA no contexto WebGL (só no carregamento): ligado apenas quando o pixel ratio efetivo é ≤ AA_MAX_PR. Em celulares
 * com DPR 2,6–3 o "Alta" desenha em 2× sem MSAA (imagem praticamente igual, ~metade do custo de preenchimento); em
 * telas DPR 1 (PC) o MSAA continua ligado.
 */
export function wantsAntialias(q: Quality, devicePr = dpr()): boolean {
  if (q === 'low') return false;
  if (q === 'auto') return Math.min(devicePr, autoSteps(devicePr)[0]!.pr) <= AA_MAX_PR;
  return TIERS[q].antialias && Math.min(devicePr, TIERS[q].pixelRatio) <= AA_MAX_PR;
}
