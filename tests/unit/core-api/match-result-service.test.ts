import { NO_CONTEST_ACTIVATION, testDomainEvents } from '../../support/domain-events';
import { expect, jest } from '@jest/globals';
import { BackgroundJobType, isAtPlace, matchCompletedAt, matchPlaceOf, type MatchPlace, MatchEnding, PeriodUnit, type SlotPeriods, MatchSide, MatchSideOutcome, MatchStatus, ParticipantStandingStatus, PeriodKind, Sport, SportEventStatus, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import type { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { MatchResultService, describeScoreProblem, gameStandings } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/match-result-service';
import { bracketInput, homeAwayOf, homeAwayPeriod, homeAwayResult, legacyMatch, placeTeam, type HomeAwayResultRequest } from '../../support/match-sides';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';
import { expectDefined } from '../../support/expect-defined';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { slotStatusRefreshJob, slotTiebreakersRefreshJob } from '../../support/slot-tiebreaker-jobs';
import { RecordingDomainEvents } from '../../support/recording-domain-events';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { DomainEventType } from '../../../packages/core-api/src/modules/domain-events';
import { inMemoryBackgroundJobs, TEST_JOB_START, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { bracketRoundSlots } from '../../support/round-slots';

// The admin's match results against an in-memory store (#699): what a result saves (the winner,
// the next match's side, every team's standing), what it refuses, and the correction lock. The
// Prisma adapter's transaction is covered in sport-event-matches.integration.

const AS_OF = new Date('2027-03-19T04:00:00.000Z');

/**
 * The result service named by home and away, as these tests and the API still are (#2046 part b
 * moves the API to sides): home is side 2. It answers each match as the API reads it.
 */
class HomeAwayResults {
  private readonly service: MatchResultService;

  constructor(deps: ConstructorParameters<typeof MatchResultService>[0]) {
    this.service = new MatchResultService(deps);
  }

  async recordResult(sportEventId: string, place: MatchPlace, result: HomeAwayResultRequest) {
    return (await this.service.recordResult(sportEventId, place, homeAwayResult(result))).map(homeAwayOf);
  }

  async cancelMatch(sportEventId: string, place: MatchPlace) {
    return (await this.service.cancelMatch(sportEventId, place)).map(homeAwayOf);
  }

  async recordPeriodScore(sportEventId: string, place: MatchPlace, periodNumber: number, score: { homeScore: number; awayScore: number }) {
    return (await this.service.recordPeriodScore(sportEventId, place, periodNumber, homeAwayPeriod(score))).map(homeAwayOf);
  }
}

/** The job a decided game's write carries to settle its squares contests, as the handler map builds it. */
function settleGameJob(sportEventId: string, sportEventRoundMatchId: string): BackgroundJobRequest {
  return {
    type: BackgroundJobType.SETTLE_GAME_CONTESTS,
    payload: { sportEventId, sportEventRoundMatchId, completedAt: AS_OF.toISOString() },
    sportEventId,
    runAt: undefined,
    dedupeKey: `SETTLE_GAME_CONTESTS:${sportEventRoundMatchId}`,
    start: TEST_JOB_START,
  };
}

/** The app's handler map over a watched queue: what a write described, and the wake once it committed. */
function gameSettlement() {
  const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart });
  const queued = jest.spyOn(queue, 'queued');
  const domainEvents = new RecordingDomainEvents({ queue });
  const decided = (sportEventId: string, sportEventRoundMatchId: string) => domainEvents.collected.filter((event) => event.type === DomainEventType.GAME_DECIDED
    && event.sportEventId === sportEventId && event.sportEventRoundMatchId === sportEventRoundMatchId && event.decidedAt.getTime() === AS_OF.getTime());
  return { domainEvents, queued, decided };
}

/** Game 1's period write for the week's first game: each quarter's own points, home and away. */
function gamePeriods(periods: readonly (readonly [number, number, number])[]) {
  const side = (sideNumber: number, pick: (home: number, away: number) => number) => ({
    sideNumber,
    periodScores: periods.map(([periodNumber, home, away]) => ({ kind: PeriodKind.REGULAR, periodNumber, score: pick(home, away) })),
  });
  return { sportEventRoundMatchId: 'game-1', gameId: 'game-1-g1', sides: [side(1, (_home, away) => away), side(2, (home) => home)] };
}

const noActivation = () => jest.fn<EventLifecycleService['activateContestsPastCutoff']>(async () => 0);

const FOUR_QUARTERS: SlotPeriods = { unit: PeriodUnit.QUARTER, count: 4 };

async function setup({ sport = Sport.BASKETBALL, status = SportEventStatus.IN_PROGRESS, periods = FOUR_QUARTERS }: { sport?: Sport; status?: SportEventStatus; periods?: SlotPeriods | null } = {}) {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(sport);
  const event = store.addEvent({ sport, status: SportEventStatus.DRAFT });
  await store.addRounds(event.id, [
    { roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-03-20T16:00:00.000Z') },
  ]);
  // A game's periods are its slot's (#2047).
  for (const round of store.roundRows) round.slot = { ...round.slot, periods };
  const [duke, vermont, houston, texas] = ['Duke', 'Vermont', 'Houston', 'Texas'].map((name, index) => {
    const team = store.addParticipant(sportRow.id, name, { participantType: 'TEAM' });
    return store.addToField(event.id, team.id, { seedNumber: index + 1 });
  });
  let sequence = 0;
  const brackets = new SportEventBracketService({ domainEvents: testDomainEvents(),
    sportEvents: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    matches: store.matchRepo(),
    contests: { recheckReminders: async () => undefined },
    ...NO_PICKS_ON_EVENT,
    newId: () => {
      sequence += 1;
      return `match-${sequence}`;
    },
  });
  if (sport === Sport.BASKETBALL || sport === Sport.FOOTBALL || sport === Sport.SOCCER) {
    await brackets.loadBracket(event.id, [
      bracketInput({ matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: duke.id, awaySportEventParticipantId: vermont.id, isNeutralSite: true, scheduledDate: null, advancesTo: { roundNumber: 2, matchNumber: 1, side: MatchSide.HOME } }),
      bracketInput({ matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: houston.id, awaySportEventParticipantId: texas.id, isNeutralSite: true, scheduledDate: null, advancesTo: { roundNumber: 2, matchNumber: 1, side: MatchSide.AWAY } }),
      // Each round numbers its matches from 1 (#2161): the final is round 2's match 1.
      bracketInput({ matchNumber: 1, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null }),
    ]);
  }
  event.status = status;
  // The bracket's loading carried a rebuild of its own; each test asserts only the jobs its writes carry.
  store.backgroundJobs.length = 0;
  const service = new HomeAwayResults({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });
  const standingOf = (rowId: string) => store.standingRows.find((row) => row.sportEventParticipantId === rowId);
  return { store, service, event, duke, vermont, houston, texas, standingOf };
}

/** A released week of two games that form no bracket, as an NFL regular-season week is. */
async function week() {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(Sport.FOOTBALL);
  const event = store.addEvent({ sport: Sport.FOOTBALL, status: SportEventStatus.DRAFT });
  await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: new Date('2027-09-12T17:00:00.000Z') }]);
  // A regular-season week's games can end level (#792), and are played in four quarters: its slot says so (#2046, #2047).
  for (const round of store.roundRows) round.slot = { ...round.slot, canEndTied: true, periods: FOUR_QUARTERS };
  const [bills, jets, chiefs, raiders] = ['Bills', 'Jets', 'Chiefs', 'Raiders'].map((name) =>
    store.addToField(event.id, store.addParticipant(sportRow.id, name, { participantType: 'TEAM' }).id));
  let sequence = 0;
  await new SportEventBracketService({ domainEvents: testDomainEvents(),
    sportEvents: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    matches: store.matchRepo(),
    contests: { recheckReminders: async () => undefined },
    ...NO_PICKS_ON_EVENT,
    newId: () => {
      sequence += 1;
      return `game-${sequence}`;
    },
  }).loadBracket(event.id, [
    bracketInput({ matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: bills.id, awaySportEventParticipantId: jets.id, isNeutralSite: false, scheduledDate: null, advancesTo: null }),
    bracketInput({ matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: chiefs.id, awaySportEventParticipantId: raiders.id, isNeutralSite: false, scheduledDate: null, advancesTo: null }),
  ]);
  event.status = SportEventStatus.SCHEDULED;
  // The games' loading carried a rebuild of its own; each test asserts only the jobs its writes carry.
  store.backgroundJobs.length = 0;
  const service = new HomeAwayResults({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });
  const standingOf = (rowId: string) => store.standingRows.find((row) => row.sportEventParticipantId === rowId);
  return { store, service, event, bills, jets, chiefs, raiders, standingOf };
}

