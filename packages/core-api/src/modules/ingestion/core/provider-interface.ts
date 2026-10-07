/**
 * SportDataProvider — the adapter interface all data providers implement.
 *
 * The ingestion layer calls this interface — never provider APIs directly.
 * Swapping or adding a provider requires only a new adapter implementation.
 *
 * `getLiveScores` returns the typed `LiveScoreResult` discriminated union per
 * plans/117 §10.2 (pool-master-rop.78.3). Each adapter implements one
 * category; `publishLiveScoreUpdate` validates the
 * result with Zod and persists per-category detail rows. Adapters whose
 * category typing isn't wired yet throw `LiveScoreUnsupportedError`.
 */

import type { ParticipantInactiveReason, Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult, MockEventState } from '@poolmaster/shared/dto';

// --- Provider Interface ---

export interface SportDataProvider {
  providerId: string;
  providerName: string;

  /** Which sports this provider covers. */
  sportsCovered: Sport[];

  /**
   * Fetch events/schedule for a sport. With a `dateRange`, only events starting inside it;
   * without one, every event the provider has for the sport (#402: the catalog browse no
   * longer defaults to a window around today). Called on demand by the catalog browse,
   * score-source linking and the year import; nothing schedules it (#126).
   */
  getUpcomingEvents(sport: Sport, dateRange?: DateRange): Promise<SportEvent[]>;

  /** Fetch details for a specific event. */
  getEventDetails(eventId: string, options?: ProviderEventSyncOptions): Promise<SportEventDetail | null>;

  /** Fetch participant list for a sport (athletes, drivers, teams). */
  getParticipants(sport: Sport): Promise<ProviderParticipant[]>;

  /**
   * Fetch live/current scores for an event. Returns a typed
   * `LiveScoreResult` discriminated by sport category. Throws
   * `LiveScoreUnsupportedError` if the adapter's category typing
   * hasn't landed yet (per plans/117 §3.1, only golf-roster adapters
   * ship in Phase 4).
   */
  getLiveScores(eventId: string, options?: ProviderEventSyncOptions): Promise<LiveScoreResult>;

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

export interface ProviderEventSyncOptions {
  mockEventState?: MockEventState;
}

export function supportsMockEventStateControls(provider: SportDataProvider): boolean {
  return provider.providerId === 'mock-contest-feed';
}

export interface LiveSimulationOptions {
  minutesPerRound?: number;
}

export type LiveSimulationPhase = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';

export interface LiveSimulationStatus {
  startsAt: Date;
  endsAt: Date;
  minutesPerRound: number;
  phase: LiveSimulationPhase;
  currentRound: number | null;
}

/**
 * A provider that can play an event's live scoring forward on its own clock, so a live
 * contest's leaderboard can be exercised without a real tournament in progress (#382).
 * Only the mock contest feed implements it.
 */
export interface ProviderLiveSimulationControls {
  /** Resolves null when the provider has no event with that id. */
  startLiveSimulation(externalEventId: string, options: LiveSimulationOptions): Promise<LiveSimulationStatus | null>;
  /** The simulation running for the event, or null when none is running (or the event is unknown). */
  getLiveSimulation(externalEventId: string): Promise<LiveSimulationStatus | null>;
}

export function supportsLiveSimulation(
  provider: SportDataProvider,
): provider is SportDataProvider & ProviderLiveSimulationControls {
  return (
    'startLiveSimulation' in provider
    && typeof provider.startLiveSimulation === 'function'
    && 'getLiveSimulation' in provider
    && typeof provider.getLiveSimulation === 'function'
  );
}

/**
 * Raised by adapters whose live-score category typing hasn't landed yet
 * (e.g., openf1, espn). Per plans/117 §3.1, Phase 4 ships only
 * golf-roster providers; the rest stay shape-locked at the design layer
 * and throw at runtime until their slice ships.
 */
export class LiveScoreUnsupportedError extends Error {
  constructor(providerId: string, sport: string) {
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
  metadata: Record<string, unknown>;
}

export interface ProviderHealthStatus {
  providerId: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  lastSuccessfulPoll?: Date;
  errorRateLastHour: number;
  latencyMsP95: number;
  message?: string;
}
