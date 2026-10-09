/**
 * Builds `SelectionService` from its Prisma adapters (#324) — the module's composition root, the
 * one place that knows both a port and its implementation.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaParticipantRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSquadMembershipRepository,
} from '../../adapters';
import { ContestEntryPickService } from '../contest-entry-picks';
import { createContestService } from '../contests/wiring';
import type { MailDeliveryProvider } from '../email';
import { createSportEventTierService } from '../events/wiring';
import { SelectionService } from './service';

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
