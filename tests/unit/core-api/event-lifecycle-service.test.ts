import { legacyMatch } from '../../support/match-sides';
import type { ContestRepository, ContestStatusTransition } from '@poolmaster/shared/db';
import {
  BackgroundJobType,
  ContestStatus,
  MatchStatus,
  SPORT_EVENT_STATUS_TRANSITIONS,
  SelectionType,
  SportEventStatus,
  type Contest,
  type SportEvent,
  type SportEventRoundMatch,
} from '@poolmaster/shared/domain';
import {
  EventLifecycleError,
  EventLifecycleService,
  type EventLifecycleContestDeps,
  type FinishedSportEventSettlement,
} from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { testDomainEvents } from '../../support/domain-events';
import type { SportEventChangedNotice } from '../../../packages/core-api/src/modules/notifications/contest-notices';
import { eventChangedJob, recordingSportEventChangedNotice } from '../../support/sport-event-changed-notice';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs, TEST_JOB_START, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { buildContest } from '../../factories';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeContestConfigurationRepo, fakeContestRepo } from '../../support/repo-fakes';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { mockFn } from '../../support/mock-fn';
import { NO_SETTLE_JOBS } from '../../support/event-settlement';
import { slotOfRound } from '../../support/round-slots';

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
  const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart });
  jest.spyOn(queue, 'queued');
  return queue;
}

/**
 * The service under test, its follow-ups collected by the app's handler map over `jobs` (a fresh
 * queue when omitted, for a test about the service's own job-free behaviour), and the leagues told
 * of a change.
 */
function lifecycleService(
  contests: EventLifecycleContestDeps,
  sportEvents: ConstructorParameters<typeof EventLifecycleService>[1],
  logger: ReturnType<typeof fakeLogger>,
  jobs?: BackgroundJobQueue,
  settlement?: FinishedSportEventSettlement,
  notice?: SportEventChangedNotice,
): EventLifecycleService {
  const domainEvents = testDomainEvents({ queue: jobs ?? startedJobs(), sportEventChanged: notice });
  return new EventLifecycleService(contests, sportEvents, domainEvents, {
    contestSettlement: settlement ?? NO_SETTLE_JOBS.contestSettlement,
  }, logger);
}

/** The "Contest is live" job one contest's move writes. */
function startedEmailsJob(contestId: string) {
  return {
    type: BackgroundJobType.CONTEST_STARTED_EMAILS,
    payload: { contestId, sportEventId: 'sport-event-1' },
    sportEventId: 'sport-event-1',
    runAt: undefined,
    start: TEST_JOB_START,
    dedupeKey: `CONTEST_STARTED_EMAILS:${contestId}`,
  };
}

/** The rebuild of a contest's boards written with its every move (#1973). */
function contestRebuildJob(contestId: string) {
  return {
    type: BackgroundJobType.REBUILD_LEADERBOARDS,
    payload: { subject: 'CONTEST', id: contestId },
    runAt: undefined,
    start: TEST_JOB_START,
    dedupeKey: `REBUILD_LEADERBOARDS:CONTEST:${contestId}`,
  };
}

/** The job an event's start writes with its status, which takes its contests live (#1952). */
const activateJob = {
  type: BackgroundJobType.ACTIVATE_EVENT_CONTESTS,
  payload: { sportEventId: 'sport-event-1' },
  sportEventId: 'sport-event-1',
  runAt: undefined,
  start: TEST_JOB_START,
  dedupeKey: 'ACTIVATE_EVENT_CONTESTS:sport-event-1',
};

/** The job a postponement writes with its status, which has the event's contests follow its start (#1952). */
const followPostponedJob = { ...activateJob, type: BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS, dedupeKey: 'FOLLOW_POSTPONED_EVENT_CONTESTS:sport-event-1' };

/** The settle job a finished event's move writes (#1448). */
function settleJob(completedAt: Date) {
  return {
    type: BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS,
    payload: { sportEventId: 'sport-event-1', completedAt: completedAt.toISOString() },
    sportEventId: 'sport-event-1',
    runAt: undefined,
    start: TEST_JOB_START,
    dedupeKey: 'SETTLE_SPORT_EVENT_CONTESTS:sport-event-1',
  };
}

