/* Destroy Any Website — clone
 * A stickman runs & jumps on a real web page (loaded through a local proxy into a
 * same-origin iframe). Words, images and boxes are destructible platforms; holes in the
 * page reveal a procedural pixel-art world underneath.
 */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ============================================================ constants
const MAX_WORLD_H = 60000;
const MP_WIDTH = 1280;
const CELL = 64;
const GRAV = 1900;
const RUN = 270;
const JUMP_V = 640;
const FLIP_V = 580;
const JET_ACC = 3400;
const JET_MAXUP = 430;
const PW = 12, PH = 42;       // player hitbox
const SHOULDER = 28;          // world px above feet where the gun is held
const MAX_WORDS = 14000;

const WEAPONS = [
  { name: 'PISTOL',   rate: 0.25, dmg: 16, speed: 1500, spread: 0.015, count: 1, type: 'bullet', gun: 9,  sfx: 'pistol' },
  { name: 'SMG',      rate: 0.065, dmg: 8, speed: 1600, spread: 0.08,  count: 1, type: 'bullet', gun: 14, sfx: 'smg' },
  { name: 'SHOTGUN',  rate: 0.8,  dmg: 11, speed: 1300, spread: 0.3,   count: 8, type: 'bullet', gun: 18, sfx: 'shotgun', life: 0.35 },
  { name: 'RPG',      rate: 0.95, dmg: 90, speed: 520,  spread: 0,     count: 1, type: 'rocket', gun: 20, sfx: 'rocket', radius: 90 },
  { name: 'RAILGUN',  rate: 1.1,  dmg: 85, speed: 0,    spread: 0,     count: 1, type: 'rail',   gun: 22, sfx: 'rail' },
  { name: 'FLAMER',   rate: 0.028, dmg: 3, speed: 520,  spread: 0.16,  count: 1, type: 'flame',  gun: 16, sfx: 'flame' },
  { name: 'MISSILES', rate: 1.2,  dmg: 42, speed: 380,  spread: 0,     count: 4, type: 'missile', gun: 14, sfx: 'rocket', radius: 50 },
];
const GRENADE = { name: 'GRENADE', dmg: 95, radius: 100, fuse: 1.7, cd: 0.7 };

// ============================================================ dom refs
const menu = $('#menu'), game = $('#game'), stage = $('#stage'), iframe = $('#site'), cvs = $('#fx');
const ctx = cvs.getContext('2d');

// ============================================================ sound (WebAudio synth)
const Sound = (() => {
  let ac, noise, master;
  function init() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = 0.35; master.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ac = null; }
  }
  const last = {};
  function burst(dur, freq, q, vol, type = 'lowpass', slide) {
    const t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur);
  }
  function tone(dur, f0, f1, vol, type = 'square') {
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
  }
  function play(name, vol = 1) {
    if (!ac || vol < 0.03) return;
    const now = performance.now();
    const minGap = { flame: 60, break: 35, smg: 30, hit: 25, jet: 90 }[name] || 0;
    if (last[name] && now - last[name] < minGap) return;
    last[name] = now;
    switch (name) {
      case 'pistol': burst(0.12, 2500, 1, 0.9 * vol); tone(0.08, 300, 80, 0.2 * vol); break;
      case 'smg': burst(0.07, 3200, 1, 0.6 * vol); break;
      case 'shotgun': burst(0.3, 1400, 0.7, 1.2 * vol); tone(0.15, 150, 40, 0.3 * vol); break;
      case 'rocket': burst(0.4, 900, 2, 0.6 * vol, 'bandpass', 300); break;
      case 'rail': tone(0.35, 1800, 90, 0.3 * vol, 'sawtooth'); burst(0.2, 5000, 1, 0.4 * vol, 'highpass'); break;
      case 'flame': burst(0.12, 700, 0.5, 0.4 * vol); break;
      case 'explode': burst(0.9, 600, 0.8, 1.6 * vol, 'lowpass', 60); tone(0.5, 90, 30, 0.6 * vol, 'sine'); break;
      case 'break': burst(0.08, 1800 + Math.random() * 2000, 2, 0.25 * vol, 'bandpass'); break;
      case 'hit': burst(0.05, 4000, 3, 0.15 * vol, 'bandpass'); break;
      case 'jump': tone(0.12, 220, 520, 0.08 * vol); break;
      case 'jet': burst(0.1, 500, 0.6, 0.25 * vol); break;
      case 'hurt': tone(0.18, 400, 120, 0.25 * vol, 'sawtooth'); break;
      case 'throw': tone(0.1, 600, 300, 0.1 * vol, 'triangle'); break;
      case 'bounce': tone(0.05, 900, 700, 0.06 * vol, 'triangle'); break;
      case 'switch': tone(0.05, 800, 1200, 0.08 * vol); break;
      case 'die': tone(0.6, 500, 60, 0.3 * vol, 'sawtooth'); break;
      case 'spawn': tone(0.25, 300, 900, 0.12 * vol, 'triangle'); break;
    }
  }
  return { init, play };
})();

// ============================================================ 32-bit pixel art: palette & buffers
const U = 2;            // sprite / fx pixel size (world px)
const PX = 2;           // background art pixel size (world px)
const BAND_H = 360;     // art px per scene band (each band = one landscape)
const INK = '#15111c';  // universal outline colour

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

class PixBuf {
  constructor(w, h) { this.w = w; this.h = h; this.img = new ImageData(w, h); this.d = new Uint32Array(this.img.data.buffer); }
  static pack(c) { return (255 << 24) | ((c[2] & 255) << 16) | ((c[1] & 255) << 8) | (c[0] & 255); }
  px(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.d[y * this.w + x] = PixBuf.pack(c); }
  get(x, y) { const v = this.d[y * this.w + x]; return [v & 255, (v >> 8) & 255, (v >> 16) & 255]; }
  blend(x, y, c, a) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.d[y * this.w + x] = PixBuf.pack(mix(this.get(x, y), c, a)); }
  hline(x0, x1, y, c) {
    y |= 0; if (y < 0 || y >= this.h) return;
    x0 = Math.max(0, x0 | 0); x1 = Math.min(this.w - 1, x1 | 0);
    const v = PixBuf.pack(c), o = y * this.w;
    for (let x = x0; x <= x1; x++) this.d[o + x] = v;
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) this.hline(x, x + w - 1, y + j, c); }
  circle(cx, cy, r, c) {
    for (let dy = -Math.floor(r); dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy)); this.hline(cx - dx, cx + dx, cy + dy, c); }
  }
  // ordered-dither between two colours: t=0 -> a, t=1 -> b
  dith(x, y, a, b, t) { this.px(x, y, t > BAYER[((y & 3) << 2) | (x & 3)] ? b : a); }
}

// muted, 32-bit era palettes (sky top -> horizon)
const THEMES = [
  { name: 'meadow', sky: ['#3d6fb5', '#5286c4', '#6d9fd2', '#8db8dd', '#b4d2e6'], orb: 'sun', orbC: '#fff1c4',
    cloud: ['#8ea4c0', '#d6e0ec', '#f6f8fb'], far: '#7e95b8', snow: '#dfe8f2', mid: '#557f63',
    grass: ['#35602f', '#4f853a', '#86b852'], dirt: ['#6b4a32', '#573b28', '#43301f'], rock: '#7d7a78', deco: 'tree', canopy: ['#23512b', '#347a38', '#5aa148'] },
  { name: 'night', sky: ['#0e1330', '#161c44', '#1f2758', '#2c356b', '#3e4780'], orb: 'moon', orbC: '#e8e4c8', stars: true,
    cloud: ['#252a58', '#343c70', '#4c5690'], far: '#28305c', snow: '#6c78a8', mid: '#1d2a44',
    grass: ['#132a26', '#1c3e33', '#2c5a46'], dirt: ['#2a2433', '#211c29', '#18141f'], rock: '#4a4658', deco: 'pine', canopy: ['#0f2622', '#17382e', '#24503c'] },
  { name: 'dusk', sky: ['#4a3262', '#7a4266', '#b0585a', '#d88458', '#eeac6e'], orb: 'sun', orbC: '#ffe0a0',
    cloud: ['#8a4c62', '#c8807a', '#f0b89a'], far: '#7a5068', mid: '#a0664c',
    grass: ['#a0643a', '#c2864a', '#e2ac6e'], dirt: ['#9a6036', '#82502c', '#6a4024'], rock: '#8a6a58', deco: 'cactus', canopy: ['#2f5a2e', '#43783a', '#6a9a4c'] },
  { name: 'coast', sky: ['#2a6aa0', '#3a82b8', '#58a0cc', '#80bcd8', '#b0d8e4'], orb: 'sun', orbC: '#fff6d8', water: ['#1b4670', '#255f8c', '#4d8fb6', '#9ccbe0'],
    cloud: ['#8aa8c4', '#d8e6f0', '#ffffff'], far: '#5a86ac', mid: '#4a7aa0',
    grass: ['#bfa672', '#d6c08a', '#eee0b0'], dirt: ['#b09868', '#98825a', '#7a6a48'], rock: '#8a8272', deco: 'palm', canopy: ['#24603a', '#35804a', '#5aa860'] },
  { name: 'autumn', sky: ['#5f7ea8', '#7f97ba', '#a4b0c4', '#cdbfb2', '#e4d0b2'], orb: 'sun', orbC: '#fff0d0',
    cloud: ['#98a0b4', '#d8d4d4', '#f4eee6'], far: '#848aa2', snow: '#e4e6ee', mid: '#7a5638',
    grass: ['#6e4420', '#9c5e28', '#cc8a36'], dirt: ['#5e4430', '#4c3626', '#3a2a1e'], rock: '#7a6e66', deco: 'tree', canopy: ['#8a3a1a', '#b8601e', '#e0942e'] },
  { name: 'volcano', sky: ['#120a14', '#1e0e18', '#34121a', '#52181a', '#782616'], orb: 'moon', orbC: '#ff8a4a', stars: true, lava: true,
    cloud: ['#2a1216', '#3e1a1c', '#5a2622'], far: '#2a1418', mid: '#3a1a1a',
    grass: ['#281410', '#3a1e16', '#5a2a1a'], dirt: ['#2e1410', '#220e0b', '#160806'], rock: '#4a3432', deco: 'crystal', canopy: ['#000000', '#000000', '#000000'] },
  { name: 'snow', sky: ['#56698f', '#7083a6', '#8d9dba', '#abb9cf', '#cbd4e1'], orb: 'sun', orbC: '#f4f4ec',
    cloud: ['#9aa6bc', '#dfe5ee', '#ffffff'], far: '#8595b4', snow: '#f0f4fa', mid: '#a4b4c8',
    grass: ['#a6b4c8', '#ccd6e2', '#eef2f7'], dirt: ['#667086', '#535c70', '#424a5c'], rock: '#7c8496', deco: 'snowpine', canopy: ['#1e3e3a', '#2c5a50', '#e8eef6'] },
].map((t) => {
  const o = { ...t };
  for (const k of ['sky', 'cloud', 'grass', 'dirt', 'canopy', 'water']) if (o[k]) o[k] = o[k].map(hex);
  for (const k of ['orbC', 'far', 'snow', 'mid', 'rock']) if (o[k]) o[k] = hex(o[k]);
  return o;
});

// fractal-ish ridge line
function ridgeLine(w, R, base, amp, freq) {
  const ph = [R() * 100, R() * 100, R() * 100, R() * 100];
  const out = new Array(w);
  for (let x = 0; x < w; x++) {
    const n = Math.sin(x * 0.011 * freq + ph[0]) * 0.45 + Math.sin(x * 0.029 * freq + ph[1]) * 0.3 +
      Math.sin(x * 0.071 * freq + ph[2]) * 0.15 + Math.sin(x * 0.19 * freq + ph[3]) * 0.1;
    out[x] = Math.round(base - amp * (n + 1) / 2);
  }
  return out;
}

