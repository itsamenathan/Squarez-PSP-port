# Squarez (browser port)

A browser port of [Squarez for PSP](https://www.gamebrew.org/wiki/Squarez_PSP) (v0.8.2, SOCALS / GlobWare, 2005).
The gameplay was reverse engineered from the original `SQUAREZ/EBOOT.PBP` (a MIPS ELF) in `SQUAREZ.zip`.
The sprites, backgrounds, sounds, music and custom game files in `assets/` come straight from that archive.

## Play

Play online at https://itsamenathan.github.io/Squarez-PSP-port/.

### Install and play offline

Open the site online once and wait for "Ready to play offline". The service worker
downloads the complete game, including sounds, music and custom games.

- Android: use Chrome's **Install app** or **Add to Home screen** menu.
- iPhone/iPad: open in Safari, tap **Share > Add to Home Screen**, then open the icon.

On phones and tablets, on-screen controls appear: drag anywhere on the left side
for the analog stick, and use the PSP face buttons, L/R and START on the right.
They hide when a controller is used and come back on the next touch.
Installation and offline caching require HTTPS, or localhost for development.
An HTTP LAN address cannot install the service worker. Browser storage can be
evicted or cleared, so reopen online if the offline copy disappears. Scores and
controller mappings remain local to the browser; the app has no cloud backup.

New game versions download online and activate after all old game windows close.
This avoids mixing code and assets from different versions during a game.

### Updating the offline cache

After changing HTML, the manifest, any `src/` file or any `assets/` file, run:

```sh
node scripts/build-offline.mjs
```

Commit the generated `sw.js` with those changes. The script hashes the app contents
and service worker template to create a fresh cache version. No build or Node.js
is required to serve the app. For the offline browser test:

```sh
npm ci
CHROMIUM_PATH=/path/to/chromium npm run test:pwa
```

The install icons use the original `ICON0.PNG` artwork from
`SQUAREZ/SQUAREZ%/EBOOT.PBP`, credited to POCHI in the game's credits.
`assets/icons/psp-icon.png` preserves the extracted image unchanged. Square icons
pad the landscape artwork instead of cropping it; the maskable variant keeps
the artwork inside the safe area. To regenerate them, with ffmpeg installed:

```sh
python3 scripts/extract-icons.py /path/to/SQUAREZ.zip
node scripts/build-offline.mjs
```

To run it locally:

```sh
python3 serve.py            # serves http://0.0.0.0:8080/
python3 serve.py --port 9000
```

Then open `http://<this-machine>:8080/` in a browser.

| Action | Keyboard | Gamepad (PSP button) |
| --- | --- | --- |
| Move | Arrows / WASD | Left stick or D-pad |
| Turbo (hold) | Shift / Z | A (✕) |
| Slow (hold) | X | B (○) |
| Drop grenade / revive | Space | X (□) |
| Rage | C / R | Y (△) |
| Pause menu | Esc / P | Start |
| Menu select / back | Enter / Esc | A (✕) / B (○) |
| Previous / next page | Q / E | L1 / R1 |
| Menu □ / △ (editor, new game, resets) | F / C | X (□) / Y (△) |

The menus follow the original's layout: ✕ plays the highlighted mode, and ○ (or Right) opens the timed choices (3:00, 2:00, 1:00).
On-screen prompts switch between keyboard names and PSP button glyphs depending on what you last used.
Controllers can vibrate, and unplugging one during a game pauses it. The pause menu can resume, restart or exit,
and switches the background and music. Bomber mode unlocks after scoring 150 in Arcade.
High scores, options and the unlock are kept in the browser's `localStorage`.

### SN30 and other non-standard controllers

The app supports the 8BitDo HID layout, including Start on button 11 and a D-pad
reported as a hat axis. Browser-standard controllers keep their standard mapping.
The layout can vary with the controller's connection mode and operating system.

If Start or the D-pad still behaves incorrectly, use the keyboard to open
**Options > Controller Setup**, then press Enter to start mapping. Follow the
prompts for each direction and button, releasing it between steps. Space skips
a button your controller doesn't have, and Esc cancels. The app saves the mapping
for that controller in this browser. The setup screen also shows raw button and
axis values for troubleshooting.

## What was recovered from the binary

- Playfield 480x272. The player is 19x19 (29x29 when powered up or raging) and moves `(stick - deadzone) / 20` px per frame, where the D-pad counts as a full stick deflection. Turbo uses desensitivity `20 - 6` and slow uses `20 + 20`.
- Enemy speeds are `rand(min(8, score/8 + 3)) + 1` along a single axis. Enemies move every other frame and bounce off the walls. Blockers, smart blockers, generators and bomb blockers are capped at `score/50 + 2`.
- Enemy AI covers all seven types: blockers pause and then turn 90°, smart blockers line up with the player and wait, generators and hives drop baby generators, babies grow into generators, and bomb blockers explode into shrapnel.
- Most timers (powerup 50, bombs and grenade pickups 35, freeze 60, grenade fuse 15, bonus life 40, rage up to 80) tick once every 6 frames. Exceptions: enemy timers tick every frame, and the rage-bar drain happens only after 9 seconds without a kill.
- Bomb types: nuke, freeze, scatter, cluster, cluster storm and rage, plus the rage-bomb decay explosion. Grenades throw a 16-way shrapnel ring.
- Built-in mode settings and the Arcade/Bomber scripts come from the mode constructors. Custom `.TXT` games use the same `SCRIPT=` format as the original.
- Collisions are pixel-accurate against the sprite masks, with black as the colour key, the same as the original.
- Text uses the game's own bitmap fonts: the 8x8 font at `0x089a3bf4` (drawn 1x, 2x or 4x), the 5x10 font at `0x089a35b4`, and the PSP button glyphs from its 10x10 Shift-JIS font.
- Particles follow `FUN_08907928`. They are 2x2 sprites whose shade darkens at life 40 and 20, spawned in the original patterns: about 70 per enemy kill and about 600 per grenade or bomb.

- Stats lists the original's 62 lifetime counters in the same order and format: run and play time, games per mode, pixels travelled, pickups, kills by enemy type and bombs used. L1+R1 resets them; this port asks you to press it twice. Hold R1 to scroll quickly.
- The custom game editor uses the original's fields and new-game defaults (`FUN_089071e0`). It edits the name, author, description, filename and all 27 settings. It also shows the compiled script and saves the standard `.TXT` format. The original opened it from the pause menu; here it opens with □ (F) in the Custom menu, and △ (C) starts a new game. Saved games stay in `localStorage` and replace a bundled file with the same name. Export downloads the `.TXT`, and I imports one from the keyboard.
- Options > Themes edits the `theme.txt` colours (R/G/B 0-31) and transparencies (N/M/H 0-255), saves named themes, and shows the sprite sheet.

- Cheat codes are entered on the main menu with □ (F) and △ (C), from `FUN_0891a510`:
  - □□□△△ toggles cheat mode and shows CHEAT ON.
  - □△□□△ toggles the Bomber unlock. It uses the same saved flag as scoring 150 in Arcade, which Stats L1+R1 also clears.
  - △△□□△ makes bomb blockers keep spawning behind the menu.

  With cheat mode on, hold R1 (E) in a game and press □ for god mode, ✕ for turbo (turbo and slow in any mode), ○ for a life or △ for a grenade. Games played in cheat mode can't enter the high score list.

- Multiplayer is the original's two-player versus game. Each player has their own field. Outside multiplayer, your pills spawn enemies on your own field. In a versus game, the opponent's score spawns them instead (`FUN_089229dc`): each point of a rise of 1-14 runs the spawn check once, and a bigger jump only updates the count. The HUD shows `OPPONENT:` where the high score usually is. A player who is out sees Waiting for Opponent, and when both are out the higher score wins. Once the opponent is out, nothing else would spawn on the other field, so this port switches it back to spawning from its own score. Passing the opponent's final score then wins at once. If the opponent disconnects, the game carries on with these single player spawns. The original's Host Game and Host Timed Game are one Host Game here, with a timer setting.

  The original connected over Wi-Fi by typing the host's IP address. A browser can't accept incoming connections, so this port uses WebRTC through [PeerJS](https://peerjs.com/) 1.5.5, stored in `src/vendor/` and loaded only when multiplayer is opened. The host gets a four-letter room code, and the other player enters it under Join Game. The free public PeerJS server (`0.peerjs.com`) introduces the two browsers, and game data then goes directly between them. When a network blocks a direct connection, it goes through PeerJS's public TURN relay. Both of these are free services with no uptime guarantee. Multiplayer needs an internet connection, works the same from GitHub Pages and from `serve.py`, and is the same for any two devices. Choices this port made that the original's code doesn't settle: the spawns and early win after the opponent is out, a tie shows Draw, ✕ on the results screen offers a rematch, pausing doesn't stop the opponent, custom games can't be played in versus, and versus scores stay out of the high score lists.

Not ported: IR multiplayer, USB mode, screenshots, the error log viewer, and theme folders with their own sprites, backgrounds and songs.