/** The job rebuilding the event's stored boards that each status change writes (#1466). */
function rebuildJob() {
  return {
    type: BackgroundJobType.REBUILD_LEADERBOARDS,
    payload: { subject: 'EVENT', id: 'sport-event-1' },
    sportEventId: 'sport-event-1',
    runAt: undefined,
    start: TEST_JOB_START,
    dedupeKey: 'REBUILD_LEADERBOARDS:EVENT:sport-event-1',
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
    providerRef: { providerId: 'balldontlie', externalId: 'provider-event-1' },
    name: 'Manual Test Golf Tournament',
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    status: SportEventStatus.SCHEDULED,
    ...overrides,
  });
  return { sportEvents: store.sportEventRepo(), storedEvent: () => store.events[0], statusJobs: () => store.backgroundJobs };
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
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger());

    for (const actor of [{ type: 'ROOT_ADMIN' as const }, { type: 'SYSTEM' as const }]) {
      await expect(
        service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.SCHEDULED, actor }),
      ).rejects.toMatchObject({ code: 'SPORT_EVENT_RELEASE_REQUIRED', statusCode: 409 });
    }
    expect(storedEvent().status).toBe(SportEventStatus.DRAFT);
  });

  it('moves a draft to SCHEDULED when the release action asks', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.SCHEDULED,
      actor: { type: 'ROOT_ADMIN' },
      release: true,
    });

    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  it('records when a draft was released with its release, and no release time on any other move', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.DRAFT });
    const transitionStatus = jest.spyOn(sportEvents, 'transitionStatus');
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger());
    const before = Date.now();

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.SCHEDULED, actor: { type: 'ROOT_ADMIN' }, release: true });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } });

    const [release, start] = transitionStatus.mock.calls.map(([, transition]) => transition);
    expect(release.releasedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(start.releasedAt).toBeUndefined();
  });

  it('writes each status change\'s jobs with the change itself: the release rebuilds the event\'s boards, the start also takes its contests live', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'PGA Championship', startDate: new Date('2026-05-14T12:00:00.000Z'), status: SportEventStatus.DRAFT, sportLeagueSeasonId: 'season-2026' });
    const jobs = startedJobs();
    const service = lifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), jobs);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.SCHEDULED, actor: { type: 'ROOT_ADMIN' }, release: true });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } });

    expect(store.backgroundJobs.map((job) => job.payload)).toEqual([
      { subject: 'EVENT', id: 'sport-event-1' },
      { sportEventId: 'sport-event-1' },
      { subject: 'EVENT', id: 'sport-event-1' },
    ]);
    expect(jobs.queued).toHaveBeenCalledTimes(2);
  });

  it('writes no job when another caller released the event first, since that release wrote them', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'PGA Championship', startDate: new Date('2026-05-14T12:00:00.000Z'), status: SportEventStatus.DRAFT });
    const repo = store.sportEventRepo();
    const jobs = startedJobs();
    // The other release lands between this one's read and its write; the read is a copy, as a
    // database read is, so the release still sees the draft it read.
    const findById = repo.findById.bind(repo);
    jest.spyOn(repo, 'findById').mockImplementationOnce(async (id) => {
      const seen = structuredClone(await findById(id));
      await repo.transitionStatus(id, { from: SportEventStatus.DRAFT, to: SportEventStatus.SCHEDULED });
      return seen;
    });
    const service = lifecycleService(contestDeps(), repo, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.SCHEDULED, actor: { type: 'ROOT_ADMIN' }, release: true });

    expect(store.backgroundJobs).toEqual([]);
    expect(jobs.queued).not.toHaveBeenCalled();
  });

  it('refuses to start a draft that was never released (422 SPORT_EVENT_INVALID_TRANSITION)', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.DRAFT });
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger());

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
    const service = lifecycleService(contests, sportEvents, fakeLogger());

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
    const service = lifecycleService(contests, sportEvents, fakeLogger());

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
    const service = lifecycleService(
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
    const service = lifecycleService(contests, sportEvents, fakeLogger());

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
    const service = lifecycleService(contests, sportEvents, fakeLogger());

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
    const service = lifecycleService(contests, sportEvents, fakeLogger());

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
    const service = lifecycleService(contests, sportEvents, fakeLogger());

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
    const service = lifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), jobs, settlement);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.COMPLETED, actor: { type: 'SYSTEM' } });

    expect(store.backgroundJobs).toEqual([settleJob(eventEndDate), rebuildJob()]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
    expect(settlement.settleFinishedSportEvent).not.toHaveBeenCalled();
  });

  it('settles a cancelled event\'s contests at the cancellation rather than its future start', async () => {
    const startDate = new Date('2099-05-28T12:00:00.000Z');
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'Golf', startDate, status: SportEventStatus.SCHEDULED });
    const before = new Date();
    const service = lifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), startedJobs(), fakeSettlement());

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
    const service = lifecycleService(contestDeps(), repo, fakeLogger(), jobs, fakeSettlement());

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.COMPLETED, actor: { type: 'SYSTEM' }, fromStatus: SportEventStatus.IN_PROGRESS });

    expect(store.backgroundJobs).toEqual([]);
    expect(jobs.queued).not.toHaveBeenCalled();
  });

  it('settles the event\'s contests when its job runs, at the completion the job carries', async () => {
    const settlement = fakeSettlement();
    const { sportEvents } = seededEvents({ status: SportEventStatus.COMPLETED });
    const completedAt = new Date('2026-05-31T22:00:00.000Z');

    await lifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement)
      .settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: completedAt.toISOString() });

    expect(settlement.settleFinishedSportEvent).toHaveBeenCalledWith('sport-event-1', {
      completedAt,
      sportEvent: expect.objectContaining({ id: 'sport-event-1', status: SportEventStatus.COMPLETED }) as unknown,
    });
  });

  it('takes a completed event\'s still-open contests live, with each one\'s contest-started email job, before settling them, when the event completed before its activation job ran', async () => {
    const settlement = fakeSettlement();
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const written: unknown[] = [];
    const contests = contestDeps({ startedContest: true, written });
    const service = lifecycleService(contests, sportEvents, fakeLogger(), startedJobs(), settlement);
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.COMPLETED, actor: { type: 'SYSTEM' } });

    // Only the settle job runs; the activation job is still waiting.
    await service.settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() });

    expect(written).toEqual([startedEmailsJob('contest-1'), contestRebuildJob('contest-1')]);
    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({ from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE }));
    expect(expectDefined(jest.mocked(contests.contests.transitionStatuses).mock.invocationCallOrder[0]))
      .toBeLessThan(expectDefined(settlement.settleFinishedSportEvent.mock.invocationCallOrder[0]));
  });

  it('takes no contest live before settling a cancelled event\'s contests', async () => {
    const settlement = fakeSettlement();
    const { sportEvents } = seededEvents({ status: SportEventStatus.CANCELLED });
    const contests = contestDeps({ startedContest: true });

    await lifecycleService(contests, sportEvents, fakeLogger(), startedJobs(), settlement)
      .settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() });

    expect(contests.contests.transitionStatuses).not.toHaveBeenCalled();
    expect(settlement.settleFinishedSportEvent).toHaveBeenCalled();
  });

  it('settles nothing, and says why, when the job finds the event moved back out of COMPLETED, since its next finish queues a job of its own', async () => {
    const settlement = fakeSettlement();
    const logger = fakeLogger();
    const { sportEvents } = seededEvents({ status: SportEventStatus.IN_PROGRESS });

    await lifecycleService(contestDeps(), sportEvents, logger, startedJobs(), settlement)
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

    await expect(lifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement)
      .settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() })).rejects.toThrow('connection reset');
  });

  // pool-master-9ya — relocated from ingestion-persistence.test.ts.
  it('pool-master-9ya writes the job that takes an event\'s open contests live with its start, and the job activates them with each one\'s contest-started email job, building no email itself', async () => {
    const { sportEvents, statusJobs } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const written: unknown[] = [];
    const contests = contestDeps({ startedContest: true, written });
    const jobs = startedJobs();
    const service = lifecycleService(contests, sportEvents, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });

    // The status change moves no contest itself: its job does, once the change has committed (#1952).
    expect(contests.contests.transitionStatuses).not.toHaveBeenCalled();
    expect(statusJobs()).toContainEqual(activateJob);
    expect(await service.activateEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 1 });

    expect(contests.contests.findBySportEvent).toHaveBeenCalledWith('sport-event-1', {
      statuses: [ContestStatus.OPEN],
    });
    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({
      from: [ContestStatus.OPEN],
      to: ContestStatus.ACTIVE,
      startsAt: STARTED_EVENT_START,
    }));
    expect(written).toEqual([startedEmailsJob('contest-1'), contestRebuildJob('contest-1')]);
    // Once for the contest's job, once for the status change's own follow-ups.
    expect(jobs.queued).toHaveBeenCalledTimes(2);
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
    const service = lifecycleService(contests, sportEvents, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });
    expect(await service.activateEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 2 });

    expect(contests.contests.transitionStatuses).toHaveBeenCalledTimes(1);
    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1', 'contest-2', 'contest-3'], expect.objectContaining({ startsAt: STARTED_EVENT_START }));
    expect(contests.contests.transitionStatus).not.toHaveBeenCalled();
    expect(written).toEqual([startedEmailsJob('contest-1'), contestRebuildJob('contest-1'), startedEmailsJob('contest-2'), contestRebuildJob('contest-2')]);
    // Once for the contests' jobs, once for the status change's own follow-ups.
    expect(jobs.queued).toHaveBeenCalledTimes(2);
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
        legacyMatch({ id: 'game-1', sportEventId: 'sport-event-1', roundNumber: 1, slot: slotOfRound(1), status: MatchStatus.IN_PROGRESS, scheduledDate: kickoff }),
      ]),
    };
    contests.contests.transitionStatuses = guardedMove(written, (ids, transition) => {
      if (transition.startsAt?.getTime() === kickoff.getTime()) throw new Error('database unavailable');
      return [...ids];
    });
    const jobs = startedJobs();
    const service = lifecycleService(contests, sportEvents, fakeLogger(), jobs);

    await expect(service.activateContestsPastCutoff(expectDefined(await sportEvents.findById('sport-event-1')), new Date(kickoff.getTime() + 60_000)))
      .rejects.toThrow('database unavailable');

    expect(written).toEqual([startedEmailsJob('contest-at-start'), contestRebuildJob('contest-at-start')]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('leaves a squares contest open while its game is still to kick off, starting only the contests that close at the event\'s start', async () => {
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
        legacyMatch({ id: 'game-1', sportEventId: 'sport-event-1', roundNumber: 1, slot: slotOfRound(1), status: MatchStatus.SCHEDULED, scheduledDate: kickoff }),
      ]),
    };
    contests.contests.transitionStatuses = guardedMove(written, (ids) => [...ids]);
    const service = lifecycleService(contests, sportEvents, fakeLogger(), startedJobs());

    expect(await service.activateContestsPastCutoff(expectDefined(await sportEvents.findById('sport-event-1')), new Date(kickoff.getTime() - 60_000))).toBe(1);

    expect(contests.contests.transitionStatuses).toHaveBeenCalledTimes(1);
    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-at-start'], expect.objectContaining({ startsAt: STARTED_EVENT_START }));
  });

  it('writes no contest-started email job when the contest is already active, and wakes the runner only for the status change\'s own follow-ups', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const written: unknown[] = [];
    const jobs = startedJobs();
    const service = lifecycleService(contestDeps({ startedContest: true, transitioned: false, written }), sportEvents, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });
    expect(await service.activateEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 0 });

    expect(written).toEqual([]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('starts the contest with its "Contest is live" job from the handler map, which needs no game-settlement queue wired', async () => {
    const { sportEvents } = seededEvents();
    const contests = contestDeps({ startedContest: true });

    const service = lifecycleService(contests, sportEvents, fakeLogger());
    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM' },
    });
    await service.activateEventContests({ sportEventId: 'sport-event-1' });

    expect(contests.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({ to: ContestStatus.ACTIVE }));
    const jobsOf = expectDefined(jest.mocked(contests.contests.transitionStatuses).mock.calls[0]?.[1].jobs);
    expect(jobsOf(['contest-1']).map((job) => job.type)).toEqual([BackgroundJobType.CONTEST_STARTED_EMAILS, BackgroundJobType.REBUILD_LEADERBOARDS]);
  });
});

