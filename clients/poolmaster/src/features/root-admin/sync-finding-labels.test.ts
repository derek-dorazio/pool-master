import { describe, expect, it } from 'vitest';
import type { ProviderSyncFindingDto } from '@/lib/api';
import { syncFindingSubject, syncFindingTitle } from './sync-finding-labels';

// What a sync finding is about and its dialog's title (#1999, #2011), from the finding's own fields.

function finding(overrides: Partial<ProviderSyncFindingDto> = {}): ProviderSyncFindingDto {
  return {
    id: 'finding-1', kind: 'SLOT_NAME_UNMATCHED', severity: 'INFO', status: 'OPEN',
    sportLeague: { id: 'pga', name: 'PGA TOUR', sport: 'GOLF' }, sportEvent: null, provider: { id: 'provider-1', name: 'BALLDONTLIE' },
    providerValue: 'the new open', providerValueName: 'The 2027 New Open', waiveNote: null,
    firstSeenAt: '2026-11-20T12:00:00.000Z', lastSeenAt: '2026-11-23T12:00:00.000Z', seenCount: 1,
    statusChangedAt: '2026-11-20T12:00:00.000Z', statusChangedBy: null, actions: ['LINK_SLOT', 'RESOLVE', 'WAIVE'],
    ...overrides,
  };
}

describe('syncFindingSubject', () => {
  it('names the feed\'s value with the feed\'s name for it, the value alone when it sent no name', () => {
    expect(syncFindingSubject(finding())).toBe('The 2027 New Open (the new open)');
    expect(syncFindingSubject(finding({ providerValueName: null }))).toBe('the new open');
  });

  it('falls back to the event, then the Provider, then nothing', () => {
    const noValue = { providerValue: null, providerValueName: null };
    expect(syncFindingSubject(finding({ ...noValue, sportEvent: { id: 'event-1', name: 'Masters Tournament' } }))).toBe('Masters Tournament');
    expect(syncFindingSubject(finding(noValue))).toBe('BALLDONTLIE');
    expect(syncFindingSubject(finding({ ...noValue, provider: null }))).toBeNull();
  });
});

describe('syncFindingTitle', () => {
  it('reads the kind\'s words, then what it is about, or the kind alone when it is about nothing', () => {
    expect(syncFindingTitle(finding())).toBe('Tournament name not matched to a slot · The 2027 New Open (the new open)');
    expect(syncFindingTitle(finding({ kind: 'SEASON_MISSING', providerValue: null, providerValueName: null, provider: null }))).toBe('No Season to sync');
  });
});
