/**
 * #1119 — the product name and tagline are typed in one place, `packages/shared/domain/brand.ts`.
 *
 * Everything a person reads (the app, its emails, link previews, the browser tab) takes them
 * from `PRODUCT_NAME` and `PRODUCT_TAGLINE`, so a rename is one edit. This check fails when
 * either is typed out anywhere else in tracked source. Tests are exempt: they check that the
 * name and tagline show up, so they spell them out on purpose. Markdown is exempt too, since
 * rules and docs name the product in prose.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRAND_FILE = 'packages/shared/domain/brand.ts';

const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|html|sql|json|yml|yaml)$/;
const TEST_PATH = /(\.(test|spec|functional|e2e)\.[a-z]+$)|(^|\/)(tests|e2e|__tests__)\//;

/** The name and tagline as `brand.ts` declares them. */
export function readBrandStrings(brandSource) {
  const read = (constant) => {
    const match = brandSource.match(new RegExp(`export const ${constant} = '([^']+)';`));
    if (!match) throw new Error(`${BRAND_FILE} has no ${constant} string.`);
    return match[1];
  };
  return [read('PRODUCT_NAME'), read('PRODUCT_TAGLINE')];
}

/** Whether a tracked file is source this check reads: not brand.ts, a test or prose. */
export function isCheckedSource(path) {
  return path !== BRAND_FILE && SOURCE_EXTENSION.test(path) && !TEST_PATH.test(path);
}

/** Every line in the given files that types out a brand string, as `path:line`. */
export function findBrandLiterals({ files, brandStrings }) {
  const hits = [];
  for (const { path, text } of files) {
    text.split('\n').forEach((line, index) => {
      const found = brandStrings.find((brand) => line.includes(brand));
      if (found) hits.push({ location: `${path}:${index + 1}`, brand: found });
    });
  }
  return hits;
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const brandStrings = readBrandStrings(readFileSync(join(repoRoot, BRAND_FILE), 'utf8'));
  const listed = spawnSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exit(1);
  }
  const files = listed.stdout
    .split('\n')
    .filter((path) => path && isCheckedSource(path))
    .map((path) => ({ path, text: readFileSync(join(repoRoot, path), 'utf8') }));
  const hits = findBrandLiterals({ files, brandStrings });
  if (hits.length > 0) {
    for (const { location, brand } of hits) console.error(`${location} types "${brand}".`);
    console.error(`Read PRODUCT_NAME or PRODUCT_TAGLINE from ${BRAND_FILE} instead (rules/ux-rules.md §9).`);
    process.exit(1);
  }
  console.log(`The product name and tagline are typed only in ${BRAND_FILE}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
