import { el, log, state, set, cmd, toast, popup, closePopup, escapeHtml } from "./ui.js";
import { GAMES } from "./config.js";
import * as native from "./native.js";

const status = {};
let pendingLaunch = null;
let probeTimer = null;
let retryTimer = null;

export function gameById(id) { return GAMES.find((g) => g.id === id); }

function setStatus(id, s, note) {
  status[id] = { state: s, note: note || "", at: Date.now() };
  paint();
}

function intentUrl(g) {
  const gen = window.generatorName || "";
  const fallback = "https://null.perchance.org/" + gen + "?optlaunch=missing&g=" + g.id;
  return "intent://#Intent;package=" + g.pkg +
    ";action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;launchFlags=0x10000000" +
    ";S.browser_fallback_url=" + encodeURIComponent(fallback) + ";end";
}

function isAndroid() { return /Android/i.test(navigator.userAgent); }

function paint() {
  const wrap = el("launchList");
  if (!wrap) return;
  wrap.innerHTML = GAMES.map((g) => {
    const st = status[g.id] || { state: "unknown" };
    const det = st.state === "installed" ? '<span class="detected yes">&#10003; DETECTED ON DEVICE' + (st.version ? " &middot; v" + escapeHtml(st.version) : "") + (native.isNative() ? " (android package manager)" : "") + "</span>"
      : st.state === "missing" ? '<span class="detected no">&#10007; NOT INSTALLED' + (native.isNative() ? " (confirmed by android)" : "") + "</span>"
        : st.state === "probing" ? '<span class="detected unk">&#8987; PROBING ...</span>'
          : '<span class="detected unk">&#8226; NOT PROBED YET</span>';
    return '<div class="launch-card ' + (st.state === "missing" ? "wrong" : "") + '" style="margin-bottom:10px">' +
      '<div class="launch-ico" style="background:' + g.accent + '">' + g.short + "</div>" +
      '<div style="flex:1;min-width:0"><div class="launch-name">' + escapeHtml(g.name) + "</div>" +
      '<div class="launch-pkg">' + g.pkg + "</div>" + det + "</div>" +
      '<button class="btn primary" data-cmd="launch.' + g.id + '">&#9654;&#65039; Launch</button></div>';
  }).join("");
  wrap.querySelectorAll("[data-cmd]").forEach((b) => {
    if (b.__b) return;
    b.__b = true;
    b.addEventListener("click", () => {
      const fn = window.__cmds && window.__cmds[b.dataset.cmd];
      if (fn) fn(b);
    });
  });
  const tag = el("launchTag");
  if (tag) {
    const known = GAMES.filter((g) => status[g.id] && status[g.id].state === "installed").length;
    const probed = GAMES.filter((g) => status[g.id]).length;
    tag.textContent = probed ? known + "/" + probed + " FOUND" : "SCANNING";
  }
  const plan = el("launchPlan");
  if (plan) {
    const sel = GAMES[0];
    plan.innerHTML = [
      ["App shell", native.isNative() ? "ANDROID APK (native)" : "browser page", native.isNative()],
      ["Android device", isAndroid() ? "YES" : "NO (desktop test mode)", isAndroid()],
      ["Launch method", native.isNative() ? "PackageManager launch intent" : "intent:// package intent", native.isNative()],
      ["Free Fire package", GAMES[0].pkg, 0],
      ["FF MAX package", GAMES[1].pkg, 0],
      ["Root required", "NO", 1],
      ["Detection", native.isNative() ? "exact - installed package list" : "launch probe + fallback handshake", native.isNative()],
    ].map(([k, v, acc]) => '<div class="kv"><div class="kv-txt"><div class="kv-k">' + k + '</div><div class="kv-v' + (acc ? " accent" : "") + '">' + escapeHtml(v) + "</div></div></div>").join("");
  }
}

