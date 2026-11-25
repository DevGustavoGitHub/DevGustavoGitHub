/** Tokens de design + componentes base + HUD. Injetado em <style id="mx-style">. */
export const baseCss = `
:root{
  --c-ink:#25222e; --c-ink-2:#5f5b6c; --c-ink-3:#8b8799;
  --c-paper:#fffaf0; --c-paper-2:#f6eedd; --c-paper-3:#ece1c9; --c-line:#e2d6bd;
  --c-brand:#17866a; --c-brand-2:#0f6b54; --c-brand-soft:#d8f1e8;
  --c-accent:#ff9330; --c-accent-2:#e2761a; --c-accent-soft:#ffe6cc;
  --c-good:#12915a; --c-bad:#de3f45; --c-warn:#e9a914; --c-info:#3b7fd4;
  --c-glass:rgba(24,26,36,.74); --c-glass-2:rgba(24,26,36,.9); --c-on-glass:#fff;
  --r-1:10px; --r-2:16px; --r-3:24px; --tap:48px;
  --sh-1:0 2px 8px rgba(20,16,30,.18); --sh-2:0 10px 34px rgba(20,16,30,.35);
  --sa-t:env(safe-area-inset-top,0px); --sa-r:env(safe-area-inset-right,0px);
  --sa-b:env(safe-area-inset-bottom,0px); --sa-l:env(safe-area-inset-left,0px);
  --font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
.mx-root,.mx-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.mx-root{position:absolute;inset:0;pointer-events:none;font-family:var(--font);color:var(--c-ink);
  touch-action:manipulation;font-variant-numeric:tabular-nums;-webkit-text-size-adjust:100%;overflow:hidden}
.mx-root button{font-family:inherit;touch-action:manipulation;-webkit-user-select:none;user-select:none;cursor:pointer}
.mx-root input{font-family:inherit}
.mx-root .ic{display:block}
.mx-root .ic-wrap{display:inline-flex;align-items:center;justify-content:center}
.mx-root .hit,.mx-root button,.mx-root input,.mx-root select{pointer-events:auto}
.mx-root [hidden]{display:none!important}

/* botões */
.btn{min-height:var(--tap);padding:0 18px;border-radius:var(--r-2);border:0;font-weight:700;font-size:16px;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;color:var(--c-ink);background:var(--c-paper-3);
  box-shadow:0 2px 0 rgba(0,0,0,.12);transition:transform .08s,filter .15s}
.btn:active:not(:disabled){transform:translateY(2px);box-shadow:none}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.primary{background:var(--c-brand);color:#fff;box-shadow:0 3px 0 var(--c-brand-2)}
.btn.accent{background:var(--c-accent);color:#2b1700;box-shadow:0 3px 0 var(--c-accent-2)}
.btn.danger{background:var(--c-bad);color:#fff;box-shadow:0 3px 0 #a92b30}
.btn.ghost{background:transparent;box-shadow:none;border:2px solid var(--c-line)}
.btn.small{min-height:40px;padding:0 12px;font-size:14px}
.btn.block{width:100%}
.icon-btn{width:var(--tap);height:var(--tap);flex:none;border-radius:50%;border:0;display:inline-flex;align-items:center;justify-content:center;
  background:var(--c-paper-3);color:var(--c-ink)}
.icon-btn:active{filter:brightness(.92)}
.mx-row{display:flex;gap:10px;align-items:center}
.mx-end{justify-content:flex-end}
.muted{color:var(--c-ink-2)}
.good{color:var(--c-good)} .bad{color:var(--c-bad)} .warn{color:var(--c-warn)}

/* camadas modais */
.mx-modal{position:absolute;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;
  padding:calc(var(--sa-t) + 10px) calc(var(--sa-r) + 10px) calc(var(--sa-b) + 10px) calc(var(--sa-l) + 10px);z-index:40;
  animation:mx-fade .18s ease-out}
.mx-dim{background:rgba(14,12,22,.58);backdrop-filter:blur(2px)}
.mx-z-report{z-index:50}.mx-z-menu{z-index:60}.mx-z-confirm{z-index:80}
.mx-dialog{width:min(420px,100%);background:var(--c-paper);border-radius:var(--r-3);padding:20px;box-shadow:var(--sh-2);animation:mx-pop .2s ease-out}
.mx-dialog h3{margin:0 0 6px;font-size:20px}
.mx-dialog p{margin:0 0 16px;color:var(--c-ink-2);line-height:1.4}
@keyframes mx-fade{from{opacity:0}to{opacity:1}}
@keyframes mx-pop{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:none}}
/* pulso só com transform/opacity (compositor): animar box-shadow repintava o botão em todo quadro por cima do canvas */
@keyframes mx-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes mx-ring{0%{transform:scale(1);opacity:.75}100%{transform:scale(1.22,1.4);opacity:0}}
.pulse::after,.attend-btn::after{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:0 0 0 5px rgba(255,147,48,.8);animation:mx-ring 1.4s ease-out infinite;pointer-events:none}
@keyframes mx-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}
.shake{animation:mx-shake .45s}

/* HUD */
.mx-top{position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:calc(var(--sa-t) + 8px) calc(var(--sa-r) + 10px) 0 calc(var(--sa-l) + 10px);z-index:10}
.hud{width:100%;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;border-radius:999px;background:var(--c-glass);
  color:var(--c-on-glass);font-weight:700;font-size:15px;backdrop-filter:blur(6px);box-shadow:var(--sh-1);white-space:nowrap}
.pill .ic{opacity:.9}
.hud .money{font-size:18px;color:#ffe9a8;transition:color .3s}
.hud .money.up{color:#8cf5b4}.hud .money.down{color:#ff9a9d}
.hud .money.bump{animation:mx-bump .35s}
@keyframes mx-bump{50%{transform:scale(1.12)}}
.hud .grow{flex:1 1 140px;min-width:0}
.lvl{display:flex;align-items:center;gap:10px;padding:0 14px 0 6px}
.lvl-badge{width:34px;height:34px;border-radius:50%;background:linear-gradient(145deg,#ffb55e,#ff8421);color:#3a1d00;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;flex:none}
.lvl-badge.pop{animation:mx-bump .7s}
.xp{flex:1;min-width:48px}
.xp-t{font-size:11px;opacity:.8;font-weight:600;line-height:1;margin-bottom:4px;display:flex;justify-content:space-between}
.xpbar{height:8px;border-radius:99px;background:rgba(255,255,255,.22);overflow:hidden}
.xpbar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7be0b4,#ffd36a);border-radius:99px;transition:width .5s ease}
.stars{display:inline-flex;gap:1px}
.stars .ic{width:15px;height:15px;stroke:#ffd36a;fill:none}
.stars .on .ic,.stars .on{fill:#ffd36a}
.stars .half{opacity:.6}
.gear{width:44px;height:44px;padding:0;justify-content:center;border:0;margin-left:auto}
.hud-right{display:flex;gap:6px;align-items:center;margin-left:auto}
.phase{font-size:12px;opacity:.85;font-weight:600}

/* ações inferiores (lado direito) */
.mx-actions{position:absolute;right:calc(var(--sa-r) + 12px);bottom:calc(var(--sa-b) + 14px);display:flex;flex-direction:column;align-items:flex-end;gap:10px;z-index:10}
.fab{width:60px;height:60px;border-radius:20px;border:0;background:var(--c-brand);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 0 var(--c-brand-2),var(--sh-1)}
.fab:active{transform:translateY(3px);box-shadow:none}
.store-btn{min-height:52px;padding:0 20px;border-radius:18px;border:0;font-weight:800;font-size:16px;display:inline-flex;align-items:center;gap:8px;
  background:var(--c-accent);color:#2b1700;box-shadow:0 4px 0 var(--c-accent-2),var(--sh-1)}
.store-btn.close{background:#f3e7cf;box-shadow:0 4px 0 #cdbd9a,var(--sh-1)}
.store-btn.end{background:var(--c-bad);color:#fff;box-shadow:0 4px 0 #a92b30,var(--sh-1)}
.store-btn:disabled{opacity:.5}
.pulse{animation:mx-pulse 1.4s infinite}
.attend-btn{position:relative}
.interact-btn{min-height:56px;padding:0 18px;border-radius:20px;border:0;background:#fff;color:var(--c-ink);font-weight:800;font-size:16px;
  display:inline-flex;align-items:center;gap:10px;box-shadow:0 4px 0 rgba(0,0,0,.2),var(--sh-1);max-width:min(300px,64vw)}
.interact-btn kbd{font:800 14px var(--font);min-width:28px;height:28px;border-radius:8px;background:var(--c-ink);color:#fff;display:none;align-items:center;justify-content:center}
@media (hover:hover) and (pointer:fine){.interact-btn kbd{display:inline-flex}}
.attend-btn{min-height:52px;padding:0 22px;border-radius:999px;border:0;background:var(--c-accent);color:#2b1700;font-weight:800;font-size:16px;
  display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 0 var(--c-accent-2),var(--sh-1);animation:mx-pulse 1.3s infinite}

/* toasts */
.toasts{display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;pointer-events:none}
.toast{pointer-events:none;max-width:min(92vw,440px);padding:10px 16px;border-radius:14px;background:var(--c-glass-2);color:#fff;font-weight:600;font-size:15px;line-height:1.3;
  box-shadow:var(--sh-1);border-left:5px solid var(--c-info);animation:mx-toast-in .25s ease-out}
.toast.good{border-color:#3ddc8e}.toast.bad{border-color:#ff6368}
.toast.out{opacity:0;transform:translateY(-8px);transition:all .3s}
@keyframes mx-toast-in{from{opacity:0;transform:translateY(-10px) scale(.96)}}

/* level up */
.levelup{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:35;pointer-events:none;animation:mx-fade .2s}
.levelup .burst{background:var(--c-paper);padding:22px 34px;border-radius:28px;text-align:center;box-shadow:var(--sh-2);animation:mx-pop .45s cubic-bezier(.2,1.4,.4,1)}
.levelup .burst b{display:block;font-size:44px;color:var(--c-accent-2);line-height:1}
.levelup .burst span{font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:13px;color:var(--c-ink-2)}
.levelup.out{opacity:0;transition:opacity .5s}
.spark{position:absolute;width:10px;height:10px;border-radius:3px;animation:mx-spark 1.1s ease-out forwards}
@keyframes mx-spark{to{transform:translate(var(--dx),var(--dy)) rotate(var(--rot));opacity:0}}

/* tutorial */
.tut{pointer-events:auto;width:min(420px,96%);background:var(--c-paper);border-radius:var(--r-2);padding:10px 12px;box-shadow:var(--sh-1);display:flex;gap:10px;align-items:center;border:2px solid var(--c-accent)}
.tut .n{width:30px;height:30px;border-radius:50%;background:var(--c-accent);color:#2b1700;font-weight:900;display:flex;align-items:center;justify-content:center;flex:none}
.tut .tx{flex:1;font-size:14px;line-height:1.3}.tut .tx b{display:block;font-size:15px}
.tut .skip{min-height:40px;border:0;background:transparent;color:var(--c-ink-2);font-weight:700;font-size:13px;padding:0 8px}
.tut-glow{outline:4px solid var(--c-accent);outline-offset:3px;animation:mx-pulse 1.3s infinite}
@media (max-height:460px){
  .mx-top{gap:4px;padding-top:calc(var(--sa-t) + 4px)}
  .tut{padding:6px 10px}.tut .tx{font-size:13px}
}
`;