describe('EventLifecycleService — the job that takes an event\'s contests live (#1952)', () => {
  it('takes no contest live once the event has moved back before its start, or is gone, and still does for one already completed', async () => {
    for (const status of [SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED, SportEventStatus.CANCELLED]) {
      const { sportEvents } = seededEvents({ status });
      const contests = contestDeps({ startedContest: true });

      // poolmaster-allow-query-in-loop: a unit test over a few statuses, against in-memory fakes
      expect(await lifecycleService(contests, sportEvents, fakeLogger()).activateEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 0 });
      expect(contests.contests.transitionStatuses).not.toHaveBeenCalled();
    }
    expect(await lifecycleService(contestDeps({ startedContest: true }), new InMemorySportEvents().sportEventRepo(), fakeLogger())
      .activateEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 0 });

    const { sportEvents } = seededEvents({ status: SportEventStatus.COMPLETED });
    expect(await lifecycleService(contestDeps({ startedContest: true }), sportEvents, fakeLogger()).activateEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 1 });
  });
});

describe('EventLifecycleService settling a decided game\'s squares contests in a job', () => {
  it('settles the game\'s contests when its job runs, at the moment the job carries, and lets a failure throw so the runner retries it', async () => {
    const settlement = fakeSettlement();
    const { sportEvents } = seededEvents({ status: SportEventStatus.IN_PROGRESS });
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement);
    const decidedAt = new Date('2026-05-02T23:30:00.000Z');
    const payload = { sportEventId: 'sport-event-1', sportEventRoundMatchId: 'game-1', completedAt: decidedAt.toISOString() };

    await service.settleFinishedGameContests(payload);
    expect(settlement.settleFinishedGame).toHaveBeenCalledWith('sport-event-1', 'game-1', { completedAt: decidedAt });

    settlement.settleFinishedGame.mockRejectedValueOnce(new Error('connection reset'));
    await expect(service.settleFinishedGameContests(payload)).rejects.toThrow('connection reset');
  });
});

