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
  PrismaContestLeaderboardSnapshotRepository,
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
import { readLeaderboardSnapshotMaxAgeMs, type LeaderboardRebuilds } from './leaderboard-snapshots';
import { createChampionshipService } from '../championship/wiring';
import type { BackgroundJobQueue } from '../background-jobs';

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

/** How old a stored leaderboard may be before a read computes it again (#1435). */
const leaderboardSnapshotMaxAgeMs = readLeaderboardSnapshotMaxAgeMs(process.env);

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
    leaderboardSnapshots: new PrismaContestLeaderboardSnapshotRepository(prisma),
    leaderboardSnapshotMaxAgeMs,
  });
}

export function createContestSettlementService(
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
  options?: { jobs?: Pick<BackgroundJobQueue, 'request' | 'queued'>; leaderboards?: Pick<LeaderboardRebuilds, 'contestsChanged'> },
): ContestSettlementService {
  return new ContestSettlementService({
    ...createContestLeaderboardReadDeps(prisma, logger),
    sportEvents: new PrismaSportEventRepository(prisma),
    contests: new PrismaContestRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
    squares: new PrismaSquaresRepository(prisma),
    championship: createChampionshipService(prisma, logger),
    jobs: options?.jobs,
    leaderboards: options?.leaderboards,
    logger,
  });
}
