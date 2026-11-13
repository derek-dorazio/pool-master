/**
 * #1619 — the rule-scanner baselines only ever go down, and this check holds them to it.
 *
 * Each scanner's `--update` only lowers its baseline, but nothing stopped a change from editing an
 * entry upward by hand, or adding a file, which quietly undoes the ratchet. This check reads every
 * baseline at the base commit and fails when the working tree's copy has an entry higher than
 * there, or one the base does not have, naming the file and the entry. Lowering or deleting an
 * entry is always fine. A baseline file the base does not have yet is new and is not compared.
 *
 * WHAT IT IS MEASURED AGAINST — the same base as the migration timestamp check:
 * - In CI (`CI` set), against `HEAD^1`: a `pull_request` build's merge commit has the base tip as
 *   its first parent, and a push to `main` has the previous `main`. all-contract-gates checks out
 *   with `fetch-depth: 2` for that reason.
 * - Locally, against the merge-base with `origin/main`. Fetch `origin/main` first.
 * - `BASELINE_BASE_REF` overrides both.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A count per web app file: the text-style, titled-tile and card-corner scanners. */
function countsPerFile(text) {
  return new Map(Object.entries(JSON.parse(text)).filter(([key]) => !key.startsWith('$')));
}

/** The duplicate check's allowed copies: a count per pair of files. */
function countsPerPair(text) {
  const { pairs = [] } = JSON.parse(text);
  return new Map(pairs.map((pair) => [[...pair.files].sort().join(' + '), pair.count]));
}

/** The query-states lint rule's grandfathered files: each listed file counts one. */
function listedFiles(text) {
  return new Map([...text.matchAll(/^\s*'([^']+)',?\s*$/gm)].map((match) => [match[1], 1]));
}

/** Every ratcheted baseline and how its entries are read. A new baseline is added here. */
export const BASELINES = [
  { file: 'scripts/text-style-baseline.json', read: countsPerFile },
  { file: 'scripts/titled-tile-baseline.json', read: countsPerFile },
  { file: 'scripts/card-corner-baseline.json', read: countsPerFile },
  { file: 'scripts/duplicate-baseline.json', read: countsPerPair },
  { file: 'eslint-rules/query-states-baseline.mjs', read: listedFiles },
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
  let failed = false;
  for (const { file, read } of BASELINES) {
    const baseText = readAt(ref, file);
    if (baseText === null) continue;
    const raises = findRaises(read(baseText), read(readFileSync(join(repoRoot, file), 'utf8')));
    for (const { key, was, now } of raises) {
      failed = true;
      console.error(`${file}: ${key} went from ${was} to ${now}. Baselines only go down: fix the new copies instead of raising the entry.`);
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
