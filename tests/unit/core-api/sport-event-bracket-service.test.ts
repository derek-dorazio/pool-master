import { expect } from '@jest/globals';
import { BracketAdvancement, MatchSide, MatchStatus, ParticipantStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import {
  findBracketProblems,
  SportEventBracketService,
  type BracketMatchInput,
} from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { expectDefined } from '../../support/expect-defined';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';

// A bracket's rules against an in-memory store: what loading refuses, what a match edit may
// change before and after release, what release still needs, and the First Four's play-in places.
// The Prisma adapter and the database checks are covered in sport-event-matches.integration.

const TEAMS = ['Duke', 'Vermont', 'Houston', 'Texas'] as const;

function setup({ sport = Sport.BASKETBALL, status = SportEventStatus.DRAFT, picks = NO_PICKS_ON_EVENT }: {
  sport?: Sport;
  status?: SportEventStatus;
  picks?: typeof NO_PICKS_ON_EVENT;
} = {}) {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(sport);
  const sportLeague = store.addSportLeague(sportRow.id, 'NCAA Division I Men');
  const event = store.addEvent({ sportLeagueId: sportLeague.id, sport, status, rounds: 2 });
  void store.roundRepo().createMany(event.id, [
    { roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-03-20T16:00:00.000Z') },
  ]);
  const [duke, vermont, houston, texas] = TEAMS.map((name, index) => {
    const team = store.addParticipant(sportRow.id, name, { participantType: 'TEAM' });
    return store.addToField(event.id, team.id, { seedNumber: index + 1 });
  });
  let sequence = 0;
  const service = new SportEventBracketService({
    sportEvents: store.sportEventRepo(),
    sportLeagues: store.sportLeagueRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    matches: store.matchRepo(),
    ...picks,
    newId: () => {
      sequence += 1;
      return `match-${sequence}`;
    },
  });
  return { store, service, event, sportRow, duke, vermont, houston, texas };
}

/** Two semifinals feeding a final: the smallest whole bracket. */
function fourTeamBracket(ids: { duke: string; vermont: string; houston: string; texas: string }): BracketMatchInput[] {
  return [
    { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: ids.duke, awaySportEventParticipantId: ids.vermont, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.HOME } },
    { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: ids.houston, awaySportEventParticipantId: ids.texas, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.AWAY } },
    { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
  ];
}

/** The picks side for an event whose named games have picks (#720). */
function picksOn(...pickedMatchIds: string[]): typeof NO_PICKS_ON_EVENT {
  return { predictions: { hasAnyOnMatch: async (sportEventMatchId) => pickedMatchIds.includes(sportEventMatchId) } };
}

function bracketOf(context: ReturnType<typeof setup>): BracketMatchInput[] {
  return fourTeamBracket({ duke: context.duke.id, vermont: context.vermont.id, houston: context.houston.id, texas: context.texas.id });
}

describe('SportEventBracketService.loadBracket', () => {
  it('stores every match with the next match and side its winner moves on to', async () => {
    const context = setup();

    const matches = await context.service.loadBracket(context.event.id, bracketOf(context));

    expect(matches.map((match) => [match.matchNumber, match.roundNumber, match.advancesToMatchId, match.advancesToSide])).toEqual([
      [1, 1, 'match-3', MatchSide.HOME],
      [2, 1, 'match-3', MatchSide.AWAY],
      [3, 2, null, null],
    ]);
    expect(matches.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('replaces the bracket already loaded rather than adding to it', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));

    const [semifinal] = bracketOf(context);
    const matches = await context.service.loadBracket(context.event.id, [{ ...semifinal, advancesTo: null }]);

    expect(matches.map((match) => match.matchNumber)).toEqual([1]);
  });

  it('refuses (422 BRACKET_INVALID) a bracket with problems and leaves the stored one alone', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));
    const [first, second, final] = bracketOf(context);

    await expect(context.service.loadBracket(context.event.id, [first, { ...second, matchNumber: 1 }, final]))
      .rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422 });
    expect(context.store.matchRows).toHaveLength(3);
  });

  it('refuses (409 SPORT_EVENT_BRACKET_LOCKED) once the event is released', async () => {
    const context = setup({ status: SportEventStatus.SCHEDULED });

    await expect(context.service.loadBracket(context.event.id, bracketOf(context)))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_BRACKET_LOCKED', statusCode: 409 });
  });

  it('refuses (422 SPORT_EVENT_NOT_BRACKET) an event whose sport is not played as a bracket', async () => {
    const context = setup({ sport: Sport.GOLF });

    await expect(context.service.loadBracket(context.event.id, bracketOf(context)))
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
  const context = { roundNumbers: new Set([1, 2]), fieldIds: new Set(Object.values(ids)) };
  const [first, second, final] = fourTeamBracket(ids);

  it('finds nothing wrong with a whole bracket, or with one whose later sides wait on their teams', () => {
    expect(findBracketProblems([first, second, final], context)).toEqual([]);
    expect(findBracketProblems([{ ...first, homeSportEventParticipantId: null }, second, final], context)).toEqual([]);
  });

  it('accepts a bye: a team placed straight into a later round on a side no match fills', () => {
    const byeFinal = { ...final, awaySportEventParticipantId: ids.texas };
    const problems = findBracketProblems([first, byeFinal], { ...context, fieldIds: context.fieldIds });

    expect(problems).toEqual([]);
  });

  it('accepts games none of which link anywhere, as a week of NFL games is, even in a league that reseeds', () => {
    const week = [{ ...first, advancesTo: null }, { ...second, advancesTo: null }];

    expect(findBracketProblems(week, context)).toEqual([]);
    expect(findBracketProblems(week, { ...context, reseeds: true })).toEqual([]);
  });

  it('still asks unlinked games over several rounds, a reseeded bracket, for one final in their last round', () => {
    const twoFinals = [{ ...first, advancesTo: null }, { ...second, advancesTo: null, roundNumber: 2 }, { ...final, advancesTo: null }];

    expect(findBracketProblems(twoFinals, { ...context, reseeds: true })).toEqual(['a bracket has one final, the one match in its last round, but this one has 2 in round 2']);
  });

  it('still checks the sides of games that link nowhere', () => {
    const week = [{ ...first, advancesTo: null }, { ...second, advancesTo: null, homeSportEventParticipantId: ids.duke }];

    expect(findBracketProblems(week, context)).toEqual(['match 2 home names the same field row as match 1 home']);
  });

  it.each([
    ['a match number used twice', [first, { ...second, matchNumber: 1 }, final], 'match number 1 is used more than once'],
    ['a round the event does not have', [first, second, { ...final, roundNumber: 3 }], 'match 3 is in round 3, which the event does not have'],
    ['a side naming a field row the event lacks', [{ ...first, homeSportEventParticipantId: 'stranger' }, second, final], 'match 1 home names stranger, which is not on the event\'s field'],
    ['a team named twice', [first, { ...second, homeSportEventParticipantId: ids.duke }, final], 'match 2 home names the same field row as match 1 home'],
    ['the two sides naming one team', [{ ...first, awaySportEventParticipantId: ids.duke }, second, final], 'match 1 away names the same field row as match 1 home'],
    ['a winner advancing to a match the bracket lacks', [first, { ...second, advancesTo: { matchNumber: 9, side: MatchSide.AWAY } }, final], 'match 2 advances to match 9, which the bracket does not have'],
    ['a winner advancing to a match in the same round', [{ ...first, advancesTo: { matchNumber: 2, side: MatchSide.HOME } }, { ...second, homeSportEventParticipantId: null }, final], 'match 1 advances to match 2, which is not in a later round'],
    ['two winners advancing to one side', [first, { ...second, advancesTo: { matchNumber: 3, side: MatchSide.HOME } }, final], 'two matches advance to match 3 home'],
    ['a fed side that also names a team', [first, second, { ...final, homeSportEventParticipantId: ids.duke }], 'match 3 home names a team, but match 1\'s winner fills it'],
    ['no final', [first, second, { ...final, advancesTo: { matchNumber: 1, side: MatchSide.HOME } }], 'a bracket has one final, the one match whose winner advances nowhere, but this one has 0'],
    ['two finals', [first, { ...second, advancesTo: null }, final], 'a bracket has one final, the one match whose winner advances nowhere, but this one has 2'],
  ])('reports %s', (_name, matches, problem) => {
    expect(findBracketProblems(matches, context)).toContain(problem);
  });

  it('reports a final that is not in the bracket\'s last round', () => {
    // Match 1 is the only match whose winner goes nowhere, yet match 3 is played a round later.
    const matches = [{ ...first, advancesTo: null }, { ...final, advancesTo: { matchNumber: 9, side: MatchSide.HOME } }];

    expect(findBracketProblems(matches, context)).toContain('the final, match 1, is not in the bracket\'s last round (round 2)');
  });
});

