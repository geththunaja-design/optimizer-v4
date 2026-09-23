import { APP, LABELS } from "./config.js";
import { el, q, qa, log, toast, popup, escapeHtml } from "./ui.js";

export const LEVELS = {
  native: { tag: "NATIVE", cls: "cap-native", rank: 3, desc: "Executed by the Android shell through a real system API." },
  real: { tag: "REAL", cls: "cap-real", rank: 2, desc: "Really executed on this device and measured." },
  limited: { tag: "LIMITED", cls: "cap-limited", rank: 1, desc: "Genuinely applied, but Android bounds how far any non-root app may reach." },
  model: { tag: "MODEL", cls: "cap-model", rank: 0, desc: "Drives this app's own engine / ballistics lab \u2014 the closest a non-root app can legally get." },
};

const C = (group, label, webLv, webNote, natLv, natNote, natApi) => ({ group, label, webLv, webNote, natLv, natNote, natApi: natApi || "" });

export const MATRIX = {
  "hw.preset": C("Hardware", "Optimization Presets", "limited",
    "Writes every parameter of this app's engine at once - frame limiter, pacing, scheduler priority, quality tier and buffer pool.",
    "native", "Also drives the system game mode and sustained-performance build, so the device itself switches profile.",
    "GameManager.setGameMode / setSustainedPerformanceMode"),
  "hw.targetFps": C("Hardware", "Target FPS Cap", "real",
    "Enforced by the app's own frame limiter; rAF intervals are measured live to prove the cap holds.",
    "native", "Sets the window frame rate and asks the display for the matching refresh mode.",
    "Window.setFrameRate / LayoutParams.preferredDisplayModeId"),
  "hw.governor": C("Hardware", "CPU / GPU Governor State", "limited",
    "The browser cannot touch the SoC governor. The value really changes this app's scheduler priority, worker count, timer resolution and quality tier.",
    "native", "Requests the performance power profile and pins the render thread to the fastest cores of this exact SoC.",
    "PerformanceHintManager / sched_setaffinity / setpriority"),
  "hw.memAggression": C("Hardware", "Memory Aggression Level", "real",
    "Resizes the real reclaimable buffer pool and how hard the app trims its own heap.",
    "native", "Also trims the process heap and clears the app's own cache directory on the same level.",
    "ActivityManager / Debug.MemoryInfo"),
  "hw.touchRate": C("Hardware", "Touch Sampling Rate", "real",
    "Every touch sample is read with getCoalescedEvents(), so the real panel report rate is read and the input pipeline runs at this rate.",
    "native", "Removes the input batching delay for the whole window.",
    "View.requestUnbufferedDispatch"),
  "mon.shield": C("Engine", "Fix FPS Drops Shield Engine", "real", "Reserves a real frame budget in the render loop and refuses late delivery.", "native", "Same budget, applied with the system's performance hint session.", "PerformanceHintManager.createHintSession"),
  "mon.framePacing": C("Engine", "Frame Pacing Lock", "real", "Flattens frame intervals in the real loop; jitter is measured before and after.", "native", "Paces on the choreographer's frame deadline instead of a timer.", "Choreographer.postFrameCallback"),
  "mon.antiThermal": C("Engine", "Anti-Thermal Drop Override", "limited", "Detects sustained frame-time decay and re-levels it inside this app. Thermal trip points belong to the kernel.", "native", "Reads the real SoC thermal status and sheds quality before the device throttles.", "PowerManager.getCurrentThermalStatus"),
  "mon.stutterBuffer": C("Engine", "Zero Stutter Buffer Priority", "limited", "Runs the pipeline on a deep double buffer with a deadline queue inside this app.", "native", "Publishes the app's real target update rate to the Android scheduler.", "PerformanceHintManager preferredUpdateRateNs"),
  "lag.perfLock": C("Zero Lag", "Performance Lock CPU Governor", "limited", "Raises this app's own scheduler priority and holds a screen wake lock while the profile is active.", "native", "Creates a hint session that holds the CPU at the requested rate for the whole session.", "PerformanceHintManager.createHintSession / setThreads"),
  "lag.gpuBoost": C("Zero Lag", "Maximum Boost GPU Clock Target", "limited", "Requests a high-performance WebGL context and full render scale. GPU clocks are kernel-owned.", "native", "Asks the device for its maximum GPU clock target through the performance profile.", "GameManager / PowerManager performance profile"),
  "lag.zeroStutter": C("Zero Lag", "Zero Stutter Frame Pacing", "real", "Removes one-frame hitches from the app's delivery queue.", "native", "Same lock, plus unbuffered input dispatch so the fix covers touch as well.", "View.requestUnbufferedDispatch"),
  "aim.fakeDamage": C("Aim & Sensi", "Fake Damage Fix", "model", "Powers this app's hit-registration model in the ballistics lab.", "model", "Not possible from any non-root process - it is a memory write into another app, and it is bannable in Free Fire.", "root only"),
  "aim.recoilFix": C("Aim & Sensi", "Game Recoil Fix", "model", "Powers the recoil-compensation curve in the ballistics lab.", "model", "Not possible from any non-root process - recoil lives inside the game's own memory.", "root only"),
  "aim.aimStick": C("Aim & Sensi", "Aim Stick to Head", "model", "Powers the head-snap magnet in the ballistics lab.", "model", "Not possible from any non-root process, and bannable in Free Fire.", "root only"),
  "aim.recoilStabilizer": C("Aim & Sensi", "Recoil Stabilizer", "model", "Damps the random climb component in the ballistics lab.", "model", "Not possible from any non-root process.", "root only"),
  "aim.spreadFix": C("Aim & Sensi", "Bullet Spread Fix", "model", "Tightens the spread cone in the ballistics lab.", "model", "Not possible from any non-root process.", "root only"),
  "aim.fireButton": C("Aim & Sensi", "Fire Button Size Guide", "real", "Redraws the real guide canvas and the hit window it reports.", "real", "Identical - the guide is the same code in both shells.", ""),
  "aim.weapon": C("Aim & Sensi", "Weapon Class Selector", "real", "Switches the real ballistic profile used by the lab.", "real", "Identical in both shells.", ""),
  "touch.delay": C("Touch", "Touch Response Delay", "real", "Real input-pipeline delay applied to this app's own touch handling.", "native", "Applied on the native input thread with unbuffered dispatch.", "View.requestUnbufferedDispatch"),
  "touch.pollRate": C("Touch", "Target Touch Polling Frequency", "real", "The engine refuses to consume touch samples slower than this; the measured panel rate is shown live.", "native", "The native input thread is driven at this rate.", "Choreographer / InputDevice"),
  "mem.batteryOverride": C("Memory", "Battery / Thermal Throttle Override", "limited", "Stops this app from downgrading itself; the system's own throttling stays in place for every non-root app.", "native", "Requests a Doze exemption so the system stops throttling this app in the background.", "ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"),
  "net.dns": C("Network", "Gaming DNS Profile", "real", "Every lookup this app performs really goes through the selected DNS-over-HTTPS resolver.", "real", "Same, in-app. The device-wide resolver needs root.", "DoH in-app"),
  "net.region": C("Network", "Regional Node Selection", "real", "Measured live against the real regional endpoints.", "real", "Identical in both shells.", ""),
  "gfx.quality": C("GFX", "Graphics Quality Preset", "real", "Changes render scale and effects on the real WebGL2 pipeline.", "native", "Also aligns the window frame rate with the chosen tier.", "Window.setFrameRate"),
  "gfx.color": C("GFX", "Colour Style Filter", "real", "Changes the grading of the real shader composite.", "real", "Identical in both shells.", ""),
  "ui.hud": C("App", "FPS Counter HUD Overlay", "real", "Real overlay driven by the measured frame loop.", "real", "Identical in both shells.", ""),
  "ui.graph": C("App", "Live Telemetry Graph", "real", "Real FPS and memory stream.", "real", "Identical in both shells.", ""),
  "ui.theme": C("App", "Dark / Light Theme", "real", "Real theme switch, remembered on this device.", "real", "Identical in both shells.", ""),
};

