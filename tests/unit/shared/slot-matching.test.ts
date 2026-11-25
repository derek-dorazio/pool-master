import { matchProviderSlots, placeSlotsByName, slotDatesChange, type SyncSeasonSlot } from '@poolmaster/shared/domain';

// The one matcher of a provider's codes to Season slots (league model slice 8, #2005).

const slot = (seasonSlotId: string, providerCode: string | null, dates: Partial<Pick<SyncSeasonSlot, 'startsAt' | 'endsAt'>> = {}): SyncSeasonSlot => ({
  seasonSlotId, slotDefinitionId: `definition-${seasonSlotId}`, providerCode, linkedCode: null, coveredByTemplate: true, sportEventId: null, startsAt: dates.startsAt ?? null, endsAt: dates.endsAt ?? null,
});
const play = (code: string) => ({ code, startsAt: new Date('2027-01-10T18:00:00Z'), endsAt: new Date('2027-01-11T01:00:00Z') });

describe('matchProviderSlots', () => {
  it('matches each play to the slot whose PROVIDER_CODE value is its code, and leaves a code no slot maps unmatched', () => {
    const slots = [slot('wild-card', 'POST:1'), slot('divisional', 'POST:2'), slot('golf-name-only', null)];

    const matches = matchProviderSlots([play('POST:2'), play('POST:4'), play('POST:1')], slots);

    expect(matches.matched.map((match) => [match.slot.seasonSlotId, match.play.code])).toEqual([['divisional', 'POST:2'], ['wild-card', 'POST:1']]);
    expect(matches.unmatched.map((each) => each.code)).toEqual(['POST:4']);
  });

  it('matches nothing to a slot its provider names by no code, whatever the play\'s code', () => {
    expect(matchProviderSlots([play('40')], [slot('masters', null)])).toEqual({ matched: [], unmatched: [play('40')] });
  });
});

describe('slotDatesChange', () => {
  it('gives the play\'s first and last game starts to a slot with no dates or other dates', () => {
    const { startsAt, endsAt } = play('POST:1');
    expect(slotDatesChange(slot('a', 'POST:1'), play('POST:1'))).toEqual({ startsAt, endsAt });
    expect(slotDatesChange(slot('a', 'POST:1', { startsAt, endsAt: new Date('2027-01-12T01:00:00Z') }), play('POST:1'))).toEqual({ startsAt, endsAt });
  });

  it('changes nothing on a slot that already has the play\'s dates', () => {
    const { startsAt, endsAt } = play('POST:1');
    expect(slotDatesChange(slot('a', 'POST:1', { startsAt, endsAt }), play('POST:1'))).toBeNull();
  });
});

// Name matching for open phases (league model slice 12, #2011).

/** The name a tournament no pattern matches is reported by: its normalized form. */
const normalized = (name: string) => {
  const [placement] = placeSlotsByName([{ name, play: play('1') }], [], []);
  return placement.outcome === 'UNMATCHED' ? placement.normalizedName : null;
};

describe('tournament name normalization', () => {
  it('reads case, year and "presented by" variants of one tournament name as the same name', () => {
    const variants = [
      'the Memorial Tournament',
      'The Memorial Tournament presented by Workday',
      'THE 2027 MEMORIAL TOURNAMENT',
      '2026 the Memorial  Tournament Presented By Workday',
    ];

    expect(new Set(variants.map(normalized))).toEqual(new Set(['the memorial tournament']));
  });

  it('keeps the punctuation and numbers that are part of a name, such as U.S. Open and 3M Open', () => {
    expect(['U.S. Open', '3M Open', 'AT&T Pebble Beach Pro-Am'].map(normalized)).toEqual(['u.s. open', '3m open', 'at&t pebble beach pro-am']);
  });
});

describe('placeSlotsByName', () => {
  const tournament = (name: string, code: string) => ({ name, play: play(code) });
  const patterns = [
    { slotDefinitionId: 'masters', pattern: 'masters tournament' },
    { slotDefinitionId: 'memorial', pattern: 'the memorial tournament' },
    { slotDefinitionId: 'twin-a', pattern: 'twin championship' },
    { slotDefinitionId: 'twin-b', pattern: 'twin championship' },
  ];

  it('creates the Season slot of the one definition a tournament\'s name matches when the Season has none yet', () => {
    expect(placeSlotsByName([tournament('Masters Tournament 2027', '17')], [], patterns))
      .toEqual([{ outcome: 'CREATE', slotDefinitionId: 'masters', play: play('17'), name: 'Masters Tournament 2027' }]);
  });

  it('links the Season\'s existing unlinked slot of that definition', () => {
    const existing = { ...slot('masters-2027', null), slotDefinitionId: 'masters' };

    expect(placeSlotsByName([tournament('Masters Tournament', '17')], [existing], patterns))
      .toEqual([{ outcome: 'LINK', seasonSlotId: 'masters-2027', play: play('17'), name: 'Masters Tournament' }]);
  });

  it('places nothing for a name no pattern matches, and reports it by its normalized name', () => {
    expect(placeSlotsByName([tournament('The New Open presented by Someone', '40')], [], patterns))
      .toEqual([{ outcome: 'UNMATCHED', normalizedName: 'the new open', name: 'The New Open presented by Someone' }]);
  });

  it('places nothing for a name the patterns of two definitions match', () => {
    expect(placeSlotsByName([tournament('Twin Championship', '50')], [], patterns))
      .toEqual([{ outcome: 'AMBIGUOUS', normalizedName: 'twin championship', name: 'Twin Championship' }]);
  });

  it('places nothing for a second tournament whose name matches a slot already linked, or already placed in the same slate', () => {
    const linked = { ...slot('memorial-2027', null), slotDefinitionId: 'memorial', linkedCode: '30' };

    expect(placeSlotsByName([tournament('the Memorial Tournament', '31')], [linked], patterns).map((placement) => placement.outcome)).toEqual(['AMBIGUOUS']);
    expect(placeSlotsByName([tournament('Masters Tournament', '17'), tournament('The Masters Tournament', '18')], [], [...patterns, { slotDefinitionId: 'masters', pattern: 'the masters tournament' }])
      .map((placement) => placement.outcome)).toEqual(['CREATE', 'AMBIGUOUS']);
  });
});

describe('matchProviderSlots by a linked tournament code', () => {
  it('matches a tournament by the code its Season slot was linked to, whatever it is called now', () => {
    const linked = { ...slot('masters-2027', null), slotDefinitionId: 'masters', linkedCode: '17' };

    expect(matchProviderSlots([play('17')], [linked]).matched.map(({ slot: each }) => each.seasonSlotId)).toEqual(['masters-2027']);
  });
});
