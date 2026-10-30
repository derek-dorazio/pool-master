/**
 * #1287 — the web app does not grow a second copy of a component.
 *
 * The rule of two (`rules/react-ui-rules.md` §5 *Component Reuse Threshold*) says the second
 * copy of a card, row, table or section gets extracted. This check makes a new copy fail CI:
 * jscpd, a token-based copy detector, lists every near-identical block in
 * `clients/poolmaster/src` (tests left out), and each pair of files with copies is compared
 * against `scripts/duplicate-baseline.json`, today's copies, each tagged with the ticket that
 * removes it.
 *
 * It fails both ways. A pair with more copies than its baseline entry allows is a new copy:
 * extract it instead. A pair with fewer is a copy that a PR removed: lower or delete its entry
 * in the same PR, so the baseline only ever shrinks. The baseline's total `count` must equal
 * `BASELINE_CEILING` exactly, so raising an entry or adding one to cover a new copy also means
 * raising the ceiling, which a reviewer sees in the diff.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCANNED_ROOT = 'clients/poolmaster/src';
export const BASELINE_FILE = 'scripts/duplicate-baseline.json';

/** The total of `count` across the baseline. Only ever lowered, with the entries that removed it. */
export const BASELINE_CEILING = 19;

/**
 * Big enough to skip short idioms (an import block, a `useMutation` call), small enough to catch
 * a copied column definition or a header block.
 */
export const DETECTOR_OPTIONS = {
  minTokens: 50,
  minLines: 8,
  format: ['typescript', 'tsx'],
  ignore: ['**/*.test.ts', '**/*.test.tsx', '**/test/**'],
};

/** The two files of a copy, sorted, as the baseline names them. */
export function pairKey(fileA, fileB) {
  return [fileA, fileB].sort().join(' <> ');
}

/** A message when the baseline's total differs from the ceiling, else null. */
export function checkCeiling(baseline, ceiling = BASELINE_CEILING) {
  const total = baseline.reduce((sum, entry) => sum + entry.count, 0);
  if (total > ceiling) {
    return `${BASELINE_FILE} allows ${total} copies over a ceiling of ${ceiling}. The baseline never grows: extract the new copy instead.`;
  }
  if (total < ceiling) {
    return `${BASELINE_FILE} allows ${total} copies under a ceiling of ${ceiling}. Lower BASELINE_CEILING to ${total}.`;
  }
  return null;
}

/** How many copies each pair of files holds. */
export function countByPair(clones) {
  const counts = new Map();
  for (const { fileA, fileB } of clones) {
    const key = pairKey(fileA, fileB);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The pairs that hold more copies than the baseline allows, and those that now hold fewer. */
export function compareWithBaseline(clones, baseline) {
  const found = countByPair(clones);
  const allowed = new Map(baseline.map((entry) => [pairKey(...entry.files), entry]));
  const added = [];
  const removed = [];
  for (const [key, count] of found) {
    const allowedCount = allowed.get(key)?.count ?? 0;
    if (count > allowedCount) added.push({ key, count, allowed: allowedCount });
  }
  for (const [key, entry] of allowed) {
    const count = found.get(key) ?? 0;
    if (count < entry.count) removed.push({ key, count, allowed: entry.count, ticket: entry.ticket });
  }
  return { added, removed };
}

async function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const { detectClones } = createRequire(import.meta.url)('jscpd');
  const started = Date.now();
  const raw = await detectClones({
    ...DETECTOR_OPTIONS,
    path: [join(repoRoot, SCANNED_ROOT)],
    reporters: [],
    silent: true,
  });
  const clones = raw.map((clone) => ({
    fileA: relative(repoRoot, clone.duplicationA.sourceId),
    fileB: relative(repoRoot, clone.duplicationB.sourceId),
    lineA: clone.duplicationA.start.line,
    lineB: clone.duplicationB.start.line,
  }));
  const baseline = JSON.parse(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8')).pairs;
  const { added, removed } = compareWithBaseline(clones, baseline);
  const ceilingProblem = checkCeiling(baseline);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  for (const { key, count, allowed } of added) {
    console.error(`New copy: ${key} holds ${count} near-identical blocks, the baseline allows ${allowed}.`);
    for (const clone of clones.filter((c) => pairKey(c.fileA, c.fileB) === key)) {
      console.error(`  ${clone.fileA}:${clone.lineA}  ~  ${clone.fileB}:${clone.lineB}`);
    }
  }
  for (const { key, count, allowed, ticket } of removed) {
    console.error(
      `Copy removed: ${key} now holds ${count} (baseline ${allowed}, ${ticket}). ` +
        `Lower its count in ${BASELINE_FILE} (delete the entry at 0) and BASELINE_CEILING with it.`,
    );
  }
  if (added.length > 0) {
    console.error(
      'Extract the shared piece instead of copying it: rules/react-ui-rules.md §5 *Component Reuse Threshold*.',
    );
  }
  if (ceilingProblem) console.error(ceilingProblem);
  if (added.length > 0 || removed.length > 0 || ceilingProblem) process.exit(1);
  console.log(`Duplicate check OK: ${clones.length} known copies, none new (${seconds}s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