// one full landscape band, returned as a canvas (already dimmed so the page stays readable)
function makeBandArt(w, h, seed, bi) {
  const R = mulberry32((seed ^ Math.imul(bi + 1, 0x9E3779B1)) >>> 0);
  const T = THEMES[((seed % THEMES.length) + bi * 3) % THEMES.length];
  const B = new PixBuf(w, h);
  const skyH = Math.floor(h * 0.56);
  const horizon = T.sky[T.sky.length - 1];

  // --- sky: dithered multi-stop gradient
  const n = T.sky.length - 1;
  for (let y = 0; y < skyH + 40; y++) {
    const t = Math.min(1, y / skyH) * n;
    const i = Math.min(n - 1, Math.floor(t)), f = t - i;
    for (let x = 0; x < w; x++) B.dith(x, y, T.sky[i], T.sky[i + 1], f);
  }
  if (T.stars) for (let i = 0; i < (w * skyH) / 70; i++) {
    const x = R() * w | 0, y = R() * skyH * 0.85 | 0, c = R() < 0.25 ? [255, 226, 160] : WHITE, a = 0.4 + R() * 0.6;
    B.blend(x, y, c, a);
    if (R() < 0.06) { B.blend(x - 1, y, c, a * 0.5); B.blend(x + 1, y, c, a * 0.5); B.blend(x, y - 1, c, a * 0.5); B.blend(x, y + 1, c, a * 0.5); }
  }
  // --- sun / moon with dithered halo
  {
    const cx = w * (0.12 + R() * 0.76) | 0, cy = skyH * (0.18 + R() * 0.22) | 0, r = 9 + R() * 7 | 0;
    for (let yy = -r * 3; yy <= r * 3; yy++) for (let xx = -r * 3; xx <= r * 3; xx++) {
      const d = Math.sqrt(xx * xx + yy * yy);
      if (d > r && d < r * 3) { const t = (1 - (d - r) / (r * 2)) * 0.55; if (t > BAYER[(((cy + yy) & 3) << 2) | ((cx + xx) & 3)]) B.blend(cx + xx, cy + yy, T.orbC, 0.28); }
    }
    B.circle(cx, cy, r, T.orbC);
    if (T.orb === 'moon') {
      const sh = mix(T.orbC, BLACK, 0.18);
      B.circle(cx + r * 0.3 | 0, cy - r * 0.25 | 0, r * 0.28, sh); B.circle(cx - r * 0.35 | 0, cy + r * 0.3 | 0, r * 0.2, sh); B.circle(cx + r * 0.1 | 0, cy + r * 0.55 | 0, r * 0.14, sh);
      for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy)); B.px(cx + dx, cy + dy, mix(T.orbC, BLACK, 0.3)); }
    } else {
      B.circle(cx - r * 0.3 | 0, cy - r * 0.3 | 0, r * 0.45, mix(T.orbC, WHITE, 0.6));
    }
  }
  // --- clouds: 3-tone blobs
  for (let i = 0; i < w / 70; i++) {
    const cx = R() * w | 0, cy = 10 + R() * skyH * 0.5 | 0, s = 5 + R() * 7;
    const blobs = [];
    for (let k = 0; k < 5; k++) blobs.push([cx + (k - 2) * s * 0.9 + (R() - 0.5) * s, cy + (k % 2 ? -s * 0.35 : 0) + (R() - 0.5) * 3, s * (0.6 + R() * 0.45)]);
    for (const [x, y, r] of blobs) B.circle(x | 0, (y | 0) + 2, r, T.cloud[0]);
    for (const [x, y, r] of blobs) B.circle(x | 0, y | 0, r, T.cloud[1]);
    for (const [x, y, r] of blobs) B.circle((x - r * 0.25) | 0, (y - r * 0.3) | 0, r * 0.5, T.cloud[2]);
    B.rect(cx - s * 2.4 | 0, cy + 1, s * 4.8 | 0, s * 0.8 | 0 || 1, T.cloud[1]);
    B.hline(cx - s * 2.4 | 0, cx + s * 2.4 | 0, cy + (s * 0.8 | 0) + 1, T.cloud[0]);
  }
  // --- far mountains with lit/shaded faces, snow caps and haze
  {
    const tops = ridgeLine(w, R, skyH * 0.98, skyH * 0.6, 0.7);
    const lit = mix(T.far, WHITE, 0.14), shade = mix(T.far, BLACK, 0.18);
    for (let x = 0; x < w; x++) {
      const t = tops[x], slope = (tops[Math.min(w - 1, x + 1)] - tops[Math.max(0, x - 1)]);
      for (let y = t; y < skyH + 30; y++) {
        const depth = (y - t) / 60;
        let c = depth < 1 ? (slope > 0 ? shade : slope < 0 ? lit : T.far) : T.far;
        if (T.snow && y - t < 4 + ((x * 7) % 3) && t < skyH * 0.62) c = slope > 0 ? mix(T.snow, BLACK, 0.12) : T.snow;
        B.dith(x, y, c, horizon, Math.min(0.55, (y - t) / (skyH * 1.2)) * 0.8 + 0.25);
      }
    }
  }
  // --- mid hills (or sea)
  if (T.water) {
    for (let y = skyH - 4; y < h; y++) {
      const t = (y - skyH + 4) / (h * 0.3);
      const tt = Math.min(1.999, t * 2), j = Math.floor(tt);
      for (let x = 0; x < w; x++) B.dith(x, y, T.water[2 - j], T.water[1 - j], tt - j);
    }
    for (let y = skyH - 3; y < h * 0.85; y += 2 + (R() * 3 | 0)) for (let k = 0; k < w / 30; k++) {
      const x = R() * w | 0, l = 3 + R() * 10 | 0;
      B.hline(x, x + l, y, T.water[2 + (R() < 0.3 ? 1 : 0)]);
    }
  } else {
    const tops = ridgeLine(w, R, skyH * 1.04, skyH * 0.32, 1.4);
    const lit = mix(T.mid, WHITE, 0.1), sh = mix(T.mid, BLACK, 0.2);
    for (let x = 0; x < w; x++) {
      const t = tops[x], slope = tops[Math.min(w - 1, x + 1)] - tops[Math.max(0, x - 1)];
      for (let y = t; y < h; y++) B.dith(x, y, y - t < 3 ? (slope > 0 ? sh : lit) : T.mid, horizon, Math.max(0, 0.3 - (y - t) / 120));
      // distant tree line bumps
      if (T.deco !== 'cactus' && T.deco !== 'crystal' && x % 3 === 0 && R() < 0.5) B.circle(x, t, 1 + R() * 2, mix(T.mid, BLACK, 0.12));
    }
  }
  // --- near ground: grass lip, dirt strata, rocks, buried stuff
  const gTops = ridgeLine(w, R, h * 0.74, h * 0.12, 2.2);
  for (let x = 0; x < w; x++) {
    const t = gTops[x];
    for (let y = t; y < h; y++) {
      const d = y - t;
      let c;
      if (d < 1) c = T.grass[2];
      else if (d < 4) c = T.grass[1];
      else if (d < 6) { B.dith(x, y, T.grass[0], T.dirt[0], (d - 4) / 2); continue; }
      else { const f = Math.min(1.999, (d - 6) / ((h - t) / 2.2)); const i = Math.floor(f); B.dith(x, y, T.dirt[i], T.dirt[Math.min(2, i + 1)], f - i); continue; }
      B.px(x, y, c);
    }
    // grass blades
    if (R() < 0.35) B.px(x, t - 1, T.grass[R() < 0.5 ? 1 : 2]);
    if (R() < 0.08) { B.px(x, t - 1, T.grass[1]); B.px(x, t - 2, T.grass[2]); }
  }
  // strata lines, pebbles, rocks
  for (let i = 0; i < w / 3; i++) {
    const x = R() * w | 0, y = gTops[x] + 8 + R() * (h - gTops[x] - 8) | 0;
    B.blend(x, y, R() < 0.5 ? BLACK : WHITE, 0.12);
    B.blend(x + 1, y, R() < 0.5 ? BLACK : WHITE, 0.08);
  }
  for (let i = 0; i < w / 40; i++) {
    const x = R() * w | 0, y = gTops[x] + 10 + R() * (h - gTops[x] - 14) | 0, r = 2 + R() * 3;
    B.circle(x, y + 1, r, mix(T.rock, BLACK, 0.4));
    B.circle(x, y, r, T.rock);
    B.circle(x - 1, y - 1, r * 0.45, mix(T.rock, WHITE, 0.25));
  }
  // buried treasure: gems / bones / lava veins
  for (let i = 0; i < w / 90; i++) {
    const x = R() * w | 0, y = gTops[x] + 14 + R() * (h - gTops[x] - 18) | 0;
    if (T.lava) {
      const l = 8 + R() * 22 | 0;
      for (let k = 0; k < l; k++) { const yy = y + Math.round(Math.sin(k * 0.4) * 1.5); B.px(x + k, yy, [220, 80, 30]); B.px(x + k, yy - 1, [120, 30, 16]); if (k % 3 === 0) B.px(x + k, yy, [255, 200, 90]); }
    } else if (R() < 0.6) {
      const c = [[80, 190, 220], [210, 80, 150], [230, 200, 80], [90, 200, 120]][R() * 4 | 0];
      B.px(x, y - 1, mix(c, WHITE, 0.5)); B.px(x - 1, y, c); B.px(x, y, c); B.px(x + 1, y, mix(c, BLACK, 0.3)); B.px(x, y + 1, mix(c, BLACK, 0.4));
    } else {
      const bc = [220, 212, 190];
      B.hline(x - 3, x + 3, y, bc); B.px(x - 4, y - 1, bc); B.px(x - 4, y + 1, bc); B.px(x + 4, y - 1, bc); B.px(x + 4, y + 1, bc);
    }
  }
  // decorations standing on the ground line
  for (let x = 8; x < w - 8; x += 12 + Math.floor(R() * 34)) decoArt(B, T, x, gTops[x], R);

  // --- post: desaturate & dim so the website stays the star
  const d = B.d;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    let r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255;
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    r = (r * 0.6 + l * 0.4) * 0.68 + 10; g = (g * 0.6 + l * 0.4) * 0.68 + 10; b = (b * 0.6 + l * 0.4) * 0.68 + 16;
    d[i] = (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
  }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').putImageData(B.img, 0, 0);
  return c;
}

function decoArt(B, T, x, top, R) {
  const s = 0.8 + R() * 0.7;
  const [c0, c1, c2] = T.canopy;
  switch (T.deco) {
    case 'tree': {
      const th = 9 * s | 0;
      B.rect(x, top - th, 2, th, [74, 50, 30]); B.px(x + 1, top - th, [50, 34, 22]);
      const cy = top - th - 3 * s, r = 5 * s;
      B.circle(x + 1, cy + 1, r, c0); B.circle(x - 2, cy + 2, r * 0.7, c0); B.circle(x + 4, cy + 2, r * 0.7, c0);
      B.circle(x, cy, r * 0.85, c1); B.circle(x - 2, cy + 1, r * 0.55, c1); B.circle(x + 3, cy + 1, r * 0.55, c1);
      B.circle(x - 1, cy - r * 0.35, r * 0.4, c2);
      break;
    }
    case 'pine': case 'snowpine': {
      const H = 18 * s | 0;
      B.rect(x, top - 3, 2, 3, [60, 40, 26]);
      for (let i = 0; i < H; i++) {
        const half = Math.floor((i % 6 + i / 3) * 0.55) + 1;
        const y = top - 3 - H + i;
        B.hline(x + 1 - half, x + half, y, c1);
        B.px(x + half, y, c0); B.px(x + half - 1, y, c0);
        if (T.deco === 'snowpine' && i % 6 === 0) B.hline(x + 1 - half, x, y, c2);
        else if (i % 6 === 0) B.px(x + 1 - half, y, c2);
      }
      break;
    }
    case 'cactus': {
      const H = 13 * s | 0, g0 = [47, 90, 46], g1 = [67, 120, 58], g2 = [106, 154, 76];
      B.rect(x - 1, top - H, 3, H, g1); B.hline(x - 1, x - 1, top - H, g2); B.rect(x + 1, top - H, 1, H, g0);
      for (let k = 0; k < H; k += 3) B.px(x, top - H + k, g2);
      B.rect(x - 4, top - H * 0.55 | 0, 3, 2, g1); B.rect(x - 4, top - H * 0.55 - 4 | 0, 2, 4, g1);
      B.rect(x + 2, top - H * 0.4 | 0, 3, 2, g0); B.rect(x + 4, top - H * 0.4 - 3 | 0, 2, 4, g0);
      break;
    }
    case 'palm': {
      const H = 16 * s | 0;
      let tx = x;
      for (let i = 0; i < H; i++) { tx = x + Math.round(Math.sin(i * 0.16) * 3); B.px(tx, top - i, i % 3 ? [130, 88, 48] : [96, 64, 36]); B.px(tx + 1, top - i, [96, 64, 36]); }
      const ty = top - H;
      for (const dir of [-1, 1]) for (let i = 0; i < 9; i++) { const yy = ty + Math.round(i * i * 0.07); B.px(tx + dir * i, yy, c1); B.px(tx + dir * i, yy + 1, c0); if (i % 3 === 1) B.px(tx + dir * i, yy - 1, c2); }
      B.circle(tx, ty + 1, 1.5, [90, 60, 36]);
      break;
    }
    case 'crystal': {
      const H = 12 * s | 0, col = [[200, 60, 120], [60, 190, 210], [150, 80, 220]][R() * 3 | 0];
      for (let i = 0; i < H; i++) { const hw = Math.floor(i / 3); B.hline(x - hw, x + hw, top - H + i, col); B.px(x + hw, top - H + i, mix(col, BLACK, 0.4)); B.px(x - hw, top - H + i, mix(col, WHITE, 0.4)); }
      break;
    }
  }
}

// ============================================================ state
let S = null; // current match state

function newState(opts) {
  return {
    mode: opts.mode, // 'sp' | 'mp'
    url: opts.url,
    room: opts.room || null,
    running: false, paused: false, ready: false,
    VW: 1280, VH: 720, scale: 1,
    worldW: 1280, worldH: 720,
    blocks: [], grid: null, gcols: 0, grows: 0,
    totalArea: 1, destroyedArea: 0, destroyedCount: 0,
    burning: new Set(),
    players: new Map(), me: null,
    projectiles: [], particles: [], beams: [], words: [], debris: [], dgrid: new Map(),
    cam: { x: 0, y: 0, shake: 0 },
    bands: [], nb: 0, artW: 0, artSeed: 0, low: null, lctx: null,
    stamp: 1,
    pendingBlk: [], lastNet: 0,
    stats: { shots: 0, blocks: 0, time: 0 },
    feed: [],
  };
}

// ============================================================ input
const keys = new Set();
const HINT_IDLE_MS = 3000;
let lastInput = performance.now();
const touchInput = () => { lastInput = performance.now(); };
const mouse = { x: 0, y: 0, down: false, rdown: false };
let showScore = false;

function isJumpKey(c) { return c === 'Space' || c === 'KeyW' || c === 'ArrowUp'; }

window.addEventListener('keydown', (e) => {
  if (!S || !S.running) return;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  touchInput();
  if (e.code === 'Escape') { togglePause(); return; }
  if (e.code === 'Tab') { showScore = true; renderScore(); $('#score').classList.remove('hidden'); return; }
  if (S.paused) return;
  if (!e.repeat && isJumpKey(e.code)) onJumpPress();
  if (/^Digit[1-7]$/.test(e.code)) selectWeapon(+e.code.slice(5) - 1);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') { showScore = false; $('#score').classList.add('hidden'); }
});
window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });

game.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
game.addEventListener('mousedown', (e) => {
  Sound.init();
  touchInput();
  if (!S || S.paused) return;
  if (e.button === 0) mouse.down = true;
  if (e.button === 2) throwGrenade();
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
game.addEventListener('contextmenu', (e) => e.preventDefault());
game.addEventListener('wheel', (e) => {
  e.preventDefault();
  touchInput();
  if (!S || !S.me || S.paused) return;
  const d = e.deltaY > 0 ? 1 : -1;
  selectWeapon((S.me.weapon + d + WEAPONS.length) % WEAPONS.length);
}, { passive: false });

function worldMouse() {
  return { x: mouse.x / S.scale + S.cam.x, y: mouse.y / S.scale + S.cam.y };
}

// ============================================================ loading a website
async function startGame(opts) {
  Sound.init();
  S = newState(opts);
  menu.classList.add('hidden');
  game.classList.remove('hidden');
  $('#loading').classList.remove('hidden');
  $('#loadTxt').textContent = 'Fetching page…';
  $('#over').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#center').textContent = '';
  $('#feed').innerHTML = '';
  $('#roomTxt').textContent = S.mode === 'mp' ? `ROOM ${S.room}` : '';
  buildWeaponBar();

  // viewport / stage sizing: world width is fixed at start so layout never changes
  S.VW = S.mode === 'mp' ? MP_WIDTH : clamp(window.innerWidth, 900, 1920);
  layoutStage();

  const src = opts.url === 'demo' ? '/demo.html'
    : S.mode === 'mp' ? `/proxy?room=${encodeURIComponent(S.room)}`
    : `/proxy?url=${encodeURIComponent(opts.url)}`;
  const myState = S;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    iframe.onload = finish;
    setTimeout(finish, 20000);
    iframe.src = src;
  });
  if (S !== myState) return;
  $('#loadTxt').textContent = 'Loading images & fonts…';
  const doc = iframe.contentDocument;
  try { await Promise.race([doc.fonts ? doc.fonts.ready : 0, wait(2500)]); } catch {}
  await waitImages(doc, 4000);
  if (S !== myState) return;
  $('#loadTxt').textContent = 'Making everything breakable…';
  await wait(30);
  prepareDom(doc);
  await nextFrame(); await nextFrame();
  collectBlocks();
  initArt();
  spawnLocal();
  $('#loading').classList.add('hidden');
  S.running = true; S.ready = true;
  lastInput = performance.now() - HINT_IDLE_MS; // show hints right away on a fresh level
  if (S.mode === 'mp') net.send({ t: 'hello' });
  flashCenter(S.mode === 'mp' ? `FIRST TO ${net.room ? net.room.firstTo : 10} KILLS` : 'DESTROY EVERYTHING!', 1800);
  setTimeout(() => { if (S === myState) remeasure(); }, 2500);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
function waitImages(doc, ms) {
  const imgs = [...doc.images].filter((i) => !i.complete);
  if (!imgs.length) return Promise.resolve();
  return Promise.race([wait(ms), Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; })))]);
}

function layoutStage() {
  S.scale = window.innerWidth / S.VW;
  S.VH = Math.ceil(window.innerHeight / S.scale);
  stage.style.width = S.VW + 'px';
  stage.style.height = S.VH + 'px';
  stage.style.transform = `scale(${S.scale})`;
  iframe.style.width = S.VW + 'px';
  iframe.style.height = S.VH + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(S.VW * dpr * S.scale);
  cvs.height = Math.round(S.VH * dpr * S.scale);
  cvs.style.width = S.VW + 'px';
  cvs.style.height = S.VH + 'px';
  S.dpr = dpr * S.scale;
  if (!S.low) { S.low = document.createElement('canvas'); S.lctx = S.low.getContext('2d'); }
  S.low.width = Math.ceil(S.VW / U) + 2;
  S.low.height = Math.ceil(S.VH / U) + 2;
}
let resizeT;
window.addEventListener('resize', () => {
  if (!S) return;
  layoutStage();
  clearTimeout(resizeT);
  resizeT = setTimeout(() => S && S.ready && remeasure(), 400);
});

const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'OPTION', 'SELECT', 'TITLE', 'HEAD', 'TEMPLATE', 'IFRAME', 'OBJECT']);
const LEAF_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'INPUT', 'SELECT', 'TEXTAREA', 'HR', 'PROGRESS', 'METER', 'OBJECT', 'EMBED', 'AUDIO']);
const XHTML = 'http://www.w3.org/1999/xhtml';

