import { Sport, SportEventStatus, SportEventSyncScope } from '@poolmaster/shared/domain';
import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { fakeLogger } from '../../support/fake-logger';

// Which events a scheduled feed syncs: the provider's linked events of the sport, the next two to
// load a field, or every event in progress for scores. The query itself runs in integration.

const NOW = new Date('2026-11-09T12:00:00.000Z');

function reader(provider: { providerId: string } | undefined) {
  const findMany = jest.fn().mockResolvedValue([{ externalId: 'ext-1' }, { externalId: 'ext-2' }]);
  const logger = fakeLogger();
  const read = createScheduledEventReader({ prisma: { sportEvent: { findMany } } as never, registry: { getProvider: () => provider } as never, logger });
  return { read, findMany, logger };
}

describe('createScheduledEventReader', () => {
  it('reads nothing and warns for a sport no provider is registered for', async () => {
    const { read, findMany, logger } = reader(undefined);

    await expect(read.listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual([]);

    expect(findMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('asks for the next two events to load a field, from now or the given start and up to the given end, earliest first', async () => {
    const { read, findMany } = reader({ providerId: 'pga' });
    const from = new Date('2026-11-10T00:00:00.000Z');
    const to = new Date('2026-11-20T00:00:00.000Z');

    await expect(read.listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual(['ext-1', 'ext-2']);
    await read.listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', from, now: NOW, to });

    const statuses = { in: [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED] };
    expect(findMany.mock.calls.map(([query]) => (query as { where: unknown }).where)).toEqual([
      { sport: Sport.GOLF, providerId: 'pga', externalId: { not: '' }, status: statuses, startDate: { gte: NOW }, syncScope: SportEventSyncScope.SCORES_ONLY },
      { sport: Sport.GOLF, providerId: 'pga', externalId: { not: '' }, status: statuses, startDate: { gte: from, lte: to }, syncScope: SportEventSyncScope.SCORES_ONLY },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, orderBy: [{ startDate: 'asc' }, { externalId: 'asc' }] }));
  });

  it('asks for every event in progress with a field for the scores feed, in no particular order', async () => {
    const { read, findMany } = reader({ providerId: 'pga' });

    await read.listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now: NOW });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sport: Sport.GOLF, providerId: 'pga', externalId: { not: '' }, status: { in: [SportEventStatus.IN_PROGRESS] }, sportEventParticipants: { some: {} }, syncScope: SportEventSyncScope.SCORES_ONLY },
      take: undefined,
      orderBy: undefined,
    }));
  });
});
