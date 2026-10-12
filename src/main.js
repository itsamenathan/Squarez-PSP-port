import {
  SCREEN_W, SCREEN_H, SPRITES, SPR, SOUNDS, SONGS, COLORS, MODES, CUSTOM_FILES, TIMED_OPTIONS,
  INSTRUCTIONS, TIPS, OBJECTS, CREDITS, parseGameFile,
} from './data.js';
import { Game } from './game.js';
import { FONT_8X8, FONT_5X10, BUTTONS } from './font.js';

const FRAME_MS = 1000 / 60;

// --- assets ------------------------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

class Sprites {
  constructor(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    // Black is the colour key, exactly like the PSP renderer and collision masks.
    for (let i = 0; i < px.length; i += 4) if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) px[i + 3] = 0;
    ctx.putImageData(data, 0, 0);
    this.sheet = c;
    this.masks = SPRITES.map(([sx, sy, w, h]) => {
      const m = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = px[((sy + y) * c.width + sx + x) * 4 + 3] ? 1 : 0;
      return m;
    });
  }

  // Pixel-accurate overlap test (FUN_0890fadc).
  maskHit(a, ax, ay, b, bx, by) {
    const [, , aw, ah] = SPRITES[a];
    const [, , bw, bh] = SPRITES[b];
    const x0 = Math.max(ax, bx), y0 = Math.max(ay, by);
    const x1 = Math.min(ax + aw, bx + bw), y1 = Math.min(ay + ah, by + bh);
    if (x0 >= x1 || y0 >= y1) return false;
    const ma = this.masks[a], mb = this.masks[b];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (ma[(y - ay) * aw + (x - ax)] && mb[(y - by) * bw + (x - bx)]) return true;
      }
    }
    return false;
  }
}

class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.music = null;
    this.musicBuffers = [];
    this.options = null;
  }

  async load() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.6;
    this.sfx.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.ctx.destination);
    const get = async name => {
      try {
        const res = await fetch(`assets/sound/${name}.wav`);
        return await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null;
      }
    };
    const sfx = await Promise.all(SOUNDS.map(get));
    sfx.forEach((b, i) => { this.buffers[i] = b; });
    this.musicBuffers = await Promise.all(SONGS.map(get));
  }

  unlock() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(id) {
    if (!this.ctx || !this.options.sound || !this.buffers[id]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[id];
    src.connect(this.sfx);
    src.start();
  }

  playMusic(song) {
    if (!this.ctx) return;
    if (this.music && this.music.song === song) return;
    this.stopMusic();
    const buf = this.musicBuffers[song - 1];
    if (!song || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.music = { src, song };
  }

  stopMusic() {
    if (this.music) { this.music.src.stop(); this.music = null; }
  }
}

// --- input -------------------------------------------------------------------------------------

// Keyboard keys map to the PSP buttons the original game reads. Esc doubles as START and Back.
const KEYMAP = {
  ArrowUp: ['up'], KeyW: ['up'], ArrowDown: ['down'], KeyS: ['down'], ArrowLeft: ['left'], KeyA: ['left'],
  ArrowRight: ['right'], KeyD: ['right'],
  ShiftLeft: ['turbo'], ShiftRight: ['turbo'], KeyZ: ['turbo'],
  KeyX: ['slow'],
  Space: ['grenade', 'accept'],
  KeyC: ['rage'], KeyR: ['rage'],
  Enter: ['accept'],
  Escape: ['start', 'back'], KeyP: ['start'], Backspace: ['back'],
  PageUp: ['pageLeft'], KeyQ: ['pageLeft'], PageDown: ['pageRight'], KeyE: ['pageRight'],
};

// Labels for on-screen prompts. Gamepads show the PSP button glyphs from the original font;
// with the standard mapping they sit in the same place (A = Cross, B = Circle, X = Square, Y = Triangle).
const KEY_LABELS = {
  accept: 'Enter', back: 'Esc', turbo: 'Shift', slow: 'X', grenade: 'Space', rage: 'C', start: 'Esc',
  pageLeft: 'Q', pageRight: 'E', dpad: 'Arrows',
};
const PAD_LABELS = {
  accept: '✕', back: '○', turbo: '✕', slow: '○', grenade: '□', rage: '△',
  start: 'START', pageLeft: 'L1', pageRight: 'R1', dpad: 'D-Pad',
};

const STICK_NAV = 0.5;
const STICK_DEAD = 0.15;

// Controller layouts. Values are button indices; dpad entries are bindings, or null to
// auto-detect (standard D-pad buttons, a hat-switch axis or axes 6/7).
// Bindings: { t: 'b', i } button, { t: 'a', i, d } axis direction, { t: 'h', i, dir } hat axis.
const PAD_ACTIONS = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'select', 'start'];
const STANDARD_PROFILE = {
  name: 'standard', cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, select: 8, start: 9,
  up: { t: 'b', i: 12 }, down: { t: 'b', i: 13 }, left: { t: 'b', i: 14 }, right: { t: 'b', i: 15 },
};
// 8BitDo pads in D-input / Switch mode as reported by Linux and macOS HID drivers
// (SDL: a:b1 b:b0 x:b4 y:b3 back:b10 start:b11 leftshoulder:b6 rightshoulder:b7, D-pad on a hat).
const HID_PROFILE = {
  name: 'hid', cross: 1, circle: 0, square: 4, triangle: 3, l1: 6, r1: 7, select: 10, start: 11,
  up: null, down: null, left: null, right: null,
};
const HAT_DIRS = [['up'], ['up', 'right'], ['right'], ['down', 'right'], ['down'], ['down', 'left'], ['left'], ['up', 'left']];

// Chrome reports a D-pad hat as one axis: -1 (up) to 1 (up-left) in steps of 2/7, ~1.29 at rest.
function hatDirs(v) {
  if (v === undefined || Math.abs(v) > 1.01) return [];
  const pos = Math.round((v + 1) * 3.5);
  return Math.abs((v + 1) * 3.5 - pos) < 0.2 ? HAT_DIRS[pos] || [] : [];
}

function loadPadProfiles() { return loadJSON('squarez.pads', {}); }

