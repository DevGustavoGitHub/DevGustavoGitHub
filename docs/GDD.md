# Mercadinho Sim — Game Design & Arquitetura (v0.1)

Simulador de gerenciamento de supermercado, sem anúncios e sem bloqueio por energia.
Uso as mecânicas como loop de gameplay. Nome, arte, sons e textos do jogo de referência **não** são reaproveitados.

## 1. Correções e decisões sobre a especificação

| Ponto da spec | Problema | Decisão |
|---|---|---|
| Relatório: "custo de reposição" | Subtrair compras do lucro pune quem estoca. O jogador tende a comprar o mínimo e vender menos. | Lucro líquido usa **COGS** (custo médio ponderado das unidades vendidas). Compras aparecem separadas como **variação de caixa**. |
| Troco exato com cédulas e moedas | Em BRL não há moeda de 1 centavo. Preços arbitrários geram troco impagável. | Preços são sempre **múltiplos de R$ 0,05**. Denominações: 200, 100, 50, 20, 10, 5, 2 e moedas 1; 0,50; 0,25; 0,10; 0,05. O algoritmo guloso é ótimo para esse conjunto, e há teste contra programação dinâmica. |
| Remover energia e anúncios | Energia e anúncios eram o **ralo de progressão** e a monetização. Sem eles a economia fica fácil e a receita zera. | Ralos reais: despesas fixas diárias (aluguel, salários), custo exponencial de licenças e expansões, mercado volátil. Monetização sugerida: compra única, ou cosméticos opcionais. **Nunca** vender tempo ou vantagem. |
| Entrega instantânea | Correto, mas remove o tempo de decisão. | Mantida. A pressão vem do relógio do dia e da capacidade de checkout. |
| Minigames manuais (bipar, troco, cartão) | A 100+ clientes/dia viram tarefa repetitiva. | Funcionários são a **válvula de ritmo**. Início: jogador atende ~23 (iniciante) a ~36 (eficiente) clientes/dia (a sim supõe 45; ver docs/qa/economy.md). Cada nível de caixa soma +25% de capacidade. |
| Mundo 3D | Maior custo de assets, câmera e performance, sem ganho de mecânica. | **2D top-down/UI primeiro** (Phaser 4). A simulação é desacoplada, então Three.js depois reaproveita 100% da lógica. |

## 2. Core loop (implementado em `src/sim`)

1. **Compra:** o catálogo mostra atacado do dia. O multiplicador por produto segue um random walk com reversão à média, limitado a [0,75; 1,35]. As caixas chegam à calçada na hora.
2. **Reposição:** unidades vão das caixas para os **níveis** dos móveis (Fase 4: cada nível guarda um produto, até `slotCapacity` unidades; `placeUnitsInLevel` / `placeUnits` / `putOnShelf`). Caixa vazia vai para a lixeira.
3. **Precificação:** o preço médio de mercado absorve **metade** do choque de atacado. Dia caro aperta a margem, dia barato a alarga.
4. **Demanda:** `P(compra) = 1 / (1 + e^(8·(r − 1,2)))`, com `r = preço / média`.
   r = 0,8 → 96%, r = 1,0 → 83%, r = 1,2 → 50%, r = 1,5 → 8%.
   O fluxo de clientes também sobe com preço baixo e com reputação.
5. **Checkout:** bipar itens, troco em dinheiro (`isChangeCorrect`) e valor digitado no cartão (`isCardAmountCorrect`). Gorjeta de 3% se a satisfação for ≥ 4.
6. **Fechamento:** `endDay` cobra despesas fixas, gera o `DayReport` e avança o mercado.

## 3. Progressão

