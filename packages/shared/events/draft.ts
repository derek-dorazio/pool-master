import type { DomainEvent } from './base';

export interface DraftPickMadeEvent extends DomainEvent {
  type: 'draft.pick_made';
  sourceService: 'draft-service';
  contestId: string;
  draftSessionId: string;
  teamId: string;
  participantId: string;
  pickNumber: number;
  round: number;
  autoPicked: boolean;
}

export interface DraftCompletedEvent extends DomainEvent {
  type: 'draft.completed';
  sourceService: 'draft-service';
  contestId: string;
  draftSessionId: string;
  totalPicks: number;
}
