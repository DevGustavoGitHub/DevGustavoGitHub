# QA de economia e ritmo — dinheiro inicial e fluidez (dias 1–10)

Pergunta do usuário: o dinheiro inicial (R$ 150) deixa o jogo fácil ou difícil demais? E a fluidez do dia?
Método: o bot atual (`src/sim/bot.ts`) não tem relógio — atende até 45 clientes/dia "de graça" e repõe na hora. Escrevi
um **bot com ritmo humano** (`src/sim/humanBot.ts`): joga pela API pública, mas o expediente corre em **segundos reais**
com a curva de chegada, o limite de 6 clientes simultâneos, a paciência e a fila do npc, e um jogador **sozinho** que tem
de escolher entre ficar no caixa (bipar item a item, dar troco ou digitar na maquininha) e sair para repor (computador →
calçada → abrir → repor → largar a caixa vazia). Quatro arquétipos × dinheiro inicial R$ 100/150/200/250/300 × 5 sementes
× 30 dias. Sem navegador. Tempos humanos (toque, troco, viagem) são **estimativas** (tabela 1.2), não medidas no aparelho.

## Resumo

| # | Sev. | Achado | Ação |
|---|---|---|---|
| 1 | **Alta** | Com R$ 150 o iniciante fecha o **dia 1 com 43% de clientes irritados** (14,6 felizes / 11,0 irritados) e só R$ 40–80 no caixa — na pior semente nem 1 caixa para abrir o dia 2. O jogador eficiente quase não depende do dinheiro inicial. | **Aplicado:** `START_MONEY` R$ 150 → **R$ 250** |
| 2 | **Alta** (meio de jogo) | **1 operador por balcão e um só caixa contratado**: o teto real é ~45 clientes/dia com 1 balcão e ~75 com 2, mas as chegadas passam de 80 no nível 10 e 115 no nível 15. | Proposta (npc + sim + ui), §4 |
| 3 | Média | A sim supõe 45 clientes/dia no caixa manual e soma o caixa contratado mesmo com 1 balcão (45 + 40). Humano real: **~23/dia (iniciante) a ~36/dia (eficiente)**; com caixa e 1 balcão, ~37–41. | Proposta (bot/GDD), §4 |
| 4 | Média | O **banco anulava o início pobre**: R$ 600 no nível 1 a 0,4%/dia (4× o dinheiro inicial, juros de R$ 2,40/dia). O iniciante com banco lucrava 2,5× mais nos dias 1–10. | **Aplicado:** `LOAN.base` R$ 200 → **0** (nível 1: R$ 400) |
| 5 | Média | Aluguel chegava cedo para o iniciante (nível 3 no dia 3, com lucro de ~R$ 100–150/dia). | **Aplicado:** `RENT.startLevel/startDay` 3/4 → **4/6** |
| 6 | Média | Com ritmo humano o **preço ótimo é ×1,2**; o sugerido (×1,0, padrão) rende só **~60–65%** disso (o bot dizia ~83%). | Proposta (decisão do usuário), §4 |
| 7 | Média | Iniciante perde 5–8 clientes/dia **na fila** a partir do nível 3 (paciência 40–60 s × 16–18 s por cliente). | Proposta (npc): paciência 50–75 s até contratar o caixa |
| 8 | Baixa | Dia de 390 s e picos de chegada estão ok: dia mais longo ou picos mais largos não mudam o lucro **por minuto real**. | Manter |
| 9 | Baixa | Não há espiral de reputação: ela converge para a satisfação média e cada ponto muda só 10% das chegadas. O risco real era de **caixa** (capital de giro), resolvido pelo #1. | — |

Resultado com as 3 mudanças (5 sementes, 30 dias): iniciante 18,4 felizes / 7,2 irritados no dia 1, lucro dos dias 1–10
R$ 131 → **R$ 209/dia**, caixa contratado no dia 15 → **11**; eficiente igual (R$ 595 → 612/dia, limitado pelo caixa);
bot puro (GDD §4.5) com a mesma linha do tempo (nível 4 no dia 4, bebidas no dia 8, expansão 1 nos dias 10–13).