- **XP:** por venda: 1 por unidade + 2 por cliente + bônus de velocidade (até 0,5 por unidade). Nível n exige `60·(n−1)^2,08 · (1 + 0,05·max(0, n−15))` XP acumulado (Fase 3): n=2: 60 (sobe no 1º dia mesmo com a loja pobre), n=3: 254, n=5: 1.073, n=10: 5.794, n=15: 14.524, n=20: 34.266, n=25: 66.847, n=30: 115.605 — primeiros níveis rápidos, nível ~30 por volta do dia 83 com o bot (Fase 4; era ~95).
- **Licenças** (nível mínimo / custo): Mercearia 1 / grátis · **Bebidas 2 / R$ 400** (2ª licença no nível 2, como no original) · Laticínios 4 / R$ 600 · Padaria 6 / R$ 1.500 · Limpeza 8 / R$ 3.000 · Congelados 10 / R$ 9.000 · Hortifrúti 13 / R$ 16.000 · Higiene e Beleza 16 / R$ 26.000 · Açougue e Frios 20 / R$ 42.000 · Eletrônicos e Utilidades 25 / R$ 70.000 (pós-teste 3).
- **Móveis, expansão, depósito, funcionários, melhorias e personalização:** implementados em `src/sim/furniture.ts`, `api.ts` e `tuning.ts` (tabelas abaixo).
- **Marcos de desbloqueio** (alinhados ao original; nenhuma lacuna maior que 3 níveis até o 28; `tests/phase2.test.ts` e `tests/phase3.test.ts` validam): 2 bebidas/geladeira/pote de gorjeta · 3 expansão 1 · 4 laticínios/caixa contratado/capacidade de clientes/caixa registradora extra · 5 depósito/expansão 2 · 6 limpador/padaria/carrinho de carga/expansão 3 · 7 expansão 4 · 8 repositor/limpeza · 10 congelados/freezer · 13 hortifrúti · 15 expansão 5 · 16 higiene · 20 açougue e frios · 25 eletrônicos · 27 estátua · 28 expansão 6. Níveis 2–5 dos funcionários espalham-se até o 22.

## 4. Números do jogo (balanceamento Fase 3, bot `src/sim/bot.ts`, validado em `tests/balance.test.ts`)

Todos os números ficam em `src/sim/tuning.ts` (+ `furniture.ts`, `catalog.ts`, `demand.ts`, `rent.ts`). Dinheiro em R$.

### 4.1 Móveis (footprint em tiles; `slots`: shelf/fridge/freezer = nº de NÍVEIS, cada um com 1 produto e até `slotCapacity` unidades; rack = caixas)

| Móvel | Custo | Nível | Níveis (slots) | Categorias | Footprint |
|---|---|---|---|---|---|
| Prateleira | 300 | 1 | 4 | mercearia, limpeza, padaria, hortifrúti, higiene, eletrônicos | 2×1 |
| Geladeira | 500 | 2 | 4 | bebidas, laticínios, hortifrúti, açougue e frios | 2×1 |
| Freezer | 1.500 | 10 | 3 | congelados | 2×1 |
| Caixa registradora | 1.000 | 4 | – | – | 2×2 |
| Estante do depósito | 500 | 5 | 8 caixas | – | 2×1 |
| Decoração | 80 (base) | 1 | – | – | 1×1 |

**Decoração** (`decorCatalog()`; o id vai como 5º argumento de `buyFurniture`, vira `Furniture.variant`): planta R$ 80 (nív. 1) · faixa R$ 80 (1) · cartaz R$ 100 (5) · tapete R$ 150 (6) · luminária R$ 120 (4) · árvore R$ 200 (8) · fonte R$ 600 (18) · estátua R$ 1.200 (27). O world reconhece `plant|tree|banner|lamp`; as demais caem no visual padrão até o world desenhá-las.

**Compra pelo carrinho (Fase 3):** `checkoutCart` cobra tudo de uma vez (tudo ou nada); produtos viram caixas FECHADAS na calçada, móveis vão para `state.furnitureStock` e são montados em 1ª pessoa com `placeFromStock` (sem cobrar de novo); `storeFurniture` desmonta de volta para o estoque (alternativa a vender). Venda de móvel devolve 50% (do preço da variante, no caso de decoração). **Níveis (Fase 4):** cada nível de prateleira/geladeira/freezer tem produto (etiqueta) e quantidade próprios (`Furniture.levels`, fonte da verdade; `state.shelf`/`state.slots` são derivados). Nível vazio (sem etiqueta, ou etiqueta com 0 un.) aceita qualquer produto de categoria aceita; com unidades, só o mesmo produto; caixa vazia puxa as unidades de volta (`pullUnitsFromLevel`) para reorganizar. Móvel novo nasce com níveis sem etiqueta; vender/desmontar devolve as unidades ao depósito (se couber) ou em caixas na calçada. **Início (Fase 3/4):** balcão em (8,6) + 2 prateleiras em z=2 (feijão em x=1 e macarrão em x=4, os 4 níveis etiquetados: 48 e 64 unidades); a fileira tem lugar para mais 2 prateleiras (x=7 e x=10). Regras de colocação: dentro do salão (rack só no depósito; decor em qualquer um), sem colisão, antessala 2×2 da porta livre, passagem de 2 tiles do depósito livre (x = porta−1..porta, z = −1 e 0), e todo móvel (exceto decor) precisa de um vizinho livre alcançável a partir da porta (móveis que já estavam inalcançáveis antes da compra não bloqueiam compras novas). Como a porta muda de lugar a cada expansão, `buyExpansion` realoca para o ponto válido mais próximo qualquer móvel que caia na nova antessala/passagem (`relocateBlocking`).

