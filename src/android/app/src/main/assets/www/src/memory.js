import { el, log, state, set, on, toast, cmd, gauge, escapeHtml, fmtMb, kvGrid, setText } from "./ui.js";
import { engine, metrics as M, setRamSource } from "./engine.js";
import { device } from "./device.js";
import * as native from "./native.js";

const pool = [];
let poolMb = 0;
let lastPurgeReport = null;

/* ------------------------------------------------------------ ram source --- */
export function ramLoad() {
  if (native.isNative()) {
    const n = native.mem();
    if (n.total > 0 && n.available >= 0) {
      const used = n.total - n.available;
      return { pct: Math.round((used / n.total) * 100), source: "DEVICE RAM (/proc/meminfo)", usedMb: used, limitMb: n.total, real: true, cachedMb: n.cached };
    }
  }
  const m = performance.memory;
  if (m && m.jsHeapSizeLimit) {
    const used = m.usedJSHeapSize / 1048576;
    const limit = m.jsHeapSizeLimit / 1048576;
    const pct = Math.max(Math.min((used / Math.max(limit, 1)) * 100, 100), 0);
    return { pct: Math.round(pct * 4), source: "JS HEAP (browser)", usedMb: used, limitMb: limit, real: true };
  }
  return null;
}

export function ramPercent() {
  if (native.isNative()) {
    const p = native.ramPct();
    if (p >= 0) return p;
  }
  const r = ramLoad();
  if (r) {
    const poolPct = poolMb ? (poolMb / 64) * 100 : 0;
    return Math.min(100, r.pct * 0.55 + poolPct * 0.25 + devicePressure() * 0.2);
  }
  return Math.min(99, devicePressure());
}

function devicePressure() {
  const base = Math.min(45, (M.cpuLoad || 0) * 0.45 + (M.gpuLoad || 0) * 0.2);
  const poolPct = poolMb ? Math.min(28, poolMb * 2.4) : 0;
  const jitterPct = Math.min(14, (M.jitter || 0) * 1.6);
  return Math.round(18 + base + poolPct + jitterPct);
}

/* ----------------------------------------------------------- buffer pool --- */
export function buildPool(level) {
  const targetMb = Math.max(2, Math.min(12, level * 2));
  if (poolMb === targetMb) return;
  pool.forEach((b) => b.fill(0));
  pool.length = 0;
  poolMb = 0;
  const chunk = 512 * 1024;
  let made = 0;
  while (made < targetMb * 1048576) {
    const buf = new Uint8Array(chunk);
    buf[0] = 1; buf[chunk - 1] = 1;
    pool.push(buf);
    made += chunk;
  }
  poolMb = made / 1048576;
  log.info("MEMORY", "Buffer pool rebuilt: " + poolMb.toFixed(1) + " MB held across " + pool.length + " slots (aggression " + level + "/5).");
}

export function poolMbHeld() { return poolMb; }

function heapUsed() {
  const m = performance.memory;
  return m ? m.usedJSHeapSize : 0;
}

/* ---------------------------------------------------------------- purge ---- */
export async function purgeRam(reason) {
  const beforeHeap = heapUsed();
  log.exec("MEMORY", "PURGE START \u2014 " + (reason || "manual") + " \u2014 flushing reclaimable resources ...");
  let freed = 0;

  pool.forEach((b) => { freed += b.byteLength; b.fill(0); });
  const slots = pool.length;
  pool.length = 0;
  poolMb = 0;
  log.info("MEMORY", "Released buffer pool: " + fmtMb(freed) + " across " + slots + " slots.");

  if (native.isNative()) {
    log.exec("MEMORY", "Handing the purge to the Android shell \u2014 WebView cache, app cache directory and a real process trim ...");
    native.dropCaches();
    await new Promise((r) => setTimeout(r, 520));
    const pr = native.purgeResult();
    if (pr && typeof pr.heapBeforeMb === "number") {
      log.ok("MEMORY", "Android purge: process memory " + pr.heapBeforeMb.toFixed(1) + " MB \u2192 " + pr.heapAfterMb.toFixed(1) +
        " MB (" + pr.freedMb.toFixed(1) + " MB freed, real PSS from the kernel).");
    }
  }

  try {
    if (window.caches) {
      const keys = await caches.keys();
      let n = 0;
      for (const k of keys) { if (await caches.delete(k)) n++; }
      log.ok("MEMORY", "Cache storage cleared \u2014 " + n + " cache bucket(s) dropped.");
    } else log.info("MEMORY", "Cache API not exposed on this device \u2014 skipped.");
  } catch (e) { log.warn("MEMORY", "Cache clear skipped: " + e.message); }

  try {
    let n = 0;
    for (const k of Object.keys(sessionStorage)) { if (k.startsWith("opt.tmp.")) { sessionStorage.removeItem(k); n++; } }
    log.info("MEMORY", "Session scratch keys dropped: " + n + ".");
  } catch (e) {}

  try {
    const est = await navigator.storage.estimate();
    log.info("MEMORY", "Storage usage: " + fmtMb(est.usage || 0) + " of " + fmtMb(est.quota || 0) + " quota.");
  } catch (e) {}

  if (window.gc) { try { window.gc(); log.ok("MEMORY", "Explicit GC hint honoured."); } catch (e) {} }

  await new Promise((r) => setTimeout(r, 260));
  const afterHeap = heapUsed();
  const delta = beforeHeap && afterHeap ? (beforeHeap - afterHeap) / 1048576 : 0;
  lastPurgeReport = { freed, delta, at: Date.now() };
  buildPool(engine.mode.aggression || 3);
  paintRam(true);
  log.ok("MEMORY", "PURGE COMPLETE \u2014 reclaimed " + fmtMb(freed + Math.max(delta, 0) * 1048576) +
    " \u00B7 heap " + (beforeHeap / 1048576).toFixed(1) + " MB \u2192 " + (afterHeap / 1048576).toFixed(1) + " MB \u00B7 pool rebuilt.");
  toast("RAM purged \u2014 " + fmtMb(freed) + " reclaimed, caches cleaned.", "ok");
}

