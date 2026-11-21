/**
 * Barramento de eventos simples e tipado de forma frouxa. Lista oficial de eventos: docs/CONTRACTS.md.
 * Quem emite um evento novo DEVE documentá-lo na seção do seu módulo em docs/CONTRACTS.md.
 */
type Handler = (payload?: any) => void;
export class EventBus {
  private h = new Map<string, Set<Handler>>();
  on(name: string, fn: Handler): () => void {
    let s = this.h.get(name);
    if (!s) this.h.set(name, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit(name: string, payload?: any): void {
    this.h.get(name)?.forEach((fn) => fn(payload));
  }
}
