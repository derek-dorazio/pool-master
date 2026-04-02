/**
 * Utility to convert Zod schemas to JSON Schema for Fastify route validation
 * and OpenAPI spec generation.
 *
 * Resolves local $ref pointers that zod-to-json-schema creates when a Zod
 * sub-schema is reused (e.g. MetricValueDtoSchema appearing twice in
 * PlatformMetricsResponseSchema).  openapi-typescript and @hey-api cannot
 * follow those local refs once Fastify embeds the schema inside the OpenAPI
 * spec's paths, so we inline them here.
 */
import { zodToJsonSchema as convert } from 'zod-to-json-schema';

/**
 * Resolve every `{ $ref: "#/..." }` in a JSON-Schema-like tree by
 * looking up the pointer within `root` and replacing the node in-place.
 */
function resolveLocalRefs(node: unknown, root: Record<string, unknown>): unknown {
  if (node === null || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    return node.map((item) => resolveLocalRefs(item, root));
  }

  const obj = node as Record<string, unknown>;

  if (typeof obj.$ref === 'string' && (obj.$ref as string).startsWith('#/')) {
    const pointer = (obj.$ref as string).slice(2).split('/');
    let target: unknown = root;
    for (const segment of pointer) {
      if (target === null || typeof target !== 'object') return obj;
      target = (target as Record<string, unknown>)[segment];
    }
    return resolveLocalRefs(target, root);
  }

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    resolved[key] = resolveLocalRefs(value, root);
  }
  return resolved;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToJsonSchema(schema: any): Record<string, unknown> {
  const raw = convert(schema, { target: 'openApi3' }) as Record<string, unknown>;
  return resolveLocalRefs(raw, raw) as Record<string, unknown>;
}
