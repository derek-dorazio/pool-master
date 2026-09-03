/**
 * Rewrite OpenAPI 3.0-style nullability (`{ "type": "string", "nullable": true }`)
 * into OpenAPI 3.1 / JSON-Schema-2020-12 style (`{ "type": ["string", "null"] }`).
 *
 * WHY: `zod-to-json-schema` (target `openApi3`) and `@fastify/swagger` both emit
 * 3.0-style `nullable: true`, but our exported spec declares `openapi: 3.1.0`.
 * `@hey-api/openapi-ts` trusts that version string, runs its 3.1 schema parser,
 * and 3.1 *removed* the `nullable` keyword — so every `| null` union is silently
 * dropped from `packages/shared/generated/hey-api/types.gen.ts`. Translating the
 * nullability encoding to match the declared version fixes generation without a
 * downgrade or a package bump. See plans/131-hey-api-nullable-generation-fix.md.
 *
 * The spec only ever contains a handful of nullable shapes (an explicit string
 * `type` plus siblings like `format`/`enum`/`minimum`, `object` schemas, and
 * single-member `allOf` wrappers around a `$ref`-like base). All are handled here.
 * `nullable` on a bare `$ref`, or alongside `oneOf`/multi-member `allOf`, falls
 * back to an `anyOf: [ <original>, { type: "null" } ]` wrap.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const STRUCTURAL_KEYS = ['allOf', 'oneOf', 'anyOf', '$ref'] as const;

/**
 * Recursively convert `nullable: true` nodes in an OpenAPI document tree to 3.1
 * type-array / `anyOf` nullability. Mutates `node` in place.
 */
export function rewriteNullableToOpenApi31(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteNullableToOpenApi31(item);
    return;
  }
  if (!isRecord(node)) return;

  // Depth-first: children are already 3.1-shaped before we handle this node,
  // which keeps the single-member `allOf` merge below simple.
  for (const value of Object.values(node)) rewriteNullableToOpenApi31(value);

  if (node.nullable !== true) return;
  delete node.nullable;

  const type = node.type;

  if (typeof type === 'string') {
    node.type = type === 'null' ? type : [type, 'null'];
    return;
  }

  if (Array.isArray(type)) {
    if (!type.includes('null')) type.push('null');
    return;
  }

  // No own `type`: the node is a composition/ref wrapper.
  const structuralKeys = STRUCTURAL_KEYS.filter((key) => key in node);

  // Common case from zod-to-json-schema: `{ allOf: [ <base> ], nullable: true,
  // description?: string }` with no other schema keywords. Flatten to the base
  // schema, made nullable, keeping this node's description if it has one.
  if (
    structuralKeys.length === 1
    && structuralKeys[0] === 'allOf'
    && Array.isArray(node.allOf)
    && node.allOf.length === 1
    && isRecord(node.allOf[0])
    && Object.keys(node).every((key) => key === 'allOf' || key === 'description')
  ) {
    const base = node.allOf[0];
    const outerDescription = node.description;
    for (const key of Object.keys(node)) delete node[key];
    Object.assign(node, base);
    if (typeof outerDescription === 'string') node.description = outerDescription;

    const baseType = node.type;
    if (typeof baseType === 'string') {
      node.type = baseType === 'null' ? baseType : [baseType, 'null'];
    } else if (Array.isArray(baseType)) {
      if (!baseType.includes('null')) baseType.push('null');
    } else {
      rewriteNullableToOpenApi31(node); // base was itself a wrapper — re-run
      if (node.type === undefined && !('anyOf' in node)) {
        wrapWithNullBranch(node);
      }
    }
    return;
  }

  if (structuralKeys.length > 0) {
    wrapWithNullBranch(node);
    return;
  }

  // `nullable: true` with neither `type` nor a composition — e.g. a lone object
  // schema described only by `properties`. Give it an explicit nullable type.
  node.type = ['null'];
  if (isRecord(node.properties) || node.properties !== undefined) {
    node.type = ['object', 'null'];
  }
}

/**
 * Move every non-`description` key of `node` into an inner schema and replace
 * `node`'s body with `anyOf: [ <inner>, { type: "null" } ]`.
 */
function wrapWithNullBranch(node: JsonRecord): void {
  const description = node.description;
  const inner: JsonRecord = {};
  for (const key of Object.keys(node)) {
    if (key === 'description') continue;
    inner[key] = node[key];
    delete node[key];
  }
  node.anyOf = [inner, { type: 'null' }];
  if (typeof description === 'string') node.description = description;
}
