import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  nflGameListSchema,
  nflGameSchema,
  NflSeasonType,
  nflTeamListSchema,
  nflTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nfl-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE NFL contract, held against the vendor's own published OpenAPI document
 * (vendored at tests/fixtures/balldontlie/openapi/nfl.yml), the way pga-contract.test.ts holds
 * the PGA TOUR's: every fixture fits the document and parses with the adapter's schemas, and
 * every field the adapter reads is documented with a type, nullability and value set it accepts.
 * The document gives no response examples for these paths, so every fixture is written to it.
 */

const spec = loadVendorSpec('nfl');

/** The document requires nothing on a team and only the state on a game, so nothing is read as required beyond that. */
const contractGaps = contractGapsAgainst(spec, new Map());

describe('BALLDONTLIE NFL fixtures', () => {
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['teams.json', '/nfl/v1/teams', nflTeamListSchema],
    ['games-2026-week-12.json', '/nfl/v1/games', nflGameListSchema],
    ['games-2025-postseason.json', '/nfl/v1/games', nflGameListSchema],
    ['games-2026-postseason-partial.json', '/nfl/v1/games', nflGameListSchema],
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('nfl', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('nfl', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('BALLDONTLIE NFL fields the adapter reads', () => {
  const pairs: Array<[component: string, adapterSchema: z.ZodType]> = [
    ['NFLGame', nflGameSchema],
    ['NFLTeam', nflTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ];

  it.each(pairs)('every field read from %s is documented with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('reads a game\'s state through the vendor\'s described reference to its state enum', () => {
    const partial = z.toJSONSchema(z.object({ status_state: z.enum(['scheduled', 'final']) })) as Record<string, unknown>;
    expect(contractGaps(partial, spec.component('NFLGame'), 'NFLGame')).toContain(
      'NFLGame.status_state: the vendor documents "in_progress", which the adapter does not handle',
    );
  });

  it('flags a game field read as always present, since the vendor requires only the state and the write time', () => {
    const strict = z.toJSONSchema(z.object({ id: z.number().int() })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('NFLGame'), 'NFLGame')).toEqual([
      'NFLGame.id: the adapter reads it as always present, but the vendor does not list it as required',
    ]);
  });

  it('asks only for the regular season and the postseason, values the games endpoint documents', () => {
    const parameter = spec.queryParameters('/nfl/v1/games').find((each) => each.name === 'season_types[]');
    const documented = (parameter?.schema['items'] as { enum: number[] }).enum;
    expect(documented).toEqual(expect.arrayContaining(Object.values(NflSeasonType)));
  });
});
