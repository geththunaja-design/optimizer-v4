import { log, el, escapeHtml, toast, set } from "./ui.js";
import * as native from "./native.js";

export const device = {
  info: { scanned: false },
};

function gpuInfo() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { renderer: "unavailable", vendor: "-", webgl2: false, maxTex: "-" };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webgl2: !!c.getContext("webgl2"),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  } catch (e) { return { renderer: "error", vendor: "-", webgl2: false, maxTex: "-" }; }
}

function uaParse(ua) {
  const android = /Android\s+([\d.]+)/i.exec(ua);
  let model = "-";
  const m = /Android[^;]*;\s*([^;)]+?)(?:\s+Build[/ ]|\s*\))/i.exec(ua);
  if (m) model = m[1].replace(/\s*wv$/i, "").trim();
  return { android: android ? android[1] : "unknown", model };
}

export async function measureRefresh() {
  return new Promise((res) => {
    const ts = [];
    let n = 0;
    const step = (t) => {
      ts.push(t);
      if (++n < 90) requestAnimationFrame(step);
      else {
        const d = [];
        for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        d.sort((a, b) => a - b);
        const med = d[d.length >> 1] || 16.7;
        const hz = Math.round(1000 / med);
        res(hz < 24 ? 0 : hz);
      }
    };
    requestAnimationFrame(step);
  });
}

export async function scanHardware(silent) {
  if (!silent) log.info("DEVICE", "Re-scanning hardware specifications ...");
  const ua = navigator.userAgent;
  const p = uaParse(ua);
  let he = {};
  try { he = await navigator.userAgentData.getHighEntropyValues(["model", "platformVersion", "architecture", "bitness", "uaFullVersion"]); } catch (e) {}
  const gpu = gpuInfo();

  const info = {
    model: (he.model && he.model !== "" ? he.model : (p.model !== "-" ? p.model : (navigator.userAgent.includes("Android") ? "unreported Android device" : "desktop preview"))),
    platform: he.platform || "Android",
    android: he.platformVersion || p.android,
    arch: (he.architecture || "arm64") + (he.bitness ? " / " + he.bitness + "-bit" : ""),
    ram: navigator.deviceMemory ? navigator.deviceMemory + " GiB (reported class)" : "unreported",
    cores: navigator.hardwareConcurrency || 4,
    res: screen.width + " x " + screen.height + " CSS px",
    resPhys: Math.round(screen.width * devicePixelRatio) + " x " + Math.round(screen.height * devicePixelRatio) + " px",
    dpr: devicePixelRatio,
    gpu: gpu.renderer,
    gpuVendor: gpu.vendor,
    webgl2: gpu.webgl2,
    maxTex: gpu.maxTex,
    refresh: "-",
    heapLimit: performance.memory ? (performance.memory.jsHeapSizeLimit / 1048576).toFixed(0) + " MB" : "n/a",
    cs: navigator.connection ? (navigator.connection.effectiveType || "") + (navigator.connection.downlink ? " @ " + navigator.connection.downlink + " Mb/s" : "") : "n/a",
    touch: navigator.maxTouchPoints || 0,
    lang: navigator.language || "-",
    shell: native.isNative() ? "Android APK (native)" : "Browser page",
    cpuModel: "-",
    ua,
  };
  if (native.isNative()) {
    const n = native.info();
    info.model = n.model || info.model;
    info.android = n.android || info.android;
    info.ram = n.totalRamMb > 0 ? (n.totalRamMb / 1024).toFixed(1) + " GB (real, /proc/meminfo)" : info.ram;
    info.cores = n.cores || info.cores;
    info.arch = n.abi || info.arch;
    info.gpu = n.gpu || info.gpu;
    info.gpuVendor = n.gpuVendor || info.gpuVendor;
    info.webgl2 = info.webgl2;
    info.cpuModel = (n.cpuModel || "-") + (n.cpuMaxMhz > 0 ? " @ " + (n.cpuMaxMhz / 1000).toFixed(2) + " GHz" : "");
    info.resPhys = n.widthPx + " x " + n.heightPx + " px";
    info.heapLimit = n.memClassMb > 0 ? n.memClassMb + " MB (app heap class)" : info.heapLimit;
  }
  Object.assign(device.info, info, { scanned: true });
  render();
  const hz = await measureRefresh();
  const natHz = native.isNative() ? (native.info().refreshHz || 0) : 0;
  device.info.refresh = natHz ? natHz + " Hz" + (hz ? " (measured " + hz + ")" : "") : (hz ? hz + " Hz" : "unavailable (page throttled)");
  render();
  if (!silent) {
    log.ok("DEVICE", "Scan complete \u2014 " + info.model + " \u00B7 Android " + info.android + " \u00B7 " + info.cores + " cores \u00B7 " + info.ram + " \u00B7 panel " + device.info.refresh + ".");
    log.info("DEVICE", "GPU renderer: " + info.gpu);
    toast("Hardware specs scanned \u2014 " + hz + " Hz panel, " + info.cores + " cores.", "ok");
  }
  return device.info;
}

