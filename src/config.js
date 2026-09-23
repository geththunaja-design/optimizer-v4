const R = (typeof window !== "undefined" && window.root) ? window.root : {};
const S = (v, fb) => (v === undefined || v === null || String(v) === "undefined" ? fb : String(v));

export const APP = {
  name: S(R.appName, "Optimizer V.4.0"),
  version: S(R.appVersion, "4.0.0"),
  build: S(R.appBuild, "V4.0.0-stable"),
  target: S(R.appTarget, "Android 8.0+ (non-root)"),
  developer: S(R.developerName, "Aash optimizer"),
  whatsapp: S(R.vipWhatsapp, "+94 71 238 6533"),
  comingSoon: S(R.comingSoon, "Optimizer V.5.0 — Coming soon, stay connected with us"),
  defaultTheme: S(R.defaultTheme, "dark"),
};

export const DEFAULTS = {
  "ui.theme": APP.defaultTheme,
  "ui.hud": true,
  "ui.graph": true,

  "hw.preset": "balanced",
  "hw.targetFps": 60,
  "hw.governor": "balanced",
  "hw.memAggression": 3,
  "hw.touchRate": 240,

  "mon.shield": false,
  "mon.framePacing": false,
  "mon.antiThermal": false,
  "mon.stutterBuffer": false,

  "lag.perfLock": false,
  "lag.gpuBoost": false,
  "lag.zeroStutter": false,

  "aim.fakeDamage": false,
  "aim.recoilFix": false,
  "aim.aimStick": false,
  "aim.recoilStabilizer": false,
  "aim.spreadFix": false,
  "aim.fireButton": 42,
  "aim.weapon": "AR",

  "touch.delay": 1,
  "touch.pollRate": 240,

  "mem.batteryOverride": false,

  "net.dns": "cloudflare",
  "net.region": "cloudflare",

  "gfx.quality": "balanced",
  "gfx.color": "vivid",
};

export const PRESETS = {
  extreme: {
    label: "Extreme Zero Lag Mode",
    icon: "\u26A1",
    tag: "MAX AGGRESSION",
    desc: "Uncapped frame budget, permanent performance lock, smallest buffers.",
    apply: {
      "hw.targetFps": 120, "hw.governor": "performance", "hw.memAggression": 5, "hw.touchRate": 480,
      "mon.shield": true, "mon.framePacing": true, "mon.antiThermal": true, "mon.stutterBuffer": true,
      "lag.perfLock": true, "lag.gpuBoost": true, "lag.zeroStutter": true,
      "gfx.quality": "smooth", "touch.delay": 1,
    },
  },
  max: {
    label: "Max Performance Tuning",
    icon: "\uD83D\uDD25",
    tag: "HIGH",
    desc: "Aggressive pacing and boost, keeps visual quality intact.",
    apply: {
      "hw.targetFps": 90, "hw.governor": "performance", "hw.memAggression": 4, "hw.touchRate": 360,
      "mon.shield": true, "mon.framePacing": true, "mon.antiThermal": true, "mon.stutterBuffer": false,
      "lag.perfLock": true, "lag.gpuBoost": true, "lag.zeroStutter": false,
      "gfx.quality": "balanced", "touch.delay": 1,
    },
  },
  balanced: {
    label: "Balanced (Normal 60 FPS)",
    icon: "\u2696\uFE0F",
    tag: "STABLE",
    desc: "Daily driver profile. Locked 60 FPS with normal thermals and memory.",
    apply: {
      "hw.targetFps": 60, "hw.governor": "balanced", "hw.memAggression": 3, "hw.touchRate": 240,
      "mon.shield": false, "mon.framePacing": true, "mon.antiThermal": false, "mon.stutterBuffer": false,
      "lag.perfLock": false, "lag.gpuBoost": false, "lag.zeroStutter": false,
      "gfx.quality": "balanced", "touch.delay": 2,
    },
  },
  ultra: {
    label: "Ultra Smooth (90/120 FPS Support)",
    icon: "\uD83D\uDCA0",
    tag: "HIGH REFRESH",
    desc: "Tuned for 90/120 Hz panels: high frame budget, tight pacing, high touch polling.",
    apply: {
      "hw.targetFps": 120, "hw.governor": "performance", "hw.memAggression": 4, "hw.touchRate": 480,
      "mon.shield": true, "mon.framePacing": true, "mon.antiThermal": false, "mon.stutterBuffer": true,
      "lag.perfLock": true, "lag.gpuBoost": true, "lag.zeroStutter": true,
      "gfx.quality": "balanced", "touch.delay": 1,
    },
  },
};

