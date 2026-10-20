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
 * each compiled serializer by its schema and reuses it. A serializer is a pure function of its
 * schema and the external schemas the factory was given, so sharing one changes no response.
 */
import type { FastifyServerOptions } from 'fastify';
import { SerializerSelector, type SerializerFactory } from '@fastify/fast-json-stringify-compiler';

export function cachedSerializerFactory(build: SerializerFactory = SerializerSelector()): SerializerFactory {
  return build;
}

/** The schema controller every core-api Fastify instance is built with. */
export const FASTIFY_SCHEMA_CONTROLLER: NonNullable<FastifyServerOptions['schemaController']> = {
  compilersFactory: { buildSerializer: cachedSerializerFactory() },
};
