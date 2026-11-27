/**
 * Módulo WORLD: cenário 3D em 1ª pessoa (Fase 3), móveis, caixas (abertas/fechadas), sujeira, grade de navegação,
 * alvos de interação (pickGroup + contorno), monitor do caixa, etiquetas de preço e posicionamento em 1ª pessoa.
 * Publica ctx.services.world (WorldService). Convenções: docs/CONTRACTS.md (seções "world" e "Fase 3 — world").
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '../core/module';
import type { PickInfo, Vec2, WorldService } from '../core/services';
import { doorPos, deliveryZone, storeBounds, trashBinPos, recycleBinPos, doorX, FURNITURE_FOOTPRINT, SIDEWALK_DEPTH, STORAGE_DEPTH, type Bounds } from '../core/layout';
import { DEFAULT_DECOR, type Box, type Decor, type Furniture, type StoreState } from '../sim/state';
import { PRODUCTS, productById } from '../sim/catalog';
import * as api from '../sim/api';
import { Shop } from './shop';
import { Env, TRASH_SILHOUETTE, RECYCLE_SILHOUETTE } from './env';
import {
  BELT_SLOTS, BELT_Y, HANDOFF, SCANNER, SEAT, chairGeos, chairSilhouette, furnitureGeos,
  furnitureItems, makeDrawer, rackColumnSlot, RACK_COLS, silhouetteOf, type SBox,
  isDisplayType, levelCountOf, levelGeoms, levelHeights, levelIndexAt, levelPids, levelVisible,
} from './furniture';
import { BoxLayer, ItemLayer, BOX_H, BOX_W, BOX_D, genericVisual, productVisual, makeProductMesh, makeBoxMesh, prewarmProductGeometry, type BoxInst } from './products';
import { SHAPES } from './look';
import { combine, meshesOf } from './batch';
import { TIERS, autoStart, autoSteps, initialQuality, isMobileDevice, isQuality, saveAutoStep, type Quality } from './quality';
import { DynamicResolution, SlowWatch } from './drs';
import { registerWarm, warmUp, lastWarm } from '../core/warm';
import { NavGrid, footprintOf } from './nav';
import { BuildMode } from './build';
import { hash01, localToWorld, makeCanvas, canvasTex, clearGroup, freezeSelf } from './kit';
import { Picks } from './pick';
import { CheckoutScreens, type Display } from './screens';
import { PriceTags } from './tags';
import { TipJars, JAR } from './tipjar';

/** Dica única "Jogo lento? use Automática" (mostrada no máximo uma vez). */
const QHINT_KEY = 'mercadinho:qhint';

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
    f(15, 'decor', W - 1, b.depth - 1, 0, undefined, 'tree'), f(19, 'desk', 9, 3, 0),
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
/** Começa um hash numérico (as chaves de mudança das seções usam isto em vez de strings gigantes: sem alocação). */
const hBegin = (seed: number): void => { H = seed | 0; };
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
  const nav = new NavGrid();
  const screens = new CheckoutScreens();
  const tags = new PriceTags();
  let picks!: Picks;
  let build!: BuildMode;
  let demo = false;
  let demoCache: { key: string; v: View } | null = null;

  /** Cada móvel tem um grupo (gaveta e tela do balcão); a casca estática de TODOS é fundida em poucas malhas. */
  interface Entry { geoSig: number; group: THREE.Group; drawer?: THREE.Mesh; drawerBaseZ: number; drawerT: number }
  const entries = new Map<number, Entry>();
  /** Chaves de mudança (hash numérico; NaN = força refazer). */
  let furniKey = NaN, itemsKey = NaN, tagsKey = NaN;
  const staticGeos: THREE.BufferGeometry[] = [];
  let hiddenId: number | null = null;
  let bounds: Bounds = storeBounds(0);
  let shellKey = '', decorKey = '', navKey = NaN, rackKey = NaN, boxKey = NaN, dirtKey = NaN;
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
  /** Mesa do computador (móvel `desk` do estado): tile e pose do centro do tile (seta do tutorial, `__world.desk()`). */
  let desk: { tx: number; tz: number; x: number; z: number; ry: number } | null = null;
  /** Caixas no chão desenhadas: índice em state.sidewalk + pose (pick/contorno/empilhamento). */
  let boxLayout: { index: number; box: Box; x: number; y: number; z: number; ry: number; open: boolean }[] = [];
  /** Caixas desenhadas nas estantes do depósito (mira por caixa: kind 'rackBox'). */
  let rackBoxes: { rackId: number; pid: string; x: number; y: number; z: number; ry: number }[] = [];
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

  /** Hash da pose do móvel (tipo, tile, rotação). */
  function geoHash(f: Furniture): number { hBegin(0x3c6ef372); hStr(f.type); hNum(f.x); hNum(f.z); hNum(f.rot); return H; }
  function syncFurniture(v: View): void {
    const seen = new Set<number>();
    let geoChanged = false;
    for (const f of v.furniture) {
      seen.add(f.id);
      const geoSig = geoHash(f);
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
    // chaves numéricas (antes eram strings com todos os móveis, montadas a cada cliente que pegava um item)
    hBegin(0x6a09e667); hInt(hiddenId ?? -1); hInt(ctx.state.upgrades.includes('tipjar') ? 1 : 0); hInt(bounds.width); hInt(bounds.depth); hInt(ctx.state.storageUnlocked ? 1 : 0);
    for (const f of v.furniture) {
      hInt(f.id); hStr(f.type); hNum(f.x); hNum(f.z); hNum(f.rot); hStr(f.variant);
      const lv = lvls.get(f.id);
      if (lv) for (let i = 0; i < lv.length; i++) hStr(lv[i]!.pid ?? '');
    }
    const fk = H;
    if (fk !== furniKey) {
      furniKey = fk;
      computeDesk(v);
      const t = pnow(); rebuildStatic(v, lvls); lap('static', t);
      picksDirty = true;
    }
    // etiquetas por nível (a malha só é refeita quando produto/esgotado de algum nível muda)
    hBegin(fk ^ 0x5be0cd19);
    for (const f of v.furniture) { const lv = lvls.get(f.id); if (!lv || f.id === hiddenId) continue; hInt(f.id); for (let i = 0; i < lv.length; i++) { hStr(lv[i]!.pid ?? ''); hInt(lv[i]!.fill > 0 ? 1 : 0); } }
    if (H !== tagsKey) {
      tagsKey = H;
      tags.rebuild(v.furniture.filter((f) => f.id !== hiddenId && lvls.has(f.id)).map((f) => ({ f, levels: lvls.get(f.id)!.map((l) => ({ pid: l.pid, empty: !(l.fill > 0) })) })));
    }
    hBegin(fk ^ 0x1f83d9ab);
    for (const f of v.furniture) { const lv = lvls.get(f.id); if (!lv) continue; hInt(f.id); for (let i = 0; i < lv.length; i++) hInt(levelVisible(f.type, lv.length, i, lv[i]!.pid, lv[i]!.units)); }
    const ik = H;
    if (ik !== itemsKey) { itemsKey = ik; const t = pnow(); rebuildItems(v, lvls); lap('items', t); }
    hBegin(0x9b05688c); hInt(bounds.width); hInt(bounds.depth); hInt(ctx.state.storageUnlocked ? 1 : 0);
    for (const f of v.furniture) { hInt(f.id); hStr(f.type); hNum(f.x); hNum(f.z); hNum(f.rot); }
    const nk = H;
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
    shadowsDirty = true; // a casca dos móveis projeta sombra
  }
  /** Matrizes dos itens por móvel, em cache: quando um cliente pega um item só o móvel dele é recalculado (antes:
   *  todos os itens da loja eram refeitos e reenviados à GPU a cada item pego). */
  const itemCache = new Map<number, { sig: number; by: Map<string, Float32Array> }>();
  /** Itens expostos POR NÍVEL (cada nível só com o seu produto), 1 InstancedMesh por produto na ItemLayer. */
  function rebuildItems(v: View, lvls: Map<number, LevelView[]>): void {
    const out = new Map<string, Float32Array[]>();
    const alive = new Set<number>();
    for (const f of v.furniture) {
      const lv = lvls.get(f.id);
      if (f.id === hiddenId || !lv) continue;
      alive.add(f.id);
      hBegin(0x510e527f); hStr(f.type); hNum(f.x); hNum(f.z); hNum(f.rot); hInt(lv.length);
      for (let i = 0; i < lv.length; i++) { hStr(lv[i]!.pid ?? ''); hInt(levelVisible(f.type, lv.length, i, lv[i]!.pid, lv[i]!.units)); }
      const sig = H;
      let c = itemCache.get(f.id);
      if (!c || c.sig !== sig) {
        const tmp = new Map<string, number[]>();
        const { cx, cz } = centerOf(f);
        furnitureItems(f, lv, cx, cz, tmp);
        const by = new Map<string, Float32Array>();
        for (const [pid, arr] of tmp) by.set(pid, new Float32Array(arr));
        c = { sig, by };
        itemCache.set(f.id, c);
      }
      for (const [pid, arr] of c.by) { let l = out.get(pid); if (!l) out.set(pid, (l = [])); l.push(arr); }
    }
    for (const id of itemCache.keys()) if (!alive.has(id)) itemCache.delete(id);
    itemLayer.setChunks('furniture', out);
  }
  function rebuildNav(v: View): void {
    nav.build(bounds, ctx.state.storageUnlocked, v.furniture, env.blocked);
    picksDirty = true;
  }

  /** Mesa do computador: móvel `desk` do estado (o sim garante uma; o jogador a MOVE como qualquer móvel). */
  function computeDesk(v: View): void {
    const f = v.furniture.find((x) => x.type === 'desk');
    if (!f) { desk = null; return; }
    const { cx, cz } = centerOf(f);
    desk = { tx: f.x, tz: f.z, x: cx, z: cz, ry: (f.rot * Math.PI) / 180 };
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
    shadowsDirty = true;
  }
  /** Hash das caixas no chão (produto, unidades, pose, carregada/aberta). */
  function boxSigOf(v: View): number {
    hBegin(0x4b6f2a1);
    for (let i = 0; i < v.sidewalk.length; i++) { const b = v.sidewalk[i]!; hStr(b.productId); hNum(b.units); hNum(b.x); hNum(b.z); hInt((b.carried ? 1 : 0) + (b.open ? 2 : 0)); hNum(b.rot); }
    return H ^ v.sidewalk.length;
  }

  /**
   * Caixas do depósito nas estantes (pós-teste 3): sempre FECHADAS e com rótulo; cada produto (ordem do catálogo) ocupa
   * colunas próprias — a incompleta na frente da 1ª coluna e as cheias atrás/nas colunas seguintes; produtos diferentes
   * lado a lado. Sem colunas livres, as que sobram ocupam os fundos livres. `rackBoxes` guarda a pose para a mira.
   */
  function syncRackBoxes(v: View): void {
    const racks = v.furniture.filter((f) => f.type === 'rack').sort((a, b) => a.id - b.id);
    const list: BoxInst[] = [];
    rackBoxes = [];
    const totalCols = racks.length * RACK_COLS;
    const used = new Set<string>();
    const put = (pid: string, ri: number, col: number, row: 0 | 1): void => {
      const r = racks[ri]!;
      const { cx, cz } = centerOf(r);
      const sl = rackColumnSlot(col, row);
      const w = localToWorld(cx, cz, r.rot, sl.x, sl.z);
      const ry = (r.rot * Math.PI) / 180 + (hash01(list.length, 3) - 0.5) * 0.06;
      list.push({ pid, x: w.x, y: sl.y, z: w.z, ry, open: false, fill: 1 });
      rackBoxes.push({ rackId: r.id, pid, x: w.x, y: sl.y, z: w.z, ry });
      used.add(`${ri}:${col}:${row}`);
    };
    let cursor = 0;
    const overflow: string[] = [];
    for (const p of PRODUCTS) {
      const units = v.storage[p.id] ?? 0;
      if (units <= 0) continue;
      const n = Math.ceil(units / p.boxSize);
      for (let k = 0; k < n; k++) {
        const c = cursor + Math.floor(k / 2);
        if (c >= totalCols) { overflow.push(p.id); continue; }
        put(p.id, Math.floor(c / RACK_COLS), c % RACK_COLS, (k % 2) as 0 | 1);
      }
      cursor += Math.ceil(n / 2);
    }
    for (let ri = 0; ri < racks.length && overflow.length; ri++) {
      for (let col = 0; col < RACK_COLS && overflow.length; col++) for (const row of [0, 1] as const) {
        if (overflow.length && !used.has(`${ri}:${col}:${row}`)) put(overflow.shift()!, ri, col, row);
      }
    }
    boxLayer.setSource('rack', list);
    shadowsDirty = true; // caixas projetam sombra
    picksDirty = true;
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
  const M3 = new THREE.Matrix4();
  const JAR_SIL: SBox[] = [[0, 0.1, 0, 0.19, 0.24, 0.19]];
  const DIRT_SIL: SBox[] = [[0, 0.04, 0, 0.62, 0.08, 0.62]];
  function rebuildPicks(v: View): void {
    picksDirty = false;
    picks.begin();
    for (const f of v.furniture) {
      if (f.id === hiddenId) continue;
      furnitureMatrix(f, M2);
      picks.add({ kind: f.type === 'desk' ? 'computer' : 'furniture', id: f.id }, silhouetteOf(f), M2);
      if (f.type === 'counter' && ctx.state.upgrades.includes('tipjar')) picks.add({ kind: 'tipjar', id: f.id }, JAR_SIL, M3.copy(M2).multiply(M.makeTranslation(JAR.x, JAR.y, JAR.z)));
      if (f.type === 'counter' && chairs.has(f.id)) picks.add({ kind: 'seat', id: f.id }, chairSilhouette(), M2.multiply(M.makeTranslation(SEAT.x, 0, SEAT.z)));
    }
    for (const b of boxLayout) picks.add({ kind: 'box', id: b.index }, b.open ? BOX_OPEN : BOX_CLOSED, T(b.x, b.y, b.z, b.ry));
    rackBoxes.forEach((b, i) => picks.add({ kind: 'rackBox', id: b.rackId, pid: b.pid, slot: i }, BOX_CLOSED, T(b.x, b.y, b.z, b.ry)));
    v.dirt.forEach((d, i) => picks.add({ kind: 'dirt', id: i }, DIRT_SIL, T(d.x, 0, d.z)));
    const tb = trashBinPos(bounds);
    picks.add({ kind: 'trash' }, TRASH_SILHOUETTE, T(tb.x, 0, tb.z));
    if (ctx.state.upgrades.includes('recycler')) { const rb = recycleBinPos(bounds); picks.add({ kind: 'recycle' }, RECYCLE_SILHOUETTE, T(rb.x, 0, rb.z)); }
    const sg = shop.signBox;
    picks.add({ kind: 'sign' }, [[0, 0, 0, sg.w, sg.h, sg.d]], T(sg.x, sg.y, sg.z));
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
  let deskSig = '';
  function syncInner(force: boolean): void {
    const s: StoreState = ctx.state;
    // a mesa do computador é um móvel do estado; se algum caminho a perdeu, o sim a recria (1 tentativa por layout)
    if (!demo && !s.furniture.some((f) => f.type === 'desk')) {
      const sig = `${s.furniture.length}|${s.nextFurnitureId}|${s.expansion}|${s.storageUnlocked}`;
      if (sig !== deskSig) { deskSig = sig; try { api.ensureDesk(s); } catch { /* sim antigo */ } }
    }
    const extra = (demo ? 1 : 0) + ((hiddenId ?? -1) + 2) * 4 + (s.upgrades.includes('tipjar') ? 1000003 : 0) + (s.upgrades.includes('recycler') ? 2000003 : 0);
    if (!force && !picksDirty && stateHash(s, extra) === lastHash) return; // nada mudou: sem alocações
    const nb = storeBounds(s.expansion);
    const dec = effectiveDecor(s.decor);
    const sk = `${s.expansion}|${s.storageUnlocked}`;
    const dk = `${dec.wallColor}|${dec.floorColor}|${dec.signColor}|${s.storeName}`;
    if (force || sk !== shellKey) {
      shellKey = sk; bounds = nb; doorAt = doorPos(bounds);
      env.rebuild(bounds);
      shop.rebuild(bounds, s.storageUnlocked, dec, s.storeName);
      shadowsDirty = true;
      decorKey = dk;
      env.setTime(ctx.clock.minute, true);
      navKey = NaN; rackKey = NaN; boxKey = NaN; furniKey = NaN; tagsKey = NaN; itemsKey = NaN; demoCache = null; picksDirty = true;
    }
    env.setRecycler(s.upgrades.includes('recycler'));
    if (dk !== decorKey) {
      const nameChanged = !decorKey.endsWith(`|${s.storeName}`);
      decorKey = dk;
      if (shop.setDecor(dec) || nameChanged) { shop.rebuild(bounds, s.storageUnlocked, dec, s.storeName); picksDirty = true; }
    }
    const v = view();
    let t = pnow(); syncFurniture(v); lap('furn', t);
    hBegin(0x7137449);
    for (const f of v.furniture) if (f.type === 'rack') { hInt(f.id); hNum(f.x); hNum(f.z); hNum(f.rot); }
    for (let i = 0; i < PRODUCTS.length; i++) hNum(v.storage[PRODUCTS[i]!.id] ?? 0);
    const rk = H;
    if (rk !== rackKey) { rackKey = rk; syncRackBoxes(v); }
    const bk = boxSigOf(v);
    t = pnow();
    if (bk !== boxKey) { boxKey = bk; syncBoxes(v); boxKey = boxSigOf(v); }
    lap('boxes', t);
    hBegin(0x2f2a1b3); for (let i = 0; i < v.dirt.length; i++) { hNum(v.dirt[i]!.x); hNum(v.dirt[i]!.z); }
    const dsk = H ^ v.dirt.length;
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
        const q = localToWorld(cx, cz, f.rot, -0.5, 0.5 + i);
        const t = tileC(q.x, q.z);
        if (!nav.isWalkable(t.x, t.z) || t.z >= bounds.depth) break; // fila só dentro do salão
        queue.push(t);
      }
      return { furnitureId: f.id, operator: tileC(op.x, op.z), queue, scanner: localToWorld(cx, cz, f.rot, SCANNER[0], SCANNER[1]) };
    }),
    spawnPoint: () => ({ x: Math.floor(doorPos(bounds).x - 5) + 0.5, z: bounds.depth + SIDEWALK_DEPTH + 0.5 }),
    trashBin: () => trashBinPos(bounds),
    recycleBin: () => recycleBinPos(bounds),
    storageSpot: (pid) => {
      const v = view();
      const racks = v.furniture.filter((f) => f.type === 'rack');
      if (!racks.length) return null;
      const b = (pid ? rackBoxes.find((x) => x.pid === pid) : undefined) ?? rackBoxes[rackBoxes.length - 1];
      const front = (x: number, z: number, ry: number, d: number): { x: number; z: number } => ({ x: x + Math.sin(ry) * d, z: z + Math.cos(ry) * d });
      if (b) { const p = front(b.x, b.z, b.ry, 0.85); return { ...p, box: { x: b.x, z: b.z } }; }
      const r = racks[0]!, { cx, cz } = centerOf(r), ry = (r.rot * Math.PI) / 180, p = front(cx, cz, ry, 1.0);
      return { ...p, box: { x: cx, z: cz } };
    },
    door: () => doorPos(bounds),
    group: root,
    /* ---- Fase 3 ---- */
    get pickGroup() { return picks.group; },
    highlight: (p) => { picks.highlight(p); tipJars.panel(p?.kind === 'tipjar' && p.id != null ? p.id : null, ctx.state.ledger.tips); },
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
    shadowDirty: () => { shadowsDirty = true; },
    poi: (kind, id) => {
      const v = new THREE.Vector3();
      switch (kind) {
        case 'computer': return desk ? v.set(desk.x, 1.25, desk.z) : null;
        case 'sign': return v.set(shop.signBox.x, shop.signBox.y + 0.3, shop.signBox.z);
        case 'delivery': { const dz = deliveryZone(bounds); return v.set(dz.x + dz.w / 2, 0.2, dz.z + dz.d / 2); }
        case 'recycle': { const rb = recycleBinPos(bounds); return v.set(rb.x, 1.3, rb.z); }
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

  /* ---------------- qualidade: tiers fixos, modo automático (resolução dinâmica) e sombra estática ----------------
   * Fixo (Baixa/Média/Alta): exatamente o que o jogador escolheu; nunca muda sozinho (no máximo uma dica em toast).
   * Automático: resolução dinâmica (drs.ts) em degraus de pixel ratio; sombras só saem no último degrau. Nada disso é
   * gravado como escolha do jogador (só o último degrau estável em 'mercadinho:drs').
   * Sombra: mapa estático (renderer.shadowMap.autoUpdate = false no main); `shadowsDirty` refaz o mapa quando o sol
   * anda (env.sunVersion), quando o que projeta sombra muda (móveis, caixas, árvores) ou quando a qualidade muda. */
  let quality: Quality = 'auto';
  let autoOn = true; // adaptação automática (resolução dinâmica / dica); WebDriver desliga
  let drs: DynamicResolution | null = null;
  const slowWatch = new SlowWatch();
  let modalOpen = false;
  let lastFrameAt = 0;
  let shadowsDirty = true;
  let sunSeen = -1;
  const AUTO_FOG: [number, number] = TIERS.high.fog;
  /** Aplica pixel ratio, sombra e neblina. Ligar/desligar sombras muda TODOS os shaders: recompila em segundo plano. */
  function applyRender(pr: number, shadow: number, fog: readonly [number, number]): void {
    const r = ctx.renderer;
    const target = Math.min(window.devicePixelRatio || 1, pr);
    if (Math.abs(r.getPixelRatio() - target) > 1e-3) { r.setPixelRatio(target); r.setSize(window.innerWidth, window.innerHeight, false); }
    const wasOn = env.sun.castShadow;
    env.setShadow(shadow);
    if (ctx.scene.fog) { const fg = ctx.scene.fog as THREE.Fog; fg.near = fog[0]; fg.far = fog[1]; }
    shadowsDirty = true;
    if (wasOn !== shadow > 0 && warmReady) void warmUp(ctx, { scene: true, hold: true });
  }
  function applyQuality(q: Quality): void {
    quality = q;
    slowWatch.reset();
    if (q === 'auto') {
      const steps = autoSteps();
      drs = new DynamicResolution(steps, autoStart(steps));
      applyRender(drs.step.pr, drs.step.shadow, AUTO_FOG);
    } else {
      drs = null;
      const cfg = TIERS[q];
      applyRender(cfg.pixelRatio, cfg.shadow, cfg.fog);
    }
  }
  /** Por quadro desenhado: resolução dinâmica (auto) ou dica única (qualidade fixa lenta). */
  function watchPerf(): void {
    const now = performance.now();
    const interval = lastFrameAt ? now - lastFrameAt : 0;
    lastFrameAt = now;
    const f = ctx.frame;
    if (!autoOn || modalOpen || (f && f.hold > 0) || document.visibilityState !== 'visible') { drs?.reset(); slowWatch.reset(); return; }
    const target = f?.targetMs ?? 1000 / 60;
    if (drs) {
      if (drs.frame(now, interval, f?.workMs ?? 0, target) !== null) {
        const s = drs.step;
        applyRender(s.pr, s.shadow, AUTO_FOG);
        saveAutoStep(s);
      }
    } else if (quality !== 'low' && slowWatch.frame(now, interval, target)) {
      let seen = false;
      try { seen = localStorage.getItem(QHINT_KEY) === '1'; localStorage.setItem(QHINT_KEY, '1'); } catch { /* privado */ }
      if (!seen) ctx.bus.emit('toast', { text: 'Jogo lento? Em Opções, use Qualidade gráfica: Automática.', kind: 'info' });
    }
  }
  const qualityInfo = (): { quality: Quality; tier: Quality; pixelRatio: number; shadows: number; antialias: boolean; auto: boolean; adaptive: boolean; mobile: boolean; step: number | null; steps: number; drsLog: unknown[]; shadowAuto: boolean } => ({
    quality, tier: quality, pixelRatio: ctx.renderer.getPixelRatio(), shadows: env.sun.castShadow ? env.sun.shadow.mapSize.x : 0,
    antialias: !!ctx.renderer.getContextAttributes()?.antialias, auto: quality === 'auto', adaptive: autoOn, mobile: isMobileDevice(),
    step: drs ? drs.index : null, steps: drs ? drs.steps.length : 0, drsLog: drs ? drs.log.slice() : [], shadowAuto: ctx.renderer.shadowMap.autoUpdate,
  });
  /* ---------------- aquecimento de shaders (objetos que só aparecem depois) ---------------- */
  let warmReady = false;
  let geoWarm = false;
  function warmSamples(add: (o: THREE.Object3D) => void): void {
    if (!geoWarm) { geoWarm = true; prewarmProductGeometry(); }
    add(makeProductMesh(PRODUCTS[0]!.id)); // esteira/cesta (Mesh com o material dos produtos)
    const bm = makeBoxMesh(PRODUCTS[0]!.id, true, 6); bm.userData.setOpen?.(1); add(bm); // caixa animável (mãos/repositor)
    add(tipJars.sample()); // pote de gorjeta, "+R$" e painel
    add(build.sample()); // fantasma/grade do modo construção
  }

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
      demo: (on = true) => { demo = on; demoCache = null; boxKey = NaN; rackKey = NaN; navKey = NaN; dirtKey = NaN; furniKey = NaN; tagsKey = NaN; itemsKey = NaN; entries.forEach((e) => furniGroup.remove(e.group)); entries.clear(); lastHash = 0; sync(false); },
      nodes: () => root.children.map((c) => ({ name: c.name || c.type, type: c.type, children: c.children.length })),
      quality: qualityInfo,
      /** Debug/testes: aplica uma qualidade (low/medium/high/auto) sem gravar como escolha do jogador. */
      setTier: (t: Quality) => { if (isQuality(t)) applyQuality(t); },
      /** Liga/desliga a adaptação automática (resolução dinâmica e dica). */
      autoQuality: (on: boolean) => { autoOn = on; drs?.reset(); slowWatch.reset(); },
      warm: () => lastWarm(),
      testGenericProducts: () => genericProductsSelfTest(),
      stats: () => ({ calls: ctx.renderer.info.render.calls, tris: ctx.renderer.info.render.triangles, geometries: ctx.renderer.info.memory.geometries, textures: ctx.renderer.info.memory.textures }),
      furnitureViews: () => entries.size,
      boxCounts: () => ({ floor: boxLayer.countOf('floor'), rack: boxLayer.countOf('rack'), open: boxLayer.openCount('floor') }),
      /** Testes (pós-teste 3): caixas desenhadas nas estantes do depósito, na ordem dos alvos ('rackBox'.slot). */
      rackBoxes: () => rackBoxes.map((b) => ({ ...b })),
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
      root.add(env.group, shop.group, furniStatic, furniGroup, itemLayer.group, boxLayer.group, tags.mesh, picks.group, picks.fx);
      itemLayer.group.traverse((o) => { o.renderOrder = 2; });
      initDirt();
      for (const o of [root, furniStatic, furniGroup, itemLayer.group, boxLayer.group, tags.mesh, picks.group, picks.fx, dirtMesh]) if (o) freezeSelf(o);
      build = new BuildMode({
        ctx, root,
        bounds: () => bounds, storageUnlocked: () => ctx.state.storageUnlocked,
        furniture: () => view().furniture,
        hide: (id) => { hiddenId = id; for (const [fid, e] of entries) e.group.visible = fid !== id; sync(false); },
        walkable: (x, z) => nav.isWalkable(x, z),
        stackHeight,
      });
      autoOn = !navigator.webdriver || /[?&]autoq=1/.test(location.search); // testes automatizados (WebDriver): resolução fixa
      applyQuality(initialQuality());
      sync(true);
      offs.push(registerWarm(warmSamples));
      warmReady = true;
      ctx.services.world = service;
      // câmera inicial em 1ª pessoa (o player assume em seguida)
      ctx.camera.position.set(bounds.width / 2, 1.6, bounds.depth - 1.2);
      ctx.camera.lookAt(bounds.width / 2, 1.3, 2);
      installLock();
      const on = ctx.bus.on.bind(ctx.bus);
      offs.push(
        on('settings:changed', (p: { quality?: unknown }) => {
          // escolha do jogador (ou emissão inicial da UI, que lê o mesmo localStorage): só reaplica se mudou
          if (isQuality(p?.quality) && p.quality !== quality) applyQuality(p.quality);
        }),
        on('ui:modal', (m?: { open?: boolean }) => { modalOpen = !!m?.open; drs?.reset(); }),
        on('stateChanged', () => { const t0 = pnow(); sync(false); if (prof.on) { prof.ev += performance.now() - t0; prof.evs++; } }),
        on('dayStarted', () => { sync(false); tipJars.resetDay(); }),
        on('checkout:done', (p: { counterId?: number; tip?: number }) => {
          if (!(p?.tip && p.tip > 0) || !ctx.state.upgrades.includes('tipjar')) return;
          tipJars.tip(p.counterId, p.tip); ctx.bus.emit('sfx', { name: 'coin' });
        }),
        on('recycle:done', (p: { x: number; z: number; amount: number }) => {
          if (!(p?.amount > 0)) return;
          tipJars.pop(root, p.x, 1.35, p.z, 0.5, p.amount);
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
      watchPerf();
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
      shop.setOpenSign(ctx.clock.signOpen);
      shop.update(dt, near, env.night);
      tipJars.update(dt); tipJars.panelRefresh(ctx.state.ledger.tips);
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
      // mapa de sombra estático: refaz só quando o sol andou ou algo que projeta sombra mudou
      if (env.sunVersion !== sunSeen) { sunSeen = env.sunVersion; shadowsDirty = true; }
      if (shadowsDirty) { shadowsDirty = false; ctx.renderer.shadowMap.needsUpdate = true; }
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
