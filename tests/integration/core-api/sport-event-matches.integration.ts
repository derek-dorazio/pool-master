import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { BackgroundJobType, HomeAway, JobTrigger, MatchEnding, MatchSideOutcome, MatchStatus, PeriodKind, Sport, gameNumbered, matchSpread, shootoutScoreOf, sideParticipantId, gameScoreOf } from '@poolmaster/shared/domain';
import type { SportEventRoundMatch } from '@poolmaster/shared/domain';
import type { MatchResultWrite, MatchSideWrite, SportEventRoundMatchWrite } from '@poolmaster/shared/db';
import { expectDefined } from '../../support/expect-defined';
import {
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withBackgroundJobsFailing,
} from '../helpers';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportRowKeys } from '../../support/sport-rows';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';

// An event's bracket against real Postgres (#698): the match port's one read and its writes, what
// removing a field row or the event does to it, and every database check the
// migration adds to sport_event_round_matches. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

function repos() {
  return {
    events: new PrismaSportEventRepository(getAppPrisma()),
    rounds: new PrismaSportEventRoundRepository(getAppPrisma()),
    field: new PrismaSportEventParticipantRepository(getAppPrisma()),
    matches: new PrismaSportEventRoundMatchRepository(getAppPrisma()),
  };
}

/** A two-round basketball event with a field of four teams. */
async function createBracketEvent() {
  const prisma = getPrisma();
  // The integration cleanup empties sport leagues no template names, so the basketball rows are set up here.
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, ...sportRowKeys(Sport.BASKETBALL), tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NCAA Men\'s Basketball' } },
    create: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: 'NCAA Men\'s Basketball' },
    update: {},
  });
  const { events, rounds, field } = repos();
  const event = await createSportEventRow(events, {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2027),
    name: 'NCAA Tournament',
    startDate: new Date('2027-03-18T16:00:00.000Z'),
    status: 'DRAFT',
    rounds: 2,
    autoLifecycleEnabled: true,
  });
  await createRoundRows(getPrisma(), rounds, event, [
    { roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-03-20T16:00:00.000Z') },
  ]);
  const teams = await Promise.all(['Duke', 'Vermont', 'Houston', 'Texas'].map((name) => prisma.participant.create({
    data: { sportLeagueId: sportLeague.id, name, participantType: 'TEAM' },
  })));
  await field.createMany(event.id, teams.map((team, index) => ({ participantId: team.id, seedNumber: index + 1 })));
  const entries = await field.findBySportEvent(event.id);
  const entryOf = (name: string) => expectDefined(entries.find((entry) => entry.participantId === teams.find((team) => team.name === name)?.id), name);
  return { event, sport, sportLeague, entries, entryOf };
}

/** A neutral-site match's two sides: side 1 then side 2, each with its team or none yet. */
function neutralSides(sideOne: string | null, sideTwo: string | null): MatchSideWrite[] {
  return [
    { sideNumber: 1, sportEventParticipantId: sideOne, homeAway: HomeAway.NONE },
    { sideNumber: 2, sportEventParticipantId: sideTwo, homeAway: HomeAway.NONE },
  ];
}

/** Two semifinals feeding a final, with ids chosen up front so the links can name them. */
function fourTeamBracket(entryOf: (name: string) => { id: string }): SportEventRoundMatchWrite[] {
  const finalId = randomUUID();
  return [
    { id: randomUUID(), roundNumber: 1, matchNumber: 1, sides: neutralSides(entryOf('Vermont').id, entryOf('Duke').id), isNeutralSite: true, scheduledDate: new Date('2027-03-18T19:10:00.000Z'), advancesToMatchId: finalId, advancesToSideNumber: 2, regionLabel: null },
    { id: randomUUID(), roundNumber: 1, matchNumber: 2, sides: neutralSides(entryOf('Texas').id, entryOf('Houston').id), isNeutralSite: true, scheduledDate: null, advancesToMatchId: finalId, advancesToSideNumber: 1, regionLabel: null },
    { id: finalId, roundNumber: 2, matchNumber: 3, sides: neutralSides(null, null), isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null },
  ];
}

/** The match's Game 1, which every loaded match has. */
function gameOneOf(match: SportEventRoundMatch) {
  return expectDefined(gameNumbered(match, 1), `Game 1 of match ${match.matchNumber}`);
}

/** Each side's own points per period of Game 1, as the read gives them. */
function periodScoresOf(match: SportEventRoundMatch) {
  return gameOneOf(match).sideResults.map((result) => ({ sideNumber: result.sideNumber, periodScores: result.periodScores }));
}

