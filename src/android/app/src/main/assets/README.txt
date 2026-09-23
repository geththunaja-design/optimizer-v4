Optimizer V.4.0 - native assets
================================

app/src/main/assets/www/ is GENERATED - do not edit it by hand.

The dashboard ships as one codebase in two shells:

  * web page   : ../../index.html + ../../src/*.js|*.css   (the perchance generator)
  * Android APK: this project, which loads that same web layer inside a WebView and gives it
                 the real Android control surface (OptimizerEngine.kt)

Run  ../../tools/sync-web-assets.sh  (i.e. tools/sync-web-assets.sh from the project root)
before the first Gradle build and after every change to the web layer. It copies the modules
into www/src/ and wraps the body-only index.html into a full document.
