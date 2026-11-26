import { bracketInput, editInput, homeAwayOf, withHomeAway, type HomeAwayBracketInput } from '../../support/match-sides';
import { testDomainEvents } from '../../support/domain-events';
import { expect, jest } from '@jest/globals';
import type { ContestRepository } from '@poolmaster/shared/db';
import { HomeAway, isAtPlace, MatchSide, MatchStatus, SlotKind, SlotPairing, Sport, SportEventStatus, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import {
  findBracketProblems,
  SportEventBracketService,
  type BracketMatchInput,
} from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { expectDefined } from '../../support/expect-defined';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { slotTiebreakersRefreshJob } from '../../support/slot-tiebreaker-jobs';
import { RecordingDomainEvents } from '../../support/recording-domain-events';

// A bracket's rules against an in-memory store: what loading refuses, what a match edit may
// change before and after release, what release still needs, and the First Four's play-in places.
// The Prisma adapter and the database checks are covered in sport-event-matches.integration.

const NOW = new Date('2027-03-01T12:00:00.000Z');
const TEAMS = ['Duke', 'Vermont', 'Houston', 'Texas'] as const;

function setup({ sport = Sport.BASKETBALL, status = SportEventStatus.DRAFT, picks = NO_PICKS_ON_EVENT, pairing = SlotPairing.FIXED }: {
  sport?: Sport;
  status?: SportEventStatus;
  picks?: typeof NO_PICKS_ON_EVENT;
  /** How the event's slots pair winners into the next round: RESEEDED places them by seed (#2006). */
  pairing?: SlotPairing;
} = {}) {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(sport);
  const sportLeague = store.addSportLeague(sportRow.id, 'NCAA Men\'s Basketball');
  const event = store.addEvent({ sportLeagueId: sportLeague.id, sport, status, rounds: 2 });
  // The semifinals and the final, each round in a slot of its own (#2006).
  const [semifinal, final] = store.addRoundSlots(event.id, [{ slotKind: SlotKind.SEMIFINAL, pairing }, { slotKind: SlotKind.FINAL, pairing }]);
  void store.addRounds(event.id, [
    { roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-03-20T16:00:00.000Z') },
  ], (roundNumber) => expectDefined(roundNumber === 1 ? semifinal : final, `round ${String(roundNumber)}'s slot`));
  const [duke, vermont, houston, texas] = TEAMS.map((name, index) => {
    const team = store.addParticipant(sportRow.id, name, { participantType: 'TEAM' });
    return store.addToField(event.id, team.id, { seedNumber: index + 1 });
  });
  let sequence = 0;
  const reminderRechecks = jest.fn<ContestRepository['recheckReminders']>().mockResolvedValue(undefined);
  const domainEvents = new RecordingDomainEvents();
  const service = new SportEventBracketService({
    sportEvents: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    matches: store.matchRepo(),
    tiers: store.tierRepo(),
    valuations: store.valuationRepo(),
    contests: { recheckReminders: reminderRechecks },
    ...picks,
    domainEvents,
    now: () => NOW,
    newId: () => {
      sequence += 1;
      return `match-${sequence}`;
    },
  });
  return { store, service, event, sportRow, sportLeague, duke, vermont, houston, texas, reminderRechecks, domainEvents };
}

/** A bracket written home and away, on its sides as the service takes it: away on side 1, home on side 2. */
function onSides(matches: readonly HomeAwayBracketInput[]): BracketMatchInput[] {
  return matches.map(bracketInput);
}

/** Two semifinals feeding a final: the smallest whole bracket. */
function fourTeamBracket(ids: { duke: string; vermont: string; houston: string; texas: string }): HomeAwayBracketInput[] {
  return [
    ({ matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: ids.duke, awaySportEventParticipantId: ids.vermont, isNeutralSite: true, scheduledDate: null, advancesTo: { roundNumber: 2, matchNumber: 1, side: MatchSide.HOME } }),
    ({ matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: ids.houston, awaySportEventParticipantId: ids.texas, isNeutralSite: true, scheduledDate: null, advancesTo: { roundNumber: 2, matchNumber: 1, side: MatchSide.AWAY } }),
    // Each round numbers its matches from 1 (#2161): the final is round 2's match 1.
    ({ matchNumber: 1, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null }),
  ];
}

/** The picks side for an event whose named games have picks (#720). */
function picksOn(...pickedMatchIds: string[]): typeof NO_PICKS_ON_EVENT {
  return { predictions: { hasAnyOnMatch: async (sportEventRoundMatchId) => pickedMatchIds.includes(sportEventRoundMatchId) } };
}

function bracketOf(context: ReturnType<typeof setup>): HomeAwayBracketInput[] {
  return fourTeamBracket({ duke: context.duke.id, vermont: context.vermont.id, houston: context.houston.id, texas: context.texas.id });
}

describe('SportEventBracketService.loadBracket', () => {
  it('stores every match with the next match and side its winner moves on to', async () => {
    const context = setup();

    const matches = await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));

    expect(matches.map((match) => [match.matchNumber, match.roundNumber, match.advancesToMatchId, homeAwayOf(match).advancesToSide])).toEqual([
      [1, 1, 'match-3', MatchSide.HOME],
      [2, 1, 'match-3', MatchSide.AWAY],
      [1, 2, null, null],
    ]);
    expect(matches.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('loads a bracket played in one slot with no FINAL kind (a tennis Slam), its final where its links end, and refuses one whose links end twice', async () => {
    const context = setup();
    // Both rounds in the event's one TOURNAMENT slot, as a Slam's seven are.
    const [slam] = context.store.addRoundSlots(context.event.id, [{ slotKind: SlotKind.TOURNAMENT }]);
    for (const round of context.store.roundRows) round.slot = { ...round.slot, seasonSlotId: expectDefined(slam, 'the Slam slot'), slotKind: SlotKind.TOURNAMENT };

    await expect(context.service.loadBracket(context.event.id, onSides(bracketOf(context)))).resolves.toHaveLength(3);
    const twoEnds = bracketOf(context).map((match) => (match.matchNumber === 2 ? { ...match, advancesTo: null } : match));
    await expect(context.service.loadBracket(context.event.id, onSides(twoEnds))).rejects.toMatchObject({ statusCode: 422 });
  });

  it('replaces the bracket already loaded rather than adding to it', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));

    const [semifinal] = bracketOf(context);
    const matches = await context.service.loadBracket(context.event.id, onSides([{ ...semifinal, advancesTo: null }]));

    expect(matches.map((match) => match.matchNumber)).toEqual([1]);
  });

  it('refuses (422 BRACKET_INVALID) a bracket with problems and leaves the stored one alone', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    const [first, second, final] = bracketOf(context);

    await expect(context.service.loadBracket(context.event.id, onSides([first, { ...second, matchNumber: 1 }, final])))
      .rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422 });
    expect(context.store.matchRows).toHaveLength(3);
  });

  it('refuses (409 SPORT_EVENT_BRACKET_LOCKED) once the event is released', async () => {
    const context = setup({ status: SportEventStatus.SCHEDULED });

    await expect(context.service.loadBracket(context.event.id, onSides(bracketOf(context))))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_BRACKET_LOCKED', statusCode: 409 });
  });

  it('refuses (422 SPORT_EVENT_NOT_BRACKET) an event whose sport is not played as a bracket', async () => {
    const context = setup({ sport: Sport.GOLF });

    await expect(context.service.loadBracket(context.event.id, onSides(bracketOf(context))))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_BRACKET', statusCode: 422 });
    await expect(context.service.listBracket(context.event.id))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_BRACKET' });
  });

  it('refuses (404 EVENT_NOT_FOUND) an event that does not exist', async () => {
    const { service } = setup();

    await expect(service.listBracket('no-such-event')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('findBracketProblems', () => {
  const ids = { duke: 'duke', vermont: 'vermont', houston: 'houston', texas: 'texas' };
  // Round 2 is played in the event's FINAL slot (#2006).
  const context = { roundNumbers: new Set([1, 2]), finalRoundNumbers: new Set([2]), fieldIds: new Set(Object.values(ids)) };
  const [first, second, final] = fourTeamBracket(ids);

  it('finds nothing wrong with a whole bracket, or with one whose later sides wait on their teams', () => {
    expect(findBracketProblems(onSides([first, second, final]), context)).toEqual([]);
    expect(findBracketProblems(onSides([{ ...first, homeSportEventParticipantId: null }, second, final]), context)).toEqual([]);
  });

  it('accepts a bye: a team placed straight into a later round on a side no match fills', () => {
    const byeFinal = { ...final, awaySportEventParticipantId: ids.texas };
    const problems = findBracketProblems(onSides([first, byeFinal]), { ...context, fieldIds: context.fieldIds });

    expect(problems).toEqual([]);
  });

  it('accepts games none of which link anywhere, as a week of NFL games is, even in a league that reseeds', () => {
    const week = [{ ...first, advancesTo: null }, { ...second, advancesTo: null }];

    expect(findBracketProblems(onSides(week), context)).toEqual([]);
    expect(findBracketProblems(onSides(week), { ...context, reseeds: true })).toEqual([]);
  });

  it('still asks unlinked games over several rounds, a reseeded bracket, for one final in its FINAL slot\'s round', () => {
    const twoFinals = [{ ...first, advancesTo: null }, { ...second, advancesTo: null, roundNumber: 2 }, { ...final, advancesTo: null }];

    expect(findBracketProblems(onSides(twoFinals), { ...context, reseeds: true })).toEqual(['a bracket has one final, the one match of its FINAL slot\'s round, but this one has 2']);
  });

  it('leaves the final and unplaced winners alone when the event\'s slots are not known yet (a data file before its load)', () => {
    const unplaced = [first, { ...second, advancesTo: null }, final];

    expect(findBracketProblems(onSides(unplaced), { ...context, finalRoundNumbers: null })).toEqual([]);
  });

  it('still checks the sides of games that link nowhere', () => {
    const week = [{ ...first, advancesTo: null }, { ...second, advancesTo: null, homeSportEventParticipantId: ids.duke }];

    expect(findBracketProblems(onSides(week), context)).toEqual(['round 1 match 2 side 2 names the same field row as round 1 match 1 side 2']);
  });

  it.each([
    ['a match number used twice within one round', [first, { ...second, matchNumber: 1 }, final], 'round 1 match 1 is used more than once'],
    ['a round the event does not have', [first, second, { ...final, roundNumber: 3 }], 'round 3 match 1 is in a round the event does not have'],
    ['a side naming a field row the event lacks', [{ ...first, homeSportEventParticipantId: 'stranger' }, second, final], 'round 1 match 1 side 2 names stranger, which is not on the event\'s field'],
    ['a team named twice', [first, { ...second, homeSportEventParticipantId: ids.duke }, final], 'round 1 match 2 side 2 names the same field row as round 1 match 1 side 2'],
    ['the two sides naming one team', [{ ...first, awaySportEventParticipantId: ids.duke }, second, final], 'round 1 match 1 side 2 names the same field row as round 1 match 1 side 1'],
    ['a winner advancing to a match the bracket lacks', [first, { ...second, advancesTo: { roundNumber: 2, matchNumber: 9, side: MatchSide.AWAY } }, final], 'round 1 match 2 advances to round 2 match 9, which the bracket does not have'],
    ['a winner advancing to a match in the same round', [{ ...first, advancesTo: { roundNumber: 1, matchNumber: 2, side: MatchSide.HOME } }, { ...second, homeSportEventParticipantId: null }, final], 'round 1 match 1 advances to round 1 match 2, which is not in a later round'],
    ['two winners advancing to one side', [first, { ...second, advancesTo: { roundNumber: 2, matchNumber: 1, side: MatchSide.HOME } }, final], 'two matches advance to round 2 match 1 side 2'],
    ['a fed side that also names a team', [first, second, { ...final, homeSportEventParticipantId: ids.duke }], 'round 2 match 1 side 2 names a team, but round 1 match 1\'s winner fills it'],
    ['no final', [first, second, { ...final, advancesTo: { roundNumber: 1, matchNumber: 1, side: MatchSide.HOME } }], 'a bracket has one final, the one match of its FINAL slot\'s round, but this one has 0'],
    ['a winner placed nowhere outside the final\'s round', [first, { ...second, advancesTo: null }, final], 'round 1 match 2\'s winner advances nowhere, but it is not the final'],
  ])('reports %s', (_name, matches, problem) => {
    expect(findBracketProblems(onSides(matches), context)).toContain(problem);
  });

  it('reports a match whose sides say they play at home or away at a neutral site, or a home game without one home side and one away side', () => {
    const [semifinal, otherSemifinal, theFinal] = onSides([first, second, final]);
    const homeAtNeutralSite = { ...semifinal, sides: semifinal.sides.map((side) => ({ ...side, homeAway: side.sideNumber === 2 ? HomeAway.HOME : HomeAway.NONE })) };
    const twoHomeSides = { ...otherSemifinal, isNeutralSite: false, sides: otherSemifinal.sides.map((side) => ({ ...side, homeAway: HomeAway.HOME })) };

    expect(findBracketProblems([homeAtNeutralSite, twoHomeSides, theFinal], context)).toEqual([
      'round 1 match 1 is at a neutral site, so neither side is home or away',
      'round 1 match 2 needs one home side and one away side',
    ]);
  });

  it('takes no game outside the FINAL slot\'s round for the final, even the only one whose winner goes nowhere', () => {
    const matches = [{ ...first, advancesTo: null }, { ...final, advancesTo: { roundNumber: 2, matchNumber: 9, side: MatchSide.HOME } }];

    expect(findBracketProblems(onSides(matches), context)).toEqual(expect.arrayContaining([
      'a bracket has one final, the one match of its FINAL slot\'s round, but this one has 0',
      'round 1 match 1\'s winner advances nowhere, but it is not the final',
    ]));
  });
});

describe('SportEventBracketService.updateMatch', () => {
  it('moves a match\'s time and site after release, which keeps its sides', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    context.store.events[0].status = SportEventStatus.SCHEDULED;
    const tipOff = new Date('2027-03-18T19:10:00.000Z');

    const match = await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ scheduledDate: tipOff, isNeutralSite: false }));

    expect(match).toMatchObject({ scheduledDate: tipOff, isNeutralSite: false });
    expect(homeAwayOf(match).homeSportEventParticipantId).toBe(context.duke.id);
  });

  it('has the reminder sweep look again at the event\'s contests when a game\'s time moves, but not when the time stays (#1170)', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    context.store.events[0].status = SportEventStatus.SCHEDULED;
    const tipOff = new Date('2027-03-18T19:10:00.000Z');

    await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ isNeutralSite: false }));
    await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ scheduledDate: tipOff }));
    await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ scheduledDate: tipOff }));

    expect(context.reminderRechecks.mock.calls).toEqual([[{ sportEventId: context.event.id }, NOW]]);
  });

  it('refuses (409 SPORT_EVENT_BRACKET_LOCKED) a change of sides once the event is released', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    await expect(context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ awaySportEventParticipantId: null })))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_BRACKET_LOCKED', statusCode: 409 });
  });

  it('swaps a pairing before release', async () => {
    const context = setup();
    const [first, second, final] = bracketOf(context);
    await context.service.loadBracket(context.event.id, onSides([{ ...first, awaySportEventParticipantId: null }, { ...second, awaySportEventParticipantId: null }, final]));

    const match = await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ awaySportEventParticipantId: context.texas.id }));

    expect(homeAwayOf(match).awaySportEventParticipantId).toBe(context.texas.id);
  });

  it.each([
    ['a team already in another match', (context: ReturnType<typeof setup>) => ({ place: { roundNumber: 1, matchNumber: 1 }, edit: { awaySportEventParticipantId: context.houston.id } }), 'already in round 1 match 2'],
    ['a side an earlier match\'s winner fills', (context: ReturnType<typeof setup>) => ({ place: { roundNumber: 2, matchNumber: 1 }, edit: { homeSportEventParticipantId: context.duke.id } }), 'is filled by an earlier match\'s winner'],
    ['both sides one team', (context: ReturnType<typeof setup>) => ({ place: { roundNumber: 1, matchNumber: 1 }, edit: { awaySportEventParticipantId: context.duke.id } }), 'both sides name the same team'],
    ['a field row the event lacks', () => ({ place: { roundNumber: 1, matchNumber: 1 }, edit: { awaySportEventParticipantId: 'stranger' } }), 'not on the event\'s field'],
  ])('refuses (422 BRACKET_INVALID) a side naming %s', async (_name, change, problem) => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    const { place, edit } = change(context);

    await expect(context.service.updateMatch(context.event.id, place, editInput(edit)))
      .rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422, message: expect.stringContaining(problem) });
  });

  // #720: a game's spread, read from the home side by pools scored against the spread.
  it('sets and clears a game\'s spread before release', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));

    expect(homeAwayOf(await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: -3.5 }))).homeSpread).toBe(-3.5);
    expect(homeAwayOf(await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: null }))).homeSpread).toBe(null);
  });

  it('changes a game\'s spread after release while no entry has picked the game', async () => {
    const context = setup({ picks: picksOn() });
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    expect(homeAwayOf(await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: 7 }))).homeSpread).toBe(7);
  });

  it('refuses (422 MATCH_SPREAD_REQUIRED) clearing a game\'s spread after release, even with no picks, keeping the spread', async () => {
    const context = setup({ picks: picksOn() });
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: -3 }));
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    await expect(context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: null })))
      .rejects.toMatchObject({ code: 'MATCH_SPREAD_REQUIRED', statusCode: 422 });
    expect(homeAwayOf(expectDefined(context.store.matchRows.find((row) => isAtPlace(row, { roundNumber: 1, matchNumber: 1 })))).homeSpread).toBe(-3);
  });

  it('refuses (409 MATCH_SPREAD_LOCKED) a spread change after release on a game with picks, keeping the spread, but still moves its time', async () => {
    const context = setup({ picks: picksOn('match-1') });
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: -3 }));
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    await expect(context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: -4 })))
      .rejects.toMatchObject({ code: 'MATCH_SPREAD_LOCKED', statusCode: 409 });
    const tipOff = new Date('2027-03-18T19:10:00.000Z');
    const moved = await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ homeSpread: -3, scheduledDate: tipOff }));
    expect([homeAwayOf(moved).homeSpread, moved.scheduledDate]).toEqual([-3, tipOff]);
  });

  it('refuses (404 BRACKET_MATCH_NOT_FOUND) a match number the bracket lacks', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));

    await expect(context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 9 }, editInput({ isNeutralSite: false })))
      .rejects.toMatchObject({ code: 'BRACKET_MATCH_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventBracketService.releaseBlockers', () => {
  it('has nothing to say about an event whose sport plays no bracket', async () => {
    const context = setup({ sport: Sport.GOLF });

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([]);
  });

  it('blocks release until the bracket is loaded', async () => {
    const context = setup();

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual(['its bracket is not loaded']);
  });

  it('lets a whole bracket release: every side named or filled by an earlier winner, and every active team in it', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([]);
  });

  it('counts a bracket place no team fills and no earlier match feeds, and an active team left out of the bracket', async () => {
    const context = setup();
    const [first, second, final] = bracketOf(context);
    await context.service.loadBracket(context.event.id, onSides([first, { ...second, awaySportEventParticipantId: null }, final]));

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([
      '1 bracket place(s) have no team and no earlier match to fill them',
      '1 active teams are not in the bracket',
    ]);
  });

  it('counts a withdrawn team still in the bracket, and does not ask for a withdrawn team left out of it', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    expectDefined(context.store.field.find((entry) => entry.id === context.texas.id)).status = SportEventParticipantStatus.WITHDRAWN;

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual(['1 withdrawn teams are still in the bracket']);
  });
});

