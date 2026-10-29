/**
 * #1242 — every GET route that answers with a list has a query-scaling test.
 *
 * The N+1 reads the 2026-10-28 audit found all passed every gate, because tests seed a handful of
 * rows. `expectConstantQueries` (tests/integration/query-scaling.ts) reads a route with 2 child
 * rows and with 20 and fails if the SQL statement count differs; this check makes writing one
 * required, the way `check-contract-verification.mjs` makes a contract case required.
 *
 * THE RULE. A GET route in the OpenAPI spec whose 200 response holds an array, at the top or in
 * any object it contains, must be named in `tests/` as `route: 'GET <path>'`, the path exactly as
 * the spec writes it, in a file that calls `expectConstantQueries(`, or be listed in
 * `query-scaling-gaps.mjs`. A listed route that has a test now, or a listed path that is not such a
 * route, fails too, and so does a list whose length is not exactly `GAP_CEILING`, so the list only
 * shrinks and each deletion lowers the ceiling with it.
 *
 * WHAT IT DOES NOT PROVE. That the test seeds the rows that could cost a query each. The helper
 * refuses a seed the response does not show; the reviewer judges whether it is the right one.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseRuleCheckArgs, readTextFile, reportFindings, walkFiles } from './rule-check-utils.mjs';
import { QUERY_SCALING_GAPS } from './query-scaling-gaps.mjs';

export const OPENAPI_SPEC = 'packages/shared/generated/openapi.json';
export const TEST_ROOTS = ['tests'];
const GAPS_FILE = 'scripts/query-scaling-gaps.mjs';

/**
 * How many entries the gap list holds, exactly. Lower it with each entry deleted; never raise it.
 * An exact count leaves no slack for a later entry, so growing the list means editing this line,
 * which a reviewer sees.
 */
export const GAP_CEILING = 33;

/** Whether a schema, following `$ref`s into `components.schemas`, is or contains an array. */
export function holdsArray(schema, components, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return false;
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    if (seen.has(name)) return false;
    return holdsArray(components[name], components, new Set([...seen, name]));
  }
  if (schema.type === 'array' || schema.items) return true;
  const nested = [
    ...(schema.allOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    ...Object.values(schema.properties ?? {}),
    ...(typeof schema.additionalProperties === 'object' ? [schema.additionalProperties] : []),
  ];
  return nested.some((child) => holdsArray(child, components, seen));
}

/** The `GET <path>` routes of a spec whose 200 JSON response holds an array, in spec order. */
export function readListRoutes(spec) {
  const components = spec.components?.schemas ?? {};
  return Object.entries(spec.paths ?? {})
    .filter(([, operations]) => holdsArray(operations.get?.responses?.['200']?.content?.['application/json']?.schema, components))
    .map(([path]) => `GET ${path}`);
}

/** The routes test files name for `expectConstantQueries`. */
export function findTestedRoutes(testTexts) {
  const tested = new Set();
  for (const text of testTexts) {
    if (!text.includes('expectConstantQueries(')) continue;
    for (const match of text.matchAll(/\broute:\s*'(GET \/[^']*)'/g)) tested.add(match[1]);
  }
  return tested;
}

export function evaluateQueryScaling({ routes, tested, gaps, ceiling = GAP_CEILING }) {
  const findings = [];
  if (gaps.length > ceiling) {
    findings.push({
      location: GAPS_FILE,
      message: `${gaps.length} gaps are listed, over the ceiling of ${ceiling}. A new list route gets its scaling test, `
        + 'not a gap entry.',
    });
  } else if (gaps.length < ceiling) {
    findings.push({
      location: 'scripts/check-query-scaling.mjs',
      message: `${gaps.length} gaps are listed under a ceiling of ${ceiling}. Lower GAP_CEILING to ${gaps.length}.`,
    });
  }
  const listed = new Set(gaps.map((gap) => gap.route));
  const known = new Set(routes);
  for (const route of routes) {
    if (!tested.has(route) && !listed.has(route)) {
      findings.push({
        location: OPENAPI_SPEC,
        message: `${route} answers with a list and has no query-scaling test. Add an expectConstantQueries case `
          + '(rules/testing-rules.md §9B *Query Scaling Tests*).',
      });
    }
  }
  for (const gap of gaps) {
    if (!known.has(gap.route)) {
      findings.push({ location: GAPS_FILE, message: `${gap.route} is listed but is not a GET route that answers with a list; delete its entry.` });
    } else if (tested.has(gap.route)) {
      findings.push({ location: GAPS_FILE, message: `${gap.route} has a scaling test now; delete its entry.` });
    }
  }
  return findings;
}

function main() {
  const { warnOnly } = parseRuleCheckArgs();
  const routes = readListRoutes(JSON.parse(readFileSync(OPENAPI_SPEC, 'utf8')));
  const tested = findTestedRoutes(walkFiles(TEST_ROOTS, { extensions: ['ts'] }).map(readTextFile));

  reportFindings({
    title: 'Query scaling',
    findings: evaluateQueryScaling({ routes, tested, gaps: QUERY_SCALING_GAPS }),
    warnOnly,
    emptyMessage: `Query scaling: ${routes.filter((route) => tested.has(route)).length} of ${routes.length} list routes tested; `
      + `${QUERY_SCALING_GAPS.length} listed gaps.`,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
