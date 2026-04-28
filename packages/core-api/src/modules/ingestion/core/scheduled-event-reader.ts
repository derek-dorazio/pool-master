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
    async listEventIdsForFeed({ sport, feed, now }) {
      logger?.debug({
        sport,
        feed,
        now: now.toISOString(),
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
          status: {
            in: feed === 'EVENTRESULTS'
              ? ['COMPLETED', 'OFFICIAL']
              : ['IN_PROGRESS'],
          },
          ...(feed === 'EVENTRESULTS'
            ? { updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }
            : {}),
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
