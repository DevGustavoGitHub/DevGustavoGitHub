# Arquitetura: ajustar a atual ou trocar de engine?

Pergunta: para o Mercadinho 3D (simulador de mercadinho low-poly em 1ª pessoa, celular deitado, muitos produtos
instanciados, NPCs andando, caixas, etiquetas e UI pesada em DOM) ficar bem otimizado e bonito, vale mais **ajustar**
Three.js + Capacitor (WebView) ou **trocar** para outra engine web (Babylon.js, PlayCanvas) ou nativa (Godot 4, Unity URP)?
Referência de estilo: "My Supermarket Simulator 3D" (Playspare), app nativo de loja ([App Store][apple]). Pesquisa
limitada (12 buscas, fontes no fim) somada às medidas deste repositório (`docs/PERF.md`, `tests/e2e/perf-bench.mjs`).

## Recomendação

**MANTER Three.js + Capacitor e continuar ajustando.** Confiança: **média-alta (~75%)**.

- Os custos que derrubavam o "Alto" eram de **conteúdo e de arquitetura do nosso código**, não do WebView: PBR em
  tudo, mapa de sombra 2048² refeito todo quadro, MSAA ×4 sobre 2× de pixel ratio, laço sem limite em tela de 120 Hz,
  ~10 draw calls por pessoa, shaders compilados no meio do jogo e reconstrução da loja inteira a cada item pego. Tudo isso
  foi corrigido dentro da stack atual (ver "Ajustes feitos"); a cena típica com 16 pessoas caiu de ~200 para ~100 draw
  calls, bem abaixo do orçamento usual para WebView (< 500 por quadro segundo o guia da Amazon para WebView/WebGL
  [amazon]).
- Trocar significa reescrever ~21 mil linhas (sim, world, player, npc, ui) e perder a bateria de testes (Vitest + 19
  e2e Playwright) — meses de trabalho com risco alto de regressão de mecânica, para um ganho que este estilo visual quase
  não aproveita.
- O teto visual de uma engine nativa é maior (GI pré-calculada pronta, pós-processamento, compressão ASTC), mas a parte
  que mais muda a cara de um jogo low-poly — **iluminação pré-calculada** — também dá para fazer em Three.js (`lightMap`/
  `aoMap`, e materiais Lambert/Basic, como recomendado na comunidade [three-baked][three-cost]).

**Quando reconsiderar (gatilhos para Godot 4):** se, depois destes ajustes, um celular médio-alvo medido com o APK
ainda não segurar 60 fps em 1,25× com ~18 pessoas; se o roteiro visual exigir GI em tempo real/pós-processamento; ou se o
WebView mostrar problemas por aparelho (há relatos de WebGL mais lento no WebView que no Chrome [khadas][babylon-wv]).

## Como jogos desse estilo são feitos e otimizados (o que a pesquisa diz)

| Técnica | O que as engines/guias recomendam | Situação no Mercadinho |
|---|---|---|
| Iluminação | Luz **pré-calculada** (lightmaps) é a forma mais barata; light probes (harmônicos esféricos) para objetos que se movem [unity-tips][android-light] | Sol + hemisfério dinâmicos; sombra agora **estática** (refeita só quando algo muda). Bake de luz/AO = próximo passo |
| Materiais | Unlit/Lambert com **texturas em atlas**; custo cresce Basic < Lambert < Phong < Standard < Physical [three-cost] | Superfícies foscas passaram de Standard para **Lambert** (diferença média < 2/255); atlases já existiam |
| Draw calls | Batching/instancing, atlas, menos casters de sombra [unity-tips][urp-perf]; no WebGL cada chamada custa mais (validação) [emscripten][chromium-gl] | Móveis fundidos, itens instanciados (já havia); NPC 10 → ~4 chamadas; sombras dos NPCs num só InstancedMesh |
| Sombras | Desligar casters onde puder, reduzir resolução, sombras "blob" para personagens [urp-perf][unity-tips] | NPCs já usavam blob; agora 1 draw call para todos; 7 casters estáticos |
| FPS | Unity usa 30 fps por padrão no mobile [unity-tips]; o Frame Pacing do Android escolhe a taxa da tela mais próxima do alvo (ex.: 60 numa tela de 120 Hz) e economiza bateria [swappy] | **Limite de 60 fps** (opção 30/60/Sem limite) com acumulador estável |
| Resolução | Escala de renderização/resolução dinâmica é padrão em engines mobile [urp-perf] | **Modo Automático** com resolução dinâmica e histerese |
| Texturas | ASTC/ETC2 (KTX2/Basis no web) reduzem memória e travadas de upload [unity-tex][mccurdy] | Texturas são canvas procedurais pequenas; sem ganho relevante agora |
| Shaders | Pré-aquecer/compilar antes do jogo; no web, `KHR_parallel_shader_compile` | **Aquecimento** com `compileAsync` no carregamento |

