import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * The vendored copy of BALLDONTLIE's published OpenAPI document for one league, readable as
 * JSON Schema. The contract tests and the fake API hold the adapter and every fixture to it,
 * so they can only agree with the vendor's document, never with each other alone.
 *
 * The vendor writes OpenAPI 3.0's `nullable: true` inside a 3.1 document. JSON Schema 2020-12
 * has no such keyword, so it is rewritten once here into the type union it means.
 */

export const BALLDONTLIE_FIXTURE_DIR = resolve(__dirname, '../fixtures/balldontlie');

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** One query parameter as the document declares it, with its `$ref` resolved. */
export interface VendorQueryParameter {
  name: string;
  required: boolean;
  schema: JsonObject;
}

export interface VendorSpec {
  /** The document's paths that answer GET. */
  readonly paths: readonly string[];
  /** The query parameters a GET path declares. */
  queryParameters(path: string): VendorQueryParameter[];
  /** A validator for the 200 JSON body of a GET path. */
  responseValidator(path: string): ValidateFunction;
  /** A validator for a value of `#/components/schemas/<name>`. */
  componentValidator(name: string): ValidateFunction;
  /** `#/components/schemas/<name>`, nullable rewritten, `$ref`s left in place. */
  component(name: string): JsonObject;
  /** Resolves a local `$ref` (`#/components/schemas/X`) to its schema. */
  resolveRef(ref: string): JsonObject;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rewriteNullable(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(rewriteNullable);
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'nullable') out[key] = rewriteNullable(value);
  }
  if (node['nullable'] !== true) return out;
  if (typeof out['$ref'] === 'string') {
    const { $ref, ...rest } = out;
    return { ...rest, anyOf: [{ $ref }, { type: 'null' }] };
  }
  if (typeof out['type'] === 'string') out['type'] = [out['type'], 'null'];
  if (Array.isArray(out['enum'])) out['enum'] = [...out['enum'], null];
  return out;
}

const specCache = new Map<string, VendorSpec>();

/** `league` names the vendored file: `openapi/<league>.yml`. */
export function loadVendorSpec(league: string): VendorSpec {
  const cached = specCache.get(league);
  if (cached) return cached;

  const raw = parse(readFileSync(resolve(BALLDONTLIE_FIXTURE_DIR, `openapi/${league}.yml`), 'utf8')) as JsonValue;
  const document = rewriteNullable(raw) as JsonObject;
  const documentId = `https://balldontlie.vendored/${league}.yml`;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ ...document, $id: documentId });

  const pointer = (segments: string[]) =>
    `${documentId}#/${segments.map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
  const paths = document['paths'] as JsonObject;

  const resolveRef = (ref: string): JsonObject => {
    const segments = ref.replace(/^#\//, '').split('/');
    let node: JsonValue = document;
    for (const segment of segments) {
      if (!isObject(node)) throw new Error(`Unresolvable $ref ${ref}`);
      node = node[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    if (!isObject(node)) throw new Error(`Unresolvable $ref ${ref}`);
    return node;
  };

  /** A parameter schema with its `$ref`s replaced by what they name, so it compiles on its own. */
  const inlineRefs = (node: JsonValue): JsonObject => {
    const inline = (value: JsonValue): JsonValue => {
      if (Array.isArray(value)) return value.map(inline);
      if (!isObject(value)) return value;
      if (typeof value['$ref'] === 'string') return inline(resolveRef(value['$ref']));
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, inline(entry)]));
    };
    return inline(node) as JsonObject;
  };

  const getOperation = (path: string): JsonObject => {
    const item = paths[path];
    if (!isObject(item) || !isObject(item['get'])) throw new Error(`The vendor document has no GET ${path}`);
    return item['get'];
  };

  const spec: VendorSpec = {
    paths: Object.keys(paths).filter((path) => isObject(paths[path]) && isObject(paths[path]['get'])),
    queryParameters(path) {
      const parameters = getOperation(path)['parameters'];
      if (!Array.isArray(parameters)) return [];
      return parameters.map((entry) => {
        const parameter = isObject(entry) && typeof entry['$ref'] === 'string' ? resolveRef(entry['$ref']) : entry;
        if (!isObject(parameter) || parameter['in'] !== 'query' || typeof parameter['name'] !== 'string' || !isObject(parameter['schema'])) {
          throw new Error(`GET ${path} declares a parameter this support does not read: ${JSON.stringify(entry)}`);
        }
        return { name: parameter['name'], required: parameter['required'] === true, schema: inlineRefs(parameter['schema']) };
      });
    },
    responseValidator(path) {
      getOperation(path);
      return ajv.compile({ $ref: pointer(['paths', path, 'get', 'responses', '200', 'content', 'application/json', 'schema']) });
    },
    componentValidator(name) {
      return ajv.compile({ $ref: pointer(['components', 'schemas', name]) });
    },
    component(name) {
      return resolveRef(`#/components/schemas/${name}`);
    },
    resolveRef,
  };
  specCache.set(league, spec);
  return spec;
}

/** A fixture file under `tests/fixtures/balldontlie/<league>/`, parsed. */
export function readBalldontlieFixture(league: string, file: string): unknown {
  return JSON.parse(readFileSync(resolve(BALLDONTLIE_FIXTURE_DIR, league, file), 'utf8'));
}

/** Ajv's errors as one readable line each, for a failure message. */
export function describeErrors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((error) => `${error.instancePath || '(root)'} ${error.message ?? ''}`).join('\n');
}