export const LABELS = {
  "mon.shield": { mod: "SHIELD", label: "Fix FPS Drops Shield Engine", on: "ENGAGED \u2014 frame budget reserved", off: "DISENGAGED" },
  "mon.framePacing": { mod: "SHIELD", label: "Frame Pacing Lock", on: "LOCKED \u2014 delivery timestamps flattened", off: "UNLOCKED" },
  "mon.antiThermal": { mod: "SHIELD", label: "Anti-Thermal Drop Override", on: "ACTIVE \u2014 degradation guard armed", off: "OFF" },
  "mon.stutterBuffer": { mod: "SHIELD", label: "Zero Stutter Driver Buffer Priority", on: "PRIORITY RAISED \u2014 deep buffer + deadline queue", off: "NORMAL PRIORITY" },
  "lag.perfLock": { mod: "ZERO-LAG", label: "Performance Lock CPU Governor", on: "GOVERNOR REQUEST = PERFORMANCE", off: "GOVERNOR REQUEST = BALANCED" },
  "lag.gpuBoost": { mod: "ZERO-LAG", label: "Maximum Boost GPU Clock Target", on: "GPU TARGET = MAX BOOST (high-performance context)", off: "GPU TARGET = NOMINAL" },
  "lag.zeroStutter": { mod: "ZERO-LAG", label: "Zero Stutter Lock Game Frame Pacing", on: "ZERO-STUTTER LOCK ON", off: "ZERO-STUTTER LOCK OFF" },
  "aim.fakeDamage": { mod: "AIM", label: "Fake Damage Fix (ghost hits)", on: "HIT REGISTRATION WINDOW PATCHED", off: "STOCK REGISTRATION" },
  "aim.recoilFix": { mod: "AIM", label: "Game Recoil Fix", on: "VERTICAL RECOIL COMPENSATION ON", off: "STOCK RECOIL" },
  "aim.aimStick": { mod: "AIM", label: "Aim Stick to Head", on: "HEAD-SNAP MAGNET ARMED", off: "FREE AIM" },
  "aim.recoilStabilizer": { mod: "AIM", label: "Recoil Stabilizer", on: "RANDOM CLIMB DAMPERS ON", off: "STOCK RANDOMNESS" },
  "aim.spreadFix": { mod: "AIM", label: "Bullet Spread Fix", on: "SPREAD CONE TIGHTENED", off: "STOCK SPREAD" },
  "mem.batteryOverride": { mod: "MEMORY", label: "Temperature / Battery Throttle Boost", on: "THROTTLE OVERRIDE ACTIVE \u2014 full clocks requested", off: "THROTTLE OVERRIDE OFF" },
  "ui.hud": { mod: "HUD", label: "FPS Counter HUD Overlay", on: "OVERLAY VISIBLE", off: "OVERLAY HIDDEN" },
  "ui.graph": { mod: "TELEMETRY", label: "Live Telemetry Graph", on: "STREAMING FPS + RAM", off: "STREAM PAUSED" },
};

export const DNS_SERVERS = {
  cloudflare: { name: "Cloudflare Ultra-Gaming", ip: "1.1.1.1", alt: "1.0.0.1", doh: "https://cloudflare-dns.com/dns-query", accent: "#f59e0b" },
  google: { name: "Google Public DNS", ip: "8.8.8.8", alt: "8.8.4.4", doh: "https://dns.google/resolve", accent: "#22d3ee" },
  opendns: { name: "OpenDNS Home", ip: "208.67.222.222", alt: "208.67.220.220", doh: "https://doh.opendns.com/dns-query", accent: "#a78bfa" },
};

export const REGIONS = [
  { id: "cloudflare", label: "Cloudflare Edge", country: "Global anycast", host: "https://cloudflare.com/cdn-cgi/trace" },
  { id: "google", label: "Google Global", country: "Global anycast", host: "https://www.google.com/generate_204" },
  { id: "aws-sin", label: "AWS Singapore", country: "Asia / Singapore", host: "https://dynamodb.ap-southeast-1.amazonaws.com/ping" },
  { id: "aws-mum", label: "AWS Mumbai", country: "India / Mumbai", host: "https://dynamodb.ap-south-1.amazonaws.com/ping" },
  { id: "do-sgp", label: "DigitalOcean SGP1", country: "Asia / Singapore", host: "https://sgp1.digitaloceanspaces.com/" },
  { id: "azure-sin", label: "Azure Southeast Asia", country: "Asia / Singapore", host: "https://southeastasia.blob.core.windows.net/" },
  { id: "garena", label: "Garena (Free Fire)", country: "Global anycast", host: "https://www.garena.com/" },
];

export const GAMES = [
  {
    id: "ff", name: "Free Fire", pkg: "com.dts.freefireth", scheme: "freefire",
    accent: "#ffa726", short: "FF", host: "ff.garena.com",
    store: "https://play.google.com/store/apps/details?id=com.dts.freefireth",
  },
  {
    id: "ffmax", name: "Free Fire MAX", pkg: "com.dts.freefiremax", scheme: "freefiremax",
    accent: "#ff4d6d", short: "FF MAX", host: "ffmax.garena.com",
    store: "https://play.google.com/store/apps/details?id=com.dts.freefiremax",
  },
];

export const WEAPONS = {
  SMG: { recoil: 0.55, climb: 1.35, spread: 2.6, rpm: 900, dmg: 19, headMult: 1.4 },
  AR: { recoil: 0.75, climb: 1.0, spread: 1.5, rpm: 640, dmg: 27, headMult: 2.0 },
  Shotgun: { recoil: 1.6, climb: 0.45, spread: 5.5, rpm: 90, dmg: 94, headMult: 1.25 },
  Marksman: { recoil: 1.1, climb: 1.15, spread: 0.7, rpm: 300, dmg: 51, headMult: 2.35 },
};

export const GFX_QUALITY = {
  smooth: { label: "Smooth (Max Performance)", scale: 0.65, bloom: 0.0, fxaa: 0, particles: 0.35, shadows: 0 },
  balanced: { label: "Balanced", scale: 0.85, bloom: 0.45, fxaa: 1, particles: 0.7, shadows: 1 },
  ultra: { label: "Ultra", scale: 1.0, bloom: 0.95, fxaa: 1, particles: 1.0, shadows: 1 },
};

export const COLOR_STYLE = {
  vivid: { label: "Vivid / Colorful", saturation: 1.28, contrast: 1.12, temp: 0.06, gamma: 1.02 },
  classic: { label: "Classic", saturation: 1.0, contrast: 1.0, temp: 0.0, gamma: 1.0 },
};

export const LOG_STYLE = {
  info: { cls: "lg-info", tag: "INFO" },
  ok: { cls: "lg-ok", tag: " OK " },
  exec: { cls: "lg-exec", tag: "EXEC" },
  warn: { cls: "lg-warn", tag: "WARN" },
  err: { cls: "lg-err", tag: " ERR" },
};
