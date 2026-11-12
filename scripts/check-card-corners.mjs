/**
 * #1591 — a page never draws its own rounded box (rules/ux-rules.md §12 item 13, *One section
 * look*). A box that holds content is a `SectionCard` or a `Tile`, a must-know message is a
 * `Notice` and a clickable box is a `Button` or a link row; the shared parts own the corners.
 *
 * This check counts the large-corner classes (`rounded-2xl`, `rounded-3xl`, `rounded-4xl`, with
 * any side or breakpoint prefix) in web app source outside `features/shared/ui`, and compares
 * each file's count with `scripts/card-corner-baseline.json`: the pages still waiting for their
 * cleanup ticket, such as the picks pages #1579 rebuilds. Like the text-style check it fails both
 * ways: a file over its baseline has a new hand-drawn box, and a file under it has been cleaned
 * up, so its entry comes down in the same PR. `--update` only lowers entries and drops those that
 * reach 0. Tests and comment lines are exempt.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareWithBaseline, isCheckedSource, ratchetBaseline } from './check-text-styles.mjs';

export const BASELINE_FILE = 'scripts/card-corner-baseline.json';
const LARGE_CORNER = /(?<![\w-])rounded(?:-[trblse]{1,2})?-[234]xl(?![\w-])/g;

/** How many large-corner classes a source file holds, comment lines left out. */
export function countCardCorners(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .reduce((sum, line) => sum + (line.match(LARGE_CORNER)?.length ?? 0), 0);
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const listed = spawnSync('git', ['ls-files', 'clients/poolmaster/src'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exit(1);
  }
  const counts = {};
  for (const path of listed.stdout.split('\n').filter((entry) => entry && /\.(ts|tsx)$/.test(entry) && isCheckedSource(entry))) {
    const count = countCardCorners(readFileSync(join(repoRoot, path), 'utf8'));
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
    console.error(`${path} has ${count} rounded-2xl/3xl/4xl class(es) (baseline ${allowed}). Use SectionCard, Tile, Notice or Button, which own their corners (rules/ux-rules.md §12 item 13).`);
  }
  for (const { path, count, allowed } of under) {
    console.error(`${path} now has ${count} large-corner class(es) (baseline ${allowed}). Lower its entry: run node scripts/check-card-corners.mjs --update.`);
  }
  if (over.length > 0 || under.length > 0) process.exit(1);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(`Card corners match the baseline: ${total} in ${Object.keys(counts).length} files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
