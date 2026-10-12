// Static data recovered from the Squarez v0.8.2 PSP EBOOT (SQUAREZ/EBOOT.PBP).

export const SCREEN_W = 480;
export const SCREEN_H = 272;

// Sprite rectangles in squarezsprites.bmp. The original imports sprites by scanning the
// sheet column by column, so the index here is the sprite id the game code uses.
export const SPRITES = [
  [2, 2, 20, 20], [2, 32, 30, 30], [2, 72, 16, 16], [2, 98, 16, 16], [2, 124, 20, 20],
  [2, 154, 20, 20], [2, 184, 20, 20], [2, 214, 20, 20], [2, 244, 20, 20],
  [52, 2, 20, 20], [52, 32, 20, 20], [52, 62, 20, 20], [52, 92, 16, 16], [52, 118, 10, 10],
  [52, 138, 10, 10], [52, 158, 10, 10], [52, 178, 10, 10], [52, 198, 20, 20], [52, 228, 20, 20],
  [102, 2, 20, 20], [102, 32, 20, 20], [102, 62, 20, 20], [102, 92, 20, 20], [102, 122, 20, 20],
  [102, 152, 20, 20], [102, 182, 8, 8], [102, 200, 2, 2], [102, 212, 2, 2], [102, 224, 2, 2],
  [102, 236, 4, 4], [102, 250, 4, 4], [102, 264, 2, 2],
  [152, 2, 2, 2], [152, 14, 2, 2], [152, 26, 2, 2], [152, 38, 2, 2], [152, 50, 2, 2],
  [152, 62, 2, 2], [152, 74, 2, 2], [152, 86, 2, 2], [152, 98, 2, 2], [152, 110, 2, 2],
  [152, 122, 2, 2], [152, 134, 1, 2], [152, 146, 1, 2], [152, 158, 1, 2], [152, 170, 16, 16],
  [152, 196, 20, 20], [152, 226, 20, 20], [152, 256, 10, 10],
  [202, 2, 20, 20], [202, 32, 20, 20], [202, 62, 20, 20], [202, 92, 30, 30], [202, 132, 20, 20],
  [202, 162, 10, 10], [202, 182, 30, 30], [202, 222, 30, 30],
];

export const SPR = {
  PLAYER: 0, PLAYER_POWER: 1, PILL: 2, ENEMY: 3, POWERUP: 4,
  BLOCKER: 5, BLOCKER_ALT: 6, SMART: 7, SMART_ALT: 8,
  GENERATOR: 9, GENERATOR_ALT: 10, GENERATOR_ALT2: 11, GRENADE: 12,
  SHRAP_GRENADE: 13, SHRAP_CLUSTER: 14, SHRAP_STORM: 15, SHRAP_HURT: 16,
  BOMB_SCATTER: 17, BOMB_NUKE: 18, BOMB_FREEZE: 19, BOMB_CLUSTER: 20, GRENADE_PICKUP: 21,
  BOMB_STORM: 22, BONUS_LIFE: 23, PARTICLE_BIG: 25,
  ICON_LIFE: 29, ICON_GRENADE: 30, RAGE_RED: 43, RAGE_YELLOW: 44, RAGE_GREEN: 45,
  GENBABY: 46, HIVE: 47, HIVE_ALT: 48, SHRAP_GENBOMB: 49, GENBOMB: 50, GENBOMB_ALT: 51,
  GENBOMB_ALT2: 52, PLAYER_RAGE: 53, BOMB_RAGE: 54, SHRAP_RAGE: 55,
};

// 2x2 particle sprites per particle family, brightest first (jump table in FUN_08909c34).
export const PARTICLE_SPRITES = {
  0x14: [26, 27, 28], 0x1e: [31, 32, 33], 0x28: [34, 35, 36], 0x32: [37, 38, 39], 0x3c: [41, 40, 42],
};

// Sound ids match the order the EBOOT loads them in (FUN_0890a67c ids).
export const SOUNDS = [
  'crash', 'pill', 'explosion', 'explosion2', 'explosion3', 'powerup', 'death', 'freeze',
  'bonuslife', 'grenadepickup', 'radarping', 'generate', 'grenadepickup2', 'bombbeep', 'rage',
  'ragepickup',
];
export const SND = {
  CRASH: 0, PILL: 1, EXPLOSION: 2, EXPLOSION2: 3, EXPLOSION3: 4, POWERUP: 5, DEATH: 6, FREEZE: 7,
  BONUSLIFE: 8, GRENADE_PICKUP: 9, RADARPING: 10, GENERATE: 11, GRENADE_PICKUP2: 12,
  BOMBBEEP: 13, RAGE: 14, RAGE_PICKUP: 15,
};
export const SONGS = ['pattern01', 'pattern02'];

