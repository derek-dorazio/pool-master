import { BackgroundJobType, ContestStatus, SPORT_EVENT_STATUS_TRANSITIONS, SportEventStatus, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import {
  DOMAIN_EVENT_HANDLERS,
  DomainEventType,
  DomainEvents,
  type ContestStatusChanged,
  type DomainEventHandler,
  type DomainEventHandlerContext,
  type DomainEventHandlerMap,
  type SportEventRescheduled,
  type SportEventStatusChanged,
} from '../../../packages/core-api/src/modules/domain-events';
import {
  DOMAIN_EVENT_TABLE_END,
  DOMAIN_EVENT_TABLE_START,
  renderDomainEventTable,
  withDomainEventTable,
} from '../../../packages/core-api/src/modules/domain-events/domain-event-table';
import { inMemoryBackgroundJobs, TEST_JOB_START, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { NOBODY_TOLD, NO_TEMPLATE_CONTESTS } from '../../support/domain-events';
import { eventChangedJob, recordingSportEventChangedNotice } from '../../support/sport-event-changed-notice';
import { mockFn } from '../../support/mock-fn';

const START = new Date('2026-05-02T20:00:00.000Z');
const SETTLE_AT = new Date('2026-05-04T23:00:00.000Z');

function statusChanged(from: SportEventStatus, to: SportEventStatus, overrides: Partial<SportEventStatusChanged> = {}): SportEventStatusChanged {
  return {
    type: DomainEventType.SPORT_EVENT_STATUS_CHANGED,
    sportEvent: { id: 'sport-event-1', startDate: START, eventSeriesId: 'series-1', eventYear: 2026 },
    from,
    to,
    settleAt: SETTLE_AT,
    reopeningContestIds: new Set(),
    ...overrides,
  };
}

function rescheduled(status: SportEventStatus, reopening: ReadonlySet<string> = new Set()): SportEventRescheduled {
  return {
    type: DomainEventType.SPORT_EVENT_RESCHEDULED,
    sportEvent: { id: 'sport-event-1', startDate: START, status },
    previousStart: new Date('2026-04-25T20:00:00.000Z'),
    reopeningContestIds: reopening,
  };
}

function contestChanged(from: readonly ContestStatus[], to: ContestStatus, overrides: Partial<ContestStatusChanged> = {}): ContestStatusChanged {
  return { type: DomainEventType.CONTEST_STATUS_CHANGED, contest: { id: 'contest-1' }, from, to, sportEventId: 'sport-event-1', ...overrides };
}

/** A real queue over the in-memory job table, whose wake is watched. */
function watchedQueue() {
  const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart });
  jest.spyOn(queue, 'queued');
  return queue;
}

/** Template contests a release joins: one job per contest named. */
function templateContests(contestIds: readonly string[]) {
  return {
    releasedEditionJobs: mockFn<typeof NO_TEMPLATE_CONTESTS.releasedEditionJobs>(async (sportEvent, jobs) => contestIds.map((contestId) =>
      jobs.request(BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST, { contestId, sportEventId: sportEvent.id }))),
  };
}

function domainEvents(overrides: Partial<ConstructorParameters<typeof DomainEvents>[0]> = {}) {
  const queue = overrides.queue ?? watchedQueue();
  return {
    queue,
    events: new DomainEvents({ queue, releasedEditionContests: NO_TEMPLATE_CONTESTS, sportEventChanged: NOBODY_TOLD, ...overrides }),
  };
}

const typesOf = (jobs: readonly BackgroundJobRequest[]) => jobs.map((job) => job.type);

