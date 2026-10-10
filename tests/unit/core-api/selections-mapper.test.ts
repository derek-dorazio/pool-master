import { SelectionType } from '@poolmaster/shared/domain';
import type { ContestConfiguration } from '@poolmaster/shared/domain';
import { toSelectionContestConfigurationDto } from '../../../packages/core-api/src/mappers/selections.mapper';

// The selection room's configuration projection: which roster size a client is told, and which
// optional fields come through as absent rather than null.

function configuration(overrides: Partial<ContestConfiguration> = {}): ContestConfiguration {
  return {
    id: 'config-1',
    contestId: 'contest-1',
    selectionType: SelectionType.TIERED,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as ContestConfiguration;
}

const TIER = { tierId: 'tier-1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 2, participantIds: ['p-a'] };

describe('toSelectionContestConfigurationDto', () => {
  it('sends no configuration for a contest that has none', () => {
    expect(toSelectionContestConfigurationDto(null, [], 0)).toBeNull();
  });

  it('reports the room\'s computed roster size, and lists the tiers without their golfers', () => {
    const dto = toSelectionContestConfigurationDto(configuration({ isExclusive: true }), [TIER], 2);

    expect(dto).toMatchObject({ rosterSize: 2, isExclusive: true });
    expect(dto?.tierConfig).toEqual([{ tierId: 'tier-1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 2 }]);
  });

  it('sends no roster size for a room that cannot take picks, whatever else the configuration holds', () => {
    expect(toSelectionContestConfigurationDto(configuration({ rounds: 3 }), [], 0)?.rosterSize).toBeUndefined();
  });

  it('sends absent fields as undefined, an unset exclusivity as false, and no tier list for a tierless room', () => {
    const dto = toSelectionContestConfigurationDto(configuration(), [], 0);

    expect(dto).toEqual({
      isExclusive: false,
      rounds: undefined,
      rosterSize: undefined,
      timePerPickSeconds: undefined,
      picksPerPeriod: undefined,
      roundValues: undefined,
      startRound: undefined,
      tierConfig: undefined,
    });
  });
});