// theme.txt, 5-bit colour channels.
const c5 = (r, g, b) => `rgb(${Math.round(r * 255 / 31)},${Math.round(g * 255 / 31)},${Math.round(b * 255 / 31)})`;
export const COLORS = {
  text: c5(31, 31, 31),
  alt: c5(24, 24, 24),
  important: c5(31, 0, 0),
  warning: c5(31, 31, 3),
  special: c5(0, 0, 31),
  timer: c5(24, 24, 24),
  log: c5(24, 24, 24),
};

// Custom game setting keys, in the order the EBOOT stores them (MODSETTING index).
export const SETTING_KEYS = [
  'ALLOWTURBO', 'ALLOWSLOW', 'ALLOWRAGE', 'POWERUPSPAWNSTART', 'POWERUPSPAWNSLIDE',
  'ENEMYSPAWN', 'BLOCKERSPAWN', 'SMARTBLOCKERSPAWN', 'GENBLOCKERSPAWN', 'GENBABYSPAWN',
  'GENBOMBSPAWN', 'HIVESPAWN', 'BOMBSPAWN', 'GRENADESPAWN', 'GRENADESTART', 'GRENADESUPPLIES',
  'GRENADEPILL', 'GRENADEHURT', 'GRENADEBONUS', 'GRENADEPILLQTY', 'BONUSLIFESPAWN',
  'BOMBNUKE', 'BOMBFREEZE', 'BOMBSCATTER', 'BOMBCLUSTER', 'BOMBCLUSTERSTORM', 'BOMBRAGE',
];

export const ENEMY_NAMES = [
  null, 'ENEMYDEFAULT', 'ENEMYBLOCKER', 'ENEMYSMARTBLOCKER', 'ENEMYGENERATOR', 'ENEMYGENBABY',
  'ENEMYGENBOMB', 'ENEMYHIVE',
];

function settings(values) {
  const s = {};
  SETTING_KEYS.forEach((k, i) => { s[k] = values[i] || 0; });
  return s;
}

// Built-in game scripts, decoded from the mode constructors (FUN_0891ef28 / FUN_08921024).
const ARCADE_SCRIPT = `
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=40,MODSETTING,GENBLOCKERSPAWN,26
SCRIPT=44,ADDENEMY,ENEMYSMARTBLOCKER
SCRIPT=44,ADDENEMY,ENEMYSMARTBLOCKER
SCRIPT=44,ADDENEMY,ENEMYSMARTBLOCKER
SCRIPT=44,ADDENEMY,ENEMYSMARTBLOCKER
SCRIPT=50,MODSETTING,GENBOMBSPAWN,13
SCRIPT=60,MODSETTING,GENBABYSPAWN,14
SCRIPT=60,MODSETTING,SMARTBLOCKERSPAWN,19
SCRIPT=60,MODSETTING,BLOCKERSPAWN,13
SCRIPT=62,ADDENEMY,ENEMYHIVE
SCRIPT=66,MODSETTING,GENBLOCKERSPAWN,22
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=100,MODSETTING,GENBABYSPAWN,23
SCRIPT=120,MODSETTING,HIVESPAWN,25
SCRIPT=146,ADDENEMY,ENEMYGENBOMB
SCRIPT=146,ADDENEMY,ENEMYGENBOMB
SCRIPT=146,ADDENEMY,ENEMYGENBOMB
SCRIPT=146,ADDENEMY,ENEMYGENBOMB
SCRIPT=155,MODSETTING,GENBABYSPAWN,8
SCRIPT=155,MODSETTING,SMARTBLOCKERSPAWN,15
SCRIPT=155,MODSETTING,BLOCKERSPAWN,6
SCRIPT=155,MODSETTING,GRENADESPAWN,12
SCRIPT=160,ADDENEMY,ENEMYHIVE
SCRIPT=160,ADDENEMY,ENEMYHIVE
SCRIPT=165,ADDENEMY,ENEMYGENBABY
SCRIPT=165,ADDENEMY,ENEMYGENBABY
SCRIPT=165,ADDENEMY,ENEMYGENBABY
SCRIPT=165,ADDENEMY,ENEMYGENBABY
SCRIPT=170,MODSETTING,BOMBSPAWN,12
SCRIPT=180,ADDENEMY,ENEMYGENBOMB
SCRIPT=180,ADDENEMY,ENEMYGENBOMB
SCRIPT=180,ADDENEMY,ENEMYGENBOMB
SCRIPT=180,ADDENEMY,ENEMYGENBOMB
SCRIPT=180,ADDENEMY,ENEMYGENBOMB
SCRIPT=202,ADDENEMY,ENEMYHIVE
SCRIPT=202,ADDENEMY,ENEMYHIVE
SCRIPT=202,ADDENEMY,ENEMYHIVE
SCRIPT=210,MODSETTING,BOMBSPAWN,15
SCRIPT=240,MODSETTING,HIVESPAWN,12
SCRIPT=242,ADDENEMY,ENEMYHIVE
SCRIPT=242,ADDENEMY,ENEMYHIVE
SCRIPT=242,ADDENEMY,ENEMYHIVE
SCRIPT=242,ADDENEMY,ENEMYHIVE
SCRIPT=260,MODSETTING,BOMBSPAWN,20
`;

