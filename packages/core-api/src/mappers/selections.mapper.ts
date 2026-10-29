/**
 * Selection room → DTO (#324).
 *
 * `SelectionService` answers with a `SelectionView` in domain terms, or a `SelectionPickResult`
 * after one pick change (#1259); the projections onto the published `SelectionStateResponse` and
 * `SelectionPickResponse` are here.
 *
 * This file is where the module's DTO shaping lives because `rules:check:route-discipline`
 * scans `routes.ts` and `handler.ts` for it — a `.map(` in either is a finding. The rule is
 * a proxy for the real point of `docs/LAYERS.md` §2.5: one projection per object, in one
 * place, rather than a shape invented wherever a response is assembled.
 */

import type {
  SelectionEntryDto,
  PickHistoryDto,
  SelectionGroupDto,
  SelectionParticipantDto,
  SelectionPickResponse,
  SelectionStateResponse,
} from '@poolmaster/shared/dto';
import type {
  SelectionEntry,
  PickHistoryRow,
  SelectionView,
  SelectionGroup,
  SelectionPickResult,
} from '../modules/selections/types';

function toSelectionParticipantDto(
  participant: SelectionGroup['participants'][number],
): SelectionParticipantDto {
  return {
    sportEventParticipantId: participant.sportEventParticipantId,
    participantId: participant.participantId,
    participantName: participant.participantName,
    role: participant.role ?? null,
    team: participant.teamAffiliation ?? null,
    status: participant.status ?? null,
    price: participant.price ?? null,
    ranking: participant.ranking ?? null,
    seedNumber: participant.seedNumber,
    orderIndex: participant.orderIndex ?? null,
    isAvailable: participant.isAvailable,
    isSelected: participant.isSelected,
  };
}

export function toSelectionGroupDto(group: SelectionGroup): SelectionGroupDto {
  const participants = group.participants.map(toSelectionParticipantDto);
  return {
    groupId: group.groupId,
    groupName: group.groupName,
    groupNumber: group.groupNumber,
    picksFromGroup: group.picksFromGroup,
    selectedParticipantIds: participants
      .filter((participant) => participant.isSelected)
      .map((participant) => participant.sportEventParticipantId),
    participants,
  };
}

/**
 * A pick as the room's history shows it. `participantId` here is the **field row** id
 * (`sportEventParticipantId`), not the canonical participant's — that is what the published
 * contract has always carried, since it is the id a client sends back to pick or unpick.
 */
export function toPickHistoryDto(pick: PickHistoryRow): PickHistoryDto {
  return {
    pickNumber: pick.pickNumber,
    round: pick.round,
    pickInRound: pick.pickInRound,
    entryId: pick.entryId,
    entryName: pick.entryName,
    participantId: pick.sportEventParticipantId,
    participantName: pick.participantName,
    role: pick.role,
    team: pick.teamAffiliation,
    price: pick.price,
    tierId: pick.tierId,
    tierName: pick.tierName,
    autoPicked: pick.isAutoPicked,
    pickedAt: pick.pickedAt.toISOString(),
  };
}

function toSelectionEntryDto(entry: SelectionEntry): SelectionEntryDto {
  return {
    id: entry.id,
    userId: entry.userId,
    name: entry.name,
    status: entry.status,
  };
}

/** The whole room: reading the state, and what submitting an entry or a draw answers with. */
export function toSelectionStateResponse(view: SelectionView): SelectionStateResponse {
  return {
    contestId: view.contest.id,
    contestName: view.contest.name,
    sportEventId: view.sportEventId,
    acceptsPicks: view.acceptsPicks,
    selectionType: view.contest.selectionType,
    drawnAt: view.contest.drawnAt?.toISOString() ?? null,
    isCommissioner: view.isCommissioner,
    rosterSize: view.rosterSize,
    status: view.status,
    myEntryId: view.myEntryId,
    entries: view.entries.map(toSelectionEntryDto),
    selectedEntryId: view.selectedEntryId,
    selectedEntryName: view.selectedEntryName,
    tiebreakerValue: view.tiebreakerValue,
    selectionGroups: view.selectionGroups.map(toSelectionGroupDto),
    pickHistories: view.picks.map(toPickHistoryDto),
    availableParticipantIds: view.availableSportEventParticipantIds,
    isComplete: view.isComplete,
    lineupSummary: view.lineupSummary,
  };
}

/** What one pick change left on the entry (#1259): its picks, its status and its lineup summary. */
export function toSelectionPickResponse(result: SelectionPickResult): SelectionPickResponse {
  return {
    contestId: result.contestId,
    entryId: result.entryId,
    sportEventId: result.sportEventId,
    entryStatus: result.entryStatus,
    picks: result.picks.map(toPickHistoryDto),
    lineupSummary: result.lineupSummary,
  };
}
