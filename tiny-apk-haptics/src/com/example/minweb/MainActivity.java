package com.example.minweb;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
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

import java.io.InputStream;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.StringWriter;
import java.net.InetAddress;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;

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
    private TitleSplash overlay;          // the game's own title screen, drawn natively for frame 1; lifted when the page is ready
    private boolean webReady, startRequested, bound;
    private volatile boolean warmed, session, hinted;
    private String pendingResult;
    private Vibrator v;
    private boolean tick, lowTick, click, thud;
    private final TrackballHaptics trackball = new TrackballHaptics();
    private SharedPreferences prefs;
    /** Custom Tabs navigation events (ICustomTabsCallback.onNavigationEvent) */
    private static final int NAV_STARTED = 1, NAV_FINISHED = 2, NAV_FAILED = 3, NAV_ABORTED = 4, TAB_SHOWN = 5, TAB_HIDDEN = 6;
    /** our end of the Custom Tabs session: Chrome reports tab/navigation events into it (AIDL id 1 -> code 2, oneway) */
    private final Binder tabsCallback = new Binder() {
        @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) {
            if (code == 2) {
                data.enforceInterface(CUSTOM_TABS_CALLBACK);
                final int event = data.readInt();
                System.out.println("[marbles] custom tab event " + event);
                // let the page know (TAB_HIDDEN with no result following = the user backed out of the login)
                runOnUiThread(() -> web.evaluateJavascript("window.onAuthTabEvent && window.onAuthTabEvent(" + event + ")", null));
                return true;                       // oneway: no reply parcel to fill
            }
            return false;                          // other callbacks: not handled, Chrome does not mind
        }
    };

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
        prefs = getSharedPreferences("mm", MODE_PRIVATE);
        System.out.println("[marbles] start, pending crash=" + prefs.contains("crash") + " handler=" + Thread.getDefaultUncaughtExceptionHandler());
        installCrashHook();
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
            /** Chromium's renderer died (OOM or crash). Default would be to kill the app; instead note it as a
             *  crash report and rebuild the Activity, which gives the game a fresh WebView. */
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail d) {
                prefs.edit().putString("crash", "WebView renderer gone: " + (d.didCrash() ? "crashed" : "killed by the system (memory)")
                        + ", priority " + d.rendererPriorityAtExit()).commit();
                runOnUiThread(MainActivity.this::recreate);
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // layer 1: the game's title screen (logo, live High Rollers, PRESS START, Chrome + MCP icons) drawn natively
        // and laid out for the phone's height, so the first frame already looks like the game. The page's own title
        // screen has the same composition and takes over on onWebReady(); 8 s timeout so an offline error page is
        // never hidden forever.
        overlay = new TitleSplash(this);
        root.addView(overlay, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.postDelayed(this::dismissOverlay, 8000);
        loadSplash();
        // keep the page clear of the navigation/gesture zone and display cutouts: swipes that start in the system's
        // bottom gesture area never reach the page, and the on-screen trackball lives at the bottom of the page
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets in = insets.getInsets(WindowInsets.Type.navigationBars() | WindowInsets.Type.displayCutout());
            v.setPadding(in.left, 0, in.right, in.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);
        getWindow().setBackgroundDrawable(null);         // root paints BG itself: drop the window background layer (no overdraw)
        goFullscreen();

        if (handleRedirect(getIntent())) startRequested = true;         // back from the login: no title screen
        debugTriggers(getIntent());
        // the platform tag lets the site tell browser / PWA / app traffic apart; installs are proven separately
        if (state != null) web.restoreState(state);
        else web.loadUrl(serverOrigin + "/?platform=android_apk" + (prefs.getBoolean("installed", false) ? "" : "&install=1"));
    }

    // ------------------------------------------------------------------ telemetry (authentic, via the page's session)
    /** Java crashes: write the trace synchronously, let the process die, hand it to the page on the next launch. */
    private void installCrashHook() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));            // not Log.getStackTraceString: R8 strips Log calls
                String trace = sw.toString();
                boolean ok = prefs.edit().putString("crash", trace.substring(0, Math.min(trace.length(), 16000))).commit();
                System.out.println("[marbles] crash parked=" + ok);
            } catch (Throwable x) { System.out.println("[marbles] crash park failed " + x); }
            if (previous != null) previous.uncaughtException(t, e);
        });
    }

    /** the parked crash trace (JSON) or null; clears it. The page posts it with its own cookies. */
    @JavascriptInterface public String consumePendingCrash() {
        String c = prefs.getString("crash", null);
        System.out.println("[marbles] consumePendingCrash pending=" + (c != null));
        if (c == null) return null;
        prefs.edit().remove("crash").apply();
        return "{\"stack\":" + json(c) + ",\"device\":" + deviceInfo() + "}";
    }

    /** model / OS / app version, for crash and event context */
    @JavascriptInterface public String deviceInfo() {
        String ver = "?";
        try { PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0); ver = pi.versionName + " (" + pi.getLongVersionCode() + ")"; } catch (Exception ignored) {}
        return "{\"model\":" + json(Build.MANUFACTURER + " " + Build.MODEL) + ",\"sdk\":" + Build.VERSION.SDK_INT + ",\"app\":" + json(ver) + "}";
    }

    /**
     * Challenge-response install proof. The server minted `nonce` for this page load; we answer with
     * sha256(nonce + ":" + sha256(our signing certificate)). The server knows the release certificate, so
     * curl, crawlers and re-signed APKs cannot produce a valid proof. Answered once per device: the flag in
     * prefs plus a key in the hardware keystore, which survives a data clear.
     */
    @JavascriptInterface public String signInstallChallenge(String nonce) {
        if (nonce == null || !nonce.matches("[A-Za-z0-9_-]{8,64}")) return null;
        if (prefs.getBoolean("installed", false) || !freshDevice()) { prefs.edit().putBoolean("installed", true).apply(); return null; }
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
            byte[] cert = pi.signingInfo.getApkContentsSigners()[0].toByteArray();
            String fp = hex(MessageDigest.getInstance("SHA-256").digest(cert));
            String proof = hex(MessageDigest.getInstance("SHA-256").digest((nonce + ":" + fp).getBytes("UTF-8")));
            prefs.edit().putBoolean("installed", true).apply();
            return "{\"nonce\":" + json(nonce) + ",\"proof\":" + json(proof) + ",\"device\":" + deviceInfo() + "}";
        } catch (Exception e) {
            return null;
        }
    }

    /** creates the device anchor key on first call; false if it already existed (device already counted) */
    private boolean freshDevice() {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias("mm_device")) return false;
            KeyPairGenerator kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            kpg.initialize(new KeyGenParameterSpec.Builder("mm_device", KeyProperties.PURPOSE_SIGN).setDigests(KeyProperties.DIGEST_SHA256).build());
            kpg.generateKeyPair();
            return true;
        } catch (Exception e) {
            return true;                                            // no keystore: fall back to the prefs flag alone
        }
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    // ------------------------------------------------------------------ trackball haptic engine (bridge)
    /** finger down; omega = current ball speed (rad/s): catching a spinning ball slips, then thuds */
    @JavascriptInterface public void tbDown(float omega) { trackball.down(omega); }
    /** static friction broke: one heavy low tick */
    @JavascriptInterface public void tbBreakout() { trackball.breakout(); }
    /** ball rolled dAngle radians under the finger at omega rad/s: bearing ticks every 6 degrees */
    @JavascriptInterface public void tbRoll(float dAngle, float omega) { trackball.roll(dAngle, omega); }
    /** finger spinning against the ball's motion */
    @JavascriptInterface public void tbBrake(float omega) { trackball.brake(omega); }
    /** finger lifted: silence at once, the ball spins on in audio only */
    @JavascriptInterface public void tbUp() { trackball.up(); }

    /**
     * Haptics for a 3-inch, 550 g phenolic arcade trackball on steel rollers. Everything is driven by angle
     * rolled, never by time: ticks fall where the encoder teeth would (60 per revolution), amplitude follows
     * speed, and the actuator is muted the instant the finger leaves so the ball feels detached.
     */
    final class TrackballHaptics {
        static final float STEP = (float) Math.toRadians(6);      // 60 ticks per revolution
        static final float MAX_OMEGA = 32f;                        // matches the web simulation's clamp
        static final long MIN_GAP_MS = 28;                         // >35 Hz would smear into a buzz: drop ticks instead
        float accum; boolean touching; long lastTick;

        void down(float omega) {
            touching = true; accum = 0;
            if (v == null || omega < 2f) return;
            float k = Math.min(1f, omega / 15f);
            VibrationEffect.Composition c = VibrationEffect.startComposition();
            if (lowTick) { c.addPrimitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.35f, 0).addPrimitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.35f, 18); } // skin slipping on the moving resin
            if (thud) c.addPrimitive(VibrationEffect.Composition.PRIMITIVE_THUD, k, 30);                 // the ball's energy dumped into the hand
            else if (click) c.addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, k, 30);
            else { v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)); return; }
            v.vibrate(c.compose());
        }

        void breakout() {
            if (v == null) return;
            if (lowTick) v.vibrate(VibrationEffect.startComposition().addPrimitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 1f, 0).compose());
            else if (tick) v.vibrate(VibrationEffect.startComposition().addPrimitive(VibrationEffect.Composition.PRIMITIVE_TICK, 1f, 0).compose());
            else v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK));
        }

        void roll(float dAngle, float omega) {
            if (!touching || v == null) return;
            accum += Math.abs(dAngle);
            if (accum < STEP) return;
            int n = (int) (accum / STEP);
            accum -= n * STEP;
            long now = android.os.SystemClock.uptimeMillis();
            if (now - lastTick < MIN_GAP_MS) return;                 // too fast for the actuator: this tooth is skipped
            lastTick = now;
            float a = 0.2f + 0.8f * Math.min(1f, omega / MAX_OMEGA);
            if (n > 1) a = Math.min(1f, a * 1.25f);                 // skipped teeth: one slightly stronger tick
            if (tick) v.vibrate(VibrationEffect.startComposition().addPrimitive(VibrationEffect.Composition.PRIMITIVE_TICK, a, 0).compose());
            else v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK));
        }

        void brake(float omega) {
            if (v == null) return;
            float k = Math.min(1f, 0.4f + omega / MAX_OMEGA);
            VibrationEffect.Composition c = VibrationEffect.startComposition();
            if (lowTick) c.addPrimitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.5f, 0).addPrimitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.5f, 16);
            if (click) c.addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, k, 24); else { v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)); return; }
            v.vibrate(c.compose());
        }

        void up() {
            touching = false; accum = 0;
            if (v != null) v.cancel();
        }
    }

    private void readConfig() {
        try {
            ApplicationInfo ai = getPackageManager().getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
            String o = ai.metaData == null ? null : ai.metaData.getString("build.secure.marbles.SERVER_ORIGIN");
            if (o != null && !o.isEmpty()) { serverOrigin = o.replaceAll("/+$", ""); serverHost = Uri.parse(serverOrigin).getHost(); }
            if (ai.metaData != null && ai.metaData.getBoolean("build.secure.marbles.DEBUG_WEBVIEW", false)) WebView.setWebContentsDebuggingEnabled(true);   // chrome://inspect
        } catch (Exception ignored) {}
    }

    private void goFullscreen() {
        getWindow().setDecorFitsSystemWindows(false);            // edge to edge; the root pads itself for the nav bar / cutout
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            c.hide(WindowInsets.Type.statusBars());               // status bar only: the nav/gesture bar stays, below the page
            c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            // when the bars do peek in, light icons on our black background
            c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
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
        // look like a modal of the game, not a browser: black toolbar/nav bar, dark scheme, no share, no page title,
        // URL bar pinned so the login form does not jump while scrolling
        extras.putInt("android.support.customtabs.extra.TOOLBAR_COLOR", BG);
        extras.putInt("androidx.browser.customtabs.extra.NAVIGATION_BAR_COLOR", BG);
        extras.putInt("androidx.browser.customtabs.extra.NAVIGATION_BAR_DIVIDER_COLOR", BTN_EDGE);
        extras.putInt("androidx.browser.customtabs.extra.COLOR_SCHEME", 2);              // dark
        extras.putInt("androidx.browser.customtabs.extra.SHARE_STATE", 2);               // share off
        extras.putBoolean("android.support.customtabs.extra.ENABLE_URLBAR_HIDING", false);
        extras.putInt("android.support.customtabs.extra.TITLE_VISIBILITY_STATE", 0);      // domain + padlock only
        // wide screens (tablets, unfolded foldables): a 480 dp side sheet at the end instead of a stretched bottom sheet
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        if (dm.widthPixels / dm.density >= 840) {
            extras.putInt("androidx.browser.customtabs.extra.INITIAL_ACTIVITY_WIDTH_PX", (int) (480 * dm.density));
            extras.putInt("androidx.browser.customtabs.extra.ACTIVITY_SIDE_SHEET_POSITION", 2);
            extras.putInt("androidx.browser.customtabs.extra.ACTIVITY_SIDE_SHEET_DECORATION_TYPE", 1);
        }
        // fade in / fade out instead of Chrome's slide; the exit bundle is applied when the tab closes
        Bundle anim = ActivityOptions.makeCustomAnimation(this, android.R.anim.fade_in, android.R.anim.fade_out).toBundle();
        extras.putBundle("android.support.customtabs.extra.EXIT_ANIMATION_BUNDLE", anim);
        i.putExtras(extras);
        i.setPackage("com.android.chrome");
        try { startActivity(i, anim); }
        catch (ActivityNotFoundException e) {
            i.setPackage(null);
            try { startActivity(i, anim); } catch (ActivityNotFoundException e2) { return "no browser installed"; }
        }
        return "";
    }

    // ------------------------------------------------------------------ login result hand-off
    /** test builds only (plain-http server, i.e. an emulator against a local server): fault injection from adb
     *    am start -n <app>/com.example.minweb.MainActivity --ez debug_crash true         Java crash in our process
     *    am start -n <app>/com.example.minweb.MainActivity --ez debug_renderer_crash true  kill the WebView renderer */
    private void debugTriggers(Intent intent) {
        if (intent == null || !serverOrigin.startsWith("http://")) return;
        boolean crash = intent.getBooleanExtra("debug_crash", false), renderer = intent.getBooleanExtra("debug_renderer_crash", false);
        intent.removeExtra("debug_crash"); intent.removeExtra("debug_renderer_crash");     // one shot: recreate() re-delivers the intent
        if (crash) web.postDelayed(() -> { throw new IllegalStateException("debug_crash from adb"); }, 500);
        if (renderer) web.postDelayed(() -> web.loadUrl("chrome://crash"), 500);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        debugTriggers(intent);
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
    @JavascriptInterface public void onWebReady() { runOnUiThread(() -> { webReady = true; dismissOverlay(); }); }
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

    // ------------------------------------------------------------------ native title splash
    /** decode the art and the bitmap font off the UI thread, show the cached High Rollers at once, then refresh them */
    private void loadSplash() {
        new Thread(() -> {
            try {
                Bitmap art = BitmapFactory.decodeStream(getAssets().open("title.webp"));
                Bitmap font = BitmapFactory.decodeStream(getAssets().open("font.png"));
                JSONObject meta = new JSONObject(readAsset("font.json"));
                runOnUiThread(() -> overlay.setAssets(art, font, meta));
            } catch (Exception e) { System.out.println("[marbles] splash assets: " + e); }
            String cached = prefs.getString("rollers", null);
            if (cached != null) { final String[][] rows = parseRollers(cached); runOnUiThread(() -> overlay.setRows(rows)); }
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(serverOrigin + "/api/leaderboard").openConnection();
                c.setConnectTimeout(2500); c.setReadTimeout(2500);
                String body = readAll(c.getInputStream());
                c.disconnect();
                final String[][] rows = parseRollers(body);
                if (rows.length > 0) { prefs.edit().putString("rollers", body).apply(); runOnUiThread(() -> overlay.setRows(rows)); }
            } catch (Exception e) { System.out.println("[marbles] leaderboard fetch: " + e); }
        }).start();
    }

    /** { top50: [ {name, intelligence} ] } -> up to 5 rows of [rank, NAME, INTELLIGENCE] */
    private static String[][] parseRollers(String body) {
        try {
            JSONArray top = new JSONObject(body).getJSONArray("top50");
            int n = Math.min(5, top.length());
            String[][] rows = new String[n][];
            for (int i = 0; i < n; i++) {
                JSONObject e = top.getJSONObject(i);
                String intel = e.optString("intelligence", "Natural");
                rows[i] = new String[] { String.valueOf(i + 1), e.optString("name", "?").toUpperCase(), intel.toUpperCase() };
            }
            return rows;
        } catch (Exception e) { return new String[0][]; }
    }

    private String readAsset(String name) throws java.io.IOException { try (InputStream in = getAssets().open(name)) { return readAll(in); } }

    private static String readAll(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    /**
     * The web title screen, natively: title art split into its logo block and its PRESS START + icons block with the
     * High Rollers table between them, drawn with the game's own 8x8 bitmap font. Landscape falls back to the plain art.
     */
    static final class TitleSplash extends View {
        /** row cuts in the 1080x608 asset: 0..CUT_A = header + logo, CUT_B..end = PRESS START + icons */
        static final int CUT_A = 491, CUT_B = 501;
        static final int BLUE = 0xFF4A7DFF;
        Bitmap art, font; JSONObject glyphs; int cell = 8, stride = 32; String[][] rows = new String[0][];
        final Paint bmp = new Paint(); final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Rect src = new Rect(), dst = new Rect();

        TitleSplash(Context c) {
            super(c);
            setBackgroundColor(BG);
            setClickable(true);                                          // nothing reaches the WebView until the page is ready
            bmp.setFilterBitmap(true);
            line.setColor(BLUE); line.setStyle(Paint.Style.STROKE); line.setStrokeWidth(2f);
            line.setPathEffect(new DashPathEffect(new float[] { 4f, 4f }, 0f));
        }

        void setAssets(Bitmap a, Bitmap f, JSONObject meta) {
            art = a; font = f;
            glyphs = meta.optJSONObject("glyphs"); cell = meta.optInt("cell", 8); stride = meta.optInt("variantStride", 32);
            invalidate();
        }
        void setRows(String[][] r) { rows = r; invalidate(); }

        @Override protected void onDraw(Canvas c) {
            if (art == null) return;
            int W = getWidth(), H = getHeight();
            float k = W / (float) art.getWidth();
            int fs = Math.max(2, Math.round(W / 360f));              // 8 px glyphs -> 24 px on a 1080-wide screen
            int rowH = cell * fs * 2;
            int tableH = rows.length == 0 ? 0 : rowH * (rows.length + 1);
            int hA = Math.round(CUT_A * k), hB = Math.round((art.getHeight() - CUT_B) * k), gap = rowH / 2;
            int total = hA + (tableH > 0 ? gap + tableH + gap : gap) + hB;
            if (total > H) {                                             // landscape / short screen: plain letterboxed art
                float kk = Math.min(W / (float) art.getWidth(), H / (float) art.getHeight());
                int dw = Math.round(art.getWidth() * kk), dh = Math.round(art.getHeight() * kk);
                dst.set((W - dw) / 2, (H - dh) / 2, (W + dw) / 2, (H + dh) / 2);
                c.drawBitmap(art, null, dst, bmp);
                return;
            }
            int y = (H - total) / 2;
            src.set(0, 0, art.getWidth(), CUT_A); dst.set(0, y, W, y + hA);
            c.drawBitmap(art, src, dst, bmp);
            y += hA + gap;
            if (tableH > 0) { drawTable(c, W, y, fs, rowH); y += tableH + gap; }
            src.set(0, CUT_B, art.getWidth(), art.getHeight()); dst.set(0, y, W, y + hB);
            c.drawBitmap(art, src, dst, bmp);
        }

        private void drawTable(Canvas c, int W, int top, int fs, int rowH) {
            int x0 = Math.round(W * 0.05f), x1 = Math.round(W * 0.95f);
            int cw = cell * fs;
            int rankW = 4 * cw, intelW = 14 * cw;
            int xRank = x0 + rankW, xIntel = x1 - intelW;
            int bottom = top + rowH * (rows.length + 1);
            c.drawRect(x0, top, x1, bottom, line);
            c.drawLine(xRank, top, xRank, bottom, line);
            c.drawLine(xIntel, top, xIntel, bottom, line);
            for (int i = 1; i <= rows.length; i++) c.drawLine(x0, top + rowH * i, x1, top + rowH * i, line);
            int ty = top + (rowH - cw) / 2;
            text(c, "PLAYER", (xRank + xIntel) / 2 - 3 * cw, ty, 2, fs);          // orange (the yellow variant)
            text(c, "INTELLIGENCE", xIntel + (intelW - 12 * cw) / 2, ty, 2, fs);
            for (int i = 0; i < rows.length; i++) {
                int ry = top + rowH * (i + 1) + (rowH - cw) / 2;
                String[] r = rows[i];
                text(c, r[0], x0 + (rankW - r[0].length() * cw) / 2, ry, 2, fs);
                String name = r[1].length() > 14 ? r[1].substring(0, 14) : r[1];
                text(c, name, xRank + cw, ry, 0, fs);
                String intel = r[2].length() > 12 ? r[2].substring(0, 12) : r[2];
                text(c, intel, xIntel + (intelW - intel.length() * cw) / 2, ry, 0, fs);
            }
        }

        /** bitmap font: glyph atlas cell lookup, colour variant = row block of `stride` px */
        private void text(Canvas c, String t, int x, int y, int variant, int fs) {
            if (font == null || glyphs == null) return;
            for (int i = 0; i < t.length(); i++) {
                String ch = String.valueOf(t.charAt(i));
                JSONArray g = glyphs.optJSONArray(ch);
                if (g == null) g = glyphs.optJSONArray(ch.toUpperCase());
                if (g != null) {
                    int gx = g.optInt(0), gy = g.optInt(1) + variant * stride;
                    src.set(gx, gy, gx + cell, gy + cell); dst.set(x, y, x + cell * fs, y + cell * fs);
                    c.drawBitmap(font, src, dst, bmp);
                }
                x += cell * fs;
            }
        }
    }
}
