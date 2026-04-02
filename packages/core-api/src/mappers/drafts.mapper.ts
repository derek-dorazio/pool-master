/**
 * Draft mappers — convert internal draft session/state objects to DTOs.
 */
import type { DraftStatus } from '@poolmaster/shared/domain';

interface SessionState {
  sessionId: string;
  contestId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentEntryId: string | null;
  startedAt: Date | null;
  pickDeadline: Date | null;
  timePerPickSeconds: number;
}

interface DraftState {
  contestId: string;
  status: DraftStatus;
  entryIds: string[];
  rounds: number;
  currentPickNumber: number;
  picks: DraftPickRecord[];
  autoPickPolicy: string;
}

interface DraftPickRecord {
  pickNumber: number;
  round: number;
  pickInRound: number;
  entryId: string;
  participantId: string;
  autoPicked: boolean;
  pickedAt: Date;
}

export interface DraftStateResponseDto {
  contestId: string;
  status: string;
  currentPickNumber: number;
  currentEntryId: string | null;
  pickDeadline: string | null;
  rounds: number;
  entryIds: string[];
  picks: DraftPickDto[];
  isComplete: boolean;
}

export interface DraftPickDto {
  pickNumber: number;
  round: number;
  pickInRound: number;
  entryId: string;
  participantId: string;
  autoPicked: boolean;
  pickedAt: string;
}

export function toDraftStateResponse(
  session: SessionState,
  state: DraftState,
  opts?: { isComplete?: boolean },
): DraftStateResponseDto {
  return {
    contestId: state.contestId,
    status: session.status,
    currentPickNumber: state.currentPickNumber,
    currentEntryId: session.currentEntryId,
    pickDeadline: session.pickDeadline?.toISOString() ?? null,
    rounds: state.rounds,
    entryIds: state.entryIds,
    picks: state.picks.map(toDraftPickDto),
    isComplete: opts?.isComplete ?? false,
  };
}

export function toDraftPickDto(pick: DraftPickRecord): DraftPickDto {
  return {
    pickNumber: pick.pickNumber,
    round: pick.round,
    pickInRound: pick.pickInRound,
    entryId: pick.entryId,
    participantId: pick.participantId,
    autoPicked: pick.autoPicked,
    pickedAt: pick.pickedAt.toISOString(),
  };
}
