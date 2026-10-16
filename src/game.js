// Squarez gameplay, ported from the decompiled PSP EBOOT. Function names in comments refer to
// the original addresses so behaviour can be checked against the binary.
import { SPR, SND, COLORS, PARTICLE_SPRITES, SCREEN_W, SCREEN_H } from './data.js';

const rand = () => Math.floor(Math.random() * 0x7fffffff);
const rmod = n => rand() % n;

// Player coordinates are clamped against these (FUN_0890a20c).
const FIELD_RIGHT = 0x1de;
const FIELD_BOTTOM = 0x10e;
const PLAYER_SIZE = 0x13;
const PLAYER_BIG = 0x1d;
export const DEADZONE_LO = 0x73;
export const DEADZONE_HI = 0x9b;

const MAX_ENEMIES = 399;
const MAX_SHRAPNEL = 200;
const MAX_PARTICLES = 2350;
const MAX_GRENADES = 60;

// Directions used by grenade and cluster explosions (FUN_0890a708 / FUN_0890e964).
const RING16 = [
  [0, -3], [3, 0], [0, 3], [-3, 0], [2, -2], [2, 2], [-2, 2], [-2, -2],
  [1, -3], [3, -1], [3, 1], [1, 3], [-1, 3], [-3, 1], [-3, -1], [-1, -3],
];

const SHRAP_SPRITE = [SPR.SHRAP_GRENADE, SPR.SHRAP_HURT, SPR.SHRAP_CLUSTER, SPR.SHRAP_STORM, SPR.SHRAP_GENBOMB, SPR.SHRAP_RAGE];
const BOMB_SPRITE = [0, SPR.BOMB_NUKE, SPR.BOMB_FREEZE, SPR.BOMB_SCATTER, SPR.BOMB_CLUSTER, SPR.BOMB_STORM, SPR.BOMB_RAGE];
const BOMB_KEYS = ['BOMBNUKE', 'BOMBFREEZE', 'BOMBSCATTER', 'BOMBCLUSTER', 'BOMBCLUSTERSTORM', 'BOMBRAGE'];