const homeWins = { winnerSide: MatchSide.HOME, homeScore: 80, awayScore: 70 };
/** The bracket as the write leaves it, handed on so the lifecycle need not read it again (#1355). */
const writtenBracketWithResult = expect.arrayContaining([expect.objectContaining({
  id: 'match-1',
  status: MatchStatus.COMPLETED,
  sides: [expect.objectContaining({ sideNumber: 1, outcome: MatchSideOutcome.LOST }), expect.objectContaining({ sideNumber: 2, outcome: MatchSideOutcome.WON })],
})]);
const awayWins = { winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 80 };

describe('MatchResultService.recordResult', () => {
  it('completes the match with its winner and scores and puts the winner on its side of the next match', async () => {
    const { service, event, vermont } = await setup();

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, awayWins);

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 80 });
    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))).toMatchObject({ homeSportEventParticipantId: vermont.id, awaySportEventParticipantId: null });
  });

  it('records when the result came in, and moves it with a correction (#1889)', async () => {
    const { store, event } = await setup();
    const completedAtOf = async () => matchCompletedAt(expectDefined((await store.matchRepo().findBySportEvent(event.id)).find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 })), 'match 1'));
    const corrected = new Date(AS_OF.getTime() + 60_000);
    let now = AS_OF;
    const service = new HomeAwayResults({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => now });

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, awayWins);
    const recorded = await completedAtOf();
    now = corrected;
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { ...awayWins, awayScore: 81 });

    expect([recorded, await completedAtOf()]).toEqual([AS_OF, corrected]);
  });

  it('gives a cancelled game no completion time (#1889)', async () => {
    const { service, event } = await week();

    const cancelled = await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 });

    expect(cancelled.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ status: MatchStatus.CANCELLED, completedAt: null });
  });

  it('answers with the bracket as it wrote it, reading the bracket once and not again after the write (#1355)', async () => {
    const { store, event, vermont } = await setup();
    const matches = store.matchRepo();
    const findBySportEvent = jest.spyOn(matches, 'findBySportEvent');
    const service = new HomeAwayResults({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches, now: () => AS_OF });

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, awayWins);

    expect(findBySportEvent).toHaveBeenCalledTimes(1);
    expect(bracket).toEqual((await store.matchRepo().findBySportEvent(event.id)).map(homeAwayOf));
    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))?.homeSportEventParticipantId).toBe(vermont.id);
  });

  it('asks the lifecycle to start the contests whose cutoff the result passed, with the service clock, on an event under way', async () => {
    const { store, event } = await setup();
    const activateContestsPastCutoff = jest.fn<EventLifecycleService['activateContestsPastCutoff']>(async () => 0);
    const service = new HomeAwayResults({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), contestActivation: { activateContestsPastCutoff }, domainEvents: testDomainEvents(), now: () => AS_OF });

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(activateContestsPastCutoff).toHaveBeenCalledWith(expect.objectContaining({ id: event.id, status: SportEventStatus.IN_PROGRESS }), AS_OF, writtenBracketWithResult);
  });

  it('asks a scheduled event\'s contests to go live with a result, since its slot can be under way before the event follows (#2013)', async () => {
    const { store, event } = await setup({ status: SportEventStatus.SCHEDULED });
    const activateContestsPastCutoff = jest.fn<EventLifecycleService['activateContestsPastCutoff']>(async () => 0);
    const service = new HomeAwayResults({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), contestActivation: { activateContestsPastCutoff }, domainEvents: testDomainEvents(), now: () => AS_OF });

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(activateContestsPastCutoff).toHaveBeenCalled();
  });

  it('writes the job settling the squares contests on the game with its result, whatever the event\'s status, and wakes the runner only once it is written', async () => {
    const { store, event } = await setup({ status: SportEventStatus.SCHEDULED });
    const settlement = gameSettlement();
    const matches = store.matchRepo();
    const applyResult = jest.spyOn(matches, 'applyResult');
    const service = new HomeAwayResults({
      sportEvents: store.sportEventRepo(),
      matches,
      contestActivation: { activateContestsPastCutoff: noActivation() },
      domainEvents: settlement.domainEvents,
      now: () => AS_OF,
    });

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(settlement.decided(event.id, 'match-1')).toHaveLength(1);
    expect(applyResult).toHaveBeenCalledWith(expect.objectContaining({ jobs: [settleGameJob(event.id, 'match-1'), eventRebuildJob(event.id), slotTiebreakersRefreshJob(event.id), slotStatusRefreshJob(event.id)] }));
    expect(settlement.queued).toHaveBeenCalledTimes(1);
    expect(applyResult.mock.invocationCallOrder[0]).toBeLessThan(expectDefined(settlement.queued.mock.invocationCallOrder[0]));
  });

  it('wakes no runner when the result cannot be written', async () => {
    const { store, event } = await setup();
    const settlement = gameSettlement();
    const matches = store.matchRepo();
    jest.spyOn(matches, 'applyResult').mockRejectedValue(new Error('connection lost'));
    const service = new HomeAwayResults({
      sportEvents: store.sportEventRepo(),
      matches,
      contestActivation: { activateContestsPastCutoff: noActivation() },
      domainEvents: settlement.domainEvents,
      now: () => AS_OF,
    });

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins)).rejects.toThrow('connection lost');

    expect(settlement.queued).not.toHaveBeenCalled();
  });

  it('accepts a result with no scores', async () => {
    const { service, event } = await setup();

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null });

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ status: MatchStatus.COMPLETED, homeScore: null, awayScore: null });
  });

  it('rewrites the standings: the winner ahead, the teams still to play tied behind it, the loser eliminated last, each at the latest round it has a match in', async () => {
    const context = await setup();

    await context.service.recordResult(context.event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(context.standingOf(context.duke.id)).toMatchObject({ position: 1, displayPosition: '1', status: ParticipantStandingStatus.ACTIVE, asOf: AS_OF });
    expect(context.standingOf(context.houston.id)).toMatchObject({ position: 2, displayPosition: 'T2', status: ParticipantStandingStatus.ACTIVE });
    expect(context.standingOf(context.vermont.id)).toMatchObject({ position: 4, displayPosition: '4', status: ParticipantStandingStatus.ELIMINATED });
  });

  it('ranks the champion first, the runner-up second and the teams out in the first round tied below them', async () => {
    const context = await setup();
    await context.service.recordResult(context.event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);
    await context.service.recordResult(context.event.id, { roundNumber: 1, matchNumber: 2 }, awayWins);

    await context.service.recordResult(context.event.id, { roundNumber: 2, matchNumber: 1 }, awayWins);

    expect(context.standingOf(context.texas.id)).toMatchObject({ position: 1, displayPosition: '1', status: ParticipantStandingStatus.COMPLETE });
    expect(context.standingOf(context.duke.id)).toMatchObject({ position: 2, displayPosition: '2', status: ParticipantStandingStatus.ELIMINATED });
    expect(context.standingOf(context.vermont.id)).toMatchObject({ position: 3, displayPosition: 'T3' });
    expect(context.standingOf(context.houston.id)).toMatchObject({ position: 3, displayPosition: 'T3' });
  });

  it('changes a winner while the next match has no result, moving the new winner into its place', async () => {
    const { service, event, vermont } = await setup();
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, awayWins);

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))?.homeSportEventParticipantId).toBe(vermont.id);
  });

  it('refuses (409 SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED) a new winner once the next match has a result, but still fixes the scores', async () => {
    const { service, event } = await setup();
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 2 }, homeWins);
    await service.recordResult(event.id, { roundNumber: 2, matchNumber: 1 }, homeWins);

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, awayWins))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED', statusCode: 409 });
    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 81, awayScore: 70 });
    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))?.homeScore).toBe(81);
  });

  it.each([
    ['one score without the other', { winnerSide: MatchSide.HOME, homeScore: 80, awayScore: null }],
    ['the winner scoring less', { winnerSide: MatchSide.HOME, homeScore: 60, awayScore: 70 }],
    ['a winner on level scores', { winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 70 }],
    ['a tie in a bracket match, which always has a winner', { winnerSide: null, homeScore: 70, awayScore: 70 }],
  ])('refuses (422 MATCH_RESULT_INVALID) %s and saves nothing', async (_label, input) => {
    const { service, event, store } = await setup();

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, input)).rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
    expect(store.standingRows).toEqual([]);
  });

  it('refuses (422 MATCH_SIDES_NOT_SET) a match still waiting for a team', async () => {
    const { service, event } = await setup();

    await expect(service.recordResult(event.id, { roundNumber: 2, matchNumber: 1 }, homeWins)).rejects.toMatchObject({ code: 'MATCH_SIDES_NOT_SET', statusCode: 422 });
  });

  it('refuses (404 BRACKET_MATCH_NOT_FOUND) a match number the bracket does not have', async () => {
    const { service, event } = await setup();

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 9 }, homeWins)).rejects.toMatchObject({ code: 'BRACKET_MATCH_NOT_FOUND', statusCode: 404 });
  });

  it('refuses (409 SPORT_EVENT_NOT_RELEASED) a draft, whose pairings can still change', async () => {
    const { service, event } = await setup({ status: SportEventStatus.DRAFT });

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
  });

  it('refuses (422 SPORT_EVENT_NOT_BRACKET) an event whose sport is not played as a bracket, and 404 EVENT_NOT_FOUND an unknown event', async () => {
    const { service, event } = await setup({ sport: Sport.GOLF });

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_BRACKET', statusCode: 422 });
    await expect(service.recordResult('no-such-event', { roundNumber: 1, matchNumber: 1 }, homeWins)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

// #772 review: quarter scores belong to the two teams playing, so a game with any is under way.
describe('MatchResultService once the next game has quarter scores', () => {
  async function scoredFinal() {
    const context = await setup({ sport: Sport.FOOTBALL });
    await context.service.recordResult(context.event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);
    await context.service.recordResult(context.event.id, { roundNumber: 1, matchNumber: 2 }, homeWins);
    await context.service.recordPeriodScore(context.event.id, { roundNumber: 2, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 3 });
    return context;
  }

  it('refuses (409 SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED) a new winner for a game whose winner is playing a game with quarter scores', async () => {
    const { service, event } = await scoredFinal();

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, awayWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED', statusCode: 409 });
  });

});

describe('MatchResultService side outcomes (#2046)', () => {
  /** Each side's outcome on the match at this place, side 1's first. */
  const outcomesAt = (store: InMemorySportEvents, place: { roundNumber: number; matchNumber: number }) =>
    expectDefined(store.matchRows.find((match) => isAtPlace(match, place))).sides.map((side) => side.outcome);

  it('rolls a win up to the winning side WON and the other LOST, and a tie where the game can end level to both TIED', async () => {
    const { service, event, store } = await week();

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 2 }, { winnerSide: null, homeScore: 20, awayScore: 20 });

    // Side 1 is the away team, side 2 the home team.
    expect(outcomesAt(store, { roundNumber: 1, matchNumber: 1 })).toEqual([MatchSideOutcome.LOST, MatchSideOutcome.WON]);
    expect(outcomesAt(store, { roundNumber: 1, matchNumber: 2 })).toEqual([MatchSideOutcome.TIED, MatchSideOutcome.TIED]);
  });

  it('rolls a level game a shoot-out settled up to the shoot-out\'s winner, where the game cannot end level', async () => {
    const { service, event, store } = await setup({ sport: Sport.SOCCER });

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4 });

    expect(outcomesAt(store, { roundNumber: 1, matchNumber: 1 })).toEqual([MatchSideOutcome.WON, MatchSideOutcome.LOST]);
  });

  it('rolls a 4-2 series up to the side with four wins WON, leaving its Games as they were', async () => {
    const { service, event, store } = await setup();
    // The first round is played as best-of-seven series, its matches' slot says so.
    for (const match of store.matchRows) match.slot = { ...match.slot, seriesGames: 7 };
    const before = expectDefined(store.matchRows.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).games;

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 4, awayScore: 2 });

    expect(outcomesAt(store, { roundNumber: 1, matchNumber: 1 })).toEqual([MatchSideOutcome.LOST, MatchSideOutcome.WON]);
    expect(expectDefined(store.matchRows.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).games).toEqual(before);
  });
});

