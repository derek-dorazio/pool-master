import { displayString, enumLabel } from '@poolmaster/shared/display-strings';
import { SeriesFormat, type LeaguePhase } from '@poolmaster/shared/domain';
import type { SlotProviderMappingDto, SportLeaguePhaseDefinitionDto, SportLeagueSlotDefinitionDto } from '@/lib/api';

/** One slot definition on the Structure tab's grid, with the phase it is in. */
export type SlotDefinitionRow = SportLeagueSlotDefinitionDto & { phase: LeaguePhase };

/** Every phase's slots, in the order the API gave them: phases in Season order, slots in play order. */
export function slotRowsOf(phases: readonly SportLeaguePhaseDefinitionDto[]): SlotDefinitionRow[] {
  return phases.flatMap((phase) => phase.slots.map((slot) => ({ ...slot, phase: phase.phase })));
}

/** How a slot's meeting is decided: "Single game", or the format with its games ("Best of · 7 games"). */
export function seriesText(slot: Pick<SportLeagueSlotDefinitionDto, 'seriesFormat' | 'seriesGames'>): string {
  const format = enumLabel('SeriesFormat', slot.seriesFormat);
  return slot.seriesFormat === SeriesFormat.SINGLE_GAME ? format : `${format} · ${displayString('word.seriesGames', { count: slot.seriesGames })}`;
}

/** One provider mapping in a line: the provider and its league, how it matches, and on what. */
export function mappingText(mapping: SlotProviderMappingDto): string {
  const matched = enumLabel('SlotProviderMatchType', mapping.matchType);
  const on = mapping.providerValue === null ? matched : `${matched} ${mapping.providerValue}`;
  return `${mapping.providerName} ${mapping.providerLeagueCode} · ${on}`;
}
