# Pesquisa de mecânicas: My Supermarket Simulator 3D (Playspare)

Data da pesquisa: 2026-11-21. Escopo: clone pessoal SEM anúncios e SEM energia.
Legenda de confiança: **[confirmado]** = fonte direta sobre o jogo; **[provável]** = fonte indireta/jogo similar coerente; **[chute]** = inferência nossa, precisa de decisão de design.

## 0. Limitações da pesquisa (leia primeiro)
- Não achei wiki, guia detalhado nem Reddit sobre o jogo mobile. As fontes úteis são: ficha da App Store (descrição, "novidades", avaliações), avaliações agregadas e um post de fórum de jogador.
- Não achei a ficha do Google Play pelo nome do pacote (só App Store). Package name não confirmado por fonte.
- Os detalhes finos (números de XP, custos de licença, capacidade de prateleira, duração do dia) NÃO estão publicados. Tudo isso fica em [chute] com valores sugeridos, a serem calibrados jogando.
- O PC "Supermarket Simulator" (Nokta) e o app "Supermarket Manager Simulator" (outro título!) foram usados só como comparação. O jogo mobile parece fortemente inspirado no PC.

## 1. Fontes
- S1 App Store (descrição, versões, IAP, avaliações): https://apps.apple.com/us/app/-/id6511238101 (também https://apps.apple.com/app/id6511238101)
- S2 Avaliações agregadas: https://justuseapp.com/en/app/6511238101/my-superstore-simulator/reviews
- S3 Post de jogador sobre energia/caixa/staff: https://www.corada.com/voices/topics/1656 (a página retornou 404 no fetch direto; o conteúdo vem do resumo da busca. Trate como [provável].)
- S4 Wiki do PC (Nokta): https://bloxodes.com/wiki/supermarket-simulator
- S5 Guia PC (gameleap): https://www.gameleap.com/articles/supermarket-simulator-beginner-s-guide-tips-on-how-to-run-a-successful-supermarket
- S6 Guia de preços PC: https://gameleap.com/articles/supermarket-simulator-guide-how-to-price-items-and-maximize-profits ; https://casualgameguides.com/walkthroughs/supermarket-simulator/how-to-price-products-for-profit
- S7 Walkthrough PC (TrueAchievements, só via busca; fetch deu 403): https://www.trueachievements.com/walkthroughfull.aspx?walkthroughid=4483
- S8 Guia de OUTRO jogo mobile (Supermarket Manager Simulator): https://www.bluestacks.com/blog/game-guides/supermarket-simulator-3d-store/smms-beginners-guide-en.html
- S9 Steam do PC: https://store.steampowered.com/app/2670630

## 2. Identidade do jogo
- Nome na loja: "My Supermarket Simulator 3D" (iOS também aparece como "My Superstore Simulator" e "My Clerk Story"). Vendedor: Game District LLC; copyright Playspare 2024. Free-to-play com anúncios e compras. Nota ~4,7 com ~134 mil avaliações. [confirmado, S1]
- Visão 3D, personagem controlado pelo jogador percorrendo a loja (a ficha fala em "redesenhar interior e exterior" e em cashier/shelver/stocker/cleaner). Perspectiva exata (1ª ou 3ª pessoa) não confirmada. [chute: 3ª pessoa com câmera aérea/seguindo, joystick virtual]
- Versão mais recente vista: 2.3.1 (Seaside Shop + minigame de pesca "Captain's Catch"). [confirmado, S1] Pesca e Seaside são extras de live-ops; NÃO necessários para o clone.

## 3. Loop central
Confirmado pela descrição (S1) e avaliações (S2):
1. Pedir produtos (computador/tablet, aba de mercado).
2. Entrega: caixas chegam uma a uma, com minutos de intervalo entre elas; pedido grande demora (relatos de 1h ou mais). Energia pode pagar entrega instantânea. [confirmado, S2]
3. Carregar caixas até as prateleiras (ou ao depósito/storage room) e abastecer.
4. Definir preços.
5. Atender clientes no caixa; pagamento em dinheiro ou cartão; gorjetas por atendimento rápido. [confirmado, S1]
6. Ganhar dinheiro e XP; subir de nível; comprar licenças, expansão, móveis, funcionários.
7. Contratar e melhorar caixa, repositor (shelver/stocker) e faxineiro para automatizar. [confirmado, S1]

Comparação PC (S5): começa com US$ 50 para o primeiro pedido, itens baratos primeiro, frete por pedido (um pedido grande compensa), caixas aparecem na calçada. [confirmado para o PC, provável para o mobile]