## 1. Modelo de tempo real

### 1.1 Constantes lidas do código

| Item | Valor | Fonte |
|---|---|---|
| Expediente | 780 min de jogo a 2 min/s = **390 s (6,5 min)**; chegadas até 20h30 (375 s) | `core/clock.ts`, `npc/index.ts` |
| Antes de abrir / à noite | relógio parado: **abastecer de manhã e à noite não gasta tempo** | `core/clock.ts` (`update` só com a loja aberta) |
| Chegadas/dia (rep. 3,5, preço ×1, sem expansão) | N1 24,8 · N2 28,7 · N3 32,5 · N4 36,3 · N5 40,0 · N6 44,0 · N7 47,8 · N8 51,5 | `sim/demand.ts` |
| Curva de chegada | 25% espalhados; picos aos **45 s** (09h30, 20%), **135 s** (12h30, 30%) e **300 s** (18h00, 25%), σ ≈ 22–28 s reais → no nível 3, ~7 clientes em 50 s no almoço | `npc/index.ts arrivalTimes` |
| Clientes simultâneos | 6 (+2/expansão, +4 melhoria); o excedente espera fora e **some sem contar** se a loja fechar | `npc/index.ts`, `api.customerCapacity` |
| Paciência | **40–60 s** (idoso ×1,2; criança ×0,8; atacado ×1,25), só corre na fila; fila ≥ 6 desiste | `npc/customer.ts` |
| Cesta | 2,9 unidades/cliente com 2 produtos (dias 1–2); ~4,9 com 4 produtos (nível 3+) | `api.makeShoppingList` |

### 1.2 Segundos por cliente no caixa (jogador sentado)

| Etapa | Iniciante | Eficiente | Base |
|---|---|---|---|
| Cliente chega à esteira + próximo da fila anda | 1,4 s | 1,4 s | `npc/checkout.ts` (approach) |
| Bipar n itens (esteira solta 1 item a cada 0,42 s) | 0,57 + n × 1,0 s | 0,57 + n × 0,6 s | `PLACE_EVERY`, estimativa do toque |
| Ir pagar + estender | 0,95 s | 0,95 s | `toPay`/`showPay` |
| Tocar no dinheiro/cartão | 1,5 s | 0,8 s | estimativa |
| Troco (60%; o painel já mostra o valor) | 3,0 s + 1,0 s/peça | 1,5 s + 0,6 s/peça | `ui/pay.ts` |
| Maquininha (40%; "23,45" + OK = 6 teclas) | 2,5 s + 0,8 s/tecla | 1,2 s + 0,4 s/tecla | `ui/pay.ts` |
| Erro no painel | 12% (+4 s) | 4% (+4 s) | estimativa |
| **Total medido** | **15,6 s** (2 produtos) / **18 s** (4) | **9,9 s** / **11 s** | `humanBot` |

Caixa contratado (mesmo fluxo, sem painel): nível 1 — 8,5 s (3 itens), 10,7 s (5), 11,5 s (8); nível 3 — 7,4 / 8,3 / 8,6 s;
nível 5 — 6,1 / 6,4 / 7,2 s. O tempo fixo (andar, cobrar) domina: subir o caixa de nível rende pouco.

### 1.3 Segundos por viagem de reposição (1 caixa por vez até o carrinho de carga, nível 6)

| Etapa | Iniciante | Eficiente |
|---|---|---|
| Levantar, computador (Adicionar → Comprar), ir à calçada, voltar e sentar | 25 s | 14 s |
| Por caixa: pegar, levar ~12 m (2,9 m/s carregando), abrir, repor (0,12 s/un.), largar a vazia | 22 s | 15 s |
| **1 / 2 / 3 caixas** | **47 / 69 / 91 s** | **29 / 44 / 59 s** |

Uma viagem no pico custa 1–3 desistências (a paciência é menor que a viagem).

### 1.4 O jogador sozinho dá conta? (loja cheia de manhã, 5 sementes × 2 dias)

