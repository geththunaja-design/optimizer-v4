# The web layer is exposed to JavaScript, so it must never be renamed or removed.
-keepclassmembers class com.aash.optimizer.JsApi {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.aash.optimizer.JsApi { *; }

# JNI entry points are bound by name: Java_com_aash_optimizer_NativeBridge_*
-keepclasseswithmembernames class com.aash.optimizer.NativeBridge { native <methods>; }
-keep class com.aash.optimizer.NativeBridge { *; }
