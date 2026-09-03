package com.example.minweb;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Parcel;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.InetAddress;

/**
 * The whole app. The WebView shows the game from SERVER_ORIGIN (manifest meta-data); this class adds
 *   - window.NativeBridge: rich haptics (Composition primitives), the browser login, the result hand-off,
 *     the "web is ready" signal and a few diagnostics;
 *   - a native title overlay painted on frame 1 while Chromium boots underneath;
 *   - a pre-warmed Chrome Custom Tabs service (raw Binder warmup) so the login tab opens without a cold start.
 *
 * Login: page -> launchAuth(SERVER/auth/<provider>?app=<nonce>) -> Custom Tab -> provider -> SERVER/callback
 *        -> <scheme>://oauth-callback?user&provider&state=<nonce> -> onNewIntent -> parked -> page pulls it
 *        with takeAuthResult() (works on cold start too, the page asks on load).
 */
public class MainActivity extends Activity {
    private static final int BG = 0xFF000000, FG = 0xFFCFD2FF, ACCENT = 0xFFFFE019, BTN = 0xFF070918;
    private static final String CUSTOM_TABS_ACTION = "android.support.customtabs.action.CustomTabsService";
    private static final String CUSTOM_TABS_IFACE = "android.support.customtabs.ICustomTabsService";
    /** ICustomTabsService.warmup(long): AIDL id 1 + FIRST_CALL_TRANSACTION */
    private static final int TXN_WARMUP = 2;

    private String serverOrigin = "https://marbles.secure.build";
    private String serverHost = "marbles.secure.build";
    private WebView web;
    private LinearLayout overlay;
    private Button startBtn;
    private boolean webReady, startRequested, bound;
    private volatile boolean warmed;
    private String pendingResult;
    private Vibrator v;
    private boolean tick, lowTick, click, thud;

    private Vibrator vibrator() {
        VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        Vibrator d = vm == null ? null : vm.getDefaultVibrator();
        return d != null && d.hasVibrator() ? d : null;
    }