### 4.2 Loja

| Item | Valor |
|---|---|
| Dinheiro inicial | **R$ 250** (QA de economia: dá para 3 caixas dos produtos mais baratos — 2 de feijão R$ 72 + 1 de macarrão R$ 70, sobram R$ 36; a 4ª não cabe) |
| Aluguel | cheio = R$ 80 + R$ 40 por expansão; **grátis até o nível 3 e o dia 5**; começa no nível 4 OU no dia 6 (o que vier primeiro) com rampa de 3 passos: 1/3 → 2/3 → integral (nível 6 ou dia 8). `state.rent` = aluguel que será cobrado no fechamento de hoje (recalculado em `closeDay`, `buyExpansion`, recomeço e migração) |
| Expansão 1 / 2 / 3 / 4 / 5 / 6 | R$ 800 (nív. 3) / R$ 2.000 (nív. 5) / R$ 4.500 (nív. 6) / R$ 10.000 (nív. 7) / R$ 55.000 (nív. 15) / R$ 140.000 (nív. 28) (pós-teste 3) — salão 12×10 → 16×12 → 20×14 → 24×16 → 28×18 → 32×20 → 36×22 (`core/layout.MAX_EXPANSION = 6`) |
| Depósito | R$ 1.200 (nív. 5; pós-teste 3); 6 caixas base + 8 por estante |
| Clientes simultâneos (`customerCapacity`) | 6 + 2 por expansão (+4 com a melhoria "Capacidade de clientes"): 6 → 18 (22 com a melhoria). O npc pode limitar mais por desempenho |
| Calçada | máx. 48 caixas (todas as caixas físicas, também as largadas no salão/depósito); `dropBox` aceita salão, vão da porta, calçada (até 14 m para os lados da fachada) e depósito/passagem desbloqueados, a 0,15 m das paredes |
| Personalização | renomear grátis (≤24 letras); cada cor alterada R$ 10; paleta de jogo novo: paredes azul-claro `#bfe1f2`, piso de madeira `#c48a55`, letreiro vermelho `#d8342c` (saves mantêm a escolha do jogador) |
| Empréstimo | limite = R$ 400 × nível (nív. 1: R$ 400; nív. 30: R$ 12.000); juros de 0,4% do saldo por dia (múltiplo de R$ 0,05, arredondado para cima), cobrados em `closeDay` e somados a `fixed`/`netProfit` (campo `DayReport.interest`) |
| Falência | `isBankrupt`: caixa < 0 e rombo > crédito disponível + 50% do custo do estoque. `restartAfterBankruptcy`: mantém nível/XP/licenças/melhorias/decoração/nome/histórico; zera dívida, estoque, funcionários, expansões, depósito, móveis por montar e volta ao layout inicial; caixa R$ 300 |
| Melhorias (compra única) | Pote de gorjeta R$ 150 (nív. 2; gorjetas ×1,5, teto 12%) · Capacidade de clientes R$ 600 (nív. 4; +4 clientes simultâneos) · Carrinho de carga R$ 1.500 (nív. 6; `carryCapacity` 1 → 3 caixas) (pós-teste 3) |
| Pedido automático | `setAutoOrder(produto, {minUnits, boxes})`: `runAutoOrders` compra `boxes` caixas quando prateleira+depósito+calçada < `minUnits`, só com dinheiro (tudo ou nada) e calçada com espaço; `buyMissing(fillRatio)` enche as prateleiras com caixas inteiras, comprando o que o caixa permitir (mais populares primeiro) |
| Histórico | `state.history` guarda 30 `DayReport`; `state.stats` guarda unidades/receita/lucro por produto dos últimos 30 dias (`topProducts(state, dias)`). Save com 45+ dias de bot ≈ 30 KB |
| Sujeira | máx. 12 manchas; > 3 manchas tiram 0,06 de satisfação por mancha (máx. 0,5) |

