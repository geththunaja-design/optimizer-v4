# Optimizer V.4.0 — specification & implementation map

App name: **Optimizer V.4.0** · Developer: **Aash optimizer** · VIP WhatsApp: **+94 71 238 6533**
· Next release: **Optimizer V.5.0 — coming soon**
Target: **Android 8.0+ (non-root)** · Category tabs must be **horizontal**

Everything below is implemented in this workspace. Where the original request asked for
something that Android does not permit without root, the implementation column says so
explicitly and states what the control really does.

## 1. Navigation & top bar
| Request | Implemented in |
|---|---|
| FPS counter HUD, global floating overlay with live FPS + app version | `src/monitors.js` (`#hud`, draggable, `ui.hud`) |
| Theme toggle dark/light | `src/main.js` `#themeBtn`, `applyTheme()` |
| CPU/GPU engine status badge | `src/monitors.js` `#engineBadge` (+ `M.cpuLoad`, `M.gpuLoad`) |

## 2. Hardware profiles
| Request | Implemented in |
|---|---|
| Device model, Android version, RAM capacity, CPU cores, screen resolution, GPU renderer | `src/device.js` `scanHardware()` → `#hwGrid` |
| Re-scan hardware specs button | `hw.scan` |
| Presets: Extreme Zero Lag / Max Performance / Balanced 60 / Ultra Smooth 90-120 | `src/config.js` `PRESETS`, `applyPreset()` → `#presetGrid` |
| Target indicators: FPS cap, touch sampling rate, CPU/GPU governor state, memory aggression | `#tgtFpsSel`, `#tgtTouchSel`, `#tgtGovSel`, `#tgtMemSlider` → `src/engine.js` |
| Console execution log | console dock + per-card log boxes (`src/ui.js` `log`) |

## 3. System monitors & fix FPS drops
| Request | Implemented in |
|---|---|
| Fix FPS Drops Shield Engine (enable/disable, frame pacing lock, anti-thermal override, zero-stutter buffer priority, "optimize now" button) | `mon.shield`, `mon.framePacing`, `mon.antiThermal`, `mon.stutterBuffer`, `mon.optimizeNow` |
| Zero Lag Plugin (performance lock, max GPU boost, zero-stutter lock, apply button) | `lag.perfLock`, `lag.gpuBoost`, `lag.zeroStutter`, `lag.apply` |
| Live metrics: in-game FPS, thermal state + temperature, FPS HUD toggle | `#monStats`, `#hudTherm`, `ui.hud` |
| Live telemetry graph, Chart.js, FPS + RAM load % | `src/monitors.js` `ensureChart()` (`chart.js@4.4.1/auto`, canvas fallback) |

The shield/pacing/anti-thermal controls are closed-loop controllers inside this app's own
render loop: pacing flattens delivery intervals, the shield reserves a per-frame deadline
budget, the anti-thermal guard detects sustained decay and re-levels quality. Thermal °C is an
estimate derived from frame-time decay (browsers do not expose the SoC sensor; the native build
reads it from `/sys/class/thermal`).

## 4. Aim & sensi (damage & recoil)
| Request | Implemented in |
|---|---|
| Toggles: fake damage fix, game recoil fix, aim stick to head, recoil stabilizer, bullet spread fix | `aim.*` → `src/aim.js` ballistics model |
| Recommended fire button size indicator, weapon class selector, drag technique guide, headshot connection bar | `#fireBtnSlider`, `#weaponSel`, `#dragGrade`, `#hsBar` |
| Drag headshot simulator with hits / headshots / registered damage tracking | `#aimCanvas`, `#aimStats` |

The simulator is a real ballistics model: per-weapon recoil/climb/spread/RPM, a network-lag
model (the drawn target is `lagMs` behind the authoritative position), ghost-hit detection and a
lag-compensation rewind when *Fake Damage Fix* is on. Aim-stick magnetises within a snap radius.
**Honest limit:** these switches cannot reach into Free Fire — a non-rooted app cannot write
another app's memory (and doing so is bannable). They tune the in-app lab, which is what a
non-root optimizer can legitimately offer.

