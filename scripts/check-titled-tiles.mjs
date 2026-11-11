/**
 * #1562 — a section is a `SectionCard`, never a `Tile` with its own heading
 * (rules/ux-rules.md §12 item 13, *One section look*).
 *
 * This check finds every `Tile` in web app source outside `features/shared/ui` whose content
 * holds a title: a `Heading`, an `Eyebrow` or an `<h1>`–`<h6>`, short of a `Tile` nested inside
 * it. It compares each file's count with `scripts/titled-tile-baseline.json`, the titled tiles
 * member and event pages still hold until their own cleanup tickets reach them. Commissioner
 * tools, billing and site admin hold none, and the baseline never lists them.
 *
 * Like the text-style check it fails both ways: a file over its baseline has a new titled tile
 * (use `SectionCard`), and a file under it has been cleaned up, so its entry comes down in the
 * same PR. `--update` only lowers entries and drops those that reach 0. Tests are exempt.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compareWithBaseline, isCheckedSource, ratchetBaseline } from './check-text-styles.mjs';

export const BASELINE_FILE = 'scripts/titled-tile-baseline.json';
const TITLE_TAG = /^(Heading|Eyebrow|h[1-6])$/;

/** How many `Tile`s in a source file hold their own title. */
export function countTitledTiles(text, fileName = 'page.tsx') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const tagName = (node) => {
    if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(source);
    if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(source);
    return null;
  };
  // Whether a tile's content holds a title, not counting what sits inside a nested tile.
  const holdsTitle = (node) => {
    let found = false;
    const visit = (child) => {
      if (found) return;
      const name = tagName(child);
      if (name === 'Tile') return;
      if (name && TITLE_TAG.test(name)) {
        found = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, visit);
    return found;
  };
  const walk = (node) => {
    if (ts.isJsxElement(node) && tagName(node) === 'Tile' && holdsTitle(node)) count += 1;
    ts.forEachChild(node, walk);
  };
  walk(source);
  return count;
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const listed = spawnSync('git', ['ls-files', 'clients/poolmaster/src'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exit(1);
  }
  const counts = {};
  for (const path of listed.stdout.split('\n').filter((entry) => entry && entry.endsWith('.tsx') && isCheckedSource(entry))) {
    const count = countTitledTiles(readFileSync(join(repoRoot, path), 'utf8'), path);
    if (count > 0) counts[path] = count;
  }
  const baseline = JSON.parse(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  const update = process.argv.includes('--update');
  if (update) {
    const lowered = ratchetBaseline(counts, baseline);
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify(lowered, null, 2)}\n`);
    console.log(`Lowered ${BASELINE_FILE}: ${Object.keys(lowered).length} files.`);
  }
  const { over, under } = compareWithBaseline(counts, update ? ratchetBaseline(counts, baseline) : baseline);
  for (const { path, count, allowed } of over) {
    console.error(`${path} has ${count} Tile(s) with their own heading (baseline ${allowed}). A titled section is a SectionCard (rules/ux-rules.md §12 item 13).`);
  }
  for (const { path, count, allowed } of under) {
    console.error(`${path} now has ${count} titled Tile(s) (baseline ${allowed}). Lower its entry: run node scripts/check-titled-tiles.mjs --update.`);
  }
  if (over.length > 0 || under.length > 0) process.exit(1);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(`Titled tiles match the baseline: ${total} in ${Object.keys(counts).length} files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
