// Integração com o app Android (Capacitor). Em navegador comum não faz nada.
import { App } from '@capacitor/app';

const cap = (window as any).Capacitor;
if (cap?.isNativePlatform?.()) {
  const game = () => (window as any).__game;

  // WebView antiga demais (sem structuredClone/Object.hasOwn ou sem WebGL): aviso amigável.
  let webglOk = false;
  try { webglOk = !!document.createElement('canvas').getContext('webgl2'); } catch { /* sem WebGL */ }
  if (!webglOk || typeof structuredClone !== 'function' || !(Object as any).hasOwn) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:16px sans-serif';
    d.textContent = 'O Android System WebView deste celular está desatualizado. Atualize "Android System WebView" e o Google Chrome na Play Store e abra o app de novo.';
    document.body.appendChild(d);
  }

  void App.addListener('pause', () => { try { game()?.save(); } catch { /* ignora */ } });
  void App.addListener('backButton', () => { game()?.bus.emit('ui:back'); });
  // Registro adiado: main.ts cria window.__game depois dos imports.
  setTimeout(() => { game()?.bus.on('app:exit', () => { try { game()?.save(); } catch { /* ignora */ } void App.exitApp(); }); }, 0);

  // Taxa da tela casada com o limite de FPS (MainActivity.DisplayBridge): 60 fps → tela em 60 Hz em vez de 120 Hz.
  const display = (fps: unknown): void => {
    if (fps !== 30 && fps !== 60 && fps !== 0) return;
    try { (window as any).MercadinhoDisplay?.setMaxFps?.(fps); } catch { /* APK antigo sem a ponte */ }
  };
  try { display((JSON.parse(localStorage.getItem('mercadinho:settings') ?? '{}') as { maxFps?: unknown }).maxFps ?? 60); } catch { display(60); }
  setTimeout(() => { game()?.bus.on('settings:changed', (p?: { maxFps?: unknown }) => display(p?.maxFps)); }, 0);
}