class Input {
  constructor(app) {
    this.app = app;
    this.keys = new Set();
    // Keys pressed and released between two frames still count as one press.
    this.tapped = new Set();
    this.prev = new Set();
    this.now = new Set();
    this.axisX = 0x82;
    this.axisY = 0x82;
    this.repeat = {};
    this.device = 'keyboard';
    this.padIndex = null;
    this.profiles = loadPadProfiles();
    this.hatAxis = {};
    this.capture = null;
    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const actions = KEYMAP[e.code];
      if (actions) {
        for (const a of actions) { this.keys.add(a); this.tapped.add(a); }
        e.preventDefault();
      }
      this.device = 'keyboard';
      this.app.userGesture();
    });
    window.addEventListener('keyup', e => {
      const actions = KEYMAP[e.code];
      if (actions) for (const a of actions) this.keys.delete(a);
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', () => this.app.userGesture());
    window.addEventListener('gamepadconnected', e => {
      const p = e.gamepad;
      this.app.toast(`Controller connected: ${shortPadName(p.id)}`);
      if (p.mapping !== 'standard' && !this.profiles[p.id]) this.app.toast('If buttons feel wrong: Options > Controller Setup');
    });
    window.addEventListener('gamepaddisconnected', e => {
      if (e.gamepad.index === this.padIndex) {
        this.padIndex = null;
        this.device = 'keyboard';
        this.app.padLost();
      }
      this.app.toast('Controller disconnected');
    });
  }

  pads() {
    return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  }

  pad() {
    if (this.padIndex === null) return null;
    return this.pads().find(p => p.index === this.padIndex) || null;
  }

  profileFor(p) {
    return this.profiles[p.id] || (p.mapping === 'standard' ? STANDARD_PROFILE : HID_PROFILE);
  }

  saveProfile(id, profile) {
    this.profiles[id] = profile;
    saveJSON('squarez.pads', this.profiles);
  }

  resetProfile(id) {
    delete this.profiles[id];
    saveJSON('squarez.pads', this.profiles);
  }

  binding(p, bind) {
    if (!bind) return false;
    if (bind.t === 'b') return !!(p.buttons[bind.i] && p.buttons[bind.i].pressed);
    if (bind.t === 'a') return (p.axes[bind.i] || 0) * bind.d > 0.5;
    if (bind.t === 'h') return hatDirs(p.axes[bind.i]).includes(bind.dir);
    return false;
  }

  // D-pad state for a pad, from its profile or auto-detected.
  dpad(p, prof) {
    const out = new Set();
    for (const dir of ['up', 'down', 'left', 'right']) if (this.binding(p, prof[dir])) out.add(dir);
    if (out.size || ['up', 'down', 'left', 'right'].some(d => prof[d])) return out;
    if (p.mapping === 'standard') return out;
    // Remember any axis seen resting outside -1..1: that is a hat switch.
    p.axes.forEach((v, i) => { if (Math.abs(v) > 1.05) this.hatAxis[p.id] = i; });
    const hat = this.hatAxis[p.id];
    if (hat !== undefined) for (const d of hatDirs(p.axes[hat])) out.add(d);
    else if (p.axes.length >= 8) {
      // Firefox exposes the hat as axes 6 and 7.
      if (p.axes[6] < -0.5) out.add('left');
      if (p.axes[6] > 0.5) out.add('right');
      if (p.axes[7] < -0.5) out.add('up');
      if (p.axes[7] > 0.5) out.add('down');
    }
    return out;
  }

  poll() {
    this.prev = this.now;
    const now = new Set([...this.keys, ...this.tapped]);
    this.tapped.clear();
    let ax = null, ay = null;
    if (this.capture) this.updateCapture();
    for (const p of this.pads()) {
      if (this.capture && !this.capture.done) break;
      const prof = this.profileFor(p);
      const b = i => i !== undefined && i !== null && !!(p.buttons[i] && p.buttons[i].pressed);
      const before = now.size;
      for (const d of this.dpad(p, prof)) now.add(d);
      if (b(prof.cross)) { now.add('turbo'); now.add('accept'); }
      if (b(prof.circle)) { now.add('slow'); now.add('back'); }
      if (b(prof.square)) now.add('grenade');
      if (b(prof.triangle)) now.add('rage');
      if (b(prof.l1)) now.add('pageLeft');
      if (b(prof.r1)) now.add('pageRight');
      if (b(prof.start)) now.add('start');
      if (b(prof.select)) now.add('back');
      // Pads without sticks (like the SN30) can report the D-pad as axes 0/1; that works here too.
      const usesAxes01 = ['up', 'down', 'left', 'right'].some(d => prof[d] && prof[d].t === 'a' && prof[d].i < 2);
      const x = usesAxes01 ? 0 : p.axes[0] || 0, y = usesAxes01 ? 0 : p.axes[1] || 0;
      const moving = Math.abs(x) > STICK_DEAD || Math.abs(y) > STICK_DEAD;
      if (moving) {
        ax = Math.round((x + 1) * 127.5);
        ay = Math.round((y + 1) * 127.5);
      }
      if (x < -STICK_NAV) now.add('navLeft');
      if (x > STICK_NAV) now.add('navRight');
      if (y < -STICK_NAV) now.add('navUp');
      if (y > STICK_NAV) now.add('navDown');
      if (now.size > before || moving) {
        if (this.device !== 'gamepad' || this.padIndex !== p.index) this.app.userGesture();
        this.device = 'gamepad';
        this.padIndex = p.index;
      }
    }
    this.now = now;
    // PSP analog values: 0..255 with 0x82 at rest. The D-pad maps to the extremes (FUN_0890a20c).
    this.axisX = now.has('left') ? 0 : now.has('right') ? 0xff : ax ?? 0x82;
    this.axisY = now.has('up') ? 0 : now.has('down') ? 0xff : ay ?? 0x82;
  }

  // --- controller setup: record one binding per step ---

  startCapture() {
    const p = this.pad() || this.pads()[0];
    if (!p) return false;
    this.capture = { id: p.id, index: p.index, step: 0, profile: { name: 'custom' }, waitRelease: true, base: null, done: false };
    return true;
  }

  cancelCapture() { this.capture = null; }

  updateCapture() {
    const c = this.capture;
    const p = this.pads().find(q => q.index === c.index);
    if (!p || c.done) return;
    const pressed = p.buttons.map(b => b.pressed);
    const axes = [...p.axes];
    const idle = !pressed.some(Boolean) && axes.every((v, i) => !c.base || Math.abs(v - c.base[i]) < 0.3);
    if (c.waitRelease) {
      if (!pressed.some(Boolean) && (!c.base || idle)) {
        c.waitRelease = false;
        c.base = axes;
      }
      return;
    }
    const step = SETUP_STEPS[c.step];
    let bind = null;
    const bi = pressed.findIndex(Boolean);
    if (bi >= 0) bind = { t: 'b', i: bi };
    else if (step.dpad) {
      for (let i = 0; i < axes.length && !bind; i++) {
        const v = axes[i], b0 = c.base[i];
        if (Math.abs(v - b0) < 0.4) continue;
        const dirs = Math.abs(b0) > 1.05 ? hatDirs(v) : [];
        if (dirs.length === 1) bind = { t: 'h', i, dir: dirs[0] };
        else if (Math.abs(b0) <= 1.05 && Math.abs(v) > 0.6) bind = { t: 'a', i, d: Math.sign(v) };
      }
    }
    if (!bind) return;
    c.profile[step.key] = step.dpad ? bind : bind.t === 'b' ? bind.i : null;
    this.nextCaptureStep();
  }

  nextCaptureStep() {
    const c = this.capture;
    c.step++;
    c.waitRelease = true;
    if (c.step >= SETUP_STEPS.length) {
      c.done = true;
      this.saveProfile(c.id, c.profile);
    }
  }

  // Raw readout shown on the setup screen.
  rawState() {
    const p = this.pad() || this.pads()[0];
    if (!p) return null;
    return {
      id: p.id, mapping: p.mapping || 'none',
      buttons: p.buttons.map((b, i) => (b.pressed ? i : -1)).filter(i => i >= 0),
      axes: p.axes.map(v => v.toFixed(2)),
      profile: this.profiles[p.id] ? 'custom' : this.profileFor(p).name,
    };
  }

  held(a) { return this.now.has(a); }
  pressed(a) { return this.now.has(a) && !this.prev.has(a); }

  // Menu navigation from the D-pad, arrow keys or stick, with key repeat.
  nav(dir) {
    const stick = 'nav' + dir[0].toUpperCase() + dir.slice(1);
    const held = this.held(dir) || this.held(stick);
    const pressed = this.pressed(dir) || (this.held(stick) && !this.prev.has(stick) && !this.held(dir));
    if (pressed) { this.repeat[dir] = 18; return true; }
    if (!held) return false;
    if (--this.repeat[dir] <= 0) { this.repeat[dir] = 5; return true; }
    return false;
  }

  label(action) {
    return (this.device === 'gamepad' ? PAD_LABELS : KEY_LABELS)[action] || action;
  }
}

