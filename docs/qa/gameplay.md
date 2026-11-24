# QA de jogabilidade — teste jogando como um jogador

Data: 24/11/2026. Build próprio (`npx vite build --outDir <scratchpad>/qa-play/dist`, `vite preview --port 5211`),
Chromium + SwiftShader, toque real via CDP (joystick, deslizar para olhar, botões, painéis), paisagem 844×390 e 740×360.
Ganchos (`__game`, `__player`, `__npc`, `__world`) só para acelerar o tempo, mirar com precisão e montar casos extremos.
Nenhum código do jogo foi alterado.

## Resumo
- O primeiro dia se joga do começo ao fim só com toques: computador → comprar 2 caixas (R$ 142 de R$ 150) → pegar na
  ENTREGAS → abrir → repor níveis diferentes da mesma prateleira com feijão e macarrão → fechar → largar com a prévia →
  arremessar a vazia na caçamba → preço → placa → sentar → bipar → troco/cartão → noite → Terminar o dia → resumo →
  Continue jogando → dia 2 (persistido no recarregar). Missões e setas guiam bem; nenhum erro de console.
- **2 bugs de severidade alta**, ambos silenciosos: (1) painel de pagamento aberto por mais de ~90 s de jogo → o OK
  correto é ignorado e a venda não entra; (2) clique fantasma: tocar em "Preço" na prateleira do macarrão sobe o preço
  do Café em R$ 0,50 sem o jogador ver.
- **3 médios**: prateleira montada no lugar da cadeira do caixa; recarregar/fechar o app com clientes na loja apaga as
  unidades das cestas; "Vender" móvel com estoque age num toque, sem confirmação.
- Vários baixos de legibilidade/toque (selo do nível por cima da missão, seta de objetivo no meio da tela, toque duplo
  na placa).
- Scripts que **falham enquanto o bug existir** (todos rodados agora: saem com código 1):
  `tests/e2e/qa-play-pay-timeout.mjs`, `qa-play-ghost-click.mjs`, `qa-play-operator-tile.mjs`,
  `qa-play-reload-stock.mjs`, `qa-play-badge-overlap.mjs`.
  Uso: `npx vite build && (npx vite preview --port 5211 &) && node tests/e2e/qa-play-<nome>.mjs` (`QA_URL` configurável).