describe('MatchResultService shoot-outs (#791)', () => {
  it('saves a soccer bracket match level after extra time with its shoot-out, the shoot-out\'s winner moving on', async () => {
    const { service, event, vermont } = await setup({ sport: Sport.SOCCER });

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4 });

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({
      status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4,
    });
    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))?.homeSportEventParticipantId).toBe(vermont.id);
  });

  it('refuses (422 MATCH_RESULT_INVALID) a soccer bracket match left level with no shoot-out', async () => {
    const { service, event } = await setup({ sport: Sport.SOCCER });

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1 }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
  });

  it('refuses (422 MATCH_RESULT_INVALID) shoot-out scores on a game its slot lets end level, and saves nothing', async () => {
    const { service, event, store } = await setup();
    // A slot whose games can end level never settles one by shoot-out (#2046: the slot's canEndTied).
    for (const match of store.matchRows) match.slot = { ...match.slot, canEndTied: true };

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 70, homeShootoutScore: 4, awayShootoutScore: 3 }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('saves a result sent without shoot-out scores as having no shoot-out', async () => {
    const { service, event } = await setup();

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ homeShootoutScore: null, awayShootoutScore: null });
  });

});

describe('describeScoreProblem with shoot-outs (#791)', () => {
  // A slot whose games cannot end level settles a level score by shoot-out (#2046: the slot's canEndTied).
  const penalties = { inBracket: true, canEndTied: false };
  const level = { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1 };
  const kicks = (homeShootoutScore: number | null, awayShootoutScore: number | null) => ({ homeShootoutScore, awayShootoutScore });
  const problem = (result: HomeAwayResultRequest, shootout: ReturnType<typeof kicks>, rules: { inBracket: boolean; canEndTied: boolean }) =>
    describeScoreProblem(homeAwayResult({ ...result, ...shootout }), rules);

  it('accepts a level bracket match whose winner has the higher shoot-out score', () => {
    expect(problem(level, kicks(3, 4), penalties)).toBeNull();
    expect(problem({ ...level, winnerSide: MatchSide.HOME }, kicks(5, 4), penalties)).toBeNull();
  });

  it('accepts a decided match with no shoot-out, and a winner with no scores at all', () => {
    expect(problem({ winnerSide: MatchSide.HOME, homeScore: 2, awayScore: 1 }, kicks(null, null), penalties)).toBeNull();
    expect(problem({ winnerSide: MatchSide.HOME, homeScore: null, awayScore: null }, kicks(null, null), penalties)).toBeNull();
  });

  it.each([
    ['a level score with no shoot-out', level, kicks(null, null), 'a level score needs both shoot-out scores'],
    ['a level score with one shoot-out score', level, kicks(null, 4), 'a level score needs both shoot-out scores'],
    ['a winner who lost the shoot-out', level, kicks(4, 3), 'the winner\'s shoot-out score must be higher than the loser\'s'],
    ['a shoot-out after a decided score', { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 2 }, kicks(3, 4), 'a shoot-out is only held after a level score'],
    ['a shoot-out with no match score', { winnerSide: MatchSide.AWAY, homeScore: null, awayScore: null }, kicks(3, 4), 'a shoot-out needs the score after extra time, level'],
  ])('refuses %s where the game cannot end level', (_label, result, shootout, message) => {
    expect(problem(result, shootout, penalties)).toBe(message);
  });

  it('refuses a shoot-out, and a winner on a level score, where the game can end level', () => {
    const canEndLevel = { inBracket: false, canEndTied: true };

    expect(problem(level, kicks(3, 4), canEndLevel)).toBe('a game that can end level is never settled by a shoot-out');
    expect(problem(level, kicks(null, null), canEndLevel)).toBe('the winner\'s score must be higher than the loser\'s');
  });

  it('accepts a tie, both scores level, only where the game can end level and outside a bracket', () => {
    const tie = { winnerSide: null, homeScore: 1, awayScore: 1 };

    expect(problem(tie, kicks(null, null), { inBracket: false, canEndTied: true })).toBeNull();
    expect(problem(tie, kicks(null, null), { inBracket: false, canEndTied: false })).toBe('this game cannot end level');
    expect(problem(tie, kicks(null, null), { inBracket: true, canEndTied: true })).toBe('a bracket match always has a winner');
    expect(problem({ ...tie, awayScore: 2 }, kicks(null, null), { inBracket: false, canEndTied: true })).toBe('a tie needs both scores, level');
  });
});