describe('SportEventBracketService.releaseBlockers (reseeded bracket)', () => {
  /**
   * One NFL-style conference whose bracket reseeds twice: seeds 1 and 2 on byes into the
   * Divisional round, 3 v 6 and 4 v 5 on Wild Card weekend, then a Conference Championship. No
   * Wild Card or Divisional game links anywhere: both later rounds are placed by seed.
   */
  async function conferenceSetup(divisional: (seed: (number: number) => string) => Array<[string | null, string | null]>, seedCount = 6) {
    const store = new InMemorySportEvents();
    const sportRow = store.addSport(Sport.FOOTBALL);
    const sportLeague = store.addSportLeague(sportRow.id, 'NFL');
    const event = store.addEvent({ sportLeagueId: sportLeague.id, sport: Sport.FOOTBALL, status: SportEventStatus.DRAFT, rounds: 3 });
    // Its postseason slots reseed, each round in its own (#2006).
    const slots = store.addRoundSlots(event.id, [
      { slotKind: SlotKind.QUARTERFINAL, name: 'Wild Card', pairing: SlotPairing.RESEEDED },
      { slotKind: SlotKind.SEMIFINAL, name: 'Divisional', pairing: SlotPairing.RESEEDED },
      { slotKind: SlotKind.FINAL, name: 'Conference Championship', pairing: SlotPairing.RESEEDED },
    ]);
    await store.addRounds(event.id, [1, 2, 3].map((roundNumber) => ({
      roundNumber, scheduledDate: new Date(Date.UTC(2027, 0, 7 * roundNumber)),
    })), (roundNumber) => expectDefined(slots[roundNumber - 1], `round ${String(roundNumber)}'s slot`));
    const seeds = Array.from({ length: seedCount }, (_, index) => index + 1).map((seedNumber) => {
      const team = store.addParticipant(sportRow.id, `Seed ${seedNumber}`, { participantType: 'TEAM' });
      return store.addToField(event.id, team.id, { seedNumber });
    });
    const seed = (number: number): string => expectDefined(seeds[number - 1]).id;
    const service = new SportEventBracketService({ domainEvents: testDomainEvents(),
      sportEvents: store.sportEventRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      matches: store.matchRepo(),
      tiers: store.tierRepo(),
      valuations: store.valuationRepo(),
      contests: { recheckReminders: async () => undefined },
      ...NO_PICKS_ON_EVENT,
    });
    const game = (matchNumber: number, roundNumber: number, home: string | null, away: string | null): HomeAwayBracketInput => (({
      matchNumber, roundNumber, homeSportEventParticipantId: home, awaySportEventParticipantId: away,
      isNeutralSite: false, scheduledDate: null, advancesTo: null, regionLabel: 'AFC',
    }));
    const [first, second] = divisional(seed);
    await service.loadBracket(event.id, onSides([
      game(1, 1, seed(3), seed(6)),
      game(2, 1, seed(4), seed(5)),
      game(3, 2, ...expectDefined(first)),
      game(4, 2, ...expectDefined(second)),
      game(5, 3, null, null),
    ]));
    return { store, service, event, seed };
  }

  it('lets a reseeded bracket release when each reseeded round has one open place per winner still to come, a round after a reseeded round included', async () => {
    const context = await conferenceSetup((seed) => [[seed(1), null], [seed(2), null]]);

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([]);
  });

  it('blocks release, naming the round and conference, when a reseeded round leaves a bye team\'s place empty and the field leaves the team out too', async () => {
    const context = await conferenceSetup((seed) => [[null, null], [seed(2), null]]);
    context.store.field = context.store.field.filter((entry) => entry.id !== context.seed(1));

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([
      'Divisional in AFC has 3 open place(s) for 2 Wild Card winner(s) still to come',
    ]);
  });

  it('blocks release, naming the round and conference, when a reseeded round names a team too many and leaves too few places for the winners to come', async () => {
    const context = await conferenceSetup((seed) => [[seed(1), seed(7)], [seed(2), null]], 7);

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([
      'Divisional in AFC has 1 open place(s) for 2 Wild Card winner(s) still to come',
    ]);
  });
});