const ROWS = [
  ["\uD83D\uDCF1", "Device Model", "model", 1],
  ["\uD83E\uDD16", "Android OS Version", "android", 1],
  ["\uD83E\uDDE0", "Physical RAM Capacity", "ram", 1],
  ["\u2699\uFE0F", "CPU Core Count", "cores", 1],
  ["\uD83D\uDDA5\uFE0F", "Screen Resolution", "res", 1],
  ["\uD83D\uDD2C", "Physical Panel Pixels", "resPhys", 0],
  ["\uD83C\uDFA8", "GPU Renderer", "gpu", 1],
  ["\uD83C\uDFA8", "GPU Vendor", "gpuVendor", 0],
  ["\u26A1", "Panel Refresh Rate", "refresh", 1],
  ["\uD83E\uDDE0", "SoC / Chipset", "cpuModel", 1],
  ["\uD83E\uDDE9", "App Shell", "shell", 1],
  ["\uD83E\uDDF1", "Architecture", "arch", 0],
  ["\uD83D\uDD0B", "JS Heap Limit", "heapLimit", 0],
  ["\uD83D\uDCF6", "Network Class", "cs", 0],
  ["\uD83D\uDC46", "Touch Points", "touch", 0],
  ["\uD83C\uDF10", "Pixel Ratio", "dpr", 0],
];

export function render() {
  const g = el("hwGrid");
  if (!g) return;
  const i = device.info;
  g.innerHTML = ROWS.map(([ico, k, key]) =>
    '<div class="kv"><span class="kv-ico">' + ico + '</span><div class="kv-txt"><div class="kv-k">' + k +
    '</div><div class="kv-v' + (key === "gpu" ? " accent" : "") + '">' + escapeHtml(i[key] === undefined ? "-" : i[key]) + "</div></div></div>").join("");
  const stamp = el("hwStamp");
  if (stamp && i.scanned) stamp.textContent = "SCANNED " + new Date().toLocaleTimeString();
}

export function specReport() {
  const i = device.info;
  return ["OPTIMIZER V.4.0 \u2014 HARDWARE SPEC REPORT",
    "Device            : " + i.model,
    "Android           : " + i.android,
    "Architecture      : " + i.arch,
    "RAM class         : " + i.ram,
    "CPU cores         : " + i.cores,
    "Screen            : " + i.res + "  (" + i.resPhys + ")",
    "Panel refresh     : " + i.refresh,
    "GPU renderer      : " + i.gpu,
    "GPU vendor        : " + i.gpuVendor + (i.webgl2 ? "  [WebGL2]" : "  [WebGL1]"),
    "Max texture       : " + i.maxTex,
    "JS heap limit     : " + i.heapLimit,
    "Network class     : " + i.cs,
    "Touch points      : " + i.touch,
    "User agent        : " + i.ua].join("\n");
}
