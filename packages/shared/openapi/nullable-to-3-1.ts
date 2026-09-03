/**
 * Rewrite OpenAPI 3.0-style nullability (`{ "type": "string", "nullable": true }`)
 * into OpenAPI 3.1 / JSON-Schema-2020-12 style (`{ "type": ["string", "null"] }`).
 *
 * WHY: `zod-to-json-schema` (target `openApi3`, see `dto/json-schema.ts`) and
 * `@fastify/swagger` both emit 3.0-style `nullable: true`, but our exported spec
 * declares `openapi: 3.1.0`. 3.1 *removed* the `nullable` keyword, so
 * `@hey-api/openapi-ts` trusts that version string, runs its 3.1 schema parser,
 * and silently drops every `| null` union from
 * `packages/shared/generated/hey-api/types.gen.ts`. Translating the nullability
 * encoding to match the declared version fixes generation without a downgrade or
 * a package bump. See plans/131-hey-api-nullable-generation-fix.md.
 *
 * Shapes seen in the exported spec: an explicit string `type` plus siblings
 * (`format` / `enum` / `minimum` / `properties` / …), and single-member `allOf`
 * wrappers around a base schema. `nullable` on a bare `$ref`, or alongside
 * `oneOf` / a multi-member `allOf`, falls back to
 * `anyOf: [ <original>, { type: "null" } ]`.
 *
 * NOTE on enums: under JSON-Schema-2020-12 `enum` is validated independently of
 * `type`, so `{ type: ["string","null"], enum: ["A","B"] }` still forbids null.
 * Whenever a node is made nullable, `null` is also added to any `enum` array.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const STRUCTURAL_KEYS = ['allOf', 'oneOf', 'anyOf', '$ref'] as const;

/** Append `"null"` to a string / string[] `type`, in place. No-op if already present. */
function addNullToType(node: JsonRecord): void {
  const type = node.type;
  if (typeof type === 'string') {
    if (type !== 'null') node.type = [type, 'null'];
  } else if (Array.isArray(type)) {
    if (!type.includes('null')) type.push('null');
  }
}

/**
 * If the node constrains values with `enum`, make sure `null` is a permitted
 * member — otherwise a nullable type union is defeated by the enum check and
 * @hey-api/openapi-ts emits the non-nullable union.
 */
function addNullToEnum(node: JsonRecord): void {
  if (Array.isArray(node.enum) && !node.enum.includes(null)) {
    node.enum.push(null);
  }
}

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

  if (typeof type === 'string' || Array.isArray(type)) {
    addNullToType(node);
    addNullToEnum(node);
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

    if (node.type === undefined && !('anyOf' in node)) {
      // base was itself a wrapper — re-run, then fall back to an anyOf null branch
      rewriteNullableToOpenApi31(node);
      if (node.type === undefined && !('anyOf' in node)) wrapWithNullBranch(node);
    } else {
      addNullToType(node);
      addNullToEnum(node);
    }
    return;
  }

  if (structuralKeys.length > 0) {
    wrapWithNullBranch(node);
    return;
  }

  // `nullable: true` with neither `type` nor a composition — e.g. a lone object
  // schema described only by `properties`. Give it an explicit nullable type.
  node.type = node.properties !== undefined ? ['object', 'null'] : ['null'];
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
