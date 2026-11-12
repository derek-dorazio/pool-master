import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  NBA_PLAYOFFS_SEASON_TYPE,
  nbaGameListSchema,
  nbaGameSchema,
  nbaPlayerListSchema,
  nbaPlayerSchema,
  nbaStatsListSchema,
  nbaStatsSchema,
  nbaTeamListSchema,
  nbaTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nba-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE NBA contract, held against the vendor's own published OpenAPI document
 * (vendored at tests/fixtures/balldontlie/openapi/nba.yml), the way nfl-contract.test.ts holds
 * the NFL's: every fixture fits the document and parses with the adapter's schemas, and every
 * field the adapter reads is documented with a type, nullability and value set it accepts.
 * The document gives no response examples for these paths, so every fixture is written to it.
 */

const spec = loadVendorSpec('nba');

/** The document requires nothing on a team and only the state on a game, so nothing is read as required beyond that. */
const contractGaps = contractGapsAgainst(spec, new Map());

describe('BALLDONTLIE NBA fixtures', () => {
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['teams.json', '/nba/v1/teams', nbaTeamListSchema],
    ['games-2024-finals.json', '/nba/v1/games', nbaGameListSchema],
    ['games-2025-first-round-partial.json', '/nba/v1/games', nbaGameListSchema],
    ['games-2023-playoffs.json', '/nba/v1/games', nbaGameListSchema],
    ['stats-2023-finals.json', '/nba/v1/stats', nbaStatsListSchema],
    ['players-active-finals-teams.json', '/nba/v1/players/active', nbaPlayerListSchema],
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('nba', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('nba', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('BALLDONTLIE NBA fields the adapter reads', () => {
  const pairs: Array<[component: string, adapterSchema: z.ZodType]> = [
    ['NBAGame', nbaGameSchema],
    ['NBATeam', nbaTeamSchema],
    ['NBAPlayer', nbaPlayerSchema],
    ['NBAStats', nbaStatsSchema],
    ['Pagination', balldontliePaginationSchema],
  ];

  it.each(pairs)('every field read from %s is documented with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a tip-off read as always set, since the vendor leaves it null until the league sets it', () => {
    const strict = z.toJSONSchema(z.object({ datetime: z.iso.datetime({ offset: true }).optional() }), { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('NBAGame'), 'NBAGame').join('\n')).toContain('NBAGame.datetime');
  });

  it('asks for a round\'s box scores by game and its stars by team, as the stats and active players endpoints document', () => {
    expect(spec.queryParameters('/nba/v1/stats').map((each) => each.name)).toContain('game_ids[]');
    expect(spec.queryParameters('/nba/v1/players/active').map((each) => each.name)).toContain('team_ids[]');
  });

  it('asks for the playoffs by a season type the games endpoint documents', () => {
    const parameter = spec.queryParameters('/nba/v1/games').find((each) => each.name === 'season_type');
    expect(parameter?.schema['enum']).toContain(NBA_PLAYOFFS_SEASON_TYPE);
  });
});
