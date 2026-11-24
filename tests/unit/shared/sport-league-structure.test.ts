/**
 * A sport league's structure in its one order (#2002): phases as a Season plays them, slots in
 * play order, mappings by provider then the order the sync tries them; and the DTO the API sends.
 */
import { expect } from '@jest/globals';
import {
  LeaguePhase,
  orderSportLeagueStructure,
  SeriesFormat,
  MatchFormat,
  PeriodUnit,
  SlotKind,
  SlotPairing,
  SlotProviderMatchType,
  type SlotProviderMappingDefinition,
  type SportLeaguePhaseDefinition,
  type SportLeagueSlotDefinition,
} from '@poolmaster/shared/domain';
import { SportLeagueStructureResponseSchema } from '@poolmaster/shared/dto/sport-catalog.dto';
import { mapSportLeagueStructureToDto } from '../../../packages/core-api/src/mappers';

function slot(key: string, slotKind: SlotKind, overrides: Partial<SportLeagueSlotDefinition> = {}): SportLeagueSlotDefinition {
  return {
    id: `00000000-0000-4000-8000-${key.length.toString().padStart(12, '0')}`, key, slotKind, weekNumber: null, name: null, awardsTrophy: false, squaresEligible: false,
    seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1, pairing: SlotPairing.FIXED,
    matchFormat: MatchFormat.HEAD_TO_HEAD, canEndTied: false, periodUnit: PeriodUnit.QUARTER, periodCount: 4, providerMappings: [], ...overrides,
  };
}

function mapping(providerName: string, matchType: SlotProviderMatchType, providerValue: string | null): SlotProviderMappingDefinition {
  return {
    id: '00000000-0000-4000-8000-000000000001', providerId: '00000000-0000-4000-8000-000000000002', providerName,
    providerLeagueCode: 'nba', providerLeagueName: 'NBA', matchType, providerValue,
  };
}

function phase(value: LeaguePhase, slots: SportLeagueSlotDefinition[]): SportLeaguePhaseDefinition {
  return { id: '00000000-0000-4000-8000-000000000003', phase: value, isSynced: true, slots };
}

describe('orderSportLeagueStructure', () => {
  it('orders phases as a Season plays them, preseason before the regular season before the postseason', () => {
    const { phases } = orderSportLeagueStructure([phase(LeaguePhase.POSTSEASON, []), phase(LeaguePhase.PRESEASON, []), phase(LeaguePhase.REGULAR, [])]);

    expect(phases.map((entry) => entry.phase)).toEqual([LeaguePhase.PRESEASON, LeaguePhase.REGULAR, LeaguePhase.POSTSEASON]);
  });

  it('orders a phase\'s weeks by number, not by key, and its knockout rounds from the play-in to the final', () => {
    const { phases } = orderSportLeagueStructure([
      phase(LeaguePhase.REGULAR, [slot('WEEK_10', SlotKind.WEEK, { weekNumber: 10 }), slot('WEEK_2', SlotKind.WEEK, { weekNumber: 2 })]),
      phase(LeaguePhase.POSTSEASON, [slot('FINAL', SlotKind.FINAL), slot('PLAY_IN', SlotKind.PLAY_IN), slot('SEMIFINAL', SlotKind.SEMIFINAL), slot('THIRD_PLACE', SlotKind.THIRD_PLACE)]),
    ]);

    expect(phases.map((entry) => entry.slots.map((item) => item.key))).toEqual([
      ['WEEK_2', 'WEEK_10'],
      ['PLAY_IN', 'SEMIFINAL', 'THIRD_PLACE', 'FINAL'],
    ]);
  });

  it('orders undated tournaments by key, so the list is stable until a Season dates them', () => {
    const { phases } = orderSportLeagueStructure([phase(LeaguePhase.REGULAR, [slot('US_OPEN', SlotKind.TOURNAMENT), slot('MASTERS', SlotKind.TOURNAMENT)])]);

    expect(phases[0]?.slots.map((item) => item.key)).toEqual(['MASTERS', 'US_OPEN']);
  });

  it('orders a slot\'s mappings by provider, then provider code before name pattern before calendar week', () => {
    const { phases } = orderSportLeagueStructure([phase(LeaguePhase.REGULAR, [slot('WEEK_1', SlotKind.WEEK, {
      weekNumber: 1,
      providerMappings: [
        mapping('Second', SlotProviderMatchType.PROVIDER_CODE, 'REG:1'),
        mapping('First', SlotProviderMatchType.CALENDAR_WEEK, null),
        mapping('First', SlotProviderMatchType.PROVIDER_CODE, 'REG:1'),
      ],
    })])]);

    expect(phases[0]?.slots[0]?.providerMappings.map((entry) => [entry.providerName, entry.matchType])).toEqual([
      ['First', SlotProviderMatchType.PROVIDER_CODE],
      ['First', SlotProviderMatchType.CALENDAR_WEEK],
      ['Second', SlotProviderMatchType.PROVIDER_CODE],
    ]);
  });
});

describe('orderSportLeagueStructure, ties', () => {
  it('orders one provider\'s mappings of one match type by value, and keeps two valueless ones level', () => {
    const { phases } = orderSportLeagueStructure([phase(LeaguePhase.REGULAR, [slot('WEEK_1', SlotKind.WEEK, {
      weekNumber: 1,
      providerMappings: [
        mapping('Only', SlotProviderMatchType.PROVIDER_CODE, 'REG:2'),
        mapping('Only', SlotProviderMatchType.CALENDAR_WEEK, null),
        mapping('Only', SlotProviderMatchType.PROVIDER_CODE, 'REG:1'),
        mapping('Only', SlotProviderMatchType.CALENDAR_WEEK, null),
      ],
    })])]);

    expect(phases[0]?.slots[0]?.providerMappings.map((entry) => entry.providerValue)).toEqual(['REG:1', 'REG:2', null, null]);
  });

  it('puts a dated week before an undated tournament in one phase, and orders two weeks by number before key', () => {
    const { phases } = orderSportLeagueStructure([phase(LeaguePhase.REGULAR, [
      slot('MASTERS', SlotKind.TOURNAMENT),
      slot('B_WEEK', SlotKind.WEEK, { weekNumber: 1 }),
      slot('A_WEEK', SlotKind.WEEK, { weekNumber: 2 }),
    ])]);

    expect(phases[0]?.slots.map((item) => item.key)).toEqual(['B_WEEK', 'A_WEEK', 'MASTERS']);
  });
});

describe('mapSportLeagueStructureToDto', () => {
  it('sends every field of every phase, slot and mapping as the response schema describes them', () => {
    const structure = orderSportLeagueStructure([phase(LeaguePhase.POSTSEASON, [
      slot('FINAL', SlotKind.FINAL, { name: 'NBA Finals', seriesFormat: SeriesFormat.BEST_OF, seriesGames: 7, awardsTrophy: true, providerMappings: [mapping('BALLDONTLIE', SlotProviderMatchType.PROVIDER_CODE, 'POST:5')] }),
    ])]);

    const dto = mapSportLeagueStructureToDto(structure);

    expect(SportLeagueStructureResponseSchema.parse(dto)).toEqual(dto);
    expect(dto.phases[0]?.slots[0]).toEqual(expect.objectContaining({ name: 'NBA Finals', seriesGames: 7, providerMappings: [expect.objectContaining({ providerValue: 'POST:5' })] }));
  });
});
