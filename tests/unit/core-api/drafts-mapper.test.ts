import { SelectionType } from '@poolmaster/shared/domain';
import type { ContestConfiguration } from '@poolmaster/shared/domain';
import { toDraftContestConfigurationDto } from '../../../packages/core-api/src/mappers/drafts.mapper';

// The draft room's configuration projection: which roster size a client is told, and which
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

describe('toDraftContestConfigurationDto', () => {
  it('sends no configuration for a contest that has none', () => {
    expect(toDraftContestConfigurationDto(null, [], 0)).toBeNull();
  });

  it('reports the room\'s computed roster size over the stored one, and lists the tiers without their golfers', () => {
    const dto = toDraftContestConfigurationDto(configuration({ rosterSize: 12, isExclusive: true }), [TIER], 2);

    expect(dto).toMatchObject({ rosterSize: 2, isExclusive: true });
    expect(dto?.tierConfig).toEqual([{ tierId: 'tier-1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 2 }]);
  });

  it('falls back to the stored roster size, then pick count, then rounds when the room computed none', () => {
    expect(toDraftContestConfigurationDto(configuration({ rosterSize: 4 }), [], 0)?.rosterSize).toBe(4);
    expect(toDraftContestConfigurationDto(configuration({ pickCount: 5 }), [], 0)?.rosterSize).toBe(5);
    expect(toDraftContestConfigurationDto(configuration({ rounds: 3 }), [], 0)?.rosterSize).toBe(3);
  });

  it('sends absent fields as undefined, an unset exclusivity as false, and no tier list for a tierless room', () => {
    const dto = toDraftContestConfigurationDto(configuration(), [], 0);

    expect(dto).toEqual({
      isExclusive: false,
      rounds: undefined,
      pickCount: undefined,
      rosterSize: undefined,
      budget: undefined,
      timePerPickSeconds: undefined,
      picksPerPeriod: undefined,
      roundValues: undefined,
      startRound: undefined,
      tierConfig: undefined,
    });
  });
});