describe('DOMAIN_EVENT_HANDLERS, the one map of what follows each change', () => {
  it('is pinned: adding, removing or reordering a follow-up changes this list, so it shows in review', () => {
    const pinned = Object.fromEntries(Object.entries(DOMAIN_EVENT_HANDLERS).map(([type, handlers]) => [type, handlers.map((handler) => handler.key)]));

    expect(pinned).toEqual({
      SPORT_EVENT_STATUS_CHANGED: [
        'settle-finished-event-contests',
        'release-into-template-contests',
        'tell-leagues-event-postponed',
        'rebuild-event-leaderboards',
      ],
      SPORT_EVENT_RESCHEDULED: ['tell-leagues-event-rescheduled'],
      CONTEST_STATUS_CHANGED: [
        'tell-league-contest-started',
        'tell-league-contest-reopened',
        'tell-league-contest-settled',
      ],
    });
  });

  it('has an entry for every domain event type, and no entry for a type that does not exist', () => {
    expect(Object.keys(DOMAIN_EVENT_HANDLERS).sort()).toEqual(Object.values(DomainEventType).sort());
  });

  it('gives every handler a key of its own, so the pin and the generated table name each one once', () => {
    const keys = Object.values(DOMAIN_EVENT_HANDLERS).flatMap((handlers) => handlers.map((handler) => handler.key));

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('queues only job types each handler declares, for every status change the model allows, so the generated table is the truth', async () => {
    const { events } = domainEvents({ releasedEditionContests: templateContests(['contest-1']), sportEventChanged: recordingSportEventChangedNotice() });
    const declared = new Set(DOMAIN_EVENT_HANDLERS.SPORT_EVENT_STATUS_CHANGED.flatMap((handler) => handler.queues));
    const declaredRescheduled = new Set(DOMAIN_EVENT_HANDLERS.SPORT_EVENT_RESCHEDULED.flatMap((handler) => handler.queues));

    for (const [from, targets] of Object.entries(SPORT_EVENT_STATUS_TRANSITIONS) as [SportEventStatus, readonly SportEventStatus[]][]) {
      for (const to of targets) {
        // poolmaster-allow-query-in-loop: a unit test over the model's declared transitions, no database
        for (const type of typesOf((await events.collect(statusChanged(from, to))).jobs)) expect(declared).toContain(type);
      }
    }
    for (const status of Object.values(SportEventStatus)) {
      // poolmaster-allow-query-in-loop: a unit test over every status, no database
      for (const type of typesOf((await events.collect(rescheduled(status))).jobs)) expect(declaredRescheduled).toContain(type);
    }
    const declaredContest = new Set(DOMAIN_EVENT_HANDLERS.CONTEST_STATUS_CHANGED.flatMap((handler) => handler.queues));
    for (const from of Object.values(ContestStatus)) {
      for (const to of Object.values(ContestStatus)) {
        // poolmaster-allow-query-in-loop: a unit test over every pair of contest statuses, no database
        const jobs = (await events.collect(contestChanged([from], to, { startsAt: START }))).jobs;
        for (const type of typesOf(jobs)) expect(declaredContest).toContain(type);
      }
    }
  });
});

describe('SPORT_EVENT_STATUS_CHANGED handlers', () => {
  const handler = (key: string): DomainEventHandler<typeof DomainEventType.SPORT_EVENT_STATUS_CHANGED> => {
    const found = DOMAIN_EVENT_HANDLERS.SPORT_EVENT_STATUS_CHANGED.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`No handler ${key}`);
    return found;
  };
  const context = () => ({ queue: watchedQueue(), releasedEditionContests: templateContests(['contest-1', 'contest-2']), sportEventChanged: recordingSportEventChangedNotice() });

  it('settles the contests of an event that completes or is cancelled, at the moment the event carries, and of no other change', async () => {
    const settle = handler('settle-finished-event-contests');

    for (const to of [SportEventStatus.COMPLETED, SportEventStatus.CANCELLED]) {
      const event = statusChanged(SportEventStatus.IN_PROGRESS, to);
      expect(settle.when?.(event)).toBe(true);
      expect(await settle.jobs(event, context())).toEqual([{
        type: BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS,
        payload: { sportEventId: 'sport-event-1', completedAt: SETTLE_AT.toISOString() },
        sportEventId: 'sport-event-1',
        runAt: undefined,
        start: TEST_JOB_START,
        dedupeKey: 'SETTLE_SPORT_EVENT_CONTESTS:sport-event-1',
      }]);
    }
    expect(settle.when?.(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS))).toBe(false);
    expect(settle.when?.(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED))).toBe(false);
  });

  it('joins a released edition to its template contests on the release alone, DRAFT to SCHEDULED', async () => {
    const release = handler('release-into-template-contests');
    const ctx = context();

    expect(release.when?.(statusChanged(SportEventStatus.DRAFT, SportEventStatus.SCHEDULED))).toBe(true);
    expect(release.when?.(statusChanged(SportEventStatus.POSTPONED, SportEventStatus.SCHEDULED))).toBe(false);
    expect(release.when?.(statusChanged(SportEventStatus.DRAFT, SportEventStatus.CANCELLED))).toBe(false);
    const jobs = await release.jobs(statusChanged(SportEventStatus.DRAFT, SportEventStatus.SCHEDULED), ctx);

    expect(ctx.releasedEditionContests.releasedEditionJobs).toHaveBeenCalledWith(
      { id: 'sport-event-1', startDate: START, eventSeriesId: 'series-1', eventYear: 2026 },
      ctx.queue,
    );
    expect(jobs.map((job) => job.payload)).toEqual([
      { contestId: 'contest-1', sportEventId: 'sport-event-1' },
      { contestId: 'contest-2', sportEventId: 'sport-event-1' },
    ]);
  });

  it('tells the leagues of a first postponement, leaving out the contests it reopens, and not of a repeated one', async () => {
    const postponed = handler('tell-leagues-event-postponed');
    const ctx = context();
    const event = statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED, { reopeningContestIds: new Set(['contest-live']) });

    expect(postponed.when?.(event)).toBe(true);
    expect(postponed.when?.(statusChanged(SportEventStatus.POSTPONED, SportEventStatus.POSTPONED))).toBe(false);
    expect(postponed.when?.(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS))).toBe(false);
    expect(await postponed.jobs(event, ctx)).toEqual([eventChangedJob('sport-event-1', 'POSTPONED')]);
    expect(ctx.sportEventChanged.sportEventChangedJobs).toHaveBeenCalledWith(
      event.sportEvent,
      { kind: 'POSTPONED' },
      { reopening: new Set(['contest-live']) },
    );
  });

  it('rebuilds the event\'s boards on every status change', async () => {
    const rebuild = handler('rebuild-event-leaderboards');

    expect(rebuild.when).toBeUndefined();
    expect(await rebuild.jobs(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS), context())).toEqual([{
      type: BackgroundJobType.REBUILD_LEADERBOARDS,
      payload: { subject: 'EVENT', id: 'sport-event-1' },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'REBUILD_LEADERBOARDS:EVENT:sport-event-1',
    }]);
  });
});

