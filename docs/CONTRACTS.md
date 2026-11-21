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