export const FEATURES = [
  ["hardware-scan", "Hardware Detection", "Hardware", "real", "Model, Android version, cores, memory class, pixel density, GPU renderer string and screen size.", "real", "Model, SoC, ABI list, cores, RAM from /proc, screen metrics.", "Build / PackageManager"],
  ["refresh-measure", "Panel Refresh Rate", "Hardware", "real", "Measured from live rAF intervals over many frames.", "real", "Read from Display.getRefreshRate() and measured.", "Display.getSupportedModes"],
  ["fps-hud", "FPS / Frame-time / Jitter", "Engine", "real", "Computed from the real frame loop.", "real", "Same loop in the native shell.", ""],
  ["cpu-load", "CPU Load Percentage", "Engine", "limited", "Estimated from this app's own main-thread duty cycle, not the whole device.", "native", "Read from /proc/stat - the whole device's real CPU load.", "/proc/stat"],
  ["thermal-read", "SoC Temperature", "Engine", "model", "Browsers expose no thermal sensor; the app estimates heat from sustained frame-time decay.", "native", "Real temperature from the thermal zones.", "/sys/class/thermal/thermal_zone*/temp"],
  ["battery-read", "Battery Level / Temperature", "Memory", "limited", "navigator.getBattery() where the browser exposes it; charging state and level only.", "native", "Level, temperature, voltage, health and charge state.", "BatteryManager"],
  ["ram-gauge", "RAM Gauge", "Memory", "limited", "Real JS heap usage where performance.memory exists, otherwise the app's own pool only.", "native", "Whole-device total, available and cached RAM.", "/proc/meminfo"],
  ["cache-purge", "Cache / Buffer Purge", "Memory", "real", "Releases the real buffer pool and deletes this app's own Cache Storage entries. The bytes drop is visible.", "native", "Also clears the app's own cache directory on disk.", "ActivityManager / File API"],
  ["storage-estimate", "Storage Footprint", "Memory", "real", "navigator.storage.estimate() reports the real quota and usage.", "native", "Package size and free disk space.", "StorageManager / PackageManager"],
  ["ping-monitor", "Game Ping Monitor", "Network", "real", "Real timed requests and DNS lookups.", "real", "Identical in both shells.", ""],
  ["dns-bench", "Resolver Benchmark", "Network", "real", "Real DoH queries timed against each resolver.", "real", "Identical in both shells.", ""],
  ["region-test", "Regional Node Latency", "Network", "real", "Real requests to the regional endpoints.", "real", "Identical in both shells.", ""],
  ["bench-cpu", "CPU Benchmark (1T / NT)", "Benchmark", "real", "Real timed compute on one and on all cores.", "native", "Plus a native C++ single-core and multi-core score for comparison.", "NDK native-bench"],
  ["bench-gpu", "GPU Fill-rate Benchmark", "Benchmark", "real", "Real WebGL2 fill-rate workload.", "real", "Same pipeline in the native shell.", ""],
  ["bench-ram", "Memory Bandwidth", "Benchmark", "real", "Real typed-array copy bandwidth.", "real", "Identical in both shells.", ""],
  ["bench-io", "Storage I/O", "Benchmark", "real", "Real IndexedDB write/read timing.", "native", "Real file I/O in the app's own sandbox.", "File API"],
  ["game-detect", "Installed Game Detection", "Launcher", "limited", "Uses an Android intent probe with a fallback handshake - accurate but indirect. Browsers cannot list installed apps.", "native", "Exact yes/no straight from the package manager.", "PackageManager.getPackageInfo"],
  ["game-launch", "Game Launcher", "Launcher", "limited", "Opens the game via its Android intent scheme in a new tab. A blocked launch is reported as \"not installed\".", "native", "Launches the exact installed package and reports a real failure code.", "PackageManager.getLaunchIntentForPackage"],
  ["wake-lock", "Keep Screen Awake", "App", "real", "Real Screen Wake Lock held while a performance profile is active.", "native", "FLAG_KEEP_SCREEN_ON plus the screen wakelock.", "WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON"],
  ["haptics", "Haptic Feedback", "App", "real", "Real vibration on every confirmed action where the browser allows it.", "native", "Real vibration with the device's own amplitude control.", "Vibrator / VibrationEffect"],
  ["fullscreen", "Fullscreen / Immersive", "App", "real", "Real Fullscreen API, plus orientation lock where the browser allows it.", "native", "True immersive fullscreen without any browser chrome.", "WindowInsetsController"],
  ["safe-area", "Notch / Gesture-bar Insets", "App", "real", "Uses the CSS safe-area insets the platform reports.", "native", "Real window insets from the display cutout and navigation mode.", "WindowInsets"],
];

