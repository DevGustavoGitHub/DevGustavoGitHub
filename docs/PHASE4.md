# Fase 4 — Ajustes do teste no celular + APK

Origem: teste do usuário no celular (versão 3 do artefato). Sem anúncios, sem energia; arte original.

## Pontos levantados pelo usuário → decisão
| # | Ponto | Decisão |
|---|---|---|
| 1 | Artefato não fica em tela cheia; barra de rolagem em algumas telas (maquininha) | **APK Android (Capacitor)** em tela cheia imersiva; e corrigir layouts para nunca rolar nas telas do jogo |
| 2 | Cada prateleira da estante deve aceitar um produto diferente (compatível) | **Níveis independentes** por móvel (`Furniture.levels`), cada um com produto e quantidade |
| 3 | Bug: repor feijão na prateleira do macarrão duplicou o produto nas duas e travou | Causa: estoque somado por produto + um produto por móvel. Resolvido pelo modelo de níveis |
| 4 | Com caixa vazia, segurar "Repor" puxa os produtos do nível para a caixa (para reorganizar) | Ação **Retirar** (segurar) → `pullUnitsFromLevel` |
| 5 | Tela do Mercado não abre tanto quanto poderia | Tablet ocupa a tela inteira no celular (paisagem baixa); revalidar no APK |
| 6 | Forçar paisagem e travar; virar para o outro lado horizontal ao girar | APK: `sensorLandscape`. Navegador: tela cheia + `screen.orientation.lock('landscape')` quando suportado; aviso "gire o celular" como reserva |
| 7 | Preço sugerido: clientes acham caro | Sugerido era mercado **+12%**. Passa a ser a **média de mercado**; curva de aceitação mais tolerante perto de 1,0 |
| 8 | Toque em botão às vezes ignorado enquanto usa o joystick | Botões agem no `pointerdown` (não `click`), multitoque independente |
| 9 | Sensibilidade da câmera nas configurações | Controle deslizante em Opções (`lookSensitivity`) |

## Pendências anteriores incluídas
- Atualizar os e2e antigos que esperam o fluxo das Fases 1–2: `fullday` (agora Terminar o dia → resumo → Continue jogando, e persistência do save ao recarregar), `ui-phase2`, `phone-fit`.
- Itens da esteira às vezes se sobrepõem; cartão pequeno visto da cadeira; teclas de 44 px em 740×360.

## Equipe (agentes em paralelo) — protocolo em docs/CONTRACTS.md, seção "Fase 4"
| Agente | Entrega |
|---|---|
| sim | Modelo de níveis (+ migração de saves), API Fase 4, derivados `shelf`/`slots`, preço sugerido = mercado, curva de demanda, bot/testes |
| world | Desenho por nível (produtos e etiqueta de preço por nível), `levelAt`, destaque do nível mirado |
| player | Repor/Retirar por nível, botões no `pointerdown` + multitoque, sensibilidade, tentativa de travar paisagem no navegador |
| npc | Clientes compram por nível (`locateProduct` → `takeFromLevel`), esteira sem sobreposição, cartão maior |
| ui | Sensibilidade em Opções, preço sugerido, telas sem rolagem e tablet em tela cheia no celular, e2e antigos atualizados |
| apk | Capacitor + Android nativo (tela cheia imersiva, sensorLandscape, tela ligada), `npm run apk`, workflow de CI, APK de depuração para o usuário |