describe('EventLifecycleService event change emails (#845 C6, C7)', () => {
  const changedNotice = recordingSportEventChangedNotice;

  it('writes the leagues\' postponed-event jobs with the POSTPONED status when the event first goes POSTPONED, and none on a repeated call', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', providerRef: { providerId: 'balldontlie', externalId: 'provider-event-1' }, name: 'Manual Test Golf Tournament', startDate: STARTED_EVENT_START, status: SportEventStatus.SCHEDULED });
    const notice = changedNotice();
    const jobs = startedJobs();
    const service = lifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), jobs, undefined, notice);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, actor: { type: 'ROOT_ADMIN' } });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, actor: { type: 'ROOT_ADMIN' } });

    expect(notice.sportEventChangedJobs).toHaveBeenCalledTimes(1);
    expect(notice.sportEventChangedJobs).toHaveBeenCalledWith(expect.objectContaining({ id: 'sport-event-1', startDate: STARTED_EVENT_START }), { kind: 'POSTPONED' }, { reopening: new Set() });
    // Each call still rebuilds the event's boards, and has its contests follow its start.
    expect(store.backgroundJobs).toEqual([followPostponedJob, eventChangedJob('sport-event-1', 'POSTPONED'), rebuildJob(), followPostponedJob, rebuildJob()]);
    expect(jobs.queued).toHaveBeenCalledTimes(2);
  });

  it('writes no postponed-event job when another caller postponed the event first, since that caller\'s move wrote them', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', providerRef: { providerId: 'balldontlie', externalId: 'provider-event-1' }, name: 'Manual Test Golf Tournament', startDate: STARTED_EVENT_START, status: SportEventStatus.SCHEDULED });
    const repo = store.sportEventRepo();
    const sportEvents = { ...repo, transitionStatus: mockFn<typeof repo.transitionStatus>(async () => null) };
    const jobs = startedJobs();
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger(), jobs, undefined, changedNotice());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, fromStatus: SportEventStatus.SCHEDULED, actor: { type: 'SYSTEM' },
    });

    expect(store.backgroundJobs).toEqual([]);
    expect(jobs.queued).not.toHaveBeenCalled();
  });

  it('fails the postponement, leaving the event SCHEDULED, when the contests to tell cannot be read, rather than postponing it with nobody told', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = changedNotice();
    notice.sportEventChangedJobs.mockRejectedValueOnce(new Error('database unavailable'));
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), undefined, notice);

    await expect(service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, actor: { type: 'ROOT_ADMIN' } }))
      .rejects.toThrow('database unavailable');

    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });

  it('writes the leagues\' cancelled-event jobs with the CANCELLED status, while the contests are still open, and none on a repeated call', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', providerRef: { providerId: 'balldontlie', externalId: 'provider-event-1' }, name: 'Manual Test Golf Tournament', startDate: STARTED_EVENT_START, status: SportEventStatus.SCHEDULED });
    const notice = changedNotice();
    const service = lifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), startedJobs(), undefined, notice);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.CANCELLED, actor: { type: 'ROOT_ADMIN' } });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.CANCELLED, actor: { type: 'ROOT_ADMIN' } });

    expect(notice.sportEventChangedJobs).toHaveBeenCalledTimes(1);
    expect(notice.sportEventChangedJobs).toHaveBeenCalledWith(expect.objectContaining({ id: 'sport-event-1', startDate: STARTED_EVENT_START }), { kind: 'CANCELLED' });
    expect(store.backgroundJobs.filter((job) => job.type === BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS)).toEqual([eventChangedJob('sport-event-1', 'CANCELLED')]);
  });

  it('settles a cancelled event\'s contests from its job without telling the leagues again, since the cancellation wrote their jobs', async () => {
    const settlement = fakeSettlement();
    const { sportEvents } = seededEvents({ status: SportEventStatus.CANCELLED });
    const notice = changedNotice();
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), settlement, notice);

    await service.settleFinishedEventContests({ sportEventId: 'sport-event-1', completedAt: new Date().toISOString() });

    expect(settlement.settleFinishedSportEvent).toHaveBeenCalledTimes(1);
    expect(notice.sportEventChangedJobs).not.toHaveBeenCalled();
  });

  it('tells nothing when an event starts or completes', async () => {
    const { sportEvents } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = changedNotice();
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger(), undefined, undefined, notice);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } });
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.COMPLETED, actor: { type: 'SYSTEM' } });

    expect(notice.sportEventChangedJobs).not.toHaveBeenCalled();
  });

  it('hands a moved event\'s edit the jobs that tell its leagues the previous start, and wakes the runner only when told the edit committed', async () => {
    const { sportEvents } = seededEvents();
    const notice = changedNotice();
    const jobs = startedJobs();
    const previousStart = new Date('2026-04-25T20:00:00.000Z');
    const moved = { id: 'sport-event-1', startDate: STARTED_EVENT_START };

    const told = await lifecycleService(contestDeps(), sportEvents, fakeLogger(), jobs, undefined, notice)
      .sportEventRescheduledJobs({ ...moved, status: SportEventStatus.SCHEDULED }, previousStart);

    expect(notice.sportEventChangedJobs).toHaveBeenCalledWith(moved, { kind: 'RESCHEDULED', previousStart }, { reopening: new Set() });
    expect(told.jobs).toEqual([eventChangedJob('sport-event-1', 'RESCHEDULED')]);
    expect(jobs.queued).not.toHaveBeenCalled();
    told.queued();
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('hands a moved event\'s edit no job when the service has no event-changed notice', async () => {
    const { sportEvents } = seededEvents();

    const told = await lifecycleService(contestDeps(), sportEvents, fakeLogger())
      .sportEventRescheduledJobs({ id: 'sport-event-1', startDate: STARTED_EVENT_START, status: SportEventStatus.SCHEDULED }, new Date('2026-04-25T20:00:00.000Z'));

    expect(told.jobs).toEqual([]);
    told.queued();
  });

  it('fails the cancellation, leaving the event SCHEDULED, when the contests to tell cannot be read, rather than cancelling it with nobody told', async () => {
    const { sportEvents, storedEvent } = seededEvents({ status: SportEventStatus.SCHEDULED });
    const notice = changedNotice();
    notice.sportEventChangedJobs.mockRejectedValueOnce(new Error('database unavailable'));
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger(), startedJobs(), undefined, notice);

    await expect(service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.CANCELLED, actor: { type: 'ROOT_ADMIN' } }))
      .rejects.toThrow('database unavailable');

    expect(storedEvent().status).toBe(SportEventStatus.SCHEDULED);
  });
});

