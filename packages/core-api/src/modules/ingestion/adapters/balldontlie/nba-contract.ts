/**
 * The BALLDONTLIE NBA responses, as far as PoolMaster reads them (#1496).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/nba.yml) gives them, and lets every other field through.
 * The document requires only `status_state` on a game and nothing on a team, so every other
 * field is read as optional here, and `nba-mapping.ts` refuses a row missing one it cannot do
 * without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/nba-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/**
 * The `season_type` the playoffs are read with. The play-in tournament is its own type
 * (`playin`): its games decide who enters the bracket and are no match of it.
 */
export const NBA_PLAYOFFS_SEASON_TYPE = 'playoffs';

/** `NBATeam`, from `/nba/v1/teams` and on each side of a game. */
export const nbaTeamSchema = z.object({
  id: z.number().int().optional(),
  conference: z.enum(['East', 'West']).optional(),
  division: z.enum(['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest']).optional(),
  full_name: z.string().optional(),
  abbreviation: z.string().optional(),
});
export type NbaTeam = z.infer<typeof nbaTeamSchema>;

export const nbaTeamListSchema = z.object({
  data: z.array(nbaTeamSchema),
});

/** `NBAGame` from `/nba/v1/games`. */
export const nbaGameSchema = z.object({
  id: z.number().int().optional(),
  /** The game's day; `datetime`, its tip-off, is null until the league sets it. */
  date: z.iso.date().optional(),
  datetime: z.iso.datetime({ offset: true }).nullable().optional(),
  season: z.number().int().optional(),
  postseason: z.boolean().optional(),
  status_state: competitionStatusStateSchema,
  home_team_score: z.number().int().optional(),
  visitor_team_score: z.number().int().optional(),
  home_team: nbaTeamSchema.optional(),
  visitor_team: nbaTeamSchema.optional(),
});
export type NbaGame = z.infer<typeof nbaGameSchema>;

export const nbaGameListSchema = z.object({
  data: z.array(nbaGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