## 5. Touch responsiveness & polling
| Request | Implemented in |
|---|---|
| Touch response delay slider 1–10 ms | `touch.delay` (real input-pipeline delay, visible as the lag between finger and processed marker) |
| Target polling 120 / 180 / 240 / 360 / 480 Hz | `touch.pollRate` |
| Calibration canvas with live swipe velocity px/ms + clear button | `#touchCanvas`, `touch.clear`, `touch.calibrate` |

`measuredHz` is measured from real pointer-event intervals, so the panel's true report rate is
shown and compared against the target.

## 6. Memory booster & battery throttles
| Request | Implemented in |
|---|---|
| Temperature-throttling override switch + boost button | `mem.batteryOverride`, `mem.boost` (stops the app downgrading its own quality under heat/low battery) |
| RAM radial gauge with live load % | `#ramGauge`, `src/memory.js` |
| Purge RAM & clean cache button | `mem.purge` — releases the buffer pool, deletes CacheStorage buckets, drops session scratch, re-measures the heap |
| Terminal execution log for memory ops | `data-log="MEMORY"` box |

## 7. Network ping tester & DNS optimizer
| Request | Implemented in |
|---|---|
| Live game ping + connection status badge | `src/net.js` `startPing()`, `#connBadge` |
| DNS selector: Cloudflare 1.1.1.1, Google 8.8.8.8, OpenDNS 208.67.222.222 | `net.dns`, `net.applyDns`, `net.testDns` (real DoH lookups + latency) |
| Regional cluster latency table | `#regionRows`, `net.testRegions` (Cloudflare, Google, AWS Singapore/Mumbai, DigitalOcean SGP1, Azure SEA, Garena) |

## 8. GFX visual tuner & shader renderer
| Request | Implemented in |
|---|---|
| Quality presets Smooth / Balanced / Ultra | `gfx.quality` (render scale, bloom taps, fbm octaves, ember density — recompiles the shaders) |
| Colour style Vivid / Classic | `gfx.color` (saturation, contrast, temperature, gamma uniforms) |
| Apply GFX shaders button + live render canvas | `gfx.apply`, `#gfxCanvas` (WebGL2 scene → FBO → bloom + grading composite) |

Real GPU cost is measured with `EXT_disjoint_timer_query_webgl2` when the device exposes it.

## 9. About & benchmark studio
| Request | Implemented in |
|---|---|
| Run benchmark test + progress bar + step logger | `bench.run`, `#benchBar`, BENCH log |
| Results before/after comparison | `#benchRows` (first run = baseline, later runs show real deltas) |
| Restore all settings to default | `about.restore` → `resetAll()` |
| Settings reset when the app is closed | nothing is persisted — reload = factory state (logged on boot) |

## 10. Game & launch
| Request | Implemented in |
|---|---|
| Detect whether Free Fire / Free Fire MAX is installed, launch it instantly | `src/launch.js` `launchGame()` — `intent://…package=…` handed to the top-level page inside the tap (Android refuses intents fired from a popup tab), one launch-tab retry after 2 s, then the probe |
| Wrong button → popup "game not found" for 5 s with a close button | `notFoundPopup()` (auto-dismiss 5 s + Close, card marked as wrong) |
| Correct button → launch, no popup | detected via activity switch / launch-tab consumption; package cached as installed |

Packages: `com.dts.freefireth` (Free Fire), `com.dts.freefiremax` (Free Fire MAX). The native
build (`src/android/`) does this exactly with `PackageManager` — see its README.

## 11. Developer
Created by **Aash optimizer** · VIP packages on WhatsApp only **+94 71 238 6533** ·
**Optimizer V.5.0 coming soon** — all in the About tab, with a working `wa.me` link and share button.

## Cross-cutting requirements
* **Horizontal category tabs** — `.tabstrip` is a horizontal scrolling strip (10 categories).
* **Instant effect** — every control writes to the engine immediately and logs what it did.
* **Professional visual language** — dark/light themes, glass cards, neon accent system, mono
  console, animated toasts/modals, responsive from 360 px phones to desktop.
* **Permissions** — the nine requested Android permissions are declared for the native build in
  `android/AndroidManifest.xml`; the About tab lists them with their real Android protection
  levels, and requests everything the browser can actually grant (notifications, persistence).

