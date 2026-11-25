/**
 * The one select and row mapping for a Season slot (#2004): what the Structure tab, an event's
 * Slots tab and an event create read of it, with its definition's key, kind, week and name.
 */
import type { Prisma } from '@prisma/client';
import type { SportLeagueSeasonSlot } from '@poolmaster/shared/domain';

export const SEASON_SLOT_SELECT = {
  id: true, sportLeaguePhaseSlotId: true, startsAt: true, endsAt: true, status: true,
  seriesFormat: true, seriesGames: true, pairing: true, isTestData: true, label: true,
  definition: { select: { key: true, slotKind: true, weekNumber: true, name: true } },
} as const satisfies Prisma.SportLeagueSeasonPhaseSlotSelect;

export type SeasonSlotRow = Prisma.SportLeagueSeasonPhaseSlotGetPayload<{ select: typeof SEASON_SLOT_SELECT }>;

export function toSeasonSlot({ sportLeaguePhaseSlotId, definition, ...slot }: SeasonSlotRow): SportLeagueSeasonSlot {
  return { ...slot, ...definition, slotDefinitionId: sportLeaguePhaseSlotId };
}
