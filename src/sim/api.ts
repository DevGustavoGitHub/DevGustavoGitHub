/**
 * API pública da simulação para os módulos de jogo (world/player/npc/ui/audio).
 * ASSINATURAS CONGELADAS: o agente `sim` implementa os corpos; os demais já programam contra elas.
 * Todas as funções mutam `state` e lançam Error('mensagem pt-BR') em violação de regra
 * (dinheiro insuficiente, nível baixo, posição inválida...). Dinheiro sempre em centavos.
 */
import type { FurnitureType } from '../core/layout';
import type { Cents } from './money';
import type { DayReport } from './economy';
import type { Decor, Furniture, StoreState } from './state';

const todo = (n: string): never => { throw new Error(`NOT_IMPLEMENTED: ${n}`); };

/* ---------- Móveis / layout ---------- */
export interface FurnitureSpec { type: FurnitureType; name: string; cost: Cents; minLevel: number; slots: number; /** categorias aceitas (vazio = qualquer/nenhuma) */ categories: string[] }
export function furnitureCatalog(): FurnitureSpec[] { return todo('furnitureCatalog'); }
/** Footprint considerando rotação. Valida limites do salão (storeBounds), colisões, porta e passagem mínima. */
export function canPlace(state: StoreState, type: FurnitureType, x: number, z: number, rot: 0 | 90 | 180 | 270, ignoreId?: number): boolean { return todo('canPlace'); }
export function buyFurniture(state: StoreState, type: FurnitureType, x: number, z: number, rot: 0 | 90 | 180 | 270, productId?: string): Furniture { return todo('buyFurniture'); }
export function moveFurniture(state: StoreState, id: number, x: number, z: number, rot: 0 | 90 | 180 | 270): void { todo('moveFurniture'); }
/** Vende o móvel por 50% do custo; o estoque exposto volta para o depósito/calçada conforme regra do sim. */
export function sellFurniture(state: StoreState, id: number): Cents { return todo('sellFurniture'); }
/** Define qual produto o shelf/fridge/freezer expõe (validando categoria licenciada e tipo do móvel). */
export function assignProduct(state: StoreState, furnitureId: number, productId: string | undefined): void { todo('assignProduct'); }
/** Capacidade total de prateleira de um produto = soma dos móveis atribuídos a ele. state.slots deve ficar consistente. */
export function productCapacity(state: StoreState, productId: string): number { return todo('productCapacity'); }

/* ---------- Expansão / depósito ---------- */
export function expansionCost(state: StoreState): Cents | null { return todo('expansionCost'); }
export function expansionMinLevel(state: StoreState): number | null { return todo('expansionMinLevel'); }
export function buyExpansion(state: StoreState): void { todo('buyExpansion'); }
export function storageCost(): { cost: Cents; minLevel: number } { return todo('storageCost'); }
export function unlockStorage(state: StoreState): void { todo('unlockStorage'); }

/* ---------- Funcionários ---------- */
export type Role = 'cashier' | 'stocker' | 'janitor';
/** Custo de contratar (nível 0→1) ou evoluir (n→n+1); null se no nível máximo. Nível máx. 5. */
export function employeeCost(state: StoreState, role: Role): { cost: Cents; minLevel: number; dailyWage: Cents } | null { return todo('employeeCost'); }
export function hireOrUpgrade(state: StoreState, role: Role): void { todo('hireOrUpgrade'); }
/** Segundos reais que o funcionário leva por ação, por nível (usado pelo módulo npc). */
export function employeeSpeed(role: Role, level: number): number { return todo('employeeSpeed'); }

/* ---------- Personalização ---------- */
export function setStoreName(state: StoreState, name: string): void { todo('setStoreName'); }
export function setDecor(state: StoreState, d: Partial<Decor>): Cents { return todo('setDecor'); }

/* ---------- Caixas / estoque físico ---------- */
/** Compra e cria as caixas em state.sidewalk (x/z indefinidos). Retorna o custo. Alias de economy.buyBoxes com validação. */
export function orderBoxes(state: StoreState, productId: string, boxes: number): Cents { return todo('orderBoxes'); }
/** Move até n unidades da caixa para a prateleira do produto, respeitando productCapacity. Retorna quantas moveu. */
export function placeUnits(state: StoreState, boxIndex: number, n: number): number { return todo('placeUnits'); }
/** Descarta caixa VAZIA (units==0) na lixeira externa. */
export function discardBox(state: StoreState, boxIndex: number): void { todo('discardBox'); }
/** Move a caixa (inteira) para o depósito: soma state.storage[productId]; exige storageUnlocked. */
export function storeBox(state: StoreState, boxIndex: number): void { todo('storeBox'); }
/** Retira do depósito 1 caixa de `productId` (cria Box com carried=true se `carry`). */
export function takeFromStorage(state: StoreState, productId: string, carry: boolean): number { return todo('takeFromStorage'); }

/* ---------- Clientes e vendas ---------- */
/** Nº de chegadas previstas hoje (usa customersForDay com o RNG do dia). */
export function plannedArrivals(state: StoreState): number { return todo('plannedArrivals'); }
/** Lista de compras de um cliente (produtos desejados e qtd), sem ainda checar preço/estoque. */
export function makeShoppingList(state: StoreState, rand: () => number): { productId: string; qty: number }[] { return todo('makeShoppingList'); }
/** O cliente topa pagar o preço atual? (curva buyProbability). `ratio` devolvido p/ balão de reclamação. */
export function acceptsPrice(state: StoreState, productId: string, rand: () => number): { ok: boolean; ratio: number } { return todo('acceptsPrice'); }
/** Retira do estoque de prateleira ao cliente colocar no carrinho. Retorna qtd realmente retirada (pode ser < qty). */
export function takeFromShelf(state: StoreState, productId: string, qty: number): number { return todo('takeFromShelf'); }
export function returnToShelf(state: StoreState, productId: string, qty: number): void { todo('returnToShelf'); }
/** Total do carrinho ao preço de venda atual. */
export function basketTotal(state: StoreState, items: { productId: string; qty: number }[]): Cents { return todo('basketTotal'); }
/**
 * Fecha a venda: receita, COGS, XP, gorjeta, reputação do cliente. `speed` 0..1 (1 = muito rápido) escala a gorjeta;
 * `satisfaction` 1..5. Dinheiro entra no caixa imediatamente. Retorna {total, tip}.
 */
export function completeSale(state: StoreState, items: { productId: string; qty: number }[], speed: number, satisfaction: number): { total: Cents; tip: Cents } { return todo('completeSale'); }
/** Registra cliente que foi embora sem comprar / desistiu (afeta reputação e ledger.lost). */
export function recordLostCustomer(state: StoreState, satisfaction: number): void { todo('recordLostCustomer'); }

/* ---------- Sujeira ---------- */
export function addDirt(state: StoreState, x: number, z: number): void { todo('addDirt'); }
export function cleanDirt(state: StoreState, index: number): void { todo('cleanDirt'); }

/* ---------- Dia ---------- */
/** Encerra o dia: paga aluguel+salários, gera DayReport, avança mercado/dia, limpa ledger. (wrapper de economy.endDay) */
export function closeDay(state: StoreState): DayReport { return todo('closeDay'); }
/** Preço de atacado/mercado/venda do dia para exibição na UI. */
export function priceInfo(state: StoreState, productId: string): { wholesale: Cents; market: Cents; sell: Cents; cost: Cents } { return todo('priceInfo'); }
