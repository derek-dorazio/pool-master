/**
 * Utility to convert Zod schemas to JSON Schema for Fastify route validation
 * and OpenAPI spec generation.
 *
 * Converts with Zod's own `z.toJSONSchema`, adjusted so the API validates what it always
 * has: see `adjustNode` and `applyAjvFixes`.
 */
import { z } from 'zod';

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

/**
 * Zod 4 builds `.trim()`, `.toLowerCase()` and `.toUpperCase()` as one kind of check, an
 * `overwrite` holding a bare function, so nothing on the check names which one it is. Running
 * the function on a probe tells them apart: each changes a different part of it. A string
 * overwrite that matches none of them throws, because the request validator could not apply
 * it and the value would be checked un-normalised, the bug #500 fixed.
 */
const PROBE = ' aB ';
const PROBE_RESULTS: ReadonlyMap<string, StringTransform> = new Map([
  [PROBE.trim(), StringTransform.TRIM],
  [PROBE.toLowerCase(), StringTransform.TO_LOWER_CASE],
  [PROBE.toUpperCase(), StringTransform.TO_UPPER_CASE],
]);

function stringTransformOf(check: z.core.$ZodCheck): StringTransform | undefined {
  const { def } = check._zod;
  if (def.check !== 'overwrite') return undefined;
  const result = (def as z.core.$ZodCheckOverwriteDef<string>).tx(PROBE);
  const transform = PROBE_RESULTS.get(result);
  if (transform === undefined) {
    throw new Error(`A string overwrite turned "${PROBE}" into "${result}": not trim, toLowerCase or toUpperCase, so the request validator cannot apply it.`);
  }
  return transform;
}

interface ConvertedNode {
  readonly zodSchema: z.core.$ZodTypes;
  readonly jsonSchema: z.core.JSONSchema.BaseSchema;
}

function recordStringTransforms({ zodSchema, jsonSchema }: ConvertedNode): void {
  if (zodSchema._zod.def.type !== 'string') return;
  const transforms = (zodSchema._zod.def.checks ?? [])
    .map(stringTransformOf)
    .filter((transform) => transform !== undefined);
  if (transforms.length > 0) jsonSchema[STRING_TRANSFORM_KEYWORD] = transforms;
}

/**
 * Zod 4 publishes its own regex beside a string `format` (`uuid`, `date-time`, `email`). Those
 * regexes are stricter than the Ajv formats the API has always validated with: a `uuid` must
 * carry an RFC 9562 version and variant, and a `date-time` must end in `Z`. Keeping only the
 * `format` leaves what the API accepts as it was. A `pattern` the DTO declared itself with
 * `.regex()` stays.
 */
function dropBuiltInFormatPatterns({ zodSchema, jsonSchema }: ConvertedNode): void {
  if (zodSchema._zod.def.type !== 'string' || jsonSchema.format === undefined) return;
  const declaresRegex = [zodSchema, ...(zodSchema._zod.def.checks ?? [])]
    .some((node) => (node._zod.def as { format?: string }).format === 'regex');
  if (!declaresRegex) delete jsonSchema.pattern;
}

/**
 * Zod 4 publishes a discriminated union as `oneOf`. Ajv checks every `oneOf` member, and with
 * Fastify's `removeAdditional` a member that does not match strips the properties it does not
 * know from the request body the matching member already passed. `anyOf` stops at the first
 * match, which is how the API has always validated these unions.
 */
function publishUnionsAsAnyOf({ jsonSchema }: ConvertedNode): void {
  if (jsonSchema.oneOf === undefined) return;
  jsonSchema.anyOf = jsonSchema.oneOf;
  delete jsonSchema.oneOf;
}

function adjustNode(node: ConvertedNode): void {
  recordStringTransforms(node);
  dropBuiltInFormatPatterns(node);
  publishUnionsAsAnyOf(node);
}

/**
 * A nullable enum converts to `{ type, enum, nullable: true }`. Ajv's `nullable` widens `type`
 * but not `enum`, so null still fails the enum check and Fastify refuses a request body that
 * sends it with a 400 — `inactiveReason: null` on the field grid save did (#666). Listing null
 * among the enum values says what the Zod schema means.
 */
function permitNullInNullableEnum(node: Record<string, unknown>): Record<string, unknown> {
  const { nullable, enum: values } = node;
  if (nullable !== true || !Array.isArray(values)) return node;
  const members = values as readonly unknown[];
  return members.includes(null) ? node : { ...node, enum: [...members, null] };
}

/**
 * A nullable union converts to `{ anyOf: [...], nullable: true }`: `nullable` on a node with no
 * `type`, which Ajv refuses when Fastify builds the response serializer, failing the request
 * with a 500. Moving `nullable` onto each member, which has its own `type`, says the same thing.
 */
function distributeNullableOverAnyOf(node: Record<string, unknown>): Record<string, unknown> {
  const { nullable, anyOf, ...rest } = node;
  if (nullable !== true || !Array.isArray(anyOf) || 'type' in node) return node;
  return {
    ...rest,
    anyOf: anyOf.map((member: unknown) =>
      member !== null && typeof member === 'object' && !Array.isArray(member)
        ? permitNullInNullableEnum({ ...(member as Record<string, unknown>), nullable: true })
        : member,
    ),
  };
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

/** Apply the fixes above to every node of a converted schema, innermost first. */
function applyAjvFixes(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(applyAjvFixes);
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    converted[key] = applyAjvFixes(value);
  }
  return permitNullInNullableEnum(distributeNullableOverAnyOf(collapseSingleAllOf(converted)));
}

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // `cycles: 'throw'`: a recursive schema would come out as a local `$ref`, which the API
  // generators cannot follow once Fastify embeds the schema under `paths`. Zod 4 inlines a
  // reused sub-schema, so without a cycle the output holds no local ref at all.
  const converted = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'output',
    cycles: 'throw',
    override: adjustNode,
  });
  return applyAjvFixes(converted) as Record<string, unknown>;
}