## Comparação das opções para ESTE jogo

| Critério | (a) Three.js + Capacitor, ajustado | (b) Babylon.js ou PlayCanvas no WebView | (c1) Godot 4 (Mobile/Compatibility) | (c2) Unity URP |
|---|---|---|---|---|
| Desempenho Android médio/alto | Bom após os ajustes; sobrecarga do WebGL por chamada e validação [emscripten][chromium-gl]; sem Vulkan no web | Igual ao (a): mesmo WebView/WebGL. PlayCanvas tem fama de rápido no mobile, mas sem benchmark controlado [utsubo]; Babylon é mais pesado no download (~1,4 MB vs ~170 kB) [utsubo] | Nativo (GLES3/Vulkan), sem WebView; Compatibility é o renderizador indicado para mobile fraco [godot-rend]; relatos de Godot 4 mais lento que 3.5 em Android [godot-fórum] | Nativo, o mais maduro para mobile (SRP Batcher, bake, probes) [urp-perf][unity-tips] |
| Teto visual | Médio-alto para low-poly (bake via lightMap, WebGPU no futuro) [webgpu-android] | Parecido; Babylon com pipeline PBR/WebGPU mais completo | Alto (LightmapGI, SDFGI no Forward+) | O mais alto (GI pré-calculada, pós, VFX) |
| Custo/risco de migração | Nenhum (evolução incremental, testes atuais continuam valendo) | Alto: reescrever world/player/npc (≈ 9 mil linhas de 3D) + adaptar testes; ganho incerto | Muito alto: reescrever tudo em GDScript/C#, UI do zero, perder Vitest/Playwright | Muito alto: igual ao Godot + C# + editor obrigatório para cenas/prefabs |
| Build NESTE ambiente (Linux, sem GPU, sem editor, linha de comando) | Já funciona (vite + cap sync + gradle) | Funciona (mesmo fluxo) | Possível: `godot --headless --export-debug` com preset + templates de export [godot-export][godot-ci] | Difícil: licença precisa ser ativada (e só planos pagos rodam em linha de comando segundo relatos) e o editor em batchmode no Linux pede servidor X/Xvfb [unity-ci][unity-lic][bitrise] |
| Manutenção | Uma linguagem (TS), testes rápidos, atualização do three a cada mês | Idem, comunidade menor | Bom, mas equipe e testes recomeçam | Licença/versões do editor; projeto binário difícil de revisar |

## Ajustes de arquitetura

### Feitos nesta rodada (detalhes e números em `docs/PERF.md`)
1. **Laço com limite de FPS** (`core/pacer.ts`, padrão 60; Opções: 30/60/Sem limite).
2. **Qualidade "Automática" com resolução dinâmica** (`world/drs.ts`), sem nunca sobrescrever a escolha do jogador.
3. **Mapa de sombra estático** (só refaz quando o sol anda ou o cenário muda) e **céu desenhado depois dos opacos**.
4. **Materiais**: foscos em Lambert; **MSAA só com pixel ratio ≤ 1,5** (no "Alta" em DPR ≥ 2 o MSAA quase não muda a imagem).
5. **NPCs**: corpo e cabeça (com cabelo/chapéu/óculos) com UM material cada (cor por parte no shader) e sombras de todos
   num InstancedMesh: ~10 → ~4 draw calls por pessoa; menos recálculos de quatérnio na animação.
