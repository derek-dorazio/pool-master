import { expect, jest } from '@jest/globals';
import { MatchEnding, MatchPeriodLayout, MatchSide, MatchStatus, ParticipantStandingStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import type { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { MatchResultService, describeScoreProblem } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/match-result-service';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';

// The admin's match results against an in-memory store (#699): what a result saves (the winner,
// the next match's side, every team's standing), what it refuses, and the correction lock. The
// Prisma adapter's transaction is covered in sport-event-matches.integration.

const AS_OF = new Date('2027-03-19T04:00:00.000Z');

async function setup({ sport = Sport.BASKETBALL, status = SportEventStatus.IN_PROGRESS }: { sport?: Sport; status?: SportEventStatus } = {}) {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(sport);
  const event = store.addEvent({ sport, status: SportEventStatus.DRAFT, rounds: 2 });
  await store.roundRepo().createMany(event.id, [
    { roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-03-20T16:00:00.000Z') },
  ]);
  const [duke, vermont, houston, texas] = ['Duke', 'Vermont', 'Houston', 'Texas'].map((name, index) => {
    const team = store.addParticipant(sportRow.id, name, { participantType: 'TEAM' });
    return store.addToField(event.id, team.id, { seedNumber: index + 1 });
  });
  let sequence = 0;
  const brackets = new SportEventBracketService({
    sportEvents: store.sportEventRepo(),
    sportLeagues: store.sportLeagueRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    affiliations: store.affiliationRepo(),
    matches: store.matchRepo(),
    tiers: store.tierRepo(),
    valuations: store.valuationRepo(),
    ...NO_PICKS_ON_EVENT,
    newId: () => {
      sequence += 1;
      return `match-${sequence}`;
    },
  });
  if (sport === Sport.BASKETBALL || sport === Sport.AMERICAN_FOOTBALL || sport === Sport.SOCCER) {
    await brackets.loadBracket(event.id, [
      { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: duke.id, awaySportEventParticipantId: vermont.id, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.HOME } },
      { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: houston.id, awaySportEventParticipantId: texas.id, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.AWAY } },
      { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
    ]);
  }
  event.status = status;
  const service = new MatchResultService({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });
  const standingOf = (rowId: string) => store.standingRows.find((row) => row.sportEventParticipantId === rowId);
  return { store, service, event, duke, vermont, houston, texas, standingOf };
}

/** A released week of two games that form no bracket, as an NFL regular-season week is. */
async function week() {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(Sport.AMERICAN_FOOTBALL);
  const event = store.addEvent({ sport: Sport.AMERICAN_FOOTBALL, status: SportEventStatus.DRAFT, rounds: 1 });
  await store.roundRepo().createMany(event.id, [{ roundNumber: 1, scheduledDate: new Date('2027-09-12T17:00:00.000Z') }]);
  const [bills, jets, chiefs, raiders] = ['Bills', 'Jets', 'Chiefs', 'Raiders'].map((name) =>
    store.addToField(event.id, store.addParticipant(sportRow.id, name, { participantType: 'TEAM' }).id));
  let sequence = 0;
  await new SportEventBracketService({
    sportEvents: store.sportEventRepo(),
    sportLeagues: store.sportLeagueRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    affiliations: store.affiliationRepo(),
    matches: store.matchRepo(),
    tiers: store.tierRepo(),
    valuations: store.valuationRepo(),
    ...NO_PICKS_ON_EVENT,
    newId: () => {
      sequence += 1;
      return `game-${sequence}`;
    },
  }).loadBracket(event.id, [
    { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: bills.id, awaySportEventParticipantId: jets.id, isNeutralSite: false, scheduledDate: null, advancesTo: null },
    { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: chiefs.id, awaySportEventParticipantId: raiders.id, isNeutralSite: false, scheduledDate: null, advancesTo: null },
  ]);
  event.status = SportEventStatus.SCHEDULED;
  const service = new MatchResultService({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });
  const standingOf = (rowId: string) => store.standingRows.find((row) => row.sportEventParticipantId === rowId);
  return { store, service, event, bills, jets, chiefs, raiders, standingOf };
}

const homeWins = { winnerSide: MatchSide.HOME, homeScore: 80, awayScore: 70 };
const awayWins = { winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 80 };

describe('MatchResultService.recordResult', () => {
  it('completes the match with its winner and scores and puts the winner on its side of the next match', async () => {
    const { service, event, vermont } = await setup();

    const bracket = await service.recordResult(event.id, 1, awayWins);

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 80 });
    expect(bracket.find((match) => match.matchNumber === 3)).toMatchObject({ homeSportEventParticipantId: vermont.id, awaySportEventParticipantId: null });
  });

  it('asks the lifecycle to start the contests whose cutoff the result passed, with the service clock, on an event under way', async () => {
    const { store, event } = await setup();
    const activateContestsPastCutoff = jest.fn<EventLifecycleService['activateContestsPastCutoff']>(async () => undefined);
    const service = new MatchResultService({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), contestActivation: { activateContestsPastCutoff, settleContestsForFinishedGame: jest.fn<EventLifecycleService['settleContestsForFinishedGame']>(async () => undefined) }, now: () => AS_OF });

    await service.recordResult(event.id, 1, homeWins);

    expect(activateContestsPastCutoff).toHaveBeenCalledWith(expect.objectContaining({ id: event.id, status: SportEventStatus.IN_PROGRESS }), AS_OF);
  });

  it('starts no contest for a result on an event that is not under way', async () => {
    const { store, event } = await setup({ status: SportEventStatus.SCHEDULED });
    const activateContestsPastCutoff = jest.fn<EventLifecycleService['activateContestsPastCutoff']>(async () => undefined);
    const service = new MatchResultService({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), contestActivation: { activateContestsPastCutoff, settleContestsForFinishedGame: jest.fn<EventLifecycleService['settleContestsForFinishedGame']>(async () => undefined) }, now: () => AS_OF });

    await service.recordResult(event.id, 1, homeWins);

    expect(activateContestsPastCutoff).not.toHaveBeenCalled();
  });

  it('asks the lifecycle to settle the squares contests on the game once its result is in, whatever the event\'s status', async () => {
    const { store, event } = await setup({ status: SportEventStatus.SCHEDULED });
    const settleContestsForFinishedGame = jest.fn<EventLifecycleService['settleContestsForFinishedGame']>(async () => undefined);
    const service = new MatchResultService({
      sportEvents: store.sportEventRepo(),
      matches: store.matchRepo(),
      contestActivation: { activateContestsPastCutoff: jest.fn<EventLifecycleService['activateContestsPastCutoff']>(async () => undefined), settleContestsForFinishedGame },
      now: () => AS_OF,
    });

    await service.recordResult(event.id, 1, homeWins);

    expect(settleContestsForFinishedGame).toHaveBeenCalledWith(expect.objectContaining({ id: event.id }), 'match-1', AS_OF);
  });

  it('accepts a result with no scores', async () => {
    const { service, event } = await setup();

    const bracket = await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null });

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ status: MatchStatus.COMPLETED, homeScore: null, awayScore: null });
  });

  it('rewrites the standings: the winner ahead, the teams still to play tied behind it, the loser eliminated last, each at the latest round it has a match in', async () => {
    const context = await setup();

    await context.service.recordResult(context.event.id, 1, homeWins);

    expect(context.standingOf(context.duke.id)).toMatchObject({ position: 1, displayPosition: '1', status: ParticipantStandingStatus.ACTIVE, currentRound: 2, asOf: AS_OF });
    expect(context.standingOf(context.houston.id)).toMatchObject({ position: 2, displayPosition: 'T2', status: ParticipantStandingStatus.ACTIVE, currentRound: 1 });
    expect(context.standingOf(context.vermont.id)).toMatchObject({ position: 4, displayPosition: '4', status: ParticipantStandingStatus.ELIMINATED, currentRound: 1 });
  });

  it('ranks the champion first, the runner-up second and the teams out in the first round tied below them', async () => {
    const context = await setup();
    await context.service.recordResult(context.event.id, 1, homeWins);
    await context.service.recordResult(context.event.id, 2, awayWins);

    await context.service.recordResult(context.event.id, 3, awayWins);

    expect(context.standingOf(context.texas.id)).toMatchObject({ position: 1, displayPosition: '1', status: ParticipantStandingStatus.COMPLETE });
    expect(context.standingOf(context.duke.id)).toMatchObject({ position: 2, displayPosition: '2', status: ParticipantStandingStatus.ELIMINATED });
    expect(context.standingOf(context.vermont.id)).toMatchObject({ position: 3, displayPosition: 'T3' });
    expect(context.standingOf(context.houston.id)).toMatchObject({ position: 3, displayPosition: 'T3' });
  });

  it('changes a winner while the next match has no result, moving the new winner into its place', async () => {
    const { service, event, vermont } = await setup();
    await service.recordResult(event.id, 1, homeWins);

    const bracket = await service.recordResult(event.id, 1, awayWins);

    expect(bracket.find((match) => match.matchNumber === 3)?.homeSportEventParticipantId).toBe(vermont.id);
  });

  it('refuses (409 SPORT_EVENT_MATCH_RESULT_LOCKED) a new winner once the next match has a result, but still fixes the scores', async () => {
    const { service, event } = await setup();
    await service.recordResult(event.id, 1, homeWins);
    await service.recordResult(event.id, 2, homeWins);
    await service.recordResult(event.id, 3, homeWins);

    await expect(service.recordResult(event.id, 1, awayWins))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', statusCode: 409 });
    const bracket = await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 81, awayScore: 70 });
    expect(bracket.find((match) => match.matchNumber === 1)?.homeScore).toBe(81);
  });

  it.each([
    ['one score without the other', { winnerSide: MatchSide.HOME, homeScore: 80, awayScore: null }],
    ['the winner scoring less', { winnerSide: MatchSide.HOME, homeScore: 60, awayScore: 70 }],
    ['a winner on level scores', { winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 70 }],
    ['a tie in a bracket match, which always has a winner', { winnerSide: null, homeScore: 70, awayScore: 70 }],
  ])('refuses (422 MATCH_RESULT_INVALID) %s and saves nothing', async (_label, input) => {
    const { service, event, store } = await setup();

    await expect(service.recordResult(event.id, 1, input)).rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
    expect(store.standingRows).toEqual([]);
  });

  it('refuses (422 MATCH_SIDES_NOT_SET) a match still waiting for a team', async () => {
    const { service, event } = await setup();

    await expect(service.recordResult(event.id, 3, homeWins)).rejects.toMatchObject({ code: 'MATCH_SIDES_NOT_SET', statusCode: 422 });
  });

  it('refuses (404 BRACKET_MATCH_NOT_FOUND) a match number the bracket does not have', async () => {
    const { service, event } = await setup();

    await expect(service.recordResult(event.id, 9, homeWins)).rejects.toMatchObject({ code: 'BRACKET_MATCH_NOT_FOUND', statusCode: 404 });
  });

  it('refuses (409 SPORT_EVENT_NOT_RELEASED) a draft, whose pairings can still change', async () => {
    const { service, event } = await setup({ status: SportEventStatus.DRAFT });

    await expect(service.recordResult(event.id, 1, homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
  });

  it('refuses (422 SPORT_EVENT_NOT_BRACKET) an event whose sport is not played as a bracket, and 404 EVENT_NOT_FOUND an unknown event', async () => {
    const { service, event } = await setup({ sport: Sport.GOLF });

    await expect(service.recordResult(event.id, 1, homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_BRACKET', statusCode: 422 });
    await expect(service.recordResult('no-such-event', 1, homeWins)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

// #772 review: quarter scores belong to the two teams playing, so a game with any is under way.
describe('MatchResultService once the next game has quarter scores', () => {
  async function scoredFinal() {
    const context = await setup({ sport: Sport.AMERICAN_FOOTBALL });
    await context.service.recordResult(context.event.id, 1, homeWins);
    await context.service.recordResult(context.event.id, 2, homeWins);
    await context.service.recordPeriodScore(context.event.id, 3, 1, { homeScore: 7, awayScore: 3 });
    return context;
  }

  it('refuses (409 SPORT_EVENT_MATCH_RESULT_LOCKED) a new winner for a game whose winner is playing a game with quarter scores', async () => {
    const { service, event } = await scoredFinal();

    await expect(service.recordResult(event.id, 1, awayWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', statusCode: 409 });
  });

  it('refuses (409 SPORT_EVENT_MATCH_RESULT_LOCKED) clearing the result of a game whose winner is playing a game with quarter scores', async () => {
    const { service, event } = await scoredFinal();

    await expect(service.clearResult(event.id, 2)).rejects.toMatchObject({ code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', statusCode: 409 });
  });
});

describe('MatchResultService shoot-outs (#791)', () => {
  it('saves a soccer bracket match level after extra time with its shoot-out, the shoot-out\'s winner moving on', async () => {
    const { service, event, vermont } = await setup({ sport: Sport.SOCCER });

    const bracket = await service.recordResult(event.id, 1, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4 });

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({
      status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4,
    });
    expect(bracket.find((match) => match.matchNumber === 3)?.homeSportEventParticipantId).toBe(vermont.id);
  });

  it('refuses (422 MATCH_RESULT_INVALID) a soccer bracket match left level with no shoot-out', async () => {
    const { service, event } = await setup({ sport: Sport.SOCCER });

    await expect(service.recordResult(event.id, 1, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1 }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
  });

  it('refuses (422 MATCH_RESULT_INVALID) shoot-out scores in a sport whose knockouts never end level, and saves nothing', async () => {
    const { service, event, store } = await setup();

    await expect(service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 70, homeShootoutScore: 4, awayShootoutScore: 3 }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('saves a result sent without shoot-out scores as having no shoot-out', async () => {
    const { service, event } = await setup();

    const bracket = await service.recordResult(event.id, 1, homeWins);

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ homeShootoutScore: null, awayShootoutScore: null });
  });

  it('clears a match\'s shoot-out with its result', async () => {
    const { service, event, store } = await setup();
    await service.recordResult(event.id, 1, homeWins);
    Object.assign(store.matchRows[0], { homeShootoutScore: 4, awayShootoutScore: 3 });

    const bracket = await service.clearResult(event.id, 1);

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ status: MatchStatus.SCHEDULED, homeShootoutScore: null, awayShootoutScore: null });
  });
});

describe('describeScoreProblem with shoot-outs (#791)', () => {
  // A test-only sport rule: no sport settles a level knockout by shoot-out until soccer.
  const penalties = { inBracket: true, shootout: { label: 'pens' } };
  const level = { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1 };
  const kicks = (homeShootoutScore: number | null, awayShootoutScore: number | null) => ({ homeShootoutScore, awayShootoutScore });

  it('accepts a level bracket match whose winner has the higher shoot-out score', () => {
    expect(describeScoreProblem(level, kicks(3, 4), penalties)).toBeNull();
    expect(describeScoreProblem({ ...level, winnerSide: MatchSide.HOME }, kicks(5, 4), penalties)).toBeNull();
  });

  it('accepts a decided match with no shoot-out, and a winner with no scores at all', () => {
    expect(describeScoreProblem({ winnerSide: MatchSide.HOME, homeScore: 2, awayScore: 1 }, kicks(null, null), penalties)).toBeNull();
    expect(describeScoreProblem({ winnerSide: MatchSide.HOME, homeScore: null, awayScore: null }, kicks(null, null), penalties)).toBeNull();
  });

  it.each([
    ['a level score with no shoot-out', level, kicks(null, null), 'a level score needs both shoot-out scores'],
    ['a level score with one shoot-out score', level, kicks(null, 4), 'a level score needs both shoot-out scores'],
    ['a winner who lost the shoot-out', level, kicks(4, 3), 'the winner\'s shoot-out score must be higher than the loser\'s'],
    ['a shoot-out after a decided score', { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 2 }, kicks(3, 4), 'a shoot-out is only held after a level score'],
    ['a shoot-out with no match score', { winnerSide: MatchSide.AWAY, homeScore: null, awayScore: null }, kicks(3, 4), 'a shoot-out needs the score after extra time, level'],
  ])('refuses %s in a bracket of a sport settled by shoot-out', (_label, result, shootout, problem) => {
    expect(describeScoreProblem(result, shootout, penalties)).toBe(problem);
  });

  it('refuses a shoot-out, and a level score, on a week of games that forms no bracket', () => {
    const week = { ...penalties, inBracket: false };

    expect(describeScoreProblem(level, kicks(3, 4), week)).toBe('only a bracket match is settled by a shoot-out');
    expect(describeScoreProblem(level, kicks(null, null), week)).toBe('the winner\'s score must be higher than the loser\'s');
  });

  it('refuses a shoot-out, and a level score, in a sport without shoot-outs', () => {
    const noShootouts = { inBracket: true, shootout: null };

    expect(describeScoreProblem(level, kicks(3, 4), noShootouts)).toBe('this sport has no shoot-outs');
    expect(describeScoreProblem(level, kicks(null, null), noShootouts)).toBe('the winner\'s score must be higher than the loser\'s');
  });
});

describe('MatchResultService matches that ended early (#704)', () => {
  it('saves a retirement whose winner trailed when it stopped, sends the winner on and puts the player who retired out', async () => {
    const { service, event, duke, vermont, standingOf } = await setup();

    const bracket = await service.recordResult(event.id, 1, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 0, ending: MatchEnding.RETIREMENT });

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 0, ending: MatchEnding.RETIREMENT });
    expect(bracket.find((match) => match.matchNumber === 3)?.homeSportEventParticipantId).toBe(vermont.id);
    expect(standingOf(duke.id)).toMatchObject({ status: ParticipantStandingStatus.ELIMINATED });
  });

  it('saves a walkover with no score as a full win that sends its winner on', async () => {
    const { service, event, duke } = await setup();

    const bracket = await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER });

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER });
    expect(bracket.find((match) => match.matchNumber === 3)?.homeSportEventParticipantId).toBe(duke.id);
  });

  it('saves a result sent without an ending as played to its end', async () => {
    const { service, event } = await setup();

    const bracket = await service.recordResult(event.id, 1, homeWins);

    expect(bracket.find((match) => match.matchNumber === 1)?.ending).toBe(MatchEnding.PLAYED);
  });

  it('puts a match back to played when a result that ended early is re-sent without an ending, and when it is cleared', async () => {
    const { service, event } = await setup();
    await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.DEFAULT });

    const resent = await service.recordResult(event.id, 1, homeWins);
    await service.recordResult(event.id, 2, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER });
    const cleared = await service.clearResult(event.id, 2);

    expect(resent.find((match) => match.matchNumber === 1)?.ending).toBe(MatchEnding.PLAYED);
    expect(cleared.find((match) => match.matchNumber === 2)).toMatchObject({ status: MatchStatus.SCHEDULED, ending: MatchEnding.PLAYED });
  });

  it('refuses (422 MATCH_RESULT_INVALID) a walkover with a score, and saves nothing', async () => {
    const { service, event, store } = await setup();

    await expect(service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 1, awayScore: 0, ending: MatchEnding.WALKOVER }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('refuses (422 MATCH_RESULT_INVALID) a walkover for a game that already has quarter scores', async () => {
    const { service, event } = await setup({ sport: Sport.AMERICAN_FOOTBALL });
    await service.recordPeriodScore(event.id, 1, 1, { homeScore: 7, awayScore: 0 });

    await expect(service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
  });

  it('refuses (422 MATCH_PERIOD_SCORE_INVALID) a quarter score for a game that was a walkover', async () => {
    const { service, event } = await setup({ sport: Sport.AMERICAN_FOOTBALL });
    await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER });

    await expect(service.recordPeriodScore(event.id, 1, 1, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'MATCH_PERIOD_SCORE_INVALID', statusCode: 422 });
  });
});

