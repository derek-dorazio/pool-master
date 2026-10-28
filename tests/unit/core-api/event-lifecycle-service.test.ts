import {
  ContestStatus,
  SPORT_EVENT_STATUS_TRANSITIONS,
  SportEventStatus,
  type SportEvent,
} from '@poolmaster/shared/domain';
import {
  EventLifecycleError,
  EventLifecycleService,
  type EventLifecycleContestDeps,
} from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import type { ContestStartedNotice, SportEventChangedNotice } from '../../../packages/core-api/src/modules/notifications';
import { buildContest } from '../../factories';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeContestConfigurationRepo, fakeContestRepo } from '../../support/repo-fakes';
import { fakeLogger } from '../../support/fake-logger';
import { mockFn } from '../../support/mock-fn';

const STARTED_EVENT_START = new Date('2026-05-02T20:00:00.000Z');

const STARTED_CONTEST = buildContest({
  id: 'contest-1',
  leagueId: 'league-1',
  sportEventIds: ['sport-event-1'],
  name: 'Masters Pick 6',
  status: ContestStatus.OPEN,
});

/**
 * The contest ports, empty by default. `startedContest` adds one OPEN contest on the event;
 * `transitioned` is whether the guarded write finds it still startable.
 */
function contestDeps(options: { startedContest?: boolean; transitioned?: boolean } = {}): EventLifecycleContestDeps {
  return {
    contests: fakeContestRepo({
      findBySportEvent: jest.fn().mockResolvedValue(options.startedContest ? [STARTED_CONTEST] : []),
      transitionStatus: jest.fn().mockResolvedValue(options.transitioned ?? true),
    }),
    configurations: fakeContestConfigurationRepo(),
    matches: { findBySportEvent: jest.fn().mockResolvedValue([]) },
  };
}

/** A contest-started notice that records whom it was asked to tell. */
function startedNotice(): ContestStartedNotice & { contestsStarted: jest.Mock } {
  return { contestsStarted: mockFn<ContestStartedNotice['contestsStarted']>(async () => undefined) };
}

/** An in-memory store holding the one event under test, and the port over it. */
function seededEvents(overrides: Partial<SportEvent> = {}) {
  const store = new InMemorySportEvents();
  store.addEvent({
    id: 'sport-event-1',
    providerId: 'mock-contest-feed',
    externalId: 'provider-event-1',
    name: 'Manual Test Golf Tournament',
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    status: SportEventStatus.SCHEDULED,
    ...overrides,
  });
  return { sportEvents: store.sportEventRepo(), storedEvent: () => store.events[0] };
}

describe('SPORT_EVENT_STATUS_TRANSITIONS exhaustiveness', () => {
  it('pool-master-g1z declares a row for every SportEventStatus value', () => {
    // Compile-time exhaustiveness comes from the `satisfies` clause on the
    // const itself; this is the runtime companion proving no key was silently
    // dropped by an edit that also touched the type.
    expect(Object.keys(SPORT_EVENT_STATUS_TRANSITIONS).sort()).toEqual(
      Object.values(SportEventStatus).sort(),
    );
  });
});

