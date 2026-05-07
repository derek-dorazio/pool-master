/**
 * SportDataProvider — the adapter interface all data providers implement.
 *
 * The ingestion layer calls this interface — never provider APIs directly.
 * Swapping or adding a provider requires only a new adapter implementation.
 *
 * `getLiveScores` returns the typed `LiveScoreResult` discriminated union per
 * plans/117 §10.2 (pool-master-rop.78.3). Each adapter implements one
 * category; the bus boundary in `publishLiveScoreUpdate` validates the
 * result with Zod and persists per-category detail rows. Adapters whose
 * category typing isn't wired yet throw `LiveScoreUnsupportedError`.
 */

import type { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

// --- Provider Interface ---

export interface SportDataProvider {
  providerId: string;
  providerName: string;

  /** Which sports this provider covers. */
  sportsCovered: Sport[];

  /** Fetch upcoming events/schedule for a sport. */
  getUpcomingEvents(sport: Sport, dateRange: DateRange): Promise<SportEvent[]>;

  /** Fetch details for a specific event. */
  getEventDetails(eventId: string): Promise<SportEventDetail | null>;

  /** Fetch participant list for a sport (athletes, drivers, teams). */
  getParticipants(sport: Sport): Promise<ProviderParticipant[]>;

  /** Fetch current rankings for a sport. */
  getRankings(sport: Sport, rankingType: string): Promise<ProviderRanking[]>;

  /**
   * Fetch live/current scores for an event. Returns a typed
   * `LiveScoreResult` discriminated by sport category. Throws
   * `LiveScoreUnsupportedError` if the adapter's category typing
   * hasn't landed yet (per plans/117 §3.1, only golf-roster adapters
   * ship in Phase 4).
   */
  getLiveScores(eventId: string): Promise<LiveScoreResult>;

  /** Fetch final results for a completed event. */
  getEventResults(eventId: string): Promise<ProviderEventResult | null>;

  /** Health check — is the provider API responding? */
  healthCheck(): Promise<ProviderHealthStatus>;
}

/**
 * Raised by adapters whose live-score category typing hasn't landed yet
 * (e.g., openf1, espn, odds-api). Per plans/117 §3.1, Phase 4 ships only
 * golf-roster providers; the rest stay shape-locked at the design layer
 * and throw at runtime until their slice ships.
 */
export class LiveScoreUnsupportedError extends Error {
  constructor(providerId: string, sport: Sport | string) {
    super(
      `Provider ${providerId} does not yet emit typed LiveScoreResult for ${sport}. ` +
        `Per plans/117 §3.1, only golf-roster providers ship in Phase 4; ` +
        `category typing for this provider lands in a future rop.78.<N> slice.`,
    );
    this.name = 'LiveScoreUnsupportedError';
  }
}

// --- Shared types ---

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
  metadata: Record<string, unknown>;
}

export interface SportEventDetail extends SportEvent {
  participants: ProviderParticipant[];
}

export interface ProviderParticipant {
  externalId: string;
  providerId: string;
  sport: Sport;
  name: string;
  firstName?: string;
  lastName?: string;
  nationality?: string;
  position?: string;
  teamAffiliation?: string;
  photoUrl?: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

export interface ProviderRanking {
  participantExternalId: string;
  rankingType: string;
  rank: number;
  points?: number;
  asOfDate: Date;
}

export interface ProviderEventResult {
  eventExternalId: string;
  providerId: string;
  status: 'COMPLETED' | 'OFFICIAL';
  results: ProviderParticipantResult[];
}

export interface ProviderParticipantResult {
  participantExternalId: string;
  finishPosition: number;
  totalScore?: number;
  totalStrokes?: number;
  dnf: boolean;
  dnfReason?: string;
  stats: Record<string, number>;
}

export interface ProviderHealthStatus {
  providerId: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  lastSuccessfulPoll?: Date;
  errorRateLastHour: number;
  latencyMsP95: number;
  message?: string;
}
