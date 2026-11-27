import { eventFeedRef, eventProviderNameOf, eventSyncKindsOf, SportEventStatus, isProviderSyncedEvent, ProviderCode, providerCodeOfSourceId, ProviderHealthStatus, providerHealthOfRuns, providerSourceIdOf } from '@poolmaster/shared/domain';

// The providerId a Provider row's events carry, and back: a scheduled sync of synced leagues asks
// only providers with a row, so a feed with none (the QA mock) syncs no league.

describe('provider source ids', () => {
  it('reads every Provider code back from the source id its events carry', () => {
    for (const code of Object.values(ProviderCode)) {
      expect(providerCodeOfSourceId(providerSourceIdOf(code))).toBe(code);
    }
  });

  it('gives BALLDONTLIE\'s events the adapter id balldontlie', () => {
    expect(providerSourceIdOf(ProviderCode.BALLDONTLIE)).toBe('balldontlie');
  });

  it('names no Provider code for a source id no Provider row has, such as the mock feed\'s', () => {
    expect(providerCodeOfSourceId('mock-contest-feed')).toBeUndefined();
    expect(providerCodeOfSourceId('')).toBeUndefined();
  });
});

describe('an event\'s id at its league\'s sync provider (#2004)', () => {
  const balldontlie = { providerCode: ProviderCode.BALLDONTLIE, providerName: 'BALLDONTLIE', externalId: '1133' };

  it('reads the id the league\'s sync provider gave the event, with that provider\'s adapter id and name', () => {
    const event = { providerMappings: [balldontlie], syncProviderId: 'balldontlie' };

    expect(eventFeedRef(event)).toEqual({ providerId: 'balldontlie', externalId: '1133' });
    expect(isProviderSyncedEvent(event)).toBe(true);
    expect(eventProviderNameOf(event)).toBe('BALLDONTLIE');
  });

  it('reads none for a test event, which no provider has an id for', () => {
    const event = { providerMappings: [], syncProviderId: 'balldontlie' };

    expect(eventFeedRef(event)).toBeUndefined();
    expect(isProviderSyncedEvent(event)).toBe(false);
    expect(eventProviderNameOf(event)).toBeNull();
  });

  it('reads none for an event of a league no provider syncs, even one a provider once gave an id', () => {
    const event = { providerMappings: [balldontlie] };

    expect(eventFeedRef(event)).toBeUndefined();
    expect(isProviderSyncedEvent(event)).toBe(false);
    expect(eventProviderNameOf(event)).toBeNull();
  });

  it('reads none when the league\'s sync provider is another than the one with an id for the event', () => {
    const event = { providerMappings: [balldontlie], syncProviderId: 'other-feed' };

    expect(eventFeedRef(event)).toBeUndefined();
    expect(eventProviderNameOf(event)).toBeNull();
  });
});

describe('the sync kinds a root admin can run on an event now (#2234)', () => {
  const linked = { providerMappings: [{ providerCode: ProviderCode.BALLDONTLIE, providerName: 'BALLDONTLIE', externalId: '1133' }], syncProviderId: 'balldontlie' };

  it.each([
    [SportEventStatus.DRAFT, []],
    [SportEventStatus.SCHEDULED, ['FIELD']],
    [SportEventStatus.IN_PROGRESS, ['FIELD', 'SCORES']],
    [SportEventStatus.COMPLETED, ['FIELD']],
    [SportEventStatus.POSTPONED, []],
    [SportEventStatus.CANCELLED, []],
  ])('a linked %s event runs %j: its field while there is one to load, its scores only while in play', (status, kinds) => {
    expect(eventSyncKindsOf({ ...linked, status })).toEqual(kinds);
  });

  it('a test event, which no provider has an id for, runs no sync kind even in play', () => {
    expect(eventSyncKindsOf({ providerMappings: [], syncProviderId: 'balldontlie', status: SportEventStatus.IN_PROGRESS })).toEqual([]);
  });
});

describe('providerHealthOfRuns', () => {
  it('is unknown with no runs counted, or none finished', () => {
    expect(providerHealthOfRuns(undefined)).toEqual({ status: null, errorRate: null });
    expect(providerHealthOfRuns({ finished: 0, failed: 0 })).toEqual({ status: null, errorRate: null });
  });

  it('is HEALTHY when none failed, DEGRADED when some did, and DOWN when all did, with the failed share as the error rate', () => {
    expect(providerHealthOfRuns({ finished: 5, failed: 0 })).toEqual({ status: ProviderHealthStatus.HEALTHY, errorRate: 0 });
    expect(providerHealthOfRuns({ finished: 4, failed: 1 })).toEqual({ status: ProviderHealthStatus.DEGRADED, errorRate: 0.25 });
    expect(providerHealthOfRuns({ finished: 3, failed: 3 })).toEqual({ status: ProviderHealthStatus.DOWN, errorRate: 1 });
  });
});
