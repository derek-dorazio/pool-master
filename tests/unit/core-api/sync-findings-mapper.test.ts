/** The sync finding DTO (#1999): dates as ISO strings, the changer by display name, and the actions it offers now. */
import { expect } from '@jest/globals';
import {
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
  Sport,
  type ProviderSyncFinding,
} from '@poolmaster/shared/domain';
import { ProviderSyncFindingDtoSchema, ProviderSyncFindingSlotChoiceListResponseSchema } from '@poolmaster/shared/dto';
import { toProviderSyncFindingDto, toProviderSyncFindingSlotChoiceDto } from '../../../packages/core-api/src/mappers/sync-findings.mapper';

const AT = new Date('2027-04-15T12:00:00.000Z');

function finding(overrides: Partial<ProviderSyncFinding> = {}): ProviderSyncFinding {
  return {
    id: '5f0c8a8e-5a0e-4c1e-9d43-2f6f8e3e4b10',
    kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT,
    severity: ProviderSyncFindingSeverity.WARNING,
    status: ProviderSyncFindingStatus.OPEN,
    sportLeague: { id: '7b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d32', name: 'PGA TOUR', sport: Sport.GOLF },
    sportEvent: null,
    provider: null,
    providerValue: 'golfer-9',
    providerValueName: null,
    syncKind: null,
    waiveNote: null,
    firstSeenAt: AT,
    lastSeenAt: AT,
    seenCount: 2,
    statusChangedAt: AT,
    statusChangedBy: null,
    ...overrides,
  };
}

describe('toProviderSyncFindingDto', () => {
  it('sends an OPEN finding the sync raised with its map action first, matching the published schema', () => {
    const dto = toProviderSyncFindingDto(finding());

    expect(ProviderSyncFindingDtoSchema.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({
      sportEvent: null, provider: null, statusChangedBy: null, firstSeenAt: '2027-04-15T12:00:00.000Z',
      actions: ['MAP_PARTICIPANT', 'RESOLVE', 'WAIVE'],
    });
  });

  it('sends a waived finding\'s event, Provider and note, names the admin who waived it, and offers only reopen', () => {
    const dto = toProviderSyncFindingDto(finding({
      status: ProviderSyncFindingStatus.WAIVED,
      waiveNote: 'An amateur',
      sportEvent: { id: '8c3fbd1b-8d3b-4f4b-8a76-5c9b1b6b7e43', name: 'The Masters' },
      provider: { id: '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11', name: 'BALLDONTLIE' },
      statusChangedBy: { id: '9d4fce2c-9e4c-4a5c-9b87-6dac2c7c8f54', firstName: 'Ada', lastName: 'Admin', username: 'ada', email: 'ada@example.test' },
    }));

    expect(ProviderSyncFindingDtoSchema.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({
      sportEvent: { name: 'The Masters' },
      provider: { name: 'BALLDONTLIE' },
      waiveNote: 'An amateur',
      statusChangedBy: { id: '9d4fce2c-9e4c-4a5c-9b87-6dac2c7c8f54', displayName: 'Ada Admin' },
      actions: ['REOPEN'],
    });
  });
});

describe('toProviderSyncFindingSlotChoiceDto', () => {
  it('answers a slot a tournament name can be linked to with its key, kind, week, name and a copy of its patterns', () => {
    const patterns = ['the memorial tournament'];
    const dto = toProviderSyncFindingSlotChoiceDto({ slotDefinitionId: '5b1f4c0e-3d7a-4f8e-9a52-1c3e8f2d6a10', key: 'MEMORIAL', slotKind: 'TOURNAMENT', weekNumber: null, name: 'Memorial Tournament', patterns });
    patterns.push('jack\'s invitational');

    expect(ProviderSyncFindingSlotChoiceListResponseSchema.parse({ slots: [dto] }).slots).toEqual([{
      slotDefinitionId: '5b1f4c0e-3d7a-4f8e-9a52-1c3e8f2d6a10', key: 'MEMORIAL', slotKind: 'TOURNAMENT', weekNumber: null, name: 'Memorial Tournament', patterns: ['the memorial tournament'],
    }]);
  });
});
