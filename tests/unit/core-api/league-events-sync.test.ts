import { expect } from '@jest/globals';
import { syncRunOutcome } from '../../support/sync-run-payload';
import { randomUUID } from 'node:crypto';
import type { SyncableSportLeagueSeason } from '@poolmaster/shared/db';
import {
  BackgroundJobStatus,
  BackgroundJobType,
  ProviderCode,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  JobTrigger,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { BackgroundJobQueue, BackgroundJobRunner } from '../../../packages/core-api/src/modules/background-jobs';
import { ProviderSeasonScheduleError } from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
import { LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import type { ProviderEventDetailsChange, ProviderSeasonImport } from '../../../packages/core-api/src/modules/events/service';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryBackgroundJobs, jobHandlers, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { inMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';

// A sport league's events sync (#1819, #2003): what its job does with the provider's events for
// each Season it reads, the run it records, how a failure ends it, and the two triggers (the
// schedule and an admin's Sync now) that queue it. The job runs on the real runner over the
// in-memory job table. That the import creates DRAFT events in the Season, linked, and skips what
// exists is importProviderSeason's, proved in sport-event-service.test.ts and against Postgres in
// synced-event-creation.integration.ts.

const NOW = new Date('2026-11-13T12:00:00Z');

/** A league's Seasons as the sync reads them: last season, this one (current) and the next. */
function seasonsOf(overrides: Partial<Record<'last' | 'current' | 'next', Partial<SyncableSportLeagueSeason>>> = {}) {
  const season = (year: number, extra: Partial<SyncableSportLeagueSeason> = {}): SyncableSportLeagueSeason => ({
    id: randomUUID(),
    sportLeagueId: 'league',
    name: String(year),
    championshipYear: year,
    startsAt: new Date(Date.UTC(year, 1, 1)),
    endsAt: new Date(Date.UTC(year + 1, 0, 31)),
    providerSeasonId: String(year),
    ...extra,
  });
  return { last: season(2025, overrides.last), current: season(2026, overrides.current), next: season(2027, overrides.next) };
}

function providerEvent(externalId: string) {
  return { externalId, name: `Event ${externalId}`, venue: null, startDate: new Date('2026-12-01T00:00:00Z'), endDate: null, providerSlots: [] };
}

function created(name: string): ProviderSeasonImport['created'][number] {
  return { event: { id: randomUUID(), name } } as ProviderSeasonImport['created'][number];
}

type ListSeasonEvents = jest.Mock<Promise<Array<ReturnType<typeof providerEvent>>>, [string, string]>;

function build(options: {
  leagues: SportLeague[];
  /** Each league's Seasons, by league id; omitted, `seasonsOf()` for every league. */
  seasons?: Map<string, SyncableSportLeagueSeason[]>;
  listSeasonEvents?: ListSeasonEvents;
  importProviderSeason?: jest.Mock;
  keepProviderEventsCurrent?: jest.Mock;
  /** False leaves queued jobs waiting until the test drains the runner. */
  wakes?: boolean;
  now?: Date;
  /** True leaves the sync on its own clock, the real one, rather than `now`. */
  ownClock?: boolean;
}) {
  const now = options.now ?? NOW;
  const jobs = inMemoryBackgroundJobs(() => now);
  const syncRuns = inMemorySyncRuns(jobs);
  const queue = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart });
  const seasonSchedule = {
    listSeasonEvents: options.listSeasonEvents
      ?? jest.fn<ReturnType<ListSeasonEvents>, Parameters<ListSeasonEvents>>(async (sportLeagueId, providerSeasonId) => [providerEvent(`${sportLeagueId}-${providerSeasonId}`)]),
  };
  const sportEvents = {
    importProviderSeason: options.importProviderSeason
      ?? jest.fn(async ({ sportLeagueSeasonId }: { sportLeagueSeasonId: string }): Promise<ProviderSeasonImport> => ({
        created: [created(`Open ${sportLeagueSeasonId}`)],
        skipped: [{ externalId: 'old', name: 'Old Open', reason: 'ALREADY_LINKED' }],
        unmatched: [],
        placed: [],
        unplaced: [],
        slotsNeedingDates: null,
        unplacedNames: [],
      })),
    keepProviderEventsCurrent: options.keepProviderEventsCurrent ?? jest.fn(async (): Promise<ProviderEventDetailsChange[]> => []),
  };
  const sportLeagues = {
    findById: jest.fn(async (id: string) => options.leagues.find((league) => league.id === id) ?? null),
    findEventSynced: jest.fn(async () => options.leagues.filter((league) => league.selectedProviderMapping !== null && league.isActive)),
  };
  const seasons = {
    findForSync: jest.fn(async (sportLeagueId: string) => options.seasons?.get(sportLeagueId) ?? []),
  };
  const findings = {
    raiseOfSource: jest.fn(async (_providerSourceId: string, _found: unknown) => undefined),
    resolveOfSource: jest.fn(async (_providerSourceId: string, _filter: unknown) => 0),
  };
  const logger = fakeLogger();
  const sync = new LeagueEventsSync({
    sportLeagues,
    seasons,
    seasonSchedule,
    sportEvents,
    findings,
    syncRuns,
    jobs: queue,
    logger,
    ...(options.ownClock ? {} : { now: () => now }),
  });
  const runner = new BackgroundJobRunner({
    jobs,
    handlers: jobHandlers({ SYNC_LEAGUE_EVENTS: (payload, context) => sync.run(payload, context) }),
    now: () => NOW,
    sleep: () => Promise.resolve(),
  });
  if (options.wakes !== false) queue.wakes(runner);
  return { sync, runner, jobs, syncRuns, seasonSchedule, sportEvents, findings, logger };
}

/** A lease renewal for a try that still holds its claim. */
const stillHeld = () => Promise.resolve(true);

/** A synced league with last, this and next Season, this one current; `seasons` holds them by league. */
function syncedLeague(seasons: Map<string, SyncableSportLeagueSeason[]>, overrides: Partial<SportLeague> = {}, own = seasonsOf()): SportLeague {
  const league = buildSportLeague({
    id: randomUUID(),
    name: 'PGA TOUR',
    selectedProviderMapping: buildProviderMapping({ providerLeagueCode: 'pga', providerLeagueName: 'PGA TOUR' }),
    currentSeasonId: own.current.id,
    ...overrides,
  });
  seasons.set(league.id, [own.last, own.current, own.next].map((season) => ({ ...season, sportLeagueId: league.id })));
  return league;
}

describe('LeagueEventsSync', () => {
  describe('the schedule', () => {
    it('queues one events sync job per active synced league, scoped to the league, naming no Season so the job reads its Seasons when it runs', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const lpga = syncedLeague(seasons, { name: 'LPGA' });
      const unsynced = syncedLeague(seasons, { selectedProviderMapping: null });
      const { sync, jobs } = build({ leagues: [pga, lpga, unsynced], seasons, wakes: false });

      await expect(sync.queueScheduled()).resolves.toBe(2);

      expect(jobs.rows.map((job) => [job.type, job.sportLeagueId, job.sportEventId, job.payload, job.trigger])).toEqual([
        [BackgroundJobType.SYNC_LEAGUE_EVENTS, pga.id, undefined, { sportLeagueId: pga.id }, JobTrigger.SCHEDULE],
        [BackgroundJobType.SYNC_LEAGUE_EVENTS, lpga.id, undefined, { sportLeagueId: lpga.id }, JobTrigger.SCHEDULE],
      ]);
    });

    it('in January the sync still reads the NFL Season being played, which began the autumn before, rather than reading by calendar year', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      // The 2026 NFL Season runs from September 2026 to the Super Bowl in February 2027.
      const nflSeasons = seasonsOf({
        last: { name: '2025', championshipYear: 2025, startsAt: new Date('2025-09-01T00:00:00Z'), endsAt: new Date('2026-02-28T23:59:59Z'), providerSeasonId: '2025' },
        current: { name: '2026', championshipYear: 2026, startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2027-02-28T23:59:59Z'), providerSeasonId: '2026' },
        next: { name: '2027', championshipYear: 2027, startsAt: new Date('2027-09-01T00:00:00Z'), endsAt: new Date('2028-02-28T23:59:59Z'), providerSeasonId: '2027' },
      });
      const nfl = syncedLeague(seasons, { name: 'NFL' }, nflSeasons);
      const { sync, seasonSchedule } = build({ leagues: [nfl], seasons, now: new Date('2027-01-15T12:00:00Z') });

      await sync.run({ sportLeagueId: nfl.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      // The playoffs under way in January 2027 are the 2026 Season's: it is read first, by its own id.
      expect(seasonSchedule.listSeasonEvents.mock.calls.map(([, providerSeasonId]) => providerSeasonId)).toEqual(['2026', '2027']);
    });

    it('makes every league\'s scheduled job due now, with no league held back behind another', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const nba = syncedLeague(seasons, { name: 'NBA' });
      const mlb = syncedLeague(seasons, { name: 'MLB' });
      const { sync, jobs } = build({ leagues: [nba, mlb], seasons, wakes: false });

      await sync.queueScheduled();

      expect(jobs.rows.map((job) => job.runAt)).toEqual([NOW, NOW]);
    });

    it('queues nothing more for a league whose sync is still waiting to run', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, jobs } = build({ leagues: [pga], seasons, wakes: false });

      await sync.queueScheduled();
      await expect(sync.queueScheduled()).resolves.toBe(0);
      expect(jobs.rows).toHaveLength(1);
    });
  });

  describe('Sync now', () => {
    it('queues the league\'s sync for the one Season asked, by the admin, and answers the queued job', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const { sync, jobs } = build({ leagues: [pga], seasons, wakes: false });
      const adminId = randomUUID();

      const job = await sync.syncNow({ sportLeagueId: pga.id, sportLeagueSeasonId: own.next.id, requestedByUserId: adminId });

      expect(job).toMatchObject({ type: BackgroundJobType.SYNC_LEAGUE_EVENTS, sportLeagueId: pga.id });
      expect(jobs.rows.map((row) => [row.payload, row.trigger, row.startedByUserId])).toEqual([
        [{ sportLeagueId: pga.id, sportLeagueSeasonId: own.next.id }, JobTrigger.ADMIN, adminId],
      ]);
    });

    it('names no Season when none is asked, so the job reads the current Season and every later one', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, jobs } = build({ leagues: [pga], seasons, wakes: false });

      await sync.syncNow({ sportLeagueId: pga.id, requestedByUserId: randomUUID() });

      expect(jobs.rows[0]?.payload).toEqual({ sportLeagueId: pga.id });
    });

    it('answers the job already waiting for the league\'s same Seasons rather than queueing a second', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, jobs } = build({ leagues: [pga], seasons, wakes: false });
      await sync.queueScheduled();
      const waiting = jobs.rows[0];

      const job = await sync.syncNow({ sportLeagueId: pga.id, requestedByUserId: randomUUID() });

      expect(job.id).toBe(waiting.id);
      expect(jobs.rows).toHaveLength(1);
    });

    it('queues a job of its own for a named Season while the scheduled sync waits, so last season is not dropped', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const { sync, jobs } = build({ leagues: [pga], seasons, wakes: false });
      await sync.queueScheduled();
      const waiting = jobs.rows[0];

      const job = await sync.syncNow({ sportLeagueId: pga.id, sportLeagueSeasonId: own.last.id, requestedByUserId: randomUUID() });

      expect(job.id).not.toBe(waiting.id);
      expect(job.payload).toMatchObject({ sportLeagueSeasonId: own.last.id });
      expect(jobs.rows.map((row) => row.trigger)).toEqual([JobTrigger.SCHEDULE, JobTrigger.ADMIN]);
    });

    it('refuses a league that does not exist with SPORT_LEAGUE_NOT_FOUND and one no provider syncs with SPORT_LEAGUE_NOT_SYNCED', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const unsynced = syncedLeague(seasons, { selectedProviderMapping: null });
      const { sync, jobs } = build({ leagues: [unsynced], seasons });

      await expect(sync.syncNow({ sportLeagueId: randomUUID(), requestedByUserId: randomUUID() }))
        .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
      await expect(sync.syncNow({ sportLeagueId: unsynced.id, requestedByUserId: randomUUID() }))
        .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });
      expect(jobs.rows).toHaveLength(0);
    });

    it('refuses a Season that is not the league\'s with 404 SPORT_LEAGUE_SEASON_NOT_FOUND and one the provider has no id for with 422 SPORT_LEAGUE_SEASON_NOT_MAPPED, queueing nothing', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf({ next: { providerSeasonId: null } });
      const pga = syncedLeague(seasons, {}, own);
      const { sync, jobs } = build({ leagues: [pga], seasons, wakes: false });

      await expect(sync.syncNow({ sportLeagueId: pga.id, sportLeagueSeasonId: randomUUID(), requestedByUserId: randomUUID() }))
        .rejects.toMatchObject({ code: 'SPORT_LEAGUE_SEASON_NOT_FOUND', statusCode: 404 });
      await expect(sync.syncNow({ sportLeagueId: pga.id, sportLeagueSeasonId: own.next.id, requestedByUserId: randomUUID() }))
        .rejects.toMatchObject({ code: 'SPORT_LEAGUE_SEASON_NOT_MAPPED', statusCode: 422 });
      expect(jobs.rows).toHaveLength(0);
    });
  });

  describe('the job', () => {
    it('imports and keeps current the current Season\'s and each later Season\'s provider events, asked for by the provider\'s Season id, the import first; last Season is not read', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const { sync, runner, seasonSchedule, sportEvents } = build({ leagues: [pga], seasons });

      await sync.queueScheduled();
      await runner.drain();

      expect(seasonSchedule.listSeasonEvents.mock.calls).toEqual([[pga.id, '2026'], [pga.id, '2027']]);
      expect(sportEvents.importProviderSeason.mock.calls).toEqual([
        [{ sportLeagueId: pga.id, sportLeagueSeasonId: own.current.id, providerId: 'balldontlie', sportLeagueProviderMappingId: pga.selectedProviderMapping?.id, providerEvents: [providerEvent(`${pga.id}-2026`)] }],
        [{ sportLeagueId: pga.id, sportLeagueSeasonId: own.next.id, providerId: 'balldontlie', sportLeagueProviderMappingId: pga.selectedProviderMapping?.id, providerEvents: [providerEvent(`${pga.id}-2027`)] }],
      ]);
      expect(sportEvents.keepProviderEventsCurrent.mock.calls).toEqual([
        [{ sportLeagueId: pga.id, providerId: 'balldontlie', providerEvents: [providerEvent(`${pga.id}-2026`)] }],
        [{ sportLeagueId: pga.id, providerId: 'balldontlie', providerEvents: [providerEvent(`${pga.id}-2027`)] }],
      ]);
      expect(sportEvents.importProviderSeason.mock.invocationCallOrder[0]).toBeLessThan(sportEvents.keepProviderEventsCurrent.mock.invocationCallOrder[0]);
    });

    it('reads only the Season a job names, even one before the current Season', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const { sync, seasonSchedule } = build({ leagues: [pga], seasons });

      await sync.run({ sportLeagueId: pga.id, sportLeagueSeasonId: own.last.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.ADMIN });

      expect(seasonSchedule.listSeasonEvents.mock.calls).toEqual([[pga.id, '2025']]);
    });

    it('skips a later Season the provider has no id for, reading the rest', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons, {}, seasonsOf({ next: { providerSeasonId: null } }));
      const { sync, seasonSchedule } = build({ leagues: [pga], seasons });

      await sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(seasonSchedule.listSeasonEvents.mock.calls.map(([, providerSeasonId]) => providerSeasonId)).toEqual(['2026']);
    });

    it('raises one SEASON_MISSING ERROR finding when the last Season the provider has an id for has ended, and still completes its run', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons, {}, seasonsOf({ current: { providerSeasonId: null }, next: { providerSeasonId: null } }));
      const { sync, findings, syncRuns } = build({ leagues: [pga], seasons });

      await sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [{
        kind: ProviderSyncFindingKind.SEASON_MISSING,
        severity: ProviderSyncFindingSeverity.ERROR,
        sportLeagueId: pga.id,
        sportEventId: null,
        providerValue: null,
        providerValueName: null,
      }]);
      expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.COMPLETED });
    });

    it('raises a SEASON_MISSING finding naming no last Season when the provider has an id for none of the league\'s Seasons', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons, {}, seasonsOf({ last: { providerSeasonId: null }, current: { providerSeasonId: null }, next: { providerSeasonId: null } }));
      const { sync, findings, logger, seasonSchedule } = build({ leagues: [pga], seasons });

      await sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(seasonSchedule.listSeasonEvents).not.toHaveBeenCalled();
      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [expect.objectContaining({ kind: ProviderSyncFindingKind.SEASON_MISSING, sportLeagueId: pga.id })]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'events.leagueSync.seasonMissing', data: expect.objectContaining({ lastMappedSeasonId: null }) }),
        expect.any(String),
      );
    });

    it('judges whether the last mapped Season has ended by the real clock when given none of its own', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const farOff = { startsAt: new Date('2098-02-01T00:00:00Z'), endsAt: new Date('2099-01-31T00:00:00Z') };
      const pga = syncedLeague(seasons, {}, seasonsOf({ current: farOff, next: farOff }));
      const { sync, findings } = build({ leagues: [pga], seasons, ownClock: true });

      await sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(findings.raiseOfSource).not.toHaveBeenCalled();
    });

    it('imports each Season through the league\'s selected provider mapping, and raises one INFO SLOT_VALUE_UNMAPPED finding for each code the import could not place', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const importProviderSeason = jest.fn(async (_input: { sportLeagueProviderMappingId: string }): Promise<ProviderSeasonImport> => ({
        created: [],
        skipped: [{ externalId: 'pre-1', name: 'Preseason Week 1', reason: 'NO_SLOT' }],
        unmatched: [{ code: 'PRE:1', eventName: 'Preseason Week 1' }],
        placed: [],
        unplaced: [],
        slotsNeedingDates: null,
        unplacedNames: [],
      }));
      const { sync, findings } = build({ leagues: [pga], seasons, importProviderSeason });

      await sync.run({ sportLeagueId: pga.id, sportLeagueSeasonId: own.current.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(importProviderSeason).toHaveBeenCalledWith(expect.objectContaining({ sportLeagueProviderMappingId: pga.selectedProviderMapping?.id }));
      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [{
        kind: ProviderSyncFindingKind.SLOT_VALUE_UNMAPPED,
        severity: ProviderSyncFindingSeverity.INFO,
        sportLeagueId: pga.id,
        sportEventId: null,
        providerValue: 'PRE:1',
        providerValueName: 'Preseason Week 1',
      }]);
    });

    it('raises one WARNING SLOT_OUTSIDE_SEASON per placed place dated before or after the Season, none for a place inside it, and one INFO GAMES_UNPLACED keyed by the Season for the games inside it that no window held', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const at = (iso: string) => new Date(iso);
      const importProviderSeason = jest.fn(async (): Promise<ProviderSeasonImport> => ({
        created: [],
        skipped: [],
        unmatched: [],
        placed: [
          { code: 'REG:1', startsAt: at('2026-01-20T00:00:00Z'), endsAt: at('2026-01-25T00:00:00Z'), eventName: 'Early' },
          { code: 'REG:2', startsAt: at('2026-03-01T00:00:00Z'), endsAt: at('2026-03-04T00:00:00Z'), eventName: 'Inside' },
          { code: null, startsAt: at('2027-01-25T00:00:00Z'), endsAt: at('2027-02-03T00:00:00Z'), eventName: 'Late' },
          { code: null, startsAt: at('2027-02-05T00:00:00Z'), endsAt: at('2027-02-06T00:00:00Z'), eventName: 'Late' },
        ],
        unplaced: [
          ...['2026-12-20T17:00:00Z', '2026-12-20T21:00:00Z', '2026-12-21T01:00:00Z'].map((kickoff) => ({ code: null, startsAt: at(kickoff), endsAt: at(kickoff), eventName: 'Bowls' })),
          { code: null, startsAt: at('2026-12-22T01:00:00Z'), endsAt: at('2026-12-22T01:00:00Z'), eventName: 'More bowls' },
          // Last Season's bowl is not this Season's to report.
          { code: null, startsAt: at('2025-12-20T17:00:00Z'), endsAt: at('2025-12-20T17:00:00Z'), eventName: 'Old bowls' },
        ],
        slotsNeedingDates: null,
        unplacedNames: [],
      }));
      const { sync, findings } = build({ leagues: [pga], seasons, importProviderSeason });

      await sync.run({ sportLeagueId: pga.id, sportLeagueSeasonId: own.current.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      const outside = (code: string | null, eventName: string) => ({
        kind: ProviderSyncFindingKind.SLOT_OUTSIDE_SEASON,
        severity: ProviderSyncFindingSeverity.WARNING,
        sportLeagueId: pga.id,
        sportEventId: null,
        providerValue: code,
        providerValueName: eventName,
      });
      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [outside('REG:1', 'Early'), outside(null, 'Late')]);
      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [{
        kind: ProviderSyncFindingKind.GAMES_UNPLACED,
        severity: ProviderSyncFindingSeverity.INFO,
        sportLeagueId: pga.id,
        sportEventId: null,
        providerValue: '2026',
        providerValueName: 'Bowls, More bowls',
      }]);
    });

    it('raises one INFO SLOT_NAME_UNMATCHED finding for a tournament name no pattern matched and an ERROR SLOT_NAME_AMBIGUOUS or SLOT_SEASON_PHASE_MISSING for a name that matched more than one slot or a slot its Season has no phase for, each by its normalized name', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const importProviderSeason = jest.fn(async (): Promise<ProviderSeasonImport> => ({
        created: [],
        skipped: [],
        unmatched: [],
        placed: [],
        unplaced: [],
        slotsNeedingDates: null,
        unplacedNames: [
          { normalizedName: 'the new open', name: 'The 2027 New Open', reason: 'UNMATCHED' },
          { normalizedName: 'twin championship', name: 'Twin Championship', reason: 'AMBIGUOUS' },
          { normalizedName: 'masters tournament', name: 'Masters Tournament', reason: 'SEASON_PHASE_MISSING' },
        ],
      }));
      const { sync, findings } = build({ leagues: [pga], seasons, importProviderSeason });

      await sync.run({ sportLeagueId: pga.id, sportLeagueSeasonId: own.current.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [
        { kind: ProviderSyncFindingKind.SLOT_NAME_UNMATCHED, severity: ProviderSyncFindingSeverity.INFO, sportLeagueId: pga.id, sportEventId: null, providerValue: 'the new open', providerValueName: 'The 2027 New Open' },
        { kind: ProviderSyncFindingKind.SLOT_NAME_AMBIGUOUS, severity: ProviderSyncFindingSeverity.ERROR, sportLeagueId: pga.id, sportEventId: null, providerValue: 'twin championship', providerValueName: 'Twin Championship' },
        { kind: ProviderSyncFindingKind.SLOT_SEASON_PHASE_MISSING, severity: ProviderSyncFindingSeverity.ERROR, sportLeagueId: pga.id, sportEventId: null, providerValue: 'masters tournament', providerValueName: 'Masters Tournament' },
      ]);
    });

    it('raises one WARNING SLOT_DATES_NEEDED for a Season whose date-window slots still need dates, naming them, resolves it once none do, and checks nothing for a Season with no such slot', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const needing = jest.fn<Promise<string[] | null>, []>();
      const importProviderSeason = jest.fn(async (): Promise<ProviderSeasonImport> => ({
        created: [], skipped: [], unmatched: [], placed: [], unplaced: [], slotsNeedingDates: await needing(), unplacedNames: [],
      }));
      const { sync, findings } = build({ leagues: [pga], seasons, importProviderSeason });
      const runOnce = () => sync.run({ sportLeagueId: pga.id, sportLeagueSeasonId: own.current.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });
      const providerSeasonId = '2026';

      needing.mockResolvedValueOnce(['ROUND_OF_16', 'FINAL']);
      await runOnce();
      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [{
        kind: ProviderSyncFindingKind.SLOT_DATES_NEEDED,
        severity: ProviderSyncFindingSeverity.WARNING,
        sportLeagueId: pga.id,
        sportEventId: null,
        providerValue: providerSeasonId,
        providerValueName: 'ROUND_OF_16, FINAL',
      }]);

      needing.mockResolvedValueOnce([]);
      await runOnce();
      expect(findings.resolveOfSource).toHaveBeenCalledWith('balldontlie', { kind: ProviderSyncFindingKind.SLOT_DATES_NEEDED, sportLeagueId: pga.id, providerValues: [providerSeasonId] });

      findings.raiseOfSource.mockClear();
      findings.resolveOfSource.mockClear();
      needing.mockResolvedValueOnce(null);
      await runOnce();
      expect(findings.raiseOfSource).not.toHaveBeenCalled();
      expect(findings.resolveOfSource).not.toHaveBeenCalledWith('balldontlie', expect.objectContaining({ kind: ProviderSyncFindingKind.SLOT_DATES_NEEDED }));
    });

    it('raises no SEASON_MISSING finding while a Season the provider has an id for has not ended', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, findings } = build({ leagues: [pga], seasons });

      await sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(findings.raiseOfSource).not.toHaveBeenCalled();
    });

    it('records one COMPLETED EVENTS run linked to its job, with each Season\'s events it created, updated and skipped, and reports the counts as its result', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const movedId = randomUUID();
      const keepProviderEventsCurrent = jest.fn()
        .mockResolvedValueOnce([{ sportEventId: movedId, externalId: 'moved', changed: ['startDate'] }])
        .mockResolvedValue([]);
      const { sync, runner, jobs, syncRuns } = build({ leagues: [pga], seasons, keepProviderEventsCurrent });

      await sync.queueScheduled();
      await runner.drain();

      const [job] = jobs.rows;
      const [run] = syncRuns.rows;
      expect(syncRuns.rows).toHaveLength(1);
      expect(run).toMatchObject({
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        providerName: 'BALLDONTLIE',
        eventId: null,
        kind: ProviderSyncKind.EVENTS,
        trigger: JobTrigger.SCHEDULE,
        sportLeagueId: pga.id,
        sportEventId: null,
        backgroundJobId: job.id,
        status: ProviderSyncRunStatus.COMPLETED,
        completedAt: NOW,
        summary: 'Synced PGA TOUR\'s events for 2026 and 2027: 2 created, 1 updated, 2 skipped.',
        stats: { created: 2, updated: 1, skipped: 2, alreadyStarted: 0 },
        changedCount: 3,
        errorCount: 0,
      });
      const details = syncRuns.update.mock.calls.at(-1)?.[1].details as { seasons: Array<{ sportLeagueSeasonId: string; season: string; created: unknown[]; updated: unknown[] }> };
      expect(details.seasons.map((season) => [season.sportLeagueSeasonId, season.season, season.created.length, season.updated])).toEqual([
        [own.current.id, '2026', 1, [{ sportEventId: movedId, externalId: 'moved', changed: ['startDate'] }]],
        [own.next.id, '2027', 1, []],
      ]);
      expect(job).toMatchObject({
        status: BackgroundJobStatus.SUCCEEDED,
        changedCount: 3,
        result: { syncRunId: run.id, sportLeagueSeasonIds: [own.current.id, own.next.id], created: 2, updated: 1, skipped: 2, alreadyStarted: 0 },
      });
    });

    it('counts the provider events it skipped because they had already started, on the run and in its result', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const own = seasonsOf();
      const pga = syncedLeague(seasons, {}, own);
      const importProviderSeason = jest.fn(async (): Promise<ProviderSeasonImport> => ({
        created: [],
        skipped: [
          { externalId: 'w1', name: 'Week 1', reason: 'ALREADY_STARTED' },
          { externalId: 'w2', name: 'Week 2', reason: 'ALREADY_LINKED' },
        ],
        unmatched: [],
        placed: [],
        unplaced: [],
        slotsNeedingDates: null,
        unplacedNames: [],
      }));
      const { sync, syncRuns } = build({ leagues: [pga], seasons, importProviderSeason });

      const result = await sync.run({ sportLeagueId: pga.id, sportLeagueSeasonId: own.current.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(result).toMatchObject({ changedCount: 0, result: { skipped: 2, alreadyStarted: 1 } });
      expect(syncRuns.rows[0]?.stats).toMatchObject({ skipped: 2, alreadyStarted: 1 });
    });

    it('shows its progress on the run after each Season while it runs', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, runner, syncRuns } = build({ leagues: [pga], seasons });

      await sync.queueScheduled();
      await runner.drain();

      const inProgress = syncRuns.update.mock.calls.filter(([, update]) => update.status === ProviderSyncRunStatus.IN_PROGRESS);
      expect(inProgress.map(([, update]) => [update.stats['seasonsDone'], update.stats['seasonCount'], update.changedCount])).toEqual([[1, 2, null], [2, 2, null]]);
    });

    it('fails the job at once, with no retry, when the provider\'s plan refuses the league, and marks its run FAILED with the code', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const listSeasonEvents = jest.fn<ReturnType<ListSeasonEvents>, Parameters<ListSeasonEvents>>()
        .mockRejectedValue(new ProviderSeasonScheduleError('Your plan does not include the PGA TOUR.', 'PROVIDER_LEAGUE_REFUSED', 422));
      const { sync, runner, jobs, syncRuns, logger } = build({ leagues: [pga], seasons, listSeasonEvents });

      await sync.queueScheduled();
      await runner.drain();

      expect(jobs.rows[0]).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 1, lastError: expect.stringContaining('PROVIDER_LEAGUE_REFUSED') });
      expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.FAILED });
      expect(syncRuns.update.mock.calls.at(-1)?.[1].details).toMatchObject({
        failurePayload: { error: { code: 'PROVIDER_LEAGUE_REFUSED', message: 'Your plan does not include the PGA TOUR.' } },
      });
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'events.leagueSync.failed' }), expect.any(String));
    });

    it('raises one PROVIDER_LEAGUE_UNKNOWN ERROR finding and fails the job at once, with no retry, when the provider does not read the league the mapping names', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const listSeasonEvents = jest.fn<ReturnType<ListSeasonEvents>, Parameters<ListSeasonEvents>>()
        .mockRejectedValue(new ProviderSeasonScheduleError('BALLDONTLIE reads no enabled league with the code "xfl" for this sport.', 'PROVIDER_LEAGUE_UNKNOWN', 422));
      const { sync, runner, jobs, syncRuns, findings } = build({ leagues: [pga], seasons, listSeasonEvents });

      await sync.queueScheduled();
      await runner.drain();

      expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [{
        kind: ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN,
        severity: ProviderSyncFindingSeverity.ERROR,
        sportLeagueId: pga.id,
        sportEventId: null,
        providerValue: 'pga',
        providerValueName: 'PGA TOUR',
      }]);
      expect(findings.resolveOfSource).not.toHaveBeenCalled();
      expect(jobs.rows[0]).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 1, lastError: expect.stringContaining('PROVIDER_LEAGUE_UNKNOWN') });
      expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.FAILED });
    });

    it('resolves the league\'s open PROVIDER_LEAGUE_UNKNOWN finding once a later events sync of it completes', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, runner, syncRuns, findings } = build({ leagues: [pga], seasons });

      await sync.queueScheduled();
      await runner.drain();

      expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.COMPLETED });
      expect(findings.resolveOfSource).toHaveBeenCalledWith('balldontlie', { kind: ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN, sportLeagueId: pga.id });
    });

    it('raises no PROVIDER_LEAGUE_UNKNOWN finding when the provider refuses the league it does read', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const listSeasonEvents = jest.fn<ReturnType<ListSeasonEvents>, Parameters<ListSeasonEvents>>()
        .mockRejectedValue(new ProviderSeasonScheduleError('Your plan does not include the PGA TOUR.', 'PROVIDER_LEAGUE_REFUSED', 422));
      const { sync, runner, findings } = build({ leagues: [pga], seasons, listSeasonEvents });

      await sync.queueScheduled();
      await runner.drain();

      expect(findings.raiseOfSource).not.toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ kind: ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN })]);
    });

    it('leaves a failure a retry may fix, such as the provider being unreachable, for the runner to try again, keeping the Seasons it finished on the run', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const listSeasonEvents = jest.fn<ReturnType<ListSeasonEvents>, Parameters<ListSeasonEvents>>(async (sportLeagueId, providerSeasonId) => {
        if (providerSeasonId === '2027') throw new Error('vendor unavailable');
        return [providerEvent(`${sportLeagueId}-${providerSeasonId}`)];
      });
      const { sync, runner, jobs, syncRuns } = build({ leagues: [pga], seasons, listSeasonEvents });

      await sync.queueScheduled();
      await runner.drain();

      expect(jobs.rows[0]).toMatchObject({ status: BackgroundJobStatus.QUEUED, attempts: 1, lastError: 'vendor unavailable' });
      expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.FAILED, summary: 'Failed: vendor unavailable', stats: { created: 1, updated: 0, skipped: 1, alreadyStarted: 0 }, changedCount: null, errorCount: 1 });
    });

    it('marks the run an earlier try left IN_PROGRESS as interrupted, then records its own', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, syncRuns } = build({ leagues: [pga], seasons });
      const jobId = randomUUID();
      const stale = await syncRuns.create({
        providerCode: ProviderCode.BALLDONTLIE, kind: ProviderSyncKind.EVENTS, trigger: JobTrigger.SCHEDULE,
        sportLeagueId: pga.id, sportEventId: null, backgroundJobId: jobId, status: ProviderSyncRunStatus.IN_PROGRESS,
        startedAt: NOW, completedAt: null, ...syncRunOutcome(),
      });

      await sync.run({ sportLeagueId: pga.id }, { jobId, attempt: 2, renewLease: stillHeld, trigger: JobTrigger.SCHEDULE });

      expect(syncRuns.rows.map((run) => [run.id === stale.id, run.status])).toEqual([[true, ProviderSyncRunStatus.FAILED], [false, ProviderSyncRunStatus.COMPLETED]]);
      expect(syncRuns.rows[0]).toMatchObject({ summary: expect.stringContaining('Interrupted'), errorCount: 1 });
    });

    it('stops before importing or recording a run when another task has claimed the job', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, syncRuns, sportEvents } = build({ leagues: [pga], seasons });

      await expect(sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease: () => Promise.resolve(false), trigger: JobTrigger.SCHEDULE }))
        .rejects.toThrow('Another try took over');
      expect(sportEvents.importProviderSeason).not.toHaveBeenCalled();
      expect(syncRuns.rows).toHaveLength(0);
    });

    it('stops before the next Season, reading it not at all, when another task claimed the job while it read the last one', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync, seasonSchedule } = build({ leagues: [pga], seasons });
      const renewLease = jest.fn<Promise<boolean>, []>().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease, trigger: JobTrigger.SCHEDULE }))
        .rejects.toThrow('Another try took over');
      expect(seasonSchedule.listSeasonEvents.mock.calls.map(([, providerSeasonId]) => providerSeasonId)).toEqual(['2026']);
    });

    it('renews its lease before each Season, so a sync slowed by the provider keeps its claim', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const pga = syncedLeague(seasons);
      const { sync } = build({ leagues: [pga], seasons });
      const renewLease = jest.fn(stillHeld);

      await sync.run({ sportLeagueId: pga.id }, { jobId: randomUUID(), attempt: 1, renewLease, trigger: JobTrigger.SCHEDULE });

      expect(renewLease).toHaveBeenCalledTimes(2);
    });

    it('fails at once, recording no run, for a league gone or no longer synced', async () => {
      const seasons = new Map<string, SyncableSportLeagueSeason[]>();
      const unsynced = syncedLeague(seasons, { selectedProviderMapping: null });
      const { sync, syncRuns } = build({ leagues: [unsynced], seasons });

      await expect(sync.run({ sportLeagueId: randomUUID() }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.ADMIN }))
        .rejects.toMatchObject({ name: 'PermanentBackgroundJobError' });
      await expect(sync.run({ sportLeagueId: unsynced.id }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld, trigger: JobTrigger.ADMIN }))
        .rejects.toMatchObject({ name: 'PermanentBackgroundJobError' });
      expect(syncRuns.rows).toHaveLength(0);
    });
  });
});
