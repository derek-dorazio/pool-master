import type { ContestRepository, ContestStatusTransition } from '@poolmaster/shared/db';
import {
  BackgroundJobType,
  ContestStatus,
  MatchStatus,
  SPORT_EVENT_STATUS_TRANSITIONS,
  SelectionType,
  SportEventStatus,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import {
  EventLifecycleError,
  EventLifecycleService,
  type EventLifecycleContestDeps,
} from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import type { SportEventChangedNotice } from '../../../packages/core-api/src/modules/notifications';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';
import { buildContest } from '../../factories';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeContestConfigurationRepo, fakeContestRepo } from '../../support/repo-fakes';
import { expectDefined } from '../../support/expect-defined';
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
 * A contest repository's guarded status write: moves those of `ids` that `moves` keeps, and
 * writes the jobs the move asks for to `written`, as the adapter does in its transaction.
 */
function guardedMove(written: unknown[], moves: (ids: readonly string[], transition: ContestStatusTransition) => string[] = (ids) => [...ids]) {
  return mockFn<ContestRepository['transitionStatuses']>(async (ids, transition) => {
    const moved = moves(ids, transition);
    if (moved.length > 0) written.push(...(transition.jobs?.(moved) ?? []));
    return moved;
  });
}

/**
 * The contest ports, empty by default. `startedContest` adds one OPEN contest on the event;
 * `transitioned` is whether the guarded write finds it still startable. `written` collects the
 * jobs each move writes with it.
 */
function contestDeps(options: { startedContest?: boolean; transitioned?: boolean; written?: unknown[] } = {}): EventLifecycleContestDeps {
  return {
    contests: fakeContestRepo({
      findBySportEvent: jest.fn().mockResolvedValue(options.startedContest ? [STARTED_CONTEST] : []),
      transitionStatuses: guardedMove(options.written ?? [], (ids) => (options.transitioned ?? true ? [...ids] : [])),
    }),
    configurations: fakeContestConfigurationRepo(),
    matches: { findBySportEvent: jest.fn().mockResolvedValue([]) },
  };
}

/** A real job queue, whose `queued` (the wake after commit) is watched. */
function startedJobs() {
  const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs() });
  jest.spyOn(queue, 'queued');
  return queue;
}

/** The "Contest is live" job one contest's move writes. */
function startedEmailsJob(contestId: string) {
  return {
    type: BackgroundJobType.CONTEST_STARTED_EMAILS,
    payload: { contestId, sportEventId: 'sport-event-1' },
    runAt: undefined,
    dedupeKey: `CONTEST_STARTED_EMAILS:${contestId}`,
  };
}

/** The settle job a finished event's move writes (#1448). */
function settleJob(completedAt: Date) {
  return {
    type: BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS,
    payload: { sportEventId: 'sport-event-1', completedAt: completedAt.toISOString() },
    runAt: undefined,
    dedupeKey: 'SETTLE_SPORT_EVENT_CONTESTS:sport-event-1',
  };
}

