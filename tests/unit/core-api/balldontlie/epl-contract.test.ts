import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  soccerMatchListSchema,
  soccerMatchSchema,
  soccerTeamListSchema,
  soccerTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/soccer-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE Premier League contract, held against the vendor's own published OpenAPI
 * document (vendored at tests/fixtures/balldontlie/openapi/epl.yml), the way nfl-contract.test.ts
 * holds the NFL's: every fixture fits the document and parses with the adapter's schemas, and
 * every field the adapter reads is documented, with a type, nullability and value set it
 * accepts. The document gives no response examples for these paths, so every fixture is written
 * to it.
 */

const spec = loadVendorSpec('epl');
/** The document requires nothing on a team and only the state on a match. */
const contractGaps = contractGapsAgainst(spec, new Map());

const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
  ['teams-2026.json', '/epl/v2/teams', soccerTeamListSchema],
  ['matches-2026.json', '/epl/v2/matches', soccerMatchListSchema],
];

describe('BALLDONTLIE Premier League contract', () => {
  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('epl', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('epl', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each([
    ['SoccerMatch', soccerMatchSchema],
    ['SoccerTeam', soccerTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ])('documents every field read from %s with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a match\'s round number read as never null, since the vendor documents it nullable', () => {
    const strict = z.toJSONSchema(z.object({ round_number: z.number().int().optional() })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('SoccerMatch'), 'SoccerMatch')).toEqual([
      expect.stringContaining('SoccerMatch.round_number'),
    ]);
  });

  it('asks for a season\'s matches and teams with the season parameter each endpoint documents, which offers no matchweek filter', () => {
    expect(spec.queryParameters('/epl/v2/matches').map((each) => each.name)).toEqual(expect.arrayContaining(['season', 'cursor', 'per_page']));
    expect(spec.queryParameters('/epl/v2/matches').map((each) => each.name)).not.toContain('round_number');
    expect(spec.queryParameters('/epl/v2/teams').map((each) => each.name)).toEqual(['season']);
  });
});
