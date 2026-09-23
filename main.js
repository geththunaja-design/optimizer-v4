import { el, qa, state, set, on, log, toast, cmd, commands, initTabs, initDock, bindControls, mountLogs, applyTheme, syncControls, renderPresetCards, resetAll, escapeHtml, kvGrid } from "./ui.js";
import { APP, DEFAULTS, PRESETS } from "./config.js";
import { engine, startEngine } from "./engine.js";
import { scanHardware, specReport, render as renderHw, device } from "./device.js";
import { initMonitors, ensureChart } from "./monitors.js";
import { initMemory } from "./memory.js";
import { initNet } from "./net.js";
import { initTouch } from "./touch.js";
import { initBench } from "./bench.js";
import { initLaunch, initLaunchBridge } from "./launch.js";
import { initGfx } from "./gfx.js";
import { initAim } from "./aim.js";
import * as caps from "./caps.js";
import * as native from "./native.js";

window.__PRESETS = PRESETS;
window.__cmds = commands;

const ANDROID_PERMS = [
  ["INTERNET", "already granted to the app", true],
  ["ACCESS_NETWORK_STATE", "already granted", true],
  ["KILL_BACKGROUND_PROCESSES", "signature-level on Android 8+ \u2014 declared, rarely honoured for third-party apps", false],
  ["GET_PACKAGE_SIZE", "declared \u2014 storage footprint reads", false],
  ["CLEAR_APP_CACHE", "privileged on Android 6+ \u2014 declared, granted only to system apps", false],
  ["QUERY_ALL_PACKAGES", "declared \u2014 required to see installed games (Play policy: needs justification)", false],
  ["REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "user-prompted exemption from Doze", false],
  ["POST_NOTIFICATIONS", "runtime prompt (Android 13+)", false],
  ["REQUEST_DELETE_PACKAGES", "user-confirmed uninstall prompts", false],
];

function renderCompat() {
  const s = caps.summary();
  const sum = el("compatSummary");
  if (sum) {
    sum.innerHTML = [["native", "NATIVE"], ["real", "REAL"], ["limited", "LIMITED"], ["model", "MODEL"]]
      .map(([k, t]) => '<div class="cap-sum ' + k + '"><b>' + s[k] + "</b><span>" + t + "</span></div>").join("");
  }
  const tag = el("compatTag");
  if (tag) tag.textContent = caps.isNative() ? "ANDROID SHELL" : "BROWSER SHELL";
  const f = caps.facts;
  const rows = [
    ["Shell", caps.isNative() ? "Android APK (native)" : "Browser page", caps.isNative()],    ["Android version", f.android ? f.androidVersion : "desktop preview", false],
    ["Browser engine", f.chromium ? "Chromium / WebView " + f.chromium : "unknown", false],
    ["CPU cores", f.cores || "unknown", f.cores >= 8],
    ["Device memory class", f.memClass ? f.memClass + " GB" : "not exposed", f.memClass >= 4],
    ["GPU", String(f.gpu).slice(0, 42), false],
    ["WebGL2 pipeline", f.webgl2 ? (f.timerQuery ? "yes + GPU timer queries" : "yes") : "not available", f.webgl2],
    ["Panel refresh", (device.info && device.info.refresh) || "measuring", false],
    ["Touch input", f.coalesced ? "getCoalescedEvents (real samples)" : (f.touch ? "basic" : "no touchscreen"), f.coalesced],
    ["Wake lock", f.wakeLock ? (f.wakeLockHeld ? "held - screen stays on" : "available") : "not exposed", f.wakeLock],
    ["Battery API", f.battery ? (f.batteryPct >= 0 ? f.batteryPct + "% " + (f.charging ? "charging" : "on battery") : "available") : "not exposed", f.battery],
    ["Haptics", f.vibrate ? "available" : "not exposed", f.vibrate],
    ["Local storage", f.quotaMb ? f.usageMb + " MB used of " + f.quotaMb + " MB" : "unknown", false],
    ["Auto-tune tier", lowEndText(), caps.lowEnd() ? false : true],
  ];
  if (native.isNative()) {
    const s = caps.nativeStatus() || {};
    rows.push(["Game mode (Android)", String(s.gameModeLabel || "unsupported"), s.gameMode === 1]);
    rows.push(["Sustained performance", s.sustained ? "REQUESTED" : "off", !!s.sustained]);
    rows.push(["CPU hint session", s.hintSession ? "HELD at target frame time" : "released", !!s.hintSession]);
    rows.push(["Unbuffered input", s.unbuffered ? "ON" : "off", !!s.unbuffered]);
    rows.push(["Thermal status", String(s.thermalLabel || "unavailable").toUpperCase(), false]);
    rows.push(["NDK layer", s.nativeLib ? "liboptimizer.so loaded" : "not loaded", !!s.nativeLib]);
  }
  kvGrid(el("compatFacts"), rows);
  return s;
}
function lowEndText() {
  const f = caps.facts;
  return caps.lowEnd() ? "smooth (light device)" : (f.cores >= 8 ? "ultra (strong device)" : "balanced");
}

function initCompat() {
  caps.track(state);
  window.__onSet = (k, v) => caps.applySetting(k, v);
  const chip = el("modeChip");
  if (chip) chip.addEventListener("click", () => caps.openReport());
  caps.probe().then(() => {
    const nat = caps.isNative();
    const attached = native.attach(engine);
    const txt = el("modeChipTxt");
    const short = el("modeChipShort");
    if (txt) txt.textContent = nat ? "NATIVE SHELL" : "BROWSER";
    if (short) short.textContent = nat ? "APK" : "WEB";
    if (chip) chip.classList.toggle("native-shell", !!nat);
    if (attached) {
      ["hw.targetFps", "hw.governor", "hw.memAggression", "hw.touchRate", "gfx.quality", "touch.delay", "touch.pollRate"].forEach((k) => {
        if (window.__onSet) window.__onSet(k, state[k]);
      });
    }
    renderCompat();
    const notes = caps.autoTune(set, state);
    notes.forEach((n) => log.info("DEVICE", "Auto-tune: " + n));
    syncControls();
    caps.annotate(document);
    const s = caps.summary();
    log.ok("DEVICE", "Compatibility resolved on this device \u2014 " + s.total + " settings and tools checked: " + s.native + " native, " + s.real + " real, " + s.limited + " limited, " + s.model + " model.");
    log.info("DEVICE", nat
      ? "Running inside the Android shell \u2014 native rows are executed by real system APIs on this phone."
      : "Running as a browser page. Tap any badge on a card, or the mode chip in the top bar, to see what each setting does here and what it does inside the APK shell.");
  });
}

function initAbout() {
  el("devName").textContent = APP.developer;
  el("devNext").textContent = APP.comingSoon;
  el("devBuild").textContent = APP.build;
  const digits = APP.whatsapp.replace(/[^\d]/g, "");
  el("devWa").textContent = APP.whatsapp;
  el("devWa").href = "https://wa.me/" + digits;

  el("permList").innerHTML = ANDROID_PERMS.map(([n, note, always]) =>
    "<div>" + (always ? "<span style=\"color:#34d399\">[OK]</span>" : "<span style=\"color:#fbbf24\">[--]</span>") +
    " android.permission." + n + ' <span style="color:#5f7099">// ' + escapeHtml(note) + "</span></div>").join("");

  el("realNotes").innerHTML = [
    ["\u2705", "Real", "Hardware read-out (model, Android version, cores, refresh rate, GPU renderer), FPS/frame-time/jitter telemetry, WebGL2 shader pipeline, ping / resolver / regional latency measurement, touch report-rate measurement, memory &amp; cache purge, benchmark suite, app launching."],
    ["\u26A0\uFE0F", "Sandboxed", "Android does not let one app change another app's CPU governor, GPU clocks or thermal limits, and does not let an app write into another game's memory without root. Those sliders here drive <b>this app's own engine and its ballistics lab</b>."],
    ["\u274C", "Not possible non-root", "Aim lock / recoil / bullet-spread modification inside Free Fire or Free Fire MAX from a separate app is a memory hack. It requires root (and is bannable), so no non-root app can do it - including this one."],
    ["\u2139\uFE0F", "Two shells, one code", "This dashboard ships as a browser page <i>and</i> as an Android APK (see <span class=\"mono\">src/android/</span>). The APK adds the genuinely native rows: real thermal status, /proc CPU + RAM, package-manager game detection, performance hint sessions, unbuffered touch dispatch and the battery-exemption request."],
    ["\u{1F9E9}", "Per-device audit", "Open the Hardware tab and tap <b>Audit every setting on this device</b> (or any badge on a card) to see every switch resolved for the exact phone you are holding, with the real API behind each one."],
  ].map(([ico, k, v]) => '<div class="row"><div class="row-txt"><div class="row-l">' + ico + " " + k + '</div><div class="row-d">' + v + "</div></div></div>").join("");

  cmd("compat.audit", () => {
    log.exec("DEVICE", "Resolving every setting and tool against this device's real capabilities ...");
    caps.probe().then(() => {
      renderCompat();
      caps.annotate(document);
      caps.openReport();
      const s = caps.summary();
      log.ok("DEVICE", "Audit complete \u2014 " + s.native + " native, " + s.real + " real, " + s.limited + " limited, " + s.model + " model of " + s.total + " entries checked.");
    });
  });
  cmd("compat.copy", async () => {
    try {
      await navigator.clipboard.writeText(caps.reportText());
      log.ok("DEVICE", "Compatibility report copied to clipboard \u2014 every setting with its status on this device.");
      toast("Compatibility report copied.", "ok");
    } catch (e) { log.warn("DEVICE", "Clipboard blocked: " + e.message); toast("Clipboard blocked by the browser.", "warn"); }
  });

  cmd("about.wa", () => {
    window.open("https://wa.me/" + digits, "_blank");
    log.info("SYSTEM", "Opening WhatsApp chat for VIP packages: " + APP.whatsapp);
  });
  cmd("about.share", async () => {
    const url = window.generatorName ? "https://perchance.org/" + window.generatorName : "https://perchance.org";
    try {
      if (navigator.share) { await navigator.share({ title: APP.name, text: APP.name + " \u2014 Android performance suite", url }); log.ok("SYSTEM", "Share sheet opened."); }
      else { await navigator.clipboard.writeText(url); log.ok("SYSTEM", "Link copied: " + url); toast("Link copied.", "ok"); }
    } catch (e) { log.warn("SYSTEM", "Share cancelled."); }
  });
  cmd("about.restore", () => {
    resetAll();
    setTimeout(() => {
      Object.keys(DEFAULTS).forEach((k) => { const ls = state[k]; });
      toast("All settings restored to default.", "ok");
      log.ok("SYSTEM", "Restore complete \u2014 every module re-initialised with factory values.");
    }, 400);
  });
  cmd("about.perms", async () => {
    log.exec("SYSTEM", "Requesting every permission this platform can actually grant ...");
    try {
      if (window.Notification && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        log[p === "granted" ? "ok" : "warn"]("SYSTEM", "POST_NOTIFICATIONS \u2192 " + p.toUpperCase());
      } else log.info("SYSTEM", "POST_NOTIFICATIONS already granted.");
    } catch (e) { log.warn("SYSTEM", "Notification prompt unavailable: " + e.message); }
    try {
      const persisted = await navigator.storage.persist();
      log[persisted ? "ok" : "warn"]("SYSTEM", "Storage persistence \u2192 " + (persisted ? "GRANTED" : "DENIED"));
    } catch (e) {}
    const list = [
      ["INTERNET", "granted by default"],
      ["ACCESS_NETWORK_STATE", navigator.onLine ? "online" : "offline"],
      ["GET_PACKAGE_SIZE", "n/a in browser"],
      ["QUERY_ALL_PACKAGES", "n/a in browser \u2014 app launch probe used instead"],
      ["REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "n/a in browser"],
      ["KILL_BACKGROUND_PROCESSES", "n/a in browser"],
      ["CLEAR_APP_CACHE", "cache API available: " + (window.caches ? "yes" : "no")],
      ["REQUEST_DELETE_PACKAGES", "n/a in browser"],
    ];
    list.forEach(([n, s]) => log.info("SYSTEM", "android.permission." + n + " \u2192 " + s));
    toast("Permission sweep complete \u2014 see the log.", "ok");
  });

  on("hw.preset", (v) => {
    el("aboutProfile").textContent = v;
    el("aboutProfileChip").textContent = PRESETS[v] ? PRESETS[v].tag : "CUSTOM";
  });

  renderLicense();

  cmd("lic.status", () => {
    renderLicense();
    const st = (window.__licenseGate && window.__licenseGate.state()) || {};
    log.info("SYSTEM", "License: " + (st.unlocked ? "ACTIVE" : "LOCKED") + (st.label ? " \u00B7 key " + st.label : "") +
      (st.exp ? " \u00B7 expires " + new Date(st.exp).toLocaleString() + " (" + fmtLeft(st.exp - Date.now()) + " left)" : " \u00B7 unlimited"));
    toast(st.unlocked ? "License active." : "App is locked.", st.unlocked ? "ok" : "warn");
  });
  cmd("lic.lock", () => {
    log.warn("SYSTEM", "Re-arming the key prompt \u2014 use it to check that your key still activates the app.");
    if (window.__licenseGate) window.__licenseGate.lock("");
  });
}

function boot() {
  applyTheme((() => { try { return localStorage.getItem("opt.theme") || DEFAULTS["ui.theme"]; } catch (e) { return DEFAULTS["ui.theme"]; } })());
  document.documentElement.setAttribute("data-theme", state["ui.theme"]);

  el("brandTitle").textContent = APP.name;
  el("brandSub").textContent = "ANDROID PERF ENGINE \u00B7 NON-ROOT \u00B7 " + APP.build;
  document.title = APP.name;
  renderPresetCards();

  initTabs();
  initDock();
  initMonitors();
  initGfx();
  initAim();
  initTouch();
  initMemory();
  initNet();
  initBench();
  initLaunch();
  initAbout();
  bindControls(document);
  mountLogs(document);

  log.ok("SYSTEM", APP.name + " " + APP.build + " booting on " + (navigator.userAgent.includes("Android") ? "Android" : "desktop preview") +
    " \u2014 " + (navigator.hardwareConcurrency || 4) + " cores, " + (devicePixelRatio || 1) + "x density, target " + APP.target + ".");
  log.info("SYSTEM", "Settings are memory-only: closing or reloading this app restores every default.");

  Object.keys(DEFAULTS).forEach((k) => set(k, DEFAULTS[k], { quiet: true }));
  syncControls();

  engine.target = Number(DEFAULTS["hw.targetFps"]);
  startEngine();
  ensureChart();
  initCompat();
  scanHardware(true).then(() => {
    log.ok("DEVICE", "Silent hardware scan done \u2014 " + device.info.model + " \u00B7 " + device.info.cores + " cores \u00B7 " + device.info.refresh + " panel.");
  });

  el("themeBtn").addEventListener("click", () => {
    const nv = state["ui.theme"] === "dark" ? "light" : "dark";
    applyTheme(nv);
    state["ui.theme"] = nv;
    log.info("HUD", "Theme switched to " + nv.toUpperCase() + " mode.");
  });

  document.addEventListener("tab", (e) => {
    if (e.detail === "monitors") ensureChart();
    if (e.detail === "hardware" && !device.info.scanned) scanHardware(true);
    if (e.detail === "memory") { syncControls(); }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) log.warn("SYSTEM", "App backgrounded \u2014 engine throttled, telemetry paused.");
    else {
      log.ok("SYSTEM", "App resumed \u2014 engine clock re-armed.");
      const r = String(device.info.refresh || "");
      if (!r || r.indexOf("unavailable") === 0) setTimeout(() => scanHardware(true), 400);
    }
  });

  window.addEventListener("error", (e) => log.err("SYSTEM", "Runtime error: " + (e.message || "unknown")));
  window.addEventListener("unhandledrejection", (e) => log.warn("SYSTEM", "Unhandled promise: " + (e.reason && e.reason.message ? e.reason.message : e.reason)));

  cmd("hw.scan", async () => { await scanHardware(false); });
  cmd("hw.copy", async () => {
    try { await navigator.clipboard.writeText(specReport()); log.ok("DEVICE", "Full spec report copied to clipboard."); toast("Spec report copied.", "ok"); }
    catch (e) { log.warn("DEVICE", "Clipboard blocked: " + e.message); }
  });

  setTimeout(() => {
    log.info("SYSTEM", "Dashboard ready \u2014 " + qa(".tab").length + " categories online. Tap any category in the horizontal bar.");
  }, 900);
}

/* -------------------------------------------------------------- licensing ---
   The dashboard boots only when the license gate in index.html reports a valid
   key. If the key expires (or the device clock is rolled back) mid-session the
   gate fires `licensegate:lock` and the engine loop is halted here.
   --------------------------------------------------------------------------- */
function fmtLeft(ms) {
  let total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400); total -= days * 86400;
  const hours = Math.floor(total / 3600); total -= hours * 3600;
  const mins = Math.floor(total / 60); const secs = total - mins * 60;
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return (days > 0 ? days + "d " : "") + pad(hours) + ":" + pad(mins) + ":" + pad(secs);
}