describe('SportEventBracketService round matchups (reseeded bracket)', () => {
  /**
   * A released bracket whose league reseeds: two unlinked semifinals, so the final's sides wait to
   * be placed by seed. `reseeds: false` reads the event's slots as fixed after the load, as a
   * bracket whose rounds are linked is; `release: false` leaves the event a draft.
   */
  async function reseededSetup({ reseeds = true, release = true, bracket }: { reseeds?: boolean; release?: boolean; bracket?: (context: ReturnType<typeof setup>) => HomeAwayBracketInput[] } = {}) {
    const context = setup({ pairing: SlotPairing.RESEEDED });
    const unlinked = bracketOf(context).map((match) => ({ ...match, advancesTo: null }));
    await context.service.loadBracket(context.event.id, onSides(bracket ? bracket(context) : unlinked));
    if (!reseeds) {
      for (const round of context.store.roundRows) round.slot = { ...round.slot, pairing: SlotPairing.FIXED };
    }
    if (release) context.event.status = SportEventStatus.SCHEDULED;
    return context;
  }

  /** Every match of the round won by its home side. */
  function finishRound(context: ReturnType<typeof setup>, roundNumber: number): void {
    for (const match of context.store.matchRows.filter((row) => row.roundNumber === roundNumber)) {
      Object.assign(match, withHomeAway(match, { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME }));
    }
  }

  it('proposes the best seed left hosting the worst once the round before is finished, and places it', async () => {
    const context = await reseededSetup();
    finishRound(context, 1);

    const proposal = await context.service.proposeRoundMatchups(context.event.id, 2);
    // The better seed hosts, on side 2 (#2184).
    expect(proposal).toEqual([{ matchNumber: 1, sides: [{ sideNumber: 1, sportEventParticipantId: context.houston.id }, { sideNumber: 2, sportEventParticipantId: context.duke.id }] }]);

    const bracket = await context.service.setRoundMatchups(context.event.id, 2, proposal);
    expect(homeAwayOf(expectDefined(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))))).toMatchObject({
      homeSportEventParticipantId: context.duke.id,
      awaySportEventParticipantId: context.houston.id,
    });
  });

  it('refuses (422 BRACKET_NOT_RESEEDED) both proposing and setting a round when the league\'s bracket does not reseed', async () => {
    const context = await reseededSetup({ reseeds: false });
    finishRound(context, 1);

    await expect(context.service.proposeRoundMatchups(context.event.id, 2)).rejects.toMatchObject({ code: 'BRACKET_NOT_RESEEDED', statusCode: 422 });
    await expect(context.service.setRoundMatchups(context.event.id, 2, []))
      .rejects.toMatchObject({ code: 'BRACKET_NOT_RESEEDED', statusCode: 422 });
  });

  it('refuses (409 SPORT_EVENT_NOT_RELEASED) a draft event, whose pairings are set through the bracket itself', async () => {
    const context = await reseededSetup({ release: false });

    await expect(context.service.proposeRoundMatchups(context.event.id, 2)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
    await expect(context.service.setRoundMatchups(context.event.id, 2, []))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
  });

  it('refuses (422 BRACKET_NOT_RESEEDED) a round whose sides are filled by the links of the round before', async () => {
    const context = await reseededSetup({ bracket: bracketOf });
    finishRound(context, 1);

    await expect(context.service.proposeRoundMatchups(context.event.id, 2)).rejects.toMatchObject({ code: 'BRACKET_NOT_RESEEDED', statusCode: 422 });
  });

  it('refuses (409 BRACKET_ROUND_NOT_FINISHED) while a match of the round before has no result', async () => {
    const context = await reseededSetup();

    await expect(context.service.proposeRoundMatchups(context.event.id, 2)).rejects.toMatchObject({ code: 'BRACKET_ROUND_NOT_FINISHED', statusCode: 409 });
  });

  it('refuses (422 BRACKET_INVALID) a proposal when more teams are left than the round has places', async () => {
    // Houston and Texas are byes into the final, so the semifinal's winner makes three teams for
    // its two places.
    const context = await reseededSetup({
      bracket: (ids) => [
        ({ matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: ids.duke.id, awaySportEventParticipantId: ids.vermont.id, isNeutralSite: true, scheduledDate: null, advancesTo: null }),
        ({ matchNumber: 1, roundNumber: 2, homeSportEventParticipantId: ids.houston.id, awaySportEventParticipantId: ids.texas.id, isNeutralSite: true, scheduledDate: null, advancesTo: null }),
      ],
    });
    finishRound(context, 1);

    await expect(context.service.proposeRoundMatchups(context.event.id, 2)).rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422 });
  });

  it('refuses (422 BRACKET_INVALID) setting a team that is not left in the round, and leaves the round unplaced', async () => {
    const context = await reseededSetup();
    finishRound(context, 1);

    await expect(context.service.setRoundMatchups(context.event.id, 2, [
      { matchNumber: 1, sides: [{ sideNumber: 1, sportEventParticipantId: context.vermont.id }, { sideNumber: 2, sportEventParticipantId: context.duke.id }] },
    ])).rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422 });
    expect(homeAwayOf(expectDefined(context.store.matchRows.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))))).toMatchObject({
      homeSportEventParticipantId: null,
      awaySportEventParticipantId: null,
    });
  });
});

