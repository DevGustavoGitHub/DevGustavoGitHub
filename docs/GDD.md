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
| Minigames manuais (bipar, troco, cartão) | A 100+ clientes/dia viram tarefa repetitiva. | Funcionários são a **válvula de ritmo**. Início: jogador atende ~45 clientes/dia. Cada nível de caixa soma +25% de capacidade. |
| Mundo 3D | Maior custo de assets, câmera e performance, sem ganho de mecânica. | **2D top-down/UI primeiro** (Phaser 4). A simulação é desacoplada, então Three.js depois reaproveita 100% da lógica. |

## 2. Core loop (implementado em `src/sim`)

1. **Compra:** o catálogo mostra atacado do dia. O multiplicador por produto segue um random walk com reversão à média, limitado a [0,75; 1,35]. As caixas chegam à calçada na hora.
2. **Reposição:** `putOnShelf` move unidades das caixas para a prateleira, limitado por `slots × slotCapacity`. Caixa vazia vai para a lixeira.
3. **Precificação:** o preço médio de mercado absorve **metade** do choque de atacado. Dia caro aperta a margem, dia barato a alarga.
4. **Demanda:** `P(compra) = 1 / (1 + e^(8·(r − 1,2)))`, com `r = preço / média`.
   r = 0,8 → 96%, r = 1,0 → 83%, r = 1,2 → 50%, r = 1,5 → 8%.
   O fluxo de clientes também sobe com preço baixo e com reputação.
5. **Checkout:** bipar itens, troco em dinheiro (`isChangeCorrect`) e valor digitado no cartão (`isCardAmountCorrect`). Gorjeta de 3% se a satisfação for ≥ 4.
6. **Fechamento:** `endDay` cobra despesas fixas, gera o `DayReport` e avança o mercado.

## 3. Progressão

- **XP:** por venda: 1 por unidade + 2 por cliente + bônus de velocidade (até 0,5 por unidade). Nível n exige `130·(n−1)^1,8 · (1 + 0,05·max(0, n−15))` XP acumulado: igual à curva original até o nível 15 (n=5: 1.585, n=10: 6.900, n=15: 15.000) e mais íngreme depois (n=20: 32.600, n=25: 59.500, n=30: 97.600), para o nível ~30 chegar por volta do dia 95 com o bot.
- **Licenças** (nível mínimo / custo): Mercearia 1 / grátis · Bebidas 3 / R$ 1.500 · Laticínios 5 / R$ 4.000 · Padaria 7 / R$ 8.000 · Limpeza 9 / R$ 12.000 · Congelados 11 / R$ 20.000 · **Hortifrúti 13 / R$ 25.000 · Higiene e Beleza 16 / R$ 35.000 · Açougue e Frios 20 / R$ 55.000 · Eletrônicos e Utilidades 25 / R$ 90.000**.
- **Móveis, expansão, depósito, funcionários, melhorias e personalização:** implementados em `src/sim/furniture.ts`, `api.ts` e `tuning.ts` (tabelas abaixo).
- **Marcos de desbloqueio** (nenhuma lacuna maior que 3 níveis até o 28; `tests/phase2.test.ts` valida): 3 depósito/bebidas/geladeira/caixa · 4 expansão 1 · 5 laticínios/repositor · 6 carrinho de carga · 7 padaria · 8 expansão 2 · 9 limpeza · 10 freezer · 11 congelados · 13 hortifrúti/expansão 3 · 16 higiene · 19 expansão 4 · 20 açougue e frios · 24 expansão 5 · 25 eletrônicos · 26 estátua · 29 expansão 6.

## 4. Números do jogo (balanceamento v1, bot `src/sim/bot.ts`, validado em `tests/balance.test.ts`)

Todos os números ficam em `src/sim/tuning.ts` (+ `furniture.ts`, `catalog.ts`, `demand.ts`). Dinheiro em R$.

### 4.1 Móveis (footprint em tiles; `slots`: shelf/fridge/freezer = slots de produto × `slotCapacity` do produto; rack = caixas)

| Móvel | Custo | Nível | Slots | Categorias | Footprint |
|---|---|---|---|---|---|
| Prateleira | 350 | 1 | 2 | mercearia, limpeza, padaria, hortifrúti, higiene, eletrônicos | 2×1 |
| Geladeira | 900 | 3 | 3 | bebidas, laticínios, hortifrúti, açougue e frios | 2×1 |
| Freezer | 1.800 | 10 | 3 | congelados | 2×1 |
| Caixa registradora | 1.200 | 3 | – | – | 2×2 |
| Estante do depósito | 600 | 3 | 8 caixas | – | 2×1 |
| Decoração | 80 (base) | 1 | – | – | 1×1 |