function renderLicense() {
  const gate = window.__licenseGate;
  const st = (gate && gate.state()) || window.__licenseState || { unlocked: false };
  const chip = el("licChip");
  if (chip) { chip.textContent = st.unlocked ? "ACTIVE" : "LOCKED"; chip.classList.toggle("on", !!st.unlocked); }
  const grid = el("licGrid");
  if (!grid) return;
  const active = !!st.unlocked;
  const sy = (gate && gate.sync) ? gate.sync() : null;
  const live = st.exp ? st.exp > Date.now() : true;
  kvGrid(grid, [
    ["App", st.appName || APP.name, active],
    ["License status", active ? "verified on this device" : (st.message || "locked \u2014 waiting for a key"), active],
    ["Issued key", st.label ? st.label : "not presented", !!st.label],
    ["Expires", st.exp ? new Date(st.exp).toLocaleString() + (live ? "  (" + fmtLeft(st.exp - Date.now()) + " left)" : "  \u2014 expired") : "unlimited \u2014 never expires", live],
    ["Live key list", sy ? (sy.state === "online" ? "downloaded \u2014 " + sy.count + " keys in force" : (sy.state === "checking" ? "checking\u2026" : "offline \u2014 using this build's list")) : "not available", !!(sy && sy.state === "online")],
    ["Keys on this device", (gate && gate.keyList ? gate.keyList().length : (gate && gate.keys ? gate.keys.length : 0)) + "  (SHA-256 digests only)", true],
    ["Keys revoked", (gate && gate.revoked ? gate.revoked().length : 0), true],
    ["Licensed to", st.owner || APP.developer, true],
  ]);
  const owner = el("licOwner");
  if (owner) owner.textContent = st.owner || APP.developer;
}

function startApp() {
  if (window.__appBooted) return;
  window.__appBooted = true;
  if (!initLaunchBridge()) {
    try { boot(); } catch (e) {
      document.body.insertAdjacentHTML("afterbegin", '<pre style="color:#fb7185;padding:12px;font-size:12px">BOOT FAILURE: ' + escapeHtml(e.message) + "</pre>");
      throw e;
    }
  }
}

document.addEventListener("licensegate:unlock", (e) => {
  const d = (e && e.detail) || {};
  engine.running = true;
  if (!window.__appBooted) startApp(); else renderLicense();
  log.ok("SYSTEM", "License verified on this device \u2014 key " + (d.label || "unnamed") + ", " +
    (d.exp ? "expires " + new Date(d.exp).toLocaleString() : "no expiry"));
});

document.addEventListener("licensegate:lock", (e) => {
  engine.running = false;
  renderLicense();
  const msg = (e && e.detail && e.detail.message) || "";
  log.warn("SYSTEM", "License locked \u2014 engine halted" + (msg ? ": " + msg : "."));
});

if ((window.__licenseState || {}).unlocked) startApp();