/* ------------------------------------------------------------------- env --- */
export const bridge = () => window.OptimizerNative || window.AndroidOptimizer || null;
export function isNative() {
  const b = bridge();
  if (b) {
    if (typeof b.mode === "function") {
      try { return b.mode() === "native"; } catch (e) { return true; }
    }
    return true;
  }
  return /OptimizerV4/i.test(navigator.userAgent);
}

export let nativeApplied = null;
export function nativeStatus() {
  const b = bridge();
  if (!b || typeof b.status !== "function") return null;
  try { return JSON.parse(b.status() || "null"); } catch (e) { return null; }
}

export const facts = {
  shell: isNative() ? "native" : "browser",
  android: /Android/i.test(navigator.userAgent),
  androidVersion: (navigator.userAgent.match(/Android\s([\d.]+)/) || [])[1] || "",
  chromium: (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || "",
  cores: navigator.hardwareConcurrency || 0,
  memClass: navigator.deviceMemory || 0,
  dpr: window.devicePixelRatio || 1,
  touch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
  webgl2: false,
  gpu: "unknown",
  timerQuery: false,
  wakeLock: "wakeLock" in navigator,
  battery: "getBattery" in navigator,
  netInfo: !!(navigator.connection || navigator.mozConnection || navigator.webkitConnection),
  vibrate: typeof navigator.vibrate === "function",
  fullscreen: !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen),
  orientationLock: !!(screen.orientation && screen.orientation.lock),
  storageEstimate: !!(navigator.storage && navigator.storage.estimate),
  persist: !!(navigator.storage && navigator.storage.persist),
  sw: "serviceWorker" in navigator,
  caches: "caches" in window,
  heap: !!(performance && performance.memory),
  coalesced: typeof TouchEvent !== "undefined" && !!TouchEvent.prototype.getCoalescedEvents,
  workers: typeof Worker === "function",
  scheduling: !!(window.scheduler && scheduler.postTask),
  wakeLockHeld: false,
  quotaMb: 0,
  usageMb: 0,
  batteryPct: -1,
  charging: null,
  native: null,
};

