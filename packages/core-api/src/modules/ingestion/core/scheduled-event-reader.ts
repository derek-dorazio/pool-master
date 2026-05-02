import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderRegistry } from './provider-registry';
import type { IngestionScheduledEventReader } from './ingestion-scheduler';

export interface ScheduledEventReaderDependencies {
  prisma: Pick<PrismaClient, 'sportEvent'>;
  registry: Pick<ProviderRegistry, 'getProvider'>;
  logger?: FastifyBaseLogger;
}

export function createScheduledEventReader({
  prisma,
  registry,
  logger,
}: ScheduledEventReaderDependencies): IngestionScheduledEventReader {
  return {
    async listEventIdsForFeed({ sport, feed, from, now, to }) {
      logger?.debug({
        sport,
        feed,
        from: from?.toISOString() ?? null,
        now: now.toISOString(),
        to: to?.toISOString() ?? null,
      }, 'Listing sport event ids for scheduled ingestion feed');

      const provider = registry.getProvider(sport);
      if (!provider) {
        logger?.warn({ sport, feed }, 'Skipping scheduled event feed because no provider is registered for sport');
        return [];
      }

      const rows = await prisma.sportEvent.findMany({
        where: {
          sport,
          providerId: provider.providerId,
          externalId: {
            not: '',
          },
          ...toFeedWhere(feed, now, from, to),
        },
        select: {
          externalId: true,
        },
      });
      logger?.debug({
        sport,
        feed,
        providerId: provider.providerId,
        eventCount: rows.length,
        eventExternalIds: rows.map((row) => row.externalId),
      }, 'Listed sport event ids for scheduled ingestion feed');
      return rows.map((row) => row.externalId);
    },
  };
}

function toFeedWhere(
  feed: Parameters<IngestionScheduledEventReader['listEventIdsForFeed']>[0]['feed'],
  now: Date,
  from?: Date,
  to?: Date,
) {
  if (feed === 'EVENTRESULTS') {
    return {
      status: { in: ['COMPLETED', 'OFFICIAL'] },
      updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    };
  }

  if (feed === 'EVENTPARTICIPANTS') {
    return {
      OR: [
        {
          status: 'SCHEDULED',
          startDate: {
            gte: from ?? now,
            ...(to ? { lte: to } : {}),
          },
        },
        { status: 'IN_PROGRESS' },
      ],
    };
  }

  return {
    status: { in: ['IN_PROGRESS'] },
  };
}
