/**
 * Matching a provider's games to Season slots (league model slice 8, #2005; plan §6, §9c). The
 * provider's adapter reduces each game to the code it names the game's place by (`REG:5`,
 * `POST:3`, a tournament id); the sport league's slot provider mappings say which slot a code is.
 * This is the one matcher: the events sync reads a Season's slots once and matches every provider
 * event's codes here. PROVIDER_CODE mappings and the Season slots a tournament was linked to by its
 * name (NAME_PATTERN, slice 12, #2011) match by code; a game whose feed names no place for it
 * (BALLDONTLIE's college football) matches a DATE_WINDOW slot whose Season window holds its start
 * (#2012), and a game no such slot places goes to the REST_OF_PHASE slot whose window holds it
 * (#2154): a phase's bowls, or a conference title weekend. Calendar weeks come with #2142.
 */

import type { SlotWindow } from './sport-league-seasons';

/**
 * One place a provider event's games are in, by the provider's code, with its games' earliest and
 * latest start. A null code is one game whose feed names no place for it: it is placed by date.
 */
export interface ProviderSlotPlay {
  code: string | null;
  startsAt: Date;
  endsAt: Date;
  /**
   * A game with no code: the provider's feed ids of the teams playing it. A window takes its dates
   * from it, and is confirmed by it, only when every one is on the event's field (#2012).
   */
  teams?: readonly string[];
  /**
   * The provider's ids for the play's games, where its feed names them: the sync records which
   * slot each game is placed in, so an event playing a slot gets that slot's games (#2154).
   */
  gameIds?: readonly string[];
}

/** A Season slot as the events sync reads it: what it is matched by, who covers it, and who plays it. */
export interface SyncSeasonSlot {
  seasonSlotId: string;
  /** The slot definition the Season slot plays. */
  slotDefinitionId: string;
  /** Its definition's key. */
  key: string;
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
  /** The Season competition the slot is in: an event's slots are all of one (#2153). */
  seasonCompetitionId: string;
  /** Its competition's own proper name, which names the event the sync makes for it; null for none (#2154). */
  competitionName: string | null;
  /**
   * Whether the league's selected provider mapping matches the slot's definition by its Season
   * window: DATE_WINDOW or REST_OF_PHASE.
   */
  placedByWindow: boolean;
  /**
   * Whether that mapping is REST_OF_PHASE (#2154): the slot takes every game in its window that no
   * other slot places, whoever plays it, and is matched after every other slot.
   */
  restOfPhase: boolean;
  /** The Season slot's date window, when it is placed by one and the Season has dates for it; null otherwise. */
  window: SlotWindow | null;
}

/** A provider event's plays, each matched to its Season slot or left unmatched. */
export interface ProviderSlotMatches<Slot extends SyncSeasonSlot> {
  /**
   * Each slot its plays reach, with the plays that are its own (`games`). `fromGames` says whether
   * it has any: always for a code; for a DATE_WINDOW slot, only when a game between teams on its
   * field is in its window; for a REST_OF_PHASE slot, whenever a game is left to it. The play is
   * then its games, from the first to the last. A DATE_WINDOW slot holding only other games (a
   * bowl between two unseeded schools, or any game before the seeds are placed) still places the
   * event on the slot, so its seeds can be placed, but its play is the window itself: it takes no
   * dates and confirms no window.
   */
  matched: Array<{ slot: Slot; play: ProviderSlotPlay; fromGames: boolean; games: ProviderSlotPlay[] }>;
  /** The plays whose code no mapping includes: not synced, and raised as a finding. */
  unmatched: CodedSlotPlay[];
  /** The games with no code that no slot's window holds: not synced, and raised as a finding. */
  unplaced: ProviderSlotPlay[];
}

/**
 * Matches each play to the Season slot whose PROVIDER_CODE mapping names its code, or that a
 * tournament of that code was linked to by name. A code names at most one slot (the mappings'
 * unique keys), so a match is never ambiguous.
 *
 * A game with no code goes to the DATE_WINDOW slot whose window holds its start, its window `from`
 * inclusive and `to` exclusive; those windows do not overlap, so that is one slot at most. Of such
 * a window's games, only those whose teams are all on the slot's field (`fieldOf`: the feed ids of
 * the field its event has, empty before its seeds are placed) are the slot's own. Every other game
 * goes to the REST_OF_PHASE slot whose window holds it (#2154): its window spans its phase, it
 * takes whoever plays, and it is matched last, so a game a DATE_WINDOW slot places never lands
 * there too. A game neither places is `unplaced` when no window holds it. A slot's own games are
 * one play, from the earliest start to the latest.
 */