describe('MatchResultService matches that ended early (#704)', () => {
  it('saves a retirement whose winner trailed when it stopped, sends the winner on and puts the player who retired out', async () => {
    const { service, event, duke, vermont, standingOf } = await setup();

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 0, ending: MatchEnding.RETIREMENT });

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 0, ending: MatchEnding.RETIREMENT });
    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))?.homeSportEventParticipantId).toBe(vermont.id);
    expect(standingOf(duke.id)).toMatchObject({ status: ParticipantStandingStatus.ELIMINATED });
  });

  it('saves a walkover with no score as a full win that sends its winner on', async () => {
    const { service, event, duke } = await setup();

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER });

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER });
    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))?.homeSportEventParticipantId).toBe(duke.id);
  });

  it('saves a result sent without an ending as played to its end', async () => {
    const { service, event } = await setup();

    const bracket = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(bracket.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))?.ending).toBe(MatchEnding.PLAYED);
  });

  it('puts a match back to played when a result that ended early is re-sent without an ending', async () => {
    const { service, event } = await setup();
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.DEFAULT });

    const resent = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(resent.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 }))?.ending).toBe(MatchEnding.PLAYED);
  });

  it('refuses (422 MATCH_RESULT_INVALID) a walkover with a score, and saves nothing', async () => {
    const { service, event, store } = await setup();

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 1, awayScore: 0, ending: MatchEnding.WALKOVER }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('refuses (422 MATCH_RESULT_INVALID) a walkover for a game that already has quarter scores', async () => {
    const { service, event } = await setup({ sport: Sport.FOOTBALL });
    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 0 });

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
  });

  it('refuses (422 MATCH_PERIOD_SCORE_INVALID) a quarter score for a game that was a walkover', async () => {
    const { service, event } = await setup({ sport: Sport.FOOTBALL });
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending: MatchEnding.WALKOVER });

    await expect(service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'MATCH_PERIOD_SCORE_INVALID', statusCode: 422 });
  });
});

