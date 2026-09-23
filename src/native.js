import { log, closePopup } from "./ui.js";

const b = () => window.OptimizerNative || window.AndroidOptimizer || null;

export function bridge() { return b(); }

export function isNative() {
  const x = b();
  if (!x) return false;
  try { return typeof x.mode === "function" ? x.mode() === "native" : true; } catch (e) { return false; }
}

export function uaMarker() { return /OptimizerV4/i.test(navigator.userAgent); }

function j(fn, fb) {
  try {
    const v = fn();
    return v ? JSON.parse(v) : fb;
  } catch (e) { return fb; }
}

let cachedInfo = null;
export function info() {
  if (cachedInfo) return cachedInfo;
  cachedInfo = isNative() ? j(() => b().deviceInfo(), {}) : {};
  return cachedInfo;
}

export function mem() { return isNative() ? j(() => b().memInfoMb(), {}) : {}; }
export function battery() { return isNative() ? j(() => b().batteryInfo(), {}) : {}; }
export function status() { return isNative() ? j(() => b().status(), {}) : {}; }
export function games() { return isNative() ? j(() => b().games(), {}) : {}; }
export function purgeResult() { return isNative() ? j(() => b().purgeResult(), {}) : {}; }

export function cpuLoad() {
  if (!isNative()) return -1;
  try { const v = b().cpuLoadPercent(); return v >= 0 ? v : -1; } catch (e) { return -1; }
}

export function thermalC() {
  if (!isNative()) return -1;
  try { const t = b().thermalCelsius(); return t > 0 ? t : -1; } catch (e) { return -1; }
}

export function ramPct() {
  const m = mem();
  if (!m.total || m.total <= 0 || !m.available || m.available < 0) return -1;
  return Math.round(((m.total - m.available) / m.total) * 100);
}

export function installed(id) {
  if (!isNative()) return null;
  try { return !!b().isGameInstalled(id); } catch (e) { return null; }
}

export function launch(id) {
  if (!isNative()) return null;
  return j(() => b().launchGame(id), { ok: false, reason: "bridge error" });
}

export function openStore(id) {
  if (!isNative()) return false;
  try { b().openStore(id); return true; } catch (e) { return false; }
}

export function dropCaches() {
  if (!isNative()) return false;
  try { b().dropCaches(); return true; } catch (e) { return false; }
}

export function bench(iters) {
  if (!isNative()) return null;
  return j(() => b().benchNative(iters || 2000000), null);
}

export function vibrate(ms) {
  if (!isNative()) return false;
  try { b().vibrate(ms || 18); return true; } catch (e) { return false; }
}

export function immersive(on) {
  if (!isNative()) return false;
  try { return !!b().setImmersive(on); } catch (e) { return false; }
}

export function orientation(mode) {
  if (!isNative()) return false;
  try { return !!b().setOrientation(mode); } catch (e) { return false; }
}

export function batteryExemption() {
  if (!isNative()) return {};
  return j(() => b().requestBatteryExemption(), {});
}

export function nativeToast(text) {
  if (!isNative()) return;
  try { b().toast(text); } catch (e) { }
}

/* --------------------------------------------------------------- wiring --- */
export function attach(engine, setRamSource) {
  if (!isNative()) return false;

  const i = info();
  engine.setCpuSource(() => cpuLoad());
  engine.setThermalSource(() => thermalC());
  if (setRamSource) setRamSource(() => { const p = ramPct(); return p >= 0 ? p : 0; });

  window.__optimizerPause = () => {
    log.warn("SYSTEM", "Android moved the app to the background \u2014 engine throttled, telemetry paused.");
  };
  window.__optimizerResume = () => {
    log.ok("SYSTEM", "App resumed \u2014 engine clock re-armed.");
    cachedInfo = null;
  };
  window.__optimizerBack = () => {
    const m = document.getElementById("modalWrap");
    if (m && !m.classList.contains("hidden")) { closePopup(); return true; }
    const dock = document.getElementById("consoleDock");
    if (dock && dock.classList.contains("open")) { dock.classList.remove("open"); return true; }
    return false;
  };

  log.ok("DEVICE", "Android shell attached \u2014 CPU load, SoC temperature and free RAM now come from /proc, not from estimates.");
  log.info("DEVICE", "Game detection is exact (PackageManager), launches are real, and thermal status is read from PowerManager.");
  if (i.cpuModel) log.info("DEVICE", "SoC: " + i.cpuModel + (i.cpuMaxMhz > 0 ? " \u00B7 up to " + i.cpuMaxMhz + " MHz" : "") + " \u00B7 " + i.cores + " cores \u00B7 " + i.totalRamMb + " MB RAM.");
  return true;
}
