import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  wnbaGameListSchema,
  wnbaGameSchema,
  wnbaTeamListSchema,
  wnbaTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/wnba-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE WNBA contract, held against the vendor's own published OpenAPI document
 * (vendored at tests/fixtures/balldontlie/openapi/wnba.yml), the way nfl-contract.test.ts holds
 * the NFL's: every fixture fits the document and parses with the adapter's schemas, and every
 * field the adapter reads is documented with a type, nullability and value set it accepts. The
 * document gives no response examples for these paths, so every fixture is written to it.
 */

const spec = loadVendorSpec('wnba');

/** The document requires nothing on a team and only the state on a game, so nothing is read as required beyond that. */
const contractGaps = contractGapsAgainst(spec, new Map());

describe('BALLDONTLIE WNBA fixtures', () => {
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['teams.json', '/wnba/v1/teams', wnbaTeamListSchema],
    ['games-2025.json', '/wnba/v1/games', wnbaGameListSchema],
    ['games-2026-partial.json', '/wnba/v1/games', wnbaGameListSchema],
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('wnba', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('wnba', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('BALLDONTLIE WNBA fields the adapter reads', () => {
  const pairs: Array<[component: string, adapterSchema: z.ZodType]> = [
    ['WNBAGame', wnbaGameSchema],
    ['WNBATeam', wnbaTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ];

  it.each(pairs)('every field read from %s is documented with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a game field read as always present, since the vendor requires only the state', () => {
    const strict = z.toJSONSchema(z.object({ postseason: z.boolean() })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('WNBAGame'), 'WNBAGame')).toEqual([
      'WNBAGame.postseason: the adapter reads it as always present, but the vendor does not list it as required',
    ]);
  });

  it('reads the games by season alone, since the endpoint documents no postseason filter and no season type values', () => {
    const parameters = spec.queryParameters('/wnba/v1/games');
    expect(parameters.map((each) => each.name)).toContain('seasons[]');
    expect(parameters.map((each) => each.name)).not.toContain('postseason');
    expect(parameters.find((each) => each.name === 'season_type')?.schema['enum']).toBeUndefined();
  });
});