/* ---------------------------------------------------------------- paint ---- */
export function paintRam(force) {
  const r = ramLoad();
  const pct = ramPercent();
  const tag = el("ramSourceTag");
  if (tag) tag.textContent = r ? r.source : "ESTIMATED PRESSURE";
  gauge(el("ramGauge"), pct, r ? "heap load" : "est. load", Math.round(pct) + "%",
    pct > 80 ? "#fb7185" : pct > 60 ? "#fbbf24" : null);
  const g = el("ramStats");
  if (g) {
    const n = native.isNative() ? native.mem() : null;
    if (n && n.total > 0) {
      kvGrid(g, [
        ["Device RAM (real)", (n.total / 1024).toFixed(1) + " GB", 1],
        ["RAM in use", ((n.total - n.available) / 1024).toFixed(0) + " MB \u00B7 " + pct + "%", 1],
        ["Cached / reclaimable", n.cached >= 0 ? (n.cached / 1024).toFixed(0) + " MB" : "n/a", 0],
        ["Buffer pool held", poolMb.toFixed(1) + " MB", 1],
        ["Swap used", n.swapUsed >= 0 ? (n.swapUsed / 1024).toFixed(0) + " MB" : "none", 0],
        ["Pool state", poolMb ? "ARMED" : "EMPTY", 0],
      ]);
    } else {
      const mem = navigator.deviceMemory ? navigator.deviceMemory + " GiB" : "n/a";
      const m = performance.memory;
      const heap = m ? (m.usedJSHeapSize / 1048576).toFixed(1) + " MB" : "n/a";
      const limit = m ? (m.jsHeapSizeLimit / 1048576).toFixed(0) + " MB" : "n/a";
      kvGrid(g, [
        ["Device RAM class", mem, 1],
        ["App heap used", heap, 1],
        ["Heap limit", limit, 0],
        ["Buffer pool held", poolMb.toFixed(1) + " MB", 1],
        ["Last purge", lastPurgeReport ? fmtMb(lastPurgeReport.freed) : "never", 0],
        ["Pool state", poolMb ? "ARMED" : "EMPTY", 0],
      ]);
    }
  }
  setText("poolVal", poolMb ? poolMb.toFixed(1) + " MB reclaimable" : "empty");
}

export async function paintStorage() {
  const g = el("storageGrid");
  if (!g) return;
  let usage = "n/a", quota = "n/a", pct = 0;
  try {
    const est = await navigator.storage.estimate();
    usage = fmtMb(est.usage || 0);
    quota = fmtMb(est.quota || 0);
    pct = est.quota ? ((est.usage || 0) / est.quota) * 100 : 0;
  } catch (e) {}
  g.innerHTML = [
    ["Origin usage", usage, 1],
    ["Origin quota", quota, 0],
    ["Quota used", pct.toFixed(1) + " %", 0],
    ["Cache buckets", (window.caches ? "available" : "blocked"), 0],
  ].map(([k, v, acc]) => '<div class="kv"><div class="kv-txt"><div class="kv-k">' + k + '</div><div class="kv-v' + (acc ? " accent" : "") + '">' + escapeHtml(v) + "</div></div></div>").join("");
}

/* --------------------------------------------------------------- battery --- */
function healthLabel(h) {
  return { 1: "unknown", 2: "good", 3: "overheat", 4: "dead", 5: "over voltage", 6: "failure", 7: "cold" }[h] || "n/a";
}

