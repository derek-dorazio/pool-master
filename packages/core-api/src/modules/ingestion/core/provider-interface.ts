/**
 * SportDataProvider — the adapter interface all data providers implement.
 *
 * The ingestion layer calls this interface — never provider APIs directly.
 * Swapping or adding a provider requires only a new adapter implementation.
 */

import type { Sport } from '@poolmaster/shared/domain';

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

  /** Fetch live/current scores for an event. */
  getLiveScores(eventId: string): Promise<ProviderStatEvent[]>;

  /** Fetch final results for a completed event. */
  getEventResults(eventId: string): Promise<ProviderEventResult | null>;

  /** Health check — is the provider API responding? */
  healthCheck(): Promise<ProviderHealthStatus>;
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

export interface ProviderStatEvent {
  id: string;
  eventExternalId: string;
  participantExternalId: string;
  statKey: string;
  statValue: number;
  statUnit?: string;
  round?: number;
  hole?: number;
  lap?: number;
  timestamp: Date;
  isCorrection: boolean;
  correctsEventId?: string;
  providerId: string;
  rawData?: unknown;
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
