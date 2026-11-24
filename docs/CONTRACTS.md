# Contratos da equipe — Mercadinho 3D

Jogo 3D (Three.js + Vite + TypeScript) de gerenciamento de supermercado para celular/desktop, **sem anúncios e sem energia**.
Mecânicas: `docs/GDD.md` (visão), `docs/RESEARCH.md` (detalhes do jogo de referência). Decisões de produto já tomadas:
- Entrega de caixas **instantânea** (sem espera artificial). Sem energia, sem anúncios, sem bloqueios por tempo.
- Funcionários são **contratados permanentemente** (salário diário, evolução até nível 5) — sem contrato que expira.
- Ladrões ficam fora da v1. Estoque no depósito **não** é reorganizado ao reabrir o jogo.
- Texto de UI em **português do Brasil**. Dinheiro em centavos (inteiros), exibido como `R$ 1.234,50`.
- **Arte 100% original e procedural** (geometrias Three.js, canvas/CanvasTexture, CSS). Nada de assets de terceiros, nada baixado, nada copiado do jogo de referência.

## Arquitetura
```
src/core/    contratos: events, clock, layout, module, services  (leitura; mudanças só aditivas e mínimas)
src/sim/     regras e economia puras (sem DOM/Three). api.ts = assinaturas CONGELADAS
src/world/   cena 3D: loja, móveis, caixas, rua, build mode, grade de navegação
src/player/  avatar, controles (joystick+swipe / WASD+mouse), câmera, interações
src/npc/     clientes e funcionários (IA, fila, checkout), sujeira
src/ui/      HUD, tablet de gestão, minigame de checkout, relatório, menus (DOM/CSS)
src/audio/   sons procedurais (WebAudio)
tests/       Vitest (sim) e e2e
```
`main.ts` instancia os módulos na ordem world → player → npc → audio → ui. Cada `src/<área>/index.ts` exporta
`default function create(): GameModule`. Módulos publicam serviços em `ctx.services` (ver `core/services.ts`).

## Estado e API
- Estado único: `ctx.state` (`StoreState`, salvo em localStorage). **Só se muda estado via `src/sim/api.ts`** (ou economy.ts). Módulos de render leem o estado.
- Posições em tiles (ver `core/layout.ts`). Origem no canto traseiro-esquerdo do salão; +z em direção à rua.
- Câmera/Three: `ctx.scene`, `ctx.camera`, `ctx.renderer`. 1 unidade = 1 metro. Y para cima.

## Eventos (EventBus `ctx.bus`) — quem emite → quem escuta
| Evento | Payload | Emissor → ouvintes |
|---|---|---|
| `storeOpened` / `storeClosing` / `dayStarted` | – | clock → todos |
| `storeEmpty` | – | npc → ui (loja fechando e vazia: gerar relatório) |
| `dayEnded` | `DayReport` | ui (após `closeDay`) → audio, main (autosave) |
| `toast` | `{text:string, kind?:'info'\|'good'\|'bad'}` | qualquer → ui |
| `checkoutRequest` | `{customerId:number, items:{productId,qty}[], total:number, method:'cash'\|'card', paid?:number}` | npc → ui (abre o minigame quando o jogador está no balcão) |
| `checkoutResult` | `{customerId:number, ok:boolean, speed:number /*0..1*/, mistakes:number}` | ui → npc |
| `checkoutAvailable` | `{customerId:number\|null}` | npc → ui/player (há cliente esperando no caixa do jogador; ui mostra botão "Atender") |
| `build:start` | `{type:FurnitureType, productId?:string}` | ui → world (modo construção para comprar/posicionar) |
| `build:edit` | `{furnitureId:number}` | ui/player → world (mover/girar/vender móvel existente) |
| `build:end` | – | world → ui (modo construção encerrado) |
| `ui:modal` | `{open:boolean}` | ui → player (trava input) |
| `interact:prompt` | `{label:string\|null, action?:()=>void}` | player → ui (botão contextual) |
| `sfx` | `{name:'scan'\|'cash'\|'coin'\|'card'\|'pop'\|'error'\|'levelup'\|'door'\|'step'\|'box'\|'trash'\|'buy', pan?:number}` | qualquer → audio |
| `levelUp` | `{level:number}` | sim/ui → audio/ui |
| `customerComplaint` | `{customerId:number, productId:string, ratio:number}` | npc → ui/audio (balão "Caro!") |
| `stateChanged` | `{what:string}` | quem mudar o estado via api → world/ui (re-render de móveis, caixas, sujeira) |
| `settings:changed` | `{quality:'low'\|'medium'\|'high', volume:number /*0..1*/, haptics:boolean, fontSize:'small'\|'medium'\|'large', reduceMotion:boolean, colorblind:boolean}` | ui → audio/world (opções do jogador; emitido ao mudar e uma vez no início) |
| `interact:secondary` | `{label:string\|null, action?:()=>void}` | player → ui (botão secundário 'Mover'; opcional, o primário assume 'Mover' quando não há outra ação) |
| `camera:override` | `{active:boolean}` | world (build mode) → player (player larga a câmera e o movimento; ao terminar interpola de volta) |
| `quality:auto` | `{quality:'low'\|'medium', fps:number}` | world → ui (adaptação automática rebaixou a qualidade gráfica; a UI pode atualizar o seletor; o world também grava `quality` em `mercadinho:settings` e emite `toast`) |
| `checkout:cancel` | `{customerId:number, counterId:number}` | npc → ui (pedido de pagamento pendente foi invalidado — cliente saiu, balcão sumiu ou painel fechou sem resposta; a UI deve fechar o painel de troco/maquininha sem emitir `checkoutResult`) |
| `ui:back` / `app:exit` | – | apk (`src/native.ts`, botão Voltar) → ui / ui ("Sair do jogo?" confirmado) → apk (salva e fecha o app) |

Quem emitir **evento novo** deve acrescentar uma linha acima (edição aditiva, uma linha, no fim da tabela).

## Regras para todos os agentes
1. **Propriedade:** edite só a sua pasta (`src/<sua área>/`, `tests/` do seu escopo). `src/core/*` e `src/sim/api.ts`: alterações **somente aditivas e mínimas** quando indispensáveis, e relate no fim. Nunca reescreva arquivos de outro agente.
2. **Sem git** (nada de commit/push/branch) e **sem `npm install`** (dependências: `three`, `vite`, `vitest`, `typescript` já instaladas). Se precisar de outra dependência, não instale: relate.
3. Outros agentes trabalham ao mesmo tempo. `tsc --noEmit` pode acusar erro em arquivo alheio em andamento: ignore, mas **sua pasta deve compilar sem erros e sem `any` desnecessário**. Antes de terminar, rode `npx tsc --noEmit` e filtre pela sua pasta.
4. Código `sim/api.ts` pode ainda lançar `NOT_IMPLEMENTED` enquanto o agente `sim` trabalha; programe contra as assinaturas. Chamadas à api devem ficar dentro de try/catch que mostra `toast` com a mensagem do erro quando for ação do jogador.
5. Qualidade mobile: 60fps alvo em celular médio. Reuse geometrias/materiais (instancing, cache), sem alocar em loops de update, `dispose()` correto, sombras só onde importa.
6. Leia `docs/RESEARCH.md` antes de começar (e dê uma olhada de novo antes de terminar). Priorize fidelidade de **mecânica e fluxo** do jogo de referência; a aparência é original.
7. Relatório final (≤ 25 linhas): o que ficou pronto, arquivos principais, eventos/serviços que usa/publica, limitações conhecidas, pedidos a outros módulos.

## Seção `sim` (api.ts) — notas para os outros módulos
- **Level up:** a sim é pura e não emite eventos. Após `completeSale` (ou qualquer ganho de XP) chame `consumeLevelUps(state): number[]` — devolve cada nível novo uma única vez (ex.: `[3,4]`); emita `levelUp` e `sfx:levelup` a partir daí. Saves antigos não disparam avisos retroativos.
- **Móveis:** `FurnitureSpec.slots` = slots de produto (shelf/fridge/freezer) ou nº de caixas (rack). `buyFurniture(..., productId)` atribui o produto; para `decor` o 5º argumento vira `variant`. `state.slots` é recalculado a cada compra/venda/atribuição (nunca edite à mão). Vender/reatribuir móvel move o excedente exposto para o depósito (se couber) ou para caixas na calçada (`state.sidewalk` sem x/z).
- **Layout:** móveis só em tiles inteiros. Antessala da porta 2×2 (x = porta−1..porta, z = depth−2..depth−1) e, com depósito, a passagem x = porta−1..porta em z = −1 e 0 ficam sempre livres. O depósito é contíguo ao salão por essa passagem; só `rack`/`decor` entram nele. Layout inicial: balcão em (8,6) e 2 prateleiras em z=2 — feijão e macarrão (Fase 3; `initialFurniture()`).
- **Depósito:** `storageCapacity/storageUsed` (em caixas); `storeBox` recusa se cheio. `takeFromStorage(state, id, carry)` cria Box em `state.sidewalk` (carried=true se `carry`) e devolve as unidades.
- **Clientes:** `makeShoppingList` só devolve produtos licenciados **com móvel atribuído** e pode devolver `[]` (cliente deve ir embora: `recordLostCustomer`). Fluxo: lista → `acceptsPrice` → `takeFromShelf` → `completeSale`/`returnToShelf`. `arrivalSchedule(state)` dá os minutos das chegadas do dia (almoço e fim de tarde); `plannedArrivals` é determinístico por (seed, dia): chame uma vez ao abrir.
- **Sujeira:** `addDirt` ignora acima de 12; `cleanDirt` com índice inválido é no-op. `dirtPenalty` já entra na reputação.
- **Funcionários:** `employeeSpeed(role, nível)` em segundos por ação (nível limitado a 1..5). Salários cobrados em `closeDay`. Caixa contratado e caixas registradoras extras aumentam `checkoutCapacity`.
- **Bot/balanceamento:** `src/sim/bot.ts` (`playDays`) joga só pela API; números em `src/sim/tuning.ts` e GDD §4.