describe('SPORT_EVENT_RESCHEDULED handlers', () => {
  const [tell] = DOMAIN_EVENT_HANDLERS.SPORT_EVENT_RESCHEDULED;

  it('tells the leagues on a released event whose start moved, with the previous start, leaving out the contests the new start reopens', async () => {
    const notice = recordingSportEventChangedNotice();
    const event = rescheduled(SportEventStatus.POSTPONED, new Set(['contest-live']));

    expect(await tell.jobs(event, { queue: watchedQueue(), releasedEditionContests: NO_TEMPLATE_CONTESTS, sportEventChanged: notice }))
      .toEqual([eventChangedJob('sport-event-1', 'RESCHEDULED')]);
    expect(notice.sportEventChangedJobs).toHaveBeenCalledWith(
      { id: 'sport-event-1', startDate: START },
      { kind: 'RESCHEDULED', previousStart: event.previousStart },
      { reopening: new Set(['contest-live']) },
    );
  });

  it('tells the leagues of a scheduled or postponed event only: a draft\'s commissioners cannot see it, and a started event\'s picks are closed', () => {
    const told = Object.values(SportEventStatus).filter((status) => tell.when?.(rescheduled(status)));

    expect(told.sort()).toEqual([SportEventStatus.POSTPONED, SportEventStatus.SCHEDULED].sort());
  });
});

