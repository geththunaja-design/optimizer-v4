package com.aash.optimizer

import android.webkit.JavascriptInterface

/**
 * The ONLY surface the web layer can call. Every method is annotated @JavascriptInterface, so
 * anything not annotated here is invisible to JavaScript. The surface is deliberately narrow:
 * it cannot read or write arbitrary files, cannot open arbitrary URIs and cannot touch any
 * other app's data. Everything it does is scoped to this app and this device.
 */
class JsApi(private val act: MainActivity) {

    @JavascriptInterface
    fun mode(): String = "native"

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun deviceInfo(): String = act.engine.deviceInfo()

    @JavascriptInterface
    fun cpuLoadPercent(): Int = act.engine.cpuLoadPercent()

    @JavascriptInterface
    fun memInfoMb(): String = act.engine.memInfo()

    @JavascriptInterface
    fun thermalCelsius(): Float = act.engine.thermalCelsius()

    @JavascriptInterface
    fun thermalStatus(): Int = act.engine.thermalStatus()

    @JavascriptInterface
    fun thermalLabel(): String = act.engine.thermalLabel(act.engine.thermalStatus())

    @JavascriptInterface
    fun batteryInfo(): String = act.engine.batteryInfo()

    @JavascriptInterface
    fun games(): String = act.engine.games()

    @JavascriptInterface
    fun isGameInstalled(id: String): Boolean = act.engine.isGameInstalled(id)

    @JavascriptInterface
    fun launchGame(id: String): String = act.engine.launchGame(id)

    @JavascriptInterface
    fun openStore(id: String) = act.engine.openStore(id)

    @JavascriptInterface
    fun applySetting(key: String, value: String): String = act.engine.applySetting(key, value)

    @JavascriptInterface
    fun status(): String = act.engine.status()

    @JavascriptInterface
    fun requestBatteryExemption(): String = act.engine.requestBatteryExemption()

    @JavascriptInterface
    fun dropCaches(): String {
        act.runOnUiThread { act.engine.dropCaches(act.webView) }
        return "{\"queued\":true}"
    }

    @JavascriptInterface
    fun purgeResult(): String = act.engine.lastPurgeResult()

    @JavascriptInterface
    fun keepScreenOn(on: Boolean): Boolean {
        act.engine.keepScreenOn(on)
        return on
    }

    @JavascriptInterface
    fun setImmersive(on: Boolean): Boolean {
        act.engine.setImmersive(on)
        return on
    }

    @JavascriptInterface
    fun setOrientation(mode: String): Boolean {
        act.engine.setOrientation(mode)
        return true
    }

    @JavascriptInterface
    fun vibrate(ms: Int): Boolean {
        act.engine.vibrate(ms)
        return true
    }

    @JavascriptInterface
    fun benchNative(iters: Int): String = act.engine.bench(iters)

    @JavascriptInterface
    fun sdkInt(): Int = android.os.Build.VERSION.SDK_INT

    @JavascriptInterface
    fun model(): String = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim()

    @JavascriptInterface
    fun cores(): Int = Runtime.getRuntime().availableProcessors()

    @JavascriptInterface
    fun toast(text: String) = act.engine.toast(text)

    @JavascriptInterface
    fun exitApp() = act.engine.exit()
}