describe('describeScoreProblem for matches that ended early (#704)', () => {
  const bracket = { inBracket: true, shootout: null };
  const noKicks = { homeShootoutScore: null, awayShootoutScore: null };

  it.each([MatchEnding.RETIREMENT, MatchEnding.DEFAULT])('accepts a %s whose winner\'s score is lower, level or missing', (ending) => {
    expect(describeScoreProblem({ winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 1, ending }, noKicks, bracket)).toBeNull();
    expect(describeScoreProblem({ winnerSide: MatchSide.HOME, homeScore: 1, awayScore: 1, ending }, noKicks, bracket)).toBeNull();
    expect(describeScoreProblem({ winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending }, noKicks, bracket)).toBeNull();
  });

  it('still refuses a played match whose winner\'s score is lower', () => {
    expect(describeScoreProblem({ winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 1, ending: MatchEnding.PLAYED }, noKicks, bracket))
      .toBe('the winner\'s score must be higher than the loser\'s');
  });

  it.each([
    ['a retirement with one score', { winnerSide: MatchSide.HOME, homeScore: 1, awayScore: null, ending: MatchEnding.RETIREMENT }, noKicks, bracket, 'give both scores or neither'],
    ['a walkover with scores', { winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 0, ending: MatchEnding.WALKOVER }, noKicks, bracket, 'a walkover has no score'],
    ['a tie that ended early', { winnerSide: null, homeScore: 1, awayScore: 1, ending: MatchEnding.RETIREMENT }, noKicks, { inBracket: false, shootout: null }, 'a tie is played to its end'],
    ['a shoot-out after a retirement', { winnerSide: MatchSide.HOME, homeScore: 1, awayScore: 1, ending: MatchEnding.RETIREMENT }, { homeShootoutScore: 4, awayShootoutScore: 3 }, { inBracket: true, shootout: { label: 'pens' } }, 'a match that ended early has no shoot-out'],
  ])('refuses %s', (_label, result, shootout, rules, problem) => {
    expect(describeScoreProblem(result, shootout, rules)).toBe(problem);
  });
});