const BOMBER_SCRIPT = `
SCRIPT=20,MODSETTING,GENBLOCKERSPAWN,5
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=32,ADDENEMY,ENEMYGENBOMB
SCRIPT=35,MODSETTING,GENBOMBSPAWN,17
SCRIPT=52,MODSETTING,GENBLOCKERSPAWN,23
SCRIPT=60,MODSETTING,GENBOMBSPAWN,25
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=72,ADDENEMY,ENEMYGENBOMB
SCRIPT=80,MODSETTING,GENBLOCKERSPAWN,21
SCRIPT=100,MODSETTING,GENBOMBSPAWN,23
SCRIPT=121,MODSETTING,GENBABYSPAWN,8
SCRIPT=135,ADDENEMY,ENEMYGENBOMB
SCRIPT=135,ADDENEMY,ENEMYGENBOMB
SCRIPT=135,ADDENEMY,ENEMYGENBOMB
SCRIPT=135,ADDENEMY,ENEMYGENBOMB
SCRIPT=135,ADDENEMY,ENEMYGENBOMB
SCRIPT=135,ADDENEMY,ENEMYGENBOMB
SCRIPT=135,ADDENEMY,ENEMYGENBOMB
`;

// Parse a Squarez custom game file (custom/*.TXT format).
export function parseGameFile(text) {
  const game = { NAME: 'UNTITLED', AUTHOR: '', DESCRIPTION: '', settings: settings([]), script: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).toUpperCase();
    const val = line.slice(eq + 1);
    if (key === 'SCRIPT') {
      const p = val.split(',').map(s => s.trim().toUpperCase());
      const score = parseInt(p[0], 10) || 0;
      if (p[1] === 'ADDENEMY') {
        const type = ENEMY_NAMES.indexOf(p[2]);
        if (type > 0) game.script.push({ score, kind: 'ADDENEMY', type });
      } else if (p[1] === 'MODSETTING') {
        if (SETTING_KEYS.includes(p[2])) game.script.push({ score, kind: 'MODSETTING', key: p[2], value: parseInt(p[3], 10) || 0 });
      } else if (p[1] === 'WINGAME') {
        game.script.push({ score, kind: 'WINGAME' });
      } else if (p[1] === 'GAMETIMER') {
        game.script.push({ score, kind: 'GAMETIMER', seconds: parseInt(p[2], 10) || 0 });
      }
    } else if (key in game.settings) {
      game.settings[key] = parseInt(val, 10) || 0;
    } else if (key === 'NAME' || key === 'AUTHOR' || key === 'DESCRIPTION') {
      game[key] = val;
    }
  }
  return game;
}

function builtin(name, description, values, script = '') {
  const g = parseGameFile(script);
  g.NAME = name;
  g.AUTHOR = 'SOCALS';
  g.DESCRIPTION = description;
  g.settings = settings(values);
  return g;
}

// Mode settings, in SETTING_KEYS order, from FUN_0891edbc / FUN_0891ef28 / FUN_08920ec0 / FUN_08921024.
export const MODES = [
  {
    id: 'classic', label: 'Classic', modeIndex: 0,
    game: builtin('CLASSIC', 'Original game', [0, 0, 0, 5, 10, 1]),
  },
  {
    id: 'arcade', label: 'Arcade', modeIndex: 1,
    game: builtin('ARCADE', 'Bombs, grenades and rage', [
      1, 1, 1, 5, 15, 1, 15, 22, 0, 0, 0, 0, 10, 25, 4, 4, 0, 0, 0, 0, 95, 1, 1, 1, 1, 1, 1,
    ], ARCADE_SCRIPT),
  },
  {
    id: 'survival', label: 'Survival', modeIndex: 2,
    game: builtin('SURVIVAL', 'No powerups at all', [0, 0, 0, 0, 0, 1]),
  },
  {
    id: 'bomber', label: 'Bomber', modeIndex: 3, locked: true,
    game: builtin('BOMBER', 'Collect pills quickly for grenades', [
      1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 10, 24, 30, 22, 0, 8, 1, 1, 2, 1, 80, 0, 0, 0, 0, 0, 1,
    ], BOMBER_SCRIPT),
  },
  { id: 'custom', label: 'Custom', modeIndex: 16 },
];

export const CUSTOM_FILES = [
  'ARCADE.TXT', 'ARCADECLASSIC.TXT', 'CLUSTERRUN.TXT', 'TURBOTHRILLS.TXT', 'TURBOTHRILLS HARD.TXT',
];