const SETUP_STEPS = [
  { key: 'up', label: 'D-Pad UP', dpad: true },
  { key: 'down', label: 'D-Pad DOWN', dpad: true },
  { key: 'left', label: 'D-Pad LEFT', dpad: true },
  { key: 'right', label: 'D-Pad RIGHT', dpad: true },
  { key: 'cross', label: '✕ (bottom face button): Select / Turbo' },
  { key: 'circle', label: '○ (right face button): Back / Slow' },
  { key: 'square', label: '□ (left face button): Grenade' },
  { key: 'triangle', label: '△ (top face button): Rage' },
  { key: 'l1', label: 'L shoulder: Previous Page' },
  { key: 'r1', label: 'R shoulder: Next Page' },
  { key: 'select', label: 'SELECT: Back' },
  { key: 'start', label: 'START: Pause' },
];

function shortPadName(id) {
  return id.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Gamepad';
}

// --- rendering ---------------------------------------------------------------------------------

const ALPHA_M = 160 / 255; // theme.txt TRANS_TEXTM: unselected menu entries
const ALPHA_H = 128 / 255; // theme.txt TRANS_TEXTH

class Renderer {
  constructor(canvas, sprites, backgrounds) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = sprites;
    this.bg = backgrounds;
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx.imageSmoothingEnabled = false;
    this.alphaM = ALPHA_M;
    this.alphaH = ALPHA_H;
    this.glyphMask = this.buildGlyphMask();
    this.tinted = new Map();
  }

  // One white atlas holding the 8x8 font (rows 0-127), the 5x10 font (rows 128-187) and the
  // PSP button glyphs (rows 188-197). Coloured copies are made on demand.
  buildGlyphMask() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 198;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    const set = (x, y) => { const o = (y * c.width + x) * 4; img.data.fill(255, o, o + 4); };
    for (let ch = 0; ch < 256; ch++) {
      const gx = (ch % 16) * 8, gy = Math.floor(ch / 16) * 8;
      for (let row = 0; row < 8; row++) {
        const bits = FONT_8X8[ch * 8 + row];
        for (let b = 0; b < 8; b++) if (bits & (0x80 >> b)) set(gx + b, gy + row);
      }
    }
    for (let ch = 0; ch < 96; ch++) {
      const gx = (ch % 16) * 5, gy = 128 + Math.floor(ch / 16) * 10;
      for (let row = 0; row < 10; row++) {
        const bits = FONT_5X10[ch * 10 + row];
        for (let b = 0; b < 5; b++) if (bits & (1 << b)) set(gx + b, gy + row);
      }
    }
    this.buttonIndex = {};
    Object.entries(BUTTONS).forEach(([sym, rows], i) => {
      this.buttonIndex[sym] = i;
      rows.forEach((bits, row) => { for (let b = 0; b < 10; b++) if (bits & (1 << b)) set(i * 10 + b, 188 + row); });
    });
    ctx.putImageData(img, 0, 0);
    return c;
  }

  glyphs(color) {
    let c = this.tinted.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = this.glyphMask.width; c.height = this.glyphMask.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(this.glyphMask, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      this.tinted.set(color, c);
    }
    return c;
  }

  background(which = 'game') {
    if (which === 'game' && this.solidBackground) {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      return;
    }
    this.ctx.drawImage(which === 'game' ? this.bg.game : this.bg.menu, 0, 0);
  }

  sprite(id, x, y) {
    const [sx, sy, w, h] = SPRITES[id];
    this.ctx.drawImage(this.sprites.sheet, sx, sy, w, h, Math.round(x), Math.round(y), w, h);
  }

  // 8x8 font, optionally scaled 2x or 4x (FUN_0892b16c / FUN_0892b058 / FUN_0892afac).
  text(str, x, y, color = COLORS.text, alpha = 1, scale = 1) {
    const atlas = this.glyphs(color);
    const c = this.ctx;
    c.globalAlpha = alpha;
    x = Math.round(x); y = Math.round(y);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i) & 0xff;
      if (ch !== 32) c.drawImage(atlas, (ch % 16) * 8, Math.floor(ch / 16) * 8, 8, 8, x, y, 8 * scale, 8 * scale);
      x += 8 * scale;
    }
    c.globalAlpha = 1;
  }

  // Centred text: x = 240 - len * 4 * scale, as in FUN_0892b218.
  center(str, y, color = COLORS.text, alpha = 1, scale = 1) {
    this.text(str, SCREEN_W / 2 - str.length * 4 * scale, y, color, alpha, scale);
  }

  // 5x10 font (FUN_0892ad10). PSP button glyphs are 10 pixels wide.
  small(str, x, y, color = COLORS.text, alpha = 1) {
    const atlas = this.glyphs(color);
    const c = this.ctx;
    c.globalAlpha = alpha;
    x = Math.round(x); y = Math.round(y);
    for (const chr of str) {
      const bi = this.buttonIndex[chr];
      if (bi !== undefined) {
        c.drawImage(atlas, bi * 10, 188, 10, 10, x, y, 10, 10);
        x += 10;
        continue;
      }
      const code = chr.charCodeAt(0);
      const ch = code >= 0x20 && code < 0x80 ? code - 0x20 : 31;
      if (ch) c.drawImage(atlas, (ch % 16) * 5, 128 + Math.floor(ch / 16) * 10, 5, 10, x, y, 5, 10);
      x += 5;
    }
    c.globalAlpha = 1;
  }

  smallWidth(str) {
    let w = 0;
    for (const chr of str) w += this.buttonIndex[chr] !== undefined ? 10 : 5;
    return w;
  }

  smallCenter(str, y, color = COLORS.text, alpha = 1) {
    this.small(str, Math.floor((SCREEN_W - this.smallWidth(str)) / 2), y, color, alpha);
  }

  dim(alpha = 0.6) {
    this.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  panel(x, y, w, h) {
    this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this.ctx.fillRect(x, y, w, h);
  }

  cursor(x, y, alpha = 1) {
    this.text('>', x, y, COLORS.warning, alpha);
  }
}

