import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  ncaafGameListSchema,
  ncaafGameSchema,
  ncaafTeamListSchema,
  ncaafTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaaf-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE college football contract, held against the vendor's own published OpenAPI
 * document (vendored at tests/fixtures/balldontlie/openapi/ncaaf.yml), the way
 * nfl-contract.test.ts holds the NFL's: every fixture fits the document and parses with the
 * adapter's schemas, and every field the adapter reads is documented, with a type, nullability
 * and value set it accepts. The document gives no response examples for these paths, so every
 * fixture is written to it.
 */

const spec = loadVendorSpec('ncaaf');
/** The document requires nothing on a team and only the state on a game. */
const contractGaps = contractGapsAgainst(spec, new Map());

const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
  ['teams.json', '/ncaaf/v1/teams', ncaafTeamListSchema],
  ['games-2025-season.json', '/ncaaf/v1/games', ncaafGameListSchema],
  ['games-2026-season-partial.json', '/ncaaf/v1/games', ncaafGameListSchema],
];

describe('BALLDONTLIE college football contract', () => {
  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('ncaaf', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('ncaaf', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each([
    ['NCAAFGame', ncaafGameSchema],
    ['NCAAFTeam', ncaafTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ])('documents every field read from %s with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a game field read as always present, since the vendor requires only the state', () => {
    const strict = z.toJSONSchema(z.object({ date: z.string() })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('NCAAFGame'), 'NCAAFGame')).toEqual([
      'NCAAFGame.date: the adapter reads it as always present, but the vendor does not list it as required',
    ]);
  });

  it('documents no postseason flag on a game, which is why the playoff is read by its date window', () => {
    expect(Object.keys(spec.component('NCAAFGame')['properties'] as Record<string, unknown>)).not.toContain('postseason');
  });

  it('asks for the window\'s games by the start_date and end_date parameters the games endpoint documents, as dates', () => {
    const parameters = spec.queryParameters('/ncaaf/v1/games');
    expect(parameters.find((each) => each.name === 'start_date')?.schema).toMatchObject({ type: 'string', format: 'date' });
    expect(parameters.find((each) => each.name === 'end_date')?.schema).toMatchObject({ type: 'string', format: 'date' });
    expect(parameters.map((each) => each.name)).toEqual(expect.arrayContaining(['cursor', 'per_page']));
  });
});
