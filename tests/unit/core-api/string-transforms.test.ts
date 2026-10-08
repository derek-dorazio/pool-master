/**
 * A Zod `.trim()` / `.toLowerCase()` on a request DTO takes effect at validation (#500).
 *
 * JSON Schema cannot express either, so the converter records them under `x-transform` and
 * core-api's Ajv plugin applies them before the rest of the schema judges the value. Without
 * both halves, `" derek@x.com "` fails `format: email` and never reaches the service.
 */
import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { z } from 'zod';
import { STRING_TRANSFORM_KEYWORD, zodToJsonSchema } from '../../../packages/shared/dto/json-schema';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';

describe('zodToJsonSchema string transforms', () => {
  it('records trim and lowercase on a string, in the order Zod applies them', () => {
    const schema = zodToJsonSchema(z.object({ email: z.string().trim().toLowerCase().email() }));

    expect(schema).toMatchObject({
      properties: { email: { format: 'email', [STRING_TRANSFORM_KEYWORD]: ['trim', 'toLowerCase'] } },
    });
  });

  it('adds nothing to a string that declares no transform', () => {
    const schema = zodToJsonSchema(z.object({ name: z.string().min(1) }));

    expect(schema).toEqual(expect.objectContaining({ properties: { name: { type: 'string', minLength: 1 } } }));
  });
});

describe('Fastify validation with the string-transform plugin', () => {
  async function echo(payload: Record<string, unknown>, query = '') {
    const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
    app.post('/echo', {
      schema: {
        body: zodToJsonSchema(z.object({
          email: z.string().trim().toLowerCase().email(),
          username: z.string().trim().min(3).regex(/^\S+$/),
          emails: z.array(z.string().trim().email()).optional(),
          note: z.string().trim().nullable().optional(),
        })),
        querystring: zodToJsonSchema(z.object({ search: z.string().trim().optional() })),
      },
      handler: (request) => ({ body: request.body, query: request.query }),
    });
    const response = await app.inject({ method: 'POST', url: `/echo${query}`, payload });
    await app.close();
    return response;
  }

  it('hands the handler trimmed, lowercased values that pass the email format and no-spaces pattern', async () => {
    const response = await echo(
      { email: '  Derek@Example.COM ', username: ' derek ', emails: [' a@b.co '], note: null },
      '?search=%20golf%20',
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      body: { email: 'derek@example.com', username: 'derek', emails: ['a@b.co'], note: null },
      query: { search: 'golf' },
    });
  });

  it('still refuses a value that is invalid once trimmed with 400', async () => {
    const tooShort = await echo({ email: 'derek@example.com', username: '  ab  ' });
    const innerSpace = await echo({ email: 'derek@example.com', username: ' de rek ' });
    const notAnEmail = await echo({ email: ' derek ', username: 'derek' });

    expect([tooShort.statusCode, innerSpace.statusCode, notAnEmail.statusCode]).toEqual([400, 400, 400]);
  });
});
