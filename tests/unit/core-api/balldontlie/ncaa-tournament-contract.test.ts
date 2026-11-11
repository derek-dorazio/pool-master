import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  ncaaBracketGameSchema,
  ncaaBracketListSchema,
  ncaaBracketTeamSchema,
  ncaaTeamListSchema,
  ncaaTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaa-tournament-contract';
import { NCAA_MEN, NCAA_WOMEN, type NcaaTournamentLeague } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaa-tournament-mapping';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE NCAA tournament contract, men's and women's, held against the vendor's own
 * published OpenAPI documents (vendored at tests/fixtures/balldontlie/openapi/ncaab.yml and
 * ncaaw.yml), the way nfl-contract.test.ts holds the NFL's: every fixture fits its document and
 * parses with the adapter's schemas, and every field the adapter reads is documented in both,
 * with a type, nullability and value set it accepts. The documents give no response examples for
 * these paths, so every fixture is written to them.
 */

const leagues: Array<[name: string, league: NcaaTournamentLeague, prefix: 'NCAAB' | 'NCAAW', brackets: string[]]> = [
  ['men\'s', NCAA_MEN, 'NCAAB', ['bracket-2025.json', 'bracket-2026-partial.json']],
  ['women\'s', NCAA_WOMEN, 'NCAAW', ['bracket-2025.json']],
];

describe.each(leagues)('BALLDONTLIE NCAA %s tournament', (_name, league, prefix, brackets) => {
  const spec = loadVendorSpec(league.key);
  /** The documents require nothing on a team and only the state on a bracket game. */
  const contractGaps = contractGapsAgainst(spec, new Map());
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['teams.json', `/${league.key}/v1/teams`, ncaaTeamListSchema],
    ...brackets.map((file): [string, string, z.ZodType] => [file, `/${league.key}/v1/bracket`, ncaaBracketListSchema]),
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture(league.key, file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture(league.key, file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each([
    [`${prefix}Bracket`, ncaaBracketGameSchema],
    [`${prefix}BracketTeam`, ncaaBracketTeamSchema],
    [`${prefix}Team`, ncaaTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ])('documents every field read from %s with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a bracket side read as never null, since the vendor sends null while a side is to be decided', () => {
    const strict = z.toJSONSchema(z.object({ id: z.number().int().optional() })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component(`${prefix}BracketTeam`), `${prefix}BracketTeam`)).toEqual([
      expect.stringContaining(`${prefix}BracketTeam.id`),
    ]);
  });

  it('numbers the First Four and the championship as the league\'s bracket endpoint documents them', () => {
    const round = spec.queryParameters(`/${league.key}/v1/bracket`).find((each) => each.name === 'round_id');
    expect(round?.schema).toMatchObject({ minimum: league.firstFourRound, maximum: league.championshipRound });
  });

  it('asks for a season\'s bracket with the one query parameter the endpoint documents for it', () => {
    expect(spec.queryParameters(`/${league.key}/v1/bracket`).map((each) => each.name)).toContain('season');
  });
});
