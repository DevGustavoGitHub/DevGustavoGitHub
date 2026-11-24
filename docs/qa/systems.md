# QA de sistemas — save, consistência, longa duração e APK (Fase 4)

Data: 24/11/2026 · Build próprio (`vite build --outDir <scratchpad>`), Chromium + SwiftShader, 844×390 com toque ·
Testes: `tests/qa-sys-sim.test.ts` (vitest), `tests/e2e/qa-sys-save.e2e.mjs`, `tests/e2e/qa-sys-longrun.e2e.mjs`.
Nenhum código do jogo foi alterado. Os testes listados na coluna "Teste" **falham enquanto o problema existir** — por isso
`npx vitest run` passa a acusar 6 falhas em `qa-sys-sim` (itens 3, 5, 6 e 9; intencional) e o e2e de save termina com 10 FAIL / 33 PASS.

## Resumo priorizado

| # | Sev. | Problema | Módulo / arquivo | Teste que falha |
|---|---|---|---|---|
| 1 | **Alta** | Ir para segundo plano no APK **não salva**: só `pagehide` (o WebView do Android não dispara ao minimizar) e o autosave de 15 s. Se o Android matar o app, perde até 15 s | `src/main.ts:57-59` | e2e `[2º plano] save imediato…` |
| 2 | **Alta** | Hora/fase do dia **não são salvas**: recarregar/reabrir no meio do dia ou à noite volta para **08:00 "preparação" do mesmo dia**, com o caixa do dia já contado, e a agenda de clientes do dia inteiro é refeita (dia "repetido") | `src/core/clock.ts` (fora do `StoreState`), `src/npc/index.ts:144-148` | e2e `[clientes] relógio…`, `[noite] após recarregar…` |
| 3 | **Alta** | Save com **tipo de móvel desconhecido** (APK mais antigo instalado por cima, tipo renomeado) **trava a inicialização** (`Cannot read properties of undefined (reading 'w')`); o save nunca é trocado → o app não abre mais | `src/sim/save.ts` (`deserialize` não valida `Furniture.type`) | vitest `tipo de móvel desconhecido…`; e2e `[corrompido] … ainda abre o jogo` |
| 4 | Média | **Unidades nas cestas/esteira somem** ao salvar e recarregar (itens tirados com `takeFromLevel` só existem na memória do npc) e o custo médio fica incoerente para sempre (`costBasis.units` > estoque) | `src/main.ts` (`ctx.save`), `src/npc/customer.ts` | e2e `[clientes com itens…]`, `[pagamento aberto]` (unidades e custo médio) |
| 5 | Média | **Save ilegível é descartado em silêncio**: `load()` → `null` → jogo novo; a tela inicial ainda diz "Continuar" e o 1º autosave **sobrescreve** o save antigo, sem backup | `src/sim/save.ts:load`, `src/main.ts:33`, `src/ui/menu.ts:34` | vitest `save recusado não é sobrescrito…`; e2e `[corrompido] save ilegível…` |
| 6 | Média | `unlockStorage` com móvel no vão da futura passagem (fundo do salão, x = porta−1..porta, z = 0) deixa o **depósito bloqueado** (não chama `relocateBlocking`) | `src/sim/api.ts:152`, `src/sim/furniture.ts` | vitest `desbloquear o depósito…` e fuzz `nenhum móvel fica na antessala…` |
| 7 | Média | **Botão/gesto Voltar do Android** sem tratamento: sai do jogo sem confirmar e sem salvar (Android ≤ 11 fecha a Activity; 12+ manda para 2º plano). Um toque no Voltar ou um gesto de borda (a área de olhar vai até a borda direita) basta | `android/…/MainActivity.java` (sem `OnBackPressedCallback`; sem `@capacitor/app`) | — (revisão de código) |
| 8 | Baixa | Comemoração de nível não vista se perde ao recarregar (`consumeLevelUps` grava `levelAck` na hora; a fila é só memória) | `src/ui/index.ts:91-95`, `src/ui/celebrate.ts` | e2e `[nível] comemoração…` |
| 9 | Baixa | `deserialize` não saneia campos numéricos/objetos nem produtos desconhecidos: `money` null (um NaN qualquer vira `null` no JSON e fica para sempre), texto, `prices/costBasis/licenses` null, depósito negativo, móvel sem x/z, caixa/depósito de produto que saiu do catálogo → `TypeError`/NaN em `priceInfo`, `makeShoppingList`, `buyMissing` | `src/sim/save.ts` | vitest `campos numéricos/objetos inválidos…`, `produto desconhecido…` |
| 10 | Baixa | Devoluções passam do limite de 48 caixas da calçada (retirar do depósito, vender/desmontar móvel abastecido, migração: 60 caixas no teste); depois disso compras e **pedido automático falham em silêncio** (`runAutoOrders` engole "Calçada cheia"/"Dinheiro insuficiente") | `src/sim/levels.ts:returnUnits`, `src/sim/api.ts:254,523` | — (registrado no fuzz; compras respeitam o limite) |
| 11 | Baixa | APK: `FLAG_KEEP_SCREEN_ON` sempre (também no menu/pausa/resumo); `versionCode 1` fixo (um APK **mais antigo** instala por cima de um novo — combina com o #3); `minSdk 23` sem checar o WebView (o bundle usa `structuredClone`/`Object.hasOwn`: WebView < 98 quebra) | `android/app/…/MainActivity.java`, `android/app/build.gradle`, `android/variables.gradle` | — |
| 12 | Info | Texturas de rostos/roupas dos clientes ficam em cache por variante: 18 → 124 em 9 dias, estabilizando (~140 no máx., ≈ 10–14 MB de GPU com mipmaps). Não é vazamento | `src/npc/looks.ts` | longrun `texturas estabilizam` (passa) |

## Detalhes

### 1 — Segundo plano não salva (Alta)
- **Passos:** jogar; mudar algo (comprar, repor); minimizar o app (ou trocar de app). O Android mata o processo depois (pouca RAM).
- **Esperado:** salvar ao ficar oculto (`visibilitychange` → `hidden`, que o WebView dispara; e/ou o evento `pause` que o Capacitor dispara no `document`).
- **Obtido:** nada é salvo; só o intervalo de 15 s e o `pagehide` (que só ocorre em navegação/descarte). e2e: save gravado tinha `money=30007`, o estado `30018`.
- **Código:** `main.ts` só tem `setInterval(save, 15000)`, `bus.on('dayEnded')` e `pagehide`. O Capacitor (MockCordovaWebViewImpl) já emite `document` `pause`/`resume`.

### 2 — Relógio do dia não persiste (Alta)
- **Passos:** abrir a loja, deixar chegar a 08:46 (ou 21:00, noite), recarregar/reabrir.
- **Esperado:** voltar na mesma hora/fase (ou, à noite, no fim do dia).
- **Obtido:** `{"antes":["open",526],"depois":["prep",480]}` e `{"antes":[1,"closing",1260],"depois":[1,"prep",480]}`. O `ledger` do dia (receita, atendidos) continua; ao abrir a loja de novo, `buildSchedule` recria **todas** as chegadas do dia (`filter(t >= minute-1)` com minute = 480) → mais clientes e receita no mesmo dia sem aluguel extra. Com o #1 e o Android matando apps, isso acontece com frequência no celular.

### 3 — Tipo de móvel desconhecido trava o boot (Alta)
- **Passos:** save com `{type:'balcao-antigo'}` (equivale a instalar um APK mais antigo por cima de um save novo, ou a renomear um tipo). Abrir o jogo.
- **Esperado:** descartar/converter o móvel (como já é feito com `furnitureStock` inválido) e abrir.
- **Obtido:** `pageerror: Cannot read properties of undefined (reading 'w')` na inicialização; `__game` nunca existe; como nada é salvo, **todo boot falha** (só limpando os dados do app). Produto desconhecido na calçada/depósito **não** trava o boot (ver #9).

### 4 — Cestas dos clientes somem no save (Média)
- **Passos:** loja aberta com clientes pegando produtos (ou sentado no caixa com itens na esteira, ou com o painel de pagamento aberto); recarregar (ou o autosave + Android matando o app).
- **Esperado:** total de unidades (níveis + depósito + calçada + cestas) igual depois de recarregar (ex.: devolver as cestas às prateleiras numa cópia ao salvar).
- **Obtido (3 execuções):** 4 clientes com 12–14 un. nas cestas → todas somem (ex.: `{"feijao":-4,"macarrao":-8}`); pagamento aberto → 3–5 un. somem (ex.: `{"feijao":-3,"macarrao":-2}`). `costBasis.units` continua contando essas unidades (só cai na venda) → depois `costBasis − possuídas = {"feijao":7,"macarrao":10}` permanente (distorce o custo médio das compras seguintes). Dinheiro não muda.
- Com loja cheia (14 clientes, até 7 itens cada) a perda por recarga passa de 50 un.

### 5 — Save ilegível sobrescrito sem aviso (Média)
- **Passos:** save com JSON quebrado (ou `sidewalk:[null]`, ou `version ≠ 1`). Abrir.
- **Obtido:** jogo novo (dia 1) e o botão diz **"Continuar"** (`hasSave()` só vê a chave); em ≤ 15 s o autosave grava por cima. Nenhuma cópia (`load` não guarda o texto ruim; `main.ts` usa `load(kv) ?? newGame()`).
- **Esperado:** guardar o texto original numa chave de backup e avisar ("save danificado"), oferecendo novo jogo.

### 6 — Depósito bloqueado após desbloquear (Média)
- **Passos:** loja 12×10, prateleira em (5,0) (permitida antes do depósito); comprar o depósito.
- **Obtido:** `tile reservado (5,0)/(6,0) ocupado por shelf #4`. O fuzz achou o mesmo com balcão (seed 11) e decoração (seed 59). Na navegação do world (`nav.ts`), a parede salão↔depósito só é atravessada nesses 2 tiles → jogador e repositor não entram no depósito até o jogador mover o móvel.
- **Esperado:** `unlockStorage` chamar `relocateBlocking` (como `buyExpansion`) ou recusar com mensagem.

### 7 — Voltar do Android (Média)
- `BridgeActivity` do Capacitor 7 não trata Voltar (o tratamento fica no plugin `@capacitor/app`, ausente: `capacitor.plugins.json` = `[]`). Sem confirmação e, por causa do #1, sem save. Sugestão: `OnBackPressedCallback` que abre o menu de pausa (ou pede confirmação) e salva.

### 8–11 — Baixas
- **8:** com 5000 XP de uma vez a comemoração abriu; após recarregar não reaparece (`levelAck` já consumido).
- **9:** vitest lista: `dinheiro null`/texto → `dinheiro não inteiro`; `prices null` → `priceInfo: Cannot read properties of null`; `costBasis null`; `licenses null` → `makeShoppingList`/`buyMissing` TypeError; depósito −5; móvel sem x/z (NaN na ocupação); produto `xyz` na calçada/depósito → `Produto desconhecido` em qualquer leitura por produto.
- **10:** no fuzz, só `takeFromStorage` e `sellFurniture` levaram a calçada acima de 48; nenhuma compra passou do limite. Na longa duração, a calçada ficou em 43–47 caixas com pedidos automáticos ativos.
- **11:** `MainActivity` mantém a tela ligada sempre; `versionCode 1` nunca muda.

## O que foi verificado e passou
- **Fuzz da sim** (6 seeds × 2.500 ações aleatórias — 30 tipos: compras, carrinho, montar/mover/vender/desmontar, níveis, clientes comprando/desistindo, depósito, expansões, funcionários, empréstimo, pedidos automáticos, melhorias, licenças, dias, falência → recomeço, save/load): **369 dias, 102 falências com recomeço, até 4 expansões**. Sem erro de programação, sem estado pela metade quando uma função recusa, e após cada passo: dinheiro inteiro, unidades ≥ 0, `shelf`/`slots` = soma dos níveis, níveis ≤ capacidade e com categoria aceita, `costBasis.units` = unidades possuídas, caixas ≤ `boxSize`, depósito ≤ capacidade, ledger coerente, XP/nível coerentes, móveis sem sobreposição e dentro dos limites, porta sempre livre (só a passagem do depósito falha, #6). **Save → load devolve o estado idêntico** em todos os passos.
- **Migração:** saves das Fases 1/2 (sem móveis, só `state.shelf`), Fase 2 (sem `loan/autoOrders/upgrades/history/stats`) e Fase 3 (`Furniture.productId` + estoque somado, sem `levels/furnitureStock/Box.open/happy/angry`) carregam sem erro e sem perder dinheiro, dívida ou unidades (vitest e no navegador).
- **Save/recarregar no navegador:** carregando caixa (volta ao chão, sem caixa "fantasma"), modo de posicionamento (não fica preso; móvel continua no estoque de montagem), noite e empréstimo (dinheiro, unidades, caixas e móveis preservados), falido (tela de falência ao continuar; recomeço com R$ 300 persiste). Autosave de 15 s e `pagehide` gravam.
- **Ciclo de vida:** áudio suspende ao ficar oculto e volta ao retornar; o relógio não anda em 2º plano (o laço é `setAnimationLoop`/rAF, parado com a página oculta, e `dt` limitado a 0,1 s na volta — sem salto de horas); tela cheia imersiva reaplicada em `onResume` e `onWindowFocusChanged`; `sensorLandscape`; `configChanges` evita recriar a Activity ao girar.

## Longa duração (9 dias, timeScale 20, loja movimentada)
Loja: expansão 2, depósito com 3 estantes, 21 móveis abastecidos, 2 balcões, caixa + repositor + faxineiro, pedidos automáticos, até 14 clientes simultâneos. Qualidade "low". 294 atendidos / 251 perdidos, **0 erros de console**, **conservação de unidades ok o tempo todo** (`costBasis.units` = níveis + depósito + calçada + cestas, sem recarregar), nenhuma caixa "carregada" sem dono.

| Fim do dia | Atend./perd. | Geometrias | Texturas | Programas | Objetos na cena | Nós DOM | Ouvintes do bus | Heap após GC (MB) | Save (KB) |
|---|---|---|---|---|---|---|---|---|---|
| início | – | 51 | 18 | 23 | 250 | 127 | 51 | 7,9 | 6,0 |
| 1 | 39/28 | 103 | 81 | 30 | 337 | 128 | 51 | 12,3 | 10,2 |
| 2 | 35/24 | 107 | 101 | 30 | 340 | 128 | 51 | 12,6 | 11,0 |
| 3 | 41/27 | 109 | 113 | 30 | 342 | 128 | 51 | 12,8 | 11,6 |
| 5 | 36/28 | 110 | 120 | 30 | 344 | 128 | 51 | 12,7 | 12,8 |
| 7* | 11/7 | 110 | 122 | 30 | 340 | 128 | 51 | 13,2 | 13,5 |
| 9 | 34/39 | 110 | 124 | 30 | 341 | 128 | 51 | 13,1 | 14,3 |

\* Dia 7: a comemoração do nível 13 pausa o relógio (por desenho) e o teste não a fechou; o dia foi encerrado à força.
Sem vazamento: geometrias/objetos/DOM/ouvintes estáveis, heap após GC +0,8 MB em 8 dias; save cresce ~0,6 KB/dia até o teto de 30 dias de histórico.

**Custo por quadro** (CDP `Performance.getMetrics`, timeScale 1, CPU de desktop; o SwiftShader infla o TaskDuration para 160–260 ms/quadro, então só o script conta): **3,8–5,0 ms de JS por quadro com 8–14 clientes** contra **2,3 ms com a loja vazia** (estilo/layout < 0,2 ms). Num celular médio (JS ~3–4× mais lento) isso dá ~12–20 ms só de script com a loja cheia: risco para 60 fps, ok para 30 fps — medir no aparelho.

Observação de balanço (fora do escopo de sistemas): ~46% dos clientes saem sem comprar com 1 caixa nível 1 para 14 clientes; tirar o 2º balcão sem operador não muda (31 vs 26 perdidos), o gargalo é a vazão do caixa.

## Como rodar
```
npx vitest run tests/qa-sys-sim.test.ts                         # fuzz, migração, saves corrompidos, depósito
npx vite build --outDir /tmp/qa/dist
QA_DIST=/tmp/qa/dist node tests/e2e/qa-sys-save.e2e.mjs          # sobe vite preview na 5212 (QA_URL usa outro servidor)
QA_FIXTURE=/tmp/qa/busy.json npx vitest run tests/qa-sys-sim.test.ts -t fixture
QA_DIST=/tmp/qa/dist QA_SAVE=/tmp/qa/busy.json QA_DAYS=9 QA_OUT=/tmp/qa/longrun.json node tests/e2e/qa-sys-longrun.e2e.mjs   # ~18 min
```
