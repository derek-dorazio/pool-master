import { ProviderSeasonType, providerSlotCode, slotPlaysOf } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/provider-slot-codes';

// The adapter's one reduction of a game to the code the vendor names its place by (#2005).

describe('providerSlotCode', () => {
  it('names a game by its season type and the vendor\'s own week or round', () => {
    expect(providerSlotCode(ProviderSeasonType.REGULAR_SEASON, 5)).toBe('REG:5');
    expect(providerSlotCode(ProviderSeasonType.POSTSEASON, 0)).toBe('POST:0');
  });
});

describe('slotPlaysOf', () => {
  it('gives each code once, with its games\' earliest and latest start, the earliest code first', () => {
    const at = (iso: string) => Date.parse(iso);
    expect(slotPlaysOf([
      { code: 'POST:2', start: at('2027-01-17T21:00:00Z') },
      { code: 'POST:1', start: at('2027-01-11T01:00:00Z') },
      { code: 'POST:1', start: at('2027-01-10T18:00:00Z') },
      { code: 'POST:2', start: at('2027-01-16T21:00:00Z') },
    ])).toEqual([
      { code: 'POST:1', startsAt: new Date('2027-01-10T18:00:00Z'), endsAt: new Date('2027-01-11T01:00:00Z') },
      { code: 'POST:2', startsAt: new Date('2027-01-16T21:00:00Z'), endsAt: new Date('2027-01-17T21:00:00Z') },
    ]);
  });

  it('gives no play for no games', () => {
    expect(slotPlaysOf([])).toEqual([]);
  });
});
