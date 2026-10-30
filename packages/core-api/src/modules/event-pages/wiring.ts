/**
 * The one construction of EventPageService (#1007).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { PrismaEventPageRepository } from '../../adapters';
import { contestOpening } from '../contest-management/contest-opening';
import { createContestOpeningReader } from '../contest-management/wiring';
import { EventPageService } from './service';

export function createEventPageService(prisma: PrismaClient, logger?: FastifyBaseLogger): EventPageService {
  return new EventPageService({
    pages: new PrismaEventPageRepository(prisma),
    openings: () => {
      const reader = createContestOpeningReader(prisma);
      return (sportEventId, setup) => contestOpening(reader, sportEventId, setup, new Date());
    },
    logger,
  });
}