## 4. Minigame de checkout
- Mobile: existe checkout manual, com pagamento em dinheiro ou cartão e gorjetas. Anúncios apareciam durante o checkout (reclamação comum). [confirmado, S1/S2]
- PC (S5): jogador recebe o pagamento e devolve o troco correto; para cartão, digita o total no terminal. Escanear é por produto no balcão. [confirmado no PC, provável no mobile]
- Dica de jogadores PC: arredondar preços facilita o troco (S6). [confirmado no PC]
- Projeto sugerido [chute]:
  - Itens no balcão: toque em cada item (ou arraste ao leitor) para escanear; bipe e total sobe.
  - Dinheiro: cliente entrega valor; jogador monta o troco tocando em notas/moedas (botões de denominações) e confirma. Erro = cliente reclama/perde gorjeta (ou aceita e perde a diferença).
  - Cartão: botão "digitar total" com teclado numérico no terminal, ou cobrança automática com confirmação.
  - Gorjeta proporcional à rapidez (cronômetro de paciência) e acerto.
  - Fila visível; paciência por cliente.

## 5. Preços e preço de mercado
- Mobile: o jogador define preços por produto; reclamações de que clientes pagam pouco e licenças são caras. Detalhe de "preço de mercado" no mobile não confirmado. [provável que exista, como no PC]
- PC (S4/S5/S6): cada produto mostra um preço de mercado que varia com o tempo (ao menos a cada dia). Preço acima do mercado derruba vendas e causa reclamação; abaixo atrai clientes; muito baixo leva à falência. Valores de jogadores: pouco acima do mercado (cerca de +0,10 a +0,15) gera quase nenhuma reclamação; mais que isso aumenta; relato de ~metade reclamando em +0,15 (anedótico e contraditório). [provável, anedótico]
- Outro app (S8) usa setas vermelha/verde para subida/queda do preço de mercado. [confirmado só naquele app]
- Sugestão [chute]: cliente compra se preço <= mercado * (1 + tolerância ~ 8-10%), probabilidade cai linearmente até ~25% acima. Mercado oscila ±10% por dia. Preço novo da etiqueta deve ser editável a qualquer momento (reclamação de jogadores: etiqueta some quando o produto esgota; ver seção 14).

## 6. Clientes
- Compram o que precisam, pesam produtos fresh no PC, pagam em dinheiro ou cartão, formam fila. [confirmado PC, S4]
- Preferem variedade (dois produtos diferentes a dois iguais). [confirmado PC, S5]
- Reclamam e deixam de comprar se o preço está alto. [confirmado PC, S4]
- Gorjetas no mobile. [confirmado, S1]
- Ladrões: PC tem shoplifters e opções de segurança (câmeras, sensores, guardas); walkthrough cita comprar um bastão por US$ 100 para bater no ladrão. [confirmado PC, S4/S7]. No mobile NÃO há menção em nenhuma fonte (S2 não cita). [chute: omitir ou fazer opcional na v2]
- Chegada de clientes: avaliação diz que no começo chegam rápido demais e as prateleiras esvaziam em minutos. [confirmado, S1] Ajustar a curva de chegada ao nível/estoque no clone.
- Tipos de clientes distintos (VIP, pão-duro etc.): sem fonte. [chute: só variação de paciência e tamanho de cesta]

## 7. Funcionários
- Tipos citados: caixa (cashier), shelver/stocker (repositor) e faxineiro (cleaner). [confirmado, S1]
- Existe "sistema de eficiência" do funcionário e um segundo shelver adicionado na v1.37.1; desenvolvedor diz que melhora a IA do shelver. [confirmado, S1]
- Caixas no mobile são pagos por tempo limitado e depois saem (jogadores pedem contrato mais longo). [confirmado, S2] No clone, sem expiração: salário contínuo OU compra única (decisão de design).
- Jogadores pedem: repositor atribuível a prateleiras específicas; auto-reordenação por nível mínimo de estoque. [confirmado como pedidos, S1] Bons candidatos para o clone.
- PC: contratar caixa após 200 checkouts e nível 10; caixa ganha XP; recomenda-se caixa primeiro, repositor depois. [confirmado PC, S4/S5/S8]
- Upgrades: velocidade/eficiência por nível do funcionário. [provável] Números: [chute]

## 8. Móveis, prateleiras, capacidade
- Mobile: prateleiras, "premium racks" (versão 2.1.2 corrigiu bug) e novas prateleiras (v1.37.1). Jogadores relatam não poder mover prateleiras depois de postas e dificuldade de colocar caixa na prateleira de cima do depósito. [confirmado, S1/S2]
- PC: prateleiras, geladeiras, freezers, bancas de hortifrúti; produtos frios exigem refrigeração. Capacidade por tipo de produto/tamanho de caixa. [confirmado PC, S4]
- Capacidades exatas do mobile: não publicadas. [chute] Prateleira simples: 3 níveis x 2-3 slots; cada slot comporta N unidades conforme tamanho do produto (pequeno 12, médio 8, grande 4); geladeira/freezer similar com 4 níveis.
- Categorias de produto mobile: não listadas. [chute: mercearia seca, bebidas, laticínios (refrigerado), congelados, hortifrúti, padaria, limpeza, higiene, snacks]. PC tem 186 produtos e 29 licenças. [confirmado PC, S4]

