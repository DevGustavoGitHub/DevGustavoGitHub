/** Estilos do minigame de checkout, relatório de fim de dia e menus. */
export const playCss = `
/* ---- cédulas e moedas ---- */
.den{position:relative;display:flex;align-items:center;justify-content:center;border:0;padding:0;color:#fff;font-weight:900;text-shadow:0 1px 1px rgba(0,0,0,.35);overflow:hidden}
.den.bill{width:100%;height:52px;min-height:48px;border-radius:8px;background:linear-gradient(135deg,var(--c1),var(--c2));box-shadow:inset 0 0 0 2px rgba(255,255,255,.5),0 3px 0 rgba(0,0,0,.25)}
.den.bill .orn{position:absolute;left:-10px;top:50%;width:34px;height:34px;margin-top:-17px;border-radius:50%;border:3px solid rgba(255,255,255,.35)}
.den.bill .orn2{position:absolute;right:6px;top:6px;bottom:6px;width:14px;border-radius:4px;background:repeating-linear-gradient(0deg,rgba(255,255,255,.4) 0 2px,transparent 2px 5px)}
.den.bill small{position:absolute;left:8px;top:4px;font-size:10px;opacity:.9}
.den.bill b{font-size:22px;letter-spacing:-.02em}
.den.coin{width:100%;max-width:62px;aspect-ratio:1;margin:0 auto;border-radius:50%;background:radial-gradient(circle at 32% 28%,#fff8 0,transparent 38%),linear-gradient(145deg,var(--c1),var(--c2));
  box-shadow:inset 0 0 0 3px rgba(255,255,255,.35),inset 0 0 0 5px rgba(0,0,0,.12),0 3px 0 rgba(0,0,0,.28);min-width:0;min-height:0}
.den.coin b{font-size:15px}
.den.bimetal{background:radial-gradient(circle at 50% 50%,#c9ccd3 0 38%,transparent 39%),linear-gradient(145deg,var(--c1),var(--c2))}
.den.bimetal b{color:#3a3d46;text-shadow:none}
button.den:active{transform:translateY(2px) scale(.97)}
.den.mini.bill{width:54px;height:30px;min-height:0;border-radius:6px;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.5),0 2px 0 rgba(0,0,0,.25)}
.den.mini.bill b{font-size:14px}.den.mini.bill small,.den.mini.bill .orn,.den.mini.bill .orn2{display:none}
.den.mini.coin{width:34px;height:34px;min-width:0;min-height:0;max-width:none}.den.mini.coin b{font-size:10px}
.den.mini{overflow:visible;margin:3px}
.den.mini::after{content:'';position:absolute;inset:-9px}

/* ---- checkout ---- */
.ck-wrap{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding:0 var(--sa-r) 0 var(--sa-l);z-index:40;pointer-events:none}
.ck{pointer-events:auto;width:min(600px,100%);max-height:calc(100% - var(--hud-b,56px) - 6px);overflow-y:auto;background:var(--c-paper);border-radius:var(--r-3) var(--r-3) 0 0;
  padding:12px 14px calc(var(--sa-b) + 14px);box-shadow:0 -6px 30px rgba(10,8,20,.4);animation:mx-slide .25s ease-out;border-top:4px solid var(--c-accent);overscroll-behavior:contain}
@keyframes mx-slide{from{transform:translateY(40px);opacity:0}}
.ck-head{display:flex;align-items:center;gap:10px}
.ck-title{display:flex;flex-direction:column;line-height:1.15;flex:1;min-width:0}
.ck-title small{color:var(--c-ink-2);font-weight:600}
.ck-speed{flex:0 0 64px;height:10px;border-radius:99px;background:var(--c-paper-3);overflow:hidden}
.ck-speed i{display:block;height:100%;width:100%;border-radius:99px;transition:width .3s linear,background .3s}
.ck-bag{display:flex;align-items:center;gap:4px;min-width:56px;height:44px;padding:0 10px;border-radius:14px;background:var(--c-brand-soft);color:var(--c-brand-2);font-size:17px}
.ck-bag.bump{animation:mx-bump .35s}
.ck-skip{flex:none}
.ck-body{margin-top:10px;display:flex;flex-direction:column;gap:10px}
.ck-hint{margin:0;display:flex;gap:8px;align-items:center;color:var(--c-ink-2);font-size:13.5px;line-height:1.3}
.belt{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));padding:10px;border-radius:var(--r-2);background:repeating-linear-gradient(90deg,#3a3946 0 18px,#43424f 18px 20px);}
.item{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;min-height:56px;padding:6px 12px 6px 6px;border:0;border-radius:12px;background:#fffdf6;text-align:left;color:var(--c-ink);box-shadow:0 3px 0 rgba(0,0,0,.35);transition:transform .12s,opacity .3s}
.item:active:not(.scanned){transform:scale(.97)}
.item .ibox{width:44px;height:44px;border-radius:10px;background:var(--c-accent);color:#2b1700;font-weight:900;font-size:20px;display:flex;align-items:center;justify-content:center;flex:none;box-shadow:inset 0 -4px 0 rgba(0,0,0,.15)}
.item .it{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.2}.item .it b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item .it small{color:var(--c-ink-2);font-size:12px}
.item .ip{font-weight:800;font-size:15px}
.item .beam{position:absolute;left:0;right:0;top:0;height:3px;background:#ff3b3b;box-shadow:0 0 10px #ff3b3b;opacity:0}
.item.scanned{opacity:.38;pointer-events:none;background:#d4f3e3}
.item.scanned .beam{animation:mx-beam .35s ease-out}
@keyframes mx-beam{0%{top:0;opacity:1}100%{top:100%;opacity:0}}
.ghost-item{position:fixed;z-index:90;border-radius:12px;background:#fffdf6;box-shadow:var(--sh-1);pointer-events:none;border:3px solid var(--c-brand)}
.ck-foot{display:flex;justify-content:space-between;align-items:center;font-size:15px;color:var(--c-ink-2);font-weight:700}
.ck-foot .run{font-size:22px;color:var(--c-ink)}
.ck-body.pay{display:grid;grid-template-columns:1fr;gap:12px}
.col{display:flex;flex-direction:column;gap:10px;min-width:0}
.amts{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px}
.amt{background:var(--c-paper-2);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;line-height:1.15}
.amt small{font-size:11.5px;font-weight:700;color:var(--c-ink-2);text-transform:uppercase;letter-spacing:.04em}
.amt b{font-size:17px;white-space:nowrap}
.amt.due{background:var(--c-accent-soft);outline:2px solid var(--c-accent)}.amt.due b{font-size:20px;color:#8a4a00}
.tray-wrap{background:#fff;border:2px dashed var(--c-line);border-radius:14px;padding:6px 8px;min-height:84px}
.tray-h{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;font-weight:700;color:var(--c-ink-2);text-transform:uppercase;letter-spacing:.04em}
.tray-h .tt{font-size:18px;color:var(--c-ink);text-transform:none;letter-spacing:0}.tt.ok{color:var(--c-good)!important}.tt.over{color:var(--c-bad)!important}
.tray{display:flex;flex-wrap:wrap;gap:2px;align-items:center;min-height:46px}
.tray .placeholder{color:var(--c-ink-3);font-size:13px;padding:8px 4px}
.hint-line{display:flex;flex-wrap:wrap;gap:4px;align-items:center;background:#fff7d6;border-radius:12px;padding:6px 10px;font-size:13px;font-weight:700;color:#7a5400}
.ck-actions{display:flex;gap:8px}.ck-actions .btn{flex:1;padding:0 8px}
.ck-ok{min-height:56px;font-size:18px}
.drawer{background:#4a4856;border-radius:var(--r-2);padding:10px;gap:10px;box-shadow:inset 0 4px 10px rgba(0,0,0,.4)}
.drawer-row{display:grid;gap:8px}
.drawer-row.bills{grid-template-columns:repeat(auto-fill,minmax(78px,1fr))}
.drawer-row.coins{grid-template-columns:repeat(5,minmax(0,1fr));padding-top:10px;border-top:2px solid rgba(255,255,255,.12)}
.reader{background:#2b2937;color:#d9f7e8;border-radius:14px;padding:10px 14px;display:flex;flex-direction:column;gap:4px}
.reader small{opacity:.7;font-weight:600}
.screen{font:800 34px/1.1 ui-monospace,Menlo,Consolas,monospace;text-align:right;color:#8cf5b4;background:#13201b;border-radius:10px;padding:10px 12px;letter-spacing:.02em}
.keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.key{min-height:56px;border-radius:14px;border:0;background:#fff;box-shadow:0 3px 0 var(--c-line);font-size:24px;font-weight:800;color:var(--c-ink);display:flex;align-items:center;justify-content:center}
.key.fn{background:var(--c-paper-3)}
.key:active{transform:translateY(2px);box-shadow:none}
.done{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 0;animation:mx-pop .3s}
.done .big{width:84px;height:84px;border-radius:50%;background:var(--c-good);color:#fff;display:flex;align-items:center;justify-content:center}
.done b{font-size:22px}.done small{color:var(--c-ink-2);font-size:14px;font-weight:600}
@media (orientation:landscape){
  .ck-wrap{align-items:center;justify-content:flex-end;padding:calc(var(--hud-b,56px) + 4px) calc(var(--sa-r) + 6px) calc(var(--sa-b) + 4px) 0}
  .ck{width:min(660px,74vw);max-height:100%;border-radius:var(--r-3);border-top:0;border-left:4px solid var(--c-accent);padding-bottom:12px}
  .ck-body.pay{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
  .belt{max-height:calc(100vh - var(--hud-b,56px) - 130px);overflow-y:auto;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
}
@media (orientation:landscape) and (max-height:520px){
  .ck{padding:8px 10px 8px}.ck-body{margin-top:6px;gap:6px}.col{gap:6px}
  .drawer-row.bills{grid-template-columns:repeat(4,1fr)}.den.bill{height:46px;min-height:46px}.drawer{padding:8px;gap:8px}.drawer-row{gap:6px}
  .drawer-row.coins{padding-top:8px}
  .tray-wrap{min-height:64px}.amt{padding:6px 8px}.amt small{font-size:10px}.amt b{font-size:14px}.amt.due b{font-size:16px}
  .ck-ok{min-height:50px}.key{min-height:48px;font-size:20px}.screen{font-size:26px;padding:6px 10px}
  .ck-hint{display:none}
  .belt{grid-template-columns:1fr 1fr;max-height:calc(100vh - var(--hud-b,56px) - 100px);padding:8px}
}
@media (orientation:landscape) and (max-height:420px){
  .ck{padding:6px 10px}.ck-head{gap:8px}.ck-body{margin-top:4px;gap:4px}.col{gap:4px}
  .ck-bag{height:38px}
  .den.bill{height:38px;min-height:38px}.den.bill b{font-size:19px}.den.coin{max-width:50px}
  .drawer{padding:6px;gap:6px}.drawer-row{gap:5px}.drawer-row.coins{padding-top:6px}
  .tray-wrap{min-height:52px;padding:4px 8px}.tray{min-height:38px}.tray .placeholder{padding:4px}
  .amt{padding:4px 8px}.ck-ok{min-height:44px;font-size:16px}.ck .btn{min-height:44px}.ck-actions .btn{font-size:14px}
  .key{min-height:40px;font-size:18px}.screen{font-size:22px;padding:4px 8px}.reader{padding:6px 10px}
  .ck-foot .run{font-size:19px}
}

/* ---- relatório ---- */
.report{width:min(560px,100%);max-height:100%;overflow-y:auto;background:var(--c-paper);border-radius:var(--r-3);box-shadow:var(--sh-2);animation:mx-pop .25s;display:flex;flex-direction:column;overscroll-behavior:contain}
.rp-head{padding:16px 18px 12px;background:#2b2937;color:#fff;border-radius:var(--r-3) var(--r-3) 0 0}
.rp-head small{opacity:.75;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:12px}
.rp-head h2{margin:2px 0 0;font-size:22px}
.rp-big{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap}
.rp-big b{font-size:30px;color:#8cf5b4}.rp-big b.neg{color:#ff9a9d}.rp-big span{font-size:13px;opacity:.85;font-weight:600}
.rp-body{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.rp-sec{background:#fff;border:2px solid var(--c-line);border-radius:var(--r-2);padding:10px 12px}
.rp-sec h4{margin:0 0 4px;font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--c-ink-2)}
.delta{font-size:12px;font-weight:800;margin-left:6px}.delta.up{color:var(--c-good)}.delta.down{color:var(--c-bad)}
.low-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.tip{display:flex;gap:10px;align-items:flex-start;background:var(--c-accent-soft);color:#6b3b00;border-radius:var(--r-1);padding:10px 12px;font-size:14px;line-height:1.35;font-weight:600}
.rp-foot{position:sticky;bottom:0;padding:10px 16px calc(10px + 0px);background:linear-gradient(transparent,var(--c-paper) 30%);display:flex;gap:10px}
.rp-foot .btn{flex:1;min-height:54px;font-size:17px}

/* ---- menus ---- */
.title-screen{background:radial-gradient(120% 90% at 50% 0%,rgba(23,134,106,.94),rgba(20,18,36,.98));flex-direction:column;gap:22px;text-align:center;color:#fff;overflow-y:auto}
.logo{display:flex;flex-direction:column;align-items:center;gap:2px}
.logo .mk{width:84px;height:84px;border-radius:26px;background:linear-gradient(145deg,#ffb55e,#ff8421);display:flex;align-items:center;justify-content:center;color:#3a1d00;box-shadow:0 8px 0 rgba(0,0,0,.25);margin-bottom:10px;transform:rotate(-6deg)}
.logo h1{margin:0;font-size:clamp(34px,9vw,54px);letter-spacing:-.03em;line-height:1}
.logo h1 span{color:#ffb55e}
.logo p{margin:6px 0 0;opacity:.8;font-weight:600}
.menu-btns{display:flex;flex-direction:column;gap:12px;width:min(340px,100%)}
.menu-btns .btn{min-height:56px;font-size:18px}
.menu-card{width:min(440px,100%);max-height:100%;overflow-y:auto;background:var(--c-paper);border-radius:var(--r-3);padding:18px;box-shadow:var(--sh-2);animation:mx-pop .22s;display:flex;flex-direction:column;gap:12px}
.menu-card h2{margin:0;font-size:22px}
.opt{display:flex;flex-direction:column;gap:8px;padding:10px 0;border-bottom:1px solid var(--c-line)}
.opt:last-of-type{border-bottom:0}
.opt label,.opt .lb{font-weight:700;display:flex;justify-content:space-between;align-items:center}
.opt input[type=range]{width:100%;height:48px;accent-color:var(--c-brand)}
.seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}
.seg .btn{min-height:48px;padding:0 6px}.seg .btn.on{background:var(--c-brand);color:#fff;box-shadow:0 3px 0 var(--c-brand-2)}
.switch{width:64px;height:40px;border-radius:99px;border:0;background:var(--c-paper-3);position:relative;transition:background .2s;flex:none}
.switch::after{content:"";position:absolute;top:4px;left:4px;width:32px;height:32px;border-radius:50%;background:#fff;box-shadow:var(--sh-1);transition:transform .2s}
.switch[aria-checked=true]{background:var(--c-brand)}.switch[aria-checked=true]::after{transform:translateX(24px)}
.menu-sub{display:flex;gap:6px;flex-direction:column}
`;
