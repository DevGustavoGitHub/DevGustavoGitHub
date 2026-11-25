# Desempenho mobile — rodada de otimização (Alto liso a 60 FPS)

Relato que motivou a rodada: celular Samsung forte, gráficos em "Alto" → travadinhas e FPS baixo → o jogo voltava
**sozinho** para gráficos leves (a adaptação antiga rebaixava o tier e gravava por cima da escolha do jogador).
Cenário assumido: tela de 120 Hz, DPR ≈ 2,6–3, paisagem ≈ 915×412 px CSS.

## Como medir (`tests/e2e/perf-bench.mjs`)

```
npx vite build && (npx vite preview --port 5230 --strictPort &) && BENCH_URL=http://localhost:5230/ node tests/e2e/perf-bench.mjs
```
Sem `BENCH_URL` o script sobe o próprio `vite preview`. Usa um save de **loja movimentada** (expansão 2, depósito, 22
móveis, caixa/repositor/faxineiro; gerado pelo fixture de `tests/qa-sys-sim.test.ts` ou `BENCH_SAVE=arquivo`), abre a
loja com 12–18 clientes e imprime:
- **configuração**: canvas (px), pixel ratio, amostras de MSAA, sombra (tamanho, todo quadro × estática), luzes, materiais
  por tipo, casters/receivers, transparentes, `backdrop-filter` visíveis;
- **vistas fixas** (câmera travada): draw calls e triângulos do passe principal e do passe de sombra;
- **janelas de 12 s** (CPU 1× e com `Emulation.setCPUThrottlingRate` 4× ≈ celular): JS por quadro (update + render,
  médio/p95/máx), quadros > 33/50 ms, uploads de textura de canvas (por tamanho), mipmaps, buffers por quadro, mutações
  do DOM, recálculos de estilo/layout, animações CSS rodando;
- **alocação** (amostragem do heap incluindo objetos já coletados): KB/quadro e por segundo de jogo simulado + top 10;
- **dia acelerado** (timeScale 20): shaders linkados depois da tela inicial, programas novos, uploads.
Variáveis: `BENCH_QUALITY`, `BENCH_DPR`, `BENCH_W/H`, `BENCH_THROTTLE`, `BENCH_SECS`, `BENCH_PHASES`, `BENCH_PROFILE=1`
(perfil de CPU), `BENCH_SHOTS` (prints), `BENCH_OUT` (JSON), `BENCH_JS_PR`/`BENCH_JS_SHADOW` (ver abaixo).

**Limites do ambiente (sem GPU):** o SwiftShader rasteriza na CPU (1,5 Mpx com MSAA ×4 e sombra 2048 = ~1 quadro/s),
então custo de GPU aparece só como **proxies** (pixels, amostras, passes de sombra, tipo de material, overdraw) e as
janelas de tempo de JS forçam pixel ratio 0,15 e sombra ≤ 256 para o rasterizador não dominar o relógio. Mesmo assim o
tempo de JS varia ±20% entre rodadas (as threads do SwiftShader disputam os 4 núcleos): por isso a tabela usa a
**mediana de 3 rodadas**. Não dá para medir aqui: tempo de GPU, calor/estrangulamento térmico, custo real de upload de
textura no Android, composição do WebView, efeito do limite de FPS numa tela de 120 Hz (o SwiftShader não passa de
~25 quadros/s nem com vsync desligado; o limitador foi validado por teste unitário com 60/90/120/144 Hz simulados).

## Diagnóstico (antes)

Qualidade "Alta" num celular DPR 2,625 em 915×412 (save movimentado, 16 pessoas na loja):

