import { ProviderCode, providerCodeOfSourceId, providerSourceIdOf } from '@poolmaster/shared/domain';

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