**Decoração** (`decorCatalog()`; o id vai como 5º argumento de `buyFurniture`, vira `Furniture.variant`): planta R$ 80 (nív. 1) · faixa R$ 80 (1) · cartaz R$ 100 (5) · tapete R$ 150 (6) · luminária R$ 120 (4) · árvore R$ 200 (8) · fonte R$ 600 (18) · estátua R$ 1.200 (26). O world reconhece `plant|tree|banner|lamp`; as demais caem no visual padrão até o world desenhá-las.

Venda de móvel devolve 50% (do preço da variante, no caso de decoração). Início: 1 caixa em (8,6) + 4 prateleiras em z=2 (arroz, feijão, macarrão, café) = 16/24/32/20 unidades de capacidade. Regras de colocação: dentro do salão (rack só no depósito; decor em qualquer um), sem colisão, antessala 2×2 da porta livre, passagem de 2 tiles do depósito livre (x = porta−1..porta, z = −1 e 0), e todo móvel (exceto decor) precisa de um vizinho livre alcançável a partir da porta (móveis que já estavam inalcançáveis antes da compra não bloqueiam compras novas). Como a porta muda de lugar a cada expansão, `buyExpansion` realoca para o ponto válido mais próximo qualquer móvel que caia na nova antessala/passagem (`relocateBlocking`).

### 4.2 Loja

| Item | Valor |
|---|---|
| Dinheiro inicial / aluguel | R$ 5.000 / R$ 120 por dia (+R$ 50 por expansão) |
| Expansão 1 / 2 / 3 / 4 / 5 / 6 | R$ 4.500 (nív. 4) / R$ 16.000 (nív. 8) / R$ 35.000 (nív. 13) / R$ 70.000 (nív. 19) / R$ 140.000 (nív. 24) / R$ 260.000 (nív. 29) — salão 12×10 → 16×12 → 20×14 → 24×16 → 28×18 → 32×20 → 36×22 (`core/layout.MAX_EXPANSION = 6`) |
| Depósito | R$ 4.000 (nív. 3); 6 caixas base + 8 por estante |
| Calçada | máx. 48 caixas |
| Personalização | renomear grátis (≤24 letras); cada cor alterada R$ 10 |
| Empréstimo | limite = R$ 1.000 + R$ 1.200 × nível (nív. 1: R$ 2.200; nív. 30: R$ 37.000); juros de 0,4% do saldo por dia (múltiplo de R$ 0,05, arredondado para cima), cobrados em `closeDay` e somados a `fixed`/`netProfit` (campo `DayReport.interest`) |
| Falência | `isBankrupt`: caixa < 0 e rombo > crédito disponível + 50% do custo do estoque. `restartAfterBankruptcy`: mantém nível/XP/licenças/melhorias/decoração/nome/histórico; zera dívida, estoque, funcionários, expansões, depósito e volta ao layout inicial; caixa R$ 3.000 |
| Carrinho de carga (dolly) | R$ 6.000, nível 6; `carryCapacity` 1 → 3 caixas |
| Pedido automático | `setAutoOrder(produto, {minUnits, boxes})`: `runAutoOrders` compra `boxes` caixas quando prateleira+depósito+calçada < `minUnits`, só com dinheiro (tudo ou nada) e calçada com espaço; `buyMissing(fillRatio)` enche as prateleiras com caixas inteiras, comprando o que o caixa permitir (mais populares primeiro) |
| Histórico | `state.history` guarda 30 `DayReport`; `state.stats` guarda unidades/receita/lucro por produto dos últimos 30 dias (`topProducts(state, dias)`). Save com 45+ dias de bot ≈ 30 KB |
| Sujeira | máx. 12 manchas; > 3 manchas tiram 0,06 de satisfação por mancha (máx. 0,5) |

### 4.3 Funcionários (nível 1→5; custo para chegar ao nível / nível do jogador / salário diário / segundos por ação)

| Papel | Custos | Nível exigido | Salário/dia | Segundos |
|---|---|---|---|---|
| Caixa | 250 · 450 · 800 · 1.400 · 2.300 | 4 · 7 · 11 · 15 · 20 | 120 · 150 · 190 · 240 · 300 | 10 · 8 · 6,5 · 5 · 4 |
| Repositor | 180 · 350 · 650 · 1.100 · 1.800 | 5 · 8 · 12 · 16 · 21 | 100 · 130 · 170 · 220 · 280 | 7 · 5,5 · 4,5 · 3,5 · 2,5 |
| Faxineiro | 120 · 220 · 400 · 700 · 1.200 | 3 · 6 · 10 · 14 · 19 | 80 · 100 · 130 · 170 · 220 | 9 · 7 · 5,5 · 4,5 · 3,5 |

