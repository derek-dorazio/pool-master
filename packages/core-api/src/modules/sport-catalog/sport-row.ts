/**
 * requireSportRow — resolves a `Sport` enum value to its persisted `Sport`
 * table row (`Participant.sportId`, `SportLeague.sportId`, etc. are real FKs
 * to this row, not the bare enum). Shared by `SportLeagueService` and the
 * golf player roster routes so there is exactly one "no Sport row exists for
 * this sport" failure mode, not two independently-drifting lookups.
 */

import type { PrismaClient } from '@prisma/client';
import type { Sport } from '@poolmaster/shared/domain';
import { SportCatalogError } from './errors';

export async function requireSportRow(prisma: PrismaClient, sport: Sport): Promise<{ id: string }> {
  const sportRow = await prisma.sport.findUnique({ where: { name: sport } });
  if (!sportRow) {
    throw new SportCatalogError(`No Sport row exists for ${sport}.`, 'SPORT_NOT_FOUND', 404);
  }
  return sportRow;
}
