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

import type { MatchSide, ProviderCode, SportEventParticipantStatus, ProviderSlotPlay, Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { JobErrorType } from '@poolmaster/shared/domain';

// --- Provider Interface ---

export interface SportDataProvider {
  /** The adapter's id, as its feed's events and sync runs name it (`balldontlie`). */
  providerId: string;
  /** The Provider row it runs for (#2073): the registry's key. */
  readonly providerCode: ProviderCode;
  providerName: string;

  /**
   * Whether the adapter reads this provider league (its own code, such as `nfl`): one of its
   * Provider's enabled leagues that it has a reader for, as it was built at startup.
   */
  servesLeague(providerLeagueCode: string): boolean;

  /**
   * The request rate the adapter holds its calls to, a minute: the provider plan's limit, from its
   * Provider row (#1997). Absent for an adapter that does not pace itself.
   */
  readonly requestsPerMinute?: number;

  /**
   * Fetch one league's events/schedule. With a `dateRange`, only events starting inside it;
   * without one, every event the provider has for the league (#402). Called by the league events
   * sync for one Season at a time (#2003). The league is the `providerLeagueCode` asked for
   * (#1797, #1997, #2005).
   */
  getUpcomingEvents(sport: Sport, dateRange: DateRange | undefined, options: ProviderEventListOptions): Promise<SportEvent[]>;

  /** Fetch details for a specific event. */
  getEventDetails(eventId: string): Promise<SportEventDetail | null>;

  /** Fetch participant list for a sport (athletes, drivers, teams). */
  getParticipants(sport: Sport): Promise<ProviderParticipant[]>;

  /**
   * Fetch live/current scores for an event. Returns a typed
   * `LiveScoreResult` discriminated by sport category.
   */
  getLiveScores(eventId: string): Promise<LiveScoreResult>;
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

/** Which league's events a caller of `getUpcomingEvents` wants (#1797, #2005). */
export interface ProviderEventListOptions {
  /**
   * The provider's own code for one of its leagues (a ProviderLeague's `code`, #1997). A provider
   * that reads league by league reads only that league: it throws `ProviderLeagueUnknownError` when
   * the code names none of its enabled leagues of the sport, and `ProviderLeagueRefusedError` when
   * the plan refuses it. One that cannot tell leagues apart ignores it, and the caller filters by
   * `SportEvent.providerLeagueCode`. There is no read of every league at once (#2005).
   */
  providerLeagueCode: string;
  /**
   * The provider's own id for one Season (a SportLeagueSeasonProviderMapping's `providerSeasonId`,
   * #2003), when that Season's whole schedule is wanted rather than a date range. A provider that
   * reads by season reads that one; one that does not ignores it.
   */
  providerSeasonId?: string;
}

/**
 * A provider was asked for a league it does not read (#2005): the code names none of its enabled
 * leagues of the sport, so nothing is read. Reading every league instead would hand back another
 * league's events as this one's.
 */
export class ProviderLeagueUnknownError extends Error {
  /** Activity's Error column (#1861). */
  readonly jobErrorType = JobErrorType.PROVIDER_ERROR;

  constructor(
    readonly providerName: string,
    readonly providerLeagueCode: string,
  ) {
    super(`${providerName} reads no enabled league with the code "${providerLeagueCode}" for this sport.`);
    this.name = 'ProviderLeagueUnknownError';
  }
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
  /**
   * The places the event's games are in, as the provider itself names them (league model slice 8,
   * #2005): a season type and the provider's own week or round (`REG:5`, `POST:3`), or a
   * tournament id. Each comes with its games' earliest and latest start. The sync matches each
   * code to a Season slot through the league's slot provider mappings; a code no mapping includes
   * is not synced. Empty where the provider names no place (a playoff read by date window).
   */
  providerSlots: ProviderSlotPlay[];
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

/** One match of a provider's fixed-shape bracket, numbered within its round and linked as the event's bracket is (#2161). */
export interface ProviderBracketMatch {
  roundNumber: number;
  matchNumber: number;
  homeTeamExternalId: string | null;
  awayTeamExternalId: string | null;
  isNeutralSite: boolean;
  scheduledAt: Date | null;
  /** The match and side its winner goes to; null for the final, and for a match before a reseed. */
  advancesTo: { roundNumber: number; matchNumber: number; side: MatchSide } | null;
  regionLabel: string | null;
}

/**
 * One match of an event as its provider schedules it (ADR 0011, #1728): the provider's games of
 * it, the round it is in, both teams by the provider's external id, and its kickoff.
 */
export interface ProviderScheduledGame {
  /**
   * The provider's games of the match, each with its number (#2007): one for a single game, and
   * a best-of series' games scheduled so far, Game 1 first. The schedule sync maps each to its Game.
   */
  games: ProviderScheduledGameId[];
  roundNumber: number;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  scheduledAt: Date | null;
  isNeutralSite: boolean;
}

/** A provider's id for one game of a match, with the game's number in it. */
export interface ProviderScheduledGameId {
  providerGameId: string;
  /** 1 for a single game and a series' first; a series' games in the order they are played. */
  gameNumber: number;
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
  /** The participant's place in the event as the provider lists it: ACTIVE, or how it went out. */
  status: SportEventParticipantStatus;
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
  seed?: number;
  /** Odds to win, valid only for the event named by `oddsSourceEventId`. */
  odds?: number;
  oddsSourceEventId?: string;
  [key: string]: unknown;
}

