/**
 * The one construction of ChampionshipService (#863): settlement and the championship routes both build it here.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { PrismaChampionshipRepository, PrismaCupRepository, PrismaSquadRepository } from '../../adapters';
import { ChampionshipService } from './service';

export function createChampionshipService(prisma: PrismaClient, logger?: FastifyBaseLogger): ChampionshipService {
  return new ChampionshipService({
    finishes: new PrismaChampionshipRepository(prisma),
    cups: new PrismaCupRepository(prisma),
    squads: new PrismaSquadRepository(prisma),
    logger,
  });
}