6. **Aquecimento de shaders** (`core/warm.ts`): tudo compilado no carregamento (sem travadinha no 1º cliente).
7. **Sincronização do mundo**: chaves de mudança numéricas (antes strings gigantes) e itens das prateleiras recalculados
   só no móvel que mudou, com upload só do produto afetado.
8. UI: animação de pulso só com transform/opacity; atlas de etiquetas sem área desperdiçada.

### Para depois (ordem de impacto estimado)
1. **Bake de luz/AO da casca da loja** (piso, paredes, teto, móveis fixos) em `lightMap`/`aoMap` e materiais Lambert/Basic;
   com isso o "Alta" pode dispensar a amostragem do mapa de sombra no interior e ficar mais bonito (AO suave). Pode ser
   gerado offline em CPU (este ambiente não tem GPU) ou uma vez no aparelho.
2. **Pedir 60 Hz à tela no Android** (`preferredDisplayModeId` quando o limite é 60), como faz o Frame Pacing [swappy]:
   menos composição a 120 Hz e menos bateria. Requer ponte JS → Java no `MainActivity`.
3. **NPC em lote**: animação por textura (VAT) ou LOD de malha para quem está longe; cesta + itens no mesmo draw call.
4. **IA/caminhos num Web Worker** (A* e decisões dos clientes fora da thread principal).
5. **WebGPU** (`WebGPURenderer` do three) quando a cobertura no Android for ampla: render bundles reduzem custo de CPU
   por draw call [webgpu-android][webdev-webgpu].
6. **KTX2/Basis** se entrarem texturas grandes (fotos, marcas) [mccurdy].

### Se um dia a decisão for TROCAR (Godot 4, renderizador Compatibility)
Etapas: (1) protótipo de 2 semanas com a loja + 20 NPCs medido no aparelho-alvo; (2) portar `src/sim` (regras puras) para
GDScript/C# com os testes de unidade (3–4 semanas); (3) cenário, móveis e itens instanciados (MultiMesh) (3–4 semanas);
(4) player e NPCs (4–6 semanas); (5) UI (tablet, pagamentos, HUD) em Control nodes (6–8 semanas); (6) export headless em
CI e paridade de saves. **Esforço: ~5–7 meses de 1 pessoa**. Riscos: regressões de mecânica sem a suíte atual, UI muito
mais trabalhosa que em DOM, desempenho do Godot 4 em Android fraco abaixo do esperado [godot-fórum], e builds com
templates/NDK presos à versão [godot-export].

## Fontes

