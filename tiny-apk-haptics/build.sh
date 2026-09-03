#!/usr/bin/env bash
# Marble Madness Android host — hand build: aapt2 → javac → R8 → zip → zipalign → apksigner (+ AAB via bundletool).
# Zero dependencies, one tiny icon. Same sources as the Gradle project in this folder (used for Play publishing).
#
# Environment (defaults = the production deployment):
#   APP_ID          build.secure.marbles        application id
#   APP_LABEL       Marble Madness              launcher name + title overlay
#   SERVER_ORIGIN   https://marbles.secure.build   where the game lives (http://10.0.2.2:3000 = local server from the emulator)
#   OAUTH_SCHEME    marbles                     <scheme>://oauth-callback, must match APP_SCHEME on the server
#   VERSION_CODE / VERSION_NAME   1 / 0.1
# Needs Android build-tools 36+ (aapt2, zipalign, apksigner) with R8 in lib/d8.jar, platform android-36+, JDK 17+.
# The AAB step needs .tools/bundletool-all-*.jar (https://github.com/google/bundletool/releases).
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}}"
[ -d "$SDK" ] || { echo "Error: set ANDROID_HOME (no SDK at $SDK)" >&2; exit 1; }
APP_ID="${APP_ID:-build.secure.marbles}"; APP_LABEL="${APP_LABEL:-Marble Madness}"
SERVER_ORIGIN="${SERVER_ORIGIN:-https://marbles.secure.build}"; OAUTH_SCHEME="${OAUTH_SCHEME:-marbles}"
VERSION_CODE="${VERSION_CODE:-1}"; VERSION_NAME="${VERSION_NAME:-0.1}"; MIN_SDK=30; TARGET_SDK=36

BUILD_TOOLS_DIR=$(ls -d "$SDK/build-tools/"* 2>/dev/null | sort -V | tail -n 1)
PLATFORM_DIR=$(ls -d "$SDK/platforms/android-"* 2>/dev/null | sort -V | tail -n 1)
[ -n "$BUILD_TOOLS_DIR" ] && [ -n "$PLATFORM_DIR" ] || { echo "Error: build-tools / platforms missing in $SDK" >&2; exit 1; }
AAPT2="$BUILD_TOOLS_DIR/aapt2"; ZIPALIGN="$BUILD_TOOLS_DIR/zipalign"; APKSIGNER="$BUILD_TOOLS_DIR/apksigner"
ANDROID_JAR="$PLATFORM_DIR/android.jar"
R8_JAR="$BUILD_TOOLS_DIR/lib/d8.jar"; [ -f "$R8_JAR" ] || R8_JAR="$SDK/cmdline-tools/latest/lib/r8.jar"
[ -f "$R8_JAR" ] || { echo "Error: R8 not found (build-tools/lib/d8.jar or cmdline-tools/lib/r8.jar)" >&2; exit 1; }
BUNDLETOOL=$(ls .tools/bundletool-all-*.jar 2>/dev/null | head -1 || true)
echo "build-tools $(basename "$BUILD_TOOLS_DIR") | platform $(basename "$PLATFORM_DIR") | app $APP_ID | server $SERVER_ORIGIN | scheme $OAUTH_SCHEME://oauth-callback"

rm -rf build; mkdir -p build/classes build/dex build/aab .keys

# 0. manifest: fill the ${placeholders} (Gradle does the same via manifestPlaceholders), add the package
#    attribute aapt2 needs; a plain-http SERVER_ORIGIN (emulator testing) also needs cleartext permission
CLEAR=""; case "$SERVER_ORIGIN" in http://*) CLEAR=' android:usesCleartextTraffic="true"';; esac
sed -e "s#\${appLabel}#$APP_LABEL#g" -e "s#\${serverOrigin}#$SERVER_ORIGIN#g" -e "s#\${oauthScheme}#$OAUTH_SCHEME#g" \
    -e "s#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.example.minweb\">#" \
    -e "s#android:allowBackup=\"false\"#android:allowBackup=\"false\"$CLEAR#" AndroidManifest.xml > build/AndroidManifest.xml