| Nível | Chegadas | Iniciante: atendidos | desistiram na fila | não entraram | Eficiente: atendidos | desistiram | não entraram |
|---|---|---|---|---|---|---|---|
| 1 | 25,3 | 22,1 (87%) | 2,7 | 0,1 | 24,5 (97%) | 0,4 | 0 |
| 2 | 29,0 | 23,8 (82%) | 4,4 | 0,2 | 27,9 (96%) | 0,5 | 0 |
| 3 | 33,0 | 22,7 (69%) | 7,6 | 2,3 | 31,0 (94%) | 1,0 | 0,4 |
| 4 | 36,9 | 22,9 (62%) | 8,0 | 6,0 | 34,2 (93%) | 0,8 | 0,9 |
| 5 | 40,8 | 23,4 (57%) | 8,2 | 8,9 | 35,9 (88%) | 0,7 | 2,5 |
| 6 | 44,7 | 23,3 (52%) | 8,3 | 12,5 | 36,3 (81%) | 0,6 | 6,7 |

- O **iniciante satura em ~23 clientes/dia já no nível 2–3**; o eficiente em ~36/dia no nível 5–6. A fila "estoura" para o
  iniciante a partir do nível 3 (7–8 desistências/dia), para o eficiente não antes do nível 5. O caixa (nível 4) chega na
  hora certa para o eficiente e 1–2 níveis tarde para o iniciante.
- Repor **durante** o dia quase não é necessário: as 2 prateleiras iniciais guardam 112 un. e as 4 do nível 3, 184 un.,
  mais que a procura de um dia. Só falta estoque quando falta **dinheiro de manhã** — exatamente o que o R$ 150 causava.
- Ociosidade no caixa: eficiente 117 s/dia no nível 1 (32% do tempo sentado; dá para arrumar a loja), ~40 s do nível 3 em
  diante; iniciante 26–40 s em todos os níveis (dia sempre cheio).

## 2. Arquétipos (5 sementes × 30 dias; `npx vitest run tests/balance-human.test.ts --silent=false`)

| Arquétipo | Preço | Caixa | Reposição | Investimento |
|---|---|---|---|---|
| Iniciante cuidadoso | sugerido (×1,0) | 15,6–18 s/cliente; 10% do dia distraído | manhã: até 2 caixas/produto; no dia, só quando acaba (2 caixas por viagem) | só com folga (reserva do bot + R$ 100), 1 móvel/dia |
| Desperdiçador | ×1,25 | ~13 s | compra o dobro do que cabe; repõe a 20% | planta (R$ 80) no dia 1, móvel antes do estoque, licença sem móvel, caixa/expansão assim que dá |
| Eficiente | ×1,1 | 9,9–11 s | enche de manhã (`bot.restock`); repõe a 35% na calmaria | igual ao bot (`investMorning`) |
| Preguiçoso | sugerido | ~13 s | **só de manhã** (enche com o que der) | como o cuidadoso |

"+banco": pega o limite quando o caixa da manhã fica abaixo de R$ 50 (e paga quando sobra).

### 2.1 Antes × depois (padrões do jogo)

Antes = R$ 150, aluguel nível 3/dia 4, banco R$ 200 + R$ 400/nível. Depois = R$ 250, aluguel nível 4/dia 6, banco R$ 400/nível.
Dias = mediana das 5 sementes.

