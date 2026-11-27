import { currentCoveredSlot, ParticipantType, SlotKind } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';

type ContestEvents = Pick<ContestDto, 'sportEvents'>;

/**
 * A contest's coverage as the API gives it, for a fixture that names only its events: one slot per
 * event, in the events' order, with the current slot worked out by the shared rule at `now`. A
 * fixture that sets `coveredSlots` or `currentSlotId` itself keeps its own.
 */
export function coverageOfEvents(
  { sportEvents }: ContestEvents,
  now: Date = new Date(),
): Pick<ContestDto, 'coveredSlots' | 'currentSlotId'> {
  const coveredSlots: ContestDto['coveredSlots'] = sportEvents.map((sportEvent) => ({
    seasonSlotId: `slot-${sportEvent.sportEventId}`,
    slotDefinitionId: `def-${sportEvent.sportEventId}`,
    key: sportEvent.sportEventId.toUpperCase(),
    name: sportEvent.name,
    slotKind: sportEvent.participantType === ParticipantType.INDIVIDUAL ? SlotKind.TOURNAMENT : SlotKind.WEEK,
    weekNumber: null,
    status: 'SCHEDULED',
    startsAt: null,
    endsAt: null,
    sportEventId: sportEvent.sportEventId,
    competitionCode: 'REGULAR',
    competitionName: null,
  }));
  const eventsById = new Map(sportEvents.map((sportEvent) => [sportEvent.sportEventId, sportEvent]));
  return { coveredSlots, currentSlotId: currentCoveredSlot(coveredSlots, eventsById, now)?.seasonSlotId ?? null };
}

/** `contest` with the coverage its events give it, unless it names its own. */
export function withCoverage<Contest extends ContestEvents & Partial<Pick<ContestDto, 'coveredSlots' | 'currentSlotId'>>>(
  contest: Contest,
  now?: Date,
): Contest & Pick<ContestDto, 'coveredSlots' | 'currentSlotId'> {
  const derived = coverageOfEvents(contest, now);
  return {
    ...contest,
    coveredSlots: contest.coveredSlots ?? derived.coveredSlots,
    currentSlotId: contest.currentSlotId !== undefined ? contest.currentSlotId : derived.currentSlotId,
  };
}