### 4.3 Funcionários (nível 1→5; custo para chegar ao nível / nível do jogador / salário diário / segundos por ação)

| Papel | Custos | Nível exigido | Salário/dia | Segundos |
|---|---|---|---|---|
| Caixa | 250 · 450 · 800 · 1.400 · 2.300 | **4** · 8 · 12 · 16 · 20 | 100 · 130 · 170 · 220 · 280 | 10 · 8 · 6,5 · 5 · 4 |
| Limpador (janitor) | 200 · 350 · 600 · 1.000 · 1.600 | **6** · 9 · 13 · 17 · 21 | 80 · 100 · 130 · 170 · 220 | 9 · 7 · 5,5 · 4,5 · 3,5 |
| Repositor | 300 · 500 · 850 · 1.400 · 2.200 | **8** · 11 · 14 · 18 · 22 | 110 · 140 · 180 · 230 · 290 | 7 · 5,5 · 4,5 · 3,5 · 2,5 |

Capacidade de checkout/dia = 45 (jogador) + `40·(1+0,25·(nível_caixa−1))` (caixa contratado) + 20 por caixa registradora extra.

### 4.4 Clientes, preço e vendas

- Chegadas/dia = `(22 + 4·min(nível,30)) · (1 + 0,4·(1 − razão_preço_média)) · (0,6 + 0,1·reputação) · (1 + 0,12·expansão) · (0,9..1,1)`.
- Compra (Fase 4, mais tolerante): `P = 1 / (1 + e^(k·(r − 1,30)))`, `k = 10` abaixo de 1,30 e `13` acima, `r = preço/mercado`: r=0,8 → 99%; 1,0 → 95%; 1,1 → 88%; 1,15 → 82%; 1,2 → 73%; 1,3 → 50%; 1,4 → 21%; 1,5 → 7%; 1,6 → 2%. **Preço sugerido = média de mercado** (×1,00; antes +12%).
- Cesta: 1 a min(produtos expostos, 3+⌊nível/3⌋, 7) produtos distintos (sorteio ponderado por popularidade), quantidade 1 (45%), 2 (36%) ou 3 (19%).
- Gorjeta = até 8% do total (12% com o pote de gorjeta) × `speed` × `(satisfação−2)/3`. Reputação: média móvel com peso 0,04 por cliente (atendido ou perdido).
- **Felizes/irritados (Fase 3):** venda com satisfação ≥ 3 conta feliz (`ledger.happy`); venda com satisfação < 3 e cliente perdido/desistente contam irritado (`ledger.angry`); felizes + irritados = atendidos + perdidos = total do resumo do dia.
- **Resumo do dia:** rendimento = receita + gorjetas (`DayReport.income`); despesa = COGS + aluguel + salários + juros (`expenses`); lucro = `netProfit` = rendimento − despesa. Compras de estoque aparecem à parte (`purchases`, `cashDelta`).
- **Troco (Fase 3):** o cliente paga em dinheiro arredondando o total para cima até um múltiplo de R$ 10, 20, 50 ou 100 (R$ 100 só acima de R$ 25), nunca mais que um passo acima — o troco é sempre < R$ 100 e a gaveta precisa só de 10 denominações (`DRAWER_DENOMS`: R$ 50, 20, 10, 5, 2 e moedas R$ 1; 0,50; 0,25; 0,10; 0,05). O guloso é ótimo com elas (teste contra programação dinâmica).
- COGS pelo custo médio ponderado; lucro líquido = receita + gorjeta − COGS − aluguel − salários − juros.

### 4.5 Resultado do balanceamento (bot: repõe 4×/dia, investe, 3 sementes, média de 30 dias, começando com R$ 250) — Fase 4 (níveis, curva nova, ajustes do QA de economia)