Capacidade de checkout/dia = 45 (jogador) + `40·(1+0,25·(nível_caixa−1))` (caixa contratado) + 20 por caixa registradora extra.

### 4.4 Clientes, preço e vendas

- Chegadas/dia = `(22 + 4·min(nível,30)) · (1 + 0,4·(1 − razão_preço_média)) · (0,6 + 0,1·reputação) · (1 + 0,12·expansão) · (0,9..1,1)`.
- Compra: `P = 1 / (1 + e^(8·(r − 1,25)))`, `r = preço/mercado`: r=1,0 → 88%; 1,1 → 77%; 1,15 → 69%; 1,25 → 50%; 1,5 → 12%; 1,6 → 6%.
- Cesta: 1 a min(produtos expostos, 4+⌊nível/3⌋) produtos distintos (sorteio ponderado por popularidade), quantidade 1 (45%), 2 (36%) ou 3 (19%).
- Gorjeta = até 8% do total × `speed` × `(satisfação−2)/3`. Reputação: média móvel com peso 0,04 por cliente (atendido ou perdido).
- COGS pelo custo médio ponderado; lucro líquido = receita + gorjeta − COGS − aluguel − salários.

### 4.5 Resultado do balanceamento (bot: repõe 4×/dia, investe, 3 sementes, média de 30 dias)

| Preço vs. mercado | Lucro/dia | Atendidos/dia | Perdidos/dia | Reputação | Nível no dia 30 |
|---|---|---|---|---|---|
| ×0,8 | R$ 460 | 67 | 2 | 4,42 | 16 |
| ×0,9 | R$ 1.007 | 68 | 1 | 4,43 | 17 |
| ×1,0 | R$ 1.314 | 63 | 2 | 4,32 | 16 |
| **×1,1** | **R$ 1.313** | 56 | 3 | 4,42 | 15 |
| ×1,15 | R$ 1.124 | 49 | 4 | 4,22 | 13 |
| ×1,2 | R$ 807 | 40 | 5 | 3,47 | 11 |
| ×1,3 | R$ 355 | 23 | 9 | 2,34 | 7 |
| ×1,6 | −R$ 67 | 2 | 15 | 1,79 | 2 |

Leitura: o ótimo fica entre mercado e +10% (volume compensa a margem); +15% ainda rende ~85%; +30% rende ~27%; +60% quebra a loja (prejuízo e reputação no chão). Preço abaixo do mercado perde margem sem ganhar volume proporcional (checkout e prateleira limitam).

Linha do tempo do bot (semente 11; as outras ficam ±3 dias): nível 2 no fim do dia 1; bebidas no dia 4; expansão 1 no dia ~10; caixa contratado ~dia 15; depósito logo após laticínios; expansão 2 ~dia 26; repositor ~dia 20-30; carrinho de carga ~dia 35-40; expansão 3 ~dia 55; hortifrúti ~dia 60; higiene ~dia 70; açougue e frios ~dia 85; expansão 4 ~dia 95; nível 30 por volta do dia 95; eletrônicos ~dia 110. O bot usa depósito (repõe a prateleira do depósito antes de comprar e abastece 2 caixas quando o atacado está < 0,9), repositor e carrinho de carga.

| Dia | Nível | Chegadas | Atendidos | Lucro/dia |
|---|---|---|---|---|
| 1 | 2 | 23 | 21 | R$ 471 |
| 10 | 5 | 47 | 42 | R$ 978 |
| 30 | 14 | 77 | 75 | R$ 1.905 |
| 50 | 20 | 132 | 127 | R$ 3.295 |
| 70 | 25 | 166 | 162 | R$ 4.134 |
| 90 | 29 | 183 | 174 | R$ 5.118 |
| 120 | 35 | 207 | 191 | R$ 6.225 |

O lucro cresce com nível e expansão, mas é limitado pelo checkout (45 + caixa + registradoras) e pela chegada (nível ≤ 30 conta). Depois do dia ~120 ainda restam as expansões 5 e 6 (R$ 400 mil somados) e a licença de eletrônicos como metas; `tests/balance.test.ts` valida 120 dias (nível 30 entre os dias 75 e 120, sempre há algo a comprar até lá, estado válido). Limitação do modelo: repositor/faxineiro poupam tempo do jogador, não mudam a regra de venda.

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
