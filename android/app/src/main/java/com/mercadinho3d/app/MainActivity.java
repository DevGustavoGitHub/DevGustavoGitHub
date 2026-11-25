package com.mercadinho3d.app;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        WindowCompat.setDecorFitsSystemWindows(w, false);
        immersive();
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) wv.addJavascriptInterface(new DisplayBridge(), "MercadinhoDisplay");
    }

    /**
     * Ponte JS → Android (src/native.ts): o jogo pede a taxa da tela que combina com o limite de FPS do jogador.
     * Com o limite de 60 (padrão) numa tela de 120 Hz, a tela passa a 60 Hz enquanto o jogo está aberto: o WebView
     * deixa de compor quadros que o jogo não desenha (menos bateria e calor; mesma ideia do Android Frame Pacing).
     * "Sem limite" volta para a taxa mais alta.
     */
    public class DisplayBridge {
        @JavascriptInterface
        public void setMaxFps(final int fps) { runOnUiThread(() -> applyRefreshRate(fps)); }
    }

    private void applyRefreshRate(int fps) {
        try {
            Window w = getWindow();
            Display d = getWindowManager().getDefaultDisplay();
            if (d == null) return;
            Display.Mode cur = d.getMode();
            float target = fps <= 0 ? Float.MAX_VALUE : (fps < 60 ? 60f : fps); // 30 fps = metade de 60 Hz
            Display.Mode best = null;
            for (Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() != cur.getPhysicalWidth() || m.getPhysicalHeight() != cur.getPhysicalHeight()) continue;
                if (best == null || Math.abs(m.getRefreshRate() - target) < Math.abs(best.getRefreshRate() - target)) best = m;
            }
            if (best == null) return;
            WindowManager.LayoutParams lp = w.getAttributes();
            if (lp.preferredDisplayModeId == best.getModeId()) return;
            lp.preferredDisplayModeId = best.getModeId();
            w.setAttributes(lp);
        } catch (RuntimeException e) {
            // aparelho sem troca de modo: segue na taxa padrão (o limite de FPS do jogo continua valendo)
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    public void onResume() {
        super.onResume();
        immersive();
    }

    private void immersive() {
        Window w = getWindow();
        View decor = w.getDecorView();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, decor);
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