/** Each side's period of play, side 1's then side 2's points. */
function regularPeriods(periods: readonly [number, number, number][]) {
  return [1, 2].map((sideNumber) => ({
    sideNumber,
    periodScores: periods.map(([periodNumber, sideOne, sideTwo]) => ({ kind: PeriodKind.REGULAR, periodNumber, score: sideNumber === 1 ? sideOne : sideTwo })),
  }));
}

/** When a test's results were recorded. */
const RECORDED_AT = new Date('2027-03-19T05:00:00.000Z');

interface ResultRequest {
  status?: MatchStatus;
  /** Side 1's outcome then side 2's. */
  outcomes: [MatchSideOutcome, MatchSideOutcome];
  /** Side 1's score then side 2's in Game 1, or null to leave the Games as they are. */
  scores: [number | null, number | null] | null;
  shootout?: [number, number];
  ending?: MatchEnding;
}

/** A single-game match's result, written to its Game 1. */
function resultOf(match: SportEventRoundMatch, { status = MatchStatus.COMPLETED, outcomes, scores, shootout, ending = MatchEnding.PLAYED }: ResultRequest): MatchResultWrite {
  return {
    id: match.id,
    status,
    ending,
    completedAt: status === MatchStatus.COMPLETED ? RECORDED_AT : null,
    outcomes: outcomes.map((outcome, index) => ({ sideNumber: index + 1, outcome })),
    gameOne: scores === null ? null : {
      gameId: gameOneOf(match).id,
      scores: scores.map((score, index) => ({ sideNumber: index + 1, score, shootoutScore: shootout?.[index] ?? null })),
    },
  };
}

/** The result cleared: SCHEDULED, both sides PENDING, Game 1 unscored. */
function clearedResultOf(match: SportEventRoundMatch): MatchResultWrite {
  return resultOf(match, { status: MatchStatus.SCHEDULED, outcomes: [MatchSideOutcome.PENDING, MatchSideOutcome.PENDING], scores: [null, null] });
}

const SIDE_TWO_WINS: [MatchSideOutcome, MatchSideOutcome] = [MatchSideOutcome.LOST, MatchSideOutcome.WON];
const SIDE_ONE_WINS: [MatchSideOutcome, MatchSideOutcome] = [MatchSideOutcome.WON, MatchSideOutcome.LOST];