## 9. Licenças, níveis, desbloqueios
- Mobile: licenças existem ("license display" corrigido na 2.1.2) e custam caro (pagas em dinheiro e, segundo avaliações, às vezes energia). Progresso desacelera nos níveis altos. Jogadores querem mais licenças e variedade. [confirmado, S1/S2]
- PC: cada licença exige nível mínimo e dinheiro; produto comprado aparece no mercado do computador. [confirmado, S4]
- Lista exata de níveis/XP/custos do mobile: não encontrada. [chute] Curva sugerida: XP para próximo nível = 100 * nível^1.5; licenças iniciais baratas (US$ 200-500) nos níveis 1-5, subindo ~x1,6 por nível de licença.

## 10. Expansão e depósito (storage room)
- Mobile: expandir a loja, adicionar seções e usar depósito para estoque extra. [confirmado, S1]
- PC: mais área, mais prateleiras e geladeiras, pagos com lucro; manter 2-3 caixas extras de cada produto no depósito. [confirmado PC, S4]
- Avaliações: depósito reorganiza itens após o app ficar fechado; "dolly" para carregar mais caixas pedido; reabastecer pedidos grandes leva horas. [confirmado, S2/S1]
- Chute: expansões em etapas (4-5), cada uma com custo crescente e requisito de nível; depósito com prateleiras de caixas (3 níveis).

## 11. Sujeira e limpeza
- Mecânica de limpeza e faxineiro adicionada em versão posterior. [confirmado, S1]
- Detalhes (lixo no chão, caixas vazias) não descritos. [chute: clientes deixam lixo/derramamento aleatório; sujeira reduz satisfação e velocidade; caixas vazias viram lixo para jogar fora]

## 12. Decoração e personalização
- Renomear a loja e redesenhar interior e exterior; itens decorativos vêm também de Manager Pass e eventos sazonais. [confirmado, S1]
- Chute para o clone: pisos, paredes, fachada, placa, iluminação, plantas/decor; só cosmético.

## 13. Dia, UI e controles
- Duração do dia do mobile: não publicada. [chute: 5-8 min reais por dia, abertura/fechamento manual; PC permite abrir/fechar a qualquer hora e o relógio fica parado até abrir (S4)]
- UI [chute, baseado nas descrições]: HUD com dinheiro, nível/XP, hora do dia; joystick virtual + botão de ação/pegar/soltar; botão do tablet/computador; menus de móveis, licenças, equipe, personalização.
- Controles mobile: arrastar caixas (carregar, pegar e soltar em prateleira). [provável]
- Relatório de fim de dia (vendas, lucro, despesas, clientes): padrão no gênero; não confirmado no mobile. [chute]
- Contas: PC cobra aluguel e contas recorrentes (S5); empréstimos no outro app (S8). Mobile: sem menção. [chute: omitir ou opcional]

## 14. Monetização e reclamações dos jogadores (o que NÃO copiar / melhorar)
- Energia: gasta em entregas instantâneas, upgrades e licenças; não regenera sozinha; ~10 por anúncio assistido; também vendida. [confirmado, S2] Jogador relata ficar sem energia e com filas longas ao fazer tudo sozinho. [S3]
- Anúncios frequentes, às vezes cobrindo botão de fechar/pagamento; "Remover Anúncios" (US$ 4,99) com relatos de não funcionar. [confirmado, S1/S2]
- IAPs: energia, dinheiro, Starter Pack, Manager Pass (US$ 14,99). Passes sazonais. [confirmado, S1]
- Pedidos de melhoria: etiquetas que permanecem após esgotar; dolly para mais caixas; entrega proporcional ao tamanho do pedido; estoque auto; repositor por prateleira; empréstimos; mais licenças; funcionários por tempo maior. [confirmado como pedidos, S1/S2]
- Para o clone: sem energia e sem anúncios; entregas com tempo curto (ex.: 5-30 s) ou instantâneas; manter o ritmo via cooldown/curva de dificuldade em vez de energia.

## 15. Resumo de decisões em aberto (precisam de escolha do time)
1. Pagamento: dinheiro com troco montado manualmente vs. só toque de confirmação (recomendo troco manual com botões de notas).
2. Funcionários: salário contínuo vs. compra única.
3. Ladrões: omitir na v1.
4. Valores de XP/licença/expansão: usar as curvas [chute] acima e calibrar.
