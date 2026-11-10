/**
 * The BALLDONTLIE PGA TOUR responses, as far as PoolMaster reads them.
 *
 * Each schema names only the fields the adapter uses, with the type and nullability the
 * vendor's published OpenAPI document (https://www.balldontlie.io/openapi/pga.yml) gives them.
 * Fields we do not read are allowed through untouched, so the vendor adding a field changes
 * nothing; a field we read changing type, losing a value we map, or disappearing fails the
 * parse with a `BalldontlieContractError` naming the path. That is the drift signal: it shows
 * up on the sync run the first time the real API answers differently from the document.
 *
 * `tests/unit/core-api/balldontlie/pga-contract.test.ts` holds every field here against the
 * vendored copy of the document, so a schema here cannot quietly disagree with it.
 */

import { z } from 'zod';

/** The vendor's normalized lifecycle state (`PGAStatusState`), shared by tournaments and rounds. */
export const PgaStatusState = {
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  FINAL: 'final',
  POSTPONED: 'postponed',
  CANCELED: 'canceled',
  DELAYED: 'delayed',
  SUSPENDED: 'suspended',
  ABANDONED: 'abandoned',
  UNKNOWN: 'unknown',
} as const;
export type PgaStatusState = (typeof PgaStatusState)[keyof typeof PgaStatusState];

/** `PGAFormatType`: only STROKE_PLAY maps onto PoolMaster's golf scoring. */
export const PgaFormatType = {
  STROKE_PLAY: 'STROKE_PLAY',
  TEAM_STROKE: 'TEAM_STROKE',
  MATCH_PLAY: 'MATCH_PLAY',
  TEAM_CUP: 'TEAM_CUP',
  UNKNOWN_SPECIAL_FORMAT: 'UNKNOWN_SPECIAL_FORMAT',
} as const;
export type PgaFormatType = (typeof PgaFormatType)[keyof typeof PgaFormatType];

/** `PGACompetitorTypeV2`: only PLAYER rows are individual golfers. */
export const PgaCompetitorType = {
  PLAYER: 'PLAYER',
  TEAM: 'TEAM',
  CUP_TEAM: 'CUP_TEAM',
  PAIRING: 'PAIRING',
} as const;
export type PgaCompetitorType = (typeof PgaCompetitorType)[keyof typeof PgaCompetitorType];

const statusStateSchema = z.enum(PgaStatusState);

/** `Pagination`: `next_cursor` is absent (or null) on the last page. */
export const pgaPaginationSchema = z.object({
  next_cursor: z.number().int().nullable().optional(),
});

/** `PGATournamentRound`, one round's state inside a tournament. */
export const pgaTournamentRoundSchema = z.object({
  round_number: z.number().int().min(1),
  status_state: statusStateSchema,
});

/** `PGATournamentCourse`: which rounds a course hosts, and its par. */
export const pgaTournamentCourseSchema = z.object({
  course: z.object({
    // The inline course object lists nothing as required.
    par: z.number().int().nullish(),
  }),
  rounds: z.array(z.number().int()),
});

/** `PGATournamentV2` from `/pga/v2/tournaments`. */
export const pgaTournamentSchema = z.object({
  id: z.number().int(),
  season: z.number().int(),
  name: z.string().min(1),
  start_date: z.iso.date(),
  end_date: z.iso.date().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  course_name: z.string().nullable(),
  status_state: statusStateSchema,
  courses: z.array(pgaTournamentCourseSchema),
  rounds: z.array(pgaTournamentRoundSchema),
  /** Present only when the request sets `include_format=true`, which every adapter call does. */
  format_type: z.enum(PgaFormatType).nullable(),
});
export type PgaTournament = z.infer<typeof pgaTournamentSchema>;

export const pgaTournamentListSchema = z.object({
  data: z.array(pgaTournamentSchema),
  meta: pgaPaginationSchema.optional(),
});

/** `PGAPlayerSummaryV2`, the player on a competitor or a result. */
export const pgaPlayerSummarySchema = z.object({
  id: z.number().int(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  display_name: z.string().min(1),
  country: z.string().nullable(),
  country_code: z.string().nullable(),
});
export type PgaPlayerSummary = z.infer<typeof pgaPlayerSummarySchema>;

/** `PGATournamentCompetitorV2` from `/pga/v2/tournament_competitors`. */
export const pgaTournamentCompetitorSchema = z.object({
  id: z.number().int(),
  tournament_id: z.number().int(),
  type: z.enum(PgaCompetitorType),
  player: pgaPlayerSummarySchema.nullable(),
});
export type PgaTournamentCompetitor = z.infer<typeof pgaTournamentCompetitorSchema>;

export const pgaTournamentCompetitorListSchema = z.object({
  data: z.array(pgaTournamentCompetitorSchema),
  meta: pgaPaginationSchema.optional(),
});

/**
 * `PGAPlayer` from `/pga/v1/players`: a golfer, with the world ranking a field's tiers are built
 * from. The vendor lists no field of it as required, so all but the id and name may be missing:
 * one golfer without a ranking must not fail a whole field read.
 */
export const pgaPlayerSchema = z.object({
  id: z.number().int(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  display_name: z.string().min(1),
  country: z.string().nullish(),
  country_code: z.string().nullish(),
  owgr: z.number().int().nullish(),
  active: z.boolean().optional(),
});
export type PgaPlayer = z.infer<typeof pgaPlayerSchema>;

export const pgaPlayerListSchema = z.object({
  data: z.array(pgaPlayerSchema),
  meta: pgaPaginationSchema.optional(),
});

/** `PGAResultRoundV2`, one round on a result row. */
export const pgaResultRoundSchema = z.object({
  round_number: z.number().int().min(1),
  score: z.number().int().nullable(),
  par_relative_score: z.number().int().nullable(),
});
export type PgaResultRound = z.infer<typeof pgaResultRoundSchema>;

/** `PGATournamentResultV2` from `/pga/v2/tournament_results`. */
export const pgaTournamentResultSchema = z.object({
  competitor: z.object({
    id: z.number().int(),
    type: z.enum(PgaCompetitorType),
    player: pgaPlayerSummarySchema.nullable(),
  }),
  /** "1", "T5", "CUT", "WD" or "DQ"; the last three mark a golfer out of the event. */
  position: z.string().nullable(),
  /** "F" once the round is finished, the holes completed ("12", or "12*" from the back nine) while it is played, else null. */
  thru: z.string().nullable(),
  current_round: z.number().int().nullable(),
  rounds: z.array(pgaResultRoundSchema),
});
export type PgaTournamentResult = z.infer<typeof pgaTournamentResultSchema>;

export const pgaTournamentResultListSchema = z.object({
  data: z.array(pgaTournamentResultSchema),
  meta: pgaPaginationSchema.optional(),
});