describe('PrismaSportEventRoundMatchRepository', () => {
  it('loads a bracket in one write and reads it back in match order with each match\'s round number and where its winner goes', async () => {
    const { event, entryOf } = await createBracketEvent();
    const bracket = fourTeamBracket(entryOf);

    await repos().matches.replaceBracket(event.id, [...bracket].reverse());
    const matches = await repos().matches.findBySportEvent(event.id);

    expect(matches.map((match) => ({
      matchNumber: match.matchNumber,
      roundNumber: match.roundNumber,
      advancesToMatchId: match.advancesToMatchId,
      advancesToSideNumber: match.advancesToSideNumber,
      status: match.status,
    }))).toEqual([
      { matchNumber: 1, roundNumber: 1, advancesToMatchId: bracket[2].id, advancesToSideNumber: 2, status: MatchStatus.SCHEDULED },
      { matchNumber: 2, roundNumber: 1, advancesToMatchId: bracket[2].id, advancesToSideNumber: 1, status: MatchStatus.SCHEDULED },
      { matchNumber: 3, roundNumber: 2, advancesToMatchId: null, advancesToSideNumber: null, status: MatchStatus.SCHEDULED },
    ]);
    expect(matches[0]).toMatchObject({ scheduledDate: new Date('2027-03-18T19:10:00.000Z') });
    expect(matches[0].sides.map((side) => [side.sideNumber, side.sportEventParticipantId, side.outcome, side.spread])).toEqual([
      [1, entryOf('Vermont').id, MatchSideOutcome.PENDING, null],
      [2, entryOf('Duke').id, MatchSideOutcome.PENDING, null],
    ]);
  });

  it('gives every loaded match its Game 1 with one unscored result per side, each where the side plays it', async () => {
    const { event, entryOf } = await createBracketEvent();
    const [first, second, final] = fourTeamBracket(entryOf);
    const homeAndAway = { ...second, isNeutralSite: false, sides: [
      { sideNumber: 1, sportEventParticipantId: entryOf('Texas').id, homeAway: HomeAway.AWAY },
      { sideNumber: 2, sportEventParticipantId: entryOf('Houston').id, homeAway: HomeAway.HOME },
    ] };

    await repos().matches.replaceBracket(event.id, [first, homeAndAway, final]);
    const matches = await repos().matches.findBySportEvent(event.id);

    expect(matches.map((match) => match.games.map((game) => [game.gameNumber, game.status, game.completedAt]))).toEqual([
      [[1, MatchStatus.SCHEDULED, null]],
      [[1, MatchStatus.SCHEDULED, null]],
      [[1, MatchStatus.SCHEDULED, null]],
    ]);
    expect(matches.map((match) => gameOneOf(match).sideResults.map((result) => [result.sideNumber, result.homeAway, result.score]))).toEqual([
      [[1, HomeAway.NONE, null], [2, HomeAway.NONE, null]],
      [[1, HomeAway.AWAY, null], [2, HomeAway.HOME, null]],
      [[1, HomeAway.NONE, null], [2, HomeAway.NONE, null]],
    ]);
  });

  it('replaces a loaded bracket whole, though its matches point at each other', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));

    const [first] = fourTeamBracket(entryOf);
    await repos().matches.replaceBracket(event.id, [{ ...first, advancesToMatchId: null, advancesToSideNumber: null }]);

    expect((await repos().matches.findBySportEvent(event.id)).map((match) => match.matchNumber)).toEqual([1]);
  });

  it('reads only the asked-about event\'s matches', async () => {
    const one = await createBracketEvent();
    const other = await createBracketEvent();
    await repos().matches.replaceBracket(one.event.id, fourTeamBracket(one.entryOf));

    await expect(repos().matches.findBySportEvent(other.event.id)).resolves.toEqual([]);
  });

  it('reads several events\' matches in one call, each event\'s in match order, leaving out events not asked about and reading none for none', async () => {
    const one = await createBracketEvent();
    const two = await createBracketEvent();
    const notAsked = await createBracketEvent();
    for (const { event, entryOf } of [one, two, notAsked]) {
      await repos().matches.replaceBracket(event.id, [...fourTeamBracket(entryOf)].reverse());
    }

    const matches = await repos().matches.findBySportEvents([two.event.id, one.event.id]);

    const byEvent = (sportEventId: string) => matches.filter((match) => match.sportEventId === sportEventId).map((match) => [match.matchNumber, match.roundNumber]);
    expect(matches).toHaveLength(6);
    expect(byEvent(one.event.id)).toEqual([[1, 1], [2, 1], [3, 2]]);
    expect(byEvent(two.event.id)).toEqual([[1, 1], [2, 1], [3, 2]]);
    await expect(repos().matches.findBySportEvents([])).resolves.toEqual([]);
  });

  it('reads one match by id, as the event read reads it with its round number and each side\'s period scores in period order, and null for no match', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const final = expectDefined((await repos().matches.findBySportEvent(event.id)).find((match) => match.roundNumber === 2));
    await repos().matches.saveGamePeriodScores({ sportEventRoundMatchId: final.id, gameId: gameOneOf(final).id, sides: regularPeriods([[2, 28, 30], [1, 10, 14]]) });

    const read = expectDefined(await repos().matches.findById(final.id));

    expect(read).toEqual((await repos().matches.findBySportEvent(event.id)).find((match) => match.id === final.id));
    expect(gameOneOf(read).sideResults.map((result) => result.periodScores.map((period) => period.periodNumber))).toEqual([[1, 2], [1, 2]]);
    await expect(repos().matches.findById(randomUUID())).resolves.toBeNull();
  });

  it('edits one match, clearing a value sent as null and keeping the ones left out', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.update(first.id, { scheduledDate: null, isNeutralSite: false });

    const [edited] = await repos().matches.findBySportEvent(event.id);
    expect(edited).toMatchObject({ scheduledDate: null, isNeutralSite: false });
    expect(sideParticipantId(edited, 2)).toBe(entryOf('Duke').id);
  });

  it('changes where each side plays Game 1 without moving either team off its side, as a provider listing the teams the other way round does', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.update(first.id, { isNeutralSite: false, gameOneHomeAway: [{ sideNumber: 1, homeAway: HomeAway.HOME }, { sideNumber: 2, homeAway: HomeAway.AWAY }] });

    const [edited] = await repos().matches.findBySportEvent(event.id);
    expect(gameOneOf(edited).sideResults.map((result) => [result.sideNumber, result.homeAway])).toEqual([[1, HomeAway.HOME], [2, HomeAway.AWAY]]);
    expect([sideParticipantId(edited, 1), sideParticipantId(edited, 2)]).toEqual([entryOf('Vermont').id, entryOf('Duke').id]);
  });

  it('stores a game\'s spread on side 1 in half points and reads it back as a number, clearing it with null (#720)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first, second] = await repos().matches.findBySportEvent(event.id);
    expect([matchSpread(first), matchSpread(second)]).toEqual([null, null]);

    await repos().matches.update(first.id, { spread: -3.5 });
    await repos().matches.update(second.id, { spread: 14 });
    const spread = await repos().matches.findBySportEvent(event.id);
    expect(spread.slice(0, 2).map(matchSpread)).toEqual([-3.5, 14]);
    expect(spread[0].sides.map((side) => side.spread)).toEqual([-3.5, null]);

    await repos().matches.update(first.id, { spread: null });
    expect(matchSpread(expectDefined((await repos().matches.findBySportEvent(event.id))[0]))).toBeNull();
  });

  it('saves and replaces a Game\'s period scores for each side, reading them in period order, and drops them with the bracket (#772)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);
    const save = (periods: readonly [number, number, number][]) => repos().matches.saveGamePeriodScores({ sportEventRoundMatchId: first.id, gameId: gameOneOf(first).id, sides: regularPeriods(periods) });

    await save([[3, 7, 14], [1, 0, 7]]);
    await save([[3, 7, 14], [1, 3, 7]]);
    expect(periodScoresOf(expectDefined((await repos().matches.findBySportEvent(event.id))[0]))).toEqual([
      { sideNumber: 1, periodScores: [{ kind: PeriodKind.REGULAR, periodNumber: 1, score: 3 }, { kind: PeriodKind.REGULAR, periodNumber: 3, score: 7 }] },
      { sideNumber: 2, periodScores: [{ kind: PeriodKind.REGULAR, periodNumber: 1, score: 7 }, { kind: PeriodKind.REGULAR, periodNumber: 3, score: 14 }] },
    ]);

    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    await expect(getPrisma().sportEventRoundMatchGameSideResultPeriodScore.count({ where: { sideResult: { sportEventRoundMatchId: first.id } } })).resolves.toBe(0);
  });

  it('keeps a Game\'s shoot-out when its periods of play are saved again', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);
    await repos().matches.applyResult({ result: resultOf(first, { outcomes: SIDE_TWO_WINS, scores: [1, 1], shootout: [3, 4] }), sideFill: null, standings: [] });

    await repos().matches.saveGamePeriodScores({ sportEventRoundMatchId: first.id, gameId: gameOneOf(first).id, sides: regularPeriods([[1, 1, 0], [2, 0, 1]]) });

    const game = gameOneOf(expectDefined(await repos().matches.findById(first.id)));
    expect([shootoutScoreOf(game, 1), shootoutScoreOf(game, 2)]).toEqual([3, 4]);
    expect(game.sideResults.find((result) => result.sideNumber === 1)?.periodScores.map((period) => period.kind)).toEqual([PeriodKind.REGULAR, PeriodKind.REGULAR, PeriodKind.SHOOTOUT]);
  });

  it('refuses a period before the first and a negative period score in the database', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);
    const save = (periodNumber: number, score: number) => repos().matches.saveGamePeriodScores({
      sportEventRoundMatchId: first.id,
      gameId: gameOneOf(first).id,
      sides: [{ sideNumber: 1, periodScores: [{ kind: PeriodKind.REGULAR, periodNumber, score }] }],
    });

    await expect(save(0, 0)).rejects.toThrow(/period_scores_check/);
    await expect(save(1, -1)).rejects.toThrow(/period_scores_check/);
  });

  it('refuses a bracket naming a round the event does not have, and writes none of it', async () => {
    const { event, entryOf } = await createBracketEvent();
    const [first] = fourTeamBracket(entryOf);

    await expect(repos().matches.replaceBracket(event.id, [{ ...first, roundNumber: 3, advancesToMatchId: null, advancesToSideNumber: null }]))
      .rejects.toThrow(`Sport event ${event.id} has no round 3`);
    await expect(repos().matches.findBySportEvent(event.id)).resolves.toEqual([]);
  });

  it('saves period scores and queues their background jobs together, so a saved score always has its follow-up queued', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.saveGamePeriodScores({ sportEventRoundMatchId: first.id, gameId: gameOneOf(first).id, sides: regularPeriods([[1, 8, 10]]) }, [
      { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: { syncRunIds: [randomUUID()], sport: Sport.BASKETBALL, eventId: event.id }, start: { trigger: JobTrigger.SYSTEM } },
    ]);

    expect(periodScoresOf(expectDefined(await repos().matches.findById(first.id))).map((side) => side.periodScores.map((period) => period.score))).toEqual([[8], [10]]);
    await expect(getPrisma().backgroundJob.count({ where: { type: BackgroundJobType.MANUAL_EVENT_SYNC } })).resolves.toBe(1);
  });

  it('places both sides of each named match in one write and leaves the other matches as they were', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first, , final] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.placeSides([
      { id: final.id, sides: [{ sideNumber: 1, sportEventParticipantId: entryOf('Texas').id }, { sideNumber: 2, sportEventParticipantId: entryOf('Duke').id }] },
    ]);

    const [unchanged, , placed] = await repos().matches.findBySportEvent(event.id);
    expect([sideParticipantId(placed, 1), sideParticipantId(placed, 2)]).toEqual([entryOf('Texas').id, entryOf('Duke').id]);
    expect(unchanged.sides).toEqual(first.sides);
  });

  it('moves a team from one side of a match to the other in one placement, though a team is on a match once', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.placeSides([
      { id: first.id, sides: [{ sideNumber: 1, sportEventParticipantId: entryOf('Duke').id }, { sideNumber: 2, sportEventParticipantId: entryOf('Vermont').id }] },
    ]);

    const [swapped] = await repos().matches.findBySportEvent(event.id);
    expect([sideParticipantId(swapped, 1), sideParticipantId(swapped, 2)]).toEqual([entryOf('Duke').id, entryOf('Vermont').id]);
  });

  it('deletes the bracket with its event', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));

    await repos().events.delete(event.id);

    await expect(getPrisma().sportEventRoundMatch.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(getPrisma().sportEventRoundMatchSide.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
  });
});

