/**
 * The constructions of the contest services (#247), so each route module and the lifecycle
 * wiring build them one way, from ports.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EventBus } from '@poolmaster/shared/events/event-bus';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryRepository,
  PrismaContestEntryStandingRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaSportEventRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../adapters';
import type { MailDeliveryProvider } from '../email';
import { createSportEventParticipantService, createSportEventTierService } from '../events/wiring';
import { GolfContestSettlementService } from './golf-contest-settlement-service';
import type { GolfContestReadDeps } from './golf-leaderboard-reads';
import { ContestService } from './service';

function createGolfContestReadDeps(prisma: PrismaClient, logger?: FastifyBaseLogger): GolfContestReadDeps {
  return {
    eventParticipants: createSportEventParticipantService(prisma, logger),
    configurations: new PrismaContestConfigurationRepository(prisma),
    scoringRules: new PrismaParticipantContestScoringRuleRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    picks: new PrismaContestEntryPickRepository(prisma),
  };
}

export function createContestService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  options?: { mailDelivery?: MailDeliveryProvider; appBaseUrl?: string },
): ContestService {
  return new ContestService({
    ...createGolfContestReadDeps(prisma, logger),
    contests: new PrismaContestRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
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

export function createGolfContestSettlementService(
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
  bus?: EventBus,
): GolfContestSettlementService {
  return new GolfContestSettlementService({
    ...createGolfContestReadDeps(prisma, logger),
    sportEvents: new PrismaSportEventRepository(prisma),
    contests: new PrismaContestRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    logger,
    bus,
  });
}
