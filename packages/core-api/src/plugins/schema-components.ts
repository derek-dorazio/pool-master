/**
 * Registers every named DTO component with Fastify (#192).
 *
 * Separate from the swagger plugin on purpose. A route that references a component
 * with `{ $ref: 'Name#' }` needs that schema registered to build its response
 * serializer — whether or not the app serves documentation. Registering inside the
 * swagger plugin made routes silently depend on docs being enabled, and any app that
 * skipped swagger failed at boot with `Cannot resolve ref "Name#"`. The unit tests
 * for the version module, which build a bare Fastify instance, caught exactly that.
 *
 * `fastify-plugin` wrapping matters: added schemas must land on the root instance so
 * routes in any encapsulation context can resolve them.
 */
import fp from 'fastify-plugin';
import { registeredSchemas } from '@poolmaster/shared/dto/schema-registry';
import { zodToJsonSchema } from '@poolmaster/shared/dto/json-schema';

// eslint-disable-next-line @typescript-eslint/require-await -- fastify-plugin expects an async signature
export const schemaComponentsPlugin = fp(async (fastify) => {
  for (const { name, schema } of registeredSchemas()) {
    // Idempotent: every route module registers this plugin so it is self-contained,
    // and `addSchema` throws on a duplicate $id. Skipping an already-present schema
    // is what lets more than one module depend on it without ordering rules.
    if (fastify.getSchema(name) !== undefined) continue;
    fastify.addSchema({ $id: name, ...zodToJsonSchema(schema) });
  }
}, { name: 'poolmaster-schema-components' });