| Onde | Antes | Por que pesa no celular |
|---|---|---|
| Ritmo | `setAnimationLoop` sem limite: numa tela de 120 Hz desenha até 120×/s | o dobro de trabalho de CPU/GPU, calor → estrangulamento térmico depois de alguns minutos |
| Pixels | canvas 1830×824 = **1,51 Mpx** com **MSAA ×4** (6,0 M amostras) | MSAA em pixel ratio 2 quase não muda a imagem e dobra o custo de preenchimento/resolve |
| Sombra | mapa **2048² refeito todo quadro** (7 draw calls, 12,3 mil triângulos, 4,2 Mpx de profundidade) | ~1 GB/s de banda só para a sombra a 60 fps, para um cenário que quase não muda |
| Materiais | **56 de 90** materiais das malhas visíveis em `MeshStandardMaterial` (PBR) — piso, paredes, teto, móveis, rua | shader de fragmento PBR (GGX, Fresnel, multiespalhamento) na tela inteira |
| Céu | esfera desenhada **primeiro** (renderOrder −10) cobrindo a tela inteira, mesmo dentro da loja | overdraw de tela cheia todo quadro |
| Draw calls | **184–200** com 16 pessoas (≈ 10 por pessoa: corpo com 4 materiais, cabeça 2, cabelo, chapéu, óculos, sombra...) | custo de CPU do three/WebGL por chamada (validação no WebView) |
| JS por quadro (CPU ×4) | **22,6 ms** (render 17,0 + update 6,1) — mediana de 3 rodadas | acima dos 16,7 ms de 60 fps antes de qualquer custo de GPU |
| Travadas | **6 shaders compilados depois da tela inicial** (1º cliente, 1ª sacola, 1º balão, 1º pagamento...); 1ª nota/cartão e 1ª caixa de cada produto montadas na hora; textura de cada roupa nova subindo no 1º quadro | cada compilação/upload custa dezenas de ms num celular |
| Adaptação automática | média < 30 fps em 3 s → **desce um tier e grava** em `mercadinho:settings` (perdia o "Alto"), e trocar sombras **recompila todos os shaders** de uma vez | travada grande + escolha do jogador sobrescrita |
| Sync do world | cliente pega um item → `stateChanged 'shelf'` → monta ~6 chaves de string com todos os móveis e **refaz as matrizes de TODOS os itens da loja** (+ upload de todos os produtos) | 30–144 KB de lixo por quadro e picos de CPU |
| Alocação | **2,39 MB por segundo de jogo** (timeScale 1) e 7,28 MB/s (timeScale 6); top: reconstrução de itens, A* (arrays por busca), troca de programa | coletas de lixo frequentes (micro-travadas) |
| CSS | pulso do botão "Terminar o dia" animando `box-shadow` (repinta todo quadro sobre o canvas) | pintura no thread principal do WebView |

## Mudanças (arquivo → o quê e por quê)