| Arquétipo | | Dia 1 felizes/irritados | Caixa no fim do dia 1 (pior) | Atendidos d1–3 / d1–10 | Lucro/dia d1–10 / d11–20 | Nível 4 | Caixa contratado | Bebidas | Expansão 1 | Nível d30 |
|---|---|---|---|---|---|---|---|---|---|---|
| Cuidadoso | antes | 14,6 / 11,0 | R$ 80 (40) | 63% / 68% | R$ 131 / 456 | 6 | 15 | 17 | 24 | 10,4 |
| | **depois** | **18,4 / 7,2** | **R$ 237 (183)** | 72% / 68% | **R$ 209** / 527 | 5 | **11** | **13** | 23 | 11,0 |
| Preguiçoso | antes | 13,2 / 12,4 | R$ 229 (228) | 75% / 79% | R$ 197 / 503 | 5 | 12 | 14 | 19 | 11,0 |
| | depois | 19,6 / 6,0 | R$ 334 (302) | 84% / 81% | R$ 277 / 508 | 5 | 10 | 11 | 22 | 11,0 |
| Eficiente | antes | 20,6 / 4,0 | R$ 63 (8) | 89% / 84% | R$ 595 / 1.070 | 4 | 13 | 8 | 14 | 12,4 |
| | depois | 22,0 / 2,6 | R$ 130 (5) | 88% / 83% | R$ 612 / 1.144 | 4 | 10 | 7 | 11 | 12,6 |
| Desperdiçador | antes | 11,6 / 11,4 | R$ 31 (15) | 58% / 64% | R$ 260 / 748 | 7 | 9 | 9 | 20 | 9,6 |
| | depois | 15,8 / 7,2 | R$ 139 (53) | 70% / 71% | R$ 396 / 839 | 6 | 8 | 7 | 17 | 10,0 |

Nenhuma falência em nenhum caso acima (o desperdiçador fica com caixa negativo em 9 dias "antes" e 1 dia "depois").
Banco: cuidadoso+banco lucrava R$ 327/dia nos dias 1–10 "antes" (2,5× sem banco; bebidas no dia 8, caixa no dia 6) →
R$ 230 "depois" (1,1×); eficiente+banco 1,24× → 1,14×. Bot puro (GDD §4.5, ×1,1): nível 3 dia 2, nível 4 dia 4, bebidas
dia 8 (igual); caixa 10/14/14 → 11/12/12; expansão 1 13/13/13 → 10/13/13; lucro dias 1–10 R$ 774 → 801.

### 2.2 Dinheiro inicial R$ 100 / 150 / 200 / 250 / 300 (aluguel e banco novos)

| Inicial | Cuidadoso: d1 fel./irr. · caixa fim d1 (pior) · lucro d1–10 · caixa contr. | Preguiçoso: d1 fel./irr. · lucro d1–10 | Eficiente: d1 fel./irr. · lucro d1–10 · exp. 1 | Desperdiçador: d1 fel./irr. · falências |
|---|---|---|---|---|
| R$ 100 | 14,6/11,0 · R$ 93 (32) · R$ 158 · d13 | 11,6/14,0 · R$ 161 | 17,6/7,0 · R$ 573 · d11 | 0/23 · **20** (trava: a planta deixa R$ 20 e nenhuma caixa cabe) |
| R$ 150 | 14,6/11,0 · R$ 80 (40) · R$ 183 · d12 | 13,2/12,4 · R$ 230 | 20,6/4,0 · R$ 623 · d10 | 11,6/11,4 · 0 |
| R$ 200 | 14,6/11,0 · R$ 130 (90) · R$ 196 · d12 | 13,2/12,4 · R$ 244 | 21,0/3,6 · R$ 600 · d13 | 14,0/9,0 · 0 |
| **R$ 250** | **18,4/7,2 · R$ 237 (183) · R$ 209 · d11** | **19,6/6,0 · R$ 277** | 22,0/2,6 · R$ 612 · d11 | 15,8/7,2 · 0 |
| R$ 300 | 19,4/6,2 · R$ 342 (235) · R$ 228 · d10 | 22,2/3,4 · R$ 301 | 21,2/3,4 · R$ 644 · d11 | 15,4/7,6 · 0 |

Leitura: R$ 200 ainda compra só 2 caixas (as baratas custam R$ 70 e R$ 72) e não muda o dia 1. **R$ 250 é o joelho**:
3 caixas (~70% da procura do dia 1), o iniciante sai de ~57% para ~72% de clientes felizes e abre o dia 2 com dinheiro
para estoque. Com R$ 300 (2 caixas de cada) o preguiçoso já tem 87% felizes no dia 1 — o dia 1 deixa de ter desafio.
Para o eficiente nada muda de R$ 100 a R$ 300 (R$ 573–644/dia): ele é limitado pelo caixa, não pelo dinheiro.

### 2.3 Recuperação depois de erro (regras antigas, 3 sementes; com as novas o caso ×1,6 é guardado em teste)

