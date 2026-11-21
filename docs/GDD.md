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

- **XP:** por venda: 1 por unidade + 2 por cliente + bônus de velocidade (até 0,5 por unidade). Nível n exige `130·(n−1)^1,8` XP acumulado (n=2: 130, n=5: 1.585, n=10: 6.900, n=20: 26.500).
- **Licenças** (nível mínimo / custo): Mercearia 1 / grátis · Bebidas 3 / R$ 1.500 · Laticínios 5 / R$ 4.000 · Padaria 7 / R$ 8.000 · Limpeza 9 / R$ 12.000 · Congelados 11 / R$ 20.000.
- **Móveis, expansão, depósito, funcionários e personalização:** implementados em `src/sim/furniture.ts`, `api.ts` e `tuning.ts` (tabelas abaixo).

## 4. Números do jogo (balanceamento v1, bot `src/sim/bot.ts`, validado em `tests/balance.test.ts`)

Todos os números ficam em `src/sim/tuning.ts` (+ `furniture.ts`, `catalog.ts`, `demand.ts`). Dinheiro em R$.

### 4.1 Móveis (footprint em tiles; `slots`: shelf/fridge/freezer = slots de produto × `slotCapacity` do produto; rack = caixas)

| Móvel | Custo | Nível | Slots | Categorias | Footprint |
|---|---|---|---|---|---|
| Prateleira | 350 | 1 | 2 | mercearia, limpeza, padaria | 2×1 |
| Geladeira | 900 | 3 | 3 | bebidas, laticínios | 2×1 |
| Freezer | 1.800 | 10 | 3 | congelados | 2×1 |
| Caixa registradora | 1.200 | 3 | – | – | 2×2 |
| Estante do depósito | 600 | 3 | 8 caixas | – | 2×1 |
| Decoração | 80 | 1 | – | – | 1×1 |

Venda de móvel devolve 50%. Início: 1 caixa em (8,6) + 4 prateleiras em z=2 (arroz, feijão, macarrão, café) = 16/24/32/20 unidades de capacidade. Regras de colocação: dentro do salão (rack só no depósito; decor em qualquer um), sem colisão, antessala 2×2 da porta livre, passagem de 2 tiles do depósito livre (x = porta−1..porta, z = −1 e 0), e todo móvel (exceto decor) precisa de um vizinho livre alcançável a partir da porta.

### 4.2 Loja

| Item | Valor |
|---|---|
| Dinheiro inicial / aluguel | R$ 5.000 / R$ 120 por dia (+R$ 50 por expansão) |
| Expansão 1 / 2 / 3 / 4 | R$ 4.500 (nív. 4) / R$ 16.000 (nív. 8) / R$ 35.000 (nív. 13) / R$ 70.000 (nív. 19) — salão 12×10 → 16×12 → 20×14 → 24×16 → 28×18 |
| Depósito | R$ 4.000 (nív. 3); 6 caixas base + 8 por estante |
| Calçada | máx. 48 caixas |
| Personalização | renomear grátis (≤24 letras); cada cor alterada R$ 10 |
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
| ×0,8 | R$ 469 | 67 | 2 | 4,41 | 17 |
| ×0,9 | R$ 1.020 | 67 | 2 | 4,05 | 17 |
| ×1,0 | R$ 1.377 | 64 | 2 | 4,31 | 17 |
| **×1,1** | **R$ 1.412** | 57 | 3 | 4,38 | 15 |
| ×1,15 | R$ 1.191 | 50 | 4 | 4,22 | 13 |
| ×1,2 | R$ 859 | 40 | 5 | 3,52 | 11 |
| ×1,3 | R$ 387 | 23 | 9 | 2,34 | 7 |
| ×1,6 | −R$ 67 | 2 | 15 | 1,79 | 2 |

Leitura: o ótimo fica entre mercado e +10% (volume compensa a margem); +15% ainda rende ~85%; +30% rende ~27%; +60% quebra a loja (prejuízo e reputação no chão). Preço abaixo do mercado perde margem sem ganhar volume proporcional (checkout e prateleira limitam).

Linha do tempo do bot (semente 11; as outras ficam ±1 dia): nível 2 no fim do dia 1; licença de bebidas no dia 4 (nível 3 no dia 3); expansão 1 no dia 10; caixa contratado ~dia 11; laticínios ~dia 14; expansão 2 ~dia 26; expansão 3 ~dia 48; expansão 4 ~dia 70.

| Dia | Nível | Chegadas | Atendidos | Lucro/dia |
|---|---|---|---|---|
| 1 | 2 | 23 | 21 | R$ 471 |
| 10 | 5 | 47 | 42 | R$ 978 |
| 20 | 10 | 68 | 63 | R$ 1.462 |
| 30 | 14 | 87 | 84 | R$ 2.277 |
| 60 | 28 | 191 | 179 | R$ 4.707 |
| 80 | 38 | 216 | 206 | R$ 6.876 |

O lucro cresce com nível e expansão, mas é limitado pelo checkout (45 + caixa + registradoras) e pela chegada (nível ≤ 30). Depois do dia ~70 não há mais o que comprar (caixa acumula): conteúdo de fim de jogo é trabalho futuro. Limitações do modelo: o bot não usa depósito/repositor/faxineiro (estes poupam tempo do jogador, não mudam regra de venda).

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
