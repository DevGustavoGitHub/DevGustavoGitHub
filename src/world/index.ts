/**
 * Módulo WORLD: cenário 3D em 1ª pessoa (Fase 3), móveis, caixas (abertas/fechadas), sujeira, grade de navegação,
 * alvos de interação (pickGroup + contorno), monitor do caixa, etiquetas de preço e posicionamento em 1ª pessoa.
 * Publica ctx.services.world (WorldService). Convenções: docs/CONTRACTS.md (seções "world" e "Fase 3 — world").
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '../core/module';
import type { PickInfo, Vec2, WorldService } from '../core/services';
import { doorPos, deliveryZone, storeBounds, trashBinPos, doorX, FURNITURE_FOOTPRINT, SIDEWALK_DEPTH, STORAGE_DEPTH, type Bounds } from '../core/layout';
import { DEFAULT_DECOR, type Box, type Decor, type Furniture, type StoreState } from '../sim/state';
import { PRODUCTS, productById } from '../sim/catalog';
import * as api from '../sim/api';
import { Shop } from './shop';
import { Env, TRASH_SILHOUETTE } from './env';
import {
  BELT_SLOTS, BELT_Y, DESK_SIZE, HANDOFF, SCANNER, SEAT, chairGeos, chairSilhouette, deskGeos, deskSilhouette, furnitureGeos,
  furnitureItems, makeDrawer, rackSlot, RACK_SLOTS, silhouetteOf, type SBox,
  isDisplayType, levelCountOf, levelGeoms, levelHeights, levelIndexAt, levelPids, levelVisible,
} from './furniture';
import { BoxLayer, ItemLayer, BOX_H, BOX_W, BOX_D, genericVisual, productVisual, makeProductMesh, makeBoxMesh, type BoxInst } from './products';
import { SHAPES } from './look';
import { combine, meshesOf } from './batch';
import { TIERS, ORDER, initialTier, isTier, isMobileDevice, persistTier, storedTier, type Tier } from './quality';
import { NavGrid, footprintOf } from './nav';
import { BuildMode } from './build';
import { hash01, localToWorld, makeCanvas, canvasTex, clearGroup, freezeSelf } from './kit';
import { Picks } from './pick';
import { CheckoutScreens, type Display } from './screens';
import { PriceTags } from './tags';
import { TipJars } from './tipjar';

/** Autoteste dos visuais genéricos (qualquer shape/cor/categoria, inclusive desconhecidos, gera geometria válida). */
function genericProductsSelfTest(): { ok: boolean; combos: number; bad: string[]; catalog: number } {
  const bad: string[] = [];
  let combos = 0;
  const shapes: (string | undefined)[] = [...SHAPES, undefined, 'forma-inexistente'];
  const cats = ['mercearia', 'hortifruti', 'higiene', 'frios', 'acougue', 'eletronicos', 'categoria-nova'];
  const colors: (string | undefined)[] = ['#d62828', '#3fb64f', undefined, 'nao-e-cor'];
  for (const shape of shapes) for (const category of cats) for (const color of colors) {
    combos++;
    const v = genericVisual({ shape, category, color } as unknown as Parameters<typeof genericVisual>[0]);
    const pos = v.geo.getAttribute('position');
    v.geo.computeBoundingBox();
    const bb = v.geo.boundingBox!;
    const fine = pos.count > 0 && Number.isFinite(bb.max.x + bb.min.y) && v.w > 0.05 && v.w < 0.4 && v.h > 0.05 && v.h < 0.4 && !!v.geo.getAttribute('color');
    if (!fine) bad.push(`${shape}/${category}/${color}`);
    v.geo.dispose();
  }
  for (const p of PRODUCTS) { const v = productVisual(p.id); if (!v.geo.getAttribute('position').count) bad.push(p.id); }
  if (productVisual('id-que-nao-existe').geo.getAttribute('position').count === 0) bad.push('unknown');
  return { ok: bad.length === 0, combos, bad, catalog: PRODUCTS.length };
}

/** Visão do estado usada para desenhar. No modo demo (?demo) e com estado vazio, usa dados locais que NUNCA são persistidos. */
interface View {
  furniture: Furniture[];
  shelf: Record<string, number>;
  slots: Record<string, number>;
  storage: Record<string, number>;
  sidewalk: Box[];
  dirt: { x: number; z: number }[];
}

function demoView(b: Bounds, storage: boolean): View {
  const W = b.width;
  const f = (id: number, type: Furniture['type'], x: number, z: number, rot: Furniture['rot'], productId?: string, variant?: string): Furniture => ({ id, type, x, z, rot, productId, variant });
  const furniture: Furniture[] = [
    f(1, 'shelf', 1, 0, 0, 'arroz'), f(2, 'shelf', 3, 0, 0, 'feijao'), f(3, 'shelf', 5, 0, 0, 'macarrao'), f(4, 'shelf', 7, 0, 0, 'cafe'),
    f(5, 'shelf', 1, 4, 180, 'pao'), f(6, 'shelf', 1, 5, 0, 'detergente'), f(7, 'shelf', 4, 4, 180, 'agua'), f(8, 'shelf', 4, 5, 0, 'leite'),
    f(9, 'fridge', W - 1, 1, 270, 'refri'), f(10, 'freezer', W - 1, 4, 270, 'sorvete'), f(11, 'fridge', 9, 0, 0, 'queijo'),
    f(12, 'counter', 7, 3, 0), f(13, 'decor', 0, b.depth - 1, 0, undefined, 'plant'), f(14, 'decor', 3, b.depth - 1, 0, undefined, 'banner'),
    f(15, 'decor', W - 1, b.depth - 1, 0, undefined, 'tree'),
  ];
  if (storage) furniture.push(f(16, 'rack', 1, -5, 0), f(17, 'rack', 4, -5, 0), f(18, 'rack', W - 3, -2, 180));
  return {
    furniture,
    shelf: { arroz: 14, feijao: 10, macarrao: 6, cafe: 18, refri: 16, sorvete: 2, pao: 15, detergente: 5, agua: 9, leite: 12, queijo: 3 },
    slots: { arroz: 2, feijao: 2, macarrao: 2, cafe: 2, refri: 2, sorvete: 2, pao: 2, detergente: 2, agua: 2, leite: 2, queijo: 2 },
    storage: storage ? { arroz: 18, refri: 14, leite: 30, feijao: 5 } : {},
    sidewalk: [
      { productId: 'arroz', units: 6 }, { productId: 'feijao', units: 12, open: true }, { productId: 'refri', units: 3, open: true }, { productId: 'leite', units: 12 },
      { productId: 'cafe', units: 0, open: true }, { productId: 'macarrao', units: 20 }, { productId: 'agua', units: 12 },
    ],
    dirt: [{ x: 3.4, z: 3.2 }, { x: 5.2, z: 7.1 }, { x: 9.6, z: 6.6 }, { x: 2.1, z: 8.4 }],
  };
}

