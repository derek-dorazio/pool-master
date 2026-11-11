/**
 * The BALLDONTLIE NCAA basketball tournament responses, men's (`/ncaab`) and women's (`/ncaaw`),
 * as far as PoolMaster reads them (#1496).
 *
 * Built the way `nfl-contract.ts` is: each schema names only the fields the adapter uses, with
 * the type and nullability the vendor's published OpenAPI documents
 * (https://www.balldontlie.io/openapi/ncaab.yml and ncaaw.yml) give them, and lets every other
 * field through. The two documents describe a bracket game and a team the same way in every
 * field read here, so one schema serves both. They require only `status_state` on a bracket game
 * and nothing on a team, so every other field is read as optional here, and
 * `ncaa-tournament-mapping.ts` refuses a row missing one it cannot do without, with a
 * `BalldontlieContractError` naming it.
 *
 * `tests/unit/core-api/balldontlie/ncaa-tournament-contract.test.ts` holds every field here
 * against the vendored copy of each document.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `NCAABTeam` / `NCAAWTeam`, from the teams list. */
export const ncaaTeamSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().optional(),
  full_name: z.string().optional(),
  abbreviation: z.string().nullable().optional(),
  conference_id: z.number().int().nullable().optional(),
});
export type NcaaTeam = z.infer<typeof ncaaTeamSchema>;

export const ncaaTeamListSchema = z.object({
  data: z.array(ncaaTeamSchema),
});

/** `NCAABBracketTeam` / `NCAAWBracketTeam`: one side of a bracket game, null id while the side is still to be decided. */
export const ncaaBracketTeamSchema = z.object({
  id: z.number().int().nullable().optional(),
  name: z.string().optional(),
  full_name: z.string().nullable().optional(),
  seed: z.string().nullable().optional(),
  score: z.number().int().nullable().optional(),
});
export type NcaaBracketTeam = z.infer<typeof ncaaBracketTeamSchema>;

/** `NCAABBracket` / `NCAAWBracket`, from the bracket: one tournament game, with or without its teams yet. */
export const ncaaBracketGameSchema = z.object({
  game_id: z.number().int().nullable().optional(),
  season: z.number().int().optional(),
  round: z.number().int().optional(),
  date: z.iso.datetime({ offset: true }).nullable().optional(),
  status_state: competitionStatusStateSchema,
  home_team: ncaaBracketTeamSchema.nullable().optional(),
  away_team: ncaaBracketTeamSchema.nullable().optional(),
});
export type NcaaBracketGame = z.infer<typeof ncaaBracketGameSchema>;

export const ncaaBracketListSchema = z.object({
  data: z.array(ncaaBracketGameSchema),
  meta: balldontliePaginationSchema.optional(),
});