// --- persistence -------------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
  sensitivity: 20, turboAdjust: 6, slowAdjust: 20, particles: 1, sound: true, music: 1,
  messages: true, largeTimer: true, vibration: true, background: 1,
};

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// --- application -------------------------------------------------------------------------------

// Main menu, laid out like FUN_0891405c: entries at x=0xcd, y=0x41 + 12 * i.
const MENU_ITEMS = [
  ...MODES.map(m => ({ kind: 'mode', mode: m, label: m.label })),
  { kind: 'screen', screen: 'options', label: 'Options' },
  { kind: 'screen', screen: 'highscores', label: 'High Scores' },
  { kind: 'screen', screen: 'instructions', label: 'Instructions' },
  { kind: 'screen', screen: 'credits', label: 'Credits' },
];
const TIMED_CHOICES = TIMED_OPTIONS.filter(Boolean);

const OPTION_ROWS = [
  { key: 'sensitivity', label: 'Analog Desensitivity:', min: 15, max: 26, fmt: v => `${v} (HIGHER=SLOWER)` },
  { key: 'turboAdjust', label: 'Turbo Adjustment:', min: 1, max: 10 },
  { key: 'slowAdjust', label: 'Slow Adjustment:', min: 1, max: 30 },
  { key: 'particles', label: 'Particle Effects:', min: 0, max: 2, fmt: v => ['OFF', 'ON', 'MAX'][v] },
  { key: 'sound', label: 'Sound F/X:', bool: true },
  { key: 'music', label: 'Music:', min: 0, max: SONGS.length, fmt: v => (v ? `SONG ${v} OF ${SONGS.length}` : 'OFF') },
  { key: 'background', label: 'Background:', min: 0, max: 1, fmt: v => (v ? 'IMAGE' : 'BACKGROUND COLOR') },
  { key: 'messages', label: 'Beginner Help System:', bool: true },
  { key: 'largeTimer', label: 'Large Timer:', bool: true },
  { key: 'vibration', label: 'Controller Vibration:', bool: true },
  { key: 'padsetup', label: 'Controller Setup', action: true },
];

const PAUSE_ITEMS = ['Resume Game', 'Background', 'Music', 'Restart Game', 'Exit Game'];

