import { el, log, state, set, on, toast, cmd, clamp, statGrid, setText } from "./ui.js";
import { engine, metrics as M } from "./engine.js";
import { autoFit } from "./canvas.js";

const pts = [];
let measuredHz = 0;
let peakVel = 0;
let velSum = 0, velN = 0;
let lastEvt = 0;
let intervalWin = [];
let calibrating = 0;
let pending = [];
let current = { x: 0, y: 0 };
let drawing = false;
let lastV = 0;

function paintStats() {
  const avgVel = velN ? velSum / velN : 0;
  statGrid(el("touchStats"), [
    ["Measured panel rate", measuredHz ? Math.round(measuredHz) + " Hz" : "--", measuredHz >= state["touch.pollRate"] ? "good" : "warn"],
    ["Target polling", state["touch.pollRate"] + " Hz", "good"],
    ["Peak drag velocity", peakVel ? peakVel.toFixed(2) + " px/ms" : "--", ""],
    ["Average velocity", avgVel ? avgVel.toFixed(2) + " px/ms" : "--", ""],
    ["Samples", velN + "", ""],
  ]);
  setText("touchCalTag", calibrating ? "CALIBRATING" : drawing ? "TRACKING" : "IDLE");
  setText("touchRateTag", state["touch.pollRate"] + " Hz TARGET");
}

export function initTouch() {
  const canvas = el("touchCanvas");
  const cv = el("touchStat");
  let ctxState = null;
  autoFit(canvas, 300, (s) => { ctxState = s; draw(); });

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp || performance.now() };
  };

  function record(p) {
    if (lastEvt) {
      const dt = p.t - lastEvt;
      if (dt > 0 && dt < 200) {
        intervalWin.push(dt);
        if (intervalWin.length > 60) intervalWin.shift();
        const sorted = [...intervalWin].sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1] || 16;
        measuredHz = measuredHz ? measuredHz * 0.75 + (1000 / med) * 0.25 : 1000 / med;
      }
    }
    lastEvt = p.t;
    const prev = pts[pts.length - 1];
    if (prev) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      const dt = Math.max(p.t - prev.t, 0.5);
      const v = d / dt;
      lastV = v;
      peakVel = Math.max(peakVel, v);
      velSum += v; velN++;
    }
    pts.push({ x: p.x, y: p.y, t: p.t });
    if (pts.length > 260) pts.shift();
    /* app input pipeline delay buffer */
    pending.push({ ...p, due: performance.now() + Number(state["touch.delay"] || 1) });
    if (pending.length > 80) pending.shift();
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    pts.length = 0;
    if (!calibrating) log.info("TOUCH", "Drag started \u2014 sampling panel report rate ...");
    else { calibrating = 2; log.exec("TOUCH", "Auto-calibration armed \u2014 swipe as fast as you can for 3 seconds."); }
    record(pos(e));
    paintStats();
  });
  canvas.addEventListener("pointermove", (e) => { if (!drawing) return; record(pos(e)); });
  const up = (e) => {
    if (!drawing) return;
    drawing = false;
    const hz = Math.round(measuredHz);
    log.ok("TOUCH", "Drag finished \u2014 panel reported at ~" + hz + " Hz, peak velocity " + peakVel.toFixed(2) + " px/ms" +
      (hz >= state["touch.pollRate"] ? " \u2014 meets the " + state["touch.pollRate"] + " Hz target." : " \u2014 below the " + state["touch.pollRate"] + " Hz target."));
    paintStats();
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", up);

  function drawMarker(x, y) {
    const c = ctxState.ctx;
    if (!c) return;
    c.beginPath();
    c.arc(x, y, 13, 0, Math.PI * 2);
    c.strokeStyle = "rgba(255,255,255,.5)";
    c.lineWidth = 1;
    c.stroke();
    c.beginPath();
    c.arc(x, y, 3.4, 0, Math.PI * 2);
    c.fillStyle = "#ffffff";
    c.fill();
    if (lastV > 0.05) {
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + clamp(lastV * 60, -90, 90), y);
      c.strokeStyle = "rgba(34,211,238,.7)";
      c.lineWidth = 2;
      c.stroke();
    }
  }

  function draw() {
    if (!ctxState) return;
    if (!engine.running) { requestAnimationFrame(draw); return; }
    const { ctx, w, h } = ctxState;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#060a15"); bg.addColorStop(1, "#0a1024");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(120,170,255,.10)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    /* processed (delay-buffered) point */
    const nowMs = performance.now();
    while (pending.length && pending[0].due <= nowMs) current = pending.shift();
    const lag = pending.length;

    if (pts.length > 1) {
      ctx.lineWidth = 2.4;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const t = i / pts.length;
        ctx.strokeStyle = "rgba(34,211,238," + (0.08 + t * 0.72).toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      pts.forEach((p, i) => {
        if (i % 3) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(160,200,255,.35)";
        ctx.fill();
      });
    }
    if (drawing || pending.length) {
      drawMarker(current.x || 0, current.y || 0);
      ctx.font = "10px monospace";
      ctx.fillStyle = "rgba(140,180,255,.7)";
      ctx.fillText("INPUT " + state["touch.delay"] + "ms \u00B7 " + lag + " queued", 10, h - 10);
    }
    if (cv) {
      cv.innerHTML = "RATE <b>" + (measuredHz ? Math.round(measuredHz) : "--") + " Hz</b><br>VEL <b>" + lastV.toFixed(2) + " px/ms</b><br>TGT <b>" + state["touch.pollRate"] + " Hz</b>";
    }
    requestAnimationFrame(draw);
  }
  draw();
  paintStats();

  let calTimer = null;
  cmd("touch.clear", () => { pts.length = 0; pending.length = 0; draw(); log.info("TOUCH", "Calibration canvas cleared."); });
  cmd("touch.calibrate", () => {
    calibrating = 1;
    measuredHz = 0; intervalWin = [];
    paintStats();
    log.exec("TOUCH", "Auto-calibrating touch panel \u2014 waiting for an input stream ...");
    if (calTimer) clearTimeout(calTimer);
    calTimer = setTimeout(() => {
      calibrating = 0;
      const hz = Math.round(measuredHz);
      const opts = [120, 180, 240, 360, 480];
      const nearest = opts.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a), 120);
      if (hz) {
        set("touch.pollRate", nearest);
        set("hw.touchRate", nearest);
        log.ok("TOUCH", "Panel measured at " + hz + " Hz \u2014 polling target locked to " + nearest + " Hz (nearest supported step).");
        toast("Panel rate " + hz + " Hz \u2014 target set to " + nearest + " Hz", "ok");
      } else log.warn("TOUCH", "No touch stream detected during calibration \u2014 swipe on the canvas and try again.");
      paintStats();
    }, 3000);
  });

  on("touch.delay", (v) => {
    const t = el("touchDelayVal");
    if (t) t.textContent = v + " ms";
    log.exec("TOUCH", "Input pipeline delay set to " + v + " ms \u2014 touch samples now reach the renderer after " + v + " ms of buffering (visible as the lag between finger and processed marker).");
  });
  on("touch.pollRate", (v) => {
    const t = el("touchPollVal");
    if (t) t.textContent = v + " Hz";
    log.exec("TOUCH", "Touch polling target = " + v + " Hz \u2014 the engine consumes no touch sample slower than " + (1000 / v).toFixed(2) + " ms.");
    paintStats();
  });

  engine.onMetrics(paintStats);
}
