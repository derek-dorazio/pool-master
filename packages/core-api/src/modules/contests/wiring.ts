/**
 * The constructions of the contest services (#247), so each route module and the lifecycle
 * wiring build them one way, from ports.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryRepository,
  PrismaContestEntryEventStandingRepository,
  PrismaContestEntryStandingRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../adapters';
import type { MailDeliveryProvider } from '../email';
import { createSportEventParticipantService, createSportEventTierService } from '../events/wiring';
import { ContestSettlementService } from './contest-settlement-service';
import type { BracketStandingsReadDeps } from './bracket-standings';
import { ContestService } from './service';

function createContestLeaderboardReadDeps(prisma: PrismaClient, logger?: FastifyBaseLogger): BracketStandingsReadDeps {
  return {
    eventParticipants: createSportEventParticipantService(prisma, logger),
    configurations: new PrismaContestConfigurationRepository(prisma),
    scoringRules: new PrismaParticipantContestScoringRuleRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    picks: new PrismaContestEntryPickRepository(prisma),
    predictions: new PrismaContestEntryMatchPredictionRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
  };
}

export function createContestService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  options?: { mailDelivery?: MailDeliveryProvider; appBaseUrl?: string },
): ContestService {
  return new ContestService({
    ...createContestLeaderboardReadDeps(prisma, logger),
    contests: new PrismaContestRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squads: new PrismaSquadRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    users: new PrismaUserRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    tiers: createSportEventTierService(prisma, logger),
    logger,
    mailDelivery: options?.mailDelivery,
    appBaseUrl: options?.appBaseUrl,
  });
}

export function createContestSettlementService(
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
): ContestSettlementService {
  return new ContestSettlementService({
    ...createContestLeaderboardReadDeps(prisma, logger),
    sportEvents: new PrismaSportEventRepository(prisma),
    contests: new PrismaContestRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
    logger,
  });
}
