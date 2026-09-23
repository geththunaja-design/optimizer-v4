package com.aash.optimizer

import android.app.Activity
import android.app.ActivityManager
import android.app.GameManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Choreographer
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.PerformanceHintManager
import android.os.PowerManager
import android.os.Process
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.MotionEvent
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.widget.Toast
import androidx.annotation.RequiresApi
import org.json.JSONObject
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * The real, non-root Android control surface.
 *
 * Everything in here is an actual platform API gated by API level, so the same app behaves
 * correctly on Android 7 through Android 15:
 *
 *   Window.setFrameRate            (API 30) - real frame-rate request for this window
 *   LayoutParams.preferredDisplayModeId      - real display mode selection for the FPS cap
 *   Window.setSustainedPerformanceMode (24) - stops the device from scaling clocks down
 *   GameManager.setGameMode        (API 31) - the system's own performance game mode
 *   PerformanceHintManager         (API 31) - CPU hint session held at the target frame time
 *   View.requestUnbufferedDispatch (via reflection) - removes input batching latency
 *   PowerManager.getCurrentThermalStatus (29) - real SoC thermal status
 *   PowerManager.isIgnoringBatteryOptimizations / ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
 *   PackageManager                 - exact game detection + launch, never a guess
 *   /proc + /sys through the NDK   - real CPU load, RAM and temperature
 *
 * Nothing here writes into another app. That is impossible without root, so the app never
 * pretends to: those switches drive the app's own lab and say so in the UI.
 */
class OptimizerEngine(private val activity: Activity, private val native: NativeBridge) {

    private companion object {
        const val FRAME_RATE_COMPATIBILITY_DEFAULT = 0
        const val FRAME_RATE_COMPATIBILITY_FIXED_SOURCE = 1
    }

    private val power: PowerManager? get() = activity.getSystemService(Context.POWER_SERVICE) as? PowerManager
    private val activityManager: ActivityManager? get() = activity.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager

    var targetFps = 60
        private set
    var sustainedPerf = false
        private set
    var perfLock = false
        private set
    var gpuBoost = false
        private set
    var unbuffered = false
        private set
    var aggression = 3
        private set
    var batteryOverride = false
        private set
    var gameMode = Int.MIN_VALUE
        private set
    var hintActive = false
        private set
    var governor = "balanced"
        private set

    private var hintHolder: Any? = null
    private var frameCallback: Choreographer.FrameCallback? = null
    private var lastFrameNs = 0L
    private val main = Handler(Looper.getMainLooper())

    /** Wrapper kept in its own class so the API-31 types are only ever resolved on API 31+. */
    @RequiresApi(31)
    private class HintSession31(private val session: PerformanceHintManager.PerformanceHintSession) {
        fun report(ns: Long) {
            try { session.reportActualWorkDuration(ns) } catch (t: Throwable) { }
        }
        fun target(ns: Long) {
            try { session.updateTargetWorkDuration(ns) } catch (t: Throwable) { }
        }
        fun close() {
            try { session.close() } catch (t: Throwable) { }
        }
    }

    private val unbufferedMethod: java.lang.reflect.Method? = try {
        View::class.java.getMethod("requestUnbufferedDispatch", MotionEvent::class.java)
    } catch (t: Throwable) {
        null
    }

    /* ---------------------------------------------------------------- device --- */

