/**
 * Builds `DraftService` from its Prisma adapters (#324) — the module's composition root, the
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
  PrismaSquadMembershipRepository,
} from '../../adapters';
import { ContestEntryPickService } from '../contest-entry-picks';
import { createSportEventTierService } from '../events/wiring';
import { DraftService } from './service';

export function createDraftService(prisma: PrismaClient, logger?: FastifyBaseLogger): DraftService {
  return new DraftService({
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
    logger,
  });
}
