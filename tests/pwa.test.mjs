import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = '/Squarez-PSP-port/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

test('Pages subpath installs a complete cache and starts offline', async () => {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.slice(1);
    const file = path.resolve(root, relative || 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}${prefix}`;
    await page.goto(base);
    await page.waitForFunction(() => window.squarez?.screen === 'menu');
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), base + 'sw.js');
    const manifest = await page.evaluate(async () => {
      const m = await fetch('manifest.webmanifest'); return m.json();
    });
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, './');
    const paths = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find(n => n.startsWith('squarez:')));
      return (await cache.keys()).map(r => new URL(r.url).pathname);
    });
    assert(paths.includes(prefix + 'src/pwa.js'));
    assert(paths.includes(prefix + 'assets/sound/pattern01.wav'));
    assert(paths.includes(prefix + 'assets/custom/TURBOTHRILLS%20HARD.TXT'));
    assert(paths.includes(prefix + 'assets/icons/apple-touch-icon.png'));
    assert(paths.every(p => p.startsWith(prefix)));

    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.squarez?.screen === 'menu');
    assert.equal(await page.evaluate(() => squarez.customGames.length), 5);
    assert.equal(await page.evaluate(() => Object.values(squarez.audio.buffers).filter(Boolean).length), 16);
    assert.equal(await page.evaluate(() => squarez.audio.musicBuffers.filter(Boolean).length), 2);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.squarez?.screen === 'game');
    // index.html and a fresh app window also load without the network.
    const second = await context.newPage();
    await second.goto(base + 'index.html');
    await second.waitForFunction(() => window.squarez?.screen === 'menu');
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