## Fase 2 — `sim` (campos, regras e conteúdo novos)
- **Campos novos em `StoreState`** (defaults em `newGame`, migração/saneamento em `deserialize`; saves antigos carregam): `loan: Cents` (saldo devedor), `autoOrders: Record<productId,{minUnits,boxes}>`, `upgrades: string[]` (`'dolly'`), `history: DayReport[]` (≤30; `endDay` acrescenta), `stats: {day, p: Record<productId,[unidades,receita,lucro]>}[]` (≤30 dias; alimentado por `completeSale`/`recordSale`), `bankruptcies: number`. `DayReport` ganhou `interest?` e `loan?`.
- **Empréstimo:** `loanInfo/takeLoan/repayLoan`; limite R$ 1.000 + R$ 1.200 × nível; juros 0,4%/dia cobrados em `closeDay` (entram em `fixed`/`netProfit`). **Falência:** `isBankrupt` (caixa < 0 e rombo > crédito disponível + 50% do custo do estoque) e `restartAfterBankruptcy` (mantém nível/licenças/melhorias/decoração; zera dívida, estoque, funcionários, expansões e layout; caixa R$ 3.000). O dinheiro pode ficar negativo após `closeDay` (despesas fixas): a UI deve oferecer crédito/aviso e chamar `isBankrupt` depois de fechar o dia.
- **Pedidos automáticos:** `setAutoOrder/autoOrderRules/runAutoOrders` (tudo ou nada por regra; pula silenciosamente sem dinheiro/calçada cheia; só licenciados); `buyMissing(fillRatio)` compra caixas inteiras até encher (conta prateleira+depósito+calçada, respeita calçada ≤ 48 e dinheiro). **Melhorias:** `upgradeCatalog/buyUpgrade/carryCapacity` (dolly R$ 6.000, nível 6, 1 → 3 caixas). **Estatísticas:** `dayHistory`, `topProducts(state, dias=7)` (dias fechados + dia em andamento, ordenado por lucro).
- **Novas categorias** (`Category`): `hortifruti`, `higiene`, `frios` (Açougue e Frios), `eletronicos` (Eletrônicos e Utilidades). **Novos produtos (ids):** hortifruti `banana tomate batata alface maca`; higiene `sabonete papelhig cremedental shampoo desodorante`; frios `carne frango linguica presunto mortadela`; eletrônicos `pilha lampada fone carregador ventilador`. Todos os produtos (inclusive os antigos) têm `color` (`#rrggbb`) e `shape`. **Avisem world/ui:** `Record<Category, …>` (cores/nomes) precisam das 4 chaves novas; world deve usar `Product.color/shape` como fallback visual.
- **Móveis:** nenhum `FurnitureType` novo (mudança aditiva só nas categorias aceitas): `shelf` aceita também hortifruti/higiene/eletrônicos; `fridge` aceita também hortifruti e frios. **Decoração:** `decorCatalog()` → `{id,name,cost,minLevel}`; ids `plant banner lamp tree rug poster fountain statue` (o world só desenha `plant|tree|banner|lamp`; as outras devem cair no visual padrão); `buyFurniture(…,'decor', x,z,rot, variantId)` cobra o preço e exige o nível da variante, `sellFurniture` devolve 50% desse preço.
- **Layout (mudança aditiva em `core/layout.ts`):** `MAX_EXPANSION = 6` e `storeBounds` aceita expansão 0..6 (salão até 36×22; largura 12+4e, profundidade 10+2e). Expansões 5/6: R$ 140.000 (nív. 24) e R$ 260.000 (nív. 29). Avisem world/npc/ui: nada pode assumir expansão máxima 4 (`ui/tablet/expansion.ts` e `ui/report.ts` usam `< 4`/`/4`; use `MAX_EXPANSION`). `buyExpansion` agora realoca móveis que caírem na nova antessala/passagem (a porta muda de lugar) e `canPlace` não é mais bloqueado por móveis antigos já inalcançáveis; o world deve re-renderizar móveis após `stateChanged {what:'expansion'}`.
- **Ritmo:** curva de XP mais íngreme após o nível 15 (`xpForLevel`); nível 30 ≈ dia 95 com o bot; ver GDD §3–4.

## Seção `npc` (src/npc) — notas para os outros módulos
- **Pedido automático:** o npc chama `api.runAutoOrders(state)` (dentro de try/catch; `NOT_IMPLEMENTED` desliga as chamadas) em `storeOpened` e a cada hora cheia de jogo enquanto a loja está aberta. Se algo foi pedido: `toast` info "Pedido automático: 2 cx Arroz, 1 cx Leite", `sfx {name:'buy'}` e `stateChanged {what:'sidewalk'}`. O repositor abastece as caixas novas normalmente (e o depósito, quando houver).
- **Repositor:** por viagem carrega até 1/2/3 caixas (nível 1 / 2-3 / 4+) de produtos diferentes e próximos, na ordem de **menor % de estoque na prateleira**; repõe cada uma e leva as vazias à lixeira de uma vez. Sem caixas na calçada, busca no depósito (também por menor %, até a mesma capacidade).
- **Checkout cancelado** (`checkoutResult.ok=false`): o cliente continua no balcão (balão "Opa!"/zangado), perde 4 s e 15% de paciência e o toast avisa. Um novo `checkoutRequest` só sai quando o jogador toca de novo em **Atender** (o npc escuta o clique em `.attend-btn`; também `__npc.retryCheckout()`) ou sai e volta ao balcão. Após 3 cancelamentos o cliente desiste e vai embora (sem loops).
- **Clientes especiais** (sorteio por chegada: ~5% bulk, ~6% picky, ~7% kid; mesmos meshes dos demais, só cor/acessório/balão):
  - `bulk` (camisa laranja, cesta enorme, balão "Compra grande!"): lista dobrada e quantidades maiores (cesto até 36 un.); no caixa de funcionário leva 1,6x mais tempo; se atendido rápido (speed >= 0,6) a velocidade enviada a `completeSale` é multiplicada por 1,3 (gorjeta maior), se lento é reduzida.
  - `picky` (camisa roxa, chapéu dourado, "Hmm, preços..."): rejeita qualquer preço acima de 1,1x a média de mercado (limite exato); a reclamação vale por 2 (`customerComplaint` com `ratio` x1,15, balão "Absurdo!") e a satisfação final cai 0,5.
  - `kid` (pequeno, camisa amarela, cabeça grande, balão "Doces!"): compra 1-2 itens de padaria/doces (fallback: qualquer produto em estoque), anda e navega mais rápido, tem menos paciência e suja mais (até 6x a chance de sujeira).
- **Debug (`window.__npc`):** `spawnNow(n, kind?)`, `sampleKinds(n)`, `runAutoOrders()`, `setAutoImpl(fn)`, `retryCheckout()`, `customerInfo(id)`, `customers()` (agora com `kind`), `stats.kinds/autoOrders`. Teste: `tests/e2e/npc-phase2.e2e.mjs` (`npx vite build && npx vite preview --port 5179`).

## Seção `world` (src/world) — notas para os outros módulos
- **Serviço:** `ctx.services.world` (`WorldService`). `findPath` devolve centros de tile **sem o tile inicial** (último ponto = destino; origem/destino não andáveis são ajustados ao tile andável mais próximo, raio 3); resultado em cache, mas é uma cópia (pode dar `shift()`). Paredes só são atravessadas na porta (2 tiles centrados) e na passagem do depósito. Navegação inclui calçada (z de depth a depth+3) e uma faixa de rua (2 tiles) para spawn: `spawnPoint()` = (⌊porta.x−5⌋+0,5; depth+3,5), perto da porta.
- **Convenção de móveis:** `Furniture.x/z` = canto mínimo do footprint **já rotacionado**. Frente (lado do cliente) em rot 0 = +z; 90 = +x; 180 = −z; 270 = −x. `furnitureAccess(id)` = tile em frente (ou ao lado, se bloqueado); `null` se inacessível.
- **Balcão (2×2, rot 0):** `operator` = tile atrás do balcão (x+1, z−1); `queue[0..]` = tiles na frente do lado esquerdo (x, z+2+i), limitada ao salão (pode ter só 1-2 posições se o balcão estiver perto da porta); `scanner` = posição (em tiles, contínua) do leitor sobre o balcão. Gaveta da registradora abre no evento `sfx {name:'cash'}`; porta de vidro abre com `sfx {name:'door'}` ou quando o jogador (`services.player.position`) está a < 3 m.
- **Caixas (`state.sidewalk`):** `carried` → não é desenhada (o player a desenha). Sem `x/z` → o **world escolhe um ponto livre** na `deliveryZone` e **grava `x/z` na própria Box** (único campo de estado que o world escreve). `x/z` = centro da caixa em tiles (contínuo). Caixas próximas (<0,3 m) empilham automaticamente. Caixa com `units < boxSize` aparece aberta. Estoque do depósito (`state.storage`) é desenhado nos `rack`s (24 caixas por rack, na ordem do catálogo).
- **Decor:** variantes visuais reconhecidas em `Furniture.variant`: `plant` (padrão), `tree`, `banner`, `lamp`.
- **Build mode:** `build:start {type, productId?, variant?}` (decor: `productId` = variante) / `build:edit {furnitureId}`. O world assume a câmera: emite `camera:override {active:true}` ao iniciar e `{active:false}` + `build:end` ao terminar (confirmar, vender ou cancelar); o `player` devolve o controle ao receber `active:false`. Confirmação chama `api.buyFurniture/moveFurniture` (erros viram `toast` kind `bad`, o modo continua ativo); sucesso emite `stateChanged {what:'furniture'}`, `sfx` e `toast`. Atalhos: R girar, Enter confirmar, Esc cancelar, Del vender; no toque: arrastar o fantasma, tocar para posicionar, arrastar fora dele para mover a câmera, pinça = zoom, giro de dois dedos = girar o móvel. UI própria em overlay DOM dentro de `uiRoot` (atributo `data-world-build`).
- **Visual reativo:** o world lê `state` a cada 0,25 s e em `stateChanged` (hash por seção; só reconstrói o que mudou). Paredes do lado da câmera ficam translúcidas (corte tipo casa de boneca). Luz/céu seguem `clock.minute` (08:00 manhã → 21:00 entardecer/noite).
- **Debug/testes:** `window.__world` (`nodes()`, `rebuild()`, `demo(true)`, `stats()`, `setCamera(...)`, `walls()`, `boxCounts()`, `walkable()`, `build.pose`, `build.camDist`, `build.ghostScreen()`, `quality()`, `setTier(t)`, `autoQuality(on)`, `testGenericProducts()`, `service`). `?demo=1` na URL desenha um layout local de desenvolvimento **apenas se `state.furniture` estiver vazio** (nunca persiste).
- **Desempenho (Fase 2) — medido com `tests/e2e/perf.e2e.mjs` (SwiftShader, cena típica: expansão 1, depósito, 18 móveis abastecidos, 6 caixas, qualidade high com sombras):** antes → depois: **draw calls 719 → 118** (expansões 2–4: 656/647/644 → 112/110/110; tier low sem sombras: 89), geometrias 159 → 74 (antes vazavam: 159 → 176 ao voltar à expansão 1; agora 74 → 74), texturas 36 → 15, triângulos ≈ 85k → ≈ 87k (igual; o ganho é em chamadas). O script falha se calls > 220, se geometrias/texturas crescerem entre expansões ou após rebuilds repetidos, e testa tiers, visuais genéricos e gestos de toque. Técnicas: (1) móveis fundidos por material (`batch.ts`: cor por vértice; tipos `matte/flat/metal/glass/glow/sign`) e **todos os móveis numa casca única** refundida só quando a estrutura muda; (2) itens expostos de prateleiras/geladeiras e das caixas abertas numa `ItemLayer` global (1 InstancedMesh por produto); (3) caixas de papelão num `BoxLayer` único (1 InstancedMesh por produto×aberta/fechada, etiqueta num **atlas** de textura, placas de prateleira em outro atlas); (4) paredes: 1 malha por face com 3 grupos de material (antes 6 draw calls por peça); (5) ambiente: prédios fundidos por cor, detalhes/faixas/postes/lixeira num lote fosco, árvores numa malha só (únicas a projetar sombra além dos móveis), carros 1 malha cada, nuvens 1 InstancedMesh; (6) luzes: só sol + hemisfério. Itens e atualizações são incrementais (hash por seção).
- **Qualidade (tiers):** `settings:changed {quality}` + `localStorage['mercadinho:settings']` → `low` (pixel ratio ≤ 1, sem sombras, neblina curta), `medium` (≤ 1,5; sombra 1024), `high` (≤ 2; sombra 2048). Troca em tempo real (pixel ratio, sombras, neblina); **antialias só no próximo carregamento** (low = off). Padrão sem escolha salva: celular (`pointer: coarse`/userAgent) → `low` (ou `medium` com ≥ 6 núcleos e ≥ 4 GB), desktop → `medium`; por isso o **primeiro** `settings:changed` (emissão inicial da UI) só vale se o jogador já tinha escolhido antes. Adaptação automática: FPS médio < 30 por 3 s (após 4 s de aquecimento, aba visível) abaixa um tier, grava em `mercadinho:settings`, emite `quality:auto` e `toast`; desligada sob WebDriver (testes) salvo `?autoq=1`.
- **Produtos novos:** o visual vem de `PRODUCTS[i].color/shape` (`genericVisual`: `box|bottle|can|bag|tray|jar`); sem `shape` usa a forma padrão da categoria e sem `color` a cor da categoria; categorias/formas desconhecidas caem em caixa cinza. Os 11 produtos originais mantêm modelos feitos à mão (por id). Placas e etiquetas são atlas gerados de `PRODUCTS` no 1º uso (catálogo fixo em runtime; limite prático ~40 produtos por atlas de placa em resolução cheia, acima disso as células encolhem).
- **Spawn:** `spawnPoint()` = (⌊porta.x − 5⌋ + 0,5; depth + 3,5): ≈ 7 m de caminhada até a porta (antes ≈ 15 s).