export function lowEnd() {
  return (facts.cores && facts.cores <= 4) || (facts.memClass && facts.memClass <= 2);
}

async function probeGpu() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    if (!gl) return;
    facts.webgl2 = true;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) facts.gpu = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "unknown";
    else facts.gpu = gl.getParameter(gl.RENDERER) || "unknown";
    facts.timerQuery = !!gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  } catch (e) { }
}

export async function probe() {
  await probeGpu();
  if (facts.storageEstimate) {
    try {
      const e = await navigator.storage.estimate();
      facts.quotaMb = Math.round((e.quota || 0) / 1048576);
      facts.usageMb = Math.round((e.usage || 0) / 1048576);
    } catch (e) { }
  }
  if (facts.battery) {
    try {
      const b = await navigator.getBattery();
      facts.batteryPct = Math.round(b.level * 100);
      facts.charging = b.charging;
    } catch (e) { }
  }
  const b = bridge();
  if (b) {
    try {
      const d = JSON.parse(b.deviceInfo() || "{}");
      facts.native = d;
      if (d.gpu) facts.gpu = d.gpu;
      if (d.memClassMb) facts.memClass = Math.round(d.memClassMb / 1024);
    } catch (e) { }
    try { facts.batteryPct = JSON.parse(b.batteryInfo() || "{}").percent; } catch (e) { }
  }
  return facts;
}

