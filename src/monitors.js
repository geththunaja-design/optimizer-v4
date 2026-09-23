import { el, log, state, set, on, toast, fmtMb, escapeHtml, cmd, statGrid, setText } from "./ui.js";
import { engine, metrics as M } from "./engine.js";
import { APP } from "./config.js";

let chart = null;
let chartFailed = false;
let chartPaused = false;
let Chart = null;
const hist = [];
const spark = new Array(60).fill(0);

/* ------------------------------------------------------------- chart.js --- */
export async function ensureChart() {
  if (chart || chartFailed || Chart || ensureChart.__busy) return;
  ensureChart.__busy = true;
  const canvas = el("graphCanvas");
  if (!canvas) return;
  try {
    const mod = await import("https://esm.sh/chart.js@4.4.1/auto");
    Chart = mod.default || mod.Chart;
    ensureChart.__busy = false;
    const ctx = canvas.getContext("2d");
    const gradA = ctx.createLinearGradient(0, 0, 0, 220);
    gradA.addColorStop(0, "rgba(34,211,238,.42)");
    gradA.addColorStop(1, "rgba(34,211,238,0)");
    const gradB = ctx.createLinearGradient(0, 0, 0, 220);
    gradB.addColorStop(0, "rgba(124,92,255,.36)");
    gradB.addColorStop(1, "rgba(124,92,255,0)");
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "FPS", data: [], borderColor: "#22d3ee", backgroundColor: gradA, fill: true, tension: .35, borderWidth: 2, pointRadius: 0, yAxisID: "y" },
          { label: "RAM %", data: [], borderColor: "#7c5cff", backgroundColor: gradB, fill: true, tension: .35, borderWidth: 2, pointRadius: 0, yAxisID: "y1" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { labels: { color: "#9fb0d4", font: { family: "JetBrains Mono", size: 10 }, boxWidth: 12 } },
          tooltip: { backgroundColor: "rgba(6,10,22,.92)", borderColor: "rgba(34,211,238,.35)", borderWidth: 1, titleFont: { family: "JetBrains Mono" }, bodyFont: { family: "JetBrains Mono" } },
        },
        scales: {
          x: { ticks: { color: "#5f7099", maxTicksLimit: 6, font: { family: "JetBrains Mono", size: 9 } }, grid: { color: "rgba(120,170,255,.07)" } },
          y: { position: "left", suggestedMin: 0, suggestedMax: 130, ticks: { color: "#22d3ee", font: { family: "JetBrains Mono", size: 9 } }, grid: { color: "rgba(120,170,255,.07)" }, title: { display: true, text: "FPS", color: "#22d3ee", font: { size: 9 } } },
          y1: { position: "right", suggestedMin: 0, suggestedMax: 100, ticks: { color: "#7c5cff", font: { family: "JetBrains Mono", size: 9 } }, grid: { drawOnChartArea: false }, title: { display: true, text: "RAM %", color: "#7c5cff", font: { size: 9 } } },
        },
      },
    });
    el("graphTag").textContent = "CHART.JS LIVE";
    log.ok("TELEMETRY", "Chart.js telemetry stream attached (FPS + RAM load %).");
  } catch (e) {
    ensureChart.__busy = false;
    chartFailed = true;
    el("graphTag").textContent = "CANVAS FALLBACK";
    log.warn("TELEMETRY", "Chart.js unavailable (" + e.message + ") \u2014 switched to built-in canvas plotter.");
    startFallbackPlot();
  }
}

