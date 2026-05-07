import type { DomainEvent } from './base';

/**
 * Live-score persistence event. Emitted by the bus boundary
 * `publishLiveScoreUpdate` after a typed `LiveScoreResult` is validated and
 * its category-specific detail rows are persisted (per plans/117 §10.3).
 *
 * This replaces the legacy `stat.received` event whose untyped
 * `ProviderStatEvent` payload bypassed validation. Subscribers read the
 * persisted detail rows by `(sportEventId, category)` rather than the
 * payload itself, so `sportEventId` is required on the event — without
 * it, downstream consumers cannot filter the persisted rows they need.
 *
 * The event is *only* emitted when the bus boundary successfully resolves
 * `externalEventId` to an internal SportEvent. Payloads whose external id
 * does not match any SportEvent log a warning and skip the bus emission
 * entirely (no zero-update phantom event), since consumers would have no
 * usable `sportEventId` to filter on.
 */
export interface LiveScorePersistedEvent extends DomainEvent {
  type: 'live_score.persisted';
  sourceService: 'ingestion-worker';
  category: 'GOLF' | 'BASKETBALL' | 'F1' | 'NFL' | 'NASCAR' | 'TENNIS' | 'SOCCER';
  providerId: string;
  /** Internal SportEvent.id resolved from the payload's externalEventId at the bus boundary. */
  sportEventId: string;
  /** Number of detail rows persisted in this batch. */
  updatesPersisted: number;
  ingestedAt: string;
}

export interface ScoreUpdatedEvent extends DomainEvent {
  type: 'score.updated';
  sourceService: 'scoring-service';
  contestId: string;
  teamId: string;
  oldScore: number;
  newScore: number;
  rank: number;
  rankChanged: boolean;
}
