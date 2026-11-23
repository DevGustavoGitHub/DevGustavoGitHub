/**
 * Aba Mercado (Fase 3, layout da referência): subabas Produtos | Móveis com cartões (ícone procedural, preço da caixa,
 * unidades por caixa, móvel exigido, −/+ e Adicionar) e o carrinho à direita (item, preço, unidades, total, Comprar, Limpar).
 * Móveis comprados vão para o estoque de montagem ("Para montar (N)" com botões Montar).
 */
import * as api from '../../sim/api';
import { LICENSES, PRODUCTS, type Category, type Product } from '../../sim/catalog';
import { unitsOwned } from '../../sim/economy';
import { wholesale } from '../../sim/market';
import type { StoreState } from '../../sim/state';
import { decorSvg, furnitureSvg, productSvg } from '../art';
import { h, money } from '../dom';
import { icon } from '../icons';
import type { UiKit } from '../kit';
import { actionBtn, CATEGORY_NAME, variation } from '../widgets';
import { addLine, buyCart, cart, clearCart, lineCost, removeOne, startPlacing, totalOf } from './cart';
import type { TabApi } from './index';

type Sub = 'products' | 'furniture';
let sub: Sub = 'products';
let filter: Category | 'all' = 'all';
const qty = new Map<string, number>();
const scroll: Record<Sub, number> = { products: 0, furniture: 0 };
export const setMarketSub = (s: Sub): void => { sub = s; };

const tryv = <T,>(fn: () => T, fb: T): T => { try { return fn(); } catch { return fb; } };
const specsOf = (): api.FurnitureSpec[] => tryv(() => api.furnitureCatalog(), [] as api.FurnitureSpec[]);
const stockOf = (s: StoreState): api.StockedFurniture[] => tryv(() => api.furnitureStock(s), [] as api.StockedFurniture[]);

/** Tipo de móvel que expõe o produto (api.furnitureForProduct; fallback pelo catálogo). */
function requiredType(p: Product, specs: api.FurnitureSpec[]): string {
  return tryv(() => api.furnitureForProduct(p.id), specs.find((sp) => sp.categories.includes(p.category))?.type ?? 'shelf');
}

function stepperEl(key: string, onChange: (n: number) => void): HTMLElement {
  const out = h('output', null, String(qty.get(key) ?? 1));
  const set = (d: number): void => {
    const n = Math.max(1, Math.min(50, (qty.get(key) ?? 1) + d));
    qty.set(key, n);
    out.textContent = String(n);
    minus.disabled = n <= 1;
    onChange(n);
  };
  const minus = h('button', { 'aria-label': 'Menos', disabled: (qty.get(key) ?? 1) <= 1, on: { click: () => set(-1) } }, '−');
  return h('div', { class: 'qty' }, minus, out, h('button', { 'aria-label': 'Mais', on: { click: () => set(1) } }, '+'));
}

