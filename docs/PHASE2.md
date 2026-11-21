# Fase 2 — melhorias (sem anúncios e sem energia)

Base integrada e verde (commit 0b00497). Esta fase implementa os itens P1 do `docs/BACKLOG.md` e robustez mobile.
As regras de colaboração continuam as de `docs/CONTRACTS.md`. Assinaturas novas: final de `src/sim/api.ts` ("FASE 2").

| Agente | Pasta | Entregas |
|---|---|---|
| sim | src/sim, tests | Implementar a API Fase 2; **conteúdo de fim de jogo** (novas licenças/produtos: hortifrúti, higiene, açougue/frios, eletrônicos... com `color`/`shape` no catálogo; mais itens de decor/móveis; expansões 5 e 6 se `storeBounds` permitir — pedir a mudança aditiva em core/layout.ts); empréstimo/falência; `runAutoOrders`; dolly; histórico; rebalancear dias 60+ com o bot; testes; atualizar GDD §4 |
| world | src/world | **Desempenho mobile**: reduzir draw calls (instancing/merge de geometria estática), tiers de qualidade via `settings:changed.quality` (pixel ratio, sombras, distância, nº de luzes), medir com `renderer.info` e documentar números; visuais genéricos por `Product.color/shape` para produtos novos (sem quebrar os atuais); `spawnPoint` mais perto da porta; teste de gestos de dois dedos no build mode |
| player | src/player | Carregar até `carryCapacity(state)` caixas (pilha nas mãos, ordem LIFO, UI de contagem), interações coerentes (largar/guardar/repor várias), `Box.carried` múltiplas; testar pinça/zoom por toque e joystick em viewport mobile emulado |
| npc | src/npc | Chamar `runAutoOrders` ao abrir a loja e a cada hora de jogo (toast com o que foi pedido); repositor lida com mais caixas; ajustar o cancelamento de checkout; **clientes especiais** (compra grande; exigente com preço; criança) mantendo o desempenho; teste e2e |
| ui | src/ui | Abas/telas: empréstimo e falência (aviso + recomeço guiado), regra de pedido automático por produto (aba Preços), botão "Comprar o que falta", seção Melhorias (dolly), Finanças com gráfico de lucro (30 dias, SVG/canvas próprio) e produtos mais vendidos, ajustes de acessibilidade (tamanho de fonte, redução de movimento, daltonismo em cores de preço), painel de checkout em paisagem baixa sem sobrepor o HUD |

Regra extra: **cada agente roda `npx tsc --noEmit` (sua pasta) e os testes relevantes antes de terminar**, e `npx vite build` deve continuar passando.
