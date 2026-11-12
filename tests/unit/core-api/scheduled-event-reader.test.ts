import { MatchStatus, Sport, SportEventStatus, SportEventSyncScope } from '@poolmaster/shared/domain';
import { createScheduledEventReader, ROUND_WITHOUT_END_UNDERWAY_MS } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { fakeLogger } from '../../support/fake-logger';

// Which events a scheduled feed syncs: the linked events of every provider serving the sport,
// each provider's next two to load a field, or every event in progress for scores. The query
// itself runs in integration.

const NOW = new Date('2026-11-09T12:00:00.000Z');

type LiveRelations = { roundSchedule?: unknown[]; matches?: unknown[] };

function reader(providerIds: string[], live: LiveRelations = {}) {
  const findMany = jest.fn(({ where, select }: { where: { providerId: { in: string[] } }; select: Record<string, unknown> }) => Promise.resolve(
    where.providerId.in.map((providerId) => ({
      providerId,
      externalId: `${providerId}-ext`,
      ...('lastProviderNotificationAt' in select && { lastProviderNotificationAt: null }),
      ...('roundSchedule' in select && { roundSchedule: live.roundSchedule ?? [] }),
      ...('matches' in select && { matches: live.matches ?? [] }),
    })),
  ));
  const logger = fakeLogger();
  const registry = { getProvidersForSport: () => providerIds.map((providerId) => ({ providerId })) };
  const read = createScheduledEventReader({ prisma: { sportEvent: { findMany } } as never, registry: registry as never, logger });
  return { read, findMany, logger };
}

describe('createScheduledEventReader', () => {
  it('reads nothing and warns for a sport no provider is registered for, for fields and for scores', async () => {
    const { read, findMany, logger } = reader([]);

    await expect(read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual([]);
    await expect(read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW })).resolves.toEqual([]);

    expect(findMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('asks each provider for its next two events to load a field, from now or the given start and up to the given end, earliest first', async () => {
    const { read, findMany } = reader(['mock', 'bdl']);
    const from = new Date('2026-11-10T00:00:00.000Z');
    const to = new Date('2026-11-20T00:00:00.000Z');

    await expect(read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual([
      { providerId: 'mock', externalId: 'mock-ext' },
      { providerId: 'bdl', externalId: 'bdl-ext' },
    ]);
    findMany.mockClear();
    await read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', from, now: NOW, to });

    const statuses = { in: [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED] };
    expect(findMany.mock.calls.map(([query]) => query.where)).toEqual([
      { sport: Sport.GOLF, providerId: { in: ['mock'] }, externalId: { not: '' }, status: statuses, startDate: { gte: from, lte: to }, syncScope: SportEventSyncScope.SCORES_ONLY },
      { sport: Sport.GOLF, providerId: { in: ['bdl'] }, externalId: { not: '' }, status: statuses, startDate: { gte: from, lte: to }, syncScope: SportEventSyncScope.SCORES_ONLY },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, orderBy: [{ startDate: 'asc' }, { externalId: 'asc' }] }));
  });

  it('issues exactly one query per provider for the field feed and exactly one in all for the scores feed, however many events they hold', async () => {
    const { read, findMany } = reader(['mock', 'bdl']);

    await read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW });
    expect(findMany).toHaveBeenCalledTimes(2);

    findMany.mockClear();
    await read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('asks once, across every provider, for every event in progress with a field for the scores feed, with when its provider last notified about it', async () => {
    const { read, findMany } = reader(['mock', 'bdl']);

    await expect(read.listLiveScoreEvents({ sport: Sport.AMERICAN_FOOTBALL, now: NOW })).resolves.toEqual([
      { providerId: 'mock', externalId: 'mock-ext', lastProviderNotificationAt: null, playedInRounds: false, playUnderwaySince: null },
      { providerId: 'bdl', externalId: 'bdl-ext', lastProviderNotificationAt: null, playedInRounds: false, playUnderwaySince: null },
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sport: Sport.AMERICAN_FOOTBALL, providerId: { in: ['mock', 'bdl'] }, externalId: { not: '' }, status: SportEventStatus.IN_PROGRESS, sportEventParticipants: { some: {} }, syncScope: SportEventSyncScope.SCORES_ONLY },
    }));
  });

  describe('when play is under way in an event in progress (#1499)', () => {
    const since = (live: LiveRelations, sport: Sport = Sport.GOLF) =>
      reader(['bdl'], live).read.listLiveScoreEvents({ sport, now: NOW }).then((events) => events.at(0)?.playUnderwaySince);

    it('reads golf, played in rounds, from its latest started round, under way until the round\'s scheduled end', async () => {
      await expect(reader(['bdl']).read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW })).resolves.toEqual([expect.objectContaining({ playedInRounds: true })]);
      const start = new Date('2026-11-09T11:00:00.000Z');
      await expect(since({ roundSchedule: [{ scheduledDate: start, scheduledEndAt: new Date('2026-11-09T20:00:00.000Z') }] })).resolves.toEqual(start);
      await expect(since({ roundSchedule: [{ scheduledDate: start, scheduledEndAt: NOW }] })).resolves.toBeNull();
    });

    it('takes a golf round with no recorded end as under way for 14 hours from its start', async () => {
      const justInside = new Date(NOW.getTime() - ROUND_WITHOUT_END_UNDERWAY_MS + 1);
      const justOutside = new Date(NOW.getTime() - ROUND_WITHOUT_END_UNDERWAY_MS);
      await expect(since({ roundSchedule: [{ scheduledDate: justInside, scheduledEndAt: null }] })).resolves.toEqual(justInside);
      await expect(since({ roundSchedule: [{ scheduledDate: justOutside, scheduledEndAt: null }] })).resolves.toBeNull();
    });

    it('takes golf with no round started yet as not in play', async () => {
      await expect(since({ roundSchedule: [] })).resolves.toBeNull();
    });

    it('reads a sport played in matches from its match in progress longest: its scheduled start, else when it last changed', async () => {
      const kickoff = new Date('2026-11-09T11:30:00.000Z');
      const changed = new Date('2026-11-09T11:40:00.000Z');
      await expect(since({ matches: [{ scheduledDate: kickoff, updatedAt: changed }] }, Sport.AMERICAN_FOOTBALL)).resolves.toEqual(kickoff);
      await expect(since({ matches: [{ scheduledDate: null, updatedAt: changed }] }, Sport.AMERICAN_FOOTBALL)).resolves.toEqual(changed);
      await expect(since({ matches: [] }, Sport.AMERICAN_FOOTBALL)).resolves.toBeNull();
    });

    it('asks golf for its latest round started by now, and a sport played in matches for its earliest-scheduled match in progress', async () => {
      const golf = reader(['bdl']);
      await golf.read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW });
      expect(golf.findMany.mock.calls[0]?.[0].select).toEqual(expect.objectContaining({
        roundSchedule: { where: { scheduledDate: { lte: NOW } }, orderBy: { roundNumber: 'desc' }, take: 1, select: { scheduledDate: true, scheduledEndAt: true } },
      }));

      const football = reader(['bdl']);
      await football.read.listLiveScoreEvents({ sport: Sport.AMERICAN_FOOTBALL, now: NOW });
      expect(football.findMany.mock.calls[0]?.[0].select).toEqual(expect.objectContaining({
        matches: { where: { status: MatchStatus.IN_PROGRESS }, orderBy: { scheduledDate: { sort: 'asc', nulls: 'last' } }, take: 1, select: { scheduledDate: true, updatedAt: true } },
      }));
    });
  });
});
