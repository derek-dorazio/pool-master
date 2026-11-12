/**
 * The BALLDONTLIE FIFA World Cup responses, as far as PoolMaster reads them (#1496): an
 * edition's matches and teams (`/fifa/worldcup/v1`).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI document
 * (https://www.balldontlie.io/openapi/fifa.yml) gives them, and lets every other field through.
 * The document requires only `status_state` on a match and nothing on a team, so every other
 * field is read as optional here, and `fifa-world-cup-mapping.ts` refuses a row missing one it
 * cannot do without, with a `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/fifa-world-cup-contract.test.ts` holds every field here
 * against the vendored copy of the document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `FIFATeam`: a nation, from an edition's teams and on each side of a match. */
export const fifaTeamSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().optional(),
  abbreviation: z.string().nullable().optional(),
});
export type FifaTeam = z.infer<typeof fifaTeamSchema>;

export const fifaTeamListSchema = z.object({
  data: z.array(fifaTeamSchema),
});

/** `FIFASeason`: the edition a match belongs to, by its year. */
export const fifaSeasonSchema = z.object({
  year: z.number().int().optional(),
});

/** `FIFAGroup`: read only for whether a match has one, which makes it a group stage match. */
export const fifaGroupSchema = z.object({});

/** `FIFAMatch`, from an edition's matches. A knockout side is null until it is decided. */
export const fifaMatchSchema = z.object({
  id: z.number().int().optional(),
  datetime: z.iso.datetime({ offset: true }).optional(),
  status_state: competitionStatusStateSchema,
  season: fifaSeasonSchema.optional(),
  group: fifaGroupSchema.nullable().optional(),
  home_team: fifaTeamSchema.nullable().optional(),
  away_team: fifaTeamSchema.nullable().optional(),
  home_score: z.number().int().nullable().optional(),
  away_score: z.number().int().nullable().optional(),
  home_score_penalties: z.number().int().nullable().optional(),
  away_score_penalties: z.number().int().nullable().optional(),
});
export type FifaMatch = z.infer<typeof fifaMatchSchema>;

export const fifaMatchListSchema = z.object({
  data: z.array(fifaMatchSchema),
  meta: balldontliePaginationSchema.optional(),
});