class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.options = { ...DEFAULT_OPTIONS, ...loadJSON('squarez.options', {}) };
    this.scores = loadJSON('squarez.scores', {});
    this.unlocks = loadJSON('squarez.unlocks', {});
    this.cheats = { god: false, turbo: false };
    this.screen = 'loading';
    this.menuIndex = 0;
    this.timedMenu = false;
    this.timedIndex = 0;
    this.customIndex = 0;
    this.customTimed = 0;
    this.page = 0;
    this.optionIndex = 0;
    this.scoreIndex = 0;
    this.pauseIndex = 0;
    this.customGames = [];
    this.game = null;
    this.demo = null;
    this.entry = null;
    this.toasts = [];
  }

  async start() {
    // background01.bmp is the in-game background; menu.bmp sits behind the menus.
    const [sheet, game, menu] = await Promise.all([
      loadImage('assets/graphics/squarezsprites.bmp'),
      loadImage('assets/graphics/background01.bmp'),
      loadImage('assets/graphics/menu.bmp'),
    ]);
    this.sprites = new Sprites(sheet);
    this.renderer = new Renderer(this.canvas, this.sprites, { game, menu });
    this.renderer.solidBackground = !this.options.background;
    this.input = new Input(this);
    this.audio = new Audio();
    this.audio.options = this.options;
    this.renderer.background('menu');
    this.renderer.center('LOADING', 0x84, COLORS.alt);
    await Promise.all([this.audio.load(), this.loadCustomGames()]);
    this.screen = 'menu';
    this.startDemo();
    let last = performance.now();
    let acc = 0;
    const loop = now => {
      acc += Math.min(250, now - last);
      last = now;
      while (acc >= FRAME_MS) {
        this.input.poll();
        this.update();
        acc -= FRAME_MS;
      }
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async loadCustomGames() {
    const games = await Promise.all(CUSTOM_FILES.map(async f => {
      try {
        const res = await fetch(`assets/custom/${encodeURIComponent(f)}`);
        if (!res.ok) return null;
        const g = parseGameFile(await res.text());
        g.file = f;
        return g;
      } catch {
        return null;
      }
    }));
    this.customGames = games.filter(Boolean);
  }

  // Audio can only start after the first user interaction.
  userGesture() {
    if (!this.audio) return;
    this.audio.unlock();
    if (!this.musicStarted && this.audio.ctx) {
      this.musicStarted = true;
      this.audio.playMusic(this.options.music);
    }
  }

  toast(text) {
    this.toasts.push({ text, ttl: 180 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  padLost() {
    if (this.screen === 'game' && this.game && (this.game.state === 0 || this.game.state === 2)) {
      this.game.paused = true;
      this.pauseIndex = 0;
    }
  }

  rumble(strength, ms) {
    if (!this.options.vibration || this.input.device !== 'gamepad') return;
    const pad = this.input.pad();
    const act = pad && pad.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength + 0.2) }).catch(() => {});
  }

  glyph(action) { return this.input.label(action); }

  // Bouncing enemies behind the menus (FUN_08913f98 seeds 12 enemies and 2 blockers).
  startDemo() {
    const d = new Game(this, { mode: MODES[0], game: MODES[0].game, timed: 0, scoreKey: 'demo' });
    d.moved = true;
    for (let i = 0; i < 14; i++) {
      d.addEnemy(i < 12 ? 1 : 2);
      const e = d.enemies[d.enemies.length - 1];
      e.x = Math.floor(Math.random() * 460) + 1;
      if (Math.random() < 0.5) e.vx = -Math.abs(e.vx);
    }
    d.px = -1000; d.py = -1000;
    this.demo = d;
  }

  bomberUnlocked() { return !!this.unlocks.bomber; }
  unlockBomber() { this.unlocks.bomber = true; saveJSON('squarez.unlocks', this.unlocks); }

  scoreKey(mode, game, timed) {
    let key = mode.id === 'custom' ? `custom:${game.NAME}` : mode.id;
    if (timed) key += `:${timed}`;
    return key;
  }

  bestScore(key) {
    const list = this.scores[key];
    return list && list.length ? list[0].score : 0;
  }

  qualifies(key, score) {
    if (score <= 0) return false;
    const list = this.scores[key] || [];
    return list.length < 10 || score > list[list.length - 1].score;
  }

  recordScore(key, name, score) {
    const entry = { name, score, at: Date.now() };
    const list = (this.scores[key] || []).concat([entry]);
    list.sort((a, b) => b.score - a.score);
    this.scores[key] = list.slice(0, 10);
    saveJSON('squarez.scores', this.scores);
    return this.scores[key].indexOf(entry);
  }

  startGame(mode, game, timed) {
    const scoreKey = this.scoreKey(mode, game, timed);
    this.lastStart = { mode, game, timed };
    this.game = new Game(this, { mode, game, timed, scoreKey });
    this.entry = null;
    this.pauseIndex = 0;
    this.screen = 'game';
  }

  gameEnded(game) {
    if (this.qualifies(game.opts.scoreKey, game.score)) {
      this.entry = { letters: (this.lastInitials || [0, 0, 0]).slice(), pos: 0, done: false, rank: -1, cooldown: 45 };
    } else {
      this.entry = { done: true, rank: -1, cooldown: 45 };
    }
  }

  saveOptions() {
    saveJSON('squarez.options', this.options);
    this.renderer.solidBackground = !this.options.background;
    if (this.musicStarted) {
      if (this.options.music) this.audio.playMusic(this.options.music);
      else this.audio.stopMusic();
    }
  }

  // --- update ----------------------------------------------------------------------------------

  update() {
    const input = this.input;
    for (const t of this.toasts) t.ttl--;
    this.toasts = this.toasts.filter(t => t.ttl > 0);
    if (this.screen !== 'game' && this.demo) {
      this.demo.frames++;
      this.demo.updateEnemies();
      this.demo.phase = (this.demo.phase + 1) & 3;
    }
    switch (this.screen) {
      case 'menu': this.updateMenu(input); break;
      case 'custom': this.updateCustom(input); break;
      case 'game': this.updateGame(input); break;
      case 'highscores': this.updateHighscores(input); break;
      case 'instructions':
        if (input.nav('right') || input.pressed('pageRight') || input.pressed('accept')) this.page = Math.min(4, this.page + 1);
        if (input.nav('left') || input.pressed('pageLeft') || input.pressed('grenade')) this.page = Math.max(0, this.page - 1);
        if (input.pressed('back')) this.screen = 'menu';
        break;
      case 'options': this.updateOptions(input); break;
      case 'padsetup': this.updatePadSetup(input); break;
      case 'credits':
        if (input.pressed('back') || input.pressed('accept')) this.screen = 'menu';
        break;
    }
  }

  updateMenu(input) {
    if (this.timedMenu) {
      if (input.nav('up')) this.timedIndex = (this.timedIndex + TIMED_CHOICES.length - 1) % TIMED_CHOICES.length;
      if (input.nav('down')) this.timedIndex = (this.timedIndex + 1) % TIMED_CHOICES.length;
      if (input.pressed('back') || input.nav('left')) this.timedMenu = false;
      else if (input.pressed('accept')) {
        const mode = MENU_ITEMS[this.menuIndex].mode;
        this.timedMenu = false;
        this.startGame(mode, mode.game, TIMED_CHOICES[this.timedIndex]);
      }
      return;
    }
    if (input.nav('up')) this.menuIndex = (this.menuIndex + MENU_ITEMS.length - 1) % MENU_ITEMS.length;
    if (input.nav('down')) this.menuIndex = (this.menuIndex + 1) % MENU_ITEMS.length;
    const item = MENU_ITEMS[this.menuIndex];
    const locked = item.kind === 'mode' && item.mode.locked && !this.bomberUnlocked();
    const timedOk = item.kind === 'mode' && item.mode.id !== 'custom' && !locked;
    if (timedOk && (input.pressed('back') || input.nav('right'))) {
      this.timedMenu = true;
      return;
    }
    if (!input.pressed('accept') || locked) return;
    if (item.kind === 'screen') {
      this.screen = item.screen;
      this.page = 0;
      this.optionIndex = 0;
      this.scoreIndex = 0;
    } else if (item.mode.id === 'custom') {
      if (this.customGames.length) this.screen = 'custom';
    } else {
      this.startGame(item.mode, item.mode.game, 0);
    }
  }

  updateCustom(input) {
    const n = this.customGames.length;
    if (input.nav('up')) this.customIndex = (this.customIndex + n - 1) % n;
    if (input.nav('down')) this.customIndex = (this.customIndex + 1) % n;
    if (input.nav('left')) this.customTimed = (this.customTimed + TIMED_OPTIONS.length - 1) % TIMED_OPTIONS.length;
    if (input.nav('right') || input.pressed('rage')) this.customTimed = (this.customTimed + 1) % TIMED_OPTIONS.length;
    if (input.pressed('back')) this.screen = 'menu';
    else if (input.pressed('accept')) {
      const mode = MODES.find(m => m.id === 'custom');
      this.startGame(mode, this.customGames[this.customIndex], TIMED_OPTIONS[this.customTimed]);
    }
  }

  updatePause(input) {
    const g = this.game;
    if (input.nav('up')) this.pauseIndex = (this.pauseIndex + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length;
    if (input.nav('down')) this.pauseIndex = (this.pauseIndex + 1) % PAUSE_ITEMS.length;
    const item = PAUSE_ITEMS[this.pauseIndex];
    const step = input.nav('left') ? -1 : input.nav('right') ? 1 : 0;
    if (item === 'Background' && (step || input.pressed('accept'))) {
      this.options.background = this.options.background ? 0 : 1;
      this.saveOptions();
    } else if (item === 'Music' && (step || input.pressed('accept'))) {
      const n = SONGS.length + 1;
      this.options.music = (this.options.music + (step || 1) + n) % n;
      this.saveOptions();
    }
    if (input.pressed('start') || input.pressed('back') || (item === 'Resume Game' && input.pressed('accept'))) {
      g.paused = false;
      this.pauseIndex = 0;
    } else if (item === 'Restart Game' && input.pressed('accept')) {
      const s = this.lastStart;
      this.startGame(s.mode, s.game, s.timed);
    } else if (item === 'Exit Game' && input.pressed('accept')) {
      this.screen = 'menu';
      this.game = null;
    }
  }

  updateGame(input) {
    const g = this.game;
    if (g.paused) { this.updatePause(input); return; }
    if (g.state === 1 && g.recorded) {
      const e = this.entry;
      // Ignore input briefly so a button held at the moment of death can't skip the results.
      if (e && e.cooldown > 0) { e.cooldown--; return; }
      if (e && !e.done) {
        if (input.nav('up')) e.letters[e.pos] = (e.letters[e.pos] + 1) % INITIALS.length;
        if (input.nav('down')) e.letters[e.pos] = (e.letters[e.pos] + INITIALS.length - 1) % INITIALS.length;
        if (input.nav('left')) e.pos = Math.max(0, e.pos - 1);
        if (input.nav('right')) e.pos = Math.min(2, e.pos + 1);
        if (input.pressed('back')) e.pos = Math.max(0, e.pos - 1);
        if (input.pressed('accept')) {
          if (e.pos < 2) { e.pos++; return; }
          this.lastInitials = e.letters.slice();
          const name = e.letters.map(i => INITIALS[i]).join('');
          e.rank = this.recordScore(g.opts.scoreKey, name, g.score);
          e.done = true;
          e.cooldown = 20;
        }
        return;
      }
      if (input.pressed('accept')) {
        const s = this.lastStart;
        this.startGame(s.mode, s.game, s.timed);
      } else if (input.pressed('back')) {
        this.screen = 'menu';
        this.game = null;
      }
      return;
    }
    g.update(input);
  }

  // Controller setup works with the keyboard while mapping, because the pad's buttons may be wrong.
  updatePadSetup(input) {
    const c = this.input.capture;
    if (!c) {
      const raw = this.input.rawState();
      if (input.pressed('accept') && raw) this.input.startCapture();
      else if (input.pressed('rage') && raw) {
        this.input.resetProfile(raw.id);
        this.toast('Controller mapping reset to default');
      } else if (input.pressed('back')) this.screen = 'options';
      return;
    }
    if (c.done) {
      if (input.pressed('accept') || input.pressed('back')) {
        this.input.cancelCapture();
        this.toast('Controller mapping saved');
        this.screen = 'options';
      }
      return;
    }
    if (input.pressed('back')) this.input.cancelCapture();
    else if (input.pressed('grenade') || (input.pressed('accept') && this.input.device === 'keyboard')) this.input.nextCaptureStep();
  }

  updateHighscores(input) {
    const keys = this.scoreKeys();
    if (input.nav('right') || input.nav('down') || input.pressed('pageRight') || input.pressed('accept')) this.scoreIndex = (this.scoreIndex + 1) % keys.length;
    if (input.nav('left') || input.nav('up') || input.pressed('pageLeft')) this.scoreIndex = (this.scoreIndex + keys.length - 1) % keys.length;
    if (input.pressed('back')) this.screen = 'menu';
  }

  scoreKeys() {
    const keys = [];
    for (const m of MODES) {
      if (m.id === 'custom') continue;
      for (const t of TIMED_OPTIONS) keys.push({ key: this.scoreKey(m, m.game, t), label: m.label + (t ? ` Timed ${t / 60}:00` : '') });
    }
    for (const g of this.customGames) keys.push({ key: `custom:${g.NAME}`, label: `Custom - ${g.NAME}` });
    return keys;
  }

  updateOptions(input) {
    const rows = OPTION_ROWS.length + 1;
    if (input.nav('up')) this.optionIndex = (this.optionIndex + rows - 1) % rows;
    if (input.nav('down')) this.optionIndex = (this.optionIndex + 1) % rows;
    const row = OPTION_ROWS[this.optionIndex];
    let changed = false;
    if (row && row.action) {
      if (input.pressed('accept')) { this.screen = 'padsetup'; this.setupStarted = false; }
    } else if (row) {
      const o = this.options;
      if (row.bool) {
        if (input.nav('left') || input.nav('right') || input.pressed('accept')) { o[row.key] = !o[row.key]; changed = true; }
      } else {
        if (input.nav('left') && o[row.key] > row.min) { o[row.key]--; changed = true; }
        if (input.nav('right') && o[row.key] < row.max) { o[row.key]++; changed = true; }
        if (input.pressed('accept')) { o[row.key] = o[row.key] >= row.max ? row.min : o[row.key] + 1; changed = true; }
      }
      if (changed && row.key === 'vibration' && o.vibration) this.rumble(0.6, 200);
    } else if (input.pressed('accept')) {
      Object.assign(this.options, DEFAULT_OPTIONS);
      changed = true;
      this.toast('Options restored to defaults');
    }
    if (changed) this.saveOptions();
    if (input.pressed('back')) this.screen = 'menu';
  }

  // --- draw ------------------------------------------------------------------------------------

  draw() {
    const r = this.renderer;
    switch (this.screen) {
      case 'menu': this.drawMenu(r); break;
      case 'custom': this.drawCustom(r); break;
      case 'game':
        this.game.draw(r);
        if (this.game.paused) this.drawPause(r);
        break;
      case 'highscores': this.drawHighscores(r); break;
      case 'instructions': this.drawInstructions(r); break;
      case 'options': this.drawOptions(r); break;
      case 'padsetup': this.drawPadSetup(r); break;
      case 'credits': this.drawCredits(r); break;
    }
    this.toasts.forEach((t, i) => {
      const y = 0xd8 - (this.toasts.length - 1 - i) * 11;
      const w = r.smallWidth(t.text) + 8;
      r.panel((SCREEN_W - w) / 2, y - 1, w, 12);
      r.smallCenter(t.text, y, COLORS.warning, Math.min(1, t.ttl / 30));
    });
  }

  drawDemo(r) {
    r.background('menu');
    for (const e of this.demo.enemies) r.sprite(this.demo.enemySprite(e), e.x, e.y);
  }

  drawHeader(r, title) {
    r.text(`Squarez - ${title}`, 2, 2, COLORS.text);
  }

  drawMenu(r) {
    this.drawDemo(r);
    r.text('Squarez', 0x81, 0x14, COLORS.text, 1, 4);
    r.text('v0.8.2', 0x12d, 0x34, COLORS.text, ALPHA_M);
    const x = 0xcd;
    MENU_ITEMS.forEach((item, i) => {
      const y = 0x41 + i * 12;
      const sel = i === this.menuIndex;
      const locked = item.kind === 'mode' && item.mode.locked && !this.bomberUnlocked();
      if (locked) r.text(item.label, x, y, COLORS.alt, sel ? ALPHA_M : ALPHA_H);
      else r.text(item.label, x, y, COLORS.text, sel ? 1 : ALPHA_M);
    });
    const item = MENU_ITEMS[this.menuIndex];
    const locked = item.kind === 'mode' && item.mode.locked && !this.bomberUnlocked();
    const b = a => this.glyph(a);
    let help;
    if (this.timedMenu) {
      const y = this.menuIndex * 12 + 0x41;
      r.text('TIMED', 0x113, y, COLORS.text);
      TIMED_CHOICES.forEach((t, i) => r.text(`${t / 60}:00`, 0x148, y + i * 10, COLORS.text, i === this.timedIndex ? 1 : ALPHA_M));
      help = `${b('accept')}:Play Timed Game  ${b('back')}:Back`;
    } else if (locked) {
      help = 'Game Locked - Score 150 in Arcade Mode';
    } else if (item.kind === 'mode' && item.mode.id !== 'custom') {
      help = `${b('accept')}:Play Game  ${b('back')}:Select Timed Game`;
    } else {
      help = `${b('dpad')} Up/Dn:Select  ${b('accept')}:Select`;
    }
    r.smallCenter(help, 0xf0, locked ? COLORS.important : COLORS.text);
    r.center('Copyright 2005 GlobWare.com', 0x100, COLORS.text);
  }

  drawCustom(r) {
    this.drawDemo(r);
    r.dim(0.5);
    this.drawHeader(r, 'CUSTOM GAMES');
    r.text(`Custom Games: ${this.customGames.length}`, 2, 0x14, COLORS.text, ALPHA_M);
    this.customGames.forEach((g, i) => {
      const sel = i === this.customIndex;
      const y = 0x2c + i * 12;
      r.text(g.NAME, 0x14, y, COLORS.text, sel ? 1 : ALPHA_M);
      r.small(g.file, 0x118, y - 1, COLORS.alt, sel ? 1 : ALPHA_M);
    });
    const g = this.customGames[this.customIndex];
    const y = 0x34 + this.customGames.length * 12;
    r.text(`AUTHOR: ${g.AUTHOR}`, 0x14, y, COLORS.alt);
    r.text(g.DESCRIPTION, 0x14, y + 12, COLORS.text);
    r.text(g.script.length ? `SCRIPTED: YES (${g.script.length} LINES)` : 'SCRIPTED: NO', 0x14, y + 24, COLORS.alt);
    const t = TIMED_OPTIONS[this.customTimed];
    r.text(t ? `< TIMED ${t / 60}:00 >` : '< UNTIMED >', 0x14, y + 42, COLORS.warning);
    const b = a => this.glyph(a);
    r.smallCenter(`${b('dpad')} Up/Dn:Select Game  ${b('dpad')} Left/Right:Timed  ${b('accept')}:Play Game  ${b('back')}:Back`, 0xf6, COLORS.text);
  }

  drawPause(r) {
    r.dim(0.35);
    r.center('PAUSED', 0x64, COLORS.text);
    const values = {
      Background: `Background: ${this.options.background ? 'IMAGE' : 'COLOR'}`,
      Music: `Music: ${this.options.music ? `${this.options.music} of ${SONGS.length}` : 'OFF'}`,
    };
    PAUSE_ITEMS.forEach((item, i) => {
      const sel = i === this.pauseIndex;
      r.text(values[item] || item, 0x14, 0x28 + i * 12, COLORS.text, sel ? 1 : ALPHA_M);
    });
    const b = a => this.glyph(a);
    r.smallCenter(`${b('dpad')} Up/Dn:Select  ${b('dpad')} Left/Right:Change`, 0xf6, COLORS.text);
    r.smallCenter(`${b('accept')}:Accept  ${b('start')}:Continue`, 0x100, COLORS.text);
  }

  drawEndPanel(r, game) {
    const e = this.entry;
    const key = game.opts.scoreKey;
    const b = a => this.glyph(a);
    if (e && !e.done) {
      r.center('NEW HIGH SCORE', 0x3f, COLORS.text);
      r.center(`SCORE:${game.score}`, 0x52, COLORS.text);
      e.letters.forEach((l, i) => {
        const x = SCREEN_W / 2 - 28 + i * 20;
        r.text(INITIALS[l], x, 0x68, i === e.pos ? COLORS.warning : COLORS.text, 1, 2);
        if (i === e.pos && (game.blink & 2)) r.text('-', x + 4, 0x7a, COLORS.warning);
      });
      r.smallCenter(`${b('dpad')} Up/Dn:Adjust Initials  ${b('dpad')} Left/Right:Select  ${b('accept')}:Accept`, 0xf6, COLORS.text);
      return;
    }
    const list = this.scores[key] || [];
    r.center('High Scores', 0x50, COLORS.text);
    list.forEach((s, i) => {
      const line = `${String(i + 1).padStart(2, '0')}> ${s.name} ${String(s.score).padStart(4, ' ')}`;
      r.center(line, 100 + i * 11, i === e?.rank ? COLORS.important : COLORS.text);
    });
    if (!list.length) r.center(`SCORE:${game.score}`, 100, COLORS.text);
    r.smallCenter(`${b('accept')}:Restart  ${b('back')}:Back`, 0xeb, COLORS.text);
  }

  drawHighscores(r) {
    this.drawDemo(r);
    r.dim(0.5);
    this.drawHeader(r, 'HIGH SCORES');
    const keys = this.scoreKeys();
    const k = keys[this.scoreIndex];
    r.center(k.label, 0x30, COLORS.warning);
    r.center(`(${this.scoreIndex + 1} of ${keys.length})`, 0x3c, COLORS.text, ALPHA_M);
    const list = this.scores[k.key] || [];
    for (let i = 0; i < 10; i++) {
      const s = list[i];
      const line = s ? `${String(i + 1).padStart(2, '0')}> ${s.name} ${String(s.score).padStart(4, ' ')}` : `${String(i + 1).padStart(2, '0')}> ---    -`;
      r.center(line, 0x50 + i * 11, COLORS.text, s ? 1 : ALPHA_H);
    }
    const b = a => this.glyph(a);
    r.smallCenter(`${b('pageLeft')}:Prev Page  ${b('pageRight')}:Next Page  ${b('dpad')}:Change  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  drawInstructions(r) {
    this.drawDemo(r);
    r.dim(0.6);
    this.drawHeader(r, `INSTRUCTIONS (${this.page + 1} of 5)`);
    if (this.page === 0) {
      INSTRUCTIONS.forEach((l, i) => r.small(l, 6, 0x14 + i * 12, l.includes('MODE:') ? COLORS.warning : COLORS.text));
    } else if (this.page === 1) {
      TIPS.forEach((l, i) => r.small(l.replace(/\{(\w+)\}/g, (_, a) => this.glyph(a)), 6, 0x14 + i * 12, i === 0 ? COLORS.warning : COLORS.text));
      r.text('CONTROL LAYOUT', 6, 0x86, COLORS.warning);
      const pad = this.input.device === 'gamepad';
      const rows = [
        ['Move Player', pad ? 'Analog stick or D-Pad' : 'Arrow keys or WASD'],
        ['Turbo (hold)', pad ? '✕' : 'Shift or Z'],
        ['Slow (hold)', pad ? '○' : 'X'],
        ['Drop Grenade / Revive', pad ? '□' : 'Space'],
        ['Enable Rage', pad ? '△' : 'C or R'],
        ['Pause', pad ? 'START' : 'Esc or P'],
      ];
      rows.forEach(([a, k], i) => {
        r.small(a, 14, 0x96 + i * 12, COLORS.text);
        r.small(k, 140, 0x96 + i * 12, COLORS.warning);
      });
    } else {
      const start = (this.page - 2) * 7;
      r.center('Game Objects', 0x14, COLORS.warning);
      OBJECTS.slice(start, start + 7).forEach(([spr, desc], i) => {
        const y = 0x22 + i * 30;
        const w = SPRITES[spr][2];
        r.sprite(spr, 14 + (30 - w) / 2, y + (30 - w) / 2);
        r.small(desc, 52, y + 10, COLORS.text);
      });
    }
    const b = a => this.glyph(a);
    r.smallCenter(`${b('pageLeft')}:Previous Page  ${b('pageRight')}:Next Page  ${b('back')}:Back`, 0x102, COLORS.text);
  }

  drawOptions(r) {
    this.drawDemo(r);
    r.dim(0.5);
    this.drawHeader(r, 'OPTIONS');
    OPTION_ROWS.forEach((row, i) => {
      const y = 0x1a + i * 15;
      const sel = i === this.optionIndex;
      const v = this.options[row.key];
      const shown = row.action ? '' : row.bool ? (v ? 'ON' : 'OFF') : row.fmt ? row.fmt(v) : String(v);
      r.text(row.label, 0x14, y, COLORS.text, sel ? 1 : ALPHA_M);
      r.text(shown, 0xc8, y, sel ? COLORS.warning : COLORS.text, sel ? 1 : ALPHA_M);
    });
    const sel = this.optionIndex === OPTION_ROWS.length;
    r.text('Restore Defaults', 0x14, 0x1a + OPTION_ROWS.length * 15 + 2, COLORS.text, sel ? 1 : ALPHA_M);
    const b = a => this.glyph(a);
    r.smallCenter(`${b('dpad')} Up/Dn:Select  ${b('dpad')} Left/Right:-/+ Adjust Setting  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  drawPadSetup(r) {
    this.drawDemo(r);
    r.dim(0.6);
    this.drawHeader(r, 'CONTROLLER SETUP');
    const raw = this.input.rawState();
    const c = this.input.capture;
    if (!raw) {
      r.center('No controller detected', 0x50, COLORS.warning);
      r.center('Connect one and press any button on it', 0x64, COLORS.text, ALPHA_M);
      r.smallCenter('Esc:Back', 0x100, COLORS.text);
      return;
    }
    r.small(`Controller: ${raw.id.slice(0, 80)}`, 6, 0x14, COLORS.text);
    r.small(`Browser mapping: ${raw.mapping}   Layout in use: ${raw.profile}`, 6, 0x20, COLORS.text, ALPHA_M);
    r.small(`Buttons held: ${raw.buttons.join(' ') || '-'}`, 6, 0x2c, COLORS.alt);
    r.small(`Axes: ${raw.axes.join(' ')}`, 6, 0x38, COLORS.alt);
    if (!c) {
      r.center('Press Enter (or ✕) to map your controller', 0x5a, COLORS.text);
      r.center('step by step.', 0x68, COLORS.text);
      r.smallCenter('Each step waits for one button. Keyboard: Space skips a step, Esc cancels.', 0x80, COLORS.text, ALPHA_M);
      r.smallCenter('Enter:Start Mapping  C:Reset To Default  Esc:Back', 0x100, COLORS.text);
      return;
    }
    if (c.done) {
      r.center('Mapping saved!', 0x60, COLORS.warning);
      r.smallCenter('Enter / ✕:Done', 0x100, COLORS.text);
      return;
    }
    const step = SETUP_STEPS[c.step];
    r.center(`Step ${c.step + 1} of ${SETUP_STEPS.length}`, 0x50, COLORS.text, ALPHA_M);
    r.center('Press', 0x64, COLORS.text);
    r.smallCenter(step.label, 0x76, COLORS.warning);
    if (c.waitRelease) r.smallCenter('(release all buttons)', 0x8c, COLORS.text, ALPHA_M);
    r.smallCenter('Space:Skip (if your controller has no such button)  Esc:Cancel', 0x100, COLORS.text);
  }

  drawCredits(r) {
    this.drawDemo(r);
    r.dim(0.5);
    this.drawHeader(r, 'CREDITS');
    CREDITS.forEach((l, i) => r.center(l.toUpperCase(), 0x24 + i * 16, i === 0 ? COLORS.warning : COLORS.text));
    r.smallCenter(`${this.glyph('back')}:Back`, 0x100, COLORS.text);
  }
}

const INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';

const app = new App(document.getElementById('screen'));
window.squarez = app;
app.start().catch(err => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="error">${String(err)}</pre>`);
  throw err;
});
