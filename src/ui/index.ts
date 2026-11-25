/**
 * Módulo de UI (DOM/CSS) — Fase 3: HUD no layout de referência, atalho de carrinho, missões com setas, comemoração de
 * nível, noite + "Terminar o dia" + resumo, Mercado com carrinho e estoque de montagem, painéis de troco/maquininha,
 * aviso de orientação. Os controles de jogo (joystick, ação, sair do caixa...) são do `player`.
 * Fase 4: sensibilidade da câmera nas Opções, preço sugerido = `api.suggestedPrice`, telas sem rolagem no celular
 * deitado (tablet em tela inteira), botões do HUD/pagamento no `pointerdown` e aviso de orientação ciente da trava.
 * Eventos: ver docs/CONTRACTS.md (seções "Fase 3" e "Fase 3 — ui"). Só muda estado via sim/api.ts (e economy.ts).
 */
import type { GameContext, GameModule } from '../core/module';
import * as api from '../sim/api';
import { Bankruptcy } from './bankruptcy';
import { Celebrate, LevelSheet } from './celebrate';
import { Checkout, type CheckoutRequest } from './checkout';
import { h } from './dom';
import { Hud } from './hud';
import { UiKit } from './kit';
import { Menus } from './menu';
import { Missions } from './missions';
import { Night } from './night';
import { PayPanel, type PayRequest } from './pay';
import { Report } from './report';
import { RotateWarning } from './rotate';
import { baseCss } from './styles-base';
import { playCss } from './styles-play';
import { phase2Css, scaleFonts } from './styles-phase2';
import { phase3Css } from './styles-phase3';
import { phase4Css } from './styles-phase4';
import { tabletCss } from './styles-tablet';
import { Tablet } from './tablet';
import { parseAutoToast, recordToday } from './tablet/auto';
import { cart } from './tablet/cart';
import { unseenTabs } from './unlocks';

