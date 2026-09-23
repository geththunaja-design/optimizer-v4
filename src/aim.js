import { el, log, state, set, on, toast, cmd, clamp, escapeHtml, barFill } from "./ui.js";
import { engine, metrics as M } from "./engine.js";
import { autoFit } from "./canvas.js";
import { WEAPONS } from "./config.js";

const S = {
  aim: { x: 0, y: 0 },
  target: { x: 0.5, y: 0.62, dir: 1, speed: 0.00022, phase: 0 },
  hist: [],
  stats: { shots: 0, hits: 0, heads: 0, dmg: 0, reg: 0, ghost: 0, bursts: 0 },
  burst: [],
  lastFire: 0,
  dragVel: 0,
  dragSamples: [],
  recoil: { x: 0, y: 0 },
  flash: 0,
  hitMarks: [],
  dragging: false,
  lastP: { x: 0, y: 0, t: 0 },
  size: { w: 340, h: 340 },
};

const lagMs = () => 38 + Number(state["touch.delay"] || 1) * 4;

function weapon() { return WEAPONS[state["aim.weapon"]] || WEAPONS.AR; }

function targetAt(tMs) {
  const w = S.size.w, h = S.size.h;
  const t = tMs / 1000;
  const x = (0.5 + 0.28 * Math.sin(t * 0.85) + 0.05 * Math.sin(t * 2.4)) * w;
  const y = (0.56 + 0.05 * Math.sin(t * 1.6)) * h;
  const scale = 1 - 0.10 * Math.sin(t * 0.31);
  return { x, y, scale };
}

/* single source of truth: the drawn figure and the hitbox come from this */
function targetShape(pos) {
  const s = pos.scale;
  return {
    headX: pos.x, headY: pos.y - 40 * s, headR: 15 * s,
    bodyX: pos.x - 23 * s, bodyY: pos.y - 22 * s, bodyW: 46 * s, bodyH: 70 * s,
  };
}

function hitTest(px, py, pos) {
  const g = targetShape(pos);
  if (Math.hypot(px - g.headX, py - g.headY) < g.headR) return "head";
  if (px > g.bodyX && px < g.bodyX + g.bodyW && py > g.bodyY && py < g.bodyY + g.bodyH) return "body";
  return null;
}

function fireShot() {
  const w = weapon();
  const cfg = {
    climb: w.climb * (state["aim.recoilFix"] ? 0.28 : 1),
    random: w.recoil * (state["aim.recoilStabilizer"] ? 0.22 : 1),
    spread: w.spread * (state["aim.spreadFix"] ? 0.3 : 1),
  };
  const spreadPx = cfg.spread * (1 + Math.max(0, 1 - state["aim.recoilStabilizer"] * 0.2)) * 1.35;
  const cx = S.size.w / 2 + S.aim.x + S.recoil.x;
  const cy = S.size.h / 2 + S.aim.y - S.recoil.y;
  let px = cx + (Math.random() - 0.5) * spreadPx * 2 + Math.cos(Math.random() * 6.28) * spreadPx * 0.6;
  let py = cy + (Math.random() - 0.5) * spreadPx * 2 + Math.sin(Math.random() * 6.28) * spreadPx * 0.6;

  const nowMs = performance.now();
  const clientPos = targetAt(nowMs - lagMs());
  const serverPos = targetAt(nowMs);

  /* aim stick: magnetise toward the head if inside the snap radius */
  if (state["aim.aimStick"]) {
    const g = targetShape(clientPos);
    const headY = g.headY;
    const d = Math.hypot(px - g.headX, py - headY);
    const snapR = 34 * clientPos.scale + 10;
    if (d < snapR) {
      const k = 1 - d / snapR;
      px += (g.headX - px) * Math.min(1, 0.55 + k);
      py += (headY - py) * Math.min(1, 0.55 + k);
    }
  }

  const clientHit = hitTest(px, py, clientPos);
  const serverHit = hitTest(px, py, serverPos);
  S.stats.shots++;

  const dmgOf = (kind) => (kind === "head" ? w.dmg * w.headMult : kind === "body" ? w.dmg : 0);
  let registered = null, ghost = false;
  if (state["aim.fakeDamage"]) {
    registered = clientHit || serverHit;
  } else {
    registered = serverHit;
    ghost = !!clientHit && !serverHit;
  }

  S.hitMarks.push({ x: px, y: py, kind: registered || (clientHit ? "ghost" : "miss"), t: nowMs });
  if (S.hitMarks.length > 26) S.hitMarks.shift();

  if (registered) {
    S.stats.hits++;
    if (registered === "head") S.stats.heads++;
    S.stats.dmg += dmgOf(registered);
    S.stats.reg += dmgOf(registered);
  } else if (ghost) {
    S.stats.ghost++;
    S.stats.dmg += dmgOf(clientHit);
    if (S.stats.ghost === 1 || S.stats.ghost % 10 === 0) {
      log.warn("AIM", "Ghost hit detected \u2014 shot landed on the target you saw but the engine refused it (" + S.stats.ghost + " unregistered so far). Enable Fake Damage Fix to patch the registration window.");
    }
  }

  if (state["aim.fakeDamage"] && ghost) { /* compensated */ }

  S.recoil.y += cfg.climb * 3.4;
  S.recoil.x += (Math.random() - 0.5) * cfg.random * 4.4;
  S.flash = 1;
  paint();
}

