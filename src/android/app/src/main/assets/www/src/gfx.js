import { el, log, state, set, on, toast, cmd, escapeHtml } from "./ui.js";
import { engine, metrics as M } from "./engine.js";
import { GFX_QUALITY, COLOR_STYLE } from "./config.js";

let noGl = false;
let statAcc = 0;

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SCENE_FS = (def) => `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes; uniform float uTime; uniform vec3 uCam; uniform vec3 uTarget;
uniform float uEmber;
#define OCT ${def.oct}
#define ORBS ${def.orbs}
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash31(vec3 p){ vec3 p3 = fract(p * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<OCT;i++){ s += a*vnoise(p); p*=2.03; a*=0.5; } return s; }
float orb(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c; float b = dot(oc, rd); float h = b*b - dot(oc,oc) + r*r;
  if(h < 0.0) return -1.0;
  return -b - sqrt(h);
}
void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uRes.x / max(uRes.y, 1.0);
  vec3 fwd = normalize(uTarget - uCam);
  vec3 rgt = normalize(cross(vec3(0.0,1.0,0.0), fwd));
  vec3 up  = cross(fwd, rgt);
  vec3 rd = normalize(uv.x*rgt + uv.y*up + 1.75*fwd);
  float t = uTime;
  vec3 col = vec3(0.0);

  /* ---- sky dome ---- */
  float sy = clamp(rd.y*0.5+0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.015,0.028,0.095), vec3(0.10,0.07,0.30), pow(sy,1.45));
  sky += vec3(0.95,0.28,0.55) * pow(max(1.0 - abs(rd.y - 0.055)*5.5, 0.0), 7.0) * 0.75;
  sky += vec3(0.25,0.45,1.0) * pow(max(1.0 - abs(rd.y - 0.02)*2.2, 0.0), 3.0) * 0.22;
  vec2 sp = rd.xz * 2.2;
  float upMask = smoothstep(-0.02, 0.40, rd.y);
  sky += vec3(0.28,0.50,1.0) * fbm(sp*0.85 + vec2(t*0.030, t*0.016)) * 0.32 * upMask;
  sky += vec3(0.70,0.22,1.0) * pow(fbm(sp*2.10 - vec2(t*0.045, 0.0)), 3.0) * 0.50 * upMask;
  if(rd.y > 0.02){
    vec2 cell = floor(vUv * uRes / 3.2);
    float r = hash21(cell);
    float tw = 0.55 + 0.45*sin(t*2.1 + r*90.0);
    vec2 lp = fract(vUv * uRes / 3.2) - 0.5;
    vec2 jit = (vec2(hash21(cell + 7.1), hash21(cell + 3.3)) - 0.5) * 0.74;
    float d = length(lp - jit);
    sky += step(0.9972, r) * smoothstep(0.20, 0.0, d) * 1.7 * tw * smoothstep(0.02, 0.30, rd.y);
  }
  col = sky;

  /* ---- neon floor grid ---- */
  if(rd.y < -0.001){
    float ft = (-1.0 - uCam.y) / rd.y;
    if(ft > 0.0 && ft < 60.0){
      vec3 p = uCam + rd*ft;
      vec2 wdt = clamp(fwidth(p.xz*0.5), vec2(0.0025), vec2(0.35));
      vec2 g = abs(fract(p.xz*0.5) - 0.5) / wdt;
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      line *= smoothstep(38.0, 4.0, ft);
      float pulse = 0.60 + 0.40*sin(p.z*0.32 - t*2.0);
      vec3 grid = mix(vec3(0.03,0.09,0.22), vec3(0.22,0.80,1.0), line) * (0.55 + 0.75*pulse*line);
      grid += vec3(0.60,0.25,1.0) * line * smoothstep(-2.0, -34.0, p.z) * 0.85;
      float fade = clamp(ft/20.0, 0.0, 1.0);
      fade *= fade;
      col = mix(grid, col, fade);
    }
  }

  /* ---- glowing energy cores ---- */
  for(int i=0;i<ORBS;i++){
    float fi = float(i);
    float a = t*(0.32 + fi*0.14) + fi*2.1;
    float rad = 2.1 + fi*0.75;
    vec3 c = vec3(sin(a)*rad, 0.35 + 0.5*sin(t*0.6 + fi*1.7) + fi*0.28, -4.2 + cos(a)*rad*0.7);
    vec3 tone = fi < 0.5 ? vec3(0.15,0.95,1.0) : (fi < 1.5 ? vec3(1.0,0.35,0.65) : vec3(0.65,0.45,1.0));
    vec3 oc = c - uCam;
    float tca = dot(oc, rd);
    float d2 = max(dot(oc, oc) - tca*tca, 0.0);
    col += tone * 0.16 / (1.0 + d2*2.6);
    float d = orb(uCam, rd, c, 0.42 + fi*0.07);
    if(d > 0.0){
      vec3 n = normalize(uCam + rd*d - c);
      float fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.6);
      float grid = 0.5 + 0.5*sin((n.x + n.y)*34.0 + t*2.6);
      col = tone * (0.35 + 1.7*fres + 0.25*grid) + vec3(1.0) * pow(fres, 9.0) * 1.5;
    }
  }
  outColor = vec4(col, 1.0);
}`;