## Bugs (prioridade)
| # | Sev. | Bug | Passos para reproduzir | Esperado × obtido | Módulo suspeito | Script / print |
|---|---|---|---|---|---|---|
| 1 | **Alta** | Painel de pagamento aberto > ~90 s: cliente reestende o pagamento por trás do painel e o OK é ignorado | Sentar no caixa, bipar, tocar no dinheiro/cartão; deixar o painel aberto ~1,5 min (iniciante lento, olhando menus); digitar o valor/troco certo e OK | Esperado: venda concluída. Obtido: painel fecha como se tivesse dado certo, mas sem `checkout:done`, sem dinheiro; o cliente continua com o cartão/notas estendidos e é preciso tocar e fazer tudo de novo. A missão "3 compras" conta a venda que não aconteceu (escuta `checkoutResult`) | npc `src/npc/checkout.ts` fase `paying`: `pendingT > 90` volta para `pay` sem avisar a UI; `onResult` sai quando `phase !== 'paying'`. ui `pay.ts` não sabe do reenvio; `missions.ts` conta `checkoutResult` | `qa-play-pay-timeout.mjs` · P1 |
| 2 | **Alta** | Clique fantasma ao abrir o tablet pelo botão de ação | 844×390, sem caixa na mão, mirar a prateleira do macarrão (qualquer nível) e dar um toque curto em "Preço" | Esperado: só abrir Preços. Obtido: o `click` do mesmo toque cai no "+0,50" do Café (2/2 tentativas; preço vira "definido por você", R$ 18,05). Em 740×360 cai na área de preço do Feijão/Café sem botão (sorte); "Usar computador" cai no total do carrinho (sorte). Com fonte grande ou outro layout pode acertar Comprar/±preço | player `controls` (botão age no `pointerdown` e o tablet abre embaixo do dedo) + ui tablet (não engole o `click` que segue a abertura; `dom.tapOn` só protege os próprios botões) | `qa-play-ghost-click.mjs` · P2 |
| 3 | Média | Móvel pode ser montado nos tiles do operador (onde fica a cadeira do caixa) | Comprar prateleira → COLOCAR mirando o chão atrás do balcão (x 8–10, z 5–6 no layout inicial) | Esperado: prévia vermelha. Obtido: válido; a cadeira some (`__world.chairs()` = []); mirando o balcão ainda dá "Sentar no caixa", mas a câmera fica dentro da prateleira e tampa a bancada | sim `canPlace` (`keepTiles` não inclui o operador; a alcançabilidade passa porque o balcão tem vizinhos livres) · world (cadeira/assento) | `qa-play-operator-tile.mjs` · P3, P4 |
| 4 | Média | Recarregar (ou o Android matar o app) com a loja aberta apaga as unidades nas cestas/esteira | Loja aberta, clientes pegam produtos, recarregar a página | Esperado: unidades voltam às prateleiras/depósito (como em Terminar o dia, que devolve). Obtido: 109 + 3 nas cestas → 109 + 0; sem venda. Relacionado: o relógio não é salvo — recarregar no meio do dia volta para 08:00 (preparação) do mesmo dia mantendo o caixa do dia (horas extras de graça) | npc/sim: save no `pagehide` sem `returnToShelf` das cestas; clientes e relógio não persistem (`main.ts`, `sim/save.ts`) | `qa-play-reload-stock.mjs` |
| 5 | Média | "Vender" móvel com estoque age num toque, sem confirmação (perde 50%) | Mirar prateleira com produtos → Mover → VENDER (fica entre Girar e Guardar no estoque) | Esperado: confirmação ("Vender por R$ 150? 5 un. voltam em caixa na entrega"). Obtido: vende na hora; as unidades viram caixa fechada na ENTREGAS e o aviso só diz "Prateleira vendida por R$ 150,00" (o mesmo com "Guardar": não diz para onde foram os produtos) | world barra de edição (`build.ts`) + ui (aviso) | — |
| 6 | Baixa | Selo do nível cobre o cartão de missão | Repor qualquer nível (o selo "Macarrão 500g 2/16 · caixa: 18" aparece no topo) | Sobreposição de 1.705 px² (844×390) e 2.457 px² (740×360): cobre o ícone e o começo do texto da missão | player `controls.badge` (posição) / ui `.mcard` | `qa-play-badge-overlap.mjs` · P5 |
| 7 | Baixa | Seta verde "da borda" aparece no meio-baixo da tela, em cima da caixa na mão | Com o objetivo atrás do jogador (ex.: missão da placa enquanto repõe no fundo da loja) | Esperado: na borda (de preferência lateral, indicando para que lado virar). Obtido: no centro-baixo (~y 298 de 390): o retângulo útil tem só ±103 px na vertical e o alvo atrás é projetado para baixo | ui `src/ui/guide.ts` `placeEdge` | P6 |
| 8 | Baixa | Toque duplo na placa abre e já pergunta "Fechar a loja agora?" | Loja fechada, dois toques rápidos no botão "Abrir loja" | O 1º abre, o 2º pede para fechar (botões no `pointerdown`). Falta um intervalo curto (~0,5 s) após alternar | player `signAct` / ui `store:sign` | P7 |
| 9 | Baixa | Toque curto no 3D (itens da esteira, dinheiro/cartão) exige dedo-baixo→cima < 380 ms | Toque "apertado" ou aparelho lento | Medido no SwiftShader: 220–310 ms para toques de 50–60 ms (frames lentos somam); uma vez o toque no dinheiro não registrou (o mesmo ponto via `__player.tap` funcionou). Criança/aparelho fraco pode ter toques ignorados | player `src/player/input.ts` (`quick`) | — |
| 10 | Baixa | Ao esvaziar a caixa segurando "Repor", o rótulo vira "Retirar" na hora | Segurar Repor até a caixa zerar, soltar e tocar de novo por reflexo | Puxa de volta as unidades que acabou de repor. Sugestão: exigir soltar + segurar ~0,3 s, ou mostrar "Caixa vazia" por 1 s antes de oferecer Retirar | player `displayAct` | — |
| 11 | Baixa | HUD sem resposta durante o pagamento | Painel de troco aberto: tocar engrenagem/dinheiro | Nada acontece e não há retorno (não dá para pausar no meio do troco). Ao menos um "toque ignorado" visual, ou permitir a pausa | ui `hud.ts` | P8 |
| 12 | Baixa | Prévia de largar caixa vazia diz "Caixa fechada · Macarrão 500g" | Largar uma caixa vazia fechada | Não informa que está vazia (útil para decidir onde largar/jogar fora) | world `build.ts` (texto da barra) | — |

## Ações inusitadas testadas (sem bug)
- Arremessar caixa **cheia** na caçamba: rótulo "Só caixa vazia"; cai ao lado com aviso claro. Vazia: descartada.
- Arremessar na **rua** (cai na calçada), na **parede** a 1 m, no **teto**, **contra a prateleira**: sempre pousa em ponto
  válido e dá para pegar de novo.
- **Largar** em cima de outra caixa (empilha), mirando o balcão (vai para o chão atrás), no vão da porta (aceito pela
  regra `canDropBox`). Girar e COLOCAR funcionam.
- **Dois dedos** em Arremessar + Largar: só arremessa, sem caixa duplicada. Toques repetidos em "Pegar": não passa da capacidade ("Mãos cheias").
- **Sentar com caixa**: "Largue a caixa" (desabilitado). **Pegar caixa sentado**: o toque na caixa do chão não faz nada.
- **Tablet carregando caixa** (atalho do carrinho): abre/fecha e a caixa continua na mão.
- **Retirar** com caixa vazia de outro produto: a caixa vira do produto do nível; em nível de outro produto com unidades
  → "Outro produto"; em nível vazio → "Repor". Geladeira recusa feijão e prateleira recusa refrigerante ("Não cabe aqui").