function fireBurst() {
  const w = weapon();
  const n = Math.max(3, Math.round(w.rpm / 120));
  const gap = Math.max(45, Math.min(150, 60000 / w.rpm));
  S.stats.bursts++;
  log.exec("AIM", "Burst fired \u2014 " + state["aim.weapon"] + " \u00B7 " + n + " rounds @ " + w.rpm + " RPM \u00B7 recoil " +
    (state["aim.recoilFix"] ? "COMPENSATED" : "STOCK") + " \u00B7 spread " + (state["aim.spreadFix"] ? "FIXED" : "STOCK") +
    " \u00B7 snap " + (state["aim.aimStick"] ? "ARMED" : "OFF"));
  for (let i = 0; i < n; i++) setTimeout(fireShot, i * gap);
  setTimeout(gradeDrag, n * gap + 90);
}

function gradeDrag() {
  const v = S.dragVel;
  let grade, tip, pct;
  if (!S.dragSamples.length) { grade = "NO DRAG"; tip = "You fired without dragging. On a moving target a small downward drag is needed to hold the head."; pct = 20; }
  else if (v < 0.25) { grade = "TOO SLOW"; tip = "Your drag is slow \u2014 the crosshair lags behind the target. Try a shorter, faster drag."; pct = 42; }
  else if (v < 1.1) { grade = "OPTIMAL"; tip = "Drag speed is in the head-connection window. Hold this and add a light downward pull to fight climb."; pct = 92; }
  else if (v < 2.4) { grade = "FAST"; tip = "Slightly fast \u2014 you are overshooting the head. Reduce sensitivity or shorten the drag."; pct = 68; }
  else { grade = "TOO FAST"; tip = "Extremely fast drag \u2014 overshoot and missed heads. Slow down by ~30%."; pct = 34; }
  const g = el("dragGrade"), t = el("dragTip");
  if (g) g.textContent = grade;
  if (t) t.textContent = tip;
  barFill(el("dragBar") && el("dragBar").firstElementChild, pct);
  log.info("AIM", "Drag graded: " + grade + " (peak " + v.toFixed(2) + " px/ms, " + S.dragSamples.length + " samples).");
}

function paint() {
  const st = S.stats;
  const acc = st.shots ? (st.hits / st.shots) * 100 : 0;
  const hsRate = st.hits ? (st.heads / st.hits) * 100 : 0;
  const broken = st.ghost;
  const grid = el("aimStats");
  if (grid) {
    grid.innerHTML = [
      ["Shots", st.shots, ""],
      ["Hits", st.hits, st.hits > 0 ? "good" : ""],
      ["Headshots", st.heads, ""],
      ["Shot accuracy", acc.toFixed(0) + "%", acc > 60 ? "good" : acc > 35 ? "warn" : "bad"],
      ["Damage dealt", Math.round(st.dmg), ""],
      ["Registered", Math.round(st.reg), ""],
      ["Ghost hits", broken, broken ? "bad" : "good"],
    ].map(([k, v, cls]) => '<div class="stat ' + cls + '"><div class="stat-v">' + v + '</div><div class="stat-k">' + k + "</div></div>").join("");
  }
  const hv = el("hsConnectVal");
  if (hv) hv.textContent = hsRate.toFixed(0) + "%";
  barFill(el("hsBar") && el("hsBar").firstElementChild, hsRate);
  const as = el("aimStat");
  if (as) {
    as.innerHTML = "DMG <b>" + Math.round(st.dmg) + "</b><br>REG <b>" + Math.round(st.reg) + "</b><br>ACC <b>" + acc.toFixed(0) + "%</b>";
  }
}

