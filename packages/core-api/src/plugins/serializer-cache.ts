/**
 * Compiles each distinct response serializer once (#808).
 *
 * Fastify builds a fast-json-stringify serializer for every route and status code, and hands each
 * build every schema registered with `addSchema` — all of the shared DTO components. Each build
 * resolves and checks that whole set again, so boot time grows with routes × components. On QA's
 * quarter-vCPU task that pushed startup past the load balancer's health-check window, and the
 * deploys failed.
 *
 * Most routes share their response schemas (the error bodies above all), so this factory keys
 * each compiled serializer by its schema and the shared schemas it was built against, and reuses
 * it. A serializer is a pure function of those, so sharing one changes no response.
 */
import type { FastifyServerOptions } from 'fastify';
import { SerializerSelector, type Serializer, type SerializerFactory } from '@fastify/fast-json-stringify-compiler';

export function cachedSerializerFactory(build: SerializerFactory = SerializerSelector()): SerializerFactory {
  // Fastify asks for a fresh compiler in every encapsulated plugin, each with the same shared
  // components, so the cache outlives one compiler: keyed first by what the compiler was given.
  const compilers = new Map<string, Map<string, Serializer>>();
  return (externalSchemas, options) => {
    const compile = build(externalSchemas, options);
    const compilerKey = JSON.stringify([externalSchemas, options]);
    let compiled = compilers.get(compilerKey);
    if (compiled === undefined) {
      compiled = new Map();
      compilers.set(compilerKey, compiled);
    }
    const cache = compiled;
    return (route) => {
      const key = JSON.stringify(route.schema);
      let serializer = cache.get(key);
      if (serializer === undefined) {
        serializer = compile(route);
        cache.set(key, serializer);
      }
      return serializer;
    };
  };
}

/** The schema controller every core-api Fastify instance is built with. */
export const FASTIFY_SCHEMA_CONTROLLER: NonNullable<FastifyServerOptions['schemaController']> = {
  compilersFactory: { buildSerializer: cachedSerializerFactory() },
};
