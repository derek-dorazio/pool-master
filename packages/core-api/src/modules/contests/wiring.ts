/**
 * The constructions of the contest services (#247), so each route module and the lifecycle
 * wiring build them one way, from ports.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaBackgroundJobRepository,
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
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportLeagueRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
  PrismaSquaresRepository,
  PrismaUserRepository,
} from '../../adapters';
import type { EmailService } from '../email';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { createEventFieldReader, createSportEventTierService } from '../events/wiring';
import type { EventFieldReads } from '../events/event-field-reader';
import { ContestSettlementService } from './contest-settlement-service';
import type { BracketStandingsReadDeps } from './bracket-standings';
import { ContestService } from './service';
import { readLeaderboardSnapshotMaxAgeMs } from './leaderboard-snapshots';
import { JobLeaderboardRebuilds } from './leaderboard-rebuild-job-requests';
import { createChampionshipService } from '../championship/wiring';
import { BackgroundJobQueue } from '../background-jobs';
import type { DomainEvents } from '../domain-events';
import { currentJobStart } from '../../core/job-start';

/** The bracket, pick'em and survivor reads, plus the batched match read the season leaderboards take (#762). */
function createContestLeaderboardReadDeps(
  prisma: PrismaClient,
): BracketStandingsReadDeps & {
  eventParticipants: EventFieldReads;
  matches: PrismaSportEventMatchRepository;
  predictions: PrismaContestEntryMatchPredictionRepository;
} {
  return {
    eventParticipants: createEventFieldReader(prisma),
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
    ...createContestLeaderboardReadDeps(prisma),
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
    fieldRows: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    tiers: createSportEventTierService(prisma, logger),
    planEntitlements: options.planEntitlements,
    expansions: new PrismaContestExpansionRepository(prisma),
    logger,
    email: options.email,
    appBaseUrl: options.appBaseUrl,
    leaderboardSnapshots: new PrismaContestLeaderboardSnapshotRepository(prisma),
    leaderboardSnapshotMaxAgeMs,
    // Stale stored boards that my entries or a cup's projection computed are rebuilt by a job
    // (#1788), which the runner on any task claims on its next poll.
    leaderboardRebuilds: new JobLeaderboardRebuilds(new BackgroundJobQueue({ jobs: new PrismaBackgroundJobRepository(prisma), currentStart: currentJobStart })),
  });
}

export function createContestSettlementService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger | undefined,
  options: {
    /** What follows settlement's writes (#1949, #1973): the app's one handler map, built in index.ts. */
    domainEvents: Pick<DomainEvents, 'collect' | 'collectEach'>;
  },
): ContestSettlementService {
  return new ContestSettlementService({
    ...createContestLeaderboardReadDeps(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    contests: new PrismaContestRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
    squares: new PrismaSquaresRepository(prisma),
    championship: createChampionshipService(prisma, logger),
    domainEvents: options.domainEvents,
    logger,
  });
}