function prepareDom(doc) {
  const win = doc.defaultView;
  const st = doc.createElement('style');
  st.textContent = `html{overflow:hidden!important;scroll-behavior:auto!important;scrollbar-width:none!important}
    body{overflow:visible!important}
    ::-webkit-scrollbar{display:none!important}
    *{transition:none!important;cursor:none!important;caret-color:transparent!important}
    .__w{}`;
  (doc.head || doc.documentElement).appendChild(st);
  if (!doc.body) return;
  // make fixed/sticky things part of the page so they can be stood on & destroyed
  for (const el of doc.body.getElementsByTagName('*')) {
    const cs = win.getComputedStyle(el);
    if (cs.position === 'fixed') el.style.setProperty('position', 'absolute', 'important');
    else if (cs.position === 'sticky') el.style.setProperty('position', 'relative', 'important');
  }
  // wrap every word in a span so each word is a destructible platform
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (!p || SKIP_TEXT.has(p.tagName) || p.namespaceURI !== XHTML) continue;
    if (!/\S/.test(n.nodeValue)) continue;
    nodes.push(n);
  }
  let count = 0;
  for (const tn of nodes) {
    if (count > MAX_WORDS) break;
    const txt = tn.nodeValue;
    const parts = txt.match(/\s+|\S+\s*/g);
    if (!parts) continue;
    const frag = doc.createDocumentFragment();
    for (const part of parts) {
      if (!/\S/.test(part)) { frag.appendChild(doc.createTextNode(part)); continue; }
      const sp = doc.createElement('span');
      sp.className = '__w';
      sp.textContent = part;
      frag.appendChild(sp);
      count++;
    }
    tn.parentNode.replaceChild(frag, tn);
  }
}

function alphaOf(c) {
  if (!c || c === 'transparent') return 0;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const p = m[1].split(/[ ,/]+/).filter(Boolean);
  return p.length > 3 ? parseFloat(p[3]) : 1;
}

function collectBlocks() {
  const doc = iframe.contentDocument, win = doc.defaultView;
  win.scrollTo(0, 0);
  const de = doc.documentElement;
  S.worldW = Math.max(S.VW, de.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
  S.worldH = clamp(Math.max(S.VH, de.scrollHeight, doc.body ? doc.body.scrollHeight : 0), S.VH, MAX_WORLD_H);
  const blocks = [];
  const vpArea = S.VW * S.VH;
  const add = (el, kind, r) => {
    const x = r.left + win.scrollX, y = r.top + win.scrollY, w = r.width, h = r.height;
    if (w < 2 || h < 2 || y > S.worldH || x > S.worldW || x + w < 0 || y + h < 0) return;
    let hp;
    if (kind === 'word') hp = 10;
    else if (kind === 'media') hp = clamp((w * h) / 220, 14, 260);
    else if (kind === 'ctrl') hp = 24;
    else hp = clamp((w * h) / 140, 18, 420);
    const b = { i: blocks.length, el, kind, x, y, w, h, hp, max: hp, alive: true, stamp: 0, burn: 0, parent: -1 };
    el.__bi = b.i;
    blocks.push(b);
  };
  if (doc.body) {
    const all = doc.body.getElementsByTagName('*');
    for (let k = 0; k < all.length; k++) {
      const el = all[k];
      // invisible things (collapsed menus, hidden tooltips...) must not become invisible platforms
      const par = el.parentElement;
      if (par && par.__hid) { el.__hid = true; continue; }
      if (el.classList && el.classList.contains('__w')) {
        const rs = el.getClientRects();
        if (rs.length === 0) continue;
        add(el, 'word', el.getBoundingClientRect());
        continue;
      }
      const tag = el.tagName.toUpperCase();
      if (el.namespaceURI !== XHTML && tag !== 'SVG') continue; // inner svg nodes
      if (LEAF_TAGS.has(tag)) {
        if (el.closest && el.closest('svg') && tag !== 'SVG') continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height > 0) add(el, tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'HR' ? 'ctrl' : 'media', r);
        continue;
      }
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') { el.__hid = true; continue; }
      const hasBg = alphaOf(cs.backgroundColor) > 0.05 || (cs.backgroundImage && cs.backgroundImage !== 'none');
      const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && alphaOf(cs.borderTopColor) > 0.05 ||
        parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none' && alphaOf(cs.borderBottomColor) > 0.05;
      if (!(hasBg || hasBorder || tag === 'BUTTON')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.width * r.height > vpArea * 0.55) continue;
      add(el, tag === 'BUTTON' ? 'ctrl' : 'box', r);
    }
  }
  S.blocks = blocks;
  // parent links (for container destruction)
  for (const b of blocks) {
    let p = b.el.parentElement;
    while (p && p.__bi === undefined) p = p.parentElement;
    if (p && blocks[p.__bi] && blocks[p.__bi].el === p) b.parent = p.__bi;
  }
  buildGrid();
  S.totalArea = 0;
  for (const b of blocks) S.totalArea += Math.min(b.w * b.h, 60000);
  S.totalArea = Math.max(S.totalArea, 1);
}

function remeasure() {
  const doc = iframe.contentDocument;
  if (!doc || !S) return;
  const win = doc.defaultView;
  const sx = win.scrollX, sy = win.scrollY;
  for (const b of S.blocks) {
    if (!b.alive) continue;
    const r = b.el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    b.x = r.left + sx; b.y = r.top + sy; b.w = r.width; b.h = r.height;
  }
  buildGrid();
}

function buildGrid() {
  S.gcols = Math.ceil(S.worldW / CELL) + 1;
  S.grows = Math.ceil(S.worldH / CELL) + 1;
  S.grid = new Array(S.gcols * S.grows);
  for (const b of S.blocks) {
    if (!b.alive) continue;
    const c0 = clamp(Math.floor(b.x / CELL), 0, S.gcols - 1), c1 = clamp(Math.floor((b.x + b.w) / CELL), 0, S.gcols - 1);
    const r0 = clamp(Math.floor(b.y / CELL), 0, S.grows - 1), r1 = clamp(Math.floor((b.y + b.h) / CELL), 0, S.grows - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const k = r * S.gcols + c;
      (S.grid[k] || (S.grid[k] = [])).push(b);
    }
  }
}

// iterate unique alive blocks overlapping rect
function queryRect(x, y, w, h, fn) {
  const stamp = ++S.stamp;
  const c0 = clamp(Math.floor(x / CELL), 0, S.gcols - 1), c1 = clamp(Math.floor((x + w) / CELL), 0, S.gcols - 1);
  const r0 = clamp(Math.floor(y / CELL), 0, S.grows - 1), r1 = clamp(Math.floor((y + h) / CELL), 0, S.grows - 1);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const cell = S.grid[r * S.gcols + c];
    if (!cell) continue;
    for (const b of cell) {
      if (!b.alive || b.stamp === stamp) continue;
      b.stamp = stamp;
      if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) if (fn(b) === false) return;
    }
  }
}

// innermost block containing point
function blockAt(x, y) {
  if (x < 0 || y < 0 || x >= S.worldW || y >= S.worldH) return null;
  const cell = S.grid[Math.floor(y / CELL) * S.gcols + Math.floor(x / CELL)];
  if (!cell) return null;
  let best = null, ba = Infinity;
  for (const b of cell) {
    if (!b.alive) continue;
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
      const a = b.w * b.h;
      if (a < ba) { ba = a; best = b; }
    }
  }
  return best;
}

// ============================================================ art / holes
// The hidden world is split into horizontal bands that are generated lazily the first time
// something is destroyed there. Each band has: art (the landscape), reveal (art copied where
// holes are) and scorch (burn marks drawn on top of the page around craters).
function initArt() {
  S.artW = Math.ceil(S.worldW / PX);
  S.nb = Math.ceil(S.worldH / PX / BAND_H);
  S.bands = [];
  S.artSeed = hashStr(S.url || 'x') >>> 0;
}

function band(i) {
  let b = S.bands[i];
  if (!b) {
    const mk = () => { const c = document.createElement('canvas'); c.width = S.artW; c.height = BAND_H; return c; };
    const reveal = mk(), scorch = mk();
    b = S.bands[i] = { art: makeBandArt(S.artW, BAND_H, S.artSeed, i), reveal, scorch, rctx: reveal.getContext('2d'), sctx: scorch.getContext('2d') };
  }
  return b;
}

// run fn(bandObj, localY) for art-row y, clipping x
function row(y, fn) {
  if (y < 0 || y >= S.nb * BAND_H) return;
  const bi = Math.floor(y / BAND_H);
  fn(band(bi), y - bi * BAND_H);
}
function revealRow(x, y, w) {
  if (x < 0) { w += x; x = 0; }
  w = Math.min(w, S.artW - x);
  if (w <= 0) return;
  row(y, (b, ly) => { b.sctx.clearRect(x, ly, w, 1); b.rctx.drawImage(b.art, x, ly, w, 1, x, ly, w, 1); });
}
function paintRow(which, x, y, w, style) {
  if (w <= 0) return;
  row(y, (b, ly) => { const g = which === 's' ? b.sctx : b.rctx; g.fillStyle = style; g.fillRect(x, ly, w, 1); });
}

const SCORCH_OUT = 'rgba(28,18,14,0.32)', SCORCH_IN = 'rgba(18,10,8,0.5)';
const EMBERS = ['#7a2a14', '#a8401a', '#c86a28'];
const HOLE_SHADE = 'rgba(0,0,0,0.42)', HOLE_SHADE2 = 'rgba(0,0,0,0.2)', HOLE_LIT = 'rgba(255,255,255,0.10)';

// circular crater (world coords)
function holeCircle(wx, wy, wr, scorch = true) {
  const cx = Math.round(wx / PX), cy = Math.round(wy / PX), r = Math.max(1, Math.round(wr / PX));
  if (scorch && r > 3) {
    const r1 = r + 3 + Math.floor(r * 0.22), r2 = r + 2;
    for (let dy = -r1; dy <= r1; dy++) {
      const dx = Math.floor(Math.sqrt(r1 * r1 - dy * dy) + (Math.random() * 2 - 1));
      paintRow('s', cx - dx, cy + dy, dx * 2 + 1, SCORCH_OUT);
    }
    for (let dy = -r2; dy <= r2; dy++) {
      const dx = Math.floor(Math.sqrt(r2 * r2 - dy * dy));
      paintRow('s', cx - dx, cy + dy, dx * 2 + 1, SCORCH_IN);
    }
    for (let i = 0; i < r * 1.5; i++) {
      const a = Math.random() * TAU, d = r + 1 + Math.random() * 2;
      paintRow('s', Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1, EMBERS[(Math.random() * 3) | 0]);
    }
  }
  const rows = [];
  for (let dy = -r; dy <= r; dy++) {
    const jitter = r > 4 ? Math.round(Math.random() * 2 - 1) : 0;
    const dx = Math.max(0, Math.floor(Math.sqrt(r * r - dy * dy)) + jitter);
    rows.push(dx);
    revealRow(cx - dx, cy + dy, dx * 2 + 1);
  }
  // inner wall shading: light comes from top-left, so the top/left rim is in shadow
  if (r >= 3) {
    for (let k = 0; k < rows.length; k++) {
      const dx = rows[k], y = cy - r + k;
      paintRow('r', cx - dx, y, 2, HOLE_SHADE);
      paintRow('r', cx + dx, y, 1, HOLE_LIT);
      if (k < 2) paintRow('r', cx - dx, y, dx * 2 + 1, k === 0 ? HOLE_SHADE : HOLE_SHADE2);
    }
  }
}

// ragged rectangular hole where a destroyed element used to be
function holeRect(b) {
  const x0 = Math.floor(b.x / PX), x1 = Math.ceil((b.x + b.w) / PX);
  const y0 = Math.floor(b.y / PX), y1 = Math.ceil((b.y + b.h) / PX);
  const big = b.kind !== 'word' && x1 - x0 > 10 && y1 - y0 > 6;
  for (let y = y0; y < y1; y++) {
    const edge = big ? Math.round(Math.random() * 1.4) : 0;
    const x = x0 + edge, w = Math.max(1, x1 - x0 - edge * 2 + Math.round(Math.random() * edge));
    revealRow(x, y, w);
    if (big) { paintRow('r', x, y, 1, HOLE_SHADE); paintRow('r', x + w - 1, y, 1, HOLE_LIT); }
  }
  if (big) { paintRow('r', x0, y0, x1 - x0, HOLE_SHADE); paintRow('r', x0, y0 + 1, x1 - x0, HOLE_SHADE2); }
}

// ============================================================ damage & destruction
function damageBlock(b, dmg, hx, hy, local) {
  if (!b.alive) return;
  b.hp -= dmg;
  if (b.kind !== 'word' && hx !== undefined) {
    holeCircle(hx, hy, dmg > 20 ? 6 : 3, false);
    if (b.kind === 'media' || b.kind === 'ctrl') shakeEl(b);
  }
  if (b.hp <= 0) destroyBlock(b, local);
  else if (b.kind === 'word') b.el.style.opacity = String(0.35 + 0.65 * (b.hp / b.max));
}

function shakeEl(b) {
  const el = b.el;
  const dmgK = 1 - b.hp / b.max;
  el.style.transform = `translate(${rand(-2, 2)}px,${rand(-2, 2)}px) rotate(${(dmgK * rand(-4, 4)).toFixed(2)}deg)`;
}

function destroyBlock(b, local, quiet) {
  if (!b.alive) return;
  b.alive = false;
  b.el.style.visibility = 'hidden';
  S.destroyedArea += Math.min(b.w * b.h, 60000);
  S.destroyedCount++;
  S.burning.delete(b);
  holeRect(b);
  if (local && S.mode === 'mp') S.pendingBlk.push(b.i);
  if (!quiet) {
    spawnDebris(b);
    if (inView(b.x + b.w / 2, b.y + b.h / 2)) Sound.play('break', 0.7);
  }
  // container destroyed -> everything inside goes too
  if (b.kind === 'box' || b.kind === 'ctrl') {
    const inner = b.el.getElementsByTagName('*');
    let n = 0;
    for (const el of inner) {
      const cb = el.__bi !== undefined ? S.blocks[el.__bi] : null;
      if (cb && cb.alive && cb.el === el) { destroyBlock(cb, false, n++ > 25); }
    }
  }
}

// ---- flying words & piling shards
// IMP describes the force that is destroying things right now; callers set it around damageBlock():
//   { dx, dy, f }  -> directional push (bullets, rail)
//   { x, y, f }    -> radial push from a point (explosions)
let IMP = null;
const MAX_WORDS_FLYING = 260;
const MAX_DEBRIS = 1100;
const DCELL = 32;

function impulseAt(cx, cy) {
  if (!IMP) return { vx: rand(-120, 120), vy: rand(-340, -180) };
  let dx = IMP.dx, dy = IMP.dy;
  if (IMP.x !== undefined) {
    const ddx = cx - IMP.x, ddy = cy - IMP.y, d = Math.hypot(ddx, ddy) || 1;
    dx = ddx / d; dy = ddy / d;
  }
  return { vx: dx * IMP.f, vy: dy * IMP.f - IMP.f * 0.45 - 60 };
}

// ---- words: the actual word is knocked off the page and tumbles away
function launchWord(b, cs) {
  const text = b.el.textContent.trim();
  if (!text) return;
  if (S.words.length >= MAX_WORDS_FLYING) S.words.shift();
  const fs = parseFloat(cs.fontSize) || 16;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const { vx, vy } = impulseAt(cx, cy);
  const k = rand(0.75, 1.25);
  S.words.push({
    text: text.slice(0, 48), font: `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`, col: cs.color,
    under: /underline/.test(cs.textDecorationLine || cs.textDecoration || ''),
    x: cx, y: cy, w: b.w, h: Math.max(8, b.h), vx: vx * k, vy: vy * k, rot: 0,
    vr: (Math.sign(vx) || 1) * rand(5, 15) * (Math.random() < 0.15 ? -1 : 1),
    life: rand(2.6, 3.6), max: 3.6, rest: false,
  });
}

