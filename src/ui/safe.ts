/** Chamadas à api tolerantes a NOT_IMPLEMENTED (Fase 2 em desenvolvimento) e a erros. */
import { errText, isNotImplemented } from './dom';

export interface Safe<T> { v: T; err?: string; pending: boolean }

export function safe<T>(fn: () => T, fallback: T): Safe<T> {
  try { return { v: fn(), pending: false }; } catch (e) {
    return { v: fallback, err: isNotImplemented(e) ? 'Em desenvolvimento' : errText(e), pending: isNotImplemented(e) };
  }
}