describe('describeScoreProblem for matches that ended early (#704)', () => {
  const bracket = { inBracket: true, canEndTied: false };
  const problem = (result: HomeAwayResultRequest, shootout: { homeShootoutScore: number | null; awayShootoutScore: number | null }, rules: { inBracket: boolean; canEndTied: boolean }) =>
    describeScoreProblem(homeAwayResult({ ...result, ...shootout }), rules);
  const noKicks = { homeShootoutScore: null, awayShootoutScore: null };

  it.each([MatchEnding.RETIREMENT, MatchEnding.DEFAULT])('accepts a %s whose winner\'s score is lower, level or missing', (ending) => {
    expect(problem({ winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 1, ending }, noKicks, bracket)).toBeNull();
    expect(problem({ winnerSide: MatchSide.HOME, homeScore: 1, awayScore: 1, ending }, noKicks, bracket)).toBeNull();
    expect(problem({ winnerSide: MatchSide.HOME, homeScore: null, awayScore: null, ending }, noKicks, bracket)).toBeNull();
  });

  it('still refuses a played match whose winner\'s score is lower', () => {
    expect(problem({ winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 1, ending: MatchEnding.PLAYED }, noKicks, bracket))
      .toBe('the winner\'s score must be higher than the loser\'s');
  });

  it.each([
    ['a retirement with one score', { winnerSide: MatchSide.HOME, homeScore: 1, awayScore: null, ending: MatchEnding.RETIREMENT }, noKicks, bracket, 'give both scores or neither'],
    ['a walkover with scores', { winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 0, ending: MatchEnding.WALKOVER }, noKicks, bracket, 'a walkover has no score'],
    ['a tie that ended early', { winnerSide: null, homeScore: 1, awayScore: 1, ending: MatchEnding.RETIREMENT }, noKicks, { inBracket: false, canEndTied: true }, 'a tie is played to its end'],
    ['a shoot-out after a retirement', { winnerSide: MatchSide.HOME, homeScore: 1, awayScore: 1, ending: MatchEnding.RETIREMENT }, { homeShootoutScore: 4, awayShootoutScore: 3 }, { inBracket: true, canEndTied: false }, 'a match that ended early has no shoot-out'],
  ])('refuses %s', (_label, result, shootout, rules, message) => {
    expect(problem(result, shootout, rules)).toBe(message);
  });
});

// #715: a postponed regular-season game is cancelled in its week and added to the week it moves to.
describe('MatchResultService.cancelMatch', () => {
  it('cancels a game of a released week that has not been played, as the feed\'s doing, leaving the week\'s other game as it was', async () => {
    const { service, event } = await week();

    const games = await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 });

    expect(games.map((game) => [game.matchNumber, game.status, game.winnerSide])).toEqual([
      [1, MatchStatus.CANCELLED, null],
      [2, MatchStatus.SCHEDULED, null],
    ]);
  });

  it('writes the job settling the squares contests on the game with its cancellation, so they end Final with no scores', async () => {
    const { store, event } = await week();
    const settlement = gameSettlement();
    const matches = store.matchRepo();
    const applyResult = jest.spyOn(matches, 'applyResult');
    const service = new HomeAwayResults({
      sportEvents: store.sportEventRepo(),
      matches,
      contestActivation: { activateContestsPastCutoff: noActivation() },
      domainEvents: settlement.domainEvents,
      now: () => AS_OF,
    });

    await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 });

    expect(settlement.decided(event.id, 'game-1')).toHaveLength(1);
    expect(applyResult).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ status: MatchStatus.CANCELLED }), jobs: [settleGameJob(event.id, 'game-1'), eventRebuildJob(event.id), slotTiebreakersRefreshJob(event.id), slotStatusRefreshJob(event.id)] }));
    expect(settlement.queued).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the game is already cancelled', async () => {
    const { service, event } = await week();
    await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 });

    const games = await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 });

    expect(games.find((game) => isAtPlace(game, { roundNumber: 1, matchNumber: 1 }))?.status).toBe(MatchStatus.CANCELLED);
  });

  it('refuses (409 MATCH_ALREADY_PLAYED) a game with a result: its result is cleared first', async () => {
    const { service, event } = await week();
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    await expect(service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 })).rejects.toMatchObject({ code: 'MATCH_ALREADY_PLAYED', statusCode: 409 });
  });

  it('refuses (422 MATCH_IN_BRACKET) a bracket game, which sends its winner on or takes a team from an earlier game', async () => {
    const { service, event } = await setup();

    await expect(service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 })).rejects.toMatchObject({ code: 'MATCH_IN_BRACKET', statusCode: 422 });
    await expect(service.cancelMatch(event.id, { roundNumber: 2, matchNumber: 1 })).rejects.toMatchObject({ code: 'MATCH_IN_BRACKET', statusCode: 422 });
  });

  it('refuses (409 SPORT_EVENT_NOT_RELEASED) a game of a draft week, whose games are still edited freely', async () => {
    const { service, event } = await week();
    event.status = SportEventStatus.DRAFT;

    await expect(service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 })).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
  });
});

// #772: the score at the end of each quarter but the last, as the scoreboard shows it. The final
// score, overtime included, is the game's result.
describe('MatchResultService period scores', () => {
  it('saves the score at the end of a quarter while the game is played, keeping the quarters in order', async () => {
    const { service, event } = await week();

    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 2, { homeScore: 10, awayScore: 7 });
    const games = await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 3, awayScore: 0 });

    expect(games.find((game) => isAtPlace(game, { roundNumber: 1, matchNumber: 1 }))?.periodScores).toEqual([
      { periodNumber: 1, homeScore: 3, awayScore: 0 },
      { periodNumber: 2, homeScore: 10, awayScore: 7 },
    ]);
    expect(games.find((game) => isAtPlace(game, { roundNumber: 1, matchNumber: 2 }))?.periodScores).toEqual([]);
  });

  it('replaces a quarter\'s score when it is entered again, and corrects it after the game is final', async () => {
    const { service, event } = await week();
    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 3, { homeScore: 14, awayScore: 3 });
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 24, awayScore: 10 });

    const games = await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 3, { homeScore: 17, awayScore: 3 });

    expect(games.find((game) => isAtPlace(game, { roundNumber: 1, matchNumber: 1 }))?.periodScores).toEqual([{ periodNumber: 3, homeScore: 17, awayScore: 3 }]);
  });

  it('writes the job settling the squares contests on a finished game with a quarter\'s score entered after its result, and none with one entered before it', async () => {
    const { store, event } = await week();
    const settlement = gameSettlement();
    const matches = store.matchRepo();
    const saveGamePeriodScores = jest.spyOn(matches, 'saveGamePeriodScores');
    const service = new HomeAwayResults({
      sportEvents: store.sportEventRepo(),
      matches,
      contestActivation: { activateContestsPastCutoff: noActivation() },
      domainEvents: settlement.domainEvents,
      now: () => AS_OF,
    });
    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 0 });
    expect(saveGamePeriodScores).toHaveBeenLastCalledWith(gamePeriods([[1, 7, 0]]), [eventRebuildJob(event.id)]);
    expect(settlement.decided(event.id, 'game-1')).toHaveLength(0);
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 24, awayScore: 10 });
    settlement.queued.mockClear();

    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 3, { homeScore: 17, awayScore: 3 });

    // Decided twice: by its result, then by the quarter entered after it.
    expect(settlement.decided(event.id, 'game-1')).toHaveLength(2);
    // Each side's own points per quarter: the third's are its running score less the first's.
    expect(saveGamePeriodScores).toHaveBeenLastCalledWith(gamePeriods([[1, 7, 0], [3, 10, 3]]), [settleGameJob(event.id, 'game-1'), eventRebuildJob(event.id), slotTiebreakersRefreshJob(event.id)]);
    expect(settlement.queued).toHaveBeenCalledTimes(1);
  });

  it('refuses (422 MATCH_PERIOD_SCORE_INVALID) a score below an earlier quarter\'s or above a later quarter\'s or the final score', async () => {
    const { service, event } = await week();
    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 3 });
    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 3, { homeScore: 14, awayScore: 10 });
    const refused = { code: 'MATCH_PERIOD_SCORE_INVALID', statusCode: 422 };

    await expect(service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 2, { homeScore: 7, awayScore: 0 })).rejects.toMatchObject(refused);
    await expect(service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 2, { homeScore: 17, awayScore: 3 })).rejects.toMatchObject(refused);
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 21, awayScore: 10 });
    await expect(service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 3, { homeScore: 24, awayScore: 10 })).rejects.toMatchObject(refused);
  });

  it('refuses (422 MATCH_RESULT_INVALID) a final score below a side\'s score at the end of a quarter', async () => {
    const { service, event } = await week();
    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 3, { homeScore: 14, awayScore: 10 });

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 13, awayScore: 10 }))
      .rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
  });

  it('refuses (422 MATCH_PERIOD_INVALID) the last quarter, whose score is the final result, and the last half of a slot played in halves', async () => {
    const football = await week();
    await expect(football.service.recordPeriodScore(football.event.id, { roundNumber: 1, matchNumber: 1 }, 4, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'MATCH_PERIOD_INVALID', statusCode: 422 });

    const college = await setup({ periods: { unit: PeriodUnit.HALF, count: 2 } });
    await college.service.recordPeriodScore(college.event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 40, awayScore: 38 });
    await expect(college.service.recordPeriodScore(college.event.id, { roundNumber: 1, matchNumber: 1 }, 2, { homeScore: 70, awayScore: 66 }))
      .rejects.toMatchObject({ code: 'MATCH_PERIOD_INVALID', statusCode: 422 });

    const quarters = await setup();
    await quarters.service.recordPeriodScore(quarters.event.id, { roundNumber: 1, matchNumber: 1 }, 3, { homeScore: 60, awayScore: 58 });
  });

  it('refuses (409 MATCH_CANCELLED) a cancelled game, and (409 SPORT_EVENT_NOT_RELEASED) a game of a draft week', async () => {
    const { service, event } = await week();
    await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 2 });
    await expect(service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 2 }, 1, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'MATCH_CANCELLED', statusCode: 409 });

    event.status = SportEventStatus.DRAFT;
    await expect(service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED', statusCode: 409 });
  });
});

