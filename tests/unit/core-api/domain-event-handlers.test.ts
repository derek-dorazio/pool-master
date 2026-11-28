import { BackgroundJobType, ContestEntryStatus, ContestStatus, SeasonSlotStatus, SPORT_EVENT_STATUS_TRANSITIONS, SportEventStatus, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import {
  DOMAIN_EVENT_HANDLERS,
  DomainEventType,
  DomainEvents,
  type ContestEntryEventStatusChanged,
  type ContestStatusChanged,
  type DomainEventHandler,
  type DomainEventHandlerContext,
  type DomainEventHandlerMap,
  type GameDecided,
  type SportEventFieldSynced,
  type SportEventRescheduled,
  type SportEventResultsChanged,
  type SportEventStatusChanged,
} from '../../../packages/core-api/src/modules/domain-events';
import {
  DOMAIN_EVENT_TABLE_END,
  DOMAIN_EVENT_TABLE_START,
  renderDomainEventTable,
  withDomainEventTable,
} from '../../../packages/core-api/src/modules/domain-events/domain-event-table';
import { inMemoryBackgroundJobs, TEST_JOB_START, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { slotTiebreakersRefreshJob } from '../../support/slot-tiebreaker-jobs';
import { NOBODY_TOLD } from '../../support/domain-events';
import { eventChangedJob, recordingSportEventChangedNotice } from '../../support/sport-event-changed-notice';
import { expectDefined } from '../../support/expect-defined';

const START = new Date('2026-05-02T20:00:00.000Z');
const SETTLE_AT = new Date('2026-05-04T23:00:00.000Z');

function statusChanged(from: SportEventStatus, to: SportEventStatus, overrides: Partial<SportEventStatusChanged> = {}): SportEventStatusChanged {
  return {
    type: DomainEventType.SPORT_EVENT_STATUS_CHANGED,
    sportEvent: { id: 'sport-event-1', startDate: START },
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

function weekStatusChanged(from: ContestEntryStatus, to: ContestEntryStatus): ContestEntryEventStatusChanged {
  return {
    type: DomainEventType.CONTEST_ENTRY_EVENT_STATUS_CHANGED,
    contestEntryEvent: { contestId: 'contest-1', contestEntryId: 'entry-1', sportEventId: 'sport-event-1' },
    from,
    to,
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

function domainEvents(overrides: Partial<ConstructorParameters<typeof DomainEvents>[0]> = {}) {
  const queue = overrides.queue ?? watchedQueue();
  return {
    queue,
    events: new DomainEvents({ queue, sportEventChanged: NOBODY_TOLD, ...overrides }),
  };
}

const typesOf = (jobs: readonly BackgroundJobRequest[]) => jobs.map((job) => job.type);

const DECIDED_AT = new Date('2026-05-02T23:30:00.000Z');

const resultsChanged: SportEventResultsChanged = { type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId: 'sport-event-1' };
const gameDecided: GameDecided = { type: DomainEventType.GAME_DECIDED, sportEventId: 'sport-event-1', sportEventRoundMatchId: 'game-1', decidedAt: DECIDED_AT };

const EVENT_REBUILD = {
  type: BackgroundJobType.REBUILD_LEADERBOARDS,
  payload: { subject: 'EVENT', id: 'sport-event-1' },
  sportEventId: 'sport-event-1',
  runAt: undefined,
  start: TEST_JOB_START,
  dedupeKey: 'REBUILD_LEADERBOARDS:EVENT:sport-event-1',
};

/** The job running the event's slots' tiebreaker rule (#2048). */
const SLOT_TIEBREAKERS_REFRESH = slotTiebreakersRefreshJob('sport-event-1');

describe('DOMAIN_EVENT_HANDLERS, the one map of what follows each change', () => {
  it('is pinned: adding, removing or reordering a follow-up changes this list, so it shows in review', () => {
    const pinned = Object.fromEntries(Object.entries(DOMAIN_EVENT_HANDLERS).map(([type, handlers]) => [type, handlers.map((handler) => handler.key)]));

    expect(pinned).toEqual({
      SPORT_EVENT_STATUS_CHANGED: [
        'activate-event-contests',
        'follow-postponed-event-contests',
        'settle-finished-event-contests',
        'tell-leagues-event-postponed',
        'tell-leagues-event-cancelled',
        'rebuild-event-leaderboards',
      ],
      SPORT_EVENT_RESCHEDULED: ['tell-leagues-event-rescheduled'],
      SPORT_EVENT_RESULTS_CHANGED: ['rebuild-leaderboards-for-changed-results'],
      SPORT_EVENT_GAMES_CHANGED: ['refresh-slot-tiebreakers'],
      GAME_DECIDED: ['settle-decided-game-contests', 'rebuild-leaderboards-for-decided-game', 'refresh-slot-tiebreakers-for-decided-game'],
      CONTEST_ENTRY_EVENT_STATUS_CHANGED: ['rebuild-contest-leaderboards'],
      CONTEST_STATUS_CHANGED: [
        'tell-league-contest-started',
        'tell-league-contest-reopened',
        'tell-league-contest-settled',
        'rebuild-moved-contest-leaderboards',
        'close-league-championship-year',
      ],
      SPORT_EVENT_FIELD_SYNCED: ['sync-games-then-tier-field'],
      PARTICIPANT_PROVIDER_MAPPED: ['resolve-mapped-participant-findings'],
      MATCH_STATUS_CHANGED: ['refresh-slot-status'],
      SEASON_SLOT_STATUS_CHANGED: ['refresh-event-status', 'activate-slot-contests', 'close-season-championship-years'],
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
    const { events } = domainEvents({ sportEventChanged: recordingSportEventChangedNotice() });
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
    for (const event of [resultsChanged, gameDecided]) {
      const declaredFor = new Set(DOMAIN_EVENT_HANDLERS[event.type].flatMap((handler) => handler.queues));
      // poolmaster-allow-query-in-loop: a unit test over the results-side events, no database
      for (const type of typesOf((await events.collect(event)).jobs)) expect(declaredFor).toContain(type);
    }
    const declaredWeek = new Set(DOMAIN_EVENT_HANDLERS.CONTEST_ENTRY_EVENT_STATUS_CHANGED.flatMap((handler) => handler.queues));
    for (const from of Object.values(ContestEntryStatus)) {
      for (const to of Object.values(ContestEntryStatus)) {
        // poolmaster-allow-query-in-loop: a unit test over every pair of statuses, no database
        for (const type of typesOf((await events.collect(weekStatusChanged(from, to))).jobs)) expect(declaredWeek).toContain(type);
      }
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
  const context = () => ({ queue: watchedQueue(), sportEventChanged: recordingSportEventChangedNotice() });

  it('takes an event\'s contests live by a job when the event starts, and on no other change', async () => {
    const activate = handler('activate-event-contests');

    expect(activate.when?.(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS))).toBe(true);
    expect(activate.when?.(statusChanged(SportEventStatus.POSTPONED, SportEventStatus.IN_PROGRESS))).toBe(true);
    for (const to of [SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED, SportEventStatus.COMPLETED, SportEventStatus.CANCELLED]) {
      expect(activate.when?.(statusChanged(SportEventStatus.IN_PROGRESS, to))).toBe(false);
    }
    expect(await activate.jobs(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS), context())).toEqual([{
      type: BackgroundJobType.ACTIVATE_EVENT_CONTESTS,
      payload: { sportEventId: 'sport-event-1' },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'ACTIVATE_EVENT_CONTESTS:sport-event-1',
    }]);
  });

  it('has a postponed event\'s contests follow its start by a job on every postponement, a repeated one too, as the lifecycle sweep asks', async () => {
    const follow = handler('follow-postponed-event-contests');

    expect(follow.when?.(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED))).toBe(true);
    expect(follow.when?.(statusChanged(SportEventStatus.POSTPONED, SportEventStatus.POSTPONED))).toBe(true);
    expect(follow.when?.(statusChanged(SportEventStatus.POSTPONED, SportEventStatus.SCHEDULED))).toBe(false);
    expect(await follow.jobs(statusChanged(SportEventStatus.IN_PROGRESS, SportEventStatus.POSTPONED), context())).toEqual([{
      type: BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS,
      payload: { sportEventId: 'sport-event-1' },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'FOLLOW_POSTPONED_EVENT_CONTESTS:sport-event-1',
    }]);
  });

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
});

describe('SPORT_EVENT_FIELD_SYNCED handlers', () => {
  const [follow] = DOMAIN_EVENT_HANDLERS.SPORT_EVENT_FIELD_SYNCED;
  const KICKOFF = new Date('2026-09-13T17:00:00.000Z');
  const fieldSynced = (status: SportEventStatus): SportEventFieldSynced => ({
    type: DomainEventType.SPORT_EVENT_FIELD_SYNCED,
    sportEvent: { id: 'sport-event-1', status },
    providerId: 'balldontlie',
    externalId: 'week-2',
    games: [{ games: [{ providerGameId: 'g1', gameNumber: 1 }], roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: 'lions', scheduledAt: KICKOFF }],
  });

  it('queues one job per event that syncs the provider\'s games, then tiers and prices the field, with the games as their kickoffs\' instants', async () => {
    expect(follow.when?.(fieldSynced(SportEventStatus.DRAFT))).toBe(true);
    expect(await follow.jobs(fieldSynced(SportEventStatus.DRAFT), { queue: watchedQueue(), sportEventChanged: NOBODY_TOLD })).toEqual([{
      type: BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS,
      payload: {
        sportEventId: 'sport-event-1',
        providerId: 'balldontlie',
        externalId: 'week-2',
        games: [{ games: [{ providerGameId: 'g1', gameNumber: 1 }], roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: 'lions', scheduledAt: KICKOFF.toISOString() }],
      },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'SYNC_EVENT_GAMES_AND_TIERS:sport-event-1',
    }]);
  });

  it('carries a playoff\'s whole bracket with the job, and a game or match with no kickoff yet as null', async () => {
    const synced: SportEventFieldSynced = {
      ...fieldSynced(SportEventStatus.DRAFT),
      games: [{ games: [{ providerGameId: 'g1', gameNumber: 1 }], roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: 'lions', scheduledAt: null }],
      bracket: [{ matchNumber: 1, roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: null, scheduledAt: KICKOFF, advancesTo: null, regionLabel: null }],
    };

    const [job] = await follow.jobs(synced, { queue: watchedQueue(), sportEventChanged: NOBODY_TOLD });

    expect(job.payload).toEqual({
      sportEventId: 'sport-event-1',
      providerId: 'balldontlie',
      externalId: 'week-2',
      games: [{ games: [{ providerGameId: 'g1', gameNumber: 1 }], roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: 'lions', scheduledAt: null }],
      bracket: [{ matchNumber: 1, roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: null, scheduledAt: KICKOFF.toISOString(), advancesTo: null, regionLabel: null }],
    });
  });

  it('follows a sync of every event still to be played, and of no finished or cancelled one', () => {
    for (const status of [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS, SportEventStatus.POSTPONED]) {
      expect(follow.when?.(fieldSynced(status))).toBe(true);
    }
    for (const status of [SportEventStatus.COMPLETED, SportEventStatus.CANCELLED]) {
      expect(follow.when?.(fieldSynced(status))).toBe(false);
    }
  });
});

describe('PARTICIPANT_PROVIDER_MAPPED handlers', () => {
  const [resolve] = DOMAIN_EVENT_HANDLERS.PARTICIPANT_PROVIDER_MAPPED;

  it('queues one job that resolves the unmapped participant findings of every feed id the write mapped', async () => {
    const mapped = { type: DomainEventType.PARTICIPANT_PROVIDER_MAPPED, sportLeagueId: 'league-1', providerId: 'provider-row-1', externalIds: ['p-1', 'p-2'] } as const;

    expect(resolve.when?.(mapped)).toBe(true);
    expect(await resolve.jobs(mapped, { queue: watchedQueue(), sportEventChanged: NOBODY_TOLD })).toEqual([expect.objectContaining({
      type: BackgroundJobType.RESOLVE_MAPPED_PARTICIPANT_FINDINGS,
      payload: { sportLeagueId: 'league-1', providerId: 'provider-row-1', externalIds: ['p-1', 'p-2'] },
      sportLeagueId: 'league-1',
    })]);
  });

  it('queues nothing for a write that mapped no feed id', () => {
    expect(resolve.when?.({ type: DomainEventType.PARTICIPANT_PROVIDER_MAPPED, sportLeagueId: 'league-1', providerId: 'provider-row-1', externalIds: [] })).toBe(false);
  });
});

describe('Status bubbling handlers (#2013)', () => {
  const [refreshSlots] = DOMAIN_EVENT_HANDLERS.MATCH_STATUS_CHANGED;
  const [refreshEvent, activateSlotContests] = DOMAIN_EVENT_HANDLERS.SEASON_SLOT_STATUS_CHANGED;

  it('a Match that moved queues one refresh of its event\'s slot statuses, held to one waiting per event', async () => {
    const jobs = await refreshSlots.jobs({ type: DomainEventType.MATCH_STATUS_CHANGED, sportEventId: 'event-1' }, { queue: watchedQueue(), sportEventChanged: NOBODY_TOLD });

    expect(jobs).toEqual([expect.objectContaining({
      type: BackgroundJobType.REFRESH_SLOT_STATUS,
      payload: { sportEventId: 'event-1' },
      dedupeKey: 'REFRESH_SLOT_STATUS:event-1',
      sportEventId: 'event-1',
    })]);
  });

  it('a Season slot that moved queues one refresh of its event\'s status, held to one waiting per event', async () => {
    const moved = { type: DomainEventType.SEASON_SLOT_STATUS_CHANGED, sportEventId: 'event-1', seasonSlotId: 'slot-1', from: 'SCHEDULED', to: 'IN_PROGRESS' } as const;

    expect(await refreshEvent.jobs(moved, { queue: watchedQueue(), sportEventChanged: NOBODY_TOLD })).toEqual([expect.objectContaining({
      type: BackgroundJobType.REFRESH_EVENT_STATUS,
      payload: { sportEventId: 'event-1' },
      dedupeKey: 'REFRESH_EVENT_STATUS:event-1',
      sportEventId: 'event-1',
    })]);
  });

  it('a slot that starts, or finishes before it was seen to start, queues its event\'s contest activation, held to one waiting per event; a slot moving on from in progress queues none', async () => {
    const context = { queue: watchedQueue(), sportEventChanged: NOBODY_TOLD };
    const moved = (from: SeasonSlotStatus, to: SeasonSlotStatus) => ({ type: DomainEventType.SEASON_SLOT_STATUS_CHANGED, sportEventId: 'event-1', seasonSlotId: 'slot-1', from, to } as const);

    for (const to of [SeasonSlotStatus.IN_PROGRESS, SeasonSlotStatus.COMPLETED]) {
      expect(activateSlotContests.when?.(moved(SeasonSlotStatus.SCHEDULED, to))).toBe(true);
      expect(await activateSlotContests.jobs(moved(SeasonSlotStatus.SCHEDULED, to), context)).toEqual([expect.objectContaining({
        type: BackgroundJobType.ACTIVATE_EVENT_CONTESTS,
        payload: { sportEventId: 'event-1' },
        dedupeKey: 'ACTIVATE_EVENT_CONTESTS:event-1',
      })]);
    }
    expect(activateSlotContests.when?.(moved(SeasonSlotStatus.IN_PROGRESS, SeasonSlotStatus.COMPLETED))).toBe(false);
  });
});

describe('Championship year close handlers (#2021)', () => {
  const closeLeagueYear = expectDefined(DOMAIN_EVENT_HANDLERS.CONTEST_STATUS_CHANGED.find((handler) => handler.key === 'close-league-championship-year'), 'handler');
  const closeSeasonYears = expectDefined(DOMAIN_EVENT_HANDLERS.SEASON_SLOT_STATUS_CHANGED.find((handler) => handler.key === 'close-season-championship-years'), 'handler');
  const context = () => ({ queue: watchedQueue(), sportEventChanged: NOBODY_TOLD });

  it('a contest gone final queues one close of its league\'s championship year, held to one waiting per contest, and any other move queues none', async () => {
    const settled = { type: DomainEventType.CONTEST_STATUS_CHANGED, contest: { id: 'contest-1' }, from: [ContestStatus.ACTIVE], to: ContestStatus.COMPLETED } as const;
    const started = { type: DomainEventType.CONTEST_STATUS_CHANGED, contest: { id: 'contest-1' }, from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE } as const;

    expect(closeLeagueYear.when?.(settled)).toBe(true);
    expect(await closeLeagueYear.jobs(settled, context())).toEqual([expect.objectContaining({
      type: BackgroundJobType.CLOSE_LEAGUE_CHAMPIONSHIP_YEAR,
      payload: { contestId: 'contest-1' },
      dedupeKey: 'CLOSE_LEAGUE_CHAMPIONSHIP_YEAR:contest-1',
    })]);
    expect(closeLeagueYear.when?.(started)).toBe(false);
  });

  it('a Season slot finished or cancelled queues one close of the championship years its Season reaches, held to one waiting per slot, and a slot starting queues none', async () => {
    const moved = { type: DomainEventType.SEASON_SLOT_STATUS_CHANGED, sportEventId: 'event-1', seasonSlotId: 'slot-1', from: 'IN_PROGRESS', to: 'COMPLETED' } as const;
    const event = (from: SeasonSlotStatus, to: SeasonSlotStatus) => ({ ...moved, from, to });
    expect(closeSeasonYears.when?.(event(SeasonSlotStatus.IN_PROGRESS, SeasonSlotStatus.COMPLETED))).toBe(true);
    expect(closeSeasonYears.when?.(event(SeasonSlotStatus.SCHEDULED, SeasonSlotStatus.CANCELLED))).toBe(true);
    expect(closeSeasonYears.when?.(event(SeasonSlotStatus.SCHEDULED, SeasonSlotStatus.IN_PROGRESS))).toBe(false);

    expect(await closeSeasonYears.jobs(moved, context())).toEqual([expect.objectContaining({
      type: BackgroundJobType.CLOSE_SEASON_CHAMPIONSHIP_YEARS,
      payload: { sportEventId: 'event-1', seasonSlotId: 'slot-1' },
      dedupeKey: 'CLOSE_SEASON_CHAMPIONSHIP_YEARS:slot-1',
      sportEventId: 'event-1',
    })]);
  });
});

describe('SPORT_EVENT_RESCHEDULED handlers', () => {
  const [tell] = DOMAIN_EVENT_HANDLERS.SPORT_EVENT_RESCHEDULED;

  it('tells the leagues on a released event whose start moved, with the previous start, leaving out the contests the new start reopens', async () => {
    const notice = recordingSportEventChangedNotice();
    const event = rescheduled(SportEventStatus.POSTPONED, new Set(['contest-live']));

    expect(await tell.jobs(event, { queue: watchedQueue(), sportEventChanged: notice }))
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

describe('SPORT_EVENT_RESULTS_CHANGED handlers', () => {
  it('rebuilds the event\'s boards on every change to a score, result, standing, field or game, and the write that changed it wakes the runner once committed', async () => {
    const { queue, events } = domainEvents();

    const written = await events.collect(resultsChanged);

    expect(written.jobs).toEqual([EVENT_REBUILD]);
    expect(queue.queued).not.toHaveBeenCalled();
    written.queued();
    expect(queue.queued).toHaveBeenCalledTimes(1);
  });
});

describe('GAME_DECIDED handlers', () => {
  it('settles the squares contests on the decided game at the moment it was decided, then rebuilds its event\'s boards and runs its slots\' tiebreaker rule, whoever decided it', async () => {
    const { events } = domainEvents();

    expect((await events.collect(gameDecided)).jobs).toEqual([
      {
        type: BackgroundJobType.SETTLE_GAME_CONTESTS,
        payload: { sportEventId: 'sport-event-1', sportEventRoundMatchId: 'game-1', completedAt: DECIDED_AT.toISOString() },
        sportEventId: 'sport-event-1',
        runAt: undefined,
        start: TEST_JOB_START,
        dedupeKey: 'SETTLE_GAME_CONTESTS:game-1',
      },
      EVENT_REBUILD,
      SLOT_TIEBREAKERS_REFRESH,
    ]);
  });
});

describe('SPORT_EVENT_GAMES_CHANGED handlers', () => {
  it('runs the event\'s slots\' tiebreaker rule again, one job waiting per event however many writes', async () => {
    const { events } = domainEvents();
    const gamesChanged = { type: DomainEventType.SPORT_EVENT_GAMES_CHANGED, sportEventId: 'sport-event-1' } as const;

    expect((await events.collect(gamesChanged)).jobs).toEqual([SLOT_TIEBREAKERS_REFRESH]);
  });
});

describe('CONTEST_ENTRY_EVENT_STATUS_CHANGED handlers', () => {
  const [rebuild] = DOMAIN_EVENT_HANDLERS.CONTEST_ENTRY_EVENT_STATUS_CHANGED;

  it('rebuilds the contest\'s own boards, one job per contest whichever entry moved, for a week submitted or sent back to draft', async () => {
    const ctx = { queue: watchedQueue(), sportEventChanged: NOBODY_TOLD };
    const submitted = await rebuild.jobs(weekStatusChanged(ContestEntryStatus.DRAFT, ContestEntryStatus.SUBMITTED), ctx);
    const backToDraft = await rebuild.jobs({ ...weekStatusChanged(ContestEntryStatus.SUBMITTED, ContestEntryStatus.DRAFT), contestEntryEvent: { contestId: 'contest-1', contestEntryId: 'entry-2', sportEventId: 'sport-event-1' } }, ctx);

    expect(rebuild.when).toBeUndefined();
    expect(submitted).toEqual([{
      type: BackgroundJobType.REBUILD_LEADERBOARDS,
      payload: { subject: 'CONTEST', id: 'contest-1' },
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'REBUILD_LEADERBOARDS:CONTEST:contest-1',
    }]);
    // One dedupe key for the contest, so a burst of members submitting waits as one rebuild.
    expect(backToDraft.map((job) => job.dedupeKey)).toEqual(submitted.map((job) => job.dedupeKey));
  });
});

describe('CONTEST_STATUS_CHANGED handlers', () => {
  const handler = (key: string): DomainEventHandler<typeof DomainEventType.CONTEST_STATUS_CHANGED> => {
    const found = DOMAIN_EVENT_HANDLERS.CONTEST_STATUS_CHANGED.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`No handler ${key}`);
    return found;
  };
  const context = () => ({ queue: watchedQueue(), sportEventChanged: NOBODY_TOLD });
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

  it('rebuilds the moved contest\'s boards for every move, keyed once per contest, since its status shows on them and settlement completes it after its standings', async () => {
    const rebuild = handler('rebuild-moved-contest-leaderboards');
    const event = contestChanged([ContestStatus.OPEN, ContestStatus.ACTIVE], ContestStatus.COMPLETED, { sportEventId: undefined });

    expect(await rebuild.jobs(event, context())).toEqual([{
      type: BackgroundJobType.REBUILD_LEADERBOARDS,
      payload: { subject: 'CONTEST', id: 'contest-1' },
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'REBUILD_LEADERBOARDS:CONTEST:contest-1',
    }]);
  });

  it('only rebuilds the boards when a commissioner opens a draft: its reminders start from the move itself', () => {
    expect(told(contestChanged([ContestStatus.DRAFT], ContestStatus.OPEN, { sportEventId: undefined }))).toEqual(['rebuild-moved-contest-leaderboards']);
  });

  it('runs exactly one email handler for each move it tells, none for a move it does not, and the boards\' rebuild for every move', () => {
    const rebuild = 'rebuild-moved-contest-leaderboards';
    expect(told(contestChanged([ContestStatus.OPEN], ContestStatus.ACTIVE))).toEqual(['tell-league-contest-started', rebuild]);
    expect(told(contestChanged([ContestStatus.ACTIVE], ContestStatus.OPEN, { startsAt: START }))).toEqual(['tell-league-contest-reopened', rebuild]);
    expect(told(contestChanged([ContestStatus.ACTIVE], ContestStatus.COMPLETED))).toEqual(['tell-league-contest-settled', rebuild, 'close-league-championship-year']);
    expect(told(contestChanged([ContestStatus.DRAFT], ContestStatus.ACTIVE))).toEqual([rebuild]);
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
      sportEventChanged: { sportEventChangedJobs: refuse },
    };
    const { events } = domainEvents(noReads);
    const contestIds = Array.from({ length: 20 }, (_, index) => `contest-${index}`);

    const batch = await events.collectEach(
      contestIds.map((id) => contestChanged([ContestStatus.OPEN], ContestStatus.ACTIVE, { contest: { id } })),
      (event) => event.contest.id,
    );

    expect(typesOf(batch.jobsFor(contestIds))).toEqual(contestIds.flatMap(() => [BackgroundJobType.CONTEST_STARTED_EMAILS, BackgroundJobType.REBUILD_LEADERBOARDS]));
  });
});

describe('DomainEvents.collect', () => {
  it('collects the jobs of each handler whose `when` takes the event, in map order, and wakes the runner only once told the write committed', async () => {
    const { queue, events } = domainEvents();

    const collected = await events.collect(statusChanged(SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS));

    expect(typesOf(collected.jobs)).toEqual([BackgroundJobType.ACTIVATE_EVENT_CONTESTS, BackgroundJobType.REBUILD_LEADERBOARDS]);
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

  it('hands no jobs for a moved subject it was given no event about', async () => {
    const { events: domain } = domainEvents({ sportEventChanged: recordingSportEventChangedNotice() });

    const batch = await domain.collectEach(events, (event) => event.sportEvent.id);

    expect(batch.jobsFor(['event-c', 'event-a'])).toEqual([eventChangedJob('event-a', 'RESCHEDULED')]);
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
      '| `SPORT_EVENT_STATUS_CHANGED` | `activate-event-contests` | `ACTIVATE_EVENT_CONTESTS` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `follow-postponed-event-contests` | `FOLLOW_POSTPONED_EVENT_CONTESTS` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `settle-finished-event-contests` | `SETTLE_SPORT_EVENT_CONTESTS` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `tell-leagues-event-postponed` | `CONTEST_EVENT_CHANGED_EMAILS` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `tell-leagues-event-cancelled` | `CONTEST_EVENT_CHANGED_EMAILS` |',
      '| `SPORT_EVENT_STATUS_CHANGED` | `rebuild-event-leaderboards` | `REBUILD_LEADERBOARDS` |',
      '| `SPORT_EVENT_RESCHEDULED` | `tell-leagues-event-rescheduled` | `CONTEST_EVENT_CHANGED_EMAILS` |',
      '| `SPORT_EVENT_RESULTS_CHANGED` | `rebuild-leaderboards-for-changed-results` | `REBUILD_LEADERBOARDS` |',
      '| `SPORT_EVENT_GAMES_CHANGED` | `refresh-slot-tiebreakers` | `REFRESH_SLOT_TIEBREAKERS` |',
      '| `GAME_DECIDED` | `settle-decided-game-contests` | `SETTLE_GAME_CONTESTS` |',
      '| `GAME_DECIDED` | `rebuild-leaderboards-for-decided-game` | `REBUILD_LEADERBOARDS` |',
      '| `GAME_DECIDED` | `refresh-slot-tiebreakers-for-decided-game` | `REFRESH_SLOT_TIEBREAKERS` |',
      '| `CONTEST_ENTRY_EVENT_STATUS_CHANGED` | `rebuild-contest-leaderboards` | `REBUILD_LEADERBOARDS` |',
      '| `CONTEST_STATUS_CHANGED` | `tell-league-contest-started` | `CONTEST_STARTED_EMAILS` |',
      '| `CONTEST_STATUS_CHANGED` | `tell-league-contest-reopened` | `CONTEST_REOPENED_EMAILS` |',
      '| `CONTEST_STATUS_CHANGED` | `tell-league-contest-settled` | `CONTEST_SETTLED_EMAILS` |',
      '| `CONTEST_STATUS_CHANGED` | `rebuild-moved-contest-leaderboards` | `REBUILD_LEADERBOARDS` |',
      '| `CONTEST_STATUS_CHANGED` | `close-league-championship-year` | `CLOSE_LEAGUE_CHAMPIONSHIP_YEAR` |',
      '| `SPORT_EVENT_FIELD_SYNCED` | `sync-games-then-tier-field` | `SYNC_EVENT_GAMES_AND_TIERS` |',
      '| `PARTICIPANT_PROVIDER_MAPPED` | `resolve-mapped-participant-findings` | `RESOLVE_MAPPED_PARTICIPANT_FINDINGS` |',
      '| `MATCH_STATUS_CHANGED` | `refresh-slot-status` | `REFRESH_SLOT_STATUS` |',
      '| `SEASON_SLOT_STATUS_CHANGED` | `refresh-event-status` | `REFRESH_EVENT_STATUS` |',
      '| `SEASON_SLOT_STATUS_CHANGED` | `activate-slot-contests` | `ACTIVATE_EVENT_CONTESTS` |',
      '| `SEASON_SLOT_STATUS_CHANGED` | `close-season-championship-years` | `CLOSE_SEASON_CHAMPIONSHIP_YEARS` |',
      DOMAIN_EVENT_TABLE_END,
    ].join('\n'));
  });

  it('says so on purpose for an event type nothing follows', () => {
    const nothingFollows: DomainEventHandlerMap = { SPORT_EVENT_STATUS_CHANGED: [], SPORT_EVENT_RESCHEDULED: [], SPORT_EVENT_RESULTS_CHANGED: [], SPORT_EVENT_GAMES_CHANGED: [], GAME_DECIDED: [], CONTEST_ENTRY_EVENT_STATUS_CHANGED: [], CONTEST_STATUS_CHANGED: [], SPORT_EVENT_FIELD_SYNCED: [], PARTICIPANT_PROVIDER_MAPPED: [], MATCH_STATUS_CHANGED: [], SEASON_SLOT_STATUS_CHANGED: [] };

    expect(renderDomainEventTable(nothingFollows)).toContain('| `SPORT_EVENT_RESCHEDULED` | none | none |');
  });

  it('replaces only the table between its markers, and refuses a document without them', () => {
    const document = `before\n${DOMAIN_EVENT_TABLE_START}\nstale\n${DOMAIN_EVENT_TABLE_END}\nafter`;

    expect(withDomainEventTable(document, 'TABLE')).toBe('before\nTABLE\nafter');
    expect(() => withDomainEventTable('no markers here', 'TABLE')).toThrow('markers are missing');
  });
});
