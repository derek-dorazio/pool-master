/**
 * #745 — every response schema is checked against a live response somewhere in `tests/`.
 *
 * `rules/testing-rules.md` §4 *Contract Verification Gate* says an endpoint is not finished
 * until a live response has been parsed with its DTO schema. Nothing else catches a mapper that
 * drops or renames a field: the hey-api SDK the functional suites call does not validate
 * responses, and TypeScript only checks what the mapper claims to return. The 2026-10-18 audit
 * found 27 of 68 response schemas never parsed, every bracket and per-event entry response among
 * them, because the gate was a sentence nobody had to satisfy.
 *
 * THE RULE. Each `export const <Name>ResponseSchema` in `packages/shared/dto` must appear in
 * `tests/` as `<Name>ResponseSchema.safeParse(` or `.parse(`, or as the first argument of
 * `expectMatchesSchema(` (tests/support/expect-matches-schema.ts), or be listed in
 * `contract-verification-gaps.mjs`. A listed schema that is checked now, or a listed name that is
 * not an exported schema, fails too, so the list only shrinks.
 *
 * WHAT IT DOES NOT PROVE. That the check runs against the right endpoint, or that the endpoint's
 * every response shape (a knockout pick as well as a golf one) is exercised. It proves a schema
 * is not forgotten; the reviewer judges the case.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseRuleCheckArgs, readTextFile, reportFindings, walkFiles } from './rule-check-utils.mjs';
import { CONTRACT_VERIFICATION_GAPS } from './contract-verification-gaps.mjs';

export const DTO_DIR = 'packages/shared/dto';
export const TEST_ROOTS = ['tests'];
const GAPS_FILE = 'scripts/contract-verification-gaps.mjs';

/** The `<Name>ResponseSchema` constants a DTO file exports. */
export function readResponseSchemaNames(text) {
  return [...text.matchAll(/^export const (\w+ResponseSchema)\b/gm)].map((match) => match[1]);
}

/** The schemas among `names` that some test text parses or hands to `expectMatchesSchema`. */
export function findCheckedSchemas(names, testTexts) {
  const checked = new Set();
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\.(?:safeParse|parse)\\(|\\bexpectMatchesSchema\\(\\s*${name}\\b`);
    if (testTexts.some((text) => pattern.test(text))) checked.add(name);
  }
  return checked;
}

export function evaluateContractVerification({ schemas, checked, gaps }) {
  const findings = [];
  const listed = new Set(gaps.map((gap) => gap.schema));
  const exported = new Set(schemas.map((schema) => schema.name));

  for (const { name, file } of schemas) {
    if (!checked.has(name) && !listed.has(name)) {
      findings.push({
        location: file,
        message: `${name} is never checked against a live response in tests/. Add a contract-verification case `
          + '(rules/testing-rules.md §4 *Contract Verification Gate*).',
      });
    }
  }
  for (const gap of gaps) {
    if (!exported.has(gap.schema)) {
      findings.push({ location: GAPS_FILE, message: `${gap.schema} is listed but is not an exported response schema; delete its entry.` });
    } else if (checked.has(gap.schema)) {
      findings.push({ location: GAPS_FILE, message: `${gap.schema} is checked now; delete its entry.` });
    }
  }
  return findings;
}

function main() {
  const { warnOnly } = parseRuleCheckArgs();
  const schemas = readdirSync(DTO_DIR)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) => {
      const path = join(DTO_DIR, file);
      return readResponseSchemaNames(readFileSync(path, 'utf8')).map((name) => ({ name, file: path }));
    });
  const testTexts = walkFiles(TEST_ROOTS, { extensions: ['ts', 'tsx'] }).map(readTextFile);
  const checked = findCheckedSchemas(schemas.map((schema) => schema.name), testTexts);

  reportFindings({
    title: 'Contract verification',
    findings: evaluateContractVerification({ schemas, checked, gaps: CONTRACT_VERIFICATION_GAPS }),
    warnOnly,
    emptyMessage: `Contract verification: ${checked.size} of ${schemas.length} response schemas checked; `
      + `${CONTRACT_VERIFICATION_GAPS.length} listed gaps.`,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
