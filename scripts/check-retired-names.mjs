/**
 * Retired names only ever lose uses (rules/review-triggers.md §10 *Reviewing against the ticket:
 * omissions and leftovers*).
 *
 * A plan that moves a fact into the model retires the code that held it: a registry field, a
 * constant table, a helper that works the fact out again. Until the slice that owns the removal
 * lands, the old name stays, and every new reader of it is one more site that slice has to find.
 * `scripts/retired-names.json` lists each retired name with the ticket that removes it
 * (`$owners`) and how many times production source uses it today. This check counts each name
 * again and fails both ways:
 *
 * - more uses than the baseline: new code reached for a retired name. Read the fact from its
 *   model home instead (the owner ticket names it).
 * - fewer: a slice removed some uses, so the entry comes down in the same PR. `--update` only
 *   ever lowers entries and drops those that reach 0; it never adds or raises one.
 *
 * A name is added to the file, with its owner, when a plan or a code pass retires it, and the new
 * entry is declared in `scripts/baseline-raises.json` (reason "retired by #N"):
 * `rules:check:baseline-ratchet` refuses a raised or new count otherwise. Counts are whole-word
 * matches in production source, tracked or untracked (ignored files excepted); tests, generated
 * clients and migrations are not counted.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_FILE = 'scripts/retired-names.json';

/** The production source a retired name is counted in. */
export const COUNTED_PATHS = ['packages/core-api/src', 'packages/shared', 'clients/poolmaster/src'];

const NOT_COUNTED = /(^packages\/shared\/generated\/)|(\.(test|spec)\.tsx?$)|((^|\/)(__tests__|test)\/)/;

/** Whether a tracked file counts: production source, not a test or a generated client. */
export function isCountedSource(path) {
  return COUNTED_PATHS.some((root) => path.startsWith(`${root}/`)) && /\.(ts|tsx|mjs)$/.test(path) && !NOT_COUNTED.test(path);
}

/** How many whole-word uses of `name` a text holds. */
export function countUses(text, name) {
  const escaped = name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
  return text.match(pattern)?.length ?? 0;
}

/** The baseline's counts and owners, with `$` keys (comment, owners) kept apart from the counts. */
export function readBaseline(text) {
  const parsed = JSON.parse(text);
  const counts = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith('$')));
  return { parsed, counts, owners: parsed.$owners ?? {} };
}

/** Names whose count is above the baseline, below it, or listed without an owner. */
export function compareWithBaseline(counts, baseline, owners) {
  const over = [];
  const under = [];
  const unowned = [];
  for (const [name, allowed] of Object.entries(baseline)) {
    const count = counts[name] ?? 0;
    if (count > allowed) over.push({ name, count, allowed });
    else if (count < allowed) under.push({ name, count, allowed });
    if (typeof owners[name] !== 'string' || owners[name].trim() === '') unowned.push(name);
  }
  return { over, under, unowned };
}

/** The baseline after cleanups: each entry lowered to its count, entries at 0 dropped with their owner. */
export function ratchetBaseline(counts, baseline) {
  const next = {};
  for (const [name, allowed] of Object.entries(baseline)) {
    const count = Math.min(counts[name] ?? 0, allowed);
    if (count > 0) next[name] = count;
  }
  return next;
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', ...COUNTED_PATHS], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exit(1);
  }
  const { parsed, counts: baseline, owners } = readBaseline(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  const texts = listed.stdout
    .split('\n')
    .filter((path) => path && isCountedSource(path))
    .map((path) => readFileSync(join(repoRoot, path), 'utf8'));
  const counts = Object.fromEntries(
    Object.keys(baseline).map((name) => [name, texts.reduce((sum, text) => sum + countUses(text, name), 0)]),
  );

  let current = baseline;
  if (process.argv.includes('--update')) {
    current = ratchetBaseline(counts, baseline);
    const keptOwners = Object.fromEntries(Object.entries(owners).filter(([name]) => name in current));
    const next = { $comment: parsed.$comment, $owners: keptOwners, ...current };
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Lowered ${BASELINE_FILE}: ${Object.keys(current).length} names.`);
  }

  const { over, under, unowned } = compareWithBaseline(counts, current, owners);
  for (const { name, count, allowed } of over) {
    console.error(`${name} is used ${count} times in production source (baseline ${allowed}). It is retired: read the fact from its model home, named on ${owners[name] ?? 'its owner ticket'} (rules/review-triggers.md §10).`);
  }
  for (const { name, count, allowed } of under) {
    console.error(`${name} is now used ${count} times (baseline ${allowed}). Lower its entry: run node scripts/check-retired-names.mjs --update.`);
  }
  for (const name of unowned) {
    console.error(`${name} in ${BASELINE_FILE} has no owner ticket under $owners.`);
  }
  if (over.length > 0 || under.length > 0 || unowned.length > 0) process.exit(1);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(`Retired names match the baseline: ${Object.keys(counts).length} names, ${total} uses left.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
