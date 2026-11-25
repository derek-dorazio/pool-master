/**
 * The sport registry is frozen: it can only shrink (rules/architecture-rules.md §4 *Sport
 * extension*, rules/domain-model-conventions-rules.md §17 *Rules Live In The Model, Not In Code*).
 *
 * `packages/shared/domain/sports/` once held every fact that differed between sports. Under the
 * league model those facts are model rows on the sport league, its slot definitions or its
 * Seasons, and the registry is emptied slice by slice. Until it is gone, nothing new goes in:
 * no new `SportDefinition` field and no new export from the folder. Only `SportDefinition`'s own
 * fields are frozen; the fields of the other registry interfaces (`SportPickEm`,
 * `SportMatchPeriods`, `SportLeagueDefinition`…) are not listed, so a reviewer reads for those
 * (rules/review-triggers.md §9). Exports are every `export const|function|type|…`, every name
 * in a local `export { … }` list and `export default`. This check lists both and
 * compares them with `scripts/sport-registry-frozen.json`:
 *
 * - a field or export the baseline lacks fails: put the fact in the model (a column or row the
 *   API returns), not in the registry;
 * - one the baseline has and the source no longer does fails too, so its entry is deleted in the
 *   same PR: run with `--update`, which only ever removes entries.
 *
 * `rules:check:baseline-ratchet` refuses an entry added to the baseline by hand unless
 * `scripts/baseline-raises.json` declares it.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_FILE = 'scripts/sport-registry-frozen.json';
export const REGISTRY_DIR = 'packages/shared/domain/sports';
const DEFINITION_FILE = 'sport-definition.ts';

/** The top-level fields of `interface SportDefinition`, in source order. */
export function definitionFields(text) {
  const start = text.indexOf('export interface SportDefinition {');
  if (start < 0) return [];
  const fields = [];
  let depth = 0;
  for (const line of text.slice(start).split('\n').slice(1)) {
    if (depth === 0 && /^\}/.test(line)) break;
    const field = depth === 0 ? /^\s{2}(?:readonly\s+)?([A-Za-z_]\w*)\??:/.exec(line) : null;
    if (field) fields.push(field[1]);
    depth += (line.match(/[{(]/g)?.length ?? 0) - (line.match(/[})]/g)?.length ?? 0);
  }
  return fields;
}

/**
 * The names a registry file exports: `export const|function|type|interface|enum|class X`, each
 * name (or its `as` alias) in a local `export { … }` list, and `default`. A re-export
 * (`export { X } from './y'`, `export * from`) is counted in the file that declares it.
 */
export function exportedNames(text) {
  const declared = [...text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function|type|interface|enum|class)\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]);
  const listed = [...text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from\b)/gm)].flatMap((match) =>
    match[1]
      .split(',')
      .map((part) => part.trim().replace(/^type\s+/, ''))
      .filter(Boolean)
      .map((part) => part.split(/\s+as\s+/).pop()),
  );
  const fallback = /^export\s+default\b/m.test(text) ? ['default'] : [];
  return [...declared, ...listed, ...fallback];
}

/** Every frozen entry: `field:<name>` for SportDefinition, `export:<file>:<name>` for the folder. */
export function registryEntries(files) {
  const entries = [];
  for (const [file, text] of Object.entries(files)) {
    if (file === DEFINITION_FILE) entries.push(...definitionFields(text).map((name) => `field:${name}`));
    entries.push(...exportedNames(text).map((name) => `export:${file}:${name}`));
  }
  return [...new Set(entries)].sort();
}

/** Entries the source has that the baseline lacks (added) and the reverse (removed). */
export function compareWithBaseline(entries, baseline) {
  const known = new Set(baseline);
  const present = new Set(entries);
  return {
    added: entries.filter((entry) => !known.has(entry)),
    removed: baseline.filter((entry) => !present.has(entry)),
  };
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const dir = join(repoRoot, REGISTRY_DIR);
  const files = Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => [name, readFileSync(join(dir, name), 'utf8')]),
  );
  const entries = registryEntries(files);
  const baselinePath = join(repoRoot, BASELINE_FILE);
  let baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (process.argv.includes('--update')) {
    const present = new Set(entries);
    baseline = baseline.filter((entry) => present.has(entry));
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Removed gone entries from ${BASELINE_FILE}: ${baseline.length} left.`);
  }
  const { added, removed } = compareWithBaseline(entries, baseline);
  for (const entry of added) {
    console.error(`${REGISTRY_DIR}: ${entry} is new. The sport registry is frozen: put the fact in the model and have the API return it (rules/architecture-rules.md §4 Sport extension).`);
  }
  for (const entry of removed) {
    console.error(`${entry} is gone from ${REGISTRY_DIR}. Delete its entry: run node scripts/check-sport-registry-frozen.mjs --update.`);
  }
  if (added.length > 0 || removed.length > 0) process.exit(1);
  console.log(`The sport registry matches its frozen list: ${entries.length} entries.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
