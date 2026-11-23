# Fase 3 — Gráfico e jogabilidade mais próximos do jogo de referência

Status: **aguardando mais prints do usuário** (caixa bipando + pagamento dinheiro/cartão, esfregão, mover estante, abrir a loja).
Não começar a implementar antes disso. O usuário pediu: "qualquer dúvida me pergunte antes de começar".

Regra de arte: tudo continua **original e procedural**. Copiamos estilo e fluxo, não logotipos, marcas, personagens nem texturas.
Mantém todas as funções que já temos (banco, pedido automático, gráficos, clientes especiais, acessibilidade) e a moeda R$.

## O que os 9 prints do jogo de referência mostram

- **Câmera:** primeira pessoa. Mira (ponto) no centro da tela. O objeto mirado ganha **contorno verde**; o botão de ação fica verde quando há algo a fazer.
- **Carregar:** a caixa aparece **aberta**, na parte de baixo da tela (sem mãos visíveis), mostrando os produtos dentro.
- **Controles mobile:** joystick à esquerda; à direita, botão grande de **ação** (ícone de mão), botão de **arremessar** acima, botão de correr/pular abaixo (o usuário **não quer pular**).
- **HUD:** dia + hora no centro do topo (ex.: "Dia 1 / 09:00 AM"), nível (estrela) com barra de XP, energia (fora: sem energia no nosso), dinheiro, engrenagem. Nenhum botão de gestão no HUD do original.
- **Mercado (computador):** abas Produtos | Móveis, cards com preço, stepper −/+ , "Adicionar" → **carrinho** à direita (item, preço, unidades, total) → "Comprar"/"Limpar". Cada produto mostra a **quantidade por caixa (12)** e o **ícone do móvel exigido** (fruteira vs. prateleira seca). Filtro.
- **Menu lateral:** Mercado, Upgrades (Licenças | Loja/seções), Funcionários, Serviços, (outro).
- **Números de referência:** começa com **$40**; caixa de maçã $4,20, laranja $2,40, abacate $7,20, cereal $14,40, café $20. Móveis: fruteira simples $100, dupla $200, prateleira seca $200, dupla $400, expositor de vegetais $200/$400.
- **Licenças** liberadas por **nível da loja** (L3 no nível 2, L4 no nível 4...). **Seções** (expansões) nos níveis 3, 5, 6, 7...
- **Funcionários:** Caixa (nível 4, $96/dia; atributos digitalização e gorjetas), Limpador (nível 6, $80/dia; esfregão e capacidade), Repositor (nível 8, $112/dia; movimento e "meia"), 4º funcionário cortado no print. Cada um com 5 níveis por atributo e escolha de uniforme.
- **Serviços:** descartar caixas vazias (tocar), licença de capacidade da loja (nível 4: mais clientes), licença de armazenamento/depósito (nível 5), licença de personalização (nível 16).
- **Cenário:** calçada com **"área de entrega" pintada**, lixeira verde de reciclagem, porta com placa **FECHADO/ABERTO**, depósito ao lado com **porta fechada por fita** até a licença, notebook num balcão interno, caixa com monitor/teclado e **cadeira**, paredes azul-claro, piso de madeira, pegadas indicando caminho no tutorial.
- **Tutorial:** personagem "gerente" com balão de fala no canto superior direito, **seta amarela** sobre o alvo e **seta verde** na borda da tela apontando para fora da visão.

## Decisões do usuário (respostas)

| Tema | Decisão |
|---|---|
| Mover/posicionar móveis | **Em 1ª pessoa**: mirar o chão, prévia verde/vermelha do móvel onde se olha, botão girar, confirmar com ação |
| Painel de gestão | **Computador no balcão + botão pequeno na tela** |
| Bipar no caixa | **Tocar nos produtos na esteira em 3D** (1ª pessoa); troco e maquininha em painel sobreposto |
| Mais prints | Usuário vai mandar antes de começar |

## Decisões tomadas por mim (justificadas na conversa)

- Só primeira pessoa; sem pular e sem correr. Arremessar caixa (inclusive na lixeira).
- Sentar no caixa para atender; botão "Levantar".
- Esfregão é objeto: pega, mira na sujeira, usa a ação.
- Dinheiro inicial baixo (~R$ 150, dá para 1–2 caixas). **Aluguel/despesas fixas começam só mais tarde** (senão quebra no dia 1) — rebalancear com o bot.
- Mercado com carrinho; produto mostra unidades/caixa e móvel exigido.
- Paisagem obrigatória com aviso "gire o celular" em retrato.
- Visual mais claro/colorido (madeira, paredes claras, toldos, placa ABERTO/FECHADO tocável, área de entrega, depósito com fita).
- Tutorial com gerente + setas.

## Plano de trabalho (quando liberado)

Agentes em paralelo, mesmas regras de `docs/CONTRACTS.md`:
1. **player** — câmera 1ª pessoa, mira + contorno, caixa aberta na tela, arremessar, sentar no caixa, esfregão, posicionamento de móveis em 1ª pessoa.
2. **world** — paleta e cenário mais claros, área de entrega, porta ABERTO/FECHADO interativa, depósito com fita, computador no balcão, cadeira, esteira com produtos para bipar.
3. **npc** — clientes colocam itens na esteira; caixa sentado; integração com o checkout em 3D.
4. **ui** — HUD estilo referência (sem energia), mercado com carrinho, menu lateral, gerente do tutorial com setas, aviso de orientação, painel de troco/cartão sobre a cena.
5. **sim** — dinheiro inicial baixo, preços/custos de móveis na escala nova, aluguel tardio, níveis de liberação conforme a referência; rebalancear com o bot.