# 1. resources (icon) + manifest, binary for the APK and proto for the AAB
"$AAPT2" compile --dir res -o build/res.zip
LINK=(--manifest build/AndroidManifest.xml -I "$ANDROID_JAR" build/res.zip --no-version-vectors --rename-manifest-package "$APP_ID"
      --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" --version-code "$VERSION_CODE" --version-name "$VERSION_NAME")
"$AAPT2" link -o build/base.apk "${LINK[@]}"
"$AAPT2" link -o build/base-proto.apk "${LINK[@]}" --proto-format

# 2. java → dex (R8 keeps the Activity and the @JavascriptInterface names, see proguard-rules.pro)
javac -g:none --release 17 -Xlint:-options -cp "$ANDROID_JAR" -d build/classes src/com/example/minweb/MainActivity.java
jar -cf build/app.jar -C build/classes .
java -cp "$R8_JAR" com.android.tools.r8.R8 --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" \
    --pg-conf proguard-rules.pro --pg-map-output build/mapping.txt --output build/dex build/app.jar

# 3. signing key (EC = small signature). Lives in .keys/ so builds stay installable over each other.
#    This is a throwaway; use your Play upload key for release.
if [ ! -f .keys/upload.jks ]; then
    keytool -genkeypair -keystore .keys/upload.jks -alias upload -keyalg EC -groupname secp256r1 -sigalg SHA256withECDSA \
        -validity 10000 -storepass marbles -keypass marbles -dname "CN=Marble Madness upload" >/dev/null 2>&1
fi

# 4. APK
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -9 -q -u ../unsigned.apk classes.dex)
# 4-byte alignment for uncompressed entries; 16 KB page alignment (-P 16) only matters for native .so files, and there are none
"$ZIPALIGN" -f -p 4 build/unsigned.apk build/aligned.apk
"$APKSIGNER" sign --ks .keys/upload.jks --ks-key-alias upload --ks-pass pass:marbles --key-pass pass:marbles \
    --min-sdk-version "$MIN_SDK" --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
    --out marbles.apk build/aligned.apk
"$APKSIGNER" verify marbles.apk

# 5. AAB (what Play accepts): module zip in bundle layout, jarsigner-signed
if [ -n "$BUNDLETOOL" ]; then
python3 - <<'EOF'
import zipfile
proto = zipfile.ZipFile('build/base-proto.apk'); mod = zipfile.ZipFile('build/aab/base.zip', 'w', zipfile.ZIP_DEFLATED)
for n in proto.namelist():
    if n == 'AndroidManifest.xml': mod.writestr('manifest/AndroidManifest.xml', proto.read(n))
    elif n == 'resources.pb' or n.startswith('res/'): mod.writestr(n, proto.read(n))
mod.write('build/dex/classes.dex', 'dex/classes.dex'); mod.close()
EOF
    echo '{ "optimizations": { "splitsConfig": { "splitDimension": [ { "value": "LANGUAGE", "negate": true }, { "value": "SCREEN_DENSITY", "negate": true } ] } } }' > build/BundleConfig.json
    java -jar "$BUNDLETOOL" build-bundle --modules=build/aab/base.zip --config=build/BundleConfig.json --output=build/unsigned.aab --overwrite
    jarsigner -keystore .keys/upload.jks -storepass marbles -keypass marbles -sigalg SHA256withECDSA -digestalg SHA-256 \
        -signedjar marbles.aab build/unsigned.aab upload >/dev/null
    java -jar "$BUNDLETOOL" build-apks --bundle=marbles.aab --output=build/marbles.apks --mode=universal --overwrite \
        --ks=.keys/upload.jks --ks-key-alias=upload --ks-pass=pass:marbles --key-pass=pass:marbles >/dev/null
    DL=$(java -jar "$BUNDLETOOL" get-size total --apks=build/marbles.apks | tail -1 | cut -d, -f2)
fi

sz() { stat -f %z "$1" 2>/dev/null || stat -c %s "$1"; }
echo "APK  marbles.apk  $(sz marbles.apk) bytes  (classes.dex $(sz build/dex/classes.dex))"
[ -n "$BUNDLETOOL" ] && echo "AAB  marbles.aab  $(sz marbles.aab) bytes, Play download estimate $DL bytes"
