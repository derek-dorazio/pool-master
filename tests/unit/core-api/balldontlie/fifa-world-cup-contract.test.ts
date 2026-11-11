import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  fifaGroupSchema,
  fifaMatchListSchema,
  fifaMatchSchema,
  fifaSeasonSchema,
  fifaTeamListSchema,
  fifaTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/fifa-world-cup-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE FIFA World Cup contract, held against the vendor's own published OpenAPI
 * document (vendored at tests/fixtures/balldontlie/openapi/fifa.yml), the way
 * nfl-contract.test.ts holds the NFL's: every fixture fits the document and parses with the
 * adapter's schemas, and every field the adapter reads is documented, with a type, nullability
 * and value set it accepts. The document gives no response examples for these paths, so every
 * fixture is written to it.
 */

const spec = loadVendorSpec('fifa');
/** The document requires nothing on a team and only the state on a match. */
const contractGaps = contractGapsAgainst(spec, new Map());

const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
  ['teams.json', '/fifa/worldcup/v1/teams', fifaTeamListSchema],
  ['matches-2022.json', '/fifa/worldcup/v1/matches', fifaMatchListSchema],
  ['matches-2026-partial.json', '/fifa/worldcup/v1/matches', fifaMatchListSchema],
];

describe('BALLDONTLIE FIFA World Cup contract', () => {
  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('fifa', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('fifa', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each([
    ['FIFAMatch', fifaMatchSchema],
    ['FIFATeam', fifaTeamSchema],
    ['FIFASeason', fifaSeasonSchema],
    ['FIFAGroup', fifaGroupSchema],
    ['Pagination', balldontliePaginationSchema],
  ])('documents every field read from %s with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a knockout side or a shoot-out score read as never null, since the vendor sends null until it is decided', () => {
    const strict = z.toJSONSchema(z.object({
      home_team: fifaTeamSchema.optional(),
      home_score_penalties: z.number().int().optional(),
    })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('FIFAMatch'), 'FIFAMatch')).toEqual([
      expect.stringContaining('FIFAMatch.home_team'),
      expect.stringContaining('FIFAMatch.home_score_penalties'),
    ]);
  });

  it('asks for an edition\'s matches by the seasons parameter the endpoint documents, which names the editions it serves', () => {
    const seasons = spec.queryParameters('/fifa/worldcup/v1/matches').find((each) => each.name === 'seasons[]');
    expect(seasons?.schema).toMatchObject({ type: 'array', items: { enum: [2018, 2022, 2026] } });
    expect(spec.queryParameters('/fifa/worldcup/v1/matches').map((each) => each.name)).toEqual(expect.arrayContaining(['cursor', 'per_page']));
  });
});
