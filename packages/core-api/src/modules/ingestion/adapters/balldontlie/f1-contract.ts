/**
 * The BALLDONTLIE Formula 1 responses, as far as PoolMaster reads them (#2045).
 *
 * Each schema names only the fields the adapter uses, with the type and nullability the vendor's
 * published OpenAPI document (https://www.balldontlie.io/openapi/f1.yml) gives them. Fields we do
 * not read pass through untouched, so the vendor adding a field changes nothing. A field we read
 * changing type, or disappearing, fails the parse with a `BalldontlieContractError` naming the
 * path.
 *
 * `tests/unit/core-api/balldontlie/f1-contract.test.ts` holds every field here against the
 * vendored copy of the document.
 *
 * Plan tiers, as the document states them: events, drivers, teams, circuits and seasons are free.
 * Sessions, session results and driver standings need a paid tier. The vendor publishes no F1
 * webhook event types, so F1 is synced on the schedule only.
 */

import { z } from 'zod';
import { balldontliePaginationSchema } from './balldontlie-client';
import { competitionStatusStateSchema } from './competition-status';

/** `F1Circuit`, where a Grand Prix is held. */
const f1CircuitSchema = z.object({
  name: z.string(),
});

/** `F1Event` from `/f1/v1/events`: one Grand Prix weekend. */
const f1EventSchema = z.object({
  id: z.number().int(),
  /** The Grand Prix's name ("Monaco Grand Prix"): the league's NAME_PATTERN slot mappings place it by it. */
  name: z.string().min(1),
  season: z.number().int(),
  start_date: z.iso.datetime({ offset: true }).nullish(),
  end_date: z.iso.datetime({ offset: true }).nullish(),
  status_state: competitionStatusStateSchema,
  circuit: f1CircuitSchema.nullish(),
  location: z.string().nullish(),
  country_name: z.string().nullish(),
});
export type F1Event = z.infer<typeof f1EventSchema>;

export const f1EventListSchema = z.object({
  data: z.array(f1EventSchema),
  meta: balldontliePaginationSchema.optional(),
});

/** `F1Session` from `/f1/v1/sessions`: one session of a weekend. */
const f1SessionSchema = z.object({
  id: z.number().int(),
  /** The weekend the session belongs to: a page of sessions spans several events. */
  event: z.object({ id: z.number().int() }),
  /**
   * The session's type as the vendor names it ("Practice", "Qualifying", "Sprint", "Race"). The
   * document lists no fixed set: which types an event plays as Rounds is the league's session
   * type provider mappings to say, never this adapter's.
   */
  type: z.string().min(1),
  date: z.iso.datetime({ offset: true }).nullish(),
  status_state: competitionStatusStateSchema,
});
export type F1Session = z.infer<typeof f1SessionSchema>;

export const f1SessionListSchema = z.object({
  data: z.array(f1SessionSchema),
  meta: balldontliePaginationSchema.optional(),
});

/** `F1Team`: a driver's team for the season. */
const f1TeamSchema = z.object({
  name: z.string(),
});

/** `F1DriverWithTeam`, the driver on a result or a standing. */
const f1DriverWithTeamSchema = z.object({
  id: z.number().int(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  display_name: z.string().min(1),
  country_name: z.string().nullish(),
  team: f1TeamSchema.nullish(),
});
export type F1DriverWithTeam = z.infer<typeof f1DriverWithTeamSchema>;

/** `F1SessionResult` from `/f1/v1/session_results`: one driver's result in a session. */
const f1SessionResultSchema = z.object({
  session: z.object({ id: z.number().int() }),
  driver: f1DriverWithTeamSchema,
  /** The driver's place; null while the session has none for them. */
  position: z.number().int().nullish(),
  /** Whether the driver retired from the session; null when the vendor does not know. */
  retired: z.boolean().nullish(),
});
export type F1SessionResult = z.infer<typeof f1SessionResultSchema>;

export const f1SessionResultListSchema = z.object({
  data: z.array(f1SessionResultSchema),
  meta: balldontliePaginationSchema.optional(),
});

/** `F1DriverStanding` from `/f1/v1/driver_standings`: a driver in the season's championship. */
const f1DriverStandingSchema = z.object({
  driver: f1DriverWithTeamSchema,
  position: z.number().int().nullish(),
});
export type F1DriverStanding = z.infer<typeof f1DriverStandingSchema>;

export const f1DriverStandingListSchema = z.object({
  data: z.array(f1DriverStandingSchema),
  meta: balldontliePaginationSchema.optional(),
});

/** `F1Driver` from `/f1/v1/drivers`: the same driver fields, with no team. */
export const f1DriverListSchema = z.object({
  data: z.array(f1DriverWithTeamSchema.omit({ team: true })),
  meta: balldontliePaginationSchema.optional(),
});
