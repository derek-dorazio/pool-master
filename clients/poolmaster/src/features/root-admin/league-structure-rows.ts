import { displayString, enumLabel } from '@poolmaster/shared/display-strings';
import { SeriesFormat, type LeaguePhase } from '@poolmaster/shared/domain';
import type {
  SlotProviderMappingDto,
  SportLeaguePhaseDefinitionDto,
  SportLeaguePositionProviderCodeDto,
  SportLeagueSeasonDto,
  SportLeagueSeasonCompetitionSlotDto,
  SportLeagueSeasonProviderMappingDto,
  SportLeagueSlotDefinitionDto,
} from '@/lib/api';

/** One slot definition on the Structure tab's grid, with the phase and competition it is in (#2153). */
export type SlotDefinitionRow = SportLeagueSlotDefinitionDto & { phase: LeaguePhase; competitionCode: string };

/**
 * Every competition's slots, in the order the API gave them: phases in Season order, competitions
 * in their order within the phase, slots in play order.
 */
export function slotRowsOf(phases: readonly SportLeaguePhaseDefinitionDto[]): SlotDefinitionRow[] {
  return phases.flatMap((phase) => phase.competitions.flatMap((competition) => competition.slots.map((slot) => ({
    ...slot,
    phase: phase.phase,
    competitionCode: competition.code,
  }))));
}

/** How many slot definitions a phase has, across its competitions. */
export function phaseSlotCount(phase: SportLeaguePhaseDefinitionDto): number {
  return phase.competitions.reduce((count, competition) => count + competition.slots.length, 0);
}

/** A phase's competitions by code, in their order ("BOWLS, CFP"); a competition shows its code until it has a display key. */
export function competitionCodesText(phase: Pick<SportLeaguePhaseDefinitionDto, 'competitions'>): string {
  return phase.competitions.map((competition) => competition.code).join(', ');
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

/** One Season slot on the Structure tab's grid, with its Season, phase and competition. */
export type SeasonSlotRow = SportLeagueSeasonCompetitionSlotDto & { seasonId: string; seasonName: string; phase: LeaguePhase; competitionCode: string };

/** Every Season's slots, in the order the API gave them: Seasons latest first, then phases, competitions and slots in play order. */
export function seasonSlotRowsOf(seasons: readonly SportLeagueSeasonDto[]): SeasonSlotRow[] {
  return seasons.flatMap((season) => season.phases.flatMap((phase) => phase.competitions.flatMap((competition) => competition.slots.map((slot) => ({
    ...slot,
    seasonId: season.id,
    seasonName: season.name,
    phase: phase.phase,
    competitionCode: competition.code,
  })))));
}

/** One Season's competition, as the Season dialog lists it, with its phase. */
export type SeasonCompetitionRow = SportLeagueSeasonDto['phases'][number]['competitions'][number] & { phase: LeaguePhase };

/** A Season's competitions in play order: phases in Season order, then competitions in their order. */
export function seasonCompetitionsOf(season: Pick<SportLeagueSeasonDto, 'phases'>): SeasonCompetitionRow[] {
  return season.phases.flatMap((phase) => phase.competitions.map((competition) => ({ ...competition, phase: phase.phase })));
}

/** One provider's id for a Season in a line: the provider and its league, then the id. */
export function seasonMappingText(mapping: SportLeagueSeasonProviderMappingDto): string {
  return `${mapping.providerName} ${mapping.providerLeagueCode} · ${mapping.providerSeasonId}`;
}

/** One provider code for a position, conference or division in a line, as the slots' mappings read: the provider and its league, then the code its feed sends. */
export function providerCodeText(code: SportLeaguePositionProviderCodeDto): string {
  return `${enumLabel('ProviderCode', code.provider)} ${code.providerLeagueCode} · ${code.providerCode}`;
}

/** What a slot's game is played in, with how many ("Quarters · 4"); "No periods" for a game kept by none. */
export function periodsText(slot: Pick<SportLeagueSlotDefinitionDto, 'periodUnit' | 'periodCount'>): string {
  return slot.periodUnit === null || slot.periodCount === null ? 'No periods' : `${enumLabel('PeriodUnit', slot.periodUnit)} · ${String(slot.periodCount)}`;
}

/** Each Season with slots that need dates, as "2026-27 (2)", in the API's order: latest first. */
export function seasonsNeedingDatesText(seasons: readonly Pick<SportLeagueSeasonDto, 'name' | 'slotsNeedingDates'>[]): string | null {
  const needing = seasons.filter((season) => season.slotsNeedingDates > 0);
  return needing.length === 0 ? null : needing.map((season) => `${season.name} (${String(season.slotsNeedingDates)})`).join(', ');
}
