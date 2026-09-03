/**
 * pool-master-m32 — hey-api drops `| null` from generated SDK types.
 *
 * Pre-fix state on origin/main:
 *   - `packages/core-api/scripts/export-openapi.ts` wrote the spec with
 *     `openapi: 3.1.0` but 3.0-style `nullable: true` on every nullable field
 *     (from zod-to-json-schema `target: openApi3` + @fastify/swagger).
 *   - @hey-api/openapi-ts ran its 3.1 parser, which ignores the removed
 *     `nullable` keyword, so `packages/shared/generated/hey-api/types.gen.ts`
 *     contained zero `| null` unions.
 *
 * On this branch:
 *   - `rewriteNullableToOpenApi31` translates `nullable: true` into 3.1
 *     type-array / `anyOf` nullability before the spec is written.
 *   - The committed spec therefore contains no `"nullable"` keys, and the
 *     generated SDK carries the `| null` unions.
 *
 * See plans/131-hey-api-nullable-generation-fix.md.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { rewriteNullableToOpenApi31 } from '../../../packages/core-api/src/openapi/nullable-to-3-1';

describe('pool-master-m32 — rewriteNullableToOpenApi31', () => {
  it('pool-master-m32: converts a primitive `nullable: true` to a type array', () => {
    const node = { type: 'string', nullable: true, description: 'x' };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({ type: ['string', 'null'], description: 'x' });
  });

  it('pool-master-m32: preserves sibling constraints (format, enum, minimum)', () => {
    const dateNode = { type: 'string', format: 'date-time', nullable: true };
    rewriteNullableToOpenApi31(dateNode);
    expect(dateNode).toEqual({ type: ['string', 'null'], format: 'date-time' });

    const enumNode = { type: 'string', enum: ['A', 'B'], nullable: true };
    rewriteNullableToOpenApi31(enumNode);
    expect(enumNode).toEqual({ type: ['string', 'null'], enum: ['A', 'B'] });

    const intNode = { type: 'integer', minimum: 0, maximum: 18, nullable: true };
    rewriteNullableToOpenApi31(intNode);
    expect(intNode).toEqual({ type: ['integer', 'null'], minimum: 0, maximum: 18 });
  });

  it('pool-master-m32: appends "null" to an existing type array only once', () => {
    const node: Record<string, unknown> = { type: ['string', 'null'], nullable: true };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({ type: ['string', 'null'] });
  });

  it('pool-master-m32: flattens a single-member allOf wrapper, keeping the outer description', () => {
    const node = {
      allOf: [
        { type: 'string', format: 'date-time', description: 'inner', nullable: true },
      ],
      nullable: true,
      description: 'outer',
    };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({
      type: ['string', 'null'],
      format: 'date-time',
      description: 'outer',
    });
  });

  it('pool-master-m32: wraps a genuine composition in anyOf with a null branch', () => {
    const node = {
      oneOf: [{ type: 'string' }, { type: 'number' }],
      nullable: true,
      description: 'union',
    };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({
      anyOf: [
        { oneOf: [{ type: 'string' }, { type: 'number' }] },
        { type: 'null' },
      ],
      description: 'union',
    });
  });

  it('pool-master-m32: recurses into nested object properties and array items', () => {
    const tree = {
      type: 'object',
      properties: {
        a: { type: 'string', nullable: true },
        b: {
          type: 'array',
          items: { type: 'object', properties: { c: { type: 'number', nullable: true } } },
        },
      },
    };
    rewriteNullableToOpenApi31(tree);
    expect(tree.properties.a).toEqual({ type: ['string', 'null'] });
    expect((tree.properties.b.items as Record<string, any>).properties.c).toEqual({
      type: ['number', 'null'],
    });
  });

  it('pool-master-m32: leaves non-nullable nodes untouched', () => {
    const node = { type: 'string', description: 'plain' };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({ type: 'string', description: 'plain' });
  });
});

describe('pool-master-m32 — committed OpenAPI spec is 3.1-clean', () => {
  it('pool-master-m32: packages/shared/generated/openapi.json contains no `nullable` keyword', () => {
    const specText = readFileSync(
      resolve(__dirname, '../../../packages/shared/generated/openapi.json'),
      'utf8',
    );
    expect(specText).toContain('"openapi": "3.1.0"');
    expect(specText).not.toMatch(/"nullable"/);
  });
});
