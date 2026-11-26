import { describe, expect, it } from 'vitest';
import { HomeAway, MatchSide, MatchSideOutcome, PeriodKind } from '@poolmaster/shared/domain';
import { homeAwayMatchFixture } from '@/features/contests/test/match-fixtures';
import { billedSides, gameOne, isTied, opposingSide, regulationPeriodScores, sideOfTeam, teamOn, winningSide } from './match-sides';

describe('match sides', () => {
  it('bills the side playing game 1 away first, joined by "at", whichever side number it has', () => {
    const match = homeAwayMatchFixture({ home: 'chiefs', away: 'bills' });
    const swapped = {
      ...match,
      games: match.games.map((game) => ({
        ...game,
        sideResults: game.sideResults.map((result) => ({ ...result, homeAway: result.homeAway === HomeAway.HOME ? HomeAway.AWAY : HomeAway.HOME })),
      })),
    };

    expect(billedSides(match)).toMatchObject({ first: { sportEventParticipantId: 'bills' }, second: { sportEventParticipantId: 'chiefs' }, isNeutralSite: false });
    expect(billedSides(swapped)).toMatchObject({ first: { sportEventParticipantId: 'chiefs' }, second: { sportEventParticipantId: 'bills' }, isNeutralSite: false });
  });

  it('bills side 1 first as neutral, "vs", when neither side is home or away', () => {
    expect(billedSides(homeAwayMatchFixture({ home: 'duke', away: 'vermont', isNeutralSite: true })))
      .toMatchObject({ first: { sideNumber: 1, sportEventParticipantId: 'vermont' }, second: { sideNumber: 2 }, isNeutralSite: true });
  });

  it('reads the team on a side, the side a team plays, its opponent, the winner and a tie from the sides', () => {
    const won = homeAwayMatchFixture({ home: 'duke', away: 'vermont', status: 'COMPLETED', homeScore: 80, awayScore: 61 });
    const level = homeAwayMatchFixture({ home: 'duke', away: 'vermont', status: 'COMPLETED', homeScore: 1, awayScore: 1, winnerSide: null });

    expect([teamOn(won, 1), teamOn(won, 2), teamOn(won, 3)]).toEqual(['vermont', 'duke', null]);
    expect(sideOfTeam(won, 'duke')?.sideNumber).toBe(2);
    expect(opposingSide(won, 2)?.sportEventParticipantId).toBe('vermont');
    expect(winningSide(won)).toMatchObject({ sportEventParticipantId: 'duke', outcome: MatchSideOutcome.WON, score: 80 });
    expect([isTied(won), isTied(level), winningSide(level)]).toEqual([false, true, undefined]);
    expect(homeAwayMatchFixture({ winnerSide: MatchSide.AWAY, status: 'COMPLETED' }).sides.map((side) => side.outcome)).toEqual([MatchSideOutcome.WON, MatchSideOutcome.LOST]);
  });

  it('reads a side\'s regulation period scores by period number, leaving out overtime and the shoot-out', () => {
    const match = homeAwayMatchFixture({ home: 'a', away: 'b', periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 3 }, { periodNumber: 2, homeScore: 14, awayScore: 10 }] });
    const game = gameOne(match);
    const withOvertime = game && {
      ...game,
      sideResults: game.sideResults.map((result) => ({ ...result, periodScores: [...result.periodScores, { kind: PeriodKind.OVERTIME, periodNumber: 1, score: 20 }] })),
    };

    expect([...regulationPeriodScores(withOvertime, 2)]).toEqual([[1, 7], [2, 14]]);
    expect([...regulationPeriodScores(withOvertime, 1)]).toEqual([[1, 3], [2, 10]]);
    expect(regulationPeriodScores(undefined, 1).size).toBe(0);
  });
});
