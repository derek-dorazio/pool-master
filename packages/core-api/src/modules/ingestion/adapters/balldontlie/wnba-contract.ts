/**
 * The BALLDONTLIE WNBA responses, as far as PoolMaster reads them (#1496).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/wnba.yml) gives them, and lets every other field through.
 * The document requires only `status_state` on a game and nothing on a team, so every other
 * field is read as optional here, and `wnba-mapping.ts` refuses a row missing one it cannot do
 * without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/wnba-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `WNBATeam`, from `/wnba/v1/teams` and on each side of a game. */
export const wnbaTeamSchema = z.object({
  id: z.number().int().optional(),
  full_name: z.string().optional(),
  abbreviation: z.string().optional(),
  conference: z.string().optional(),
});
export type WnbaTeam = z.infer<typeof wnbaTeamSchema>;

export const wnbaTeamListSchema = z.object({
  data: z.array(wnbaTeamSchema),
});

/** `WNBAGame` from `/wnba/v1/games`. */
export const wnbaGameSchema = z.object({
  id: z.number().int().optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  season: z.number().int().optional(),
  postseason: z.boolean().optional(),
  status_state: competitionStatusStateSchema,
  home_team: wnbaTeamSchema.optional(),
  visitor_team: wnbaTeamSchema.optional(),
  home_score: z.number().int().optional(),
  away_score: z.number().int().optional(),
});
export type WnbaGame = z.infer<typeof wnbaGameSchema>;

export const wnbaGameListSchema = z.object({
  data: z.array(wnbaGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
