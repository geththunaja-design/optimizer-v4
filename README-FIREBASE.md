# Optimizer V.4.0 - the license-gated build (Firebase Studio / Firebase Hosting)

This repository is the **merged** build: the Optimizer V.4.0 dashboard **plus** its license gate.
Nothing loads until a valid license key is entered, and the key never appears in the source.

```
index.html                  the dashboard - the license gate lives at the top of this file
main.pjs                    perchance config (app name, version, developer, WhatsApp, theme)
src/*.js | *.css | *.png    the dashboard modules (the gate boots them - see src/main.js)
src/android/                the Android shell (Kotlin + NDK); its own build notes in src/android/README.md
src/firebase/               firebase.json, .idx/dev.nix and this file's source copy
src/tools/build-*           the packaging scripts (see "Rebuilding this package")
```

## How the license gate works

* `index.html` starts with an inline block: `window.LICENSE_CONFIG` (app name, owner, WhatsApp,
  messages) and `window.LICENSE_KEYS` (the allow-list), followed by the gate module.
* The gate hides the whole page (`html:not(.license-gate-ready) body > *` is
  `visibility:hidden`), shows a lock card, and hashes what you type with **SHA-256** after
  stripping every non-alphanumeric character and uppercasing the letters.
* Only the digest is compared, and only digests are stored - the plaintext key is **not** in
  this repo. That also means a lost key cannot be recovered from the source.
* A valid key unlocks the app and adds a bar showing `License active · unlimited`, or a live
  countdown for keys with an `exp` date.
* Anti-tamper: if the device clock jumps backwards by more than `rollbackToleranceMinutes`
  (10 by default) the app re-locks with the "device time has been changed" message.
* Expiry is re-checked every second - when a key expires the gate re-locks itself, and the
  dashboard halts its frame engine (`licensegate:lock` in `src/main.js`).
* Optional: the *Remember key* checkbox keeps the key in `localStorage` so it auto-activates
  next launch. Unchecking it removes the stored copy.

### Issuing a new key

1. Choose a key (at least 12 characters - e.g. `AASH-FF-2026-0017`). Give the buyer the exact
   text; keep it in your private owner list.
2. Compute its digest - the key must be alphanumeric-only and uppercase:

   ```bash
   printf '%s' "AASH-FF-2026-0017" | tr -d -c 'A-Za-z0-9' | tr 'a-z' 'A-Z' | sha256sum
   ```

   (Any SHA-256 tool works: on Android use a hash app, or run the same expression in a browser
   console with `crypto.subtle.digest`.)
3. Add one line to `window.LICENSE_KEYS` in `index.html`:

   ```js
   { label: "aash-ff-2017", hash: "PASTE_THE_64_CHAR_DIGEST", exp: null }
   ```

   `exp: null` never expires; or use an ISO date like `"2026-10-23T09:56:49.946Z"` for a
   time-limited key (as the `spare-30d` entry does).
4. Save. The key works immediately - no rebuild of the file itself is needed beyond saving it.

To revoke a key, delete its line. The build currently registers 2 keys (`owner`, `spare-30d`).

## Open it in Firebase Studio

1. Firebase Studio (firebase.studio) → **Create a workspace / Import a repo**.
   Either connect the Git repo that holds these files, or upload/import this folder.
2. Studio reads `.idx/dev.nix` from the repo root and provisions the environment
   (Node 20 + a static preview server). The preview pane shows the app on the `web` preview.
3. `index.html` is the entry point; the license gate appears first.

## Deploy it to Firebase Hosting

In the Studio terminal (or your own machine with Node installed):

```bash
npx -y firebase-tools@latest login
# put your project id in .firebaserc (replace YOUR_FIREBASE_PROJECT_ID), or:
npx -y firebase-tools@latest use --add YOUR_FIREBASE_PROJECT_ID
npx -y firebase-tools@latest deploy --only hosting
```

`firebase.json` serves the repo root, keeps `index.html` out of the CDN cache, and skips the
Android sources / docs / `main.pjs` when uploading. The app is then reachable at
`https://YOUR_PROJECT_ID.web.app`.

Prefer the drag-and-drop route? `npx -y firebase-tools@latest init hosting` and answer
**public directory: `.`**, **single-page app: No**, then deploy.

## Rebuilding this package

The source of truth for the dashboard is the perchance generator (`index.html` is body-only
there). This package holds the standalone version of the same file. To regenerate it from the
generator sources:

```bash
src/tools/build-firebase-package.sh            # builds ./dist/optimizer-v4-firebase/
src/tools/build-firebase-package.sh out.zip    # ...and zips it
```

The script wraps the body-only `index.html` into a full HTML document, copies `src/` (minus the
Android build assets), and drops in `firebase.json`, `.firebaserc`, `.idx/dev.nix` and
`.gitignore` from `src/firebase/`. Editing here means editing the perchance generator's
`index.html` - or, if you only ever ship this static build, edit `index.html` in this repo
directly and run `src/android/tools/sync-web-assets.sh` to refresh the APK assets.

## Notes

* The Android shell loads `src/android/app/src/main/assets/www/index.html`, generated by
  `src/android/tools/sync-web-assets.sh` from this repo's `index.html` - so the APK is
  license-gated too.
* WebView loads the assets over `https://appassets.androidplatform.net`, a secure origin, so
  `crypto.subtle` (used for the SHA-256 check) is available there just like in a browser.
* `main.pjs` is only used by the perchance page; it is not read by the static build (app config
  for the web/APK comes from `src/config.js`).
