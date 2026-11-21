/**
 * Módulo de UI (DOM/CSS): HUD, tablet de gestão, minigame de checkout, relatório de fim de dia, menus e tutorial.
 * Eventos: ver docs/CONTRACTS.md. Só muda estado via sim/api.ts (e economy.ts para licenças/preços).
 */
import type { GameContext, GameModule } from '../core/module';
import { Bankruptcy } from './bankruptcy';
import { Checkout, type CheckoutRequest } from './checkout';
import { h } from './dom';
import { Hud } from './hud';
import { UiKit } from './kit';
import { Menus } from './menu';
import { Report } from './report';
import { baseCss } from './styles-base';
import { playCss } from './styles-play';
import { phase2Css, scaleFonts } from './styles-phase2';
import { tabletCss } from './styles-tablet';
import { Tablet } from './tablet';
import { Tutorial } from './tutorial';
import { parseAutoToast, recordToday } from './tablet/auto';

export default function create(): GameModule {
  let kit: UiKit;
  let root: HTMLElement;
  let hud: Hud;
  let tablet: Tablet;
  let checkout: Checkout;
  let report: Report;
  let menus: Menus;
  let tutorial: Tutorial;
  let bankrupt: Bankruptcy;
  let pending: CheckoutRequest | null = null;
  let available = false;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  const offs: (() => void)[] = [];

  const tryOpenPending = (): void => {
    if (!pending || checkout.isOpen || kit.isModalOpen()) return;
    const req = pending;
    pending = null;
    checkout.open(req);
  };
  const syncAttend = (): void => hud.setAttend((available || pending !== null) && !checkout.isOpen);

  const endDay = (): void => {
    if (report.isOpen) return;
    const { phase } = kit.ctx.clock;
    if (phase === 'report') return;
    if (phase === 'open' || phase === 'prep') {
      void kit.confirm({ title: 'Encerrar o dia agora?', text: 'Os clientes que ainda estão na loja vão embora e o relatório do dia será gerado.', ok: 'Encerrar dia' })
        .then((ok) => { if (ok) report.show(); });
      return;
    }
    void kit.confirm({ title: 'Encerrar o dia?', text: 'Ainda pode haver clientes na loja. Eles vão embora e o relatório será gerado.', ok: 'Encerrar dia' })
      .then((ok) => { if (ok) report.show(); });
  };

  return {
    name: 'ui',
    init(ctx: GameContext) {
      kit = new UiKit(ctx);
      const style = h('style', { id: 'mx-style' });
      style.textContent = scaleFonts(baseCss + tabletCss + playCss + phase2Css);
      document.head.appendChild(style);
      root = h('div', { class: 'mx-root', style: 'pointer-events:none' });
      ctx.uiRoot.appendChild(root);
      kit.attachLayer(root);
      kit.settings.bindRoot(root);

      hud = new Hud(kit, root, {
        openTablet: () => tablet.open(),
        openMenu: () => menus.showPause(),
        endDay,
        attend: () => {
          if (pending) { if (kit.isModalOpen()) return; const r = pending; pending = null; checkout.open(r); syncAttend(); }
          else kit.toast('Vá até o caixa para atender o cliente.', 'info');
        },
      });
      tablet = new Tablet(kit, root);
      bankrupt = new Bankruptcy(kit, root);
      tablet.guard = () => bankrupt.check();
      tablet.onOpen = () => tutorial.noteTabletOpened();
      checkout = new Checkout(kit, root);
      report = new Report(kit, root);
      report.afterNext = () => { bankrupt.check(); };
      tutorial = new Tutorial(kit, hud);
      menus = new Menus(kit, root, {
        endDay,
        replayTutorial: () => tutorial.start(true),
        onStart: () => { kit.settings.emit(); if (!bankrupt.check()) tutorial.start(); },
      });

      const bus = ctx.bus;
      offs.push(
        bus.on('storeEmpty', () => { if (!report.isOpen) report.show(); }),
        bus.on('checkoutAvailable', (p: { customerId: number | null }) => {
          available = p.customerId !== null;
          if (!available && !checkout.isOpen) pending = null;
          syncAttend();
        }),
        bus.on('checkoutRequest', (req: CheckoutRequest) => {
          pending = req;
          tryOpenPending();
          syncAttend();
        }),
        bus.on('dayStarted', () => report.snapshotDay()),
        // Pedido automático feito pelo npc (toast "Pedido automático: 3 cx Arroz, 2 cx Feijão"): guarda para a aba Automático.
        bus.on('toast', (p: { text: string }) => {
          const items = parseAutoToast(p.text, kit.ctx.state);
          if (items.length) recordToday(kit.ctx.state.day, items);
        }),
      );
      keyHandler = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') kit.escape();
      };
      window.addEventListener('keydown', keyHandler);

      report.snapshotDay();
      kit.settings.emit();
      menus.showTitle();
      ctx.bus.emit('toast', { text: `Bem-vindo à ${ctx.state.storeName}!`, kind: 'info' });
    },
    update(dt: number) {
      hud.update(dt);
      tablet.update(dt);
      checkout.update(dt);
      tutorial.update(dt);
      if (pending) { tryOpenPending(); syncAttend(); }
    },
    dispose() {
      offs.forEach((f) => f());
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
      root?.remove();
      document.getElementById('mx-style')?.remove();
    },
  };
}