function notFoundPopup(g) {
  const other = GAMES.find((x) => x.id !== g.id);
  const otherKnown = status[other.id] && status[other.id].state === "installed";
  popup("\u26A0\uFE0F Game not found",
    "<b>" + escapeHtml(g.name) + "</b> was not found on this device, so it could not be launched." +
    "<br><br>You selected the wrong game button for this device." +
    (otherKnown ? "<br><br>The installed game on this device is <b>" + escapeHtml(other.name) + "</b> \u2014 use that button instead." : ""),
    { duration: 5000, footer: '<button class="btn primary block" data-close>&#10006; Close</button>' });
  log.err("LAUNCH", "LAUNCH BLOCKED \u2014 " + g.name + " (" + g.pkg + ") is not installed on this device. Showing 5s notice.");
  toast(g.name + " not found on this device.", "bad", 5000);
}

let launchAttempt = null;

function nativeLaunch(g) {
  if (launchAttempt) { log.warn("LAUNCH", "Launch already in progress \u2014 ignoring duplicate tap."); return false; }
  launchAttempt = { id: g.id };
  log.exec("LAUNCH", "Launch requested: " + g.name + " \u2014 asking Android for package " + g.pkg + " ...");
  setStatus(g.id, "probing");
  const r = native.launch(g.id);
  launchAttempt = null;
  if (r && r.ok) {
    setStatus(g.id, "installed", "package manager");
    log.ok("LAUNCH", "SUCCESS \u2014 Android launched " + g.pkg + " (" + r.reason + ").");
    toast("Successfully launched " + g.name, "ok", 3400);
    return true;
  }
  setStatus(g.id, "missing", (r && r.reason) || "not installed");
  log.err("LAUNCH", "LAUNCH BLOCKED \u2014 " + g.pkg + " reported: " + ((r && r.reason) || "unknown") + ".");
  notFoundPopup(g);
  return false;
}

export function launchGame(g) {
  if (native.isNative()) return nativeLaunch(g);
  const id = g.id;
  if (launchAttempt) { log.warn("LAUNCH", "Launch already in progress \u2014 ignoring duplicate tap."); return; }
  log.exec("LAUNCH", "Launch requested: " + g.name + " \u2014 resolving package " + g.pkg + " ...");
  setStatus(id, "probing");

  const intent = intentUrl(g);
  let win = null;
  let settled = false;

  const settle = (res, how) => {
    if (settled) return;
    settled = true;
    clearTimeout(probeTimer);
    clearTimeout(retryTimer);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("focus", onFocus);
    stopWatch();
    launchAttempt = null;
    if (res === "installed") {
      setStatus(id, "installed", how);
      log.ok("LAUNCH", "SUCCESS \u2014 " + g.name + " is installed and was launched (signal: " + how + ").");
      log.info("LAUNCH", "Package " + g.pkg + " detected on this device. Future taps launch instantly.");
      toast("Successfully launched " + g.name, "ok", 3400);
    } else {
      setStatus(id, "missing", how);
      notFoundPopup(g);
    }
  };

  const onVis = () => { if (document.hidden) settle("installed", "activity switch"); };
  const onFocus = () => log.info("LAUNCH", g.name + " session ended \u2014 this app is in the foreground again.");
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onFocus, { once: true });
  launchAttempt = { id };

  /* Chrome closes the tab that fired a successful app-launch intent */
  const closeWatch = setInterval(() => {
    if (win && win.closed) { clearInterval(closeWatch); settle("installed", "launch tab consumed"); }
  }, 200);
  const stopWatch = () => clearInterval(closeWatch);

  const openTab = (why) => {
    try {
      win = window.open(intent, "_blank");
    } catch (e) {
      log.warn("LAUNCH", (why || "Launch tab") + " blocked (" + e.message + ").");
    }
  };

  const framed = (() => { try { return window.top !== window; } catch (e) { return true; } })();

  if (!isAndroid()) {
    /* a desktop browser cannot start an Android app \u2014 keep the probe and the notice */
    openTab("Intent tab");
    log.info("LAUNCH", "Desktop browser \u2014 intent dispatched for the detection probe; expect the 5s notice.");
    probeTimer = setTimeout(() => settle("missing", "no android response"), 2400);
  } else {
    /*
     * Android only starts an app for an intent that came from the page itself in
     * this same tap, so the intent is handed straight to the top-level page
     * instead of a popup tab (which Android refuses to launch from).
     */
    let how = "direct intent";
    if (!framed) {
      try { location.href = intent; } catch (e) { openTab("Same-tab intent"); }
    } else {
      try {
        const a = document.createElement("a");
        a.href = intent;
        a.target = "_top";
        a.rel = "noopener";
        a.style.cssText = "display:none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        how = "top-level handoff";
      } catch (e) {
        log.warn("LAUNCH", "Top-level handoff blocked (" + e.message + ").");
        openTab("Intent tab");
      }
    }
    log.info("LAUNCH", "Intent dispatched to Android (" + how + ") \u2014 " + g.name + " should open now.");
    /* if Android did not take the handoff, retry once through a launch tab */
    retryTimer = setTimeout(() => {
      if (settled || document.hidden || win) return;
      log.warn("LAUNCH", "No Android handoff after 2s \u2014 retrying through a launch tab ...");
      openTab("Retry intent tab");
    }, 2000);
    probeTimer = setTimeout(() => {
      if (settled) return;
      if (document.hidden) return settle("installed", "activity switch");
      settle("missing", win ? "no android response" : "handoff blocked by browser");
    }, 3200);
  }
}

