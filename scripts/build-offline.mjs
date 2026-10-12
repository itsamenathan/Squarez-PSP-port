// Run after changing any app files. The content hash creates a new, complete cache version.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const groups = await Promise.all(entries.map(e => e.isDirectory()
    ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  return groups.flat();
}
const urls = ['index.html', 'manifest.webmanifest', ...await files('src'), ...await files('assets')].sort();
const template = await readFile(path.join(root, 'scripts/sw-template.js'), 'utf8');
const hash = createHash('sha256').update(template);
for (const url of urls) hash.update(url).update(await readFile(path.join(root, url)));
const output = template.replace('__VERSION__', hash.digest('hex').slice(0, 16))
  .replace('__ASSETS__', JSON.stringify(urls, null, 2));
const target = path.join(root, 'sw.js');
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error('sw.js is stale. Run node scripts/build-offline.mjs');
} else {
  await writeFile(target, output);
}