function fakeSettlement() {
  return {
    settleFinishedSportEvent: jest.fn().mockResolvedValue({ contestsCompleted: 1 }),
    settleFinishedGame: jest.fn().mockResolvedValue(0),
  };
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
  it('writes the job that settles its contests with the completed status, at the event\'s end, and settles nothing in the request (#1448)', async () => {
    const settlement = {
      settleFinishedSportEvent: jest.fn().mockResolvedValue({ contestsCompleted: 1 }),
      settleFinishedGame: jest.fn().mockResolvedValue(0),
    };
    const eventEndDate = new Date('2026-05-31T22:00:00.000Z');
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'Golf', startDate: new Date('2026-05-28T12:00:00.000Z'), endDate: eventEndDate, status: SportEventStatus.IN_PROGRESS });
    const jobs = startedJobs();
    const service = new EventLifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), jobs, settlement);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.COMPLETED, actor: { type: 'SYSTEM' } });

    expect(store.backgroundJobs).toEqual([settleJob(eventEndDate)]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
    expect(settlement.settleFinishedSportEvent).not.toHaveBeenCalled();
  });

  it('settles a cancelled event\'s contests at the cancellation rather than its future start', async () => {
    const startDate = new Date('2099-05-28T12:00:00.000Z');
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'Golf', startDate, status: SportEventStatus.SCHEDULED });
    const before = new Date();
    const service = new EventLifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), startedJobs(), fakeSettlement());

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.CANCELLED, actor: { type: 'ROOT_ADMIN' } });

    const [job] = store.backgroundJobs;
    const completedAt = new Date((job.payload as { completedAt: string }).completedAt);
    expect(completedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(completedAt.getTime()).toBeLessThan(startDate.getTime());
  });

  it('writes no settlement job when another caller finished the event first, since that caller\'s move wrote one', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'Golf', startDate: new Date('2026-05-28T12:00:00.000Z'), status: SportEventStatus.IN_PROGRESS });
    const repo = store.sportEventRepo();
    const jobs = startedJobs();
    // The other caller's move lands between this one's read and its write.
    const findById = repo.findById.bind(repo);
    jest.spyOn(repo, 'findById').mockImplementationOnce(async (id) => {
      const seen = await findById(id);
      await repo.transitionStatus(id, { from: SportEventStatus.IN_PROGRESS, to: SportEventStatus.COMPLETED });
      return seen;
    });
    const service = new EventLifecycleService(contestDeps(), repo, fakeLogger(), jobs, fakeSettlement());

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.COMPLETED, actor: { type: 'SYSTEM' }, fromStatus: SportEventStatus.IN_PROGRESS });

    expect(store.backgroundJobs).toEqual([]);
    expect(jobs.queued).not.toHaveBeenCalled();
  });

  it('settles the event\'s contests when its job runs, at the completion the job carries', async () => {
    const settlement = fakeSettlement();
    const { sportEvents } = seededEvents({ status: SportEventStatus.COMPLETED });
    const completedAt = new Date('2026-05-31T22:00:00.000Z');

    await new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement)
      .settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: completedAt.toISOString() });

    expect(settlement.settleFinishedSportEvent).toHaveBeenCalledWith('sport-event-1', {
      completedAt,
      sportEvent: expect.objectContaining({ id: 'sport-event-1', status: SportEventStatus.COMPLETED }) as unknown,
    });
  });

  it('settles nothing, and says why, when the job finds the event moved back out of COMPLETED, since its next finish queues a job of its own', async () => {
    const settlement = fakeSettlement();
    const logger = fakeLogger();
    const { sportEvents } = seededEvents({ status: SportEventStatus.IN_PROGRESS });

    await new EventLifecycleService(contestDeps(), sportEvents, logger, startedJobs(), settlement)
      .settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() });

    expect(settlement.settleFinishedSportEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'events.settleContests.skipped', data: { sportEventId: 'sport-event-1', status: SportEventStatus.IN_PROGRESS } },
      expect.any(String),
    );
  });

  it('lets a settlement failure throw from the job, so the runner retries it', async () => {
    const settlement = fakeSettlement();
    settlement.settleFinishedSportEvent.mockRejectedValueOnce(new Error('connection reset'));
    const { sportEvents } = seededEvents({ status: SportEventStatus.COMPLETED });

    await expect(new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement)
      .settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() })).rejects.toThrow('connection reset');
  });

  // pool-master-9ya — relocated from ingestion-persistence.test.ts.
  it('pool-master-9ya activates open contests when an event starts and writes each one\'s contest-started email job with the move, building no email itself', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const written: unknown[] = [];
    const contests = contestDeps({ startedContest: true, written });
    const jobs = startedJobs();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(contests.contests.findBySportEvent).toHaveBeenCalledWith('sport-event-1', {
      statuses: [ContestStatus.OPEN],
    });
    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({
      from: [ContestStatus.OPEN],
      to: ContestStatus.ACTIVE,
      startsAt: STARTED_EVENT_START,
    }));
    expect(written).toEqual([startedEmailsJob('contest-1')]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('starts every contest going live at the event\'s start in one write, and writes an email job for each it moved, none for one already live', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const second = buildContest({ ...STARTED_CONTEST, id: 'contest-2', leagueId: 'league-2' });
    const alreadyLive = buildContest({ ...STARTED_CONTEST, id: 'contest-3', leagueId: 'league-3' });
    const written: unknown[] = [];
    const contests = contestDeps();
    contests.contests.findBySportEvent = jest.fn().mockResolvedValue([STARTED_CONTEST, second, alreadyLive]);
    contests.contests.transitionStatuses = guardedMove(written, (ids) => ids.filter((id) => id !== alreadyLive.id));
    const jobs = startedJobs();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(contests.contests.transitionStatuses).toHaveBeenCalledTimes(1);
    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1', 'contest-2', 'contest-3'], expect.objectContaining({ startsAt: STARTED_EVENT_START }));
    expect(contests.contests.transitionStatus).not.toHaveBeenCalled();
    expect(written).toEqual([startedEmailsJob('contest-1'), startedEmailsJob('contest-2')]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('still wakes the runner for the contests already live when a later start\'s write fails, since their jobs committed with them', async () => {
    const kickoff = new Date(STARTED_EVENT_START.getTime() + 60 * 60_000);
    const { sportEvents } = seededEvents({ status: SportEventStatus.IN_PROGRESS });
    const atStart = buildContest({ ...STARTED_CONTEST, id: 'contest-at-start' });
    const squares = buildContest({
      ...STARTED_CONTEST,
      id: 'contest-squares',
      leagueId: 'league-2',
      selectionType: SelectionType.SQUARES,
      squaresGameMatchId: 'game-1',
    });
    const written: unknown[] = [];
    const contests = contestDeps();
    contests.contests.findBySportEvent = jest.fn().mockResolvedValue([atStart, squares]);
    contests.configurations = fakeContestConfigurationRepo({
      findByContests: jest.fn().mockResolvedValue([{ contestId: squares.id, configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 } }]),
    });
    contests.matches = {
      findBySportEvent: jest.fn().mockResolvedValue([
        { id: 'game-1', sportEventId: 'sport-event-1', roundNumber: 1, status: MatchStatus.IN_PROGRESS, scheduledDate: kickoff } as SportEventMatch,
      ]),
    };
    contests.contests.transitionStatuses = guardedMove(written, (ids, transition) => {
      if (transition.startsAt?.getTime() === kickoff.getTime()) throw new Error('database unavailable');
      return [...ids];
    });
    const jobs = startedJobs();
    const service = new EventLifecycleService(contests, sportEvents, fakeLogger(), jobs);

    await expect(service.activateContestsPastCutoff(expectDefined(await sportEvents.findById('sport-event-1')), new Date(kickoff.getTime() + 60_000)))
      .rejects.toThrow('database unavailable');

    expect(written).toEqual([startedEmailsJob('contest-at-start')]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('pool-master-9ya writes no contest-started email job, and wakes nothing, when the contest is already active', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const written: unknown[] = [];
    const jobs = startedJobs();
    const service = new EventLifecycleService(contestDeps({ startedContest: true, transitioned: false, written }), sportEvents, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(written).toEqual([]);
    expect(jobs.queued).not.toHaveBeenCalled();
  });

  it('still starts the contest, in a write that asks for no job, when no job queue is wired', async () => {
    const { sportEvents } = seededEvents();
    const contests = contestDeps({ startedContest: true });

    await new EventLifecycleService(contests, sportEvents, fakeLogger()).applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({ to: ContestStatus.ACTIVE }));
    expect(jest.mocked(contests.contests.transitionStatuses).mock.calls[0]?.[1].jobs).toBeUndefined();
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

  it('tells the leagues an event was cancelled before its job settles its contests', async () => {
    const order: string[] = [];
    const settlement = {
      settleFinishedSportEvent: jest.fn(async () => { order.push('settled'); return { sportEventId: 'sport-event-1', contestsSettled: 1, contestsCompleted: 1, standingsUpserted: 0 }; }),
      settleFinishedGame: jest.fn().mockResolvedValue(0),
    };
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement, undefined, changedNotice(order));

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.CANCELLED, actor: { type: 'ROOT_ADMIN' } });
    expect(order).toEqual([]);
    await service.settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() });

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

  it('fails the settle job and settles nothing when a cancelled event\'s email jobs cannot be queued, so the job is retried', async () => {
    const settlement = fakeSettlement();
    const { sportEvents } = seededEvents({ status: SportEventStatus.CANCELLED });
    const notice = { sportEventChanged: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const service = new EventLifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement, undefined, notice);

    await expect(service.settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() }))
      .rejects.toThrow('database unavailable');

    expect(settlement.settleFinishedSportEvent).not.toHaveBeenCalled();
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
