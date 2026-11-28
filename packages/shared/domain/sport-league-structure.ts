/**
 * A sport league's structure (#2002, plans/league-model-redesign.md §1): its timeless phase and
 * slot definitions and how each provider's games match a slot. Set by migration; the League
 * page's Structure tab reads it, and later slices hang Seasons, events and contest coverage on
 * the slot definitions.
 */
import { compareByEnumOrder } from './enum-order';
import {
  LeaguePhaseOrder,
  SlotKindOrder,
  SlotProviderMatchTypeOrder,
  type LeaguePhase,
  type MatchFormat,
  type PeriodUnit,
  type SeriesFormat,
  type SlotKind,
  type SlotPairing,
  type SlotProviderMatchType,
} from './enums';

/** How one provider's games match a slot definition. */
export interface SlotProviderMappingDefinition {
  id: string;
  providerId: string;
  providerName: string;
  /** The provider's own code for the league the mapping reads (`nfl`). */
  providerLeagueCode: string;
  providerLeagueName: string;
  matchType: SlotProviderMatchType;
  /** The adapter's code or the normalized name a game is matched on; null for CALENDAR_WEEK. */
  providerValue: string | null;
}

/** One slot definition: a week, a knockout round or a recurring tournament. */
export interface SportLeagueSlotDefinition {
  id: string;
  /** A code unique in the league that nothing parses. */
  key: string;
  slotKind: SlotKind;
  /** Only on a WEEK slot. */
  weekNumber: number | null;
  /** The league's own proper name for it; null when screens show the word for its kind. */
  name: string | null;
  awardsTrophy: boolean;
  squaresEligible: boolean;
  /** Whether its games are played at a neutral site, neither side at home; each Game of the slot takes it. */
  isNeutralSite: boolean;
  seriesFormat: SeriesFormat;
  seriesGames: number;
  pairing: SlotPairing;
  /** Two sides meeting, or a whole field ranked. */
  matchFormat: MatchFormat;
  /** Whether a game of the slot can finish level; a slot that cannot is decided by overtime or a shoot-out. */
  canEndTied: boolean;
  /** What a game is played in, set with `periodCount`; null with it for a game kept by no period (a race, a tennis match). */
  periodUnit: PeriodUnit | null;
  /** How many periods a game has, overtime aside; null exactly when `periodUnit` is. */
  periodCount: number | null;
  providerMappings: SlotProviderMappingDefinition[];
}

/**
 * One competition of a phase (#2153): what the phase's slots are played as. Most phases hold one,
 * coded as the phase; NCAA Men's Football's POSTSEASON holds the CFP. No contest crosses
 * competitions.
 */
export interface SportLeagueCompetitionDefinition {
  id: string;
  /** A readable key unique in the league (REGULAR, CFP); screens show it until a display key exists, nothing parses it. */
  code: string;
  /** Its place among its phase's competitions, from 1. */
  orderIndex: number;
  /** The conference whose teams alone it places (#2052); null for none. Only a POSTSEASON_CONFERENCE competition names one. */
  conferenceId: string | null;
  /** In play order. */
  slots: SportLeagueSlotDefinition[];
}

/** One phase definition, with its competitions in order. */
export interface SportLeaguePhaseDefinition {
  id: string;
  phase: LeaguePhase;
  /** Whether the league's sync reads the phase; an unsynced phase has no slots. */
  isSynced: boolean;
  competitions: SportLeagueCompetitionDefinition[];
}

export interface SportLeagueStructure {
  /** In the order a Season plays them. */
  phases: SportLeaguePhaseDefinition[];
}

const byPhase = compareByEnumOrder(LeaguePhaseOrder);
const bySlotKind = compareByEnumOrder(SlotKindOrder);
const byMatchType = compareByEnumOrder(SlotProviderMatchTypeOrder);

/**
 * Slots in play order within a competition: by kind (weeks first, the final last), a week by its
 * number. Tournaments have no order of their own until a Season dates them (slice 6), so they
 * come by key, which keeps the list stable.
 */
export function compareSlotDefinitions(
  left: Pick<SportLeagueSlotDefinition, 'slotKind' | 'weekNumber' | 'key'>,
  right: Pick<SportLeagueSlotDefinition, 'slotKind' | 'weekNumber' | 'key'>,
): number {
  return bySlotKind(left.slotKind, right.slotKind)
    || (left.weekNumber ?? 0) - (right.weekNumber ?? 0)
    || left.key.localeCompare(right.key);
}

/** Where a slot sits in a Season's play (#2153): its phase, then its competition's place in that phase. */
export interface SlotPlace {
  phase: LeaguePhase;
  competitionOrderIndex: number;
}

/** Phase order, then competition order within the phase: the one order of a league's competitions. */
export function compareSlotPlaces(left: SlotPlace, right: SlotPlace): number {
  return byPhase(left.phase, right.phase) || left.competitionOrderIndex - right.competitionOrderIndex;
}

/** Mappings by provider, then in the order the sync tries them, then by value. */
function compareMappings(left: SlotProviderMappingDefinition, right: SlotProviderMappingDefinition): number {
  return left.providerName.localeCompare(right.providerName)
    || byMatchType(left.matchType, right.matchType)
    || (left.providerValue ?? '').localeCompare(right.providerValue ?? '');
}

/**
 * A league's structure in its one order: phases as a Season plays them, each one's competitions
 * by their order, and each competition's slots in play order.
 */
export function orderSportLeagueStructure(phases: readonly SportLeaguePhaseDefinition[]): SportLeagueStructure {
  return {
    phases: [...phases]
      .sort((left, right) => byPhase(left.phase, right.phase))
      .map((phase) => ({
        ...phase,
        competitions: [...phase.competitions]
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map((competition) => ({
            ...competition,
            slots: [...competition.slots]
              .sort(compareSlotDefinitions)
              .map((slot) => ({ ...slot, providerMappings: [...slot.providerMappings].sort(compareMappings) })),
          })),
      })),
  };
}