function updateWords(dt) {
  const W = S.words;
  let j = 0;
  for (let i = 0; i < W.length; i++) {
    const w = W[i];
    w.life -= dt;
    if (w.life <= 0 || w.y > S.worldH + 200 || w.x < -300 || w.x > S.worldW + 300) continue;
    if (!w.rest) {
      w.vy = Math.min(w.vy + GRAV * dt, 1400);
      w.vx *= 1 - 0.4 * dt;
      w.rot += w.vr * dt;
      const r = w.h / 2;
      const prevB = w.y + r;
      w.x += w.vx * dt; w.y += w.vy * dt;
      if (w.vy > 0) {
        const top = surfaceBelow(w.x - w.w * 0.25, w.x + w.w * 0.25, prevB, w.y + r, null);
        if (top !== null) {
          w.y = top - r;
          if (w.vy > 220) { w.vy *= -0.38; w.vx *= 0.7; w.vr *= -0.6; puff(w.x, top, 2); }
          else { w.vy = 0; w.rest = true; }
        }
      }
    } else {
      // slide to a stop, fall flat (upright or upside-down)
      w.vx *= Math.pow(0.02, dt);
      w.x += w.vx * dt;
      const flat = Math.round(w.rot / Math.PI) * Math.PI;
      w.rot = lerp(w.rot, flat, Math.min(1, dt * 14));
      if (Math.random() < dt * 4 && surfaceBelow(w.x - w.w * 0.25, w.x + w.w * 0.25, w.y + w.h / 2 - 2, w.y + w.h / 2 + 2, null) === null) w.rest = false;
    }
    W[j++] = w;
  }
  W.length = j;
}

function drawWords(g, vx, vy) {
  for (const w of S.words) {
    if (!inView(w.x, w.y, 200)) continue;
    const a = Math.min(1, w.life / 0.6);
    g.save();
    g.globalAlpha = a;
    g.translate(Math.round(w.x - vx), Math.round(w.y - vy));
    g.rotate(Math.round(w.rot / (Math.PI / 12)) * (Math.PI / 12)); // stepped rotation = sprite feel
    g.font = w.font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(10,8,16,0.45)'; g.fillText(w.text, 2, 2);
    g.fillStyle = w.col; g.fillText(w.text, 0, 0);
    if (w.under) g.fillRect(-w.w / 2, w.h * 0.32, w.w, 1);
    g.restore();
  }
  g.globalAlpha = 1;
}

// ---- shards: images / boxes crack into pieces that keep their real pixels and pile up
function shatter(b, cs) {
  const el = b.el, tag = el.tagName.toUpperCase();
  let src = null, SW = 0, SH = 0;
  if (tag === 'IMG' && el.complete && el.naturalWidth) { src = el; SW = el.naturalWidth; SH = el.naturalHeight; }
  else if (tag === 'CANVAS' && el.width) { src = el; SW = el.width; SH = el.height; }
  else if (tag === 'VIDEO' && el.videoWidth) { src = el; SW = el.videoWidth; SH = el.videoHeight; }
  const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && alphaOf(cs.borderTopColor) > 0.1;
  const edge = hasBorder ? cs.borderTopColor : null;
  // solid colour, or the stops of a background gradient sampled by height
  let stops = null;
  if (alphaOf(cs.backgroundColor) >= 0.1) stops = [cs.backgroundColor];
  else if (cs.backgroundImage && cs.backgroundImage !== 'none') {
    const cols = (cs.backgroundImage.match(/rgba?\([^)]*\)/g) || []).filter((c) => alphaOf(c) >= 0.1);
    if (cols.length) stops = cols;
  }
  const borderOnly = !src && !stops && edge;
  if (!stops) stops = [edge || (b.kind === 'media' ? '#8a8ca0' : '#c8c8d0')];
  const fillAt = (fy) => stops[Math.min(stops.length - 1, Math.floor(fy * stops.length))];

  const area = b.w * b.h;
  const target = clamp(Math.round(area / 420), 3, 44);
  const ps = clamp(Math.sqrt(area / target), 6, 28);
  const cols = clamp(Math.round(b.w / ps), 1, 40), rows = clamp(Math.round(b.h / ps), 1, 40);
  const pieces = [];
  const cut = (n) => { const a = [0]; for (let i = 1; i < n; i++) a.push((i + rand(-0.32, 0.32)) / n); a.push(1); return a; };
  const xs = cut(cols);
  for (let c = 0; c < cols; c++) {
    const ys = cut(rows); // different horizontal cuts per column -> brick-like cracks
    for (let r = 0; r < rows; r++) {
      const onEdge = c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
      if (borderOnly && !onEdge) continue; // hollow frame: only the border breaks off
      const fx = b.x + xs[c] * b.w, fy = b.y + ys[r] * b.h;
      const fw = Math.max(3, (xs[c + 1] - xs[c]) * b.w), fh = Math.max(3, (ys[r + 1] - ys[r]) * b.h);
      const cx = fx + fw / 2, cy = fy + fh / 2;
      const { vx, vy } = impulseAt(cx, cy);
      const k = rand(0.35, 1.05);
      pieces.push({
        x: cx, y: cy, w: fw, h: fh, vx: vx * k + rand(-70, 70), vy: vy * k + rand(-80, 30), rot: 0, vr: rand(-9, 9),
        src, sx: xs[c] * SW, sy: ys[r] * SH, sw: (xs[c + 1] - xs[c]) * SW, sh: (ys[r + 1] - ys[r]) * SH,
        fill: fillAt((ys[r] + ys[r + 1]) / 2), edge: edge && onEdge && !borderOnly ? edge : null,
        rest: false, check: rand(0, 0.3), cells: null,
      });
    }
  }
  // big elements: keep a random subset as solid shards, the rest turns to dust
  const KEEP = 56;
  for (let i = pieces.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pieces[i], pieces[j]] = [pieces[j], pieces[i]]; }
  pieces.forEach((d, i) => { if (i < KEEP) addDebris(d); else if (i < KEEP + 14) puff(d.x, d.y, 1); });
}

function addDebris(d) {
  if (S.debris.length >= MAX_DEBRIS) {
    // drop the oldest piece to keep things fast
    const old = S.debris.shift();
    dgridRemove(old);
  }
  S.debris.push(d);
}

// settled shards live in a coarse grid so others can land on them
function dgridAdd(d) {
  const x0 = Math.floor((d.x - d.rw / 2) / DCELL), x1 = Math.floor((d.x + d.rw / 2) / DCELL);
  const y0 = Math.floor((d.y - d.rh / 2) / DCELL), y1 = Math.floor((d.y + d.rh / 2) / DCELL);
  d.cells = [];
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const k = cy * 65536 + cx;
    let a = S.dgrid.get(k);
    if (!a) S.dgrid.set(k, (a = []));
    a.push(d); d.cells.push(k);
  }
}
function dgridRemove(d) {
  if (!d.cells) return;
  for (const k of d.cells) { const a = S.dgrid.get(k); if (a) { const i = a.indexOf(d); if (i >= 0) a.splice(i, 1); if (!a.length) S.dgrid.delete(k); } }
  d.cells = null;
}

// highest landing surface whose top lies in [y0, y1] under the span [x0, x1]: page elements, piles, floor
let SURF_X0 = 0, SURF_X1 = 0; // horizontal extent of the last surface found
function surfaceBelow(x0, x1, y0, y1, self) {
  if (y1 >= S.worldH) { SURF_X0 = -1e9; SURF_X1 = 1e9; return S.worldH; }
  let best = null;
  queryRect(x0, y0 - 1, Math.max(1, x1 - x0), y1 - y0 + 2, (b) => {
    if (b.y >= y0 - 0.5 && b.y <= y1 && (best === null || b.y < best)) { best = b.y; SURF_X0 = b.x; SURF_X1 = b.x + b.w; }
  });
  const cx0 = Math.floor(x0 / DCELL), cx1 = Math.floor(x1 / DCELL), cy0 = Math.floor((y0 - 1) / DCELL), cy1 = Math.floor(y1 / DCELL);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const a = S.dgrid.get(cy * 65536 + cx);
    if (!a) continue;
    for (const o of a) {
      if (o === self) continue;
      const top = o.y - o.rh / 2;
      if (top >= y0 - 0.5 && top <= y1 && o.x + o.rw / 2 > x0 && o.x - o.rw / 2 < x1 && (best === null || top < best)) { best = top; SURF_X0 = o.x - o.rw / 2; SURF_X1 = o.x + o.rw / 2; }
    }
  }
  return best;
}

function updateDebris(dt) {
  const D = S.debris;
  let j = 0;
  for (let i = 0; i < D.length; i++) {
    const d = D[i];
    if (d.y > S.worldH + 100 || d.x < -200 || d.x > S.worldW + 200) { dgridRemove(d); continue; }
    if (d.rest) {
      d.check -= dt;
      if (d.check <= 0) {
        d.check = 0.25 + Math.random() * 0.1;
        const bot = d.y + d.rh / 2;
        if (surfaceBelow(d.x - d.rw * 0.3, d.x + d.rw * 0.3, bot - 2, bot + 2, d) === null) {
          d.rest = false; dgridRemove(d); d.vy = 0; d.vx = rand(-30, 30); d.vr = rand(-3, 3);
        }
      }
    } else {
      d.vy = Math.min(d.vy + GRAV * dt, 1400);
      d.vx *= 1 - 0.5 * dt;
      d.rot += d.vr * dt;
      const r = Math.min(d.w, d.h) / 2;
      const prevB = d.y + r;
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.x < r) { d.x = r; d.vx = Math.abs(d.vx) * 0.4; }
      if (d.x > S.worldW - r) { d.x = S.worldW - r; d.vx = -Math.abs(d.vx) * 0.4; }
      if (d.vy > 0) {
        const half = Math.min(d.w, d.h) * 0.35;
        const top = surfaceBelow(d.x - half, d.x + half, prevB, d.y + r, d);
        if (top !== null) {
          if (d.vy > 240) {
            d.y = top - r; d.vy *= -0.3; d.vx *= 0.55; d.vr *= -0.5;
            if (Math.random() < 0.5) puff(d.x, top, 1);
            if (inView(d.x, top) && Math.random() < 0.3) Sound.play('bounce', 0.4);
          } else if (d.x < SURF_X0 - 1 || d.x > SURF_X1 + 1) {
            // centre of mass hangs over the edge -> tip over and slide off
            const dir = d.x < SURF_X0 ? -1 : 1;
            d.y = top - r; d.vy = 0; d.vx = dir * rand(60, 120); d.vr = dir * rand(3, 6); d.x += dir * 2;
          } else {
            // settle lying down: long side horizontal, on the nearest matching quarter turn
            let q = Math.round(d.rot / (Math.PI / 2));
            if ((Math.abs(q) % 2 === 1) !== (d.h > d.w * 1.15)) q += d.rot > q * (Math.PI / 2) ? 1 : -1;
            d.rot = q * (Math.PI / 2);
            const swap = Math.abs(q) % 2 === 1;
            d.rw = swap ? d.h : d.w; d.rh = swap ? d.w : d.h;
            d.y = top - d.rh / 2; d.vx = d.vy = d.vr = 0;
            d.rest = true; d.check = 0.3;
            dgridAdd(d);
          }
        }
      }
    }
    D[j++] = d;
  }
  D.length = j;
}

// explosions kick piles and tumbling words back into the air
function blastDebris(x, y, radius) {
  const R2 = radius * 1.3;
  for (const d of S.debris) {
    const dx = d.x - x, dy = d.y - y, dist = Math.hypot(dx, dy);
    if (dist > R2) continue;
    const k = (1 - dist / R2) * 700;
    if (d.rest) { d.rest = false; dgridRemove(d); }
    d.vx += (dx / (dist || 1)) * k + rand(-40, 40); d.vy += (dy / (dist || 1)) * k - k * 0.5; d.vr = rand(-12, 12);
  }
  for (const w of S.words) {
    const dx = w.x - x, dy = w.y - y, dist = Math.hypot(dx, dy);
    if (dist > R2) continue;
    const k = (1 - dist / R2) * 700;
    w.rest = false; w.vx += (dx / (dist || 1)) * k; w.vy += (dy / (dist || 1)) * k - k * 0.5; w.vr = rand(-14, 14);
    w.life = Math.max(w.life, 1.5);
  }
}

function drawDebris(L) {
  for (const d of S.debris) {
    if (!inView(d.x, d.y, 80)) continue;
    const w = Math.max(1, Math.round(d.w / U)), h = Math.max(1, Math.round(d.h / U));
    const x0 = -(w >> 1), y0 = -(h >> 1);
    L.save();
    L.translate(lx(d.x), ly(d.y));
    L.rotate(d.rest ? d.rot : Math.round(d.rot / (Math.PI / 8)) * (Math.PI / 8));
    L.fillStyle = INK; L.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
    let drawn = false;
    if (d.src && d.sw >= 1 && d.sh >= 1) { try { L.drawImage(d.src, d.sx, d.sy, d.sw, d.sh, x0, y0, w, h); drawn = true; } catch {} }
    if (!drawn) { L.fillStyle = d.fill || '#8a8ca0'; L.fillRect(x0, y0, w, h); }
    if (d.edge) { L.fillStyle = d.edge; L.fillRect(x0, y0, w, 1); L.fillRect(x0, y0, 1, h); }
    // bevel so every shard reads as a chunky 3D piece
    L.fillStyle = 'rgba(255,255,255,0.3)'; L.fillRect(x0, y0, w, 1); L.fillRect(x0, y0 + 1, 1, h - 1);
    L.fillStyle = 'rgba(0,0,0,0.32)'; L.fillRect(x0, y0 + h - 1, w, 1); L.fillRect(x0 + w - 1, y0, 1, h - 1);
    L.restore();
  }
}

function puff(x, y, n) {
  for (let i = 0; i < n; i++) S.particles.push({ t: 'smoke', x: x + rand(-6, 6), y: y - rand(0, 4), vx: rand(-50, 50), vy: rand(-50, -10), s: rand(5, 9), life: rand(0.35, 0.6), max: 0.6 });
}

// replaces the old confetti: words fly, solid things shatter
function spawnDebris(b) {
  let cs;
  try { cs = iframe.contentWindow.getComputedStyle(b.el); } catch { return; }
  // impact pop: a quick white frame where the element was
  S.particles.push({ t: 'pop', x: b.x, y: b.y, w: b.w, h: b.h, life: 0.14, max: 0.14 });
  if (b.kind === 'word') {
    launchWord(b, cs);
    puff(b.x + b.w / 2, b.y + b.h / 2, 1);
  } else {
    shatter(b, cs);
    const n = clamp(Math.round(b.w / 24), 2, 10);
    for (let i = 0; i < n; i++) puff(b.x + rand(0, b.w), b.y + b.h, 1);
    for (let i = 0; i < 6; i++) S.particles.push({ t: 'spark', x: b.x + rand(0, b.w), y: b.y + rand(0, b.h), vx: rand(-200, 200), vy: rand(-260, 40), life: rand(0.2, 0.4), max: 0.4, col: '#e8eaf2' });
  }
}

function inView(x, y, m = 80) {
  return x > S.cam.x - m && x < S.cam.x + S.VW + m && y > S.cam.y - m && y < S.cam.y + S.VH + m;
}
function volAt(x, y) {
  const cx = S.cam.x + S.VW / 2, cy = S.cam.y + S.VH / 2;
  const d = Math.hypot(x - cx, y - cy);
  return clamp(1 - d / 1600, 0, 1);
}

