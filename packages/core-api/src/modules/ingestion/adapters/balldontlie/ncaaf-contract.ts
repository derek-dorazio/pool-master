/**
 * The BALLDONTLIE college football responses, as far as PoolMaster reads them (#1496): games and
 * teams (`/ncaaf/v1`), for the College Football Playoff.
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/ncaaf.yml) gives them, and lets every other field through.
 * The document requires only `status_state` on a game and nothing on a team, so every other
 * field is read as optional here, and `ncaaf-mapping.ts` refuses a row missing one it cannot do
 * without, with a `BalldontlieContractError` naming it.
 *
 * The document gives a game no postseason flag, bowl name or venue, which is why the playoff's
 * games are found by date (`CFP_LEAGUE` in `ncaaf-mapping.ts`).
 *
 * `tests/unit/core-api/balldontlie/ncaaf-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `NCAAFTeam`, from `/ncaaf/v1/teams` and on each side of a game. */
export const ncaafTeamSchema = z.object({
  id: z.number().int().optional(),
  conference: z.string().optional(),
  full_name: z.string().optional(),
  abbreviation: z.string().optional(),
});
export type NcaafTeam = z.infer<typeof ncaafTeamSchema>;

export const ncaafTeamListSchema = z.object({
  data: z.array(ncaafTeamSchema),
});

/** `NCAAFGame` from `/ncaaf/v1/games`. */
export const ncaafGameSchema = z.object({
  id: z.number().int().optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  season: z.number().int().optional(),
  status_state: competitionStatusStateSchema,
  home_team: ncaafTeamSchema.optional(),
  visitor_team: ncaafTeamSchema.optional(),
  home_score: z.number().int().optional(),
  away_score: z.number().int().optional(),
});
export type NcaafGame = z.infer<typeof ncaafGameSchema>;

export const ncaafGameListSchema = z.object({
  data: z.array(ncaafGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
