/**
 * A nullable enum converts to `{ type, enum, nullable: true }`. Ajv's `nullable` widens `type`
 * but not `enum`, so unless the converter adds null to the enum, Fastify rejects a request body
 * that sends null for the field with a 400, though the published contract says null is allowed.
 * The field grid's `inactiveReason: null` (clear the reason) hit exactly that.
 */
import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from '../../../packages/shared/dto/json-schema';
import { ParticipantInactiveReason } from '../../../packages/shared/domain/enums';

const BodySchema = z.object({
  reason: z.nativeEnum(ParticipantInactiveReason).nullable().optional(),
  kind: z.enum(['A', 'B']).nullable(),
});

describe('zodToJsonSchema with a nullable enum', () => {
  it('adds null to the enum values of a nullable enum, so the schema itself permits null', () => {
    const schema = zodToJsonSchema(BodySchema) as { properties: Partial<Record<string, Record<string, unknown>>> };

    expect(schema.properties['reason']?.['enum']).toEqual(['WITHDRAWN', 'ELIMINATED', null]);
    expect(schema.properties['kind']?.['enum']).toEqual(['A', 'B', null]);
  });

  it('accepts null for a nullable enum in a request body instead of rejecting it with a 400, and still rejects an unknown value', async () => {
    const app = Fastify();
    app.patch('/rows', {
      schema: { body: zodToJsonSchema(BodySchema) },
      handler: async (request) => request.body,
    });

    const cleared = await app.inject({ method: 'PATCH', url: '/rows', payload: { reason: null, kind: null } });
    const set = await app.inject({ method: 'PATCH', url: '/rows', payload: { reason: 'WITHDRAWN', kind: 'A' } });
    const unknown = await app.inject({ method: 'PATCH', url: '/rows', payload: { reason: 'RETIRED', kind: 'A' } });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ reason: null, kind: null });
    expect(set.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(400);
    await app.close();
  });
});