export class Game {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts; // { mode, game, timed, scoreKey, versus }
    this.mode = opts.mode;
    this.settings = { ...opts.game.settings };
    this.script = opts.game.script.slice().sort((a, b) => a.score - b.score);
    this.reset();
  }

  // Lifetime counters for the Stats screen; the menu demo doesn't count.
  stat(key, n = 1) {
    if (this.opts.scoreKey !== 'demo' && n) this.app.addStat(key, n);
  }

  // FUN_0891b92c
  reset() {
    const s = this.settings;
    this.px = 0xe6; this.py = 0x7e;
    this.psize = PLAYER_SIZE;
    this.state = 0; // 0 alive, 1 dead, 2 revive pending (invulnerable)
    this.paused = false;
    this.moved = false;
    this.score = 0;
    this.lives = 0;
    this.grenadeCount = Math.min(MAX_GRENADES, s.GRENADESTART);
    this.powerTimer = 0;
    this.rageTimer = 0;
    this.rageBar = 0;
    this.rageLastKill = 0;
    this.powerupCountdown = s.POWERUPSPAWNSLIDE === 0 ? 0 : s.POWERUPSPAWNSTART;
    this.powerup = null;
    this.pill = null;
    this.pillTimer = 0;
    this.bomb = null;
    this.bombType = 0;
    this.bombLastScore = 0;
    this.bombMsg = 0;
    this.grenadePickup = null;
    this.grenadeLastScore = 0;
    this.bonusLife = null;
    this.bonusLastScore = 0;
    this.bonusMsg = 0;
    this.bannerTimer = 0;
    this.banner = null;
    this.enemies = [];
    this.shrapnel = [];
    this.particles = [];
    this.grenades = [];
    this.f6 = 0;
    this.phase = 0;
    this.blink = 0;
    this.frames = 0;
    this.scriptPtr = 0;
    this.scriptStarted = false;
    this.won = false;
    this.gameTimer = this.opts.timed ? this.opts.timed * 60 : -1;
    this.scriptTimer = false;
    this.turbo = 0;
    this.log = [];
    this.highScore = this.opts.versus ? 0 : this.app.bestScore(this.opts.scoreKey);
    // Versus games start in state 3, Waiting for Opponent, until both players are ready (FUN_0891b92c).
    if (this.opts.versus) this.state = 3;
    this.oppScore = 0;
    this.oppOut = false;
    this.out = false;
    this.timeUp = false;
    this.recorded = false;
    // Starting with cheat mode on already counts as cheating (FUN_0891b92c seeds DAT_089a6bb8).
    this.cheated = this.app.cheats.on;
    this.cheatHeld = false;
  }

  get secs() { return Math.floor(this.frames / 60); }
  get alive() { return this.state === 0 || this.state === 2; }
  get playerSprite() {
    if (this.rageTimer > 0) return SPR.PLAYER_RAGE;
    if (this.powerTimer > 0) return SPR.PLAYER_POWER;
    return SPR.PLAYER;
  }

  message(text, color = COLORS.log, always = false) {
    if (!always && !this.app.options.messages) return;
    this.log.push({ text, color, ttl: 240 });
    if (this.log.length > 4) this.log.shift();
  }

  sound(id) { this.app.audio.play(id); }

  // --- spawning -----------------------------------------------------------------------------

  speedCap() {
    return Math.min(8, Math.trunc(this.score / 8) + 3);
  }

  // FUN_08907d7c
  addEnemy(type) {
    if (this.enemies.length >= MAX_ENEMIES) return;
    const size = type === 1 || type === 5 ? 16 : 20;
    const e = { type, w: size, h: size, x: 0, y: 0, vx: 0, vy: 0, timer: 0, dead: false };
    let dir;
    if (this.px < 0xa0) { e.x = rmod(0xdb) + 0xf0; dir = 1; }
    else if (this.px < 0xfa) { e.x = rmod(100) + 0x168; dir = 1; }
    else if (this.px < 0x140) { e.x = rmod(0xa0) + 1; dir = -1; }
    else { e.x = rmod(0xf0) + 1; dir = -1; }
    e.y = rmod(0xf0) + 10;
    let max = this.speedCap();
    const slow = Math.trunc(this.score / 50) + 2;
    if ((type === 2 || type === 3 || type === 4 || type === 6) && slow < max) max = slow;
    const clamp = v => (type === 1 ? v : v >= 9 ? 5 : v < 2 ? 2 : v);
    if (rand() & 1) e.vx = clamp(dir * (rmod(max) + 1));
    else e.vy = clamp(rmod(max) + 1);
    switch (type) {
      case 2: e.timer = rmod(2000) + 900; break;
      case 3: e.timer = 150; break;
      case 4: case 6: e.timer = rmod(400) + 400; break;
      case 5: e.timer = rmod(300) + 600; break;
      case 7: e.vx = 0; e.vy = 0; e.timer = rmod(0x96) + 0x32; break;
      default: e.timer = 0;
    }
    this.enemies.push(e);
  }

  // FUN_08908654: a generator or hive drops a baby generator.
  addBaby(x, y) {
    if (this.enemies.length >= MAX_ENEMIES) return;
    const e = { type: 5, w: 16, h: 16, x, y, vx: 0, vy: 0, timer: rmod(300) + 600, dead: false };
    const dir = rand() & 1 ? 1 : -1;
    const max = this.speedCap();
    if (rand() & 1) e.vy = rmod(max) + 1;
    else e.vx = dir * (rmod(max) + 1);
    this.enemies.push(e);
  }

  // FUN_08915900: each pill spawns enemies according to the *SPAWN settings.
  spawnForScore(score) {
    const s = this.settings;
    const every = (n, type) => { if (n && score % n === 0) this.addEnemy(type); };
    every(s.BLOCKERSPAWN, 2);
    every(s.SMARTBLOCKERSPAWN, 3);
    every(s.GENBLOCKERSPAWN, 4);
    every(s.GENBOMBSPAWN, 6);
    every(s.GENBABYSPAWN, 5);
    every(s.ENEMYSPAWN, 1);
    every(s.HIVESPAWN, 7);
  }

  // Versus games (FUN_089229dc): the opponent's score drives our spawns. Each point of a small
  // rise runs the spawn check once; a jump of 15 or more is a resync and only updates the count.
  // Nothing spawns while we're out of the game.
  opponentScored(score) {
    const d = score - this.oppScore;
    if (d >= 1 && d <= 14 && !(this.state !== 0 && this.lives <= 0)) {
      for (let i = 0; i < d; i++) this.spawnForScore(++this.oppScore);
    }
    this.oppScore = score;
  }

  // Both players are ready: play starts at once, timer included (the original sets the
  // moved flag here rather than waiting for the first move).
  startVersus() {
    this.state = 0;
    this.moved = true;
  }

  // FUN_0890b6cc
  runScript() {
    while (this.scriptPtr < this.script.length && this.script[this.scriptPtr].score <= this.score) {
      const e = this.script[this.scriptPtr++];
      if (e.kind === 'ADDENEMY') this.addEnemy(e.type);
      else if (e.kind === 'MODSETTING') this.settings[e.key] = e.value;
      else if (e.kind === 'WINGAME') { this.won = true; this.die(true); }
      else if (e.kind === 'GAMETIMER') { this.scriptTimer = true; this.gameTimer = e.seconds * 60; }
    }
  }

  // Random spot on the far side of the playfield from the player.
  awayX(near, mid, far) {
    if (this.px < 0xa0) return near();
    if (this.px < 0x140) return mid();
    return far();
  }

  // FUN_08914ff8
  spawnItems() {
    const s = this.settings;
    if (!this.pill && this.state === 0) {
      const p = { x: 0, y: 0 };
      do {
        p.y = rmod(0xdc) + 10;
        p.x = this.awayX(
          () => rmod(0x118) + 0xb4,
          () => (rand() & 1 ? rmod(0xa0) + 5 : rmod(0x78) + 0x154),
          () => rmod(300),
        );
      } while (this.touchesPlayer(p.x, p.y, 0xf, SPR.PILL));
      this.pill = p;
      if (s.GRENADEPILL) this.pillTimer = 0xc;
    }
    if (s.BOMBSPAWN > 0 && this.score % s.BOMBSPAWN === 0 && this.bombLastScore !== this.score) {
      const enabled = BOMB_KEYS.map((k, i) => (s[k] ? i + 1 : 0)).filter(Boolean);
      if (!enabled.length) {
        this.message('SCRIPT ERROR: BOMBTIMER > 0 ALLS BOMBS OFF', COLORS.important);
        this.bombLastScore = this.score;
      } else {
        this.bombType = enabled[rmod(enabled.length)];
        if (this.bombType === 2 && this.score > 0x14) this.bombType = rmod(5) + 1;
        const b = { x: 0, y: 0 };
        do {
          b.y = rmod(0xdc) + 10;
          b.x = this.awayX(() => rmod(300) + 0xa0, () => rmod(0xa0) + 300, () => rmod(0x140));
        } while (this.touchesPlayer(b.x, b.y, 0x13, BOMB_SPRITE[this.bombType]));
        b.timer = this.mode.id === 'bomber' ? 0x46 : 0x23;
        this.bomb = b;
        this.bombLastScore = this.score;
      }
    }
    if (s.GRENADESPAWN > 0 && this.score % s.GRENADESPAWN === 0 && this.grenadeLastScore !== this.score) {
      const g = { x: 0, y: 0 };
      do {
        g.y = rmod(0xdc) + 10;
        g.x = this.awayX(() => rmod(300) + 0xa0, () => rmod(0xa0) + 300, () => rmod(0x140));
      } while (this.touchesPlayer(g.x, g.y, 0x13, SPR.GRENADE_PICKUP));
      g.timer = this.mode.id === 'bomber' ? 0x46 : 0x23;
      this.grenadePickup = g;
      this.grenadeLastScore = this.score;
    }
  }

  // FUN_08908d6c
  spawnBonusLife() {
    const x = this.px < 0xa0 ? rmod(0xdb) + 0xf0
      : this.px < 0xfa ? rmod(100) + 0x168
      : this.px < 0x140 ? rmod(0xa0) + 1 : rmod(0xf0) + 1;
    this.bonusLife = { x, y: rmod(0xf0) + 10, timer: 0x28 };
    this.bonusLastScore = this.score;
  }

  spawnPowerup() {
    const y = rmod(0xdc) + 10;
    const x = this.awayX(() => rmod(300) + 0xa0, () => rmod(0xa0) + 300, () => rmod(0x140));
    this.powerup = { x, y };
    this.powerupCountdown = 0;
  }

  // --- collisions --------------------------------------------------------------------------

  // Bounding test used throughout the EBOOT: two inclusive ranges overlap.
  static overlap(ax, aw, bx, bw) {
    return ax <= bx + bw && bx <= ax + aw;
  }

  touchesPlayer(x, y, size, sprite) {
    if (!Game.overlap(this.px, this.psize, x, size) || !Game.overlap(this.py, this.psize, y, size)) return false;
    return this.app.sprites.maskHit(this.playerSprite, this.px, this.py, sprite, x, y);
  }

  // --- player ------------------------------------------------------------------------------

  // FUN_0890a18c
  updateSize() {
    this.psize = this.powerTimer > 0 || this.rageTimer > 0 ? PLAYER_BIG : PLAYER_SIZE;
  }

  grow() {
    this.px = Math.max(1, this.px - 5);
    this.py = Math.max(1, this.py - 5);
    if (this.px + 0x1d > 0x1dd) this.px = 0x1c1;
    if (this.py + 0x1d > 0x10e) this.py = 0xf2;
  }

  shrink() {
    this.px += 5;
    this.py += 5;
  }

  // FUN_0890a20c: stick values are 0..255 with a dead zone; speed = distance / desensitivity.
  movePlayer(input) {
    if (this.state !== 0) return;
    const sens = this.turbo || this.app.options.sensitivity;
    const ax = input.axisX, ay = input.axisY;
    const x0 = this.px, y0 = this.py;
    if (!this.moved && (ax < DEADZONE_LO || ax > DEADZONE_HI || ay < DEADZONE_LO || ay > DEADZONE_HI)) this.moved = true;
    if (ax < DEADZONE_LO) this.px = Math.max(0, this.px - Math.trunc((DEADZONE_LO - ax) / sens));
    else if (ax > DEADZONE_HI) this.px = Math.min(FIELD_RIGHT - this.psize, this.px + Math.trunc((ax - DEADZONE_HI) / sens));
    if (ay < DEADZONE_LO) this.py = Math.max(0, this.py - Math.trunc((DEADZONE_LO - ay) / sens));
    else if (ay > DEADZONE_HI) this.py = Math.min(FIELD_BOTTOM - this.psize, this.py + Math.trunc((ay - DEADZONE_HI) / sens));
    this.stat('pixels', Math.abs(this.px - x0) + Math.abs(this.py - y0));
  }

  // FUN_08924af0 (in-game part)
  handleInput(input) {
    const s = this.settings;
    const o = this.app.options;
    // Unpausing is handled by the pause menu in main.js.
    if (input.pressed('start') && (this.state === 0 || this.state === 2)) {
      this.paused = true;
      return;
    }
    if (input.held('turbo') && (s.ALLOWTURBO || this.app.cheats.turbo)) {
      if (!this.turbo) this.turbo = Math.max(5, o.sensitivity - o.turboAdjust);
    } else if (input.held('slow') && (s.ALLOWSLOW || this.app.cheats.turbo)) {
      if (!this.turbo) this.turbo = Math.min(0x24, o.sensitivity + o.slowAdjust);
    } else {
      this.turbo = 0;
    }
    // With cheat mode on, R1 plus a face button is a cheat instead of the usual action.
    this.cheatHeld = this.app.cheats.on && input.held('pageRight') && this.state !== 1;
    if (this.cheatHeld) { this.cheatInput(input); return; }
    if (input.pressed('grenade')) {
      if (this.state === 1 && this.lives > 0) this.revive();
      else if (this.state === 2) { this.state = 0; }
      else if (this.state === 0 && this.grenadeCount > 0) { this.grenadeCount--; this.dropGrenade(); this.moved = true; }
    }
    if (input.pressed('rage') && this.state === 0 && this.rageBar > 0 && s.ALLOWRAGE) this.startRage();
  }

  // In-game cheats (FUN_08924af0): R+○ life, R+□ god mode, R+✕ turbo, R+△ grenade.
  cheatInput(input) {
    const c = this.app.cheats;
    const say = text => { this.cheated = true; this.message(text, COLORS.log, true); };
    if (input.pressed('slow') && this.lives < 100) {
      this.lives++;
      say('Bonus life cheat!');
    }
    if (input.pressed('grenade')) {
      c.god = !c.god;
      say(c.god ? 'God mode enabled!' : 'God mode disabled');
    }
    if (input.pressed('turbo')) {
      c.turbo = !c.turbo;
      say(c.turbo ? 'Turbo mode enabled!' : 'Turbo mode disabled');
    }
    if (input.pressed('rage')) {
      this.addGrenades(1);
      say('Bonus grenade cheat!');
    }
  }

  // FUN_0890770c
  dropGrenade() {
    if (this.grenades.length >= 0x3b) return;
    this.grenades.push({
      x: this.px + Math.trunc((this.psize - 16) / 2),
      y: this.py + Math.trunc((this.psize - 16) / 2),
      fuse: 0xf,
    });
  }

  // FUN_08913dfc
  startRage() {
    if (this.powerTimer) { this.shrink(); this.powerTimer = 0; }
    this.sound(SND.RAGE);
    if (this.rageTimer === 0) {
      this.grow();
      this.rageTimer = this.rageBar;
    } else {
      this.rageTimer += this.rageBar;
    }
    this.rageBar = 0;
    this.updateSize();
  }

  // FUN_08913574: kills made while powered up or raging build the rage bar.
  gainRage() {
    if (!this.settings.ALLOWRAGE) return;
    if (this.rageBar < 0x50) this.rageBar++;
    // The seconds counter starts at 1 so that 0 can mean "no kill yet".
    const now = this.secs + 1;
    if (this.rageLastKill !== 0) {
      const d = 3 - (now - this.rageLastKill);
      if (d >= 1) {
        const bonus = d >= 2 ? d * 2 : 0;
        this.rageBar += this.rageTimer === 0 ? bonus : d - 1;
        if (this.rageBar > 0x50) this.rageBar = 0x50;
      }
    }
    this.rageLastKill = now;
  }

  revive() {
    this.lives--;
    this.state = 2;
    if (this.powerTimer > 1) { this.shrink(); this.powerTimer = 0; }
    if (this.rageTimer > 0) { this.shrink(); this.rageTimer = 0; }
    this.updateSize();
  }

  die(win = false) {
    if (this.state === 1) return;
    this.state = 1;
    // In a versus game, a death with no lives left puts us out, which ends the opponent's game
    // too (FUN_089133b4 sets flag 2). Running out of time doesn't.
    if (!win && this.lives <= 0 && this.gameTimer !== 0) this.out = true;
    if (!win) this.sound(SND.DEATH);
    if (win || this.lives <= 0 || this.gameTimer === 0) this.finish();
  }

  finish() {
    if (this.recorded) return;
    this.recorded = true;
    this.app.gameEnded(this);
  }

  // --- explosions --------------------------------------------------------------------------

  addShrapnel(x, y, vx, vy, type, life) {
    if (this.shrapnel.length >= MAX_SHRAPNEL) return;
    this.shrapnel.push({ x, y, vx, vy, type, life, dead: false });
  }

  // FUN_08907928. Families 0x14 (red), 0x1e (green) and 0x28 (orange) darken as they age.
  addParticle(x, y, vx, vy, type, life) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const p = { x, y, vx, vy, type, life, dead: false };
    if (type !== 1) {
      p.family = type - (type % 10);
      p.shade = type % 10;
      this.shadeParticle(p);
    }
    this.particles.push(p);
  }

  shadeParticle(p) {
    if (p.family === 0x14 || p.family === 0x1e || p.family === 0x28) p.shade = p.life >= 40 ? 0 : p.life >= 20 ? 1 : 2;
  }

  // Spray used by grenades, bombs and bomb blockers (FUN_0890a708 and friends).
  explosionParticles(x, y, family, lifeBase = 10) {
    const level = this.app.options.particles;
    if (!level) return;
    const rounds = level === 2 ? 6 : 3;
    const t = () => family + rmod(3);
    const life = () => rmod(50) + lifeBase;
    for (let round = 0; round < rounds; round++) {
      for (let k = 3; k < 27; k++) this.particleQuad(x, y, k, t, life);
      for (let i = 0; i < 24; i++) this.particleStreams(x, y, t, life);
    }
  }

  particleQuad(x, y, k, t, life) {
    this.addParticle(x, y, rmod(k) + 3, -4 - rmod(k), t(), life());
    this.addParticle(x, y, -3 - rmod(k), -4 - rmod(k), t(), life());
    this.addParticle(x, y, rmod(k) + 3, rmod(k) + 4, t(), life());
    this.addParticle(x, y, -3 - rmod(k), rmod(k) + 4, t(), life());
  }

  particleStreams(x, y, t, life) {
    const wobble = () => -(rmod(4) * (rand() & 1));
    this.addParticle(x, y, wobble(), -rmod(7) - 4, t(), life());
    this.addParticle(x, y, wobble(), -rmod(7) - 4, t(), life());
    this.addParticle(x, y, rmod(7) + 3, wobble(), t(), life());
    this.addParticle(x, y, -rmod(7) - 3, wobble(), t(), life());
  }

  // FUN_0890a708
  grenadeExplode(x, y) {
    this.sound(SND.EXPLOSION2);
    this.stat('grenadesExploded');
    const type = this.settings.GRENADEHURT ? 1 : 0;
    for (const [vx, vy] of RING16) this.addShrapnel(x + 5, y + 5, vx, vy, type, rmod(19) + 11);
    this.explosionParticles(x + 5, y + 5, 0x1e);
    this.app.rumble(0.3, 120);
  }

  // FUN_0890e964
  clusterExplode(x, y) {
    this.sound(SND.EXPLOSION2);
    for (const [vx, vy] of RING16) this.addShrapnel(x + 5, y + 5, vx, vy, 2, 999);
    this.explosionParticles(x + 5, y + 5, 0x28, 30);
    this.app.rumble(0.3, 120);
  }

  // FUN_08910844 (scatter, type 0) and FUN_0890b8ac (bomb blocker / decayed rage bomb).
  scatterExplode(x, y, type, lifeFn) {
    this.sound(SND.EXPLOSION2);
    const r = (n, base) => rmod(n) + base;
    const x2 = x + 10, y2 = y + 10;
    for (let k = 0; k < 2; k++) {
      this.addShrapnel(x, y, -r(5, 2), -r(5, 2), type, lifeFn());
      this.addShrapnel(x2, y, r(5, 2), -r(5, 2), type, lifeFn());
      this.addShrapnel(x, y2, -r(5, 2), r(5, 2), type, lifeFn());
      this.addShrapnel(x2, y2, r(5, 2), r(5, 2), type, lifeFn());
    }
    this.addShrapnel(x2, y, 0, -3 - rmod(4), type, lifeFn());
    this.addShrapnel(x2, y2, 0, rmod(4) + 3, type, lifeFn());
    this.addShrapnel(x, y, rmod(4) + 3, 0, type, lifeFn());
    this.addShrapnel(x, y2, -3 - rmod(4), 0, type, lifeFn());
    this.addShrapnel(x, y, -2 - rmod(4), -2 - rmod(4), type, lifeFn());
    this.addShrapnel(x2, y, rmod(4) + 2, -2 - rmod(4), type, lifeFn());
    this.addShrapnel(x, y2, -2 - rmod(4), rmod(4) + 2, type, lifeFn());
    this.addShrapnel(x2, y2, rmod(4) + 2, rmod(4) + 2, type, lifeFn());
    for (let k = 0; k < 2; k++) {
      this.addShrapnel(x, y, -r(3, 1), -r(3, 1), type, lifeFn());
      this.addShrapnel(x2, y, r(3, 1), -r(3, 1), type, lifeFn());
      this.addShrapnel(x, y2, -r(3, 1), r(3, 1), type, lifeFn());
      this.addShrapnel(x2, y2, r(3, 1), r(3, 1), type, lifeFn());
    }
    this.explosionParticles(x + 5, y + 5, type === 0 ? 0x1e : 0x14);
    this.app.rumble(0.4, 150);
  }

  // FUN_0890fda8
  killEnemy(e) {
    e.dead = true;
    this.stat(`kill:${e.type}`);
    this.sound(SND.CRASH);
    const r5 = () => rmod(5) + 3;
    for (let i = e.type === 2 ? 2 : 1; i > 0; i--) {
      this.addParticle(e.x, e.y, r5(), -r5(), 1, 0x14);
      this.addParticle(e.x, e.y, -r5(), -r5(), 1, 0x14);
      this.addParticle(e.x, e.y, r5(), r5(), 1, 0x14);
      this.addParticle(e.x, e.y, -r5(), r5(), 1, 0x14);
    }
    const level = this.app.options.particles;
    if (!level) return;
    const n = level === 2 ? 24 : e.type === 2 ? 16 : 8;
    const t = () => 0x14 + rmod(3);
    const life = () => rmod(50) + 10;
    for (let i = 0; i < n; i++) this.particleQuad(e.x, e.y, i + 3, t, life);
    for (let i = 0; i < n; i++) this.particleStreams(e.x, e.y, t, life);
  }

  // FUN_08911b9c
  collectBomb() {
    const b = this.bomb;
    if (!b || this.state !== 0 || this.paused) return;
    if (!this.touchesPlayer(b.x, b.y, 0x13, BOMB_SPRITE[this.bombType])) return;
    this.bomb = null;
    this.bombLastScore = this.score;
    const t = this.bombType;
    this.stat(`bomb:${t}`);
    let msg = true;
    if (t === 1) {
      this.sound(SND.EXPLOSION3);
      for (const e of this.enemies) if (!e.dead && (e.type === 1 || e.type === 5)) this.killEnemy(e);
    } else if (t === 2) {
      this.bombMsg = 0x3c;
      this.sound(SND.FREEZE);
      msg = false;
    } else if (t === 3) {
      this.scatterExplode(b.x, b.y, 0, () => 999);
    } else if (t === 4) {
      this.clusterExplode(b.x, b.y);
    } else if (t === 5) {
      this.sound(SND.EXPLOSION2);
      const r = () => rmod(5) + 3;
      this.addShrapnel(b.x, b.y, r(), -r(), 3, rmod(20) + 4);
      this.addShrapnel(b.x, b.y, -r(), -r(), 3, rmod(20) + 4);
      this.addShrapnel(b.x, b.y, r(), r(), 3, rmod(20) + 4);
      this.addShrapnel(b.x, b.y, -r(), r(), 3, rmod(20) + 4);
    } else if (t === 6) {
      this.sound(SND.RAGE_PICKUP);
      this.rageBar = 0x50;
      msg = false;
    }
    if (msg && this.app.options.messages) this.bombMsg = 0x1e;
  }

  // --- per-frame update ---------------------------------------------------------------------

  update(input) {
    this.handleInput(input);
    if (this.paused || this.state === 3) return;
    // The opponent being out ends our game as soon as we're playing (FUN_089229dc). The original
    // only sets the dead state, which with spare lives would offer Next Life; this ends it.
    if (this.oppOut && this.state === 0 && this.moved) {
      this.lives = 0;
      this.state = 1;
      this.finish();
      return;
    }
    this.frames++;
    const tick = this.f6 === 0;
    const running = this.alive;
    if (!this.scriptStarted) { this.scriptStarted = true; this.runScript(); }
    this.updateSize();
    this.movePlayer(input);

    // Bomber pill timer.
    if (this.pillTimer > 0 && running && tick && this.moved) this.pillTimer--;
    // Rage bar drains when no kill happened for a while.
    if (tick && this.state === 0 && this.rageBar > 0 && this.rageLastKill && this.secs + 1 - this.rageLastKill >= 9) this.rageBar--;
    if (this.rageTimer > 0 && running && tick && --this.rageTimer === 0) { this.shrink(); this.updateSize(); }
    if (this.powerTimer > 0 && running && tick && --this.powerTimer === 0) { this.shrink(); this.updateSize(); }
    if (this.bonusLife && running && tick && --this.bonusLife.timer <= 0) this.bonusLife = null;

    // Powerup pickup.
    if (this.powerup && running && this.state === 0 &&
        Game.overlap(this.powerup.x, 0x13, this.px, this.psize) && Game.overlap(this.powerup.y, 0x13, this.py, this.psize)) {
      if (this.rageTimer > 0) {
        this.rageTimer = Math.min(0x50, this.rageTimer + 0x10);
      } else {
        if (this.powerTimer === 0) this.grow();
        this.powerTimer = 0x32;
      }
      this.powerup = null;
      this.stat('powerups');
      this.powerupCountdown = this.settings.POWERUPSPAWNSLIDE
        ? this.settings.POWERUPSPAWNSTART + Math.trunc(this.score / this.settings.POWERUPSPAWNSLIDE) : 0;
      this.sound(SND.POWERUP);
    }
    this.updateSize();

    // Bombs decay; a decayed rage bomb explodes.
    if (this.bomb && running && tick && --this.bomb.timer <= 0) {
      const b = this.bomb;
      this.bomb = null;
      if (this.bombType === 6) this.scatterExplode(b.x, b.y, 5, () => rmod(25) + 15);
    }
    this.collectBomb();

    // Grenade pickups.
    if (this.grenadePickup && running && tick && --this.grenadePickup.timer <= 0) this.grenadePickup = null;
    const gp = this.grenadePickup;
    if (gp && this.state === 0 && this.touchesPlayer(gp.x, gp.y, 0x13, SPR.GRENADE_PICKUP)) {
      this.grenadePickup = null;
      if (this.grenadeCount >= 0x3c) {
        this.message('Max grenades reached!', COLORS.important);
      } else {
        const n = this.addGrenades(this.settings.GRENADESUPPLIES);
        this.sound(SND.GRENADE_PICKUP);
        this.message(`Acquired ${n} grenades`);
      }
    }

    this.updateGrenades(tick, running);
    this.updateEnemies();
    this.updateShrapnel();
    this.updateParticles();
    this.enemyCollisions();
    this.pickups(tick);
    this.shrapnelHitsPlayer();

    if (this.powerupCountdown === 1 && this.mode.id !== 'survival' && this.mode.id !== 'bomber') this.spawnPowerup();

    // Timed games and GAMETIMER scripts.
    if (this.gameTimer > 0 && this.state === 0 && this.moved) {
      if (--this.gameTimer === 0) {
        this.timeUp = true;
        this.lives = 0;
        this.die(!this.scriptTimer);
      }
    }

    this.spawnItems();
    this.removeDead();

    for (const l of this.log) l.ttl--;
    this.log = this.log.filter(l => l.ttl > 0);
    this.phase = (this.phase + 1) & 3;
    this.f6 = (this.f6 + 1) % 6;
    if (this.f6 === 0) this.blink = (this.blink + 1) % 60;
  }

  // FUN_0890b57c
  addGrenades(n) {
    if (this.grenadeCount >= 0x3c) return 0;
    if (this.grenadeCount + n > 0x3c) n = 0x3c - this.grenadeCount;
    this.grenadeCount += n;
    this.stat('grenades', n);
    return n;
  }

  // FUN_0890b3f0
  updateGrenades(tick, running) {
    for (const g of this.grenades) {
      if (tick && running && --g.fuse === 0) {
        g.dead = true;
        this.grenadeExplode(g.x, g.y);
      }
    }
  }

  // FUN_0890d0c0
  updateEnemies() {
    const frozen = this.bombType === 2 && this.bombMsg > 0;
    const live = this.state === 0 || this.state === 2;
    const moveFrame = this.phase === 0 || this.phase === 2;
    let smartIndex = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      let stopped = !this.moved;
      if (e.type !== 1 && live && this.moved) {
        let t = e.timer;
        switch (e.type) {
          case 2:
            if (t === 0) { [e.vx, e.vy] = [e.vy, e.vx]; t = rmod(2000) + 900; }
            else if (t < 0x12d) stopped = true;
            break;
          case 5:
            if (t === 0) {
              e.type = 4; e.w = 20; e.h = 20;
              e.x = Math.max(0, e.x - 2); e.y = Math.max(0, e.y - 2);
              if (e.x + e.w >= 0x1e0) e.x = 0x1df - e.w;
              if (e.y + e.h > 0x10f) e.y = 0x10f - e.h;
              t = rmod(400) + 400;
              const cap = Math.trunc(this.score / 50) + 2;
              e.vx = Math.max(-cap, Math.min(cap, e.vx));
              e.vy = Math.max(-cap, Math.min(cap, e.vy));
            } else if (t <= 200) stopped = true;
            break;
          case 4:
            if (t === 0) { [e.vx, e.vy] = [e.vy, e.vx]; t = rmod(400) + 400; }
            else if (t < 0xc9) stopped = true;
            if (t === 0x32) { this.addBaby(e.x + 2, e.y + 2); this.sound(SND.GENERATE); }
            break;
          case 7:
            if (t === 0) t = rmod(0x96) + 0x32;
            else if (t < 0x33) stopped = true;
            if (t === 0x32) { this.addBaby(e.x + 2, e.y + 2); this.sound(SND.GENERATE); }
            break;
          case 6:
            if (t === 0) {
              stopped = true;
              e.dead = true;
              this.scatterExplode(e.x, e.y, 4, () => rmod(25) + 15);
              continue;
            } else if (t < 0xc9) stopped = true;
            if (t === 0x32) this.sound(SND.BOMBBEEP);
            break;
          case 3:
            if (t === 0) {
              // Smart blocker: line up with the player along the longer axis, then wait.
              const dx = this.px - e.x, dy = this.py - e.y;
              let horizontal = Math.abs(dy) < Math.abs(dx);
              if (!horizontal && smartIndex >= 1 && smartIndex % 2 === 0) horizontal = true;
              let dist, spd;
              if (horizontal) {
                if (e.vx === 0) { e.vx = e.vy; e.vy = 0; }
                if ((dx < 0 && e.vx > 0) || (dx > 0 && e.vx < 0)) e.vx = -e.vx;
                dist = Math.abs(dx); spd = Math.abs(e.vx);
              } else {
                if (e.vy === 0) { e.vy = e.vx; e.vx = 0; }
                if ((dy < 0 && e.vy > 0) || (dy > 0 && e.vy < 0)) e.vy = -e.vy;
                dist = Math.abs(dy); spd = Math.abs(e.vy);
              }
              t = Math.trunc((dist * 2) / (spd || 1)) + 0x96;
            } else if (t < 0x97) stopped = true;
            smartIndex++;
            break;
        }
        e.timer = t - 1;
        if (e.type === 3 && e.timer === 0x4b) this.sound(SND.RADARPING);
      }
      if (stopped || !live || !moveFrame) continue;
      let vx = e.vx, vy = e.vy;
      if (frozen) {
        vx = Math.trunc(vx / 3) || Math.sign(vx);
        vy = Math.trunc(vy / 3) || Math.sign(vy);
      }
      e.x += vx; e.y += vy;
      if (e.x < 0) { e.vx = -e.vx; e.x = Math.abs(e.vx) + 1; }
      else if (e.x > 0x1df - e.w) { e.vx = -e.vx; e.x = 0x1df - e.w + e.vx; }
      if (e.y < 0) { e.vy = -e.vy; e.y = Math.abs(e.vy) + 1; }
      else if (e.y > 0x10f - e.h) { e.vy = -e.vy; e.y = 0x10f - e.h + e.vy; }
    }
  }

  // FUN_0890f754
  updateShrapnel() {
    if (!(this.state === 0 || this.state === 2) || !(this.phase === 0 || this.phase === 2)) return;
    for (const s of this.shrapnel) {
      if (s.dead) continue;
      if (--s.life < 0) {
        s.dead = true;
        if (s.type === 3) this.clusterExplode(s.x, s.y);
        continue;
      }
      s.x += s.vx; s.y += s.vy;
      if (s.x < 0 || s.x >= 0x1d0 || s.y < 0 || s.y >= 0x100) s.dead = true;
    }
  }

  // FUN_08909c34
  updateParticles() {
    if (!this.alive || !(this.phase === 0 || this.phase === 2)) return;
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy;
      if (--p.life <= 0 || p.x < 0 || p.x > 0x1cf || p.y < 0 || p.y > 0xff) p.dead = true;
      else if (p.type !== 1) this.shadeParticle(p);
    }
  }

  // FUN_089136ac
  enemyCollisions() {
    if (!(this.state === 0 || this.state === 2)) return;
    const sprites = this.app.sprites;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const es = this.enemySprite(e);
      let hit = false;
      for (const s of this.shrapnel) {
        if (s.dead || s.type === 4) continue;
        if (!Game.overlap(s.x, 9, e.x, e.w - 1) || !Game.overlap(s.y, 9, e.y, e.h - 1)) continue;
        if (sprites.maskHit(SHRAP_SPRITE[s.type], s.x, s.y, es, e.x, e.y)) { hit = true; break; }
      }
      if (hit) { this.killEnemy(e); continue; }
      if (this.state === 2) continue;
      if (!Game.overlap(this.px, this.psize, e.x, e.w - 1) || !Game.overlap(this.py, this.psize, e.y, e.h - 1)) continue;
      if (!sprites.maskHit(this.playerSprite, this.px, this.py, es, e.x, e.y)) continue;
      const canKill = (this.powerTimer > 0 && (e.type === 1 || e.type === 5)) || this.rageTimer > 0;
      if (canKill) {
        this.gainRage();
        this.killEnemy(e);
      } else if (!this.app.cheats.god) {
        this.die();
        this.app.rumble(1, 400);
        return;
      }
    }
  }

  // FUN_089133b4: shrapnel types 1, 4 and 5 kill the player.
  shrapnelHitsPlayer() {
    if (this.state !== 0 || this.app.cheats.god) return;
    for (const s of this.shrapnel) {
      if (s.dead || !(s.type === 1 || s.type === 4 || s.type === 5)) continue;
      if (!Game.overlap(this.px, this.psize - 1, s.x, 9) || !Game.overlap(this.py, this.psize - 1, s.y, 9)) continue;
      if (this.app.sprites.maskHit(this.playerSprite, this.px, this.py, SHRAP_SPRITE[s.type], s.x, s.y)) {
        this.die();
        this.app.rumble(1, 400);
        return;
      }
    }
  }

  // FUN_08915b5c (pill + bonus life part)
  pickups(tick) {
    const s = this.settings;
    if (this.state === 0 && this.pill && this.touchesPlayer(this.pill.x, this.pill.y, 0xf, SPR.PILL)) {
      this.pill = null;
      this.score++;
      this.stat('pills');
      this.runScript();
      if (this.highScore > 0 && this.score === this.highScore + 1) this.showBanner('NEW HIGH SCORE!', COLORS.important, 0x32);
      this.sound(SND.PILL);
      if (this.mode.id === 'arcade' && !this.app.bomberUnlocked() && this.score === 0x96) {
        this.app.unlockBomber();
        this.showBanner('BOMBER MODE UNLOCKED!', COLORS.important, 0x1e);
      }
      if (s.GRENADEPILL && this.pillTimer > 0) {
        if (this.pillTimer < 6) {
          this.addGrenades(s.GRENADEPILLQTY);
          this.message('Acquired grenade!');
          this.sound(SND.GRENADE_PICKUP);
        } else {
          this.addGrenades(s.GRENADEBONUS);
          this.message('Quick pickup bonus!');
          this.sound(SND.GRENADE_PICKUP2);
        }
        if (this.grenadeCount >= 0x3c) this.showBanner('MAX GRENADES REACHED!', COLORS.important, 0x6e);
      }
      if (!this.powerup && this.powerupCountdown > 0) this.powerupCountdown--;
      // In a versus game our pills spawn enemies on the opponent's field instead (opponentScored).
      if (!this.opts.versus) this.spawnForScore(this.score);
      if (this.score > 0 && this.score !== this.bonusLastScore && s.BONUSLIFESPAWN && this.score % s.BONUSLIFESPAWN === 0) this.spawnBonusLife();
    }
    const bl = this.bonusLife;
    if (this.state === 0 && bl && this.touchesPlayer(bl.x, bl.y, 0x13, SPR.BONUS_LIFE)) {
      this.sound(SND.BONUSLIFE);
      this.stat('bonusLives');
      if (this.lives < 100) this.lives++;
      this.bonusLife = null;
      this.bonusMsg = 0x1e;
    }
    if (tick && this.alive) {
      if (this.bombMsg > 0) this.bombMsg--;
      if (this.bonusMsg > 0) this.bonusMsg--;
      if (this.bannerTimer > 0) this.bannerTimer--;
    }
  }

  showBanner(text, color, y) {
    this.banner = { text, color, y };
    this.bannerTimer = 0x1e;
  }

  removeDead() {
    if (this.enemies.some(e => e.dead)) this.enemies = this.enemies.filter(e => !e.dead);
    if (this.shrapnel.some(s => s.dead)) this.shrapnel = this.shrapnel.filter(s => !s.dead);
    if (this.particles.some(p => p.dead)) this.particles = this.particles.filter(p => !p.dead);
    if (this.grenades.some(g => g.dead)) this.grenades = this.grenades.filter(g => !g.dead);
  }

  enemySprite(e) {
    const t = e.timer;
    switch (e.type) {
      case 1: return SPR.ENEMY;
      case 2: return t >= 100 && t < 0x12d ? SPR.BLOCKER_ALT : SPR.BLOCKER;
      case 3: return t >= 0x4c && t < 0x97 ? SPR.SMART_ALT : SPR.SMART;
      case 4: return t < 100 ? SPR.GENERATOR_ALT : t < 0xc9 ? SPR.GENERATOR_ALT2 : SPR.GENERATOR;
      case 5: return SPR.GENBABY;
      case 6: return t >= 100 && t < 0xc9 ? SPR.GENBOMB_ALT2 : SPR.GENBOMB_ALT;
      case 7: return t < 100 ? SPR.HIVE_ALT : SPR.HIVE;
    }
    return SPR.ENEMY;
  }

  // --- rendering ---------------------------------------------------------------------------

  draw(r) {
    // Flashing messages alternate between full and medium translucency (DAT_089a6ba8 & 3).
    const flash = (this.blink & 3) >= 2 ? r.alphaM : 1;
    const o = this.app.options;
    r.background();
    if (this.powerup) r.sprite(SPR.POWERUP, this.powerup.x, this.powerup.y);
    if (this.bonusLife) {
      r.sprite(SPR.BONUS_LIFE, this.bonusLife.x, this.bonusLife.y);
      this.itemTimer(r, this.bonusLife);
    }
    if (this.pill) {
      r.sprite(SPR.PILL, this.pill.x, this.pill.y);
      if (this.pillTimer > 0 && this.moved) {
        r.small(String(this.pillTimer), this.pill.x + (this.pillTimer < 10 ? 5 : 3), this.pill.y + 3, COLORS.warning);
      }
    }
    if (this.bomb) {
      r.sprite(BOMB_SPRITE[this.bombType], this.bomb.x, this.bomb.y);
      this.itemTimer(r, this.bomb);
    }
    if (this.grenadePickup) {
      r.sprite(SPR.GRENADE_PICKUP, this.grenadePickup.x, this.grenadePickup.y);
      this.itemTimer(r, this.grenadePickup);
    }

    // Player and the powerup / rage counter drawn on top of it.
    if (this.state !== 2 || (this.blink & 2)) r.sprite(this.playerSprite, this.px, this.py);
    const counter = this.rageTimer > 0 ? this.rageTimer : this.powerTimer;
    if (counter > 0) {
      const col = counter <= 10 ? COLORS.important : counter < 0x14 ? COLORS.warning : COLORS.timer;
      r.text(String(counter), this.px + (counter < 10 ? 12 : 7), this.py + 11, col);
      if (o.largeTimer && this.state === 0) r.center(String(counter), 0x19, col, 1, 2);
    }

    for (const g of this.grenades) {
      r.sprite(SPR.GRENADE, g.x, g.y);
      r.small(String(g.fuse), g.x + (g.fuse < 10 ? 5 : 3), g.y + 3, g.fuse < 10 ? COLORS.important : COLORS.timer);
    }
    for (const e of this.enemies) r.sprite(this.enemySprite(e), e.x, e.y);
    this.drawEffects(r);

    // HUD
    r.text(`Squarez - ${this.title}`, 2, 2, COLORS.text);
    if (this.opts.versus) r.center(`OPPONENT:${this.oppScore}`, 2, COLORS.text);
    else r.center(`HIGH SCORE:${Math.max(this.highScore, 0)}`, 2, COLORS.text);
    r.text(`SCORE:${this.score}`, 0x18b, 2, COLORS.text);
    if (this.gameTimer >= 0) {
      const t = Math.ceil(this.gameTimer / 60);
      r.center(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, 0xc, t < 11 ? COLORS.important : COLORS.warning);
    }
    if (this.bombMsg > 0 && this.alive) {
      if (this.bombType === 1) {
        r.center('ENEMIES DESTROYED!', 0x5a, COLORS.important, flash);
        r.center('BLOCKERS IMMUNE!', 0x6e, COLORS.important, flash);
      } else if (this.bombType === 2) {
        r.center('ENEMIES SLOWED!', 0x5a, COLORS.special, flash);
        r.center(String(this.bombMsg), 0x6e, COLORS.special, flash);
      } else if (this.bombType === 3) r.center('SCATTER BOMBS!', 0x5a, COLORS.important, flash);
      else if (this.bombType === 4) r.center('CLUSTER BOMB!', 0x5a, COLORS.important, flash);
      else if (this.bombType === 5) r.center('CLUSTER STORM BOMB!', 0x5a, COLORS.important, flash);
    }
    if (this.bonusMsg > 0 && this.alive) r.center('BONUS LIFE!', 0x46, COLORS.special, flash);
    if (this.bannerTimer > 0 && this.banner && this.alive) r.center(this.banner.text, this.banner.y, this.banner.color, flash);

    // Lives and grenades (FUN_0890def0)
    if (this.mode.id === 'arcade' || this.mode.id === 'bomber' || this.mode.id === 'custom' || this.lives > 0 || this.grenadeCount > 0) {
      r.sprite(SPR.ICON_LIFE, 0x1c8, 0xff);
      r.small(`:${this.lives}`, 0x1cf, 0xfc, COLORS.text);
      r.sprite(SPR.ICON_GRENADE, 0x1aa, 0xff);
      r.small(`:${this.grenadeCount}`, 0x1b1, 0xfc, COLORS.text);
    }
    // Rage bar, drawn leftwards from the bottom right corner; it flashes when full.
    const len = Math.trunc(this.rageBar / 2);
    if (len > 0 && !(this.rageBar === 0x50 && (this.blink & 1) && this.state !== 1)) {
      const spr = this.rageBar >= 0x14 ? SPR.RAGE_RED : SPR.RAGE_YELLOW;
      for (let i = 0; i < len; i++) r.sprite(spr, 0x1de - i, 0x10d);
    }

    // Message log, newest at the bottom (FUN_0891b5b0).
    for (let i = 0; i < (this.paused ? 0 : this.log.length); i++) {
      const l = this.log[this.log.length - 1 - i];
      r.text(l.text, 2, 0xf8 - i * 10, l.color, r.alphaLog);
    }

    // Cheat HUD along the bottom edge (FUN_0892681c).
    const cheats = this.app.cheats;
    if (cheats.god) r.small('GodMode', 2, 0x101, COLORS.important);
    if (cheats.turbo) r.small('Turbo', 0x2a, 0x101, COLORS.important);
    if (this.cheatHeld) {
      const g = a => this.app.glyph(a);
      r.smallCenter(`${g('grenade')}:God ${g('turbo')}:Turbo ${g('slow')}:Life ${g('rage')}:Grenade`, 0x101, COLORS.important);
    }

    if (this.state === 1) this.drawEnd(r);
    else if (this.state === 3) this.app.drawVersusWait(r);
    else if (this.state === 2) {
      r.center('Revive', 0x2d, COLORS.text);
      r.smallCenter(`${this.app.glyph('grenade')}:Revive`, 0xeb, COLORS.text);
    }
  }

  // Shrapnel and particles; the menu demo draws these too for the bomb blocker easter egg.
  drawEffects(r) {
    for (const s of this.shrapnel) r.sprite(SHRAP_SPRITE[s.type], s.x, s.y);
    for (const p of this.particles) r.sprite(p.type === 1 ? SPR.PARTICLE_BIG : PARTICLE_SPRITES[p.family][p.shade], p.x, p.y);
  }

  get title() {
    return this.mode.id === 'custom' ? 'CUSTOM' : this.mode.label.toUpperCase();
  }

  itemTimer(r, item) {
    const t = item.timer;
    r.small(String(t), item.x + (t < 10 ? 7 : 5), item.y + 5, t < 10 ? COLORS.important : COLORS.timer);
  }

  drawEnd(r) {
    if (this.lives > 0 && !this.recorded) {
      r.center('You Died', 0x2d, COLORS.text);
      r.smallCenter(`${this.app.glyph('grenade')}:Next Life  (${this.lives} left)`, 0xeb, COLORS.text);
      return;
    }
    r.dim(0.4);
    if (this.opts.versus) {
      this.app.drawVersusEnd(r, this);
      return;
    }
    if (this.won) {
      if (this.mode.id === 'custom') {
        r.center('You Beat', 0x19, COLORS.important);
        r.center(this.opts.game.NAME, 0x2d, COLORS.important);
      } else {
        r.center('You Win!', 0x2d, COLORS.important);
      }
    } else {
      r.center('Game Over', 0x2d, COLORS.text);
    }
    this.app.drawEndPanel(r, this);
  }
}

export { SCREEN_W, SCREEN_H };
