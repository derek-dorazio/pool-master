/**
 * The BALLDONTLIE NHL responses, as far as PoolMaster reads them (#1496 part 4).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/nhl.yml) gives them, and lets every other field through.
 * The document requires only `status_state` on a game and nothing on a team, so every other
 * field is read as optional here, and `nhl-mapping.ts` refuses a row missing one it cannot do
 * without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/nhl-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `NHLTeam`, from `/nhl/v1/teams` and on each side of a game. */
export const nhlTeamSchema = z.object({
  id: z.number().int().optional(),
  full_name: z.string().optional(),
  tricode: z.string().optional(),
  conference_name: z.string().nullable().optional(),
  division_name: z.string().nullable().optional(),
});
export type NhlTeam = z.infer<typeof nhlTeamSchema>;

export const nhlTeamListSchema = z.object({
  data: z.array(nhlTeamSchema),
  meta: balldontliePaginationSchema.optional(),
});

/** `NHLGame` from `/nhl/v1/games`. */
export const nhlGameSchema = z.object({
  id: z.number().int().optional(),
  season: z.number().int().optional(),
  postseason: z.boolean().optional(),
  game_date: z.iso.date().optional(),
  home_team: nhlTeamSchema.optional(),
  away_team: nhlTeamSchema.optional(),
  home_score: z.number().int().nullable().optional(),
  away_score: z.number().int().nullable().optional(),
  status_state: competitionStatusStateSchema,
});
export type NhlGame = z.infer<typeof nhlGameSchema>;

export const nhlGameListSchema = z.object({
  data: z.array(nhlGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
