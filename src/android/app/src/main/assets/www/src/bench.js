import { el, log, cmd, toast, barFill, escapeHtml } from "./ui.js";
import { engine, metrics as M } from "./engine.js";
import * as native from "./native.js";

const workerSrc = `
self.onmessage = (e) => {
  const n = e.data.n;
  let x = 12345;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; x ^= (x >> 7); }
  self.postMessage({ ms: performance.now() - t0, x });
};`;

let workers = [];
let running = false;
const runs = [];

function cpuWork(iterations) {
  let x = 12345;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; x ^= (x >> 7); }
  return { ms: performance.now() - t0, x };
}

function calibrate() {
  let n = 200000;
  let guard = 0;
  while (true) {
    const r = cpuWork(n);
    if (r.ms > 90) return { n, ms: r.ms };
    n *= 2;
    if (n > 4e7 || ++guard > 12) { n = Math.min(n, 4e7); return { n, ms: cpuWork(Math.min(n, 4e7)) }; }
  }
}

function gpuFill(targetMs) {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 320;
  const gl = c.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const vs = "attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }";
  const fs = `precision highp float; uniform float t;
  void main(){ vec2 u = gl_FragCoord.xy / 320.0; float a = 0.0;
    for (int i = 0; i < 48; i++) { float f = float(i) * 0.13; a += sin(u.x * 24.0 + f + t) * cos(u.y * 21.0 - f); a = fract(a * 0.37); }
    gl_FragColor = vec4(a, a * 0.6, 1.0 - a, 1.0); }`;
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tLoc = gl.getUniformLocation(prog, "t");
  const t0 = performance.now();
  let frames = 0;
  while (performance.now() - t0 < targetMs) {
    const frameStart = performance.now();
    gl.uniform1f(tLoc, (performance.now() - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
    frames++;
    /* A software / very slow GPU can take hundreds of ms for one fill of this shader.
       Bail out after the first frame that has already eaten the whole budget so the app
       never freezes the UI thread on a low-end device. */
    if (performance.now() - frameStart > 250) break;
  }
  const ms = performance.now() - t0;
  const mpix = (frames * 320 * 320) / 1e6;
  return { mpix, ms, mpps: (mpix / ms) * 1000 };
}

function ramBandwidth() {
  const size = 16 * 1024 * 1024;
  const a = new Uint8Array(size);
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) a[i] = i & 255;
  const t0 = performance.now();
  for (let pass = 0; pass < 4; pass++) b.set(a);
  const ms = performance.now() - t0;
  const mb = (size * 4) / 1048576;
  return { mb, ms, mbps: (mb / ms) * 1000 };
}

async function storageIo() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(null), 8000);
    try {
      const req = indexedDB.open("optimizer-bench", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onerror = () => done(null);
      req.onsuccess = () => {
        const db = req.result;
        const data = new Uint8Array(1536 * 1024);
        for (let i = 0; i < data.length; i += 1024) data[i] = i & 255;
        const tx = db.transaction("kv", "readwrite");
        const t0 = performance.now();
        tx.objectStore("kv").put(data, "blob");
        tx.oncomplete = () => {
          const writeMs = performance.now() - t0;
          const tx2 = db.transaction("kv", "readonly");
          const t1 = performance.now();
          const g = tx2.objectStore("kv").get("blob");
          g.onsuccess = () => {
            const readMs = performance.now() - t1;
            const okBytes = g.result ? g.result.byteLength : 0;
            done({ mb: okBytes / 1048576, writeMs, readMs, mbps: (okBytes / 1048576 / (writeMs + readMs)) * 1000 });
          };
          g.onerror = () => done(null);
        };
        tx.onerror = () => done(null);
      };
    } catch (e) { done(null); }
  });
}

function setStep(name, pct) {
  const s = el("benchStep"), p = el("benchPct");
  if (s) s.textContent = name;
  if (p) p.textContent = Math.round(pct) + "%";
  barFill(el("benchBar") && el("benchBar").firstElementChild, pct);
}