/* Hash numérico SEM alocação (FNV-1a) do que a sincronização lê: se não mudou, `sync` sai sem montar chaves/strings. */
let H = 0;
const hInt = (n: number): void => { H = Math.imul(H ^ (n | 0), 16777619); };
const hNum = (n: number | undefined): void => { hInt(typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1024) : -7); };
const hStr = (t: string | undefined): void => { if (typeof t !== 'string') { hInt(-3); return; } for (let i = 0; i < t.length; i++) hInt(t.charCodeAt(i)); hInt(t.length); };
function stateHash(s: StoreState, extra: number): number {
  H = 0x811c9dc5 | 0;
  hInt(extra); hNum(s.expansion); hInt(s.storageUnlocked ? 1 : 0);
  hStr(s.decor?.wallColor); hStr(s.decor?.floorColor); hStr(s.decor?.signColor); hStr(s.storeName);
  const fs = s.furniture;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]!;
    hInt(f.id); hStr(f.type); hNum(f.x); hNum(f.z); hNum(f.rot); hStr(f.variant); hStr(f.productId);
    const lv = f.levels;
    if (Array.isArray(lv)) { hInt(lv.length); for (let j = 0; j < lv.length; j++) { hStr(lv[j]?.productId); hNum(lv[j]?.units); } }
    else if (f.productId) { hNum(s.shelf[f.productId]); hNum(s.slots[f.productId]); }
  }
  for (let i = 0; i < PRODUCTS.length; i++) { const id = PRODUCTS[i]!.id; hNum(s.storage[id]); hNum(s.prices[id]); hNum(s.market[id]); }
  const sw = s.sidewalk;
  for (let i = 0; i < sw.length; i++) { const b = sw[i]!; hStr(b.productId); hNum(b.units); hNum(b.x); hNum(b.z); hNum(b.rot); hInt((b.carried ? 1 : 0) + (b.open ? 2 : 0)); }
  const d = s.dirt;
  for (let i = 0; i < d.length; i++) { hNum(d[i]!.x); hNum(d[i]!.z); }
  return H;
}
/** Hash só das entradas de preço (prices/market): etiquetas recalculam `priceInfo` apenas quando muda. */
function priceHash(s: StoreState): number {
  H = 0x2c1b3c6d | 0;
  for (let i = 0; i < PRODUCTS.length; i++) { const id = PRODUCTS[i]!.id; hNum(s.prices[id]); hNum(s.market[id]); }
  return H;
}

/** Cores legadas (saves antigos) → paleta da Fase 3 (parede azul-clara, piso de madeira). */
function effectiveDecor(d: Decor): Decor {
  return {
    wallColor: d.wallColor === '#f2e8d5' || d.wallColor === '#bfe1f2' ? DEFAULT_DECOR.wallColor : d.wallColor,
    floorColor: d.floorColor === '#c9c4b8' ? DEFAULT_DECOR.floorColor : d.floorColor,
    signColor: d.signColor,
  };
}

