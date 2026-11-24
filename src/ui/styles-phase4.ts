/**
 * Estilos da Fase 4: nenhuma tela do jogo rola no celular deitado (844×390, 800×360, 740×360, 720×330 — alturas com
 * as barras do navegador), tablet em tela inteira no celular, barras de rolagem discretas/ocultas nas listas internas,
 * alvos de toque ≥ 44 px e Opções/pausa/tela inicial compactas. Medido por tests/e2e/phone-fit.e2e.mjs.
 */
export const phase4Css = `
/* listas internas: barra fina; no toque e em telas baixas, oculta (rolagem continua) */
.mx-root *{scrollbar-width:thin;scrollbar-color:rgba(70,98,127,.45) transparent}
@media (pointer:coarse),(max-height:520px){.mx-root *{scrollbar-width:none}.mx-root ::-webkit-scrollbar{display:none}}

/* alvos de toque ≥ 44 px */
.btn.small{min-height:44px}
.switch{width:68px;height:44px}.switch::after{top:5px;left:5px;width:34px;height:34px}
.t3-x{height:44px}

/* dinheiro no cabeçalho do tablet (no celular o tablet cobre o HUD) */
.t3-cash{display:none;position:absolute;left:8px;top:50%;transform:translateY(-50%);align-items:center;gap:5px;height:34px;padding:0 10px 0 5px;border-radius:9px;
  background:rgba(29,42,60,.92);color:#fff;font-weight:900;font-size:15px;white-space:nowrap;pointer-events:none;text-shadow:none}
.t3-cash svg{width:26px;height:26px;flex:none}
.t3-cash.neg .t3-cash-v{color:#ff9a9d}

/* ---------- celular deitado ---------- */
@media (max-height:520px){
  /* tablet/computador em TELA INTEIRA (respeitando a safe-area); o HUD fica escondido atrás e os toasts por cima */
  .tb-wrap{padding:var(--sa-t) var(--sa-r) var(--sa-b) var(--sa-l);background:rgba(9,20,34,.94)}
  .tb-wrap .t3{width:100%;max-width:none}
  .mx-root.tb-open .mx-top .hud{visibility:hidden}
  .t3-cash{display:flex}
  .t3-head{height:44px;padding:0 150px}
  .t3-panel{border-radius:12px}
  .t3-rail{padding-top:48px;gap:4px}
  .rail-btn{min-height:48px}
}
@media (max-height:420px){.t3-head{height:44px}.t3-x{height:44px}.t3-rail{padding-top:48px}}

/* Opções e pausa compactas (grade de 2 colunas), tela inicial lado a lado */
@media (orientation:landscape) and (max-height:520px){
  .menu-card{padding:10px 14px;gap:6px}
  .menu-card h2{font-size:20px}
  .opt-card{width:min(800px,100%)}
  .opt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px;align-items:center}
  .opt-card .opt{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:center;gap:8px;padding:3px 0;min-height:54px}
  .opt-card .opt.inl{grid-template-columns:minmax(0,1fr)}
  .opt-card .opt small{display:none}
  .opt-card .opt .lb{font-size:14px;line-height:1.15;gap:6px}
  .opt-card .opt input[type=range]{height:44px;min-width:0}
  .opt-card .seg .btn{min-height:44px;font-size:14px;padding:0 4px}
  .opt-card .opt-back{min-height:48px}
  .menu-sub{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .menu-sub .btn{min-height:48px;padding:0 8px}
  .title-screen{flex-direction:row;gap:clamp(24px,7vw,72px)}
  .title-screen .logo .mk{width:64px;height:64px;border-radius:20px;margin-bottom:6px}
  .title-screen .menu-btns{width:min(320px,44vw)}
}
.opt-card .opt-back{margin-top:4px}
@media (orientation:landscape) and (max-height:520px){.opt-card .opt-back{margin-top:0}}

/* ---------- pagamento (troco / maquininha) sem rolagem ---------- */
.pay-info b{overflow:hidden;text-overflow:ellipsis}
@media (max-height:400px){
  .pay-speed{height:4px;flex:none}
  .pay-info{grid-template-columns:repeat(4,minmax(0,1fr))}
  .pay-info div{flex-direction:column;align-items:stretch;justify-content:center;gap:0;padding:2px 4px;font-size:9.5px;line-height:1.15;text-align:center}
  .pay-info b{font-size:13px}
  .pay-row{padding:4px;gap:4px}
  .pay-den{min-height:44px}
  .bill3{min-height:36px}
  .pay-act .pk{min-height:44px}
}
@media (max-height:380px){
  .pay-pad{grid-template-columns:repeat(5,minmax(0,1fr));grid-auto-rows:minmax(44px,1fr);gap:5px}
  .pay-pad .pk.ok{grid-column:span 2}
  .pay-pad .pk{font-size:22px}
}

/* ---------- comemoração e resumo do dia sem rolagem ---------- */
@media (max-height:520px){
  .c-foot{flex-wrap:nowrap}
  .btn-go{min-width:min(260px,38vw)}
}
@media (max-height:400px){
  .cele{gap:4px;padding-top:calc(var(--sa-t) + 4px);padding-bottom:calc(var(--sa-b) + 6px)}
  .c-emb{width:62px;height:52px;margin-bottom:-12px}
  .ribbon{padding:4px 34px 7px}.ribbon b{font-size:25px}.rib-tab{font-size:15px;padding:2px 14px 4px}
  .c-band{padding:4px 0 6px}
  .sum-stats{padding:4px 12px}.sum-stats svg{width:30px;height:30px}.sum-stats b{font-size:19px}
  .sum-money{gap:1px 10px;font-size:18px}.sum-money .bill-ic{width:26px;height:26px}.sum-money hr{margin:1px 0}
  .btn-go{min-height:48px;font-size:18px}.btn-det{min-height:46px}
}
@media (max-height:360px){.c-emb{display:none}}

/* HUD estreito (720 px): o dinheiro não encolhe (a barra de XP cede espaço) */
.money3{flex:none}
/* Mercado no celular: aviso + "Encher prateleiras" numa linha só (mais cartões visíveis) */
@media (max-height:520px){
  .mk-note{flex-wrap:nowrap;font-size:12px;line-height:1.2;padding:3px 4px 3px 10px}
  .mk-note .btn{flex:none;padding:0 10px}
}

/* selo de reposição do player (.pl-badge) fora do cartão de missão no celular (QA): centrado na área livre à esquerda */
@media (max-height:520px){
  body:has(.mx-root.has-card) .pl-badge{left:29vw;max-width:calc(58vw - 24px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
}
`;