export function matchProviderSlots<Slot extends SyncSeasonSlot>(
  plays: readonly ProviderSlotPlay[],
  slots: readonly Slot[],
  fieldOf: (slot: Slot) => ReadonlySet<string> = () => new Set(),
): ProviderSlotMatches<Slot> {
  const slotByCode = new Map(slots.flatMap((slot) => [slot.providerCode, slot.linkedCode].flatMap((code) => (code === null ? [] : [[code, slot] as const]))));
  const windowed = slots.flatMap((slot) => (slot.window === null ? [] : [{ slot, window: slot.window }]));
  const byDate = windowed.filter(({ slot }) => !slot.restOfPhase);
  const rest = windowed.filter(({ slot }) => slot.restOfPhase);
  const holding = (play: ProviderSlotPlay) => ({ window }: { window: SlotWindow }) => play.startsAt >= window.startsAt && play.startsAt < window.endsAt;
  const matches: ProviderSlotMatches<Slot> = { matched: [], unmatched: [], unplaced: [] };
  /** Each window a game is in, with the games that are its slot's own. */
  const byWindow = new Map<Slot, { window: SlotWindow; games: ProviderSlotPlay[] }>();
  const placeIn = (found: { slot: Slot; window: SlotWindow }, own: ProviderSlotPlay | null) => {
    const placed = byWindow.get(found.slot) ?? { window: found.window, games: [] };
    if (own !== null) placed.games.push(own);
    byWindow.set(found.slot, placed);
  };
  for (const play of plays) {
    if (play.code !== null) {
      const slot = slotByCode.get(play.code);
      if (slot === undefined) matches.unmatched.push({ ...play, code: play.code });
      else matches.matched.push({ slot, play, fromGames: true, games: [play] });
      continue;
    }
    const dated = byDate.find(holding(play));
    const onField = dated !== undefined && play.teams !== undefined && play.teams.length > 0 && play.teams.every((team) => fieldOf(dated.slot).has(team));
    if (dated !== undefined && onField) {
      placeIn(dated, play);
      continue;
    }
    const leftOver = rest.find(holding(play));
    if (leftOver !== undefined) placeIn(leftOver, play);
    // A window holding only other teams' games still places its event on the slot, so its seeds can be placed.
    if (dated !== undefined) placeIn(dated, null);
    if (dated === undefined && leftOver === undefined) matches.unplaced.push(play);
  }
  for (const [slot, { window, games }] of byWindow) {
    const span = spanOf(games);
    matches.matched.push(span === null
      ? { slot, play: { code: null, startsAt: window.startsAt, endsAt: window.endsAt }, fromGames: false, games }
      : { slot, play: span, fromGames: true, games });
  }
  return matches;
}

/** Games as one play, from the earliest start to the latest; null for none. */
function spanOf(games: readonly ProviderSlotPlay[]): ProviderSlotPlay | null {
  if (games.length === 0) return null;
  const starts = games.map((game) => game.startsAt.getTime());
  const ends = games.map((game) => game.endsAt.getTime());
  return { code: null, startsAt: new Date(Math.min(...starts)), endsAt: new Date(Math.max(...ends)) };
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
  /** A play with a code: a game with none is placed by date window, never by name. */
  play: CodedSlotPlay;
}

/** A play whose feed names its place by a code. */
export type CodedSlotPlay = ProviderSlotPlay & { code: string };

/** Where a tournament's name placed it, or why it placed it nowhere. */
type SlotNamePlacement =
  /** One pattern matched and the Season already has that definition's slot, still unlinked: link it. */
  | { outcome: 'LINK'; seasonSlotId: string; play: CodedSlotPlay; name: string }
  /** One pattern matched and the Season has no slot of that definition yet: add it, linked. */
  | { outcome: 'CREATE'; slotDefinitionId: string; play: CodedSlotPlay; name: string; normalizedName: string }
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