describe('CONTEST_STATUS_CHANGED handlers', () => {
  const handler = (key: string): DomainEventHandler<typeof DomainEventType.CONTEST_STATUS_CHANGED> => {
    const found = DOMAIN_EVENT_HANDLERS.CONTEST_STATUS_CHANGED.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`No handler ${key}`);
    return found;
  };
  const context = () => ({ queue: watchedQueue(), releasedEditionContests: NO_TEMPLATE_CONTESTS, sportEventChanged: NOBODY_TOLD });
  const told = (event: ContestStatusChanged) => DOMAIN_EVENT_HANDLERS.CONTEST_STATUS_CHANGED
    .filter((candidate) => candidate.when?.(event) ?? true).map((candidate) => candidate.key);

  it('tells the league "Contest is live" for an open contest its event\'s start took live, keyed once per contest', async () => {
    const started = handler('tell-league-contest-started');
    const event = contestChanged([ContestStatus.OPEN], ContestStatus.ACTIVE);

    expect(started.when?.(event)).toBe(true);
    expect(await started.jobs(event, context())).toEqual([{
      type: BackgroundJobType.CONTEST_STARTED_EMAILS,
      payload: { contestId: 'contest-1', sportEventId: 'sport-event-1' },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'CONTEST_STARTED_EMAILS:contest-1',
    }]);
  });

  it('tells the league its picks are open again for a live contest a postponement reopened, with the start they close at', async () => {
    const reopened = handler('tell-league-contest-reopened');
    const event = contestChanged([ContestStatus.ACTIVE], ContestStatus.OPEN, { startsAt: START });

    expect(reopened.when?.(event)).toBe(true);
    expect(await reopened.jobs(event, context())).toEqual([{
      type: BackgroundJobType.CONTEST_REOPENED_EMAILS,
      payload: { contestId: 'contest-1', sportEventId: 'sport-event-1', startsAt: START.toISOString() },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: `CONTEST_REOPENED_EMAILS:contest-1:sport-event-1:reopened-${START.toISOString()}`,
    }]);
  });

  it('tells the league its final results for a contest settlement completed, from any status it settles from', async () => {
    const settled = handler('tell-league-contest-settled');
    const event = contestChanged([ContestStatus.OPEN, ContestStatus.ACTIVE], ContestStatus.COMPLETED, { sportEventId: undefined });

    expect(settled.when?.(event)).toBe(true);
    expect(await settled.jobs(event, context())).toEqual([{
      type: BackgroundJobType.CONTEST_SETTLED_EMAILS,
      payload: { contestId: 'contest-1' },
      sportEventId: undefined,
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'CONTEST_SETTLED_EMAILS:contest-1',
    }]);
  });

  it('queues nothing when a commissioner opens a draft: its reminders start from the move itself', () => {
    expect(told(contestChanged([ContestStatus.DRAFT], ContestStatus.OPEN, { sportEventId: undefined }))).toEqual([]);
  });

  it('runs exactly one handler for each move it tells, and none for a move it does not', () => {
    expect(told(contestChanged([ContestStatus.OPEN], ContestStatus.ACTIVE))).toEqual(['tell-league-contest-started']);
    expect(told(contestChanged([ContestStatus.ACTIVE], ContestStatus.OPEN, { startsAt: START }))).toEqual(['tell-league-contest-reopened']);
    expect(told(contestChanged([ContestStatus.ACTIVE], ContestStatus.COMPLETED))).toEqual(['tell-league-contest-settled']);
    expect(told(contestChanged([ContestStatus.DRAFT], ContestStatus.ACTIVE))).toEqual([]);
  });

  it('fails the move of a contest that went live or reopened without the event that moved it, rather than queue an email naming none', () => {
    expect(() => handler('tell-league-contest-started').jobs(contestChanged([ContestStatus.OPEN], ContestStatus.ACTIVE, { sportEventId: undefined }), context()))
      .toThrow('without the sport event that moved it');
    expect(() => handler('tell-league-contest-reopened').jobs(contestChanged([ContestStatus.ACTIVE], ContestStatus.OPEN, { sportEventId: undefined, startsAt: START }), context()))
      .toThrow('without the sport event that moved it');
    expect(() => handler('tell-league-contest-reopened').jobs(contestChanged([ContestStatus.ACTIVE], ContestStatus.OPEN), context()))
      .toThrow('without the start its picks close at again');
  });

  it('reads nothing: collecting the moves of many contests at once costs no read per contest', async () => {
    const refuse = () => { throw new Error('A contest status handler read through its context'); };
    const noReads: Omit<DomainEventHandlerContext, 'queue'> = {
      releasedEditionContests: { releasedEditionJobs: refuse },
      sportEventChanged: { sportEventChangedJobs: refuse },
    };
    const { events } = domainEvents(noReads);
    const contestIds = Array.from({ length: 20 }, (_, index) => `contest-${index}`);

    const batch = await events.collectEach(
      contestIds.map((id) => contestChanged([ContestStatus.OPEN], ContestStatus.ACTIVE, { contest: { id } })),
      (event) => event.contest.id,
    );

    expect(typesOf(batch.jobsFor(contestIds))).toEqual(contestIds.map(() => BackgroundJobType.CONTEST_STARTED_EMAILS));
  });
});

describe('DomainEvents.collect', () => {
  it('collects the jobs of each handler whose `when` takes the event, in map order, and wakes the runner only once told the write committed', async () => {
    const { queue, events } = domainEvents({ releasedEditionContests: templateContests(['contest-1']) });

    const collected = await events.collect(statusChanged(SportEventStatus.DRAFT, SportEventStatus.SCHEDULED));

    expect(typesOf(collected.jobs)).toEqual([BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST, BackgroundJobType.REBUILD_LEADERBOARDS]);
    expect(queue.queued).not.toHaveBeenCalled();
    collected.queued();
    expect(queue.queued).toHaveBeenCalledTimes(1);
  });

  it('collects nothing and wakes nothing for an event none of its handlers take', async () => {
    const { queue, events } = domainEvents();

    const collected = await events.collect(rescheduled(SportEventStatus.DRAFT));
    collected.queued();

    expect(collected.jobs).toEqual([]);
    expect(queue.queued).not.toHaveBeenCalled();
  });

  it('fails the collection when a handler\'s read fails, so the writer makes no change without its follow-ups', async () => {
    const notice = recordingSportEventChangedNotice();
    notice.sportEventChangedJobs.mockRejectedValueOnce(new Error('database unavailable'));
    const { events } = domainEvents({ sportEventChanged: notice });

    await expect(events.collect(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED))).rejects.toThrow('database unavailable');
  });
});