describe('EventLifecycleService on an unknown event', () => {
  it('refuses with 404 SPORT_EVENT_NOT_FOUND and changes nothing', async () => {
    const { sportEvents, storedEvent } = seededEvents();
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger());

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
    const service = lifecycleService(contestDeps(), sportEvents, fakeLogger(), undefined, settlement);
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

describe('EventLifecycleService — leaderboard rebuild (#1466)', () => {
  it('writes the event\'s rebuild job with each status change and wakes the runner once the status is written', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', status: SportEventStatus.SCHEDULED });
    const jobs = startedJobs();
    const service = lifecycleService(contestDeps(), store.sportEventRepo(), fakeLogger(), jobs);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, actor: { type: 'ROOT_ADMIN' } });

    expect(store.backgroundJobs).toEqual([followPostponedJob, rebuildJob()]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('wakes no rebuild when another caller changed the status first, since that change wrote its own', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', status: SportEventStatus.SCHEDULED });
    const repo = store.sportEventRepo();
    const findById = repo.findById.bind(repo);
    jest.spyOn(repo, 'findById').mockImplementationOnce(async (id) => {
      const seen = await findById(id);
      await repo.transitionStatus(id, { from: SportEventStatus.SCHEDULED, to: SportEventStatus.IN_PROGRESS });
      return seen;
    });
    const jobs = startedJobs();
    const service = lifecycleService(contestDeps(), repo, fakeLogger(), jobs);

    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', fromStatus: SportEventStatus.SCHEDULED, toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' } });

    expect(store.backgroundJobs).toEqual([]);
    expect(jobs.queued).not.toHaveBeenCalled();
  });
});

