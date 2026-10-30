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
 * the spec writes it, in a file that calls `expectConstantQueries(` (or `expectFixedQueries(`, for
 * a list whose length code fixes). There are no exemptions: the routes that shipped before the
 * check got their tests with their fixes (#1315, #1316).
 *
 * WHAT IT DOES NOT PROVE. That the test seeds the rows that could cost a query each. The helper
 * refuses a seed the response does not show; the reviewer judges whether it is the right one.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseRuleCheckArgs, readTextFile, reportFindings, walkFiles } from './rule-check-utils.mjs';

export const OPENAPI_SPEC = 'packages/shared/generated/openapi.json';
export const TEST_ROOTS = ['tests'];

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

/** The routes test files name for `expectConstantQueries` or `expectFixedQueries`. */
export function findTestedRoutes(testTexts) {
  const tested = new Set();
  for (const text of testTexts) {
    if (!text.includes('expectConstantQueries(') && !text.includes('expectFixedQueries(')) continue;
    for (const match of text.matchAll(/\broute:\s*'(GET \/[^']*)'/g)) tested.add(match[1]);
  }
  return tested;
}

export function evaluateQueryScaling({ routes, tested }) {
  return routes
    .filter((route) => !tested.has(route))
    .map((route) => ({
      location: OPENAPI_SPEC,
      message: `${route} answers with a list and has no query-scaling test. Add an expectConstantQueries case, or an `
        + 'expectFixedQueries case when code fixes its length (rules/testing-rules.md §9B *Query Scaling Tests*).',
    }));
}

function main() {
  const { warnOnly } = parseRuleCheckArgs();
  const routes = readListRoutes(JSON.parse(readFileSync(OPENAPI_SPEC, 'utf8')));
  const tested = findTestedRoutes(walkFiles(TEST_ROOTS, { extensions: ['ts'] }).map(readTextFile));

  reportFindings({
    title: 'Query scaling',
    findings: evaluateQueryScaling({ routes, tested }),
    warnOnly,
    emptyMessage: `Query scaling: all ${routes.length} list routes tested.`,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