const COMP_FS = (def) => `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uScene; uniform vec2 uTexel; uniform vec2 uRes;
uniform float uBloom; uniform float uRadius; uniform float uSat; uniform float uCon;
uniform float uTemp; uniform float uGamma; uniform float uVignette; uniform float uScan;
#define TAPS ${def.taps}
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = texture(uScene, vUv).rgb;
  vec3 b = vec3(0.0);
  for(int i=0;i<TAPS;i++){
    float a = 6.2831853*float(i)/float(TAPS);
    vec2 d = vec2(cos(a), sin(a));
    b += texture(uScene, vUv + d*uTexel*uRadius*1.0).rgb * 0.75;
    b += texture(uScene, vUv + d*uTexel*uRadius*2.7).rgb * 0.5;
  }
  b /= float(TAPS);
  vec3 bright = max(b - 0.42, 0.0) * 2.1;
  c += bright * uBloom;
  float luma = dot(c, vec3(0.299,0.587,0.114));
  c = mix(vec3(luma), c, uSat);
  c = (c - 0.5) * uCon + 0.5;
  c += uTemp * vec3(0.11, 0.01, -0.09);
  c = pow(max(c, 0.0), vec3(1.0/uGamma));
  float vig = 1.0 - uVignette * pow(clamp(length(vUv - 0.5)*1.42, 0.0, 1.0), 2.0);
  c *= vig;
  c *= 1.0 - uScan * (0.5 + 0.5*sin(vUv.y*uRes.y*3.14159));
  c += (hash21(vUv*uRes + fract(0.0)) - 0.5) / 255.0;
  outColor = vec4(clamp(c, 0.0, 1.6), 1.0);
}`;

const EMBER_VS = `#version 300 es
in float aSeed; uniform float uTime; uniform vec2 uRes; uniform float uCount;
out float vHeat;
void main(){
  float s = aSeed;
  if(s > uCount){ gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; vHeat = 0.0; return; }
  float h1 = fract(sin(s*127.1)*43758.5453);
  float h2 = fract(sin(s*311.7)*43758.5453);
  float h3 = fract(sin(s*74.7)*43758.5453);
  float fy = fract(h1 + uTime*0.05*(0.35 + h2));
  float fx = fract(h2 + sin(uTime*0.17 + h3*20.0)*0.045);
  float depth = 0.35 + h3*0.85;
  float scale = 1.0/(depth);
  vec2 p = vec2((fx-0.5)*2.4*scale, (fy-0.45)*1.7*scale - 0.15);
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = (2.4 + h3*3.8) * (uRes.y/700.0);
  vHeat = fract(h1*7.0 + uTime*0.28);
}`;

const EMBER_FS = `#version 300 es
precision highp float; in float vHeat; out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if(r > 0.5) discard;
  float a = pow(1.0 - r*2.0, 2.2);
  outColor = vec4(mix(vec3(1.0,0.45,0.15), vec3(1.0,0.85,0.4), vHeat) * a, a);
}`;

let gl = null, sceneProg = null, compProg = null, emberProg = null, fbo = null, tex = null;
let canvas, wrapEl;
let camAngle = 0.6, camPitch = 0.34, dragging = false, lastX = 0, lastY = 0, spin = true;
let renderScale = 0.85;
let timerExt = null, query = null, gpuMs = 0;
let compileMs = 0, drawCalls = 0, lastFrame = 0;
let emberBuf = null, emberCount = 400, uniforms = {};

