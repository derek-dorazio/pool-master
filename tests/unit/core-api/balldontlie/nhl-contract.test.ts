import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  nhlGameListSchema,
  nhlGameSchema,
  nhlTeamListSchema,
  nhlTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nhl-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE NHL contract, held against the vendor's own published OpenAPI document
 * (vendored at tests/fixtures/balldontlie/openapi/nhl.yml), the way nfl-contract.test.ts holds
 * the NFL's: every fixture fits the document and parses with the adapter's schemas, and every
 * field the adapter reads is documented with a type, nullability and value set it accepts. The
 * document gives no response examples for these paths, so every fixture is written to it.
 */

const spec = loadVendorSpec('nhl');

/** The document requires nothing on a team and only the state on a game, so nothing is read as required beyond that. */
const contractGaps = contractGapsAgainst(spec, new Map());

describe('BALLDONTLIE NHL fixtures', () => {
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['teams.json', '/nhl/v1/teams', nhlTeamListSchema],
    ['games-2024-postseason.json', '/nhl/v1/games', nhlGameListSchema],
    ['games-2025-postseason-partial.json', '/nhl/v1/games', nhlGameListSchema],
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('nhl', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('nhl', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('BALLDONTLIE NHL fields the adapter reads', () => {
  const pairs: Array<[component: string, adapterSchema: z.ZodType]> = [
    ['NHLGame', nhlGameSchema],
    ['NHLTeam', nhlTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ];

  it.each(pairs)('every field read from %s is documented with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a score read as never null, since the vendor sends null before a game starts', () => {
    const strict = z.toJSONSchema(z.object({ home_score: z.number().int().optional() })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('NHLGame'), 'NHLGame').join('\n')).toMatch(/NHLGame\.home_score/);
  });

  it('asks for the postseason by the games endpoint\'s documented boolean filter', () => {
    const parameter = spec.queryParameters('/nhl/v1/games').find((each) => each.name === 'postseason');
    expect(parameter?.schema['type']).toBe('boolean');
  });
});
