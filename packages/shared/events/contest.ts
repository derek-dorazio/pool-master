import type { DomainEvent } from './base';

export interface ContestLockedEvent extends DomainEvent {
  type: 'contest.locked';
  sourceService: 'core-api';
  contestId: string;
  lockedAt: string;
}

export interface ContestCompletedEvent extends DomainEvent {
  type: 'contest.completed';
  sourceService: 'core-api';
  contestId: string;
  winnerTeamId?: string;
}
