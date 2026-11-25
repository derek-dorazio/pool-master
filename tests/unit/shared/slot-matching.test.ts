import { matchProviderSlots, slotDatesChange, type SyncSeasonSlot } from '@poolmaster/shared/domain';

// The one matcher of a provider's codes to Season slots (league model slice 8, #2005).

const slot = (seasonSlotId: string, providerCode: string | null, dates: Partial<Pick<SyncSeasonSlot, 'startsAt' | 'endsAt'>> = {}): SyncSeasonSlot => ({
  seasonSlotId, providerCode, coveredByTemplate: true, sportEventId: null, startsAt: dates.startsAt ?? null, endsAt: dates.endsAt ?? null,
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
