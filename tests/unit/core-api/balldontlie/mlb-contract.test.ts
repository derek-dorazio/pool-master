import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  mlbGameListSchema,
  mlbGameSchema,
  mlbTeamListSchema,
  mlbTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/mlb-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE MLB contract, held against the vendor's own published OpenAPI document
 * (vendored at tests/fixtures/balldontlie/openapi/mlb.yml), the way nfl-contract.test.ts holds
 * the NFL's: every fixture fits the document and parses with the adapter's schemas, and every
 * field the adapter reads is documented with a type, nullability and value set it accepts. The
 * document gives no response examples for these paths, so every fixture is written to it.
 */

const spec = loadVendorSpec('mlb');

/** The document requires nothing on a team and only the state on a game, so nothing is read as required beyond that. */
const contractGaps = contractGapsAgainst(spec, new Map());

describe('BALLDONTLIE MLB fixtures', () => {
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['teams.json', '/mlb/v1/teams', mlbTeamListSchema],
    ['games-2025-postseason.json', '/mlb/v1/games', mlbGameListSchema],
    ['games-2026-postseason-partial.json', '/mlb/v1/games', mlbGameListSchema],
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('mlb', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('mlb', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('BALLDONTLIE MLB fields the adapter reads', () => {
  const pairs: Array<[component: string, adapterSchema: z.ZodType]> = [
    ['MLBGame', mlbGameSchema],
    ['MLBTeam', mlbTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ];

  it.each(pairs)('every field read from %s is documented with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('reads a team\'s league and division as any string, so a value the document does not list fails no team read', () => {
    const ours = z.toJSONSchema(mlbTeamSchema, { io: 'input' }) as { properties: Record<string, unknown> };
    expect(ours.properties['league']).toEqual({ type: 'string' });
    expect(ours.properties['division']).toEqual({ type: 'string' });
  });

  it('asks for the postseason by the games endpoint\'s documented boolean filter, and the season by seasons[]', () => {
    const parameters = spec.queryParameters('/mlb/v1/games');
    expect(parameters.find((each) => each.name === 'postseason')?.schema['type']).toBe('boolean');
    expect(parameters.map((each) => each.name)).toContain('seasons[]');
  });
});