| Preço vs. mercado | Lucro/dia | Atendidos/dia | Perdidos/dia | Reputação | Nível no dia 30 |
|---|---|---|---|---|---|
| ×0,8 | R$ 331 | 48 | 7 | 4,49 | 13 |
| ×0,9 | R$ 1.193 | 68 | 2 | 4,46 | 17 |
| ×1,0 (sugerido) | R$ 1.746 | 71 | 2 | 4,43 | 17 |
| **×1,1** | **R$ 2.016** | 67 | 2 | 4,44 | 16 |
| ×1,15 | R$ 1.857 | 61 | 3 | 4,25 | 15 |
| ×1,2 | R$ 1.543 | 53 | 4 | 3,95 | 14 |
| ×1,3 | R$ 624 | 29 | 7 | 2,34 | 9 |
| ×1,6 | −R$ 58 | 0 | 16 | 2,04 | 1 |

Leitura: o ótimo do bot fica em +10%; o preço sugerido (mercado) rende ~87% do ótimo com a reputação mais alta; +15% ainda rende ~92%; +20% ~77%; +30% ~31%; +60% quebra a loja (quase ninguém compra, prejuízo assim que o aluguel começa). Com ritmo humano (docs/qa/economy.md §2.4) o ótimo sobe para ~×1,2 e o sugerido rende ~60–65% dele. Preço abaixo do mercado perde margem sem ganhar volume proporcional (checkout e prateleira limitam). O bot nunca fica com caixa negativo nos primeiros 20 dias (×1,0 a ×1,25, reposição 2× ou 4×/dia). O bot padrão cobra ×1,1 (`defaultBotOptions`).

Linha do tempo do bot (×1,1; sementes 3/11/29, ±2 dias entre elas): dia 1 compra 2 caixas de feijão + 1 de macarrão (sobram R$ 36), vende ~24 clientes, lucra ~R$ 190 e sobe para o **nível 2**; nível 3 no dia 2; pote de gorjeta dia 4; prateleiras de arroz e café nos dias 5 e 6–7; bebidas + geladeira no dia 8; laticínios dia 10–12; expansão 1 dia 10–13; caixa contratado dia 11–12; padaria dia 15–16; expansão 2 dia 17–18; limpeza dia 21; expansão 3, capacidade de clientes e depósito dias 25–26; repositor dias 27–45; congelados dia 30–31; hortifrúti dia 36–37; expansão 4 dia 43–44; carrinho de carga dia 44–46; higiene dia 52–53; açougue e frios dia 62–63; expansão 5 dia 74–76; **nível 30 nos dias 82–83** (antes da Fase 4: 95–98; prateleiras com 4 níveis e clientes mais tolerantes aceleram); eletrônicos dia 88; expansão 6 dia 109.

| Dia | Nível | Chegadas | Atendidos | Felizes/irritados | Receita | Despesas fixas | Lucro/dia | Caixa |
|---|---|---|---|---|---|---|---|---|
| 1 | 2 | 24 | 22 | 22/2 | R$ 464 | R$ 0 | R$ 195 | R$ 163 |
| 2 | 3 | 28 | 28 | 28/0 | R$ 542 | R$ 0 | R$ 231 | R$ 191 |
| 3 | 3 | 36 | 34 | 34/2 | R$ 623 | R$ 0 | R$ 269 | R$ 456 |
| 5 | 4 | 35 | 34 | 34/1 | R$ 1.883 | R$ 27 | R$ 779 | R$ 468 |
| 10 | 7 | 47 | 45 | 45/2 | R$ 2.971 | R$ 80 | R$ 1.149 | R$ 1.878 |
| 20 | 12 | 87 | 83 | 83/4 | R$ 6.556 | R$ 290 | R$ 2.530 | R$ 10.769 |
| 30 | 16 | 107 | 104 | 104/3 | R$ 8.882 | R$ 530 | R$ 3.265 | R$ 17.885 |
| 50 | 22 | 162 | 158 | 158/4 | R$ 12.420 | R$ 630 | R$ 5.106 | R$ 29.135 |
| 70 | 27 | 186 | 184 | 184/2 | R$ 15.579 | R$ 630 | R$ 6.562 | R$ 55.488 |
| 90 | 31 | 221 | 216 | 210/11 | R$ 23.823 | R$ 670 | R$ 10.470 | R$ 33.674 |
| 120 | 36 | 231 | 224 | 207/24 | R$ 23.129 | R$ 710 | R$ 10.042 | R$ 119.635 |