function makeProgram(vsSrc, fsSrc, label) {
  const t0 = performance.now();
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) { log.err("GFX", label + " vertex compile failed: " + gl.getShaderInfoLog(vs)); return null; }
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { log.err("GFX", label + " fragment compile failed: " + gl.getShaderInfoLog(fs)); return null; }
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { log.err("GFX", label + " link failed: " + gl.getProgramInfoLog(p)); return null; }
  compileMs += performance.now() - t0;
  return p;
}

function defs() {
  const q = GFX_QUALITY[state["gfx.quality"]] || GFX_QUALITY.balanced;
  return { oct: q.qualityOct || (state["gfx.quality"] === "smooth" ? 2 : state["gfx.quality"] === "ultra" ? 4 : 3), orbs: state["gfx.quality"] === "smooth" ? 2 : 3, taps: q.fxaa ? 10 : 6, scale: q.scale, bloom: q.bloom, particles: q.particles };
}

export function compileProfile(reason) {
  if (!gl) return;
  const d = defs();
  compileMs = 0;
  sceneProg = makeProgram(VS, SCENE_FS(d), "scene") || sceneProg;
  compProg = makeProgram(VS, COMP_FS(d), "composite") || compProg;
  emberProg = emberProg || makeProgram(EMBER_VS, EMBER_FS, "embers");
  renderScale = d.scale;
  if (!sceneProg || !compProg) { log.warn("GFX", "Shader profile incomplete \u2014 keeping previous programs."); return; }
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const a = gl.getAttribLocation(sceneProg, "aPos");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  log.ok("GFX", "Shader profile compiled in " + compileMs.toFixed(1) + " ms \u2014 " + (reason || "profile") +
    " \u00B7 quality=" + state["gfx.quality"] + " \u00B7 render scale " + Math.round(renderScale * 100) + "% \u00B7 bloom taps " + d.taps + " \u00B7 orbs " + d.orbs + " \u00B7 fbm octaves " + d.oct + ".");
}

let buf = null;

function usePos(prog) {
  if (prog.__aPos === undefined) prog.__aPos = gl.getAttribLocation(prog, "aPos");
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(prog.__aPos);
  gl.vertexAttribPointer(prog.__aPos, 2, gl.FLOAT, false, 0, 0);
}