describe('PrismaSportEventRoundMatchRepository.applyResult', () => {
  it('completes the match, fills the next match\'s side and writes every standing in one transaction, then rewrites them', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first, , final] = await repos().matches.findBySportEvent(event.id);
    const asOf = new Date('2027-03-19T04:00:00.000Z');

    await repos().matches.applyResult({
      result: resultOf(first, { outcomes: SIDE_ONE_WINS, scores: [80, 70] }),
      sideFill: { id: final.id, sideNumber: 2, sportEventParticipantId: entryOf('Vermont').id },
      standings: [
        { sportEventParticipantId: entryOf('Vermont').id, position: 1, displayPosition: '1', status: 'ACTIVE', currentRound: 2, asOf },
        { sportEventParticipantId: entryOf('Duke').id, position: 4, displayPosition: '4', status: 'ELIMINATED', currentRound: 1, asOf },
      ],
    });
    await repos().matches.applyResult({
      result: resultOf(first, { outcomes: SIDE_ONE_WINS, scores: [81, 70] }),
      sideFill: null,
      standings: [{ sportEventParticipantId: entryOf('Duke').id, position: 3, displayPosition: 'T3', status: 'ELIMINATED', currentRound: 1, asOf }],
    });

    const [completed, , filled] = await repos().matches.findBySportEvent(event.id);
    expect(completed).toMatchObject({ status: MatchStatus.COMPLETED, completedAt: RECORDED_AT });
    expect(completed.sides.map((side) => side.outcome)).toEqual(SIDE_ONE_WINS);
    expect(gameOneOf(completed)).toMatchObject({ status: MatchStatus.COMPLETED, completedAt: RECORDED_AT });
    expect([gameScoreOf(gameOneOf(completed), 1), gameScoreOf(gameOneOf(completed), 2)]).toEqual([81, 70]);
    expect(sideParticipantId(filled, 2)).toBe(entryOf('Vermont').id);
    const standings = await getPrisma().sportEventParticipantStanding.findMany({ where: { sportEventParticipant: { sportEventId: event.id } } });
    expect(Object.fromEntries(standings.map((row) => [row.sportEventParticipantId, [row.displayPosition, row.status]]))).toEqual({
      [entryOf('Duke').id]: ['T3', 'ELIMINATED'],
      [entryOf('Vermont').id]: ['1', 'ACTIVE'],
    });
  });

  it('fills side 1 of the next match when the winner advances to side 1', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [, second, final] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.applyResult({
      result: resultOf(second, { outcomes: SIDE_TWO_WINS, scores: [70, 75] }),
      sideFill: { id: final.id, sideNumber: 1, sportEventParticipantId: entryOf('Houston').id },
      standings: [],
    });

    const filled = expectDefined(await repos().matches.findById(final.id));
    expect([sideParticipantId(filled, 1), sideParticipantId(filled, 2)]).toEqual([entryOf('Houston').id, null]);
  });

  it('stores a level game\'s shoot-out apart from its score, and clears it with the result (#791)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.applyResult({ result: resultOf(first, { outcomes: SIDE_TWO_WINS, scores: [1, 1], shootout: [3, 4] }), sideFill: null, standings: [] });
    const settled = gameOneOf(expectDefined(await repos().matches.findById(first.id)));
    await repos().matches.applyResult({ result: clearedResultOf(first), sideFill: null, standings: [] });
    const cleared = expectDefined(await repos().matches.findById(first.id));

    expect([gameScoreOf(settled, 1), gameScoreOf(settled, 2), shootoutScoreOf(settled, 1), shootoutScoreOf(settled, 2)]).toEqual([1, 1, 3, 4]);
    expect([shootoutScoreOf(gameOneOf(cleared), 1), shootoutScoreOf(gameOneOf(cleared), 2)]).toEqual([null, null]);
    expect(cleared.sides.map((side) => side.outcome)).toEqual([MatchSideOutcome.PENDING, MatchSideOutcome.PENDING]);
    expect(gameOneOf(cleared)).toMatchObject({ status: MatchStatus.SCHEDULED, completedAt: null });
  });

  it('stores how a match ended, and a walkover with no score, and puts it back to played when cleared (#704)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.applyResult({ result: resultOf(first, { outcomes: SIDE_TWO_WINS, scores: [null, null], ending: MatchEnding.WALKOVER }), sideFill: null, standings: [] });
    const walkover = expectDefined(await repos().matches.findById(first.id));
    await repos().matches.applyResult({ result: clearedResultOf(first), sideFill: null, standings: [] });
    const cleared = expectDefined(await repos().matches.findById(first.id));

    expect(walkover).toMatchObject({ status: MatchStatus.COMPLETED, ending: MatchEnding.WALKOVER });
    expect(walkover.sides.map((side) => side.outcome)).toEqual(SIDE_TWO_WINS);
    expect(gameScoreOf(gameOneOf(walkover), 2)).toBeNull();
    expect(cleared).toMatchObject({ status: MatchStatus.SCHEDULED, ending: MatchEnding.PLAYED, completedAt: null });
  });

  it('leaves a series\' Games as they are when its result is written, the result naming no Game 1 score', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.applyResult({ result: resultOf(first, { outcomes: SIDE_ONE_WINS, scores: null }), sideFill: null, standings: [] });

    const decided = expectDefined(await repos().matches.findById(first.id));
    expect(decided.status).toBe(MatchStatus.COMPLETED);
    expect(decided.games).toEqual(first.games);
  });

  it('writes a match\'s live status on a match with no result, and leaves a match that has one as it is', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first, second] = await repos().matches.findBySportEvent(event.id);
    await repos().matches.applyResult({ result: resultOf(second, { outcomes: SIDE_TWO_WINS, scores: [70, 75] }), sideFill: null, standings: [] });

    await repos().matches.applyStatuses([
      { id: first.id, status: MatchStatus.IN_PROGRESS },
      { id: second.id, status: MatchStatus.IN_PROGRESS },
    ]);

    const [live, decided] = await repos().matches.findBySportEvent(event.id);
    expect(live.status).toBe(MatchStatus.IN_PROGRESS);
    expect(live.sides.map((side) => side.outcome)).toEqual([MatchSideOutcome.PENDING, MatchSideOutcome.PENDING]);
    expect(decided.status).toBe(MatchStatus.COMPLETED);
    expect([gameScoreOf(gameOneOf(decided), 1), gameScoreOf(gameOneOf(decided), 2)]).toEqual([70, 75]);
  });

  it('writes nothing when one part of the result is refused by the database', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await expect(repos().matches.applyResult({
      result: resultOf(first, { outcomes: SIDE_TWO_WINS, scores: [70, 80] }),
      sideFill: { id: first.id, sideNumber: 1, sportEventParticipantId: entryOf('Duke').id },
      standings: [],
    })).rejects.toThrow();

    const unchanged = expectDefined(await repos().matches.findById(first.id));
    expect(unchanged).toEqual(first);
  });
});

