/**
 * Matching a provider's games to Season slots (league model slice 8, #2005; plan §6, §9c). The
 * provider's adapter reduces each game to the code it names the game's place by (`REG:5`,
 * `POST:3`, a tournament id); the sport league's slot provider mappings say which slot a code is.
 * This is the one matcher: the events sync reads a Season's slots once and matches every provider
 * event's codes here. PROVIDER_CODE mappings and the Season slots a tournament was linked to by its
 * name (NAME_PATTERN, slice 12, #2011) match by code; date windows and calendar weeks come with
 * slice 13 (#2012).
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
  /** The slot definition the Season slot plays. */
  slotDefinitionId: string;
  /**
   * The PROVIDER_CODE value the league's selected provider mapping names the slot's definition by;
   * null when that provider has no such mapping for it (a tournament matched by name).
   */
  providerCode: string | null;
  /**
   * The provider's code for the tournament the Season slot was linked to by its name (#2011): it
   * matches by this code from then on, whatever the tournament is called. Null until linked.
   */
  linkedCode: string | null;
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
 * Matches each play to the Season slot whose PROVIDER_CODE mapping names its code, or that a
 * tournament of that code was linked to by name. A code names at most one slot (the mappings'
 * unique keys), so a match is never ambiguous.
 */
export function matchProviderSlots<Slot extends SyncSeasonSlot>(
  plays: readonly ProviderSlotPlay[],
  slots: readonly Slot[],
): ProviderSlotMatches<Slot> {
  const slotByCode = new Map(slots.flatMap((slot) => [slot.providerCode, slot.linkedCode].flatMap((code) => (code === null ? [] : [[code, slot] as const]))));
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

/**
 * A tournament name as NAME_PATTERN mappings hold it (#2011, plan §6 item 2): lower case, with any
 * year and anything from "presented by" on removed, and its spaces collapsed. "The 2027 Memorial
 * Tournament presented by Workday" and "the Memorial Tournament" are the same name.
 */
function normalizeSlotName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bpresented by\b.*$/u, '')
    .replace(/\b(?:19|20)\d{2}\b/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** A NAME_PATTERN mapping: the slot definition a normalized tournament name places a tournament on. */
export interface SlotNamePattern {
  slotDefinitionId: string;
  pattern: string;
}

/** A provider event whose plays no code placed, by its name and its first play. */
export interface UnplacedProviderEvent {
  name: string;
  play: ProviderSlotPlay;
}

/** Where a tournament's name placed it, or why it placed it nowhere. */
type SlotNamePlacement =
  /** One pattern matched and the Season already has that definition's slot, still unlinked: link it. */
  | { outcome: 'LINK'; seasonSlotId: string; play: ProviderSlotPlay; name: string }
  /** One pattern matched and the Season has no slot of that definition yet: add it, linked. */
  | { outcome: 'CREATE'; slotDefinitionId: string; play: ProviderSlotPlay; name: string; normalizedName: string }
  /** No pattern matched: nothing is created, and a finding offers "link to existing". */
  | { outcome: 'UNMATCHED'; normalizedName: string; name: string }
  /**
   * More than one definition's pattern matched, or the one it matched is already linked to another
   * tournament this Season: nothing is linked, and an ERROR finding is raised.
   */
  | { outcome: 'AMBIGUOUS'; normalizedName: string; name: string };

/**
 * Places each tournament no code placed by its normalized name (#2011): the one matcher for
 * NAME_PATTERN mappings, for leagues whose provider mapping has any. Name matching happens only
 * here, for a tournament the feed gives no better key for, and once linked it matches by code
 * (`matchProviderSlots`). Two tournaments of one slate whose names match one definition: the first
 * is placed and the second is ambiguous, since a Season slot takes one tournament.
 */
export function placeSlotsByName(
  events: readonly UnplacedProviderEvent[],
  slots: readonly SyncSeasonSlot[],
  patterns: readonly SlotNamePattern[],
): SlotNamePlacement[] {
  const definitionsByPattern = new Map<string, Set<string>>();
  for (const { pattern, slotDefinitionId } of patterns) {
    definitionsByPattern.set(pattern, (definitionsByPattern.get(pattern) ?? new Set()).add(slotDefinitionId));
  }
  const slotByDefinition = new Map(slots.map((slot) => [slot.slotDefinitionId, slot]));
  const claimed = new Set(slots.flatMap((slot) => (slot.linkedCode === null ? [] : [slot.slotDefinitionId])));
  return events.map(({ name, play }): SlotNamePlacement => {
    const normalizedName = normalizeSlotName(name);
    const definitions = [...(definitionsByPattern.get(normalizedName) ?? [])];
    if (definitions.length === 0) return { outcome: 'UNMATCHED', normalizedName, name };
    const [slotDefinitionId] = definitions;
    if (definitions.length > 1 || claimed.has(slotDefinitionId)) return { outcome: 'AMBIGUOUS', normalizedName, name };
    claimed.add(slotDefinitionId);
    const slot = slotByDefinition.get(slotDefinitionId);
    return slot === undefined
      ? { outcome: 'CREATE', slotDefinitionId, play, name, normalizedName }
      : { outcome: 'LINK', seasonSlotId: slot.seasonSlotId, play, name };
  });
}