export default function create(): GameModule {
  let kit: UiKit;
  let root: HTMLElement;
  let hud: Hud;
  let tablet: Tablet;
  let checkout: Checkout;
  let pay: PayPanel;
  let report: Report;
  let menus: Menus;
  let missions: Missions;
  let night: Night;
  let celebrate: Celebrate;
  let levelSheet: LevelSheet;
  let bankrupt: Bankruptcy;
  let rotate: RotateWarning;
  let legacyPending: CheckoutRequest | null = null;
  let payPending: PayRequest | null = null;
  let lvlT = 0, dotT = 0;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  const offs: (() => void)[] = [];

  /** "Terminar o dia": confirma se ainda há clientes (ou se a loja segue aberta) e abre o resumo. */
  const endDay = (): void => {
    const { clock, services } = kit.ctx;
    if (report.isOpen || clock.phase === 'report') return;
    const n = services.npc?.customersInStore() ?? 0;
    if (clock.phase === 'closing' && n === 0) { report.show(); return; }
    const text = n > 0
      ? `Ainda ${n > 1 ? `há ${n} clientes` : 'há 1 cliente'} na loja. Se terminar agora, ${n > 1 ? 'eles vão' : 'ele vai'} embora sem comprar.`
      : clock.phase === 'prep' ? 'A loja nem abriu hoje. O dia termina sem vendas e as despesas fixas são cobradas.'
        : 'A loja ainda está aberta. Os clientes param de entrar e o resumo do dia é gerado.';
    void kit.confirm({ title: 'Terminar o dia?', text, ok: 'Terminar o dia' }).then((ok) => { if (ok) report.show(); });
  };

  /** Placa da porta (`store:sign`, do player) e menu de pausa: abre; fecha com confirmação; à noite, orienta. */
  let signAt = -1e9;
  const storeSign = (): void => {
    const { clock } = kit.ctx;
    // toque duplo na placa (QA): a 2ª ação em menos de 1 s é ignorada (abria e já perguntava "Fechar a loja?")
    const now = performance.now();
    if (now - signAt < 1000) return;
    signAt = now;
    if (clock.phase === 'prep') { clock.openStore(); kit.sfx('sign'); kit.toast('Loja aberta! Os clientes já podem entrar.', 'good'); }
    else if (clock.phase === 'open') {
      // durante o expediente a placa só PAUSA a entrada (o dia fecha às 21:00 ou em "Terminar o dia")
      const closed = !clock.doorsClosed;
      clock.setDoorsClosed(closed);
      kit.sfx('sign');
      kit.toast(closed ? 'Porta fechada: nenhum cliente novo entra. Toque na placa para reabrir.' : 'Porta aberta: os clientes voltaram a entrar.', closed ? 'info' : 'good');
    } else if (clock.phase === 'closing') kit.toast('A loja está fechada. Toque em "Terminar o dia" quando quiser.', 'info');
  };

  const tryPay = (): void => {
    if (!payPending || pay.isOpen || kit.isModalOpen()) return;
    const r = payPending;
    payPending = null;
    pay.open(r);
  };
  const tryLegacy = (): void => {
    if (!legacyPending || checkout.isOpen || kit.isModalOpen()) return;
    const r = legacyPending;
    legacyPending = null;
    checkout.open(r);
  };
  /**
   * A sim não emite eventos: a UI anuncia cada nível acima de `levelAck` (emite `levelUp`; o audio toca o som) e só dá
   * baixa (`api.consumeLevelUps`) depois do "Continue jogando!" da comemoração — recarregar antes disso mostra de novo.
   */
  let emittedLv = -1;
  const pollLevels = (): void => {
    const s = kit.ctx.state;
    const ack = Number.isFinite(s.levelAck) ? s.levelAck : s.level;
    if (emittedLv < 0) emittedLv = ack;
    for (let l = Math.max(ack, emittedLv) + 1; l <= s.level; l++) { emittedLv = l; kit.ctx.bus.emit('levelUp', { level: l }); }
  };
  const ackLevel = (lv: number): void => {
    const s = kit.ctx.state;
    if (lv < s.level) return; // ainda há comemoração na fila: a baixa vem na última
    try { api.consumeLevelUps(s); kit.ctx.save(); } catch { /* sim antiga */ }
  };

  /** HUD tocado com o pagamento aberto (QA): dá retorno em vez de ignorar em silêncio. */
  const busyPay = (): boolean => {
    if (!kit.isModalOpen('pay')) return false;
    kit.toast('Termine o pagamento primeiro (ou toque em × para cancelar).', 'info');
    kit.sfx('error');
    kit.settings.buzz(30);
    return true;
  };

  /**
   * Voltar do Android (`ui:back`, emitido pelo APK): cancela o diálogo de cima; fecha o painel/modal de cima (tablet,
   * Opções, nível, comemoração, pagamento → confirma cancelar, detalhes do resumo); sem modal → menu de pausa (no
   * posicionamento, cancela como o Esc); na pausa ou na tela inicial → "Sair do jogo?" → salva e emite `app:exit`.
   */
  let building = false;
  const back = (): void => {
    if (kit.closeTopConfirm()) return;
    const top = kit.topModal();
    if (top === 'pause' || top === 'title') {
      void kit.confirm({ title: 'Sair do jogo?', text: 'Seu progresso fica salvo e você continua de onde parou.', ok: 'Sair', cancel: 'Continuar jogando', danger: true })
        .then((ok) => { if (ok) { kit.ctx.save(); kit.ctx.bus.emit('app:exit'); } });
      return;
    }
    if (top === 'report') { report.closeDetails(); return; } // o resumo só sai com "Continue jogando!"
    if (top) { kit.runCloser(top); return; } // falência e aviso de orientação não têm fechador: sem ação
    if (building) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })); return; }
    menus.showPause();
  };

  return {
    name: 'ui',
    init(ctx: GameContext) {
      kit = new UiKit(ctx);
      const style = h('style', { id: 'mx-style' });
      style.textContent = scaleFonts(baseCss + tabletCss + playCss + phase2Css + phase3Css + phase4Css);
      document.head.appendChild(style);
      root = h('div', { class: 'mx-root', style: 'pointer-events:none' });
      ctx.uiRoot.appendChild(root);
      kit.attachLayer(root);
      kit.settings.bindRoot(root);

      hud = new Hud(kit, root, {
        openTablet: (tab) => { if (!busyPay()) tablet.open(tab); },
        openMenu: () => { if (!busyPay()) menus.showPause(); },
        openLevel: () => { if (busyPay()) return; levelSheet.open(); hud.setDot(unseenTabs(ctx.state).size > 0); },
      });
      tablet = new Tablet(kit, root);
      bankrupt = new Bankruptcy(kit, root);
      tablet.guard = () => bankrupt.check();
      tablet.onSeen = () => hud.setDot(unseenTabs(ctx.state).size > 0);
      checkout = new Checkout(kit, root);
      pay = new PayPanel(kit, root);
      report = new Report(kit, root);
      report.afterNext = () => { bankrupt.check(); };
      missions = new Missions(kit, hud, root);
      night = new Night(kit, hud, root, missions, endDay);
      celebrate = new Celebrate(kit, root);
      celebrate.onAck = ackLevel;
      levelSheet = new LevelSheet(kit, root, (tab) => tablet.open(tab));
      menus = new Menus(kit, root, {
        endDay,
        replayTutorial: () => missions.start(true),
        onStart: () => { kit.settings.emit(); if (!bankrupt.check()) missions.start(); },
        toggleStore: storeSign,
        tutorialActive: () => missions.active,
        skipTutorial: () => { missions.finish(false); kit.toast('Tutorial pulado. Você pode revê-lo no menu.', 'info'); },
      });
      rotate = new RotateWarning(kit, root);

      const bus = ctx.bus;
      offs.push(
        bus.on('ui:openTablet', (p?: { tab?: string; productId?: string }) => tablet.open(p?.tab, { productId: p?.productId })),
        bus.on('store:sign', storeSign),
        bus.on('storeClosing', () => night.show()),
        bus.on('storeEmpty', () => night.empty()), // o resumo NÃO abre sozinho (Fase 3)
        bus.on('dayStarted', () => { night.hide(); report.snapshotDay(); }),
        bus.on('levelUp', (p?: { level: number }) => { if (p) celebrate.push(p.level); }),
        bus.on('ui:back', back),
        bus.on('build:state', (p?: { active?: boolean }) => { building = !!p?.active; }),
        bus.on('build:end', () => { building = false; }),
        // o npc cancela o pagamento (cliente cansou/desistiu): fecha o painel com aviso, sem "Pago!"
        bus.on('checkout:cancel', (p?: { customerId?: number }) => {
          if (payPending && payPending.customerId === p?.customerId) payPending = null;
          if (pay.isOpen && pay.customerId === p?.customerId) pay.abort('O cliente cansou de esperar e o pagamento foi cancelado.');
        }),
        bus.on('checkoutAvailable', (p?: { customerId: number | null }) => { if (p?.customerId === null && !checkout.isOpen) legacyPending = null; }),
        bus.on('checkoutRequest', (req?: PayRequest) => {
          if (!req) return;
          if (req.stage === 'pay') { payPending = req; tryPay(); return; }
          legacyPending = req; // fluxo antigo (bipar no painel + pagar)
          tryLegacy();
        }),
        bus.on('quality:auto', (p: { quality: 'low' | 'medium' | 'high' }) => kit.settings.adopt({ quality: p.quality })),
        // Pedido automático do npc ("Pedido automático: 3 cx Arroz, 2 cx Feijão"): guarda para a aba Automático.
        bus.on('toast', (p: { text: string }) => {
          const items = parseAutoToast(p.text, kit.ctx.state);
          if (items.length) recordToday(kit.ctx.state.day, items);
        }),
      );
      keyHandler = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { kit.escape(); return; }
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !kit.isModalOpen()) tablet.open('market');
      };
      window.addEventListener('keydown', keyHandler);
      (window as unknown as { __ui?: unknown }).__ui = { kit, hud, tablet, pay, report, celebrate, missions, night, cart, levelSheet, endDay, storeSign };

      report.snapshotDay();
      hud.setDot(unseenTabs(ctx.state).size > 0);
      kit.settings.emit();
      menus.showTitle();
      // save danificado/incompatível (main.ts guardou uma cópia e começou um jogo novo): aviso claro, uma vez
      try {
        if (localStorage.getItem('mercadinho:save-recovered') !== null) {
          localStorage.removeItem('mercadinho:save-recovered');
          void kit.notice('Save recuperado', 'Seu save não pôde ser carregado; guardamos uma cópia e começamos um jogo novo.');
        }
      } catch { /* sem localStorage */ }
      ctx.bus.emit('toast', { text: `Bem-vindo à ${ctx.state.storeName}!`, kind: 'info' });
    },
    update(dt: number) {
      hud.update(dt);
      tablet.update(dt);
      checkout.update(dt);
      pay.update(dt);
      missions.update(dt);
      celebrate.update();
      night.sync();
      if (payPending) tryPay();
      if (legacyPending) tryLegacy();
      lvlT += dt;
      if (lvlT >= 0.25) { lvlT = 0; pollLevels(); }
      dotT += dt;
      if (dotT >= 1) { dotT = 0; hud.setDot(unseenTabs(kit.ctx.state).size > 0); }
    },
    dispose() {
      offs.forEach((f) => f());
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
      missions.dispose();
      rotate.dispose();
      kit.dispose();
      root?.remove();
      document.getElementById('mx-style')?.remove();
    },
  };
}