describe('MatchResultService.clearResult', () => {
  it('schedules the match again, empties the side its winner filled and restores the loser\'s standing', async () => {
    const context = await setup();
    await context.service.recordResult(context.event.id, 1, homeWins);

    const bracket = await context.service.clearResult(context.event.id, 1);

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null });
    expect(bracket.find((match) => match.matchNumber === 3)?.homeSportEventParticipantId).toBeNull();
    expect(context.standingOf(context.vermont.id)).toMatchObject({ status: ParticipantStandingStatus.ACTIVE, position: 1 });
  });

  it('changes nothing for a match with no result', async () => {
    const { service, event, store } = await setup();

    await service.clearResult(event.id, 1);

    expect(store.standingRows).toEqual([]);
  });

  it('refuses (409 SPORT_EVENT_MATCH_RESULT_LOCKED) once the next match has a result', async () => {
    const { service, event } = await setup();
    await service.recordResult(event.id, 1, homeWins);
    await service.recordResult(event.id, 2, homeWins);
    await service.recordResult(event.id, 3, homeWins);

    await expect(service.clearResult(event.id, 2)).rejects.toMatchObject({ code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', statusCode: 409 });
  });
});

// #715: a postponed regular-season game is cancelled in its week and added to the week it moves to.
describe('MatchResultService.cancelMatch', () => {
  it('cancels a game of a released week that has not been played, leaving the week\'s other game as it was', async () => {
    const { service, event } = await week();

    const games = await service.cancelMatch(event.id, 1);

    expect(games.map((game) => [game.matchNumber, game.status, game.winnerSide])).toEqual([
      [1, MatchStatus.CANCELLED, null],
      [2, MatchStatus.SCHEDULED, null],
    ]);
  });

  it('changes nothing when the game is already cancelled', async () => {
    const { service, event } = await week();
    await service.cancelMatch(event.id, 1);

    const games = await service.cancelMatch(event.id, 1);

    expect(games.find((game) => game.matchNumber === 1)?.status).toBe(MatchStatus.CANCELLED);
  });

  it('refuses (409 MATCH_ALREADY_PLAYED) a game with a result: its result is cleared first', async () => {
    const { service, event } = await week();
    await service.recordResult(event.id, 1, homeWins);

    await expect(service.cancelMatch(event.id, 1)).rejects.toMatchObject({ code: 'MATCH_ALREADY_PLAYED', statusCode: 409 });
  });

  it('refuses (422 MATCH_IN_BRACKET) a bracket game, which sends its winner on or takes a team from an earlier game', async () => {
    const { service, event } = await setup();

    await expect(service.cancelMatch(event.id, 1)).rejects.toMatchObject({ code: 'MATCH_IN_BRACKET', statusCode: 422 });
    await expect(service.cancelMatch(event.id, 3)).rejects.toMatchObject({ code: 'MATCH_IN_BRACKET', statusCode: 422 });
  });

  it('refuses (409 SPORT_EVENT_NOT_RELEASED) a game of a draft week, whose games are still edited freely', async () => {
    const { service, event } = await week();
    event.status = SportEventStatus.DRAFT;

    await expect(service.cancelMatch(event.id, 1)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
  });
});

// #772: the score at the end of each quarter but the last, as the scoreboard shows it. The final
// score, overtime included, is the game's result.
describe('MatchResultService period scores', () => {
  it('saves the score at the end of a quarter while the game is played, keeping the quarters in order', async () => {
    const { service, event } = await week();

    await service.recordPeriodScore(event.id, 1, 2, { homeScore: 10, awayScore: 7 });
    const games = await service.recordPeriodScore(event.id, 1, 1, { homeScore: 3, awayScore: 0 });

    expect(games.find((game) => game.matchNumber === 1)?.periodScores).toEqual([
      { periodNumber: 1, homeScore: 3, awayScore: 0 },
      { periodNumber: 2, homeScore: 10, awayScore: 7 },
    ]);
    expect(games.find((game) => game.matchNumber === 2)?.periodScores).toEqual([]);
  });

  it('replaces a quarter\'s score when it is entered again, and corrects it after the game is final', async () => {
    const { service, event } = await week();
    await service.recordPeriodScore(event.id, 1, 3, { homeScore: 14, awayScore: 3 });
    await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 24, awayScore: 10 });

    const games = await service.recordPeriodScore(event.id, 1, 3, { homeScore: 17, awayScore: 3 });

    expect(games.find((game) => game.matchNumber === 1)?.periodScores).toEqual([{ periodNumber: 3, homeScore: 17, awayScore: 3 }]);
  });

  it('asks the lifecycle to settle the squares contests on a finished game when a quarter\'s score is entered after its result, and not before it', async () => {
    const { store, event } = await week();
    const settleContestsForFinishedGame = jest.fn<EventLifecycleService['settleContestsForFinishedGame']>(async () => undefined);
    const service = new MatchResultService({
      sportEvents: store.sportEventRepo(),
      matches: store.matchRepo(),
      contestActivation: { activateContestsPastCutoff: jest.fn<EventLifecycleService['activateContestsPastCutoff']>(async () => undefined), settleContestsForFinishedGame },
      now: () => AS_OF,
    });
    await service.recordPeriodScore(event.id, 1, 1, { homeScore: 7, awayScore: 0 });
    expect(settleContestsForFinishedGame).not.toHaveBeenCalled();
    await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 24, awayScore: 10 });
    settleContestsForFinishedGame.mockClear();

    await service.recordPeriodScore(event.id, 1, 3, { homeScore: 17, awayScore: 3 });

    expect(settleContestsForFinishedGame).toHaveBeenCalledWith(expect.objectContaining({ id: event.id }), 'game-1', AS_OF);
  });

  it('clears a quarter\'s score, and changes nothing for a quarter not entered', async () => {
    const { service, event } = await week();
    await service.recordPeriodScore(event.id, 1, 1, { homeScore: 7, awayScore: 0 });

    await service.clearPeriodScore(event.id, 1, 2);
    const games = await service.clearPeriodScore(event.id, 1, 1);

    expect(games.find((game) => game.matchNumber === 1)?.periodScores).toEqual([]);
  });

  it('refuses (422 MATCH_PERIOD_SCORE_INVALID) a score below an earlier quarter\'s or above a later quarter\'s or the final score', async () => {
    const { service, event } = await week();
    await service.recordPeriodScore(event.id, 1, 1, { homeScore: 7, awayScore: 3 });
    await service.recordPeriodScore(event.id, 1, 3, { homeScore: 14, awayScore: 10 });
    const refused = { code: 'MATCH_PERIOD_SCORE_INVALID', statusCode: 422 };

    await expect(service.recordPeriodScore(event.id, 1, 2, { homeScore: 7, awayScore: 0 })).rejects.toMatchObject(refused);
    await expect(service.recordPeriodScore(event.id, 1, 2, { homeScore: 17, awayScore: 3 })).rejects.toMatchObject(refused);
    await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 21, awayScore: 10 });
    await expect(service.recordPeriodScore(event.id, 1, 3, { homeScore: 24, awayScore: 10 })).rejects.toMatchObject(refused);
  });

  it('refuses (422 MATCH_RESULT_INVALID) a final score below a side\'s score at the end of a quarter', async () => {
    const { service, event } = await week();
    await service.recordPeriodScore(event.id, 1, 3, { homeScore: 14, awayScore: 10 });

    await expect(service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 13, awayScore: 10 }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
  });

  it('refuses (422 MATCH_PERIOD_INVALID) the last quarter, whose score is the final result, and the last half of a league that plays halves', async () => {
    const football = await week();
    await expect(football.service.recordPeriodScore(football.event.id, 1, 4, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'MATCH_PERIOD_INVALID', statusCode: 422 });

    const college = await setup();
    college.event.matchPeriodLayout = MatchPeriodLayout.HALVES;
    await college.service.recordPeriodScore(college.event.id, 1, 1, { homeScore: 40, awayScore: 38 });
    await expect(college.service.recordPeriodScore(college.event.id, 1, 2, { homeScore: 70, awayScore: 66 }))
      .rejects.toMatchObject({ code: 'MATCH_PERIOD_INVALID', statusCode: 422 });

    const quarters = await setup();
    await quarters.service.recordPeriodScore(quarters.event.id, 1, 3, { homeScore: 60, awayScore: 58 });
  });

  it('refuses (409 MATCH_CANCELLED) a cancelled game, and (409 SPORT_EVENT_NOT_RELEASED) a game of a draft week', async () => {
    const { service, event } = await week();
    await service.cancelMatch(event.id, 2);
    await expect(service.recordPeriodScore(event.id, 2, 1, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'MATCH_CANCELLED', statusCode: 409 });

    event.status = SportEventStatus.DRAFT;
    await expect(service.recordPeriodScore(event.id, 1, 1, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
  });
});

