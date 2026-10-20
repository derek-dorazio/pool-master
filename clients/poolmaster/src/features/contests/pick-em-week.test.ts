import { describe, expect, it } from 'vitest';
import {
  canChangeWeek,
  confidenceOptions,
  confidencePicks,
  currentWeekRound,
  describeMatchup,
  firstKickoff,
  isPlayoffSurvivor,
  isTeamUsed,
  missedWeek,
  roundWeek,
  survivorPickTeam,
  tiebreakerGame,
  weekSubmitHint,
} from './pick-em-week';
import { NFL_TEAMS, WEEK_1_START, pickEmWeekFixture, playoffSurvivorFixture, survivorWeekFixture, week1Games, weekPick } from './test/pick-em-fixtures';

const id = (team: { sportEventParticipantId: string }) => team.sportEventParticipantId;

describe('pick\'em week helpers', () => {
  it('names a game away team first, "at" the home team, or "vs" at a neutral site', () => {
    const [monday] = week1Games({ 1: {} });
    expect(describeMatchup(monday)).toBe('Bears at Packers');
    expect(describeMatchup({ ...monday, isNeutralSite: true })).toBe('Bears vs Packers');
  });

  it('finds the week\'s first kickoff whatever order the games come in, and none for a week with no games', () => {
    expect(firstKickoff(week1Games())).toBe(WEEK_1_START);
    expect(firstKickoff([])).toBeNull();
  });

  it('finds the tiebreaker game the server names, and none when it names none', () => {
    expect(tiebreakerGame(pickEmWeekFixture())?.sportEventMatchId).toBe('match-1');
    expect(tiebreakerGame(pickEmWeekFixture({ tiebreakerMatchId: null }))).toBeNull();
  });

  it('lets an own draft week change until its first kickoff, a submitted week until its last, and another entry never', () => {
    const firstGameStarted = week1Games({ 2: { locked: true } });
    expect(canChangeWeek(pickEmWeekFixture())).toBe(true);
    expect(canChangeWeek(pickEmWeekFixture({ games: firstGameStarted }))).toBe(false);
    expect(missedWeek(pickEmWeekFixture({ games: firstGameStarted }))).toBe(true);
    expect(canChangeWeek(pickEmWeekFixture({ games: firstGameStarted, status: 'SUBMITTED' }))).toBe(true);
    expect(missedWeek(pickEmWeekFixture({ games: firstGameStarted, status: 'SUBMITTED' }))).toBe(false);
    expect(canChangeWeek(pickEmWeekFixture({ games: week1Games({ 1: { locked: true }, 2: { locked: true }, 3: { locked: true } }), status: 'SUBMITTED' }))).toBe(false);
    expect(canChangeWeek(pickEmWeekFixture({ ownEntry: false }))).toBe(false);
  });

  it('swaps a confidence value with the open game holding it, giving that game the old value or none', () => {
    const games = week1Games({
      1: { pick: weekPick(NFL_TEAMS.packers, { confidence: 3 }) },
      2: { pick: weekPick(NFL_TEAMS.chiefs, { confidence: null }) },
    });
    expect(confidencePicks(games, games[1], 3)).toEqual([
      { sportEventMatchId: 'match-2', sportEventParticipantId: id(NFL_TEAMS.chiefs), confidence: 3 },
      { sportEventMatchId: 'match-1', sportEventParticipantId: id(NFL_TEAMS.packers), confidence: null },
    ]);
  });

  it('leaves a locked game\'s confidence value alone and saves the repeat, and saves nothing for a game with no pick', () => {
    const games = week1Games({
      2: { locked: true, pick: weekPick(NFL_TEAMS.chiefs, { confidence: 2 }) },
      3: { pick: weekPick(NFL_TEAMS.eagles, { confidence: 1 }) },
    });
    expect(confidencePicks(games, games[2], 2)).toEqual([
      { sportEventMatchId: 'match-3', sportEventParticipantId: id(NFL_TEAMS.eagles), confidence: 2 },
    ]);
    expect(confidencePicks(games, games[0], 1)).toEqual([]);
  });

  it('offers every confidence value largest first, leaving out the values on games that have kicked off', () => {
    const games = week1Games({
      1: { pick: weekPick(NFL_TEAMS.packers, { confidence: 1 }) },
      2: { locked: true, pick: weekPick(NFL_TEAMS.chiefs, { confidence: 3 }) },
      3: { pick: weekPick(NFL_TEAMS.eagles, { confidence: 2 }) },
    });
    const week = pickEmWeekFixture({ mode: 'CONFIDENCE', games });
    expect(confidenceOptions(week, games[0])).toEqual([2, 1]);
    expect(confidenceOptions(pickEmWeekFixture({ mode: 'CONFIDENCE' }), week1Games()[0])).toEqual([3, 2, 1]);
  });

  it('says what is left before a week can submit in the order to fix it: picks, then confidence values, then the tiebreaker', () => {
    expect(weekSubmitHint(pickEmWeekFixture())).toBe('Pick every game to submit: 3 still to pick.');
    const allPicked = (confidence: [number | null, number | null, number | null]) => week1Games({
      1: { pick: weekPick(NFL_TEAMS.packers, { confidence: confidence[0] }) },
      2: { pick: weekPick(NFL_TEAMS.chiefs, { confidence: confidence[1] }) },
      3: { pick: weekPick(NFL_TEAMS.eagles, { confidence: confidence[2] }) },
    });
    expect(weekSubmitHint(pickEmWeekFixture({ mode: 'CONFIDENCE', games: allPicked([1, null, null]) })))
      .toBe('Rank every pick from 1 to 3: 2 still to rank.');
    expect(weekSubmitHint(pickEmWeekFixture({ mode: 'CONFIDENCE', games: allPicked([1, 1, 2]) })))
      .toBe('Use each value from 1 to 3 once: a value is on more than one pick.');
    expect(weekSubmitHint(pickEmWeekFixture({ mode: 'CONFIDENCE', games: allPicked([1, 2, 3]) }))).toBe('Save your tiebreaker to submit.');
    expect(weekSubmitHint(pickEmWeekFixture({ games: allPicked([null, null, null]), tiebreakerValue: 41 }))).toBeNull();
  });
});

