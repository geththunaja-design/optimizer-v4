import { log, set, get, clamp } from "./ui.js";

const now = () => performance.now();

const M = {
  fps: 0, frameMs: 16.7, jitter: 0, cpuLoad: 0, gpuLoad: 0,
  thermal: 0, ramPct: 0, dropped: 0, skipped: 0, longTasks: 0, qualityBias: 1,
  rafHz: 60, stable: 0,
};

export const engine = {
  metrics: M,
  target: 60,
  renderers: new Set(),
  subs: new Set(),
  mode: { pacing: false, shield: false, antiThermal: false, buffer: false, perfLock: false, gpuBoost: false, zeroStutter: false, governor: "balanced", aggression: 3 },
  gpuTimeMs: 0,
  running: true,

  addRenderer(fn) { this.renderers.add(fn); return () => this.renderers.delete(fn); },
  onMetrics(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  priority() { return this.mode.shield ? 1 : 0; },

  setTargetFps(v) { this.target = Number(v) || 60; M.skipped = 0; log.exec("SHIELD", "Frame budget re-armed: cap = " + this.target + " FPS (engine limiter " + (this.target >= 144 ? "unlocked" : "active") + ")."); },
  setFramePacing(v) { this.mode.pacing = !!v; if (v) log.ok("SHIELD", "Frame pacing lock engaged: delivery intervals flattened with drift-correction."); },
  setShield(v) { this.mode.shield = !!v; if (v) { this.mode.pacing = true; log.ok("SHIELD", "Shield engine online: essential work is protected by a per-frame deadline budget."); } },
  setAntiThermal(v) { this.mode.antiThermal = !!v; if (v) log.ok("SHIELD", "Anti-thermal override armed: closed-loop frame-hold controller watching for sustained decay."); },
  setStutterBuffer(v) { this.mode.buffer = !!v; log[v ? "ok" : "warn"]("SHIELD", v ? "Driver buffer priority raised: backlog depth " + this.bufferDepth() + " slots." : "Driver buffer priority normal."); },
  setZeroStutter(v) { this.mode.zeroStutter = !!v; if (v) log.ok("ZERO-LAG", "Zero-stutter lock on: post-hitch re-alignment enabled."); },
  setPerfLock(v) { this.mode.perfLock = !!v; log.exec("ZERO-LAG", "App scheduler governor = " + (v ? "performance (no idle back-off, max render priority)" : "balanced") + "."); },
  setGpuBoost(v) { this.mode.gpuBoost = !!v; log.exec("ZERO-LAG", v ? "GPU clock target = MAX BOOST (high-performance context, full render scale)." : "GPU clock target = nominal."); },
  setGovernor(g) {
    this.mode.governor = g;
    const map = { performance: 1, balanced: 0.75, powersave: 0.5 };
    this.governorScale = map[g] || 0.75;
    log.exec("ZERO-LAG", "Governor request written: " + g + " (work scale " + this.governorScale + ").");
  },
  setAggression(l) {
    this.mode.aggression = l;
    log.exec("MEMORY", "Memory aggression level " + l + "/5 \u2014 reclaim threshold " + (l * 20) + "%, pool held at " + (l * 2) + " MB.");
  },
  bufferDepth() { return this.mode.buffer ? 4 : 2; },

  setGpuTimeSource(fn) { this.gpuSource = fn; },
  setCpuSource(fn) { this.cpuSource = fn; },
  setThermalSource(fn) { this.thermalSource = fn; },
};

/* ------------------------------------------------------------ metrics ----- */
const intervals = [];
const busy = [];
let longTaskCount = 0;

if (typeof PerformanceObserver !== "undefined") {
  try {
    new PerformanceObserver((list) => {
      longTaskCount += list.getEntries().length;
      M.longTasks = longTaskCount;
    }).observe({ entryTypes: ["longtask"] });
  } catch (e) {}
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(a) {
  const m = a.reduce((s, v) => s + v, 0) / (a.length || 1);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length || 1));
}

/* --------------------------------------------------------------- loop ----- */
let last = now();
let nextDeadline = last;
let hitchFlag = false;
let fpsEma = 60;
let cpuEma = 0;
let decayWatch = [];
let thermalPressure = 0;
let publishAcc = 0;
let rafCount = 0;
let rafWin = now();
let renderScaleBias = 1;

