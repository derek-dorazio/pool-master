import { expect } from '@jest/globals';
import { MatchSide, MatchStatus, ParticipantStandingStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { MatchResultService } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/match-result-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

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
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    matches: store.matchRepo(),
    newId: () => {
      sequence += 1;
      return `match-${sequence}`;
    },
  });
  if (sport === Sport.BASKETBALL) {
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

const homeWins = { winnerSide: MatchSide.HOME, homeScore: 80, awayScore: 70 };
const awayWins = { winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 80 };

describe('MatchResultService.recordResult', () => {
  it('completes the match with its winner and scores and puts the winner on its side of the next match', async () => {
    const { service, event, vermont } = await setup();

    const bracket = await service.recordResult(event.id, 1, awayWins);

    expect(bracket.find((match) => match.matchNumber === 1)).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 80 });
    expect(bracket.find((match) => match.matchNumber === 3)).toMatchObject({ homeSportEventParticipantId: vermont.id, awaySportEventParticipantId: null });
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
    ['a tie', { winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 70 }],
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