export function marketTab(body: HTMLElement, kit: UiKit, tab: TabApi): void {
  const s = kit.ctx.state;
  const list = h('div', { class: 'mk-list', role: 'list' });
  list.addEventListener('scroll', () => { scroll[sub] = list.scrollTop; }, { passive: true });
  const cartEl = h('aside', { class: 'mk-cart', 'aria-label': 'Carrinho' });

  const renderCart = (): void => {
    const total = totalOf(s);
    const poor = total > s.money;
    const lines = cart.map((l, i) => {
      let name = l.id, art = '', units = '';
      if (l.kind === 'product') {
        const p = PRODUCTS.find((x) => x.id === l.id);
        name = p?.name ?? l.id; art = p ? productSvg(p, 26) : '';
        units = `${l.qty} cx`;
      } else {
        const d = l.variant ? tryv(() => api.decorCatalog().find((x) => x.id === l.variant), undefined) : undefined;
        name = d?.name ?? specsOf().find((f) => f.type === l.id)?.name ?? l.id;
        art = l.id === 'decor' ? decorSvg(l.variant ?? 'plant', 26) : furnitureSvg(l.id, 26);
        units = `${l.qty}`;
      }
      return h('button', { class: 'cline', 'aria-label': `Remover 1 de ${name}`, title: 'Toque para remover 1', on: { click: () => { removeOne(i); kit.sfx('pop'); renderCart(); } } },
        h('span', { class: 'nm', html: art }, h('span', null, h('b', { class: 'x' }, '−'), name)), h('span', null, money(lineCost(s, l))), h('span', null, units));
    });
    cartEl.replaceChildren(
      h('h4', null, 'Carrinho', h('small', null, `Saldo ${money(s.money)}`)),
      h('div', { class: 'cart-h' }, h('span', null, 'Item'), h('span', null, 'Preço'), h('span', null, 'Unid.')),
      h('div', { class: 'cart-lines' }, lines.length ? lines : h('div', { class: 'cart-empty' }, 'Vazio. Toque em Adicionar nos cartões.')),
      h('div', { class: 'cart-total' }, h('span', null, 'Total'), h('b', { id: 'cart-total' }, money(total))),
      poor && cart.length ? h('div', { class: 'cart-msg' }, `Faltam ${money(total - s.money)}`) : null,
      h('div', { class: 'cart-act' },
        h('button', { class: 'cart-buy', id: 'cart-buy', disabled: !cart.length || poor, on: { click: () => { if (buyCart(kit, () => tab.close())) tab.refresh(); } } }, 'Comprar'),
        h('button', { class: 'cart-clear', 'aria-label': 'Limpar carrinho', disabled: !cart.length, html: icon('trash', 22), on: { click: () => { clearCart(); kit.sfx('pop'); renderCart(); } } }, 'Limpar')));
  };

  const addBtn = (line: () => api.CartLine, label = 'Adicionar'): HTMLButtonElement => {
    const b = actionBtn({ kind: 'buy', label, onClick: () => {
      addLine(line());
      kit.sfx('pop');
      kit.settings.buzz(10);
      renderCart();
      b.textContent = 'Adicionado!';
      window.setTimeout(() => { b.textContent = label; }, 700);
    } });
    b.classList.add('add');
    return b;
  };

  /* ---------------- produtos ---------------- */
  const products = (): void => {
    const specs = specsOf();
    const stock = stockOf(s);
    list.appendChild(h('div', { class: 'mk-note' }, h('span', null, 'Caixas chegam na hora, fechadas, na área de entrega.'),
      h('button', { class: 'btn small', id: 'mk-fill', on: { click: () => fillShelves(kit, renderCart) } }, h('span', { html: icon('box', 18) }), 'Encher prateleiras')));
    const owned = LICENSES.filter((l) => s.licenses.includes(l.id) && (filter === 'all' || filter === l.id));
    for (const lic of owned) {
      if (filter === 'all' && owned.length > 1) list.appendChild(h('div', { class: 'grp' }, CATEGORY_NAME[lic.id]));
      for (const p of PRODUCTS.filter((x) => x.category === lic.id)) {
        const boxCost = wholesale(s, p.id) * p.boxSize;
        const req = requiredType(p, specs);
        const reqSpec = specs.find((sp) => sp.type === req);
        const compat = specs.filter((sp) => sp.categories.includes(p.category)).map((sp) => sp.type);
        const hasOne = s.furniture.some((f) => compat.includes(f.type));
        const inStock = stock.some((f) => compat.includes(f.type));
        const fname = (reqSpec?.name ?? 'prateleira').toLowerCase();
        list.appendChild(h('div', { class: 'pcard', role: 'listitem', 'data-product': p.id },
          h('div', { class: 'pc-l' },
            h('b', { class: 'pc-name' }, p.name),
            h('span', { class: 'pc-sub' }, `Na loja: ${unitsOwned(s, p.id)} un`),
            h('div', { class: 'pc-art' },
              h('span', { html: productSvg(p, 66) }),
              h('span', { class: 'pc-furn', title: `Exige: ${reqSpec?.name ?? req}`, 'aria-label': `Exige ${fname}`, html: furnitureSvg(req, 30) }),
              h('span', { class: 'pc-units', title: 'Unidades por caixa' }, String(p.boxSize), h('span', { html: icon('box', 18) }))),
            hasOne ? null : h('span', { class: 'pc-warn' }, inStock ? `Monte a ${fname} (no estoque)` : `Precisa de ${fname}`)),
          h('div', { class: 'pc-r' },
            h('div', { class: 'pc-price' }, money(boxCost), variation(s.market[p.id] ?? 1)),
            stepperEl(`p:${p.id}`, () => {}),
            addBtn(() => ({ kind: 'product', id: p.id, qty: qty.get(`p:${p.id}`) ?? 1 })))));
      }
    }
    const next = LICENSES.find((l) => !s.licenses.includes(l.id));
    if (next && filter === 'all') {
      list.appendChild(h('div', { class: 'mk-note' }, h('span', null, `Mais produtos: licença de ${CATEGORY_NAME[next.id]} (nível ${next.minLevel}).`),
        h('button', { class: 'btn small', on: { click: () => tab.goto('licenses') } }, 'Ver licenças')));
    }
  };

  /* ---------------- móveis ---------------- */
  const furniture = (): void => {
    const specs = specsOf();
    const stock = stockOf(s);
    if (stock.length) {
      list.appendChild(h('div', { class: 'stock-row', id: 'mk-stock' }, h('b', null, `Para montar (${stock.length})`),
        stock.map((it, i) => {
          const name = it.variant ? tryv(() => api.decorCatalog().find((d) => d.id === it.variant)?.name, undefined) ?? it.type : specs.find((f) => f.type === it.type)?.name ?? it.type;
          return h('div', { class: 'stock-item' }, h('span', { html: it.type === 'decor' ? decorSvg(it.variant ?? 'plant', 40) : furnitureSvg(it.type, 40) }), h('span', null, name),
            actionBtn({ kind: 'buy', label: 'Montar', onClick: () => startPlacing(kit, i, it, () => tab.close()) }));
        })));
    }
    const card = (key: string, name: string, cost: number, minLevel: number, art: string, info: string, line: () => api.CartLine, extraLock?: string): HTMLElement => {
      const locked = s.level < minLevel;
      return h('div', { class: `pcard${locked ? ' locked' : ''}`, role: 'listitem', 'data-furniture': key },
        h('div', { class: 'pc-l' }, h('b', { class: 'pc-name' }, name), h('span', { class: 'pc-sub' }, info), h('div', { class: 'pc-art' }, h('span', { html: art }))),
        h('div', { class: 'pc-r' }, h('div', { class: 'pc-price' }, money(cost)),
          locked ? actionBtn({ kind: 'lock', level: minLevel }) : extraLock ? actionBtn({ kind: 'off', label: extraLock }) : stepperEl(`f:${key}`, () => {}),
          locked || extraLock ? null : addBtn(line)));
    };
    const display = specs.filter((sp) => sp.categories.length > 0);
    const others = specs.filter((sp) => sp.categories.length === 0 && sp.type !== 'decor');
    if (display.length) list.appendChild(h('div', { class: 'grp' }, 'Expositores'));
    for (const sp of display) {
      const cats = sp.categories.map((c) => CATEGORY_NAME[c as Category] ?? c).join(', ');
      list.appendChild(card(sp.type, sp.name, sp.cost, sp.minLevel, furnitureSvg(sp.type, 66), `Aceita: ${cats}`,
        () => ({ kind: 'furniture', id: sp.type, qty: qty.get(`f:${sp.type}`) ?? 1 })));
    }
    if (others.length) list.appendChild(h('div', { class: 'grp' }, 'Loja e depósito'));
    for (const sp of others) {
      const info = sp.type === 'counter' ? 'Mais um caixa: atende mais clientes' : sp.type === 'rack' ? `Guarda ${sp.slots} caixas no depósito` : '';
      list.appendChild(card(sp.type, sp.name, sp.cost, sp.minLevel, furnitureSvg(sp.type, 66), info,
        () => ({ kind: 'furniture', id: sp.type, qty: qty.get(`f:${sp.type}`) ?? 1 }), sp.type === 'rack' && !s.storageUnlocked ? 'Requer depósito' : undefined));
    }
    const decor = tryv(() => api.decorCatalog(), [] as api.DecorItem[]);
    if (decor.length) list.appendChild(h('div', { class: 'grp' }, 'Decoração'));
    for (const d of decor) {
      list.appendChild(card(`decor:${d.id}`, d.name, d.cost, d.minLevel, decorSvg(d.id, 66), 'Decoração (sem produtos)',
        () => ({ kind: 'furniture', id: 'decor', variant: d.id, qty: qty.get(`f:decor:${d.id}`) ?? 1 })));
    }
  };

  const subBtn = (id: Sub, label: string): HTMLElement => h('button', { class: `subtab${sub === id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(sub === id), 'data-sub': id,
    on: { click: () => { if (sub !== id) { sub = id; tab.refresh(); } } } }, label);
  const sel = sub === 'products' ? h('select', { class: 'sel', 'aria-label': 'Categoria', on: { change: (e) => { filter = (e.target as HTMLSelectElement).value as Category | 'all'; scroll.products = 0; tab.refresh(); } } },
    h('option', { value: 'all', selected: filter === 'all' }, 'Todas as categorias'),
    LICENSES.filter((l) => s.licenses.includes(l.id)).map((l) => h('option', { value: l.id, selected: filter === l.id }, CATEGORY_NAME[l.id]))) : null;
  if (sub === 'products') products(); else furniture();
  renderCart();
  body.appendChild(h('div', { class: 'mk3' },
    h('div', { class: 'mk-left' }, h('div', { class: 'mk-top', role: 'tablist' }, subBtn('products', 'Produtos'), subBtn('furniture', 'Móveis'), sel), list),
    cartEl));
  list.scrollTop = scroll[sub];
}

/** "Encher prateleiras": simula `buyMissing` numa cópia (sem limite de dinheiro) e põe as caixas no carrinho. */
function fillShelves(kit: UiKit, renderCart: () => void): void {
  const s = kit.ctx.state;
  try {
    const c = structuredClone(s);
    c.money = Number.MAX_SAFE_INTEGER / 4;
    api.buyMissing(c, 1);
    const added = c.sidewalk.slice(s.sidewalk.length);
    const by = new Map<string, number>();
    for (const b of added) by.set(b.productId, (by.get(b.productId) ?? 0) + 1);
    if (!by.size) { kit.toast('As prateleiras já estão cheias (ou não há móvel para o produto).', 'info'); return; }
    let n = 0;
    for (const [id, q] of by) { addLine({ kind: 'product', id, qty: q }); n += q; }
    kit.toast(`${n} ${n > 1 ? 'caixas foram para' : 'caixa foi para'} o carrinho.`, 'good');
    kit.sfx('pop');
    renderCart();
  } catch (e) {
    kit.toast(e instanceof Error ? e.message : String(e), 'bad');
  }
}
