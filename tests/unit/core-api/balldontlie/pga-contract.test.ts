import { z } from 'zod';
import {
  pgaPaginationSchema,
  pgaPlayerListSchema,
  pgaPlayerSchema,
  pgaPlayerSummarySchema,
  pgaResultRoundSchema,
  pgaTournamentCompetitorListSchema,
  pgaTournamentCompetitorSchema,
  pgaTournamentCourseSchema,
  pgaTournamentListSchema,
  pgaTournamentResultListSchema,
  pgaTournamentResultSchema,
  pgaTournamentRoundSchema,
  pgaTournamentSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/pga-contract';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE PGA TOUR contract, held three ways against the vendor's own published
 * OpenAPI document (vendored at tests/fixtures/balldontlie/openapi/pga.yml):
 *
 * 1. every fixture the adapter tests read fits the document's response schema, so no test
 *    passes on data the vendor would never send;
 * 2. every fixture parses with the adapter's own schemas, so the adapter reads what the
 *    document describes;
 * 3. every field the adapter reads is in the document with a type and nullability the adapter
 *    accepts, and every enum value the document lists is one the adapter handles.
 *
 * When the real API is reachable, `npm run balldontlie:contract-check` runs the same
 * schemas against live responses and diffs the live document against this copy.
 */

const spec = loadVendorSpec('pga');

type JsonSchema = Record<string, unknown>;

describe('BALLDONTLIE PGA fixtures', () => {
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['doc-example-tournaments.json', '/pga/v2/tournaments', pgaTournamentListSchema],
    ['tournaments-2026.json', '/pga/v2/tournaments', pgaTournamentListSchema],
    ['doc-example-tournament-competitors.json', '/pga/v2/tournament_competitors', pgaTournamentCompetitorListSchema],
    ['tournament-competitors-41.json', '/pga/v2/tournament_competitors', pgaTournamentCompetitorListSchema],
    ['doc-example-tournament-results.json', '/pga/v2/tournament_results', pgaTournamentResultListSchema],
    ['tournament-results-41-live.json', '/pga/v2/tournament_results', pgaTournamentResultListSchema],
    ['tournament-results-40-final.json', '/pga/v2/tournament_results', pgaTournamentResultListSchema],
    ['players.json', '/pga/v1/players', pgaPlayerListSchema],
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('pga', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('pga', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('the vendor\'s documented examples are served verbatim, so a changed example shows up as a changed fixture', () => {
    const exampleFor = (path: string) => {
      const operation = spec.resolveRef(`#/paths/${path.replace(/\//g, '~1')}`)['get'] as JsonSchema;
      const responses = operation['responses'] as Record<string, JsonSchema>;
      const content = responses['200']['content'] as Record<string, JsonSchema>;
      return content['application/json']['example'];
    };
    expect(readBalldontlieFixture('pga', 'doc-example-tournaments.json')).toEqual(exampleFor('/pga/v2/tournaments'));
    expect(readBalldontlieFixture('pga', 'doc-example-tournament-competitors.json')).toEqual(exampleFor('/pga/v2/tournament_competitors'));
    expect(readBalldontlieFixture('pga', 'doc-example-tournament-results.json')).toEqual(exampleFor('/pga/v2/tournament_results'));
  });
});

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
 * Fields we read as always present that the vendor does not list as required, each with why
 * that is safe. Nothing else may be read as required unless the document requires it.
 */
const PRESENT_BY_REQUEST: ReadonlyMap<string, string> = new Map([
  ['PGATournamentV2.format_type', 'present when include_format=true, which every adapter read of /pga/v2/tournaments sends'],
  ['PGAPlayer.id', 'a player record with no id is not a player; every other player shape requires it'],
  ['PGAPlayer.display_name', 'the one name a golfer is shown by; PGAPlayerSummaryV2 requires it for the same golfers'],
]);

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
      if (ourRequired.has(name) && !theirRequired.has(name) && !PRESENT_BY_REQUEST.has(field)) {
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

describe('BALLDONTLIE PGA fields the adapter reads', () => {
  const pairs: Array<[component: string, adapterSchema: z.ZodType]> = [
    ['PGATournamentV2', pgaTournamentSchema],
    ['PGATournamentRound', pgaTournamentRoundSchema],
    ['PGATournamentCourse', pgaTournamentCourseSchema],
    ['PGAPlayerSummaryV2', pgaPlayerSummarySchema],
    ['PGATournamentCompetitorV2', pgaTournamentCompetitorSchema],
    ['PGAPlayer', pgaPlayerSchema],
    ['PGATournamentResultV2', pgaTournamentResultSchema],
    ['PGAResultRoundV2', pgaResultRoundSchema],
    ['Pagination', pgaPaginationSchema],
  ];

  it.each(pairs)('every field read from %s is documented with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as JsonSchema;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a field the vendor makes nullable that the adapter reads as never null', () => {
    const strict = z.toJSONSchema(z.object({ end_date: z.iso.date() })) as JsonSchema;
    expect(contractGaps(strict, spec.component('PGATournamentV2'), 'PGATournamentV2')).toEqual([
      'PGATournamentV2.end_date: the vendor documents type null; the adapter accepts string',
    ]);
  });

  it('flags a field the adapter reads that the vendor does not document', () => {
    const invented = z.toJSONSchema(z.object({ tour_name: z.string() })) as JsonSchema;
    expect(contractGaps(invented, spec.component('PGATournamentV2'), 'PGATournamentV2')).toEqual([
      'PGATournamentV2.tour_name: the adapter reads it, but the vendor documents no such field',
    ]);
  });

  it('flags a documented enum value the adapter does not handle', () => {
    const partial = z.toJSONSchema(z.object({ type: z.enum(['PLAYER', 'TEAM']) })) as JsonSchema;
    expect(contractGaps(partial, spec.component('PGATournamentCompetitorV2'), 'PGATournamentCompetitorV2')).toEqual([
      'PGATournamentCompetitorV2.type: the vendor documents "CUP_TEAM", which the adapter does not handle',
      'PGATournamentCompetitorV2.type: the vendor documents "PAIRING", which the adapter does not handle',
    ]);
  });

  it('flags a fixed value set the adapter imposes on a field the vendor leaves free', () => {
    const narrowed = z.toJSONSchema(z.object({ position: z.enum(['1', 'CUT']).nullable() })) as JsonSchema;
    expect(contractGaps(narrowed, spec.component('PGATournamentResultV2'), 'PGATournamentResultV2')).toEqual([
      'PGATournamentResultV2.position: the adapter accepts only [1, CUT], but the vendor documents no fixed set',
    ]);
  });

  it('flags a field read as always present that the vendor does not require', () => {
    const optionalElsewhere = z.toJSONSchema(z.object({ owgr: z.number().int().nullable() })) as JsonSchema;
    // PGAPlayer declares no required list at all, so the vendor requires none of its fields.
    expect(contractGaps(optionalElsewhere, spec.component('PGAPlayer'), 'PGAPlayer')).toEqual([
      'PGAPlayer.owgr: the adapter reads it as always present, but the vendor does not list it as required',
    ]);
    const shape = { ...spec.component('PGATournamentV2'), required: ['id'] };
    const ours = z.toJSONSchema(z.object({ season: z.number().int() })) as JsonSchema;
    expect(contractGaps(ours, shape, 'PGATournamentV2')).toEqual([
      'PGATournamentV2.season: the adapter reads it as always present, but the vendor does not list it as required',
    ]);
  });

  it('flags a date read in a format the vendor does not document', () => {
    const asDateTime = z.toJSONSchema(z.object({ start_date: z.iso.datetime() })) as JsonSchema;
    expect(contractGaps(asDateTime, spec.component('PGATournamentV2'), 'PGATournamentV2')).toEqual([
      'PGATournamentV2.start_date: the adapter reads format date-time; the vendor documents date',
    ]);
  });
});