function drawTarget(ctx, pos, alpha, label) {
  const g = targetShape(pos);
  const s = pos.scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  /* shadow */
  ctx.beginPath();
  ctx.ellipse(pos.x, g.bodyY + g.bodyH + 4 * s, g.bodyW * 0.62, 7 * s, 0, 0, 6.29);
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fill();
  /* body */
  const grd = ctx.createLinearGradient(g.bodyX, g.bodyY, g.bodyX + g.bodyW, g.bodyY + g.bodyH);
  grd.addColorStop(0, "#ff5d73"); grd.addColorStop(1, "#7c5cff");
  ctx.fillStyle = grd;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(g.bodyX, g.bodyY, g.bodyW, g.bodyH, 8 * s);
  else ctx.rect(g.bodyX, g.bodyY, g.bodyW, g.bodyH);
  ctx.fill();
  /* arms */
  ctx.fillStyle = "rgba(255,255,255,.14)";
  ctx.fillRect(g.bodyX - g.bodyW * 0.32, g.bodyY + 4 * s, g.bodyW * 0.3, g.bodyH * 0.62);
  ctx.fillRect(g.bodyX + g.bodyW * 1.02, g.bodyY + 4 * s, g.bodyW * 0.3, g.bodyH * 0.62);
  /* head */
  ctx.beginPath();
  ctx.arc(g.headX, g.headY, g.headR, 0, 6.29);
  ctx.fillStyle = "#ffd166";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,.65)";
  ctx.stroke();
  /* head ring */
  ctx.beginPath();
  ctx.arc(g.headX, g.headY, g.headR + 5 * s, 0, 6.29);
  ctx.strokeStyle = "rgba(255,209,102,.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (label) {
    ctx.font = "9px monospace";
    ctx.fillStyle = "rgba(255,120,140,.85)";
    ctx.fillText(label, g.headX + g.headR + 8, g.headY);
  }
  ctx.restore();
}

