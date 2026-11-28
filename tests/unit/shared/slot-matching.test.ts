import { matchProviderSlots, placeSlotsByName, playsOutsideSeason, slotDatesChange, SlotWindowStatus, type SyncSeasonSlot } from '@poolmaster/shared/domain';

// The one matcher of a provider's codes and dates to Season slots (league model slices 8 and 13, #2005, #2012).

const slot = (seasonSlotId: string, providerCode: string | null, dates: Partial<Pick<SyncSeasonSlot, 'startsAt' | 'endsAt' | 'window'>> = {}): SyncSeasonSlot => ({
  seasonSlotId, slotDefinitionId: `definition-${seasonSlotId}`, key: seasonSlotId, providerCode, linkedCode: null, coveredByTemplate: true, placedByWindow: dates.window !== undefined && dates.window !== null, sportEventId: null, seasonCompetitionId: 'competition', competitionName: null, restOfPhase: false, startsAt: dates.startsAt ?? null, endsAt: dates.endsAt ?? null, window: dates.window ?? null, conferenceTeams: null,
});
const windowed = (seasonSlotId: string, from: string, to: string, status: SlotWindowStatus = SlotWindowStatus.CONFIRMED) =>
  slot(seasonSlotId, null, { window: { startsAt: new Date(from), endsAt: new Date(to), status } });
const game = (kickoff: string, teams: readonly string[] = ['seed-1', 'seed-2']) => ({ code: null, startsAt: new Date(kickoff), endsAt: new Date(kickoff), teams });
const SEEDS = new Set(['seed-1', 'seed-2', 'seed-3', 'seed-4']);
const seeded = () => SEEDS;
/** A REST_OF_PHASE slot: its window is its phase's span, and it takes the games no other slot places. */
const restOf = (seasonSlotId: string, from: string, to: string) => ({ ...windowed(seasonSlotId, from, to, SlotWindowStatus.TENTATIVE), restOfPhase: true });
const play = (code: string) => ({ code, startsAt: new Date('2027-01-10T18:00:00Z'), endsAt: new Date('2027-01-11T01:00:00Z') });

describe('matchProviderSlots', () => {
  it('matches each play to the slot whose PROVIDER_CODE value is its code, and leaves a code no slot maps unmatched', () => {
    const slots = [slot('wild-card', 'POST:1'), slot('divisional', 'POST:2'), slot('golf-name-only', null)];

    const matches = matchProviderSlots([play('POST:2'), play('POST:4'), play('POST:1')], slots);

    expect(matches.matched.map((match) => [match.slot.seasonSlotId, match.play.code, match.fromGames])).toEqual([['divisional', 'POST:2', true], ['wild-card', 'POST:1', true]]);
    expect(matches.unmatched.map((each) => each.code)).toEqual(['POST:4']);
  });

  it('matches nothing to a slot its provider names by no code, whatever the play\'s code', () => {
    expect(matchProviderSlots([play('40')], [slot('masters', null)])).toEqual({ matched: [], unmatched: [play('40')], unplaced: [] });
  });

  it('places a game with no code in the slot whose window holds its kickoff, from inclusive and to exclusive, and its window\'s games between seeds as one play from the first to the last', () => {
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
    ], slots, seeded);

    expect(matches.matched.map(({ slot: placed, play: placedPlay, fromGames }) => [placed.seasonSlotId, placedPlay.startsAt.toISOString(), placedPlay.endsAt.toISOString(), fromGames])).toEqual([
      ['quarterfinal', '2026-12-30T10:00:00.000Z', '2027-01-01T21:00:00.000Z', true],
      ['semifinal', '2027-01-14T23:00:00.000Z', '2027-01-14T23:00:00.000Z', true],
    ]);
    expect(matches.unplaced.map((each) => each.startsAt.toISOString())).toEqual(['2027-01-02T12:00:00.000Z', '2026-12-27T20:00:00.000Z']);
    expect(matches.unmatched).toEqual([]);
  });

  it('takes a window\'s dates only from games between two seeds: a bowl of unseeded schools, or of one seed, places the event on the slot with the window as its play', () => {
    const firstRound = windowed('first-round', '2026-12-18T10:00:00Z', '2026-12-20T10:00:00Z', SlotWindowStatus.TENTATIVE);
    const bowls = [game('2026-12-19T17:00:00Z', ['other-1', 'other-2']), game('2026-12-19T21:00:00Z', ['seed-1', 'other-3'])];

    expect(matchProviderSlots(bowls, [firstRound], seeded).matched).toEqual([
      { slot: firstRound, play: { code: null, startsAt: new Date('2026-12-18T10:00:00Z'), endsAt: new Date('2026-12-20T10:00:00Z') }, fromGames: false, games: [] },
    ]);
    // Before the seeds are placed no game is the event's own.
    expect(matchProviderSlots([game('2026-12-19T17:00:00Z')], [firstRound]).matched.map(({ fromGames }) => fromGames)).toEqual([false]);
    // A game between two seeds in the same window is.
    const placed = matchProviderSlots([...bowls, game('2026-12-19T20:00:00Z', ['seed-3', 'seed-4'])], [firstRound], seeded).matched;
    expect(placed.map(({ play: placed, fromGames }) => [placed.startsAt.toISOString(), placed.endsAt.toISOString(), fromGames]))
      .toEqual([['2026-12-19T20:00:00.000Z', '2026-12-19T20:00:00.000Z', true]]);
  });

  it('places no game with no code when no slot has a window', () => {
    expect(matchProviderSlots([game('2027-01-01T21:00:00Z')], [slot('coded', 'POST:1')])).toEqual({ matched: [], unmatched: [], unplaced: [game('2027-01-01T21:00:00Z')] });
  });
});