describe('SPORT_EVENT_STATUS_TRANSITIONS DRAFT row (#431)', () => {
  it('lets a draft move only to SCHEDULED (its release) or CANCELLED', () => {
    expect(SPORT_EVENT_STATUS_TRANSITIONS[SportEventStatus.DRAFT]).toEqual([
      SportEventStatus.SCHEDULED,
      SportEventStatus.CANCELLED,
    ]);
  });

  it('gives no status a way back to DRAFT', () => {
    for (const targets of Object.values(SPORT_EVENT_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(SportEventStatus.DRAFT);
    }
  });
});

describe('EventLifecycleService release guard (#431)', () => {
  it('refuses to move a draft to SCHEDULED outside the release action, with 409 SPORT_EVENT_RELEASE_REQUIRED', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    for (const actor of [{ type: 'ROOT_ADMIN' as const }, { type: 'SYSTEM' as const }]) {
      await expect(
        service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.SCHEDULED, actor }),
      ).rejects.toMatchObject({ code: 'SPORT_EVENT_RELEASE_REQUIRED', statusCode: 409 });
    }
    expect(storedEvent().status).toBe(SportEventStatus.DRAFT);
  });

  it('moves a draft to SCHEDULED when the release action asks', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.SCHEDULED,
      actor: { type: 'ROOT_ADMIN' },
      release: true,
    });

    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  it('adds a released edition to the contests made from a template covering its series, and only on release (#714)', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.DRAFT });
    const releasedEditionContests = { addReleasedEditionToTemplateContests: jest.fn().mockResolvedValue([]) };
    const service = new EventLifecycleService(
      contestDeps(), sportEvents, fakeLogger(), undefined, undefined, releasedEditionContests,
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.SCHEDULED,
      actor: { type: 'ROOT_ADMIN' },
      release: true,
    });
    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(releasedEditionContests.addReleasedEditionToTemplateContests).toHaveBeenCalledTimes(1);
    expect(releasedEditionContests.addReleasedEditionToTemplateContests).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sport-event-1', eventSeriesId: 'event-series-2', eventYear: 2026 }),
    );
  });

  it('refuses to start a draft that was never released (422 SPORT_EVENT_INVALID_TRANSITION)', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } }),
    ).rejects.toMatchObject({ code: 'SPORT_EVENT_INVALID_TRANSITION', statusCode: 422 });
    expect(storedEvent().status).toBe(SportEventStatus.DRAFT);
  });
});