- **Comprar sem dinheiro**: Comprar desabilitado com "Faltam R$ 122,00". **Carrinho com móvel + produtos**: compra
  única, tablet fecha, entra em montagem, caixa na entrega.
- **Mover** prateleira com estoque: níveis preservados. **Guardar**: vai para "Para montar" (produtos em caixa na entrega).
- **Durante o pagamento**: girar para retrato (aviso + relógio pausado, volta intacto); nível subir no meio (a comemoração
  espera o painel fechar); troco errado ("Troco incompleto") e cartão errado ("Valor diferente do total") avisam sem
  fechar; desfazer, C, vírgula (2ª vírgula ignorada, máx. 2 casas) e ⌫ funcionam.
- **Sair do caixa com cliente esperando**: itens deixam de ser tocáveis, a paciência corre; ao voltar, tudo tocável de novo.
- **Abrir/fechar a loja**: fechar pede confirmação; à noite a placa não tem ação. **Terminar o dia com 6 clientes**:
  confirmação explica que vão embora sem comprar; as unidades das cestas voltam às prateleiras.
- **Recarregar** carregando caixa, sentado, montando móvel do estoque e na prévia de caixa: nada se perde (caixas caem
  perto do ponto inicial; móvel volta para "Para montar"). Só o caso com clientes na loja perde estoque (bug 4).

## Fluidez
- Resposta dos botões: imediata (agem no `pointerdown`). Segurar "Repor" coloca ~1 un./0,12 s, com selo n/capacidade.
- Desempenho: 16–22 fps no SwiftShader em qualidade baixa (sem GPU; não representa o celular). Sem travadas além disso;
  abrir o tablet levou ~1 s no SwiftShader.
- Câmera: ~0,58 rad (33°) por 100 px em 844×390 (0,63 em 740×360): meia-volta pede 2 deslizes na metade direita;
  há ajuste em Opções. Joystick fixo e confortável; colisão sem "grudar" na parede.
- Legibilidade: textos sem corte nas telas do jogo; tablet em tela inteira sem rolagem externa (só as listas internas
  rolam). Problemas: bugs 6 e 7. A seta 3D amarela às vezes encosta no selo do dia quando o alvo está alto e perto.
- Clareza para iniciante: boa — missão + gerente + seta 3D + rótulo do botão sempre dizem o próximo passo.

## Sugestões de jogabilidade
1. Regra geral contra clique fantasma: qualquer painel aberto por um `pointerdown` ignora `click`/toques até o próximo
   `pointerdown` (ou 350 ms). Resolve o bug 2 e protege Comprar/preços em qualquer layout.
2. Pagamento: enquanto o painel estiver aberto o cliente não reestende; se a paciência acabar, fechar o painel com aviso
   ("O cliente cansou de esperar") em vez de trocar o estado por trás.
3. Reservar o tile do operador (e a frente da esteira) no `canPlace`; confirmar VENDER; dizer onde foram os produtos.
4. Salvar devolvendo as cestas às prateleiras no `pagehide` e salvar a hora do dia (ou recomeçar o dia de forma explícita).
5. Primeiro minuto: na tela inicial o balcão oferece "Sentar no caixa" e "Mover" antes de haver produto; esconder "Mover"
   do balcão durante o tutorial evita que o iniciante tire o caixa do lugar.
6. Fechar a loja cedo não tem volta naquele dia: dizer isso no diálogo ("não dá para reabrir hoje").
7. Seta de objetivo atrás do jogador: mostrar na lateral (esquerda/direita) apontando para onde virar.
8. Selo do nível: posicionar abaixo da mira ou à esquerda, fora da área do cartão de missão.

## Prints
Pasta: `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/` (temporária).
- P1 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/A1-panel-and-cash-again.png` — maquininha aberta e o cliente estendendo o cartão de novo atrás dela.
- P2 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/15-prices.png` — Café "Preço definido por você" (R$ 18,05) sem o jogador tocar nele.
- P3 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/F1-shelf-on-operator.png` — prévia válida atrás do balcão.
- P4 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/F1-sit-after-blocked.png` — sentado com a câmera dentro da prateleira.
- P5 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/G-740-badge.png` — selo do nível sobre a missão (740×360).
- P6 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/13-aim-level3.png` — seta verde no meio-baixo, sobre a caixa.
- P7 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/C1-double-tap-sign.png` — "Fechar a loja agora?" logo após abrir.
- P8 `/tmp/claude-0/-home-user-DevGustavoGitHub/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/scratchpad/qa-play/26-gear-during-pay.png` — engrenagem sem efeito com o troco aberto.
- Fluxo bom (referência): `02-hud-start.png`, `07-delivery-box.png`, `11-drop-preview.png`, `21-belt-items.png`,
  `23-change-panel.png`, `24-change-wrong.png`, `C3-summary.png` (mesma pasta).