function explode(x, y, radius, dmg, owner, weaponName) {
  const local = owner === S.me.id;
  holeCircle(x, y, radius * 0.55);
  IMP = { x, y: y + 12, f: 260 + radius * 4 };
  queryRect(x - radius, y - radius, radius * 2, radius * 2, (b) => {
    const nx = clamp(x, b.x, b.x + b.w), ny = clamp(y, b.y, b.y + b.h);
    const d = Math.hypot(nx - x, ny - y);
    if (d > radius) return;
    damageBlock(b, dmg * (1 - (d / radius) * 0.6), undefined, undefined, local);
  });
  IMP = null;
  blastDebris(x, y, radius);
  for (const p of S.players.values()) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - x, p.y - PH / 2 - y);
    if (d > radius) continue;
    const k = 1 - d / radius;
    const ang = Math.atan2(p.y - PH / 2 - y, p.x - x);
    if (p === S.me) {
      p.vx += Math.cos(ang) * 700 * k; p.vy += Math.sin(ang) * 700 * k - 150 * k;
      p.onGround = false;
      hurtMe(dmg * k * (owner === p.id ? 0.35 : 1), owner, weaponName);
    }
  }
  // fx
  const P = S.particles;
  P.push({ t: 'flash', x, y, r: radius * 0.3, R: radius * 1.1, life: 0.25, max: 0.25 });
  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU), s = rand(60, 380);
    P.push({ t: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, s: rand(4, 10), life: rand(0.3, 0.7), max: 0.7 });
  }
  for (let i = 0; i < 14; i++) {
    const a = rand(0, TAU), s = rand(20, 120);
    P.push({ t: 'smoke', x: x + rand(-20, 20), y: y + rand(-20, 20), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, s: rand(8, 18), life: rand(0.8, 1.6), max: 1.6 });
  }
  for (let i = 0; i < 12; i++) {
    const a = rand(0, TAU), s = rand(200, 600);
    P.push({ t: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.5), max: 0.5 });
  }
  S.cam.shake = Math.min(24, S.cam.shake + radius / 6 * volAt(x, y));
  Sound.play('explode', volAt(x, y));
}

// ============================================================ players
function makePlayer(id, name, color) {
  return { id, name, color, x: 100, y: 100, vx: 0, vy: 0, onGround: false, facing: 1, aim: 0,
    weapon: 0, cd: 0, gcd: 0, hp: 100, dead: false, respawnT: 0, invuln: 0,
    airJump: false, flip: 0, flipDir: 1, jetting: false, jumpAt: 0, run: 0, hurtT: 0,
    lastHit: null, lastWeapon: '', kills: 0, deaths: 0, tx: 0, ty: 0, remote: false };
}

function spawnLocal() {
  const id = S.mode === 'mp' ? net.id : 'me';
  const color = S.mode === 'mp' ? net.color : '#ff3b3b';
  const name = S.mode === 'mp' ? net.name : 'You';
  const me = makePlayer(id, name, color);
  S.me = me;
  S.players.set(id, me);
  respawn(me, true);
  S.cam.x = clamp(me.x - S.VW / 2, 0, Math.max(0, S.worldW - S.VW));
  S.cam.y = clamp(me.y - S.VH * 0.55, 0, Math.max(0, S.worldH - S.VH));
}

function respawn(p, first) {
  // pick a random word/box top to stand on
  const cands = S.blocks.filter((b) => b.alive && b.w >= 14 && b.y > 30 && (first ? b.y < S.VH * 0.9 : true) && b.y < S.worldH - 10);
  let x = rand(40, S.VW - 40), y = 60;
  if (cands.length) {
    const b = cands[Math.floor(Math.random() * cands.length)];
    x = b.x + b.w / 2; y = b.y - 1;
  }
  Object.assign(p, { x, y: y - 40, vx: 0, vy: 0, hp: 100, dead: false, invuln: 2, onGround: false, flip: 0, lastHit: null });
  if (!first) Sound.play('spawn', 0.8);
  for (let i = 0; i < 16; i++) S.particles.push({ t: 'spark', x: p.x, y: p.y - 20, vx: rand(-200, 200), vy: rand(-200, 200), life: 0.4, max: 0.4, col: p.color });
}

function onJumpPress() {
  const p = S.me;
  if (!p || p.dead) return;
  p.jumpAt = S.stats.time;
  if (p.onGround || p.coyote > 0) {
    p.vy = -JUMP_V; p.onGround = false; p.coyote = 0; p.airJump = true;
    Sound.play('jump');
  } else if (p.airJump) {
    p.vy = -FLIP_V; p.airJump = false; p.flip = 1; p.flipDir = p.facing;
    Sound.play('jump', 1.2);
  }
}

function selectWeapon(i) {
  if (!S.me || S.me.weapon === i) return;
  S.me.weapon = i;
  Sound.play('switch');
  updateWeaponBar();
}

function hurtMe(dmg, by, weaponName) {
  const p = S.me;
  if (p.dead || p.invuln > 0 || dmg <= 0) return;
  p.hp -= dmg;
  p.hurtT = 0.2;
  if (by !== p.id) { p.lastHit = by; p.lastWeapon = weaponName; }
  Sound.play('hurt', 0.7);
  bloodAt(p.x, p.y - PH / 2, p.color, 6);
  if (p.hp <= 0) killMe();
}

function killMe() {
  const p = S.me;
  p.hp = 0; p.dead = true; p.respawnT = 2.2; p.deaths++;
  Sound.play('die');
  gib(p);
  const by = p.lastHit;
  if (S.mode === 'mp') net.send({ t: 'killed', by: by || p.id, weapon: p.lastWeapon || 'self' });
  else addFeed(`<b style="color:${p.color}">You</b> blew yourself up`);
}

function gib(p) {
  for (let i = 0; i < 18; i++) S.particles.push({ t: 'chunk', col: i % 3 ? p.color : '#111', x: p.x, y: p.y - PH / 2, s: rand(3, 6), vx: rand(-300, 300), vy: rand(-500, -100), rot: 0, vr: rand(-10, 10), life: rand(1, 2), max: 2, g: 1 });
  bloodAt(p.x, p.y - PH / 2, p.color, 14);
}
function bloodAt(x, y, col, n) {
  for (let i = 0; i < n; i++) S.particles.push({ t: 'spark', x, y, vx: rand(-220, 220), vy: rand(-260, 60), life: rand(0.2, 0.5), max: 0.5, col });
}

// platform landing test: returns top y of landing surface or null
function findLanding(p, prevY, newY) {
  if (newY >= S.worldH) return S.worldH;
  const dropping = keys.has('KeyS') || keys.has('ArrowDown') ? p === S.me : p.dropping;
  if (dropping) return null;
  let best = null;
  queryRect(p.x - PW / 2 + 1, prevY - 1, PW - 2, newY - prevY + 2, (b) => {
    if (b.y >= prevY - 0.5 && b.y <= newY && (best === null || b.y < best)) best = b.y;
  });
  return best;
}

// still standing on something? (with a small step-up so you can walk along uneven text lines)
function supported(p) {
  if (p.y >= S.worldH - 0.5) return true;
  let best = null;
  queryRect(p.x - PW / 2 + 1, p.y - 7, PW - 2, 9, (b) => { if (b.y >= p.y - 6 && b.y <= p.y + 1.5 && (best === null || b.y < best)) best = b.y; });
  if (best === null) return false;
  p.y = best;
  return true;
}

function updateMe(dt) {
  const p = S.me;
  if (keys.size || mouse.down) touchInput();
  if (p.dead) {
    p.respawnT -= dt;
    if (p.respawnT <= 0) respawn(p);
    return;
  }
  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const jumpHeld = keys.has('Space') || keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  const accel = p.onGround ? 3200 : 1500;
  const want = target * RUN;
  if (p.vx < want) p.vx = Math.min(want, p.vx + accel * dt);
  else if (p.vx > want) p.vx = Math.max(want, p.vx - accel * dt);

  const m = worldMouse();
  p.aim = Math.atan2(m.y - (p.y - SHOULDER), m.x - p.x);
  p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;

  // jetpack: hold jump in the air
  p.jetting = false;
  if (jumpHeld && !p.onGround && S.stats.time - p.jumpAt > 0.2) { // unlimited jetpack
    p.vy = Math.max(-JET_MAXUP, p.vy - JET_ACC * dt);
    p.jetting = true;
    if (Math.random() < 0.8) S.particles.push({ t: 'fire', x: p.x - p.facing * 7 + rand(-2, 2), y: p.y - 20, vx: rand(-30, 30), vy: rand(200, 320), s: rand(3, 5), life: 0.25, max: 0.25 });
    Sound.play('jet', 0.5);
  }

  if (p.flip > 0) p.flip = Math.max(0, p.flip - dt / 0.45);

  // drop through
  if (down && p.onGround && p.y < S.worldH - 1) { p.onGround = false; p.y += 2; }

  p.vy = Math.min(p.vy + GRAV * dt, 1300);
  movePlayer(p, dt);

  p.run += Math.abs(p.vx) * dt * 0.05;

  // shooting
  p.cd -= dt; p.gcd -= dt;
  if (mouse.down && p.cd <= 0) {
    const w = WEAPONS[p.weapon];
    p.cd = w.rate;
    const mz = muzzle(p);
    const seed = (Math.random() * 1e9) | 0;
    fire(p, p.weapon, mz.x, mz.y, p.aim, seed, m.x, m.y);
    if (S.mode === 'mp') net.send({ t: 'f', w: p.weapon, x: mz.x, y: mz.y, a: p.aim, s: seed, tx: m.x, ty: m.y });
    // recoil
    if (w.type === 'rail' || w.type === 'rocket' || w.name === 'SHOTGUN') { p.vx -= Math.cos(p.aim) * 120; if (!p.onGround) p.vy -= Math.sin(p.aim) * 120; }
  }
}

function movePlayer(p, dt) {
  const steps = Math.ceil(Math.abs(p.vy * dt) / 8) || 1;
  const sdt = dt / steps;
  if (p.coyote > 0) p.coyote -= dt;
  for (let s = 0; s < steps; s++) {
    p.x += p.vx * sdt;
    if (p.x < PW / 2) { p.x = PW / 2; p.vx = 0; }
    if (p.x > S.worldW - PW / 2) { p.x = S.worldW - PW / 2; p.vx = 0; }
    const prevY = p.y;
    if (p.onGround) {
      if (!supported(p)) { p.onGround = false; p.coyote = 0.08; }
      else { p.vy = 0; continue; }
    }
    p.y += p.vy * sdt;
    if (p.y - PH < 0) { p.y = PH; p.vy = Math.max(0, p.vy); }
    if (p.vy >= 0) {
      const land = findLanding(p, prevY, p.y);
      if (land !== null) {
        p.y = land; p.vy = 0; p.onGround = true; p.airJump = false; p.flip = 0;
      }
    }
  }
}

function muzzle(p) {
  const w = WEAPONS[p.weapon];
  const len = 9 + w.gun;
  return { x: p.x + Math.cos(p.aim) * len, y: p.y - SHOULDER + Math.sin(p.aim) * len };
}

function throwGrenade() {
  const p = S.me;
  if (!p || p.dead || p.gcd > 0) return;
  p.gcd = GRENADE.cd;
  const m = muzzle(p);
  const vx = Math.cos(p.aim) * 620 + p.vx * 0.5, vy = Math.sin(p.aim) * 620 + p.vy * 0.3 - 120;
  spawnGrenade(p.id, m.x, m.y, vx, vy);
  if (S.mode === 'mp') net.send({ t: 'g', x: m.x, y: m.y, vx, vy });
}
function spawnGrenade(owner, x, y, vx, vy) {
  S.projectiles.push({ t: 'grenade', owner, x, y, vx, vy, life: GRENADE.fuse, rot: 0 });
  Sound.play('throw', volAt(x, y));
}

// ============================================================ weapons
function fire(p, wi, x, y, ang, seed, tx, ty) {
  const w = WEAPONS[wi];
  const R = mulberry32(seed);
  const owner = p.id;
  const vol = volAt(x, y);
  Sound.play(w.sfx, vol);
  S.stats.shots++;
  p.muzzleT = 0.06;
  switch (w.type) {
    case 'bullet':
      for (let i = 0; i < w.count; i++) {
        const a = ang + (R() - 0.5) * w.spread * 2;
        const sp = w.speed * (w.count > 1 ? 0.8 + R() * 0.4 : 1);
        S.projectiles.push({ t: 'bullet', owner, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: w.dmg, life: w.life || 1.2, wn: w.name });
      }
      // shell casing
      S.particles.push({ t: 'chunk', col: '#e0b040', x: p.x, y: p.y - SHOULDER, s: 2, vx: -p.facing * rand(60, 140), vy: rand(-260, -160), rot: 0, vr: 20, life: 0.8, max: 0.8, g: 1 });
      break;
    case 'rocket':
      S.projectiles.push({ t: 'rocket', owner, x, y, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed, ang, life: 4, dmg: w.dmg, radius: w.radius, wn: w.name });
      break;
    case 'missile':
      for (let i = 0; i < w.count; i++) {
        const a = ang + (i - (w.count - 1) / 2) * 0.35 - 0.15 * Math.cos(ang) * 0;
        S.projectiles.push({ t: 'missile', owner, x, y, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed - 80, ang: a, life: 3.2, dmg: w.dmg, radius: w.radius,
          tx: tx + (R() - 0.5) * 60, ty: ty + (R() - 0.5) * 60, delay: 0.12 + i * 0.05, wn: w.name });
      }
      break;
    case 'flame':
      for (let i = 0; i < 2; i++) {
        const a = ang + (R() - 0.5) * w.spread * 2;
        const sp = w.speed * (0.75 + R() * 0.5);
        S.projectiles.push({ t: 'flame', owner, x, y, vx: Math.cos(a) * sp + p.vx * 0.3, vy: Math.sin(a) * sp, dmg: w.dmg, life: 0.5 + R() * 0.15, max: 0.65, wn: w.name, hit: new Set() });
      }
      break;
    case 'rail': {
      const local = owner === S.me.id;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let ex = x, ey = y;
      const hitB = new Set(), hitP = new Set();
      for (let d = 0; d < 2600; d += 4) {
        ex = x + dx * d; ey = y + dy * d;
        if (ex < 0 || ey < 0 || ex > S.worldW || ey > S.worldH) break;
        const b = blockAt(ex, ey);
        if (b && !hitB.has(b)) { hitB.add(b); IMP = { dx, dy, f: 750 }; damageBlock(b, w.dmg, ex, ey, local); IMP = null; }
        if (d % 8 === 0) holeCircle(ex, ey, 7, false);
        for (const q of S.players.values()) {
          if (q.id === owner || q.dead || hitP.has(q)) continue;
          if (Math.abs(ex - q.x) < PW / 2 + 2 && ey > q.y - PH && ey < q.y) {
            hitP.add(q);
            if (q === S.me) hurtMe(w.dmg, owner, w.name);
            else bloodAt(ex, ey, q.color, 10);
          }
        }
      }
      S.beams.push({ x1: x, y1: y, x2: ex, y2: ey, life: 0.35, max: 0.35, col: p.color });
      for (let i = 0; i < 24; i++) { const t = Math.random(); S.particles.push({ t: 'spark', x: lerp(x, ex, t), y: lerp(y, ey, t), vx: rand(-60, 60), vy: rand(-60, 60), life: rand(0.2, 0.5), max: 0.5, col: '#aef' }); }
      S.cam.shake = Math.min(20, S.cam.shake + 6 * vol);
      break;
    }
  }
}

function hitPlayerAt(x, y, owner) {
  for (const q of S.players.values()) {
    if (q.id === owner || q.dead || q.invuln > 0) continue;
    if (x > q.x - PW / 2 - 1 && x < q.x + PW / 2 + 1 && y > q.y - PH && y < q.y) return q;
  }
  return null;
}