/* ---------------------------------------------------------------- resolve -- */
export function status(key) {
  const m = MATRIX[key];
  if (!m) return { key, label: key, group: "Other", level: "model", note: "Not catalogued." };
  const nat = isNative();
  let level = nat ? m.natLv : m.webLv;
  let note = nat ? m.natNote : m.webNote;
  let api = m.natApi;
  if (!nat) {
    const need = { "gfx.quality": "webgl2", "mem.batteryOverride": "battery", "lag.perfLock": "wakeLock" }[key];
    if (need && !facts[need]) { level = "limited"; note += " This device/browser does not expose that API, so the app uses its own equivalent."; }
    if (key === "gfx.quality" && !facts.webgl2) note = "Changes render scale, particle density and the colour grade of the live render. WebGL2 is not exposed here, so the same controls drive the built-in 2D software renderer instead.";
  }
  return { key, label: m.label, group: m.group, level, note, api, other: nat ? m.webLv : m.natLv, otherNote: nat ? m.webNote : m.natNote };
}

export function featureStatus(f) {
  const [, label, group] = f;
  const nat = isNative();
  let level = nat ? f[5] : f[3];
  let note = nat ? f[6] : f[4];
  let api = nat ? f[7] : f[4];
  const gated = {
    "cpu-load": facts.native ? null : null,
    "battery-read": "battery",
    "ram-gauge": "heap",
    "refresh-measure": null,
    "wake-lock": "wakeLock",
    "haptics": "vibrate",
    "fullscreen": "fullscreen",
    "storage-estimate": "storageEstimate",
    "bench-gpu": "webgl2",
    "game-detect": null,
  }[f[0]];
  if (!nat && gated && !facts[gated]) { level = "limited"; note += " Not exposed by this browser."; }
  return { key: f[0], label: label, group: group, level: level, note: note, api: api };
}

export function summary() {
  const rows = allRows();
  const s = { native: 0, real: 0, limited: 0, model: 0, total: rows.length };
  rows.forEach((r) => { s[r.level]++; });
  return s;
}

export function allRows() {
  const rows = Object.keys(MATRIX).map((k) => status(k));
  FEATURES.forEach((f) => rows.push(featureStatus(f)));
  return rows;
}

/* ------------------------------------------------------------------ report -- */
function pill(level) {
  const L = LEVELS[level];
  return '<span class="pill ' + L.cls + '">' + L.tag + "</span>";
}

export function reportHtml(filterKeys) {
  const rows = allRows().filter((r) => !filterKeys || filterKeys.includes(r.key) || filterKeys.includes(r.group));
  const groups = {};
  rows.forEach((r) => { (groups[r.group] = groups[r.group] || []).push(r); });
  const nat = isNative();
  return Object.entries(groups).map(([g, list]) => {
    return '<div class="compat-grp"><div class="compat-gt">' + escapeHtml(g) + "</div>" +
      list.map((r) => '<div class="compat-row"><div class="compat-l">' + escapeHtml(r.label) +
        (r.api && nat ? '<div class="compat-api">' + escapeHtml(r.api) + "</div>" : "") +
        '</div><div class="compat-s">' + pill(r.level) + r.note + "</div></div>").join("") +
      "</div>";
  }).join("");
}

