/**
 * requireSport — resolves a `Sport` enum value to its persisted `Sport` row
 * (`Participant.sportId`, `SportLeague.sportId`, etc. are real FKs to this
 * row, not the bare enum). The one "no Sport row exists for this sport"
 * failure mode for every caller.
 */

import type { PrismaClient } from '@prisma/client';
import type { SportRepository } from '@poolmaster/shared/db';
import type { Sport, SportConfig } from '@poolmaster/shared/domain';
import { PrismaSportRepository } from '../../adapters';
import { SportCatalogError } from './errors';

export async function requireSport(sports: SportRepository, sport: Sport): Promise<SportConfig> {
  const sportRow = await sports.findByName(sport);
  if (!sportRow) {
    throw new SportCatalogError(`No Sport row exists for ${sport}.`, 'SPORT_NOT_FOUND', 404);
  }
  return sportRow;
}

/**
 * The same lookup for the golf services still built on a PrismaClient. They move
 * onto injected ports in #236, and this wrapper goes with them.
 */
export function requireSportRow(prisma: PrismaClient, sport: Sport): Promise<SportConfig> {
  return requireSport(new PrismaSportRepository(prisma), sport);
}