function makeFbo(w, h) {
  if (tex) gl.deleteTexture(tex);
  if (fbo) gl.deleteFramebuffer(fbo);
  tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resize() {
  const cssW = canvas.clientWidth || 320;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(120, Math.round(cssW * dpr * renderScale));
  const h = Math.max(90, Math.round((cssW * 0.62) * dpr * renderScale));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  canvas.style.height = Math.round(cssW * 0.62) + "px";
  makeFbo(canvas.width, canvas.height);
}

export function drawGfx(t, dt) {
  if (!gl || !canvas || canvas.offsetParent === null) return;
  resize();
  const d = defs();
  const st = state;
  const col = COLOR_STYLE[st["gfx.color"]] || COLOR_STYLE.vivid;

  if (timerExt && !query) query = gl.createQuery();

  const u = (p, n) => gl.getUniformLocation(p, n);
  /* start from a clean surface: a stale drawing buffer otherwise leaves ghost trails */
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.useProgram(sceneProg);
  usePos(sceneProg);
  gl.uniform2f(u(sceneProg, "uRes"), canvas.width, canvas.height);
  gl.uniform1f(u(sceneProg, "uTime"), t / 1000);
  const ca = Math.cos(camAngle), sa = Math.sin(camAngle);
  const radius = 9.2, py = 2.35 + Math.sin(camPitch) * 4.2;
  gl.uniform3f(u(sceneProg, "uCam"), ca * radius, py, sa * radius);
  gl.uniform3f(u(sceneProg, "uTarget"), 0, 0.35, -3.2);
  gl.uniform1f(u(sceneProg, "uEmber"), d.particles);
  if (timerExt) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (timerExt) gl.endQuery(timerExt.TIME_ELAPSED_EXT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(compProg);
  usePos(compProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(u(compProg, "uScene"), 0);
  gl.uniform2f(u(compProg, "uTexel"), 1 / canvas.width, 1 / canvas.height);
  gl.uniform2f(u(compProg, "uRes"), canvas.width, canvas.height);
  gl.uniform1f(u(compProg, "uBloom"), d.bloom);
  gl.uniform1f(u(compProg, "uRadius"), 1.4);
  gl.uniform1f(u(compProg, "uSat"), col.saturation);
  gl.uniform1f(u(compProg, "uCon"), col.contrast);
  gl.uniform1f(u(compProg, "uTemp"), col.temp);
  gl.uniform1f(u(compProg, "uGamma"), col.gamma);
  gl.uniform1f(u(compProg, "uVignette"), st["gfx.quality"] === "smooth" ? 0.16 : 0.34);
  gl.uniform1f(u(compProg, "uScan"), 0.018);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (emberProg && d.particles > 0.02) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(emberProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, emberBuf);
    if (emberProg.__aSeed === undefined) emberProg.__aSeed = gl.getAttribLocation(emberProg, "aSeed");
    const al = emberProg.__aSeed;
    gl.enableVertexAttribArray(al);
    gl.vertexAttribPointer(al, 1, gl.FLOAT, false, 0, 0);
    gl.uniform1f(u(emberProg, "uTime"), t / 1000);
    gl.uniform2f(u(emberProg, "uRes"), canvas.width, canvas.height);
    gl.uniform1f(u(emberProg, "uCount"), Math.round(emberCount * d.particles));
    gl.drawArrays(gl.POINTS, 0, emberCount);
    gl.disable(gl.BLEND);
  }
  drawCalls++;

  if (query) {
    const avail = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
    if (avail) {
      const dtq = gl.getQueryParameter(query, gl.QUERY_RESULT);
      const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
      if (!disjoint) gpuMs = dtq / 1e6;
      gl.deleteQuery(query);
      query = null;
    }
  }

  const cv = el("gfxStat");
  if (cv && drawCalls % 6 === 0) {
    const budget = 1000 / engine.target;
    cv.innerHTML = "GPU <b>" + gpuMs.toFixed(2) + " ms</b><br>" + canvas.width + "x" + canvas.height + " px<br>budget " + budget.toFixed(1) + " ms";
    const gs = el("gfxStats");
    if (gs) {
      gs.innerHTML = [
        ["Render scale", Math.round(renderScale * 100) + " %", 1],
        ["Buffer size", canvas.width + " x " + canvas.height, 0],
        ["GPU frame cost", (gpuMs || 0).toFixed(2) + " ms", 1],
        ["Shader profile", state["gfx.quality"], 1],
        ["Colour filter", state["gfx.color"], 1],
        ["Compile time", compileMs.toFixed(1) + " ms", 0],
      ].map(([k, v, acc]) => '<div class="kv"><div class="kv-txt"><div class="kv-k">' + k + '</div><div class="kv-v' + (acc ? " accent" : "") + '">' + escapeHtml(v) + "</div></div></div>").join("");
    }
  }
}

export function initGfx() {
  canvas = el("gfxCanvas");
  if (!canvas) return;
  gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, powerPreference: state["lag.gpuBoost"] ? "high-performance" : "default", alpha: false });
  if (!gl) {
    noGl = true;
    el("gfxTag").textContent = "2D SOFTWARE";
    log.warn("GFX", "This device exposes no WebGL2 \u2014 the tuner switched to its 2D software renderer. The same quality and colour controls now drive real canvas resolution scaling and real colour grading.");
  } else {
    timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (timerExt) {
      engine.setGpuTimeSource(() => (gpuMs / Math.max(1000 / engine.target, 1)) * 100);
      log.ok("GFX", "GPU hardware timer query available \u2014 measuring real GPU frame cost.");
    } else {
      log.warn("GFX", "GPU timer query not exposed; using fill-rate model for GPU load.");
    }
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const seeds = new Float32Array(emberCount);
    for (let i = 0; i < emberCount; i++) seeds[i] = i / emberCount + Math.random() * 0.0004;
    emberBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, emberBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

    compileProfile("boot profile");
    resize();
  }

  canvas.addEventListener("pointerdown", (e) => { dragging = true; spin = false; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    camAngle -= (e.clientX - lastX) * 0.008;
    camPitch = Math.max(-0.15, Math.min(0.9, camPitch + (e.clientY - lastY) * 0.005));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("pointercancel", () => { dragging = false; });

  engine.addRenderer((t) => {
    if (spin && !dragging) camAngle += 0.0016;
    if (noGl) draw2D(t); else drawGfx(t);
  });

  on("gfx.quality", (v) => {
    const q = GFX_QUALITY[v];
    el("gfxQualityVal").textContent = q.label;
    el("gfxQualityDesc").textContent = "Render scale " + Math.round(q.scale * 100) + "%, bloom " + q.bloom + ", ember density " + Math.round(q.particles * 100) + "%. Applied live to the shader pipeline.";
    compileProfile("quality = " + v);
    canvas.width = 0;
    log.exec("GFX", "Quality preset switched to " + q.label + " \u2014 render scale " + Math.round(q.scale * 100) + "%, GPU work re-budgeted.");
  });
  on("gfx.color", (v) => {
    const c = COLOR_STYLE[v];
    el("gfxColorVal").textContent = c.label;
    el("gfxColorDesc").textContent = "Saturation " + c.saturation + "x, contrast " + c.contrast + "x, temperature " + (c.temp >= 0 ? "+" : "") + c.temp + ".";
    log.exec("GFX", "Colour style filter \u2192 " + c.label + " (sat " + c.saturation + ", con " + c.contrast + ", temp " + c.temp + ").");
  });
  on("lag.gpuBoost", (v) => log.info("GFX", v ? "High-performance GPU context requested; render scale will not be reduced." : "GPU context returned to default power profile."));

  const qs = el("gfxQualitySel");
  if (qs) qs.innerHTML = Object.entries(GFX_QUALITY).map(([k, v]) => '<option value="' + k + '">' + v.label + "</option>").join("");
  const cs2 = el("gfxColorSel");
  if (cs2) cs2.innerHTML = Object.entries(COLOR_STYLE).map(([k, v]) => '<option value="' + k + '">' + v.label + "</option>").join("");

  cmd("gfx.apply", () => {
    if (noGl) {
      paint2D(true);
      log.exec("GFX", "Re-applying the visual profile to the 2D software renderer ...");
      const q2 = GFX_QUALITY[state["gfx.quality"]] || GFX_QUALITY.balanced;
      log.ok("GFX", "Profile active \u2014 " + q2.label + " at " + Math.round(q2.scale * 100) + "% render scale plus the " + COLOR_STYLE[state["gfx.color"]].label + " grade, drawn on the CPU (no WebGL2 on this device).");
      toast("GFX profile applied \u2014 2D software renderer.", "ok");
      return;
    }
    log.exec("GFX", "Injecting visual profile into the shader pipeline ...");
    compileProfile("manual injection");
    setTimeout(() => log.ok("GFX", "Visual profile active \u2014 " + GFX_QUALITY[state["gfx.quality"]].label + " + " + COLOR_STYLE[state["gfx.color"]].label + " shaders running on the GPU."), 120);
    toast("GFX shaders applied.", "ok");
  });
  cmd("gfx.cycle", () => {
    const keys = Object.keys(GFX_QUALITY);
    const i = (keys.indexOf(state["gfx.quality"]) + 1) % keys.length;
    set("gfx.quality", keys[i]);
  });
  cmd("gfx.fullscreen", () => {
    const w = canvas.parentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (w.requestFullscreen) w.requestFullscreen().then(() => log.info("GFX", "Fullscreen shader preview opened.")).catch((e) => log.warn("GFX", "Fullscreen refused: " + e.message));
  });

  if (!noGl)   log.ok("GFX", "WebGL2 context acquired \u2014 " + gl.getParameter(gl.VERSION) + " \u00B7 max texture " + gl.getParameter(gl.MAX_TEXTURE_SIZE) + ".");
}

/* ------------------------------------------------------- 2D fallback ------- */
/* Used when this device/browser exposes no WebGL2. The quality tier really scales the
   back buffer and the particle count, and the colour style really grades the canvas. */
function draw2D(t) {
  if (!canvas || canvas.offsetParent === null) return;
  const c = canvas.getContext("2d");
  if (!c) return;
  const d = defs();
  const col = COLOR_STYLE[state["gfx.color"]] || COLOR_STYLE.vivid;
  const cssW = canvas.clientWidth || 320;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(120, Math.round(cssW * dpr * d.scale));
  const h = Math.max(90, Math.round(cssW * 0.62 * dpr * d.scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.height = Math.round(cssW * 0.62) + "px";
  }
  const phase = (t || 0) * 0.00035 + camAngle;
  const baseHue = 188 + col.temp * 220 - (col.saturation - 1) * 70;
  const dens = d.particles === undefined ? 0.7 : d.particles;

  const bg = c.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#05070f");
  bg.addColorStop(1, "#0a1024");
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);

  const orbs = Math.max(2, d.orbs || 3);
  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < orbs; i++) {
    const a = phase * (1 + i * 0.32) + (i * Math.PI * 2) / orbs;
    const x = w * (0.5 + 0.3 * Math.cos(a));
    const y = h * (0.5 + 0.27 * Math.sin(a * 1.27));
    const r = Math.min(w, h) * (0.24 + 0.07 * Math.sin(a * 0.8));
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const hue = baseHue + i * 46;
    g.addColorStop(0, "hsla(" + hue + ", 92%, 62%, .55)");
    g.addColorStop(0.55, "hsla(" + (hue + 24) + ", 88%, 52%, .20)");
    g.addColorStop(1, "hsla(" + (hue + 40) + ", 85%, 46%, 0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  const rings = state["gfx.quality"] === "ultra" ? 4 : state["gfx.quality"] === "smooth" ? 2 : 3;
  c.lineWidth = Math.max(1, w / 320);
  for (let k = 0; k < rings; k++) {
    const rr = Math.min(w, h) * (0.16 + k * 0.075);
    const rot = phase * (0.6 + k * 0.2);
    c.strokeStyle = "hsla(" + (baseHue + 12 + k * 18) + ", 90%, 66%, " + Math.max(0.06, 0.34 - k * 0.06) + ")";
    c.beginPath();
    for (let s = 0; s <= 6; s++) {
      const th = rot + (s / 6) * Math.PI * 2;
      const px = w / 2 + rr * Math.cos(th);
      const py = h / 2 + rr * Math.sin(th) * 0.78;
      if (s === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
  }

  const sparks = Math.round(130 * dens);
  for (let i = 0; i < sparks; i++) {
    const sx = (((i * 8191) % 10007) / 10007) * w;
    const sy = (((i * 6151) % 9973) / 9973) * h;
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(phase * 6 + i));
    c.fillStyle = "hsla(" + (baseHue + (i % 3) * 40) + ", 95%, 72%, " + (0.18 * tw * dens) + ")";
    c.fillRect(sx, sy, 1.6, 1.6);
  }

  c.globalCompositeOperation = "saturation";
  c.globalAlpha = Math.min(1, Math.max(0, col.saturation - 1) * 1.8);
  c.fillStyle = "hsl(" + baseHue + ", 100%, 50%)";
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = "overlay";
  c.globalAlpha = Math.min(0.4, Math.abs(col.temp) * 3.2);
  c.fillStyle = col.temp >= 0 ? "#ff9d4d" : "#4d9dff";
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  if (col.contrast && col.contrast !== 1) {
    const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0," + Math.min(0.5, (col.contrast - 1) * 2.2) + ")");
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
  }

  statAcc += 1;
  if (statAcc % 20 === 0) paint2D(false, w, h, d, col);
}

function paint2D(force, w, h, d, col) {
  if (!canvas) return;
  if (!d) d = defs();
  if (!col) col = COLOR_STYLE[state["gfx.color"]] || COLOR_STYLE.vivid;
  if (w === undefined) w = canvas.width;
  if (h === undefined) h = canvas.height;
  const dens = d.particles === undefined ? 0.7 : d.particles;
  const st = el("gfxStat");
  if (st) st.textContent = "2D SOFTWARE \u00B7 " + w + "x" + h + " \u00B7 " + state["gfx.quality"] + " \u00B7 " + col.label;
  const gs = el("gfxStats");
  if (gs) {
    gs.innerHTML = [
      ["Renderer", "2D canvas (no WebGL2)", 1],
      ["Render scale", Math.round(d.scale * 100) + "%", 1],
      ["Back buffer", w + " x " + h, 0],
      ["Orbs / rings", d.orbs + " / " + (state["gfx.quality"] === "ultra" ? 4 : state["gfx.quality"] === "smooth" ? 2 : 3), 0],
      ["Particles", Math.round(130 * dens), 0],
      ["Colour filter", state["gfx.color"], 1],
      ["Live FPS", M.fps, 0],
    ].map(([k, v, acc]) => '<div class="kv"><div class="kv-txt"><div class="kv-k">' + k + '</div><div class="kv-v' + (acc ? " accent" : "") + '">' + escapeHtml(v) + "</div></div></div>").join("");
  }
}
