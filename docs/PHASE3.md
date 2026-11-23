# Fase 3 — Gráfico e jogabilidade mais próximos do jogo de referência

Status: **em desenvolvimento** (usuário respondeu as dúvidas e mandou 22 prints de referência).
Regra de arte: tudo continua **original e procedural**. Copiamos estilo, layout e fluxo, nunca logotipos, marcas,
nomes de produtos, personagens nem texturas do jogo de referência. Mantemos todas as nossas funções
(banco, pedido automático, gráficos, clientes especiais, acessibilidade) e a moeda R$.

## Prints de referência (para os agentes abrirem com Read; NÃO copiar arte)
Pasta: `/root/.claude/uploads/2ed9bbe2-646e-5ae5-8953-b3786c4c1f1e/`
| Arquivo | Mostra |
|---|---|
| `c5c9752b-image.jpg` | Rua em 1ª pessoa segurando caixote aberto; HUD; botões ação/arremessar; área de entrega; depósito ao lado |
| `855d6fc6-image.jpg` | Mercado: produtos com preço, −/+, Adicionar, carrinho à direita, unidades/caixa e ícone do móvel exigido |
| `7cfb6f04-image.jpg` | Mercado: aba de móveis (simples/duplo) |
| `c8bfc497-image.jpg` | Upgrades: licenças por nível da loja |
| `5e3f92c5-image.jpg` | Upgrades: seções (expansões) por nível |
| `98eb997c-image.jpg` | Funcionários: caixa/limpador/repositor, salário diário, 2 atributos com 5 níveis, nível de liberação |
| `1bbbd62c-image.jpg` | Serviços: descartar caixas vazias, capacidade de clientes, depósito, personalização |
| `803d80e7-image.jpg` | Interior em 1ª pessoa: caixa com contorno verde, notebook num balcão, seta de objetivo |
| `50f3d74d-image.jpg` | Interior: fruteira com seta amarela, prateleira, porta do depósito com fita, mira no centro |
| `43423c16-image.jpg` | Sentado no caixa: monitor "TOTAL", maquininha, esteira, botão laranja "Sair do caixa", missão 0/3 |
| `d7a25583-image.jpg` | Itens na esteira com contorno verde; mão do tutorial indicando tocar |
| `8b9fda5e-image.jpg` | Monitor lista o item e total; cliente estende leque de notas (contorno verde) |
| `da4d1656-image.jpg` | Painel "Dê o troco" à direita (5 notas + 5 moedas, desfazer/OK/C); monitor: recebido/total/troco/dando |
| `a6c1096e-image.jpg` | Cliente estende cartão (contorno verde); etiqueta de preço "--" na prateleira vazia |
| `73ee9783-image.jpg` | Painel da maquininha à direita (1–9, apagar, 0, decimal, OK, C); monitor "pagamento no cartão" |
| `ba67155f-image.jpg` | Na rua segurando caixa vazia; botões extras de caixa (largar/arremessar) |
| `46aa48fb-image.jpg` | Prévia ciano da caixa no chão + barra ⟲ COLOCAR ⟳ e CANCELAR |
| `b0554b92-image.jpg`, `bb48c542-image.jpg`, `9b96e09b-image.jpg` | Tela de subida de nível: gerente comemorando, "Agora disponível", Continue jogando |
| `a1300d0b-image.jpg` | 21:00: aviso "Nenhum cliente novo virá à noite", botão "Terminar o dia", placa FECHADO, atalho do carrinho junto ao joystick |
| `d808ed98-image.jpg` | Resumo do dia: total/irritados/felizes, rendimento, despesa, lucro, Continue jogando |

