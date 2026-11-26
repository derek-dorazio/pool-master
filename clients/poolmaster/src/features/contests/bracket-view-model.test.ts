import { describe, expect, it } from 'vitest';
import { bracketGroups, bracketHalves, drawBracket, openingRoundIndex, splitMiddle } from './bracket-view-model';
import { TEAMS, emptyBracketGames, filledBracketGames, gamePick } from './test/bracket-fixtures';
import { midTournamentGames, tournamentGames } from './test/bracket-tournament-fixture';



function lineOf(drawing: ReturnType<typeof drawBracket>, matchNumber: number, name: string) {
  const game = bracketGroups(drawing).flatMap((group) => group.rounds.flatMap((round) => round.games))
    .find((drawn) => drawn.game.matchNumber === matchNumber);
  const line = game?.lines.find((candidate) => candidate.team?.name === name);
  if (!line) throw new Error(`No ${name} in game ${matchNumber}`);
  return line;
}

describe('drawBracket', () => {
  it('groups a four-region bracket by region in the order the bracket lists them, with the Final Four and final in the middle', () => {
    const drawing = drawBracket(midTournamentGames());

    expect(drawing.regions.map((region) => region.label)).toEqual(['South', 'East', 'West', 'Midwest']);
    expect(drawing.regions[0].rounds.map((round) => [round.label, round.games.length])).toEqual([
      ['First Round', 8], ['Round of 32', 4], ['Sweet 16', 2], ['Elite Eight', 1],
    ]);
    expect(drawing.middle?.label).toBe('Final Four');
    expect(drawing.middle?.rounds.map((round) => [round.label, round.games.length])).toEqual([['Final Four', 2], ['National Championship', 1]]);
  });

  it('puts the first and third regions on the left half and the second and fourth on the right, so each meets its semifinal opponent', () => {
    const { left, right } = bracketHalves(drawBracket(midTournamentGames()));

    expect(left.map((region) => region.label)).toEqual(['South', 'West']);
    expect(right.map((region) => region.label)).toEqual(['East', 'Midwest']);
  });

  it('leaves the bracket\'s own first round plain, and marks a later line green when the pick that sent its team there was right', () => {
    const drawing = drawBracket(midTournamentGames());

    expect(lineOf(drawing, 1, 'Auburn').mark).toBe('none');
    // Auburn won its first-round game (1), as picked, so its line in the Round of 32 game is right.
    expect(lineOf(drawing, 33, 'Auburn').mark).toBe('right');
  });

  it('marks a line wrong when the pick that sent its team there lost, with the team that really won the place', () => {
    const drawing = drawBracket(midTournamentGames());

    // The entry picked Michigan over UC San Diego in game 3; UC San Diego won.
    const michigan = lineOf(drawing, 34, 'Michigan');
    expect(michigan.mark).toBe('wrong');
    expect(michigan.actual?.name).toBe('UC San Diego');
  });

  it('marks a later pick whose team is already out wrong before its own game is played, with no real winner yet to show', () => {
    const drawing = drawBracket(tournamentGames({ playedRounds: 1, realUpsets: [[1, 'UC San Diego']], upsets: [[2, 'Michigan']] }));

    // Michigan is out after the first round; the entry still has it in the Sweet 16.
    const michigan = lineOf(drawing, 49, 'Michigan');
    expect(michigan.mark).toBe('wrong');
    expect(michigan.actual).toBeNull();
  });

  it('leaves every line plain before any game is played', () => {
    const drawing = drawBracket(tournamentGames({ playedRounds: 0 }));
    const marks = new Set(bracketGroups(drawing).flatMap((group) => group.rounds.flatMap((round) => round.games.flatMap((game) => game.lines.map((line) => line.mark)))));

    expect([...marks]).toEqual(['none']);
  });

  it('marks the team the entry picked in each game, and waits an open line on the round before\'s winner', () => {
    const empty = drawBracket(emptyBracketGames());
    const final = empty.middle?.rounds.at(-1)?.games[0];
    expect(final?.lines.map((line) => [line.team, line.openLabel])).toEqual([[null, 'Final Four winner'], [null, 'Final Four winner']]);

    const filled = drawBracket(filledBracketGames());
    expect(filled.regions[0].rounds[0].games[0].lines.map((line) => [line.team?.name, line.isPicked])).toEqual([['Duke', true], ['Vermont', false]]);
  });

  it('names each region\'s winner as the entry picked it: its last game\'s pick', () => {
    const drawing = drawBracket(midTournamentGames());

    expect(drawing.regions.map((region) => region.winner?.team?.name)).toEqual(['Auburn', 'Duke', 'Florida', 'Kentucky']);
  });

  it('has no champion until the final is picked, then the final\'s pick, out once that pick is busted', () => {
    expect(drawBracket(emptyBracketGames()).champion).toBeNull();
    expect(drawBracket(filledBracketGames()).champion).toEqual({ team: TEAMS.duke, isOut: false });

    const busted = filledBracketGames().map((game) => (game.matchNumber === 7 ? { ...game, pick: gamePick(TEAMS.duke, { outcome: 'BUSTED', points: 0 }) } : game));
    expect(drawBracket(busted).champion).toEqual({ team: TEAMS.duke, isOut: true });
  });

  it('draws a bracket with no regions as its middle alone', () => {
    const games = emptyBracketGames().map((game) => ({ ...game, regionLabel: null }));
    const drawing = drawBracket(games);

    expect(drawing.regions).toEqual([]);
    expect(drawing.middle?.rounds).toHaveLength(3);
  });
});