function updateProjectiles(dt) {
  const PR = S.projectiles;
  for (let i = PR.length - 1; i >= 0; i--) {
    const pr = PR[i];
    pr.life -= dt;
    let dead = pr.life <= 0;
    const local = pr.owner === S.me.id;
    if (pr.t === 'bullet') {
      const dist = Math.hypot(pr.vx, pr.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / 5));
      for (let s = 0; s < steps && !dead; s++) {
        pr.x += pr.vx * dt / steps; pr.y += pr.vy * dt / steps;
        if (pr.x < 0 || pr.y < 0 || pr.x > S.worldW || pr.y > S.worldH) { dead = true; break; }
        const q = hitPlayerAt(pr.x, pr.y, pr.owner);
        if (q) { dead = true; if (q === S.me) hurtMe(pr.dmg, pr.owner, pr.wn); else bloodAt(pr.x, pr.y, q.color, 4); Sound.play('hit', volAt(pr.x, pr.y)); break; }
        const b = blockAt(pr.x, pr.y);
        if (b) {
          dead = true;
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          IMP = { dx: pr.vx / sp, dy: pr.vy / sp, f: 380 + pr.dmg * 6 };
          damageBlock(b, pr.dmg, pr.x, pr.y, local);
          IMP = null;
          for (let k = 0; k < 3; k++) S.particles.push({ t: 'spark', x: pr.x, y: pr.y, vx: -pr.vx * 0.1 + rand(-120, 120), vy: -pr.vy * 0.1 + rand(-120, 120), life: rand(0.1, 0.25), max: 0.25 });
        }
      }
      pr.px = pr.x - pr.vx * 0.012; pr.py = pr.y - pr.vy * 0.012;
    } else if (pr.t === 'rocket' || pr.t === 'missile') {
      if (pr.t === 'missile') {
        if (pr.delay > 0) { pr.delay -= dt; pr.vy += 300 * dt; }
        else {
          const want = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
          let da = want - pr.ang; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
          const turned = pr.ang + clamp(da, -6 * dt, 6 * dt);
          const sp = Math.min(900, Math.hypot(pr.vx, pr.vy) + 1400 * dt);
          pr.vx = Math.cos(turned) * sp; pr.vy = Math.sin(turned) * sp;
          if (Math.hypot(pr.tx - pr.x, pr.ty - pr.y) < 14) pr.life = 0;
        }
      } else {
        const sp = Math.min(1300, Math.hypot(pr.vx, pr.vy) + 900 * dt);
        pr.vx = Math.cos(pr.ang) * sp; pr.vy = Math.sin(pr.ang) * sp;
      }
      pr.ang = Math.atan2(pr.vy, pr.vx);
      const dist = Math.hypot(pr.vx, pr.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / 6));
      for (let s = 0; s < steps; s++) {
        pr.x += pr.vx * dt / steps; pr.y += pr.vy * dt / steps;
        pr.dist = (pr.dist || 0) + dist / steps;
        const armed = pr.dist > 22; // don't blow up in your own face on the line of text you stand next to
        if (pr.x < 0 || pr.y < 0 || pr.x > S.worldW || pr.y > S.worldH || (armed && blockAt(pr.x, pr.y)) || hitPlayerAt(pr.x, pr.y, pr.owner)) { pr.life = 0; break; }
      }
      if (Math.random() < 0.9) S.particles.push({ t: 'smoke', x: pr.x - Math.cos(pr.ang) * 8, y: pr.y - Math.sin(pr.ang) * 8, vx: rand(-15, 15), vy: rand(-25, 0), s: pr.t === 'rocket' ? rand(4, 7) : rand(2, 4), life: 0.6, max: 0.6 });
      S.particles.push({ t: 'fire', x: pr.x - Math.cos(pr.ang) * 8, y: pr.y - Math.sin(pr.ang) * 8, vx: -pr.vx * 0.1, vy: -pr.vy * 0.1, s: 3, life: 0.08, max: 0.1 });
      if (pr.life <= 0) { explode(pr.x, pr.y, pr.radius, pr.dmg, pr.owner, pr.wn); dead = true; }
    } else if (pr.t === 'flame') {
      pr.vx *= 1 - 1.8 * dt; pr.vy = pr.vy * (1 - 1.8 * dt) - 240 * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      const b = blockAt(pr.x, pr.y);
      if (b && !pr.hit.has(b)) {
        pr.hit.add(b);
        IMP = { dx: pr.vx > 0 ? 0.3 : -0.3, dy: -0.95, f: 200 };
        damageBlock(b, pr.dmg, undefined, undefined, local);
        IMP = null;
        if (b.alive) { b.burn = 2.5; if (S.burning.size < 400) S.burning.add(b); }
        pr.vx *= 0.3; pr.vy *= 0.3;
      }
      const q = hitPlayerAt(pr.x, pr.y, pr.owner);
      if (q && !pr.hit.has(q)) { pr.hit.add(q); if (q === S.me) { hurtMe(pr.dmg * 1.6, pr.owner, pr.wn); q.burnT = 1.2; q.burnBy = pr.owner; } }
    } else if (pr.t === 'grenade') {
      pr.vy += GRAV * 0.9 * dt;
      pr.rot += pr.vx * dt * 0.05;
      const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
      if (nx < 3 || nx > S.worldW - 3) { pr.vx *= -0.6; }
      else pr.x = nx;
      if (pr.vy > 0) {
        let top = ny >= S.worldH - 3 ? S.worldH - 3 : null;
        if (top === null) queryRect(pr.x - 2, pr.y, 4, ny - pr.y + 3, (b) => { if (b.y >= pr.y + 2 && (top === null || b.y < top)) top = b.y - 3; });
        if (top !== null && ny >= top) {
          pr.y = top; pr.vy *= -0.45; pr.vx *= 0.7;
          if (Math.abs(pr.vy) > 60) Sound.play('bounce', volAt(pr.x, pr.y));
          if (Math.abs(pr.vy) < 40) pr.vy = 0;
        } else pr.y = ny;
      } else pr.y = Math.max(3, ny);
      if (pr.life <= 0) { explode(pr.x, pr.y, GRENADE.radius, GRENADE.dmg, pr.owner, GRENADE.name); dead = true; }
    }
    if (dead) PR.splice(i, 1);
  }
}

function updateBurning(dt) {
  for (const b of S.burning) {
    if (!b.alive) { S.burning.delete(b); continue; }
    b.burn -= dt;
    IMP = { dx: rand(-0.3, 0.3), dy: -1, f: 160 };
    damageBlock(b, 9 * dt, undefined, undefined, false);
    IMP = null;
    if (Math.random() < 0.5 && S.particles.length < 2400) S.particles.push({ t: 'fire', x: b.x + rand(0, b.w), y: b.y + rand(0, b.h), vx: rand(-20, 20), vy: rand(-120, -50), s: rand(3, 6), life: rand(0.3, 0.6), max: 0.6 });
    // spread
    if (Math.random() < 0.6 * dt && S.burning.size < 400) {
      queryRect(b.x - 16, b.y - 8, b.w + 32, b.h + 16, (o) => { if (o.burn <= 0 && Math.random() < 0.3) { o.burn = 1.6; S.burning.add(o); return false; } });
    }
    if (b.burn <= 0) S.burning.delete(b);
  }
  const me = S.me;
  if (me.burnT > 0 && !me.dead) {
    me.burnT -= dt;
    hurtMe(10 * dt, me.burnBy, 'FLAMER');
    if (Math.random() < 0.6) S.particles.push({ t: 'fire', x: me.x + rand(-5, 5), y: me.y - rand(0, PH), vx: 0, vy: -100, s: 4, life: 0.3, max: 0.3 });
  }
}

function updateParticles(dt) {
  const P = S.particles;
  let j = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    if (p.t === 'flash' || p.t === 'pop') { P[j++] = p; continue; }
    if (p.g) p.vy += GRAV * 0.8 * dt;
    if (p.t === 'smoke') { p.vx *= 1 - dt; p.vy -= 30 * dt; p.s += 12 * dt; }
    if (p.t === 'fire') { p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt; p.vy -= 60 * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.vr) p.rot += p.vr * dt;
    if (p.g && p.y > S.worldH - 2) { p.y = S.worldH - 2; p.vy *= -0.3; p.vx *= 0.6; }
    P[j++] = p;
  }
  P.length = j;
  for (let i = S.beams.length - 1; i >= 0; i--) if ((S.beams[i].life -= dt) <= 0) S.beams.splice(i, 1);
}

// ============================================================ remote players
function updateRemotes(dt) {
  for (const p of S.players.values()) {
    if (!p.remote) continue;
    const k = 1 - Math.pow(0.0005, dt);
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 200) { p.x = p.tx; p.y = p.ty; }
    p.x = lerp(p.x, p.tx + p.vx * 0.05, k);
    p.y = lerp(p.y, p.ty + p.vy * 0.05, k);
    p.run += Math.abs(p.vx) * dt * 0.05;
    if (p.flip > 0) p.flip = Math.max(0, p.flip - dt / 0.45);
    p.hurtT = Math.max(0, (p.hurtT || 0) - dt);
    p.invuln = Math.max(0, (p.invuln || 0) - dt);
    p.muzzleT = Math.max(0, (p.muzzleT || 0) - dt);
    if (p.jetting && Math.random() < 0.7) S.particles.push({ t: 'fire', x: p.x - p.facing * 7, y: p.y - 20, vx: rand(-30, 30), vy: rand(200, 320), s: rand(3, 5), life: 0.25, max: 0.25 });
  }
}

// ============================================================ sprites (32-bit style, 1 char = 1 pixel)
const SPR_PAL = {
  k: INK, d: '#3a3a4c', m: '#6a6c80', l: '#a8acc0', x: '#e8eaf2',
  w: '#5e3a22', W: '#8e6038', g: '#46552a', G: '#76863f', b: '#27386e', B: '#6ad0f6',
  r: '#7e1c20', R: '#d0444a', y: '#f2c43c', o: '#e87a2a',
};
function sprite(rows) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (SPR_PAL[ch]) { g.fillStyle = SPR_PAL[ch]; g.fillRect(x, y, 1, 1); } }));
  return c;
}
// guns: grip on the left, barrel pointing right; `ay` = row the hand holds
const GUN_SPR = [
  { ay: 2, rows: [
    'kkkkkkkk',
    'klllllxk',
    'kmmmmmdk',
    'kdkkkkk.',
    'kdk.....',
    'kkk.....'] },
  { ay: 2, rows: [
    '.kkkkkkkkkk',
    'kmlllllllxk',
    'kdmmmmmmmdk',
    '.kdkkdkkkk.',
    '..kdk.kdk..',
    '..kkk.kkk..'] },
  { ay: 2, rows: [
    'kkkkkkkkkkkkk',
    'kWWWkmllllllk',
    'kwwwkdmmmmmmk',
    '.kkwwkkkkkkk.',
    '...kkk.......'] },
  { ay: 2, rows: [
    '..kkkkkkkkkkkk',
    'kkGGGGGGGGGGGk',
    'kdggggggggggdk',
    'kkgggdgggggggk',
    '..kkkdkkkkkkk.',
    '....kkk.......'] },
  { ay: 2, rows: [
    '.kkkkkkkkkkkkk.',
    'kbbbbbbbbbbbxBk',
    'kdmmmmmmmmmmmdk',
    'kBBBBBBBBBBBBbk',
    '.kkkdkkkkkkkkk.',
    '...kkk.........'] },
  { ay: 2, rows: [
    '.kkkkk......',
    'kRRRRkkkkkk.',
    'krrrrkmllllk',
    'krrrrkdmmmdk',
    '.kkkdkkkkkk.',
    '...kkk......'] },
  { ay: 3, rows: [
    'kkkkkkkkkkk',
    'kmllllkRyRk',
    'kmmmmmkrkrk',
    'kmmmmmkRyRk',
    'kdddddkrkrk',
    'kkkdkkkkkkk',
    '..kkk......'] },
].map((s) => ({ ...s, c: sprite(s.rows), w: s.rows[0].length, h: s.rows.length }));
GUN_SPR.forEach((s, i) => { WEAPONS[i].gun = s.w * U; });

const ROCKET_SPR = sprite(['kk.kkkkk.', 'yokGGGGlk', 'yokgggmxk', 'kk.kkkkk.']);
const MISSILE_SPR = sprite(['kkkkkk.', 'yklllxk', 'kkkkkk.']);
const GRENADE_SPR = sprite(['.kmk.', 'kkkkk', 'kGgGk', 'kgGgk', 'kGggk', '.kkk.']);
const FIRE_RAMP = ['#fff6d0', '#ffe070', '#ffa838', '#e8582a', '#a8301c', '#521812'];
const SMOKE_RAMP = ['#8a8494', '#6e6878', '#57525f', '#423e4a'];

const shadeCache = new Map();
function shadesOf(col) {
  let s = shadeCache.get(col);
  if (!s) {
    const c = hex(col);
    s = { hi: css(mix(c, WHITE, 0.45)), base: col, sh: css(mix(c, BLACK, 0.38)), dk: css(mix(c, BLACK, 0.6)) };
    shadeCache.set(col, s);
  }
  return s;
}

// ============================================================ camera & render
function updateCamera(dt) {
  const me = S.me;
  const m = { x: mouse.x / S.scale, y: mouse.y / S.scale };
  const lookX = (m.x - S.VW / 2) * 0.25, lookY = (m.y - S.VH / 2) * 0.25;
  const tx = clamp(me.x - S.VW / 2 + lookX, 0, Math.max(0, S.worldW - S.VW));
  const ty = clamp(me.y - S.VH * 0.55 + lookY, 0, Math.max(0, S.worldH - S.VH));
  const k = 1 - Math.pow(0.002, dt);
  S.cam.x = lerp(S.cam.x, tx, k);
  S.cam.y = lerp(S.cam.y, ty, k);
  S.cam.shake = Math.max(0, S.cam.shake - dt * 40);
  const sx = S.cam.shake ? rand(-S.cam.shake, S.cam.shake) * 0.5 : 0;
  const sy = S.cam.shake ? rand(-S.cam.shake, S.cam.shake) * 0.5 : 0;
  S.view = { x: Math.round(S.cam.x + sx), y: Math.round(S.cam.y + sy) };
  const win = iframe.contentWindow;
  if (win) {
    const vx = clamp(S.view.x, 0, Math.max(0, S.worldW - S.VW)), vy = clamp(S.view.y, 0, Math.max(0, S.worldH - S.VH));
    if (win.scrollX !== vx || win.scrollY !== vy) win.scrollTo(vx, vy);
    S.view.x = win.scrollX + (S.view.x - vx);
    S.view.y = win.scrollY + (S.view.y - vy);
    iframe.style.transform = sx || sy ? `translate(${-(S.view.x - win.scrollX)}px,${-(S.view.y - win.scrollY)}px)` : '';
  }
}

// low-res helpers (fx buffer: 1 px = U world px, aligned to the world grid)
let LO = { ox: 0, oy: 0 };
const lx = (x) => Math.round((x - LO.ox) / U);
const ly = (y) => Math.round((y - LO.oy) / U);

function pixCircle(L, cx, cy, r, col) {
  L.fillStyle = col;
  for (let dy = -Math.floor(r); dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy)); L.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1); }
}
function pixLine(L, x0, y0, x1, y1, size) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  const o = (size - 1) >> 1;
  for (;;) {
    L.fillRect(x0 - o, y0 - o, size, size);
    if ((x0 === x1 && y0 === y1) || ++n > 4000) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function render() {
  const g = ctx, d = S.dpr;
  const vx = S.view.x, vy = S.view.y;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, S.VW, S.VH);
  g.imageSmoothingEnabled = false;
  // hidden world: scorch marks, then revealed art
  const ay0 = vy / PX;
  const b0 = Math.max(0, Math.floor(ay0 / BAND_H)), b1 = Math.min(S.nb - 1, Math.floor((ay0 + S.VH / PX) / BAND_H));
  for (let bi = b0; bi <= b1; bi++) {
    const b = S.bands[bi];
    if (!b) continue;
    const dy = bi * BAND_H * PX - vy;
    g.drawImage(b.scorch, -vx, dy, S.artW * PX, BAND_H * PX);
    g.drawImage(b.reveal, -vx, dy, S.artW * PX, BAND_H * PX);
  }

  // fx layer at 1/U resolution
  const L = S.lctx;
  LO = { ox: Math.floor(vx / U) * U, oy: Math.floor(vy / U) * U };
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.clearRect(0, 0, S.low.width, S.low.height);
  L.imageSmoothingEnabled = false;
  drawDebris(L);
  drawParticles(L);
  drawBeams(L);
  drawProjectiles(L);
  for (const p of S.players.values()) if (!p.dead && inView(p.x, p.y - 20)) drawStickman(L, p);
  drawIndicators(L, vx, vy);
  drawCrosshair(L, vx, vy);
  drawWords(g, vx, vy);
  g.drawImage(S.low, LO.ox - vx, LO.oy - vy, S.low.width * U, S.low.height * U);

  // crisp full-res overlays
  g.translate(-vx, -vy);
  if (S.mode === 'mp') for (const p of S.players.values()) if (!p.dead && inView(p.x, p.y - 20)) nameTag(g, p);
  g.setTransform(d, 0, 0, d, 0, 0);
  if (S.me.hurtT > 0) {
    const a = S.me.hurtT * 2;
    g.fillStyle = `rgba(160,20,30,${a * 0.5})`;
    for (let i = 0; i < 3; i++) { const w = 6 + i * 6; g.globalAlpha = 1 - i * 0.3; g.fillRect(0, 0, S.VW, w - i * 4); g.fillRect(0, S.VH - w + i * 4, S.VW, w - i * 4); g.fillRect(0, 0, w - i * 4, S.VH); g.fillRect(S.VW - w + i * 4, 0, w - i * 4, S.VH); }
    g.globalAlpha = 1;
  }
}

