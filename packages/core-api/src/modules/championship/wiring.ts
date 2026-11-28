/**
 * The one construction of ChampionshipService (#863): settlement and the championship routes both build it here.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { PrismaChampionshipRepository, PrismaLeagueChampionshipYearRepository, PrismaLeagueRepository, PrismaSquadRepository } from '../../adapters';
import { ChampionshipCalendarService } from './calendar-service';
import { ChampionshipService } from './service';

export function createChampionshipService(prisma: PrismaClient, logger?: FastifyBaseLogger): ChampionshipService {
  return new ChampionshipService({
    finishes: new PrismaChampionshipRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    squads: new PrismaSquadRepository(prisma),
    closedYears: new PrismaLeagueChampionshipYearRepository(prisma),
    logger,
  });
}

export function createChampionshipCalendarService(prisma: PrismaClient, logger?: FastifyBaseLogger): ChampionshipCalendarService {
  return new ChampionshipCalendarService({ years: new PrismaLeagueChampionshipYearRepository(prisma), logger });
}
