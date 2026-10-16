import {
  SCREEN_W, SCREEN_H, SPRITES, SPR, SND, SOUNDS, SONGS, COLORS, MODES, CUSTOM_FILES, TIMED_OPTIONS,
  INSTRUCTIONS, TIPS, OBJECTS, CREDITS, parseGameFile, serializeGameFile, newCustomGame,
  STATS, SETTING_KEYS, SETTING_LABELS, SETTING_FLAGS, ENEMY_NAMES, TEXT_CHARS, TEXT_MAX,
  THEME_COLORS, DEFAULT_THEME, c5,
} from './data.js';
import { Game, DEADZONE_LO, DEADZONE_HI } from './game.js';
import { FONT_8X8, FONT_5X10, BUTTONS } from './font.js';
import { TouchControls } from './touch.js';
import { Link, ROOM_LETTERS, ROOM_CODE_LENGTH } from './net.js';

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
  KeyC: ['rage', 'triangle'], KeyR: ['rage', 'triangle'],
  // Space is both Square and Cross on the keyboard, so menus use F for Square.
  KeyF: ['square'],
  KeyI: ['import'],
  Enter: ['accept'],
  Escape: ['start', 'back'], KeyP: ['start'], Backspace: ['back'],
  PageUp: ['pageLeft'], KeyQ: ['pageLeft'], PageDown: ['pageRight'], KeyE: ['pageRight'],
};

// Labels for on-screen prompts. Gamepads show the PSP button glyphs from the original font;
// with the standard mapping they sit in the same place (A = Cross, B = Circle, X = Square, Y = Triangle).
const KEY_LABELS = {
  accept: 'Enter', back: 'Esc', turbo: 'Shift', slow: 'X', grenade: 'Space', rage: 'C', start: 'Esc',
  pageLeft: 'Q', pageRight: 'E', dpad: 'Arrows', square: 'F', triangle: 'C',
};
const PAD_LABELS = {
  accept: '✕', back: '○', turbo: '✕', slow: '○', grenade: '□', rage: '△',
  start: 'START', pageLeft: 'L1', pageRight: 'R1', dpad: 'D-Pad', square: '□', triangle: '△',
};
// The on-screen controls use the same glyphs as a pad.
const TOUCH_LABELS = { ...PAD_LABELS, pageLeft: 'L', pageRight: 'R', dpad: 'Stick' };

