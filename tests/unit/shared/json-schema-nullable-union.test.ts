/**
 * A nullable union converts to an `anyOf` plus `nullable`, a node with no `type`. Ajv refuses
 * that when Fastify builds the response serializer, so the request fails with a 500. The
 * converter moves `nullable` onto each member, which all have a type. These pin its output and
 * the serializer behaviour that depends on it.
 */
import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from '../../../packages/shared/dto/json-schema';

const RulesSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TIERED'), picksPerTier: z.number().int() }),
  z.object({ kind: z.literal('BUDGET'), rosterSize: z.number().int() }),
]);

const ResponseSchema = z.object({
  rules: RulesSchema.nullable().describe('The rules, or null when there are none.'),
});

describe('zodToJsonSchema with a nullable union', () => {
  it('puts nullable on every typed member of the union instead of on an anyOf with no type', () => {
    const schema = zodToJsonSchema(ResponseSchema) as { properties: Partial<Record<string, Record<string, unknown>>> };
    const rules = schema.properties['rules'];

    expect(rules).not.toHaveProperty('nullable');
    expect(rules?.['description']).toBe('The rules, or null when there are none.');
    expect(rules?.['anyOf']).toEqual([
      expect.objectContaining({ type: 'object', nullable: true }),
      expect.objectContaining({ type: 'object', nullable: true }),
    ]);
  });

  it('serializes both a union member and null for a nullable union field, rather than failing with a 500', async () => {
    const app = Fastify();
    app.get<{ Querystring: { empty?: string } }>('/rules', {
      schema: { response: { 200: zodToJsonSchema(ResponseSchema) } },
      handler: async (request) => ({ rules: request.query.empty === undefined ? { kind: 'BUDGET', rosterSize: 6 } : null }),
    });

    const withRules = await app.inject({ method: 'GET', url: '/rules' });
    const withoutRules = await app.inject({ method: 'GET', url: '/rules?empty=1' });

    expect(withRules.statusCode).toBe(200);
    expect(withRules.json()).toEqual({ rules: { kind: 'BUDGET', rosterSize: 6 } });
    expect(withoutRules.statusCode).toBe(200);
    expect(withoutRules.json()).toEqual({ rules: null });
    await app.close();
  });
});
