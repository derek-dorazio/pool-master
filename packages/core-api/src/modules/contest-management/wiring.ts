/**
 * The one construction of ContestManagementService. Contest creation lives on the contests
 * module's `createContest` route (#245) and the configuration reads and writes on this module's,
 * so both build the service here rather than each wiring its dependencies.
 */
import type { ContestOpenedNotice } from '../notifications/contest-notices';
import type { DomainEvents } from '../domain-events';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventSlotParticipantValuationRepository,
  PrismaSportEventSlotTierRepository,
  PrismaSportEventRepository,
  PrismaSportRepository,
} from '../../adapters';
import { createSportEventTierService } from '../events/wiring';
import { createCupService } from '../cups/wiring';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import type { ContestOpeningReader } from './contest-opening';
import { createBatchedContestOpeningReader, createContestSportEventReader } from './contest-sport-event-reader';
import { ContestManagementService } from './service';

export function createContestManagementService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  planEntitlements: PlanEntitlementsService,
  options: {
    /** What follows a contest's status change (#1949): the app's one handler map, built in index.ts. */
    domainEvents: Pick<DomainEvents, 'collect' | 'collectEach'>;
    /** Who is told a contest has opened (#845); without it, nobody is. */
    contestOpened?: ContestOpenedNotice;
  },
): ContestManagementService {
  const sportEventTierService = createSportEventTierService(prisma, logger);
  return new ContestManagementService({
    contests: new PrismaContestRepository(prisma),
    configTemplates: new PrismaContestConfigTemplateRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    scoringRules: new PrismaParticipantContestScoringRuleRepository(prisma),
    tiers: sportEventTierService,
    logger,
    sportEventReader: createContestSportEventReader({
      sportEvents: new PrismaSportEventRepository(prisma),
      sports: new PrismaSportRepository(prisma),
      field: new PrismaSportEventParticipantRepository(prisma),
      tiers: new PrismaSportEventSlotTierRepository(prisma),
      valuations: new PrismaSportEventSlotParticipantValuationRepository(prisma),
      matches: new PrismaSportEventRoundMatchRepository(prisma),
    }),
    cups: createCupService(prisma, logger, planEntitlements),
    planEntitlements,
    contestOpened: options.contestOpened,
    domainEvents: options.domainEvents,
  });
}

/**
 * What asking whether a setup could open on an event needs (#1007): contest creation's reader,
 * plus the next game a squares contest could still be played on. Its reads are batched (#1316):
 * the events asked about together, as an event page's offers are, are read together, each read
 * once for all of them. Build one for each page read and let it go with it.
 */
export function createContestOpeningReader(prisma: PrismaClient): ContestOpeningReader {
  return createBatchedContestOpeningReader({
    sportEvents: new PrismaSportEventRepository(prisma),
    sports: new PrismaSportRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    tiers: new PrismaSportEventSlotTierRepository(prisma),
    valuations: new PrismaSportEventSlotParticipantValuationRepository(prisma),
    matches: new PrismaSportEventRoundMatchRepository(prisma),
  });
}
