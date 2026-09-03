package com.example.minweb;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Parcel;
import android.os.Process;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.net.InetAddress;

/**
 * The whole app. The WebView shows the game from SERVER_ORIGIN (manifest meta-data); this class adds
 *   - window.NativeBridge: rich haptics (Composition primitives), the browser login, the result hand-off,
 *     the "web is ready" signal and a few diagnostics;
 *   - a native title mask (one flat View, one draw call) painted on frame 1 while Chromium boots underneath;
 *   - Chrome Custom Tabs pre-warmed over raw Binder: warmup(), a session, and a mayLaunchUrl() hint for the
 *     login origin, so the login tab opens hot and already connected.
 *
 * Login: page -> launchAuth(SERVER/auth/<provider>?app=<nonce>) -> Custom Tab -> provider -> SERVER/callback
 *        -> <scheme>://oauth-callback?user&provider&state=<nonce> -> onNewIntent -> parked -> page pulls it
 *        with takeAuthResult() (works on cold start too, the page asks on load).
 */
public class MainActivity extends Activity {
    private static final int BG = 0xFF000000, FG = 0xFFCFD2FF, ACCENT = 0xFFFFE019, BTN = 0xFF070918, BTN_EDGE = 0xFF283066;
    private static final String CUSTOM_TABS_ACTION = "android.support.customtabs.action.CustomTabsService";
    private static final String CUSTOM_TABS_IFACE = "android.support.customtabs.ICustomTabsService";
    private static final String CUSTOM_TABS_CALLBACK = "android.support.customtabs.ICustomTabsCallback";
    private static final String EXTRA_SESSION = "android.support.customtabs.extra.SESSION";
    /** ICustomTabsService AIDL ids + FIRST_CALL_TRANSACTION(1): warmup=1, newSession=2, mayLaunchUrl=3 */
    private static final int TXN_WARMUP = 2, TXN_NEW_SESSION = 3, TXN_MAY_LAUNCH_URL = 4;

    private String serverOrigin = "https://marbles.secure.build";
    private String serverHost = "marbles.secure.build";
    private WebView web;
    private TitleMask overlay;
    private boolean webReady, startRequested, bound;
    private volatile boolean warmed, session, hinted;
    private String pendingResult;
    private Vibrator v;
    private boolean tick, lowTick, click, thud;
    /** our end of the Custom Tabs session (Chrome talks back to it; we ignore what it says) */
    private final Binder tabsCallback = new Binder();

    private Vibrator vibrator() {
        VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        Vibrator d = vm == null ? null : vm.getDefaultVibrator();
        return d != null && d.hasVibrator() ? d : null;
    }