| Área | Arquivos | Mudança |
|---|---|---|
| Ritmo de quadros | `src/core/pacer.ts`, `src/main.ts`, `tests/pacer.test.ts` | Limite de FPS (padrão **60**; opção 30/60/Sem limite). Acumulador estável: desenha quando o tempo acumulado está mais perto do alvo agora do que no próximo vsync → 60 cravados em 120 Hz, média 60 em 90/144 Hz, todos os quadros em 60 Hz (mesmo com jitter). O `dt` entregue é o tempo real desde o último quadro desenhado (física/animações iguais). |
| Qualidade automática | `src/world/quality.ts`, `src/world/drs.ts`, `src/world/index.ts`, `tests/drs.test.ts` | Modo **Automática** (padrão de quem nunca escolheu) = **resolução dinâmica** em degraus de pixel ratio com histerese; sombras só no último degrau. Escolha fixa nunca é trocada nem gravada; no máximo uma dica em toast. Ver "Qualidade automática". |
| MSAA | `src/world/quality.ts` (`wantsAntialias`), `src/main.ts` | MSAA só quando o pixel ratio efetivo é ≤ 1,5 (Média; PC com DPR 1). "Alta" em DPR ≥ 2 roda em 2× sem MSAA. |
| Sombra estática | `src/main.ts`, `src/world/index.ts`, `src/world/env.ts`, `src/player/index.ts` | `shadowMap.autoUpdate = false`; o mapa é refeito só quando o sol anda (agora em degraus de 0,5% do dia ≈ 2 s de jogo, < 1°), quando móveis/caixas/árvores mudam, quando a qualidade muda ou enquanto uma caixa arremessada voa (`world.shadowDirty()`). |
| Céu | `src/world/env.ts` | Desenhado depois dos opacos (teste de profundidade): só pinta onde aparece. |
| Materiais | `src/world/kit.ts`, `batch.ts`, `shop.ts`, `env.ts`, `tex.ts`, `atlas.ts` | Superfícies foscas (rugosidade ≥ 0,7, sem metal) em **Lambert** (mesmo difuso do PBR por fragmento). Metal, vidro, produtos (0,55), placas (0,6) continuam PBR para manter o brilho. |
| NPCs | `src/npc/body.ts`, `looks.ts`, `model.ts`, `index.ts` | Corpo com **1 material** (textura da roupa + cores de calça/pele/calçado por parte, no shader) e cabeça + cabelo + chapéu + óculos **fundidos** com 1 material (rosto misturado sobre a pele no shader, opaco); sombras (discos) de todas as pessoas num **InstancedMesh**; rotação dos ossos com `Euler.set` (1 recálculo de quatérnio em vez de 3). ≈ 10 → ≈ 4 draw calls por pessoa. |
| Shaders/uploads no meio do jogo | `src/core/warm.ts`, `src/main.ts`, provedores em world/npc/player | **Aquecimento**: cada módulo registra exemplos (pessoa com cesta/sacola/caixa/esfregão, balão, contorno, notas/cartão, pote de gorjeta, fantasma do modo construção, caixa na mão, item na esteira) e o main compila tudo com `compileAsync` no carregamento (render segurado por `ctx.frame.hold`, a UI segue respondendo), chama o 1º uso de cada programa e sobe as texturas dos exemplos (inclui as 24 roupas). Geometrias de item/caixa de todos os produtos são montadas no carregamento. Trocar sombras (opção) recompila em segundo plano do mesmo jeito. |
| Sync do world | `src/world/index.ts`, `src/world/products.ts` | Chaves de mudança **numéricas** (FNV, sem alocar) no lugar das strings; itens das prateleiras em **cache por móvel** (só o móvel que mudou é recalculado) e `ItemLayer` em blocos com upload só do produto afetado (`addUpdateRange`). |
| A* | `src/world/nav.ts` | Memória de trabalho reaproveitada (arrays da grade e heap tipados), sem trocas por desestruturação; mesmos caminhos. |
| Texturas | `src/world/tags.ts` | Atlas de etiquetas com altura exata (1024×1152 em vez de 1024×2048): −44% em cada reenvio quando um preço muda. |
| CSS | `src/ui/styles-base.ts` | Pulso só com `transform`/`opacity` (anel num `::after`): sem repintura por quadro sobre o canvas. |
| Opções | `src/ui/settings.ts`, `menu.ts`, `styles-phase4.ts`, `index.ts`, `src/audio/theory.ts` | "Qualidade gráfica": Automática/Baixa/Média/Alta; nova linha "FPS máximo": 30/60/Sem limite; "Voltar" no cabeçalho (a grade de 8 opções cabe sem rolagem em 720×330). `maxFps` e `quality:'auto'` persistidos em `mercadinho:settings` (saves antigos continuam valendo); áudio trata `auto` como média. Removido o `quality:auto` (UI não adota nada do world). |
| Android | `android/app/src/main/AndroidManifest.xml`, `MainActivity.java`, `src/native.ts` | `hardwareAccelerated="true"` explícito (WebGL do WebView exige; o padrão já é true, explícito evita desligar sem querer). Ponte `MercadinhoDisplay.setMaxFps`: com limite 60 (ou 30) a tela do celular é pedida em **60 Hz** (`preferredDisplayModeId`), "Sem limite" volta à taxa mais alta — o WebView para de compor 120 quadros/s que o jogo não desenha (mesma ideia do Android Frame Pacing). Compila (`gradlew compileDebugJavaWithJavac`); não testado em aparelho. |
| Medidas | `tests/e2e/perf-bench.mjs`, `tests/qa-sys-sim.test.ts` | Banco de medidas reutilizável (acima); fixture da loja movimentada voltou a funcionar (pulava níveis sem produto). |

## Antes × depois (Alta, DPR 2,625, 915×412, loja movimentada)