function drawFrame() {
  const cv = el("aimCanvas");
  if (!cv || !cv.__state || cv.offsetParent === null) return;
  const { ctx, w, h } = cv.__state;
  const nowMs = performance.now();
  S.size.w = w; S.size.h = h;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#050914"); sky.addColorStop(0.55, "#0a1230"); sky.addColorStop(1, "#050810");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

  /* horizon + perspective floor */
  const hy = h * 0.52;
  ctx.strokeStyle = "rgba(34,211,238,.22)";
  ctx.lineWidth = 1;
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + i * 26, h);
    ctx.lineTo(w / 2 + i * 5, hy);
    ctx.stroke();
  }
  for (let i = 1; i < 9; i++) {
    const y = hy + Math.pow(i / 9, 1.9) * (h - hy);
    ctx.strokeStyle = "rgba(34,211,238," + (0.05 + i * 0.02).toFixed(2) + ")";
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.fillStyle = "rgba(124,92,255,.10)";
  ctx.fillRect(0, hy - 1, w, h - hy);

  /* background dummies */
  drawTarget(ctx, { x: w * 0.2, y: h * 0.47, scale: 0.5 }, 0.4);
  drawTarget(ctx, { x: w * 0.82, y: h * 0.45, scale: 0.42 }, 0.35);

  const client = targetAt(nowMs - lagMs());
  const server = targetAt(nowMs);
  drawTarget(ctx, client, 1);

  if (!state["aim.fakeDamage"]) {
    const sc = targetShape(server), cc = targetShape(client);
    const d = Math.hypot(sc.headX - cc.headX, sc.headY - cc.headY);
    if (d > 3) {
      ctx.beginPath();
      ctx.arc(sc.headX, sc.headY, 4, 0, 6.29);
      ctx.fillStyle = "rgba(255,90,110,.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,90,110,.25)";
      ctx.beginPath(); ctx.moveTo(sc.headX, sc.headY); ctx.lineTo(cc.headX, cc.headY); ctx.stroke();
      ctx.font = "8px monospace";
      ctx.fillStyle = "rgba(255,120,140,.8)";
      ctx.fillText("SRV", sc.headX + 6, sc.headY);
    }
  }

  /* hit marks */
  S.hitMarks.forEach((m) => {
    const age = (nowMs - m.t) / 700;
    if (age > 1) return;
    const a = 1 - age;
    const kind = m.kind;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3 + age * 9, 0, 6.29);
    ctx.strokeStyle = kind === "head" ? "rgba(255,209,102," + a + ")" : kind === "body" ? "rgba(52,211,153," + a + ")" : kind === "ghost" ? "rgba(251,113,133," + a + ")" : "rgba(160,180,220," + a * 0.6 + ")";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (kind === "ghost") {
      ctx.font = "8px monospace";
      ctx.fillStyle = "rgba(251,113,133," + a + ")";
      ctx.fillText("GHOST", m.x + 8, m.y - 6);
    }
  });

  /* crosshair */
  const cx = w / 2 + S.aim.x + S.recoil.x;
  const cy = h / 2 + S.aim.y - S.recoil.y;
  ctx.save();
  ctx.strokeStyle = "rgba(34,211,238,.95)";
  ctx.lineWidth = 1.6;
  const gap = 7, len = 11;
  [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx * gap, cy + dy * gap);
    ctx.lineTo(cx + dx * (gap + len), cy + dy * (gap + len));
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, 6.29);
  ctx.fillStyle = "#22d3ee";
  ctx.fill();
  if (state["aim.aimStick"]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, 6.29);
    ctx.strokeStyle = "rgba(52,211,153,.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (S.flash > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + S.flash * 14, 0, 6.29);
    ctx.fillStyle = "rgba(255,220,140," + (S.flash * 0.5) + ")";
    ctx.fill();
    S.flash *= 0.82;
  }
  ctx.restore();

  /* recoil decay */
  S.recoil.y *= 0.955;
  S.recoil.x *= 0.93;
  S.aim.x = clamp(S.aim.x, -w * 0.42, w * 0.42);
  S.aim.y = clamp(S.aim.y, -h * 0.42, h * 0.42);
}