function startFallbackPlot() {
  const c = el("graphCanvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  c.__fallback = true;
  const draw = () => {
    if (!c.__fallback) return;
    if (!engine.running) { requestAnimationFrame(draw); return; }
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(120,170,255,.12)";
    for (let i = 0; i <= 4; i++) { const y = (h / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const pts = hist.slice(-120);
    if (pts.length > 1) {
      const drawLine = (key, color, scale) => {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
        pts.forEach((p, i) => {
          const x = (i / (pts.length - 1)) * w;
          const y = h - (p[key] / scale) * h;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      };
      drawLine("fps", "#22d3ee", 130);
      drawLine("ram", "#7c5cff", 100);
    }
    requestAnimationFrame(draw);
  };
  draw();
}

let chartTick = 0;
function pushChart() {
  const p = { fps: M.fps, ram: M.ramPct };
  hist.push(p);
  if (hist.length > 400) hist.shift();
  if (chart && !chartPaused && (chartTick += 1) % 2 === 0) {
    const lbl = new Date().toLocaleTimeString().replace(" ", "");
    chart.data.labels.push(lbl);
    chart.data.datasets[0].data.push(M.fps);
    chart.data.datasets[1].data.push(M.ramPct);
    if (chart.data.labels.length > 60) {
      chart.data.labels.shift();
      chart.data.datasets.forEach((d) => d.data.shift());
    }
    chart.update("none");
  }
}

/* ---------------------------------------------------------------- badges --- */
function paintHud() {
  const hud = el("hud");
  if (!hud) return;
  const on2 = state["ui.hud"];
  hud.classList.toggle("hidden", !on2);
  if (!on2) return;
  setText("hudFps", M.fps);
  const f = el("hudFps");
  const fcls = "hud-fps " + (M.fps < engine.target * 0.7 ? "bad" : M.fps < engine.target * 0.9 ? "warn" : "");
  if (f && f.className !== fcls) f.className = fcls;
  setText("hudFrame", M.frameMs.toFixed(1) + " ms");
  setText("hudCpu", M.cpuLoad + "%");
  setText("hudRam", M.ramPct + "%");
  setText("hudTherm", M.thermal.toFixed(1) + "\u00B0C");
  setText("hudVer", "v" + APP.version);
  spark.push(M.fps);
  spark.shift();
  const sc = el("hudSpark");
  if (sc) {
    const ctx = sc.getContext("2d");
    ctx.clearRect(0, 0, sc.width, sc.height);
    ctx.beginPath();
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 1.6;
    const max = Math.max(engine.target, 60);
    spark.forEach((v, i) => {
      const x = (i / (spark.length - 1)) * sc.width;
      const y = sc.height - (v / max) * sc.height;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}

export function paintStats() {
  statGrid(el("monStats"), [
    ["In-game FPS", M.fps, M.fps >= engine.target * 0.9 ? "good" : M.fps >= engine.target * 0.7 ? "warn" : "bad"],
    ["Frame time", M.frameMs.toFixed(1) + "ms", ""],
    ["Jitter", M.jitter.toFixed(1) + "ms", M.jitter < 3 ? "good" : "warn"],
    ["CPU " + (M.cpuReal ? "device" : "engine"), M.cpuLoad + "%", M.cpuLoad < 60 ? "good" : "warn"],
    ["GPU engine", M.gpuLoad + "%", M.gpuLoad < 85 ? "good" : "warn"],
    [M.thermalReal ? "SoC temp" : "Thermal est.", M.thermal.toFixed(1) + "\u00B0C", M.thermal < 42 ? "good" : M.thermal < 52 ? "warn" : "bad"],
  ]);
  setText("fpsPillVal", M.fps);
  setText("cpuLoadTxt", M.cpuLoad + "%");
  setText("gpuLoadTxt", M.gpuLoad + "%");
  const b = el("fpsPill");
  if (b) {
    const cls = "badge" + (M.fps < engine.target * 0.7 ? " bad" : M.fps < engine.target * 0.9 ? " warn" : "");
    if (b.className !== cls) b.className = cls;
  }
  const eb = el("engineBadge");
  if (eb) eb.classList.toggle("warn", M.cpuLoad > 70 || M.gpuLoad > 85);
  const chip = el("shieldChip");
  if (chip) {
    const onCount = ["mon.shield", "mon.framePacing", "mon.antiThermal", "mon.stutterBuffer"].filter((k) => state[k]).length;
    chip.textContent = onCount ? "ACTIVE " + onCount + "/4" : "STANDBY";
    chip.classList.toggle("on", onCount > 0);
  }
  const lchip = el("lagChip");
  if (lchip) {
    const n = ["lag.perfLock", "lag.gpuBoost", "lag.zeroStutter"].filter((k) => state[k]).length;
    lchip.textContent = n ? "ACTIVE " + n + "/3" : "STANDBY";
    lchip.classList.toggle("on", n > 0);
  }
}

/* -------------------------------------------------------------- controls --- */
export function initMonitors() {
  engine.onMetrics((m) => {
    paintHud();
    paintStats();
    if (state["ui.graph"]) pushChart();
  });

  el("hudBtn").addEventListener("click", () => set("ui.hud", !state["ui.hud"]));
  const hud = el("hud");
  if (hud) {
    let drag = null;
    hud.addEventListener("pointerdown", (e) => {
      const r = hud.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
      hud.setPointerCapture(e.pointerId);
    });
    hud.addEventListener("pointermove", (e) => {
      if (!drag) return;
      hud.style.left = Math.max(2, Math.min(window.innerWidth - 60, drag.l + e.clientX - drag.x)) + "px";
      hud.style.top = Math.max(2, Math.min(window.innerHeight - 40, drag.t + e.clientY - drag.y)) + "px";
    });
    const drop = () => { if (drag) { drag = null; log.info("HUD", "FPS overlay pinned to (" + hud.style.left + ", " + hud.style.top + ")."); } };
    hud.addEventListener("pointerup", drop);
    hud.addEventListener("pointercancel", drop);
  }
  on("ui.hud", (v) => { paintHud(); toast(v ? "FPS HUD overlay enabled." : "FPS HUD overlay hidden.", v ? "ok" : "warn"); });
  on("ui.graph", (v) => { if (v) { ensureChart(); } toast(v ? "Telemetry graph streaming." : "Telemetry graph paused.", v ? "ok" : "warn"); });

  on("hw.targetFps", (v) => {
    engine.setTargetFps(v);
    const t = el("tgtFpsVal"); if (t) t.textContent = v + " FPS";
    const s = el("tgtTouchTag");
  });
  on("hw.governor", (v) => { engine.setGovernor(v); const t = el("tgtGovVal"); if (t) t.textContent = v; });
  on("hw.memAggression", (v) => { engine.setAggression(v); const t = el("tgtMemVal"); if (t) t.textContent = v + " / 5"; });

  on("mon.shield", (v) => engine.setShield(v));
  on("mon.framePacing", (v) => engine.setFramePacing(v));
  on("mon.antiThermal", (v) => engine.setAntiThermal(v));
  on("mon.stutterBuffer", (v) => engine.setStutterBuffer(v));
  on("lag.perfLock", (v) => engine.setPerfLock(v));
  on("lag.gpuBoost", (v) => engine.setGpuBoost(v));
  on("lag.zeroStutter", (v) => engine.setZeroStutter(v));

  cmd("mon.optimizeNow", () => {
    const before = { fps: M.fps, jitter: M.jitter, frame: M.frameMs };
    log.exec("SHIELD", "Running frame-pacing + FPS-drop repair routine ...");
    set("mon.shield", true);
    set("mon.framePacing", true);
    set("mon.stutterBuffer", true);
    set("hw.targetFps", engine.target === 60 ? 60 : engine.target);
    log.info("SHIELD", "Holding steady for 1.4s to measure the repair ...");
    toast("Measuring frame pacing repair ...", "warn", 1600);
    setTimeout(() => {
      log.ok("SHIELD", "Repair complete \u2014 jitter " + before.jitter.toFixed(2) + "ms \u2192 " + M.jitter.toFixed(2) +
        "ms, frame time " + before.frame.toFixed(2) + "ms \u2192 " + M.frameMs.toFixed(2) + "ms.");
      toast("Frame pacing repaired \u2014 jitter " + M.jitter.toFixed(1) + "ms", "ok");
    }, 1400);
  });

  cmd("lag.apply", () => {
    log.exec("ZERO-LAG", "Writing zero-lag profile: governor=performance, GPU=boost, pacing=locked ...");
    set("lag.perfLock", true); set("lag.gpuBoost", true); set("lag.zeroStutter", true);
    set("hw.governor", "performance");
    log.ok("ZERO-LAG", "Zero lag profile live \u2014 render priority maxed, GPU boost requested, stutter lock on.");
    toast("Zero Lag Optimization applied.", "ok");
  });

  cmd("graph.toggle", () => {
    chartPaused = !chartPaused;
    log.info("TELEMETRY", chartPaused ? "Telemetry stream paused." : "Telemetry stream resumed.");
  });
  cmd("graph.snapshot", () => {
    const pts = hist.slice(-120);
    if (!pts.length) return toast("No telemetry captured yet.", "warn");
    const fps = pts.map((p) => p.fps);
    const avg = (fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1);
    const min = Math.min(...fps), max = Math.max(...fps);
    log.ok("TELEMETRY", "60s telemetry snapshot \u2014 avg " + avg + " FPS, min " + min + ", max " + max + ", " + pts.length + " samples.");
    toast("Telemetry: avg " + avg + " FPS (min " + min + " / max " + max + ")", "ok", 4200);
  });
}
