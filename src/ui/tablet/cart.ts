/** Carrinho do Mercado (memória da sessão) e compra via `api.checkoutCart` (fallback para a sim antiga). */
import * as api from '../../sim/api';
import { productById } from '../../sim/catalog';
import { wholesale } from '../../sim/market';
import type { StoreState } from '../../sim/state';
import { errText, isNotImplemented, money } from '../dom';
import type { UiKit } from '../kit';

export const cart: api.CartLine[] = [];
const same = (a: api.CartLine, b: api.CartLine): boolean => a.kind === b.kind && a.id === b.id && a.variant === b.variant;

export function addLine(l: api.CartLine): void {
  const cur = cart.find((x) => same(x, l));
  if (cur) cur.qty = Math.min(99, cur.qty + l.qty); else cart.push({ ...l });
}
export function removeOne(i: number): void {
  const l = cart[i];
  if (!l) return;
  l.qty--;
  if (l.qty <= 0) cart.splice(i, 1);
}
export function clearCart(): void { cart.length = 0; }

/** Custo de uma linha a preço de hoje (api.cartTotal; fallback local). */
export function lineCost(s: StoreState, l: api.CartLine): number {
  try { return api.cartTotal(s, [l]); } catch {
    try {
      if (l.kind === 'product') { const p = productById(l.id); return wholesale(s, p.id) * p.boxSize * l.qty; }
      const d = l.variant ? api.decorCatalog().find((x) => x.id === l.variant) : undefined;
      return (d?.cost ?? api.furnitureCatalog().find((f) => f.type === l.id)?.cost ?? 0) * l.qty;
    } catch { return 0; }
  }
}
export function totalOf(s: StoreState): number { return cart.reduce((a, l) => a + lineCost(s, l), 0); }

/**
 * Compra o carrinho. Produtos viram caixas na área de entrega; móveis vão para o estoque de montagem e o
 * posicionamento do primeiro móvel novo começa (`build:start {type, stockIndex}`) com o tablet fechado.
 */
export function buyCart(kit: UiKit, closeTablet: () => void): boolean {
  const { ctx } = kit;
  const s = ctx.state;
  const lines = cart.filter((l) => l.qty > 0).map((l) => ({ ...l }));
  if (!lines.length) return false;
  let before = 0;
  try { before = api.furnitureStock(s).length; } catch { /* */ }
  let res: { cost: number; boxes: number; furniture: number };
  try {
    res = api.checkoutCart(s, lines);
  } catch (e) {
    if (!isNotImplemented(e)) { kit.toast(errText(e), 'bad'); kit.sfx('error'); kit.settings.buzz(40); return false; }
    // sim sem Fase 3: caixas pelo pedido antigo; o 1º móvel pelo modo construção antigo (cobra ao posicionar)
    const cost = lines.filter((l) => l.kind === 'product').reduce((a, l) => a + lineCost(s, l), 0);
    if (cost > s.money) { kit.toast('Dinheiro insuficiente', 'bad'); kit.sfx('error'); return false; }
    let boxes = 0;
    for (const l of lines) if (l.kind === 'product') { try { api.orderBoxes(s, l.id, l.qty); boxes += l.qty; } catch (err) { kit.toast(errText(err), 'bad'); } }
    const f = lines.find((l) => l.kind === 'furniture');
    clearCart();
    if (f) addLine({ ...f, qty: Math.max(0, f.qty - 1) });
    ctx.bus.emit('stateChanged', { what: 'cart', boxes, furniture: 0 });
    ctx.save();
    if (boxes) kit.toast(`${boxes} ${boxes > 1 ? 'caixas chegaram' : 'caixa chegou'} na área de entrega.`, 'good');
    if (f) { closeTablet(); ctx.bus.emit('build:start', { type: f.id, productId: f.variant, variant: f.variant }); }
    kit.sfx('buy');
    return true;
  }
  clearCart();
  kit.sfx('buy');
  kit.settings.buzz(20);
  ctx.bus.emit('stateChanged', { what: 'cart', boxes: res.boxes, furniture: res.furniture });
  ctx.save();
  const parts: string[] = [];
  if (res.boxes) parts.push(`${res.boxes} ${res.boxes > 1 ? 'caixas na área de entrega' : 'caixa na área de entrega'}`);
  if (res.furniture) parts.push(`${res.furniture} ${res.furniture > 1 ? 'móveis para montar' : 'móvel para montar'}`);
  kit.toast(`Compra de ${money(res.cost)}: ${parts.join(' e ')}.`, 'good');
  if (res.furniture > 0) {
    let stock: api.StockedFurniture[] = [];
    try { stock = api.furnitureStock(s); } catch { /* */ }
    const idx = before < stock.length ? before : 0;
    const it = stock[idx];
    if (it) startPlacing(kit, idx, it, closeTablet);
  }
  return true;
}

/** Fecha o tablet e inicia o posicionamento em 1ª pessoa de um móvel do estoque de montagem. */
export function startPlacing(kit: UiKit, stockIndex: number, it: api.StockedFurniture, closeTablet: () => void): void {
  closeTablet();
  let name: string = it.type;
  try { name = it.variant ? api.decorCatalog().find((d) => d.id === it.variant)?.name ?? name : api.furnitureCatalog().find((f) => f.type === it.type)?.name ?? name; } catch { /* */ }
  kit.ctx.bus.emit('build:start', it.variant ? { type: it.type, stockIndex, variant: it.variant, productId: it.variant } : { type: it.type, stockIndex });
  kit.toast(`Monte: ${name}. Mire no chão e toque em COLOCAR.`, 'info');
}
