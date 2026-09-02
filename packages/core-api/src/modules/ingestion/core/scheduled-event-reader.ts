import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { SportEventStatus, SportEventSyncScope } from '@poolmaster/shared/domain';
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
        orderBy: feed === 'EVENTPARTICIPANTS'
          ? [
              { startDate: 'asc' },
              { externalId: 'asc' },
            ]
          : undefined,
        take: feed === 'EVENTPARTICIPANTS' ? 2 : undefined,
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
      status: { in: [SportEventStatus.COMPLETED] },
      updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      syncScope: { in: [SportEventSyncScope.FULL, SportEventSyncScope.SCORES_ONLY] },
    };
  }

  if (feed === 'EVENTPARTICIPANTS') {
    return {
      status: SportEventStatus.SCHEDULED,
      releaseAt: { lte: now },
      fieldLocked: false,
      fieldLocksAt: { gt: now },
      startDate: {
        gte: from ?? now,
        ...(to ? { lte: to } : {}),
      },
      syncScope: SportEventSyncScope.FULL,
    };
  }

  return {
    status: { in: [SportEventStatus.IN_PROGRESS] },
    sportEventParticipants: { some: {} },
    syncScope: { in: [SportEventSyncScope.FULL, SportEventSyncScope.SCORES_ONLY] },
  };
}