export const TIMED_OPTIONS = [0, 180, 120, 60];

export const INSTRUCTIONS = [
  'The object of Squarez is to move your blue square over green squares. When you collect a',
  'green square an enemy red square will appear. If you crash into a red square your game will',
  'be over. However, if you get the yellow powerup square, your blue square will turn purple and',
  'a counter will appear. While in this mode you can destroy enemy red squares by crashing into',
  "them. When your timer turns red you'll have less than 10 counts before you turn back to",
  'normal. Your score is determined by the number of green squares you collected.',
  '',
  'CLASSIC MODE: Original game as described above.',
  'ARCADE MODE: Includes bomb and freeze powerups which decay after a specified amount of',
  'time. Ability to use turbo and slow speeds, drop grenades and rage.',
  'SURVIVAL MODE: No powerups at all will appear. Collect as many green squares as possible.',
  'BOMBER MODE: No powerups either. Collect pills quickly to receive grenade bonuses. Once the',
  'pill timer is gone you lose your grenade bonus. Collecting the pill very quickly will award',
  'an extra grenade bonus! Unlock it by scoring 150 in Arcade mode.',
  'CUSTOM MODE: Play the bundled custom game files.',
  'TIMED MODE: All games playable in 3:00, 2:00 and 1:00 time limits.',
];

export const TIPS = [
  'ARCADE MODE TIPS',
  ' * You generate rage by destroying small enemies quickly while in powerup mode.',
  ' * After a few seconds of not destroying enemies your rage will diminish.',
  ' * Your rage bar will turn from yellow to red when you have enough rage for a rampage!',
  ' * When your rage bar flashes, you have reached the maximum rage allowed.',
  ' * Anytime you have rage stored up you can press ({rage}) to go on a rampage.',
  ' * When in powerup or rage mode, use turbo ({turbo}) to clear enemies quicker.',
  " * Don't forget, it is essential to drop grenades! ({grenade})  Use them wisely.",
  ' * Slow ({slow}) can help you ease your way into tight areas.',
];

export const OBJECTS = [
  [SPR.PLAYER_POWER, 'Powerup Mode: Allows you to destroy small enemies.'],
  [SPR.PLAYER_RAGE, 'Rage Mode: Arcade/Custom only.  Destroy anything!'],
  [SPR.PILL, 'Pill: Collect these to increase your score.'],
  [SPR.POWERUP, 'Powerup: Collect powerup to enable powerup mode.'],
  [SPR.ENEMY, 'Enemy: Standard small enemy.'],
  [SPR.BLOCKER, 'Blocker: Stronger enemy.  All blockers are immune to powerup mode.'],
  [SPR.SMART, 'Smart-Blocker: Smarter enemy.'],
  [SPR.GENERATOR, 'Generator Blocker: Spawns baby generators.'],
  [SPR.GENBABY, 'Generator Baby: Small enemy which grows up into a generator blocker.'],
  [SPR.GENBOMB, 'Bomb Blocker: Self-destructing bomb.  Shrapnel kills!'],
  [SPR.HIVE, 'Enemy Hive: Spawns generator babies quickly.  Grenade it!'],
  [SPR.BOMB_NUKE, 'Nuke Bomb: Kills all small enemies.'],
  [SPR.BOMB_FREEZE, 'Freeze Bomb: Slows enemies.'],
  [SPR.BOMB_SCATTER, 'Scatter Bomb: Launches shrapnel in random directions.'],
  [SPR.BOMB_CLUSTER, 'Cluster Bomb: Explodes in a circular pattern.'],
  [SPR.BOMB_STORM, 'Cluster Storm Bomb: Launches 4 cluster bombs.'],
  [SPR.BOMB_RAGE, 'Rage Bomb: Awards you full rage. (when bomb decays it explodes!)'],
  [SPR.GRENADE_PICKUP, 'Grenade Powerup: Collect to acquire grenades.'],
  [SPR.SHRAP_HURT, 'Grenade Shrapnel: Can be deadly to player (Bomber mode)'],
  [SPR.BONUS_LIFE, 'Bonus Life: Collect to acquire a free life.'],
];

export const CREDITS = [
  'SQUAREZ v0.8.2 - Copyright 2005 GlobWare.com',
  '',
  'PROGRAMMING, GRAPHICS & MUSIC: SOCALS',
  'MUSIC GENERATED USING PSPKICK',
  'ICON ARTWORK: POCHI',
  'START BACKGROUND: GIGA PHIL',
  'THANKS: xXGarrettXx FOR SURVIVAL MODE IDEA',
  'BETA TESTERS: xXGarrettXx, JimShoe, FrozenIpaq & LittleDevil2128',
  'Developed in Long Beach, California',
  '',
  'Browser port reverse engineered from the original PSP EBOOT.',
];