## UI (`src/ui/`) — notas de integração
- Opções persistidas em `localStorage['mercadinho:settings']` = `{quality, volume, haptics, fontSize, reduceMotion, colorblind}` (JSON; quem gravar outro campo deve preservar os demais). A UI emite `settings:changed` ao iniciar e a cada mudança; `quality` é sugestão para world (pixel ratio, sombras). **Fase 2 (acessibilidade):** `fontSize` `'small'|'medium'|'large'` (escala 0,9/1/1,2 dos textos da UI), `reduceMotion` (padrão = `prefers-reduced-motion`; desliga animações da UI — **world/player devem desligar tremor/balanço de câmera e animações decorativas quando `true`**), `colorblind` (verde/vermelho → azul/laranja + setas ↑↓ na UI; world pode ignorar). Adota `quality:auto` do world.
- **Fase 2:** aba Finanças = banco (`loanInfo/takeLoan/repayLoan`), gráfico de lucro SVG (`dayHistory`) e `topProducts(30)`; abas novas **Automático** (`setAutoOrder/autoOrderRules/runAutoOrders`) e **Melhorias** (`upgradeCatalog/buyUpgrade`); Mercado ganhou "Comprar o que falta" (`buyMissing`, custo simulado em cópia do estado antes de confirmar). `stateChanged.what` novos: `loan`, `autoOrder`, `upgrade`, `bankruptcy`. **Falência:** `api.isBankrupt` é checado ao abrir o tablet, ao iniciar o jogo e após "Próximo dia"; a tela só some com "Recomeçar" (`restartAfterBankruptcy` + save; se a fase não é `prep`, chama `clock.startNextDay()`). "Pedido hoje" (aba Automático) vem de `localStorage['mercadinho:autoToday']`, alimentado pelo botão "Pedir agora" e pelo toast `Pedido automático: N cx Nome, ...` do `npc` (**o texto desse toast é contrato**: se mudar, avise a UI). Aviso de caixa baixo = caixa < 2× (aluguel + salários): pílula do HUD laranja e "!" no botão do tablet.
- O painel do checkout mede a base do HUD (`.hud`) e usa `--hud-b` para nunca sobrepô-lo (retrato e paisagem baixa, 740×360 testado).
- A UI emite `stateChanged {what}` após cada ação do jogador (`orderBoxes`, `price`, `license`, `employee`, `expansion`, `storage`, `decor`, `storeName`) e `dayEnded` (DayReport) depois de `clock.startNextDay()` + `save()`.
- `checkoutRequest` abre o minigame na hora (se houver outro modal aberto, fica pendente e o botão "Atender cliente" aparece). `checkoutResult.speed` vem do tempo total (escanear + pagar); usar a dica de troco limita speed a 0,6.
- A UI **não** captura a tecla E (o `player` já trata); o botão contextual só mostra a dica e chama `action()` ao toque.
- Durante `build:start`..`build:end` o HUD é ocultado para não competir com a barra do modo construção do `world`.
- Estado do relatório/tutorial em localStorage: `mercadinho:lastReport`, `mercadinho:daysnap`, `mercadinho:tutorial`. "Novo jogo" apaga também estas chaves, troca `ctx.save` por no-op (evita o autosave regravar) e recarrega.


## Fase 2 — contrato adicional (integração)
- `PlayerService.carryingAll: Box[]` — todas as caixas carregadas (base → topo, LIFO); `carrying` é o topo. Capacidade: `api.carryCapacity(state)` (1; 3 com dolly).
- O toast do pedido automático segue o formato `Pedido automático: N cx Nome, ...` — a aba "Automático" da UI o interpreta (mudança de texto exige mudar `src/ui/tablet/auto.ts`).
- Expansão máxima é `MAX_EXPANSION` (core/layout.ts), hoje 6.

---

# Fase 3 — 1ª pessoa, caixa sentado, visual de referência (PROTOCOLO OBRIGATÓRIO)

Plano e prints de referência: `docs/PHASE3.md`. Tipos novos: `src/core/services.ts` (PickInfo, PickService,
campos opcionais de WorldService/PlayerService), `src/core/outline.ts` (contorno verde compartilhado),
`src/sim/api.ts` (seção "FASE 3").

## Donos (mudanças de propriedade desta fase)
- **player** é dono de TODOS os controles de jogo na tela: joystick, área de olhar, mira, botão de ação (com rótulo),
  arremessar, largar, "Sair do caixa". A UI **remove** seu botão contextual antigo (`interact:prompt` deixa de ter
  botão na UI) e o botão "Atender cliente".
- **world** é dono do modo de posicionamento (móveis e caixas) e da barra ⟲ COLOCAR ⟳ / CANCELAR (centro, embaixo).
- **ui** é dono do HUD, do atalho de carrinho (embaixo à esquerda, ao lado do joystick), de todos os painéis
  (tablet, troco, maquininha, comemoração, resumo, noite, missões) e do aviso de orientação.
- Camadas (z-index): cena < HUD (20) < controles do player (30) < barra de posicionamento do world (35) < painéis/modais (60+).

## Interação em 1ª pessoa (pick)
- O world mantém `pickGroup` (proxies invisíveis: `material.visible=false`, raycast funciona) com `userData.pick: PickInfo`
  para: móveis (`furniture`, id=furnitureId), caixas no chão (`box`, id=índice em state.sidewalk), sujeira (`dirt`,
  id=índice em state.dirt), lixeira (`trash`), placa da porta (`sign`), computador (`computer`), assento do caixa
  (`seat`, id=furnitureId do balcão), porta do depósito (`storageDoor`). Atualiza quando o estado muda.
- O player faz raycast do **centro da tela** contra `pickGroup` (alcance ~2,6 m; placa/computador até ~3,5 m),
  chama `world.highlight(pick|null)` quando o alvo muda e define o rótulo do botão de ação:
  | Alvo | Condição | Ação (rótulo) |
  |---|---|---|
  | box | mãos com espaço | Pegar |
  | furniture shelf/fridge/freezer | carregando caixa do mesmo produto | Repor (segurar repete, 1 un. a cada ~0,12 s) |
  | furniture shelf/fridge/freezer | sem caixa compatível | Preço → `ui:openTablet {tab:'prices', productId}`; secundário: Mover → `build:edit` |
  | furniture rack (depósito) | com caixa / sem caixa | Guardar / Retirar |
  | trash | caixa vazia na mão | Jogar fora |
  | dirt | — | Limpar (animação ~0,9 s de esfregão na tela, depois `api.cleanDirt`) |
  | sign | — | Abrir loja / Fechar loja → `store:sign` |
  | computer | — | Usar computador → `ui:openTablet {}` |
  | seat | balcão sem funcionário | Sentar no caixa |
  | storageDoor | depósito trancado | Depósito (licença) → `ui:openTablet {tab:'services'}` |
- Carregando caixa e sem alvo: botões extras **Largar** (→ `build:box {boxIndex}`) e **Arremessar**.
- Arremesso: o player simula a trajetória (gravidade, chão y=0, paredes por `isWalkable`). Se cair na lixeira
  (raio ~0,8 m de `world.trashBin()`) e estiver vazia → `api.discardBox`; cheia na lixeira → cai ao lado (`api.dropBox`)
  com aviso; senão `api.dropBox(x,z,rot)` no ponto de queda (ajustado para ponto caminhável).
- Após cada ação bem-sucedida o player emite `player:action` (para missões e áudio) e `stateChanged`.

## Caixa sentado (sequência)
1. Player: ação "Sentar no caixa" → câmera vai para `world.seatPose(counterId)`; `PlayerService.mode='seated'`,
   `seatedAt=counterId` e `atCounter=counterId`; olhar limitado; movimento travado; botão laranja **Sair do caixa**.
   Toques no canvas fazem raycast contra os objetos registrados em `services.pick` (PickService do player).
2. Npc: cliente da frente chega ao balcão onde `seatedAt===counterId` (ou com funcionário caixa) e coloca os produtos
   na esteira: malhas de `world.makeProductMesh(productId)` em `world.beltSlots(counterId)`, com `addOutline` e
   `services.pick.add(mesh, onTap)`.
3. Cada toque bipa um item (`sfx scan`, item some/vai para a sacola) e o npc emite `checkout:display`
   `{counterId, mode:'items', lastItem:{name, price}, total}` (total acumulado).
4. Tudo bipado → cliente estende **notas** (leque) ou **cartão** em `world.handoffPoint(counterId)`, tocável.
5. Toque no dinheiro/cartão → npc emite `checkoutRequest {customerId, counterId, items, total, method, paid, stage:'pay'}`.
6. UI abre só o painel de pagamento (à direita): troco (5 notas + 5 moedas, desfazer/OK/C) ou maquininha
   (1–9, apagar, 0, vírgula, OK/C), emite `checkout:display` com `mode:'cash', received, total, change, giving`
   ou `mode:'card', total, typed`, e no fim `checkoutResult {customerId, ok, speed, mistakes}` (speed = só o pagamento).
7. Npc: `api.completeSale` (speed combinando bipagem + pagamento), emite `checkout:done`, cliente sai, próximo avança;
   `checkout:display {mode:'idle'}`. O world desenha o monitor do balcão a partir do último `checkout:display`.
- Funcionário caixa: fica sentado no balcão dele e faz tudo sozinho (mesmo visual, sem painéis).

## Posicionamento em 1ª pessoa (world)
- Início: `build:start {type, productId?, variant?, stockIndex?}` (montar do estoque se `stockIndex`), `build:edit {furnitureId}`
  ou `build:box {boxIndex}`. **Sem `camera:override`**: o jogador continua andando e olhando.
- A prévia segue o raio do centro da câmera até o chão (móveis na grade com `canPlace`; caixas livres em ponto caminhável),
  verde/vermelha (caixa: ciano/vermelho). Barra: ⟲ COLOCAR ⟳ e CANCELAR (+ VENDER e GUARDAR no modo editar).
- Confirmar: estoque → `api.placeFromStock`; editar → `moveFurniture`; caixa → `api.dropBox`; legado → `buyFurniture`.
- Emite `build:state {active, kind:'furniture'|'box'}` no início e no fim (o player esconde os botões de ação), e `build:end`.

## Dia e noite
- 21:00 (`storeClosing`): sem clientes novos. A UI mostra o aviso de noite e o botão **Terminar o dia**.
  **O relatório não abre sozinho em `storeEmpty`**: só ao tocar Terminar o dia (com confirmação se ainda houver clientes).
- Abrir/fechar a loja: placa da porta (`store:sign`, a UI decide e confirma o fechamento antecipado) e menu de pausa.

## Eventos novos da Fase 3
| Evento | Payload | Emissor → ouvintes |
|---|---|---|
| `player:action` | `{kind:'pickBox'\|'placeUnits'\|'discardBox'\|'dropBox'\|'throwBox'\|'storeBox'\|'takeBox'\|'clean'\|'sit'\|'stand'\|'useComputer'\|'sign'\|'move', productId?, furnitureId?}` | player → ui (missões), audio |
| `checkout:display` | `{counterId, mode:'idle'\|'items'\|'cash'\|'card', lastItem?:{name,price}, total?, received?, change?, giving?, typed?}` | npc e ui → world (monitor) |
| `checkout:done` | `{customerId, counterId, total, tip, method, happy:boolean}` | npc → ui, audio |
| `store:sign` | – | player → ui |
| `ui:openTablet` | `{tab?:string, productId?:string}` | player, world, ui → ui |
| `build:box` | `{boxIndex:number}` | player → world |
| `build:state` | `{active:boolean, kind:'furniture'\|'box'}` | world → player, ui |
| `checkoutRequest` (estendido) | `+ {counterId, stage:'pay'}` | npc → ui |
| `build:start` (estendido) | `+ {stockIndex?:number}` | ui → world |
| `sfx` (novos nomes) | `'throw'\|'mop'\|'sit'\|'stand'\|'place'\|'sign'\|'night'\|'celebrate'` | qualquer → audio |

