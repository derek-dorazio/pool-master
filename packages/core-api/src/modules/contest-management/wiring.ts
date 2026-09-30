/**
 * The one construction of ContestManagementService. Contest creation lives on the contests
 * module's `createContest` route (#245) and the configuration reads and writes on this module's,
 * so both build the service here rather than each wiring its dependencies.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Sport, TournamentFormat } from '@poolmaster/shared/domain';
import { getDefaultTournamentFormatForSport } from '@poolmaster/shared/domain';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestCoreRepository,
  PrismaParticipantContestScoringRuleRepository,
} from '../../adapters';
import { createSportEventTierService } from '../events/wiring';
import { ContestManagementService } from './service';

export function createContestManagementService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
): ContestManagementService {
  const sportEventTierService = createSportEventTierService(prisma, logger);
  return new ContestManagementService(
    new PrismaContestCoreRepository(prisma),
    new PrismaContestConfigTemplateRepository(prisma),
    new PrismaContestConfigurationRepository(prisma),
    new PrismaParticipantContestScoringRuleRepository(prisma),
    sportEventTierService,
    logger,
    {
      findById: async (sportEventId) => {
        const row = await prisma.sportEvent.findUnique({
          where: { id: sportEventId },
          include: {
            _count: {
              select: {
                sportEventParticipants: true,
              },
            },
          },
        });

        if (!row) {
          return null;
        }
        const sport = row.sport as Sport;
        const sportRow = await prisma.sport.findUnique({
          where: { name: row.sport },
          select: { tournamentFormat: true },
        });

        return {
          id: row.id,
          releaseAt: row.releaseAt,
          fieldLocksAt: row.fieldLocksAt,
          fieldLocked: row.fieldLocked,
          sport,
          tournamentFormat:
            (sportRow?.tournamentFormat as TournamentFormat | undefined)
            ?? getDefaultTournamentFormatForSport(sport),
          participantCount: row.participantCount,
          loadedParticipantCount: row._count.sportEventParticipants,
        };
      },
    },
  );
}
