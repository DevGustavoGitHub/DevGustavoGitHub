/** Estilos da Fase 3: HUD no layout de referência, missões, noite, comemoração, resumo, pagamento, tablet azul, carrinho, orientação. */
export const phase3Css = `
:root{--p3-sky:#1ea0f2;--p3-sky-2:#0b78c9;--p3-navy:#1d2a3c;--p3-navy-2:#152031;--p3-navy-3:#2b3d55;--p3-red:#f0483e;--p3-green:#2fcf4a;--p3-yellow:#ffd23f}
/* camadas: cena < HUD (20) < controles do player (30) < barra do world (35) < painéis/modais (60+) */
.mx-modal{z-index:60}.mx-z-report{z-index:62}.mx-z-menu{z-index:64}.mx-z-confirm{z-index:85}.ck-wrap{z-index:62}
.mx-root.hud-over .mx-top{z-index:66}
.mx-root:has(.cele) .mx-top,.mx-root:has(.cele) .mslot,.mx-root:has(.cele) .edge-arrow{visibility:hidden}

/* ---------------- HUD ---------------- */
.mx-top{z-index:20;gap:4px;padding:calc(var(--sa-t) + 6px) calc(var(--sa-r) + 8px) 0 calc(var(--sa-l) + 8px)}
.hud3{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;gap:8px}
.hud3 .hud-r{display:flex;gap:6px;align-items:center;min-width:0}
.day-badge{display:flex;flex-direction:column;min-width:74px;border-radius:9px;overflow:hidden;border:2px solid #fff;box-shadow:0 3px 0 rgba(0,0,0,.28),var(--sh-1);text-align:center;font-weight:900;line-height:1;pointer-events:none}
.day-badge b{background:#e8322b;color:#fff;font-size:14px;padding:4px 8px 3px}
.day-badge span{background:#fff;color:#1d2a3c;font-size:17px;padding:3px 8px 5px}
.day-badge.night b{background:#3c3f9a}.day-badge.night span{background:#e5e9ff}
.hpill{height:42px;border-radius:9px;background:rgba(29,42,60,.92);color:#fff;border:0;display:flex;align-items:center;gap:6px;padding:0 10px 0 6px;font-weight:900;font-size:17px;box-shadow:0 3px 0 rgba(0,0,0,.28);position:relative;pointer-events:auto;min-width:0}
.lvl3{flex:0 1 150px;padding-left:0}
.lvl3 .lvl-star{position:relative;width:42px;height:42px;flex:none;margin:-3px 0 -3px -4px}
.lvl3 .lvl-star .star-ic{width:42px;height:42px}
.lvl3 .lvl-star b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;padding-top:4px;text-shadow:0 1px 1px rgba(0,0,0,.45)}
.xp3{flex:1 1 70px;min-width:36px;height:13px;border-radius:99px;background:#0b111a;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}
.xp3 i{display:block;height:100%;width:0;background:linear-gradient(#64ccff,#1ea0f2);border-radius:99px;transition:width .5s}
.hpill .dot{position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:50%;background:#f0302a;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)}
.money3{padding-left:4px}.money3 .bill-ic{width:34px;height:34px;flex:none}
.money3 .money-v{white-space:nowrap;transition:color .3s}
.money3.up .money-v{color:#8cf5b4}.money3.down .money-v{color:#ff9a9d}.money3.bump{animation:mx-bump .35s}
.money3.low{box-shadow:0 0 0 2px #ffb36b,0 3px 0 rgba(0,0,0,.28)}.money3.low .money-v{color:#ffcf8a}
.mx-cb .money3.up .money-v{color:#9ccbff}.mx-cb .money3.down .money-v{color:#ffb36b}
.gear3{width:46px;padding:0;justify-content:center}.gear3 .gear-ic{width:28px;height:28px}
.mx-root.has-card .mx-top .toasts{padding-right:min(340px,42vw)}

/* atalho do carrinho (ao lado do joystick do player) */
.cart-fab{position:absolute;left:calc(var(--sa-l) + 220px);bottom:calc(var(--sa-b) + 14px);z-index:32;width:56px;height:56px;border-radius:50%;
  border:3px solid rgba(255,255,255,.9);background:rgba(29,42,60,.84);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:var(--sh-1);pointer-events:auto}
.cart-fab:active{transform:scale(.94)}
.cart-fab .dot{position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:#f0302a;border:2px solid #fff}

/* missões / noite (canto superior direito) */
.mslot{position:absolute;right:calc(var(--sa-r) + 8px);top:calc(var(--hud-b,52px) + 6px);z-index:20;display:flex;flex-direction:column;align-items:flex-end;gap:8px;width:min(340px,42vw);pointer-events:none}
.mcard{pointer-events:auto;position:relative;width:100%;padding-right:50px;animation:mx-pop .25s}
.mc-box{position:relative;display:flex;min-height:60px;background:rgba(29,42,60,.94);border-radius:10px;box-shadow:0 3px 0 rgba(0,0,0,.28)}
.mc-box::after{content:'';position:absolute;right:-9px;top:50%;margin-top:-9px;border:9px solid transparent;border-right:0;border-left-color:rgba(29,42,60,.94)}
.mc-ic{width:56px;flex:none;display:flex;align-items:center;justify-content:center;border-right:2px solid rgba(255,255,255,.08)}
.mc-ic .pic,.mc-ic .fic{width:44px;height:44px}
.mc-main{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px 10px}
.mc-bar{position:relative;height:15px;border-radius:99px;background:#0b111a;overflow:hidden}
.mc-bar i{display:block;height:100%;width:0;background:linear-gradient(#64ccff,#1ea0f2);transition:width .4s}
.mc-bar span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff;letter-spacing:.04em}
.mc-tx{color:#fff;font-weight:800;font-size:14px;line-height:1.18}
.mc-face{position:absolute;right:0;top:50%;margin-top:-29px;width:58px;height:58px;border-radius:50%;background:linear-gradient(#8fd7ff,#1ea0f2);border:3px solid #fff;overflow:hidden;box-shadow:var(--sh-1)}
.mc-face .mgr{width:100%;height:100%}
.mcard.done .mc-box{box-shadow:0 0 0 3px #2fcf4a,0 3px 0 rgba(0,0,0,.28)}
.mcard.night .mc-tx{color:#ff7a70;text-align:center}
.night-ic{width:46px;border-radius:7px;overflow:hidden;background:#fff;text-align:center;font-weight:900;line-height:1;box-shadow:0 2px 0 rgba(0,0,0,.3)}
.night-ic b{display:block;background:#e8322b;color:#fff;font-size:10px;padding:3px 0}.night-ic span{display:block;color:#1d2a3c;font-size:14px;padding:4px 0}
.endday{pointer-events:auto;position:absolute;right:calc(var(--sa-r) + 8px);top:calc(var(--hud-b,52px) + 80px);z-index:32;min-height:58px;padding:0 18px 0 12px;border:0;border-radius:14px;
  background:linear-gradient(#35b0ff,#1585d6);color:#fff;font-weight:900;font-size:17px;text-transform:uppercase;display:flex;align-items:center;gap:8px;box-shadow:0 5px 0 #0a5c9c,var(--sh-1);line-height:1.05;text-align:left}
.endday .moon-ic{width:40px;height:40px}
.endday.pulse{animation:mx-pulse 1.4s infinite}
.edge-arrow{position:absolute;left:0;top:0;z-index:21;width:46px;height:46px;margin:-23px 0 0 -23px;pointer-events:none;display:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.45))}

/* folha de nível (toque na estrela) */
.lvl-wrap{align-items:flex-start;justify-content:center;padding-top:calc(var(--hud-b,52px) + 8px)}
.lvl-sheet{width:min(440px,94vw);max-height:100%;overflow-y:auto;background:var(--p3-navy);color:#fff;border-radius:16px;padding:12px 14px;box-shadow:var(--sh-2);display:flex;flex-direction:column;gap:10px;animation:mx-pop .2s}
.lvl-sheet h3{margin:0;font-size:20px;display:flex;align-items:center;gap:8px}.lvl-sheet h3 .star-ic{width:40px;height:40px}
.lvl-sheet h4{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#9fb3c8}
.lvl-sheet .xp3{height:16px}.lvl-sheet small{color:#b8c7d8;font-weight:700}
.ulist{display:flex;flex-direction:column;gap:6px}
.urow{display:flex;align-items:center;gap:10px;background:var(--p3-navy-2);border-radius:10px;padding:4px 6px 4px 4px;min-height:52px}
.urow .ic{width:44px;height:44px;flex:none;border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}
.urow .ic svg{width:40px;height:40px}.urow b{flex:1;font-size:14px}
.urow .btn{min-height:44px}
.new-tag{background:#f0302a;color:#fff;font-weight:900;font-size:10.5px;padding:2px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:.03em}

/* ---------------- comemoração e resumo ---------------- */
.cele{z-index:70;flex-direction:column;justify-content:center;align-items:stretch;gap:8px;padding:calc(var(--sa-t) + 8px) 0 calc(var(--sa-b) + 10px);overflow:hidden;
  background:radial-gradient(120% 100% at 55% 25%,rgba(30,52,86,.6),rgba(6,10,18,.86));--cw:min(470px,60vw);--cl:max(calc((100% - var(--cw)) / 2),28%)}
.cele .c-in{width:var(--cw);margin-left:var(--cl);display:flex;flex-direction:column;align-items:center;gap:6px;position:relative;z-index:2}
.c-face{position:absolute;left:calc(var(--sa-l) + 1%);bottom:0;height:min(96%,560px);aspect-ratio:200/300;z-index:3;pointer-events:none;animation:mx-face .5s cubic-bezier(.2,1.3,.4,1)}
.c-face .mgr{width:100%;height:100%;display:block}
@keyframes mx-face{from{transform:translateY(40px);opacity:0}}
.c-emb{width:110px;height:92px;margin-bottom:-14px;position:relative;z-index:1}.c-emb svg{width:100%;height:100%}
.ribbon{position:relative;padding:6px 40px 9px;background:linear-gradient(#3cbaff,#1488e0);border:3px solid #0b5fa8;border-radius:14px;box-shadow:0 5px 0 #0a4f8c;text-align:center;
  background-image:radial-gradient(circle at 20% 30%,rgba(255,255,255,.25) 0 2px,transparent 3px),radial-gradient(circle at 70% 60%,rgba(255,255,255,.2) 0 2px,transparent 3px),linear-gradient(#3cbaff,#1488e0);background-size:38px 26px,46px 30px,auto}
.ribbon::before,.ribbon::after{content:'';position:absolute;top:12px;width:30px;height:100%;background:#0f6fc0;z-index:-1;border:3px solid #0b5fa8}
.ribbon::before{left:-22px;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,30% 50%)}.ribbon::after{right:-22px;clip-path:polygon(0 0,100% 0,70% 50%,100% 100%,0 100%)}
.ribbon b{display:block;font-size:34px;line-height:1.05;font-weight:900;color:#ffd23f;text-transform:uppercase;letter-spacing:.01em;text-shadow:0 3px 0 #b55f08,0 0 3px #7a3a00;white-space:nowrap}
.rib-tab{margin-top:-4px;padding:4px 20px 6px;background:#1488e0;border:3px solid #fff;border-top:0;border-radius:0 0 12px 12px;color:#fff;font-weight:900;font-size:19px;text-transform:uppercase;box-shadow:0 4px 0 rgba(0,0,0,.25)}
.c-band{width:100%;background:rgba(4,8,14,.62);padding:8px 0 10px;position:relative;z-index:1}
.c-band h4{margin:0 0 4px;color:#fff;font-size:16px;font-weight:900;text-transform:uppercase;text-align:center}
.c-items{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-height:40vh;overflow-y:auto}
.c-item{width:96px;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;animation:mx-pop .35s backwards}
.c-item .ic{width:66px;height:66px;border-radius:14px;background:#fff;border:3px solid #fff;box-shadow:0 3px 0 rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;overflow:hidden}
.c-item .ic svg{width:60px;height:60px}
.c-item small{color:#fff;font-weight:800;font-size:12px;line-height:1.15;text-transform:uppercase}
.c-none{color:#dbe7f3;font-weight:700;font-size:14px;text-align:center;padding:4px 8px}
.btn-go{min-height:56px;min-width:min(320px,70vw);padding:0 26px;border:0;border-radius:14px;background:linear-gradient(#45e260,#22b13c);color:#fff;font-weight:900;font-size:21px;text-transform:uppercase;
  text-shadow:0 2px 0 #157a2a;box-shadow:0 5px 0 #157a2a,var(--sh-1);pointer-events:auto}
.btn-go:active{transform:translateY(3px);box-shadow:0 2px 0 #157a2a}
.c-foot{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
.btn-det{min-height:48px;padding:0 16px;border-radius:12px;border:2px solid rgba(255,255,255,.55);background:rgba(255,255,255,.1);color:#fff;font-weight:800;font-size:15px}
.cele .spark{z-index:4}
.sum-stats{display:flex;justify-content:center;gap:18px;background:rgba(4,8,14,.5);border-radius:12px;padding:6px 14px}
.sum-stats div{display:flex;align-items:center;gap:6px;color:#fff}.sum-stats svg{width:40px;height:40px}
.sum-stats small{display:block;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;opacity:.85}.sum-stats b{display:block;font-size:24px;line-height:1}
.sum-money{display:grid;grid-template-columns:auto auto;gap:4px 10px;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:21px}
.sum-money .k{text-align:right}.sum-money .v{display:flex;align-items:center;gap:6px}.sum-money .bill-ic{width:34px;height:34px}
.sum-money .pos{color:#4be36b}.sum-money .neg{color:#ff5a50}.sum-money hr{grid-column:1/-1;width:100%;border:0;border-top:2px solid rgba(255,255,255,.35);margin:2px 0}
.mx-cb .sum-money .pos{color:#7ab8ff}.mx-cb .sum-money .neg{color:#ffab5c}
.sum-sheet{position:absolute;z-index:6;left:50%;top:calc(var(--sa-t) + 8px);bottom:calc(var(--sa-b) + 8px);transform:translateX(-50%);width:min(580px,94vw);display:flex;flex-direction:column;background:var(--c-paper);border-radius:var(--r-3);box-shadow:var(--sh-2);overflow:hidden;animation:mx-pop .2s}
.sum-sheet .ss-head{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 16px;background:linear-gradient(#2fb0ff,#1695e8);color:#fff}.sum-sheet .ss-head h3{flex:1;margin:0;font-size:18px}
.sum-sheet .ss-head .icon-btn{background:rgba(255,255,255,.2);color:#fff}
.sum-sheet .rp-body{overflow-y:auto;overscroll-behavior:contain}

/* ---------------- pagamento (troco / maquininha) ---------------- */
.pay{position:absolute;right:calc(var(--sa-r) + 8px);top:calc(var(--hud-b,52px) + 6px);bottom:calc(var(--sa-b) + 8px);z-index:62;width:min(390px,47vw);display:flex;flex-direction:column;gap:6px;
  padding:8px;border-radius:16px;background:#263548;box-shadow:var(--sh-2);pointer-events:auto;animation:mx-slide-r .22s ease-out;overflow-y:auto;overscroll-behavior:contain}
@keyframes mx-slide-r{from{transform:translateX(30px);opacity:0}}
.pay-h{display:flex;align-items:center;gap:6px}
.pay-h h3{flex:1;margin:0;text-align:center;color:#9ec3ea;font-weight:900;font-size:22px;text-transform:uppercase;letter-spacing:.02em}
.pay-h .icon-btn{width:44px;height:44px;background:rgba(255,255,255,.1);color:#fff}
.pay-speed{height:6px;border-radius:99px;background:#1b2738;overflow:hidden}.pay-speed i{display:block;height:100%;width:100%;transition:width .3s linear,background .3s}
.pay-info{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.pay-info div{background:#1b2738;border-radius:8px;padding:3px 8px;display:flex;justify-content:space-between;align-items:center;gap:6px;color:#b9cde2;font-size:11.5px;font-weight:800;text-transform:uppercase}
.pay-info b{color:#fff;font-size:14px;text-transform:none;white-space:nowrap}.pay-info .chg b{color:#ffd23f}.pay-info .giv b{color:#4be36b}
.pay-row{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;background:#1b2738;border-radius:12px;padding:6px}
.pay-den{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:0;background:transparent;color:#fff;padding:0;min-height:48px;min-width:0;height:100%}
.pay-den small{font-weight:900;font-size:14px;white-space:nowrap}
.pay-den:active .bill3,.pay-den:active .coin3{transform:translateY(2px) scale(.96)}
.bill3{position:relative;width:100%;max-width:60px;flex:1 1 auto;min-height:44px;max-height:96px;border-radius:6px;background:linear-gradient(160deg,var(--c1),var(--c2));
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.55),inset 0 0 0 5px rgba(0,0,0,.08),0 3px 0 rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;overflow:hidden}
.bill3::before{content:'';position:absolute;width:62%;aspect-ratio:1;border-radius:50%;border:3px solid rgba(255,255,255,.45);background:rgba(255,255,255,.12)}
.bill3::after{content:'';position:absolute;left:6px;right:6px;bottom:6px;height:5px;border-radius:3px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.45) 0 3px,transparent 3px 6px)}
.bill3 b{position:relative;font-size:19px;font-weight:900;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.bill3 i{position:absolute;top:4px;left:5px;font-style:normal;font-size:9px;font-weight:900;color:#fff;opacity:.9}
.coin3{width:100%;max-width:52px;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 32% 28%,#fff9 0,transparent 40%),linear-gradient(145deg,var(--c1),var(--c2));
  box-shadow:inset 0 0 0 3px rgba(255,255,255,.4),inset 0 0 0 6px rgba(0,0,0,.12),0 3px 0 rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.4)}
.coin3.bimetal{background:radial-gradient(circle,#cfd3da 0 40%,transparent 41%),linear-gradient(145deg,var(--c1),var(--c2))}.coin3.bimetal{color:#3a3d46;text-shadow:none}
.pay-act{display:grid;grid-template-columns:1fr 2fr 1fr;gap:6px;flex:none}
.pk{min-height:50px;border:0;border-radius:12px;font-weight:900;font-size:26px;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 0 rgba(0,0,0,.3);text-shadow:0 2px 0 rgba(0,0,0,.2)}
.pk:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,.3)}
.pk.blue{background:linear-gradient(#35b0ff,#1585d6);box-shadow:0 4px 0 #0a5c9c}.pk.green{background:linear-gradient(#45e260,#22b13c);box-shadow:0 4px 0 #157a2a}
.pk.red{background:linear-gradient(#ff6a5f,#e0322a);box-shadow:0 4px 0 #a11d17}
.pay.card{background:#fff;width:min(350px,45vw)}
.pay.card .pay-h h3{color:#5f6b78}.pay.card .pay-h .icon-btn{background:#e9eef3;color:#1d2a3c}
.pay-screen{background:#e9eef3;border-radius:10px;display:flex;justify-content:space-between;align-items:center;padding:4px 12px;font-weight:900;color:#6b7785;font-size:17px;min-height:44px}
.pay-screen b{font-size:28px;color:#1d2a3c;white-space:nowrap}
.pay-due{font-size:12.5px;font-weight:800;color:#5f6b78;text-align:center}
.pay-screen .due-in{display:none;font-size:11px;font-weight:800;color:#6b7785;margin-left:6px}
.pay-pad{flex:1 1 0;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(44px,1fr);gap:6px}
.pay-pad .pk{min-height:44px;font-size:28px}.pay-pad .pk.ok{grid-column:span 2}
.pay-done{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#fff;font-weight:900;font-size:22px;animation:mx-pop .25s}
.pay.card .pay-done{color:#1d2a3c}
.pay-done span{width:76px;height:76px;border-radius:50%;background:#22b13c;color:#fff;display:flex;align-items:center;justify-content:center}
.pay.shake{animation:mx-shake .45s}
@media (max-height:420px){
  .pay{gap:4px;padding:6px}.pay-h h3{font-size:18px}
  .pay-den small{display:none}.pay-info b{font-size:13px}.pk{min-height:46px;font-size:23px}
  .pay-pad{grid-template-columns:repeat(4,1fr);grid-auto-rows:minmax(46px,1fr)}.pay-pad .pk{font-size:24px;min-height:46px}.pay-pad .pk.ok{grid-column:span 3}
  .pay-screen{min-height:38px}.pay-screen b{font-size:24px}
}

@media (max-height:400px){
  .pay{top:calc(var(--hud-b,48px) + 4px);bottom:calc(var(--sa-b) + 6px)}
  .pay.card .pay-speed,.pay.card .pay-due{display:none}.pay-screen .due-in{display:inline}
  .pay-screen{min-height:36px}.pay-screen b{font-size:22px}.pay-pad{gap:5px;grid-auto-rows:minmax(44px,1fr)}.pay-pad .pk{min-height:44px}
}

/* ---------------- aviso de orientação ---------------- */
.rotate{position:fixed;inset:0;z-index:95;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;color:#fff;pointer-events:auto;
  background:radial-gradient(120% 90% at 50% 0%,#1e8fe0,#0d2440)}
.rotate .rot-ic{width:150px;height:130px}.rotate .ph{transform-origin:60px 52px;animation:mx-rot 2.4s ease-in-out infinite}
.rotate h2{margin:0;font-size:26px;font-weight:900}.rotate p{margin:0;font-size:16px;opacity:.9;max-width:300px;line-height:1.4}
@keyframes mx-rot{0%,18%{transform:rotate(0)}50%,78%{transform:rotate(-90deg)}100%{transform:rotate(0)}}
@media (orientation:portrait) and (max-width:1024px){.rotate{display:flex}}

/* ---------------- tablet (computador) ---------------- */
.tb-wrap{align-items:stretch;padding:calc(var(--hud-b,52px) + 6px) calc(var(--sa-r) + 8px) calc(var(--sa-b) + 6px) calc(var(--sa-l) + 4px)}
.t3{width:min(1100px,100%);margin:0 auto;height:100%;display:grid;grid-template-columns:62px minmax(0,1fr);animation:mx-pop .2s ease-out}
.t3-rail{display:flex;flex-direction:column;gap:5px;padding:46px 0 6px;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;align-items:flex-end;min-height:0}
.t3-rail::-webkit-scrollbar{display:none}
.rail-btn{position:relative;width:56px;min-height:52px;flex:none;border:0;border-radius:12px 0 0 12px;background:#eef2f6;color:#7d8b9b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  font-size:9.5px;font-weight:800;line-height:1;padding:4px 2px;box-shadow:inset -3px 0 0 #d5dde6,0 3px 0 rgba(0,0,0,.18)}
.rail-btn .ic{width:24px;height:24px}
.rail-btn.on{width:62px;background:var(--p3-sky);color:#fff;box-shadow:0 3px 0 var(--p3-sky-2)}
.rail-btn .dot{position:absolute;top:3px;right:6px;width:12px;height:12px;border-radius:50%;background:#f0302a;border:2px solid #fff}
.t3-panel{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;background:#fff;border-radius:16px;overflow:hidden;box-shadow:var(--sh-2);border:3px solid #fff}
.t3-head{position:relative;height:44px;background:linear-gradient(#35b6ff,#1695e8);display:flex;align-items:center;justify-content:center;color:#fff;padding:0 52px}
.t3-head h2{margin:0;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:.02em;text-shadow:0 2px 0 rgba(0,0,0,.18);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t3-x{position:absolute;right:0;top:0;width:52px;height:44px;border:0;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center}
.t3-x .ic{width:30px;height:30px;stroke-width:3.2}
.t3-body{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:10px;background:#eaf4fc;border:3px solid #bfe2fb;border-top:0;border-radius:0 0 13px 13px;min-height:0}
.t3-body>*+*{margin-top:8px}
.t3-body.fill{overflow:hidden;padding:6px}
.t3 .card,.bigcard,.pcard,.stock-item{--c-ink:#fff;--c-ink-2:#b8c7d8;--c-ink-3:#8194aa;--c-paper:#1d2a3c;--c-paper-2:#152031;--c-paper-3:#2b3d55;--c-line:#34485f;--c-good:#4be37a;--c-bad:#ff6b6b;--c-warn:#ffc94d}
.mx-cb .t3 .card,.mx-cb .bigcard,.mx-cb .pcard{--c-good:#7ab8ff;--c-bad:#ffab5c}
.t3 .card{background:var(--p3-navy);border:0;color:#fff;box-shadow:0 3px 0 rgba(0,0,0,.18)}
.t3 .card.owned{background:#173a35}.t3 .card.locked{background:#26303d;opacity:1}.t3 .card.off{background:#222c39}
.t3 .card input[type=text],.t3 .card select{background:#0f1925;color:#fff;border-color:#34485f}
.t3 .btn.primary{background:linear-gradient(#35b0ff,#1585d6);box-shadow:0 4px 0 #0a5c9c;color:#fff}
.t3 .chart .sel{fill:rgba(255,255,255,.12)}
.t3 .sec-title h4{color:#46627f}.t3 .banner{background:#d6ecfb;color:#0b5fa8}.t3 .banner.warn{background:#fff1d6;color:#7a4300}
.t3 .sum-grid .stat,.t3 .t3-body>.stat{background:#fff}
.t3 .miss-card{background:var(--p3-navy)}
.t3 .empty{color:#5f6f82}.t3 .card .empty{color:var(--c-ink-2)}
.focus-hl{outline:3px solid var(--p3-yellow);outline-offset:2px;animation:mx-focus .8s ease-in-out 3}
@keyframes mx-focus{50%{outline-color:transparent}}
@media (min-width:1000px) and (min-height:600px){.t3{grid-template-columns:76px minmax(0,1fr)}.rail-btn{width:68px;font-size:10.5px}.rail-btn.on{width:76px}}

/* tiles de produto com ícone procedural (Preços/Automático) */
.ptile.pt3{background:#fff;padding:2px;box-shadow:inset 0 0 0 2px var(--tc)}.ptile.pt3 svg{width:40px;height:40px}

/* botões de compra no estilo da referência */
.abtn{min-height:48px;width:100%;border:0;border-radius:10px;font-weight:900;font-size:15px;text-transform:uppercase;color:#fff;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 10px;
  box-shadow:0 4px 0 rgba(0,0,0,.3);letter-spacing:.01em;line-height:1.1;text-align:center}
.abtn.buy{background:linear-gradient(#35b0ff,#1585d6);box-shadow:0 4px 0 #0a5c9c}.abtn.lock{background:linear-gradient(#ff6a5f,#e0322a);box-shadow:0 4px 0 #a11d17;cursor:not-allowed}
.abtn.owned{background:linear-gradient(#949ea9,#6f7984);box-shadow:0 4px 0 #4a525b}.abtn.poor,.abtn.off{background:#46566a;box-shadow:0 4px 0 #2f3b49;color:#d3dce6}
.abtn:disabled{cursor:not-allowed}.abtn:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,.3)}

/* cartões grandes (licenças, equipe, expansão, serviços, melhorias) */
.bigs{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(196px,1fr))}
.bigcard{display:flex;flex-direction:column;gap:6px;background:var(--p3-navy);border-radius:12px;padding:8px;color:#fff;box-shadow:0 3px 0 rgba(0,0,0,.18)}
.bigcard h5{margin:0;font-size:15px;font-weight:900;text-transform:uppercase;line-height:1.1}
.bigcard .art{display:flex;align-items:center;justify-content:center;min-height:86px;background:var(--p3-navy-2);border-radius:8px;position:relative}
.bigcard .art svg{width:76px;height:76px}
.bigcard p{margin:0;font-size:12.5px;color:#b8c7d8;line-height:1.3;text-align:center}
.bigcard .meta{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:13px;font-weight:800;color:#d5e2ef}
.bigcard .meta b{font-size:18px;color:#fff}
.bigcard .abtn{margin-top:auto}
.bigcard.owned .art{box-shadow:inset 0 0 0 2px #2fcf4a}
.bigcard .tag-ok{position:absolute;top:6px;right:6px;background:#2fcf4a;color:#0b3d17;font-size:10.5px;font-weight:900;padding:2px 6px;border-radius:4px;text-transform:uppercase}

/* ---------------- Mercado + carrinho ---------------- */
.mk3{display:grid;grid-template-columns:minmax(0,1fr) minmax(196px,31%);gap:8px;height:100%;min-height:0}
.mk-left{display:flex;flex-direction:column;min-height:0}
.mk-top{display:flex;gap:6px;align-items:flex-end}
.subtab{min-height:48px;padding:0 16px;border:0;border-radius:10px 10px 0 0;background:var(--p3-sky);color:#fff;font-weight:900;font-size:15px;text-transform:uppercase;box-shadow:inset 0 -3px 0 rgba(0,0,0,.15)}
.subtab.on{background:#fff;color:#5f6b78;box-shadow:inset 0 3px 0 #bfe2fb,inset 3px 0 0 #bfe2fb,inset -3px 0 0 #bfe2fb}
.mk-top .sel{margin-left:auto;margin-bottom:4px;height:44px;min-height:44px;border-radius:10px;border:2px solid #bfe2fb;background:#fff;color:#1d2a3c;font-weight:800;max-width:46%}
.mk-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;border:3px solid #bfe2fb;border-radius:0 12px 12px 12px;background:#fff;padding:6px;display:grid;gap:6px;
  grid-template-columns:repeat(auto-fill,minmax(232px,1fr));grid-auto-rows:max-content;align-content:start}
.mk-note{grid-column:1/-1;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#eaf4fc;border-radius:10px;padding:4px 6px 4px 10px;font-size:13px;font-weight:700;color:#35506b}
.mk-note .btn{min-height:44px}
.pcard{display:grid;grid-template-columns:minmax(0,1fr) 136px;gap:6px;background:var(--p3-navy);border-radius:10px;padding:8px;color:#fff;min-height:140px;position:relative}
.pcard.locked{background:#26303d}
.pc-l{display:flex;flex-direction:column;gap:2px;min-width:0}
.pc-name{font-size:14px;font-weight:900;line-height:1.15}
.pc-sub{font-size:11px;color:#9fb3c8;font-weight:700;line-height:1.2}
.pc-art{position:relative;flex:1 0 auto;display:flex;align-items:center;justify-content:center;min-height:66px}
.pc-art>.pic,.pc-art>.fic{width:66px;height:66px}
.pc-furn{position:absolute;left:-2px;bottom:-2px;width:30px;height:30px;display:flex}.pc-furn svg{width:30px;height:30px}
.pc-units{position:absolute;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;font-size:13px;font-weight:900;line-height:1;gap:1px}
.pc-units svg{width:18px;height:18px;color:#e2a85c}
.pc-info{grid-column:1/-1;font-size:11px;color:#9fb3c8;font-weight:700;line-height:1.25}
.pc-warn{font-size:11px;font-weight:800;color:#ffd08a;background:rgba(255,160,40,.16);border-radius:6px;padding:2px 6px;align-self:flex-start;line-height:1.2}
.pc-r{display:flex;flex-direction:column;gap:6px;justify-content:center}
.pc-price{text-align:center;font-size:19px;font-weight:900;line-height:1.1;display:flex;flex-direction:column;align-items:center}
.pc-price .var{font-size:11px}
.qty{display:grid;grid-template-columns:48px minmax(0,1fr) 48px;align-items:center;background:#111b29;border-radius:10px;height:48px}
.qty button{height:48px;border:0;background:transparent;color:#fff;font-size:28px;font-weight:900;line-height:1;padding:0}
.qty button:disabled{opacity:.35}
.qty output{text-align:center;font-size:20px;font-weight:900}
.pc-r .abtn{min-height:48px;font-size:14px}
.mk-cart{display:flex;flex-direction:column;min-height:0;background:#e3eef8;border-radius:12px;padding:8px;gap:6px}
.mk-cart h4{margin:0;font-size:19px;font-weight:900;color:#2b3a4c;text-transform:uppercase;display:flex;justify-content:space-between;align-items:baseline;gap:6px}
.mk-cart h4 small{font-size:11.5px;color:#5f6f82;text-transform:none;font-weight:800}
.cart-h,.cline{display:grid;grid-template-columns:minmax(0,1fr) 74px 46px;gap:4px;align-items:center}
.cart-h{font-size:10.5px;font-weight:900;color:#5f6f82;text-transform:uppercase;background:#d4e4f2;padding:4px 6px;border-radius:6px}
.cart-h span:not(:first-child),.cline span:not(:first-child){text-align:right}
.cart-lines{flex:1;min-height:48px;overflow-y:auto;overscroll-behavior:contain}
.cline{width:100%;min-height:48px;border:0;border-bottom:1px solid #cfdeeb;background:transparent;font-size:12.5px;font-weight:800;color:#1d2a3c;text-align:left;padding:0 4px}
.cline:active{background:#d4e4f2}
.cline .nm{display:flex;align-items:center;gap:4px;min-width:0}.cline .nm span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cline .nm svg{width:26px;height:26px;flex:none}
.cline .x{color:#c0392b;font-weight:900;margin-right:2px}
.cart-empty{color:#7d8b9b;font-size:13px;font-weight:700;text-align:center;padding:14px 6px}
.cart-total{display:flex;justify-content:space-between;align-items:center;background:#d4e4f2;border-radius:8px;padding:4px 10px;font-weight:900;color:#2b3a4c;font-size:14px;text-transform:uppercase}
.cart-total b{font-size:20px;text-transform:none}
.cart-act{display:grid;grid-template-columns:minmax(0,1fr) 62px;gap:6px}
.cart-buy{min-height:52px;border:0;border-radius:12px;background:linear-gradient(#35b0ff,#1585d6);box-shadow:0 4px 0 #0a5c9c;color:#fff;font-weight:900;font-size:21px;text-transform:uppercase}
.cart-buy:disabled{background:#8a9aac;box-shadow:0 4px 0 #66768a;font-size:14px}
.cart-clear{min-height:52px;border:0;border-radius:12px;background:linear-gradient(#ff6a5f,#e0322a);box-shadow:0 4px 0 #a11d17;color:#fff;font-weight:900;font-size:10.5px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;text-transform:uppercase}
.cart-msg{font-size:11.5px;font-weight:800;color:#b03a2e;text-align:center}
.stock-row{grid-column:1/-1;display:flex;gap:6px;overflow-x:auto;background:#fff3cd;border-radius:10px;padding:6px;align-items:center}
.stock-row>b{flex:none;font-size:13px;color:#7a4300;padding:0 4px;max-width:90px;line-height:1.2}
.stock-item{flex:none;display:flex;align-items:center;gap:6px;background:var(--p3-navy);color:#fff;border-radius:10px;padding:4px 6px 4px 4px;font-size:13px;font-weight:800}
.stock-item svg{width:40px;height:40px}.stock-item .abtn{width:auto;min-width:92px;font-size:13px}
.grp{grid-column:1/-1;margin:4px 2px 0;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#46627f}
@media (max-width:700px){.mk3{grid-template-columns:minmax(0,1fr) 180px}.mk-list{grid-template-columns:1fr}}
@media (max-height:420px){
  .t3-head{height:40px}.t3-head h2{font-size:20px}.t3-x{height:40px}.t3-rail{padding-top:42px}
  .pcard{min-height:128px;padding:6px}.pc-art{min-height:56px}.pc-art>.pic,.pc-art>.fic{width:56px;height:56px}
  .mk-cart h4{font-size:16px}.cart-buy{font-size:18px;min-height:48px}.cart-clear{min-height:48px}
  .bigcard .art{min-height:70px}.bigcard .art svg{width:62px;height:62px}
}
@media (max-height:400px){
  .day-badge b{font-size:13px;padding:3px 8px 2px}.day-badge span{font-size:15px;padding:2px 8px 4px}.hpill{height:38px;font-size:16px}
  .lvl3 .lvl-star,.lvl3 .lvl-star .star-ic{width:38px;height:38px}.money3 .bill-ic{width:30px;height:30px}.gear3{width:42px}
  .mc-box{min-height:52px}.mc-ic{width:48px}.mc-ic .pic,.mc-ic .fic{width:38px;height:38px}.mc-tx{font-size:13px}.mc-face{width:50px;height:50px;margin-top:-25px}.mcard{padding-right:44px}
  .endday{top:calc(var(--hud-b,48px) + 70px);min-height:52px;font-size:15px}.endday .moon-ic{width:34px;height:34px}
  .c-emb{width:80px;height:66px;margin-bottom:-10px}.ribbon b{font-size:27px}.rib-tab{font-size:16px;padding:3px 16px 4px}
  .c-item{width:84px}.c-item .ic{width:56px;height:56px}.c-item .ic svg{width:50px;height:50px}.c-item small{font-size:11px}
  .btn-go{min-height:50px;font-size:18px}.cele{gap:5px}.sum-money{font-size:18px}.sum-money .bill-ic{width:28px;height:28px}.sum-stats b{font-size:20px}.sum-stats svg{width:32px;height:32px}
}
`;
