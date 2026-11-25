import Fastify from 'fastify';
import { z } from 'zod';
import { registerSchema, registeredSchemas } from '../../../packages/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../../packages/core-api/src/plugins/schema-components';

registerSchema('OpenApiPluginsTestThing', z.object({ name: z.string() }));

describe('schemaComponentsPlugin', () => {
  it('registers every named DTO under its own $id', async () => {
    const app = Fastify({ logger: false });
    await app.register(schemaComponentsPlugin);
    await app.ready();

    for (const { name } of registeredSchemas()) expect(app.getSchema(name)).toBeDefined();
    await app.close();
  });

  it('skips a schema the app already has, rather than failing on a duplicate $id', async () => {
    const app = Fastify({ logger: false });
    const own = { $id: 'OpenApiPluginsTestThing', type: 'object', properties: { own: { type: 'string' } } };
    app.addSchema(own);

    await app.register(schemaComponentsPlugin);
    await app.ready();

    expect(app.getSchema('OpenApiPluginsTestThing')).toEqual(own);
    await app.close();
  });
});
