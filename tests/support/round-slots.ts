/**
 * A round's slot as the round and match reads give it (#2006), for tests that build rounds and
 * games by hand. Each kind (and week) is its own Season slot, so rounds of different kinds read
 * as played in different slots. Test code only.
 */
import { createHash } from 'node:crypto';
import { SlotKind, SlotPairing, chooseSlotTiebreakerGame, type SportEventRoundMatch, type SportEventRoundSlot } from '@poolmaster/shared/domain';

/** A Season slot id for a name, the same each run: a UUID, as the wire's slot id is. */
function slotIdOf(name: string): string {
  const hex = createHash('sha256').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function roundSlot(slotKind: SlotKind, overrides: Partial<SportEventRoundSlot> = {}): SportEventRoundSlot {
  const seasonSlotId = overrides.seasonSlotId ?? slotIdOf(`${slotKind}-${String(overrides.weekNumber ?? 0)}`);
  return {
    seasonSlotId,
    // Each Season slot plays a definition of its own, unless the test names one.
    slotDefinitionId: slotIdOf(`definition-${seasonSlotId}`),
    name: null,
    slotKind,
    weekNumber: null,
    seriesGames: 1,
    pairing: SlotPairing.FIXED,
    canEndTied: false,
    isNeutralSite: false,
    squaresEligible: true,
    periods: null,
    tiebreakerMatchId: null,
    ...overrides,
  };
}

/** A week of games' slot. */
export function weekRoundSlot(weekNumber = 1): SportEventRoundSlot {
  return roundSlot(SlotKind.WEEK, { weekNumber });
}

/**
 * The slots of a bracket of `rounds` rounds, first to final: the last is the FINAL, the one before
 * it the SEMIFINAL, the earlier ones kinds of their own, as a league's postseason definitions are.
 */
export function bracketRoundSlots(rounds: number, overrides: Partial<SportEventRoundSlot> = {}): SportEventRoundSlot[] {
  const kinds = [SlotKind.PLAY_IN, SlotKind.ROUND_OF_64, SlotKind.ROUND_OF_32, SlotKind.ROUND_OF_16, SlotKind.QUARTERFINAL, SlotKind.SEMIFINAL, SlotKind.FINAL];
  if (rounds > kinds.length) throw new Error(`A test bracket has at most ${String(kinds.length)} rounds, not ${String(rounds)}.`);
  return kinds.slice(kinds.length - rounds).map((slotKind) => roundSlot(slotKind, overrides));
}

/** A round row's `eventSlot`, as a Prisma stub returns it to the round reads (#2006): one TOURNAMENT slot. */
export function eventSlotRowStub(seasonSlotId = 'season-slot-tournament') {
  return {
    seasonSlot: {
      id: seasonSlotId, sportLeagueCompetitionSlotId: 'definition-tournament', startsAt: null, endsAt: null, status: 'SCHEDULED' as const,
      seriesFormat: 'SINGLE_GAME' as const, seriesGames: 1, pairing: 'FIXED' as const, isTestData: false, label: null,
      windowStartsAt: null, windowEndsAt: null, windowStatus: null,
      definition: { key: 'TOURNAMENT', slotKind: 'TOURNAMENT' as const, weekNumber: null, name: null, canEndTied: false },
    },
    tiebreakerGame: null,
  };
}

/** Round `roundNumber`'s slot when each round is a slot of its own (a bracket's), none of them the FINAL. */
export function slotOfRound(roundNumber: number): SportEventRoundSlot {
  return roundSlot(SlotKind.QUARTERFINAL, { seasonSlotId: slotIdOf(`round-${String(roundNumber)}`) });
}

/** Round `roundNumber`'s own slot named `names[roundNumber - 1]`, the last of `names` the FINAL: a bracket named by its slots. */
export function namedSlotOfRound(roundNumber: number, names: readonly string[]): SportEventRoundSlot {
  return roundSlot(roundNumber === names.length ? SlotKind.FINAL : SlotKind.QUARTERFINAL, {
    seasonSlotId: slotIdOf(`round-${String(roundNumber)}`),
    name: names[roundNumber - 1] ?? null,
  });
}

/**
 * Games as the stored rows read once the slot rule has run (#2048): each slot names its
 * tiebreaker game, the rule's choice among its timed games. A fixture slot with no timed game
 * stands for one whose games are all scheduled together later, so it names its last game in
 * game order (a bracket's final). Test code only.
 */
export function withSlotTiebreakers<Match extends Pick<SportEventRoundMatch, 'id' | 'sportEventId' | 'slot' | 'scheduledDate' | 'status' | 'roundNumber' | 'matchNumber'>>(matches: readonly Match[]): Match[] {
  // A fixture's events may share a slot id, so each event's slot is its own.
  const slotKey = (match: Match) => JSON.stringify([match.sportEventId, match.slot.seasonSlotId]);
  const chosenBySlot = new Map<string, string | null>();
  for (const slotId of new Set(matches.map(slotKey))) {
    const inSlot = matches.filter((match) => slotKey(match) === slotId);
    const chosen = chooseSlotTiebreakerGame(inSlot.map((match) => ({ id: match.id, scheduledDate: match.scheduledDate, roundNumber: match.roundNumber, status: match.status, moved: false })));
    chosenBySlot.set(slotId, chosen?.id ?? null);
  }
  return matches.map((match) => ({ ...match, slot: { ...match.slot, tiebreakerMatchId: chosenBySlot.get(slotKey(match)) ?? null } }));
}
