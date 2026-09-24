/**
 * Named OpenAPI component registry.
 *
 * Every entry here becomes `components.schemas.<name>` in the published OpenAPI
 * document, which is what makes hey-api generate an importable named type. Routes
 * reference an entry by `$ref` instead of inlining its shape.
 *
 * WHY THIS EXISTS. Before it, every route called `zodToJsonSchema(X)` directly, so
 * every shape was published inline per-operation and `components.schemas` was empty.
 * hey-api had nothing named to emit, so the frontend's only handle on a response was
 * to index into the operation's response map — `GetLeagueResponses[200]['league']` —
 * and those derivations were copy-pasted until they drifted. See #192 / plans/143.
 *
 * WHAT THIS IS NOT. `dto/json-schema.ts` inlines local `$ref`s on purpose: refs that
 * zod-to-json-schema emits INSIDE a path's schema cannot be followed by the
 * generators once Fastify embeds them under `paths`. That remains true and that
 * helper keeps doing it. A ref to a TOP-LEVEL `components.schemas` entry is a
 * different thing and is followed correctly — which is the whole reason this registry
 * hoists schemas up rather than leaving them nested.
 */
import type { ZodTypeAny } from 'zod';

export interface NamedSchema {
  /** The name published as `components.schemas.<name>` and generated as a type. */
  readonly name: string;
  readonly schema: ZodTypeAny;
}

const registry = new Map<string, ZodTypeAny>();

/**
 * Register a Zod schema under a published component name.
 *
 * Throws on a duplicate name registered with a different schema: two modules
 * publishing different shapes under one name is the exact drift this epic removes,
 * and it must fail at startup rather than silently letting the last registration win.
 */
export function registerSchema<T extends ZodTypeAny>(name: string, schema: T): T {
  const existing = registry.get(name);
  if (existing !== undefined && existing !== schema) {
    throw new Error(
      `Duplicate OpenAPI component name "${name}". Two different schemas cannot publish `
      + 'under one name — pick distinct names, or export one canonical schema and reuse it.',
    );
  }
  registry.set(name, schema);
  return schema;
}

/** Every registered schema, for the swagger plugin to publish as components. */
export function registeredSchemas(): readonly NamedSchema[] {
  return [...registry.entries()].map(([name, schema]) => ({ name, schema }));
}

/**
 * A route-level reference to a registered component.
 *
 * The `Name#` form is Fastify's, NOT an OpenAPI document pointer. Fastify builds the
 * response serializer from the route schema and resolves `$ref` against schemas added
 * via `fastify.addSchema({ $id })` — it has no knowledge of `components.schemas`.
 * Using `#/components/schemas/Name` here fails at boot with
 * `Cannot find reference "#/components/schemas/Name"`, which is how this was settled.
 * @fastify/swagger then hoists every added schema into `components.schemas` for the
 * published document, so the OpenAPI output is correct without the route saying so.
 */
export function schemaRef(name: string): { $ref: string } {
  if (!registry.has(name)) {
    throw new Error(
      `No registered OpenAPI component named "${name}". Register it with registerSchema() `
      + 'in the DTO module before referencing it from a route.',
    );
  }
  return { $ref: `${name}#` };
}

/** Test seam: drop all registrations. */
export function resetRegistryForTests(): void {
  registry.clear();
}
