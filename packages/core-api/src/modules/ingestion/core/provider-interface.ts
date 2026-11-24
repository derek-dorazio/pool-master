/**
 * SportDataProvider — the adapter interface all data providers implement.
 *
 * The ingestion layer calls this interface — never provider APIs directly.
 * Swapping or adding a provider requires only a new adapter implementation.
 *
 * `getLiveScores` returns the typed `LiveScoreResult` discriminated union per
 * plans/117 §10.2 (pool-master-rop.78.3). Each adapter implements one
 * category; `publishLiveScoreUpdate` validates the
 * result with Zod and persists it through the event's scoring family.
 */

import type { MatchSide, ParticipantInactiveReason, Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { JobErrorType } from '@poolmaster/shared/domain';

// --- Provider Interface ---

export interface SportDataProvider {
  providerId: string;
  providerName: string;

  /** Which sports this provider covers. */
  sportsCovered: Sport[];

  /**
   * The request rate the adapter holds its calls to, a minute: the provider plan's limit, from its
   * Provider row (#1997). Absent for an adapter that does not pace itself.
   */
  readonly requestsPerMinute?: number;

  /**
   * Fetch events/schedule for a sport. With a `dateRange`, only events starting inside it;
   * without one, every event the provider has for the sport (#402: the catalog browse no
   * longer defaults to a window around today). Called on demand by the catalog browse,
   * score-source linking and the year import; nothing schedules it (#126). Given a
   * `providerLeagueCode`, a provider that reads its sport league by league reads only that league
   * (#1797, #1997).
   */
  getUpcomingEvents(sport: Sport, dateRange?: DateRange, options?: ProviderEventListOptions): Promise<SportEvent[]>;

  /** Fetch details for a specific event. */
  getEventDetails(eventId: string): Promise<SportEventDetail | null>;

  /** Fetch participant list for a sport (athletes, drivers, teams). */
  getParticipants(sport: Sport): Promise<ProviderParticipant[]>;

  /**
   * Fetch live/current scores for an event. Returns a typed
   * `LiveScoreResult` discriminated by sport category.
   */
  getLiveScores(eventId: string): Promise<LiveScoreResult>;

  /** Health check — is the provider API responding? */
  healthCheck(): Promise<ProviderHealthStatus>;
}

export interface ProviderPayloadCapture {
  operation: string;
  path?: string;
  capturedAt: string;
  /** The response JSON. Absent when `rawOmitted` is set. */
  raw?: unknown;
  /** Size of the response body in characters, when the adapter measured it. */
  bytes?: number;
  /**
   * The body was left out because it would have taken the run's capture past its size budget
   * (#418): only the path and size are kept. The run's payload reports `rawTruncated`.
   */
  rawOmitted?: true;
}

export interface ProviderPayloadCaptureSession {
  run<T>(work: () => Promise<T>): Promise<T>;
  consumeProviderPayloads(): ProviderPayloadCapture[];
}

export interface ProviderPayloadDiagnostics {
  clearProviderPayloads(): void;
  consumeProviderPayloads(): ProviderPayloadCapture[];
  beginProviderPayloadCapture?(): ProviderPayloadCaptureSession;
}

export function supportsProviderPayloadDiagnostics(
  provider: SportDataProvider,
): provider is SportDataProvider & ProviderPayloadDiagnostics {
  return (
    'clearProviderPayloads' in provider
    && typeof provider.clearProviderPayloads === 'function'
    && 'consumeProviderPayloads' in provider
    && typeof provider.consumeProviderPayloads === 'function'
  );
}

// --- Shared types ---

/** What a caller of `getUpcomingEvents` wants from a sport's list (#1797). */
export interface ProviderEventListOptions {
  /**
   * The provider's own code for one of its leagues (a ProviderLeague's `code`, #1997), when only
   * that league's events are wanted. A provider that reads the sport league by league reads only
   * that league, and throws `ProviderLeagueRefusedError` when the plan refuses it; one that cannot
   * tell ignores it, and the caller filters by `SportEvent.providerLeagueCode`.
   */
  providerLeagueCode?: string;
  /**
   * The provider's own id for one Season (a SportLeagueSeasonProviderMapping's `providerSeasonId`,
   * #2003), when that Season's whole schedule is wanted rather than a date range. A provider that
   * reads by season reads that one; one that does not ignores it.
   */
  providerSeasonId?: string;
}

/**
 * A provider refused one league's reads because the account's plan does not include them
 * (#1797): an HTTP 401 or 403 from the vendor. Thrown only for a read the caller asked of that
 * league alone; a sport's whole list leaves a refused league out instead.
 */
export class ProviderLeagueRefusedError extends Error {
  /** Activity's Error column (#1861). */
  readonly jobErrorType = JobErrorType.PROVIDER_ERROR;

  constructor(
    readonly providerName: string,
    readonly league: string,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(`${providerName} refused ${league}'s reads (HTTP ${String(status)}): the current plan does not include them.`, options);
    this.name = 'ProviderLeagueRefusedError';
  }
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface SportEvent {
  externalId: string;
  providerId: string;
  sport: Sport;
  name: string;
  venue?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED';
  rounds?: number;
  participantCount?: number;
  fieldLocked: boolean;
  /**
   * The provider's own code for the league the event belongs to (a ProviderLeague's `code`,
   * #1997); a sport league's sync keeps the events of its selected provider league. Absent from a
   * provider that does not read league by league.
   */
  providerLeagueCode?: string;
  metadata: ProviderEventMetadata;
}

/**
 * Provider-specific extras on an event. Stored as given; the named keys are the ones
 * something reads back, so a provider that supplies them supplies them with these types.
 */
export interface ProviderEventMetadata {
  /** The provider's tour word for the event's league; provider data, stored as given. */
  tour?: string;
  [key: string]: unknown;
}

export interface SportEventDetail extends SportEvent {
  participants: ProviderParticipant[];
  /**
   * The event's games as the provider schedules them, for an event whose games the provider lists
   * up front (a game week, #1728); left out where it does not. A synced league's event takes its
   * matches from them (`ProviderGameSlateService`).
   */
  games?: ProviderScheduledGame[];
  /**
   * The event's whole bracket, for a playoff whose shape is fixed (the NFL postseason, #1728):
   * every match from the first round to the final, each side the team the seeds place there or
   * null while a result or a reseed decides it. Left out until the provider's seeds fill the first
   * round. A synced league's draft event loads it as its bracket; `games` then keeps it current.
   */
  bracket?: ProviderBracketMatch[];
}

/** One match of a provider's fixed-shape bracket, numbered and linked as the event's bracket is. */
export interface ProviderBracketMatch {
  matchNumber: number;
  roundNumber: number;
  homeTeamExternalId: string | null;
  awayTeamExternalId: string | null;
  isNeutralSite: boolean;
  scheduledAt: Date | null;
  /** The match and side its winner goes to; null for the final, and for a match before a reseed. */
  advancesTo: { matchNumber: number; side: MatchSide } | null;
  regionLabel: string | null;
}

/**
 * One game of an event as its provider schedules it (ADR 0011, #1728): the provider's game id,
 * the round it is in, both teams by the provider's external id, and its kickoff.
 */
export interface ProviderScheduledGame {
  externalGameId: string;
  roundNumber: number;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  scheduledAt: Date | null;
  isNeutralSite: boolean;
}

export interface ProviderParticipant {
  externalId: string;
  providerId: string;
  sport: Sport;
  name: string;
  firstName?: string;
  lastName?: string;
  nationality?: string;
  /** Playing role ("GOLFER"), not a rank. */
  role?: string;
  teamAffiliation?: string;
  photoUrl?: string;
  active: boolean;
  /** Meaningful only when `active` is false; undefined covers "inactive, no more specific reason." */
  inactiveReason?: ParticipantInactiveReason;
  /**
   * The participant's ranking as the provider's field reports it (#384). When present, an
   * event field load writes it onto the event participant; when absent, the participant keeps
   * the ranking it already has.
   */
  ranking?: number;
  metadata: ProviderParticipantMetadata;
}

/**
 * Provider-specific extras on a participant. Stored as given; the named keys are the
 * ones something reads back.
 */
export interface ProviderParticipantMetadata {
  /**
   * The name of the league the participant plays in, for display, when the provider's sport
   * covers more than one (a college team is a men's or a women's team).
   */
  tour?: string;
  seed?: number;
  /**
   * A play-in place (#1728): the participant stands for a First Four pairing until its winner
   * fills the place, so the field row a load creates for it is marked as one.
   */
  playInPlace?: boolean;
  /** Odds to win, valid only for the event named by `oddsSourceEventId`. */
  odds?: number;
  oddsSourceEventId?: string;
  [key: string]: unknown;
}

export interface ProviderHealthStatus {
  providerId: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  lastSuccessfulPoll?: Date;
  errorRateLastHour: number;
  latencyMsP95: number;
  message?: string;
}
