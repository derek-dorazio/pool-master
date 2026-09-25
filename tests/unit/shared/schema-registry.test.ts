/**
 * #192 — the named-component registry.
 *
 * These cover the registry's contract. The document-level invariants (that a
 * registered schema actually reaches `components.schemas` under its own name, and
 * that a route $refs it) live in openapi-named-components.test.ts, because those can
 * only be observed on the generated artifact.
 */
import { z } from 'zod';
import {
  registerSchema,
  registeredSchemas,
  schemaRef,
  resetRegistryForTests,
} from '../../../packages/shared/dto/schema-registry';

describe('#192: named OpenAPI component registry', () => {
  beforeEach(() => {
    resetRegistryForTests();
  });

  it('rule: returns the schema it was given, so registration composes inline', () => {
    const schema = z.object({ a: z.string() });
    expect(registerSchema('Thing', schema)).toBe(schema);
  });

  it('rule: publishes registered schemas for the components plugin', () => {
    const a = z.object({ a: z.string() });
    const b = z.object({ b: z.number() });
    registerSchema('A', a);
    registerSchema('B', b);
    expect(registeredSchemas()).toEqual([
      { name: 'A', schema: a },
      { name: 'B', schema: b },
    ]);
  });

  it('rule: re-registering the SAME schema under one name is a no-op', () => {
    // Module import order can register a schema more than once; that is benign.
    const schema = z.object({ a: z.string() });
    registerSchema('Thing', schema);
    registerSchema('Thing', schema);
    expect(registeredSchemas()).toHaveLength(1);
  });

  it('rule: two DIFFERENT schemas under one name throws at registration', () => {
    // This is the drift #192 exists to remove. It must fail at startup rather than
    // letting the last registration silently win and publish the wrong shape.
    registerSchema('Thing', z.object({ a: z.string() }));
    expect(() => registerSchema('Thing', z.object({ b: z.number() })))
      .toThrow(/Duplicate OpenAPI component name "Thing"/);
  });

  it('rule: schemaRef emits Fastify $id syntax, not an OpenAPI document pointer', () => {
    // Fastify resolves route $refs against addSchema($id); it knows nothing about
    // components.schemas. Using '#/components/schemas/X' here fails at boot with
    // `Cannot find reference`, which is how the mechanism was settled.
    registerSchema('Thing', z.object({ a: z.string() }));
    expect(schemaRef('Thing')).toEqual({ $ref: 'Thing#' });
  });

  it('rule: referencing an unregistered component throws with a usable message', () => {
    expect(() => schemaRef('Missing'))
      .toThrow(/No registered OpenAPI component named "Missing"/);
  });
});
