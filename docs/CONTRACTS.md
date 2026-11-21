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
| `interact:secondary` | `{label:string\|null, action?:()=>void}` | player → ui (botão secundário 'Mover'; opcional, o primário assume 'Mover' quando não há outra ação) |
| `camera:override` | `{active:boolean}` | world (build mode) → player (player larga a câmera e o movimento; ao terminar interpola de volta) |

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
- **Layout:** móveis só em tiles inteiros. Antessala da porta 2×2 (x = porta−1..porta, z = depth−2..depth−1) e, com depósito, a passagem x = porta−1..porta em z = −1 e 0 ficam sempre livres. O depósito é contíguo ao salão por essa passagem; só `rack`/`decor` entram nele. Layout inicial: balcão em (8,6) e 4 prateleiras em z=2 (`initialFurniture()`).
- **Depósito:** `storageCapacity/storageUsed` (em caixas); `storeBox` recusa se cheio. `takeFromStorage(state, id, carry)` cria Box em `state.sidewalk` (carried=true se `carry`) e devolve as unidades.
- **Clientes:** `makeShoppingList` só devolve produtos licenciados **com móvel atribuído** e pode devolver `[]` (cliente deve ir embora: `recordLostCustomer`). Fluxo: lista → `acceptsPrice` → `takeFromShelf` → `completeSale`/`returnToShelf`. `arrivalSchedule(state)` dá os minutos das chegadas do dia (almoço e fim de tarde); `plannedArrivals` é determinístico por (seed, dia): chame uma vez ao abrir.
- **Sujeira:** `addDirt` ignora acima de 12; `cleanDirt` com índice inválido é no-op. `dirtPenalty` já entra na reputação.
- **Funcionários:** `employeeSpeed(role, nível)` em segundos por ação (nível limitado a 1..5). Salários cobrados em `closeDay`. Caixa contratado e caixas registradoras extras aumentam `checkoutCapacity`.
- **Bot/balanceamento:** `src/sim/bot.ts` (`playDays`) joga só pela API; números em `src/sim/tuning.ts` e GDD §4.

## Seção `world` (src/world) — notas para os outros módulos
- **Serviço:** `ctx.services.world` (`WorldService`). `findPath` devolve centros de tile **sem o tile inicial** (último ponto = destino; origem/destino não andáveis são ajustados ao tile andável mais próximo, raio 3); resultado em cache, mas é uma cópia (pode dar `shift()`). Paredes só são atravessadas na porta (2 tiles centrados) e na passagem do depósito. Navegação inclui calçada (z de depth a depth+3) e uma faixa de rua (2 tiles) para spawn: `spawnPoint()` = (−7,5; depth+3,5).
- **Convenção de móveis:** `Furniture.x/z` = canto mínimo do footprint **já rotacionado**. Frente (lado do cliente) em rot 0 = +z; 90 = +x; 180 = −z; 270 = −x. `furnitureAccess(id)` = tile em frente (ou ao lado, se bloqueado); `null` se inacessível.
- **Balcão (2×2, rot 0):** `operator` = tile atrás do balcão (x+1, z−1); `queue[0..]` = tiles na frente do lado esquerdo (x, z+2+i), limitada ao salão (pode ter só 1-2 posições se o balcão estiver perto da porta); `scanner` = posição (em tiles, contínua) do leitor sobre o balcão. Gaveta da registradora abre no evento `sfx {name:'cash'}`; porta de vidro abre com `sfx {name:'door'}` ou quando o jogador (`services.player.position`) está a < 3 m.
- **Caixas (`state.sidewalk`):** `carried` → não é desenhada (o player a desenha). Sem `x/z` → o **world escolhe um ponto livre** na `deliveryZone` e **grava `x/z` na própria Box** (único campo de estado que o world escreve). `x/z` = centro da caixa em tiles (contínuo). Caixas próximas (<0,3 m) empilham automaticamente. Caixa com `units < boxSize` aparece aberta. Estoque do depósito (`state.storage`) é desenhado nos `rack`s (24 caixas por rack, na ordem do catálogo).
- **Decor:** variantes visuais reconhecidas em `Furniture.variant`: `plant` (padrão), `tree`, `banner`, `lamp`.
- **Build mode:** `build:start {type, productId?, variant?}` (decor: `productId` = variante) / `build:edit {furnitureId}`. O world assume a câmera: emite `camera:override {active:true}` ao iniciar e `{active:false}` + `build:end` ao terminar (confirmar, vender ou cancelar); o `player` devolve o controle ao receber `active:false`. Confirmação chama `api.buyFurniture/moveFurniture` (erros viram `toast` kind `bad`, o modo continua ativo); sucesso emite `stateChanged {what:'furniture'}`, `sfx` e `toast`. Atalhos: R girar, Enter confirmar, Esc cancelar, Del vender; no toque: arrastar o fantasma, tocar para posicionar, arrastar fora dele para mover a câmera, pinça = zoom, giro de dois dedos = girar o móvel. UI própria em overlay DOM dentro de `uiRoot` (atributo `data-world-build`).
- **Visual reativo:** o world lê `state` a cada 0,25 s e em `stateChanged` (hash por seção; só reconstrói o que mudou). Paredes do lado da câmera ficam translúcidas (corte tipo casa de boneca). Luz/céu seguem `clock.minute` (08:00 manhã → 21:00 entardecer/noite).
- **Debug/testes:** `window.__world` (`nodes()`, `rebuild()`, `demo(true)`, `stats()`, `setCamera(...)`, `walls()`, `boxCounts()`, `walkable()`, `build.pose`, `service`). `?demo=1` na URL desenha um layout local de desenvolvimento **apenas se `state.furniture` estiver vazio** (nunca persiste).