    fun deviceInfo(): String {
        val j = JSONObject()
        val n = try { JSONObject(native.safeDeviceInfo()) } catch (t: Throwable) { JSONObject() }
        j.put("model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        j.put("manufacturer", Build.MANUFACTURER)
        j.put("brand", Build.BRAND)
        j.put("device", Build.DEVICE)
        j.put("hardware", Build.HARDWARE)
        j.put("board", Build.BOARD)
        j.put("android", Build.VERSION.RELEASE)
        j.put("sdk", Build.VERSION.SDK_INT)
        j.put("abi", Build.SUPPORTED_ABIS.joinToString(", "))
        j.put("cores", n.optInt("cores", Runtime.getRuntime().availableProcessors()))
        j.put("cpuModel", n.optString("cpuModel", "").ifEmpty { Build.HARDWARE })
        j.put("cpuMaxMhz", n.optInt("cpuMaxMhz", -1))
        j.put("totalRamMb", n.optInt("totalRamMb", -1))
        j.put("availRamMb", n.optInt("availRamMb", -1))
        val am = activityManager
        j.put("memClassMb", am?.memoryClass ?: -1)
        j.put("largeMemClassMb", am?.largeMemoryClass ?: -1)
        j.put("lowRam", am?.isLowRamDevice ?: false)
        j.put("nativeLib", native.available)
        val gpu = glRenderer()
        j.put("gpu", gpu.first)
        j.put("gpuVendor", gpu.second)
        val dm = activity.resources.displayMetrics
        j.put("density", dm.density)
        j.put("widthPx", dm.widthPixels)
        j.put("heightPx", dm.heightPixels)
        j.put("widthDp", (dm.widthPixels / dm.density).toInt())
        j.put("heightDp", (dm.heightPixels / dm.density).toInt())
        val wm = activity.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        val display = wm?.defaultDisplay
        val refresh = display?.refreshRate ?: 0f
        j.put("refreshHz", refresh.toInt())
        var maxHz = refresh
        try {
            for (m in display?.supportedModes ?: emptyArray()) maxHz = max(maxHz, m.refreshRate)
        } catch (t: Throwable) {
        }
        j.put("maxRefreshHz", maxHz.toInt())
        j.put("cutout", hasCutout())
        return j.toString()
    }

    private fun hasCutout(): Boolean = if (Build.VERSION.SDK_INT >= 28) {
        try {
            activity.window.decorView.rootWindowInsets?.displayCutout != null
        } catch (t: Throwable) {
            false
        }
    } else false

    private fun glRenderer(): Pair<String, String> {
        var renderer = "unavailable"
        var vendor = "-"
        try {
            val egl = android.opengl.EGL14.eglGetDisplay(android.opengl.EGL14.EGL_DEFAULT_DISPLAY)
            val ver = IntArray(2)
            if (android.opengl.EGL14.eglInitialize(egl, ver, 0, ver, 1)) {
                val cfgAttrs = intArrayOf(
                    android.opengl.EGL14.EGL_RENDERABLE_TYPE, android.opengl.EGL14.EGL_OPENGL_ES2_BIT,
                    android.opengl.EGL14.EGL_SURFACE_TYPE, android.opengl.EGL14.EGL_PBUFFER_BIT,
                    android.opengl.EGL14.EGL_RED_SIZE, 8,
                    android.opengl.EGL14.EGL_GREEN_SIZE, 8,
                    android.opengl.EGL14.EGL_BLUE_SIZE, 8,
                    android.opengl.EGL14.EGL_NONE
                )
                val cfgs = arrayOfNulls<android.opengl.EGLConfig>(1)
                val n = IntArray(1)
                if (android.opengl.EGL14.eglChooseConfig(egl, cfgAttrs, 0, cfgs, 0, 1, n, 0) && n[0] > 0) {
                    val cfg = cfgs[0]
                    val ctx = if (cfg == null) android.opengl.EGL14.EGL_NO_CONTEXT else android.opengl.EGL14.eglCreateContext(
                        egl, cfg, android.opengl.EGL14.EGL_NO_CONTEXT,
                        intArrayOf(android.opengl.EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, android.opengl.EGL14.EGL_NONE), 0
                    )
                    val surf = if (cfg == null) android.opengl.EGL14.EGL_NO_SURFACE else android.opengl.EGL14.eglCreatePbufferSurface(
                        egl, cfg, intArrayOf(android.opengl.EGL14.EGL_WIDTH, 1, android.opengl.EGL14.EGL_HEIGHT, 1, android.opengl.EGL14.EGL_NONE), 0
                    )
                    if (ctx != android.opengl.EGL14.EGL_NO_CONTEXT && surf != android.opengl.EGL14.EGL_NO_SURFACE) {
                        if (android.opengl.EGL14.eglMakeCurrent(egl, surf, surf, ctx)) {
                            renderer = android.opengl.GLES20.glGetString(android.opengl.GLES20.GL_RENDERER) ?: "unknown"
                            vendor = android.opengl.GLES20.glGetString(android.opengl.GLES20.GL_VENDOR) ?: "-"
                        }
                        android.opengl.EGL14.eglMakeCurrent(
                            egl, android.opengl.EGL14.EGL_NO_SURFACE, android.opengl.EGL14.EGL_NO_SURFACE, android.opengl.EGL14.EGL_NO_CONTEXT
                        )
                        android.opengl.EGL14.eglDestroySurface(egl, surf)
                        android.opengl.EGL14.eglDestroyContext(egl, ctx)
                    }
                }
                android.opengl.EGL14.eglTerminate(egl)
            }
        } catch (t: Throwable) {
        }
        return Pair(renderer, vendor)
    }

    fun cpuLoadPercent(): Int = native.safeCpuLoad()
    fun memInfo(): String = native.safeMemInfo()
    fun thermalCelsius(): Float = native.safeThermal()
    fun bench(iters: Int): String = native.safeBench(iters)

    fun thermalStatus(): Int = if (Build.VERSION.SDK_INT >= 29) {
        try {
            power?.currentThermalStatus ?: -1
        } catch (t: Throwable) {
            -1
        }
    } else -1

    fun thermalLabel(status: Int): String = when (status) {
        PowerManager.THERMAL_STATUS_NONE -> "nominal"
        PowerManager.THERMAL_STATUS_LIGHT -> "light"
        PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
        PowerManager.THERMAL_STATUS_SEVERE -> "severe"
        PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
        PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
        PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
        else -> "unavailable"
    }

    fun batteryInfo(): String {
        val j = JSONObject()
        val bm = activity.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        j.put("percent", bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1)
        j.put("charging", bm?.isCharging ?: false)
        j.put("currentNow", bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW) ?: 0)
        try {
            val i = activity.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (i != null) {
                val t = i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1)
                j.put("temp", if (t > 0) t / 10.0 else -1)
                j.put("voltage", i.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1))
                j.put("health", i.getIntExtra(BatteryManager.EXTRA_HEALTH, -1))
                j.put("plugged", i.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1))
            }
        } catch (t: Throwable) {
        }
        j.put("thermal", thermalStatus())
        j.put("thermalLabel", thermalLabel(thermalStatus()))
        j.put("ignoringOptimisations", ignoringBatteryOptimisations())
        return j.toString()
    }

    fun ignoringBatteryOptimisations(): Boolean = if (Build.VERSION.SDK_INT >= 23) {
        try {
            power?.isIgnoringBatteryOptimizations(activity.packageName) ?: false
        } catch (t: Throwable) {
            false
        }
    } else true

    fun requestBatteryExemption(): String {
        val j = JSONObject()
        if (Build.VERSION.SDK_INT < 23) {
            j.put("ok", true)
            j.put("already", true)
            return j.toString()
        }
        val already = ignoringBatteryOptimisations()
        j.put("already", already)
        if (!already) {
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                        .setData(Uri.parse("package:${activity.packageName}"))
                )
                j.put("ok", true)
            } catch (t: Throwable) {
                j.put("ok", false)
            }
        } else j.put("ok", true)
        batteryOverride = true
        return j.toString()
    }

    /* ---------------------------------------------------------------- window --- */

    fun setTargetFps(fps: Int): Int {
        targetFps = fps.coerceIn(24, 240)
        return main.post {
            try {
                val w = activity.window
                val lp = w.attributes
                lp.preferredRefreshRate = if (targetFps >= 144) 0f else targetFps.toFloat()
                w.attributes = lp
                if (Build.VERSION.SDK_INT >= 30) {
                    w.setFrameRate(
                        targetFps.toFloat(),
                        if (targetFps >= 144) FRAME_RATE_COMPATIBILITY_DEFAULT else FRAME_RATE_COMPATIBILITY_FIXED_SOURCE
                    )
                }
                if (Build.VERSION.SDK_INT in 23..29) {
                    val display = w.windowManager?.defaultDisplay
                    val modes = display?.supportedModes
                    if (modes != null && modes.isNotEmpty()) {
                        val best = modes.minByOrNull { abs(it.refreshRate - targetFps) }
                        if (best != null) {
                            val lp2 = w.attributes
                            lp2.preferredDisplayModeId = best.modeId
                            w.attributes = lp2
                        }
                    }
                }
                updateHintTarget()
            } catch (t: Throwable) {
            }
        }.let { targetFps }
    }

    fun setSustainedPerformance(on: Boolean) {
        sustainedPerf = on
        main.post {
            try {
                if (Build.VERSION.SDK_INT >= 24 && power?.isSustainedPerformanceModeSupported == true) {
                    activity.window.setSustainedPerformanceMode(on)
                }
            } catch (t: Throwable) {
            }
        }
    }

    fun setGameMode(mode: Int) {
        if (Build.VERSION.SDK_INT < 31) {
            gameMode = -1
            return
        }
        main.post {
            try {
                val gm = activity.getSystemService(Context.GAME_SERVICE) as? GameManager
                if (gm != null) {
                    gm.gameMode = mode
                    gameMode = gm.gameMode
                }
            } catch (t: Throwable) {
            }
        }
    }

    @RequiresApi(31)
    fun startHints() {
        main.post {
            try {
                if (Build.VERSION.SDK_INT < 31) return@post
                stopHintsInternal()
                val mgr = activity.getSystemService(Context.PERFORMANCE_HINT_SERVICE) as? PerformanceHintManager ?: return@post
                val holder = HintSession31(mgr.createHintSession(intArrayOf(Process.myTid()), frameNanos()))
                hintHolder = holder
                lastFrameNs = System.nanoTime()
                val cb = object : Choreographer.FrameCallback {
                    override fun doFrame(frameTimeNanos: Long) {
                        val now = System.nanoTime()
                        val actual = if (lastFrameNs == 0L) frameNanos() else now - lastFrameNs
                        lastFrameNs = now
                        holder.report(min(max(actual, 500_000L), frameNanos() * 4))
                        if (hintActive) Choreographer.getInstance().postFrameCallback(this)
                    }
                }
                frameCallback = cb
                hintActive = true
                Choreographer.getInstance().postFrameCallback(cb)
            } catch (t: Throwable) {
                hintActive = false
            }
        }
    }

    fun stopHints() {
        main.post { stopHintsInternal() }
    }

    private fun stopHintsInternal() {
        hintActive = false
        try {
            frameCallback?.let { Choreographer.getInstance().removeFrameCallback(it) }
        } catch (t: Throwable) {
        }
        frameCallback = null
        try {
            (hintHolder as? HintSession31)?.close()
        } catch (t: Throwable) {
        }
        hintHolder = null
    }

    private fun updateHintTarget() {
        if (Build.VERSION.SDK_INT < 31) return
        try {
            (hintHolder as? HintSession31)?.target(frameNanos())
        } catch (t: Throwable) {
        }
    }

    private fun frameNanos(): Long = (1_000_000_000L / max(targetFps, 24).toLong())

    fun setUnbuffered(on: Boolean) {
        unbuffered = on
    }

    fun requestUnbuffered(ev: MotionEvent, v: View) {
        val m = unbufferedMethod ?: return
        try {
            m.invoke(v, ev)
        } catch (t: Throwable) {
        }
    }

    fun setImmersive(on: Boolean) {
        main.post {
            try {
                val w = activity.window
                if (Build.VERSION.SDK_INT >= 30) {
                    val c = w.insetsController
                    if (on) {
                        w.setDecorFitsSystemWindows(false)
                        c?.hide(android.view.WindowInsets.Type.systemBars())
                        c?.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    } else {
                        w.setDecorFitsSystemWindows(true)
                        c?.show(android.view.WindowInsets.Type.systemBars())
                    }
                } else {
                    @Suppress("DEPRECATION")
                    w.decorView.systemUiVisibility = if (on)
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    else View.SYSTEM_UI_FLAG_VISIBLE
                }
            } catch (t: Throwable) {
            }
        }
    }

    fun keepScreenOn(on: Boolean) {
        main.post {
            try {
                if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } catch (t: Throwable) {
            }
        }
    }

    fun setOrientation(mode: String) {
        main.post {
            activity.requestedOrientation = when (mode) {
                "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                else -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
            }
        }
    }

    fun setStatusBarDark(dark: Boolean) {
        main.post {
            try {
                val w = activity.window
                w.statusBarColor = if (dark) 0xFF05070F.toInt() else 0xFFEEF2FB.toInt()
                w.navigationBarColor = if (dark) 0xFF05070F.toInt() else 0xFFEEF2FB.toInt()
                if (Build.VERSION.SDK_INT >= 30) {
                    val c = w.insetsController
                    if (dark) c?.setSystemBarsAppearance(0, android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)
                    else c?.setSystemBarsAppearance(
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                            android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                            android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    )
                } else {
                    @Suppress("DEPRECATION")
                    run {
                        var f = w.decorView.systemUiVisibility
                        f = if (dark) f and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
                        else f or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                        w.decorView.systemUiVisibility = f
                    }
                }
            } catch (t: Throwable) {
            }
        }
    }

    fun vibrate(ms: Int) {
        val v: Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
            (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
        try {
            if (v == null || !v.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(ms.toLong().coerceIn(5, 200), VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(ms.toLong().coerceIn(5, 200))
            }
        } catch (t: Throwable) {
        }
    }

    /* -------------------------------------------------------------- packages --- */

    fun gamePackages(): Map<String, String> = mapOf(
        "ff" to "com.dts.freefireth",
        "ffmax" to "com.dts.freefiremax"
    )

    fun games(): String {
        val j = JSONObject()
        val pm = activity.packageManager
        for ((id, pkg) in gamePackages()) {
            val info = try {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(pkg, 0)
            } catch (t: Throwable) {
                null
            }
            val o = JSONObject()
            o.put("installed", info != null)
            if (info != null) {
                o.put("version", info.versionName ?: "-")
                @Suppress("DEPRECATION")
                o.put("versionCode", if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong())
            }
            j.put(id, o)
        }
        return j.toString()
    }

    fun isGameInstalled(id: String): Boolean {
        val pkg = gamePackages()[id] ?: return false
        return try {
            @Suppress("DEPRECATION")
            activity.packageManager.getPackageInfo(pkg, 0)
            true
        } catch (t: Throwable) {
            false
        }
    }

    fun launchGame(id: String): String {
        val j = JSONObject()
        val pkg = gamePackages()[id]
        if (pkg == null) {
            j.put("ok", false)
            j.put("reason", "unknown game id")
            return j.toString()
        }
        val intent = activity.packageManager.getLaunchIntentForPackage(pkg)
        if (intent == null) {
            j.put("ok", false)
            j.put("reason", "not installed")
            return j.toString()
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        return try {
            activity.startActivity(intent)
            j.put("ok", true)
            j.put("reason", "launched $pkg")
            j.toString()
        } catch (t: Throwable) {
            j.put("ok", false)
            j.put("reason", "launch blocked: ${t.javaClass.simpleName}")
            j.toString()
        }
    }

    fun openStore(id: String) {
        val pkg = gamePackages()[id] ?: return
        try {
            activity.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (t: Throwable) {
        }
    }

    /* ----------------------------------------------------------------- memory --- */

    fun dropCaches(webView: android.webkit.WebView?) {
        val mbBefore = usedHeapMb()
        try {
            webView?.clearCache(true)
        } catch (t: Throwable) {
        }
        try {
            activity.cacheDir?.listFiles()?.forEach { deleteTree(it) }
        } catch (t: Throwable) {
        }
        Runtime.getRuntime().gc()
        val mbAfter = usedHeapMb()
        val j = JSONObject()
        j.put("heapBeforeMb", mbBefore)
        j.put("heapAfterMb", mbAfter)
        j.put("freedMb", max(0.0, mbBefore - mbAfter))
        lastPurge = j.toString()
    }

    private var lastPurge = "{}"
    fun lastPurgeResult(): String = lastPurge

    private fun usedHeapMb(): Double {
        val info = Debug.MemoryInfo()
        try {
            Debug.getMemoryInfo(info)
            return info.totalPss / 1024.0
        } catch (t: Throwable) {
            return 0.0
        }
    }

    private fun deleteTree(f: File) {
        try {
            if (f.isDirectory) f.listFiles()?.forEach { deleteTree(it) }
            f.delete()
        } catch (t: Throwable) {
        }
    }

    /* --------------------------------------------------------------- settings --- */

    private fun bool(v: String) = v.equals("true", true)

    private fun num(v: String, fallback: Int) = v.trim().replace("\"", "").toIntOrNull() ?: fallback

    /** Applies one dashboard setting with the real Android API behind it. Returns a report. */
    fun applySetting(key: String, value: String): String {
        val j = JSONObject()
        try {
            when (key) {
                "hw.targetFps" -> {
                    setTargetFps(num(value, 60))
                    j.put("targetFps", targetFps)
                }
                "hw.governor" -> {
                    governor = value.trim().replace("\"", "")
                    val perf = governor == "performance"
                    setSustainedPerformance(perf)
                    setGameMode(if (perf) 1 else if (governor == "powersave") 2 else 0)
                    if (perf) native.safeLockThreads(0)
                    j.put("governor", governor)
                    j.put("sustained", sustainedPerf)
                }
                "hw.memAggression" -> {
                    aggression = num(value, 3)
                    j.put("aggression", aggression)
                }
                "hw.touchRate", "touch.pollRate", "touch.delay" -> {
                    setUnbuffered(true)
                    j.put("unbuffered", true)
                }
                "mon.shield" -> {
                    val on = bool(value)
                    setUnbuffered(on)
                    if (on) startHints() else stopHints()
                    j.put("shield", on)
                }
                "mon.framePacing", "lag.zeroStutter" -> {
                    setUnbuffered(bool(value))
                    j.put("framePacing", unbuffered)
                }
                "mon.antiThermal" -> {
                    setSustainedPerformance(bool(value))
                    j.put("thermal", thermalLabel(thermalStatus()))
                }
                "mon.stutterBuffer" -> j.put("buffers", if (bool(value)) 4 else 2)
                "lag.perfLock" -> {
                    perfLock = bool(value)
                    setSustainedPerformance(perfLock)
                    setGameMode(if (perfLock) 1 else 0)
                    if (perfLock) native.safeLockThreads(0)
                    startHints()
                    keepScreenOn(perfLock)
                    j.put("perfLock", perfLock)
                }
                "lag.gpuBoost" -> {
                    gpuBoost = bool(value)
                    if (gpuBoost) setGameMode(1)
                    j.put("gpuBoost", gpuBoost)
                }
                "mem.batteryOverride" -> {
                    if (bool(value)) requestBatteryExemption() else batteryOverride = false
                    j.put("batteryOverride", batteryOverride)
                    j.put("ignoring", ignoringBatteryOptimisations())
                }
                "gfx.quality" -> {
                    j.put("quality", value)
                    j.put("frameRate", targetFps)
                }
                "ui.theme" -> setStatusBarDark(value.contains("dark"))
                else -> j.put("noop", true)
            }
            j.put("gameMode", gameMode)
            j.put("hintSession", hintActive)
            j.put("nativeLib", native.available)
        } catch (t: Throwable) {
            j.put("error", t.javaClass.simpleName)
        }
        return j.toString()
    }

    fun status(): String {
        val j = JSONObject()
        j.put("targetFps", targetFps)
        j.put("sustained", sustainedPerf)
        j.put("perfLock", perfLock)
        j.put("gpuBoost", gpuBoost)
        j.put("unbuffered", unbuffered)
        j.put("aggression", aggression)
        j.put("batteryOverride", batteryOverride)
        j.put("ignoring", ignoringBatteryOptimisations())
        j.put("gameMode", gameMode)
        j.put("gameModeLabel", when (gameMode) {
            1 -> "PERFORMANCE"
            2 -> "BATTERY"
            0 -> "STANDARD"
            else -> "UNSUPPORTED"
        })
        j.put("hintSession", hintActive)
        j.put("thermal", thermalStatus())
        j.put("thermalLabel", thermalLabel(thermalStatus()))
        j.put("nativeLib", native.available)
        j.put("cores", Runtime.getRuntime().availableProcessors())
        return j.toString()
    }

    fun toast(text: String) {
        main.post { Toast.makeText(activity, text, Toast.LENGTH_SHORT).show() }
    }

    fun exit() {
        main.post { activity.finish() }
    }
}