    private final ServiceConnection tabsConnection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            warmed = transactBool(service, TXN_WARMUP, p -> p.writeLong(0));
            session = warmed && transactBool(service, TXN_NEW_SESSION, p -> p.writeStrongBinder(tabsCallback));
            // hint the login origin: Chrome pre-connects (DNS + TCP + TLS) and may pre-render; the nonce
            // added at click time does not matter for the connection warm-up
            hinted = session && transactBool(service, TXN_MAY_LAUNCH_URL, p -> {
                p.writeStrongBinder(tabsCallback);
                p.writeInt(1); Uri.parse(serverOrigin + "/auth/github").writeToParcel(p, 0);   // in Uri url
                p.writeInt(0);                                                                   // in Bundle extras (null)
                p.writeInt(-1);                                                                  // in List<Bundle> otherLikelyBundles (null)
            });
            System.out.println("[marbles] custom tabs warmup=" + warmed + " session=" + session + " mayLaunchUrl=" + hinted);
        }
        @Override public void onServiceDisconnected(ComponentName name) { session = false; }
    };

    private interface ParcelWriter { void write(Parcel p); }

    private static boolean transactBool(IBinder service, int code, ParcelWriter body) {
        Parcel data = Parcel.obtain(), reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(CUSTOM_TABS_IFACE);
            body.write(data);
            boolean ok = service.transact(code, data, reply, 0);       // false = code unknown to this browser
            reply.readException();
            return ok && reply.readInt() != 0;
        } catch (Exception e) {
            return false;
        } finally { data.recycle(); reply.recycle(); }
    }

    @Override
    protected void onCreate(Bundle state) {
        // boot on an elevated main thread; the kernel scheduler favours us over background daemons for these ms
        try { Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_DISPLAY); } catch (Exception ignored) {}
        // opaque surface: no alpha blending pass in SurfaceFlinger for this window
        getWindow().setFormat(PixelFormat.OPAQUE);
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

        // layer 0: the WebView boots and loads the game underneath, invisible until START
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                    // localStorage: lobby id, login nonce
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);        // the game is remote: 200 KB of code + 11 MB of audio want the HTTP cache
        s.setOffscreenPreRaster(true);                   // raster tiles while hidden behind the title mask
        s.setGeolocationEnabled(false);
        s.setNeedInitialFocus(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
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

        // layer 1: the title mask, a single flat View (no measure/layout tree, one onDraw)
        overlay = new TitleMask(this, String.valueOf(getApplicationInfo().loadLabel(getPackageManager())), () -> {
            hapticClick();
            if (webReady) dismissOverlay(); else { startRequested = true; overlay.setLoading(); }
        });
        root.addView(overlay, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        getWindow().setBackgroundDrawable(null);         // root paints BG itself: drop the window background layer (no overdraw)
        goFullscreen();

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

    /** http(s) URL in the pre-warmed Custom Tab session (or the default browser); @return "" or an error */
    private String openInBrowser(Uri u) {
        if (!"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) return "refused: only http(s) URLs may be opened";
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        Bundle extras = new Bundle();
        extras.putBinder(EXTRA_SESSION, session ? tabsCallback : null);   // our warm session, else a plain Custom Tab
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
    @JavascriptInterface public String browserPrewarmed() { return hinted ? "bound+warm+session+hint" : session ? "bound+warm+session" : warmed ? "bound+warm" : bound ? "bound" : "no"; }
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

    /** plain buzz (ms 1..1000) */
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

    /**
     * The frame-1 title screen: one View, three Paints, one onDraw. No TextView/Button/LinearLayout trees,
     * no measure or layout passes. Draws the app label and a START button in the game's palette.
     */
    static final class TitleMask extends View {
        private final Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint btnPaint = new Paint();
        private final Paint btnEdge = new Paint();
        private final Paint btnText = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Rect btn = new Rect();
        private final String title;
        private final Runnable onStart;
        private String btnLabel = "START";
        private final float d;

        TitleMask(Context ctx, String title, Runnable onStart) {
            super(ctx);
            this.title = title; this.onStart = onStart;
            d = ctx.getResources().getDisplayMetrics().density;
            setBackgroundColor(BG);
            titlePaint.setColor(FG); titlePaint.setTextSize(28 * d); titlePaint.setTextAlign(Paint.Align.CENTER);
            btnPaint.setColor(BTN);
            btnEdge.setColor(BTN_EDGE); btnEdge.setStyle(Paint.Style.STROKE); btnEdge.setStrokeWidth(Math.max(1f, d));
            btnText.setColor(ACCENT); btnText.setTextSize(16 * d); btnText.setTextAlign(Paint.Align.CENTER); btnText.setFakeBoldText(true);
        }

        void setLoading() { btnLabel = "LOADING..."; invalidate(); }

        @Override protected void onDraw(Canvas c) {
            int cx = getWidth() / 2, cy = getHeight() / 2;
            c.drawText(title, cx, cy - 24 * d, titlePaint);
            btn.set((int) (cx - 110 * d), (int) (cy + 8 * d), (int) (cx + 110 * d), (int) (cy + 56 * d));
            c.drawRect(btn, btnPaint);
            c.drawRect(btn, btnEdge);
            c.drawText(btnLabel, cx, btn.centerY() + 6 * d, btnText);
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            if (e.getAction() == MotionEvent.ACTION_UP && btn.contains((int) e.getX(), (int) e.getY())) { performClick(); onStart.run(); }
            return true;            // swallow everything: nothing may reach the WebView underneath
        }

        @Override public boolean performClick() { return super.performClick(); }
    }
}