- `apple` — [My Supermarket Simulator 3D (Playspare)](https://apps.apple.com/US/app/id6511238101)
- `unity-tips` — [Unity, otimização mobile (iluminação, sombras, batching, 30 fps)](https://unity.com/how-to/mobile-game-optimization-tips-part-2)
- `urp-perf` — [Unity URP, configurar para desempenho](https://docs.unity3d.com/Manual/urp/configure-for-better-performance.html)
- `android-light` — [Android Developers, iluminação para jogos mobile](https://developer.android.com/games/optimize/lighting-for-mobile-games-with-unity)
- `unity-tex` — [formatos de textura por plataforma (ASTC/ETC2)](https://docs.unity3d.com/Manual/texture-choose-format-by-platform.html)
- `mccurdy` — [formatos de textura para WebGL/WebGPU (KTX2/Basis)](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)
- `swappy` — [Android Frame Pacing (Swappy)](https://developer.android.com/games/sdk/frame-pacing)
- `emscripten` — [custo por chamada no WebGL](https://emscripten.org/docs/optimizing/Optimizing-WebGL.html)
- `chromium-gl` — [OpenGL vs WebGL no Android (Chromium, 2013)](https://groups.google.com/a/chromium.org/g/graphics-dev/c/PpCagID7WFQ)
- `amazon` — [boas práticas WebGL em WebView (< 500 draw calls)](https://developer.amazon.com/docs/vega/0.24/webview-webgl-best-practices.html)
- `khadas` — [relato de WebGL mais lento no WebView](https://forum.khadas.com/t/webview-webgl-performance-problem/1706)
- `babylon-wv` — [WebView vs Chrome no Android](https://forum.babylonjs.com/t/webgl2-perfomance-issue-on-android-embeded-webview-vs-chrome/1319)
- `three-cost` — [custo relativo dos materiais do three](https://discourse.threejs.org/t/are-there-settings-for-shading-rate-or-shading-precision/12259)
- `three-baked` — [lightmap/MeshBasic para luz pré-calculada](https://discourse.threejs.org/t/why-should-i-use-lightmap-instead-of-draw-shadow-in-diffusemap/46759)
- `utsubo` — [Three.js vs Babylon.js vs PlayCanvas (2026)](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison)
- `godot-rend` — [renderizadores do Godot 4](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html)
- `godot-fórum` — [Godot 3 vs 4 em mobile](https://forum.godotengine.org/t/godot-3-vs-godot-4-mobile-games/36251)
- `godot-export` — [export Android (SDK/NDK/templates)](https://docs.godotengine.org/en/4.5/tutorials/export/exporting_for_android.html)
- `godot-ci` — [export por linha de comando em CI](https://forum.godotengine.org/t/godot-export-to-android-from-command-line-in-ci/20520)
- `unity-ci` — [Unity em batchmode](https://docs.unity3d.com/2021.1/Documentation/Manual/CommandLineArguments.html)
- `unity-lic` — [ativação de licença no Linux exige X/Xvfb](https://issuetracker-mig.prd.it.unity3d.com/issues/linux-unity-licensing-command-on-linux-pops-a-progress-bar-when-using-batchmode-and-nographics)
- `bitrise` — [builds Unity por linha de comando exigem licença (relato)](https://discuss.bitrise.io/t/building-on-unity-with-bitrise/23185)
- `webgpu-android` — [WebGPU no Chrome Android (Android 12+, Qualcomm/ARM)](https://developer.chrome.com/blog/new-in-webgpu-121)
- `webdev-webgpu` — [WebGPU nos navegadores, render bundles](https://web.dev/blog/webgpu-supported-major-browsers)

[apple]: https://apps.apple.com/US/app/id6511238101
[unity-tips]: https://unity.com/how-to/mobile-game-optimization-tips-part-2
[urp-perf]: https://docs.unity3d.com/Manual/urp/configure-for-better-performance.html
[android-light]: https://developer.android.com/games/optimize/lighting-for-mobile-games-with-unity
[unity-tex]: https://docs.unity3d.com/Manual/texture-choose-format-by-platform.html
[mccurdy]: https://www.donmccurdy.com/2024/02/11/web-texture-formats/
[swappy]: https://developer.android.com/games/sdk/frame-pacing
[emscripten]: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html
[chromium-gl]: https://groups.google.com/a/chromium.org/g/graphics-dev/c/PpCagID7WFQ
[amazon]: https://developer.amazon.com/docs/vega/0.24/webview-webgl-best-practices.html
[khadas]: https://forum.khadas.com/t/webview-webgl-performance-problem/1706
[babylon-wv]: https://forum.babylonjs.com/t/webgl2-perfomance-issue-on-android-embeded-webview-vs-chrome/1319
[three-cost]: https://discourse.threejs.org/t/are-there-settings-for-shading-rate-or-shading-precision/12259
[three-baked]: https://discourse.threejs.org/t/why-should-i-use-lightmap-instead-of-draw-shadow-in-diffusemap/46759
[utsubo]: https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison
[godot-rend]: https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html
[godot-fórum]: https://forum.godotengine.org/t/godot-3-vs-godot-4-mobile-games/36251
[godot-export]: https://docs.godotengine.org/en/4.5/tutorials/export/exporting_for_android.html
[godot-ci]: https://forum.godotengine.org/t/godot-export-to-android-from-command-line-in-ci/20520
[unity-ci]: https://docs.unity3d.com/2021.1/Documentation/Manual/CommandLineArguments.html
[unity-lic]: https://issuetracker-mig.prd.it.unity3d.com/issues/linux-unity-licensing-command-on-linux-pops-a-progress-bar-when-using-batchmode-and-nographics
[bitrise]: https://discuss.bitrise.io/t/building-on-unity-with-bitrise/23185
[webgpu-android]: https://developer.chrome.com/blog/new-in-webgpu-121
[webdev-webgpu]: https://web.dev/blog/webgpu-supported-major-browsers
