import type { SlotStatusRepository, SlotStatusState } from '@poolmaster/shared/db';
import {
  BackgroundJobType,
  MatchStatus,
  ScoringFamily,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  SeasonSlotStatus,
  SportEventStatus,
  type BackgroundJobRequest,
  type ProviderSyncFindingRaise,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { SlotStatusService } from '../../../packages/core-api/src/modules/events/slot-status-service';
import { testDomainEvents } from '../../support/domain-events';

const EVENT_ID = 'event-1';

/** Slots in memory, with a guarded write that can be told another writer moved a slot first. */
function slotStore(slots: SlotStatusState[]) {
  const written: Array<{ seasonSlotId: string; from: SeasonSlotStatus; to: SeasonSlotStatus; jobs: BackgroundJobRequest[] }> = [];
  const movedElsewhere = new Set<string>();
  const repo: SlotStatusRepository = {
    findBySportEvent: async () => slots.map((slot) => ({ ...slot, matchStatuses: [...slot.matchStatuses] })),
    transitionStatus: async (seasonSlotId, { from, to }, jobs) => {
      const slot = slots.find((each) => each.seasonSlotId === seasonSlotId);
      if (!slot || slot.status !== from || movedElsewhere.has(seasonSlotId)) return false;
      slot.status = to;
      written.push({ seasonSlotId, from, to, jobs: [...jobs] });
      return true;
    },
  };
  return { repo, written, movedElsewhere };
}

const slot = (seasonSlotId: string, status: SeasonSlotStatus, matchStatuses: MatchStatus[], feedFinal = false): SlotStatusState => ({ seasonSlotId, status, matchStatuses, feedFinal });

function eventOf(overrides: Partial<SportEvent> = {}) {
  return { id: EVENT_ID, status: SportEventStatus.SCHEDULED, autoLifecycleEnabled: true, scoringFamily: ScoringFamily.HEAD_TO_HEAD, ...overrides } as SportEvent;
}

function service(slots: SlotStatusState[], event: SportEvent | null = eventOf()) {
  const store = slotStore(slots);
  const transitions: Array<{ fromStatus?: SportEventStatus; toStatus: SportEventStatus }> = [];
  let current = event;
  const eventLifecycle = {
    applySportEventStatusTransition: jest.fn(async (input: { sportEventId: string; toStatus: SportEventStatus; fromStatus?: SportEventStatus }) => {
      transitions.push({ fromStatus: input.fromStatus, toStatus: input.toStatus });
      current = current && { ...current, status: input.toStatus };
      return { sportEvent: current as SportEvent, fromStatus: input.fromStatus ?? SportEventStatus.SCHEDULED, toStatus: input.toStatus };
    }),
  };
  const findings = { raise: jest.fn(async (_raises: readonly ProviderSyncFindingRaise[]) => undefined) };
  const slotStatuses = new SlotStatusService({
    slots: store.repo,
    sportEvents: { findById: async () => current },
    eventLifecycle,
    domainEvents: testDomainEvents(),
    findings,
  });
  return { slotStatuses, store, transitions, eventLifecycle, findings };
}

describe('SlotStatusService.refreshSlots', () => {
  it('moves each slot its Matches have moved, with the refresh of its event\'s status and its contests\' activation written in the same write, and leaves the rest alone', async () => {
    const { slotStatuses, store } = service([
      slot('slot-started', SeasonSlotStatus.SCHEDULED, [MatchStatus.IN_PROGRESS, MatchStatus.SCHEDULED]),
      slot('slot-waiting', SeasonSlotStatus.SCHEDULED, [MatchStatus.SCHEDULED]),
    ]);

    await expect(slotStatuses.refreshSlots(EVENT_ID)).resolves.toEqual({ changedCount: 1 });

    expect(store.written).toEqual([{
      seasonSlotId: 'slot-started',
      from: SeasonSlotStatus.SCHEDULED,
      to: SeasonSlotStatus.IN_PROGRESS,
      jobs: [
        expect.objectContaining({ type: BackgroundJobType.REFRESH_EVENT_STATUS, payload: { sportEventId: EVENT_ID }, dedupeKey: `REFRESH_EVENT_STATUS:${EVENT_ID}` }),
        expect.objectContaining({ type: BackgroundJobType.ACTIVATE_EVENT_CONTESTS, payload: { sportEventId: EVENT_ID }, dedupeKey: `ACTIVATE_EVENT_CONTESTS:${EVENT_ID}` }),
      ],
    }]);
  });

  it('completes a slot by its event\'s scoring family: a golf slot whose rounds are all complete waits for the feed\'s final call', async () => {
    const golf = service([slot('slot-golf', SeasonSlotStatus.IN_PROGRESS, [MatchStatus.COMPLETED, MatchStatus.COMPLETED])], eventOf({ scoringFamily: ScoringFamily.STROKE_PLAY }));
    await expect(golf.slotStatuses.refreshSlots(EVENT_ID)).resolves.toEqual({ changedCount: 0 });

    const called = service([slot('slot-golf', SeasonSlotStatus.IN_PROGRESS, [MatchStatus.COMPLETED, MatchStatus.COMPLETED], true)], eventOf({ scoringFamily: ScoringFamily.STROKE_PLAY }));
    await called.slotStatuses.refreshSlots(EVENT_ID);
    expect(called.store.written.map((write) => write.to)).toEqual([SeasonSlotStatus.COMPLETED]);
  });

  it('never moves a completed slot again, though a late result moves one of its Matches back in progress, and raises one late-change finding for the event however many of its slots changed', async () => {
    const { slotStatuses, store, findings } = service(
      [
        slot('slot-done', SeasonSlotStatus.COMPLETED, [MatchStatus.IN_PROGRESS]),
        slot('slot-also-done', SeasonSlotStatus.COMPLETED, [MatchStatus.SCHEDULED]),
      ],
      eventOf({ sportLeagueId: 'league-1' }),
    );

    await expect(slotStatuses.refreshSlots(EVENT_ID)).resolves.toEqual({ changedCount: 0 });
    expect(store.written).toEqual([]);
    expect(findings.raise).toHaveBeenCalledTimes(1);
    expect(findings.raise).toHaveBeenCalledWith([{
      kind: ProviderSyncFindingKind.SLOT_CHANGED_AFTER_COMPLETED,
      severity: ProviderSyncFindingSeverity.WARNING,
      sportLeagueId: 'league-1',
      sportEventId: EVENT_ID,
      providerId: null,
      providerValue: null,
      providerValueName: null,
    }]);
  });

  it('raises no late-change finding for a completed slot whose Matches still complete it, or for a golf slot the feed still calls final', async () => {
    const teams = service([slot('slot-done', SeasonSlotStatus.COMPLETED, [MatchStatus.COMPLETED, MatchStatus.CANCELLED])]);
    await teams.slotStatuses.refreshSlots(EVENT_ID);
    expect(teams.findings.raise).not.toHaveBeenCalled();

    const golf = service([slot('slot-golf', SeasonSlotStatus.COMPLETED, [MatchStatus.COMPLETED], true)], eventOf({ scoringFamily: ScoringFamily.STROKE_PLAY }));
    await golf.slotStatuses.refreshSlots(EVENT_ID);
    expect(golf.findings.raise).not.toHaveBeenCalled();
  });

  it('raises the late-change finding when the feed takes back a golf tournament\'s final call after its slot completed', async () => {
    const { slotStatuses, findings } = service([slot('slot-golf', SeasonSlotStatus.COMPLETED, [MatchStatus.COMPLETED], false)], eventOf({ scoringFamily: ScoringFamily.STROKE_PLAY }));

    await slotStatuses.refreshSlots(EVENT_ID);

    expect(findings.raise).toHaveBeenCalledTimes(1);
  });

  it('counts no move a concurrent refresh already made, and refreshes nothing for an event that is gone', async () => {
    const raced = service([slot('slot-1', SeasonSlotStatus.SCHEDULED, [MatchStatus.IN_PROGRESS])]);
    raced.store.movedElsewhere.add('slot-1');
    await expect(raced.slotStatuses.refreshSlots(EVENT_ID)).resolves.toEqual({ changedCount: 0 });

    const gone = service([slot('slot-1', SeasonSlotStatus.SCHEDULED, [MatchStatus.IN_PROGRESS])], null);
    await expect(gone.slotStatuses.refreshSlots(EVENT_ID)).resolves.toEqual({ changedCount: 0 });
    expect(gone.store.written).toEqual([]);
  });
});

describe('SlotStatusService.refreshEvent', () => {
  it('starts a scheduled event once any of its slots has started, through the event lifecycle, as the system', async () => {
    const { slotStatuses, eventLifecycle } = service([slot('slot-1', SeasonSlotStatus.IN_PROGRESS, []), slot('slot-2', SeasonSlotStatus.SCHEDULED, [])]);

    await expect(slotStatuses.refreshEvent(EVENT_ID)).resolves.toEqual({ changedCount: 1 });
    expect(eventLifecycle.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: EVENT_ID, fromStatus: SportEventStatus.SCHEDULED, toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' },
    });
  });

  it('completes an in-progress event once every slot is complete, and walks a scheduled one through in progress first', async () => {
    const live = service([slot('slot-1', SeasonSlotStatus.COMPLETED, [])], eventOf({ status: SportEventStatus.IN_PROGRESS }));
    await live.slotStatuses.refreshEvent(EVENT_ID);
    expect(live.transitions).toEqual([{ fromStatus: SportEventStatus.IN_PROGRESS, toStatus: SportEventStatus.COMPLETED }]);

    const unstarted = service([slot('slot-1', SeasonSlotStatus.COMPLETED, [])]);
    await unstarted.slotStatuses.refreshEvent(EVENT_ID);
    expect(unstarted.transitions).toEqual([
      { fromStatus: SportEventStatus.SCHEDULED, toStatus: SportEventStatus.IN_PROGRESS },
      { fromStatus: SportEventStatus.IN_PROGRESS, toStatus: SportEventStatus.COMPLETED },
    ]);
  });

  it('leaves a draft, an event whose automatic lifecycle is off, and an event its slots would take back to scheduled where they are', async () => {
    for (const event of [
      eventOf({ status: SportEventStatus.DRAFT }),
      eventOf({ autoLifecycleEnabled: false }),
      eventOf({ status: SportEventStatus.IN_PROGRESS }),
    ]) {
      const slots = event.status === SportEventStatus.IN_PROGRESS ? [slot('slot-1', SeasonSlotStatus.SCHEDULED, [])] : [slot('slot-1', SeasonSlotStatus.IN_PROGRESS, [])];
      const { slotStatuses, eventLifecycle } = service(slots, event);
      await expect(slotStatuses.refreshEvent(EVENT_ID)).resolves.toEqual({ changedCount: 0 });
      expect(eventLifecycle.applySportEventStatusTransition).not.toHaveBeenCalled();
    }
  });

  it('leaves an event with no slots to its own status', async () => {
    const { slotStatuses, eventLifecycle } = service([]);

    await expect(slotStatuses.refreshEvent(EVENT_ID)).resolves.toEqual({ changedCount: 0 });
    expect(eventLifecycle.applySportEventStatusTransition).not.toHaveBeenCalled();
  });
});
