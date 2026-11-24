import { eventProviderNameOf, ProviderCode, providerCodeOfSourceId, ProviderHealthStatus, providerHealthOfRuns, providerSourceIdOf } from '@poolmaster/shared/domain';

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

describe('eventProviderNameOf', () => {
  it('names the league\'s sync provider for an event linked to it', () => {
    expect(eventProviderNameOf({ providerId: 'balldontlie', syncProviderId: 'balldontlie', syncProviderName: 'BALLDONTLIE' })).toBe('BALLDONTLIE');
  });

  it('names none for an admin-authored event, an event linked to another provider, or a league no provider syncs', () => {
    expect(eventProviderNameOf({ providerId: 'manual-admin', syncProviderId: 'balldontlie', syncProviderName: 'BALLDONTLIE' })).toBeNull();
    expect(eventProviderNameOf({ providerId: 'other-feed', syncProviderId: 'balldontlie', syncProviderName: 'BALLDONTLIE' })).toBeNull();
    expect(eventProviderNameOf({ providerId: 'balldontlie' })).toBeNull();
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
