import { DEFAULTS, LABELS, LOG_STYLE } from "./config.js";

export const el = (id) => document.getElementById(id);
export const q = (sel, root) => (root || document).querySelector(sel);
export const qa = (sel, root) => [...(root || document).querySelectorAll(sel)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------------------------------------------------------- state ---- */
export const state = { ...DEFAULTS };
const listeners = new Map();
const booted = new Set();

export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  if (booted.has(key)) fn(state[key], key);
  return () => listeners.get(key).delete(fn);
}

export function get(key) { return state[key]; }

export function set(key, value, opts) {
  const o = opts || {};
  const prev = state[key];
  state[key] = value;
  if (!o.silent && !booted.has(key)) booted.add(key);
  const ls = listeners.get(key);
  if (ls) ls.forEach((fn) => { try { fn(value, key); } catch (e) { log.err("STATE", key + " handler: " + e.message); } });
  if (window.__onSet) { try { window.__onSet(key, value); } catch (e) { } }
  if (!o.quiet && prev !== value) logToggle(key, value);
  return value;
}

export function applyPreset(name, opts) {
  const P = window.__PRESETS && window.__PRESETS[name];
  if (!P) return;
  log.exec("PROFILE", "Applying preset \"" + P.label + "\" ...");
  Object.entries(P.apply).forEach(([k, v], i) => setTimeout(() => set(k, v), i * 22));
  setTimeout(() => set("hw.preset", name, { quiet: true }), 0);
  renderPresetCards();
  log.ok("PROFILE", "Preset \"" + P.label + "\" fully applied to engine \u2014 " + Object.keys(P.apply).length + " parameters written.");
}

export function resetAll() {
  log.warn("SYSTEM", "Restore-all-defaults requested \u2014 reverting every parameter to factory state.");
  booted.clear();
  Object.entries(DEFAULTS).forEach(([k, v]) => set(k, v, { quiet: true }));
  booted.add("*");
  Object.keys(DEFAULTS).forEach((k) => {
    if (["ui.theme", "ui.hud", "ui.graph"].includes(k)) return;
    const ls = listeners.get(k);
    if (ls) ls.forEach((fn) => { try { fn(state[k], k); } catch (e) {} });
  });
  Object.keys(DEFAULTS).forEach((k) => { if (!booted.has(k)) booted.add(k); });
  state["hw.preset"] = DEFAULTS["hw.preset"];
  syncControls();
  renderPresetCards();
  log.ok("SYSTEM", "Factory profile restored \u2014 all switches OFF, 60 FPS cap, balanced governor, stock aim/touch/GFX.");
}

/* ------------------------------------------------------------------ log ---- */
const entries = [];
const logTargets = new Set();

export const log = {
  push(level, mod, msg) {
    const L = LOG_STYLE[level] || LOG_STYLE.info;
    const d = new Date();
    const t = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" +
      String(d.getSeconds()).padStart(2, "0") + "." + String(d.getMilliseconds()).padStart(3, "0");
    const e = { level, mod, msg, t };
    entries.push(e);
    if (entries.length > 800) entries.shift();
    logTargets.forEach((tb) => {
      if (tb.filter !== "all" && tb.filter !== "SYSTEM" && tb.filter !== mod && tb.filter !== level) return;
      appendLine(tb.node, e);
    });
    dockCount();
  },
  info(m, s) { this.push("info", m, s); },
  ok(m, s) { this.push("ok", m, s); },
  exec(m, s) { this.push("exec", m, s); },
  warn(m, s) { this.push("warn", m, s); },
  err(m, s) { this.push("err", m, s); },
  clear() { entries.length = 0; logTargets.forEach((t) => { t.node.innerHTML = ""; }); dockCount(); },
  lines() { return entries.slice(); },
};

