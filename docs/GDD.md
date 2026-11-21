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

- **XP:** 1 por unidade vendida. Nível n exige `120·(n−1)^1,7` XP acumulado.
- **Licenças:** por categoria, com nível mínimo e custo (mercearia grátis → congelados R$ 20.000).
- **Funcionários:** caixa, repositor e faxineiro, com salário diário que cresce com o nível.
- **A implementar:** expansão de metragem, depósito (`storage` já existe no estado), móveis, personalização.

## 4. Resultado do balanceamento preliminar

Bot que só repõe 1×/dia, 30 dias, semente 11. **Não são valores finais.**

| Preço vs. mercado | Lucro/dia | Atendidos/dia | Perdidos/dia | Reputação |
|---|---|---|---|---|
| ×0,9 | R$ 52 | 18 | 24 | 2,26 |
| ×1,0 | R$ 177 | 20 | 19 | 2,41 |
| **×1,15** | **R$ 353** | 22 | 10 | 2,83 |
| ×1,3 | R$ 188 | 13 | 6 | 1,77 |
| ×1,6 | −R$ 162 | 1 | 9 | 1,30 |

Leitura:
- **Existe ponto ótimo interior** (~+15%) e abusar de preço dá prejuízo. A mecânica de precificação funciona.
- Preço baixo rende menos porque a loja inicial é **limitada por prateleira**: os perdidos são sobretudo ruptura de estoque. O bot não repõe durante o dia, e o jogador real vai repor. Isso **subestima** a lucratividade e a reputação.
- A reputação cai demais com ruptura. Revisar o peso da ruptura em `simulateOpenDay`.
- O bot nunca compra móveis nem funcionários, então o nível 7 não é representativo.

**Próximo passo de balanceamento:** bot que repõe a cada N minutos e investe em slots e funcionários. Depois ajustar os parâmetros (8; 1,2), o fluxo base `18 + 5·nível` e o aluguel.

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

1. ✅ Núcleo de simulação e testes.
2. Cena Phaser: loja top-down, HUD (dinheiro, hora, nível), tablet de compras e precificação.
3. Clientes andando e fila, depois o minigame de checkout (bipar, troco, cartão).
4. Relatório de fim de dia, autosave, funcionários.
5. Expansão, depósito, móveis e personalização.
6. Capacitor/Android, e depois avaliar a camada 3D.
