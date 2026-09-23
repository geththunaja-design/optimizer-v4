# Optimizer V.4.0 — native Android shell

The dashboard ships as **one codebase in two shells**:

| shell | what it is |
|---|---|
| web page | `../../index.html` + `../../src/*.js` — the perchance generator, works in any modern browser |
| Android APK | **this project** — the same web layer inside a WebView, plus the real Android control surface |

In the APK the web layer talks to the shell through `window.OptimizerNative`
(`JsApi.kt`, `@JavascriptInterface`). `src/native.js` + `src/caps.js` detect the shell,
route every setting to it, and re-label the whole UI as `NATIVE`.

## Layout

```
settings.gradle.kts / build.gradle.kts / gradle.properties   Gradle 8.7 + AGP 8.5, Kotlin 1.9
app/build.gradle.kts                        minSdk 24 (Android 7) → targetSdk 34, arm64 + armv7 + x86_64
app/src/main/AndroidManifest.xml            the requested permission set + game package queries
app/src/main/java/com/aash/optimizer/
    MainActivity.kt                         WebView shell over a secure local origin (WebViewAssetLoader)
    OptimizerWebView.kt                     touch stream handed to the platform unbuffered
    OptimizerEngine.kt                      every real non-root Android control (API-level gated)
    JsApi.kt                                the only surface JavaScript may call
    NativeBridge.kt                         JNI loader + guards
app/src/main/cpp/
    native-optimizer.cpp                    /proc + /sys readers, thread pinning, native CPU bench
    CMakeLists.txt                          builds liboptimizer.so
app/src/main/res/                           theme, strings, launcher icons (mdpi → xxxhdpi)
tools/sync-web-assets.sh                    bundles ../../index.html + ../../src into assets/www
tools/github-actions/build-apk.yml          one-click APK build in CI (copy to .github/workflows/)
tools/gitignore.txt                         copy to .gitignore at the repo root
```

## What the shell really does, and on which API

| dashboard setting | real Android API | from |
|---|---|---|
| Target FPS | `Window.setFrameRate()` + display mode selection | API 30 / 23 |
| Governor = performance | `setSustainedPerformanceMode()` + big-core affinity (`sched_setaffinity`) | API 24 |
| Preset / GPU boost | `GameManager.setGameMode(PERFORMANCE)` | API 31 |
| Shield, zero-lag | `PerformanceHintManager` hint session held at the target frame time | API 31 |
| Touch delay / polling | `View.requestUnbufferedDispatch()` — removes input batching | API 21 |
| Anti-thermal | `PowerManager.getCurrentThermalStatus()` + /sys thermal zones | API 29 |
| Battery override | `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Doze exemption) | API 23 |
| RAM gauge | `/proc/meminfo` (total / available / cached / swap) | always |
| CPU load | `/proc/stat` | always |
| SoC temperature | `/sys/class/thermal/thermal_zone*/temp` | most SoCs |
| CPU benchmark | native C++ integer + float workload, 1 core and N cores | always |
| Memory purge | WebView cache + app cache dir + process trim (real PSS delta) | always |
| Keep screen awake | `FLAG_KEEP_SCREEN_ON` | always |
| Game detection / launch | `PackageManager.getPackageInfo` / `getLaunchIntentForPackage` | always |
| Haptics / immersive / insets | `VibrationEffect`, `WindowInsetsController` | API 26 / 30 |

Every call is wrapped in try/catch and gated by `Build.VERSION.SDK_INT`, so the app runs on
Android 7 through 15 and simply reports "unsupported" where a device does not expose something.

## What is impossible without root — and why

Android's application sandbox means a normal (non-root) app **cannot**:

* change the CPU governor / GPU clock / thermal trip points of the SoC,
* write into another app's memory (aim lock, recoil patching, bullet-spread patching,
  "fake damage" injection into Free Fire / Free Fire MAX),
* clear another app's cache (`CLEAR_APP_CACHE` is `signature|privileged`, so a normal APK can
  declare it but never hold it),
* force-stop other apps (`KILL_BACKGROUND_PROCESSES` only affects your own processes).

Those features exist in this dashboard as real controls for the app's own engine and its
ballistics lab, and the capability layer labels them `MODEL` on every device instead of pretending.
Memory patching inside Free Fire is also a bannable offence.

## Building the APK

### On a PC / with Android Studio

```bash
# 1. Kotlin toolchain: JDK 17, Android SDK 34, NDK 26.1.10909125, CMake 3.22.1
# 2. bundle the web layer into the APK assets
./tools/sync-web-assets.sh
# 3. build (Android Studio: just open this folder and press Run)
./gradlew assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
```
Without a Gradle wrapper installed, use Android Studio, or `gradle assembleDebug` with Gradle 8.7+.

### Without a PC (free GitHub CI)

1. Download the whole generator (`index.html`, `src/`, `src/android/`) and push it to a GitHub repo.
2. Copy `tools/github-actions/build-apk.yml` to `.github/workflows/build-apk.yml`.
3. Actions → **Build Optimizer APK** → Run workflow.
4. Download the `OptimizerV4-debug-apk` artifact and install it on the phone
   (allow "install unknown apps" for your browser or file manager).

`tools/sync-web-assets.sh` runs inside the workflow, so the APK always contains exactly the web
layer in the repo — one codebase, two shells, no divergence.

## Notes

* `tools/gitignore.txt` → copy to `.gitignore` at the repo root (the perchance editor refuses to
  store a file or directory whose name starts with a dot, hence the two template files in `tools/`).
* `app/src/main/assets/www/` is generated by `tools/sync-web-assets.sh`; never edit it by hand.
* Release builds keep minification off so the JNI bridge and the `@JavascriptInterface` surface can
  never be stripped. `app/proguard-rules.pro` holds the keep rules if you want to enable it.
* `QUERY_ALL_PACKAGES` is what lets the launcher see the Free Fire packages; Play policy requires a
  justification for it on a published release.
