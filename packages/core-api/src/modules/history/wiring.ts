/**
 * The one construction of HistoryService (#837) and YearReviewService (#872).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaChampionshipRepository,
  PrismaLeagueChampionshipYearRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaLeagueYearReviewRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../adapters';
import { createChampionshipService } from '../championship/wiring';
import { createCupService } from '../cups/wiring';
import { readApplicationBaseUrl, type EmailService } from '../email';
import { HistoryService } from './service';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { YearReviewService } from './year-review-service';

export function createHistoryService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  planEntitlements: PlanEntitlementsService,
): HistoryService {
  return new HistoryService({
    finishes: new PrismaChampionshipRepository(prisma),
    squads: new PrismaSquadRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    championship: createChampionshipService(prisma, logger),
    cups: createCupService(prisma, logger, planEntitlements),
    closedYears: new PrismaLeagueChampionshipYearRepository(prisma),
    logger,
  });
}

export function createYearReviewService(prisma: PrismaClient, options: {
  history: HistoryService;
  email: EmailService;
  logger: FastifyBaseLogger;
}): YearReviewService {
  return new YearReviewService({
    reviews: new PrismaLeagueYearReviewRepository(prisma),
    finishes: new PrismaChampionshipRepository(prisma),
    closedYears: new PrismaLeagueChampionshipYearRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    appBaseUrl: readApplicationBaseUrl(process.env),
    ...options,
  });
}
