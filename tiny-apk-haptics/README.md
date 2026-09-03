# Marble Madness — Android host

The one Android app for the game: a 16.7 KB APK (10.6 KB AAB, ~9.6 KB Play download) that shows
https://marbles.secure.build in a WebView and gives the game what a browser cannot: rich haptics,
a browser-based login that comes back into the app, a native title screen on the first frame, and a
pre-warmed Chrome Custom Tab. No AndroidX, no Material, no dependencies; one Java class and one icon.

```
AndroidManifest.xml         permissions, <queries> for the Custom Tabs service, meta-data SERVER_ORIGIN,
                            launcher intent + ${oauthScheme}://oauth-callback intent
src/com/example/minweb/MainActivity.java   everything
res/mipmap/ic.png           973-byte launcher icon (Play requires one)
proguard-rules.pro          keep the Activity and the @JavascriptInterface names
build.sh                    hand build: aapt2 → javac → R8 → zip → zipalign → apksigner (+ AAB via bundletool)
build.gradle, settings.gradle, app/build.gradle, gradlew   publishing project (AGP 9 + gradle-play-publisher)
```

## Build

```
./build.sh                                   # marbles.apk + marbles.aab, production server
SERVER_ORIGIN=http://10.0.2.2:3000 ./build.sh   # test build against a local `node tools/serve.mjs` from the emulator
./gradlew bundleRelease                      # Play bundle via Gradle (same sources)
./gradlew publishReleaseBundle               # upload to the internal track (after the first manual upload)
```

Env: `APP_ID` (build.secure.marbles), `APP_LABEL`, `SERVER_ORIGIN`, `OAUTH_SCHEME` (marbles), `VERSION_CODE`,
`VERSION_NAME`. The Gradle project reads `MM_SERVER_ORIGIN`, `MM_OAUTH_SCHEME`, the `MM_UPLOAD_*` key
variables and `MM_PLAY_SERVICE_ACCOUNT`. `.keys/upload.jks` is a generated throwaway (password `marbles`);
replace it with the real upload key before Play. Needs build-tools 36+, platform android-36+, JDK 17+,
and `.tools/bundletool-all-*.jar` for the AAB.

## What the host adds to the game

**`window.NativeBridge`** (injected into the page):

| method | purpose |
|---|---|
| `tick(scale)`, `impact(scale)`, `thud()` | actuator primitives TICK / LOW_TICK, CLICK, THUD with predefined-effect fallbacks |
| `hapticClick()`, `vibrate(ms)`, `buzz(ms, amp)`, `cancelHaptics()`, `caps()` | simpler effects and capability JSON |
| `launchAuth(url)` | open an http(s) URL in the pre-warmed Chrome Custom Tab (default browser fallback) |
| `takeAuthResult()` | JSON `{user, provider, state, error}` parked from the last `marbles://oauth-callback` |
| `onWebReady()` | page is interactive: the native title overlay may be lifted |
| `browserPrewarmed()`, `serverOrigin()` | diagnostics |

The game side lives in the main repo:

- `src/engine/trackball.ts` — `Trackball.vibrate()` routes to the bridge when present: 2 ms detent → `tick`,
  8–12 ms bounce → `impact`, 25 ms landing or shatter patterns → `thud`; otherwise `navigator.vibrate`.
- `src/main.ts` — calls `onWebReady()` after boot; intercepts the login dock so the Twitter/GitHub buttons
  call `launchAuth(origin + '/auth/<provider>?app=<nonce>')`; `window.onAuthComplete` pulls the parked
  result, checks the nonce, sets the same `mm_user` display cookie the web flow uses and updates the dock
  and `game.playerName`. It also runs on load, so a cold start straight from the redirect works.
- `tools/serve.mjs` — `/auth/<provider>?app=<nonce>` stores the nonce in the state cookie; both
  `/callback/<provider>` exits go through `authExit()`, which for app callers returns a page that jumps to
  `marbles://oauth-callback?user=..&provider=..&state=<nonce>` (or `&error=..`) and keeps the web behaviour
  (`/?user=..`) otherwise. `APP_SCHEME` env (default `marbles`) must match the app's `OAUTH_SCHEME`.

Login sequence: dock tap → Custom Tab (Chrome, already warmed) → server → provider consent → server
callback exchanges the code with the secret it holds → jump page → Android opens the app via the scheme →
`onNewIntent` parks the result → the page pulls it. Providers block embedded logins and the user's browser
session makes it one tap, which is why it does not happen inside the WebView.

## Verified on an API 35 emulator against a local server

- First frame: native "Marble Madness / START"; the game boots underneath and lifts the overlay on
  `onWebReady()`. Chrome's `CustomTabsConnectionService` lists the app as a client after `warmup()`.
- GitHub dock tap → `CustomTabActivity` on GitHub's consent page for "Marble Madness: Humans vs Agents".
- Hand-off with the real nonce → dock shows `@rex`, `game.playerName` set, the bridge played
  `Primitive=TICK` for the confirmation. Wrong nonce → rejected. Provider error → reported.
- Cookie-state flow for plain web users is unchanged.

## Notes

- Package visibility: the `<queries>` block is what lets `bindService()` reach Chrome on API 30+; without it
  the app still runs, only the pre-warm silently does nothing.
- The server's client ids and secrets should come from the environment (`.env` at the repo root is loaded
  by `tools/serve.mjs` and gitignored). Rotate any secret that has been pasted into a chat.
- Play: new apps must upload an AAB and target API 36 (done); the first bundle is a manual upload, then the
  Gradle Play Publisher plugin can take over.