describe('EventLifecycleService.applySportEventStatusTransition', () => {
  it('pool-master-g1z allows a declared transition for a ROOT_ADMIN actor', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'ROOT_ADMIN' },
    });

    expect(result.fromStatus).toBe(SportEventStatus.SCHEDULED);
    expect(result.toStatus).toBe(SportEventStatus.IN_PROGRESS);
    expect(storedEvent().status).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('pool-master-g1z rejects an undeclared transition for a ROOT_ADMIN actor with 422 SPORT_EVENT_INVALID_TRANSITION', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        // SCHEDULED -> COMPLETED skips IN_PROGRESS entirely; not declared.
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'ROOT_ADMIN' },
      }),
    ).rejects.toMatchObject({
      name: 'EventLifecycleError',
      code: 'SPORT_EVENT_INVALID_TRANSITION',
      statusCode: 422,
    });
    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  it('pool-master-g1z treats a same-status call as a no-op, never rejecting it', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.COMPLETED, endDate: new Date('2026-05-31T22:00:00.000Z') });
    const contests = contestDeps();
    const contestSettlement = { settleFinishedSportEvent: jest.fn().mockResolvedValue(undefined), settleFinishedGame: jest.fn().mockResolvedValue(0) };
    const service = new EventLifecycleService(
      contests,
      sportEvents,
      fakeLogger(),
      undefined,
      contestSettlement,
    );

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'ROOT_ADMIN' },
      }),
    ).resolves.toMatchObject({ fromStatus: SportEventStatus.COMPLETED, toStatus: SportEventStatus.COMPLETED });
  });

  it('pool-master-g1z sets endDate on completion only when it is not already set', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.IN_PROGRESS });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
    });

    expect(storedEvent().status).toBe(SportEventStatus.COMPLETED);
    expect(storedEvent().endDate).toBeInstanceOf(Date);
  });

  it('pool-master-g1z leaves an already-set endDate alone on completion', async () => {
    const existingEndDate = new Date('2026-05-31T22:00:00.000Z');
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.IN_PROGRESS, endDate: existingEndDate });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
    });

    expect(storedEvent().status).toBe(SportEventStatus.COMPLETED);
    expect(storedEvent().endDate).toEqual(existingEndDate);
  });

  it('allows a declared transition for a SYSTEM actor, the lifecycle scheduler', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(result.toStatus).toBe(SportEventStatus.IN_PROGRESS);
    expect(storedEvent().status).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('pool-master-k6q rejects an undeclared transition for a SYSTEM actor with 422 SPORT_EVENT_INVALID_TRANSITION, same as ROOT_ADMIN', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'SYSTEM' },
      }),
    ).rejects.toMatchObject({
      name: 'EventLifecycleError',
      code: 'SPORT_EVENT_INVALID_TRANSITION',
      statusCode: 422,
    });
    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  // pool-master-eux.6 — relocated from ingestion-persistence.test.ts (that
  // module now only proves it delegates here, see
  // tests/unit/core-api/ingestion-persistence.test.ts).
  it('pool-master-eux.6 triggers Golf contest settlement from completed schedule events', async () => {
    const settlement = {
      settleFinishedSportEvent: jest.fn().mockResolvedValue({ contestsCompleted: 1 }),
      settleFinishedGame: jest.fn().mockResolvedValue(0),
    };
    const eventEndDate = new Date('2026-05-31T22:00:00.000Z');
    const { sportEvents } = seededEvents({ status: SportEventStatus.IN_PROGRESS, endDate: eventEndDate });
    const contests = contestDeps();
    const service = new EventLifecycleService(
      contests,
      sportEvents,
      fakeLogger(),
      undefined,
      settlement,
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
    });

    expect(settlement.settleFinishedSportEvent).toHaveBeenCalledWith('sport-event-1', {
      completedAt: eventEndDate,
    });
  });

  it('settles the contests of an event when it is cancelled, at the cancellation rather than its future start', async () => {
    const settlement = {
      settleFinishedSportEvent: jest.fn().mockResolvedValue({ contestsCompleted: 1 }),
      settleFinishedGame: jest.fn().mockResolvedValue(0),
    };
    const startDate = new Date('2099-05-28T12:00:00.000Z');
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED, startDate });
    const before = new Date();
    const service = new EventLifecycleService(
      contestDeps(),
      sportEvents,
      fakeLogger(),
      undefined,
      settlement,
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.CANCELLED,
      actor: { type: 'ROOT_ADMIN' },
    });

    const [, input] = settlement.settleFinishedSportEvent.mock.calls[0] as [string, { completedAt: Date }];
    expect(input.completedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(input.completedAt.getTime()).toBeLessThan(startDate.getTime());
  });

  // pool-master-9ya — relocated from ingestion-persistence.test.ts.
  it('pool-master-9ya activates open contests when an event starts and asks for each one\'s contest-started emails', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const contests = contestDeps({ startedContest: true });
    const notice = startedNotice();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger(), notice);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(contests.contests.findBySportEvent).toHaveBeenCalledWith('sport-event-1', {
      statuses: [ContestStatus.OPEN],
    });
    expect(contests.contests.transitionStatus).toHaveBeenCalledWith('contest-1', {
      from: [ContestStatus.OPEN],
      to: ContestStatus.ACTIVE,
      startsAt: STARTED_EVENT_START,
    });
    expect(notice.contestsStarted).toHaveBeenCalledTimes(1);
    expect(notice.contestsStarted).toHaveBeenCalledWith([STARTED_CONTEST], expect.objectContaining({ id: 'sport-event-1' }));
  });

  it('asks once for the contest-started emails of every contest the event starts, so their shared event reads are made once', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const second = buildContest({ ...STARTED_CONTEST, id: 'contest-2', leagueId: 'league-2' });
    const alreadyLive = buildContest({ ...STARTED_CONTEST, id: 'contest-3', leagueId: 'league-3' });
    const contests = contestDeps();
    contests.contests.findBySportEvent = jest.fn().mockResolvedValue([STARTED_CONTEST, second, alreadyLive]);
    contests.contests.transitionStatus = jest.fn().mockImplementation(async (contestId: string) => contestId !== alreadyLive.id);
    const notice = startedNotice();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger(), notice);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(notice.contestsStarted).toHaveBeenCalledTimes(1);
    expect(notice.contestsStarted).toHaveBeenCalledWith([STARTED_CONTEST, second], expect.objectContaining({ id: 'sport-event-1' }));
  });

  it('pool-master-9ya does not ask for contest-started emails again when the contest is already active', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = startedNotice();
    const service = new EventLifecycleService(contestDeps({ startedContest: true, transitioned: false }), sportEvents, fakeLogger(), notice);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(notice.contestsStarted).not.toHaveBeenCalled();
  });

  it('keeps the transition successful, and logs it, when the contest-started emails cannot be queued', async () => {
    const logger = fakeLogger();
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = { contestsStarted: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const service = new EventLifecycleService(contestDeps({ startedContest: true }), sportEvents, logger, notice);

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.IN_PROGRESS,
        actor: { type: 'SYSTEM' },
      }),
    ).resolves.toMatchObject({ toStatus: SportEventStatus.IN_PROGRESS });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ contestIds: ['contest-1'], error: 'database unavailable' }),
      'Failed to queue contest started emails',
    );
  });

  it('still starts the contest when no contest-started notice is wired', async () => {
    const { sportEvents } = seededEvents();
    const contests = contestDeps({ startedContest: true });

    await new EventLifecycleService(contests, sportEvents, fakeLogger()).applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(contests.contests.transitionStatus).toHaveBeenCalledWith('contest-1', expect.objectContaining({ to: ContestStatus.ACTIVE }));
  });
});

