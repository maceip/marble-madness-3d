# R8 rules shared by build.sh and the Gradle release build.
-allowaccessmodification
-overloadaggressively
-repackageclasses ""
-renamesourcefileattribute ""

# WebView finds bridge methods by their @JavascriptInterface annotation at runtime
-keepattributes *Annotation*

# framework entry points (manifest + lifecycle)
-keep public class com.example.minweb.MainActivity extends android.app.Activity {
    public <init>();
    protected void onCreate(android.os.Bundle);
    protected void onNewIntent(android.content.Intent);
    protected void onSaveInstanceState(android.os.Bundle);
    protected void onDestroy();
    public void onBackPressed();
}

# window.NativeBridge.<name>() must keep its names
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-assumenosideeffects class android.util.Log {
    public static *** *(...);
}

-dontwarn android.**