describe('splitMiddle', () => {
  it('puts the first semifinal on the left, the second on the right and the final in the centre', () => {
    const drawing = drawBracket(midTournamentGames());
    const middle = drawing.middle;
    if (!middle) throw new Error('no middle');
    const { final, left, right } = splitMiddle(middle);

    expect(final?.game.roundNumber).toBe(6);
    expect(left.map((round) => round.games.map(({ lines }) => lines.map((line) => line.team?.name)))).toEqual([[['Auburn', 'Duke']]]);
    expect(right.map((round) => round.games.map(({ lines }) => lines.map((line) => line.team?.name)))).toEqual([[['Florida', 'Kentucky']]]);
  });

  it('splits every round before the final in two for a bracket with no regions, and leaves a lone final with no sides', () => {
    const drawing = drawBracket(emptyBracketGames().map((game) => ({ ...game, regionLabel: null })));
    const middle = drawing.middle;
    if (!middle) throw new Error('no middle');
    const { left, right } = splitMiddle(middle);

    expect(left.map((round) => round.games.map(({ game }) => game.matchNumber))).toEqual([[1, 2], [5]]);
    expect(right.map((round) => round.games.map(({ game }) => game.matchNumber))).toEqual([[3, 4], [6]]);
    expect(splitMiddle({ rounds: middle.rounds.slice(-1) })).toMatchObject({ left: [], right: [] });
  });
});

describe('openingRoundIndex', () => {
  it('opens a phone\'s region at the round being played, keeping two rounds on screen', () => {
    const drawing = drawBracket(midTournamentGames());

    // Through the Sweet 16: the Elite Eight is next, the last round, so the last pair opens.
    expect(openingRoundIndex(drawing.regions[0])).toBe(2);
    expect(openingRoundIndex(drawBracket(tournamentGames({ playedRounds: 1 })).regions[0])).toBe(1);
    expect(openingRoundIndex(drawBracket(tournamentGames({ playedRounds: 0 })).regions[0])).toBe(0);
  });

  it('opens on the last pair once every round is played', () => {
    expect(openingRoundIndex(drawBracket(tournamentGames({ playedRounds: 6 })).regions[0])).toBe(2);
  });
});

