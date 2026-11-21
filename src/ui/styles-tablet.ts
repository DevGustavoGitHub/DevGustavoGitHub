/** Estilos do tablet de gestão e seus cartões. */
export const tabletCss = `
.tablet{width:min(980px,100%);height:100%;max-height:min(760px,100%);background:var(--c-paper);border-radius:var(--r-3);box-shadow:var(--sh-2);
  display:grid;grid-template-rows:auto auto 1fr;overflow:hidden;animation:mx-pop .22s ease-out;border:3px solid #2b2937}
.tb-head{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 16px;background:#2b2937;color:#fff}
.tb-head h2{margin:0;font-size:18px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-head .cash{font-weight:800;color:#ffe9a8;font-size:16px;white-space:nowrap}
.tb-head .icon-btn{background:rgba(255,255,255,.14);color:#fff}
.tb-tabs{display:flex;gap:6px;padding:8px;overflow-x:auto;background:var(--c-paper-2);border-bottom:2px solid var(--c-line);scrollbar-width:none}
.tb-tabs::-webkit-scrollbar{display:none}
.tab-btn{flex:none;min-height:var(--tap);padding:0 14px;border-radius:14px;border:0;background:transparent;color:var(--c-ink-2);font-weight:700;font-size:14px;
  display:inline-flex;align-items:center;gap:8px}
.tab-btn.on{background:var(--c-brand);color:#fff;box-shadow:0 3px 0 var(--c-brand-2)}
.tb-body{overflow-y:auto;overscroll-behavior:contain;padding:12px;-webkit-overflow-scrolling:touch;min-height:0}
.tb-body>*+*{margin-top:10px}
@media (orientation:landscape) and (max-height:520px){
  .tablet{grid-template-columns:auto 1fr;grid-template-rows:auto 1fr;max-height:100%}
  .tb-head{grid-column:1/-1;padding:2px 6px 2px 14px}
  .tb-head .icon-btn{width:44px;height:44px}
  .tb-tabs{flex-direction:column;overflow-y:auto;overflow-x:hidden;border-bottom:0;border-right:2px solid var(--c-line);width:64px;padding:6px;align-items:stretch}
  .tab-btn{flex-direction:column;gap:2px;padding:6px 2px;font-size:10px;justify-content:center;min-height:52px;text-align:center;line-height:1.1}
  .mx-modal{padding-top:calc(var(--sa-t) + 4px);padding-bottom:calc(var(--sa-b) + 4px)}
}
@media (min-width:900px) and (min-height:521px){
  .tablet{grid-template-columns:200px 1fr;grid-template-rows:auto 1fr}
  .tb-head{grid-column:1/-1}
  .tb-tabs{flex-direction:column;overflow-x:hidden;border-bottom:0;border-right:2px solid var(--c-line);padding:12px}
  .tab-btn{justify-content:flex-start}
}

.card{background:#fff;border:2px solid var(--c-line);border-radius:var(--r-2);padding:12px;display:flex;flex-direction:column;gap:10px}
.card.locked{background:var(--c-paper-2);opacity:.85}
.card.owned{border-color:var(--c-brand);background:#f3fbf7}
.card-head{display:flex;gap:10px;align-items:center}
.card-head .grow{flex:1;min-width:0}
.card-head h5{margin:0;font-size:16px;line-height:1.2}
.card-head small{color:var(--c-ink-2);font-size:12.5px;display:block;margin-top:2px;line-height:1.3}
.card-actions{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.ptile{width:44px;height:44px;border-radius:12px;background:var(--tc);color:#fff;font-weight:900;font-size:20px;display:flex;align-items:center;justify-content:center;flex:none;
  text-shadow:0 1px 0 rgba(0,0,0,.25);box-shadow:inset 0 -4px 0 rgba(0,0,0,.18)}
.sec-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}
.sec-title h4{margin:0;font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--c-ink-2)}
.banner{display:flex;gap:10px;align-items:center;background:var(--c-brand-soft);color:var(--c-brand-2);padding:10px 12px;border-radius:var(--r-1);font-weight:600;font-size:14px;line-height:1.3}
.banner.warn{background:var(--c-accent-soft);color:#7a4300}
.empty{padding:22px;text-align:center;color:var(--c-ink-2)}
.stepper{display:inline-flex;align-items:center;gap:6px}
.stepper output{min-width:44px;text-align:center;font-weight:800;font-size:18px}
.stepper .icon-btn{background:var(--c-paper-3)}
.kv{display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:3px 0}
.kv .k{color:var(--c-ink-2)}.kv .v{font-weight:700;text-align:right}
.kv.total{border-top:2px dashed var(--c-line);margin-top:4px;padding-top:8px;font-size:16px}
.badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:800;background:var(--c-paper-3);color:var(--c-ink-2);white-space:nowrap}
.badge.good{background:#d4f3e3;color:#0b6b3f}.badge.bad{background:#fddcde;color:#a3262c}.badge.warn{background:#fdecc4;color:#7a5400}.badge.info{background:#d9e8fb;color:#1f5aa6}
.var{display:inline-flex;align-items:center;gap:2px;font-weight:800;font-size:13px}.var.good{color:var(--c-good)}.var.bad{color:var(--c-bad)}.var.mute{color:var(--c-ink-3)}
.stock{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--c-ink-2)}
.stock span{background:var(--c-paper-2);padding:2px 8px;border-radius:99px}
.price-ctl{display:flex;gap:4px;align-items:center;justify-content:center;flex-wrap:wrap}
.price-ctl .btn{min-width:54px;padding:0 6px;font-size:13px}
.price-ctl output{min-width:96px;text-align:center;font-weight:900;font-size:20px;background:var(--c-paper-2);border-radius:12px;padding:10px 6px}
.pips{display:inline-flex;gap:4px}.pips i{width:16px;height:8px;border-radius:4px;background:var(--c-paper-3)}.pips i.on{background:var(--c-accent)}
.swatches{display:flex;flex-wrap:wrap;gap:8px}
.sw{width:48px;height:48px;border-radius:14px;border:3px solid #fff;box-shadow:0 0 0 2px var(--c-line);padding:0}
.sw.on{box-shadow:0 0 0 4px var(--c-ink)}
.field{display:flex;gap:8px}
.field input[type=text]{flex:1;min-width:0;height:var(--tap);border-radius:12px;border:2px solid var(--c-line);padding:0 12px;font-size:16px;background:#fff;color:var(--c-ink)}
select.sel{height:44px;border-radius:12px;border:2px solid var(--c-line);background:#fff;padding:0 8px;font-size:14px;color:var(--c-ink);max-width:100%}
.sum-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.stat{background:var(--c-paper-2);border-radius:var(--r-1);padding:10px 12px}
.stat small{display:block;color:var(--c-ink-2);font-size:12px;font-weight:600}
.stat b{font-size:18px}
`;