## Fase 3 — ADENDO (pedido do usuário durante a fase): caixas abrem/fecham; móveis por categoria
- `Box` ganha `open?: boolean` (caixa chega FECHADA da entrega; o sim adiciona o campo com migração) e a API nova
  `setBoxOpen(state, boxIndex, open)` (o sim implementa). Estado de aberta/fechada persiste no save.
- **player** (carregando caixa): botão **Abrir/Fechar caixa** (alterna, animação das abas ~0,35 s, sfx `boxOpen`/`boxClose`).
  **Repor exige caixa aberta**: mirando o móvel do produto com a caixa fechada, a ação vira "Abrir caixa".
  Fluxo do usuário: abrir → repor → fechar de novo → colocar onde quiser (Largar com prévia) ou guardar no depósito.
- **world** desenha caixas no chão e na pilha ABERTAS (abas abertas, produtos visíveis por cima; vazia mostra o fundo)
  ou FECHADAS (abas fechadas com fita). Mesmo visual no npc repositor.
- **Abastecer móvel novo/vazio**: se o móvel não tem produto, ou o produto dele está esgotado (state.shelf[produto] = 0),
  e a categoria do produto da caixa é aceita pelo móvel (`FurnitureSpec.categories`): o player chama
  `api.assignProduct(furnitureId, productId)` e depois `placeUnits` (rótulo "Repor"). Móvel com outro produto em estoque:
  ação desabilitada "Outro produto". Assim: comprar prateleira/geladeira/freezer → montar → abastecer com o produto respectivo.
- **ui**: aba Móveis do Mercado vende prateleiras, geladeiras e freezers (e demais tipos); cada produto mostra o ícone do
  móvel exigido (`api.furnitureForProduct`).
- **npc** repositor: abre a caixa (visual) antes de repor e fecha/descarta depois.
- `sfx` novos: `'boxOpen'`, `'boxClose'`.

## Fase 3 — sim (estado novo, regras e números; detalhes em docs/GDD.md §3–4)
- **Campos novos** (defaults em `newGame`, migração em `deserialize`; saves antigos carregam): `StoreState.furnitureStock: {type, variant?}[]`
  (móveis comprados e não montados; ausente/inválido → `[]`); `Box.open?: boolean` (`false` = fechada, como chega de
  `orderBoxes/checkoutCart/runAutoOrders/buyMissing/takeFromStorage` e das sobras de `reconcile`; ausente em saves antigos = fechada);
  `Ledger.happy/angry` (venda com satisfação ≥ 3 → feliz; venda < 3 e perdido/desistente → irritado; ledger antigo: atendidos = felizes,
  perdidos = irritados). `DayReport` ganhou (opcionais só por causa do histórico antigo; sempre presentes em relatórios novos):
  `happy`, `angry` (happy + angry = served + lost = "total"), `rent`, `wages`, `income` (= receita + gorjetas, "rendimento"),
  `expenses` (= COGS + fixas, "despesa"; `income − expenses = netProfit`, "lucro").
- **`state.rent`** agora é o aluguel que será cobrado no fechamento de HOJE (`src/sim/rent.ts`): 0 até o nível 2 e o dia 3; rampa
  1/3 → 2/3 → integral a partir do nível 3 OU do dia 4 (integral no nível 5 ou dia 6); cheio = R$ 80 + R$ 40/expansão. É recalculado em
  `closeDay` (para o dia seguinte), `buyExpansion`, recomeço e migração. **ui:** use `DayReport.rent/wages` no relatório (não `fixed − state.rent`).
- **API Fase 3 implementada:** `cartTotal`, `checkoutCart` (atômica; recusa licença/nível/dinheiro, carrinho vazio, calçada > 48 caixas e estante
  sem depósito; mensagens pt-BR), `furnitureStock` (cópia), `placeFromStock` (valida `canPlace` e o produto; não cobra; decor mantém a variante
  comprada), `storeFurniture` (mesmas regras de `sellFurniture`: último balcão e estante com depósito cheio são recusados), `dropBox`
  (x/z em metros = tiles; `rot` em radianos normalizado para [0, 2π); `carried=false`), `customerCapacity`, `furnitureForProduct`.
  **Adições:** `canDropBox(state, x, z)` (mesma validação do `dropBox`: salão, vão da porta, calçada z ∈ [depth+0,15; depth+2,85] e até 14 m
  para os lados, depósito/passagem só desbloqueados, 0,15 m das paredes; móveis não são checados) e `setBoxOpen(state, boxIndex, open)`.
  `placeUnits` não exige caixa aberta (quem exige é o player). `assignProduct` aceita móvel sem produto e troca o produto de um móvel
  esgotado quando a categoria é aceita (com estoque exposto, o excedente vai ao depósito/calçada; o player desabilita esse caso).
- **Avisos:** **player/world** — clampem o ponto de queda do arremesso à calçada (a rua da navegação do world não é aceita) e usem
  `api.canDropBox` para a prévia ciano/vermelha. **npc** — use `Math.min(api.customerCapacity(state), limite de desempenho)` no lugar de
  `10 + expansion` (6 + 2/expansão, +4 com a melhoria 'capacity'). **ui** — gaveta do troco: `DRAWER_BILLS`/`DRAWER_COINS`/`DRAWER_DENOMS`
  (`src/sim/money.ts`; R$ 50, 20, 10, 5, 2 e R$ 1; 0,50; 0,25; 0,10; 0,05): `customerCashPayment` paga no máximo um passo acima do total
  (R$ 100 só acima de R$ 25), então o troco é sempre < R$ 100; `upgradeCatalog` agora tem 3 itens em ordem de nível (`tipjar` 2, `capacity` 4,
  `dolly` 6); `restartAfterBankruptcy` também zera `furnitureStock`.
- **Números (tuning.ts):** dinheiro inicial R$ 150; layout inicial = balcão (8,6) + prateleiras de feijão (1,2) e macarrão (4,2)
  (`nextFurnitureId` 4); paleta padrão `#bfe1f2`/`#c48a55`/`#d8342c` (saves mantêm a escolha). Liberações: bebidas + geladeira + pote de gorjeta 2;
  expansões 3/5/6/7/15/28 (R$ 1.500/4.500/11.000/26.000/75.000/180.000); caixa, laticínios, capacidade e 2º balcão 4; depósito (R$ 2.500) 5;
  limpador e carrinho de carga (R$ 5.000) 6; repositor 8. Pote de gorjeta R$ 150 (gorjeta ×1,5); capacidade R$ 1.500 (+4). XP: nível n =
  60·(n−1)^2,08·(1 + 0,05·max(0, n−15)) (nível 2 = 60 XP). Empréstimo R$ 200 + R$ 400 × nível; recomeço com R$ 300. Bot: nível 2 no dia 1,
  bebidas dia 7–8, expansão 1 dia 10–14, caixa contratado dia 11–16, nível 30 dia 95–98, nunca no vermelho no começo.
- **Fase 3 — audio:** `sfx` aceita `throw mop sit stand place sign night celebrate boxOpen boxClose` (+ `x,z` opcionais em tiles: pan/volume relativos à câmera). Reações: `player:action` throwBox/clean/sit/stand/dropBox/sign → throw/mop/sit/stand/place/sign (se o emissor também mandar o `sfx` de mesmo nome até 1,5 s antes, não duplica: emita o `sfx` no início da animação, ex.: esfregão); `checkout:done` → "ka-ching" da registradora (+ moedas e brilho se `tip>0`; balcão onde o jogador não está sentado soa posicionado e mais baixo); `storeClosing` → night; `levelUp` → celebrate (cobre `sfx levelup` por 3 s e silencia um levelup já iniciado: a tela de comemoração não precisa emitir som); a placa cobre o sino de `storeOpened` (1,5 s). night/celebrate/jingle abaixam a música; passo mais discreto e de prioridade baixa no limitador. Debug: `window.__audio.log()`. Obs. UI: `SfxName` em `ui/kit.ts` ainda não lista os nomes novos.

## Fase 3 — npc (src/npc)
- **Caixa sentado:** o cliente da frente só é atendido num balcão operado: jogador com `services.player.seatedAt === counterId`
  (legado: `atCounter`) ou funcionário caixa sentado. Itens = `world.makeProductMesh` (reserva própria) em `world.beltSlots`
  (reserva: layout local do balcão da Fase 3), andam na esteira rumo ao scanner; cada um com `addOutline` +
  `services.pick.add(obj, onTap)` (sem `services.pick`, o npc usa um raycast de toque próprio). Até ~12 toques por cliente
  (acima disso um item vale várias unidades: `lastItem.name` "Arroz 5kg ×3", `price` = unidade × n).
- **Eventos:** `checkout:display {counterId, mode:'items', total:0}` ao começar; a cada bipe `{mode:'items', lastItem, total}`;
  `{mode:'idle'}` ao vender/desistir (também no caixa do funcionário). Notas (leque, 2–5 cédulas que somam `paid`) ou cartão
  em `world.handoffPoint` com contorno plano verde; o grupo tem `userData.npcPay = true`. Toque → `checkoutRequest
  {customerId, counterId, items, total, method, paid (cartão: = total), stage:'pay'}`. `checkout:done` ganhou `staff:boolean`
  (true = funcionário). `happy` = satisfação ≥ 3 (mesma regra de `ledger.happy`). speed da venda = 50% bipagem/reação + 50% UI.
- **Cancelar** (`checkoutResult.ok=false`): balão, −15% de paciência e +4 s; o cliente estende o pagamento de novo após ~1,4 s
  (tocar reabre o painel); 3 cancelamentos = desiste (itens voltam à prateleira). Jogador levantou com o painel aberto: após
  1,5 s o pagamento é reapresentado. Sem ninguém no caixa a paciência corre e o cliente pode desistir (esteira limpa).
  O npc **não** escuta mais o botão "Atender".
- **Funcionário caixa:** ocupa o balcão de menor id em que o jogador não está sentado (`world.seatPose` ou reserva), senta e faz
  o mesmo fluxo sem painéis. Repositor abre a caixa (`api.setBoxOpen`, sfx `boxOpen`) antes de repor, fecha (`boxClose`) a que
  sobra; vazia vai aberta para a lixeira (visual = `world.makeBoxMesh`, mesmo do chão; reserva própria). Limpador com esfregão.
  O item bipado voa até `counters().scanner` (posição nova) e some; geometria/material do world nunca são descartados pelo npc.
- **Capacidade:** clientes simultâneos = min(`api.customerCapacity`, 18 − funcionários). À noite (`closing`) nenhum novo;
  `storeEmpty` continua sendo emitido quando a loja esvazia. `sfx` do npc agora manda `{name, x, z}`.
- **Visual:** pessoas com esqueleto (1 SkinnedMesh/pessoa, geometria por variante compartilhada), rosto em CanvasTexture,
  9 cabelos, capacete/boné/gorro/chapéu, óculos escuros, 9 estilos de roupa (`looks.ts`), cesta com itens instanciados,
  sacola ao sair; ≈ 11 draw calls por pessoa. Debug: `__npc.lanes()`, `tappables()`, `tap()`, `capacity()`.
  Teste: `tests/e2e/npc-seated.e2e.mjs` (`NPC_URL`, padrão porta 5193).

