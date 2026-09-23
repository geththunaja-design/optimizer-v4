#!/usr/bin/env bash
# Optimizer V.4.0 - build the static / Firebase Studio package.
# -----------------------------------------------------------------------------
# The generator's index.html is body-only (perchance wraps it). This script turns
# it into a standalone document and assembles a ready-to-import repo:
#
#   index.html                  standalone dashboard + license gate
#   main.pjs                    perchance config (reference)
#   BUILD-APK.md                how to build the Android APK
#   src/*.js|*.css|*.png        dashboard modules
#   src/android/**              the Android shell (Kotlin + NDK)
#   src/firebase/**             firebase.json / .idx/dev.nix / docs (source copies)
#   src/tools/**                this script
#   firebase.json               Firebase Hosting config (serves the repo root)
#   .firebaserc                 project id placeholder
#   .idx/dev.nix                Firebase Studio environment + preview
#   .github/workflows/build-apk.yml
#   .gitignore
#   README-FIREBASE.md          import / deploy / key-issuing instructions
#
# Usage:
#   src/tools/build-firebase-package.sh                    -> ./dist/optimizer-v4-firebase
#   src/tools/build-firebase-package.sh my-out-dir         -> your directory
#   src/tools/build-firebase-package.sh optimizer.zip      -> build + zip
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"      # .../src
root="$(cd "$here/.." && pwd)"                               # generator root

[ -f "$root/index.html" ] || { echo "ERROR: no index.html at $root" >&2; exit 1; }
[ -d "$root/src" ] || { echo "ERROR: no src/ at $root" >&2; exit 1; }

target="${1:-$root/dist/optimizer-v4-firebase}"
case "$target" in
  *.zip) out="${target%.zip}"; zip_to="$target" ;;
  *)     out="$target";        zip_to="" ;;
esac

echo "source : $root"
echo "target : $out"

rm -rf "$out"
mkdir -p "$out/src"

# 1. the dashboard, wrapped into a full HTML document if it is body-only
if head -n 5 "$root/index.html" | grep -qi '<!doctype'; then
  cp "$root/index.html" "$out/index.html"
else
  {
    printf '%s\n' '<!doctype html>'
    printf '%s\n' '<html lang="en"><head>'
    printf '%s\n' '<meta charset="utf-8">'
    printf '%s\n' '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    printf '%s\n' '<meta name="color-scheme" content="dark light">'
    printf '%s\n' '<meta name="theme-color" content="#05070f">'
    printf '%s\n' '<title>Optimizer V.4.0</title>'
    printf '%s\n' '</head><body>'
    cat "$root/index.html"
    printf '\n%s\n' '</body></html>'
  } > "$out/index.html"
fi

# 2. the whole src/ tree (modules, docs, Android shell, firebase + tools sources)
cp -R "$root/src/." "$out/src/"

# 3. drop Android build output / generated assets if any slipped in
find "$out/src" \( -name build -o -name .gradle -o -name .cxx -o -name node_modules \) \
  -type d -prune -exec rm -rf {} + 2>/dev/null || true
rm -f "$out/src/local.properties" "$out/src/android/local.properties"

# 4. repo-root files
[ -f "$root/main.pjs" ] && cp "$root/main.pjs" "$out/main.pjs"

cp "$root/src/firebase/firebase.json"    "$out/firebase.json"
cp "$root/src/firebase/firebaserc.json"  "$out/.firebaserc"
cp "$root/src/firebase/gitignore.txt"    "$out/.gitignore"
cp "$root/src/firebase/README.md"        "$out/README-FIREBASE.md"
[ -f "$root/src/BUILD-APK.md" ] && cp "$root/src/BUILD-APK.md" "$out/BUILD-APK.md"

mkdir -p "$out/.idx"
cp "$root/src/firebase/dev.nix" "$out/.idx/dev.nix"

mkdir -p "$out/.github/workflows"
cp "$root/src/android/tools/github-actions/build-apk.yml" "$out/.github/workflows/build-apk.yml"

echo "files: $(find "$out" -type f | wc -l | tr -d ' ')"

if [ -n "$zip_to" ]; then
  rm -f "$zip_to"
  ( cd "$(dirname "$out")" && zip -qr "$(cd "$(dirname "$zip_to")" && pwd)/$(basename "$zip_to")" "$(basename "$out")" )
  echo "zip   : $zip_to"
fi
echo "done  - import '$out' into Firebase Studio, or:  cd \"$out\" && npx -y firebase-tools@latest deploy --only hosting"
