/** Opções do jogador (localStorage 'mercadinho:settings'); emite 'settings:changed' {quality,volume,haptics}. */
import type { EventBus } from '../core/events';

export type Quality = 'low' | 'medium' | 'high';
export interface Settings { quality: Quality; volume: number; haptics: boolean }
export const SETTINGS_KEY = 'mercadinho:settings';

const DEFAULTS: Settings = { quality: 'medium', volume: 0.8, haptics: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const d = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: d.quality === 'low' || d.quality === 'high' || d.quality === 'medium' ? d.quality : DEFAULTS.quality,
      volume: typeof d.volume === 'number' ? Math.min(1, Math.max(0, d.volume)) : DEFAULTS.volume,
      haptics: typeof d.haptics === 'boolean' ? d.haptics : DEFAULTS.haptics,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export class SettingsStore {
  value: Settings = loadSettings();
  constructor(private bus: EventBus) {}
  set(p: Partial<Settings>): void {
    this.value = { ...this.value, ...p };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.value)); } catch { /* modo privado */ }
    this.emit();
  }
  emit(): void { this.bus.emit('settings:changed', { ...this.value }); }
  buzz(ms: number | number[]): void {
    if (!this.value.haptics) return;
    try { navigator.vibrate?.(ms); } catch { /* sem suporte */ }
  }
}