## Decisões (usuário)
| Tema | Decisão |
|---|---|
| Câmera | **Primeira pessoa**, carregando caixas nas mãos; sem pular |
| Botões | Ação à direita, arremessar caixa |
| Dinheiro inicial | Pouco: dá para comprar 1–2 produtos |
| Caixa | Sentar na cadeira para atender; **bipar tocando nos produtos na esteira em 3D**; troco e maquininha em painel |
| Esfregão | **Não é item**: mirar na sujeira, tocar em "Limpar", animação curta esfregando |
| Móveis | **Posicionar em 1ª pessoa** (prévia verde/vermelha onde se olha, girar, colocar) |
| Gestão | **Computador no balcão + botão pequeno** (atalho de carrinho ao lado do joystick, como no original) |
| Escopo | Manter nossas funções; mudar principalmente gráfico e jogabilidade |
| Caixas | **Abrir a caixa (animação), repor, fechar de novo e colocar onde quiser** |
| Móveis | **Comprar prateleiras, geladeiras e freezers** e abastecer com os produtos respectivos |

## Decisões (minhas, justificadas)
- Só 1ª pessoa (sem alternância). Mira central + contorno verde no alvo; botão de ação mostra o rótulo da ação.
- Abrir/fechar a loja tocando na **placa da porta** (ABERTO/FECHADO). Às 21:00: aviso de noite e botão **"Terminar o dia"**; o relatório só abre quando o jogador toca (dá para repor/limpar à noite). Fallback no menu de pausa.
- Resumo do dia no estilo do original (clientes total/irritados/felizes, rendimento, despesa, lucro) + nossos detalhes expansíveis.
- Tela de comemoração de nível com o gerente (personagem original desenhado em SVG) e "Agora disponível".
- Missões do tutorial no canto (ícone, barra de progresso 0/3, gerente), seta 3D amarela sobre o alvo e seta na borda da tela.
- Mercado com **carrinho** (produtos e móveis); móveis comprados vão para um **estoque de montagem** e entram no modo de posicionamento em 1ª pessoa.
- Gaveta de troco com **5 notas (R$ 2, 5, 10, 20, 50) e 5 moedas (5c, 10c, 25c, 50c, R$ 1)**: como o cliente paga com no máximo R$ 100 acima do arredondamento, o troco nunca exige R$ 100/200. Sem moeda de 1c (preços em múltiplos de R$ 0,05).
- Maquininha com tecla decimal (vírgula), como no original.
- Etiquetas de preço nas prateleiras ("--" quando vazia).
- Dinheiro inicial ~R$ 150; **aluguel só começa mais tarde**; liberações por nível alinhadas ao original (caixa no 4, limpador no 6, repositor no 8, depósito no 5, capacidade de clientes no 4); melhoria "pote de gorjeta" no nível 2.
- Paisagem obrigatória com aviso "gire o celular".

## Equipe (agentes em paralelo) — ver protocolo em docs/CONTRACTS.md, seção "Fase 3"
| Agente | Pasta | Entrega |
|---|---|---|
| player | src/player | Câmera/controle 1ª pessoa, mira, raycast + contorno, caixa aberta na tela (pilha com dolly), arremessar, largar com prévia, sentar no caixa + toque nos itens, esfregão animado, todos os botões de jogo |
| world | src/world | Visual claro/colorido, interior com teto, fachada, rua e props, área de entrega, placa da porta, depósito com fita, computador no balcão, cadeira, monitor e maquininha 3D, etiquetas de preço, pickGroup + highlight, posições de assento/esteira/entrega, posicionamento em 1ª pessoa |
| npc | src/npc | Clientes com visual melhor, itens na esteira, entrega de dinheiro/cartão tocáveis, fluxo de pagamento, caixa contratado sentado, eventos para monitor e missões |
| ui | src/ui | HUD estilo referência, atalho de carrinho, missões com gerente, comemoração de nível, resumo do dia, noite + Terminar o dia, mercado com carrinho e estoque de montagem, painéis de troco/maquininha, aviso de orientação |
| sim | src/sim, tests | Dinheiro inicial baixo, aluguel tardio, carrinho, estoque de móveis, dropBox, capacidade de clientes, liberações por nível, felizes/irritados, rebalanceamento com o bot |
| audio | src/audio | SFX novos (arremesso, esfregão, sentar, colocar, placa, noite, comemoração) |