export default function create(): GameModule {
  let ctx!: GameContext;
  const tipJars = new TipJars();
  const root = new THREE.Group(); root.name = 'world';
  let shop!: Shop; let env!: Env;
  const furniGroup = new THREE.Group(); furniGroup.name = 'furniture';
  const itemLayer = new ItemLayer(); itemLayer.group.name = 'items';
  const boxLayer = new BoxLayer(itemLayer); boxLayer.group.name = 'boxes';
  const furniStatic = new THREE.Group(); furniStatic.name = 'furnitureStatic';
  const deskGroup = new THREE.Group(); deskGroup.name = 'computerDesk';
  const nav = new NavGrid();
  const screens = new CheckoutScreens();
  const tags = new PriceTags();
  let picks!: Picks;
  let build!: BuildMode;
  let demo = false;
  let demoCache: { key: string; v: View } | null = null;

  /** Cada móvel tem um grupo (gaveta e tela do balcão); a casca estática de TODOS é fundida em poucas malhas. */
  interface Entry { geoSig: string; group: THREE.Group; drawer?: THREE.Mesh; drawerBaseZ: number; drawerT: number }
  const entries = new Map<number, Entry>();
  let furniKey = '', itemsKey = '';
  const staticGeos: THREE.BufferGeometry[] = [];
  let hiddenId: number | null = null;
  let bounds: Bounds = storeBounds(0);
  let shellKey = '', decorKey = '', navKey = '', rackKey = '', boxKey = '', dirtKey = '';
  let picksDirty = true;
  let acc = 0;
  /** Perfil de CPU opt-in (`__world.profile(true)` liga/zera; `__world.profile()` lê médias em ms). Desligado = só um teste de booleano. */
  const prof = { on: false, t0: 0, frames: 0, upd: 0, sync: 0, syncs: 0, ev: 0, evs: 0, prices: 0, pricesN: 0, env: 0, max: 0 };
  const pnow = (): number => (prof.on ? performance.now() : 0);
  const sec: Record<string, number> = {};
  const lap = (k: string, t0: number): void => { if (prof.on) sec[k] = (sec[k] ?? 0) + performance.now() - t0; };
  let doorTimer = 0, drawerAnim = false;
  let doorAt: Vec2 = doorPos(bounds);
  let lastMinute = -1;
  const offs: (() => void)[] = [];
  /** Cadeiras desenhadas (balcões com o tile do operador livre). */
  const chairs = new Set<number>();
  /** Balcão do computador: tile ocupado e pose. */
  let desk: { tx: number; tz: number; x: number; z: number; ry: number } | null = null;
  /** Caixas no chão desenhadas: índice em state.sidewalk + pose (pick/contorno/empilhamento). */
  let boxLayout: { index: number; box: Box; x: number; y: number; z: number; ry: number; open: boolean }[] = [];
  const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

  /* ---------------- sujeira ---------------- */
  let dirtMesh: THREE.InstancedMesh | null = null;
  let dirtTex: THREE.CanvasTexture | null = null;
  let dirtMat: THREE.MeshBasicMaterial | null = null;
  let dirtGeo: THREE.PlaneGeometry | null = null;
  const DIRT_CAP = 200;
  function initDirt(): void {
    const { c, g } = makeCanvas(64, 64);
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 20 + hash01(i, 5) * 9;
      const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.fill();
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(8 + hash01(i, 8) * 48, 8 + hash01(i, 9) * 48, 2 + hash01(i, 3) * 3, 0, 7); g.fill(); }
    dirtTex = canvasTex(c);
    dirtGeo = new THREE.PlaneGeometry(0.62, 0.62); dirtGeo.rotateX(-Math.PI / 2);
    dirtMat = new THREE.MeshBasicMaterial({ map: dirtTex, transparent: true, opacity: 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, color: 0xffffff });
    dirtMesh = new THREE.InstancedMesh(dirtGeo, dirtMat, DIRT_CAP);
    dirtMesh.count = 0; dirtMesh.frustumCulled = false; dirtMesh.renderOrder = 2;
    root.add(dirtMesh);
  }
  const dirtObj = new THREE.Object3D(), dirtCol = new THREE.Color();
  function syncDirt(v: View): void {
    if (!dirtMesh) return;
    const n = Math.min(DIRT_CAP, v.dirt.length);
    for (let i = 0; i < n; i++) {
      const d = v.dirt[i]!;
      const s = 0.7 + hash01(i, 1, Math.round(d.x * 10)) * 0.8;
      dirtObj.position.set(d.x, 0.024 + (i % 9) * 0.0012, d.z);
      dirtObj.rotation.set(0, hash01(i, 2) * 6.28, 0); dirtObj.scale.set(s, 1, s * (0.7 + hash01(i, 3) * 0.4)); dirtObj.updateMatrix();
      dirtMesh.setMatrixAt(i, dirtObj.matrix);
      dirtMesh.setColorAt(i, dirtCol.setHex([0x6a4a2f, 0x55402c, 0x7a5a38, 0x3d5a3a][i % 4]!));
    }
    dirtMesh.count = n;
    dirtMesh.instanceMatrix.needsUpdate = true;
    if (dirtMesh.instanceColor) dirtMesh.instanceColor.needsUpdate = true;
  }

  /* ---------------- estado (visão) ---------------- */
  function view(): View {
    const s = ctx.state;
    if (demo && s.furniture.length === 0) {
      const key = `${bounds.width}|${s.storageUnlocked}`;
      if (!demoCache || demoCache.key !== key) demoCache = { key, v: demoView(bounds, s.storageUnlocked) };
      return demoCache.v;
    }
    return { furniture: s.furniture, shelf: s.shelf, slots: s.slots, storage: s.storage, sidewalk: s.sidewalk, dirt: s.dirt };
  }

  function fillFraction(v: View, f: Furniture): number {
    const p = f.productId;
    if (!p) return 0;
    const qty = v.shelf[p] ?? 0;
    if (qty <= 0) return 0;
    let cap = 0;
    try { cap = (v.slots[p] ?? 0) * productById(p).slotCapacity; } catch { /* produto desconhecido */ }
    if (cap <= 0) cap = qty;
    return Math.min(1, qty / cap);
  }

  /* ---------------- níveis (Fase 4) ---------------- */
  interface LevelView { pid?: string; units: number; fill: number }
  /** Níveis do móvel para desenhar: `Furniture.levels` (fonte da verdade: produto e unidades POR NÍVEL; fill = units /
   *  slotCapacity). Reserva sem `levels` (save/sim antigo): todos os níveis com o produto do móvel e a fração do estoque somado. */
  function levelsOf(v: View, f: Furniture): LevelView[] {
    if (!isDisplayType(f.type)) return [];
    const raw = Array.isArray(f.levels) && f.levels.length ? f.levels : null;
    const legacy = raw ? 0 : fillFraction(v, f);
    return levelPids(f).map((pid, i): LevelView => {
      if (!pid) return { units: 0, fill: 0 };
      let cap = 0;
      try { cap = productById(pid).slotCapacity; } catch { /* produto desconhecido */ }
      if (!raw) return { pid, units: Math.round(legacy * cap), fill: legacy };
      const u = Number(raw[i]?.units);
      const units = Number.isFinite(u) && u > 0 ? u : 0;
      return { pid, units, fill: units > 0 ? Math.min(1, units / (cap > 0 ? cap : units)) : 0 };
    });
  }
  const LM = new THREE.Matrix4(), LI = new THREE.Matrix4(), LP = new THREE.Vector3();
  function levelAt(id: number, point: THREE.Vector3): number | null {
    const f = view().furniture.find((x) => x.id === id);
    if (!f || !isDisplayType(f.type) || !point) return null;
    LP.copy(point).applyMatrix4(LI.copy(furnitureMatrix(f, LM)).invert());
    return levelIndexAt(f.type, levelCountOf(f), LP.x, LP.y, LP.z);
  }
  /** Região (caixa local) do nível para o contorno de destaque. */
  function levelBoxes(p: PickInfo): SBox[] | null {
    if (p.kind !== 'furniture' || p.id === undefined || p.level === undefined) return null;
    const f = view().furniture.find((x) => x.id === p.id);
    const g = f ? levelGeoms(f.type, levelCountOf(f))[p.level] : undefined;
    return g ? [g.box] : null;
  }

  /* ---------------- móveis ---------------- */
  function centerOf(f: Furniture): { cx: number; cz: number } {
    const fp = footprintOf(f);
    return { cx: f.x + fp.w / 2, cz: f.z + fp.d / 2 };
  }
  /** Matriz de mundo do móvel (centro do footprint, rotação). */
  function furnitureMatrix(f: Furniture, out: THREE.Matrix4): THREE.Matrix4 {
    const { cx, cz } = centerOf(f);
    return out.compose(P.set(cx, 0.01, cz), Q.setFromAxisAngle(UP, (f.rot * Math.PI) / 180), ONE);
  }
  /** Tiles ocupados por móveis (chave x,z). */
  function occupied(v: View): Set<string> {
    const s = new Set<string>();
    for (const f of v.furniture) { const fp = footprintOf(f); for (let i = 0; i < fp.w; i++) for (let j = 0; j < fp.d; j++) s.add(`${f.x + i},${f.z + j}`); }
    return s;
  }

  function syncFurniture(v: View): void {
    const seen = new Set<number>();
    let geoChanged = false;
    for (const f of v.furniture) {
      seen.add(f.id);
      const geoSig = `${f.type}|${f.x}|${f.z}|${f.rot}`;
      let e = entries.get(f.id);
      if (e && e.geoSig === geoSig) continue;
      if (e) furniGroup.remove(e.group);
      geoChanged = true;
      const group = new THREE.Group();
      const { cx, cz } = centerOf(f);
      group.position.set(cx, 0.01, cz);
      group.rotation.y = (f.rot * Math.PI) / 180;
      group.userData.furnitureId = f.id;
      freezeSelf(group); // a gaveta (filho) continua animada
      e = { geoSig, group, drawerBaseZ: 0, drawerT: 0 };
      if (f.type === 'counter') {
        const d = makeDrawer(group); d.drawer.renderOrder = 2;
        e.drawer = d.drawer; e.drawerBaseZ = d.baseZ;
        screens.attach(f.id, group);
      }
      group.visible = f.id !== hiddenId;
      furniGroup.add(group);
      entries.set(f.id, e);
    }
    for (const [id, e] of entries) {
      if (seen.has(id)) continue;
      furniGroup.remove(e.group); entries.delete(id); geoChanged = true;
    }
    screens.prune(new Set(v.furniture.filter((f) => f.type === 'counter').map((f) => f.id)));
    const cg = new Map<number, THREE.Object3D>();
    for (const f of v.furniture) if (f.type === 'counter') { const en = entries.get(f.id); if (en) cg.set(f.id, en.group); }
    tipJars.sync(ctx.state.upgrades.includes('tipjar'), cg);
    const lvls = new Map<number, LevelView[]>();
    for (const f of v.furniture) if (isDisplayType(f.type)) lvls.set(f.id, levelsOf(v, f));
    const lp = (f: Furniture): string => (lvls.get(f.id) ?? []).map((l) => l.pid ?? '').join('/');
    const fk = `${hiddenId ?? ''}|${bounds.width}x${bounds.depth}|${ctx.state.storageUnlocked}|` + v.furniture.map((f) => `${f.id}:${f.type}:${f.x}:${f.z}:${f.rot}:${lp(f)}:${f.variant ?? ''}`).join(',');
    if (fk !== furniKey) {
      furniKey = fk;
      placeDesk(v);
      const t = pnow(); rebuildStatic(v, lvls); lap('static', t);
      picksDirty = true;
    }
    // etiquetas por nível (a malha só é refeita quando produto/esgotado de algum nível muda)
    tags.rebuild(v.furniture.filter((f) => f.id !== hiddenId && lvls.has(f.id)).map((f) => ({ f, levels: lvls.get(f.id)!.map((l) => ({ pid: l.pid, empty: !(l.fill > 0) })) })));
    const ik = fk + '|' + v.furniture.map((f) => (lvls.get(f.id) ?? []).map((l, i, a) => levelVisible(f.type, a.length, i, l.pid, l.fill)).join('/')).join(',');
    if (ik !== itemsKey) { itemsKey = ik; const t = pnow(); rebuildItems(v, lvls); lap('items', t); }
    const nk = `${bounds.width}x${bounds.depth}|${ctx.state.storageUnlocked}|${desk ? `${desk.tx},${desk.tz}` : '-'}|` + v.furniture.map((f) => `${f.id}:${f.type}:${f.x}:${f.z}:${f.rot}`).join(',');
    if (geoChanged || nk !== navKey) { navKey = nk; rebuildNav(v); }
  }
  function rebuildStatic(v: View, lvls: Map<number, LevelView[]>): void {
    for (const m of [...furniStatic.children]) furniStatic.remove(m);
    staticGeos.forEach((g) => g.dispose()); staticGeos.length = 0;
    const occ = occupied(v);
    chairs.clear();
    const parts: { geos: ReturnType<typeof furnitureGeos>; matrix: THREE.Matrix4 }[] = [];
    for (const f of v.furniture) {
      if (f.id === hiddenId) continue;
      furnitureMatrix(f, M);
      parts.push({ geos: furnitureGeos(f, lvls.get(f.id)?.map((l) => l.pid)), matrix: M.clone() });
      if (f.type === 'counter') {
        const { cx, cz } = centerOf(f);
        const op = localToWorld(cx, cz, f.rot, SEAT.x, SEAT.z);
        const tx = Math.floor(op.x), tz = Math.floor(op.z);
        if (!occ.has(`${tx},${tz}`) && tx >= 0 && tx < bounds.width && tz >= (ctx.state.storageUnlocked ? -STORAGE_DEPTH : 0) && tz < bounds.depth) {
          chairs.add(f.id);
          parts.push({ geos: chairGeos(), matrix: M.clone().multiply(M2.makeTranslation(SEAT.x, 0, SEAT.z)) });
        }
      }
    }
    const merged = combine(parts);
    for (const mesh of meshesOf(merged, furniStatic, { order: 2 })) { staticGeos.push(mesh.geometry); freezeSelf(mesh); }
  }
  /** Itens expostos POR NÍVEL (cada nível só com o seu produto), 1 InstancedMesh por produto na ItemLayer. */
  function rebuildItems(v: View, lvls: Map<number, LevelView[]>): void {
    const by = new Map<string, number[]>();
    for (const f of v.furniture) {
      const lv = lvls.get(f.id);
      if (f.id === hiddenId || !lv) continue;
      const { cx, cz } = centerOf(f);
      furnitureItems(f, lv, cx, cz, by);
    }
    itemLayer.setSource('furniture', by);
  }
  function rebuildNav(v: View): void {
    nav.build(bounds, ctx.state.storageUnlocked, v.furniture, desk ? [...env.blocked, { x: desk.tx, z: desk.tz }] : env.blocked);
    picksDirty = true;
  }

  /** Balcão do computador: 1º tile livre junto à parede (frente: ao lado da antessala da porta; depois laterais). */
  function placeDesk(v: View): void {
    const W = bounds.width, D = bounds.depth, dx = doorX(bounds);
    const occ = occupied(v);
    const reserved = new Set<string>();
    for (const zz of [D - 1, D - 2]) for (const xx of [dx - 1, dx]) reserved.add(`${xx},${zz}`);
    for (const f of v.furniture) {
      const { cx, cz } = centerOf(f);
      const fp = FURNITURE_FOOTPRINT[f.type];
      const fy = fp.d / 2 + 0.5;
      const near: [number, number][] = f.type === 'counter'
        ? [[SEAT.x, SEAT.z], [SEAT.x - 1, SEAT.z], [-0.5, fy], [0.5, fy], [-0.5, fy + 1]]
        : [[-0.5, fy], [0.5, fy]];
      for (const [lx, lz] of near) { const w = localToWorld(cx, cz, f.rot, lx, lz); reserved.add(`${Math.floor(w.x)},${Math.floor(w.z)}`); }
    }
    const free = (x: number, z: number): boolean => x >= 0 && x < W && z >= 0 && z < D && !occ.has(`${x},${z}`) && !reserved.has(`${x},${z}`);
    const cands: { tx: number; tz: number; wall: 'front' | 'left' | 'right' }[] = [];
    for (let k = 0; k < W; k++) {
      const left = dx - 2 - k, right = dx + 1 + k;
      if (left >= 0) cands.push({ tx: left, tz: D - 1, wall: 'front' });
      if (right < W) cands.push({ tx: right, tz: D - 1, wall: 'front' });
    }
    for (let z = D - 2; z >= 1; z--) { cands.push({ tx: 0, tz: z, wall: 'left' }); cands.push({ tx: W - 1, tz: z, wall: 'right' }); }
    const c = cands.find((q) => free(q.tx, q.tz));
    if (!c) { desk = null; deskGroup.visible = false; return; }
    const h = DESK_SIZE.d / 2 + 0.01;
    desk = c.wall === 'front' ? { tx: c.tx, tz: c.tz, x: c.tx + 0.5, z: D - h, ry: Math.PI }
      : c.wall === 'left' ? { tx: c.tx, tz: c.tz, x: h, z: c.tz + 0.5, ry: Math.PI / 2 }
      : { tx: c.tx, tz: c.tz, x: W - h, z: c.tz + 0.5, ry: -Math.PI / 2 };
    if (!deskGroup.children.length) for (const m of meshesOf(deskGeos(), deskGroup, { order: 2 })) freezeSelf(m);
    deskGroup.position.set(desk.x, 0.01, desk.z);
    deskGroup.rotation.y = desk.ry;
    deskGroup.updateMatrix();
    deskGroup.visible = true;
  }

  /* ---------------- caixas no chão e em racks ---------------- */
  function pickFreeSpot(boxes: Box[], self: Box): { x: number; z: number } {
    const dz = deliveryZone(bounds);
    const cols = Math.max(1, Math.floor(dz.w / 0.85)), rows = Math.max(1, Math.floor(dz.d / 0.85));
    let best = { x: dz.x + 0.5, z: dz.z + 0.5 }, bestN = 1e9;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = dz.x + (c + 0.5) * (dz.w / cols), z = dz.z + (r + 0.5) * (dz.d / rows);
      let n = 0;
      for (const o of boxes) if (o !== self && !o.carried && o.x !== undefined && o.z !== undefined && Math.abs(o.x - x) < 0.4 && Math.abs(o.z - z) < 0.4) n++;
      if (n < bestN) { bestN = n; best = { x, z }; if (n === 0) return best; }
    }
    return best;
  }

  function syncBoxes(v: View): void {
    for (const b of v.sidewalk) {
      if (b.carried) continue;
      if (b.x === undefined || b.z === undefined) { const p = pickFreeSpot(v.sidewalk, b); b.x = p.x; b.z = p.z; }
    }
    const list: BoxInst[] = [];
    boxLayout = [];
    for (let i = 0; i < v.sidewalk.length; i++) {
      const b = v.sidewalk[i]!;
      if (b.carried || b.x === undefined || b.z === undefined) continue;
      let lvl = 0;
      for (const o of boxLayout) if (Math.abs(o.x - b.x) < 0.3 && Math.abs(o.z - b.z) < 0.3) lvl++;
      let size = 12;
      try { size = productById(b.productId).boxSize; } catch { /* */ }
      const ry = Number.isFinite(b.rot) ? (b.rot as number) : (hash01(Math.round(b.x * 10), Math.round(b.z * 10), lvl) - 0.5) * 0.5;
      const open = b.open === true;
      list.push({ pid: b.productId, x: b.x, y: lvl * BOX_H, z: b.z, ry, open, fill: Math.max(0, Math.min(1, b.units / size)) });
      boxLayout.push({ index: i, box: b, x: b.x, y: lvl * BOX_H, z: b.z, ry, open });
    }
    boxLayer.setSource('floor', list);
    picksDirty = true;
  }
  const boxSigOf = (v: View): string => v.sidewalk.map((b) => `${b.productId}:${b.units}:${b.x ?? '-'}:${b.z ?? '-'}:${b.carried ? 1 : 0}:${b.open ? 1 : 0}:${b.rot ?? ''}`).join(',');

  function syncRackBoxes(v: View): void {
    const racks = v.furniture.filter((f) => f.type === 'rack').sort((a, b) => a.id - b.id);
    const list: BoxInst[] = [];
    const queue: { pid: string; open: boolean; fill: number }[] = [];
    for (const p of PRODUCTS) {
      const units = v.storage[p.id] ?? 0;
      if (units <= 0) continue;
      const full = Math.floor(units / p.boxSize), rem = units % p.boxSize;
      for (let i = 0; i < full; i++) queue.push({ pid: p.id, open: false, fill: 1 });
      if (rem > 0) queue.push({ pid: p.id, open: true, fill: rem / p.boxSize });
    }
    let k = 0;
    for (const r of racks) {
      const { cx, cz } = centerOf(r);
      for (let s = 0; s < RACK_SLOTS && k < queue.length; s++, k++) {
        const q = queue[k]!;
        const sl = rackSlot(s);
        const w = localToWorld(cx, cz, r.rot, sl.x, sl.z);
        list.push({ pid: q.pid, x: w.x, y: sl.y, z: w.z, ry: (r.rot * Math.PI) / 180 + (hash01(k, 3) - 0.5) * 0.08, open: q.open, fill: q.fill });
      }
    }
    boxLayer.setSource('rack', list);
  }

  /** Altura da pilha onde uma caixa seria largada (empilha a < 0,3 m de outra), ignorando `self`. */
  function stackHeight(x: number, z: number, self: Box | null): number {
    let lvl = 0;
    for (const o of boxLayout) if (o.box !== self && Math.abs(o.x - x) < 0.3 && Math.abs(o.z - z) < 0.3) lvl++;
    return lvl * BOX_H;
  }

  /* ---------------- alvos de interação ---------------- */
  const T = (x: number, y: number, z: number, ry = 0): THREE.Matrix4 => M.compose(P.set(x, y, z), Q.setFromAxisAngle(UP, ry), ONE);
  const BOX_CLOSED: SBox[] = [[0, BOX_H / 2, 0, BOX_W, BOX_H, BOX_D]];
  const BOX_OPEN: SBox[] = [[0, BOX_H / 2, 0, BOX_W, BOX_H, BOX_D], [0, BOX_H + 0.07, 0, BOX_W + 0.16, 0.14, BOX_D + 0.16]];
  const DIRT_SIL: SBox[] = [[0, 0.04, 0, 0.62, 0.08, 0.62]];
  function rebuildPicks(v: View): void {
    picksDirty = false;
    picks.begin();
    for (const f of v.furniture) {
      if (f.id === hiddenId) continue;
      furnitureMatrix(f, M2);
      picks.add({ kind: 'furniture', id: f.id }, silhouetteOf(f), M2);
      if (f.type === 'counter' && chairs.has(f.id)) picks.add({ kind: 'seat', id: f.id }, chairSilhouette(), M2.multiply(M.makeTranslation(SEAT.x, 0, SEAT.z)));
    }
    for (const b of boxLayout) picks.add({ kind: 'box', id: b.index }, b.open ? BOX_OPEN : BOX_CLOSED, T(b.x, b.y, b.z, b.ry));
    v.dirt.forEach((d, i) => picks.add({ kind: 'dirt', id: i }, DIRT_SIL, T(d.x, 0, d.z)));
    const tb = trashBinPos(bounds);
    picks.add({ kind: 'trash' }, TRASH_SILHOUETTE, T(tb.x, 0, tb.z));
    const sg = shop.signBox;
    picks.add({ kind: 'sign' }, [[0, 0, 0, sg.w, sg.h, sg.d]], T(sg.x, sg.y, sg.z));
    if (desk) picks.add({ kind: 'computer' }, deskSilhouette(), T(desk.x, 0.01, desk.z, desk.ry));
    const sd = shop.storageDoorBox;
    if (sd) picks.add({ kind: 'storageDoor' }, [[0, 0, 0, sd.w, sd.h, sd.d]], T(sd.x, sd.y, sd.z));
    picks.end();
  }

  /* ---------------- etiquetas de preço ---------------- */
  const priceCache = new Map<string, number>();
  function refreshPrices(): void {
    const t0 = pnow();
    for (const p of PRODUCTS) { try { priceCache.set(p.id, api.priceInfo(ctx.state, p.id).sell); } catch { /* sim antigo */ } }
    if (prof.on) { prof.prices += performance.now() - t0; prof.pricesN++; }
  }
  const displayPids = new Set<string>();
  function refreshTags(v: View): void {
    displayPids.clear();
    for (const f of v.furniture) for (const p of levelPids(f)) if (p) displayPids.add(p);
    tags.refresh(displayPids, (pid) => priceCache.get(pid) ?? 0);
  }

  /* ---------------- sincronização geral ---------------- */
  function sync(force = false): void {
    const t0 = pnow();
    syncInner(force);
    if (prof.on) { prof.sync += performance.now() - t0; prof.syncs++; }
  }
  let lastHash = 0, lastPriceHash = 0;
  function syncInner(force: boolean): void {
    const s: StoreState = ctx.state;
    const extra = (demo ? 1 : 0) + ((hiddenId ?? -1) + 2) * 4;
    if (!force && !picksDirty && stateHash(s, extra) === lastHash) return; // nada mudou: sem alocações
    const nb = storeBounds(s.expansion);
    const dec = effectiveDecor(s.decor);
    const sk = `${s.expansion}|${s.storageUnlocked}`;
    const dk = `${dec.wallColor}|${dec.floorColor}|${dec.signColor}|${s.storeName}`;
    if (force || sk !== shellKey) {
      shellKey = sk; bounds = nb; doorAt = doorPos(bounds);
      env.rebuild(bounds);
      shop.rebuild(bounds, s.storageUnlocked, dec, s.storeName);
      decorKey = dk;
      env.setTime(ctx.clock.minute, true);
      navKey = ''; rackKey = ''; boxKey = ''; furniKey = ''; demoCache = null; picksDirty = true;
    }
    if (dk !== decorKey) {
      const nameChanged = !decorKey.endsWith(`|${s.storeName}`);
      decorKey = dk;
      if (shop.setDecor(dec) || nameChanged) { shop.rebuild(bounds, s.storageUnlocked, dec, s.storeName); picksDirty = true; }
    }
    const v = view();
    let t = pnow(); syncFurniture(v); lap('furn', t);
    const rk = v.furniture.filter((f) => f.type === 'rack').map((f) => `${f.id}:${f.x}:${f.z}:${f.rot}`).join(',') + '|' + PRODUCTS.map((p) => v.storage[p.id] ?? 0).join(',');
    if (rk !== rackKey) { rackKey = rk; syncRackBoxes(v); }
    const bk = boxSigOf(v);
    t = pnow();
    if (bk !== boxKey) { boxKey = bk; syncBoxes(v); boxKey = boxSigOf(v); }
    lap('boxes', t);
    const dsk = v.dirt.map((d) => `${d.x.toFixed(2)},${d.z.toFixed(2)}`).join(';');
    if (dsk !== dirtKey) { dirtKey = dsk; syncDirt(v); picksDirty = true; }
    const ph = priceHash(s);
    if (force || ph !== lastPriceHash || !priceCache.size) { lastPriceHash = ph; refreshPrices(); }
    t = pnow(); refreshTags(v); lap('tagsRefresh', t);
    t = pnow(); if (picksDirty) rebuildPicks(v); lap('picks', t);
    lastHash = stateHash(s, extra); // depois: syncBoxes grava x/z nas caixas
  }

  /* ---------------- WorldService ---------------- */
  const tileC = (x: number, z: number): Vec2 => ({ x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5 });
  function access(f: Furniture): Vec2 | null {
    const { cx, cz } = centerOf(f);
    const fp = FURNITURE_FOOTPRINT[f.type];
    const cands: [number, number][] = [];
    const fy = fp.d / 2 + 0.5;
    cands.push([-0.5, fy], [0.5, fy], [-0.5, -fy], [0.5, -fy]);
    if (f.type === 'counter') { cands.length = 0; cands.push([-0.5, fy], [0.5, fy]); }
    for (const [lx, lz] of cands) {
      const w = localToWorld(cx, cz, f.rot, lx, lz);
      const t = tileC(w.x, w.z);
      if (nav.isWalkable(t.x, t.z)) return t;
    }
    return null;
  }
  const counterById = (id: number): Furniture | undefined => view().furniture.find((f) => f.id === id && f.type === 'counter');
  /** Ponto local do balcão → mundo (Vector3 novo). */
  const counterPoint = (f: Furniture, lx: number, ly: number, lz: number): THREE.Vector3 => new THREE.Vector3(lx, ly, lz).applyMatrix4(furnitureMatrix(f, M2));
  const service: WorldService = {
    findPath: (from, to) => nav.findPath(from, to),
    isWalkable: (x, z) => nav.isWalkable(x, z),
    furnitureAccess: (id) => { const f = view().furniture.find((x) => x.id === id); return f ? access(f) : null; },
    counters: () => view().furniture.filter((f) => f.type === 'counter').map((f) => {
      const { cx, cz } = centerOf(f);
      const op = localToWorld(cx, cz, f.rot, 0.5, -1.5);
      const queue: Vec2[] = [];
      for (let i = 0; i < 8; i++) {
        const q = localToWorld(cx, cz, f.rot, -0.5, 1.5 + i);
        const t = tileC(q.x, q.z);
        if (!nav.isWalkable(t.x, t.z) || t.z >= bounds.depth) break; // fila só dentro do salão
        queue.push(t);
      }
      return { furnitureId: f.id, operator: tileC(op.x, op.z), queue, scanner: localToWorld(cx, cz, f.rot, SCANNER[0], SCANNER[1]) };
    }),
    spawnPoint: () => ({ x: Math.floor(doorPos(bounds).x - 5) + 0.5, z: bounds.depth + SIDEWALK_DEPTH + 0.5 }),
    trashBin: () => trashBinPos(bounds),
    door: () => doorPos(bounds),
    group: root,
    /* ---- Fase 3 ---- */
    get pickGroup() { return picks.group; },
    highlight: (p) => picks.highlight(p),
    seatPose: (id) => {
      const f = counterById(id);
      if (!f) return null;
      return { pos: counterPoint(f, SEAT.eye[0], SEAT.eye[1], SEAT.eye[2]), look: counterPoint(f, SEAT.look[0], SEAT.look[1], SEAT.look[2]) };
    },
    beltSlots: (id) => {
      const f = counterById(id);
      return f ? BELT_SLOTS.map(([x, z]) => counterPoint(f, x, BELT_Y + 0.005, z)) : [];
    },
    handoffPoint: (id) => { const f = counterById(id); return f ? counterPoint(f, HANDOFF[0], HANDOFF[1], HANDOFF[2]) : null; },
    makeProductMesh: (pid) => makeProductMesh(pid),
    makeBoxMesh: (pid, open, units) => makeBoxMesh(pid, open, units),
    levelAt: (id, point) => levelAt(id, point),
    poi: (kind, id) => {
      const v = new THREE.Vector3();
      switch (kind) {
        case 'computer': return desk ? v.set(desk.x, 1.25, desk.z) : null;
        case 'sign': return v.set(shop.signBox.x, shop.signBox.y + 0.3, shop.signBox.z);
        case 'delivery': { const dz = deliveryZone(bounds); return v.set(dz.x + dz.w / 2, 0.2, dz.z + dz.d / 2); }
        case 'trash': { const tb = trashBinPos(bounds); return v.set(tb.x, 1.3, tb.z); }
        case 'storageDoor': return v.set(doorX(bounds), 2.4, 0.1);
        case 'counter': {
          const f = id !== undefined ? counterById(id) : view().furniture.find((q) => q.type === 'counter');
          return f ? picks.centerOf({ kind: 'furniture', id: f.id }, v) : null;
        }
        default: return id !== undefined ? picks.centerOf({ kind: 'furniture', id }, v) : null;
      }
    },
  };

  /* ---------------- qualidade (tiers) + adaptação automática ---------------- */
  let tier: Tier = 'medium';
  let firstSettings = true;
  let autoOn = true;
  const fpsWin = { frames: 0, ms: 0, last: 0, since: 0 };
  function applyTier(t: Tier): void {
    tier = t;
    const cfg = TIERS[t];
    const r = ctx.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    r.setSize(window.innerWidth, window.innerHeight, false);
    env.setShadow(cfg.shadow);
    if (ctx.scene.fog) { const fg = ctx.scene.fog as THREE.Fog; fg.near = cfg.fog[0]; fg.far = cfg.fog[1]; }
    fpsWin.frames = 0; fpsWin.ms = 0; fpsWin.since = performance.now();
  }
  function watchFps(): void {
    const now = performance.now();
    const gap = fpsWin.last ? now - fpsWin.last : 0;
    fpsWin.last = now;
    if (!autoOn || tier === 'low' || document.visibilityState !== 'visible') { fpsWin.frames = 0; fpsWin.ms = 0; return; }
    if (gap > 1000 || now - fpsWin.since < 4000) { if (gap > 1000) fpsWin.since = now; fpsWin.frames = 0; fpsWin.ms = 0; return; }
    fpsWin.frames++; fpsWin.ms += gap;
    if (fpsWin.ms < 3000) return;
    const fps = (fpsWin.frames / fpsWin.ms) * 1000;
    fpsWin.frames = 0; fpsWin.ms = 0;
    if (fps >= 30) return;
    const lower = ORDER[Math.max(0, ORDER.indexOf(tier) - 1)]!;
    applyTier(lower); persistTier(lower);
    ctx.bus.emit('quality:auto', { quality: lower, fps: Math.round(fps) });
    ctx.bus.emit('toast', { text: `Desempenho baixo (${Math.round(fps)} fps): qualidade gráfica reduzida para ${lower === 'low' ? 'baixa' : 'média'}.`, kind: 'info' });
  }
  const qualityInfo = (): { tier: Tier; pixelRatio: number; shadows: number; antialias: boolean; auto: boolean; mobile: boolean } => ({
    tier, pixelRatio: ctx.renderer.getPixelRatio(), shadows: TIERS[tier].shadow, antialias: !!ctx.renderer.getContextAttributes()?.antialias, auto: autoOn, mobile: isMobileDevice(),
  });

  /* ---------------- câmera travada (testes/prints: independe do player) ---------------- */
  let lock: [number, number, number, number, number, number] | null = null;
  let prevBefore: THREE.Scene['onBeforeRender'] | null = null;
  function installLock(): void {
    prevBefore = ctx.scene.onBeforeRender;
    ctx.scene.onBeforeRender = (...args) => {
      if (lock) { const c = ctx.camera; c.position.set(lock[0], lock[1], lock[2]); c.lookAt(lock[3], lock[4], lock[5]); c.updateMatrixWorld(); }
      prevBefore?.apply(ctx.scene, args);
    };
  }

  /* ---------------- ciclo do módulo ---------------- */
  function exposeDebug(): void {
    const w = window as unknown as Record<string, unknown>;
    w.__world = {
      group: root, nav, get build() { return build; },
      rebuild: () => sync(true),
      sync: () => sync(false),
      demo: (on = true) => { demo = on; demoCache = null; boxKey = ''; rackKey = ''; navKey = ''; dirtKey = ''; furniKey = ''; entries.forEach((e) => furniGroup.remove(e.group)); entries.clear(); lastHash = 0; sync(false); },
      nodes: () => root.children.map((c) => ({ name: c.name || c.type, type: c.type, children: c.children.length })),
      quality: qualityInfo,
      setTier: (t: Tier) => applyTier(t),
      autoQuality: (on: boolean) => { autoOn = on; },
      testGenericProducts: () => genericProductsSelfTest(),
      stats: () => ({ calls: ctx.renderer.info.render.calls, tris: ctx.renderer.info.render.triangles, geometries: ctx.renderer.info.memory.geometries, textures: ctx.renderer.info.memory.textures }),
      furnitureViews: () => entries.size,
      boxCounts: () => ({ floor: boxLayer.countOf('floor'), rack: boxLayer.countOf('rack'), open: boxLayer.openCount('floor') }),
      walls: () => [{ n: [0, 1], fade: 1 }],
      setCamera: (x: number, y: number, z: number, lx: number, ly: number, lz: number) => { ctx.camera.position.set(x, y, z); ctx.camera.lookAt(lx, ly, lz); ctx.camera.updateMatrixWorld(); },
      lockCamera: (x: number, y: number, z: number, lx: number, ly: number, lz: number) => { lock = [x, y, z, lx, ly, lz]; ctx.camera.position.set(x, y, z); ctx.camera.lookAt(lx, ly, lz); ctx.camera.updateMatrixWorld(); },
      unlockCamera: () => { lock = null; },
      startBuild: (type: Furniture['type'], productId?: string) => ctx.bus.emit('build:start', { type, productId }),
      bounds: () => ({ ...bounds }),
      walkable: () => ({ minX: nav.minX, minZ: nav.minZ, w: nav.w, h: nav.h, rows: Array.from({ length: nav.h }, (_, r) => Array.from({ length: nav.w }, (_, c) => (nav.walk[r * nav.w + c] ? '.' : '#')).join('')) }),
      picks: () => picks.list(),
      highlighted: () => picks.current,
      screens: () => screens.info(),
      tags: () => tags.info(),
      profile: (on?: boolean) => {
        if (on !== undefined) { for (const k of Object.keys(sec)) delete sec[k]; Object.assign(prof, { on, t0: performance.now(), frames: 0, upd: 0, sync: 0, syncs: 0, ev: 0, evs: 0, prices: 0, pricesN: 0, env: 0, max: 0 }); return null; }
        const f = Math.max(1, prof.frames), secs = Math.max(0.001, (performance.now() - prof.t0) / 1000), r = (x: number): number => Math.round(x * 1000) / 1000;
        const secs2 = Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, r(v / Math.max(1, prof.syncs))]));
        return { sec: secs2, frames: prof.frames, secs: r(secs), updMs: r(prof.upd / f), updMaxMs: r(prof.max), envMs: r(prof.env / f), syncPerSec: r(prof.syncs / secs), syncMs: r(prof.sync / Math.max(1, prof.syncs)), eventsPerSec: r(prof.evs / secs), eventMs: r(prof.ev / Math.max(1, prof.evs)), pricesPerSec: r(prof.pricesN / secs), pricesMs: r(prof.prices / Math.max(1, prof.pricesN)), worldMsPerFrame: r((prof.upd + prof.ev) / f) };
      },
      /* Fase 4 (níveis) */
      tagLevels: () => tags.levels(),
      levels: (id: number) => { const v = view(); const f = v.furniture.find((x) => x.id === id); return f ? levelsOf(v, f) : null; },
      levelAt: (id: number, x: number, y: number, z: number) => levelAt(id, new THREE.Vector3(x, y, z)),
      levelHeights: (type: Furniture['type'], n: number) => levelHeights(type, n),
      /** Ponto de mundo no centro da FRENTE do nível (testes: mirar a câmera). */
      levelPoint: (id: number, level: number) => {
        const f = view().furniture.find((x) => x.id === id);
        const g = f ? levelGeoms(f.type, levelCountOf(f))[level] : undefined;
        if (!f || !g) return null;
        const p = new THREE.Vector3(g.box[0], g.box[1], g.box[2] + g.box[5] / 2).applyMatrix4(furnitureMatrix(f, new THREE.Matrix4()));
        return { x: p.x, y: p.y, z: p.z };
      },
      desk: () => (desk ? { ...desk } : null),
      chairs: () => [...chairs],
      service,
    };
  }

  return {
    name: 'world',
    init(c) {
      ctx = c;
      demo = /[?&]demo(=1|=true|&|$)/.test(location.search);
      ctx.scene.add(root);
      shop = new Shop(); env = new Env(ctx.scene);
      picks = new Picks(!!ctx.renderer.getContextAttributes()?.stencil);
      picks.levelBoxes = levelBoxes;
      ctx.scene.fog = new THREE.Fog(0xd5ecff, 95, 230);
      root.add(env.group, shop.group, furniStatic, furniGroup, deskGroup, itemLayer.group, boxLayer.group, tags.mesh, picks.group, picks.fx);
      itemLayer.group.traverse((o) => { o.renderOrder = 2; });
      initDirt();
      for (const o of [root, furniStatic, furniGroup, deskGroup, itemLayer.group, boxLayer.group, tags.mesh, picks.group, picks.fx, dirtMesh]) if (o) freezeSelf(o);
      build = new BuildMode({
        ctx, root,
        bounds: () => bounds, storageUnlocked: () => ctx.state.storageUnlocked,
        furniture: () => view().furniture,
        hide: (id) => { hiddenId = id; for (const [fid, e] of entries) e.group.visible = fid !== id; sync(false); },
        walkable: (x, z) => nav.isWalkable(x, z),
        stackHeight,
      });
      const t0 = initialTier();
      autoOn = !navigator.webdriver || /[?&]autoq=1/.test(location.search); // testes automatizados (WebDriver) não são rebaixados
      applyTier(t0);
      sync(true);
      ctx.services.world = service;
      // câmera inicial em 1ª pessoa (o player assume em seguida)
      ctx.camera.position.set(bounds.width / 2, 1.6, bounds.depth - 1.2);
      ctx.camera.lookAt(bounds.width / 2, 1.3, 2);
      installLock();
      const on = ctx.bus.on.bind(ctx.bus);
      offs.push(
        on('settings:changed', (p: { quality?: unknown }) => {
          // o primeiro evento é a emissão inicial da UI: só vale se o jogador já escolheu algo antes (senão vence o padrão por dispositivo)
          const first = firstSettings; firstSettings = false;
          if (!isTier(p?.quality)) return;
          if (first && storedTier() === null) return;
          applyTier(p.quality);
        }),
        on('stateChanged', () => { const t0 = pnow(); sync(false); if (prof.on) { prof.ev += performance.now() - t0; prof.evs++; } }),
        on('dayStarted', () => { sync(false); tipJars.resetDay(); }),
        on('checkout:done', (p: { counterId?: number; tip?: number }) => {
          if (!(p?.tip && p.tip > 0) || !ctx.state.upgrades.includes('tipjar')) return;
          tipJars.tip(p.counterId, p.tip); ctx.bus.emit('sfx', { name: 'coin' });
        }),
        on('build:start', (p: { type: Furniture['type']; productId?: string; variant?: string; stockIndex?: number }) => { sync(false); picks.highlight(null); build.start(p); }),
        on('build:edit', (p: { furnitureId: number }) => { sync(false); picks.highlight(null); build.edit(p.furnitureId); }),
        on('build:box', (p: { boxIndex: number }) => { sync(false); picks.highlight(null); build.startBox(p?.boxIndex); }),
        on('checkout:display', (p: Display) => screens.set(p, view().furniture.find((f) => f.type === 'counter')?.id)),
        on('sfx', (p?: { name?: string }) => {
          if (p?.name === 'door') doorTimer = 1.6;
          if (p?.name === 'cash') { for (const e of entries.values()) if (e.drawer) e.drawerT = 1; drawerAnim = true; }
        }),
      );
      exposeDebug();
    },
    update(dt) {
      const T0 = pnow();
      watchFps();
      acc += dt;
      if (acc >= 0.25) { acc = 0; sync(false); }
      const min = ctx.clock.minute;
      if (Math.abs(min - lastMinute) > 0.4) { lastMinute = min; env.setTime(min); }
      doorTimer = Math.max(0, doorTimer - dt);
      let near = doorTimer > 0;
      const pl = ctx.services.player;
      if (pl && !near) {
        near = Math.hypot(pl.position.x - doorAt.x, pl.position.z - doorAt.z) < 3;
      }
      shop.setOpenSign(ctx.clock.phase === 'open');
      shop.update(dt, near, env.night);
      tipJars.update(dt);
      const TE = pnow();
      env.update(dt);
      if (prof.on) prof.env += performance.now() - TE;
      if (drawerAnim) { // só itera enquanto alguma gaveta anima (sfx 'cash')
        drawerAnim = false;
        for (const e of entries.values()) {
          if (e.drawer && e.drawerT > 0) {
            e.drawerT = Math.max(0, e.drawerT - dt * 1.6);
            e.drawer.position.z = e.drawerBaseZ - Math.sin(Math.min(1, e.drawerT * 1.3) * Math.PI) * 0.26;
            if (e.drawerT > 0) drawerAnim = true;
          }
        }
      }
      build.update(dt);
      if (prof.on) { const d = performance.now() - T0; prof.frames++; prof.upd += d; prof.max = Math.max(prof.max, d); }
    },
    dispose() {
      offs.forEach((f) => f());
      build.dispose();
      entries.forEach((e) => furniGroup.remove(e.group));
      entries.clear();
      boxLayer.dispose(); itemLayer.dispose(); screens.dispose(); tipJars.dispose(); tags.dispose(); picks.dispose();
      staticGeos.forEach((g) => g.dispose()); staticGeos.length = 0;
      dirtMesh?.dispose(); dirtGeo?.dispose(); dirtMat?.dispose(); dirtTex?.dispose();
      shop.dispose(); env.dispose();
      clearGroup(root);
      ctx.scene.remove(root);
      ctx.scene.fog = null;
      if (prevBefore !== null) ctx.scene.onBeforeRender = prevBefore;
      delete ctx.services.world;
      delete (window as unknown as Record<string, unknown>).__world;
    },
  };
}
