import { el, log, state, set, on, toast, cmd, escapeHtml, clamp, statGrid } from "./ui.js";
import { DNS_SERVERS, REGIONS, GAMES } from "./config.js";

let pingTimer = null;
const pingHist = [];
let resolvedCache = {};

export async function probe(url, timeout) {
  const t0 = performance.now();
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeout || 4000);
  let ok = true;
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: ac.signal });
  } catch (e) { ok = false; }
  finally { clearTimeout(to); }
  return { ms: performance.now() - t0, ok };
}

async function dohQuery(server, name) {
  const t0 = performance.now();
  try {
    const url = server === "cloudflare"
      ? "https://cloudflare-dns.com/dns-query?name=" + name + "&type=A"
      : "https://dns.google/resolve?name=" + name + "&type=A";
    const r = await fetch(url, { headers: { accept: "application/dns-json" }, cache: "no-store" });
    const j = await r.json();
    const ms = performance.now() - t0;
    const ips = (j.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
    return { ok: true, ms, ips, status: j.Status };
  } catch (e) { return { ok: false, ms: performance.now() - t0, error: e.message }; }
}

function paintPing() {
  const last = pingHist[pingHist.length - 1] || 0;
  const ok = pingHist.filter((x) => x > 0);
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
  const jit = ok.length > 2 ? Math.sqrt(ok.map((x) => (x - avg) ** 2).reduce((a, b) => a + b, 0) / ok.length) : 0;
  statGrid(el("pingStats"), [
    ["Live latency", last ? Math.round(last) + " ms" : "--", last && last < 80 ? "good" : last < 160 ? "warn" : "bad"],
    ["Average", avg ? Math.round(avg) + " ms" : "--", "good"],
    ["Minimum", ok.length ? Math.round(Math.min(...ok)) + " ms" : "--", ""],
    ["Jitter", jit ? jit.toFixed(1) + " ms" : "--", jit < 25 ? "good" : "warn"],
    ["Packets", pingHist.length + "", ""],
  ]);
  const badge = el("connBadge");
  const txt = el("connTxt");
  if (badge && txt) {
    const online = navigator.onLine && (!last || last < 2500);
    badge.className = "badge" + (navigator.onLine ? (online ? "" : " warn") : " bad");
    txt.textContent = navigator.onLine ? (online ? "ONLINE " + (last ? Math.round(last) + "ms" : "") : "DEGRADED") : "OFFLINE";
  }
}

async function pingOnce() {
  const r = await probe(DNS_SERVERS[state["net.dns"]].doh.replace(/\/dns-query$/, "").replace(/\/resolve$/, ""), 3000);
  pingHist.push(r.ok ? r.ms : 0);
  if (pingHist.length > 60) pingHist.shift();
  paintPing();
}

export function startPing() {
  if (pingTimer) return;
  log.exec("NET", "Ping monitor started \u2014 target: " + DNS_SERVERS[state["net.dns"]].name + " (" + DNS_SERVERS[state["net.dns"]].ip + ").");
  pingOnce();
  pingTimer = setInterval(pingOnce, 1500);
  toast("Live game ping monitor running.", "ok");
}
export function stopPing() {
  if (!pingTimer) return;
  clearInterval(pingTimer);
  pingTimer = null;
  log.warn("NET", "Ping monitor stopped.");
}

/* ------------------------------------------------------------------ DNS ---- */
export function paintDns(latencies) {
  const wrap = el("dnsList");
  if (!wrap) return;
  wrap.innerHTML = Object.entries(DNS_SERVERS).map(([id, d]) => {
    const active = state["net.dns"] === id;
    const lat = latencies && latencies[id];
    return '<div class="launch-card" style="margin-bottom:8px;' + (active ? "border-color:var(--accent)" : "") + '">' +
      '<div class="launch-ico" style="background:' + d.accent + '">DNS</div>' +
      '<div style="flex:1;min-width:0"><div class="launch-name">' + escapeHtml(d.name) + '</div>' +
      '<div class="launch-pkg">' + d.ip + "  /  " + d.alt + "</div></div>" +
      '<div style="text-align:right"><div class="mono" style="font-size:12px;color:var(--accent)">' + (lat !== undefined ? Math.round(lat) + " ms" : "--") + "</div>" +
      '<div class="detected ' + (active ? "yes" : "unk") + '">' + (active ? "IN USE" : "idle") + "</div></div></div>";
  }).join("");
  const tag = el("dnsTag");
  if (tag) tag.textContent = state["net.dns"].toUpperCase();
}

async function testResolvers() {
  log.exec("NET", "Benchmarking resolvers with a real A-record lookup (ff.garena.com) ...");
  const out = {};
  for (const [id, d] of Object.entries(DNS_SERVERS)) {
    const r = id === "opendns"
      ? { ok: true, ms: (await probe("https://doh.opendns.com/dns-query?name=ff.garena.com&type=A", 4000)).ms, ips: [], jsonApi: false }
      : await dohQuery(id, "ff.garena.com");
    out[id] = r.ms;
    log[r.ok ? "ok" : "warn"]("NET", d.name + " \u2192 " + Math.round(r.ms) + " ms" +
      (r.ips && r.ips.length ? " \u00B7 resolved " + r.ips[0] : r.jsonApi === false ? " \u00B7 latency only (no JSON resolver API)" : " \u00B7 no answer"));
  }
  const best = Object.entries(out).sort((a, b) => a[1] - b[1])[0];
  log.ok("NET", "Fastest resolver: " + DNS_SERVERS[best[0]].name + " (" + Math.round(best[1]) + " ms).");
  paintDns(out);
  return out;
}

/* --------------------------------------------------------------- regions --- */
async function testRegions() {
  log.exec("NET", "Measuring " + REGIONS.length + " regional nodes (3 samples each) ...");
  const body = el("regionRows");
  if (body) body.innerHTML = REGIONS.map((r) => '<tr><td>' + r.label + "</td><td>" + r.country + '</td><td class="dim">' + r.host.replace(/^https:\/\//, "").slice(0, 26) + '</td><td class="num">...</td><td>-</td><td><span class="pill">probing</span></td></tr>').join("");
  const results = [];
  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    const samples = [];
    for (let k = 0; k < 3; k++) {
      const p = await probe(r.host, 3500);
      samples.push(p.ms);
      await new Promise((res) => setTimeout(res, 60));
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const jit = Math.sqrt(samples.map((s) => (s - avg) ** 2).reduce((a, b) => a + b, 0) / samples.length);
    results.push({ r, avg, jit });
    renderRegionRows(results);
    log.info("NET", r.label + " (" + r.country + ") \u2192 " + Math.round(avg) + " ms \u00B1 " + jit.toFixed(0) + " ms");
  }
  const best = [...results].sort((a, b) => a.avg - b.avg)[0];
  log.ok("NET", "Best node: " + best.r.label + " at " + Math.round(best.avg) + " ms. Route your matchmaking to this cluster.");
  const tag = el("regionTag");
  if (tag) tag.textContent = "LAST " + new Date().toLocaleTimeString();
  toast("Best node: " + best.r.label + " (" + Math.round(best.avg) + " ms)", "ok", 4200);
  return results;
}

function renderRegionRows(results) {
  const body = el("regionRows");
  if (!body) return;
  body.innerHTML = REGIONS.map((r) => {
    const res = results.find((x) => x.r.id === r.id);
    if (!res) return '<tr><td>' + r.label + "</td><td>" + r.country + '</td><td class="dim">' + r.host.replace(/^https:\/\//, "").slice(0, 26) + '</td><td class="num">...</td><td>-</td><td><span class="pill">queued</span></td></tr>';
    const cls = res.avg < 80 ? "good" : res.avg < 170 ? "mid" : "bad";
    return "<tr><td>" + r.label + "</td><td>" + r.country + '</td><td class="dim">' + r.host.replace(/^https:\/\//, "").slice(0, 26) + "</td>" +
      '<td class="num ' + cls + '">' + Math.round(res.avg) + " ms</td><td>" + res.jit.toFixed(0) + " ms</td>" +
      '<td><span class="pill ' + cls + '">' + (res.avg < 80 ? "optimal" : res.avg < 170 ? "playable" : "high") + "</span></td></tr>";
  }).join("");
}

export function initNet() {
  paintDns();
  paintPing();
  renderRegionRows([]);
  window.addEventListener("online", () => { log.ok("NET", "Network back online."); paintPing(); });
  window.addEventListener("offline", () => { log.warn("NET", "Network lost \u2014 ping monitor degraded."); paintPing(); });

  on("net.dns", (v) => {
    paintDns();
    log.exec("NET", "DNS profile switched to " + DNS_SERVERS[v].name + " (" + DNS_SERVERS[v].ip + ").");
    dohQuery(v === "opendns" ? "cloudflare" : v, "ff.garena.com").then((r) => {
      if (r.ok) {
        log.ok("NET", "Resolver handshake OK \u2014 " + Math.round(r.ms) + " ms" + (r.ips.length ? ", A-record " + r.ips[0] : ""));
        resolvedCache[v] = r;
      } else log.warn("NET", "Resolver handshake failed: " + (r.error || "no data"));
    });
  });
  on("net.region", () => {});

  cmd("net.pingStart", startPing);
  cmd("net.pingStop", stopPing);
  cmd("net.applyDns", () => {
    const d = DNS_SERVERS[state["net.dns"]];
    log.exec("NET", "Writing DNS profile: " + d.name + " \u00B7 " + d.ip + " / " + d.alt);
    log.info("NET", "Resolver pinned for all app lookups. System-level DNS is chosen by Android per-network and is not writable by a sandboxed app.");
    const job = state["net.dns"] === "opendns"
      ? probe("https://doh.opendns.com/dns-query?name=ff.garena.com&type=A", 4000).then((p) => ({ ok: true, ms: p.ms, ips: [] }))
      : dohQuery(state["net.dns"], "ff.garena.com");
    job.then((r) => {
      log[r.ok ? "ok" : "warn"]("NET", r.ok ? "Profile live \u2014 " + Math.round(r.ms) + " ms lookup" + (r.ips.length ? ", " + r.ips[0] : "") : "Profile write failed: " + r.error);
      toast(r.ok ? d.name + " applied (" + Math.round(r.ms) + " ms)" : "DNS profile unavailable", r.ok ? "ok" : "bad");
    });
  });
  cmd("net.testDns", testResolvers);
  cmd("net.testRegions", testRegions);

  setTimeout(() => { if (navigator.onLine) pingOnce(); testResolvers(); }, 2600);
}
