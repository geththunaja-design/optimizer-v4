package com.aash.optimizer

/**
 * JNI surface. Every method here is answered by liboptimizer.so (see cpp/native-optimizer.cpp),
 * i.e. by real C/C++ reading /proc, /sys and this process's own scheduling.
 *
 * If the native library is missing or fails to load, `available` stays false and every call
 * degrades to an empty answer instead of crashing - the app then runs in its web-only mode.
 */
class NativeBridge {

    var available = false
        private set

    init {
        available = try {
            System.loadLibrary("optimizer")
            true
        } catch (t: Throwable) {
            false
        }
    }

    fun load(): Boolean = available

    external fun deviceInfo(): String
    external fun cpuLoadPercent(): Int
    external fun memInfoMb(): String
    external fun thermalCelsius(): Float
    external fun lockAppThreads(cores: Int): Boolean
    external fun benchNative(iters: Int): String

    fun safeDeviceInfo(): String = call({ deviceInfo() }, "{}")
    fun safeMemInfo(): String = call({ memInfoMb() }, "{}")
    fun safeCpuLoad(): Int = try {
        if (available) cpuLoadPercent() else -1
    } catch (t: Throwable) { -1 }
    fun safeThermal(): Float = try {
        if (available) thermalCelsius() else -1f
    } catch (t: Throwable) { -1f }
    fun safeLockThreads(cores: Int): Boolean = try {
        available && lockAppThreads(cores)
    } catch (t: Throwable) { false }
    fun safeBench(iters: Int): String = call({ benchNative(iters) }, "{}")

    private inline fun call(block: () -> String, fallback: String): String = try {
        if (available) block() else fallback
    } catch (t: Throwable) { fallback }
}
