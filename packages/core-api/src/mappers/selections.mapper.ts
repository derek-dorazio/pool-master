/**
 * Selection room → DTO (#324).
 *
 * `SelectionService` answers with a `SelectionView` in domain terms; the projection onto the
 * published `SelectionStateResponse` / `SelectionPickResponse` shape is here. Both responses have
 * always carried the same fields, so there is one projection, not two.
 *
 * This file is where the module's DTO shaping lives because `rules:check:route-discipline`
 * scans `routes.ts` and `handler.ts` for it — a `.map(` in either is a finding. The rule is
 * a proxy for the real point of `docs/LAYERS.md` §2.5: one projection per object, in one
 * place, rather than a shape invented wherever a response is assembled.
 */

import type {
  SelectionContestConfigurationDto,
  SelectionEntryDto,
  PickHistoryDto,
  SelectionGroupDto,
  SelectionParticipantDto,
  SelectionStateResponse,
} from '@poolmaster/shared/dto';
import type { ContestConfiguration } from '@poolmaster/shared/domain';
import type {
  SelectionEntry,
  PickHistoryRow,
  SelectionView,
  SelectionGroup,
  SelectionTierConfig,
} from '../modules/selections/types';

/**
 * The configuration subset a selection-room client needs. `rosterSize` prefers the room's computed
 * size and falls back through the configuration's own roster size, pick count and round count —
 * a chain of `||` rather than `??`, so a stored zero falls through to the next candidate the
 * same way a null does.
 */
export function toSelectionContestConfigurationDto(
  configuration: ContestConfiguration | null,
  tiers: readonly SelectionTierConfig[],
  rosterSize: number,
): SelectionContestConfigurationDto | null {
  if (!configuration) return null;
  return {
    isExclusive: configuration.isExclusive ?? false,
    rounds: configuration.rounds ?? undefined,
    pickCount: configuration.pickCount ?? undefined,
    rosterSize:
      rosterSize
      || configuration.rosterSize
      || configuration.pickCount
      || configuration.rounds
      || undefined,
    budget: configuration.budget ?? undefined,
    timePerPickSeconds: configuration.timePerPickSeconds ?? undefined,
    picksPerPeriod: configuration.picksPerPeriod ?? undefined,
    roundValues: configuration.roundValues ?? undefined,
    startRound: configuration.startRound ?? undefined,
    tierConfig: tiers.length > 0 ? tiers.map(toSelectionTierConfigDto) : undefined,
  };
}

function toSelectionTierConfigDto(tier: SelectionTierConfig) {
  return {
    tierId: tier.tierId,
    tierName: tier.tierName,
    tierNumber: tier.tierNumber,
    picksFromTier: tier.picksFromTier,
  };
}

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
    orderIndex: participant.orderIndex ?? null,
    isAvailable: participant.isAvailable,
    unavailableReason: participant.unavailableReason ?? null,
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
    isOnClock: false,
    status: entry.status,
  };
}

/**
 * The whole room. Used for both published selection responses: reading the state, and the
 * refreshed state a submission answers with.
 */
export function toSelectionStateResponse(view: SelectionView): SelectionStateResponse {
  return {
    contestId: view.contest.id,
    contestName: view.contest.name,
    selectionType: view.contest.selectionType,
    isTurnBased: false,
    isCommissioner: view.isCommissioner,
    rosterSize: view.rosterSize,
    contestConfiguration: toSelectionContestConfigurationDto(
      view.configuration,
      view.tiers,
      view.rosterSize,
    ),
    status: view.status,
    currentPickNumber: view.currentPickNumber,
    currentRound: view.currentRound,
    totalPicks: view.totalPicks,
    totalRounds: view.totalRounds,
    currentEntryId: view.currentEntryId,
    currentEntryName: view.currentEntryName,
    myEntryId: view.myEntryId,
    isMyPick: view.canCurrentUserSubmit,
    currentTurnStartedAt: null,
    timePerPickSeconds: 0,
    entries: view.entries.map(toSelectionEntryDto),
    selectedEntryId: view.selectedEntryId,
    selectedEntryName: view.selectedEntryName,
    tiebreakerValue: view.tiebreakerValue,
    selectionGroups: view.selectionGroups.map(toSelectionGroupDto),
    pickHistories: view.picks.map(toPickHistoryDto),
    availableParticipantIds: view.availableSportEventParticipantIds,
    isComplete: view.isComplete,
  };
}
