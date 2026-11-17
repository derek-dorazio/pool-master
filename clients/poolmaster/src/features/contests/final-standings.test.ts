import { describe, expect, it } from 'vitest';
import { describeFinalStandings, type FinalRow } from './final-standings';

function row(entryName: string, position: number | null, points: number, isMine = false): FinalRow {
  return { entryName, isMine, position, score: `${String(points)} pts` };
}

describe('describeFinalStandings', () => {
  it('names the winner with a gold trophy, then 2nd and 3rd with silver and bronze', () => {
    const standings = describeFinalStandings([row('Big Hitters', 1, 11), row('Lakers 2', 2, 10), row('Sharks 1', 3, 9), row('Bears Den', 4, 9)]);

    expect(standings).toEqual({
      winner: { label: 'Winner', metal: 'gold', names: ['Big Hitters'], score: '11 pts' },
      runnersUp: [
        { label: '2nd', metal: 'silver', names: ['Lakers 2'], score: '10 pts' },
        { label: '3rd', metal: 'bronze', names: ['Sharks 1'], score: '9 pts' },
      ],
      yourFinish: null,
    });
  });

  it('says the viewer finished at their one entry\'s place of every entry on the board', () => {
    const standings = describeFinalStandings([row('Big Hitters', 1, 11), row('Lakers 2', 2, 10), row('Sharks 1', 3, 9, true), row('Bears Den', 4, 9)]);

    expect(standings?.yourFinish).toBe('You finished 3rd of 4');
  });

  it('lists every one of the viewer\'s entries best first', () => {
    const rows = [row('Sharks 2', 11, 2, true), row('Big Hitters', 1, 11), row('Sharks 1', 3, 9, true), row('Sharks 3', 5, 7, true)];

    expect(describeFinalStandings(rows)?.yourFinish).toBe('You finished 3rd, 5th, and 11th of 4');
  });

  it('names everyone tied for 1st and shows no runners-up beneath them, even with an entry placed 3rd', () => {
    const standings = describeFinalStandings([row('Big Hitters', 1, 11), row('Lakers 2', 1, 11, true), row('Sharks 1', 3, 9), row('Bears Den', 4, 8)]);

    expect(standings?.winner).toEqual({ label: 'Tied for 1st', metal: 'gold', names: ['Big Hitters', 'Lakers 2'], score: '11 pts' });
    expect(standings?.runnersUp).toEqual([]);
    expect(standings?.yourFinish).toBe('You finished 1st of 4');
  });

  it('names everyone tied for a lower step too', () => {
    const standings = describeFinalStandings([row('Big Hitters', 1, 11), row('Lakers 2', 2, 10), row('Sharks 1', 2, 10)]);

    expect(standings?.runnersUp).toEqual([{ label: 'Tied for 2nd', metal: 'silver', names: ['Lakers 2', 'Sharks 1'], score: '10 pts' }]);
  });

  it('leaves out an unplaced entry from the podium and the viewer\'s finish, and is null when nobody was placed', () => {
    expect(describeFinalStandings([row('Big Hitters', 1, 11), row('Sharks 1', null, 0, true)])).toEqual({
      winner: { label: 'Winner', metal: 'gold', names: ['Big Hitters'], score: '11 pts' },
      runnersUp: [],
      yourFinish: null,
    });
    expect(describeFinalStandings([row('Sharks 1', null, 0)])).toBeNull();
    expect(describeFinalStandings([])).toBeNull();
  });
});
