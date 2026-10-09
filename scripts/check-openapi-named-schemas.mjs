/**
 * #192 — every request body and response in the exported OpenAPI must reference a named
 * component (`#/components/schemas/<Name>`), never an inline schema.
 *
 * A named component is what makes hey-api generate an importable type. An inline schema gives
 * the frontend only an index into the operation's response map, and those derivations get
 * copied around until they drift. Before #192 the error envelope alone was inlined 454 times.
 *
 * Fix a failure by registering the Zod schema with `registerSchema()` in its DTO module and
 * pointing the route at it with `schemaRef()`, then `npm run api:refresh`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COMPONENT_REF = '#/components/schemas/';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Every request body or response whose schema is not a `$ref` to a named component. */
export function findInlineSchemas(spec) {
  const inline = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item?.[method];
      if (!operation) continue;
      const where = `${method.toUpperCase()} ${path}`;
      for (const [mediaType, media] of Object.entries(operation.requestBody?.content ?? {})) {
        if (!isNamedRef(media?.schema)) inline.push({ operation: where, part: `request body (${mediaType})` });
      }
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        for (const [mediaType, media] of Object.entries(response?.content ?? {})) {
          if (!isNamedRef(media?.schema)) inline.push({ operation: where, part: `${status} response (${mediaType})` });
        }
      }
    }
  }
  return inline;
}

function isNamedRef(schema) {
  return typeof schema?.$ref === 'string' && schema.$ref.startsWith(COMPONENT_REF);
}

function main() {
  const specPath = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/shared/generated/openapi.json');
  const inline = findInlineSchemas(JSON.parse(readFileSync(specPath, 'utf-8')));
  if (inline.length === 0) {
    console.log('OpenAPI named-schema check: every request body and response references a named component.');
    return;
  }
  console.error(`OpenAPI named-schema check: ${inline.length} inline schema(s). Name each one:`);
  for (const { operation, part } of inline) console.error(`  ${operation}  ${part}`);
  console.error(
    '\nRegister the Zod schema with registerSchema() in its DTO module, reference it from the route '
    + 'with schemaRef(), then run `npm run api:refresh`.',
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