## Fase 3 — world (src/world)
- **Visual 1ª pessoa:** paredes OPACAS (sem casa de boneca; 1 malha, 1 grupo por material), piso de tábuas (`decor.floorColor`), paredes `decor.wallColor` (cores legadas `#f2e8d5`/`#c9c4b8` viram `DEFAULT_DECOR`), teto com luminárias, rodapé; fachada de tijolos, faixa verde, letreiro (`storeName`/`signColor`), toldos listrados, pôsteres, porta de vidro e placa **ABERTO/FECHADO** (segue `clock.phase === 'open'`, pilar à direita da porta, legível dos dois lados). Rua com faixas e estacionamento, ENTREGAS pintada (`deliveryZone`), lixeira verde de reciclagem, **caçamba cinza = `trashBin()`**, hidrante, ponto de ônibus, bancos, árvores outonais, postes, prédios, carros. Decalques num atlas único (`tex.ts`). `shop.ts` reexporta `Env` (agora em `env.ts`).
- **Balcão (local, frente +z):** esteira à esquerda (x<0, cliente em +z → scanner em −z), mesa do operador à direita com monitor (fica à ESQUERDA da vista sentada; o painel de pagamento da UI à direita não o cobre), maquininha, impressora, teclado, gaveta (abre em `sfx cash`), gôndola de doces; cadeira no tile do operador (omitida se o tile estiver ocupado). `counters().scanner` aponta o novo scanner.
- **Serviço (campos Fase 3):** `pickGroup` (um proxy por caixa da silhueta, `material.visible=false`, `userData.pick`; kinds furniture/box/dirt/trash/sign/computer/seat/storageDoor — este só com depósito trancado; refeito quando o estado muda; `box.id` = índice em `state.sidewalk`). `highlight(pick|null)`: contorno verde só na silhueta externa (passe de stencil + casco; requer `stencil: true` no renderer, já em `main.ts`; sem stencil cai para casco de faces traseiras); sujeira = anel. `seatPose` (olhos a 1,24 m), `beltSlots` (8, cliente → scanner, sobre a esteira), `handoffPoint`, `makeProductMesh` (geometria/material compartilhados: **não descarte**), **novo opcional** `makeBoxMesh(pid, open, units?)` (caixa igual às do chão; `userData.setOpen(t 0..1)` anima as abas, `userData.setUnits(n)`), `poi(kind, id?)`.
- **Monitor:** `checkout:display` → tela LCD do balcão `counterId` (sem id: 1º balcão); valores em centavos; `typed` número (centavos) ou string ("45,2"). A face da maquininha mostra `typed`/total. Canvas redesenhado só quando o conteúdo muda (1 draw call por balcão).
- **Computador:** balcão lateral com notebook e caneca no 1º tile livre junto à parede, ao lado da antessala da porta (depois paredes laterais); bloqueia o tile na navegação e muda de lugar se um móvel ocupar o tile.
- **Etiquetas de preço:** uma por prateleira/geladeira/freezer (cor do produto + `R$ x,yy`; `--` sem produto ou com `state.shelf[pid] = 0`), atualizadas em `stateChanged`/`dayStarted`/a cada 2 s; móveis novos sem produto aparecem com placa VAZIO e passam a mostrar o produto ao atribuir/abastecer.
- **Caixas:** `Box.open` (ausente = fechada) desenha aberta (abas abertas, interior, produtos por cima e divisória; vazia mostra o fundo) ou fechada com fita; `Box.rot` usado quando definido; empilha a < 0,3 m. Depósito: cheias fechadas, a parcial aberta.
- **Posicionamento 1ª pessoa:** `build:start {type, productId?, variant?, stockIndex?}` (com `stockIndex` usa tipo/variante do estoque e `placeFromStock`; sem, `buyFurniture` legado), `build:edit {furnitureId}` (COLOCAR=`moveFurniture`, VENDER, GUARDAR=`storeFurniture`), `build:box {boxIndex}` (`api.canDropBox` + tile sem móvel; rua inválida; reflete aberta/fechada; `dropBox` com rotação em radianos, passos de 22,5°). Prévia no chão sob a mira (0,75–3,5 m caixa; até 7 m móvel), grade, verde/vermelho (caixa ciano/vermelho). Sem `camera:override`. Emite `build:state {active, kind, placed?}` e `build:end {kind, placed}` (campos `placed` aditivos: o player pode emitir `player:action dropBox` quando `placed`). Barra DOM `[data-world-build]` z-index 35 (botões ≥ 48 px; aria-labels "Girar para a esquerda/direita", "Colocar", "Cancelar", "Vender", "Guardar no estoque"); teclado R/Shift+R, Enter, Esc, Delete.
- **Debug:** `__world.lockCamera(x,y,z,lx,ly,lz)`/`unlockCamera()` (fixa a câmera no render, independe do player), `picks()`, `highlighted()`, `screens()`, `tags()`, `desk()`, `chairs()`, `boxCounts().open`, `build.pose`.
- **Desempenho (tests/e2e/perf.e2e.mjs, câmera dentro da loja a 1,6 m, cena típica, high com sombras, SwiftShader):** draw calls 111–119 → **68–82** dentro; 95–118 → 80–81 na rua; low 54; texturas 16; sem vazamento entre expansões/rebuilds. Sombra do sol suavizada (`shadow.intensity 0.6`).

## Fase 3 — ui (src/ui)
- **HUD (layout da referência, z 20):** selo do dia no centro do topo (faixa vermelha "Dia N" + hora; azul à noite), estrela de nível com barra de XP (toque abre a folha de nível: XP, novidades, próximo nível; **ponto vermelho** = algo liberado ainda não visto, controlado em `localStorage['mercadinho:seen']`), dinheiro (toque abre Finanças/banco; laranja = caixa baixo) e engrenagem (pausa). Sem energia. Removidos: botão contextual (`interact:prompt` não tem mais botão na UI), "Atender cliente" e abrir/fechar loja. A UI publica `--hud-b` (base do HUD, px) no `.mx-root`; painéis à direita e o tablet começam abaixo dela.
- **Atalho de carrinho:** `.cart-fab` 56 px em `left: safe-area + 220px; bottom: safe-area + 14px` (ao lado do joystick do player, sem cobrir seu raio), **z 32** (acima dos controles do player para não ser bloqueado); some durante `build:state {active:true}` e com modal aberto. Abre o Mercado. Desktop: tecla **M** abre o Mercado (a UI não captura E/Espaço/F/R).
- **Abrir/fechar a loja:** só por `store:sign` (placa; abre direto, fecha com confirmação; à noite orienta a terminar o dia) ou pelo menu de pausa. `sfx 'sign'` ao abrir/fechar.
- **Noite:** em `storeClosing` o cartão de missão vira o aviso "Nenhum cliente novo virá à noite" e aparece **Terminar o dia** (`#end-day`, z 32, à direita abaixo do aviso; `sfx 'night'`). `storeEmpty` só destaca o botão e mostra um toast. Terminar com clientes na loja (`npc.customersInStore()`) pede confirmação. Resumo: total = felizes + irritados (`DayReport.happy/angry`), rendimento (`income`), despesa (`expenses`), lucro = rendimento − despesa; "Detalhes" abre o relatório completo (aluguel/salários de `DayReport.rent/wages`). "Continue jogando!" → `clock.startNextDay()` + save + `dayEnded`.
- **Nível:** a UI chama `api.consumeLevelUps` a cada 0,25 s e emite `levelUp {level}` (o audio toca o som; a UI não toca outro). Comemoração em fila, só sem modal aberto e fora do posicionamento; mostra o que tem `minLevel === N` (licenças, móveis, decoração, funcionários, melhorias, expansões, depósito — `src/ui/unlocks.ts`).
- **Mercado com carrinho:** Produtos | Móveis; `api.cartTotal`/`api.checkoutCart` (linhas `CartLine`); produto mostra o móvel exigido (`api.furnitureForProduct`) e "Precisa de geladeira" etc. quando não há móvel montado que aceite a categoria. Após comprar móveis: **fecha o tablet** e emite `build:start {type, stockIndex}` (índice do 1º móvel novo; decoração leva também `variant` e `productId = variant`). Aba Móveis: "Para montar (N)" com **Montar**. Também emite `stateChanged {what:'cart', boxes, furniture}`. "Encher prateleiras" põe no carrinho o que `buyMissing` compraria.
- **Tablet:** abas `market prices auto licenses expansion services staff upgrades finance decor` (aliases: `storage`→services, `furniture`→Mercado/Móveis, `bank`→finance...). `ui:openTablet {tab?, productId?}` abre (padrão Mercado) e destaca `[data-product=productId]` por ~3 s. Serviços: descartar caixas vazias (`api.discardBox`), depósito, capacidade de clientes (`api.customerCapacity` + melhoria `capacity`), personalização.
- **Pagamento (`checkoutRequest` com `stage:'pay'`):** painel à direita (z 62), modal (`ui:modal`). Dinheiro: gaveta `DRAWER_BILLS`/`DRAWER_COINS`, desfazer/OK/C; emite `checkout:display {counterId, customerId, mode:'cash', total, received, change, giving}` a cada toque. Cartão: 1–9, apagar, 0, vírgula, OK, C; emite `{mode:'card', total, typed (centavos), typedText}`. Fim: `checkoutResult {customerId, ok, speed (só pagamento), mistakes}`; erro não fecha (conta `mistakes`); "×" cancela com confirmação (`ok:false`). Pedidos sem `stage` seguem o minigame antigo.
- **Missões (tutorial):** cartão no canto superior direito com gerente original (`src/ui/manager.ts`); passos: comprar caixas → pegar a caixa → **abrir a caixa e repor** (`player:action openBox` = 1/2, `placeUnits` conclui) → abrir a loja na placa → sentar e concluir 3 compras (`checkout:done`, 1x por cliente) → jogar caixas vazias no lixo (`discardBox`) → atender mais 5. Seta 3D amarela (objeto `ui-guide-arrow` na cena; alvos de `world.poi`, com fallback pelo layout) e seta verde na borda. Progresso em `mercadinho:tutorial`; pular/rever no menu de pausa.
- **Orientação:** em retrato (≤ 1024 px de largura) cobre a tela com "Gire o celular" (z 95), pausa o relógio e trava o input (modal `rotate`).
- **Debug/teste:** `window.__ui` (`tablet`, `pay`, `report`, `celebrate`, `missions`, `night`, `cart`, `endDay()`, `storeSign()`). E2E: `tests/e2e/ui-phase3.e2e.mjs` (`npx vite build && npx vite preview --port 5194`; prints em `UI3_SHOTS`).