describe('SportEventBracketService.updateMatch', () => {
  it('moves a match\'s time and site after release, which keeps its sides', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));
    context.store.events[0].status = SportEventStatus.SCHEDULED;
    const tipOff = new Date('2027-03-18T19:10:00.000Z');

    const match = await context.service.updateMatch(context.event.id, 1, { scheduledDate: tipOff, isNeutralSite: false });

    expect(match).toMatchObject({ scheduledDate: tipOff, isNeutralSite: false, homeSportEventParticipantId: context.duke.id });
  });

  it('refuses (409 SPORT_EVENT_BRACKET_LOCKED) a change of sides once the event is released', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    await expect(context.service.updateMatch(context.event.id, 1, { awaySportEventParticipantId: null }))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_BRACKET_LOCKED', statusCode: 409 });
  });

  it('swaps a pairing before release', async () => {
    const context = setup();
    const [first, second, final] = bracketOf(context);
    await context.service.loadBracket(context.event.id, [{ ...first, awaySportEventParticipantId: null }, { ...second, awaySportEventParticipantId: null }, final]);

    const match = await context.service.updateMatch(context.event.id, 1, { awaySportEventParticipantId: context.texas.id });

    expect(match.awaySportEventParticipantId).toBe(context.texas.id);
  });

  it.each([
    ['a team already in another match', (context: ReturnType<typeof setup>) => ({ matchNumber: 1, edit: { awaySportEventParticipantId: context.houston.id } }), 'already in match 2'],
    ['a side an earlier match\'s winner fills', (context: ReturnType<typeof setup>) => ({ matchNumber: 3, edit: { homeSportEventParticipantId: context.duke.id } }), 'filled by an earlier match\'s winner'],
    ['both sides one team', (context: ReturnType<typeof setup>) => ({ matchNumber: 1, edit: { awaySportEventParticipantId: context.duke.id } }), 'both sides name the same team'],
    ['a field row the event lacks', () => ({ matchNumber: 1, edit: { awaySportEventParticipantId: 'stranger' } }), 'not on the event\'s field'],
  ])('refuses (422 BRACKET_INVALID) a side naming %s', async (_name, change, problem) => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));
    const { matchNumber, edit } = change(context);

    await expect(context.service.updateMatch(context.event.id, matchNumber, edit))
      .rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422, message: expect.stringContaining(problem) });
  });

  // #720: a game's spread, read from the home side by pools scored against the spread.
  it('sets and clears a game\'s spread before release', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));

    await expect(context.service.updateMatch(context.event.id, 1, { homeSpread: -3.5 })).resolves.toMatchObject({ homeSpread: -3.5 });
    await expect(context.service.updateMatch(context.event.id, 1, { homeSpread: null })).resolves.toMatchObject({ homeSpread: null });
  });

  it('changes a game\'s spread after release while no entry has picked the game', async () => {
    const context = setup({ picks: picksOn() });
    await context.service.loadBracket(context.event.id, bracketOf(context));
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    await expect(context.service.updateMatch(context.event.id, 1, { homeSpread: 7 })).resolves.toMatchObject({ homeSpread: 7 });
  });

  it('refuses (422 MATCH_SPREAD_REQUIRED) clearing a game\'s spread after release, even with no picks, keeping the spread', async () => {
    const context = setup({ picks: picksOn() });
    await context.service.loadBracket(context.event.id, bracketOf(context));
    await context.service.updateMatch(context.event.id, 1, { homeSpread: -3 });
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    await expect(context.service.updateMatch(context.event.id, 1, { homeSpread: null }))
      .rejects.toMatchObject({ code: 'MATCH_SPREAD_REQUIRED', statusCode: 422 });
    expect(context.store.matchRows.find((row) => row.matchNumber === 1)?.homeSpread).toBe(-3);
  });

  it('refuses (409 MATCH_SPREAD_LOCKED) a spread change after release on a game with picks, keeping the spread, but still moves its time', async () => {
    const context = setup({ picks: picksOn('match-1') });
    await context.service.loadBracket(context.event.id, bracketOf(context));
    await context.service.updateMatch(context.event.id, 1, { homeSpread: -3 });
    context.store.events[0].status = SportEventStatus.SCHEDULED;

    await expect(context.service.updateMatch(context.event.id, 1, { homeSpread: -4 }))
      .rejects.toMatchObject({ code: 'MATCH_SPREAD_LOCKED', statusCode: 409 });
    const tipOff = new Date('2027-03-18T19:10:00.000Z');
    await expect(context.service.updateMatch(context.event.id, 1, { homeSpread: -3, scheduledDate: tipOff }))
      .resolves.toMatchObject({ homeSpread: -3, scheduledDate: tipOff });
  });

  it('refuses (404 BRACKET_MATCH_NOT_FOUND) a match number the bracket lacks', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));

    await expect(context.service.updateMatch(context.event.id, 9, { isNeutralSite: false }))
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
    await context.service.loadBracket(context.event.id, bracketOf(context));

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([]);
  });

  it('counts a bracket place no team fills and no earlier match feeds, and an active team left out of the bracket', async () => {
    const context = setup();
    const [first, second, final] = bracketOf(context);
    await context.service.loadBracket(context.event.id, [first, { ...second, awaySportEventParticipantId: null }, final]);

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual([
      '1 bracket place(s) have no team and no earlier match to fill them',
      '1 active teams are not in the bracket',
    ]);
  });

  it('counts a withdrawn team still in the bracket, and does not ask for a withdrawn team left out of it', async () => {
    const context = setup();
    await context.service.loadBracket(context.event.id, bracketOf(context));
    expectDefined(context.store.field.find((entry) => entry.id === context.texas.id)).isActive = false;

    await expect(context.service.releaseBlockers(context.event)).resolves.toEqual(['1 withdrawn teams are still in the bracket']);
  });
});

