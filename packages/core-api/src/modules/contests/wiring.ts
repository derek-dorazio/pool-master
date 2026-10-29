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
  PrismaContestExpansionRepository,
  PrismaContestEntryStandingRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaParticipantRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventRepository,
  PrismaSportLeagueRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
  PrismaSquaresRepository,
  PrismaUserRepository,
} from '../../adapters';
import type { EmailService } from '../email';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { createSportEventParticipantService, createSportEventTierService } from '../events/wiring';
import type { SportEventParticipantService } from '../events/sport-event-participant-service';
import { ContestSettlementService } from './contest-settlement-service';
import type { BracketStandingsReadDeps } from './bracket-standings';
import { ContestService } from './service';
import { ContestLeaderboardCache, readLeaderboardCacheTtlMs } from './contest-leaderboard-cache';
import { createChampionshipService } from '../championship/wiring';
import type { ContestSettledNotice } from '../notifications/contest-notices';

/** The bracket, pick'em and survivor reads, plus the batched match read the season leaderboards take (#762). */
function createContestLeaderboardReadDeps(
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
): BracketStandingsReadDeps & {
  eventParticipants: SportEventParticipantService;
  matches: PrismaSportEventMatchRepository;
  predictions: PrismaContestEntryMatchPredictionRepository;
} {
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

/** One leaderboard cache for the container (#1162): the contest page and a cup's projection share it. */
const leaderboardCache = new ContestLeaderboardCache(readLeaderboardCacheTtlMs(process.env));

export function createContestService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  options: { planEntitlements: PlanEntitlementsService; email?: EmailService; appBaseUrl?: string },
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
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    tiers: createSportEventTierService(prisma, logger),
    planEntitlements: options.planEntitlements,
    expansions: new PrismaContestExpansionRepository(prisma),
    logger,
    email: options.email,
    appBaseUrl: options.appBaseUrl,
    leaderboardCache,
  });
}

export function createContestSettlementService(
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
  options?: { contestSettled?: ContestSettledNotice },
): ContestSettlementService {
  return new ContestSettlementService({
    ...createContestLeaderboardReadDeps(prisma, logger),
    sportEvents: new PrismaSportEventRepository(prisma),
    contests: new PrismaContestRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
    squares: new PrismaSquaresRepository(prisma),
    championship: createChampionshipService(prisma, logger),
    contestSettled: options?.contestSettled,
    logger,
  });
}
