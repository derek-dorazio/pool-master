/**
 * The one construction of HistoryService (#837).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { PrismaChampionshipRepository, PrismaSquadRepository } from '../../adapters';
import { createChampionshipService } from '../championship/wiring';
import { createCupService } from '../cups/wiring';
import { HistoryService } from './service';

export function createHistoryService(prisma: PrismaClient, logger: FastifyBaseLogger): HistoryService {
  return new HistoryService({
    finishes: new PrismaChampionshipRepository(prisma),
    squads: new PrismaSquadRepository(prisma),
    championship: createChampionshipService(prisma, logger),
    cups: createCupService(prisma, logger),
    logger,
  });
}