| Erro | Cuidadoso: lucro d1–10 · atraso | Eficiente: lucro d1–10 · atraso |
|---|---|---|
| Nenhum | R$ 142 | R$ 605 |
| Gasta todo o caixa em decoração no dia 3 | R$ 126 · +1–2 dias (caixa contratado d14–16 vs 13–15) | R$ 554 · ~0 |
| Preço ×1,6 nos dias 3–4 | R$ 72 · +2–5 dias (nível 5 no d11 vs d9; caixa d17–19 vs 13–15) | R$ 366 · +3 dias (nível 5 no d9–10 vs d6–7) |
| Dia 3 largado (sem abastecer, 70% fora do caixa) | R$ 110 · +1–3 dias | R$ 535 · +0–1 dia |

Nenhuma falência: o jogo perdoa erro isolado em 1–4 dias. Só quebra quem mantém ×1,6 (quase ninguém compra: −R$ 50/dia).

### 2.4 Preço com ritmo humano (regras novas, 3 sementes × 20 dias)

| Preço | Cuidadoso: lucro/dia · atendidos | Eficiente: lucro/dia · atendidos |
|---|---|---|
| ×1,0 (sugerido) | R$ 367 · 77% | R$ 626 · 75% |
| ×1,1 | R$ 545 · 79% | R$ 852 · 79% |
| **×1,2** | **R$ 603** · 78% | **R$ 950** · 79% |
| ×1,3 | R$ 452 · 67% | R$ 581 · 72% |
| ×1,6 | −R$ 51 · 3% | −R$ 50 · 3% |

Com o caixa humano como gargalo, vale mais margem por cliente do que conversão: o ótimo sobe de ×1,1 (bot) para ×1,2, e o
"desperdiçador" a ×1,25 não é punido (lucra mais que o cuidadoso). Quem nunca mexe no preço deixa ~40% do lucro na mesa.

### 2.5 Meio de jogo: um operador por balcão (eficiente + caixa contratado, 4 sementes)

| Nível | Expansão | Caixa (nív.) | Chegadas | Atendidos com 1 balcão | com 2 balcões |
|---|---|---|---|---|---|
| 6 | 1 | 1 | 48,8 | 41,0 (84%) | 46,0 (94%) |
| 8 | 2 | 2 | 63,8 | 47,5 (74%) | 59,8 (94%) |
| 10 | 3 | 2 | 80,0 | 45,3 (57%), 32 desistem | 69,3 (87%) |
| 12 | 4 | 3 | 98,3 | 50,5 (51%) | 75,0 (76%) |
| 15 | 4 | 3 | 115,3 | 52,8 (46%) | 76,5 (66%) |

Com 1 balcão o caixa contratado **substitui** o jogador (que vai repor); a sim soma os dois. Balcões além do 2º não têm
operador (só existe 1 caixa contratado), mas a sim dá +20 clientes/dia por balcão extra.

## 3. Mudanças aplicadas (sim)

| Constante (`src/sim/tuning.ts`) | Antes | Depois | Por quê |
|---|---|---|---|
| `START_MONEY` | R$ 150 (2 caixas) | **R$ 250** (3 caixas; a 4ª não cabe) | dia 1 do iniciante 57% → 72% felizes; caixa no fim do dia 1 R$ 40–80 → R$ 183–365; eficiente igual |
| `RENT.startLevel` / `startDay` | 3 / 4 | **4 / 6** (rampa 1/3 → 2/3 → integral até nível 6 ou dia 8) | iniciante lucra R$ 177 → 209/dia nos dias 1–10; eficiente +R$ 4/dia |
| `LOAN.base` | R$ 200 (nível 1: R$ 600) | **R$ 0** (nível 1: R$ 400; nível 30: R$ 12.000) | banco deixa de ser atalho (2,5× → 1,1× no lucro do iniciante) e ainda tira qualquer um do aperto (~5 caixas) |