const STICK_NAV = 0.5;
const STICK_DEAD = 0.15;
const TOUCH_DEAD = 0.1;

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
      // An open text field takes every key so letters can be typed.
      if (this.app.text && this.app.textKey(e)) {
        e.preventDefault();
        this.device = 'keyboard';
        return;
      }
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
    // Touch only counts as a user activation (needed for audio) when the finger lifts.
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && !this.touch.visible) this.touch.setVisible(true);
      this.app.userGesture();
    });
    window.addEventListener('pointerup', () => this.app.userGesture());
    this.touch = new TouchControls(() => {
      if (this.app.options.vibration && navigator.vibrate) navigator.vibrate(8);
    });
    if (this.touch.visible) this.device = 'touch';
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
    const t = this.touch;
    if (t.active() || t.tapped.size) {
      for (const a of t.held) now.add(a);
      for (const a of t.tapped) now.add(a);
      t.tapped.clear();
      const { x, y } = t.stick;
      if (x || y) {
        ax = this.touchAxis(x);
        ay = this.touchAxis(y);
      }
      if (x < -STICK_NAV) now.add('navLeft');
      if (x > STICK_NAV) now.add('navRight');
      if (y < -STICK_NAV) now.add('navUp');
      if (y > STICK_NAV) now.add('navDown');
      this.device = 'touch';
    }
    if (this.capture) this.updateCapture();
    for (const p of this.pads()) {
      if (this.capture && !this.capture.done) break;
      const prof = this.profileFor(p);
      const b = i => i !== undefined && i !== null && !!(p.buttons[i] && p.buttons[i].pressed);
      const before = now.size;
      for (const d of this.dpad(p, prof)) now.add(d);
      if (b(prof.cross)) { now.add('turbo'); now.add('accept'); }
      if (b(prof.circle)) { now.add('slow'); now.add('back'); }
      if (b(prof.square)) { now.add('grenade'); now.add('square'); }
      if (b(prof.triangle)) { now.add('rage'); now.add('triangle'); }
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
        if (this.touch.visible) this.touch.setVisible(false);
        this.device = 'gamepad';
        this.padIndex = p.index;
      }
    }
    this.now = now;
    // PSP analog values: 0..255 with 0x82 at rest. The D-pad maps to the extremes (FUN_0890a20c).
    this.axisX = now.has('left') ? 0 : now.has('right') ? 0xff : ax ?? 0x82;
    this.axisY = now.has('up') ? 0 : now.has('down') ? 0xff : ay ?? 0x82;
  }

  // The game ignores the inner ~20% of the stick and then rounds speed down to whole pixels,
  // so a linear mapping left a wide dead spot. Past a small dead zone the touch stick starts
  // at the slowest speed for the current sensitivity and reaches full speed at the rim.
  touchAxis(v) {
    const m = Math.abs(v);
    if (m < TOUCH_DEAD) return 0x82;
    const g = this.app.game;
    const sens = (g && g.turbo) || this.app.options.sensitivity;
    const t = Math.min(1, (m - TOUCH_DEAD) / (0.95 - TOUCH_DEAD));
    if (v > 0) {
      const lo = Math.min(0xff, DEADZONE_HI + sens);
      return Math.ceil(lo + t * (0xff - lo));
    }
    const hi = Math.max(0, DEADZONE_LO - sens);
    return Math.floor(hi - t * hi);
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
    const labels = { gamepad: PAD_LABELS, touch: TOUCH_LABELS }[this.device] || KEY_LABELS;
    return labels[action] || action;
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

// Themes change these (see App.applyTheme).
let ALPHA_M = 160 / 255; // theme.txt TRANS_TEXTM: unselected menu entries
let ALPHA_H = 128 / 255; // theme.txt TRANS_TEXTH

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
    this.alphaLog = 200 / 255; // TRANS_TEXTLOGN
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
      this.ctx.fillStyle = COLORS.background;
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

  rect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  // Small text ending at the right edge.
  smallRight(str, y, color = COLORS.text, alpha = 1) {
    this.small(str, SCREEN_W - 2 - this.smallWidth(str), y, color, alpha);
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

function cloneTheme(t) {
  return JSON.parse(JSON.stringify(t));
}

// Custom game files are plain names ending in .TXT, like the files in custom/.
function cleanFilename(name) {
  let f = name.replace(/^.*[\\/]/, '').replace(/[^\w .-]/g, '').trim().toUpperCase() || 'UNTITLED.TXT';
  if (!f.endsWith('.TXT')) f = f.replace(/\.[^.]*$/, '') + '.TXT';
  return f;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "1 day 2h 3m 4s" as in the original's stats screen; zero shows as None.
function formatTime(secs) {
  if (!secs) return 'None';
  const d = Math.floor(secs / 86400), h = Math.floor(secs / 3600) % 24, m = Math.floor(secs / 60) % 60, s = secs % 60;
  const hms = `${h}h ${m}m ${s}s`;
  return d ? `${d} day${d === 1 ? '' : 's'} ${hms}` : hms;
}

// --- application -------------------------------------------------------------------------------

// Main menu, laid out like FUN_0891405c: entries at x=0xcd, y=0x41 + 12 * i.
const MENU_ITEMS = [
  ...MODES.map(m => ({ kind: 'mode', mode: m, label: m.label })),
  { kind: 'screen', screen: 'multi', label: 'Multiplayer' },
  { kind: 'screen', screen: 'options', label: 'Options' },
  { kind: 'screen', screen: 'stats', label: 'Stats' },
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
  { key: 'themes', label: 'Themes', action: true },
  { key: 'padsetup', label: 'Controller Setup', action: true },
];

const STATS_ROWS = 20;
const EDITOR_ROWS = 17;
const SCRIPT_ROWS = 18;
const CUSTOM_ROWS = 8;

const PAUSE_ITEMS = ['Resume Game', 'Background', 'Music', 'Restart Game', 'Exit Game'];
// A versus game restarts from its results screen, once both players choose Restart.
const VERSUS_PAUSE_ITEMS = PAUSE_ITEMS.filter(i => i !== 'Restart Game');

// Multiplayer (versus) setup. Custom games aren't offered because the guest may not have the file.
const VERSUS_MODES = MODES.filter(m => m.id !== 'custom');
const MULTI_ROWS = ['mode', 'timed', 'host', 'join'];
const VERSUS_VERSION = 1;

class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.options = { ...DEFAULT_OPTIONS, ...loadJSON('squarez.options', {}) };
    this.scores = loadJSON('squarez.scores', {});
    this.unlocks = loadJSON('squarez.unlocks', {});
    this.stats = loadJSON('squarez.stats', {});
    this.statsTop = 0;
    this.runFrames = 0;
    this.playFrames = 0;
    this.themes = [DEFAULT_THEME, ...loadJSON('squarez.themes', [])];
    this.themeIndex = Math.min(loadJSON('squarez.theme', 0), this.themes.length - 1);
    this.theme = cloneTheme(this.themes[this.themeIndex]);
    this.themeRow = 0;
    this.themeChannel = 0;
    this.edit = null;
    this.scriptTop = 0;
    this.customTop = 0;
    this.text = null;
    // Cheat mode, its in-game toggles and the bomb blocker menu easter egg. Not saved.
    this.cheats = { on: false, god: false, turbo: false, bombers: false };
    this.code = '';
    this.bomberSpawnAt = -Infinity;
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
    // Versus play: the setup screen's choices and the current link (see hostGame/joinGame).
    this.multiRow = 0;
    this.multiMode = 1;
    this.multiTimed = 0;
    this.mp = null;
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
    this.applyTheme();
    this.input = new Input(this);
    const flush = () => { if (document.visibilityState === 'hidden') this.saveStats(); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', () => this.saveStats());
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
    // Saved games replace a bundled file of the same name, like files copied over USB did.
    const list = games.filter(Boolean);
    for (const [file, text] of Object.entries(loadJSON('squarez.custom', {}))) {
      const g = parseGameFile(text);
      g.file = file;
      g.savedAs = file;
      g.user = true;
      const i = list.findIndex(b => b.file.toUpperCase() === file.toUpperCase());
      if (i >= 0) list[i] = g;
      else list.push(g);
    }
    this.customGames = list;
    this.customIndex = Math.min(this.customIndex, Math.max(0, list.length - 1));
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
    if (!this.options.vibration) return;
    if (this.input.device === 'touch' && navigator.vibrate) navigator.vibrate(Math.round(ms * strength));
    if (this.input.device !== 'gamepad') return;
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

  startGame(mode, game, timed, versus = false) {
    // Versus games keep out of the high score lists, which are for single player rules.
    const scoreKey = versus ? 'versus' : this.scoreKey(mode, game, timed);
    this.lastStart = { mode, game, timed };
    this.game = new Game(this, { mode, game, timed, scoreKey, versus });
    this.addStat(`games:${mode.id}:${timed}`);
    this.entry = null;
    this.pauseIndex = 0;
    this.screen = 'game';
  }

  gameEnded(game) {
    if (game.opts.versus) {
      this.entry = { done: true, rank: -1, cooldown: 45 };
      if (this.mp && game.out) this.mp.link.send({ t: 'out' });
      return;
    }
    // Games played with cheats don't make the high score list (DAT_089a6bb8).
    if (!game.cheated && this.qualifies(game.opts.scoreKey, game.score)) {
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
    if (++this.runFrames >= 60) {
      this.runFrames = 0;
      this.addStat('running');
    }
    if (this.statsDirty && this.runFrames === 0 && this.stats.running % 10 === 0) this.saveStats();
    if (this.screen !== 'game' && this.demo) this.updateDemo();
    if (this.text) { this.updateText(input); return; }
    switch (this.screen) {
      case 'menu': this.updateMenu(input); break;
      case 'custom': this.updateCustom(input); break;
      case 'multi': this.updateMulti(input); break;
      case 'lobby': this.updateLobby(input); break;
      case 'editor': this.updateEditor(input); break;
      case 'script': this.updateScript(input); break;
      case 'stats': this.updateStats(input); break;
      case 'themes': this.updateThemes(input); break;
      case 'sprites':
        if (input.pressed('back') || input.pressed('accept')) this.screen = 'themes';
        break;
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

  // Menu background. With the TTSST code on, a bomb blocker joins every 3 seconds until
  // 4 are on screen, and their explosions play out (FUN_0891405c).
  updateDemo() {
    const d = this.demo;
    d.frames++;
    if (this.cheats.bombers && d.enemies.filter(e => e.type === 6).length < 4 && d.frames - this.bomberSpawnAt >= 180) {
      this.bomberSpawnAt = d.frames;
      d.addEnemy(6);
    }
    d.updateEnemies();
    d.updateShrapnel();
    d.updateParticles();
    d.removeDead();
    d.phase = (d.phase + 1) & 3;
  }

  // Main menu codes (FUN_0891a510): □ adds S and △ adds T, any other input clears the
  // buffer, and the fifth press is checked against the three codes.
  menuCode(input) {
    if (input.pressed('square')) this.code += 'S';
    else if (input.pressed('triangle')) this.code += 'T';
    else {
      const other = ['up', 'down', 'left', 'right', 'navUp', 'navDown', 'navLeft', 'navRight', 'accept', 'back', 'start', 'pageLeft', 'pageRight'];
      if (other.some(a => input.pressed(a))) this.code = '';
      return;
    }
    if (this.code.length !== 5) {
      if (this.code.length > 10) this.code = '';
      return;
    }
    const code = this.code;
    if (code === 'SSSTT') {
      const c = this.cheats;
      c.on = !c.on;
      if (!c.on) { c.god = false; c.turbo = false; }
      this.audio.play(c.on ? SND.BONUSLIFE : SND.GENERATE);
    } else if (code === 'STSST') {
      // Same flag as scoring 150 in Arcade, so this can lock Bomber again too.
      this.unlocks.bomber = !this.unlocks.bomber;
      saveJSON('squarez.unlocks', this.unlocks);
      this.audio.play(SND.CRASH);
    } else if (code === 'TTSST') {
      this.cheats.bombers = !this.cheats.bombers;
      this.audio.play(SND.BONUSLIFE);
    } else return;
    this.code = '';
  }

  updateMenu(input) {
    if (!this.timedMenu) this.menuCode(input);
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
      this.screen = 'custom';
    } else {
      this.startGame(item.mode, item.mode.game, 0);
    }
  }

  // Custom game menu: ✕ Load Game, □ Game Settings, △ New Game (strings at 0x08980a0c).
  updateCustom(input) {
    const n = this.customGames.length;
    if (n && input.nav('up')) this.customIndex = (this.customIndex + n - 1) % n;
    if (n && input.nav('down')) this.customIndex = (this.customIndex + 1) % n;
    if (input.nav('left')) this.customTimed = (this.customTimed + TIMED_OPTIONS.length - 1) % TIMED_OPTIONS.length;
    if (input.nav('right')) this.customTimed = (this.customTimed + 1) % TIMED_OPTIONS.length;
    this.customTop = Math.max(Math.min(this.customTop, this.customIndex), this.customIndex - CUSTOM_ROWS + 1);
    const g = this.customGames[this.customIndex];
    if (input.pressed('back')) this.screen = 'menu';
    else if (input.pressed('triangle')) this.newGame();
    else if (input.pressed('import')) this.importCustom();
    else if (g && input.pressed('square')) this.openEditor(g);
    else if (g && input.pressed('accept')) {
      const mode = MODES.find(m => m.id === 'custom');
      this.startGame(mode, g, TIMED_OPTIONS[this.customTimed]);
    }
  }

  newGame() {
    const taken = new Set(this.customGames.map(g => g.file.toUpperCase()));
    let file = 'UNTITLED.TXT';
    for (let i = 2; taken.has(file); i++) file = `UNTITLED${i}.TXT`;
    const g = newCustomGame(file);
    g.dirty = true;
    this.customGames.push(g);
    this.customIndex = this.customGames.length - 1;
    this.openEditor(g);
  }

  importCustom() {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.txt,.TXT,text/plain';
    picker.addEventListener('change', async () => {
      const f = picker.files[0];
      if (!f) return;
      const g = parseGameFile(await f.text());
      g.file = cleanFilename(f.name);
      this.saveCustom(g);
      this.toast(`Imported ${g.file}`);
    });
    picker.click();
  }

  // --- custom game editor (pause menu page in the original: FUN_0891c23c / FUN_08923e78) ---

  editorRows(g) {
    const rows = [
      { label: 'Name', text: 'NAME' },
      { label: 'Author', text: 'AUTHOR' },
      { label: 'Description', text: 'DESCRIPTION' },
      { label: 'Filename', text: 'file' },
      ...SETTING_KEYS.map((k, i) => ({ label: SETTING_LABELS[i], setting: k })),
      { label: 'Save Custom File', action: 'save' },
      { label: 'Export .TXT File', action: 'export' },
    ];
    if (g.user) rows.push({ label: 'Delete Custom File', action: 'delete' });
    return rows;
  }

  openEditor(g) {
    this.edit = { game: g, index: 0, top: 0, confirm: false };
    this.screen = 'editor';
  }

  updateEditor(input) {
    const e = this.edit;
    const g = e.game;
    const rows = this.editorRows(g);
    const n = rows.length;
    const before = e.index;
    if (input.nav('up')) e.index = (e.index + n - 1) % n;
    if (input.nav('down')) e.index = (e.index + 1) % n;
    if (e.index !== before) e.confirm = false;
    e.top = Math.max(Math.min(e.top, e.index), e.index - EDITOR_ROWS + 1);
    const row = rows[e.index];
    if (row.setting) {
      const k = row.setting;
      const max = SETTING_FLAGS.has(k) ? 1 : 999;
      let v = g.settings[k];
      if (input.nav('left')) v--;
      if (input.nav('right')) v++;
      if (input.pressed('pageLeft')) v -= 10;
      if (input.pressed('pageRight')) v += 10;
      v = Math.max(0, Math.min(max, v));
      if (v !== g.settings[k]) { g.settings[k] = v; g.dirty = true; }
    }
    if (input.pressed('back')) { this.screen = 'custom'; return; }
    if (input.pressed('square')) { this.scriptTop = 0; this.screen = 'script'; return; }
    if (!input.pressed('accept')) return;
    if (row.text) {
      this.openText(row.label, g[row.text], v => {
        const value = row.text === 'file' ? cleanFilename(v) : v;
        if (value !== g[row.text]) { g[row.text] = value; g.dirty = true; }
      });
    } else if (row.action === 'save') {
      this.saveCustom(g);
    } else if (row.action === 'export') {
      download(cleanFilename(g.file), serializeGameFile(g));
    } else if (row.action === 'delete') {
      if (!e.confirm) { e.confirm = true; return; }
      const saved = loadJSON('squarez.custom', {});
      delete saved[g.savedAs || g.file];
      saveJSON('squarez.custom', saved);
      this.toast(`Deleted ${g.savedAs || g.file}`);
      this.edit = null;
      this.screen = 'custom';
      this.loadCustomGames();
    }
  }

  // Saved games live in localStorage, keyed by filename.
  saveCustom(g) {
    g.file = cleanFilename(g.file);
    const clash = this.customGames.find(o => o !== g && o.file.toUpperCase() === g.file.toUpperCase() && !o.user);
    const saved = loadJSON('squarez.custom', {});
    if (g.savedAs && g.savedAs !== g.file) delete saved[g.savedAs];
    saved[g.file] = serializeGameFile(g);
    saveJSON('squarez.custom', saved);
    g.savedAs = g.file;
    g.user = true;
    g.dirty = false;
    // Saving over another game's file replaces it, as on the PSP.
    const other = this.customGames.findIndex(o => o !== g && o.file.toUpperCase() === g.file.toUpperCase());
    if (other >= 0) this.customGames.splice(other, 1);
    if (!this.customGames.includes(g)) this.customGames.push(g);
    this.customIndex = this.customGames.indexOf(g);
    this.toast(clash ? `Saved ${g.file} (replaces the bundled game)` : `Saved ${g.file}`);
  }

  updateScript(input) {
    const max = Math.max(0, this.edit.game.script.length - SCRIPT_ROWS);
    if (input.nav('up')) this.scriptTop = Math.max(0, this.scriptTop - 1);
    if (input.nav('down')) this.scriptTop = Math.min(max, this.scriptTop + 1);
    if (input.pressed('pageLeft')) this.scriptTop = Math.max(0, this.scriptTop - SCRIPT_ROWS);
    if (input.pressed('pageRight')) this.scriptTop = Math.min(max, this.scriptTop + SCRIPT_ROWS);
    if (input.pressed('back') || input.pressed('square')) this.screen = 'editor';
  }

  // --- text entry: D-Pad picks letters, as on the PSP (FUN_08906fe0); keyboards can type ---

  openText(label, value, done) {
    const chars = [...value].slice(0, TEXT_MAX);
    this.text = { label, chars, pos: Math.min(chars.length, TEXT_MAX - 1), caps: true, done };
  }

  closeText(accept) {
    const t = this.text;
    this.text = null;
    if (accept) t.done(t.chars.join('').trim());
  }

  // Room code entry for Join Game: D-pad Down/Up steps through the letters, ✕ adds the selected
  // one, ○ deletes, and the code is used as soon as its last letter is in.
  openCode(done) {
    this.text = { code: true, chars: [], cur: 0, done };
  }

  addCodeLetter(letter) {
    const t = this.text;
    t.chars.push(letter);
    t.cur = 0;
    if (t.chars.length === ROOM_CODE_LENGTH) {
      this.text = null;
      t.done(t.chars.join(''));
    }
  }

  updateCode(input) {
    const t = this.text;
    const n = ROOM_LETTERS.length;
    if (input.nav('down')) t.cur = (t.cur + 1) % n;
    if (input.nav('up')) t.cur = (t.cur + n - 1) % n;
    if (input.pressed('accept')) this.addCodeLetter(ROOM_LETTERS[t.cur]);
    else if (input.pressed('back')) {
      if (!t.chars.length) this.text = null;
      else t.cur = ROOM_LETTERS.indexOf(t.chars.pop());
    }
  }

  codeKey(e) {
    const t = this.text;
    const letter = e.key.length === 1 ? e.key.toUpperCase() : '';
    if (letter && ROOM_LETTERS.includes(letter)) this.addCodeLetter(letter);
    else if (e.key === 'Backspace') { if (t.chars.length) t.chars.pop(); }
    else if (e.key === 'Escape') this.text = null;
    else if (e.key === 'ArrowDown') t.cur = (t.cur + 1) % ROOM_LETTERS.length;
    else if (e.key === 'ArrowUp') t.cur = (t.cur + ROOM_LETTERS.length - 1) % ROOM_LETTERS.length;
    else if (e.key === 'Enter') this.addCodeLetter(ROOM_LETTERS[t.cur]);
    else return false;
    return true;
  }

  updateText(input) {
    const t = this.text;
    if (t.code) { this.updateCode(input); return; }
    const cycle = d => {
      if (t.pos >= TEXT_MAX) return;
      const cur = (t.chars[t.pos] || ' ').toUpperCase();
      const i = Math.max(0, TEXT_CHARS.indexOf(cur));
      const next = TEXT_CHARS[(i + d + TEXT_CHARS.length) % TEXT_CHARS.length];
      t.chars[t.pos] = t.caps ? next : next.toLowerCase();
    };
    if (input.nav('up')) cycle(1);
    if (input.nav('down')) cycle(-1);
    if (input.nav('left')) t.pos = Math.max(0, t.pos - 1);
    if (input.nav('right') || input.pressed('back')) t.pos = Math.min(t.chars.length, TEXT_MAX - 1, t.pos + 1);
    if (input.pressed('square')) t.caps = !t.caps;
    if (input.pressed('pageLeft') && t.pos > 0) t.chars.splice(--t.pos, 1);
    if (input.pressed('accept') || input.pressed('pageRight')) this.closeText(true);
  }

  // Keyboard typing for an open text field. Returns true when the key was used.
  textKey(e) {
    const t = this.text;
    if (t.code) return this.codeKey(e);
    if (e.key === 'Enter') this.closeText(true);
    else if (e.key === 'Escape') this.closeText(false);
    else if (e.key === 'Backspace') { if (t.pos > 0) t.chars.splice(--t.pos, 1); }
    else if (e.key === 'Delete') t.chars.splice(t.pos, 1);
    else if (e.key === 'ArrowLeft') t.pos = Math.max(0, t.pos - 1);
    else if (e.key === 'ArrowRight') t.pos = Math.min(t.chars.length, t.pos + 1);
    else if (e.key === 'Home') t.pos = 0;
    else if (e.key === 'End') t.pos = t.chars.length;
    else if (e.key.length === 1 && e.key >= ' ' && e.key <= '~') {
      if (t.chars.length < TEXT_MAX) t.chars.splice(t.pos++, 0, e.key);
    } else return false;
    return true;
  }

  // --- stats (FUN_089023f0 draws, FUN_0891b100 handles input) ---

  addStat(key, n = 1) {
    this.stats[key] = (this.stats[key] || 0) + n;
    this.statsDirty = true;
  }

  saveStats() {
    if (!this.statsDirty) return;
    this.statsDirty = false;
    saveJSON('squarez.stats', this.stats);
  }

  statValue(row) {
    if (!row.sum) return this.stats[row.key] || 0;
    let total = 0;
    for (const [k, v] of Object.entries(this.stats)) if (k.startsWith(row.key + ':')) total += v;
    return total;
  }

  updateStats(input) {
    const max = STATS.length - STATS_ROWS;
    const fast = input.held('pageRight');
    if (input.held('pageLeft') && fast && (input.pressed('pageLeft') || input.pressed('pageRight'))) {
      // Asks once before wiping everything; the original reset straight away.
      if (!this.statsConfirm) {
        this.statsConfirm = 240;
        this.toast(`Press ${this.glyph('pageLeft')}+${this.glyph('pageRight')} again to reset all stats`);
      } else {
        this.statsConfirm = 0;
        this.stats = {};
        this.statsDirty = true;
        // FUN_0891b100 also clears the Bomber unlock (DAT_089a6ba4) here.
        this.unlocks.bomber = false;
        saveJSON('squarez.unlocks', this.unlocks);
        this.saveStats();
        this.toast('Stats reset');
      }
      return;
    }
    if (this.statsConfirm) this.statsConfirm--;
    // Holding R1 scrolls every frame (QuickScroll).
    const step = dir => (fast ? input.held(dir) || input.held('nav' + dir[0].toUpperCase() + dir.slice(1)) : input.nav(dir));
    if (step('up')) this.statsTop = Math.max(0, this.statsTop - 1);
    if (step('down')) this.statsTop = Math.min(max, this.statsTop + 1);
    if (input.pressed('back')) this.screen = 'menu';
  }

  // --- themes (Options > Themes, FUN_0890389c) ---

  applyTheme() {
    const th = this.theme;
    for (const row of THEME_COLORS) {
      const [r, g, b] = th.colors[row.key];
      const n = th.trans[row.key] ? th.trans[row.key][0] : 255;
      // Log text fades as a whole (Renderer.alphaLog); other kinds bake TRANS_*N into the colour.
      COLORS[row.key] = row.key === 'log' || row.key === 'background' || n >= 255 ? c5(r, g, b)
        : c5(r, g, b).replace('rgb(', 'rgba(').replace(')', `,${(n / 255).toFixed(3)})`);
    }
    ALPHA_M = th.trans.text[1] / 255;
    ALPHA_H = th.trans.text[2] / 255;
    const rend = this.renderer;
    rend.alphaM = ALPHA_M;
    rend.alphaH = ALPHA_H;
    rend.alphaLog = th.trans.log[0] / 255;
    rend.tinted.clear();
  }

  themeRows() {
    const rows = [
      { label: 'Theme Name', text: 'NAME' },
      { label: 'Author', text: 'AUTHOR' },
      { label: 'Description', text: 'DESCRIPTION' },
      ...THEME_COLORS.map(c => ({ label: c.label, color: c })),
      { label: 'Save Theme', action: 'save' },
      { label: 'View Sprites', action: 'sprites' },
      { label: 'Restore Defaults', action: 'defaults' },
    ];
    if (this.themeIndex > 0) rows.push({ label: 'Delete Theme', action: 'delete' });
    return rows;
  }

  selectTheme(i) {
    this.themeIndex = i;
    this.theme = cloneTheme(this.themes[i]);
    this.themeDirty = false;
    saveJSON('squarez.theme', i);
    this.applyTheme();
  }

  saveThemes() {
    saveJSON('squarez.themes', this.themes.slice(1));
    saveJSON('squarez.theme', this.themeIndex);
  }

  updateThemes(input) {
    const rows = this.themeRows();
    const n = rows.length;
    const before = this.themeRow;
    if (input.nav('up')) this.themeRow = (this.themeRow + n - 1) % n;
    if (input.nav('down')) this.themeRow = (this.themeRow + 1) % n;
    if (this.themeRow !== before) this.themeConfirm = false;
    const row = rows[this.themeRow];
    const th = this.theme;
    if (input.pressed('back')) {
      if (this.themeDirty) this.toast('Theme changes are not saved until you Save Theme');
      this.screen = 'options';
      return;
    }
    if (this.themeRow === 0) {
      // Left/Right on the name switches between saved themes (Change Theme).
      const count = this.themes.length;
      if (input.nav('left')) this.selectTheme((this.themeIndex + count - 1) % count);
      if (input.nav('right')) this.selectTheme((this.themeIndex + 1) % count);
    }
    if (row.color) {
      const channels = 3 + row.color.trans;
      this.themeChannel = Math.min(this.themeChannel, channels - 1);
      if (input.pressed('accept') || input.pressed('pageRight')) this.themeChannel = (this.themeChannel + 1) % channels;
      if (input.pressed('pageLeft')) this.themeChannel = (this.themeChannel + channels - 1) % channels;
      const d = (input.nav('right') ? 1 : 0) - (input.nav('left') ? 1 : 0);
      if (d) {
        const key = row.color.key;
        const c = this.themeChannel;
        if (c < 3) th.colors[key][c] = Math.max(0, Math.min(31, th.colors[key][c] + d));
        else th.trans[key][c - 3] = Math.max(0, Math.min(255, th.trans[key][c - 3] + d * 5));
        this.themeDirty = true;
        this.applyTheme();
      }
      return;
    }
    if (!input.pressed('accept')) return;
    if (row.text) {
      this.openText(row.label, th[row.text], v => {
        if (v !== th[row.text]) { th[row.text] = v; this.themeDirty = true; }
      });
    } else if (row.action === 'save') {
      if (this.themeIndex === 0) {
        // The default theme stays as shipped; saving it makes a new theme.
        if (th.NAME === DEFAULT_THEME.NAME) th.NAME = `THEME ${this.themes.length}`;
        this.themes.push(cloneTheme(th));
        this.themeIndex = this.themes.length - 1;
      } else {
        this.themes[this.themeIndex] = cloneTheme(th);
      }
      this.saveThemes();
      this.themeDirty = false;
      this.toast(`Saved theme ${th.NAME}`);
    } else if (row.action === 'sprites') {
      this.screen = 'sprites';
    } else if (row.action === 'defaults') {
      const d = cloneTheme(DEFAULT_THEME);
      th.colors = d.colors;
      th.trans = d.trans;
      this.themeDirty = true;
      this.applyTheme();
      this.toast('Theme colors restored to defaults');
    } else if (row.action === 'delete') {
      if (!this.themeConfirm) { this.themeConfirm = true; return; }
      this.themeConfirm = false;
      this.themes.splice(this.themeIndex, 1);
      this.selectTheme(0);
      this.saveThemes();
      this.themeRow = 0;
      this.toast('Theme deleted');
    }
  }

  // --- multiplayer (versus) ---
  // The original hosts over Wi-Fi and the joiner types the host's IP address. Browsers can't
  // listen for connections, so a room code finds the host through the PeerJS server (net.js).

  versusMode() { return VERSUS_MODES[this.multiMode]; }

  updateMulti(input) {
    const n = MULTI_ROWS.length;
    if (input.nav('up')) this.multiRow = (this.multiRow + n - 1) % n;
    if (input.nav('down')) this.multiRow = (this.multiRow + 1) % n;
    const row = MULTI_ROWS[this.multiRow];
    const step = input.nav('left') ? -1 : input.nav('right') ? 1 : 0;
    if (row === 'mode' && (step || input.pressed('accept'))) {
      const m = VERSUS_MODES.length;
      do this.multiMode = (this.multiMode + (step || 1) + m) % m;
      while (VERSUS_MODES[this.multiMode].locked && !this.bomberUnlocked());
    } else if (row === 'timed' && (step || input.pressed('accept'))) {
      const m = TIMED_OPTIONS.length;
      this.multiTimed = (this.multiTimed + (step || 1) + m) % m;
    } else if (row === 'host' && input.pressed('accept')) {
      this.hostGame();
    } else if (row === 'join' && input.pressed('accept')) {
      this.openCode(code => this.joinGame(code));
    }
    if (input.pressed('back')) this.screen = 'menu';
  }

  newLink(role) {
    if (this.mp) this.mp.link.close();
    const link = new Link();
    const mp = { link, role, code: null, status: 'connecting', error: null, mode: null, timed: 0 };
    this.mp = mp;
    link.onPeer = () => { if (this.mp === mp) this.sendHello(); };
    link.onMessage = msg => { if (this.mp === mp) this.netMessage(msg); };
    link.onClose = reason => { if (this.mp === mp) this.netClosed(reason); };
    this.screen = 'lobby';
    return mp;
  }

  hostGame() {
    const mp = this.newLink('host');
    mp.mode = this.versusMode();
    mp.timed = TIMED_OPTIONS[this.multiTimed];
    mp.link.host().then(code => {
      if (this.mp !== mp) return;
      mp.code = code;
      mp.status = 'waiting';
    }).catch(err => this.netFailed(mp, err));
  }

  joinGame(code) {
    const mp = this.newLink('guest');
    mp.code = code;
    // Once connected, the host's hello message starts the game.
    mp.link.join(code).then(() => { if (this.mp === mp) mp.status = 'connected'; })
      .catch(err => this.netFailed(mp, err));
  }

  netFailed(mp, err) {
    if (this.mp !== mp) return;
    mp.link.close();
    mp.status = 'error';
    mp.error = err.message;
  }

  // The host picks the game; sending it to the guest puts both players on Waiting for Opponent.
  sendHello() {
    const mp = this.mp;
    mp.link.send({ t: 'hello', v: VERSUS_VERSION, mode: mp.mode.id, timed: mp.timed });
    this.startVersus();
  }

  netMessage(msg) {
    const mp = this.mp;
    const g = this.screen === 'game' && this.game && this.game.opts.versus ? this.game : null;
    if (msg.t === 'hello' && mp.role === 'guest') {
      if (msg.v !== VERSUS_VERSION) {
        this.netFailed(mp, new Error('The other player has a different version. Reload both games'));
        return;
      }
      mp.mode = VERSUS_MODES.find(m => m.id === msg.mode) || VERSUS_MODES[0];
      mp.timed = TIMED_OPTIONS.includes(msg.timed) ? msg.timed : 0;
      this.startVersus();
    } else if (msg.t === 'ready') {
      mp.oppReady = true;
      this.checkReady();
    } else if (msg.t === 'score' && g && Number.isInteger(msg.score) && msg.score >= 0) {
      g.opponentScored(msg.score);
    } else if (msg.t === 'out' && g) {
      g.oppOut = true;
    }
  }

  netClosed(reason) {
    const mp = this.mp;
    // Close fully so a waiting host can't be joined by someone else mid-game.
    mp.link.close();
    if (this.screen === 'game') {
      mp.lost = reason;
    } else {
      mp.status = 'error';
      mp.error = reason === 'left' ? 'The other player left' : 'Connection lost';
    }
  }

  // A new game (first or restarted) waits in state 3 until both players have sent ready.
  startVersus() {
    const mp = this.mp;
    mp.status = 'playing';
    mp.sent = -1;
    this.text = null;
    this.startGame(mp.mode, mp.mode.game, mp.timed, true);
    mp.link.send({ t: 'ready' });
    this.checkReady();
  }

  checkReady() {
    const mp = this.mp;
    const g = this.game;
    if (!mp.oppReady || !g || !g.opts.versus || g.state !== 3) return;
    mp.oppReady = false;
    g.startVersus();
  }

  sendScore() {
    const mp = this.mp;
    if (!mp || mp.lost || this.game.score === mp.sent) return;
    mp.sent = this.game.score;
    mp.link.send({ t: 'score', score: mp.sent });
  }

  leaveVersus() {
    if (this.mp) this.mp.link.close();
    this.mp = null;
    this.game = null;
    this.screen = 'multi';
  }

  updateLobby(input) {
    if (input.pressed('back') || (this.mp.status === 'error' && input.pressed('accept'))) this.leaveVersus();
  }

  // Results: ✕ restarts, which waits for the opponent to restart too; ○ goes back.
  updateVersusEnd(input) {
    const e = this.entry;
    if (e && e.cooldown > 0) { e.cooldown--; return; }
    if (input.pressed('back')) this.leaveVersus();
    else if (input.pressed('accept') && !this.mp.lost) this.startVersus();
  }

  pauseItems() {
    return this.game && this.game.opts.versus ? VERSUS_PAUSE_ITEMS : PAUSE_ITEMS;
  }

  updatePause(input) {
    const g = this.game;
    const items = this.pauseItems();
    if (input.nav('up')) this.pauseIndex = (this.pauseIndex + items.length - 1) % items.length;
    if (input.nav('down')) this.pauseIndex = (this.pauseIndex + 1) % items.length;
    const item = items[this.pauseIndex];
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
      if (g.opts.versus) { this.leaveVersus(); return; }
      this.screen = 'menu';
      this.game = null;
    }
  }

  updateGame(input) {
    const g = this.game;
    if (g.opts.versus) this.sendScore();
    if (g.paused) { this.updatePause(input); return; }
    if (g.state === 1 && g.recorded && g.opts.versus) { this.updateVersusEnd(input); return; }
    if (g.state === 3 && input.pressed('back')) { this.leaveVersus(); return; }
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
    if (!g.paused && ++this.playFrames >= 60) {
      this.playFrames = 0;
      this.addStat(`time:${g.mode.id}:${g.opts.timed}`);
    }
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
    // The original resets with L1+R1, but here L1/R1 also turn pages, so △ (pressed twice) resets.
    if (input.pressed('triangle')) {
      const k = keys[this.scoreIndex];
      if (this.scoreConfirm !== k.key) {
        this.scoreConfirm = k.key;
        this.toast(`Press ${this.glyph('triangle')} again to reset ${k.label}`);
      } else {
        this.scoreConfirm = null;
        delete this.scores[k.key];
        saveJSON('squarez.scores', this.scores);
        this.toast(`${k.label} high scores reset`);
      }
      return;
    }
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
      if (input.pressed('accept')) {
        this.screen = row.key;
        this.setupStarted = false;
        this.themeRow = 0;
      }
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
      case 'multi': this.drawMulti(r); break;
      case 'lobby': this.drawLobby(r); break;
      case 'game':
        this.game.draw(r);
        if (this.game.opts.versus) this.drawVersusStatus(r);
        if (this.game.paused) this.drawPause(r);
        break;
      case 'highscores': this.drawHighscores(r); break;
      case 'instructions': this.drawInstructions(r); break;
      case 'options': this.drawOptions(r); break;
      case 'padsetup': this.drawPadSetup(r); break;
      case 'credits': this.drawCredits(r); break;
      case 'stats': this.drawStats(r); break;
      case 'editor': this.drawEditor(r); break;
      case 'script': this.drawScript(r); break;
      case 'themes': this.drawThemes(r); break;
      case 'sprites': this.drawSprites(r); break;
    }
    if (this.text) this.drawText(r);
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
    this.demo.drawEffects(r);
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
    if (this.cheats.on) r.text('CHEAT ON', 0x19e, 0x100, COLORS.important);
  }

  drawCustom(r) {
    this.drawDemo(r);
    r.dim(0.5);
    this.drawHeader(r, 'CUSTOM GAMES');
    r.text(`Custom Games: ${this.customGames.length}`, 2, 0x14, COLORS.text, ALPHA_M);
    const shown = this.customGames.slice(this.customTop, this.customTop + CUSTOM_ROWS);
    shown.forEach((g, k) => {
      const i = this.customTop + k;
      const sel = i === this.customIndex;
      const y = 0x2c + k * 12;
      r.text(g.NAME + (g.dirty ? '*' : ''), 0x14, y, COLORS.text, sel ? 1 : ALPHA_M);
      r.small(g.file, 0x118, y - 1, g.user ? COLORS.warning : COLORS.alt, sel ? 1 : ALPHA_M);
    });
    if (this.customTop > 0) r.text('^', 6, 0x2c, COLORS.warning);
    if (this.customTop + CUSTOM_ROWS < this.customGames.length) r.text('v', 6, 0x2c + (CUSTOM_ROWS - 1) * 12, COLORS.warning);
    const b = a => this.glyph(a);
    const g = this.customGames[this.customIndex];
    const y = 0x34 + Math.min(CUSTOM_ROWS, Math.max(1, this.customGames.length)) * 12;
    if (g) {
      r.text(`AUTHOR: ${g.AUTHOR}`, 0x14, y, COLORS.alt);
      r.text(g.DESCRIPTION, 0x14, y + 12, COLORS.text);
      r.text(g.script.length ? `SCRIPTED: YES (${g.script.length} LINES)` : 'SCRIPTED: NO', 0x14, y + 24, COLORS.alt);
      const t = TIMED_OPTIONS[this.customTimed];
      r.text(t ? `< TIMED ${t / 60}:00 >` : '< UNTIMED >', 0x14, y + 38, COLORS.warning);
    } else {
      r.text(`No custom games. Press ${b('triangle')} to make one.`, 0x14, 0x2c, COLORS.warning);
    }
    r.smallCenter(`${b('dpad')} Up/Dn:Select Game  ${b('dpad')} Left/Right:Timed${this.input.device === 'keyboard' ? '  I:Import .TXT' : ''}`, 0xf6, COLORS.text);
    r.smallCenter(`${b('accept')}:Load Game  ${b('square')}:Game Settings  ${b('triangle')}:New Game  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  // Custom game editor: labels at x=2, values at x=0xf2, 17 rows from y=0x1e (FUN_0891c23c).
  drawEditor(r) {
    this.drawDemo(r);
    r.dim(0.6);
    const e = this.edit;
    const g = e.game;
    this.drawHeader(r, 'CUSTOM GAME EDITOR');
    r.small(`Current Game File: ${g.savedAs || g.file}${g.dirty ? '  (UNSAVED CHANGES)' : ''}`, 2, 0x10, COLORS.alt);
    const rows = this.editorRows(g);
    rows.slice(e.top, e.top + EDITOR_ROWS).forEach((row, k) => {
      const i = e.top + k;
      const y = 0x1e + k * 12;
      const sel = i === e.index;
      const a = sel ? 1 : ALPHA_M;
      let label = row.label;
      if (row.action === 'delete' && sel && e.confirm) label = `Delete Custom File - press ${this.glyph('accept')} again`;
      r.text(label, 2, y, row.action ? COLORS.warning : COLORS.text, a);
      const v = row.text ? g[row.text] : row.setting ? String(g.settings[row.setting]) : '';
      if (row.text && v.length * 8 > SCREEN_W - 0xf2) r.small(v, 0xf2, y - 1, sel ? COLORS.warning : COLORS.text, a);
      else r.text(v, 0xf2, y, sel ? COLORS.warning : COLORS.text, a);
    });
    const b = a => this.glyph(a);
    const row = rows[e.index];
    const adjust = row.setting ? `  ${b('dpad')} Left/Right:-/+ Adjust Setting  ${b('pageLeft')}/${b('pageRight')}:-/+10` : '';
    r.smallCenter(`${b('dpad')} Up/Dn:Select Setting${adjust}`, 0xf6, COLORS.text);
    r.smallCenter(`${b('accept')}:Select  ${b('square')}:Compiled Script  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  drawScript(r) {
    this.drawDemo(r);
    r.dim(0.6);
    const g = this.edit.game;
    this.drawHeader(r, 'CUSTOM GAME EDITOR');
    r.text(`Compiled Script (${g.script.length} LINES)`, 2, 0x14, COLORS.text);
    r.text('LINE  SPAWN  ACTION', 2, 0x24, COLORS.warning);
    const pad = (n, w) => String(n).padStart(w, '0');
    g.script.slice(this.scriptTop, this.scriptTop + SCRIPT_ROWS).forEach((s, k) => {
      const head = `${pad(this.scriptTop + k + 1, 4)}   ${pad(s.score, 3)}   `;
      const action = s.kind === 'ADDENEMY' ? `ADDENEMY(${ENEMY_NAMES[s.type]})`
        : s.kind === 'MODSETTING' ? `MODSETTING(${s.key})(${s.value})`
        : s.kind === 'GAMETIMER' ? `GAMETIMER ${s.seconds} SECS` : 'WINGAME';
      r.text(head + action, 2, 0x30 + k * 10, COLORS.text);
    });
    if (!g.script.length) r.text('SCRIPTED: NO', 2, 0x30, COLORS.alt);
    const b = a => this.glyph(a);
    r.smallCenter(`${b('dpad')} Up/Dn:Scroll  ${b('pageLeft')}/${b('pageRight')}:Page  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  drawCode(r) {
    const t = this.text;
    r.dim(0.6);
    r.rect(0x10, 0x48, SCREEN_W - 0x20, 0x5c, COLORS.alt);
    r.rect(0x11, 0x49, SCREEN_W - 0x22, 0x5a, '#000');
    r.center('ENTER ROOM CODE', 0x50, COLORS.warning);
    // Four large letter boxes: entered letters, then the one being chosen, then blanks.
    const size = 32, gap = 8;
    const x0 = (SCREEN_W - (ROOM_CODE_LENGTH * size + (ROOM_CODE_LENGTH - 1) * gap)) / 2;
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      const x = x0 + i * (size + gap);
      const cur = i === t.chars.length;
      r.rect(x, 0x62, size, size, cur ? 'rgba(255,255,0,0.15)' : 'rgba(255,255,255,0.08)');
      const ch = i < t.chars.length ? t.chars[i] : cur ? ROOM_LETTERS[t.cur] : '';
      if (ch) r.text(ch, x, 0x62, cur ? COLORS.warning : COLORS.text, 1, 4);
      if (cur && ((this.demo.frames >> 4) & 1)) r.rect(x, 0x62 + size + 1, size, 2, COLORS.warning);
    }
    const b = a => this.glyph(a);
    if (this.input.device === 'keyboard') {
      r.smallCenter('Type the code   Backspace:Delete   Esc:Cancel', 0x92, COLORS.text);
    } else {
      r.smallCenter(`${b('dpad')} Down/Up:Change Letter  ${b('accept')}:Add Letter  ${b('back')}:Delete`, 0x92, COLORS.text);
    }
  }

  drawText(r) {
    const t = this.text;
    if (t.code) { this.drawCode(r); return; }
    r.dim(0.6);
    r.rect(0x10, 0x48, SCREEN_W - 0x20, 0x5c, COLORS.alt);
    r.rect(0x11, 0x49, SCREEN_W - 0x22, 0x5a, '#000');
    r.center(t.label, 0x50, COLORS.warning);
    const x = SCREEN_W / 2 - TEXT_MAX * 4;
    r.rect(x - 2, 0x64, TEXT_MAX * 8 + 4, 12, 'rgba(255,255,255,0.08)');
    r.text(t.chars.join(''), x, 0x66, COLORS.text);
    if ((this.demo.frames >> 4) & 1) r.rect(x + t.pos * 8, 0x6f, 8, 1, COLORS.warning);
    r.small(`${t.chars.length}/${TEXT_MAX}`, x + TEXT_MAX * 8 - 30, 0x74, COLORS.alt);
    const b = a => this.glyph(a);
    if (this.input.device === 'keyboard') {
      r.smallCenter('Type to edit   Arrows:Move   Backspace:Delete', 0x86, COLORS.text);
      r.smallCenter('Enter:Done   Esc:Cancel', 0x92, COLORS.text);
    } else {
      r.smallCenter(`${b('dpad')} Up/Dn:Change Letter  ${b('dpad')} Left/Right:Move`, 0x86, COLORS.text);
      r.smallCenter(`${b('accept')}:Select  ${b('square')}:Caps ${t.caps ? 'Off' : 'On'}  ${b('back')}:Advance  L1:Backspace  R1:Done`, 0x92, COLORS.text);
    }
  }

  // 20 rows from y=0x19, 11 pixels apart: "label: " in the alt colour, then the value.
  drawStats(r) {
    this.drawDemo(r);
    r.dim(0.6);
    this.drawHeader(r, 'STATS');
    STATS.slice(this.statsTop, this.statsTop + STATS_ROWS).forEach((row, i) => {
      const y = 0x19 + i * 11;
      const label = `${row.label}: `;
      const v = this.statValue(row);
      r.small(label, 2, y, COLORS.alt);
      r.small(row.time ? formatTime(v) : v.toLocaleString('en-US'), 2 + r.smallWidth(label), y, COLORS.text);
    });
    const b = a => this.glyph(a);
    r.small(`(${STATS.length} stats)`, 2, 0x100, COLORS.text);
    r.smallCenter(`${b('pageLeft')}+${b('pageRight')}:Reset Stats  ${b('pageRight')}:QuickScroll  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  // Theme editor, laid out like FUN_0890389c: values from x=0x96, R/G/B then a swatch,
  // then the N/M/H transparencies and a sample letter.
  drawThemes(r) {
    this.drawDemo(r);
    r.dim(0.6);
    const th = this.theme;
    this.drawHeader(r, `OPTIONS - THEMES (${this.themeIndex + 1} of ${this.themes.length})`);
    r.small(this.themeIndex ? `Saved theme${this.themeDirty ? ' (UNSAVED CHANGES)' : ''}` : `Built-in theme${this.themeDirty ? ' (UNSAVED CHANGES)' : ''}`, 2, 0x10, COLORS.alt);
    const rows = this.themeRows();
    const ys = [];
    let y = 0x20;
    rows.forEach((row, i) => {
      if (i === 3) {
        r.text('COLOR SETTINGS', 0x96, 0x53, COLORS.text);
        r.text('TRANSPARENCY SETTINGS', 0x12c, 0x53, COLORS.text);
        y = 0x62;
      }
      if (row.action && !rows[i - 1].action) y += 6;
      ys.push(y);
      y += row.color ? 11 : 12;
    });
    rows.forEach((row, i) => {
      const sel = i === this.themeRow;
      const a = sel ? 1 : ALPHA_M;
      let label = row.label;
      if (row.action === 'delete' && sel && this.themeConfirm) label = `Delete Theme - press ${this.glyph('accept')} again`;
      r.text(label, 2, ys[i], row.action ? COLORS.warning : COLORS.text, a);
      if (row.text) {
        r.text(th[row.text], 0x96, ys[i], sel ? COLORS.warning : COLORS.text, a);
        if (i === 0 && sel) r.text('<>', 0x96 + th.NAME.length * 8 + 6, ys[i], COLORS.warning);
      }
      if (!row.color) return;
      const key = row.color.key;
      const [cr, cg, cb] = th.colors[key];
      const trans = th.trans[key] || [];
      const chan = (c, s, x) => r.text(s, x, ys[i], sel && this.themeChannel === c ? COLORS.warning : COLORS.text, sel ? 1 : ALPHA_M);
      chan(0, `R:${cr}`, 0x96);
      chan(1, `G:${cg}`, 0xbe);
      chan(2, `B:${cb}`, 0xe6);
      r.rect(0x113, ys[i] - 1, 10, 10, c5(cr, cg, cb));
      ['N', 'M', 'H'].slice(0, row.color.trans).forEach((n, k) => chan(3 + k, `${n}:${trans[k]}`, 0x12c + k * 0x32));
      if (key !== 'background') {
        ['A', 'B', 'C'].slice(0, row.color.trans).forEach((ch, k) => {
          r.text(ch, 0x1c2 + k * 8, ys[i], c5(cr, cg, cb), trans[k] / 255);
        });
      }
    });
    const b = a => this.glyph(a);
    const row = rows[this.themeRow];
    let help = `${b('dpad')} Up/Dn:Select`;
    if (this.themeRow === 0) help += `  ${b('dpad')} Left/Right:Change Theme`;
    if (row.color) help += `  ${b('dpad')} Left/Right:-/+ Adjust  ${b('accept')}/${b('pageRight')}:Next Value`;
    r.smallCenter(help, 0xf6, COLORS.text);
    r.smallCenter(`${b('accept')}:Accept  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  drawSprites(r) {
    this.drawDemo(r);
    r.dim(0.8);
    this.drawHeader(r, 'OPTIONS - THEMES - SPRITES');
    const sheet = this.sprites.sheet;
    const scale = Math.min(1, 0xe0 / sheet.height, (SCREEN_W - 8) / sheet.width);
    const w = sheet.width * scale, h = sheet.height * scale;
    r.ctx.drawImage(sheet, Math.round((SCREEN_W - w) / 2), 0x12, w, h);
    r.small(`${SPRITES.length} Sprites Imported`, 2, 0x100, COLORS.alt);
    r.smallRight(`${this.glyph('back')}:Back`, 0x100, COLORS.text);
  }

  drawMulti(r) {
    this.drawDemo(r);
    r.dim(0.5);
    this.drawHeader(r, 'MULTIPLAYER MODES');
    const t = TIMED_OPTIONS[this.multiTimed];
    const labels = {
      mode: `Game Mode: ${this.versusMode().label}`,
      timed: `Timer: ${t ? `${t / 60}:00` : 'OFF'}`,
      host: 'Host Game',
      join: 'Join Game',
    };
    MULTI_ROWS.forEach((row, i) => {
      const sel = i === this.multiRow;
      const y = 0x24 + i * 14 + (i >= 2 ? 8 : 0);
      r.text(labels[row], 0x14, y, i >= 2 ? COLORS.warning : COLORS.text, sel ? 1 : ALPHA_M);
      if (sel && i < 2) r.text('<>', 0x14 + labels[row].length * 8 + 6, y, COLORS.warning);
    });
    [
      'Versus play for two. Every pill you collect sends enemies',
      "to your opponent's screen, and every pill they collect",
      'sends enemies to yours. The last player standing wins.',
      '',
      'The host gets a room code to give the other player.',
      'Players are connected through the free PeerJS service.',
    ].forEach((l, i) => r.small(l, 0x14, 0x7c + i * 11, COLORS.alt));
    const b = a => this.glyph(a);
    r.smallCenter(`${b('dpad')} Up/Dn:Select  ${b('dpad')} Left/Right:Change  ${b('accept')}:Select  ${b('back')}:Back`, 0x100, COLORS.text);
  }

  drawLobby(r) {
    this.drawDemo(r);
    r.dim(0.6);
    const mp = this.mp;
    const host = mp.role === 'host';
    this.drawHeader(r, host ? 'MULTIPLAYER - HOST GAME' : 'MULTIPLAYER - JOIN GAME');
    const blink = (this.demo.frames >> 5) & 1;
    const b = a => this.glyph(a);
    if (mp.status === 'error') {
      r.center('Unable to Connect', 0x50, COLORS.important);
      r.smallCenter(mp.error || 'Connection failed', 0x66, COLORS.text);
      r.smallCenter(`${b('back')}:Back`, 0x100, COLORS.text);
      return;
    }
    if (host && mp.status === 'waiting') {
      const t = mp.timed ? ` (${mp.timed / 60}:00)` : '';
      r.center(`Hosting ${mp.mode.label} Game${t}`, 0x30, COLORS.text);
      r.center('ROOM CODE', 0x50, COLORS.alt);
      r.center(mp.code, 0x62, COLORS.warning, 1, 4);
      r.center('Waiting for opponent...', 0xa0, COLORS.text, blink ? ALPHA_M : 1);
      r.smallCenter('Your opponent picks Multiplayer > Join Game and enters this code.', 0xbc, COLORS.alt);
    } else if (host) {
      r.center('Connecting to the matchmaking server...', 0x60, COLORS.text, blink ? ALPHA_M : 1);
    } else if (mp.status === 'connected') {
      r.center(`Joined game ${mp.code}`, 0x50, COLORS.text);
      r.center('Waiting for the host...', 0x64, COLORS.text, blink ? ALPHA_M : 1);
    } else {
      r.center(`Joining game ${mp.code}...`, 0x60, COLORS.text, blink ? ALPHA_M : 1);
    }
    r.smallCenter(`${b('back')}:Cancel`, 0x100, COLORS.text);
  }

  // CONNECTION LOST across the middle of the field (FUN_0892681c draws it at y=0xaa).
  drawVersusStatus(r) {
    if (this.mp && this.mp.lost && !this.game.paused) r.center('CONNECTION LOST', 0xaa, COLORS.important);
  }

  drawVersusWait(r) {
    r.center('Waiting for Opponent', 0x2d, COLORS.text);
    r.smallCenter(`${this.glyph('back')}:Back`, 0xeb, COLORS.text);
  }

  // Versus results (FUN_08915b5c): the usual Game Over, with You Win! above it when the
  // opponent's last message said they were out, otherwise You Lose!.
  drawVersusEnd(r, game) {
    const b = a => this.glyph(a);
    const scripted = game.won && !game.timeUp;
    if (scripted && game.mode.id === 'custom') {
      r.center('You Beat', 0x19, COLORS.important);
      r.center(game.opts.game.NAME, 0x2d, COLORS.important);
    } else {
      r.center(scripted ? 'You Win!' : 'Game Over', 0x2d, scripted ? COLORS.important : COLORS.text);
    }
    r.center(game.oppOut ? 'You Win!' : 'You Lose!', 0x19, COLORS.important);
    r.center(`SCORE:${game.score}`, 0x50, COLORS.text);
    r.center(`OPPONENT:${game.oppScore}`, 0x62, COLORS.text);
    const lost = this.mp && this.mp.lost;
    r.smallCenter(lost ? `${b('back')}:Back` : `${b('accept')}:Restart  ${b('back')}:Back`, 0xeb, COLORS.text);
  }

  drawPause(r) {
    r.dim(0.35);
    r.center('PAUSED', 0x64, COLORS.text);
    const values = {
      Background: `Background: ${this.options.background ? 'IMAGE' : 'COLOR'}`,
      Music: `Music: ${this.options.music ? `${this.options.music} of ${SONGS.length}` : 'OFF'}`,
    };
    this.pauseItems().forEach((item, i) => {
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
    r.smallCenter(`${b('pageLeft')}:Prev Page  ${b('pageRight')}:Next Page  ${b('triangle')}:Reset High Scores  ${b('back')}:Back`, 0x100, COLORS.text);
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
      const pad = this.input.device !== 'keyboard';
      const touch = this.input.device === 'touch';
      const rows = [
        ['Move Player', touch ? 'Drag on the left side' : pad ? 'Analog stick or D-Pad' : 'Arrow keys or WASD'],
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
