import { matchProviderSlots, playsOutsideSeason, slotDatesChange, SlotWindowStatus, type SyncSeasonSlot } from '@poolmaster/shared/domain';

// The one matcher of a provider's codes and dates to Season slots (league model slices 8 and 13, #2005, #2012).

const slot = (seasonSlotId: string, providerCode: string | null, dates: Partial<Pick<SyncSeasonSlot, 'startsAt' | 'endsAt' | 'window'>> = {}): SyncSeasonSlot => ({
  seasonSlotId, providerCode, coveredByTemplate: true, sportEventId: null, startsAt: dates.startsAt ?? null, endsAt: dates.endsAt ?? null, window: dates.window ?? null,
});
const windowed = (seasonSlotId: string, from: string, to: string, status: SlotWindowStatus = SlotWindowStatus.CONFIRMED) =>
  slot(seasonSlotId, null, { window: { startsAt: new Date(from), endsAt: new Date(to), status } });
const game = (kickoff: string) => ({ code: null, startsAt: new Date(kickoff), endsAt: new Date(kickoff) });
const play = (code: string) => ({ code, startsAt: new Date('2027-01-10T18:00:00Z'), endsAt: new Date('2027-01-11T01:00:00Z') });

describe('matchProviderSlots', () => {
  it('matches each play to the slot whose PROVIDER_CODE value is its code, and leaves a code no slot maps unmatched', () => {
    const slots = [slot('wild-card', 'POST:1'), slot('divisional', 'POST:2'), slot('golf-name-only', null)];

    const matches = matchProviderSlots([play('POST:2'), play('POST:4'), play('POST:1')], slots);

    expect(matches.matched.map((match) => [match.slot.seasonSlotId, match.play.code])).toEqual([['divisional', 'POST:2'], ['wild-card', 'POST:1']]);
    expect(matches.unmatched.map((each) => each.code)).toEqual(['POST:4']);
  });

  it('matches nothing to a slot its provider names by no code, whatever the play\'s code', () => {
    expect(matchProviderSlots([play('40')], [slot('masters', null)])).toEqual({ matched: [], unmatched: [play('40')], unplaced: [] });
  });

  it('places a game with no code in the slot whose window holds its kickoff, from inclusive and to exclusive, and its window\'s games as one play from the first to the last', () => {
    const slots = [
      windowed('quarterfinal', '2026-12-30T10:00:00Z', '2027-01-02T12:00:00Z'),
      windowed('semifinal', '2027-01-14T10:00:00Z', '2027-01-16T12:00:00Z', SlotWindowStatus.TENTATIVE),
      slot('coded', 'POST:1'),
    ];

    const matches = matchProviderSlots([
      game('2027-01-01T21:00:00Z'),
      game('2026-12-30T10:00:00Z'),
      game('2027-01-14T23:00:00Z'),
      game('2027-01-02T12:00:00Z'),
      game('2026-12-27T20:00:00Z'),
    ], slots);

    expect(matches.matched.map(({ slot: placed, play: placedPlay }) => [placed.seasonSlotId, placedPlay.startsAt.toISOString(), placedPlay.endsAt.toISOString()])).toEqual([
      ['quarterfinal', '2026-12-30T10:00:00.000Z', '2027-01-01T21:00:00.000Z'],
      ['semifinal', '2027-01-14T23:00:00.000Z', '2027-01-14T23:00:00.000Z'],
    ]);
    expect(matches.unplaced.map((each) => each.startsAt.toISOString())).toEqual(['2027-01-02T12:00:00.000Z', '2026-12-27T20:00:00.000Z']);
    expect(matches.unmatched).toEqual([]);
  });

  it('places no game with no code when no slot has a window', () => {
    expect(matchProviderSlots([game('2027-01-01T21:00:00Z')], [slot('coded', 'POST:1')])).toEqual({ matched: [], unmatched: [], unplaced: [game('2027-01-01T21:00:00Z')] });
  });
});

describe('playsOutsideSeason', () => {
  const season = { startsAt: new Date('2026-12-01T05:00:00Z'), endsAt: new Date('2027-02-01T05:00:00Z') };

  it('keeps the plays that start before the Season or end after it, and drops those inside it, its edges included', () => {
    const before = { code: 'A', startsAt: new Date('2026-11-30T20:00:00Z'), endsAt: new Date('2026-12-02T00:00:00Z') };
    const after = { code: 'B', startsAt: new Date('2027-01-31T20:00:00Z'), endsAt: new Date('2027-02-02T00:00:00Z') };
    const edges = { code: 'C', startsAt: season.startsAt, endsAt: season.endsAt };

    expect(playsOutsideSeason([before, edges, after], season)).toEqual([before, after]);
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