describe('survivor week helpers', () => {
  it('knows the teams used in another week, and names the week\'s one pick', () => {
    const week = survivorWeekFixture({ games: week1Games({ 3: { pick: weekPick(NFL_TEAMS.eagles) } }) });
    expect(isTeamUsed(week, NFL_TEAMS.bills)).toBe(true);
    expect(isTeamUsed(week, NFL_TEAMS.chiefs)).toBe(false);
    expect(survivorPickTeam(week)).toEqual(NFL_TEAMS.eagles);
    expect(survivorPickTeam(survivorWeekFixture())).toBeNull();
  });

  it('asks for one pick to submit, and nothing more once the week has it', () => {
    expect(weekSubmitHint(survivorWeekFixture())).toBe('Pick one team to submit.');
    expect(weekSubmitHint(survivorWeekFixture({ games: week1Games({ 3: { pick: weekPick(NFL_TEAMS.eagles) } }) }))).toBeNull();
  });

  it('lets an entry that is out change nothing, and keeps a pick whose game has kicked off as the week\'s', () => {
    expect(canChangeWeek(survivorWeekFixture({ survivor: { eliminatedInWeek: 1, usedParticipantIds: [] } }))).toBe(false);
    const kickedOff = week1Games({ 2: { locked: true, pick: weekPick(NFL_TEAMS.chiefs) } });
    expect(canChangeWeek(survivorWeekFixture({ status: 'SUBMITTED', games: kickedOff }))).toBe(false);
    expect(canChangeWeek(pickEmWeekFixture({ status: 'SUBMITTED', games: kickedOff }))).toBe(true);
  });
});

describe('playoff survivor helpers', () => {
  it('reads a survivor event with several rounds as a playoff, and a one-round week as a regular week', () => {
    expect(isPlayoffSurvivor(playoffSurvivorFixture())).toBe(true);
    expect(isPlayoffSurvivor(survivorWeekFixture())).toBe(false);
  });

  it('opens on the first round with a game still to kick off, and on the last round once every game has', () => {
    const playoff = playoffSurvivorFixture();
    expect(currentWeekRound(playoff)).toBe(2);
    expect(currentWeekRound({ games: playoff.games.map((game) => ({ ...game, locked: true })) })).toBe(2);
    expect(currentWeekRound({ games: playoff.games.map((game) => ({ ...game, locked: false })) })).toBe(1);
  });

  it('shows one round as its own week, counting its picks and marking teams picked in other rounds as used', () => {
    const round2 = roundWeek(playoffSurvivorFixture(), 2);
    expect(round2.games.map((game) => game.sportEventMatchId)).toEqual(['match-2', 'match-3']);
    expect(round2.gameCount).toBe(2);
    expect(round2.pickedCount).toBe(0);
    expect(isTeamUsed(round2, NFL_TEAMS.bills)).toBe(true);
    expect(isTeamUsed(round2, NFL_TEAMS.bears)).toBe(false);

    const round1 = roundWeek(playoffSurvivorFixture(), 1);
    expect(round1.pickedCount).toBe(1);
    expect(isTeamUsed(round1, NFL_TEAMS.bills)).toBe(false);
  });
});
