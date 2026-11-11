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
 * in the same PR. `--update` only ever lowers entries (and drops those that reach 0); it never
 * adds or raises one, so the baseline only shrinks. A renamed file needs its entry moved by hand,
 * which shows in the diff. Tests are exempt: they assert classes on purpose.
 *
 * Text colour means every `text-<colour>` class, icons included, until icons get a tone on a
 * shared part. Two limits, accepted for a ratchet: only lines that start with a comment are
 * skipped (a JSX `{/* … *\/}` or trailing comment still counts), and counts are per file, so
 * swapping one class for another passes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_FILE = 'scripts/text-style-baseline.json';
const WEB_SOURCE = /^clients\/poolmaster\/src\/.*\.tsx?$/;
const SHARED_UI = /^clients\/poolmaster\/src\/features\/shared\/ui\//;
const TEST_PATH = /\.(test|spec)\.tsx?$|(^|\/)(__tests__|test)\//;

// `text-` classes that are layout, not type: alignment, wrapping and overflow.
const TEXT_LAYOUT = 'left|right|center|justify|start|end|balance|wrap|nowrap|pretty|ellipsis|clip';

/**
 * The text-style classes a page may not set: size, every text colour, weight, family, slant,
 * line height, case, tracking and figures. A word followed by `(` is a call, not a class.
 */
export const TEXT_STYLE_CLASS = new RegExp(
  '(?<![\\w-])(?:' +
    [
      `text-(?!(?:${TEXT_LAYOUT})(?![\\w-]))[a-z][\\w-]*`,
      'font-(?:normal|medium|semibold|bold|extrabold|black|display|mono|body|numeric)',
      'italic',
      'leading-[\\w-]+',
      'uppercase|lowercase|capitalize',
      'tracking-[\\w-]+',
      'tabular-nums',
    ].join('|') +
    ')(?![\\w-])(?!\\s*\\()',
  'g',
);

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

/**
 * The baseline after a cleanup: each entry lowered to its file's current count, entries that
 * reach 0 or whose file is gone dropped. Never adds a file or raises an entry.
 */
export function ratchetBaseline(counts, baseline) {
  const next = {};
  for (const [path, allowed] of Object.entries(baseline)) {
    const count = Math.min(counts[path] ?? 0, allowed);
    if (count > 0) next[path] = count;
  }
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
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
  const baseline = JSON.parse(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  if (process.argv.includes('--update')) {
    const lowered = ratchetBaseline(counts, baseline);
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify(lowered, null, 2)}\n`);
    console.log(`Lowered ${BASELINE_FILE}: ${Object.keys(lowered).length} files.`);
  }
  const current = process.argv.includes('--update') ? ratchetBaseline(counts, baseline) : baseline;
  const { over, under } = compareWithBaseline(counts, current);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
