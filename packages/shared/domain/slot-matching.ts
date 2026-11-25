/**
 * Matching a provider's games to Season slots (league model slice 8, #2005; plan §6, §9c). The
 * provider's adapter reduces each game to the code it names the game's place by (`REG:5`,
 * `POST:3`, a tournament id); the sport league's slot provider mappings say which slot a code is.
 * This is the one matcher: the events sync reads a Season's slots once and matches every provider
 * event's codes here. PROVIDER_CODE mappings match today; name patterns come with slice 12 (#2011)
 * and date windows and calendar weeks with slice 13 (#2012).
 */

/** One place a provider event's games are in, by the provider's code, with its games' earliest and latest start. */
export interface ProviderSlotPlay {
  code: string;
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
}

/** A provider event's plays, each matched to its Season slot or left unmatched. */
export interface ProviderSlotMatches<Slot extends SyncSeasonSlot> {
  matched: Array<{ slot: Slot; play: ProviderSlotPlay }>;
  /** The plays whose code no mapping includes: not synced, and raised as a finding. */
  unmatched: ProviderSlotPlay[];
}

/**
 * Matches each play to the Season slot whose PROVIDER_CODE mapping names its code. A code names at
 * most one slot (the mappings' unique key), so a match is never ambiguous.
 */
export function matchProviderSlots<Slot extends SyncSeasonSlot>(
  plays: readonly ProviderSlotPlay[],
  slots: readonly Slot[],
): ProviderSlotMatches<Slot> {
  const slotByCode = new Map(slots.flatMap((slot) => (slot.providerCode === null ? [] : [[slot.providerCode, slot] as const])));
  const matches: ProviderSlotMatches<Slot> = { matched: [], unmatched: [] };
  for (const play of plays) {
    const slot = slotByCode.get(play.code);
    if (slot === undefined) matches.unmatched.push(play);
    else matches.matched.push({ slot, play });
  }
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