describe('DomainEvents.collectEach, for a guarded batch write', () => {
  const events: SportEventRescheduled[] = [
    { ...rescheduled(SportEventStatus.SCHEDULED), sportEvent: { id: 'event-a', startDate: START, status: SportEventStatus.SCHEDULED } },
    { ...rescheduled(SportEventStatus.SCHEDULED), sportEvent: { id: 'event-b', startDate: START, status: SportEventStatus.SCHEDULED } },
  ];

  it('hands the write the jobs of only the subjects it moved, and wakes the runner once it committed', async () => {
    const { queue, events: domain } = domainEvents({ sportEventChanged: recordingSportEventChangedNotice() });

    const batch = await domain.collectEach(events, (event) => event.sportEvent.id);

    expect(batch.jobsFor(['event-b'])).toEqual([eventChangedJob('event-b', 'RESCHEDULED')]);
    batch.queued();
    expect(queue.queued).toHaveBeenCalledTimes(1);
  });

  it('wakes nothing when the write moved none of its subjects', async () => {
    const { queue, events: domain } = domainEvents({ sportEventChanged: recordingSportEventChangedNotice() });

    const batch = await domain.collectEach(events, (event) => event.sportEvent.id);

    expect(batch.jobsFor([])).toEqual([]);
    batch.queued();
    expect(queue.queued).not.toHaveBeenCalled();
  });

  it('keeps every event\'s jobs when two events are about one subject', async () => {
    const { events: domain } = domainEvents({ sportEventChanged: recordingSportEventChangedNotice() });
    const twice: SportEventRescheduled[] = [events[0], { ...events[0], previousStart: new Date('2026-04-18T20:00:00.000Z') }];

    const batch = await domain.collectEach(twice, (event) => event.sportEvent.id);

    expect(batch.jobsFor(['event-a'])).toHaveLength(2);
  });
});

describe('The generated domain event table in docs/BACKGROUND-JOBS.md', () => {
  it('lists every handler in map order with the job types it queues', () => {
    expect(renderDomainEventTable(DOMAIN_EVENT_HANDLERS)).toBe([
      DOMAIN_EVENT_TABLE_START,
      '| Domain event | Handler | Queues |',
      '|---|---|---|',
      '| `SPORT_EVENT_STATUS_CHANGED` | `settle-finished-event-contests` | `SETTLE_SPORT_EVENT_CONTESTS` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `release-into-template-contests` | `ADD_RELEASED_EDITION_TO_CONTEST` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `tell-leagues-event-postponed` | `CONTEST_EVENT_CHANGED_EMAILS` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `rebuild-event-leaderboards` | `REBUILD_LEADERBOARDS` |',
      '| `SPORT_EVENT_RESCHEDULED` | `tell-leagues-event-rescheduled` | `CONTEST_EVENT_CHANGED_EMAILS` |',
      '| `CONTEST_STATUS_CHANGED` | `tell-league-contest-started` | `CONTEST_STARTED_EMAILS` |',
      '| `CONTEST_STATUS_CHANGED` | `tell-league-contest-reopened` | `CONTEST_REOPENED_EMAILS` |',
      '| `CONTEST_STATUS_CHANGED` | `tell-league-contest-settled` | `CONTEST_SETTLED_EMAILS` |',
      DOMAIN_EVENT_TABLE_END,
    ].join('\n'));
  });

  it('says so on purpose for an event type nothing follows', () => {
    const nothingFollows: DomainEventHandlerMap = { SPORT_EVENT_STATUS_CHANGED: [], SPORT_EVENT_RESCHEDULED: [], CONTEST_STATUS_CHANGED: [] };

    expect(renderDomainEventTable(nothingFollows)).toContain('| `SPORT_EVENT_RESCHEDULED` | none | none |');
  });

  it('replaces only the table between its markers, and refuses a document without them', () => {
    const document = `before\n${DOMAIN_EVENT_TABLE_START}\nstale\n${DOMAIN_EVENT_TABLE_END}\nafter`;

    expect(withDomainEventTable(document, 'TABLE')).toBe('before\nTABLE\nafter');
    expect(() => withDomainEventTable('no markers here', 'TABLE')).toThrow('markers are missing');
  });
});