function drawParticles(L) {
  for (const p of S.particles) {
    if (!inView(p.x, p.y, 60)) continue;
    const a = clamp(p.life / p.max, 0, 1);
    const x = lx(p.x), y = ly(p.y);
    switch (p.t) {
      case 'char':
        L.save(); L.translate(x, y); L.rotate(Math.round(p.rot / (Math.PI / 4)) * (Math.PI / 4));
        L.globalAlpha = Math.min(1, a * 1.6);
        L.font = p.fontLo || (p.fontLo = p.font.replace(/([\d.]+)px/, (m, n) => Math.max(5, Math.round(n / U)) + 'px'));
        L.textAlign = 'center'; L.textBaseline = 'middle';
        L.fillStyle = INK; L.fillText(p.ch, 1, 1);
        L.fillStyle = p.col; L.fillText(p.ch, 0, 0);
        L.restore(); break;
      case 'chunk': {
        const s = Math.max(2, Math.round(p.s / U));
        L.globalAlpha = Math.min(1, a * 1.6);
        L.fillStyle = INK; L.fillRect(x - 1, y - 1, s + 2, s + 2);
        L.fillStyle = p.col; L.fillRect(x, y, s, s);
        const flip = (Math.floor(p.rot * 2) & 3);
        L.fillStyle = 'rgba(255,255,255,0.4)'; L.fillRect(flip & 1 ? x + s - 1 : x, flip & 2 ? y + s - 1 : y, 1, 1);
        L.fillStyle = 'rgba(0,0,0,0.35)'; L.fillRect(flip & 1 ? x : x + s - 1, flip & 2 ? y : y + s - 1, 1, 1);
        break;
      }
      case 'smoke': {
        const s = Math.max(2, Math.round(p.s / U));
        L.globalAlpha = a * 0.55;
        L.fillStyle = SMOKE_RAMP[Math.min(3, Math.floor((1 - a) * 4))];
        L.fillRect(x - (s >> 1), y - (s >> 1) + 1, s, s - 2);
        L.fillRect(x - (s >> 1) + 1, y - (s >> 1), s - 2, s);
        break;
      }
      case 'fire': {
        const s = Math.max(1, Math.round((p.s * (0.45 + a * 0.7)) / U));
        L.globalAlpha = 1;
        L.fillStyle = FIRE_RAMP[Math.min(5, Math.floor((1 - a) * 6))];
        L.fillRect(x - (s >> 1), y - (s >> 1), s, s);
        break;
      }
      case 'spark':
        L.globalAlpha = Math.min(1, a * 1.4);
        L.fillStyle = p.col || FIRE_RAMP[a > 0.5 ? 0 : 1];
        L.fillRect(x, y, 1, 1);
        L.fillRect(x - Math.sign(p.vx), y - Math.sign(p.vy), 1, 1);
        break;
      case 'pop': {
        const x0 = lx(p.x) - 1, y0 = ly(p.y) - 1, w = Math.round(p.w / U) + 2, h = Math.round(p.h / U) + 2;
        L.globalAlpha = a;
        L.fillStyle = 'rgba(255,255,255,0.35)'; L.fillRect(x0, y0, w, h);
        L.fillStyle = '#ffffff'; L.fillRect(x0, y0, w, 1); L.fillRect(x0, y0 + h - 1, w, 1); L.fillRect(x0, y0, 1, h); L.fillRect(x0 + w - 1, y0, 1, h);
        break;
      }
      case 'flash': {
        const t = 1 - a, R = lerp(p.r, p.R, Math.sqrt(t)) / U;
        L.globalAlpha = 1;
        if (t < 0.85) pixCircle(L, x, y, R, FIRE_RAMP[Math.min(5, 3 + Math.floor(t * 3))]);
        if (t < 0.7) pixCircle(L, x, y, R * 0.78, FIRE_RAMP[2 + Math.floor(t * 2)]);
        if (t < 0.5) pixCircle(L, x, y, R * 0.55, FIRE_RAMP[1]);
        if (t < 0.3) pixCircle(L, x, y, R * 0.32, FIRE_RAMP[0]);
        break;
      }
    }
  }
  L.globalAlpha = 1;
}

function drawBeams(L) {
  for (const b of S.beams) {
    const a = b.life / b.max;
    const x0 = lx(b.x1), y0 = ly(b.y1), x1 = lx(b.x2), y1 = ly(b.y2);
    L.globalAlpha = a;
    L.fillStyle = shadesOf(b.col).sh; pixLine(L, x0, y0, x1, y1, a > 0.5 ? 5 : 3);
    L.fillStyle = b.col; pixLine(L, x0, y0, x1, y1, 3);
    L.fillStyle = a > 0.4 ? '#ffffff' : shadesOf(b.col).hi; pixLine(L, x0, y0, x1, y1, 1);
  }
  L.globalAlpha = 1;
}

function drawProjectiles(L) {
  for (const pr of S.projectiles) {
    if (!inView(pr.x, pr.y)) continue;
    const x = lx(pr.x), y = ly(pr.y);
    switch (pr.t) {
      case 'bullet': {
        const tx = lx(pr.px ?? pr.x), ty = ly(pr.py ?? pr.y);
        L.fillStyle = '#c8782a'; pixLine(L, tx, ty, x, y, 1);
        L.fillStyle = '#ffe070'; pixLine(L, lerp(tx, x, 0.5), lerp(ty, y, 0.5), x, y, 1);
        L.fillStyle = '#ffffff'; L.fillRect(x, y, 1, 1);
        break;
      }
      case 'rocket': case 'missile': {
        const spr = pr.t === 'rocket' ? ROCKET_SPR : MISSILE_SPR;
        L.save(); L.translate(x, y); L.rotate(Math.round(pr.ang / (Math.PI / 8)) * (Math.PI / 8));
        L.drawImage(spr, -spr.width / 2 | 0, -spr.height / 2 | 0);
        L.restore(); break;
      }
      case 'flame': {
        const a = clamp(pr.life / pr.max, 0, 1), s = Math.round((6 + (1 - a) * 14) / U);
        L.fillStyle = FIRE_RAMP[Math.min(5, Math.floor((1 - a) * 5.5))];
        L.fillRect(x - (s >> 1), y - (s >> 1), s, s);
        if (a > 0.5) { L.fillStyle = FIRE_RAMP[0]; L.fillRect(x - 1, y - 1, 2, 2); }
        break;
      }
      case 'grenade':
        L.save(); L.translate(x, y); L.rotate(Math.round(pr.rot / (Math.PI / 4)) * (Math.PI / 4));
        L.drawImage(GRENADE_SPR, -2, -3);
        L.fillStyle = (pr.life * 6 | 0) % 2 ? '#ff4040' : '#ffd23f'; L.fillRect(0, -3, 1, 1);
        L.restore(); break;
    }
  }
}

function drawIndicators(L, vx, vy) {
  if (S.mode !== 'mp') return;
  const W = S.low.width, H = S.low.height;
  for (const p of S.players.values()) {
    if (p === S.me || p.dead || inView(p.x, p.y - 20, 0)) continue;
    const cx = W / 2, cy = H / 2;
    const ang = Math.atan2(ly(p.y - 20) - cy, lx(p.x) - cx);
    const ex = clamp(cx + Math.cos(ang) * 2000, 8, W - 8) | 0, ey = clamp(cy + Math.sin(ang) * 2000, 8, H - 8) | 0;
    const dxs = Math.round(Math.cos(ang)), dys = Math.round(Math.sin(ang));
    const s = shadesOf(p.color);
    L.fillStyle = INK; L.fillRect(ex - 3, ey - 3, 7, 7);
    L.fillStyle = s.base; L.fillRect(ex - 2, ey - 2, 5, 5);
    L.fillStyle = s.hi; L.fillRect(ex - 2, ey - 2, 2, 1);
    L.fillStyle = INK; L.fillRect(ex + dxs * 4 - 1, ey + dys * 4 - 1, 3, 3);
    L.fillStyle = s.base; L.fillRect(ex + dxs * 4, ey + dys * 4, 1, 1);
  }
}

function drawCrosshair(L, vx, vy) {
  const x = Math.round((mouse.x / S.scale + vx - LO.ox) / U), y = Math.round((mouse.y / S.scale + vy - LO.oy) / U);
  const arms = [[-5, 0, 3, 1], [3, 0, 3, 1], [0, -5, 1, 3], [0, 3, 1, 3]];
  L.fillStyle = INK;
  for (const [ax, ay, w, h] of arms) L.fillRect(x + ax - 1, y + ay - 1, w + 2, h + 2);
  L.fillRect(x - 1, y - 1, 3, 3);
  L.fillStyle = '#ffffff';
  for (const [ax, ay, w, h] of arms) L.fillRect(x + ax, y + ay, w, h);
  L.fillStyle = S.me ? S.me.color : '#ff3b3b';
  L.fillRect(x, y, 1, 1);
}

function nameTag(g, p) {
  g.font = '8px "Press Start 2P", monospace'; g.textAlign = 'center';
  const y = Math.round(p.y - PH - 14), x = Math.round(p.x);
  g.fillStyle = INK; g.fillText(p.name, x + 1, y + 1); g.fillText(p.name, x - 1, y); g.fillText(p.name, x + 1, y - 1);
  g.fillStyle = shadesOf(p.color).hi; g.fillText(p.name, x, y);
  if (p !== S.me) {
    g.fillStyle = INK; g.fillRect(x - 16, y + 4, 32, 6);
    g.fillStyle = '#3a1418'; g.fillRect(x - 15, y + 5, 30, 4);
    const w = Math.round(30 * clamp(p.hp / 100, 0, 1));
    g.fillStyle = '#4fbf4a'; g.fillRect(x - 15, y + 5, w, 4);
    g.fillStyle = '#a8f07a'; g.fillRect(x - 15, y + 5, w, 1);
  }
}

// stickman hero drawn pixel by pixel into the fx buffer (units: 1 = U world px, 21 units tall)
// Back parts and front parts get separate outline passes so limbs read clearly (classic sprite trick).
function drawStickman(L, p) {
  if (p.invuln > 0 && ((p.invuln * 12) | 0) % 2 === 0) return;
  const s = p.hurtT > 0 ? { hi: '#ffffff', base: '#ffffff', sh: '#d8d8e0', dk: '#a0a0b0' } : shadesOf(p.color);
  const f = p.facing;
  const rot = p.flip > 0 ? p.flipDir * (1 - p.flip) * TAU : 0;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const bx = (p.x - LO.ox) / U, by = (p.y - LO.oy) / U;
  const CY = -10.5;
  const P = (ux, uy) => {
    if (rot) { const dy = uy - CY; return [Math.round(bx + ux * cr - dy * sr), Math.round(by + ux * sr + dy * cr + CY)]; }
    return [Math.round(bx + ux), Math.round(by + uy)];
  };
  // pose (units)
  const hip = [0, -8], sh = [0, -14], head = [0, -18];
  let k1, f1, k2, f2;
  if (!p.onGround) { k1 = [2.5 * f, -5]; f1 = [1.5 * f, -1]; k2 = [-2 * f, -4]; f2 = [-3.5 * f, -1]; }
  else if (Math.abs(p.vx) > 20) {
    const ph = p.run, s1 = Math.sin(ph);
    k1 = [s1 * 3, -4 - Math.max(0, -Math.cos(ph)) * 1.5]; f1 = [s1 * 5, -Math.max(0, Math.cos(ph)) * 2];
    k2 = [-s1 * 3, -4 - Math.max(0, Math.cos(ph)) * 1.5]; f2 = [-s1 * 5, -Math.max(0, -Math.cos(ph)) * 2];
  } else { k1 = [1.5 * f, -4]; f1 = [3 * f, 0]; k2 = [-1.5 * f, -4]; f2 = [-3 * f, 0]; }
  const ax = Math.cos(p.aim), ay = Math.sin(p.aim);
  const hand = [ax * 5, sh[1] + ay * 5];
  const hand2 = [ax * 3.5 - f * 0.5, sh[1] + 1.5 + ay * 3.5];
  const pack = [-f * 3, -12.5];
  const seg = (a, b, size) => { const A = P(a[0], a[1]), B = P(b[0], b[1]); pixLine(L, A[0], A[1], B[0], B[1], size); };

  // ---- back layer: back leg, back arm, jetpack
  L.fillStyle = INK;
  seg(hip, k2, 3); seg(k2, f2, 3); seg(sh, hand2, 3);
  { const [x, y] = P(pack[0], pack[1]); L.fillRect(x - 2, y - 3, 5, 8); }
  L.fillStyle = s.sh; seg(hip, k2, 1); seg(k2, f2, 1); seg(sh, hand2, 1);
  { const [x, y] = P(f2[0], f2[1]); L.fillStyle = s.dk; L.fillRect(x, y, 1, 1); }
  {
    const [x, y] = P(pack[0], pack[1]);
    L.fillStyle = '#4a4c5e'; L.fillRect(x - 1, y - 2, 3, 6);
    L.fillStyle = '#8a8ca0'; L.fillRect(x - 1, y - 2, 1, 5);
    L.fillStyle = '#2a2b38'; L.fillRect(x + 1, y - 1, 1, 5);
    L.fillStyle = '#e04848'; L.fillRect(x, y - 2, 1, 1);
    if (p.jetting) {
      const len = 3 + (Math.random() * 3 | 0);
      for (let i = 0; i < len; i++) { L.fillStyle = FIRE_RAMP[Math.min(5, i)]; L.fillRect(x - (i < 2 ? 1 : 0), y + 4 + i, i < 2 ? 3 : 1, 1); }
    }
  }
  // ---- front layer outline: torso, front leg, head
  L.fillStyle = INK;
  seg(hip, sh, 4); seg(hip, k1, 3); seg(k1, f1, 3);
  { const [x, y] = P(head[0], head[1]); pixCircle(L, x, y, 4.4, INK); }
  // torso: lit front column + shaded back column, belt
  {
    const A = P(hip[0], hip[1]), B = P(sh[0], sh[1]);
    L.fillStyle = s.base; pixLine(L, A[0], A[1], B[0], B[1], 2);
    L.fillStyle = s.sh; pixLine(L, A[0] - (f > 0 ? 1 : 0), A[1], B[0] - (f > 0 ? 1 : 0), B[1] + 1, 1);
    L.fillStyle = s.hi; pixLine(L, A[0] + (f > 0 ? 0 : 0), A[1] - 4, B[0], B[1] + 1, 1);
    const [hx, hy] = P(hip[0], hip[1] - 0.5);
    L.fillStyle = '#3a2a22'; L.fillRect(hx - 1, hy, 2, 1);
  }
  // front leg with boot
  L.fillStyle = s.base; seg(hip, k1, 1); seg(k1, f1, 1);
  { const [x, y] = P(f1[0], f1[1]); L.fillStyle = s.dk; L.fillRect(x, y, 1, 1); L.fillRect(x + f, y, 1, 1); }
  // head: base, shade, highlight, eye
  {
    const [x, y] = P(head[0], head[1]);
    pixCircle(L, x, y, 3.4, s.base);
    L.fillStyle = s.sh; L.fillRect(x - 3 * f + (f > 0 ? 0 : -1), y, 2, 2); L.fillRect(x - 2, y + 3, 5, 1); L.fillRect(x - (f > 0 ? 3 : -2), y + 2, 2, 1);
    L.fillStyle = s.hi; L.fillRect(x - 1, y - 3, 3, 1); L.fillRect(x - 2, y - 2, 1, 1);
    L.fillStyle = '#ffffff'; L.fillRect(f > 0 ? x + 1 : x - 2, y - 1, 2, 2);
    L.fillStyle = INK; L.fillRect(f > 0 ? x + 2 : x - 2, y - 1, 1, 2);
  }
  // scarf trailing behind the neck
  {
    const [nx, ny] = P(0, -15);
    const t = S.stats.time * 12 + p.x * 0.05;
    const dir = Math.abs(p.vx) > 20 ? -Math.sign(p.vx) : -f;
    for (let i = 1; i <= 5; i++) {
      const yy = ny + Math.round(Math.sin(t + i) * (i / 3)) + (p.onGround && Math.abs(p.vx) < 20 ? (i >> 1) : 0);
      L.fillStyle = INK; L.fillRect(nx + dir * i, yy - 1, 1, 3);
    }
    for (let i = 1; i <= 5; i++) {
      const yy = ny + Math.round(Math.sin(t + i) * (i / 3)) + (p.onGround && Math.abs(p.vx) < 20 ? (i >> 1) : 0);
      L.fillStyle = i % 2 ? '#f2c43c' : '#c8902a'; L.fillRect(nx + dir * i, yy, 1, 1);
    }
  }
  // gun
  {
    const gs = GUN_SPR[p.weapon];
    const [hx, hy] = P(hand[0], hand[1]);
    const ang = p.aim + rot;
    L.save(); L.translate(hx, hy); L.rotate(Math.round(ang / (Math.PI / 16)) * (Math.PI / 16));
    if (Math.cos(ang) < 0) L.scale(1, -1);
    L.drawImage(gs.c, -1, -gs.ay);
    if (p.muzzleT > 0 && WEAPONS[p.weapon].type !== 'flame') {
      const mx = gs.w - 1;
      L.fillStyle = FIRE_RAMP[2]; L.fillRect(mx, -2, 3, 5); L.fillRect(mx + 3, -1, 3, 3);
      L.fillStyle = FIRE_RAMP[1]; L.fillRect(mx, -1, 3, 3); L.fillRect(mx + 3, 0, 2, 1);
      L.fillStyle = FIRE_RAMP[0]; L.fillRect(mx, 0, 2, 1);
    }
    L.restore();
  }
  // front arm over the gun
  L.fillStyle = INK; seg(sh, hand, 3);
  L.fillStyle = s.base; seg(sh, hand, 1);
  { const [x, y] = P(hand[0], hand[1]); L.fillStyle = s.hi; L.fillRect(x, y, 1, 1); }
}