## Honest limits (non-root, no exceptions)
1. CPU governor, GPU clocks, thermal trip points, other apps' cache and other apps' memory are
   **not writable** by any non-root app, with or without permissions.
2. Aim/recoil/bullet-spread modification *inside* Free Fire is memory patching → root only,
   bannable. Here it is a real model inside this app's simulator.
3. `CLEAR_APP_CACHE` is `signature|privileged` — declaring it is legal, holding it is impossible
   for a normal APK. `KILL_BACKGROUND_PROCESSES` only affects your own processes on Android 8+.

---

## 12. "Every setting must work on every Android, non-root" — how that is answered

A browser tab physically cannot reach the device: the sandbox blocks CPU governors, GPU clocks,
thermal limits, other apps' caches and other apps' memory, with or without permissions. So the
requirement is met in two halves, and **both ship in this source tree**:

### a) A per-device capability layer (`src/caps.js` + `src/native.js`)

Every switch, slider and tool is catalogued with what it really does **in the browser on this
device** and what it really does **inside the Android shell**, and each is resolved live into one
of four levels:

| level | meaning |
|---|---|
| `NATIVE` | executed by the Android shell through a real system API (APK only) |
| `REAL` | really executed on this device and measured |
| `LIMITED` | genuinely applied, but Android bounds how far any non-root app may reach |
| `MODEL` | drives this app's own engine / ballistics lab — the closest a non-root app may legally get |

* The top-bar **mode chip** shows `BROWSER` or `NATIVE SHELL`; tapping it opens the full audit.
* **Every card gets a badge** (`⚙ caps.annotate`) rating the settings inside it for *this* device;
  tapping a badge opens that card's rows with the exact API named under each one.
* Hardware tab → **Device Compatibility & Every-Setting Audit**: live facts (shell, Android
  version, cores, memory class, GPU, WebGL2/timer queries, panel Hz, coalesced touch, wake lock,
  battery API, haptics, storage) plus both buttons.
* `caps.autoTune()` adapts the app to the device it actually landed on: 2-core phones get the
  smooth tier + 30 FPS cap + tighter pacing, 8-core phones get the ultra tier, no-WebGL2 devices
  are told the shader tuner falls back.
* Anything the browser cannot do is *replaced by something that does work*, and the log says so —
  e.g. the screen wake lock is really held during a performance profile, `getCoalescedEvents()`
  really measures the panel's touch report rate, and the DNS profile really switches the resolver
  used by every lookup the app performs.

### b) The native Android shell (`src/android/`)

A complete, buildable Kotlin + NDK project that loads *this same web dashboard* into a WebView
over a secure local origin and hands it the real Android control surface as
`window.OptimizerNative`. See `src/android/README.md` for the build (including a one-click GitHub
Actions workflow that produces an installable APK).

APIs the shell really drives, each API-level gated so it works from Android 7 to 15:
`Window.setFrameRate` / `preferredDisplayModeId` (FPS cap), `setSustainedPerformanceMode`,
`GameManager.setGameMode`, `PerformanceHintManager` hint session held at the target frame time,
`View.requestUnbufferedDispatch` (input latency), `PowerManager.getCurrentThermalStatus`,
`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `PackageManager` game detection + launch,
`FLAG_KEEP_SCREEN_ON`, `VibrationEffect`, immersive fullscreen and real window insets, plus
`/proc/stat`, `/proc/meminfo`, `/proc/cpuinfo`, `/sys/class/thermal/*` and a native C++ CPU
benchmark through the NDK layer.

In the shell, CPU load, SoC temperature and free RAM stop being estimates: the engine reads them
from the kernel (`liboptimizer.so`) and the monitor labels switch from `CPU engine` / `Thermal
est.` to `CPU device` / `SoC temp`.

### c) One more real fix found while doing this

The GPU fill-rate benchmark could freeze the UI thread on a software or very slow GPU, because a
single `gl.finish()` frame could take longer than the whole test. `gpuFill()` now aborts after any
single frame that exceeds 250 ms, so the benchmark stays responsive on low-end devices.

