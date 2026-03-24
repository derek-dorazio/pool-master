import type { DomainEvent } from './base';

export interface StatEvent extends DomainEvent {
  type: 'stat.received';
  sourceService: 'ingestion-worker';
  eventId: string;
  participantExternalId: string;
  participantId?: string;
  statKey: string;
  statValue: number;
  round?: number;
  isCorrection: boolean;
  correctsEventId?: string;
  providerId: string;
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