describe('MatchResultService period scores — refusals and clock', () => {
  it('refuses (422 MATCH_PERIOD_INVALID) a period score for a game whose slot keeps none, naming the game', async () => {
    const { service, event } = await setup({ periods: null });

    await expect(service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 1, awayScore: 0 }))
      .rejects.toMatchObject({ code: 'MATCH_PERIOD_INVALID', statusCode: 422, message: 'Round 1 match 1 keeps no score by period.' });
  });

  it('refuses (422 MATCH_SIDES_NOT_SET) a period score for a game still waiting for a team, and saves nothing', async () => {
    const { service, event, store } = await setup();

    await expect(service.recordPeriodScore(event.id, { roundNumber: 2, matchNumber: 1 }, 1, { homeScore: 20, awayScore: 18 }))
      .rejects.toMatchObject({ code: 'MATCH_SIDES_NOT_SET', statusCode: 422 });
    expect(store.matchRows.map(homeAwayOf).find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 }))?.periodScores).toEqual([]);
  });

  it('stamps results, cancellations and period scores with the current time when it has no clock of its own', async () => {
    const { store, event } = await week();
    const service = new HomeAwayResults({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo() });
    const before = Date.now();

    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 0 });
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);
    await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 2 });

    const after = Date.now();
    const stamps = store.standingRows.flatMap((row) => (row.asOf === null ? [] : [row.asOf.getTime()]));
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps.every((stamp) => stamp >= before && stamp <= after)).toBe(true);
    expect(store.matchRows.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 2 }))?.status).toBe(MatchStatus.CANCELLED);
  });
});