function multiCore(cores, iterations) {
  return new Promise((resolve) => {
    let done = 0, total = 0;
    const t0 = performance.now();
    for (let i = 0; i < cores; i++) {
      const w = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" })));
      workers.push(w);
      w.onmessage = (e) => {
        total += e.data.ms;
        if (++done === cores) resolve({ cores, wallMs: performance.now() - t0, perCoreMs: total / cores });
        w.terminate();
      };
      w.postMessage({ n: iterations });
    }
  });
}

function killWorkers() {
  workers.forEach((w) => { try { w.terminate(); } catch (e) {} });
  workers = [];
}

export async function runBenchmark() {
  if (running) return toast("Benchmark already running.", "warn");
  running = true;
  killWorkers();
  const btn = el("benchResults") && null;
  log.exec("BENCH", "Benchmark suite started \u2014 measuring CPU, GPU fill-rate, memory bandwidth and storage I/O ...");
  const tag = el("benchTag"); if (tag) tag.textContent = "RUNNING";
  toast("Benchmark running \u2014 keep the app in the foreground.", "warn", 3200);
  const result = { at: Date.now(), profile: engine.mode.governor, bias: engine.bias || 1, fps: M.fps };

  setStep("Calibrating CPU workload ...", 4);
  await new Promise((r) => setTimeout(r, 60));
  const cal = calibrate();
  const iterations = cal.n;
  log.info("BENCH", "Calibration: " + iterations.toLocaleString() + " iterations \u2248 " + cal.ms.toFixed(0) + " ms on one core.");

  setStep("CPU single-core test ...", 18);
  await new Promise((r) => setTimeout(r, 40));
  const single = cpuWork(iterations);
  result.cpu1 = Math.round(iterations / single.ms / 1000 * 100) / 100;
  log.ok("BENCH", "CPU 1-thread: " + single.ms.toFixed(1) + " ms \u2192 score " + result.cpu1);

  setStep("CPU multi-core test (" + Math.min(navigator.hardwareConcurrency || 4, 8) + " threads) ...", 34);
  const cores = Math.min(navigator.hardwareConcurrency || 4, 8);
  const multi = await multiCore(cores, iterations);
  result.cores = cores;
  result.cpuN = Math.round((iterations * cores) / multi.wallMs / 1000 * 100) / 100;
  result.scaling = Math.round((result.cpuN / (result.cpu1 * cores)) * 1000) / 10;
  log.ok("BENCH", "CPU " + cores + "-thread: " + multi.wallMs.toFixed(1) + " ms wall \u2192 score " + result.cpuN + " (" + result.scaling + "% scaling efficiency)");

  if (native.isNative()) {
    setStep("Native CPU benchmark (NDK C++, all cores) ...", 44);
    await new Promise((r) => setTimeout(r, 40));
    const nb = native.bench(3000000);
    if (nb && nb.singleMops) {
      result.nat1 = Math.round(nb.singleMops * 10) / 10;
      result.natN = Math.round(nb.multiMops * 10) / 10;
      result.natThreads = nb.threads;
      log.ok("BENCH", "Native C++ (NDK): " + result.nat1 + " Mops/s on one core, " + result.natN + " Mops/s across " + nb.threads + " threads.");
    }
  }

  setStep("GPU fill-rate + shader test ...", 54);
  await new Promise((r) => setTimeout(r, 40));
  const gpu = gpuFill(700);
  if (gpu) {
    result.gpu = Math.round(gpu.mpps * 10) / 10;
    log.ok("BENCH", "GPU fill-rate: " + gpu.mpps.toFixed(1) + " Mpixel/s across " + Math.round(gpu.mpix) + " Mpixels of heavy fragment work.");
  } else log.warn("BENCH", "WebGL unavailable \u2014 GPU test skipped.");

  setStep("Memory bandwidth test ...", 72);
  await new Promise((r) => setTimeout(r, 40));
  const ram = ramBandwidth();
  result.ram = Math.round(ram.mbps);
  log.ok("BENCH", "Memory bandwidth: " + ram.mbps.toFixed(0) + " MB/s (" + ram.mb.toFixed(0) + " MB moved in " + ram.ms.toFixed(1) + " ms).");

  setStep("Storage I/O test ...", 88);
  const io = await storageIo();
  if (io) {
    result.storage = Math.round(io.mbps * 10) / 10;
    log.ok("BENCH", "Storage I/O: " + io.mbps.toFixed(1) + " MB/s (write " + io.writeMs.toFixed(0) + " ms, read " + io.readMs.toFixed(0) + " ms for " + io.mb.toFixed(0) + " MB).");
  } else log.warn("BENCH", "IndexedDB unavailable \u2014 storage test skipped.");

  result.total = Math.round((result.cpu1 * 11 + result.cpuN * 4 + (result.gpu || 0) * 1.4 + result.ram / 90 + (result.storage || 0) * 1.6));
  runs.push(result);
  setStep("Complete", 100);
  log.ok("BENCH", "Suite complete \u2014 composite score " + result.total + " at governor=" + engine.mode.governor + ", quality bias " + (engine.bias || 1) + ".");
  renderResults();
  const t2 = el("benchTag"); if (t2) t2.textContent = runs.length > 1 ? "RUN " + runs.length : "1 RUN";
  if (runs.length === 1) log.info("BENCH", "This run is the baseline. Apply an optimization preset and run again to see the real delta.");
  running = false;
  toast("Benchmark complete \u2014 score " + result.total, "ok", 4200);
  return result;
}