/* the fallback tab (opened by Android when the package is missing) reports back */
export function initLaunchBridge() {
  if (native.isNative()) return false;
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.optlaunch !== "missing") return;
    const g = gameById(d.g) || GAMES[0];
    setStatus(g.id, "missing", "fallback handshake");
    clearTimeout(probeTimer);
    clearTimeout(retryTimer);
    launchAttempt = null;
    closePopup();
    notFoundPopup(g);
  });
  /* this tab may itself be the fallback tab */
  const qp = new URLSearchParams(location.search);
  if (qp.get("optlaunch") === "missing") {
    const g = gameById(qp.get("g")) || GAMES[0];
    log.warn("LAUNCH", "Android reported " + g.name + " is NOT installed (fallback handshake).");
    /* the launcher tab opened us: report back, then close ourselves */
    try { if (window.opener) window.opener.postMessage({ optlaunch: "missing", g: g.id }, "*"); } catch (e) {}
    if (window.opener) { setTimeout(() => { try { window.close(); } catch (e) {} }, 150); return true; }
    /* same-tab fallback: keep the app alive and let it show the notice after boot */
    pendingLaunch = g;
    setTimeout(() => { if (pendingLaunch) { setStatus(pendingLaunch.id, "missing", "fallback handshake"); notFoundPopup(pendingLaunch); } }, 1200);
    return false;
  }
  return false;
}

export function initLaunch() {
  if (native.isNative()) {
    const gm = native.games();
    Object.entries(gm).forEach(([id, o]) => {
      status[id] = { state: o.installed ? "installed" : "missing", note: "package manager", version: o.version, at: Date.now() };
    });
  }
  paint();
  GAMES.forEach((g) => cmd("launch." + g.id, () => launchGame(g)));
  cmd("launch.rescan", () => {
    GAMES.forEach((g) => delete status[g.id]);
    if (native.isNative()) {
      const gm = native.games();
      Object.entries(gm).forEach(([id, o]) => { status[id] = { state: o.installed ? "installed" : "missing", note: "package manager", version: o.version, at: Date.now() }; });
      log.info("LAUNCH", "Re-asked the Android package manager for both game packages.");
    } else log.info("LAUNCH", "Launch probe cache cleared \u2014 next tap will re-detect the installed game.");
    paint();
  });
  log.info("LAUNCH", native.isNative()
    ? "Launcher armed \u2014 detection is exact (installed package list), so a wrong button is caught before anything is launched."
    : "Launcher armed \u2014 " + (isAndroid() ? "Android device detected" : "desktop preview (intent probes will report not-installed)") + ".");
  if (native.isNative()) {
    const found = GAMES.filter((g) => status[g.id] && status[g.id].state === "installed").map((g) => g.name);
    log.ok("LAUNCH", found.length ? "Installed on this device: " + found.join(", ") + "." : "Neither Free Fire nor Free Fire MAX is installed on this device \u2014 both buttons will show the 5 second notice.");
  }
}