Arquivos: `src/sim/tuning.ts`; comentários em `rent.ts`, `state.ts`, `economy.ts`, `bot.ts`; novo `src/sim/humanBot.ts`
(bot com ritmo humano, reutilizável); testes `tests/balance-human.test.ts` (novo: 9 guardas do início do jogo),
`tests/phase3.test.ts` (dinheiro inicial e rampa do aluguel), `tests/balance.test.ts` (início pobre = 3 caixas),
`tests/rules.test.ts` (1 linha: 4 caixas de feijão não cabem). `npx vitest run`: tudo verde exceto as 6 falhas
intencionais de `tests/qa-sys-sim.test.ts` (bugs #3/#5/#6/#9 de `docs/qa/systems.md`, de outro agente); `npx tsc --noEmit`
só acusa o mesmo arquivo (`process`/`node:fs` sem `@types/node`).

**GDD a atualizar (dono do doc):** §1 "Início: jogador atende ~45 clientes/dia" → ~23 (iniciante) a ~36 (eficiente);
§4.2 dinheiro inicial R$ 250 (3 caixas, 4 não cabem), aluguel "grátis até o nível 3 e o dia 5; começa no nível 4 OU no
dia 6; integral no nível 6 ou dia 8", empréstimo "R$ 400 × nível"; §4.5 "começando com R$ 150" e "dia 1 compra 1 caixa
de feijão + 1 de macarrão (sobram R$ 8)" → "2 de feijão + 1 de macarrão (sobram R$ 36)". PHASE3.md registra a decisão
"dinheiro inicial ~R$ 150" (pouco): R$ 250 mantém o espírito — 2 produtos, prateleiras longe de cheias.

## 4. Propostas para outros módulos (não editados)

| # | Sev. | Módulo | Proposta | Evidência |
|---|---|---|---|---|
| P1 | **Alta** (dia ~12+) | npc `checkout.ts` + sim `api`/`tuning` + ui funcionários | Permitir **1 caixa contratado por balcão** (ex.: 2º caixa no nível 10, 3º no 15) ou autoatendimento; senão o teto é ~45 clientes/dia (1 balcão) / ~75 (2) | §2.5: nível 10 → 80 chegadas, 45 atendidos com 1 balcão, 32 desistências |
| P2 | Média | sim `CHECKOUT` + bot/GDD | `CHECKOUT.manual` 45 → **35** e, com 1 balcão, capacidade = max(jogador, caixa) em vez da soma; balcão extra só soma se houver operador. Não apliquei: muda a tabela do GDD §4.5 e `rules.test.ts` fixa 45 + 20 | §1.4 (humano 23–36/dia), §2.5 |
| P3 | Média | npc `customer.ts` (paciência) | **50–75 s** (era 40–60) enquanto não há caixa contratado | iniciante: desistências na fila 5,4 → 2,9/dia, lucro +11%, reputação 3,10 → 3,25; eficiente ~igual |
| P4 | Média | sim `demand.ts` / ui preço sugerido (decisão do usuário, Fase 4) | Ou sugerido = mercado ×1,1, ou `DEMAND_CURVE.mid` 1,30 → **1,25** (aceitação 95/88/73/50% → 92/82/62/34% em ×1,0/1,1/1,2/1,3; estimativa por item, margem × aceitação: ótimo volta a ×1,1 e o sugerido rende ~85% dele), ou só uma dica "cobrar um pouco acima do mercado" | §2.4 |
| P5 | Baixa | ui missões/HUD | Depois de "Atenda mais 5 clientes": missão "abasteça antes de abrir ou à noite (o relógio fica parado)"; aviso de nível vazio; no nível 4, dica "contrate o caixa" | iniciante perdia 13 clientes "sem nada" no dia 1 com R$ 150 (prateleira vazia); o cuidadoso só contrata no dia 11 |
| P6 | Baixa | ui banco | Oferecer o empréstimo quando o caixa < caixa mais barata e as prateleiras estão vazias | desperdiçador com R$ 100 trava (20 falências em 5×30 dias) |
| P7 | Baixa | core `clock.ts` | **Manter 2 min/s (390 s)**: dia de 450 s dá +16% de lucro/dia ao iniciante mas o lucro por minuto real fica igual (R$ 27,2 → 27,5/min) | 5 sementes × 10 dias |
| P8 | Baixa | npc `index.ts` (curva) | Manter os picos: σ ×1,5 não muda nada (69% → 69% atendidos); o gargalo é a vazão do dia, não o pico | idem |

## 5. Limites do modelo

- Toque, painel e viagem são estimativas de mão humana em celular (sem medição no aparelho); a geometria da loja é fixa
  (balcão, calçada e lixeira a ~8–12 m); o cliente pega os itens no fim das compras; o jogador só sai do caixa entre um
  cliente e outro. Repositor e limpador não são modelados (liberam no nível 8 e 6).
- Reproduzir: `npx vitest run tests/balance-human.test.ts --silent=false` (tabelas de capacidade, arquétipos e preço).
  Para outros cenários, `newHumanRun(seed, HUMAN_PROFILES.x, dinheiro, { daySeconds, patience, sigma })` + `playHumanDays`.

## Ajuste de progressão (pós-teste)

Relato: o jogador chegou ao nível 3 e não conseguiu comprar nada desbloqueado. Diagnóstico com o humanBot (iniciante cuidadoso, 3 sementes): caixa no fim dos dias 1–6 ≈ R$ 130–900, mas a reserva do bot (aluguel + salários + 35% do estoque para encher as prateleiras + R$ 20) chega a R$ 450–650 no nível 3, e licença de bebidas (R$ 400) + geladeira (R$ 500) pedem R$ 900 + reserva: o cuidadoso não comprava a licença até o dia 7+ (o eficiente, só no dia 7).

| Item | Antes | Depois |
|---|---|---|
| Licença de bebidas | R$ 400 | R$ 100 |
| Geladeira | R$ 500 | R$ 150 |
| Prateleira | R$ 300 | R$ 200 |
| Pote de gorjeta | R$ 150 | R$ 100 |
| Markup feijão / macarrão | 1,45 / 1,50 | 1,55 / 1,65 |
| Dinheiro inicial | R$ 250 | R$ 250 (inalterado: 4ª caixa não cabe) |
| Cuidadoso: licença + geladeira | dia 7+ | dia 3–4 (nível 3) |
| Eficiente: licença + geladeira | dia 7 | dia 5–7 (nível 4–5) |

Alavancas usadas na ordem: custos, margem; o dinheiro inicial ficou (R$ 300 deixava comprar a 4ª caixa e quebrava o "início pobre"). `displayTypeFor` passou a usar a ordem do catálogo (prateleira antes da geladeira) em vez do mais barato, e o humanBot cuidadoso agora compra licença nova antes de mais uma prateleira de mercearia. Caixa no fim do dia 1 do cuidadoso caiu um pouco (R$ 127–304), limite do teste ajustado para R$ 120.

## Ritmo do início (pós-teste 2)

Feedback: no nível 1–2 o jogador abastece 2–3 produtos, a fila se forma, falta mercadoria e não dá tempo de atender, comprar e repor (um iniciante atende ~23 clientes/dia sozinho; chegavam 26–30).
- **Chegadas** (`demand.ts EARLY_BASE`): base 13/17/20 nos níveis 1/2/3 (≈ 12–14, 16–18, ~20 clientes/dia); do nível 4 (caixa) a curva antiga `22 + 4·nível`.
- **Cestas** (`api.makeShoppingList`): 1–3 itens nos níveis 1–2; teto sobe 1 item a cada 2 níveis a partir do 3, até o teto antigo.
- **Placa como pausa**: na fase `open` a placa alterna `clock.doorsClosed` (sem clientes novos, relógio segue; o dia só fecha às 21:00 ou em "Terminar o dia").
- **Paciência**: fila de balcão atendido (jogador sentado ou funcionário) perde paciência à metade da velocidade; quem está sendo atendido não perde.
- **Resultado** (humanBot, 5 sementes): iniciante cuidadoso perde ~1–3 clientes/dia (fila + estoque) nos níveis 1–2. Teste intencional alterado: caixa no fim do dia 1 do cuidadoso ≥ R$ 80 (era R$ 120), pois com metade dos clientes o dia 1 rende menos; nível 4 chega ~1–2 dias depois.