export function reportText() {
  const s = summary();
  const head = [APP.name + " " + APP.build,
    "shell=" + (isNative() ? "NATIVE APK" : "browser"),
    "android=" + (facts.androidVersion || "desktop preview"),
    "chrome=" + (facts.chromium || "-"),
    "cores=" + facts.cores, "deviceMemoryClass=" + (facts.memClass || "-") + "GB",
    "webgl2=" + facts.webgl2, "gpu=" + facts.gpu,
    "verdict: native " + s.native + " / real " + s.real + " / limited " + s.limited + " / model " + s.model + " of " + s.total].join("\n");
  return head + "\n\n" + allRows().map((r) => "[" + LEVELS[r.level].tag + "] " + r.group + " :: " + r.label + " - " + r.note).join("\n");
}

export function openReport(keys, title) {
  popup(title || "Every setting, on THIS device", '<div class="compat-scroll">' + reportHtml(keys) + "</div>" +
    '<div class="notice" style="margin-top:12px"><span class="n-ico">&#8505;&#65039;</span><span>' +
    (isNative()
      ? "Running inside the Android shell: every NATIVE row is executed by a real system API and every LIMITED row is the furthest Android allows a non-root app to go."
      : "Running in a browser: NATIVE rows are what the Android shell does when you install the APK build; REAL rows are already real here, on this device.") +
    "</span></div>", { footer: '<button class="btn" data-close>Close</button><button class="btn ghost" id="compatCopyBtn">&#128203; Copy report</button>' });
  const copy = el("compatCopyBtn");
  if (copy) copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(reportText()); log.ok("DEVICE", "Compatibility report copied to clipboard."); toast("Report copied.", "ok"); }
    catch (e) { log.warn("DEVICE", "Clipboard blocked: " + e.message); }
  });
}

/* ------------------------------------------------------- browser-side real -- */
export let wakeLock = null;
export async function holdWake() {
  if (!facts.wakeLock || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    facts.wakeLockHeld = true;
    wakeLock.addEventListener("release", () => { facts.wakeLockHeld = false; wakeLock = null; });
    log.ok("ENGINE", "Screen wake lock held \u2014 the panel will not dim while the performance profile is active.");
  } catch (e) { log.warn("ENGINE", "Wake lock refused by the browser: " + e.message); }
}
export function releaseWake() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) { } wakeLock = null; facts.wakeLockHeld = false; }
}

export function buzz(ms) {
  if (facts.vibrate) { try { navigator.vibrate(ms || 18); } catch (e) { } }
  const b = bridge();
  if (b && b.vibrate) { try { b.vibrate(ms || 18); } catch (e) { } }
}

let live = {};
export function track(stateObj) { live = stateObj; }

function wantWake() {
  const fast = window.__PRESETS && live["hw.preset"] && window.__PRESETS[live["hw.preset"]] && live["hw.preset"] !== "balanced";
  return live["hw.governor"] === "performance" || live["lag.perfLock"] === true || live["mon.shield"] === true || !!fast;
}

/* ---------------------------------------------------------- native routing -- */
const NATIVE_SWITCH = {
  "mon.shield": "shield", "mon.framePacing": "framePacing", "mon.antiThermal": "antiThermal", "mon.stutterBuffer": "stutterBuffer",
  "lag.perfLock": "perfLock", "lag.gpuBoost": "gpuBoost", "lag.zeroStutter": "zeroStutter",
  "touch.delay": "touchDelay", "touch.pollRate": "touchPoll",
  "gfx.quality": "gfxQuality", "gfx.color": "gfxColor",
  "hw.memAggression": "memAggression", "mem.batteryOverride": "batteryOverride",
};

