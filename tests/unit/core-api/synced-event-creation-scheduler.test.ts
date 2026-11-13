import { expect } from '@jest/globals';
import type { SportLeague } from '@poolmaster/shared/domain';
import { SyncedEventCreationScheduler } from '../../../packages/core-api/src/modules/events/synced-event-creation-scheduler';
import type { ProviderEventYearImport } from '../../../packages/core-api/src/modules/events/service';
import { buildSportLeague } from '../../factories';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';

// The sweep's own logic: which leagues and years it imports, and that one failure does not stop
// the rest. That the import creates DRAFT events, linked, and skips what exists is
// importProviderEventYear's, proved in sport-event-service.test.ts and against Postgres in
// synced-event-creation.integration.ts.

const NOW = new Date('2026-11-13T12:00:00Z');

function providerEvent(externalId: string) {
  return { externalId, name: `Event ${externalId}`, venue: null, startDate: new Date('2026-12-01T00:00:00Z'), endDate: null };
}

function importOf(createdCount: number): ProviderEventYearImport {
  return { created: Array.from({ length: createdCount }, () => ({}) as ProviderEventYearImport['created'][number]), skipped: [] };
}

type ListTourEvents = jest.Mock<Promise<Array<ReturnType<typeof providerEvent>>>, [string, string, number]>;
type ImportYear = jest.Mock<Promise<ProviderEventYearImport>, [{ sportLeagueId: string; eventYear: number; providerId: string }]>;

function build(options: { leagues: SportLeague[]; listTourEventsForYear?: ListTourEvents; jobLock?: ReturnType<typeof heldHere> }) {
  const sportLeagues = { findEventSynced: jest.fn().mockResolvedValue(options.leagues) };
  const scoreSource = {
    listTourEventsForYear: options.listTourEventsForYear
      ?? jest.fn<ReturnType<ListTourEvents>, Parameters<ListTourEvents>>(async (_providerId, sportLeagueId, eventYear) => [providerEvent(`${sportLeagueId}-${eventYear}`)]),
  };
  const sportEvents = { importProviderEventYear: jest.fn<ReturnType<ImportYear>, Parameters<ImportYear>>().mockResolvedValue(importOf(1)) };
  const logger = fakeLogger();
  const scheduler = new SyncedEventCreationScheduler({
    sportLeagues,
    scoreSource,
    sportEvents,
    jobLock: options.jobLock ?? heldHere(),
    logger,
    now: () => NOW,
  });
  return { scheduler, sportLeagues, scoreSource, sportEvents, logger };
}

