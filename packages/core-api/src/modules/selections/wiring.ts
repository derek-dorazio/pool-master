/**
 * Builds `SelectionService` (#324) and `PredictionService` (#716) from their Prisma adapters — the module's composition root, the
 * one place that knows both a port and its implementation.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaParticipantRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaContestEntryStandingRepository,
  PrismaSquadMembershipRepository,
  PrismaSquaresRepository,
} from '../../adapters';
import { ContestEntryPickService } from '../contest-entry-picks';
import { createContestService } from '../contests/wiring';
import type { MailDeliveryProvider } from '../email';
import { createSportEventTierService } from '../events/wiring';
import { PredictionService } from './prediction-service';
import { SelectionService } from './service';
import { SquaresService } from './squares-service';

export function createSelectionService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  options?: { mailDelivery?: MailDeliveryProvider; appBaseUrl?: string },
): SelectionService {
  return new SelectionService({
    contests: new PrismaContestRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    picks: new PrismaContestEntryPickRepository(prisma),
    // Module-scoped, one per fastify register (plans/117 §7.1): the service resolves
    // Contest.contestFormat in the same Prisma transaction as the insert.
    pickWrites: new ContestEntryPickService(prisma, logger),
    tiers: createSportEventTierService(prisma, logger),
    sportEvents: new PrismaSportEventRepository(prisma),
    entryReceipts: createContestService(prisma, logger, options),
    logger,
  });
}

export function createPredictionService(prisma: PrismaClient, logger: FastifyBaseLogger): PredictionService {
  return new PredictionService({
    contests: new PrismaContestRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    scoringRules: new PrismaParticipantContestScoringRuleRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    predictions: new PrismaContestEntryMatchPredictionRepository(prisma),
    logger,
  });
}

export function createSquaresService(prisma: PrismaClient, logger: FastifyBaseLogger): SquaresService {
  return new SquaresService({
    contests: new PrismaContestRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    squares: new PrismaSquaresRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    logger,
  });
}