export function applySetting(key, value) {
  if (wantWake() && !wakeLock) holdWake();
  else if (!wantWake() && wakeLock) releaseWake();

  const b = bridge();
  if (b && b.applySetting) {
    try {
      const rep = b.applySetting(key, String(value));
      let r = null;
      try { r = rep ? JSON.parse(rep) : null; } catch (e) { }
      if (r) {
        nativeApplied = r;
        const bits = [];
        if (r.targetFps !== undefined) bits.push("window frame rate " + r.targetFps + " FPS");
        if (r.gameMode !== undefined) bits.push("game mode " + (r.gameMode === 1 ? "PERFORMANCE" : r.gameMode === 2 ? "BATTERY" : r.gameMode === 0 ? "STANDARD" : "unsupported"));
        if (r.sustained !== undefined) bits.push("sustained performance " + (r.sustained ? "ON" : "OFF"));
        if (r.hintSession !== undefined) bits.push("CPU hint session " + (r.hintSession ? "HELD" : "released"));
        if (r.unbuffered !== undefined) bits.push("unbuffered input " + (r.unbuffered ? "ON" : "OFF"));
        if (r.ignoring !== undefined) bits.push("Doze exemption " + (r.ignoring ? "granted" : "pending"));
        if (r.nativeLib !== undefined) bits.push("NDK layer " + (r.nativeLib ? "loaded" : "unavailable"));
        if (r.error) bits.push("error: " + r.error);
        if (bits.length) {
          const mod = (LABELS[key] && LABELS[key].mod) || "SYSTEM";
          log.info(mod, "Android shell applied " + key + " \u2014 " + bits.join(" \u00B7 ") + ".");
        }
      }
    } catch (e) { log.warn("SYSTEM", "Native apply failed for " + key + ": " + e.message); }
    return;
  }
  if (key === "net.dns" && !b) log.info("NET", "DNS profile \"" + value + "\" is now used for every lookup this app performs.");
  if (key === "ui.hud" || key === "ui.graph" || key === "ui.theme") return;
  if (live[key] !== undefined) live[key] = value;
}

/* --------------------------------------------------------------- annotate -- */
const RANK = { model: 0, limited: 1, real: 2, native: 3 };

export function annotate(root) {
  qa(".card", root || document).forEach((card) => {
    if (card.__cap) return;
    card.__cap = true;
    const hd = q(".card-hd", card);
    if (!hd) return;
    const ids = [...new Set([...card.querySelectorAll("[data-key]")].map((n) => n.dataset.key))].filter((k) => MATRIX[k]);
    if (!ids.length) return;
    const st = ids.map(status);
    const best = st.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
    const worst = st.reduce((a, b) => (RANK[b.level] < RANK[a.level] ? b : a));
    const chip = document.createElement("button");
    chip.className = "cap-chip " + LEVELS[best.level].cls;
    chip.type = "button";
    chip.innerHTML = "&#9679; " + LEVELS[best.level].tag + (worst.level !== best.level ? " + " + LEVELS[worst.level].tag : "");
    chip.title = ids.map((k) => LEVELS[status(k).level].tag + " " + status(k).label).join("\n");
    chip.addEventListener("click", () => openReport(ids, "This card, on THIS device"));
    hd.appendChild(chip);
  });
}

/* ------------------------------------------------------------- auto-tune --- */
export function autoTune(set, state) {
  const notes = [];
  if (lowEnd()) {
    set("gfx.quality", "smooth", { quiet: true });
    set("hw.memAggression", 4, { quiet: true });
    if (facts.cores && facts.cores <= 2) set("hw.targetFps", 30, { quiet: true });
    set("mon.framePacing", true, { quiet: true });
    notes.push("low-end device (" + (facts.cores || "?") + " cores, " + (facts.memClass || "?") + " GB class) \u2014 smooth tier, tighter pacing, 30/60 FPS cap");
  } else if (facts.cores >= 8 && facts.dpr <= 3) {
    set("gfx.quality", "ultra", { quiet: true });
    notes.push("8+ cores \u2014 ultra tier available and selected by default");
  }
  if (facts.webgl2 === false) notes.push("no WebGL2 \u2014 the shader tuner falls back to the 2D path on this device");
  if (facts.timerQuery) notes.push("GPU timer queries available \u2014 real GPU frame time is included in the monitor");
  if (!facts.android && facts.shell !== "native") notes.push("desktop preview \u2014 phone-only measurements (panel rate, touch sampling) will read live once opened on Android");
  return notes;
}
