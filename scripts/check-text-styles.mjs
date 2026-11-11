/**
 * #1586 — components own text styles; pages never set them by hand.
 *
 * Font size, weight, case, tracking, figures and text colour belong to the shared parts in
 * `clients/poolmaster/src/features/shared/ui` (`Heading`, `Eyebrow`, `Text` and the composites
 * built on them). This check counts those classes in every other web app source file and
 * compares each file's count with `scripts/text-style-baseline.json`, today's hand-set styles.
 *
 * It fails both ways. A file with more than its baseline allows has a new hand-set style: use a
 * shared part instead. A file with fewer has been cleaned up, so its baseline entry comes down
 * in the same PR (`--update` rewrites the file), and the baseline only ever shrinks. Tests are
 * exempt: they assert classes on purpose.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_FILE = 'scripts/text-style-baseline.json';
const WEB_SOURCE = /^clients\/poolmaster\/src\/.*\.tsx?$/;
const SHARED_UI = /^clients\/poolmaster\/src\/features\/shared\/ui\//;
const TEST_PATH = /\.(test|spec)\.tsx?$|(^|\/)(__tests__|test)\//;

/** The text-style classes a page may not set: size, weight, case, tracking, figures, colour. */
export const TEXT_STYLE_CLASS =
  /(?<![\w-])(?:text-(?:xs|sm|base|lg|xl|[2-9]xl)|font-(?:normal|medium|semibold|bold|extrabold|black)|uppercase|lowercase|capitalize|tracking-[\w-]+|tabular-nums|text-muted-foreground|text-foreground)(?![\w-])/g;

/** Whether a tracked file is one this check reads: web app source outside shared/ui, not a test. */
export function isCheckedSource(path) {
  return WEB_SOURCE.test(path) && !SHARED_UI.test(path) && !TEST_PATH.test(path);
}

/** How many hand-set text-style classes a file holds, comment lines left out. */
export function countTextStyles(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .reduce((sum, line) => sum + (line.match(TEXT_STYLE_CLASS)?.length ?? 0), 0);
}

/** Files over their baseline (new hand-set styles) and under it (cleaned up, baseline to lower). */
export function compareWithBaseline(counts, baseline) {
  const over = [];
  const under = [];
  for (const [path, count] of Object.entries(counts)) {
    const allowed = baseline[path] ?? 0;
    if (count > allowed) over.push({ path, count, allowed });
    else if (count < allowed) under.push({ path, count, allowed });
  }
  for (const [path, allowed] of Object.entries(baseline)) {
    if (!(path in counts)) under.push({ path, count: 0, allowed });
  }
  const byPath = (a, b) => a.path.localeCompare(b.path);
  return { over: over.sort(byPath), under: under.sort(byPath) };
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const listed = spawnSync('git', ['ls-files', 'clients/poolmaster/src'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exit(1);
  }
  const counts = {};
  for (const path of listed.stdout.split('\n').filter((entry) => entry && isCheckedSource(entry))) {
    const count = countTextStyles(readFileSync(join(repoRoot, path), 'utf8'));
    if (count > 0) counts[path] = count;
  }
  if (process.argv.includes('--update')) {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`Wrote ${BASELINE_FILE}: ${Object.keys(sorted).length} files.`);
    return;
  }
  const baseline = JSON.parse(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  const { over, under } = compareWithBaseline(counts, baseline);
  for (const { path, count, allowed } of over) {
    console.error(`${path} sets ${count} text-style classes by hand (baseline ${allowed}). Use Heading, Eyebrow or Text from features/shared/ui instead (rules/react-ui-rules.md, Text styles).`);
  }
  for (const { path, count, allowed } of under) {
    console.error(`${path} now sets ${count} text-style classes (baseline ${allowed}). Lower its entry: run node scripts/check-text-styles.mjs --update.`);
  }
  if (over.length > 0 || under.length > 0) process.exit(1);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(`Hand-set text styles match the baseline: ${total} in ${Object.keys(counts).length} files.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
