/**
 * Matching a provider's games to Season slots (league model slice 8, #2005; plan §6, §9c). The
 * provider's adapter reduces each game to the code it names the game's place by (`REG:5`,
 * `POST:3`, a tournament id); the sport league's slot provider mappings say which slot a code is.
 * This is the one matcher: the events sync reads a Season's slots once and matches every provider
 * event's codes here. PROVIDER_CODE mappings match a game's code; a game whose feed names no place
 * for it (BALLDONTLIE's college football) matches a DATE_WINDOW slot whose Season window holds its
 * start (#2012). Name patterns come with slice 12 (#2011) and calendar weeks with #2142.
 */

import type { SlotWindowStatus } from './enums';

/**
 * One place a provider event's games are in, by the provider's code, with its games' earliest and
 * latest start. A null code is one game whose feed names no place for it: it is placed by date.
 */
export interface ProviderSlotPlay {
  code: string | null;
  startsAt: Date;
  endsAt: Date;
}

/** A Season slot as the events sync reads it: what it is matched by, who covers it, and who plays it. */
export interface SyncSeasonSlot {
  seasonSlotId: string;
  /**
   * The PROVIDER_CODE value the league's selected provider mapping names the slot's definition by;
   * null when that provider has no such mapping for it (golf's names, slice 12).
   */
  providerCode: string | null;
  /** Whether one of the league's active contest templates lists the slot's definition. */
  coveredByTemplate: boolean;
  /** The event that plays it; null while it is free. */
  sportEventId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  /**
   * The Season slot's date window, when the league's selected provider mapping matches the slot's
   * definition by DATE_WINDOW and the Season has dates for it; null otherwise.
   */
  window: { startsAt: Date; endsAt: Date; status: SlotWindowStatus } | null;
}

/** A provider event's plays, each matched to its Season slot or left unmatched. */
export interface ProviderSlotMatches<Slot extends SyncSeasonSlot> {
  matched: Array<{ slot: Slot; play: ProviderSlotPlay }>;
  /** The plays whose code no mapping includes: not synced, and raised as a finding. */
  unmatched: Array<ProviderSlotPlay & { code: string }>;
  /** The games with no code that no slot's window holds: not synced, and raised as a finding. */
  unplaced: ProviderSlotPlay[];
}

/**
 * Matches each play to the Season slot whose PROVIDER_CODE mapping names its code. A code names at
 * most one slot (the mappings' unique key), so a match is never ambiguous. A game with no code goes
 * to the slot whose window holds its start, its window `from` inclusive and `to` exclusive; a
 * Season's windows do not overlap, so that too is one slot at most. The games one window places are
 * one play, from the earliest start to the latest.
 */
export function matchProviderSlots<Slot extends SyncSeasonSlot>(
  plays: readonly ProviderSlotPlay[],
  slots: readonly Slot[],
): ProviderSlotMatches<Slot> {
  const slotByCode = new Map(slots.flatMap((slot) => (slot.providerCode === null ? [] : [[slot.providerCode, slot] as const])));
  const windowed = slots.filter((slot) => slot.window !== null);
  const matches: ProviderSlotMatches<Slot> = { matched: [], unmatched: [], unplaced: [] };
  const byWindow = new Map<Slot, ProviderSlotPlay>();
  for (const play of plays) {
    if (play.code === null) {
      const slot = windowed.find(({ window }) => window !== null && play.startsAt >= window.startsAt && play.startsAt < window.endsAt);
      if (slot === undefined) {
        matches.unplaced.push(play);
        continue;
      }
      const placed = byWindow.get(slot);
      byWindow.set(slot, placed === undefined ? play : {
        code: null,
        startsAt: play.startsAt < placed.startsAt ? play.startsAt : placed.startsAt,
        endsAt: play.endsAt > placed.endsAt ? play.endsAt : placed.endsAt,
      });
      continue;
    }
    const slot = slotByCode.get(play.code);
    if (slot === undefined) matches.unmatched.push({ ...play, code: play.code });
    else matches.matched.push({ slot, play });
  }
  for (const [slot, play] of byWindow) matches.matched.push({ slot, play });
  return matches;
}

/**
 * A slot's dates from its games (#2003, #2005): the play's earliest and latest start, or null when
 * the slot already has them.
 */
export function slotDatesChange(slot: Pick<SyncSeasonSlot, 'startsAt' | 'endsAt'>, play: ProviderSlotPlay): { startsAt: Date; endsAt: Date } | null {
  const same = slot.startsAt?.getTime() === play.startsAt.getTime() && slot.endsAt?.getTime() === play.endsAt.getTime();
  return same ? null : { startsAt: play.startsAt, endsAt: play.endsAt };
}

/**
 * The plays dated outside their Season's span (#2012): a game before the Season starts or after
 * it ends. Each is still written; the sync raises one WARNING for it, since a span that misses a
 * game is a Season row to fix, not a game to drop.
 */
export function playsOutsideSeason<Play extends ProviderSlotPlay>(
  plays: readonly Play[],
  season: { startsAt: Date; endsAt: Date },
): Play[] {
  return plays.filter((play) => play.startsAt < season.startsAt || play.endsAt > season.endsAt);
}