describe('matchProviderSlots rest of phase (#2154)', () => {
  const quarterfinal = windowed('quarterfinal', '2026-12-30T10:00:00Z', '2027-01-02T12:00:00Z');
  const bowls = restOf('bowls', '2026-12-13T10:00:00Z', '2027-01-26T12:00:00Z');
  const byKickoff = (games: readonly { startsAt: Date }[]) => games.map((each) => each.startsAt.toISOString());

  it('puts a postseason game no other slot places in the rest-of-phase slot, whoever plays it, and a quarterfinal between seeds in the quarterfinal, never in the bowls', () => {
    const cfpQuarterfinal = game('2026-12-31T21:00:00Z', ['seed-1', 'seed-4']);
    const bowlInTheQuarterfinalWindow = game('2026-12-31T17:00:00Z', ['other-1', 'other-2']);
    const earlyBowl = game('2026-12-19T17:00:00Z', ['other-3', 'other-4']);

    const matches = matchProviderSlots([cfpQuarterfinal, bowlInTheQuarterfinalWindow, earlyBowl], [bowls, quarterfinal], seeded);

    const gamesOf = new Map(matches.matched.map(({ slot: each, games }) => [each.seasonSlotId, byKickoff(games)]));
    expect(gamesOf.get('quarterfinal')).toEqual(['2026-12-31T21:00:00.000Z']);
    expect(gamesOf.get('bowls')).toEqual(['2026-12-31T17:00:00.000Z', '2026-12-19T17:00:00.000Z']);
    expect(matches.unplaced).toEqual([]);
  });

  it('dates the rest-of-phase slot by its own games, from the first to the last', () => {
    const matches = matchProviderSlots([game('2026-12-31T17:00:00Z', ['a', 'b']), game('2026-12-19T17:00:00Z', ['c', 'd'])], [bowls], seeded);

    expect(matches.matched.map(({ slot: each, play: span, fromGames }) => [each.seasonSlotId, span.startsAt.toISOString(), span.endsAt.toISOString(), fromGames]))
      .toEqual([['bowls', '2026-12-19T17:00:00.000Z', '2026-12-31T17:00:00.000Z', true]]);
  });

  it('gives a quarterfinal played before the seeds are placed to the bowls, and to the quarterfinal once both teams are on its field', () => {
    const cfpQuarterfinal = game('2026-12-31T21:00:00Z', ['seed-1', 'seed-4']);

    const before = matchProviderSlots([cfpQuarterfinal], [bowls, quarterfinal]);
    const after = matchProviderSlots([cfpQuarterfinal], [bowls, quarterfinal], seeded);

    expect(before.matched.map(({ slot: each, games }) => [each.seasonSlotId, games.length])).toEqual([['bowls', 1], ['quarterfinal', 0]]);
    expect(after.matched.map(({ slot: each, games }) => [each.seasonSlotId, games.length])).toEqual([['quarterfinal', 1]]);
  });

  it('takes every game in a title weekend\'s window with no field to place, and leaves a game outside every window unplaced', () => {
    const titleGames = restOf('conference-championships', '2026-12-04T10:00:00Z', '2026-12-06T12:00:00Z');
    const secGame = game('2026-12-05T21:00:00Z', ['georgia', 'alabama']);
    const regularSeasonGame = game('2026-11-28T17:00:00Z', ['ohio-state', 'michigan']);

    const matches = matchProviderSlots([secGame, regularSeasonGame], [titleGames, bowls]);

    expect(matches.matched.map(({ slot: each, games }) => [each.seasonSlotId, byKickoff(games)])).toEqual([['conference-championships', ['2026-12-05T21:00:00.000Z']]]);
    expect(matches.unplaced).toEqual([regularSeasonGame]);
  });

  it('reads each slot\'s own field: a game between one slot\'s seeds is not another slot\'s', () => {
    const semifinal = windowed('semifinal', '2027-01-14T10:00:00Z', '2027-01-16T12:00:00Z');
    const fields = new Map([['quarterfinal', new Set(['seed-1', 'seed-2'])]]);

    const matches = matchProviderSlots([game('2027-01-15T00:00:00Z', ['seed-1', 'seed-2'])], [semifinal, quarterfinal, bowls], (each) => fields.get(each.seasonSlotId) ?? new Set());

    expect(matches.matched.map(({ slot: each, games }) => [each.seasonSlotId, games.length])).toEqual([['bowls', 1], ['semifinal', 0]]);
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
      .toEqual([{ outcome: 'CREATE', slotDefinitionId: 'masters', play: play('17'), name: 'Masters Tournament 2027', normalizedName: 'masters tournament' }]);
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

describe('matchProviderSlots in a conference\'s competition (#2052)', () => {
  const window = ['2027-03-10T10:00:00Z', '2027-03-16T12:00:00Z'] as const;
  const inConference = (seasonSlotId: string, teams: readonly string[]) => ({ ...restOf(seasonSlotId, ...window), conferenceTeams: new Set(teams) });
  const acc = inConference('acc-tournament', ['duke', 'unc', 'virginia']);
  const sec = inConference('sec-tournament', ['auburn', 'florida']);

  it('places a game only in the tournament of the conference both its teams hold, and leaves a game between two conferences unplaced', () => {
    const accGame = game('2027-03-12T23:00:00Z', ['duke', 'unc']);
    const secGame = game('2027-03-13T01:00:00Z', ['auburn', 'florida']);
    const crossConference = game('2027-03-13T17:00:00Z', ['duke', 'florida']);

    const matches = matchProviderSlots([accGame, secGame, crossConference], [acc, sec]);

    expect(matches.matched.map(({ slot: each, games }) => [each.seasonSlotId, games.length])).toEqual([['acc-tournament', 1], ['sec-tournament', 1]]);
    expect(matches.unplaced).toEqual([crossConference]);
  });

  it('leaves a game whose teams the feed does not name out of a conference\'s competition', () => {
    const unnamed = { code: null, startsAt: new Date('2027-03-12T23:00:00Z'), endsAt: new Date('2027-03-12T23:00:00Z') };

    expect(matchProviderSlots([unnamed], [acc]).unplaced).toEqual([unnamed]);
  });

  it('refuses a coded game with another conference\'s team, and takes a coded play that names no teams on its code', () => {
    const accFinal = { ...slot('acc-final', 'CONF:ACC'), conferenceTeams: new Set(['duke', 'unc']) };
    const visitor = { ...play('CONF:ACC'), teams: ['duke', 'auburn'] };

    expect(matchProviderSlots([visitor], [accFinal]).unplaced).toEqual([visitor]);
    expect(matchProviderSlots([play('CONF:ACC')], [accFinal]).matched.map(({ slot: each }) => each.seasonSlotId)).toEqual(['acc-final']);
  });

  it('places any game in a competition that names no conference, as before', () => {
    const titleGames = restOf('conference-championships', ...window);

    expect(matchProviderSlots([game('2027-03-12T23:00:00Z', ['duke', 'auburn'])], [titleGames]).matched).toHaveLength(1);
  });
});
