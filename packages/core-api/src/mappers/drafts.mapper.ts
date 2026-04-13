/**
 * Draft mappers — convert internal draft session/state objects to DTOs.
 */
import type { DraftStatus, SelectionType } from '@poolmaster/shared/domain';

interface SessionState {
  sessionId: string;
  contestId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentEntryId: string | null;
  startedAt: Date | null;
  currentTurnStartedAt: Date | null;
  timePerPickSeconds: number;
}

interface DraftState {
  contestId: string;
  status: DraftStatus;
  entryIds: string[];
  rounds: number;
  currentPickNumber: number;
  picks: DraftPickHistoryRecord[];
  autoPickPolicy: string;
  selectionType?: SelectionType;
}

interface DraftPickHistoryRecord {
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
  status: DraftStatus;
  currentPickNumber: number;
  currentEntryId: string | null;
  currentTurnStartedAt: string | null;
  rounds: number;
  entryIds: string[];
  draftPickHistories: DraftPickHistoryDto[];
  isComplete: boolean;
  selectionType?: SelectionType;
}

export interface DraftPickHistoryDto {
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
    currentTurnStartedAt: session.currentTurnStartedAt?.toISOString() ?? null,
    rounds: state.rounds,
    entryIds: state.entryIds,
    draftPickHistories: state.picks.map(toDraftPickHistoryDto),
    isComplete: opts?.isComplete ?? false,
  };
}

export function toDraftPickHistoryDto(pick: DraftPickHistoryRecord): DraftPickHistoryDto {
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
