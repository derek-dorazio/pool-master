import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { pickEmBoardGames, pickEmShownWeeks, pickEmWeekCell, pickLabel, reportMissingTeam, teamNameIn, teamNamesOf } from './pick-em-board';
import { pickEmEventFieldFixture, pickEmLeaderboardFixture, week2EventGamesFixture } from './test/pick-em-fixtures';

const teamName = teamNameIn(teamNamesOf(pickEmEventFieldFixture('week-2')));
const kickoff = (startsAt: string) => `kicks off ${startsAt}`;

describe('pickEmBoardGames', () => {
  it('lists the week\'s games in kickoff order, each named by its teams\' short names with its kickoff', () => {
    expect(pickEmBoardGames(week2EventGamesFixture(), teamName, kickoff)).toEqual([
      { id: 'week2-game-1', matchup: 'BUF at KC', progress: 'kicks off 2099-09-20T17:00:00.000Z' },
      { id: 'week2-game-2', matchup: 'DAL at PHI', progress: 'kicks off 2099-09-20T20:25:00.000Z' },
      { id: 'week2-game-3', matchup: 'CHI at GB', progress: 'kicks off 2099-09-22T00:15:00.000Z' },
    ]);
  });

  it('gives a played game\'s winner and score, a tie as a tie, a game under way as playing now, and leaves a cancelled game out', () => {
    const games = pickEmBoardGames(week2EventGamesFixture({
      1: { status: 'COMPLETED', winnerSide: 'AWAY', homeScore: 20, awayScore: 24 },
      2: { status: 'COMPLETED', winnerSide: null, homeScore: 17, awayScore: 17 },
      3: { status: 'IN_PROGRESS' },
    }), teamName, kickoff);

    expect(games.map((game) => game.progress)).toEqual(['BUF 24–⁠20', 'Tie 17–⁠17', 'Playing now']);
    expect(pickEmBoardGames(week2EventGamesFixture({ 2: { status: 'CANCELLED' } }), teamName, kickoff).map((game) => game.id)).toEqual(['week2-game-1', 'week2-game-3']);
  });

  it('says a neutral-site game is "vs", a game with no kickoff yet has its time to be set, and a side not decided is to be decided', () => {
    const [game] = pickEmBoardGames([{ ...week2EventGamesFixture()[1], isNeutralSite: true, scheduledDate: null, homeSportEventParticipantId: null }], teamName, kickoff);

    expect(game).toMatchObject({ matchup: 'BUF vs To be decided', progress: 'Time to be set' });
  });
});

describe('pickEmShownWeeks', () => {
  it('gives a column to every week under way or played and to the week the board is on, and none to a week still to come', () => {
    const board = pickEmLeaderboardFixture();
    const [week1, week2] = board.weeks;
    const weeks = [week1, { ...week2, started: false }, { ...week2, sportEventId: 'week-3', started: false }];

    expect(pickEmShownWeeks({ currentWeekId: 'week-1', weeks }).map((week) => week.sportEventId)).toEqual(['week-1']);
    expect(pickEmShownWeeks({ currentWeekId: 'week-2', weeks }).map((week) => week.sportEventId)).toEqual(['week-1', 'week-2']);
  });
});

describe('pickEmWeekCell', () => {
  const board = pickEmLeaderboardFixture();
  const [week1, week2] = board.weeks;
  const leader = board.entries[0];

  it('counts a week\'s picks right, with a medal for the top three and a peek with the place among the entries placed and the teams missed', () => {
    expect(pickEmWeekCell(week1, leader.weeks[0])).toEqual({
      text: '2',
      medal: '🥇',
      peek: { title: 'Week 1', facts: [{ label: 'Right', value: '2 of 3' }, { label: 'Place', value: '1st of 1' }, { label: 'Missed', value: 'BUF' }] },
    });
  });

  it('marks a shared place as tied, names a missed tie pick "Tie", says when nothing was missed, and gives no medal below third', () => {
    const cell = { ...leader.weeks[1], position: 4, displayPosition: 'T4', missedPicks: [{ teamName: null }] };

    expect(pickEmWeekCell(week2, cell)).toMatchObject({ medal: null, peek: { facts: [{ value: '1 of 3' }, { value: 'T4th of 2' }, { value: 'Tie' }] } });
    expect(pickEmWeekCell(week2, { ...cell, missedPicks: [] }).peek?.facts.at(-1)).toEqual({ label: 'Missed', value: 'None' });
  });

  it('leaves the place out of the peek of a week not placed yet', () => {
    expect(pickEmWeekCell(week2, { ...leader.weeks[1], position: null, displayPosition: null }).peek?.facts.map((fact) => fact.label)).toEqual(['Right', 'Missed']);
  });

  it('shows a dash, with no medal or peek, for a week the entry did not submit or that has not started', () => {
    const missed = board.entries[1].weeks[0];

    expect(pickEmWeekCell(week1, missed)).toEqual({ text: '—', medal: null, peek: null });
    expect(pickEmWeekCell(week1, undefined)).toEqual({ text: '—', medal: null, peek: null });
  });
});

describe('teamNameIn', () => {
  it('names a side not decided yet "To be decided", but shows a team the field does not hold as a dash and reports it', () => {
    const onMissing = vi.fn();
    const name = teamNameIn(new Map([['sep-chiefs', 'KC']]), onMissing);

    expect(name(null)).toBe('To be decided');
    expect(onMissing).not.toHaveBeenCalled();
    expect(name('sep-unknown')).toBe('—');
    expect(onMissing).toHaveBeenCalledWith('sep-unknown');
    expect(name('sep-chiefs')).toBe('KC');
  });
});

describe('reportMissingTeam', () => {
  it('logs a team missing from an event\'s field once, however many polls name it again', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    reportMissingTeam('week-9')('sep-gone');
    reportMissingTeam('week-9')('sep-gone');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ action: 'pickEm.team.missingFromField', data: { sportEventId: 'week-9', fieldRowId: 'sep-gone' } }, expect.any(String));
    warn.mockRestore();
  });
});

describe('pickLabel', () => {
  it('names a team pick by its team and a tie pick "Tie"', () => {
    expect(pickLabel('sep-chiefs', teamName)).toBe('KC');
    expect(pickLabel(null, teamName)).toBe('Tie');
  });
});