(semente 11, bot ×1,1, Fase 4.) O lucro cresce com nível e expansão, mas é limitado pelo checkout (45 + caixa + registradoras) e pela chegada (nível ≤ 30 conta). `tests/balance.test.ts` valida: R$ 250 compram só 3 caixas, dia 1 lucra sem aluguel e chega ao nível 2, 2ª licença/expansão 1/caixa contratado nas janelas acima, nenhum caixa negativo no começo, preço justo lucrativo e abusivo no prejuízo, lucro limitado por nível, nível 30 entre os dias 75 e 120 com sempre algo a comprar, estado válido por 120 dias. Limitação do modelo: repositor/limpador poupam tempo do jogador e a capacidade de clientes simultâneos só limita o npc em tempo real; o bot não modela esses dois efeitos.

### 4.6 Catálogo de produtos (custo atacado / markup / caixa / unid. por slot / popularidade)

Existentes: arroz 22,00 · feijão 6,00 · macarrão 3,50 · café 13,00 (mercearia) · refrigerante 5,50 · água 1,80 (bebidas) · leite 4,00 · queijo 11,00 (laticínios) · pão 3,00 (padaria) · detergente 1,80 (limpeza) · sorvete 14,00 (congelados). Todos têm `color` e `shape` (`box|bottle|can|bag|tray|jar`).

| Categoria | Produtos (id: atacado R$ × markup, caixa, slot, pop.) |
|---|---|
| Hortifrúti (prateleira ou geladeira) | banana 4,50×1,7 (10/12/5) · tomate 5,00×1,7 (10/10/4) · batata 4,00×1,6 (12/12/4) · alface 2,00×1,9 (12/12/3) · maca 7,00×1,6 (10/10/3) |
| Higiene e Beleza (prateleira) | sabonete 2,50×1,8 (24/20/4) · papelhig 12,00×1,5 (8/8/5) · cremedental 3,50×1,7 (24/16/4) · shampoo 9,00×1,6 (12/10/3) · desodorante 8,00×1,7 (12/10/3) |
| Açougue e Frios (geladeira) | carne 18,00×1,4 (8/8/4) · frango 13,00×1,45 (8/8/4) · linguica 11,00×1,5 (10/10/3) · presunto 9,00×1,5 (10/10/4) · mortadela 5,00×1,7 (12/12/3) |
| Eletrônicos e Utilidades (prateleira) | pilha 9,00×1,8 (20/16/3) · lampada 7,00×1,8 (20/16/3) · fone 35,00×1,6 (8/6/2) · carregador 45,00×1,6 (8/6/2) · ventilador 120,00×1,35 (2/4/1) |

## 5. Arquitetura

```
src/sim/      núcleo puro em TypeScript (sem DOM, sem Phaser): determinístico por seed, testável
src/game/     (próximo) Phaser 4: cenas, sprites, UI, input; chama src/sim
tests/        Vitest: troco, mercado, economia, save
```

- **Persistência:** `save.ts` usa um `KV` injetável (localStorage hoje, Capacitor Preferences no Android). Save versionado (`version: 1`), com mesclagem sobre `newGame` para campos novos e `null` em caso de corrupção.
- **Determinismo:** o RNG é derivado de `seed` e `day`, então os bugs do balanceamento são reproduzíveis.
- **Android:** Phaser rodando no navegador, empacotado com Capacitor.

## 6. Roadmap

1. ✅ Núcleo de simulação, regras de móveis/expansão/funcionários, bot e testes de balanceamento.
2. Cena Phaser: loja top-down, HUD (dinheiro, hora, nível), tablet de compras e precificação.
3. Clientes andando e fila, depois o minigame de checkout (bipar, troco, cartão).
4. Relatório de fim de dia, autosave, funcionários.
5. Expansão, depósito, móveis e personalização.
6. Capacitor/Android, e depois avaliar a camada 3D.
