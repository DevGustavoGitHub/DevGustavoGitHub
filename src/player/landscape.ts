/**
 * FASE 4 — paisagem no NAVEGADOR: no primeiro gesto de toque tenta tela cheia + `screen.orientation.lock('landscape')`
 * (falhas silenciosas; o aviso "Gire o celular" da UI continua como reserva). Não faz nada no app nativo
 * (Capacitor: o Android já trava em sensorLandscape), dentro de iframe (artefato) nem sob WebDriver (testes),
 * salvo `?fs=1` na URL. O gesto de ativação de toque é o `pointerup` (o `pointerdown` de toque não ativa).
 */
export interface LandscapeInfo {
  state: 'idle' | 'skipped' | 'trying' | 'done' | 'failed';
  reason: string;
  tries: number;
  fullscreen: boolean;
  locked: boolean;
}

export function setupLandscape(): { info: () => LandscapeInfo; dispose: () => void } {
  const info: LandscapeInfo = { state: 'idle', reason: '', tries: 0, fullscreen: false, locked: false };
  const snap = (): LandscapeInfo => ({ ...info });
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  let native = false;
  try { native = !!cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : true); } catch { native = !!cap; }
  let framed = true;
  try { framed = window.self !== window.top; } catch { framed = true; }
  const forced = /[?&]fs=1(&|$)/.test(location.search);
  const skip = native ? 'native' : framed ? 'iframe' : navigator.webdriver && !forced ? 'webdriver' : '';
  if (skip) { info.state = 'skipped'; info.reason = skip; return { info: snap, dispose: () => {} }; }

  const errName = (e: unknown): string => (e instanceof Error ? e.name || e.message : String(e));
  const attempt = async (): Promise<void> => {
    info.tries++;
    info.state = 'trying';
    info.reason = '';
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') await el.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { info.reason = `fullscreen: ${errName(e)}`; }
    info.fullscreen = !!document.fullscreenElement;
    try {
      const o = (screen as unknown as { orientation?: { lock?: (t: string) => Promise<void> } }).orientation;
      if (o && typeof o.lock === 'function') { await o.lock('landscape'); info.locked = true; } else if (!info.reason) info.reason = 'lock: sem suporte';
    } catch (e) { info.reason += `${info.reason ? '; ' : ''}lock: ${errName(e)}`; }
    info.state = info.fullscreen || info.locked ? 'done' : 'failed';
    if (info.state === 'done' || info.tries >= 2) off();
  };
  const onGesture = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || info.state === 'trying') return; // desktop: nada de tela cheia forçada
    void attempt().catch(() => { info.state = 'failed'; });
  };
  const off = (): void => window.removeEventListener('pointerup', onGesture, true);
  window.addEventListener('pointerup', onGesture, true);
  return { info: snap, dispose: off };
}
