import { Sport, SportEventStatus, SportEventSyncScope } from '@poolmaster/shared/domain';
import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { fakeLogger } from '../../support/fake-logger';

// Which events a scheduled feed syncs: the linked events of every provider serving the sport,
// each provider's next two to load a field, or every event in progress for scores. The query
// itself runs in integration.

const NOW = new Date('2026-11-09T12:00:00.000Z');

function reader(providerIds: string[]) {
  const findMany = jest.fn(({ where }: { where: { providerId: { in: string[] } } }) => Promise.resolve(
    where.providerId.in.map((providerId) => ({ providerId, externalId: `${providerId}-ext` })),
  ));
  const logger = fakeLogger();
  const registry = { getProvidersForSport: () => providerIds.map((providerId) => ({ providerId })) };
  const read = createScheduledEventReader({ prisma: { sportEvent: { findMany } } as never, registry: registry as never, logger });
  return { read, findMany, logger };
}

describe('createScheduledEventReader', () => {
  it('reads nothing and warns for a sport no provider is registered for', async () => {
    const { read, findMany, logger } = reader([]);

    await expect(read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual([]);

    expect(findMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
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

  it('asks once, across every provider, for every event in progress with a field for the scores feed', async () => {
    const { read, findMany } = reader(['mock', 'bdl']);

    await read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now: NOW });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { sport: Sport.GOLF, providerId: { in: ['mock', 'bdl'] }, externalId: { not: '' }, status: { in: [SportEventStatus.IN_PROGRESS] }, sportEventParticipants: { some: {} }, syncScope: SportEventSyncScope.SCORES_ONLY },
      select: { providerId: true, externalId: true },
    });
  });
});
