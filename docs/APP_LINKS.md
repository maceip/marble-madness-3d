# Web app installation and native links

The public origin is `https://marbles.secure.build`.

## Android

`www/.well-known/assetlinks.json` associates the origin with Android application ID
`build.secure.marbles`. It contains both certificates that can sign an installed build:

- `A0:64:DF:...:A0:D0` is the **App signing key certificate** shown in Play Console and signs Play-distributed APKs.
- `DB:39:EA:...:DC:ED` is the RSA Play upload/direct-install certificate used by `build.sh` and signs the local APK.

The upload certificate signs the AAB sent to Play, but Google replaces that signature when generating store APKs.
Keep the Play app-signing fingerprint first, and do not substitute the upload fingerprint for it.

The Android manifest deliberately declares the full HTTPS host. Android 15 and later refine that broad
scope using `dynamic_app_link_components` in `assetlinks.json`; older Android versions open all URLs on
the host in the app.

## Apple

`www/.well-known/apple-app-site-association` contains all four Apple association services but grants none
until a native Apple target exists. This repository currently has no Apple Team ID, bundle ID, App Clip ID,
or associated-domains entitlement, so publishing placeholder identifiers would create a false association.

When an Apple target is created:

1. Add `<TEAM_ID>.<BUNDLE_ID>` and URL `components` under `applinks.details`.
2. Add the same app ID under `webcredentials.apps` and `activitycontinuation.apps` only if those features
   are implemented.
3. Add `<TEAM_ID>.<APP_CLIP_BUNDLE_ID>` under `appclips.apps` only if an App Clip exists.
4. Add matching `applinks:marbles.secure.build`, `webcredentials:marbles.secure.build`,
   `activitycontinuation:marbles.secure.build`, or `appclips:marbles.secure.build` entries to the target's
   Associated Domains entitlement.

The AASA file must remain extensionless, available without redirects, served as `application/json`, and
smaller than 128 KB.
