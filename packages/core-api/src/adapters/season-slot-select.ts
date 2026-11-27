/**
 * The one select and row mapping for a Season slot (#2004): what the Structure tab, an event's
 * Slots tab and an event create read of it, with its definition's key, kind, week and name, and its
 * date window (#2012).
 */
import type { Prisma } from '@prisma/client';
import { slotPeriodsOf, type SportEventRoundSlot, type SportLeagueSeasonSlot } from '@poolmaster/shared/domain';

export const SEASON_SLOT_SELECT = {
  id: true, sportLeagueCompetitionSlotId: true, startsAt: true, endsAt: true, status: true,
  seriesFormat: true, seriesGames: true, pairing: true, isTestData: true, label: true,
  windowStartsAt: true, windowEndsAt: true, windowStatus: true,
  definition: { select: { key: true, slotKind: true, weekNumber: true, name: true, canEndTied: true, periodUnit: true, periodCount: true } },
} as const satisfies Prisma.SportLeagueSeasonCompetitionSlotSelect;

export type SeasonSlotRow = Prisma.SportLeagueSeasonCompetitionSlotGetPayload<{ select: typeof SEASON_SLOT_SELECT }>;

export function toSeasonSlot({ sportLeagueCompetitionSlotId, definition: { canEndTied: _canEndTied, periodUnit: _periodUnit, periodCount: _periodCount, ...definition }, windowStartsAt, windowEndsAt, windowStatus, ...slot }: SeasonSlotRow): SportLeagueSeasonSlot {
  return {
    ...slot,
    ...definition,
    slotDefinitionId: sportLeagueCompetitionSlotId,
    // The database check sets the three window columns together (#2012).
    window: windowStartsAt !== null && windowEndsAt !== null && windowStatus !== null
      ? { startsAt: windowStartsAt, endsAt: windowEndsAt, status: windowStatus }
      : null,
  };
}

/**
 * An event that covers a test slot, as a relation filter on its `slots` (#2004): the one database
 * form of `isTestEvent`. `some` finds test events and `none` leaves them out.
 */
export const COVERS_TEST_SLOT = { seasonSlot: { isTestData: true } } as const satisfies Prisma.SportEventSlotWhereInput;

/**
 * A round's slot through its event slot (#2006): the select a round or a match reads it with, and
 * the match of its tiebreaker game (#2048).
 */
export const ROUND_EVENT_SLOT_SELECT = {
  select: { seasonSlot: { select: SEASON_SLOT_SELECT }, tiebreakerGame: { select: { sportEventRoundMatchId: true } } },
} as const satisfies Prisma.SportEventSlotDefaultArgs;

/** The slot a round is played in, as `SportEventRound.slot` and `SportEventRoundMatch.slot` carry it. */
export function toRoundSlot(eventSlot: Prisma.SportEventSlotGetPayload<typeof ROUND_EVENT_SLOT_SELECT>): SportEventRoundSlot {
  const { id, slotDefinitionId, name, slotKind, weekNumber, seriesGames, pairing } = toSeasonSlot(eventSlot.seasonSlot);
  const { definition } = eventSlot.seasonSlot;
  return { seasonSlotId: id, slotDefinitionId, name, slotKind, weekNumber, seriesGames, pairing, canEndTied: definition.canEndTied, periods: slotPeriodsOf(definition), tiebreakerMatchId: eventSlot.tiebreakerGame?.sportEventRoundMatchId ?? null };
}

/**
 * A match whose round is played in a FIELD slot (#2008): a golf round or a race, every
 * competitor a side. Field reads keep these apart from the head-to-head matches.
 */
export const FIELD_MATCH_WHERE = {
  sportEventRound: { eventSlot: { seasonSlot: { definition: { matchFormat: 'FIELD' } } } },
} as const satisfies Prisma.SportEventRoundMatchWhereInput;