/**
 * One bracket or field write, on a fresh event: `write` makes it carrying the given jobs, and
 * `state` reads what it changes, so a rolled-back write leaves `state` as it was.
 */
type JobCarryingWrite = (context: Awaited<ReturnType<typeof createBracketEvent>>) => Promise<{
  write: (jobs: ReturnType<typeof eventRebuildJob>[]) => Promise<unknown>;
  state: () => Promise<unknown>;
}>;

const loadedBracket = async (context: Awaited<ReturnType<typeof createBracketEvent>>) => {
  await repos().matches.replaceBracket(context.event.id, fourTeamBracket(context.entryOf));
  return repos().matches.findBySportEvent(context.event.id);
};
const matchRows = (sportEventId: string) => getPrisma().sportEventRoundMatch.findMany({ where: { sportEventId }, orderBy: { matchNumber: 'asc' }, include: { sides: { orderBy: { sideNumber: 'asc' } } } });
const fieldRows = (sportEventId: string) => getPrisma().sportEventParticipant.findMany({ where: { sportEventId }, orderBy: { id: 'asc' } });

const JOB_CARRYING_WRITES: ReadonlyArray<[string, JobCarryingWrite]> = [
  ['a bracket load', async (context) => ({
    write: (jobs) => repos().matches.replaceBracket(context.event.id, fourTeamBracket(context.entryOf), jobs),
    state: () => matchRows(context.event.id),
  })],
  ['a match edit', async (context) => {
    const [first] = await loadedBracket(context);
    return { write: (jobs) => repos().matches.update(expectDefined(first).id, { isNeutralSite: false }, jobs), state: () => matchRows(context.event.id) };
  }],
  ['a round\'s matchups placed', async (context) => {
    const [, , final] = await loadedBracket(context);
    return {
      write: (jobs) => repos().matches.placeSides([{ id: expectDefined(final).id, sides: [{ sideNumber: 1, sportEventParticipantId: context.entryOf('Texas').id }, { sideNumber: 2, sportEventParticipantId: context.entryOf('Duke').id }] }], jobs),
      state: () => matchRows(context.event.id),
    };
  }],
  ['teams added to the field', async (context) => {
    const team = await getPrisma().participant.create({ data: { sportLeagueId: context.sportLeague.id, name: `Added ${randomUUID()}`, participantType: 'TEAM' } });
    return { write: (jobs) => repos().field.createMany(context.event.id, [{ participantId: team.id }], jobs), state: () => fieldRows(context.event.id) };
  }],
  ['a grid save', async (context) => ({
    write: (jobs) => repos().field.updateMany([{ id: context.entryOf('Duke').id, updates: { ranking: 7 } }], jobs),
    state: () => fieldRows(context.event.id),
  })],
  ['a field row removed', async (context) => ({
    write: (jobs) => repos().field.delete(context.entryOf('Texas').id, jobs),
    state: () => fieldRows(context.event.id),
  })],
];