describe('SportEventBracketService.releaseBlockers (reseeded bracket)', () => {
  /**
   * One NFL-style conference whose bracket reseeds twice: seeds 1 and 2 on byes into the
   * Divisional round, 3 v 6 and 4 v 5 on Wild Card weekend, then a Conference Championship. No
   * Wild Card or Divisional game links anywhere: both later rounds are placed by seed.
   */
  async function conferenceSetup(divisional: (seed: (number: number) => string) => Array<[string | null, string | null]>) {
    const store = new InMemorySportEvents();
    const sportRow = store.addSport(Sport.AMERICAN_FOOTBALL);
    const sportLeague = store.addSportLeague(sportRow.id, 'NFL');
    await store.sportLeagueRepo().update(sportLeague.id, {
      bracketAdvancement: BracketAdvancement.RESEED_BY_SEED,
      roundNames: ['Wild Card', 'Divisional', 'Conference Championship'],
    });
    const event = store.addEvent({ sportLeagueId: sportLeague.id, sport: Sport.AMERICAN_FOOTBALL, status: SportEventStatus.DRAFT, rounds: 3 });
    await store.roundRepo().createMany(event.id, [1, 2, 3].map((roundNumber) => ({
      roundNumber, scheduledDate: new Date(Date.UTC(2027, 0, 7 * roundNumber)),
    })));
    const seeds = [1, 2, 3, 4, 5, 6].map((seedNumber) => {
      const team = store.addParticipant(sportRow.id, `Seed ${seedNumber}`, { participantType: 'TEAM' });
      return store.addToField(event.id, team.id, { seedNumber });
    });
    const seed = (number: number): string => expectDefined(seeds[number - 1]).id;
    const service = new SportEventBracketService({
      sportEvents: store.sportEventRepo(),
      sportLeagues: store.sportLeagueRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      matches: store.matchRepo(),
      ...NO_PICKS_ON_EVENT,
    });
    const game = (matchNumber: number, roundNumber: number, home: string | null, away: string | null): BracketMatchInput => ({
      matchNumber, roundNumber, homeSportEventParticipantId: home, awaySportEventParticipantId: away,
      isNeutralSite: false, scheduledDate: null, advancesTo: null, regionLabel: 'AFC',
    });
    const [first, second] = divisional(seed);
    await service.loadBracket(event.id, [
      game(1, 1, seed(3), seed(6)),
      game(2, 1, seed(4), seed(5)),
      game(3, 2, ...expectDefined(first)),
      game(4, 2, ...expectDefined(second)),
      game(5, 3, null, null),
    ]);
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
});

describe('SportEventBracketService.fillPlayInSlot', () => {
  function withPlayInPlace() {
    const context = setup({ status: SportEventStatus.SCHEDULED });
    const pairing = context.store.addParticipant(context.sportRow.id, 'Texas / Xavier', { participantType: 'TEAM' });
    const slot = context.store.addToField(context.event.id, pairing.id, { seedNumber: 11, isPlayInPlace: true });
    const xavier = context.store.addParticipant(context.sportRow.id, 'Xavier', { participantType: 'TEAM' });
    return { ...context, pairing, slot, xavier };
  }

  it('points the play-in place at the winning team, keeping the row and its seed, inactivates the pairing and leaves the row a play-in place no more', async () => {
    const { service, store, event, pairing, slot, xavier } = withPlayInPlace();

    await service.fillPlayInSlot(event.id, slot.id, xavier.id);

    expect(store.field.find((entry) => entry.id === slot.id)).toMatchObject({ participantId: xavier.id, seedNumber: 11, isPlayInPlace: false });
    expect(store.participants.find((participant) => participant.id === pairing.id)?.status).toBe(ParticipantStatus.INACTIVE);
  });

  it('refuses (409 EVENT_PARTICIPANT_ALREADY_ON_FIELD) a winner already on the field', async () => {
    const { service, store, event, slot, duke } = withPlayInPlace();

    await expect(service.fillPlayInSlot(event.id, slot.id, duke.participantId))
      .rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_ALREADY_ON_FIELD', statusCode: 409 });
    expect(store.field.find((entry) => entry.id === slot.id)?.participantId).not.toBe(duke.participantId);
  });

  it('refuses (404 PARTICIPANT_NOT_FOUND) a winner from another sport or an inactive one', async () => {
    const { service, store, event, slot } = withPlayInPlace();
    const golfer = store.addParticipant(store.addSport(Sport.GOLF).id, 'Ana');
    const retired = store.addParticipant(store.sports[0].id, 'Retired U', { status: ParticipantStatus.INACTIVE });

    await expect(service.fillPlayInSlot(event.id, slot.id, golfer.id)).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND', statusCode: 404 });
    await expect(service.fillPlayInSlot(event.id, slot.id, retired.id)).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND' });
  });

  it('refuses (409 EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE) a row that is not a play-in place, leaving the team and its participant alone', async () => {
    const { service, store, event, duke, xavier } = withPlayInPlace();

    await expect(service.fillPlayInSlot(event.id, duke.id, xavier.id))
      .rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE', statusCode: 409 });
    expect(store.field.find((entry) => entry.id === duke.id)?.participantId).toBe(duke.participantId);
    expect(store.participants.find((participant) => participant.id === duke.participantId)?.status).toBe(ParticipantStatus.ACTIVE);
  });

  it('refuses (404 EVENT_PARTICIPANT_NOT_FOUND) a field row of another event', async () => {
    const { service, store, event, xavier } = withPlayInPlace();
    const other = store.addEvent({ sport: Sport.BASKETBALL });
    const elsewhere = store.addToField(other.id, store.addParticipant(store.sports[0].id, 'Gonzaga').id);

    await expect(service.fillPlayInSlot(event.id, elsewhere.id, xavier.id))
      .rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
  });

  it('refuses (409 PLAY_IN_SLOT_ALREADY_PLAYED) once the place has started a bracket match', async () => {
    const { service, store, event, slot, xavier, duke } = withPlayInPlace();
    store.matchRows.push({
      id: 'match-started', sportEventId: event.id, roundNumber: 1, matchNumber: 1,
      homeSportEventParticipantId: duke.id, awaySportEventParticipantId: slot.id, isNeutralSite: true,
      scheduledDate: null, status: MatchStatus.IN_PROGRESS, winnerSide: null, homeScore: null, awayScore: null,
      advancesToMatchId: null, advancesToSide: null, regionLabel: null, homeSpread: null, periodScores: [], createdAt: new Date(), updatedAt: new Date(),
    });

    await expect(service.fillPlayInSlot(event.id, slot.id, xavier.id))
      .rejects.toMatchObject({ code: 'PLAY_IN_SLOT_ALREADY_PLAYED', statusCode: 409 });
  });
});

describe('SportEventBracketService round matchups (reseeded bracket)', () => {
  /**
   * A released bracket whose league reseeds: two unlinked semifinals, so the final's sides wait to
   * be placed by seed. `reseeds: false` switches the league to a fixed bracket after the load, as
   * an admin can; `release: false` leaves the event a draft.
   */
  async function reseededSetup({ reseeds = true, release = true, bracket }: { reseeds?: boolean; release?: boolean; bracket?: (context: ReturnType<typeof setup>) => BracketMatchInput[] } = {}) {
    const context = setup();
    const sportLeagues = context.store.sportLeagueRepo();
    await sportLeagues.update(context.event.sportLeagueId, { bracketAdvancement: BracketAdvancement.RESEED_BY_SEED });
    const unlinked = bracketOf(context).map((match) => ({ ...match, advancesTo: null }));
    await context.service.loadBracket(context.event.id, bracket ? bracket(context) : unlinked);
    if (!reseeds) await sportLeagues.update(context.event.sportLeagueId, { bracketAdvancement: BracketAdvancement.FIXED });
    if (release) context.event.status = SportEventStatus.SCHEDULED;
    return context;
  }

  /** Every match of the round won by its home side. */
  function finishRound(context: ReturnType<typeof setup>, roundNumber: number): void {
    for (const match of context.store.matchRows.filter((row) => row.roundNumber === roundNumber)) {
      Object.assign(match, { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME });
    }
  }

  it('proposes the best seed left hosting the worst once the round before is finished, and places it', async () => {
    const context = await reseededSetup();
    finishRound(context, 1);

    const proposal = await context.service.proposeRoundMatchups(context.event.id, 2);
    expect(proposal).toEqual([{ matchNumber: 3, homeSportEventParticipantId: context.duke.id, awaySportEventParticipantId: context.houston.id }]);

    const bracket = await context.service.setRoundMatchups(context.event.id, 2, proposal);
    expect(expectDefined(bracket.find((match) => match.matchNumber === 3))).toMatchObject({
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
        { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: ids.duke.id, awaySportEventParticipantId: ids.vermont.id, isNeutralSite: true, scheduledDate: null, advancesTo: null },
        { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: ids.houston.id, awaySportEventParticipantId: ids.texas.id, isNeutralSite: true, scheduledDate: null, advancesTo: null },
      ],
    });
    finishRound(context, 1);

    await expect(context.service.proposeRoundMatchups(context.event.id, 2)).rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422 });
  });

  it('refuses (422 BRACKET_INVALID) setting a team that is not left in the round, and leaves the round unplaced', async () => {
    const context = await reseededSetup();
    finishRound(context, 1);

    await expect(context.service.setRoundMatchups(context.event.id, 2, [
      { matchNumber: 3, homeSportEventParticipantId: context.duke.id, awaySportEventParticipantId: context.vermont.id },
    ])).rejects.toMatchObject({ code: 'BRACKET_INVALID', statusCode: 422 });
    expect(expectDefined(context.store.matchRows.find((match) => match.matchNumber === 3))).toMatchObject({
      homeSportEventParticipantId: null,
      awaySportEventParticipantId: null,
    });
  });
});
