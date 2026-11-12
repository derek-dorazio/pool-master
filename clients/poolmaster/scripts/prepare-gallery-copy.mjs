/**
 * #1615 — readies the built component gallery (`npm run gallery:build`) for publishing as a
 * private Artifact, so the owner can browse it on a phone without running anything.
 *
 * node scripts/prepare-gallery-copy.mjs <out-dir>
 *
 * Copies `storybook-static` to <out-dir>, names the page, writes each U+FFFD character in the
 * bundled libraries as its `�` escape (the publisher refuses the raw character; inside a JS
 * string or template literal the two are the same), and writes `<out-dir>/files.json`, the list
 * of files to publish beside `index.html`. Publishing itself is the Artifact tool's: publish
 * `<out-dir>/index.html` with `root` <out-dir> and `files` from files.json, to the gallery's
 * existing URL (clients/poolmaster/README.md, Component gallery).
 */
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node scripts/prepare-gallery-copy.mjs <out-dir>');
  process.exit(1);
}
const built = new URL('../storybook-static', import.meta.url).pathname;

rmSync(outDir, { force: true, recursive: true });
cpSync(built, outDir, { recursive: true });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(outDir);
for (const path of files.filter((file) => /\.(js|html|css|json)$/.test(file))) {
  const text = readFileSync(path, 'utf8');
  if (text.includes('�')) writeFileSync(path, text.replaceAll('�', '\\uFFFD'));
}

const indexPath = join(outDir, 'index.html');
writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace(/<title>[^<]*<\/title>/, '<title>Component gallery</title>'));

const published = files.map((file) => relative(outDir, file)).filter((file) => file !== 'index.html').sort();
writeFileSync(join(outDir, 'files.json'), `${JSON.stringify(published.map((path) => ({ path })))}\n`);
console.log(`Gallery copy ready in ${outDir}: index.html and ${published.length} files (files.json).`);