function drawFirePreview() {
  const cv = el("firePreview");
  if (!cv || !cv.__state) return;
  const { ctx, w, h } = cv.__state;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#070c1a"); bg.addColorStop(1, "#0b1022");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

  /* phone frame */
  const pw = Math.min(w * 0.62, h * 0.72 * 0.56 + 40);
  const ph = Math.min(h * 0.82, pw * 1.78);
  const px = w * 0.5 - pw / 2 + w * 0.16, py = h * 0.5 - ph / 2;
  ctx.strokeStyle = "rgba(140,175,255,.35)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(px, py, pw, ph, 12) : ctx.rect(px, py, pw, ph);
  ctx.stroke();
  ctx.fillStyle = "rgba(120,160,255,.05)";
  ctx.fill();
  /* fire button */
  const size = (Number(state["aim.fireButton"]) / 100) * pw;
  ctx.beginPath();
  ctx.arc(px + pw - size / 2 - 10, py + ph - size / 2 - 14, size / 2, 0, 6.29);
  const g = ctx.createRadialGradient(px + pw - size / 2 - 10, py + ph - size / 2 - 14, 2, px + pw - size / 2 - 10, py + ph - size / 2 - 14, size / 2);
  g.addColorStop(0, "rgba(34,211,238,.45)");
  g.addColorStop(1, "rgba(124,92,255,.18)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = "10px monospace";
  ctx.fillStyle = "#d8f7ff";
  ctx.textAlign = "center";
  ctx.fillText(state["aim.fireButton"] + "%", px + pw - size / 2 - 10, py + ph - size / 2 - 10);
  /* recommended band */
  const rec = pw * 0.42;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(px + pw - rec / 2 - 10, py + ph - rec / 2 - 14, rec / 2, 0, 6.29);
  ctx.strokeStyle = "rgba(52,211,153,.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.font = "9px monospace";
  ctx.fillStyle = "rgba(52,211,153,.8)";
  ctx.fillText("42% RECOMMENDED", 10, h - 10);
  ctx.fillStyle = "rgba(160,190,240,.5)";
  ctx.fillText("HUD DRAG GUIDE", 10, 16);
  ctx.textAlign = "left";
}

function advice(v) {
  const t = el("fireBtnAdvice");
  if (!t) return;
  const msg = v < 34 ? "Small button \u2014 aim travel is short and the thumb can cover the target. Increase toward 40-46% for a stable drag."
    : v > 55 ? "Large button \u2014 your drag window shrinks and finger travel becomes long. Reduce toward 42-46% for faster flicks."
      : "Ideal band. This size keeps the drag window short while giving a stable pivot for recoil control.";
  t.textContent = msg;
}

export function initAim() {
  const cv = el("aimCanvas");
  const cssH = () => (window.innerWidth < 560 ? 320 : 420);
  if (cv) autoFit(cv, cssH, (s) => { cv.__state = s; });
  const fp = el("firePreview");
  if (fp) autoFit(fp, 150, (s) => { fp.__state = s; drawFirePreview(); });
  window.addEventListener("resize", () => setTimeout(() => { if (cv && cv.__refit) cv.__refit(); }, 140));

  const rect = () => cv.getBoundingClientRect();
  cv.addEventListener("pointerdown", (e) => {
    S.dragging = true;
    S.lastP = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    S.dragSamples = [];
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    if (!S.dragging) return;
    const dx = e.clientX - S.lastP.x, dy = e.clientY - S.lastP.y;
    const dt = Math.max(e.timeStamp - S.lastP.t, 1);
    const sens = 1.15;
    S.aim.x += dx * sens;
    S.aim.y += dy * sens;
    const v = Math.hypot(dx, dy) / dt;
    S.dragVel = S.dragSamples.length ? S.dragVel * 0.72 + v * 0.28 : v;
    if (v > 0.02) S.dragSamples.push(v);
    S.lastP = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });
  const end = (e) => {
    if (!S.dragging) return;
    S.dragging = false;
    if (S.dragSamples.length < 3 && Math.abs(S.lastFire - performance.now()) > 400) {
      S.lastFire = performance.now();
      fireBurst();
    } else gradeDrag();
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);

  engine.addRenderer(() => { drawFrame(); });

  const ws = el("weaponSel");
  if (ws) ws.innerHTML = Object.keys(WEAPONS).map((k) => '<option value="' + k + '">' + k + "</option>").join("");
  on("aim.weapon", (v) => {
    const w = WEAPONS[v] || WEAPONS.AR;
    el("aimWeaponTag").textContent = v;
    el("weapStats").textContent = v;
    el("weapDesc").textContent = "Recoil " + w.recoil + " \u00B7 climb " + w.climb + " \u00B7 spread " + w.spread + " \u00B7 " + w.rpm + " RPM \u00B7 " + w.dmg + " dmg \u00B7 " + w.headMult + "x headshot.";
    log.exec("AIM", "Weapon class \u2192 " + v + " (recoil " + w.recoil + " / climb " + w.climb + " / spread " + w.spread + ").");
  });
  on("aim.fireButton", (v) => {
    el("fireBtnVal").textContent = v + "%";
    advice(v);
    drawFirePreview();
    log.exec("AIM", "Recommended fire button size set to " + v + "% of screen width \u2014 HUD guide updated.");
  });

  cmd("aim.fire", () => { S.lastFire = performance.now(); fireBurst(); });
  cmd("aim.newTarget", () => { S.target.phase = Math.random() * 6.28; S.hitMarks.length = 0; log.info("AIM", "New target spawned at a fresh distance."); });
  cmd("aim.reset", () => {
    S.stats = { shots: 0, hits: 0, heads: 0, dmg: 0, reg: 0, ghost: 0, bursts: 0 };
    S.hitMarks.length = 0; S.recoil = { x: 0, y: 0 }; S.aim = { x: 0, y: 0 };
    log.warn("AIM", "Simulator stats reset.");
    paint();
  });
  setTimeout(() => { advice(state["aim.fireButton"]); paint(); }, 400);
}
