import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { SportEventStatus, SportEventSyncScope } from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './provider-registry';
import type { IngestionScheduledEventReader } from './ingestion-scheduler';

/** How many upcoming events per provider a field sync pass loads. */
const FIELD_EVENTS_PER_PROVIDER = 2;

export interface ScheduledEventReaderDependencies {
  prisma: Pick<PrismaClient, 'sportEvent'>;
  registry: Pick<ProviderRegistry, 'getProvidersForSport'>;
  logger?: FastifyBaseLogger;
}

export function createScheduledEventReader({
  prisma,
  registry,
  logger,
}: ScheduledEventReaderDependencies): IngestionScheduledEventReader {
  return {
    async listEventsForFeed({ sport, feed, from, now, to }) {
      logger?.debug({
        sport,
        feed,
        from: from?.toISOString() ?? null,
        now: now.toISOString(),
        to: to?.toISOString() ?? null,
      }, 'Listing sport events for scheduled ingestion feed');

      // Every provider serving the sport syncs the events linked to it (#1495).
      const providerIds = registry.getProvidersForSport(sport).map((provider) => provider.providerId);
      if (providerIds.length === 0) {
        logger?.warn({ sport, feed }, 'Skipping scheduled event feed because no provider is registered for sport');
        return [];
      }

      const select = { providerId: true, externalId: true } as const;
      const linkedToProviders = (ids: string[]) => ({
        sport,
        providerId: { in: ids },
        externalId: { not: '' },
        ...toFeedWhere(feed, now, from, to),
      });
      // Each provider loads the fields of its own next two events, so one provider's earlier
      // events never hold another's back. Scores poll every in-progress event at once.
      const rows = feed === 'EVENTPARTICIPANTS'
        ? (await Promise.all(providerIds.map((providerId) =>
            // poolmaster-allow-query-in-loop: once per provider serving the sport, one or two
            prisma.sportEvent.findMany({
              where: linkedToProviders([providerId]),
              orderBy: [{ startDate: 'asc' }, { externalId: 'asc' }],
              take: FIELD_EVENTS_PER_PROVIDER,
              select,
            })))).flat()
        : await prisma.sportEvent.findMany({ where: linkedToProviders(providerIds), select });
      logger?.debug({
        sport,
        feed,
        providerIds,
        eventCount: rows.length,
        events: rows,
      }, 'Listed sport events for scheduled ingestion feed');
      return rows;
    },
  };
}

function toFeedWhere(
  feed: Parameters<IngestionScheduledEventReader['listEventsForFeed']>[0]['feed'],
  now: Date,
  from?: Date,
  to?: Date,
) {
  if (feed === 'EVENTPARTICIPANTS') {
    return {
      // A field loads while the event is a draft or released and not yet started (#431).
      status: { in: [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED] },
      startDate: {
        gte: from ?? now,
        ...(to ? { lte: to } : {}),
      },
      syncScope: SportEventSyncScope.SCORES_ONLY,
    };
  }

  return {
    status: { in: [SportEventStatus.IN_PROGRESS] },
    sportEventParticipants: { some: {} },
    syncScope: SportEventSyncScope.SCORES_ONLY,
  };
}
