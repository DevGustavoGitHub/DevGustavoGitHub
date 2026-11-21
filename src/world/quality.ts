/** Tiers de qualidade gráfica (low/medium/high), detecção de celular e persistência (localStorage 'mercadinho:settings'). */
export type Tier = 'low' | 'medium' | 'high';
export interface TierCfg {
  /** Pixel ratio máximo do renderer. */
  pixelRatio: number;
  /** Resolução do mapa de sombra do sol (0 = sem sombras). */
  shadow: number;
  /** Só vale no próximo carregamento (o contexto WebGL não muda de antialias em runtime). */
  antialias: boolean;
  /** Neblina (near, far): na qualidade baixa o fundo some mais cedo. */
  fog: [number, number];
}
export const TIERS: Record<Tier, TierCfg> = {
  low: { pixelRatio: 1, shadow: 0, antialias: false, fog: [60, 140] },
  medium: { pixelRatio: 1.5, shadow: 1024, antialias: true, fog: [80, 190] },
  high: { pixelRatio: 2, shadow: 2048, antialias: true, fog: [95, 230] },
};
export const SETTINGS_KEY = 'mercadinho:settings';
export const ORDER: Tier[] = ['low', 'medium', 'high'];
export const isTier = (q: unknown): q is Tier => q === 'low' || q === 'medium' || q === 'high';

export function isMobileDevice(): boolean {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  } catch { return false; }
}
/** Qualidade salva pelo jogador (null se nunca escolheu). */
export function storedTier(): Tier | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const q = (JSON.parse(raw) as { quality?: unknown }).quality;
    return isTier(q) ? q : null;
  } catch { return null; }
}
/** Padrão sem escolha do jogador: celular fraco = low, celular melhor = medium, desktop = medium. */
export function defaultTier(): Tier {
  if (!isMobileDevice()) return 'medium';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const strong = (navigator.hardwareConcurrency ?? 4) >= 6 && (nav.deviceMemory ?? 4) >= 4;
  return strong ? 'medium' : 'low';
}
export const initialTier = (): Tier => storedTier() ?? defaultTier();
/** Grava só o campo `quality`, preservando o resto das opções. */
export function persistTier(t: Tier): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    obj.quality = t;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
  } catch { /* modo privado */ }
}