describe('MatchResultService on a week of games that form no bracket', () => {
  it('ranks no team on a week\'s result: both teams of the played game COMPLETE with no place, the teams still to play ACTIVE', async () => {
    const { service, event, bills, jets, chiefs, raiders, standingOf } = await week();

    await service.recordResult(event.id, 1, homeWins);

    for (const team of [bills, jets]) {
      expect(standingOf(team.id)).toMatchObject({ position: null, displayPosition: null, status: ParticipantStandingStatus.COMPLETE, currentRound: 1 });
    }
    for (const team of [chiefs, raiders]) {
      expect(standingOf(team.id)).toMatchObject({ position: null, displayPosition: null, status: ParticipantStandingStatus.ACTIVE, currentRound: 1 });
    }
  });

  it('crowns no champion once every game of the week is played', async () => {
    const { service, event, bills, jets, chiefs, raiders, standingOf } = await week();

    await service.recordResult(event.id, 1, homeWins);
    await service.recordResult(event.id, 2, awayWins);

    expect([bills, jets, chiefs, raiders].map((team) => standingOf(team.id)?.position ?? null)).toEqual([null, null, null, null]);
  });

  it('puts a cleared game\'s teams back to ACTIVE', async () => {
    const { service, event, bills, jets, standingOf } = await week();
    await service.recordResult(event.id, 1, homeWins);

    await service.clearResult(event.id, 1);

    expect([standingOf(bills.id)?.status, standingOf(jets.id)?.status]).toEqual([ParticipantStandingStatus.ACTIVE, ParticipantStandingStatus.ACTIVE]);
  });

  it('records a tie (#792): the game COMPLETED with no winner and its level scores, both teams COMPLETE with no place', async () => {
    const { service, event, bills, jets, standingOf } = await week();

    const games = await service.recordResult(event.id, 1, { winnerSide: null, homeScore: 20, awayScore: 20 });

    expect(games.find((game) => game.matchNumber === 1)).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: null, homeScore: 20, awayScore: 20 });
    for (const team of [bills, jets]) {
      expect(standingOf(team.id)).toMatchObject({ position: null, status: ParticipantStandingStatus.COMPLETE });
    }
  });

  it('changes a tie to a win and back, since a week\'s game sends nobody on', async () => {
    const { service, event } = await week();
    await service.recordResult(event.id, 1, { winnerSide: null, homeScore: 20, awayScore: 20 });

    await service.recordResult(event.id, 1, { winnerSide: MatchSide.HOME, homeScore: 23, awayScore: 20 });
    const games = await service.recordResult(event.id, 1, { winnerSide: null, homeScore: 23, awayScore: 23 });

    expect(games.find((game) => game.matchNumber === 1)).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: null, homeScore: 23, awayScore: 23 });
  });

  it.each([
    ['without its scores', { winnerSide: null, homeScore: null, awayScore: null }],
    ['with one score only', { winnerSide: null, homeScore: 20, awayScore: null }],
    ['with scores that are not level', { winnerSide: null, homeScore: 21, awayScore: 20 }],
  ])('refuses (422 MATCH_RESULT_INVALID) a tie %s and saves nothing', async (_label, input) => {
    const { service, event, store } = await week();

    await expect(service.recordResult(event.id, 1, input)).rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('marks a cancelled game\'s teams COMPLETE with no place, since their week is over', async () => {
    const { service, event, bills, jets, standingOf } = await week();

    await service.cancelMatch(event.id, 1);

    for (const team of [bills, jets]) {
      expect(standingOf(team.id)).toMatchObject({ position: null, displayPosition: null, status: ParticipantStandingStatus.COMPLETE });
    }
  });
});

