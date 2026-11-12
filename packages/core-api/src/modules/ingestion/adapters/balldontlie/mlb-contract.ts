/**
 * The BALLDONTLIE MLB responses, as far as PoolMaster reads them (#1496).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/mlb.yml) gives them, and lets every other field through.
 * The document requires only `status_state` on a game and nothing on a team, so every other
 * field is read as optional here, and `mlb-mapping.ts` refuses a row missing one it cannot do
 * without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/mlb-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `MLBTeam`, from `/mlb/v1/teams` and on each side of a game. */
export const mlbTeamSchema = z.object({
  id: z.number().int().optional(),
  /** The team's full name ("Los Angeles Dodgers"); `name` is the nickname alone. */
  display_name: z.string().optional(),
  abbreviation: z.string().optional(),
  /**
   * Plain strings, though the document lists `American` and `National`: they only describe the
   * team, so a value the document does not list (a blank one, on a team that is no MLB club)
   * must not fail every team's read. `mlb-mapping.ts` keeps the teams of the two leagues.
   */
  league: z.string().optional(),
  division: z.string().optional(),
});

/** The two leagues an MLB club plays in. */
export const MLB_LEAGUES: readonly string[] = ['American', 'National'];
export type MlbTeam = z.infer<typeof mlbTeamSchema>;

export const mlbTeamListSchema = z.object({
  data: z.array(mlbTeamSchema),
});

/** One side's line on a game: its runs are its score. */
const mlbTeamDataSchema = z.object({
  runs: z.number().int().optional(),
});

/** `MLBGame` from `/mlb/v1/games`. */
export const mlbGameSchema = z.object({
  id: z.number().int().optional(),
  season: z.number().int().optional(),
  postseason: z.boolean().optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  home_team: mlbTeamSchema.optional(),
  away_team: mlbTeamSchema.optional(),
  home_team_data: mlbTeamDataSchema.optional(),
  away_team_data: mlbTeamDataSchema.optional(),
  status_state: competitionStatusStateSchema,
});
export type MlbGame = z.infer<typeof mlbGameSchema>;

export const mlbGameListSchema = z.object({
  data: z.array(mlbGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
