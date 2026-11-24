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
  seriesFormat: SeriesFormat;
  seriesGames: number;
  pairing: SlotPairing;
  providerMappings: SlotProviderMappingDefinition[];
}

/** One phase definition, with its slots in play order. */
export interface SportLeaguePhaseDefinition {
  id: string;
  phase: LeaguePhase;
  /** Whether the league's sync reads the phase; an unsynced phase has no slots. */
  isSynced: boolean;
  slots: SportLeagueSlotDefinition[];
}

export interface SportLeagueStructure {
  /** In the order a Season plays them. */
  phases: SportLeaguePhaseDefinition[];
}

const byPhase = compareByEnumOrder(LeaguePhaseOrder);
const bySlotKind = compareByEnumOrder(SlotKindOrder);
const byMatchType = compareByEnumOrder(SlotProviderMatchTypeOrder);

/**
 * Slots in play order within a phase: by kind (weeks first, the final last), a week by its
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

/** Mappings by provider, then in the order the sync tries them, then by value. */
function compareMappings(left: SlotProviderMappingDefinition, right: SlotProviderMappingDefinition): number {
  return left.providerName.localeCompare(right.providerName)
    || byMatchType(left.matchType, right.matchType)
    || (left.providerValue ?? '').localeCompare(right.providerValue ?? '');
}

/** A league's structure in its one order: phases as a Season plays them, each one's slots in play order. */
export function orderSportLeagueStructure(phases: readonly SportLeaguePhaseDefinition[]): SportLeagueStructure {
  return {
    phases: [...phases]
      .sort((left, right) => byPhase(left.phase, right.phase))
      .map((phase) => ({
        ...phase,
        slots: [...phase.slots]
          .sort(compareSlotDefinitions)
          .map((slot) => ({ ...slot, providerMappings: [...slot.providerMappings].sort(compareMappings) })),
      })),
  };
}
