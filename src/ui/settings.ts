/** Opções do jogador (localStorage 'mercadinho:settings'); emite 'settings:changed' {quality,volume,haptics,fontSize,reduceMotion,colorblind,lookSensitivity}. */
import type { EventBus } from '../core/events';

export type Quality = 'low' | 'medium' | 'high';
export type FontSize = 'small' | 'medium' | 'large';
export interface Settings {
  quality: Quality;
  volume: number;
  haptics: boolean;
  /** Tamanho do texto da interface (P/M/G). */
  fontSize: FontSize;
  /** Desliga animações da UI e tremores de câmera. */
  reduceMotion: boolean;
  /** Troca verde/vermelho por azul/laranja e acrescenta ícones ↑↓. */
  colorblind: boolean;
  /** Fase 4: sensibilidade da câmera (multiplicador do olhar, 0,4–2,0; o player aplica). */
  lookSensitivity: number;
}
export const LOOK_MIN = 0.4;
export const LOOK_MAX = 2;
/** Sensibilidade válida: limitada a 0,4–2,0 em passos de 0,1 (padrão 1,0). */
export const clampLook = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(LOOK_MAX, Math.max(LOOK_MIN, v)) * 10) / 10 : 1;
export const FONT_SCALE: Record<FontSize, number> = { small: 0.9, medium: 1, large: 1.2 };
export const SETTINGS_KEY = 'mercadinho:settings';

const prefersReduced = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const defaults = (): Settings => ({ quality: 'medium', volume: 0.8, haptics: true, fontSize: 'medium', reduceMotion: prefersReduced(), colorblind: false, lookSensitivity: 1 });

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const DEFAULTS = defaults();
    if (!raw) return DEFAULTS;
    const d = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: d.quality === 'low' || d.quality === 'high' || d.quality === 'medium' ? d.quality : DEFAULTS.quality,
      volume: typeof d.volume === 'number' ? Math.min(1, Math.max(0, d.volume)) : DEFAULTS.volume,
      haptics: typeof d.haptics === 'boolean' ? d.haptics : DEFAULTS.haptics,
      fontSize: d.fontSize === 'small' || d.fontSize === 'large' || d.fontSize === 'medium' ? d.fontSize : DEFAULTS.fontSize,
      reduceMotion: typeof d.reduceMotion === 'boolean' ? d.reduceMotion : DEFAULTS.reduceMotion,
      colorblind: typeof d.colorblind === 'boolean' ? d.colorblind : DEFAULTS.colorblind,
      lookSensitivity: clampLook(d.lookSensitivity),
    };
  } catch {
    return defaults();
  }
}

export class SettingsStore {
  value: Settings = loadSettings();
  private root: HTMLElement | null = null;
  constructor(private bus: EventBus) {}
  /** Raiz da UI que recebe as classes de acessibilidade (mx-fs-*, mx-rm, mx-cb). */
  bindRoot(root: HTMLElement): void { this.root = root; this.applyClasses(); }
  private applyClasses(): void {
    const r = this.root;
    if (!r) return;
    const v = this.value;
    r.classList.toggle('mx-fs-s', v.fontSize === 'small');
    r.classList.toggle('mx-fs-l', v.fontSize === 'large');
    r.classList.toggle('mx-rm', v.reduceMotion);
    r.classList.toggle('mx-cb', v.colorblind);
    r.style.setProperty('--fs', String(FONT_SCALE[v.fontSize]));
  }
  set(p: Partial<Settings>): void {
    this.value = { ...this.value, ...p };
    // preserva campos gravados por outros módulos (contrato: quem grava outro campo mantém os demais)
    let extra: Record<string, unknown> = {};
    try { extra = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>; } catch { /* corrompido */ }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...extra, ...this.value })); } catch { /* modo privado */ }
    this.emit();
  }
  /** Adota mudança vinda de fora (ex.: `quality:auto` do world) sem emitir de volta. */
  adopt(p: Partial<Settings>): void { this.value = { ...this.value, ...p }; }
  emit(): void { this.applyClasses(); this.bus.emit('settings:changed', { ...this.value }); }
  buzz(ms: number | number[]): void {
    if (!this.value.haptics) return;
    try { navigator.vibrate?.(ms); } catch { /* sem suporte */ }
  }
}
