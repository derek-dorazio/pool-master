/**
 * #1619 — the rule-scanner baselines only ever go down, and this check holds them to it.
 *
 * Each scanner's `--update` only lowers its baseline, but nothing stopped a change from editing an
 * entry upward by hand, or adding a file, which quietly undoes the ratchet. This check reads every
 * baseline at the base commit and fails when the working tree's copy has an entry higher than
 * there, or one the base does not have, naming the file and the entry. Lowering or deleting an
 * entry is always fine. A baseline file the base does not have yet is new and is not compared.
 *
 * WHEN A SCANNER GETS STRICTER — a PR that tightens a scanner either fixes the copies it now
 * finds, or lists each raised entry in `scripts/baseline-raises.json` with the count it may reach
 * and why. That file is the one sanctioned way up: it sits in the PR's diff, so the reviewer sees
 * every raise and its reason. An entry only allows its exact count; the scanner's next `--update`
 * or a later fix lowers the baseline again, and the entry is then deleted.
 *
 * WHAT IT IS MEASURED AGAINST — the same base as the migration timestamp check:
 * - In CI (`CI` set), against `HEAD^1`: a `pull_request` build's merge commit has the base tip as
 *   its first parent, and a push to `main` has the previous `main`. all-contract-gates checks out
 *   with `fetch-depth: 2` for that reason.
 * - Locally, against the merge-base with `origin/main`. Fetch `origin/main` first.
 * - `BASELINE_BASE_REF` overrides both.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A count per web app file: the text-style, titled-tile, card-corner and page-sections scanners. */
function countsPerFile(text) {
  return new Map(Object.entries(JSON.parse(text)).filter(([key]) => !key.startsWith('$')));
}

/** The duplicate check's allowed copies: a count per pair of files. */
function countsPerPair(text) {
  const { pairs = [] } = JSON.parse(text);
  return new Map(pairs.map((pair) => [[...pair.files].sort().join(' + '), pair.count]));
}

/** A grandfathered-files list: each quoted path on a line of its own counts one, in either quote. */
function listedFiles(text) {
  return new Map([...text.matchAll(/^\s*(['"])([^'"]+)\1,?\s*$/gm)].map((match) => [match[2], 1]));
}

/** Every ratcheted baseline and how its entries are read. A new baseline is added here. */
export const BASELINES = [
  { file: 'scripts/text-style-baseline.json', read: countsPerFile },
  { file: 'scripts/titled-tile-baseline.json', read: countsPerFile },
  { file: 'scripts/card-corner-baseline.json', read: countsPerFile },
  { file: 'scripts/duplicate-baseline.json', read: countsPerPair },
  { file: 'eslint-rules/query-states-baseline.mjs', read: listedFiles },
  { file: 'eslint-rules/button-style-baseline.mjs', read: listedFiles },
  { file: 'scripts/page-sections-baseline.json', read: countsPerFile },
];

/**
 * The entries `head` has above `base`: higher counts, and entries `base` lacks (counted from 0).
 * Lower and removed entries are the ratchet working and are never reported.
 */
export function findRaises(base, head) {
  const raises = [];
  for (const [key, count] of head) {
    const was = base.get(key) ?? 0;
    if (count > was) raises.push({ key, was, now: count });
  }
  return raises;
}

/** The raises a PR declares in `scripts/baseline-raises.json`: `{ file, key, now, reason }` each. */
export const RAISES_FILE = 'scripts/baseline-raises.json';

/** A file's declared raises as `key -> now`, refusing an entry with no reason. */
export function declaredRaises(text, file) {
  const { raises = [] } = JSON.parse(text);
  const allowed = new Map();
  for (const raise of raises) {
    if (raise.file !== file) continue;
    if (typeof raise.reason !== 'string' || raise.reason.trim() === '') {
      throw new Error(`${RAISES_FILE}: the raise of ${raise.file} ${raise.key} needs a reason.`);
    }
    allowed.set(raise.key, raise.now);
  }
  return allowed;
}

/** The raises left once those declared at exactly their new count are taken out. */
export function undeclared(raises, allowed) {
  return raises.filter(({ key, now }) => allowed.get(key) !== now);
}

/** The base ref (see WHAT IT IS MEASURED AGAINST), or null when no merge-base resolves. */
export function resolveBaseRef(env = process.env, mergeBaseWith = (ref) => git(['merge-base', 'HEAD', ref])) {
  if (env.BASELINE_BASE_REF) return env.BASELINE_BASE_REF;
  if (env.CI) return 'HEAD^1';
  return mergeBaseWith('origin/main');
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** A file's text at a ref, or null when the ref does not have it. */
function readAt(ref, file) {
  const result = spawnSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const ref = resolveBaseRef();
  if (!ref || git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) {
    const where = ref ? `\`${ref}\`` : 'a merge-base with `origin/main`';
    console.error(`Baseline ratchet check: could not read the base at ${where}. In CI the job needs \`fetch-depth: 2\`; locally, fetch origin/main.`);
    process.exit(1);
  }
  const raisesPath = join(repoRoot, RAISES_FILE);
  const raisesText = existsSync(raisesPath) ? readFileSync(raisesPath, 'utf8') : '{}';
  let failed = false;
  for (const { file, read } of BASELINES) {
    const baseText = readAt(ref, file);
    if (baseText === null) continue;
    const headPath = join(repoRoot, file);
    if (!existsSync(headPath)) {
      failed = true;
      console.error(`${file} is gone but is still in BASELINES: remove it from scripts/check-baseline-ratchet.mjs too.`);
      continue;
    }
    const raises = undeclared(findRaises(read(baseText), read(readFileSync(headPath, 'utf8'))), declaredRaises(raisesText, file));
    for (const { key, was, now } of raises) {
      failed = true;
      console.error(`${file}: ${key} went from ${was} to ${now}. Baselines only go down: fix the new copies, or, when a scanner got stricter, declare the raise with its reason in ${RAISES_FILE}.`);
    }
  }
  if (failed) {
    console.error('A baseline was raised by hand. Each scanner\'s --update only lowers it; see the scanner named in the file for what it counts.');
    process.exit(1);
  }
  console.log(`Baselines only went down against ${ref}: ${BASELINES.length} files checked.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
