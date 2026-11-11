/**
 * The BALLDONTLIE NCAA men's basketball responses, as far as PoolMaster reads them (#1496).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/ncaab.yml) gives them, and lets every other field through.
 * The document requires only `status_state` on a bracket game and nothing on a team, so every
 * other field is read as optional here, and `ncaab-mapping.ts` refuses a row missing one it
 * cannot do without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/ncaab-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/**
 * The tournament's rounds as `/ncaab/v1/bracket` numbers them. The First Four is round 1, so
 * the round of 64 is the first round of PoolMaster's six-round bracket.
 */
export const NcaabBracketRound = {
  FIRST_FOUR: 1,
  ROUND_OF_64: 2,
  CHAMPIONSHIP: 7,
} as const;

/** `NCAABTeam`, from `/ncaab/v1/teams`. */
export const ncaabTeamSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().optional(),
  full_name: z.string().optional(),
  abbreviation: z.string().nullable().optional(),
  conference_id: z.number().int().nullable().optional(),
});
export type NcaabTeam = z.infer<typeof ncaabTeamSchema>;

export const ncaabTeamListSchema = z.object({
  data: z.array(ncaabTeamSchema),
});

/** `NCAABBracketTeam`: one side of a bracket game, null id while the side is still to be decided. */
export const ncaabBracketTeamSchema = z.object({
  id: z.number().int().nullable().optional(),
  name: z.string().optional(),
  full_name: z.string().nullable().optional(),
  seed: z.string().nullable().optional(),
  score: z.number().int().nullable().optional(),
});
export type NcaabBracketTeam = z.infer<typeof ncaabBracketTeamSchema>;

/** `NCAABBracket` from `/ncaab/v1/bracket`: one tournament game, with or without its teams yet. */
export const ncaabBracketGameSchema = z.object({
  game_id: z.number().int().nullable().optional(),
  season: z.number().int().optional(),
  round: z.number().int().optional(),
  region_label: z.string().nullable().optional(),
  date: z.iso.datetime({ offset: true }).nullable().optional(),
  status_state: competitionStatusStateSchema,
  home_team: ncaabBracketTeamSchema.nullable().optional(),
  away_team: ncaabBracketTeamSchema.nullable().optional(),
});
export type NcaabBracketGame = z.infer<typeof ncaabBracketGameSchema>;

export const ncaabBracketListSchema = z.object({
  data: z.array(ncaabBracketGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
