/**
 * A sub-schema reused inside one DTO and made nullable the second time converts to an `allOf`
 * around the first copy plus `nullable`. Left like that, the node carries `nullable` with no
 * `type`, and Fastify's response serializer fails the request with a 500 as soon as it has to
 * validate an `anyOf` branch of the same response. These pin the converter's output and the
 * serializer behaviour that depends on it.
 */
import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from '../../../packages/shared/dto/json-schema';

const Stamp = z.string().datetime();

const RunSchema = z.object({
  startedAt: Stamp.nullable(),
  completedAt: Stamp.nullable(),
  actor: z.discriminatedUnion('type', [
    z.object({ type: z.literal('SYSTEM') }),
    z.object({ type: z.literal('ADMIN'), userId: z.string() }),
  ]),
});

describe('zodToJsonSchema with a reused schema made nullable', () => {
  it('gives the reused nullable field its own type instead of an allOf with nullable and no type', () => {
    const schema = zodToJsonSchema(RunSchema) as { properties: Record<string, Record<string, unknown>> };

    expect(schema.properties['completedAt']).toEqual(expect.objectContaining({
      type: 'string', format: 'date-time', nullable: true,
    }));
    expect(schema.properties['completedAt']).not.toHaveProperty('allOf');
  });

  it('serializes a response that has both a reused nullable field and a union, rather than failing with a 500', async () => {
    const app = Fastify();
    app.get('/run', {
      schema: { response: { 200: zodToJsonSchema(RunSchema) } },
      handler: async () => ({ startedAt: null, completedAt: null, actor: { type: 'ADMIN', userId: 'u-1' } }),
    });

    const response = await app.inject({ method: 'GET', url: '/run' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ startedAt: null, completedAt: null, actor: { type: 'ADMIN', userId: 'u-1' } });
    await app.close();
  });
});
