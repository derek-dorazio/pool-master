import type { VendorSpec } from './balldontlie-vendor-spec';

/**
 * Every way an adapter schema (as `z.toJSONSchema` writes it) and the vendor's documented schema
 * disagree, as readable lines. The adapter must accept everything the vendor documents for the
 * fields it reads; fields it does not read are not compared. Shared by each league's contract
 * test.
 *
 * `presentByRequest` names the fields (`Component.field`) read as always present although the
 * vendor does not list them as required, each with why that is safe.
 */
export function contractGapsAgainst(spec: VendorSpec, presentByRequest: ReadonlyMap<string, string>) {
  type JsonSchema = Record<string, unknown>;

  /** A vendor schema node with its `$ref` resolved and `anyOf [X, null]` folded into X's types. */
  interface VendorNode {
    schema: JsonSchema;
    types: Set<string>;
  }

  function typesOf(schema: JsonSchema): Set<string> {
    const type = schema['type'];
    if (Array.isArray(type)) return new Set(type as string[]);
    if (typeof type === 'string') return new Set([type]);
    return new Set();
  }

  function resolveVendor(node: JsonSchema): VendorNode {
    if (typeof node['$ref'] === 'string') {
      return resolveVendor(spec.resolveRef(node['$ref']));
    }
    // The vendor wraps a described `$ref` as `allOf: [{ $ref }]`; one branch is that branch.
    if (Array.isArray(node['allOf'])) {
      const branches = node['allOf'] as JsonSchema[];
      if (branches.length !== 1) throw new Error(`Unsupported vendor allOf: ${JSON.stringify(node)}`);
      return resolveVendor(branches[0]);
    }
    if (Array.isArray(node['anyOf'])) {
      const branches = (node['anyOf'] as JsonSchema[]).map(resolveVendor);
      const nonNull = branches.filter((branch) => !(branch.types.size === 1 && branch.types.has('null')));
      if (nonNull.length !== 1) throw new Error(`Unsupported vendor anyOf: ${JSON.stringify(node)}`);
      const types = new Set(nonNull[0].types);
      if (nonNull.length !== branches.length) types.add('null');
      return { schema: nonNull[0].schema, types };
    }
    return { schema: node, types: typesOf(node) };
  }

  /** Our node, likewise: zod writes `.nullable()` as `anyOf [X, { type: 'null' }]`. */
  function resolveOurs(node: JsonSchema): VendorNode {
    if (Array.isArray(node['anyOf'])) {
      const branches = node['anyOf'] as JsonSchema[];
      const nonNull = branches.filter((branch) => branch['type'] !== 'null');
      const types = new Set(typesOf(nonNull[0]));
      if (nonNull.length !== branches.length) types.add('null');
      return { schema: nonNull[0], types };
    }
    return { schema: node, types: typesOf(node) };
  }


  /**
   * Every way our schema and the vendor's disagree, as readable lines. Our schema must accept
   * everything the vendor documents for the fields we read; fields we do not read are not
   * compared.
   */
  function contractGaps(ours: JsonSchema, vendor: JsonSchema, at: string): string[] {
    const our = resolveOurs(ours);
    const theirs = resolveVendor(vendor);
    const gaps: string[] = [];

    for (const type of theirs.types) {
      const accepted = our.types.has(type) || (type === 'integer' && our.types.has('number'));
      if (!accepted) gaps.push(`${at}: the vendor documents type ${type}; the adapter accepts ${[...our.types].join('|')}`);
    }
    if (our.types.size === 0 || theirs.types.size === 0) {
      gaps.push(`${at}: a side states no type (ours ${[...our.types].join('|')}, vendor ${[...theirs.types].join('|')})`);
    }

    const ourEnum = our.schema['enum'] as unknown[] | undefined;
    const theirEnum = theirs.schema['enum'] as unknown[] | undefined;
    if (ourEnum && !theirEnum) {
      gaps.push(`${at}: the adapter accepts only [${ourEnum.join(', ')}], but the vendor documents no fixed set`);
    }
    if (ourEnum && theirEnum) {
      for (const value of theirEnum.filter((entry) => entry !== null)) {
        if (!ourEnum.includes(value)) gaps.push(`${at}: the vendor documents ${JSON.stringify(value)}, which the adapter does not handle`);
      }
    }
    const ourFormat = our.schema['format'] as string | undefined;
    const theirFormat = theirs.schema['format'] as string | undefined;
    if (ourFormat && ourFormat !== theirFormat) {
      gaps.push(`${at}: the adapter reads format ${ourFormat}; the vendor documents ${theirFormat ?? 'none'}`);
    }

    if (our.types.has('object')) {
      const ourProperties = (our.schema['properties'] ?? {}) as Record<string, JsonSchema>;
      const theirProperties = (theirs.schema['properties'] ?? {}) as Record<string, JsonSchema>;
      const ourRequired = new Set((our.schema['required'] ?? []) as string[]);
      // No `required` list means the vendor requires nothing on that component.
      const theirRequired = new Set((theirs.schema['required'] ?? []) as string[]);
      for (const [name, property] of Object.entries(ourProperties)) {
        const field = `${at}.${name}`;
        if (!(name in theirProperties)) {
          gaps.push(`${field}: the adapter reads it, but the vendor documents no such field`);
          continue;
        }
        if (ourRequired.has(name) && !theirRequired.has(name) && !presentByRequest.has(field)) {
          gaps.push(`${field}: the adapter reads it as always present, but the vendor does not list it as required`);
        }
        gaps.push(...contractGaps(property, theirProperties[name], field));
      }
    }

    if (our.types.has('array')) {
      gaps.push(...contractGaps(our.schema['items'] as JsonSchema, theirs.schema['items'] as JsonSchema, `${at}[]`));
    }
    return gaps;
  }

  return contractGaps;
}
