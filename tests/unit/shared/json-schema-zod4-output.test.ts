/**
 * The converter keeps the API validating as it did before Zod 4 (#1137).
 *
 * Fastify's Ajv validates every request against what `zodToJsonSchema` returns, so each
 * difference between Zod 4's own converter and the old one is either undone here or refused.
 */
import { expect } from '@jest/globals';
import { z } from 'zod';
import { STRING_TRANSFORM_KEYWORD, zodToJsonSchema } from '../../../packages/shared/dto/json-schema';
import { TieredContestRulesSchema, extendRules } from '../../../packages/shared/domain/contest-rules';

type JsonNode = Record<string, unknown> & { properties: Record<string, Record<string, unknown>> };

function convert(shape: z.ZodRawShape): JsonNode {
  return zodToJsonSchema(z.object(shape)) as JsonNode;
}

describe('zodToJsonSchema on Zod 4', () => {
  it('publishes a uuid, date-time or email as its format alone, without Zod\'s stricter regex', () => {
    const { properties } = convert({ id: z.uuid(), at: z.iso.datetime(), email: z.email() });

    expect(properties.id).toEqual({ type: 'string', format: 'uuid' });
    expect(properties.at).toEqual({ type: 'string', format: 'date-time' });
    expect(properties.email).toEqual({ type: 'string', format: 'email' });
  });

  it('keeps a pattern the schema declares itself', () => {
    const { properties } = convert({ code: z.string().regex(/^[A-Z]{3}$/) });

    expect(properties.code).toMatchObject({ pattern: '^[A-Z]{3}$' });
  });

  it('publishes a discriminated union as anyOf, so Ajv stops at the first matching member', () => {
    const union = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.number() }),
      z.object({ kind: z.literal('b') }),
    ]);

    const { properties } = convert({ rules: union });

    expect(properties.rules).toHaveProperty('anyOf');
    expect(properties.rules).not.toHaveProperty('oneOf');
  });

  it('records toUpperCase under x-transform like trim and toLowerCase', () => {
    const { properties } = convert({ code: z.string().trim().toUpperCase() });

    expect(properties.code).toMatchObject({ [STRING_TRANSFORM_KEYWORD]: ['trim', 'toUpperCase'] });
  });

  it('refuses a string overwrite the request validator could not apply', () => {
    expect(() => convert({ code: z.string().overwrite((value) => value.slice(1)) }))
      .toThrow(/not trim, toLowerCase or toUpperCase/);
  });

  it('refuses a recursive schema, which would publish a local $ref the API generators cannot follow', () => {
    interface Node { children: Node[] }
    const NodeSchema: z.ZodType<Node> = z.object({ children: z.array(z.lazy(() => NodeSchema)) });

    expect(() => zodToJsonSchema(NodeSchema)).toThrow(/Cycle detected/);
  });
});

describe('extendRules', () => {
  it('keeps the rules\' description, which Zod 4\'s extend drops', () => {
    const extended = extendRules(TieredContestRulesSchema, { id: z.string() });

    expect(extended.description).toBe(TieredContestRulesSchema.description);
    expect(zodToJsonSchema(extended)).toMatchObject({ description: TieredContestRulesSchema.description });
  });
});