describe('MatchResultService on a week of games that form no bracket', () => {
  it('ranks no team on a week\'s result: both teams of the played game COMPLETE with no place, the teams still to play ACTIVE', async () => {
    const { service, event, bills, jets, chiefs, raiders, standingOf } = await week();

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    for (const team of [bills, jets]) {
      expect(standingOf(team.id)).toMatchObject({ position: null, displayPosition: null, status: ParticipantStandingStatus.COMPLETE });
    }
    for (const team of [chiefs, raiders]) {
      expect(standingOf(team.id)).toMatchObject({ position: null, displayPosition: null, status: ParticipantStandingStatus.ACTIVE });
    }
  });

  it('crowns no champion once every game of the week is played', async () => {
    const { service, event, bills, jets, chiefs, raiders, standingOf } = await week();

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 2 }, awayWins);

    expect([bills, jets, chiefs, raiders].map((team) => standingOf(team.id)?.position ?? null)).toEqual([null, null, null, null]);
  });

  it('records a tie (#792): the game COMPLETED with no winner and its level scores, both teams COMPLETE with no place', async () => {
    const { service, event, bills, jets, standingOf } = await week();

    const games = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: null, homeScore: 20, awayScore: 20 });

    expect(games.find((game) => isAtPlace(game, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: null, homeScore: 20, awayScore: 20 });
    for (const team of [bills, jets]) {
      expect(standingOf(team.id)).toMatchObject({ position: null, status: ParticipantStandingStatus.COMPLETE });
    }
  });

  it('changes a tie to a win and back, since a week\'s game sends nobody on', async () => {
    const { service, event } = await week();
    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: null, homeScore: 20, awayScore: 20 });

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 23, awayScore: 20 });
    const games = await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSide: null, homeScore: 23, awayScore: 23 });

    expect(games.find((game) => isAtPlace(game, { roundNumber: 1, matchNumber: 1 }))).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: null, homeScore: 23, awayScore: 23 });
  });

  it.each([
    ['without its scores', { winnerSide: null, homeScore: null, awayScore: null }],
    ['with one score only', { winnerSide: null, homeScore: 20, awayScore: null }],
    ['with scores that are not level', { winnerSide: null, homeScore: 21, awayScore: 20 }],
  ])('refuses (422 MATCH_RESULT_INVALID) a tie %s and saves nothing', async (_label, input) => {
    const { service, event, store } = await week();

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, input)).rejects.toMatchObject({ code: 'MATCH_RESULT_INVALID', statusCode: 422 });
    expect(store.matchRows.every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);
  });

  it('marks a cancelled game\'s teams COMPLETE with no place, since their week is over', async () => {
    const { service, event, bills, jets, standingOf } = await week();

    await service.cancelMatch(event.id, { roundNumber: 1, matchNumber: 1 });

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
    const event = store.addEvent({ sport: Sport.BASKETBALL, status: SportEventStatus.IN_PROGRESS });
    const [one, two, three, four, five, six] = [1, 2, 3, 4, 5, 6].map((seed) => {
      const team = store.addParticipant(sportRow.id, `Seed ${seed}`, { participantType: 'TEAM' });
      return store.addToField(event.id, team.id, { seedNumber: seed });
    });
    // Each match is named here by a key, its id `m<key>`; its place is its round and its number within the round (#2161).
    const match = (key: number, roundNumber: number, matchNumber: number, home: string | null, away: string | null, advancesTo: [string, MatchSide] | null) => (legacyMatch({
      id: `m${key}`, sportEventId: event.id, roundNumber, slot: bracketRoundSlots(3)[roundNumber - 1], matchNumber,
      homeSportEventParticipantId: home, awaySportEventParticipantId: away, isNeutralSite: false,
      scheduledDate: null, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED,
      advancesToMatchId: advancesTo?.[0] ?? null, advancesToSide: advancesTo?.[1] ?? null, regionLabel: null, homeSpread: null, completedAt: null, periodScores: [],
      createdAt: AS_OF, updatedAt: AS_OF,
    }));
    const [first, second, third, fourth, final] = finalFirst ? [3, 4, 5, 2, 1] : [1, 2, 3, 4, 5];
    store.matchRows.push(
      match(first, 1, 1, three.id, six.id, null),
      match(second, 1, 2, four.id, five.id, null),
      match(third, 2, 1, one.id, null, [`m${final}`, MatchSide.HOME]),
      match(fourth, 2, 2, two.id, null, [`m${final}`, MatchSide.AWAY]),
      match(final, 3, 1, null, null, null),
    );
    // Stored in key order, so with `finalFirst` the final's row comes first.
    store.matchRows.sort((left, right) => left.id.localeCompare(right.id));
    const service = new HomeAwayResults({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });
    const standingOf = (rowId: string) => store.standingRows.find((row) => row.sportEventParticipantId === rowId);
    const matchOf = (key: number) => expectMatch(store.matchRows.find((row) => row.id === `m${key}`));
    const placeOf = (key: number) => matchPlaceOf(matchOf(key));
    return { store, service, event, one, two, three, four, five, six, standingOf, matchOf, placeOf };
  }

  function expectMatch<T>(value: T | undefined): T {
    if (value === undefined) throw new Error('no such match');
    return value;
  }

  it('leaves a first-round winner unplaced but counts it into the next round, still alive', async () => {
    const { service, event, six, three, standingOf, matchOf, placeOf } = await reseeded();

    await service.recordResult(event.id, placeOf(1), awayWins);

    expect([homeAwayOf(matchOf(3)).awaySportEventParticipantId, homeAwayOf(matchOf(4)).awaySportEventParticipantId]).toEqual([null, null]);
    expect(standingOf(six.id)).toMatchObject({ status: ParticipantStandingStatus.ACTIVE });
    expect(standingOf(three.id)).toMatchObject({ status: ParticipantStandingStatus.ELIMINATED });
  });

  it('swaps the placed team when a first-round winner changes before the next round is played', async () => {
    const { service, event, three, six, matchOf, placeOf } = await reseeded();
    await service.recordResult(event.id, placeOf(1), awayWins);
    placeTeam(matchOf(3), MatchSide.AWAY, six.id);

    await service.recordResult(event.id, placeOf(1), homeWins);

    expect(homeAwayOf(matchOf(3)).awaySportEventParticipantId).toBe(three.id);
  });

  it('refuses (409 SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED) a new first-round winner once the match it was placed in has a result', async () => {
    const { service, event, six, matchOf, placeOf } = await reseeded();
    await service.recordResult(event.id, placeOf(1), awayWins);
    placeTeam(matchOf(3), MatchSide.AWAY, six.id);
    await service.recordResult(event.id, placeOf(3), homeWins);

    await expect(service.recordResult(event.id, placeOf(1), homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED', statusCode: 409 });
  });

  it('refuses (409 SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED) a new first-round winner once its next-round game is played, even when the final\'s row is stored first', async () => {
    const { service, event, six, matchOf, placeOf } = await reseeded({ finalFirst: true });
    await service.recordResult(event.id, placeOf(3), awayWins);
    placeTeam(matchOf(5), MatchSide.AWAY, six.id);
    await service.recordResult(event.id, placeOf(5), awayWins);
    expect(homeAwayOf(matchOf(1)).homeSportEventParticipantId).toBe(six.id);

    await expect(service.recordResult(event.id, placeOf(3), homeWins)).rejects.toMatchObject({ code: 'SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED', statusCode: 409 });
    expect([homeAwayOf(matchOf(5)).awaySportEventParticipantId, homeAwayOf(matchOf(1)).homeSportEventParticipantId]).toEqual([six.id, six.id]);
  });

  it('crowns the winner of the one match in the last round, not a first-round winner that links nowhere', async () => {
    const { service, event, one, two, six, five, standingOf, matchOf, placeOf } = await reseeded();
    await service.recordResult(event.id, placeOf(1), awayWins);
    await service.recordResult(event.id, placeOf(2), awayWins);
    placeTeam(matchOf(3), MatchSide.AWAY, six.id);
    placeTeam(matchOf(4), MatchSide.AWAY, five.id);
    await service.recordResult(event.id, placeOf(3), homeWins);
    await service.recordResult(event.id, placeOf(4), homeWins);

    await service.recordResult(event.id, placeOf(5), awayWins);

    expect(standingOf(two.id)).toMatchObject({ position: 1, status: ParticipantStandingStatus.COMPLETE });
    expect(standingOf(one.id)).toMatchObject({ position: 2, status: ParticipantStandingStatus.ELIMINATED });
    expect(standingOf(six.id)?.status).toBe(ParticipantStandingStatus.ELIMINATED);
  });
});

describe('MatchResultService on a bracket numbered within each round (#2161)', () => {
  it('advances a winner to the match its link names, round 2\'s match 2, not round 2\'s match 1, past a round whose first game is between two byes', async () => {
    const store = new InMemorySportEvents();
    const sportRow = store.addSport(Sport.BASKETBALL);
    const event = store.addEvent({ sport: Sport.BASKETBALL, status: SportEventStatus.IN_PROGRESS });
    const [one, two, three, five, six] = [1, 2, 3, 5, 6].map((seed) => store.addToField(event.id, store.addParticipant(sportRow.id, `Seed ${seed}`, { participantType: 'TEAM' }).id, { seedNumber: seed }));
    const match = (id: string, roundNumber: number, matchNumber: number, home: string | null, away: string | null, advancesTo: [string, MatchSide] | null) => (legacyMatch({
      id, sportEventId: event.id, roundNumber, slot: bracketRoundSlots(3)[roundNumber - 1], matchNumber,
      homeSportEventParticipantId: home, awaySportEventParticipantId: away, isNeutralSite: false,
      scheduledDate: null, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED,
      advancesToMatchId: advancesTo?.[0] ?? null, advancesToSide: advancesTo?.[1] ?? null, regionLabel: null, homeSpread: null, completedAt: null, periodScores: [],
      createdAt: AS_OF, updatedAt: AS_OF,
    }));
    // Round 1 is one play-in game; the 1 and 2 seeds' byes meet in round 2's match 1.
    store.matchRows.push(
      match('play-in', 1, 1, five.id, six.id, ['semi-2', MatchSide.AWAY]),
      match('semi-1', 2, 1, one.id, two.id, ['final', MatchSide.HOME]),
      match('semi-2', 2, 2, three.id, null, ['final', MatchSide.AWAY]),
      match('final', 3, 1, null, null, null),
    );
    const service = new HomeAwayResults({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, awayWins);

    const byId = (id: string) => store.matchRows.find((row) => row.id === id);
    expect(homeAwayOf(expectDefined(byId('semi-2')))).toMatchObject({ homeSportEventParticipantId: three.id, awaySportEventParticipantId: six.id });
    expect(homeAwayOf(expectDefined(byId('semi-1')))).toMatchObject({ homeSportEventParticipantId: one.id, awaySportEventParticipantId: two.id });
  });
});

describe('MatchResultService — leaderboard rebuild (#1466)', () => {
  /** The context's store, with a service that hands each write the event's rebuild. */
  function rebuilding(store: InMemorySportEvents, contestActivation: ConstructorParameters<typeof MatchResultService>[0]['contestActivation'] = NO_CONTEST_ACTIVATION) {
    const domainEvents = new RecordingDomainEvents();
    const service = new HomeAwayResults({ sportEvents: store.sportEventRepo(), matches: store.matchRepo(), contestActivation, domainEvents, now: () => AS_OF });
    return { service, domainEvents };
  }

  it('writes the rebuild job with a result, after the game\'s settling job, and wakes both once the result is written', async () => {
    const { store, event } = await setup();
    const { service, domainEvents } = rebuilding(store);

    await service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);

    expect(store.backgroundJobs).toEqual([settleGameJob(event.id, 'match-1'), eventRebuildJob(event.id), slotTiebreakersRefreshJob(event.id), slotStatusRefreshJob(event.id)]);
    expect(domainEvents.changedSportEventIds).toEqual([event.id]);
  });

  it('writes the rebuild job with a result and with a cancelled game', async () => {
    const context = await setup();
    const { service, domainEvents } = rebuilding(context.store);
    await service.recordResult(context.event.id, { roundNumber: 1, matchNumber: 1 }, homeWins);
    const games = await week();
    const weekly = rebuilding(games.store);
    await weekly.service.cancelMatch(games.event.id, { roundNumber: 1, matchNumber: 1 });

    // The result and the cancellation decide their games, so each also settles the game's squares contests.
    expect(context.store.backgroundJobs).toEqual([settleGameJob(context.event.id, 'match-1'), eventRebuildJob(context.event.id), slotTiebreakersRefreshJob(context.event.id), slotStatusRefreshJob(context.event.id)]);
    expect(domainEvents.changedSportEventIds).toEqual([context.event.id]);
    expect(games.store.backgroundJobs).toEqual([settleGameJob(games.event.id, 'game-1'), eventRebuildJob(games.event.id), slotTiebreakersRefreshJob(games.event.id), slotStatusRefreshJob(games.event.id)]);
    expect(weekly.domainEvents.changedSportEventIds).toEqual([games.event.id]);
  });

  it('writes the rebuild job with a quarter score saved', async () => {
    const { store, event } = await setup({ sport: Sport.FOOTBALL });
    const { service, domainEvents } = rebuilding(store);

    await service.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, { homeScore: 7, awayScore: 0 });

    expect(store.backgroundJobs).toEqual([eventRebuildJob(event.id)]);
    expect(domainEvents.changedSportEventIds).toEqual([event.id]);
  });

  it('wakes no runner when the result write carrying the rebuild fails', async () => {
    const { store, event } = await setup();
    const matches = { ...store.matchRepo(), applyResult: () => Promise.reject(new Error('result write failed')) };
    const domainEvents = new RecordingDomainEvents();
    const service = new HomeAwayResults({ contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches, domainEvents, now: () => AS_OF });

    await expect(service.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, homeWins)).rejects.toThrow('result write failed');
    expect(domainEvents.handedOutSportEventIds).toEqual([event.id]);
    expect(domainEvents.changedSportEventIds).toEqual([]);
  });
});