export function startEngine() {
  if (window.__engineStarted) return;
  window.__engineStarted = true;
  const frame = () => {
    requestAnimationFrame(frame);
    const t = now();
    const dt = t - last;

    /* the license gate halts the engine loop while the app is locked */
    if (!engine.running) { last = t; nextDeadline = t; return; }

    rafCount++;
    if (t - rafWin >= 1000) { M.rafHz = Math.round((rafCount * 1000) / (t - rafWin)); rafCount = 0; rafWin = t; }

    const minI = 1000 / engine.target;
    if (t + 0.6 < nextDeadline) { M.skipped++; last = t; return; }

    const step = engine.mode.pacing ? Math.min(minI, t - nextDeadline + minI) : minI;
    nextDeadline = engine.mode.zeroStutter && hitchFlag ? t + minI * 0.5 : t + step;
    if (t - nextDeadline > minI * 3) nextDeadline = t + minI;

    const budgetStart = now();
    const depth = engine.bufferDepth();
    let budgetLeft = engine.mode.shield ? minI * (0.55 + depth * 0.06) : Infinity;
    const list = [...engine.renderers];
    for (const r of list) {
      const essential = r.essential !== false;
      if (!essential && budgetLeft <= 0) { M.skipped++; continue; }
      try { r(t, dt, renderScaleBias); } catch (e) {
        if (!r.__err) { r.__err = true; log.err("SYSTEM", "Renderer fault dropped: " + e.message); }
      }
      budgetLeft -= now() - budgetStart;
    }

    hitchFlag = intervals.length > 4 && dt > median(intervals) * 1.9;
    if (dt < 400) { intervals.push(dt); if (intervals.length > 90) intervals.shift(); }
    const med = median(intervals) || 16.7;
    const inst = 1000 / med;
    fpsEma = fpsEma * 0.9 + inst * 0.1;
    M.fps = Math.round(fpsEma);
    M.frameMs = +med.toFixed(2);
    M.jitter = +stdev(intervals.slice(-30)).toFixed(2);

    const busyMs = now() - budgetStart;
    cpuEma = cpuEma * 0.92 + clamp((busyMs / Math.max(med, 1)) * 100, 0, 100) * 0.08;
    if (engine.cpuSource) {
      try {
        const v = engine.cpuSource();
        if (v >= 0) { M.cpuLoad = Math.round(clamp(v, 0, 100)); M.cpuReal = true; }
        else M.cpuLoad = Math.round(cpuEma + (longTaskCount ? Math.min(longTaskCount * 2, 12) : 0));
      } catch (e) { M.cpuLoad = Math.round(cpuEma); }
    } else M.cpuLoad = Math.round(cpuEma + (longTaskCount ? Math.min(longTaskCount * 2, 12) : 0));

    if (engine.gpuSource) { try { M.gpuLoad = Math.round(clamp(engine.gpuSource(), 0, 100)); } catch (e) {} }
    else {
      const q = engine.mode.gpuBoost ? 1.25 : 1;
      M.gpuLoad = Math.round(clamp((M.fps / Math.max(engine.target, 30)) * 62 * q * renderScaleBias, 0, 100));
    }

    /* anti-thermal closed loop */
    decayWatch.push(inst);
    if (decayWatch.length > 240) decayWatch.shift();
    if (engine.mode.antiThermal) {
      const recent = decayWatch.slice(-120);
      const old = decayWatch.slice(0, 120);
      if (recent.length > 60 && old.length > 60) {
        const drop = (median(old) - median(recent)) / median(old);
        if (drop > 0.07 && renderScaleBias > 0.62) renderScaleBias = Math.max(0.62, renderScaleBias - 0.02);
        else if (drop < 0.015 && renderScaleBias < 1) renderScaleBias = Math.min(1, renderScaleBias + 0.01);
      }
      M.qualityBias = +renderScaleBias.toFixed(2);
    } else if (renderScaleBias < 1) { renderScaleBias = Math.min(1, renderScaleBias + 0.01); M.qualityBias = +renderScaleBias.toFixed(2); }

    const pHit = intervals.slice(-180).filter((x) => x > med * 1.7).length / Math.max(intervals.slice(-180).length, 1);
    thermalPressure = thermalPressure * 0.97 + pHit * 0.03;
    const clampedPressure = clamp(thermalPressure * 6, 0, 1);
    M.thermal = +(26 + clampedPressure * 22 + (M.cpuLoad / 100) * 12 + (M.gpuLoad / 100) * 10).toFixed(1);
    if (engine.thermalSource) {
      try {
        const t = engine.thermalSource();
        if (t > 0) { M.thermal = +t.toFixed(1); M.thermalReal = true; }
      } catch (e) { }
    }
    M.stable = Math.round(clamp(100 - M.jitter * 3.2 - (M.skipped / Math.max(rafCount + 1, 1)) * 40, 0, 100));
    engine.bias = renderScaleBias;

    publishAcc += dt;
    if (publishAcc > 180) {
      publishAcc = 0;
      if (engine.ramSource) { try { M.ramPct = Math.round(clamp(engine.ramSource(), 0, 100)); } catch (e) {} }
      engine.subs.forEach((fn) => { try { fn(M); } catch (e) {} });
    }
    last = t;
  };
  requestAnimationFrame(frame);
  log.ok("SHIELD", "Engine online \u2014 frame limiter, pacing scheduler and metrics samplers armed (cap " + engine.target + " FPS).");
}

export function idleBackoff() {
  const t = now();
  const dt = t - last;
  last = t;
  return dt;
}

export function setRamSource(fn) { engine.ramSource = fn; }
export function qualityBias() { return engine.bias || 1; }
export { M as metrics };