    private final ServiceConnection tabsConnection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            Parcel data = Parcel.obtain(), reply = Parcel.obtain();
            try {
                data.writeInterfaceToken(CUSTOM_TABS_IFACE);
                data.writeLong(0);
                boolean ok = service.transact(TXN_WARMUP, data, reply, 0);
                reply.readException();
                warmed = ok && reply.readInt() != 0;
            } catch (Exception ignored) {
            } finally { data.recycle(); reply.recycle(); }
        }
        @Override public void onServiceDisconnected(ComponentName name) {}
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        readConfig();
        v = vibrator();
        if (v != null) {
            tick = v.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_TICK);
            click = v.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_CLICK);
            lowTick = v.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_LOW_TICK);
            thud = v.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_THUD);
        }
        preheatBrowser();
        prefetchDns();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setBackgroundColor(BG);
        web.addJavascriptInterface(this, "NativeBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (serverHost.equals(u.getHost())) return false;          // the game stays in the WebView
                openInBrowser(u);                                            // anything else: Custom Tab
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        overlay = buildOverlay();
        root.addView(overlay, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        goFullscreen();                                                 // needs the decor view: after setContentView

        if (handleRedirect(getIntent())) startRequested = true;         // back from the login: no title screen
        if (state != null) web.restoreState(state); else web.loadUrl(serverOrigin + "/");
    }

    private void readConfig() {
        try {
            ApplicationInfo ai = getPackageManager().getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
            String o = ai.metaData == null ? null : ai.metaData.getString("build.secure.marbles.SERVER_ORIGIN");
            if (o != null && !o.isEmpty()) { serverOrigin = o.replaceAll("/+$", ""); serverHost = Uri.parse(serverOrigin).getHost(); }
        } catch (Exception ignored) {}
    }

    private void goFullscreen() {
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) { c.hide(WindowInsets.Type.systemBars()); c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); }
        getWindow().getDecorView().setKeepScreenOn(true);
    }

    private LinearLayout buildOverlay() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(BG);
        TextView title = new TextView(this);
        title.setText(getApplicationInfo().loadLabel(getPackageManager()));
        title.setTextSize(28);
        title.setTextColor(FG);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 0, 0, 48);
        startBtn = new Button(this);
        startBtn.setText("START");
        startBtn.setTextColor(ACCENT);
        startBtn.setBackgroundColor(BTN);
        startBtn.setPadding(72, 24, 72, 24);
        startBtn.setOnClickListener(x -> {
            hapticClick();
            if (webReady) dismissOverlay(); else { startRequested = true; startBtn.setText("LOADING..."); }
        });
        l.addView(title);
        l.addView(startBtn);
        return l;
    }

    private void dismissOverlay() {
        if (overlay.getVisibility() != View.GONE) {
            overlay.setVisibility(View.GONE);
            web.evaluateJavascript("window.onAppStarted && window.onAppStarted()", null);
        }
    }

    private void preheatBrowser() {
        Intent i = new Intent(CUSTOM_TABS_ACTION);
        i.setPackage("com.android.chrome");
        try { bound = bindService(i, tabsConnection, BIND_AUTO_CREATE); } catch (Exception e) { bound = false; }
    }

    private void prefetchDns() {
        final String[] hosts = { serverHost, "github.com", "x.com", "api.x.com" };
        new Thread(() -> { for (String h : hosts) { try { InetAddress.getAllByName(h); } catch (Exception ignored) {} } }).start();
    }

    /** http(s) URL in a Custom Tab (pre-warmed Chrome) or the default browser; @return "" or an error */
    private String openInBrowser(Uri u) {
        if (!"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) return "refused: only http(s) URLs may be opened";
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        Bundle extras = new Bundle();
        extras.putBinder("android.support.customtabs.extra.SESSION", null);   // Custom Tab request without AndroidX
        i.putExtras(extras);
        i.setPackage("com.android.chrome");
        try { startActivity(i); }
        catch (ActivityNotFoundException e) {
            i.setPackage(null);
            try { startActivity(i); } catch (ActivityNotFoundException e2) { return "no browser installed"; }
        }
        return "";
    }

    // ------------------------------------------------------------------ login result hand-off
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (handleRedirect(intent)) {
            dismissOverlay();
            web.evaluateJavascript("window.onAuthComplete && window.onAuthComplete()", null);
        }
    }

    private boolean handleRedirect(Intent intent) {
        if (intent == null) return false;
        Uri u = intent.getData();
        if (u == null || !"oauth-callback".equals(u.getHost())) return false;
        StringBuilder b = new StringBuilder("{");
        for (String k : new String[] { "user", "provider", "state", "error" }) {
            String val = u.getQueryParameter(k);
            if (val != null) { if (b.length() > 1) b.append(','); b.append('"').append(k).append("\":").append(json(val)); }
        }
        pendingResult = b.append('}').toString();
        return true;
    }

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    // ------------------------------------------------------------------ window.NativeBridge
    @JavascriptInterface public void onWebReady() { runOnUiThread(() -> { webReady = true; if (startRequested) dismissOverlay(); }); }
    @JavascriptInterface public String takeAuthResult() { String r = pendingResult; pendingResult = null; return r; }
    @JavascriptInterface public String launchAuth(String url) { return openInBrowser(Uri.parse(url)); }
    @JavascriptInterface public String browserPrewarmed() { return warmed ? "bound+warm" : bound ? "bound" : "no"; }
    @JavascriptInterface public String serverOrigin() { return serverOrigin; }

    /** capabilities as JSON so the page can adapt */
    @JavascriptInterface public String caps() {
        return "{\"vibrator\":" + (v != null) + ",\"tick\":" + tick + ",\"lowTick\":" + lowTick + ",\"click\":" + click
                + ",\"thud\":" + thud + ",\"amplitude\":" + (v != null && v.hasAmplitudeControl()) + "}";
    }

    /** trackball detent: light crisp tick, scale 0..1 with speed */
    @JavascriptInterface public void tick(float scale) {
        if (v == null) return;
        float k = Math.max(0.1f, Math.min(scale, 1f));
        if (lowTick && k < 0.35f) v.vibrate(VibrationEffect.startComposition().addPrimitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, k * 2f, 0).compose());
        else if (tick) v.vibrate(VibrationEffect.startComposition().addPrimitive(VibrationEffect.Composition.PRIMITIVE_TICK, k, 0).compose());
        else v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK));
    }

    /** wall bounce / marble collision: sharp click scaled with impact */
    @JavascriptInterface public void impact(float scale) {
        if (v == null) return;
        float k = Math.max(0.2f, Math.min(scale, 1f));
        if (click) v.vibrate(VibrationEffect.startComposition().addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, k, 0).compose());
        else v.vibrate(VibrationEffect.createPredefined(k > 0.6f ? VibrationEffect.EFFECT_HEAVY_CLICK : VibrationEffect.EFFECT_CLICK));
    }

    /** landing after a fall / shatter: heavy downward thud */
    @JavascriptInterface public void thud() {
        if (v == null) return;
        if (thud) v.vibrate(VibrationEffect.startComposition().addPrimitive(VibrationEffect.Composition.PRIMITIVE_THUD, 1f, 0).compose());
        else v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK));
    }

    @JavascriptInterface public void hapticClick() {
        if (v != null) v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK));
    }

    /** plain buzz (ms 1..1000, amplitude 1..255) */
    @JavascriptInterface public void vibrate(long ms) {
        if (v != null) v.vibrate(VibrationEffect.createOneShot(Math.max(1, Math.min(ms, 1000)), VibrationEffect.DEFAULT_AMPLITUDE));
    }

    @JavascriptInterface public void buzz(int ms, int amplitude) {
        if (v == null) return;
        v.vibrate(VibrationEffect.createOneShot(Math.max(1, Math.min(ms, 1000)), v.hasAmplitudeControl() ? Math.max(1, Math.min(amplitude, 255)) : VibrationEffect.DEFAULT_AMPLITUDE));
    }

    @JavascriptInterface public void cancelHaptics() { if (v != null) v.cancel(); }

    // ------------------------------------------------------------------ lifecycle
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() {
        if (bound) { try { unbindService(tabsConnection); } catch (Exception ignored) {} }
        web.destroy();
        super.onDestroy();
    }
}