## Fase 3 — player (src/player)
- **Só 1ª pessoa:** olhos a 1,6 m (sentado ≈ 1,22 m), FOV 70 na paisagem (retrato: até 100 para manter o campo horizontal), cápsula de raio 0,3 contra `world.isWalkable` + paredes finas (fachada fora da porta, parede do depósito fora da passagem), sem pular/correr (3,3 m/s; 2,9 com caixa). Avatar de 3ª pessoa removido. `reduceMotion` desliga balanço de cabeça e da caixa.
- **Controles (z 30, `[data-player-controls]`, classes `pl-*`):** joystick visível em repouso no canto inferior esquerdo (centro x = 15% da largura limitado a 96–150 px, y = altura − 90..122 px, raio 58; `__player.input.restPos()`), segue o dedo se o toque começar longe; olhar arrastando na metade direita (qualquer ponto livre quando sentado); mira (ponto branco). Botão de AÇÃO 96 px (right 26, bottom 20) com mão SVG original + rótulo, anel verde (azul no modo daltônico) com alvo, laranja-claro quando desabilitado; Arremessar / Largar / Abrir-Fechar caixa / Mover (secundário) em arco à esquerda e acima; "Sair do caixa" laranja à direita (meio). Some tudo com `ui:modal` ou `camera:override`; só o grupo de ação some em `build:state {active:true}` e durante o esfregão. Teclado: WASD/setas, E/Espaço (segurar repete), G arremessar, Q largar, C abrir/fechar, F secundário (Enter/R/Esc/Del ficam com o world). **Não emite mais `interact:prompt`/`interact:secondary`.**
- **Alvo:** raycast do centro em `world.pickGroup` (sem ele, proxies próprias montadas do estado), 2,6 m (placa/computador 3,5 m), histerese (+0,3 m no alvo atual; troca após 0,07 s; perda após 0,16 s), a mira não atravessa paredes. `world.highlight` só quando o alvo muda (sem ele: arestas verdes de reserva) e nunca sentado.
- **Rótulos:** Pegar · Mãos cheias · Abrir caixa · Repor (segurar = 1 un./0,12 s; atribui com `assignProduct` se o móvel está vazio/esgotado e a categoria é aceita) · Prateleira cheia · Outro produto · Não cabe aqui (categoria recusada) · Preço (`ui:openTablet {tab:'prices', productId}`) · Guardar / Retirar / Caixa vazia / Depósito vazio (rack) · Jogar fora / Só caixa vazia · Limpar · Abrir loja / Fechar loja (`store:sign`; se a fase continuar `prep` 0,4 s depois e sem modal, o player abre a loja) · Usar computador · Sentar no caixa / Caixa ocupado (funcionário no 1º balcão de `counters()`) / Largue a caixa · Depósito (licença) (`ui:openTablet {tab:'services'}`). Secundário "Mover" (`build:edit`) só de mãos livres. Ação na caixa da pilha que serve (ela vai para o topo).
- **`player:action` kinds** do protocolo + `openBox`/`closeBox` (aditivos); sempre seguido de `stateChanged {what: sidewalk|shelf|furniture|storage|dirt|player}`. `sfx`: `throw`/`mop` no INÍCIO da animação, `boxOpen`/`boxClose`, `sit`/`stand`, `box`, `pop` (cada unidade), `trash`, `step`, `error` (ação desabilitada).
- **Caixa na mão:** caixa própria do player (abas animadas 0,35 s que dobram para fora/baixo para não tapar a mira, fita quando fechada, rótulo do produto; produtos de `world.makeProductMesh` em até 2 camadas, fallback blocos coloridos; vazia quando `units==0`); com dolly (capacidade > 1) a pilha aparece num carrinho. A caixa **arremessada** usa `world.makeBoxMesh` (mesmo visual do chão; `setOpen`/`setUnits`). A camada da mão é desenhada por último limpando a profundidade (nunca entra na parede/prateleira).
- **Arremesso:** mira assistida (lixeira mirada, ou ponto do chão a 1–9 m), física própria (gravidade, chão, topo de móveis por altura, paredes, teto 2,75 m; props finos da calçada não bloqueiam). Durante o voo a Box continua `carried=true`. Pouso: raio 0,8 m de `trashBin()` + vazia → `discardBox`; com produtos → cai 1 m ao lado + toast; senão `dropBox(x,z,rot)` no ponto válido mais próximo (`canDropBox` + sem móvel).
- **Largar:** `build:box {boxIndex}` (a caixa some da mão durante a prévia); sem `build:state {active:true}` em 0,3 s solta à frente com `dropBox`. Fim com `placed !== false` e a caixa no chão → `player:action dropBox`; cancelado → volta para a mão.
- **Sentado:** `world.seatPose` (fallback: operador + frente do balcão), yaw ±60°, pitch −0,6..+0,5 em torno da pose; `mode='seated'`, `seatedAt = atCounter = counterId`. `services.pick` (PickService): toque/clique curto no canvas → raycast nos objetos registrados (visíveis e na cena; tolerância de 34 px para itens pequenos) → `onTap`; ignorado com `ui:modal` aberto. "Sair do caixa" levanta no tile do operador.
- **Debug:** `window.__player` (`cam pos teleport look lookAt target actions forceTarget press actionDown actionUp throwBox dropBox toggleBox secondary sit stand capacity forceCap held flying mopping tap picks tapProbe tapProbeHits removeTapProbe usingFallback dropAll`). E2E: `tests/e2e/player-fp.e2e.mjs` (`npx vite build && npx vite preview --port 5192`; `PLAYER_URL`, prints em `PLAYER_SHOTS`).

---

# Fase 4 — níveis por móvel, APK e ajustes de toque (PROTOCOLO OBRIGATÓRIO)
Plano: `docs/PHASE4.md`. Tipos: `ShelfLevel` e `Furniture.levels` (src/sim/state.ts), `PickInfo.level` e
`WorldService.levelAt` (src/core/services.ts), API "FASE 4" no fim de src/sim/api.ts.

## Modelo de níveis (sim é o dono)
- shelf/fridge/freezer têm `levels: ShelfLevel[]` (quantidade de níveis = `FurnitureSpec.slots` do tipo). Cada nível tem
  produto próprio (etiqueta) e `units` (capacidade = `slotCapacity` do produto). Etiqueta pode ficar com 0 unidades ("--").
- `state.shelf[produto]` e `state.slots[produto]` passam a ser DERIVADOS (soma dos níveis), recalculados pelo sim após
  cada mutação; leitura continua valendo. `Furniture.productId` fica obsoleto (migração: níveis recebem o produto antigo e
  o estoque é distribuído).
- Funções antigas continuam funcionando com a regra nova: `placeUnits` (repositor npc: enche níveis do produto, depois
  níveis vazios sem etiqueta compatíveis), `takeFromShelf`/`returnToShelf` (por níveis), `assignProduct` (etiqueta os níveis
  vazios), `productCapacity` (soma dos níveis com a etiqueta).
- Preço sugerido (`suggestedPrice`) = **média de mercado** (×1,00), não +12%. Curva de aceitação mais tolerante:
  ~95% em 1,00, ~85–90% em 1,10, 50% por volta de 1,30, quase zero acima de 1,6. Balão "Caro!" só quando rejeita com
  razão > 1,05. Exigentes (picky) continuam rejeitando > 1,10.

## Interação por nível (player)
O player faz raycast do centro; no móvel, calcula o nível com `world.levelAt(furnitureId, hitPoint)` e preenche `pick.level`.
| Situação | Ação |
|---|---|
| caixa aberta com unidades; `canStockLevel` = ok | **Repor** (segurar, 1 un. a cada ~0,12 s) → `placeUnitsInLevel` |
| caixa fechada | **Abrir caixa** |
| caixa aberta **vazia**, nível com unidades | **Retirar** (segurar) → `pullUnitsFromLevel` (a caixa passa a ser do produto do nível) |
| other-product / not-accepted / full | desabilitado: "Outro produto" / "Não cabe aqui" / "Nível cheio" |
| sem caixa | Preço → `ui:openTablet {tab:'prices', productId do nível}`; secundário: Mover |
- O world desenha produtos e etiqueta de preço POR NÍVEL e destaca só o nível mirado quando `pick.level` vem preenchido.
- npc: cliente escolhe um nível com `locateProduct` (com unidades), vai ao `furnitureAccess` do móvel e usa `takeFromLevel`.

## Toque e configurações
- Botões de jogo agem no `pointerdown` (sem esperar `click`), cada ponteiro rastreado por `pointerId`; joystick e olhar
  não bloqueiam outros dedos. Nenhum `preventDefault` global que suprima eventos de outros alvos.
- `mercadinho:settings` ganha `lookSensitivity` (0,4–2,0; padrão 1,0) e `settings:changed` passa a levar esse campo.
- Telas do jogo (troco, maquininha, Mercado/tablet, resumo) **não podem ter barra de rolagem** em 844×390, 800×360,
  740×360 e 720×330; no celular o tablet ocupa a tela inteira (respeitando safe-area).

## APK (agente apk)
- Capacitor (Android). App em tela cheia imersiva (barras do sistema ocultas, reaparecem com gesto), orientação
  `sensorLandscape` (trava em paisagem e vira para o outro lado horizontal), tela sempre ligada, nome "Mercadinho 3D".
- Service worker desligado dentro do app nativo (`window.Capacitor`).
- `npm run apk` gera o APK de depuração; assinatura com keystore de depuração FIXA versionada (credenciais públicas
  padrão de debug) para que atualizações instalem por cima sem perder o save.
- Navegador: no primeiro toque, tentar tela cheia + `screen.orientation.lock('landscape')`; se falhar, manter o aviso.

## Fase 4 — world (src/world)
- **Desenho por nível:** cada nível de shelf/fridge/freezer desenha só o seu produto (`Furniture.levels[i].productId`), com
  itens proporcionais a `units / slotCapacity` (mín. 1 com estoque; fileira da frente primeiro, até 2 camadas se couber;
  produto mais alto que o vão é reduzido para caber). Nº de tábuas/cestos = `levels.length` (reserva sem `levels`: `FurnitureSpec.slots`
  do tipo, todos com o `productId` antigo e a fração de `state.shelf/slots`). Instancing mantido (1 InstancedMesh por produto).
- **Índice do nível:** shelf/fridge = de **cima para baixo** (0 = tábua de cima); freezer = cestos da **esquerda para a direita**
  vistos da frente. Geometria única em `levelGeoms(type, n)` (src/world/furniture.ts: região, tábua, área útil, etiqueta);
  `levelHeights(type, n)` = y local da base da tábua de cada índice (shelf 4 níveis: 1,03 / 0,72 / 0,41 / 0,10 m; fridge 4: 1,385 / 0,99 / 0,595 / 0,20 m).
- **Etiqueta por nível:** cor do produto + preço; `--` quando o nível tem produto e 0 unidades; nível sem produto = sem etiqueta
  (1 malha, 1 draw call). Frisos das tábuas na cor do produto do nível. Placa do topo: produto único, categoria dominante
  ("Mercearia") se os níveis misturam produtos, VAZIO sem etiquetas.
- **`levelAt(furnitureId, point)`:** ponto de mundo → coordenadas do móvel (com rotação) → índice (shelf/fridge pela altura,
  freezer pelo x local); `null` fora do móvel ou tipo sem níveis. **`highlight(pick)`** com `pick.level` = contorno verde só da
  região daquele nível (sem `level`, o móvel inteiro, como antes); `highlighted()` devolve o `level`.
- **Prévia:** o fantasma usa o nº de níveis do móvel (editar) ou do tipo (novo). Caixas, monitor, posicionamento sem mudança.
- **Debug:** `__world.levels(id)`, `levelAt(id,x,y,z)`, `levelPoint(id,level)` (centro da frente, mundo), `levelHeights(type,n)`,
  `tagLevels()` (`{id, level, pid, text}`); `tags()` agrega por produto (`-` se todos os níveis dele esgotaram).
- **Desempenho (perf.e2e, mesma cena):** draw calls 68–82 dentro (igual à Fase 3), low 54, texturas 16, sem vazamentos;
  triângulos ≈ 117k (low ≈ 110k).
