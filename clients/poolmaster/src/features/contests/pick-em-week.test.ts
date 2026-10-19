import { describe, expect, it } from 'vitest';
import {
  canChangeWeek,
  confidencePicks,
  describeMatchup,
  firstKickoff,
  missedWeek,
  tiebreakerGame,
  weekSubmitHint,
} from './pick-em-week';
import { NFL_TEAMS, WEEK_1_START, pickEmWeekFixture, week1Games, weekPick } from './test/pick-em-fixtures';

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
