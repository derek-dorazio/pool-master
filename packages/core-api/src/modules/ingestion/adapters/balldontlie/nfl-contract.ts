/**
 * The BALLDONTLIE NFL responses, as far as PoolMaster reads them (#1496).
 *
 * Built the way `pga-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/nfl.yml) gives them, and lets every other field through.
 * The document requires only `status_state` and `updated_at` on a game and nothing on a team,
 * so every other field is read as optional here, and `nfl-mapping.ts` refuses a row missing one
 * it cannot do without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/nfl-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** The `season_types[]` values of `/nfl/v1/games`: 1 is the preseason, which no event covers. */
export const NflSeasonType = {
  REGULAR_SEASON: 2,
  POSTSEASON: 3,
} as const;
export type NflSeasonType = (typeof NflSeasonType)[keyof typeof NflSeasonType];

/** `NFLTeam`, from `/nfl/v1/teams` and on each side of a game. */
export const nflTeamSchema = z.object({
  id: z.number().int().optional(),
  conference: z.enum(['AFC', 'NFC']).optional(),
  division: z.enum(['NORTH', 'SOUTH', 'EAST', 'WEST']).optional(),
  location: z.string().optional(),
  name: z.string().optional(),
  full_name: z.string().optional(),
  abbreviation: z.string().optional(),
});
export type NflTeam = z.infer<typeof nflTeamSchema>;

export const nflTeamListSchema = z.object({
  data: z.array(nflTeamSchema),
});

/** `NFLGame` from `/nfl/v1/games`. */
export const nflGameSchema = z.object({
  id: z.number().int().optional(),
  home_team: nflTeamSchema.optional(),
  visitor_team: nflTeamSchema.optional(),
  week: z.number().int().optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  season: z.number().int().optional(),
  postseason: z.boolean().optional(),
  status_state: competitionStatusStateSchema,
  home_team_score: z.number().int().optional(),
  visitor_team_score: z.number().int().optional(),
});
export type NflGame = z.infer<typeof nflGameSchema>;

export const nflGameListSchema = z.object({
  data: z.array(nflGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