// ============================================================ HUD
function buildWeaponBar() {
  const bar = $('#weapons');
  bar.innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const d = document.createElement('div');
    d.className = 'slot';
    const c = GUN_SPR[i].c.cloneNode();
    c.getContext('2d').drawImage(GUN_SPR[i].c, 0, 0);
    c.style.width = GUN_SPR[i].w * 3 + 'px'; c.style.height = GUN_SPR[i].h * 3 + 'px';
    d.innerHTML = `<b>${i + 1}</b>`;
    d.appendChild(c);
    const s = document.createElement('span'); s.textContent = w.name; d.appendChild(s);
    bar.appendChild(d);
  });
  updateWeaponBar();
}
function updateWeaponBar() {
  const i = S && S.me ? S.me.weapon : 0;
  [...$('#weapons').children].forEach((el, k) => el.classList.toggle('on', k === i));
}

let hudT = 0;
function updateHud(dt) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.08;
  const me = S.me;
  const hp = Math.max(0, Math.round(me.hp));
  $('#hpFill').style.width = hp + '%';
  $('#hpFill').className = hp > 50 ? '' : hp > 25 ? 'mid' : 'low';
  $('#hpTxt').textContent = hp + '%';
  // key hints fade in after a few idle seconds
  $('#hints').classList.toggle('show', !S.paused && performance.now() - lastInput > HINT_IDLE_MS);
  const pct = S.blocks.length ? (S.destroyedArea / S.totalArea) * 100 : 0;
  const shown = pct >= 99.95 ? 100 : Math.min(99.9, pct);
  $('#destFill').style.width = shown.toFixed(1) + '%';
  $('#destTxt').textContent = (shown >= 100 ? '100' : shown.toFixed(1)) + '%';
  if (shown >= 100 && !S.announcedFull) { S.announcedFull = true; flashCenter('WEBSITE<br>100% DESTROYED!', 3500); }
  if (S.mode === 'mp') {
    const r = net.room;
    const mine = r && r.players.find((x) => x.id === net.id);
    $('#killsTxt').textContent = mine ? `KILLS ${mine.kills} / ${r.firstTo}` : '';
  } else $('#killsTxt').textContent = `BLOCKS ${S.destroyedCount}`;
  const c = $('#center');
  if (me.dead) { c.innerHTML = `RESPAWN IN ${Math.ceil(me.respawnT)}`; delete c.dataset.until; }
  else if (c.dataset.until) { if (performance.now() > +c.dataset.until) { c.innerHTML = ''; delete c.dataset.until; } }
  else if (c.innerHTML) c.innerHTML = '';
  if (showScore) renderScore();
}

function flashCenter(html, ms) {
  const c = $('#center');
  c.innerHTML = html;
  c.dataset.until = performance.now() + ms;
}

function addFeed(html) {
  const f = $('#feed');
  const d = document.createElement('div');
  d.innerHTML = html;
  f.prepend(d);
  while (f.children.length > 5) f.lastChild.remove();
  setTimeout(() => d.remove(), 5000);
}

function renderScore() {
  const t = $('#scoreTable');
  if (S.mode === 'mp' && net.room) {
    $('#scoreTitle').textContent = `ROOM ${net.room.code} · FIRST TO ${net.room.firstTo}`;
    t.innerHTML = '<tr><th>PLAYER</th><th>KILLS</th><th>DEATHS</th></tr>' + scoreRows();
  } else {
    $('#scoreTitle').textContent = 'STATS';
    const pct = (S.destroyedArea / S.totalArea) * 100;
    t.innerHTML = `<tr><td>Website destroyed</td><td>${pct.toFixed(1)}%</td></tr>
      <tr><td>Things smashed</td><td>${S.destroyedCount} / ${S.blocks.length}</td></tr>
      <tr><td>Shots fired</td><td>${S.stats.shots}</td></tr>
      <tr><td>Deaths</td><td>${S.me.deaths}</td></tr>
      <tr><td>Time</td><td>${Math.floor(S.stats.time / 60)}:${String(Math.floor(S.stats.time % 60)).padStart(2, '0')}</td></tr>`;
  }
}
function scoreRows() {
  return [...net.room.players].sort((a, b) => b.kills - a.kills)
    .map((p) => `<tr><td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === net.room.host ? ' ★' : ''}${p.id === net.id ? ' (you)' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function togglePause(force) {
  const on = force !== undefined ? force : !S.paused;
  S.paused = on;
  $('#pause').classList.toggle('hidden', !on);
  $('#copyLinkBtn').classList.toggle('hidden', S.mode !== 'mp');
  $('#reloadBtn').classList.toggle('hidden', S.mode === 'mp');
  mouse.down = false; keys.clear();
}

// ============================================================ main loop
let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (t - lastT) / 1000);
  lastT = t;
  if (!S || !S.running || !S.me) return;
  const frozen = S.paused && S.mode === 'sp';
  if (!frozen) {
    S.stats.time += dt;
    if (!S.paused) updateMe(dt);
    else S.me.vy = Math.min(S.me.vy + GRAV * dt, 1300), movePlayer(S.me, dt);
    updateRemotes(dt);
    updateProjectiles(dt);
    updateBurning(dt);
    updateParticles(dt);
    updateWords(dt);
    updateDebris(dt);
    if (S.me.muzzleT > 0) S.me.muzzleT -= dt;
  }
  updateCamera(dt);
  render();
  updateHud(dt);
  if (S.mode === 'mp') netTick(t);
}
requestAnimationFrame(frame);
window.__daw = { get S() { return S; } }; // debug handle

// ============================================================ networking
const net = {
  ws: null, id: null, color: null, name: 'Player', room: null, pending: null,
  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === 1) return resolve();
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not connect to server'));
      ws.onclose = () => { if (S && S.mode === 'mp' && S.running) flashCenter('DISCONNECTED', 99999); this.ws = null; };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onNet(m); };
    });
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
};

function netTick(t) {
  if (!S.me || t - S.lastNet < 50) return;
  S.lastNet = t;
  const p = S.me;
  net.send({ t: 's', x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), a: +p.aim.toFixed(2), w: p.weapon,
    f: p.facing, hp: Math.round(p.hp), d: p.dead ? 1 : 0, g: p.onGround ? 1 : 0, j: p.jetting ? 1 : 0, fl: p.flip > 0 ? 1 : 0, iv: p.invuln > 0 ? 1 : 0 });
  if (S.pendingBlk.length) { net.send({ t: 'b', i: S.pendingBlk }); S.pendingBlk = []; }
}

function remotePlayer(id) {
  let p = S && S.players.get(id);
  if (!p && S) {
    const info = net.room && net.room.players.find((x) => x.id === id);
    p = makePlayer(id, info ? info.name : '?', info ? info.color : '#999');
    p.remote = true;
    S.players.set(id, p);
  }
  return p;
}

function onNet(m) {
  switch (m.t) {
    case 'error':
      $('#mpMsg').textContent = m.msg;
      if (net.pending) { net.pending(); net.pending = null; }
      break;
    case 'welcome':
      net.id = m.id; net.color = m.color;
      break;
    case 'room': {
      const first = !net.room || net.room.code !== m.code;
      net.room = m;
      if (first) {
        const url = new URL(location.href); url.hash = 'room=' + m.code; history.replaceState(null, '', url);
        startGame({ mode: 'mp', url: m.url, room: m.code });
      }
      if (S) for (const info of m.players) { const p = S.players.get(info.id); if (p) { p.name = info.name; p.color = info.color; } }
      if (showScore) renderScore();
      break;
    }
    case 'left':
      if (S) { const p = S.players.get(m.id); if (p) addFeed(`<b style="color:${p.color}">${esc(p.name)}</b> left`); S.players.delete(m.id); }
      break;
    case 'hello': // new player -> show join
      if (S && S.ready) { const p = remotePlayer(m.id); addFeed(`<b style="color:${p.color}">${esc(p.name)}</b> joined`); }
      break;
    case 's': {
      if (!S || !S.ready) return;
      const p = remotePlayer(m.id);
      if (p.dead && !m.d) { p.x = m.x; p.y = m.y; }
      if (!p.dead && m.d) gib(p);
      p.tx = m.x; p.ty = m.y; p.vx = m.vx; p.vy = m.vy; p.aim = m.a; p.weapon = m.w; p.facing = m.f;
      if (m.hp < p.hp) p.hurtT = 0.15;
      p.hp = m.hp; p.dead = !!m.d; p.onGround = !!m.g; p.jetting = !!m.j; p.invuln = m.iv ? 0.3 : 0;
      if (m.fl && p.flip === 0 && !p.onGround) { p.flip = 1; p.flipDir = p.facing; }
      break;
    }
    case 'f':
      if (!S || !S.ready) return;
      fire(remotePlayer(m.id), m.w, m.x, m.y, m.a, m.s, m.tx, m.ty);
      break;
    case 'g':
      if (!S || !S.ready) return;
      spawnGrenade(m.id, m.x, m.y, m.vx, m.vy);
      break;
    case 'b':
      if (!S || !S.ready) return;
      for (const i of m.i) { const b = S.blocks[i]; if (b && b.alive) destroyBlock(b, false); }
      break;
    case 'kill': {
      if (!S) return;
      const room = net.room;
      const name = (id) => { const p = room && room.players.find((x) => x.id === id); return p ? `<b style="color:${p.color}">${esc(p.name)}</b>` : '?'; };
      if (m.by === m.victim) addFeed(`${name(m.victim)} self-destructed`);
      else addFeed(`${name(m.by)} [${esc(m.weapon)}] ${name(m.victim)}`);
      if (m.by === net.id && m.victim !== net.id) flashCenter('+1 KILL', 900);
      break;
    }
    case 'over': {
      const room = net.room;
      const w = room.players.find((x) => x.id === m.winner);
      setTimeout(() => {
        $('#overTitle').innerHTML = `${esc(w ? w.name : '?')} WINS!`;
        $('#overTable').innerHTML = '<tr><th>PLAYER</th><th>KILLS</th><th>DEATHS</th></tr>' + scoreRows();
        $('#againBtn').classList.toggle('hidden', net.room.host !== net.id);
        $('#over').classList.remove('hidden');
      }, 300);
      break;
    }
    case 'restart':
      $('#over').classList.add('hidden');
      startGame({ mode: 'mp', url: net.room.url, room: net.room.code });
      break;
  }
}

// ============================================================ menu wiring
function goMenu() {
  if (S) S.running = false;
  S = null;
  iframe.src = 'about:blank';
  if (net.ws) { net.ws.close(); net.ws = null; }
  net.room = null;
  history.replaceState(null, '', location.pathname);
  game.classList.add('hidden');
  menu.classList.remove('hidden');
}

function readName() {
  const n = $('#nameInput').value.trim() || 'Player' + Math.floor(Math.random() * 90 + 10);
  try { localStorage.setItem('daw-name', n); } catch {}
  return n;
}

$('#urlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const u = $('#urlInput').value.trim();
  startGame({ mode: 'sp', url: u || 'demo' });
});
document.querySelectorAll('[data-url]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.url !== 'demo') $('#urlInput').value = b.dataset.url;
  startGame({ mode: 'sp', url: b.dataset.url });
}));
$('#createRoom').addEventListener('click', async () => {
  let u = $('#urlInput').value.trim();
  if (!u) { $('#mpMsg').textContent = 'Type a website address above first (e.g. wikipedia.org)'; return; }
  net.name = readName();
  $('#mpMsg').textContent = 'Opening room & loading website…';
  try { await net.connect(); } catch (err) { $('#mpMsg').textContent = err.message; return; }
  net.send({ t: 'create', url: u, name: net.name, firstTo: +$('#firstTo').value });
});
$('#joinRoom').addEventListener('click', () => joinRoom($('#codeInput').value.trim()));
async function joinRoom(code) {
  if (!code) { $('#mpMsg').textContent = 'Enter a room code'; return; }
  net.name = readName();
  $('#mpMsg').textContent = 'Joining…';
  try { await net.connect(); } catch (err) { $('#mpMsg').textContent = err.message; return; }
  net.send({ t: 'join', code, name: net.name });
}

$('#resumeBtn').addEventListener('click', () => togglePause(false));
$('#reloadBtn').addEventListener('click', () => { const u = S.url; togglePause(false); startGame({ mode: 'sp', url: u }); });
$('#quitBtn').addEventListener('click', goMenu);
$('#overQuit').addEventListener('click', goMenu);
$('#againBtn').addEventListener('click', () => net.send({ t: 'restart' }));
$('#copyLinkBtn').addEventListener('click', async () => {
  const link = location.origin + location.pathname + '#room=' + net.room.code;
  try { await navigator.clipboard.writeText(link); $('#copyLinkBtn').textContent = 'Copied!'; } catch { prompt('Invite link:', link); }
  setTimeout(() => ($('#copyLinkBtn').textContent = 'Copy invite link'), 1500);
});

// menu background: animated pixel art
(function menuBg() {
  const c = makeBandArt(480, BAND_H, (Math.random() * 1e9) >>> 0, (Math.random() * 7) | 0);
  $('#menuBg').style.backgroundImage = `url(${c.toDataURL()})`;
})();
try { $('#nameInput').value = localStorage.getItem('daw-name') || ''; } catch {}

// deep links: #room=CODE or ?url=...
(function boot() {
  const h = location.hash.match(/room=([A-Z0-9]{5})/i);
  if (h) { $('#codeInput').value = h[1].toUpperCase(); $('#mpMsg').textContent = 'Invited to room ' + h[1].toUpperCase() + ' — enter a name and click “Join room”.'; }
  const q = new URLSearchParams(location.search).get('url');
  if (q) { $('#urlInput').value = q; }
})();
})();