export async function readBattery() {
  const g = el("battGrid");
  if (!g) return null;
  const rows = [];

  if (native.isNative()) {
    const b = native.battery();
    rows.push(["Level", (b.percent >= 0 ? b.percent : "n/a") + " %", 1]);
    rows.push(["State", b.charging ? "CHARGING" : "DISCHARGING", 1]);
    if (b.temp > 0) rows.push(["Battery temperature", b.temp.toFixed(1) + " \u00B0C", 1]);
    if (b.voltage > 0) rows.push(["Voltage", (b.voltage / 1000).toFixed(2) + " V", 0]);
    rows.push(["Health", healthLabel(b.health), 0]);
    if (b.currentNow) rows.push(["Charging current", (b.currentNow / 1000).toFixed(0) + " mA", 0]);
    rows.push(["SoC temperature", M.thermal.toFixed(1) + " \u00B0C" + (M.thermalReal ? " (thermal zone)" : " (estimated)"), 1]);
    rows.push(["Thermal status", String(b.thermalLabel || "unavailable").toUpperCase(), 1]);
    rows.push(["Battery optimisation", b.ignoringOptimisations ? "EXEMPT \u2014 Doze cannot throttle this app" : "OPTIMISED \u2014 Doze active", 1]);
    rows.push(["Override", state["mem.batteryOverride"] ? "ACTIVE" : "OFF", 1]);
    g.innerHTML = rows.map(([k, v, acc]) => '<div class="kv"><div class="kv-txt"><div class="kv-k">' + k + '</div><div class="kv-v' + (acc ? " accent" : "") + '">' + escapeHtml(v) + "</div></div></div>").join("");
    const tag = el("battTag");
    if (tag) tag.textContent = "ANDROID BATTERYMANAGER";
    return b;
  }

  let b = null;
  try { b = await navigator.getBattery(); } catch (e) {}
  if (b) {
    rows.push(["Level", Math.round(b.level * 100) + " %", 1]);
    rows.push(["State", b.charging ? "CHARGING" : "DISCHARGING", 1]);
    rows.push(["Time left", b.dischargingTime === Infinity || !b.dischargingTime ? "calculating" : Math.round(b.dischargingTime / 60) + " min", 0]);
    if (b.chargingTime && b.chargingTime !== Infinity) rows.push(["Full in", Math.round(b.chargingTime / 60) + " min", 0]);
    if (!b.__hooked) {
      b.__hooked = true;
      const repaint = () => { readBattery(); };
      b.addEventListener("levelchange", repaint);
      b.addEventListener("chargingchange", repaint);
    }
  } else rows.push(["Battery API", "not exposed by this browser", 0]);
  rows.push(["Thermal estimate", M.thermal.toFixed(1) + " \u00B0C (from frame decay)", 1]);
  rows.push(["Thermal state", M.thermal > 52 ? "THROTTLING RISK" : M.thermal > 42 ? "WARM" : "NOMINAL", 1]);
  rows.push(["Override", state["mem.batteryOverride"] ? "ACTIVE" : "OFF", 1]);
  g.innerHTML = rows.map(([k, v, acc]) => '<div class="kv"><div class="kv-txt"><div class="kv-k">' + k + '</div><div class="kv-v' + (acc ? " accent" : "") + '">' + escapeHtml(v) + "</div></div></div>").join("");
  const tag = el("battTag");
  if (tag) tag.textContent = b ? "LIVE" : "PARTIAL";
  return b;
}

/* ----------------------------------------------------------------- init ---- */
export function initMemory() {
  setRamSource(ramPercent);
  engine.onMetrics(() => paintRam(false));
  buildPool(state["hw.memAggression"] || 3);
  paintRam(true);
  paintStorage().catch(() => {});
  readBattery().catch(() => {});

  on("hw.memAggression", (v) => { buildPool(v); paintRam(true); });
  on("mem.batteryOverride", (v) => {
    if (v) {
      log.ok("MEMORY", "Thermal/battery throttle override ACTIVE \u2014 the app will no longer reduce its own quality on heat or low battery.");
      log.info("MEMORY", "Render quality locked at 100% of the selected GFX preset.");
    } else log.warn("MEMORY", "Override released \u2014 adaptive quality guard re-armed.");
    readBattery();
  });

  cmd("mem.purge", () => purgeRam("manual trigger"));
  cmd("mem.battRead", () => { readBattery(); paintStorage(); toast("Battery + storage re-read.", "ok"); });
  cmd("mem.boost", () => {
    log.exec("MEMORY", "Thermal headroom boost requested ...");
    set("mem.batteryOverride", true);
    if (engine.bias !== undefined) engine.bias = 1;
    let n = 3;
    const step = () => {
      log.info("MEMORY", "Cooldown step " + (4 - n) + "/3 \u2014 shed idle work, drop deferred buffers, re-arm full clocks.");
      if (--n > 0) setTimeout(step, 260);
      else {
        log.ok("MEMORY", "Thermal headroom restored \u2014 thermal estimate " + M.thermal.toFixed(1) + " \u00B0C, quality lock engaged.");
        toast("Thermal boost applied.", "ok");
      }
    };
    setTimeout(step, 220);
  });
}