function lineNode(e) {
  const L = LOG_STYLE[e.level] || LOG_STYLE.info;
  const d = document.createElement("div");
  d.className = "log-line " + L.cls;
  d.innerHTML = '<span class="log-t">' + e.t + "</span> <span class=\"log-tag\">" + L.tag + "</span> <span class=\"log-mod\">[" + e.mod + "]</span> " + escapeHtml(e.msg);
  return d;
}
function appendLine(node, e) {
  node.appendChild(lineNode(e));
  while (node.childElementCount > 320) node.removeChild(node.firstChild);
  node.scrollTop = node.scrollHeight;
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function logToggle(key, value) {
  const L = LABELS[key];
  const mod = L ? L.mod : "SYSTEM";
  if (L) {
    const on = value === true || (typeof value === "number" && key === "hw.memAggression") || value === "on";
    const txt = typeof value === "boolean" ? (value ? L.on : L.off) : String(value);
    log[value === false ? "warn" : key.startsWith("hw.") || key.startsWith("net.") || key.startsWith("gfx.") ? "exec" : "ok"](mod, L.label + " \u2192 " + txt + (on && typeof value === "boolean" ? " \u2014 applying to engine now." : ""));
  } else {
    log.exec(mod, key + " = " + value);
  }
}

export function mountLogs(root) {
  qa(".logbox", root || document).forEach((node) => {
    if (node.__bound || node.classList.contains("no-log")) return;
    node.__bound = true;
    const tb = { node, filter: node.dataset.log || "all" };
    logTargets.add(tb);
    node.__tb = tb;
    entries.forEach((e) => { if (tb.filter === "all" || tb.filter === e.mod || tb.filter === e.level) appendLine(node, e); });
  });
}

/* ---------------------------------------------------------------- toast ---- */
export function toast(msg, type, ms) {
  const wrap = el("toastWrap");
  if (!wrap) return;
  const d = document.createElement("div");
  d.className = "toast " + (type || "");
  d.innerHTML = '<span>' + (type === "bad" ? "\u26A0\uFE0F" : type === "ok" ? "\u2705" : type === "warn" ? "\u2139\uFE0F" : "\u2699\uFE0F") + "</span><span>" + escapeHtml(msg) + "</span>";
  wrap.appendChild(d);
  setTimeout(() => { d.style.transition = "opacity .3s, transform .3s"; d.style.opacity = "0"; d.style.transform = "translateY(8px)"; }, (ms || 2600) - 300);
  setTimeout(() => d.remove(), ms || 2600);
}

/* ---------------------------------------------------------------- modal ---- */
export function popup(title, bodyHtml, opts) {
  const o = opts || {};
  const wrap = el("modalWrap");
  wrap.innerHTML =
    '<div class="modal"><div class="modal-hd">' + escapeHtml(title) + "</div>" +
    '<div class="modal-bd">' + bodyHtml + "</div>" +
    '<div class="modal-ft">' + o.footer + "</div>" +
    (o.duration ? '<div class="modal-bar"><i style="transition:width ' + o.duration + "ms linear\"></i></div>" : "") +
    "</div>";
  wrap.classList.remove("hidden");
  if (o.duration) {
    const bar = q(".modal-bar > i", wrap);
    requestAnimationFrame(() => { bar.style.width = "0%"; });
    o._timer = setTimeout(() => closePopup(), o.duration);
  }
  qa("[data-close]", wrap).forEach((b) => b.addEventListener("click", () => closePopup()));
  if (o.onClose) wrap.__onClose = o.onClose;
  return wrap;
}
export function closePopup() {
  const wrap = el("modalWrap");
  if (!wrap) return;
  if (wrap.__timer) clearTimeout(wrap.__timer);
  wrap.classList.add("hidden");
  wrap.innerHTML = "";
  if (wrap.__onClose) { const f = wrap.__onClose; wrap.__onClose = null; f(); }
}

/* ------------------------------------------------------------- rendering --- */
export function gauge(node, pct, label, valueText, hue) {
  if (!node) return;
  if (!node.__built) {
    node.innerHTML = '<svg viewBox="0 0 120 120" width="100%" height="100%">' +
      '<circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="10"/>' +
      '<circle class="g-arc" cx="60" cy="60" r="52" fill="none" stroke="url(#gg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="327" stroke-dashoffset="327"/>' +
      '<defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs></svg>' +
      '<div class="gauge-txt"><div><div class="gauge-v"></div><div class="gauge-k"></div></div></div>';
    node.__built = true;
  }
  const arc = q(".g-arc", node);
  const p = clamp(pct, 0, 100);
  arc.setAttribute("stroke-dashoffset", String(327 - (327 * p) / 100));
  if (hue) arc.setAttribute("stroke", hue);
  q(".gauge-v", node).textContent = valueText !== undefined ? valueText : Math.round(p) + "%";
  q(".gauge-k", node).textContent = label || "";
}

export function barFill(node, pct) { if (node) node.style.width = clamp(pct, 0, 100) + "%"; }

/* cheap repeatedly-updated grids: build the nodes once, then only touch values */
export function statGrid(node, rows) {
  if (!node) return;
  if (!node.__cells || node.__cells.length !== rows.length) {
    node.innerHTML = rows.map(() => '<div class="stat"><div class="stat-v"></div><div class="stat-k"></div></div>').join("");
    node.__cells = [...node.children].map((c) => ({ c, v: q(".stat-v", c), k: q(".stat-k", c) }));
  }
  rows.forEach((r, i) => {
    const cell = node.__cells[i];
    const val = String(r[1]);
    if (cell.v.textContent !== val) cell.v.textContent = val;
    if (cell.k.textContent !== r[0]) cell.k.textContent = r[0];
    const cls = "stat " + (r[2] || "");
    if (cell.c.className !== cls) cell.c.className = cls;
  });
}

export function kvGrid(node, rows) {
  if (!node) return;
  if (!node.__cells || node.__cells.length !== rows.length) {
    node.innerHTML = rows.map(() => '<div class="kv"><div class="kv-txt"><div class="kv-k"></div><div class="kv-v"></div></div></div>').join("");
    node.__cells = [...node.children].map((c) => ({ c, v: q(".kv-v", c), k: q(".kv-k", c) }));
  }
  rows.forEach((r, i) => {
    const cell = node.__cells[i];
    const val = String(r[1]);
    if (cell.v.textContent !== val) cell.v.textContent = val;
    if (cell.k.textContent !== r[0]) cell.k.textContent = r[0];
    const cls = "kv-v" + (r[2] ? " accent" : "");
    if (cell.v.className !== cls) cell.v.className = cls;
  });
}

export function setText(id, txt) {
  const n = el(id);
  if (n && n.textContent !== String(txt)) n.textContent = String(txt);
}

/* ------------------------------------------------------------------ tabs --- */
export function initTabs() {
  const strip = el("tabStrip");
  const tabs = qa(".tab", strip);
  tabs.forEach((t) => {
    t.addEventListener("click", () => activateTab(t.dataset.view));
  });
  activateTab(tabs[0].dataset.view);
}
export function activateTab(id) {
  qa(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === id));
  qa(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + id));
  const t = qa(".tab").find((x) => x.dataset.view === id);
  if (t && t.scrollIntoView) t.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  window.scrollTo({ top: 0, behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
  sessionStorage.setItem("opt.tab", id);
  document.dispatchEvent(new CustomEvent("tab", { detail: id }));
}

/* ----------------------------------------------------------------- theme --- */
export function applyTheme(name) {
  document.documentElement.setAttribute("data-theme", name);
  state["ui.theme"] = name;
  const b = el("themeBtn");
  if (b) b.textContent = name === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
  try { localStorage.setItem("opt.theme", name); } catch (e) {}
}

/* ------------------------------------------------- generic control wiring -- */
export const commands = {};
export function cmd(name, fn) { commands[name] = fn; }

export function syncControls() {
  qa("[data-key]").forEach((node) => {
    const k = node.dataset.key;
    const v = state[k];
    if (node.classList.contains("sw")) {
      node.setAttribute("aria-pressed", v === true ? "true" : "false");
      const chip = node.parentElement && q(".state-chip", node.parentElement);
      if (chip) { chip.textContent = v ? "ENABLED" : "DISABLED"; chip.classList.toggle("on", !!v); }
    } else if (node.type === "range") {
      node.value = v;
      paintRange(node);
      const out = document.querySelector('[data-out="' + k + '"]');
      if (out) out.textContent = node.dataset.suffix ? v + node.dataset.suffix : v;
    } else if (node.tagName === "SELECT") {
      node.value = v;
    } else if (node.type === "radio" || node.classList.contains("preset")) {
      node.classList.toggle("active", node.dataset.value === v);
    }
  });
}

export function paintRange(node) {
  const min = Number(node.min || 0), max = Number(node.max || 100);
  const pct = ((Number(node.value) - min) / (max - min)) * 100;
  node.style.setProperty("--fill", pct + "%");
}

export function bindControls(root) {
  const scope = root || document;
  qa("[data-key]", scope).forEach((node) => {
    if (node.__b) return;
    node.__b = true;
    const k = node.dataset.key;
    if (node.classList.contains("sw")) {
      node.addEventListener("click", () => {
        const nv = !state[k];
        node.setAttribute("aria-pressed", nv ? "true" : "false");
        const chip = node.parentElement && q(".state-chip", node.parentElement);
        if (chip) { chip.textContent = nv ? "ENABLED" : "DISABLED"; chip.classList.toggle("on", nv); }
        set(k, nv);
      });
    } else if (node.type === "range") {
      node.addEventListener("input", () => { paintRange(node); const out = document.querySelector('[data-out="' + k + '"]'); if (out) out.textContent = node.dataset.suffix ? node.value + node.dataset.suffix : node.value; state[k] = Number(node.value); });
      node.addEventListener("change", () => set(k, Number(node.value)));
    } else if (node.tagName === "SELECT") {
      node.addEventListener("change", () => set(k, node.value));
    } else if (node.classList.contains("preset")) {
      node.addEventListener("click", () => applyPreset(node.dataset.value));
    }
    syncControls();
  });
  qa("[data-cmd]", scope).forEach((node) => {
    if (node.__b) return;
    node.__b = true;
    node.addEventListener("click", () => {
      const fn = commands[node.dataset.cmd];
      if (fn) { try { fn(node); } catch (e) { log.err("SYSTEM", "Command " + node.dataset.cmd + " failed: " + e.message); toast("Command failed: " + e.message, "bad", 4200); } }
      else log.warn("SYSTEM", "No handler registered for command " + node.dataset.cmd);
    });
  });
  mountLogs(scope);
}

function renderPresetCards() {
  const wrap = el("presetGrid");
  if (!wrap || !window.__PRESETS) return;
  wrap.innerHTML = Object.entries(window.__PRESETS).map(([id, p]) =>
    '<button class="preset ' + (state["hw.preset"] === id ? "active" : "") + '" data-value="' + id + '" data-key="hw.preset">' +
    '<span class="preset-tag">' + p.tag + "</span>" +
    '<div class="preset-ico">' + p.icon + '</div><div class="preset-l">' + escapeHtml(p.label) + "</div>" +
    '<div class="preset-d">' + escapeHtml(p.desc) + "</div></button>").join("");
  bindControls(wrap);
}
export { renderPresetCards };

/* ------------------------------------------------------------------ dock --- */
export function initDock() {
  const dock = el("consoleDock");
  if (!dock) return;
  q(".dock-hd", dock).addEventListener("click", () => dock.classList.toggle("open"));
  el("dockClear").addEventListener("click", (e) => { e.stopPropagation(); log.clear(); });
  qa(".fchip", dock).forEach((c) => c.addEventListener("click", (e) => {
    e.stopPropagation();
    qa(".fchip", dock).forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    const f = c.dataset.filter;
    const box = q(".logbox", dock);
    const tb = box.__tb;
    if (tb) tb.filter = f;
    box.innerHTML = "";
    log.lines().forEach((en) => { if (f === "all" || f === en.mod || f === en.level) appendLine(box, en); });
  }));
  dockCount();
}
function dockCount() {
  const c = el("dockCount");
  if (c) c.textContent = entries.length + " events";
}

export function fmtMb(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }
export function now() { return performance.now(); }
