/**
 * The one construction of ContestManagementService. Contest creation lives on the contests
 * module's `createContest` route (#245) and the configuration reads and writes on this module's,
 * so both build the service here rather than each wiring its dependencies.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRepository, SportRepository } from '@poolmaster/shared/db';
import { getDefaultTournamentFormatForSport } from '@poolmaster/shared/domain';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaSportEventRepository,
  PrismaSportRepository,
} from '../../adapters';
import { createSportEventTierService } from '../events/wiring';
import { ContestManagementService, type ContestCreateSportEventReader } from './service';

export function createContestManagementService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
): ContestManagementService {
  const sportEventTierService = createSportEventTierService(prisma, logger);
  return new ContestManagementService(
    new PrismaContestRepository(prisma),
    new PrismaContestConfigTemplateRepository(prisma),
    new PrismaContestConfigurationRepository(prisma),
    new PrismaParticipantContestScoringRuleRepository(prisma),
    sportEventTierService,
    logger,
    createContestSportEventReader(new PrismaSportEventRepository(prisma), new PrismaSportRepository(prisma)),
  );
}

/**
 * What contest creation needs to know about the event: its release and field-lock timing, its
 * sport's tournament format, and how much of its field has loaded. Composed from the slice-2
 * ports (#247) — it was a raw Prisma read inlined here.
 */
export function createContestSportEventReader(
  sportEvents: SportEventRepository,
  sports: SportRepository,
): ContestCreateSportEventReader {
  return {
    findById: async (sportEventId) => {
      const event = await sportEvents.findById(sportEventId);
      if (!event) {
        return null;
      }
      const [sport, loaded] = await Promise.all([
        sports.findByName(event.sport),
        sportEvents.countParticipants([sportEventId]),
      ]);
      return {
        id: event.id,
        releaseAt: event.releaseAt,
        fieldLocksAt: event.fieldLocksAt,
        fieldLocked: event.fieldLocked,
        sport: event.sport,
        tournamentFormat: sport?.tournamentFormat ?? getDefaultTournamentFormatForSport(event.sport),
        participantCount: event.participantCount ?? null,
        loadedParticipantCount: loaded.get(sportEventId) ?? 0,
      };
    },
  };
}