| Métrica | Antes | Depois | Nota |
|---|---|---|---|
| Quadros desenhados/s numa tela de 120 Hz | até 120 | **60** (padrão) | `tests/pacer.test.ts` (120 Hz → 60,0; 90/144 Hz → 57–63; 60 Hz → todos) |
| Pixels / amostras por quadro | 1,51 Mpx × 4 = 6,03 M | 1,51 Mpx × 1 = **1,51 M** | sem MSAA em pixel ratio 2 |
| Passe de sombra | 7 draw calls + 4,2 Mpx **todo quadro** | só quando muda (sol a cada ~2 s de jogo, cenário) | proxy de banda: ~60× menos |
| Materiais PBR (por malha visível) | 56 de 90 | **23** de 73 | Lambert 22 → 40 |
| Transparentes | 12 | **7** | rosto do NPC virou opaco |
| Céu | tela cheia todo quadro | só pixels visíveis | dentro da loja: zero |
| Draw calls, 16 pessoas na loja | 184–200 | **100–105** | vistas fixas sem clientes: 58/84/81/41/83 → 53/67/66/42/66 |
| JS por quadro, CPU 1× (mediana de 3–4 rodadas) | 4,53 ms (update 1,02 + render 3,47) | **2,9 ms** (0,72 + 2,2) | −36% |
| JS por quadro, CPU 4× (mediana de 3–4 rodadas) | 22,6 ms (6,1 + 17,0) | **15,6 ms** (4,4 + 10,8) | −31%: cabe nos 16,7 ms |
| Shaders compilados depois da tela inicial | 6 | **1** (0 durante o dia) | o perfil com CPU ×4 não mostra mais compilação nem 1ª nota/caixa/roupa nos quadros longos |
| Shaders no carregamento / aquecimento | 25 / – | 41 / 0,2–0,6 s (SwiftShader, sem compilação paralela; render segurado, tela inicial visível) | `compileAsync` com `KHR_parallel_shader_compile` no celular |
| Sync do world por `stateChanged` (cliente pega item) | 0,54 ms (itens 0,103, móveis 0,172) | **0,40 ms** (itens 0,038, móveis 0,114) | `__world.profile()`, CPU 1× |
| Alocação por segundo de jogo (timeScale 1 / 6) | 2,39 / 7,28 MB | **1,61 / 5,63 MB** | −33% / −23% (o que sobra é o passo dos agentes do npc e o three) |
| Reenvio do atlas de etiquetas | 8,4 MB | **4,7 MB** | só quando um preço muda |
| Animação CSS contínua | `box-shadow` (repinta) | `transform`/`opacity` (compositor) | botão "Terminar o dia" |
| Quadros > 50 ms em 12 s com CPU ×4 | 0–3 (máx 44–113 ms) | 1–3 (máx 51–118 ms) | ruidoso, sem melhora clara; o que sobra é upload da tela do caixa (512², a cada item bipado), cliente pegando item (sim + ouvintes) e GC |

Consumo na tela de 120 Hz, calor e tempo de GPU não puderam ser medidos aqui (ver "Como medir").

## Qualidade automática e opções

- **Opções → Qualidade gráfica:** Automática (padrão para quem nunca escolheu), Baixa, Média, Alta. **FPS máximo:** 30, 60
  (padrão), Sem limite. Ambas gravadas em `mercadinho:settings` (`quality`, `maxFps`); saves antigos com low/medium/high
  continuam valendo como escolha fixa.
- **Escolha fixa:** exatamente o que o jogador escolheu (Alta = pixel ratio 2, sombra 2048; Média = 1,5, 1024, MSAA;
  Baixa = 1, sem sombra). Nunca muda sozinha nem é gravada pelo jogo. Se ficar abaixo de 75% do FPS alvo por ~8 s, aparece
  **uma única vez** (para sempre, chave `mercadinho:qhint`) o toast "Jogo lento? Em Opções, use Qualidade gráfica: Automática."
- **Automática (`world/drs.ts`):** degraus de pixel ratio 2 → 1,75 → 1,5 → 1,25 → 1 → 0,85 (limitados ao DPR; sombra 2048
  nos degraus ≥ 1,75 e 1024 abaixo; trocar o tamanho do mapa não recompila nada). A cada janela de 1 s compara o intervalo
  médio entre quadros com o alvo (limite do jogador; sem limite = 60 fps): **desce** depois de 2 janelas abaixo de 90% (ou 1
  abaixo de 60%), só se o gargalo parecer GPU (JS do quadro < 75% do intervalo — com a CPU no limite, baixar a resolução
  não ajuda); **sobe** depois de 6 janelas boas (≥ 97%); se a subida deixa o jogo lento logo depois, volta e dobra a espera
  (até 60 janelas). Só no último degrau desliga as sombras (troca de shader, compilada em segundo plano) e não as religa na
  sessão. Ignora janelas com menu aberto, aba oculta, pausas > 250 ms e aquecimento de shaders. O último degrau estável fica
  em `mercadinho:drs` para o próximo carregamento começar no ponto certo. Ponto de partida: PC = topo; celular forte = 1,5;
  celular fraco (< 6 núcleos ou < 4 GB) = 1 sem sombras. MSAA no automático: só em telas DPR ≤ 1,5.