describe('Bracket and field writes carry the event\'s leaderboard rebuild (#1466)', () => {
  const rebuildJobs = (sportEventId: string) => getPrisma().backgroundJob.findMany({
    where: { type: BackgroundJobType.REBUILD_LEADERBOARDS, dedupeKey: eventRebuildJob(sportEventId).dedupeKey },
    select: { type: true },
  });

  it.each(JOB_CARRYING_WRITES)('commits the rebuild job with %s', async (_write, prepare) => {
    const context = await createBracketEvent();
    const { write } = await prepare(context);

    await write([eventRebuildJob(context.event.id)]);

    await expect(rebuildJobs(context.event.id)).resolves.toEqual([{ type: BackgroundJobType.REBUILD_LEADERBOARDS }]);
  });

  it.each(JOB_CARRYING_WRITES)('rolls back %s when its rebuild job cannot be written, leaving what it would change as it was', async (_write, prepare) => {
    const context = await createBracketEvent();
    const { write, state } = await prepare(context);
    const before = await state();

    await expect(withBackgroundJobsFailing(BackgroundJobType.REBUILD_LEADERBOARDS, () => write([eventRebuildJob(context.event.id)]))).rejects.toThrow();

    await expect(state()).resolves.toEqual(before);
    await expect(rebuildJobs(context.event.id)).resolves.toEqual([]);
  });
});

