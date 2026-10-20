/**
 * core-api builds each distinct response serializer once (#808).
 *
 * Every serializer build re-checks all shared DTO schemas, so building one per route and status
 * code made boot time grow with routes × components until QA's task missed its health-check
 * window. These tests count builds through the factory the cache wraps.
 */
import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { SerializerSelector, type SerializerFactory } from '@fastify/fast-json-stringify-compiler';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import { cachedSerializerFactory } from '../../../packages/core-api/src/plugins/serializer-cache';

const ERROR_BODY = { type: 'object', properties: { error: { type: 'string' } } } as const;
const ITEM_BODY = { type: 'object', properties: { id: { type: 'string' }, total: { type: 'number' } } } as const;

/** The default fast-json-stringify factory, counting the serializers it compiles. */
function countingFactory(): { factory: SerializerFactory; builds: () => number } {
  let builds = 0;
  const real = SerializerSelector();
  const factory: SerializerFactory = (externalSchemas, options) => {
    const compile = real(externalSchemas, options);
    return (route) => {
      builds += 1;
      return compile(route);
    };
  };
  return { factory, builds: () => builds };
}

async function appWithRoutes(buildSerializer: SerializerFactory) {
  const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS, schemaController: { compilersFactory: { buildSerializer } } });
  for (const path of ['/a', '/b', '/c']) {
    app.get(path, {
      schema: { response: { 200: ITEM_BODY, 400: ERROR_BODY, 404: ERROR_BODY } },
      handler: (request, reply) => (request.headers['x-fail'] === 'yes'
        ? reply.code(404).send({ error: 'not found', secret: 'dropped' })
        : { id: path, total: 3, secret: 'dropped' }),
    });
  }
  await app.ready();
  return app;
}

describe('cachedSerializerFactory', () => {
  it('compiles each distinct response schema once, however many routes and status codes share it', async () => {
    const counter = countingFactory();
    const app = await appWithRoutes(cachedSerializerFactory(counter.factory));

    expect(counter.builds()).toBe(2);
    await app.close();
  });

  it('shares compiled serializers across encapsulated plugins that reference the same shared schema', async () => {
    const counter = countingFactory();
    const app = Fastify({
      logger: false,
      ajv: FASTIFY_AJV_OPTIONS,
      schemaController: { compilersFactory: { buildSerializer: cachedSerializerFactory(counter.factory) } },
    });
    app.addSchema({ $id: 'Item', ...ITEM_BODY });
    for (const path of ['/a', '/b', '/c']) {
      app.register((child, _options, done) => {
        child.get(path, { schema: { response: { 200: { $ref: 'Item#' } } }, handler: () => ({ id: path, total: 1 }) });
        done();
      });
    }
    await app.ready();

    expect(counter.builds()).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/c' })).body).toBe('{"id":"/c","total":1}');
    await app.close();
  });

  it('still serializes each route by its own schema, dropping fields the schema does not declare', async () => {
    const app = await appWithRoutes(cachedSerializerFactory(countingFactory().factory));

    const ok = await app.inject({ method: 'GET', url: '/b' });
    const missing = await app.inject({ method: 'GET', url: '/c', headers: { 'x-fail': 'yes' } });

    expect(ok.body).toBe('{"id":"/b","total":3}');
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toBe('{"error":"not found"}');
    await app.close();
  });
});