- Testes automatizados (WebDriver) mantêm a resolução fixa (`?autoq=1` liga). Debug: `__world.quality()`, `setTier(q)`,
  `autoQuality(on)`, `warm()`, `window.__pacer`.
- **Conferido ao vivo** (SwiftShader = "GPU" muito lenta, `?autoq=1`): com "Alta" fixa por 12 s a opção continuou "Alta"
  (pixel ratio 2, sombra 2048, `mercadinho:settings` intacto); trocando para "Automática" ela desceu 2 → 1,75 → 1,5 → 1,25 →
  1 → 0,85 e por fim tirou as sombras (4 → 14 fps), sem mexer na opção gravada (`quality: 'auto'`; degrau em `mercadinho:drs`).

## Visual do "Alto" (prints na mesma pose de câmera)

- **Lambert nas superfícies foscas** (troca em tempo real no build antigo, 6 vistas): diferença média 0,8–1,7 níveis de 255,
  < 1% dos pixels com diferença > 16 — e esses vêm do carro e do NPC que se mexeram entre os prints (imagem de diferença
  conferida). Produtos (rugosidade 0,55) ficariam sem o brilho especular nos close-ups: por isso continuam PBR.
- **Antes × depois completos** (5 vistas, DPR 2,625): diferença média 1,0–2,1, 0,2–1,6% dos pixels > 16, concentrados nas
  **bordas** (sem MSAA em 2×: serrilhado praticamente invisível na tela de ~400 ppi), nos funcionários (aparência sorteada a
  cada sessão) e nos carros.
- **NPCs**: rosto, cabelo (inclusive os de dupla face), chapéu, óculos, uniforme e crachá conferidos em close; mesmo estilo,
  sem emendas (o rosto agora é misturado à pele no shader em vez de um retalho transparente por cima).
- **Sombra estática**: igual parada; o sol muda em degraus de < 1° (antes, contínuo).

## Riscos e o que observar no celular

1. **Instalar o APK e jogar 10–15 min no "Alta" com a loja cheia**: deve ficar em 60 fps sem esquentar como antes. Se cair,
   o "Automática" deve baixar só a resolução (imagem um pouco mais suave) e voltar quando sobrar folga — sem toast, sem trocar
   a opção escolhida.
2. **Escolha fixa**: escolher "Alta", reabrir o app e conferir que continua "Alta" (antes o jogo gravava "Média/Baixa").
3. **Tela de 120 Hz**: com FPS máximo 60 a tela deve ir para 60 Hz durante o jogo (contador de FPS do sistema/Game Booster);
   em "Sem limite" o jogo tenta 120.
4. **Primeiro cliente, primeira sacola, primeiro pagamento, primeiro repositor**: não deve haver travadinha (antes havia
   compilação de shader). O carregamento pode levar ~0,1–0,5 s a mais (aquecimento), com a tela inicial já visível.
5. **MSAA**: no Alta em celular o serrilhado deve ser imperceptível; em tablets/PC (DPR ≤ 1,5) o MSAA continua.
6. Riscos: `preferredDisplayModeId` é sugestão (o sistema pode ignorar em economia de bateria); o shader de "cor por parte"
   dos NPCs foi conferido no SwiftShader (ANGLE) — GPUs Mali/Adreno devem se comportar igual, mas vale olhar os rostos;
   mapa de sombra estático depende de avisar `shadowDirty()` quem mover algo que projeta sombra.
7. Próximos passos de maior impacto: ver `docs/ARCHITECTURE.md` (bake de luz/AO da casca da loja, NPC em lote, IA em
   Worker, WebGPU).
