import { Sport, SportStat, getSportDefinition, type SportComposite } from '@poolmaster/shared/domain';
import { expectDefined } from '../../support/expect-defined';

// Each sport's one composite (#932, `plans/championship-stat-pools.md` §2): its name, the stats it
// counts and its formula, a whole number per game. A stat with no value on the line counts 0.

function compositeOf(sport: Sport): SportComposite {
  return expectDefined(getSportDefinition(sport).composite, `${sport}'s composite`);
}

describe('Box Score (baseball)', () => {
  const boxScore = compositeOf(Sport.BASEBALL);

  it('is named Box Score and counts total bases, runs, RBI, walks and stolen bases', () => {
    expect([boxScore.name, boxScore.stats]).toEqual(['Box Score', [
      SportStat.TOTAL_BASES, SportStat.RUNS, SportStat.RUNS_BATTED_IN, SportStat.WALKS, SportStat.STOLEN_BASES,
    ]]);
  });

  it('adds the five stats one for one: a two-run homer, a walk and a steal score 4 + 1 + 2 + 1 + 1 = 9', () => {
    expect(boxScore.score({ TOTAL_BASES: 4, RUNS: 1, RUNS_BATTED_IN: 2, WALKS: 1, STOLEN_BASES: 1 })).toBe(9);
  });

  it('scores a hitless game with no walks 0, and ignores a stat it does not count', () => {
    expect(boxScore.score({})).toBe(0);
    expect(boxScore.score({ TOTAL_BASES: 1, POINTS: 30 })).toBe(1);
  });
});

describe('Triple Threat (basketball)', () => {
  const tripleThreat = compositeOf(Sport.BASKETBALL);

  it('is named Triple Threat and counts points, rebounds and assists', () => {
    expect([tripleThreat.name, tripleThreat.stats]).toEqual(['Triple Threat', [SportStat.POINTS, SportStat.REBOUNDS, SportStat.ASSISTS]]);
  });

  it('adds points, rebounds and assists: a 30-point, 12-rebound, 8-assist game scores 50', () => {
    expect(tripleThreat.score({ POINTS: 30, REBOUNDS: 12, ASSISTS: 8 })).toBe(50);
  });
});

describe('Power Play (hockey)', () => {
  const powerPlay = compositeOf(Sport.HOCKEY);

  it('is named Power Play and counts goals, assists and shots on goal', () => {
    expect([powerPlay.name, powerPlay.stats]).toEqual(['Power Play', [SportStat.GOALS, SportStat.ASSISTS, SportStat.SHOTS_ON_GOAL]]);
  });

  it('counts a goal twice: two goals, an assist and five shots score 2 x 2 + 1 + 5 = 10', () => {
    expect(powerPlay.score({ GOALS: 2, ASSISTS: 1, SHOTS_ON_GOAL: 5 })).toBe(10);
  });
});

describe('Redzone (American football)', () => {
  const redzone = compositeOf(Sport.AMERICAN_FOOTBALL);

  it('is named Redzone and counts touchdowns, receptions and yards of every kind', () => {
    expect(redzone.name).toBe('Redzone');
    expect(redzone.stats).toEqual([
      SportStat.PASSING_TOUCHDOWNS, SportStat.RUSHING_TOUCHDOWNS, SportStat.RECEIVING_TOUCHDOWNS,
      SportStat.RECEPTIONS, SportStat.PASSING_YARDS, SportStat.RUSHING_YARDS, SportStat.RECEIVING_YARDS,
    ]);
  });

  it('scores 6 a touchdown of any kind, 1 a reception and 1 per 10 yards: a receiver\'s 7 catches for 98 yards and a score is 6 + 7 + 9 = 22', () => {
    expect(redzone.score({ RECEIVING_TOUCHDOWNS: 1, RECEPTIONS: 7, RECEIVING_YARDS: 98 })).toBe(22);
  });

  it('adds every kind of yards before rounding down: a quarterback\'s 245 passing and 15 rushing yards are 26, not 24 + 1', () => {
    expect(redzone.score({ PASSING_TOUCHDOWNS: 2, RUSHING_TOUCHDOWNS: 1, PASSING_YARDS: 245, RUSHING_YARDS: 15 })).toBe(18 + 26);
  });

  it('rounds a game of lost yards down too: -12 rushing yards score -2', () => {
    expect(redzone.score({ RUSHING_YARDS: -12 })).toBe(-2);
  });
});

describe('Hat Trick (soccer)', () => {
  const hatTrick = compositeOf(Sport.SOCCER);

  it('is named Hat Trick and counts goals, assists and shots on target', () => {
    expect([hatTrick.name, hatTrick.stats]).toEqual(['Hat Trick', [SportStat.GOALS, SportStat.ASSISTS, SportStat.SHOTS_ON_TARGET]]);
  });

  it('counts a goal three times and an assist twice: a goal, an assist and four shots on target score 3 + 2 + 4 = 9', () => {
    expect(hatTrick.score({ GOALS: 1, ASSISTS: 1, SHOTS_ON_TARGET: 4 })).toBe(9);
  });

  it('scores a hat trick from three shots on target 3 x 3 + 3 = 12, and ignores hockey\'s shots on goal', () => {
    expect(hatTrick.score({ GOALS: 3, SHOTS_ON_TARGET: 3 })).toBe(12);
    expect(hatTrick.score({ SHOTS_ON_GOAL: 5 })).toBe(0);
  });
});

describe('Every sport\'s composite', () => {
  it('belongs only to the five championship stat pool sports, each scheduled for its games, a soccer knockout round one match', () => {
    expect(Object.values(Sport).filter((sport) => getSportDefinition(sport).composite !== null).map((sport) => [sport, compositeOf(sport).defaultGames]))
      .toEqual([[Sport.BASKETBALL, 7], [Sport.AMERICAN_FOOTBALL, 1], [Sport.HOCKEY, 7], [Sport.BASEBALL, 7], [Sport.SOCCER, 1]]);
  });
});