describe('EventLifecycleService — a postponed event\'s contests follow its start', () => {
  const NOW = new Date('2026-05-02T21:00:00.000Z');
  const NEW_START = new Date('2026-05-09T20:00:00.000Z');
  const LIVE = buildContest({ ...STARTED_CONTEST, status: ContestStatus.ACTIVE });

  /** The postponed event, its start moved to `startDate`, and any other events the contests score. */
  function postponedEvents(startDate: Date, others: Array<Partial<SportEvent> & { id: string }> = []) {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'Week 6', startDate, status: SportEventStatus.POSTPONED });
    for (const other of others) store.addEvent({ name: other.id, startDate: NEW_START, status: SportEventStatus.SCHEDULED, ...other });
    return store.sportEventRepo();
  }

  function liveContests(contests: readonly Contest[], options: { games?: SportEventRoundMatch[]; configurations?: Array<{ contestId: string; configJson: unknown }> } = {}) {
    const deps = contestDeps();
    deps.contests.findBySportEvent = jest.fn().mockResolvedValue(contests);
    deps.configurations = fakeContestConfigurationRepo({ findByContests: jest.fn().mockResolvedValue(options.configurations ?? []) });
    deps.matches = { findBySportEvent: jest.fn().mockResolvedValue(options.games ?? []) };
    return deps;
  }

  async function follow(deps: EventLifecycleContestDeps, sportEvents: ReturnType<typeof postponedEvents>) {
    await lifecycleService(deps, sportEvents, fakeLogger()).followPostponedStart(expectDefined(await sportEvents.findById('sport-event-1')), NOW);
  }

  it('takes a live contest back to OPEN, so it takes entries and pick changes, when its postponed event has not started', async () => {
    const deps = liveContests([LIVE]);

    await follow(deps, postponedEvents(NEW_START));

    expect(deps.contests.findBySportEvent).toHaveBeenCalledWith('sport-event-1', { statuses: [ContestStatus.ACTIVE] });
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({ from: [ContestStatus.ACTIVE], to: ContestStatus.OPEN, startsAt: NEW_START }));
  });

  it('writes the job that reopens the live contests with the postponement, and the job reopens them without waiting for the next sweep', async () => {
    const store = new InMemorySportEvents();
    // The transition reads the clock, so the moved start is a week from now.
    store.addEvent({ id: 'sport-event-1', name: 'Week 6', startDate: new Date(Date.now() + 7 * 24 * 60 * 60_000), status: SportEventStatus.IN_PROGRESS });
    const deps = liveContests([LIVE]);
    const service = lifecycleService(deps, store.sportEventRepo(), fakeLogger());

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.POSTPONED,
      actor: { type: 'ROOT_ADMIN' },
    });

    // The postponement moves no contest itself: its job does, once the change has committed (#1952).
    expect(deps.contests.transitionStatuses).not.toHaveBeenCalled();
    expect(store.backgroundJobs).toContainEqual(followPostponedJob);
    expect(await service.followPostponedEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 1 });
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({ from: [ContestStatus.ACTIVE], to: ContestStatus.OPEN }));
  });

  it('moves no contest from a postponement\'s job once the event is no longer postponed, since its own change queued what follows it', async () => {
    const deps = liveContests([LIVE]);
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'Week 6', startDate: NEW_START, status: SportEventStatus.SCHEDULED });

    expect(await lifecycleService(deps, store.sportEventRepo(), fakeLogger()).followPostponedEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 0 });
    expect(await lifecycleService(deps, new InMemorySportEvents().sportEventRepo(), fakeLogger()).followPostponedEventContests({ sportEventId: 'sport-event-1' })).toEqual({ changedCount: 0 });
    expect(deps.contests.transitionStatuses).not.toHaveBeenCalled();
  });

  it('keeps live a season contest whose earlier event has started, and reopens one whose every event is still ahead, starting at its first event', async () => {
    const season = buildContest({ ...LIVE, id: 'contest-season', sportEventIds: ['sport-event-0', 'sport-event-1'] });
    const ahead = buildContest({ ...LIVE, id: 'contest-ahead', sportEventIds: ['sport-event-1', 'sport-event-2'] });
    const earlierWeek = new Date('2026-05-05T20:00:00.000Z');
    const sportEvents = postponedEvents(NEW_START, [
      { id: 'sport-event-0', startDate: new Date('2026-04-25T20:00:00.000Z'), status: SportEventStatus.COMPLETED },
      { id: 'sport-event-2', startDate: earlierWeek },
    ]);
    const deps = liveContests([season, ahead]);

    await follow(deps, sportEvents);

    expect(deps.contests.transitionStatuses).toHaveBeenCalledTimes(1);
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-ahead'], expect.objectContaining({ to: ContestStatus.OPEN, startsAt: earlierWeek }));
  });

  it('reopens a season contest whose first week moved past its second week\'s start, from the second week\'s start, while that week is still ahead', async () => {
    const weekTwoStart = new Date('2026-05-05T20:00:00.000Z');
    const season = buildContest({ ...LIVE, id: 'contest-season', sportEventIds: ['sport-event-1', 'sport-event-2'] });
    const deps = liveContests([season]);

    await follow(deps, postponedEvents(NEW_START, [{ id: 'sport-event-2', startDate: weekTwoStart }]));

    expect(weekTwoStart.getTime()).toBeLessThan(NEW_START.getTime());
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-season'], expect.objectContaining({ to: ContestStatus.OPEN, startsAt: weekTwoStart }));
  });

  it('keeps a season contest live once the week after its postponed first week has started', async () => {
    const season = buildContest({ ...LIVE, id: 'contest-season', sportEventIds: ['sport-event-1', 'sport-event-2'] });
    const deps = liveContests([season]);

    await follow(deps, postponedEvents(NEW_START, [{ id: 'sport-event-2', startDate: new Date(NOW.getTime() - 60_000), status: SportEventStatus.IN_PROGRESS }]));

    expect(deps.contests.transitionStatuses).not.toHaveBeenCalled();
  });

  it('reopens the contests starting at the same moment in one write', async () => {
    const second = buildContest({ ...LIVE, id: 'contest-2', leagueId: 'league-2' });
    const deps = liveContests([LIVE, second]);

    await follow(deps, postponedEvents(NEW_START));

    expect(deps.contests.transitionStatuses).toHaveBeenCalledTimes(1);
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1', 'contest-2'], expect.objectContaining({ startsAt: NEW_START }));
  });

  it('keeps live a squares contest and a contest whose draw dealt its picks, and reopens a bracket, reading no rules to decide', async () => {
    const squares = buildContest({ ...LIVE, id: 'contest-squares', selectionType: SelectionType.SQUARES, squaresGameMatchId: 'game-1' });
    const drawn = buildContest({ ...LIVE, id: 'contest-drawn', drawnAt: new Date('2026-05-01T00:00:00.000Z') });
    const fullBracket = buildContest({ ...LIVE, id: 'contest-full-bracket', selectionType: SelectionType.BRACKET });
    const deps = liveContests([squares, drawn, fullBracket], {
      configurations: [{ contestId: fullBracket.id, configJson: { selectionType: SelectionType.BRACKET } }],
    });

    await follow(deps, postponedEvents(NEW_START));

    expect(deps.configurations.findByContests).not.toHaveBeenCalled();
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith([fullBracket.id], expect.objectContaining({ to: ContestStatus.OPEN }));
  });

  it('keeps every contest live when a game of the event was already under way before the postponement', async () => {
    const deps = liveContests([LIVE], {
      games: [legacyMatch({ id: 'game-1', sportEventId: 'sport-event-1', roundNumber: 1, slot: slotOfRound(1), status: MatchStatus.IN_PROGRESS, scheduledDate: NEW_START })],
    });

    await follow(deps, postponedEvents(NEW_START));

    expect(deps.contests.transitionStatuses).not.toHaveBeenCalled();
  });

  it('still reopens when the event\'s games are scheduled or postponed themselves, none of them begun', async () => {
    const deps = liveContests([LIVE], {
      games: [
        legacyMatch({ id: 'game-1', sportEventId: 'sport-event-1', roundNumber: 1, slot: slotOfRound(1), status: MatchStatus.SCHEDULED, scheduledDate: NEW_START }),
        legacyMatch({ id: 'game-2', sportEventId: 'sport-event-1', roundNumber: 1, slot: slotOfRound(1), status: MatchStatus.POSTPONED, scheduledDate: NEW_START }),
      ],
    });

    await follow(deps, postponedEvents(NEW_START));

    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({ to: ContestStatus.OPEN }));
  });

  it('writes one "Picks are open again" job with each contest it reopens, keyed by the new start, and wakes the runner once', async () => {
    const second = buildContest({ ...LIVE, id: 'contest-2', leagueId: 'league-2' });
    const deps = liveContests([LIVE, second]);
    const written: unknown[] = [];
    // contest-2 went live again, or reopened, between the read and the guarded write.
    deps.contests.transitionStatuses = guardedMove(written, (ids) => ids.filter((id) => id === 'contest-1'));
    const jobs = startedJobs();
    const sportEvents = postponedEvents(NEW_START);

    await lifecycleService(deps, sportEvents, fakeLogger(), jobs)
      .followPostponedStart(expectDefined(await sportEvents.findById('sport-event-1')), NOW);

    expect(written).toEqual([{
      type: BackgroundJobType.CONTEST_REOPENED_EMAILS,
      payload: { contestId: 'contest-1', sportEventId: 'sport-event-1', startsAt: NEW_START.toISOString() },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: `CONTEST_REOPENED_EMAILS:contest-1:sport-event-1:reopened-${NEW_START.toISOString()}`,
    }, contestRebuildJob('contest-1')]);
    expect(jobs.queued).toHaveBeenCalledTimes(1);
  });

  it('leaves out of the postponement\'s event changed jobs the live contests it reopens, so their members get the one picks are open again email', async () => {
    const store = new InMemorySportEvents();
    const newStart = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    store.addEvent({ id: 'sport-event-1', name: 'Week 6', startDate: newStart, status: SportEventStatus.IN_PROGRESS });
    const squares = buildContest({ ...LIVE, id: 'contest-squares', selectionType: SelectionType.SQUARES, squaresGameMatchId: 'game-1' });
    const deps = liveContests([LIVE, squares]);
    const notice = recordingSportEventChangedNotice();

    const service = lifecycleService(deps, store.sportEventRepo(), fakeLogger(), startedJobs(), undefined, notice);
    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.POSTPONED,
      actor: { type: 'ROOT_ADMIN' },
    });
    await service.followPostponedEventContests({ sportEventId: 'sport-event-1' });

    expect(notice.sportEventChangedJobs).toHaveBeenCalledWith(expect.objectContaining({ id: 'sport-event-1' }), { kind: 'POSTPONED' }, { reopening: new Set(['contest-1']) });
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({ to: ContestStatus.OPEN }));
  });

  it('fails the postponement\'s job when its reopen write fails, and its retry sends the picks are open again email, so a contest left out of the event changed jobs is told', async () => {
    const store = new InMemorySportEvents();
    store.addEvent({ id: 'sport-event-1', name: 'Week 6', startDate: new Date(Date.now() + 7 * 24 * 60 * 60_000), status: SportEventStatus.IN_PROGRESS });
    const sportEvents = store.sportEventRepo();
    const deps = liveContests([LIVE]);
    const written: unknown[] = [];
    const move = guardedMove(written);
    deps.contests.transitionStatuses = mockFn<ContestRepository['transitionStatuses']>(async () => { throw new Error('database unavailable'); });
    const service = lifecycleService(deps, sportEvents, fakeLogger(), startedJobs(), undefined, recordingSportEventChangedNotice());

    // The postponement itself lands: the reopen is its job's.
    await service.applySportEventStatusTransition({ sportEventId: 'sport-event-1', toStatus: SportEventStatus.POSTPONED, actor: { type: 'ROOT_ADMIN' } });
    await expect(service.followPostponedEventContests({ sportEventId: 'sport-event-1' })).rejects.toThrow('database unavailable');

    deps.contests.transitionStatuses = move;
    await service.followPostponedEventContests({ sportEventId: 'sport-event-1' });

    expect((written as Array<{ type: string; payload: { contestId?: string; id?: string } }>).map(({ type, payload }) => [type, payload.contestId ?? payload.id]))
      .toEqual([[BackgroundJobType.CONTEST_REOPENED_EMAILS, 'contest-1'], [BackgroundJobType.REBUILD_LEADERBOARDS, 'contest-1']]);
  });

  it('leaves out of a postponed event\'s moved start the live contests the new start reopens, and tells every contest of a scheduled event\'s move', async () => {
    const newStart = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const previousStart = new Date('2026-05-02T20:00:00.000Z');
    const notice = recordingSportEventChangedNotice();
    const postponed = lifecycleService(liveContests([LIVE]), postponedEvents(previousStart), fakeLogger(), startedJobs(), undefined, notice);

    await postponed.sportEventRescheduledJobs({ id: 'sport-event-1', startDate: newStart, status: SportEventStatus.POSTPONED }, previousStart);

    expect(notice.sportEventChangedJobs).toHaveBeenLastCalledWith({ id: 'sport-event-1', startDate: newStart }, { kind: 'RESCHEDULED', previousStart }, { reopening: new Set(['contest-1']) });

    const scheduled = seededEvents({ startDate: previousStart });
    await lifecycleService(liveContests([LIVE]), scheduled.sportEvents, fakeLogger(), startedJobs(), undefined, notice)
      .sportEventRescheduledJobs({ id: 'sport-event-1', startDate: newStart, status: SportEventStatus.SCHEDULED }, previousStart);

    expect(notice.sportEventChangedJobs).toHaveBeenLastCalledWith({ id: 'sport-event-1', startDate: newStart }, { kind: 'RESCHEDULED', previousStart }, { reopening: new Set() });
  });

  it('writes no job and wakes nothing when the guarded write finds no contest still live', async () => {
    const deps = liveContests([LIVE]);
    const written: unknown[] = [];
    deps.contests.transitionStatuses = guardedMove(written, () => []);
    const jobs = startedJobs();
    const sportEvents = postponedEvents(NEW_START);

    await lifecycleService(deps, sportEvents, fakeLogger(), jobs)
      .followPostponedStart(expectDefined(await sportEvents.findById('sport-event-1')), NOW);

    expect(written).toEqual([]);
    expect(jobs.queued).not.toHaveBeenCalled();
  });

  it('writes nothing when no contest on the postponed event is live', async () => {
    const deps = liveContests([]);

    await follow(deps, postponedEvents(NEW_START));

    expect(deps.matches.findBySportEvent).not.toHaveBeenCalled();
    expect(deps.contests.transitionStatuses).not.toHaveBeenCalled();
  });

  it('starts the open contests once the postponed event\'s start has passed, as at any start', async () => {
    const deps = liveContests([STARTED_CONTEST]);
    const passed = new Date(NOW.getTime() - 60_000);

    await follow(deps, postponedEvents(passed));

    expect(deps.contests.findBySportEvent).toHaveBeenCalledWith('sport-event-1', { statuses: [ContestStatus.OPEN] });
    expect(deps.contests.transitionStatuses).toHaveBeenCalledWith(['contest-1'], expect.objectContaining({
      from: [ContestStatus.OPEN],
      to: ContestStatus.ACTIVE,
      startsAt: passed,
    }));
  });
});
