/**
 * #1841 — a shared enum's order lives beside the enum, in `packages/shared/domain/enums.ts`, and
 * nowhere else (rules/domain-model-conventions-rules.md §2 *Closed Sets Are Enums*). A list, grid or sort
 * that needs the order uses `<Name>Order` with `compareByEnumOrder`, or a named priority order
 * declared there, such as `ContestStatusOrderForHomeCurrent`.
 *
 * This check flags a `Record<SharedEnum, number>` declared outside enums.ts that is an order
 * map: its name says so (order, rank, index, priority, position, place, sequence), or its literal
 * gives the values the places 0, 1, 2 ... in turn. A `Record<SharedEnum, number>` holding real
 * quantities, such as a cup weight or a cap's usage, is not an order and passes. Tests and
 * comment lines are exempt.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENUMS_FILE = 'packages/shared/domain/enums.ts';
const SOURCE = /^(packages|clients)\/.+\.(ts|tsx)$/;
const EXEMPT = /(\.(test|spec|stories)\.tsx?$)|(\/generated\/)|(\/src\/test\/)/;
const ORDER_NAME = /order|rank|index|priority|position|place|sequence/i;

/** The names of the `as const` enum objects enums.ts declares. */
export function sharedEnumNames(enumsSource) {
  return [...enumsSource.matchAll(/^export const (\w+) = \{/gm)].map((match) => match[1]);
}

/** True when an object literal's values are the whole numbers 0, 1, 2 ... with none skipped. */
function isPlaceSequence(literal) {
  const values = [...literal.matchAll(/:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g)].map((match) => Number(match[1]));
  if (values.length < 2) return false;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.every((value, index) => value === index);
}

/** The order maps a source file declares: `{ name, enumName, line }` for each. */
export function findEnumOrderMaps(text, enumNames) {
  const code = text
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line))
    .join('\n');
  const enums = enumNames.join('|');
  const declaration = new RegExp(
    `(?:const|let|var)\\s+(\\w+)\\s*:[^=;]*?Record<\\s*(${enums})\\s*,\\s*number\\s*>[^=;]*=\\s*(\\{[^}]*\\})?`,
    'g',
  );
  const found = [];
  for (const match of code.matchAll(declaration)) {
    const [, name, enumName, literal] = match;
    if (ORDER_NAME.test(name) || (literal !== undefined && isPlaceSequence(literal))) {
      found.push({ name, enumName, line: code.slice(0, match.index).split('\n').length });
    }
  }
  return found;
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const enumNames = sharedEnumNames(readFileSync(join(repoRoot, ENUMS_FILE), 'utf8'));
  const listed = spawnSync('git', ['ls-files', 'packages', 'clients'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exit(1);
  }
  const paths = listed.stdout.split('\n').filter((path) => SOURCE.test(path) && !EXEMPT.test(path) && path !== ENUMS_FILE);
  let failures = 0;
  for (const path of paths) {
    for (const { name, enumName, line } of findEnumOrderMaps(readFileSync(join(repoRoot, path), 'utf8'), enumNames)) {
      failures += 1;
      console.error(`${path}:${line} ${name} is an order map over ${enumName}. Use ${enumName}Order with compareByEnumOrder, or declare a named order beside ${enumName} in ${ENUMS_FILE} (rules/domain-model-conventions-rules.md §2 *Closed Sets Are Enums*).`);
    }
  }
  if (failures > 0) process.exit(1);
  console.log(`No enum order maps outside ${ENUMS_FILE}: ${paths.length} files checked against ${enumNames.length} enums.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
