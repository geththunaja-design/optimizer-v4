# Optimizer V.4.0 — build the APK

This folder is the complete source of the app: the dashboard (web layer) **and** its Android
shell (Kotlin + NDK C++). The Android shell loads the same dashboard inside a WebView and gives
it the real Android control surface through `window.OptimizerNative`.

```
index.html                 the dashboard (web layer)
main.pjs                   perchance config: app name, version, developer, WhatsApp, theme
src/*.js | *.css | *.png   the dashboard modules
src/android/               the Android project (open THIS folder in Android Studio)
    settings.gradle.kts, build.gradle.kts, gradle.properties
    app/build.gradle.kts                    minSdk 24 (Android 7) -> targetSdk 34, arm64 + armv7 + x86_64
    app/src/main/AndroidManifest.xml         permissions + Free Fire package queries
    app/src/main/java/com/aash/optimizer/    MainActivity / OptimizerWebView / OptimizerEngine / JsApi / NativeBridge
    app/src/main/cpp/native-optimizer.cpp    /proc + /sys readers, core pinning, native CPU bench
    app/src/main/assets/www/                 the web layer, already bundled for the WebView
    tools/sync-web-assets.sh                 re-bundles index.html + src/ into assets/www
    tools/github-actions/build-apk.yml       the CI build recipe (Option A below)
```

---

## Option A — build it on GitHub, no PC needed (recommended)

1. Make a free GitHub account, then create a **new empty repository**
   (public or private — private repos get free build minutes too).
2. Upload the **contents of this folder** to that repository, keeping the folder structure.
   On the repo page: **Add file → Upload files**, then drag in `index.html`, `main.pjs`,
   `src/`, `BUILD-APK.md` (the `.github` folder may be hidden — see step 3).
3. Check that the build recipe arrived: the repo must contain
   `.github/workflows/build-apk.yml`.
   If it is missing (some uploaders skip hidden files), click **Add file → Create new file**,
   type the name exactly as `.github/workflows/build-apk.yml`, paste the contents of
   `src/android/tools/github-actions/build-apk.yml`, and commit.
4. Open the **Actions** tab → **Build Optimizer APK** → **Run workflow**.
   (A push also triggers it automatically.)
5. Wait ~5–10 minutes for the green tick. Open the run and download the artifact
   **OptimizerV4-debug-apk**, then unzip it to get `app-debug.apk`.
6. Copy `app-debug.apk` to the phone and install it. First time: allow
   *"install unknown apps"* for your browser or file manager.
   The phone may warn about an unknown developer — that is normal for a self-built APK.

## Option B — Android Studio on a PC

1. Install **Android Studio** (JDK 17 is bundled). In **SDK Manager** install:
   `Android SDK Platform 34`, `Build-Tools 34.0.0`, `CMake 3.22.1`,
   `NDK (Side by side) 26.1.10909125`.
2. **Open** the `src/android` folder as the project (not this outer folder).
3. The web layer is already bundled in `app/src/main/assets/www/`.
   After editing any web file, re-bundle it:
   `./tools/sync-web-assets.sh` (from `src/android`; on Windows use Git Bash or WSL,
   or just copy `index.html` + `src/*.js|*.css|*.png` into `app/src/main/assets/www/` yourself).
4. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
   Output: `src/android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Notes

* **The web layer is license-gated.** `index.html` starts with the license gate (an inline
  `window.LICENSE_CONFIG` / `window.LICENSE_KEYS` block + the gate module). The APK that
  `tools/sync-web-assets.sh` bundles from it is therefore gated too — a user needs a key issued
  by the developer before the dashboard starts. The key is only ever stored as a SHA-256 digest;
  see `src/firebase/README.md` for the key-issuing recipe.
* The APK is a **debug** APK — self-signed, installs anywhere, no Play Store needed.
  For a Play release you would add your own signing key (`*.keystore`), which never belongs in
  a public repo.
* Editing the app: UI + behaviour live in `src/*.js` and `index.html`; the editable config
  (app name, version, developer, WhatsApp, theme) is at the top of `src/config.js`
  (mirrored from `main.pjs` for the web page).
* The launcher icon is `src/android/app/src/main/res/mipmap-*/ic_launcher.png`.
* `QUERY_ALL_PACKAGES` is what lets the launcher detect Free Fire / Free Fire MAX.
  Google Play requires a written justification for that permission on a published release.
* The dashboard's web version and the APK share one codebase — nothing is duplicated.