describe('SportEventBracketService — leaderboard rebuild (#1466)', () => {
  /** What the store kept and the rebuilds woke for, from `from` on: one action's writes. */
  function since(context: ReturnType<typeof setup>, from: { jobs: number; woken: number }) {
    return { jobs: context.store.backgroundJobs.slice(from.jobs), woken: context.domainEvents.changedSportEventIds.slice(from.woken) };
  }
  const mark = (context: ReturnType<typeof setup>) => ({ jobs: context.store.backgroundJobs.length, woken: context.domainEvents.changedSportEventIds.length });
  /** A write of the event's games also runs its slots' tiebreaker rule again (#2048). */
  const gamesWritten = (sportEventId: string) => ({ jobs: [eventRebuildJob(sportEventId), slotTiebreakersRefreshJob(sportEventId)], woken: [sportEventId] });

  it('writes the event\'s rebuild and tiebreaker jobs with a loaded bracket and with a match edit, waking the runner after each', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context)));
    expect(since(context, { jobs: 0, woken: 0 })).toEqual(gamesWritten(context.event.id));

    const before = mark(context);
    await context.service.updateMatch(context.event.id, { roundNumber: 1, matchNumber: 1 }, editInput({ isNeutralSite: false }));
    expect(since(context, before)).toEqual(gamesWritten(context.event.id));
  });

  it('writes the rebuild and tiebreaker jobs with a reseeded round\'s matchups', async () => {
    const context = setup({ pairing: SlotPairing.RESEEDED });
    await context.service.loadBracket(context.event.id, onSides(bracketOf(context).map((match) => ({ ...match, advancesTo: null }))));
    context.event.status = SportEventStatus.SCHEDULED;
    for (const match of context.store.matchRows.filter((row) => row.roundNumber === 1)) {
      Object.assign(match, withHomeAway(match, { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME }));
    }
    const proposal = await context.service.proposeRoundMatchups(context.event.id, 2);
    const before = mark(context);

    await context.service.setRoundMatchups(context.event.id, 2, proposal);

    expect(since(context, before)).toEqual(gamesWritten(context.event.id));
  });

  it('hands out no rebuild for a bracket refused before anything is written', async () => {
    const context = setup();
    const [first, second, final] = bracketOf(context);

    await expect(context.service.loadBracket(context.event.id, onSides([first, { ...second, matchNumber: 1 }, final]))).rejects.toBeDefined();

    expect(context.store.backgroundJobs).toEqual([]);
    expect(context.domainEvents.handedOutSportEventIds).toEqual([]);
  });
});