describe('sport_event_round_matches and match side database checks', () => {
  /** Inserts one match of the event directly, as only a defect in the service could. */
  async function insertMatch(event: { id: string }, values: Record<string, unknown> = {}) {
    const round = await getPrisma().sportEventRound.findFirstOrThrow({ where: { sportEventId: event.id, roundNumber: 1 } });
    return getPrisma().sportEventRoundMatch.create({
      data: { sportEventId: event.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: true, ...values },
    });
  }

  /** Inserts one side of a match directly. */
  function insertSide(match: { id: string; sportEventId: string }, values: { sideNumber: number } & Record<string, unknown>) {
    return getPrisma().sportEventRoundMatchSide.create({ data: { sportEventId: match.sportEventId, sportEventRoundMatchId: match.id, ...values } });
  }

  it('refuses one team on both sides of a match', async () => {
    const { event, entryOf } = await createBracketEvent();
    const match = await insertMatch(event);
    await insertSide(match, { sideNumber: 1, sportEventParticipantId: entryOf('Duke').id });

    await expect(insertSide(match, { sideNumber: 2, sportEventParticipantId: entryOf('Duke').id })).rejects.toThrow(/Unique constraint/);
  });

  it('refuses a side number other than 1 or 2, and a second side with the same number', async () => {
    const { event } = await createBracketEvent();
    const match = await insertMatch(event);
    await insertSide(match, { sideNumber: 1 });

    await expect(insertSide(match, { sideNumber: 3 })).rejects.toThrow(/sport_event_round_match_sides_side_number_check/);
    await expect(insertSide(match, { sideNumber: 1 })).rejects.toThrow(/Unique constraint/);
  });

  it('refuses a spread on side 2 and one not in half points, and takes one in half points on side 1 (#720)', async () => {
    const { event } = await createBracketEvent();
    const match = await insertMatch(event);

    await expect(insertSide(match, { sideNumber: 2, spread: 3.5 })).rejects.toThrow(/sport_event_round_match_sides_spread_side_one_check/);
    await expect(insertSide(match, { sideNumber: 1, spread: 3.2 })).rejects.toThrow(/sport_event_round_match_sides_spread_half_points_check/);
    await expect(insertSide(match, { sideNumber: 1, spread: -6.5 })).resolves.toMatchObject({ sideNumber: 1 });
  });

  it('refuses a side naming a team from another event\'s field', async () => {
    const { event } = await createBracketEvent();
    const other = await createBracketEvent();
    const match = await insertMatch(event);

    await expect(insertSide(match, { sideNumber: 1, sportEventParticipantId: other.entryOf('Duke').id })).rejects.toThrow(/sport_event_round_match_sides_participant_fkey/);
  });

  it('refuses a side number to advance to without the match, a match to advance to without the side, and a side number other than 1 or 2', async () => {
    const { event } = await createBracketEvent();
    const next = await insertMatch(event, { matchNumber: 2 });

    await expect(insertMatch(event, { advancesToSideNumber: 1 })).rejects.toThrow(/sport_event_round_matches_advances_to_side_number_check/);
    await expect(insertMatch(event, { advancesToMatchId: next.id })).rejects.toThrow(/sport_event_round_matches_advances_to_side_number_check/);
    await expect(insertMatch(event, { advancesToMatchId: next.id, advancesToSideNumber: 3 })).rejects.toThrow(/sport_event_round_matches_advances_to_side_number_check/);
  });

  it('refuses a match that advances into itself', async () => {
    const { event } = await createBracketEvent();
    const match = await insertMatch(event);

    await expect(getPrisma().sportEventRoundMatch.update({ where: { id: match.id }, data: { advancesToMatchId: match.id, advancesToSideNumber: 1 } }))
      .rejects.toThrow(/sport_event_round_matches_advances_elsewhere/);
  });

  it('refuses a match number below 1, and a negative Game score', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await expect(insertMatch(event, { matchNumber: 0 })).rejects.toThrow(/sport_event_round_matches_match_number_positive/);
    await expect(getPrisma().sportEventRoundMatchGameSideResult.updateMany({ where: { sportEventRoundMatchGameId: gameOneOf(first).id }, data: { score: -1 } }))
      .rejects.toThrow(/sport_event_round_match_game_side_results_score_check/);
  });

  it('refuses a shoot-out numbered other than 1, and takes one numbered 1 (#791)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);
    const sideResult = await getPrisma().sportEventRoundMatchGameSideResult.findFirstOrThrow({ where: { sportEventRoundMatchGameId: gameOneOf(first).id } });
    const insert = (periodNumber: number) => getPrisma().sportEventRoundMatchGameSideResultPeriodScore.create({
      data: { sportEventRoundMatchGameSideResultId: sideResult.id, kind: PeriodKind.SHOOTOUT, periodNumber, score: 4 },
    });

    await expect(insert(2)).rejects.toThrow(/sport_event_round_match_game_side_result_period_scores_check/);
    await expect(insert(1)).resolves.toMatchObject({ kind: PeriodKind.SHOOTOUT });
  });

  it('refuses an early ending on a match that is not COMPLETED, and takes a retirement on a COMPLETED one (#704)', async () => {
    const { event } = await createBracketEvent();

    await expect(insertMatch(event, { ending: MatchEnding.RETIREMENT })).rejects.toThrow(/sport_event_round_matches_ending_check/);
    await expect(insertMatch(event, { ending: MatchEnding.RETIREMENT, status: MatchStatus.COMPLETED }))
      .resolves.toMatchObject({ ending: MatchEnding.RETIREMENT });
  });

  it('refuses a match number used twice in one round, and two matches advancing to one side', async () => {
    const { event } = await createBracketEvent();
    const final = await insertMatch(event, { matchNumber: 3 });
    await insertMatch(event, { matchNumber: 1, advancesToMatchId: final.id, advancesToSideNumber: 2 });

    await expect(insertMatch(event, { matchNumber: 1 })).rejects.toThrow(/Unique constraint/);
    await expect(insertMatch(event, { matchNumber: 2, advancesToMatchId: final.id, advancesToSideNumber: 2 }))
      .rejects.toThrow(/Unique constraint/);
  });

  it('refuses to remove a field row a match side names, so a bracket never loses a team silently', async () => {
    const { event, entryOf } = await createBracketEvent();
    const match = await insertMatch(event);
    await insertSide(match, { sideNumber: 2, sportEventParticipantId: entryOf('Duke').id });

    await expect(repos().field.delete(entryOf('Duke').id)).rejects.toThrow(/Foreign key constraint/);
    await expect(repos().field.findById(entryOf('Duke').id)).resolves.not.toBeNull();
  });
});
