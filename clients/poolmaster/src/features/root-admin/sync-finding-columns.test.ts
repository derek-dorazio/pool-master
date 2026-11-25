import { describe, expect, it } from 'vitest';
import type { ProviderSyncFindingDto } from '@/lib/api';
import { syncFindingColumns, syncFindingLeagueOptions } from './sync-finding-columns';

// The Findings grid's columns (#1999): what each reads from a finding, and the league filter's options.

function finding(overrides: Partial<ProviderSyncFindingDto> = {}): ProviderSyncFindingDto {
  return {
    id: 'finding-1', kind: 'SEASON_MISSING', severity: 'ERROR', status: 'OPEN',
    sportLeague: { id: 'nfl', name: 'NFL', sport: 'FOOTBALL' }, sportEvent: null, provider: { id: 'provider-1', name: 'BALLDONTLIE' },
    providerValue: null, providerValueName: null, waiveNote: null,
    firstSeenAt: '2026-11-20T12:00:00.000Z', lastSeenAt: '2026-11-23T12:00:00.000Z', seenCount: 1,
    statusChangedAt: '2026-11-20T12:00:00.000Z', statusChangedBy: null, actions: ['RESOLVE', 'WAIVE'],
    ...overrides,
  };
}

/** A column's value for one finding, as the grid reads it. */
function valueOf(id: string, row: ProviderSyncFindingDto): unknown {
  const column = syncFindingColumns([]).find((each) => each.id === id);
  if (column === undefined || !('accessorFn' in column)) throw new Error(`No accessor column ${id}`);
  return column.accessorFn(row, 0);
}

describe('syncFindingColumns', () => {
  it('reads the Provider\'s name, or nothing for a finding about no Provider', () => {
    expect(valueOf('provider', finding())).toBe('BALLDONTLIE');
    expect(valueOf('provider', finding({ provider: null }))).toBeNull();
  });

  it('reads what the finding is about, and keys the league column by the league\'s id', () => {
    expect(valueOf('subject', finding())).toBe('BALLDONTLIE');
    expect(valueOf('sportLeague', finding())).toBe('nfl');
  });
});

describe('syncFindingLeagueOptions', () => {
  it('offers each league the findings name once, by name, keeping two leagues of one name apart by id', () => {
    const findings = [
      finding(),
      finding({ id: 'finding-2', sportLeague: { id: 'pga', name: 'PGA TOUR', sport: 'GOLF' } }),
      finding({ id: 'finding-3', sportLeague: { id: 'nfl-2', name: 'NFL', sport: 'FOOTBALL' } }),
      finding({ id: 'finding-4' }),
    ];

    expect(syncFindingLeagueOptions(findings)).toEqual([
      { value: 'nfl', label: 'NFL' },
      { value: 'nfl-2', label: 'NFL' },
      { value: 'pga', label: 'PGA TOUR' },
    ]);
  });
});
