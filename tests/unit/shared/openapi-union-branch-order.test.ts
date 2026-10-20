/**
 * A union's branch order must not let an earlier branch strip a later branch's fields.
 *
 * Fastify validates request bodies with Ajv `removeAdditional`, and our Zod unions publish as
 * plain `anyOf`. Ajv tries the branches in order: a branch whose `required` keys are all
 * present strips every property its `additionalProperties: false` does not list, and only
 * then fails on the `selectionType` enum. The next branch sees the stripped payload. That is
 * how the squares create request lost `maxSquaresPerEntry` to the Survivor branch, which
 * requires only `selectionType`; the fix put Survivor last (`rules/service-rules.md` §4).
 *
 * The scan derives everything from the committed `openapi.json`, which `api:check` keeps in
 * step with the route schemas, so a new union or a new light branch is covered without
 * anyone adding it to a list.
 */
import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';

const ROOT = join(__dirname, '../../..');

interface JsonSchema {
  $ref?: unknown;
  anyOf?: unknown;
  additionalProperties?: unknown;
  properties?: unknown;
  required?: unknown;
  enum?: unknown;
  [key: string]: unknown;
}

interface StrippingPair {
  path: string;
  earlier: number;
  later: number;
  stripped: string[];
}

const openapi = JSON.parse(
  readFileSync(join(ROOT, 'packages/shared/generated/openapi.json'), 'utf8'),
) as JsonSchema;

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follows a local `#/components/schemas/X` reference; anything else is returned as is. */
function resolve(schema: JsonSchema, doc: JsonSchema): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return schema;
  const target = ref
    .slice(2)
    .split('/')
    .reduce<unknown>((node, key) => (isSchema(node) ? node[key] : undefined), doc);
  return isSchema(target) ? resolve(target, doc) : schema;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Every pair of `anyOf` branches where the earlier one would match a payload meant for the
 * later one on its required keys and strip fields the later one needs.
 */
function findStrippingPairs(doc: JsonSchema): StrippingPair[] {
  const pairs: StrippingPair[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}/${String(index)}`));
      return;
    }
    if (!isSchema(node)) return;

    const branches = Array.isArray(node.anyOf) ? node.anyOf.filter(isSchema).map((b) => resolve(b, doc)) : [];
    branches.forEach((earlier, i) => {
      if (earlier.additionalProperties !== false || !isSchema(earlier.properties)) return;
      const earlierProperties = Object.keys(earlier.properties);
      const required = stringList(earlier.required);
      branches.slice(i + 1).forEach((later, offset) => {
        if (!isSchema(later.properties)) return;
        const laterProperties = Object.keys(later.properties);
        if (!required.every((key) => laterProperties.includes(key))) return;
        const stripped = laterProperties.filter((key) => !earlierProperties.includes(key));
        if (stripped.length > 0) pairs.push({ path, earlier: i, later: i + 1 + offset, stripped });
      });
    });

    Object.entries(node).forEach(([key, child]) => walk(child, `${path}/${key}`));
  };

  walk(doc, '#');
  return pairs;
}

const contestConfiguration = resolve(
  { $ref: '#/components/schemas/ContestConfigurationRequest' },
  openapi,
);

function branchesOf(schema: JsonSchema): JsonSchema[] {
  return Array.isArray(schema.anyOf) ? schema.anyOf.filter(isSchema) : [];
}

function selectionTypeOf(branch: JsonSchema): unknown {
  const properties = isSchema(branch.properties) ? branch.properties : {};
  const selectionType = isSchema(properties['selectionType']) ? properties['selectionType'] : {};
  return stringList(selectionType.enum)[0];
}

/** The contest configuration union with its Survivor branch moved to the front. */
function survivorFirst(): JsonSchema {
  const branches = branchesOf(contestConfiguration);
  const survivor = branches.filter((branch) => selectionTypeOf(branch) === 'SURVIVOR');
  const rest = branches.filter((branch) => selectionTypeOf(branch) !== 'SURVIVOR');
  return { ...contestConfiguration, anyOf: [...survivor, ...rest] };
}

describe('anyOf branch order in the published contract', () => {
  it('has no union where an earlier branch would strip fields from a later branch\'s payload', () => {
    expect(findStrippingPairs(openapi)).toEqual([]);
  });

  it('scans the contest configuration union, which carries a Survivor branch that requires only selectionType', () => {
    const survivor = branchesOf(contestConfiguration).find((branch) => selectionTypeOf(branch) === 'SURVIVOR');

    expect(survivor?.required).toEqual(['selectionType']);
    expect(survivor?.additionalProperties).toBe(false);
  });

  it('reports Survivor ahead of Squares as stripping maxSquaresPerEntry', () => {
    const reordered = { components: { schemas: { ContestConfigurationRequest: survivorFirst() } } };
    const squares = branchesOf(survivorFirst()).findIndex((branch) => selectionTypeOf(branch) === 'SQUARES');

    expect(findStrippingPairs(reordered)).toContainEqual({
      path: '#/components/schemas/ContestConfigurationRequest',
      earlier: 0,
      later: squares,
      stripped: expect.arrayContaining(['maxSquaresPerEntry']),
    });
  });
});

describe('Fastify validation of the contest configuration union', () => {
  async function echo(body: JsonSchema, payload: JsonSchema) {
    const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
    app.post('/echo', { schema: { body }, handler: (request) => request.body });
    const response = await app.inject({ method: 'POST', url: '/echo', payload });
    await app.close();
    return response;
  }

  const squaresPayload = { selectionType: 'SQUARES', maxSquaresPerEntry: 10 };

  it('keeps maxSquaresPerEntry on a squares configuration with the published branch order', async () => {
    const response = await echo(contestConfiguration, squaresPayload);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(squaresPayload);
  });

  it('refuses a squares configuration once Survivor is moved first, because the Survivor branch stripped maxSquaresPerEntry', async () => {
    const response = await echo(survivorFirst(), squaresPayload);

    expect(response.statusCode).toBe(400);
  });
});
