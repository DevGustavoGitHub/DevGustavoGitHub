/** Estilos da Fase 2: acessibilidade (fonte/movimento/daltonismo), banco, gráfico, pedido automático, falência. */
export const phase2Css = `
/* ---- tamanho de fonte: todo font-size em px é multiplicado por var(--fs) (ver scaleFonts) ---- */

/* ---- reduzir movimento ---- */
.mx-rm *,.mx-rm *::before,.mx-rm *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
.mx-rm .spark{display:none}

/* ---- modo daltônico: verde/vermelho viram azul/laranja e aparecem setas ---- */
.mx-cb{--c-good:#1f6fd1;--c-bad:#d95f02;--c-brand-soft:#d8f1e8}
.mx-cb .badge.good{background:#d6e6fb;color:#144f99}.mx-cb .badge.bad{background:#ffe0c2;color:#9a3f00}
.mx-cb .toast.good{border-color:#6aaaf5}.mx-cb .toast.bad{border-color:#ffa24d}
.mx-cb .hud .money.up{color:#9ccbff}.mx-cb .hud .money.down{color:#ffb36b}
.mx-cb .rp-big b{color:#9ccbff}.mx-cb .rp-big b.neg{color:#ffb36b}
.mx-cb .item.scanned{background:#d6e6fb}
.mx-cb .done .big{background:var(--c-good)}
.cbi{display:none;font-weight:900;margin-right:2px}
.mx-cb .cbi{display:inline}
.mx-cb .delta.up::before{content:'↑ '}.mx-cb .delta.down::before{content:'↓ '}
.mute{color:var(--c-ink-3)}

/* ---- caixa baixo ---- */
.hud .money.low{color:#ffb36b;box-shadow:0 0 0 2px #ffb36b,var(--sh-1)}
.fab.alert::after{content:'!';position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;background:var(--c-accent);color:#2b1700;font-weight:900;font-size:15px;display:flex;align-items:center;justify-content:center;box-shadow:var(--sh-1)}
.fab{position:relative}
.banner.bad{background:#fddcde;color:#8d1f25}
.mx-cb .banner.bad{background:#ffe0c2;color:#7a3500}

/* ---- banco ---- */
.bank-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.bank-act{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:var(--r-1);background:var(--c-paper-2)}
.bank-act h6{margin:0;font-size:13px;color:var(--c-ink-2);letter-spacing:.04em;text-transform:uppercase}
.bank-row{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.bank-row .stepper output{min-width:96px;font-size:16px}
.bank-cols{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}

/* ---- gráfico ---- */
.chart{position:relative}
.chart{max-width:520px;margin:0 auto;width:100%}
.chart svg{display:block;width:100%;height:auto;touch-action:pan-y;user-select:none;-webkit-user-select:none;outline:none}
.chart svg:focus-visible{outline:3px solid var(--c-info);outline-offset:2px;border-radius:8px}
.chart .gl{stroke:var(--c-line);stroke-width:1}
.chart .zero{stroke:var(--c-ink-3);stroke-width:1.5}
.chart text{font-family:var(--font);font-weight:600;font-size:11px;fill:var(--c-ink-2)}
.chart .bar-pos{fill:#2a6fdb}.chart .bar-neg{fill:url(#mx-hatch)}
.chart .bar-neg-out{fill:#e8710a}
.chart .sel{fill:rgba(37,34,46,.12)}
.chart .ctip{position:absolute;pointer-events:none;background:var(--c-glass-2);color:#fff;border-radius:10px;padding:6px 10px;font-size:13px;line-height:1.3;white-space:nowrap;box-shadow:var(--sh-1);z-index:3;transform:translateX(-50%)}
.chart .ctip b{display:block;font-size:14px}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--c-ink-2);font-weight:600}
.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.tbl{width:100%;border-collapse:collapse;font-size:14px}
.tbl th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--c-ink-2);text-align:right;padding:4px 6px;border-bottom:2px solid var(--c-line)}
.tbl th:first-child,.tbl td:first-child{text-align:left}
.tbl td{padding:8px 6px;text-align:right;border-bottom:1px solid var(--c-paper-3);white-space:nowrap}
.tbl td:first-child{white-space:normal;font-weight:700}
.tbl tr:last-child td{border-bottom:0}
.tbl-wrap{overflow-x:auto}

/* ---- pedido automático / melhorias / comprar o que falta ---- */
.auto-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.auto-ctl{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.auto-ctl .fld{display:flex;flex-direction:column;gap:2px}
.auto-ctl .fld small{color:var(--c-ink-2);font-size:12px;font-weight:600}
.auto-ctl .stepper output{min-width:40px}
.card.off .auto-ctl{opacity:.55}
.today-list{display:flex;flex-wrap:wrap;gap:6px}
.miss-card{border-color:var(--c-accent);background:#fffaf0}
.seg.sm{max-width:200px}.seg.sm .btn{min-height:44px}
.up-card .ptile{background:var(--c-accent);color:#2b1700}

/* ---- falência ---- */
.bankrupt{background:radial-gradient(120% 90% at 50% 0%,rgba(70,40,60,.96),rgba(20,18,36,.98));z-index:70;flex-direction:column;overflow-y:auto}
.bk-card{width:min(480px,100%);max-height:100%;overflow-y:auto;background:var(--c-paper);border-radius:var(--r-3);padding:20px;box-shadow:var(--sh-2);display:flex;flex-direction:column;gap:12px;animation:mx-pop .3s}
.bk-card h2{margin:0;font-size:24px}
.bk-card p{margin:0;line-height:1.45;color:var(--c-ink-2)}
.bk-cols{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.bk-box{background:#fff;border:2px solid var(--c-line);border-radius:var(--r-2);padding:10px 12px}
.bk-box h4{margin:0 0 6px;font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--c-ink-2)}
.bk-box ul{margin:0;padding-left:18px;font-size:14px;line-height:1.5}
.bk-ico{width:56px;height:56px;border-radius:18px;background:var(--c-accent);color:#3a1d00;display:flex;align-items:center;justify-content:center}
@media (orientation:landscape) and (max-height:520px){
  .bk-card{padding:12px 16px;gap:8px}.bk-card h2{font-size:20px}.bk-ico{display:none}
}
`;

/** Multiplica cada `font-size:Npx` (e o tamanho em `font:` abreviado) por `var(--fs)`, a escala escolhida em Opções. */
export function scaleFonts(css: string): string {
  return css
    .replace(/font-size:\s*([\d.]+)px/g, 'font-size:calc($1px * var(--fs,1))')
    .replace(/font:(\d{3}) ([\d.]+)px/g, 'font:$1 calc($2px * var(--fs,1))');
}