describe('EventLifecycleService event change emails (#845 C6, C7)', () => {
  /** An event-changed notice that records what it was told, and the order against settlement. */
  function changedNotice(order: string[] = []): SportEventChangedNotice & { sportEventChanged: jest.Mock } {
    return {
      sportEventChanged: mockFn<SportEventChangedNotice['sportEventChanged']>(async (_sportEvent, change) => { order.push(`told ${change.kind}`); }),
    };
  }

  it('tells the leagues an event was postponed when it first goes POSTPONED, and not again on a repeated call', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = changedNotice();
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), undefined, undefined, undefined, notice);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, actor: { type: 'ROOT_ADMIN' } });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, actor: { type: 'ROOT_ADMIN' } });

    expect(notice.sportEventChanged).toHaveBeenCalledTimes(1);
    expect(notice.sportEventChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'sport-event-1', status: SportEventStatus.POSTPONED }), { kind: 'POSTPONED' });
  });

  it('tells the leagues an event was cancelled before its contests settle', async () => {
    const order: string[] = [];
    const settlement = {
      settleFinishedSportEvent: jest.fn(async () => { order.push('settled'); return { sportEventId: 'sport-event-1', contestsSettled: 1, contestsCompleted: 1, standingsUpserted: 0 }; }),
      settleFinishedGame: jest.fn().mockResolvedValue(0),
    };
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), undefined, settlement, undefined, changedNotice(order));

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.CANCELLED, actor: { type: 'ROOT_ADMIN' } });

    expect(order).toEqual(['told CANCELLED', 'settled']);
  });

  it('tells nothing when an event starts or completes', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = changedNotice();
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), undefined, undefined, undefined, notice);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.COMPLETED, actor: { type: 'SYSTEM' } });

    expect(notice.sportEventChanged).not.toHaveBeenCalled();
  });

  it('tells the leagues a moved event\'s previous start', async () => {
    const { sportEvents, storedEvent } = seededEvents();
    const notice = changedNotice();
    const previousStart = new Date('2026-04-25T20:00:00.000Z');

    await new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), undefined, undefined, undefined, notice)
      .sportEventRescheduled(storedEvent(), previousStart);

    expect(notice.sportEventChanged).toHaveBeenCalledWith(storedEvent(), { kind: 'RESCHEDULED', previousStart });
  });

  it('still cancels the event and settles its contests, and logs it, when the event changed emails cannot be queued', async () => {
    const logger = fakeLogger();
    const settlement = {
      settleFinishedSportEvent: jest.fn().mockResolvedValue({ contestsCompleted: 1 }),
      settleFinishedGame: jest.fn().mockResolvedValue(0),
    };
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = { sportEventChanged: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const service = new EventLifecycleService(contestDeps(), sportEvents, logger, undefined, settlement, undefined, notice);

    await expect(service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.CANCELLED, actor: { type: 'ROOT_ADMIN' } }))
      .resolves.toMatchObject({ toStatus: SportEventStatus.CANCELLED });

    expect(settlement.settleFinishedSportEvent).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'sport-event-1', change: 'CANCELLED', error: 'database unavailable' }),
      'Failed to queue event changed emails',
    );
  });
});