describe('MatchResultService on a reseeded bracket', () => {
  // Seeds 1 and 2 on byes; the first-round games (3 v 6, 4 v 5) link nowhere, so the admin places
  // their winners into the second round by seed.
  // Matches are numbered in round order unless `finalFirst`, which numbers the final 1 and the
  // first round 3 and 4: nothing makes a bracket number its rounds in order.
  async function reseeded({ finalFirst = false }: { finalFirst?: boolean } = {}) {
    const store = new InMemorySportEvents();
    const sportRow = store.addSport(Sport.BASKETBALL);
    const event = store.addEvent({ sport: Sport.BASKETBALL, status: SportEventStatus.IN_PROGRESS, rounds: 3 });
    const [one, two, three, four, five, six] = [1, 2, 3, 4, 5, 6].map((seed) => {
      const team = store.addParticipant(sportRow.id, `Seed ${seed}`, { participantType: 'TEAM' });
      return store.addToField(event.id, team.id, { seedNumber: seed });
    });
    const match = (matchNumber: number, roundNumber: number, home: string | null, away: string | null, advancesTo: [string, MatchSide] | null) => ({
      id: `m${matchNumber}`, sportEventId: event.id, roundNumber, matchNumber,
      homeSportEventParticipantId: home, awaySportEventParticipantId: away, isNeutralSite: false,
      scheduledDate: null, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED,
      advancesToMatchId: advancesTo?.[0] ?? null, advancesToSide: advancesTo?.[1] ?? null, regionLabel: null, homeSpread: null, periodScores: [],
      createdAt: AS_OF, updatedAt: AS_OF,
    });
    const [first, second, third, fourth, final] = finalFirst ? [3, 4, 5, 2, 1] : [1, 2, 3, 4, 5];
    store.matchRows.push(
      match(first, 1, three.id, six.id, null),
      match(second, 1, four.id, five.id, null),
      match(third, 2, one.id, null, [`m${final}`, MatchSide.HOME]),
      match(fourth, 2, two.id, null, [`m${final}`, MatchSide.AWAY]),
      match(final, 3, null, null, null),
    );
    store.matchRows.sort((left, right) => left.matchNumber - right.matchNumber);
    const service = new MatchResultService({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });
    const standingOf = (rowId: string) => store.standingRows.find((row) => row.sportEventParticipantId === rowId);
    const matchOf = (matchNumber: number) => expectMatch(store.matchRows.find((row) => row.matchNumber === matchNumber));
    return { store, service, event, one, two, three, four, five, six, standingOf, matchOf };
  }

  function expectMatch<T>(value: T | undefined): T {
    if (value === undefined) throw new Error('no such match');
    return value;
  }

  it('leaves a first-round winner unplaced but counts it into the next round, still alive', async () => {
    const { service, event, six, three, standingOf, matchOf } = await reseeded();

    await service.recordResult(event.id, 1, awayWins);

    expect([matchOf(3).awaySportEventParticipantId, matchOf(4).awaySportEventParticipantId]).toEqual([null, null]);
    expect(standingOf(six.id)).toMatchObject({ status: ParticipantStandingStatus.ACTIVE, currentRound: 2 });
    expect(standingOf(three.id)).toMatchObject({ status: ParticipantStandingStatus.ELIMINATED, currentRound: 1 });
  });

  it('swaps the placed team when a first-round winner changes before the next round is played', async () => {
    const { service, event, three, six, matchOf } = await reseeded();
    await service.recordResult(event.id, 1, awayWins);
    matchOf(3).awaySportEventParticipantId = six.id;

    await service.recordResult(event.id, 1, homeWins);

    expect(matchOf(3).awaySportEventParticipantId).toBe(three.id);
  });

  it('empties the placed team\'s side when its first-round result is cleared', async () => {
    const { service, event, six, matchOf } = await reseeded();
    await service.recordResult(event.id, 1, awayWins);
    matchOf(3).awaySportEventParticipantId = six.id;

    await service.clearResult(event.id, 1);

    expect(matchOf(3).awaySportEventParticipantId).toBeNull();
  });

  it('refuses (409 SPORT_EVENT_MATCH_RESULT_LOCKED) a new first-round winner once the match it was placed in has a result', async () => {
    const { service, event, six, matchOf } = await reseeded();
    await service.recordResult(event.id, 1, awayWins);
    matchOf(3).awaySportEventParticipantId = six.id;
    await service.recordResult(event.id, 3, homeWins);

    await expect(service.recordResult(event.id, 1, homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', statusCode: 409 });
  });

  it('refuses (409 SPORT_EVENT_MATCH_RESULT_LOCKED) a new first-round winner once its next-round game is played, even when the final is numbered first', async () => {
    const { service, event, six, matchOf } = await reseeded({ finalFirst: true });
    await service.recordResult(event.id, 3, awayWins);
    matchOf(5).awaySportEventParticipantId = six.id;
    await service.recordResult(event.id, 5, awayWins);
    expect(matchOf(1).homeSportEventParticipantId).toBe(six.id);

    await expect(service.recordResult(event.id, 3, homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', statusCode: 409 });
    expect([matchOf(5).awaySportEventParticipantId, matchOf(1).homeSportEventParticipantId]).toEqual([six.id, six.id]);
  });

  it('crowns the winner of the one match in the last round, not a first-round winner that links nowhere', async () => {
    const { service, event, one, two, six, five, standingOf, matchOf } = await reseeded();
    await service.recordResult(event.id, 1, awayWins);
    await service.recordResult(event.id, 2, awayWins);
    Object.assign(matchOf(3), { awaySportEventParticipantId: six.id });
    Object.assign(matchOf(4), { awaySportEventParticipantId: five.id });
    await service.recordResult(event.id, 3, homeWins);
    await service.recordResult(event.id, 4, homeWins);

    await service.recordResult(event.id, 5, awayWins);

    expect(standingOf(two.id)).toMatchObject({ position: 1, status: ParticipantStandingStatus.COMPLETE });
    expect(standingOf(one.id)).toMatchObject({ position: 2, status: ParticipantStandingStatus.ELIMINATED });
    expect(standingOf(six.id)?.status).toBe(ParticipantStandingStatus.ELIMINATED);
  });
});
