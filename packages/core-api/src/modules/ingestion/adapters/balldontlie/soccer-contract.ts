/**
 * The BALLDONTLIE soccer responses, as far as PoolMaster reads them (#1496): the Premier
 * League's matches and teams (`/epl/v2`).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/epl.yml) gives them, and lets every other field through.
 * The vendor's soccer documents describe a match (`SoccerMatch`) and a team (`SoccerTeam`) by
 * the same components. The document requires only `status_state` on a match and nothing on a
 * team, so every other field is read as optional here, and `epl-mapping.ts` refuses a row
 * missing one it cannot do without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/epl-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `SoccerTeam`, from a season's teams list. A match names its teams by id alone. */
export const soccerTeamSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().optional(),
  abbreviation: z.string().nullable().optional(),
});
export type SoccerTeam = z.infer<typeof soccerTeamSchema>;

export const soccerTeamListSchema = z.object({
  data: z.array(soccerTeamSchema),
});

/** `SoccerMatch`, from a season's matches. */
export const soccerMatchSchema = z.object({
  id: z.number().int().optional(),
  home_team_id: z.number().int().nullable().optional(),
  away_team_id: z.number().int().nullable().optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  status_state: competitionStatusStateSchema,
  home_score: z.number().int().nullable().optional(),
  away_score: z.number().int().nullable().optional(),
  round_number: z.number().int().nullable().optional(),
});
export type SoccerMatch = z.infer<typeof soccerMatchSchema>;

export const soccerMatchListSchema = z.object({
  data: z.array(soccerMatchSchema),
  meta: balldontliePaginationSchema.optional(),
});