describe('SyncedEventCreationScheduler', () => {
  it('imports each synced league\'s provider events for this calendar year and the next, through the admin\'s year import', async () => {
    const nfl = buildSportLeague({ id: 'sl-nfl', name: 'NFL', matchKeyword: 'NFL', eventSyncProviderId: 'balldontlie' });
    const { scheduler, scoreSource, sportEvents } = build({ leagues: [nfl] });

    await scheduler.runSweep();

    expect(scoreSource.listTourEventsForYear.mock.calls).toEqual([
      ['balldontlie', 'sl-nfl', 2026],
      ['balldontlie', 'sl-nfl', 2027],
    ]);
    expect(sportEvents.importProviderEventYear.mock.calls).toEqual([
      [{ sportLeagueId: 'sl-nfl', eventYear: 2026, providerId: 'balldontlie', providerEvents: [providerEvent('sl-nfl-2026')] }],
      [{ sportLeagueId: 'sl-nfl', eventYear: 2027, providerId: 'balldontlie', providerEvents: [providerEvent('sl-nfl-2027')] }],
    ]);
  });

  it('imports with each league\'s own provider', async () => {
    const pga = buildSportLeague({ id: 'sl-pga', eventSyncProviderId: 'balldontlie', matchKeyword: 'PGA TOUR' });
    const epl = buildSportLeague({ id: 'sl-epl', eventSyncProviderId: 'other-feed', matchKeyword: 'EPL' });
    const { scheduler, scoreSource } = build({ leagues: [pga, epl] });

    await scheduler.runSweep();

    expect(scoreSource.listTourEventsForYear.mock.calls.map(([providerId, sportLeagueId]) => [providerId, sportLeagueId])).toEqual([
      ['balldontlie', 'sl-pga'], ['balldontlie', 'sl-pga'], ['other-feed', 'sl-epl'], ['other-feed', 'sl-epl'],
    ]);
  });

  it('logs a league whose provider read fails and still imports the other years and leagues', async () => {
    const failing = buildSportLeague({ id: 'sl-failing', name: 'Failing', eventSyncProviderId: 'balldontlie', matchKeyword: 'X' });
    const working = buildSportLeague({ id: 'sl-working', eventSyncProviderId: 'balldontlie', matchKeyword: 'Y' });
    const listTourEventsForYear = jest.fn<ReturnType<ListTourEvents>, Parameters<ListTourEvents>>(async (_providerId, sportLeagueId, eventYear) => {
      if (sportLeagueId === 'sl-failing' && eventYear === 2026) throw new Error('vendor unavailable');
      return [providerEvent(`${sportLeagueId}-${eventYear}`)];
    });
    const { scheduler, sportEvents, logger } = build({ leagues: [failing, working], listTourEventsForYear });

    await scheduler.runSweep();

    expect(sportEvents.importProviderEventYear.mock.calls.map(([input]) => [input.sportLeagueId, input.eventYear])).toEqual([
      ['sl-failing', 2027], ['sl-working', 2026], ['sl-working', 2027],
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sportLeagueId: 'sl-failing', eventYear: 2026, error: 'vendor unavailable' }),
      'Synced event creation failed for a sport league',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ leagueCount: 2, createdCount: 3, failedCount: 1 }),
      'Synced event creation sweep finished',
    );
  });

  it('passes over a league the read returned without a provider, importing nothing for it', async () => {
    const unsynced = buildSportLeague({ eventSyncProviderId: null, matchKeyword: 'NFL' });
    const { scheduler, scoreSource } = build({ leagues: [unsynced] });

    await scheduler.runSweep();

    expect(scoreSource.listTourEventsForYear).not.toHaveBeenCalled();
  });

  it('runs on today\'s calendar year and without a logger when given neither', async () => {
    const synced = buildSportLeague({ id: 'sl-nfl', eventSyncProviderId: 'balldontlie', matchKeyword: 'NFL' });
    const listTourEventsForYear = jest.fn<ReturnType<ListTourEvents>, Parameters<ListTourEvents>>().mockRejectedValueOnce(new Error('down')).mockResolvedValue([]);
    const scheduler = new SyncedEventCreationScheduler({
      sportLeagues: { findEventSynced: jest.fn().mockResolvedValue([synced]) },
      scoreSource: { listTourEventsForYear },
      sportEvents: { importProviderEventYear: jest.fn().mockResolvedValue(importOf(0)) },
      jobLock: heldHere(),
    });
    scheduler.start();
    scheduler.stop();

    await scheduler.runSweep();

    const thisYear = new Date().getUTCFullYear();
    expect(listTourEventsForYear.mock.calls.map(([, , eventYear]) => eventYear)).toEqual([thisYear, thisYear + 1]);
  });

  it('imports nothing when no league is synced', async () => {
    const { scheduler, scoreSource, sportEvents } = build({ leagues: [] });

    await scheduler.runSweep();

    expect(scoreSource.listTourEventsForYear).not.toHaveBeenCalled();
    expect(sportEvents.importProviderEventYear).not.toHaveBeenCalled();
  });

  it('skips the sweep on a task that does not hold its job lock', async () => {
    const lock = heldElsewhere();
    const synced = buildSportLeague({ eventSyncProviderId: 'balldontlie', matchKeyword: 'NFL' });
    const { scheduler, sportLeagues } = build({ leagues: [synced], jobLock: lock });

    await scheduler.runSweep();

    expect(lock.keys).toEqual(['synced-event-creation']);
    expect(sportLeagues.findEventSynced).not.toHaveBeenCalled();
  });
});
