# Revisão de qualidade (QA) — resumo

Feita enquanto você estava fora (24/11). Três testadores independentes, depois correções pelos donos de cada módulo.
Relatórios completos: [gameplay.md](gameplay.md) (jogabilidade com toques reais), [systems.md](systems.md)
(save, consistência, desempenho, ciclo de vida do app) e [economy.md](economy.md) (equilíbrio e dificuldade).

## Bugs encontrados e situação
| Gravidade | Problema | Situação |
|---|---|---|
| Alta | Venda perdida: com o painel de troco aberto por ~90 s, o OK era ignorado mas a missão contava a venda | Corrigido (cliente espera o painel; cancelamento fecha o painel com aviso) |
| Alta | Toque fantasma: tocar em "Preço" abria o tablet e o mesmo toque mudava o preço de outro produto | Corrigido (ações que abrem painel disparam ao soltar o dedo; o painel ignora o toque que o abriu) |
| Alta | Minimizar o app no Android não salvava | Corrigido (salva ao ficar oculto e no evento de pausa do Android) |
| Alta | Hora do dia não era salva: recarregar voltava às 08:00 e repetia os clientes do dia | Corrigido (hora salva; agenda de clientes retoma do minuto salvo) |
| Alta | Save incompatível travava a abertura do jogo para sempre | Corrigido (save é saneado; se ainda falhar, guarda cópia e recomeça, com aviso) |
| Média | Produtos nas cestas/esteira dos clientes sumiam ao recarregar | Corrigido (voltam ao estoque ao carregar) |
| Média | Dava para montar móvel em cima da cadeira do caixa | Corrigido (lugar do operador reservado) |
| Média | "Vender" móvel em um toque, sem dizer para onde iam os produtos | Corrigido (confirmação com valor e destino) |
| Média | Comprar o depósito podia ficar com a passagem bloqueada | Corrigido (móveis são realocados) |
| Média | Botão voltar do Android saía do jogo sem confirmar | Corrigido (fecha painel → pausa → "Sair do jogo?") |
| Média | Save ilegível era descartado em silêncio | Corrigido (cópia guardada + aviso) |
| Baixa | Selo do nível cobria a missão; seta de objetivo no meio da tela com alvo atrás; toque duplo na placa abria e fechava; toque longo na esteira ignorado; pedido automático falhava sem avisar | Corrigidos |
| — | Um funcionário caixa por balcão (proposta do QA de economia) | **Pendente** (hoje continua 1 caixa contratado) |

## Equilíbrio (economia)
- **Dinheiro inicial: R$ 150 → R$ 250.** Com R$ 150 um iniciante terminava o dia 1 sem dinheiro para comprar uma caixa
  no dia 2. R$ 250 compra 3 caixas baratas; R$ 300 já deixava o começo fácil demais.
- **Aluguel começa mais tarde** (nível 4 ou dia 6) e o **primeiro empréstimo é menor** (R$ 400), para não pular o início.
- **Paciência dos clientes 50–75 s** enquanto você atende sozinho (antes de contratar o caixa).
- **Preço sugerido continua = média de mercado** (como você pediu). Dica nova no jogo: até ~10% acima do mercado quase
  ninguém reclama e o lucro sobe.
- Um jogador sozinho no caixa atende ~23 clientes/dia (iniciante) a ~36 (experiente); por isso o ritmo foi ajustado.

## Desempenho
- Mundo 3D: ~0,05 ms por quadro (antes 0,11–0,28). Mira do jogador mais barata e sem alocações. Clientes: removida
  uma troca de shader a cada quadro (~0,6 ms com 10 clientes) e animação reduzida para quem está longe.
- O desenho da cena custa ~1,6 ms de CPU por quadro num computador. **A fluidez real só dá para medir no seu celular.**

## O que testar no celular
1. Instalar o APK novo por cima do anterior (o save é mantido).
2. Minimizar e voltar ao app no meio do dia; fechar e reabrir — deve voltar na mesma hora, com o estoque certo.
3. Botão/gesto voltar do Android em cada tela.
4. Pagamento demorado no troco (sem pressa) — a venda deve entrar.
5. Fluidez com a loja cheia (se cair abaixo de 30 fps o jogo reduz a qualidade sozinho e avisa).
