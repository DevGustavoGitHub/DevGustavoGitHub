/**
 * Módulo WORLD: cenário 3D, móveis, caixas, sujeira, grade de navegação, modo construção.
 * Publica ctx.services.world (WorldService). Veja docs/CONTRACTS.md (seção "world") para convenções.
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '../core/module';
import type { Vec2, WorldService } from '../core/services';
import { doorPos, deliveryZone, storeBounds, trashBinPos, FURNITURE_FOOTPRINT, SIDEWALK_DEPTH, type Bounds } from '../core/layout';
import type { Box, Furniture, StoreState } from '../sim/state';
import { PRODUCTS, productById } from '../sim/catalog';
import * as api from '../sim/api';
import { Shop, Env } from './shop';
import { buildFurniture, rackSlot, RACK_SLOTS, type FurnitureView } from './furniture';
import { BoxLayer, BOX_H, type BoxInst } from './products';
import { NavGrid, footprintOf } from './nav';
import { BuildMode } from './build';
import { hash01, localToWorld, makeCanvas, canvasTex, clearGroup } from './kit';

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
      { productId: 'arroz', units: 6 }, { productId: 'feijao', units: 12 }, { productId: 'refri', units: 3 }, { productId: 'leite', units: 12 },
      { productId: 'cafe', units: 0 }, { productId: 'macarrao', units: 20 }, { productId: 'agua', units: 12 },
    ],
    dirt: [{ x: 3.4, z: 3.2 }, { x: 5.2, z: 7.1 }, { x: 9.6, z: 6.6 }, { x: 2.1, z: 8.4 }],
  };
}

export default function create(): GameModule {
  let ctx!: GameContext;
  const root = new THREE.Group(); root.name = 'world';
  let shop!: Shop; let env!: Env;
  const furniGroup = new THREE.Group(); furniGroup.name = 'furniture';
  const boxLayer = new BoxLayer(160); boxLayer.group.name = 'boxes';
  const rackLayer = new BoxLayer(160); rackLayer.group.name = 'rackBoxes';
  const nav = new NavGrid();
  let build!: BuildMode;
  let demo = false;
  let demoCache: { key: string; v: View } | null = null;

  interface Entry { sig: string; geoSig: string; view: FurnitureView; group: THREE.Group; drawerT: number }
  const entries = new Map<number, Entry>();
  let hiddenId: number | null = null;
  let bounds: Bounds = storeBounds(0);
  let shellKey = '', decorKey = '', navKey = '', rackKey = '', boxKey = '', dirtKey = '';
  let acc = 0;
  let doorTimer = 0;
  let lastMinute = -1;
  const offs: (() => void)[] = [];

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
    dirtMat = new THREE.MeshBasicMaterial({ map: dirtTex, transparent: true, opacity: 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, color: 0x6a4a2f });
    dirtMesh = new THREE.InstancedMesh(dirtGeo, dirtMat, DIRT_CAP);
    dirtMesh.count = 0; dirtMesh.frustumCulled = false; dirtMesh.renderOrder = 2;
    root.add(dirtMesh);
  }
  function syncDirt(v: View): void {
    if (!dirtMesh) return;
    const n = Math.min(DIRT_CAP, v.dirt.length);
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const d = v.dirt[i]!;
      const s = 0.7 + hash01(i, 1, Math.round(d.x * 10)) * 0.8;
      o.position.set(d.x, 0.024 + (i % 9) * 0.0012, d.z);
      o.rotation.set(0, hash01(i, 2) * 6.28, 0); o.scale.set(s, 1, s * (0.7 + hash01(i, 3) * 0.4)); o.updateMatrix();
      dirtMesh.setMatrixAt(i, o.matrix);
      dirtMesh.setColorAt(i, col.setHex([0x6a4a2f, 0x55402c, 0x7a5a38, 0x3d5a3a][i % 4]!));
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

  /* ---------------- móveis ---------------- */
  function centerOf(f: Furniture): { cx: number; cz: number } {
    const fp = footprintOf(f);
    return { cx: f.x + fp.w / 2, cz: f.z + fp.d / 2 };
  }
  function makeView(f: Furniture, fraction: number): FurnitureView { return buildFurniture(f, fraction); }

  function syncFurniture(v: View): void {
    const seen = new Set<number>();
    let geoChanged = false;
    for (const f of v.furniture) {
      seen.add(f.id);
      const frac = fillFraction(v, f);
      const bucket = Math.round(frac * 48);
      const geoSig = `${f.type}|${f.x}|${f.z}|${f.rot}`;
      const sig = `${geoSig}|${f.productId ?? ''}|${f.variant ?? ''}|${bucket}`;
      let e = entries.get(f.id);
      if (e && e.sig === sig) continue;
      if (!e || e.geoSig !== geoSig) geoChanged = true;
      if (e) { disposeEntry(e); }
      const view = makeView(f, frac);
      const group = view.group;
      const { cx, cz } = centerOf(f);
      group.position.set(cx, 0.01, cz);
      group.rotation.y = (f.rot * Math.PI) / 180;
      group.visible = f.id !== hiddenId;
      group.userData.furnitureId = f.id;
      furniGroup.add(group);
      e = { sig, geoSig, view, group, drawerT: 0 };
      entries.set(f.id, e);
    }
    for (const [id, e] of entries) {
      if (seen.has(id)) continue;
      disposeEntry(e); entries.delete(id); geoChanged = true;
    }
    const nk = `${bounds.width}x${bounds.depth}|${ctx.state.storageUnlocked}|` + v.furniture.map((f) => `${f.id}:${f.type}:${f.x}:${f.z}:${f.rot}`).join(',');
    if (geoChanged || nk !== navKey) { navKey = nk; rebuildNav(v); }
  }
  function disposeEntry(e: Entry): void {
    e.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    furniGroup.remove(e.group);
  }
  function rebuildNav(v: View): void {
    nav.build(bounds, ctx.state.storageUnlocked, v.furniture, env.blocked);
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
    // caixas sem posição ganham um ponto livre na zona de entrega (o mundo escolhe, ver CONTRACTS)
    for (const b of v.sidewalk) {
      if (b.carried) continue;
      if (b.x === undefined || b.z === undefined) { const p = pickFreeSpot(v.sidewalk, b); b.x = p.x; b.z = p.z; }
    }
    const list: BoxInst[] = [];
    const placed = v.sidewalk.filter((b) => !b.carried && b.x !== undefined && b.z !== undefined);
    for (let i = 0; i < placed.length; i++) {
      const b = placed[i]!;
      let lvl = 0;
      for (let j = 0; j < i; j++) { const o = placed[j]!; if (Math.abs(o.x! - b.x!) < 0.3 && Math.abs(o.z! - b.z!) < 0.3) lvl++; }
      let size = 12;
      try { size = productById(b.productId).boxSize; } catch { /* */ }
      list.push({
        pid: b.productId, x: b.x!, y: lvl * BOX_H, z: b.z!,
        ry: (hash01(Math.round(b.x! * 10), Math.round(b.z! * 10), lvl) - 0.5) * 0.5,
        open: b.units < size, fill: Math.min(1, b.units / size),
      });
    }
    boxLayer.update(list);
  }
  const boxSigOf = (v: View): string => v.sidewalk.map((b) => `${b.productId}:${b.units}:${b.x ?? '-'}:${b.z ?? '-'}:${b.carried ? 1 : 0}`).join(',');

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
    rackLayer.update(list);
  }

  /* ---------------- sincronização geral ---------------- */
  function sync(force = false): void {
    const s: StoreState = ctx.state;
    const nb = storeBounds(s.expansion);
    const sk = `${s.expansion}|${s.storageUnlocked}`;
    if (force || sk !== shellKey) {
      shellKey = sk; bounds = nb;
      env.rebuild(bounds);
      shop.rebuild(bounds, s.storageUnlocked, s.decor, s.storeName);
      decorKey = `${s.decor.wallColor}|${s.decor.floorColor}|${s.decor.signColor}|${s.storeName}`;
      env.setTime(ctx.clock.minute, true);
      navKey = ''; rackKey = ''; boxKey = ''; demoCache = null;
    }
    const dk = `${s.decor.wallColor}|${s.decor.floorColor}|${s.decor.signColor}|${s.storeName}`;
    if (dk !== decorKey) { decorKey = dk; shop.setDecor(s.decor, s.storeName); }
    const v = view();
    syncFurniture(v);
    const rk = v.furniture.filter((f) => f.type === 'rack').map((f) => `${f.id}:${f.x}:${f.z}:${f.rot}`).join(',') + '|' + PRODUCTS.map((p) => v.storage[p.id] ?? 0).join(',');
    if (rk !== rackKey) { rackKey = rk; syncRackBoxes(v); }
    const bk = boxSigOf(v);
    if (bk !== boxKey) { boxKey = bk; syncBoxes(v); boxKey = boxSigOf(v); }
    const dsk = v.dirt.map((d) => `${d.x.toFixed(1)},${d.z.toFixed(1)}`).join(';');
    if (dsk !== dirtKey) { dirtKey = dsk; syncDirt(v); }
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
        if (!nav.isWalkable(t.x, t.z)) break;
        queue.push(t);
      }
      return { furnitureId: f.id, operator: tileC(op.x, op.z), queue, scanner: localToWorld(cx, cz, f.rot, 0.52, 0.62) };
    }),
    spawnPoint: () => ({ x: -7.5, z: bounds.depth + SIDEWALK_DEPTH + 0.5 }),
    trashBin: () => trashBinPos(bounds),
    door: () => doorPos(bounds),
    group: root,
  };

  /* ---------------- ciclo do módulo ---------------- */
  function exposeDebug(): void {
    const w = window as unknown as Record<string, unknown>;
    w.__world = {
      group: root, nav, get build() { return build; },
      rebuild: () => sync(true),
      sync: () => sync(false),
      demo: (on = true) => { demo = on; demoCache = null; boxKey = ''; rackKey = ''; navKey = ''; dirtKey = ''; entries.forEach(disposeEntry); entries.clear(); sync(false); },
      nodes: () => root.children.map((c) => ({ name: c.name || c.type, type: c.type, children: c.children.length })),
      stats: () => ({ calls: ctx.renderer.info.render.calls, tris: ctx.renderer.info.render.triangles, geometries: ctx.renderer.info.memory.geometries, textures: ctx.renderer.info.memory.textures }),
      furnitureViews: () => entries.size,
      setCamera: (x: number, y: number, z: number, lx: number, ly: number, lz: number) => { ctx.camera.position.set(x, y, z); ctx.camera.lookAt(lx, ly, lz); },
      startBuild: (type: Furniture['type'], productId?: string) => ctx.bus.emit('build:start', { type, productId }),
      bounds: () => ({ ...bounds }),
      walkable: () => ({ minX: nav.minX, minZ: nav.minZ, w: nav.w, h: nav.h, rows: Array.from({ length: nav.h }, (_, r) => Array.from({ length: nav.w }, (_, c) => (nav.walk[r * nav.w + c] ? '.' : '#')).join('')) }),
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
      ctx.scene.fog = new THREE.Fog(0xd5ecff, 95, 230);
      root.add(env.group, shop.group, furniGroup, boxLayer.group, rackLayer.group);
      initDirt();
      build = new BuildMode({
        ctx, root,
        bounds: () => bounds, storageUnlocked: () => ctx.state.storageUnlocked,
        furniture: () => view().furniture,
        buildModel: (f, fr) => makeView(f, fr),
        hide: (id) => { hiddenId = id; for (const [fid, e] of entries) e.group.visible = fid !== id; },
      });
      sync(true);
      ctx.services.world = service;
      // câmera inicial: visão da fachada, caso o módulo player ainda não controle
      ctx.camera.position.set(bounds.width / 2 + 4, 11, bounds.depth + 15);
      ctx.camera.lookAt(bounds.width / 2, 0, bounds.depth / 2 - 1);
      const on = ctx.bus.on.bind(ctx.bus);
      offs.push(
        on('stateChanged', () => sync(false)),
        on('dayStarted', () => sync(false)),
        on('build:start', (p: { type: Furniture['type']; productId?: string; variant?: string }) => { sync(false); build.start(p.type, p.productId, p.variant); }),
        on('build:edit', (p: { furnitureId: number }) => { sync(false); build.edit(p.furnitureId); }),
        on('sfx', (p: { name: string }) => {
          if (p.name === 'door') doorTimer = 1.6;
          if (p.name === 'cash') for (const e of entries.values()) if (e.view.drawer) e.drawerT = 1;
        }),
      );
      exposeDebug();
    },
    update(dt) {
      acc += dt;
      if (acc >= 0.25) { acc = 0; sync(false); }
      const min = ctx.clock.minute;
      if (Math.abs(min - lastMinute) > 0.4) { lastMinute = min; env.setTime(min); }
      doorTimer = Math.max(0, doorTimer - dt);
      let near = doorTimer > 0;
      const pl = ctx.services.player;
      if (pl && !near) {
        const d = doorPos(bounds);
        near = Math.hypot(pl.position.x - d.x, pl.position.z - d.z) < 3;
      }
      shop.forceFade = build.active;
      shop.update(dt, ctx.camera, near, env.night);
      env.update(dt);
      for (const e of entries.values()) {
        if (e.view.drawer && e.drawerT > 0) {
          e.drawerT = Math.max(0, e.drawerT - dt * 1.6);
          e.view.drawer.position.z = (e.view.drawerBaseZ ?? 0) + Math.sin(Math.min(1, e.drawerT * 1.3) * Math.PI) * 0.26;
        }
      }
      build.update(dt);
    },
    dispose() {
      offs.forEach((f) => f());
      build.dispose();
      for (const e of entries.values()) disposeEntry(e);
      entries.clear();
      boxLayer.dispose(); rackLayer.dispose();
      dirtMesh?.dispose(); dirtGeo?.dispose(); dirtMat?.dispose(); dirtTex?.dispose();
      shop.dispose(); env.dispose();
      clearGroup(root);
      ctx.scene.remove(root);
      ctx.scene.fog = null;
      delete ctx.services.world;
      delete (window as unknown as Record<string, unknown>).__world;
    },
  };
}
void api;