describe('MatchResultService on matches missing a Game or a side (#2046)', () => {
  /** The week with its first game's Game 1 taken away, and the service by side number. */
  async function weekWithoutGameOne() {
    const setUp = await week();
    const first = expectDefined(setUp.store.matchRows.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 })));
    first.games = [];
    const bySide = new MatchResultService({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: setUp.store.sportEventRepo(), matches: setUp.store.matchRepo(), now: () => AS_OF });
    return { ...setUp, first, bySide };
  }

  it('fails, saving nothing, on a period score for a match with no Game 1, which every loaded match has', async () => {
    const { event, first, bySide } = await weekWithoutGameOne();

    await expect(bySide.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, [{ sideNumber: 1, score: 0 }, { sideNumber: 2, score: 7 }]))
      .rejects.toThrow(`Match ${first.id} has no Game 1`);
    expect(first.games).toEqual([]);
  });

  it('completes a match with no Game 1 with its winner, writing no Game\'s scores', async () => {
    const { event, bySide } = await weekWithoutGameOne();

    const after = await bySide.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSideNumber: 2, sides: [{ sideNumber: 1, score: 7 }, { sideNumber: 2, score: 14 }] });

    const first = expectDefined(after.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 })));
    expect([first.status, first.sides.map((side) => side.outcome), first.games]).toEqual([MatchStatus.COMPLETED, [MatchSideOutcome.LOST, MatchSideOutcome.WON], []]);
  });

  it('leaves a side\'s Game 1 score as it was when a walkover names no side\'s score', async () => {
    const { store, event } = await week();
    const bySide = new MatchResultService({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });

    const after = await bySide.recordResult(event.id, { roundNumber: 1, matchNumber: 1 }, { winnerSideNumber: 2, sides: [], ending: MatchEnding.WALKOVER });

    const first = expectDefined(after.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 })));
    expect([first.ending, first.games[0]?.sideResults.map((result) => result.score)]).toEqual([MatchEnding.WALKOVER, [null, null]]);
  });

  it('counts a side a period score leaves out as 0 at the end of that period', async () => {
    const { store, event } = await week();
    const bySide = new MatchResultService({ domainEvents: testDomainEvents(), contestActivation: NO_CONTEST_ACTIVATION, sportEvents: store.sportEventRepo(), matches: store.matchRepo(), now: () => AS_OF });

    const after = await bySide.recordPeriodScore(event.id, { roundNumber: 1, matchNumber: 1 }, 1, [{ sideNumber: 2, score: 7 }]);

    expect(homeAwayOf(expectDefined(after.find((match) => isAtPlace(match, { roundNumber: 1, matchNumber: 1 })))).periodScores).toEqual([{ periodNumber: 1, homeScore: 7, awayScore: 0 }]);
  });

  it('refuses a winner that is not one of the match\'s sides', () => {
    expect(describeScoreProblem({ winnerSideNumber: 3, sides: [{ sideNumber: 1, score: 1 }, { sideNumber: 2, score: 0 }] }, { inBracket: true, canEndTied: false }))
      .toBe('the winner must be one of the match\'s sides');
  });

  it('gives a week\'s side with no team yet no standing, and its other side one', () => {
    const match = legacyMatch({ id: 'm', homeSportEventParticipantId: 'home-team', status: MatchStatus.SCHEDULED });

    expect(gameStandings([match], AS_OF).map((row) => [row.sportEventParticipantId, row.status])).toEqual([['home-team', ParticipantStandingStatus.ACTIVE]]);
  });
});