describe('EventLifecycleService on an unknown event', () => {
  it('refuses with 404 SPORT_EVENT_NOT_FOUND and changes nothing', async () => {
    const { sportEvents, storedEvent } = seededEvents();
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger());

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'no-such-event',
        toStatus: SportEventStatus.IN_PROGRESS,
        actor: { type: 'SYSTEM' },
      }),
    ).rejects.toMatchObject({ name: 'EventLifecycleError', code: 'SPORT_EVENT_NOT_FOUND', statusCode: 404 });
    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });
});

describe('EventLifecycleError', () => {
  it('pool-master-g1z defaults to 422 SPORT_EVENT_INVALID_TRANSITION', () => {
    const error = new EventLifecycleError('bad transition');
    expect(error.code).toBe('SPORT_EVENT_INVALID_TRANSITION');
    expect(error.statusCode).toBe(422);
    expect(error.name).toBe('EventLifecycleError');
  });
});

describe('EventLifecycleService when another caller changes the status first (#1159)', () => {
  /** The event's status moves to `movedTo` between this caller's read and its write. */
  function racedTo(movedTo: SportEventStatus) {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.IN_PROGRESS });
    const transitionStatus = sportEvents.transitionStatus.bind(sportEvents);
    sportEvents.transitionStatus = async (id, transition) => {
      storedEvent().status = movedTo;
      return transitionStatus(id, transition);
    };
    const settlement = { settleFinishedSportEvent: jest.fn().mockResolvedValue(undefined), settleFinishedGame: jest.fn() };
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), undefined, settlement);
    return { service, settlement, storedEvent };
  }

  it('refuses an admin change with 409 when the event ended in another status, and runs no settlement for it', async () => {
    const { service, settlement, storedEvent } = racedTo(SportEventStatus.COMPLETED);

    await expect(service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.CANCELLED,
      actor: { type: 'ROOT_ADMIN' },
    })).rejects.toMatchObject({ code: 'SPORT_EVENT_INVALID_TRANSITION', statusCode: 409 });
    expect(storedEvent().status).toBe(SportEventStatus.COMPLETED);
    expect(settlement.settleFinishedSportEvent).not.toHaveBeenCalled();
  });

  it('answers an admin change with the event when it ended in the status asked for, without settling it a second time', async () => {
    const { service, settlement } = racedTo(SportEventStatus.COMPLETED);

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'ROOT_ADMIN' },
    });

    expect(result.sportEvent.status).toBe(SportEventStatus.COMPLETED);
    expect(settlement.settleFinishedSportEvent).not.toHaveBeenCalled();
  });

  it('lets the scheduler, which names the status it saw, lose the race quietly', async () => {
    const { service, settlement } = racedTo(SportEventStatus.CANCELLED);

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
      fromStatus: SportEventStatus.IN_PROGRESS,
    });

    expect(result.sportEvent.status).toBe(SportEventStatus.CANCELLED);
    expect(settlement.settleFinishedSportEvent).not.toHaveBeenCalled();
  });
});
