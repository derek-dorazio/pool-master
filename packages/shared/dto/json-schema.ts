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
import { zodToJsonSchema as convert, type PostProcessCallback } from 'zod-to-json-schema';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * The string normalisations a Zod schema can declare (`.trim()`, `.toLowerCase()`,
 * `.toUpperCase()`), named as Zod names their checks.
 */
export const StringTransform = {
  TRIM: 'trim',
  TO_LOWER_CASE: 'toLowerCase',
  TO_UPPER_CASE: 'toUpperCase',
} as const;
export type StringTransform = (typeof StringTransform)[keyof typeof StringTransform];

/**
 * JSON Schema has no way to say "trim this", so a Zod `.trim()` used to vanish in conversion
 * and Fastify validated the raw value: `" derek@x.com "` failed `format: email` before any
 * service could trim it (#500). The converter now records each normalisation under this
 * keyword, in the order Zod applies them, and core-api's validator applies them to the
 * request before checking the value. It is an `x-` extension, so OpenAPI tooling ignores it.
 */
export const STRING_TRANSFORM_KEYWORD = 'x-transform';

const STRING_TRANSFORMS: ReadonlySet<string> = new Set(Object.values(StringTransform));

interface ZodStringDefShape extends ZodTypeDef {
  typeName?: string;
  checks?: readonly { kind: string }[];
}

const recordStringTransforms: PostProcessCallback = (jsonSchema, def) => {
  const stringDef = def as ZodStringDefShape;
  if (jsonSchema === undefined || stringDef.typeName !== 'ZodString') return jsonSchema;
  const transforms = (stringDef.checks ?? [])
    .map((check) => check.kind)
    .filter((kind) => STRING_TRANSFORMS.has(kind));
  if (transforms.length === 0) return jsonSchema;
  return Object.assign({}, jsonSchema, { [STRING_TRANSFORM_KEYWORD]: transforms });
};

// zod-to-json-schema's own signature makes TypeScript instantiate a type that is
// excessively deep, and ts-jest fails compilation with TS2589 at the call site
// below. `npx turbo typecheck` does NOT surface it -- the package tsconfigs and
// the ts-jest config resolve it differently -- so removing this assertion looks
// safe right up until the backend suite fails to compile. It is a third-party
// type escape hatch, narrowed to the one shape this module actually calls.
// eslint-disable-next-line no-restricted-syntax -- see above; TS2589 without it
const convertToJsonSchema = convert as unknown as (
  schema: ZodType<unknown>,
  options: { target: 'openApi3'; postProcess: PostProcessCallback }
) => unknown;

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

  if (typeof obj.$ref === 'string' && obj.$ref.startsWith('#/')) {
    const pointer = obj.$ref.slice(2).split('/');
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
  return collapseSingleAllOf(resolved);
}

/**
 * A reused sub-schema made nullable converts to `{ allOf: [<ref>], nullable: true }`. Once the
 * ref is inlined, that `allOf` of one says nothing its member does not, but it leaves `nullable`
 * on a node with no `type`, which Ajv refuses when Fastify's serializer validates an `anyOf`
 * branch against the response schema. Folding the one member into its parent keeps the meaning
 * and gives `nullable` its `type` back.
 */
function collapseSingleAllOf(node: Record<string, unknown>): Record<string, unknown> {
  const { allOf, ...rest } = node;
  if (!Array.isArray(allOf) || allOf.length !== 1) return node;
  const [member] = allOf as unknown[];
  if (member === null || typeof member !== 'object' || Array.isArray(member)) return node;
  return { ...(member as Record<string, unknown>), ...rest };
}

export function zodToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  const raw = convertToJsonSchema(schema, { target: 'openApi3', postProcess: recordStringTransforms }) as Record<string, unknown>;
  return resolveLocalRefs(raw, raw) as Record<string, unknown>;
}