- **Editar móvel (QA):** VENDER pede confirmação ("Vender a prateleira por R$ X? (metade do preço) N un. voltam em K caixas na
  calçada (ENTREGAS)" / "vão para o depósito", simulado numa cópia do estado) com VENDER/VOLTAR (Enter/Delete confirmam, Esc volta);
  vender/GUARDAR avisam no toast para onde foram as unidades. Prévia de caixa vazia diz "(vazia)".
- **CPU:** `sync` sai cedo por hash numérico sem alocação (só reconstrói o que mudou); preços só quando `prices/market` mudam;
  matrizes de objetos estáticos congeladas (95 → 14 automáticos). Perfil opt-in: `__world.profile(true)` / `__world.profile()`.

## Fase 4 — sim (implementado; números em docs/GDD.md §4.1, §4.4 e §4.5)
- **Níveis:** prateleira 4, geladeira 4, freezer 3 (`FurnitureSpec.slots`). `Furniture.levels: ShelfLevel[]` é a fonte da verdade
  (nível sem etiqueta = `{units: 0}`; regras em `src/sim/levels.ts`). **Derivados** (recalculados pelo sim após toda mutação; escrever neles
  não tem efeito): `state.shelf[p]` (soma da loja inteira), `state.slots[p]` (nº de níveis com a etiqueta) e `Furniture.productId`
  (etiqueta do 1º nível etiquetado; só compatibilidade). Nível livre (sem etiqueta) ou com etiqueta e 0 un. aceita qualquer produto de
  categoria aceita; com unidades, só o mesmo produto; a etiqueta fica com 0 un. ("--"). Móvel novo (`buyFurniture`/`placeFromStock` sem
  `productId`) nasce sem etiquetas; com `productId`, todos os níveis etiquetados. Vender/desmontar devolve as unidades de cada nível
  (depósito se couber, senão caixas fechadas na calçada). Layout inicial: 4 níveis de feijão (48 un.) e 4 de macarrão (64 un.).
- **API Fase 4:** `furnitureLevels` (cópia; `[]` sem níveis; móvel inexistente lança) · `levelCapacity` (capacidade TOTAL do nível; 0 sem
  etiqueta e sem `productId`, ou categoria recusada) · `canStockLevel` com precedência **box-empty → not-accepted → other-product → full →
  box-closed → ok** (balcão/estante/decor = not-accepted; caixa/móvel/nível inexistentes lançam) · `placeUnitsInLevel` (0 = caixa vazia ou
  nível cheio; lança "… não cabe em …", "Este nível tem outro produto", "Quantidade inválida"; não exige caixa aberta) · `pullUnitsFromLevel`
  (caixa vazia vira do produto do nível; mesma caixa até boxSize; 0 = nível vazio/caixa cheia; lança "A caixa tem outro produto") ·
  `takeFromLevel` (unidades do produto ATUAL do nível; 0 para qtd inválida ou móvel/nível que sumiu, sem lançar) · `locateProduct` (ordem
  dos móveis e níveis; inclui níveis com 0 un.). `costBasis` não muda ao mover entre caixa e nível (testado: `costBasis.units = unitsOwned`).
- **Funções antigas com a regra nova:** `placeUnits` enche níveis do produto (em QUALQUER móvel, na ordem de `state.furniture`) e depois
  níveis livres compatíveis; lança "Nenhuma prateleira exibe este produto" sem nenhum dos dois. `takeFromShelf` tira do nível mais cheio;
  `returnToShelf` volta aos níveis do produto/livres e o resto vai ao depósito/calçada. `assignProduct` etiqueta só os níveis VAZIOS
  (`undefined` tira a etiqueta deles; níveis com unidades ficam; nada vai para a calçada). `productCapacity` = níveis etiquetados × slotCapacity.
- **Saves:** sem níveis (Fase 3 ou anterior) → níveis recebem o `productId` antigo e o estoque somado é distribuído enchendo nível a nível
  (sobra → depósito/calçada); níveis inválidos são saneados (etiqueta recusada/desconhecida, excesso, tamanho errado).
- **Preço:** `suggestedPrice` = média de mercado. Aceitação `1/(1+e^(k·(r−1,30)))`, k = 10 abaixo e 13 acima: 99% (0,8) · 95% (1,0) ·
  88% (1,1) · 73% (1,2) · 50% (1,3) · 21% (1,4) · 2% (1,6). Bot padrão ×1,1 (ótimo de lucro; o sugerido rende ~83% dele); nível 30 no dia ~83.
- **Avisos:** **world** — desenhe e etiquete por `f.levels[i]` (`levels.length` dá o nº de níveis; capacidade = `levelCapacity`); nunca use
  `state.shelf[f.productId]` para desenhar um móvel (é a soma da loja: era a causa do "duplicou nas duas"). **player** — Repor =
  `canStockLevel` + `placeUnitsInLevel`; com caixa vazia `canStockLevel` dá `box-empty` antes de tudo (ofereça Retirar se o nível tem
  unidades → `pullUnitsFromLevel`); não use mais `assignProduct`+`placeUnits` para o jogador (põe no 1º nível do produto da loja, não no
  mirado); Preço = `furnitureLevels(...)[level].productId`. **npc** — cliente: `locateProduct` (units > 0) → andar até o móvel →
  `takeFromLevel` (confira o `productId` do nível; 0 = móvel sumiu/esvaziou); desistência segue com `returnToShelf`. Repositor: `placeUnits`
  vale, mas para repor o móvel até onde andou use `locateProduct` + `placeUnitsInLevel`. **ui** — preço sugerido = mercado (sem +12%);
  `productCapacity`/`state.slots` contam níveis (4 por prateleira); `economy.shelfCapacity`/`unitsOwned` seguem válidos.

## Fase 4 — player (src/player)
- **Nível mirado:** no hit de móvel shelf/fridge/freezer o player chama `world.levelAt(furnitureId, hitPoint)`; fora dos níveis
  (tampo, base, lateral) procura o nível mais próximo na vertical (passos de 7 cm, até 70 cm). Sem `levelAt`: estimativa própria
  (nível 0 = o de cima; freezer da esquerda para a direita). O alvo vira um `PickInfo` NOVO `{kind:'furniture', id, level}` (o
  `userData.pick` do world nunca é alterado) e `world.highlight` é chamado também quando só o nível muda (troca após 0,07 s).
- **Ações por nível** (decididas por `api.canStockLevel` sobre as caixas carregadas, do topo para a base): **Repor** (caixa aberta,
  `ok`; segurar = 1 un./0,12 s → `placeUnitsInLevel(…, pick.level, 1)`) > **Abrir caixa** (caixa fechada que serviria: `box-closed`) >
  **Retirar** (caixa ABERTA e VAZIA, nível com unidades; segurar → `pullUnitsFromLevel(…, 1)`; enquanto segura continua puxando
  para a MESMA caixa até encher `boxSize` ou esvaziar o nível — não vira "Repor" no meio) > **Abrir caixa** (fechada vazia, nível com
  unidades) > desabilitados **Outro produto** / **Não cabe aqui** / **Nível cheio** / **Caixa vazia**. Sem caixa: **Preço** →
  `ui:openTablet {tab:'prices', productId do nível}` (nível sem etiqueta: sem `productId`; alvo sem nível: 1º nível etiquetado) e
  secundário **Mover**. `assignProduct`/`placeUnits` não são mais usados pelo player.
- **`player:action`:** `placeUnits` e o novo `pullUnits` levam `{productId, furnitureId, level}`; depois `stateChanged {what:'shelf'}`
  (+ `'furniture'` quando a etiqueta do nível muda, + `'sidewalk'` no Retirar). Selo na tela: "Produto n/capacidade · caixa: k"
  (`levelCapacity` = capacidade total do nível).
- **Multitoque:** todos os botões do player agem no `pointerdown` (o `click` só vale com `detail === 0`, teclado/leitor de tela) e têm
  `touch-action:none`; o botão de ação guarda o `pointerId` que o apertou e só solta no `pointerup`/`pointercancel`/`lostpointercapture`
  desse mesmo ponteiro. Joystick e olhar seguem por `pointerId` sem capturar outros dedos; nenhum `preventDefault` global (só
  `contextmenu` na área livre e teclas Espaço/setas). Medido no e2e: com dois dedos (CDP) o Chromium NÃO entrega `click` ao botão,
  por isso o bug do usuário.
- **Sensibilidade:** `lookSensitivity` (0,4–2,0; padrão 1) lido de `localStorage['mercadinho:settings']` no início e de cada
  `settings:changed` (evento sem o campo mantém o valor); multiplica o olhar por toque e por mouse (`__player.prefs()`).
- **Paisagem no navegador** (`src/player/landscape.ts`): no 1º `pointerup` de toque (o gesto que dá ativação ao toque) tenta
  `documentElement.requestFullscreen({navigationUI:'hide'})` + `screen.orientation.lock('landscape')`, falhas silenciosas, até 2
  tentativas. Não roda no app nativo (`window.Capacitor` com `isNativePlatform()`), em iframe (artefato), com mouse, nem sob WebDriver
  (testes) salvo `?fs=1`. Estado em `__player.landscape()`.
- **Debug novo:** `__player.target()` com `level`, `__player.aimLevel(furnitureId, level)` (mira pelo caminho real: raycast +
  `levelAt`), `__player.prefs()`, `__player.landscape()`. E2E: `tests/e2e/player-fp.e2e.mjs` (`npx vite build && npx vite preview
  --port 5202`; `PLAYER_URL`, prints em `PLAYER_SHOTS`).

## Fase 4 — ui (src/ui)
- **Opções:** "Sensibilidade da câmera" (`input[type=range]#opt-look`, 0,4–2,0, passo 0,1, padrão 1,0) → `mercadinho:settings.lookSensitivity`
  e `settings:changed {…, lookSensitivity}` a cada mudança e na emissão inicial (o player aplica). A UI grava preservando campos de outros
  módulos. Opções têm modal próprio (Esc fecha só elas). No celular deitado Opções e pausa viram grade de 2 colunas; tela inicial lado a lado.
- **Preços:** "Preço sugerido" e "Definir todos no sugerido" (`#price-all`) usam `api.suggestedPrice` (média de mercado). Selo pela razão
  preço/mercado: Barato < 0,95 ≤ Justo ≤ 1,10 < Caro ≤ 1,25 < Abusivo (justo até +10%, onde fica o lucro máximo da curva nova).
- **Sem rolagem (altura ≤ 520 px):** o tablet ocupa a TELA INTEIRA (`.tb-wrap` só com a safe-area; o `.hud` fica escondido atrás, toasts por
  cima; dinheiro em `.t3-cash` no cabeçalho; classe `tb-open` no `.mx-root`). Pagamento: troco com os 4 valores numa linha; maquininha em
  4 colunas (≤ 420 px) ou 5 colunas/3 linhas (≤ 380 px) — a ordem das teclas segue as colunas calculadas pelo CSS (também no `resize`).
  Comemoração/resumo compactos (emblema menor; oculto ≤ 360 px). Listas internas (produtos, trilho, Preços, carrinho) rolam com barra
  oculta no toque/telas baixas (fina no desktop). Alvos ≥ 44 px (`.btn.small`, `.switch`, `.t3-x`).
- **Toque:** botões do HUD (nível, dinheiro, menu, carrinho), "Terminar o dia" e teclas do troco/maquininha agem no `pointerdown`
  (`dom.tapOn`: cancela o clique fantasma no `touchend`; teclado/leitor de tela via `click` com `detail 0`). Listas roláveis seguem no `click`.
- **Orientação:** o aviso só aparece em retrato e sem trava: nunca no app nativo (`Capacitor.isNativePlatform()`) nem em tela cheia com
  `screen.orientation` em paisagem (trava do `player/landscape.ts`); aceita `orientation:locked {locked}` opcional no bus; espera 0,35 s
  antes de mostrar após girar (sem piscar). Visibilidade por classe `.rotate.on` (não mais por media query).
- **E2E** (`npx vite build` + `npx vite preview --port 5204`; `NPC_URL`/`UI2_URL`/`UI3_URL`): `phone-fit` (sem rolagem em 844×390, 800×360,
  740×360, 720×330: troco, maquininha, tablet/Mercado em tela inteira, Preços, pausa, Opções, comemoração, noite, resumo, tela inicial;
  prints em `UI4_SHOTS`), `fullday` (placa → noite → Terminar o dia → resumo → Continue jogando → dia 2 `prep` → recarregar: dia e dinheiro
  persistem), `ui-phase2` (falência via resumo e via tablet, Automático, Encher prateleiras, Preços, Finanças/banco, Melhorias,
  Opções/sensibilidade; o layout do checkout antigo saiu), `ui-phase3` (tablet em tela inteira no celular; sem aviso no app nativo).

## Fase 4 — npc (src/npc)
- **Compra por nível:** para cada item o cliente escolhe o nível COM unidades mais próximo (`api.locateProduct`; sem nenhum,
  vai a um nível etiquetado e mostra "Sem estoque"), anda até `world.furnitureAccess(furnitureId)` e retira com
  `api.takeFromLevel` — só de níveis que AINDA têm a etiqueta do produto (conferida por `locateProduct` logo antes de retirar),
  completando a quantidade com outros níveis do mesmo móvel. Nível esvaziou/trocou no caminho: outro nível do móvel, outro
  móvel (até 2 trocas, sem sortear o preço de novo) ou desiste do item (balão "Sem estoque"). Devoluções (desistência,
  fechamento) usam `returnToShelf`. Sem a API de níveis (lança): reserva `furnitureFor` + `takeFromShelf`.
- **Reclamação de preço:** rejeição (`acceptsPrice.ok=false`) só vira balão "Caro!" + `customerComplaint` com razão
  preço/mercado > 1,05; abaixo disso o cliente apenas deixa o item, sem balão nem penalidade. Exigente: recusa > 1,10
  sempre ("Absurdo!", reclamação ×2, `ratio` ×1,15); abaixo de 1,10 segue a regra comum.
- **Repositor:** vai ao móvel mais próximo com espaço nos níveis ETIQUETADOS com o produto e repõe lá com
  `api.placeUnitsInLevel` (nunca troca etiquetas do jogador); se sobrar e outro móvel do produto tiver espaço, leva a mesma
  caixa até lá. Sem níveis/API: `placeUnits`.
- **Esteira contínua:** eixo derivado de `world.beltSlots` (média dos 2 primeiros → 2 últimos, + meio passo); cada item ocupa
  o comprimento da sua caixa envolvente (`geometry.boundingBox`, cache por produto) com folga de 3 cm, frente virada para o
  operador; anda até encostar no da frente (nunca se sobrepõem). Não coube na ponta do cliente: ele espera (pose de cesta) e
  põe o restante quando a bipagem libera espaço.
- **Pagamento visto da cadeira:** com o jogador sentado, notas/cartão vêm até 0,5 m mais perto da câmera (nunca a menos de
  1,3 m) e maiores (cartão ×2,5 ≈ 45×30 px em 740×360; notas ×1,4); o cliente encosta no balcão e se debruça. Funcionário: tamanho normal.
- **Debug:** `__npc.lanes()` ganhou `gap` (menor folga entre itens vizinhos; negativa = sobreposição), `waiting` (itens ainda
  na cesta), `payScale`, `method`; `__npc.stock(n, productId?)` (teste: abastece os níveis etiquetados e recalcula
  `state.shelf`), `__npc.locate(pid)`. E2E: `npc-seated` (+ compra por nível, esteira sem sobreposição, pagamento maior),
  `npc-phase2` (+ "Caro!" só > 1,05), `npc`, `npc-staff` — abastecem por `__npc.stock` (state.shelf é derivado) e usam
  timeScale maior porque o SwiftShader roda a ~2–3 fps (dt limitado a 0,1 s).

## Fase 4 — sim: correções do QA (docs/qa/systems.md, gameplay.md, economy.md)
- **Relógio salvo:** `StoreState.clock?: SavedClock` (`{minute, phase: 'prep'|'open'|'closing'|'report'}`, tipos em state.ts). `newGame` =
  `{minute: OPEN_MIN, phase: 'prep'}`; `deserialize` saneia (ausente/fase desconhecida → prep às 08:00; prep → OPEN_MIN; minuto limitado a
  [OPEN_MIN, CLOSE_MIN]). **main/core** gravam antes de salvar e restauram ao carregar (a sim não mexe no campo).
- **Cestas dos clientes:** `StoreState.npcHeld?: {productId, qty}[]` — o **npc** mantém (soma ao tirar com `takeFromLevel`/`takeFromShelf`,
  subtrai ao vender com `completeSale` ou devolver com `returnToShelf`). Ao carregar, `deserialize` devolve tudo à exposição (níveis do
  produto, níveis livres, depósito/calçada) e deixa `[]` (ausente continua ausente). Também no load: `costBasis[p].units` = unidades possuídas.
- **Save saneado:** números inválidos (null/NaN/texto/negativos/não inteiros) viram valores válidos (dinheiro inválido → 0); objetos null →
  padrão; produtos/licenças/melhorias fora do catálogo removidos (caixas, depósito, custo médio, preços, pedidos, estatísticas); caixa acima
  de boxSize vira mais caixas; móvel de tipo desconhecido é descartado (unidades devolvidas) e móvel sem x/z/rot válidos, fora da área ou
  sobreposto volta para "Para montar"; ids repetidos ganham ids novos. `deserialize` só lança para JSON ilegível ou versão ≠ 1.
- **Save ilegível:** `load` guarda o texto em `${SAVE_KEY}:corrupt-<timestamp>` (uma vez por conteúdo) e grava `SAVE_RECOVERED_KEY`
  (`'mercadinho:save-recovered'`) = `{"key", "at", "error"}` antes de devolver null. **ui** — mostre "save danificado (cópia guardada)" e
  apague a chave de aviso (`localStorage.removeItem`); o backup fica.
- **Cadeira do caixa:** `canPlace` reserva o tile do operador de cada balcão (`operatorTile(f)` em furniture.ts, mesma conta de
  `world.counters().operator`; rot 0 → (x+1, z−1)): nenhum móvel em cima, o do balcão novo dentro do salão e livre, e o tile precisa continuar
  alcançável a partir da porta (comprar, montar do estoque, mover). `reservedTiles(state)` = antessala + passagem + operadores.
- **Depósito/expansão:** `unlockStorage` e `buyExpansion` realocam móveis da passagem, da antessala ou do tile do operador; sem lugar
  válido, o móvel é desmontado para "Para montar" (unidades → depósito/calçada; nunca o último balcão).
- **Pedido automático:** o array de `runAutoOrders` continua só com as compras; ganhou `.skipped: AutoOrderSkip[]` (não enumerável) com
  `{productId, boxes, reason: 'sidewalk-full'|'no-money', message}` (pt-BR). **npc** — mostre `message` (toast `bad`), no máx. 1×/hora por produto.
- **QA de economia (mantido):** dinheiro inicial R$ 250, aluguel a partir do nível 4 ou dia 6, empréstimo R$ 400 × nível; GDD §1/§4 atualizados.
- **Pendente:** um caixa contratado por balcão (proposta P1 de docs/qa/economy.md) não foi implementado nesta rodada.
- **Adendo QA (gameplay.md):** ações que ABREM painel/modo (Preço, Usar computador, Depósito (licença), Abrir/Fechar loja,
  Mover) rodam no `pointerup` do MESMO dedo, se ele for solto sobre o botão (folga de 24 px). Repor/Retirar/Pegar/joystick seguem no
  `pointerdown`. O `touchend` de cada botão do player cancela o `click` sintético (sem clique fantasma no tablet). Teclado (E/Espaço,
  Enter) age na hora. Placa com intervalo de 0,6 s (toque duplo não abre e fecha). Ao esvaziar a caixa no Repor, o mesmo nível não
  oferece "Retirar" por 1 s ("Caixa vazia"). Toque no 3D sentado (esteira, dinheiro): até 800 ms com o dedo a menos de 14 px do início.
- **Desempenho:** mira (raycast) a cada 2 quadros com câmera/posição mudando, a cada 6 parado e na hora após `stateChanged`;
  teste próprio sem alocação contra a caixa envolvente de cada proxy (sem objetos `Intersection` do Three; a matriz da câmera é
  atualizada antes, então a mira não fica um quadro atrasada); `resolve` das ações só quando alvo/estado/caixas/fase mudam (ou a
  cada 0,25 s); sem objetos/strings/closures por quadro em controls/held/colisão. Medida (`__player.bench`, loja cheia: 26 móveis,
  14 caixas, 6 sujeiras): alocação 2,7–3,8 KB → 0,55–1,8 KB por quadro (resto: números boxados no V8/Three e `isWalkable` ao andar);
  tempo 0,009–0,022 → 0,003–0,017 ms/quadro no laço. Debug: `__player.bench(n, walk, look)`, `perf()`, `perfReset()`, `castNow()`.

## Fase 4 — npc (correções do QA)
- **Pagamento pendente (bug alto do QA):** com o painel de troco/maquininha aberto (`ui:modal {open:true}`) o cliente não reestende
  o pagamento e nada expira; o `checkoutResult` do pedido pendente é sempre aceito. Painel fechado sem resposta (2,5 s), UI ausente
  (90 s) ou jogador fora do caixa (1,5 s, painel fechado): o npc invalida o pedido e emite `checkout:cancel {customerId, counterId}`
  (**ui: feche o painel ao receber**); resultado de pedido cancelado é ignorado. Teste: `tests/e2e/qa-play-pay-timeout.mjs`.
- **Agenda:** chegadas determinísticas por (seed, dia) (`dayRand`) e filtradas por `t >= clock.minute`: ao recarregar no meio do dia
  (core restaurando o minuto) as já ocorridas não se repetem. `__npc.schedule()`.
- **`state.npcHeld?: {productId, qty}[]`:** soma dos itens com clientes (cestas, esteira, pagamento), reescrita na hora a cada
  pegar/devolver/vender/abortar (antes de qualquer evento) e zerada no init e em `dayStarted`; a sim devolve às prateleiras ao carregar.
- **Paciência:** 50–75 s sem caixa contratado (40–60 s com caixa); multiplicadores de idoso/criança/atacado mantidos.
- **Pedido automático:** entradas com `reason`/`error`/`skipped` (string) geram o toast `bad` "Pedido automático não comprou Arroz
  (calçada cheia)"; o toast "Pedido automático: N cx …" (contrato da UI) só lista o que foi comprado.
- **Desempenho:** material próprio para a pele da cabeça (antes o mesmo do `SkinnedMesh`), para o recheio da caixa do repositor e
  clone próprio do material de produto do world na esteira — eliminam a troca de programa do three a cada quadro
  (`getProgramCacheKey`/`flatten` ≈ 0,6 ms/quadro no perfil com 10 clientes); itens da cesta invisíveis quando vazia e com
  culling; LOD: fora da vista ou a mais de 15 m o esqueleto anima a cada 4 ticks. `__npc.perf()` = ms do update do npc/quadro.
- **Vários caixas contratados:** não implementado (aguarda a sim; hoje 1 caixa contratado no balcão de menor id sem o jogador).

### Fase 4 — ui: correções do QA (docs/qa/*.md)
- **Voltar (`ui:back`):** cancela o diálogo de cima → fecha o painel/modal de cima (tablet, Opções, nível, comemoração, pagamento pede
  confirmação, "Detalhes" do resumo) → sem modal abre a pausa (no posicionamento manda Esc ao world) → na pausa/tela inicial pergunta
  "Sair do jogo?" e, confirmado, salva e emite `app:exit`. Resumo, falência e aviso de orientação ignoram o Voltar.
- **Clique fantasma:** `kit` descarta (captura da janela) o 1º clique de ponteiro sem `pointerdown` novo depois da abertura de qualquer
  modal/diálogo da UI (sem janela de tempo). Teclado e `.click()` programático passam. `qa-play-ghost-click` passa.
- **Pagamento:** missões contam só `checkout:done`; `checkout:cancel {customerId}` fecha o painel com aviso (sem "Pago!"). HUD tocado com o
  pagamento aberto dá retorno (toast + som). Placa: 2ª ação em < 1 s é ignorada; o diálogo de fechar avisa que não dá para reabrir hoje.
- **Save:** `mercadinho:save-recovered` → aviso "Seu save não pôde ser carregado; guardamos uma cópia e começamos um jogo novo" e a
  chave é apagada; "Continuar" só aparece com save que `deserialize` aceita.
- **Nível:** a UI emite `levelUp` para cada nível acima de `levelAck` e só chama `api.consumeLevelUps` depois do "Continue jogando!" da
  última comemoração (recarregar antes disso mostra de novo).
- **Preço:** texto da aba Preços e missão final do tutorial ("suba um preço: até 10% acima do mercado quase ninguém reclama").
- **Baixos:** selo de reposição do player (`.pl-badge`) recentrado na área livre à esquerda quando há cartão de missão no celular (CSS da
  ui; o player pode adotar a posição e a ui remove a regra) — `qa-play-badge-overlap` passa; seta verde com alvo atrás da câmera vai
  para a lateral (lado de virar).
- **Pendente:** vários caixas (um por balcão) — a sim ainda não permite; a aba Equipe continua com um caixa.

