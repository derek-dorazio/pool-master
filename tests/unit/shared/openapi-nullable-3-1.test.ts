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
 *   - `rewriteNullableToOpenApi31` (packages/shared/openapi) translates
 *     `nullable: true` into 3.1 type-array / `anyOf` nullability, and adds
 *     `null` to any `enum` array so nullable enum fields survive too.
 *   - The committed spec has no `"nullable"` keys, and the generated SDK's
 *     `| null` count is at least that of `api-types.ts` (openapi-typescript).
 *
 * See plans/131-hey-api-nullable-generation-fix.md.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { rewriteNullableToOpenApi31 } from '@poolmaster/shared/openapi';

const GENERATED_DIR = resolve(__dirname, '../../../packages/shared/generated');

describe('pool-master-m32 — rewriteNullableToOpenApi31', () => {
  it('pool-master-m32: converts a primitive `nullable: true` to a type array', () => {
    const node = { type: 'string', nullable: true, description: 'x' };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({ type: ['string', 'null'], description: 'x' });
  });

  it('pool-master-m32: preserves sibling constraints (format, minimum)', () => {
    const dateNode = { type: 'string', format: 'date-time', nullable: true };
    rewriteNullableToOpenApi31(dateNode);
    expect(dateNode).toEqual({ type: ['string', 'null'], format: 'date-time' });

    const intNode = { type: 'integer', minimum: 0, maximum: 18, nullable: true };
    rewriteNullableToOpenApi31(intNode);
    expect(intNode).toEqual({ type: ['integer', 'null'], minimum: 0, maximum: 18 });
  });

  it('pool-master-m32: adds null to a nullable enum (type union alone does not permit null under 2020-12)', () => {
    const node = { type: 'string', enum: ['COMMISSIONER', 'MEMBER'], nullable: true };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({
      type: ['string', 'null'],
      enum: ['COMMISSIONER', 'MEMBER', null],
    });
  });

  it('pool-master-m32: does not double-add null to an enum that already has it', () => {
    const node: Record<string, unknown> = {
      type: ['string', 'null'],
      enum: ['A', null],
      nullable: true,
    };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({ type: ['string', 'null'], enum: ['A', null] });
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

  it('pool-master-m32: flattens a single-member allOf wrapper around a nullable enum', () => {
    const node = {
      allOf: [{ type: 'string', enum: ['A', 'B'], nullable: true }],
      nullable: true,
    };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({ type: ['string', 'null'], enum: ['A', 'B', null] });
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
    const node = { type: 'string', enum: ['A', 'B'], description: 'plain' };
    rewriteNullableToOpenApi31(node);
    expect(node).toEqual({ type: 'string', enum: ['A', 'B'], description: 'plain' });
  });
});

describe('pool-master-m32 — committed generated artifacts are 3.1-clean and carry `| null`', () => {
  const openapi = readFileSync(resolve(GENERATED_DIR, 'openapi.json'), 'utf8');
  const heyApiTypes = readFileSync(resolve(GENERATED_DIR, 'hey-api/types.gen.ts'), 'utf8');
  const apiTypes = readFileSync(resolve(GENERATED_DIR, 'api-types.ts'), 'utf8');

  // Count lines carrying a `| null` type union. Line-based (not occurrence-based)
  // so it is comparable across the two generators — openapi-typescript
  // occasionally emits `| null` twice on one line where hey-api emits it once.
  // The leading space keeps JSDoc like `@enum {string|null}` out of the count.
  const countNullUnionLines = (src: string) =>
    src.split('\n').filter((line) => / \| null\b/.test(line)).length;

  it('pool-master-m32: openapi.json declares 3.1.0 and has no `nullable` keyword', () => {
    expect(openapi).toContain('"openapi": "3.1.0"');
    expect(openapi).not.toMatch(/"nullable"/);
  });

  it('pool-master-m32: every `type: [T, "null"]` enum node also lists null in its enum', () => {
    const spec = JSON.parse(openapi) as unknown;
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`));
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      const rec = node as Record<string, unknown>;
      if (
        Array.isArray(rec.type)
        && rec.type.includes('null')
        && Array.isArray(rec.enum)
        && !rec.enum.includes(null)
      ) {
        offenders.push(path);
      }
      for (const [key, value] of Object.entries(rec)) walk(value, `${path}.${key}`);
    };
    walk(spec, '$');
    expect(offenders).toEqual([]);
  });

  it('pool-master-m32: hey-api SDK carries at least as many `| null` union lines as api-types.ts', () => {
    // openapi-typescript honours nullability regardless of the declared version,
    // so its count is the floor the hey-api SDK must also reach. Before the enum
    // fix the hey-api count trailed api-types by 18 (the nullable-enum slots).
    expect(countNullUnionLines(heyApiTypes)).toBeGreaterThanOrEqual(countNullUnionLines(apiTypes));
  });

  it('pool-master-m32: representative nullable fields carry `| null` in the hey-api SDK', () => {
    // plain nullable string, nullable number, nullable enum
    expect(heyApiTypes).toMatch(/matchKeyword:\s*string\s*\|\s*null/);
    expect(heyApiTypes).toMatch(/price:\s*number\s*\|\s*null/);
    expect(heyApiTypes).toMatch(/memberType:\s*'COMMISSIONER'\s*\|\s*'MEMBER'\s*\|\s*null/);
  });
});
