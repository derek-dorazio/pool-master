/**
 * A sport league's Seasons (#2003, plans/league-model-redesign.md §2): each one real Season with
 * its name, championship year and date span, set by the migration that adds it and never worked
 * out from a clock. A Season has a phase for each of the league's phase definitions and a slot for
 * each definition of a synced phase (TOURNAMENT slots are added when the first tournament
 * matches); a slot's dates come from its Games once the sync matches them.
 */
import { compareSlotDefinitions } from './sport-league-structure';
import { compareByEnumOrder } from './enum-order';
import {
  LeaguePhaseOrder,
  SlotKind,
  type LeaguePhase,
  type SeasonSlotStatus,
  type SeriesFormat,
  type SlotPairing,
} from './enums';

/** A provider's own id for a Season: how the sync asks that feed for it. */
export interface SportLeagueSeasonProviderMapping {
  id: string;
  /** The league's provider mapping the id belongs to. */
  sportLeagueProviderMappingId: string;
  providerId: string;
  providerName: string;
  providerLeagueCode: string;
  /** The provider's season id as it sends it. */
  providerSeasonId: string;
}

/** One slot of one Season: a slot definition played that Season, or a labelled test slot. */
export interface SportLeagueSeasonSlot {
  id: string;
  /** The slot definition it plays. */
  slotDefinitionId: string;
  key: string;
  slotKind: SlotKind;
  weekNumber: number | null;
  /** The definition's proper name; null when screens show the word for its kind. */
  name: string | null;
  /** The earliest start and latest end of its Games; null until the sync has matched one. */
  startsAt: Date | null;
  endsAt: Date | null;
  status: SeasonSlotStatus;
  seriesFormat: SeriesFormat;
  seriesGames: number;
  pairing: SlotPairing;
  /** A test slot, which the sync never reads or writes; QA only. */
  isTestData: boolean;
  /** A test slot's label; null on a synced slot. */
  label: string | null;
}

/** One phase of one Season, with its slots in play order. */
export interface SportLeagueSeasonPhase {
  id: string;
  phase: LeaguePhase;
  isSynced: boolean;
  slots: SportLeagueSeasonSlot[];
}

/** One Season of a sport league. */
export interface SportLeagueSeason {
  id: string;
  sportLeagueId: string;
  /** What screens call it: "2025-26", "2026". */
  name: string;
  /** The year it is named for: NFL 2025 for a Super Bowl in February 2026. */
  championshipYear: number;
  startsAt: Date;
  endsAt: Date;
}

/** A Season with its provider ids and its phases and slots, as the Structure tab lists it. */
export interface SportLeagueSeasonDetail extends SportLeagueSeason {
  /** Whether it is its league's current Season. */
  isCurrent: boolean;
  providerMappings: SportLeagueSeasonProviderMapping[];
  phases: SportLeagueSeasonPhase[];
}

/** What the current-Season rule reads of one Season. */
export interface CurrentSeasonCandidate {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Whether any event the sync made is in it (slice 7 moves this to its slots). */
  hasSyncedEvent: boolean;
}

/**
 * A league's current Season (plan §2, the one rule every reader of "the current season" goes
 * through): the Season whose span holds `now`; between Seasons the next one once it has a synced
 * event (its schedule is published), otherwise the one that ended last; a league whose Seasons
 * all lie ahead takes the first. Null for a league with no Season.
 */
export function currentSeasonOf(seasons: readonly CurrentSeasonCandidate[], now: Date): string | null {
  const byStart = [...seasons].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  const underWay = byStart.find((season) => season.startsAt <= now && now <= season.endsAt);
  if (underWay) return underWay.id;
  const next = byStart.find((season) => season.startsAt > now);
  if (next?.hasSyncedEvent) return next.id;
  const last = byStart.filter((season) => season.endsAt < now).at(-1);
  return (last ?? next)?.id ?? null;
}

/**
 * The Seasons the events sync reads (plan §6): the current Season and every later one, in date
 * order. None when the league has no current Season.
 */
export function seasonsToSync<Season extends Pick<SportLeagueSeason, 'id' | 'startsAt'>>(
  seasons: readonly Season[],
  currentSeasonId: string | null,
): Season[] {
  const current = seasons.find((season) => season.id === currentSeasonId);
  if (current === undefined) return [];
  return [...seasons]
    .filter((season) => season.startsAt >= current.startsAt)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

const byPhase = compareByEnumOrder(LeaguePhaseOrder);

/**
 * Slots in play order within a phase: by kind and week number as their definitions are, a
 * TOURNAMENT slot by its start (the PGA's order changes every year; an undated one comes last, by
 * key), and a test slot after its definition's synced slot, by label.
 */
export function compareSeasonSlots(left: SportLeagueSeasonSlot, right: SportLeagueSeasonSlot): number {
  const byDate = (left.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  const tournaments = left.slotKind === right.slotKind && left.slotKind === SlotKind.TOURNAMENT ? byDate : 0;
  return tournaments
    || compareSlotDefinitions(left, right)
    || Number(left.isTestData) - Number(right.isTestData)
    || (left.label ?? '').localeCompare(right.label ?? '');
}

/** A league's Seasons in their one order, latest first; each Season's phases and slots in play order. */
export function orderSportLeagueSeasons(seasons: readonly SportLeagueSeasonDetail[]): SportLeagueSeasonDetail[] {
  return [...seasons]
    .sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())
    .map((season) => ({
      ...season,
      providerMappings: [...season.providerMappings].sort((left, right) => left.providerName.localeCompare(right.providerName)),
      phases: [...season.phases]
        .sort((left, right) => byPhase(left.phase, right.phase))
        .map((phase) => ({ ...phase, slots: [...phase.slots].sort(compareSeasonSlots) })),
    }));
}

/** A Season's own facts, as a write gives them. */
export type SportLeagueSeasonSpan = Pick<SportLeagueSeason, 'name' | 'championshipYear' | 'startsAt' | 'endsAt'>;

/**
 * The one Season a sport league made through the admin API starts with (#2003): `now`'s calendar
 * year in UTC, named for it. Every other Season is added by migration. A stopgap for the browser
 * journeys, which make their own leagues; it goes when they move to test slots (#2004).
 */
export function calendarYearSeason(now: Date): SportLeagueSeasonSpan {
  const championshipYear = now.getUTCFullYear();
  return {
    name: String(championshipYear),
    championshipYear,
    startsAt: new Date(Date.UTC(championshipYear, 0, 1)),
    endsAt: new Date(Date.UTC(championshipYear + 1, 0, 1) - 1),
  };
}