function renderResults() {
  const body = el("benchRows");
  if (!body) return;
  if (!runs.length) return;
  const before = runs[0];
  const after = runs[runs.length - 1];
  const rows = [
    ["CPU single-thread (JS)", before.cpu1, after.cpu1, ""],
    ["CPU " + (after.cores || 4) + "-thread (JS)", before.cpuN, after.cpuN, ""],
    ["CPU native 1-core (Mops/s)", before.nat1, after.nat1, ""],
    ["CPU native " + (after.natThreads || 8) + "-thread (Mops/s)", before.natN, after.natN, ""],
    ["GPU fill-rate (Mpix/s)", before.gpu, after.gpu, ""],
    ["RAM bandwidth (MB/s)", before.ram, after.ram, ""],
    ["Storage I/O (MB/s)", before.storage, after.storage, ""],
    ["Composite score", before.total, after.total, "big"],
  ];
  body.innerHTML = rows.map(([k, b, a, cls]) => {
    if (b === undefined && a === undefined) return "";
    const d = b && a ? ((a - b) / b) * 100 : 0;
    const dcls = d > 1 ? "good" : d < -1 ? "bad" : "";
    return "<tr><td>" + k + '</td><td class="num">' + (b === undefined ? "-" : b) + '</td><td class="num">' + (a === undefined ? "-" : a) +
      '</td><td class="' + dcls + '">' + (runs.length > 1 ? (d >= 0 ? "+" : "") + d.toFixed(1) + "%" : "baseline") + "</td></tr>";
  }).join("");
  const t = el("benchScoreTag");
  if (t) t.textContent = "SCORE " + after.total;
}

export function initBench() {
  cmd("bench.run", () => { runBenchmark(); });
  cmd("bench.reset", () => { runs.length = 0; killWorkers(); el("benchRows").innerHTML = '<tr><td colspan="4" class="dim">No results yet - run a benchmark.</td></tr>'; el("benchScoreTag").textContent = "-"; el("benchTag").textContent = "IDLE"; setStep("Ready", 0); log.warn("BENCH", "Benchmark results cleared."); });
  setStep("Ready", 0);
}
