/**
 * Aquecimento de shaders: cada módulo registra um "fornecedor" que monta exemplos dos objetos que só aparecem depois
 * (cliente com cesta/sacola/balão, caixa na mão, pote de gorjeta, fantasma do modo construção...). No carregamento e
 * depois de uma troca de qualidade que muda os shaders (sombras ligadas/desligadas), `warmUp` compila tudo com
 * `renderer.compileAsync` (KHR_parallel_shader_compile: sem travar o quadro) usando as luzes/neblina da cena real.
 * Assim nenhum programa novo é compilado no meio do jogo (cada compilação custa dezenas de ms num celular).
 *
 * Regras para os fornecedores: use as MESMAS fábricas/materiais do jogo (o programa depende do material e do tipo de
 * objeto: Mesh × InstancedMesh × SkinnedMesh × Sprite); não descarte materiais compartilhados; os objetos de exemplo
 * ficam fora da cena e são soltos depois (geometrias/materiais em cache continuam vivos).
 */
import * as THREE from 'three';
import type { GameContext } from './module';

export type WarmProvider = (add: (o: THREE.Object3D) => void) => void;
const providers = new Set<WarmProvider>();

export function registerWarm(p: WarmProvider): () => void {
  providers.add(p);
  return () => providers.delete(p);
}

export interface WarmResult { programs: number; ms: number; objects: number }
let running: Promise<WarmResult> | null = null;
let last: WarmResult | null = null;
export const lastWarm = (): WarmResult | null => last;

/**
 * Compila os shaders dos exemplos (e, com `scene`, de toda a cena). Com `hold`, segura o render do jogo até terminar
 * (os updates continuam): usado na troca de qualidade, quando TODOS os programas mudam e desenhar antes travaria.
 */
export function warmUp(ctx: GameContext, o: { scene?: boolean; hold?: boolean } = {}): Promise<WarmResult> {
  if (running) return running.then(() => warmUp(ctx, o));
  const t0 = performance.now();
  const r = ctx.renderer;
  const before = r.info.programs?.length ?? 0;
  const group = new THREE.Group();
  group.name = 'warm';
  for (const p of providers) {
    try { p((obj) => group.add(obj)); } catch (e) { console.warn('[warm] fornecedor falhou', e); }
  }
  group.updateMatrixWorld(true);
  const objects = group.children.length;
  if (o.hold && ctx.frame) ctx.frame.hold++;
  // compileAsync só com KHR_parallel_shader_compile (sem ele o three só avisa e compila do mesmo jeito, travando)
  let parallel = false;
  try { parallel = typeof r.compileAsync === 'function' && r.extensions.has('KHR_parallel_shader_compile'); } catch { /* contexto perdido */ }
  const compile = (s: THREE.Object3D, target?: THREE.Scene): Promise<unknown> => {
    try {
      return parallel ? r.compileAsync(s, ctx.camera, target ?? null) : Promise.resolve(r.compile(s, ctx.camera, target ?? null));
    } catch (e) { console.warn('[warm] compile falhou', e); return Promise.resolve(); }
  };
  // um instante depois: a tela (UI) pinta antes; enquanto isso o render já está segurado (hold)
  const jobs = new Promise<void>((res) => setTimeout(() => {
    const list = [compile(group, ctx.scene)];
    if (o.scene) list.push(compile(ctx.scene));
    void Promise.all(list).then(() => res());
  }, 30));
  // garante término mesmo se o driver nunca responder ao estado de compilação
  const timeout = new Promise((res) => setTimeout(res, 8000));
  running = Promise.race([jobs, timeout]).then(() => {
    // 1º uso de cada programa (lista de uniforms, checagem de erros) e upload das texturas dos exemplos também saem do
    // meio do jogo: no perfil com CPU ×4 eram ~30–40% dos quadros longos quando um cliente novo aparecia
    try {
      for (const p of r.info.programs ?? []) (p as unknown as { getUniforms?: () => unknown }).getUniforms?.();
      const seen = new Set<THREE.Texture>();
      group.traverse((x) => {
        const m = (x as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const map = (mat as THREE.MeshBasicMaterial).map;
          if (map && !seen.has(map)) { seen.add(map); r.initTexture(map); }
        }
      });
    } catch (e) { console.warn('[warm] pré-upload falhou', e); }
    if (o.hold && ctx.frame) ctx.frame.hold = Math.max(0, ctx.frame.hold - 1);
    group.clear();
    running = null;
    last = { programs: (r.info.programs?.length ?? 0) - before, ms: Math.round(performance.now() - t0), objects };
    return last;
  });
  return running;
}
