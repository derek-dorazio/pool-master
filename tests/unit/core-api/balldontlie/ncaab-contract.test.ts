import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  NcaabBracketRound,
  ncaabBracketGameSchema,
  ncaabBracketListSchema,
  ncaabBracketTeamSchema,
  ncaabTeamListSchema,
  ncaabTeamSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaab-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE NCAA men's basketball contract, held against the vendor's own published
 * OpenAPI document (vendored at tests/fixtures/balldontlie/openapi/ncaab.yml), the way
 * nfl-contract.test.ts holds the NFL's: every fixture fits the document and parses with the
 * adapter's schemas, and every field the adapter reads is documented with a type, nullability and
 * value set it accepts. The document gives no response examples for these paths, so every
 * fixture is written to it.
 */

const spec = loadVendorSpec('ncaab');

/** The document requires nothing on a team and only the state on a bracket game. */
const contractGaps = contractGapsAgainst(spec, new Map());

describe('BALLDONTLIE NCAAB fixtures', () => {
  const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
    ['teams.json', '/ncaab/v1/teams', ncaabTeamListSchema],
    ['bracket-2025.json', '/ncaab/v1/bracket', ncaabBracketListSchema],
    ['bracket-2026-partial.json', '/ncaab/v1/bracket', ncaabBracketListSchema],
  ];

  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('ncaab', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('ncaab', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('BALLDONTLIE NCAAB fields the adapter reads', () => {
  const pairs: Array<[component: string, adapterSchema: z.ZodType]> = [
    ['NCAABBracket', ncaabBracketGameSchema],
    ['NCAABBracketTeam', ncaabBracketTeamSchema],
    ['NCAABTeam', ncaabTeamSchema],
    ['Pagination', balldontliePaginationSchema],
  ];

  it.each(pairs)('every field read from %s is documented with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a bracket side read as never null, since the vendor sends null while a side is to be decided', () => {
    const strict = z.toJSONSchema(z.object({ id: z.number().int().optional() })) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('NCAABBracketTeam'), 'NCAABBracketTeam')).toEqual([
      expect.stringContaining('NCAABBracketTeam.id'),
    ]);
  });

  it('numbers the First Four, the round of 64 and the championship as the bracket endpoint documents them', () => {
    const round = spec.queryParameters('/ncaab/v1/bracket').find((each) => each.name === 'round_id');
    expect(round?.schema).toMatchObject({ minimum: NcaabBracketRound.FIRST_FOUR, maximum: NcaabBracketRound.CHAMPIONSHIP });
    expect((spec.component('NCAABBracket')['properties'] as Record<string, { description: string }>)['round'].description)
      .toContain(`${String(NcaabBracketRound.ROUND_OF_64)}=Round of 64`);
  });

  it('asks for a season\'s bracket with the one query parameter the endpoint documents for it', () => {
    expect(spec.queryParameters('/ncaab/v1/bracket').map((each) => each.name)).toContain('season');
  });
});
