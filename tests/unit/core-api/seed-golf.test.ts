import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sport } from '@poolmaster/shared/domain';
import {
  golferRoundScore,
  seedDateOffsetDays,
  shiftedEventDates,
  shiftedMatchTimes,
} from '../../../packages/core-api/scripts/seed-golf/seed-golf-data';
import { parseSportDataFile, SportDataContent, TEST_SEED_CONTENTS, type SportDataFile } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';
import { expectDefined } from '../../support/expect-defined';

function seedWithStarts(...startDates: string[]): Pick<SportDataFile, 'sportLeagues'> {
  return {
    sportLeagues: [{
      name: 'Tour',
      players: [],
      events: startDates.map((startDate, index) => ({
        key: `e${index}`,
        name: `Event ${index}`,
        startDate,
        endDate: startDate,
        venue: null,
        location: null,
        rounds: 4,
        roundsPar: 72,
        field: [],
      })),
    }],
  };
}

describe('golf seed dates', () => {
  it('moves the season forward by whole weeks so its first event starts at least a week after the run', () => {
    // 2026-01-15 is a Thursday; a run on 2026-10-08 needs 280 days to clear 2026-10-15.
    const offset = seedDateOffsetDays(seedWithStarts('2026-03-05', '2026-01-15'), new Date('2026-10-08T19:00:00Z'));

    expect(offset % 7).toBe(0);
    expect(offset).toBe(280);
    expect(shiftedEventDates({ startDate: '2026-01-15', endDate: '2026-01-18' }, offset)).toEqual({
      startDate: '2026-10-22T12:00:00.000Z',
      endDate: '2026-10-25T23:00:00.000Z',
    });
  });

  it('leaves the dates alone when the season is already more than a week away', () => {
    expect(seedDateOffsetDays(seedWithStarts('2026-01-15'), new Date('2025-12-01T00:00:00Z'))).toBe(0);
  });
});

describe('event dates for the API', () => {
  it('starts an event at noon UTC on its start date and ends it by 23:00 UTC on its end date when no start time is given', () => {
    expect(shiftedEventDates({ startDate: '2027-11-18', endDate: '2027-11-21' }, 0)).toEqual({
      startDate: '2027-11-18T12:00:00.000Z',
      endDate: '2027-11-21T23:00:00.000Z',
    });
  });

  it('starts a race at its post time, and ends a one-day race no earlier than an evening post time', () => {
    expect(shiftedEventDates({ startDate: '2027-01-30', endDate: '2027-01-30', startsAt: '2027-01-30T17:40:00-05:00' }, 0)).toEqual({
      startDate: '2027-01-30T22:40:00.000Z',
      endDate: '2027-01-30T23:00:00.000Z',
    });
    expect(shiftedEventDates({ startDate: '2027-05-01', endDate: '2027-05-01', startsAt: '2027-05-01T19:30:00-04:00' }, 0)).toEqual({
      startDate: '2027-05-01T23:30:00.000Z',
      endDate: '2027-05-01T23:30:00.000Z',
    });
  });
});

describe('golf seed round scores', () => {
  const golfer = { player: 'p', ranking: 1, oddsToWin: 5, rounds: [70, 75] };

  it('stores a finished round as completed, eighteen holes, to par against the event par', () => {
    expect(golferRoundScore(golfer, 1, 72)).toEqual({ strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' });
  });

  it('marks the last round of a golfer who missed the cut as MISSED_CUT and stores nothing after it', () => {
    const cut = { ...golfer, finish: 'MC' as const };

    expect(golferRoundScore(cut, 2, 72)).toEqual({ strokes: 75, scoreToPar: 3, thru: 18, status: 'MISSED_CUT' });
    expect(golferRoundScore(cut, 3, 72)).toBeNull();
  });

  it('stores a withdrawal as a DNF round through the holes played, to par for those holes', () => {
    const withdrawn = { ...golfer, rounds: [70, 40], finish: 'WD' as const, withdrawnThru: 9 };

    expect(golferRoundScore(withdrawn, 2, 72)).toEqual({ strokes: 40, scoreToPar: 4, thru: 9, status: 'DNF' });
  });
});

describe('golf-2026.json', () => {
  const seed = parseSportDataFile(
    JSON.parse(readFileSync(join(__dirname, '../../../packages/core-api/scripts/seed-golf/golf-2026.json'), 'utf8')) as unknown,
    { allowTestData: true },
  );

  it('is a 2026 golf test seed whose envelope names both tours and a test seed\'s contents', () => {
    expect(seed.scope).toEqual({ sport: Sport.GOLF, season: 2026, sportLeagues: ['PGA TOUR', 'LPGA Tour'], contents: [...TEST_SEED_CONTENTS] });
    expect(seed.testData).toBe(true);
  });

  it('holds every 2026 PGA TOUR and LPGA Tour event, each field drawn from its own tour', () => {
    expect(seed.sportLeagues.map((tour) => [tour.name, tour.events.length])).toEqual([['PGA TOUR', 45], ['LPGA Tour', 31]]);
    for (const tour of seed.sportLeagues) {
      const keys = new Set(tour.players.map((player) => player.key));
      for (const event of tour.events) {
        expect(event.field.length).toBeGreaterThan(60);
        expect(event.field.every((golfer) => keys.has(golfer.player))).toBe(true);
        expect(new Set(event.field.map((golfer) => golfer.player)).size).toBe(event.field.length);
      }
    }
  });

  it('gives each event one outright winner and a full set of rounds to everyone who finished', () => {
    for (const event of seed.sportLeagues.flatMap((tour) => tour.events)) {
      const finishers = event.field.filter((golfer) => !golfer.finish);
      expect(finishers.every((golfer) => golfer.rounds?.length === event.rounds)).toBe(true);
      const totals = finishers.map((golfer) => (golfer.rounds ?? []).reduce((sum, strokes) => sum + strokes, 0)).sort((a, b) => a - b);
      if (event.winner === 'public') expect(totals[0]).toBeLessThan(totals[1]);
    }
  });
});

const SEED_DIR = join(__dirname, '../../../packages/core-api/scripts/seed-golf');

function readDataFile(name: string, allowTestData: boolean) {
  return parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, name), 'utf8')) as unknown, { allowTestData });
}

function eventRows(file: SportDataFile, league = 0) {
  return file.sportLeagues[league].events.map((event) => [event.name, event.startDate, event.endDate, event.rounds, event.roundsPar]);
}

describe('horse-racing-2027.json', () => {
  it('is a real 2027 US Thoroughbred schedule: the Pegasus World Cup and the three Triple Crown races, each a one-race event with no par', () => {
    const file = readDataFile('horse-racing-2027.json', false);

    expect(file.scope).toEqual({ sport: Sport.HORSE_RACING, season: 2027, sportLeagues: ['US Thoroughbred'], contents: [SportDataContent.SCHEDULE] });
    expect(eventRows(file)).toEqual([
      ['Pegasus World Cup', '2027-01-30', '2027-01-30', 1, null],
      ['Kentucky Derby', '2027-05-01', '2027-05-01', 1, null],
      ['Preakness Stakes', '2027-05-23', '2027-05-23', 1, null],
      ['Belmont Stakes', '2027-06-05', '2027-06-05', 1, null],
    ]);
  });
});

describe('auto-racing-2027-formula-1.json', () => {
  it('is a real 2027 Formula 1 schedule of 24 one-day Grands Prix, Bahrain on March 14 to Abu Dhabi on December 12', () => {
    const file = readDataFile('auto-racing-2027-formula-1.json', false);
    const events = file.sportLeagues[0].events;

    expect(file.scope).toEqual({ sport: Sport.AUTO_RACING, season: 2027, sportLeagues: ['Formula 1'], contents: [SportDataContent.SCHEDULE] });
    expect(events).toHaveLength(24);
    expect([events[0].name, events[0].startDate]).toEqual(['Bahrain Grand Prix', '2027-03-14']);
    expect([events[23].name, events[23].startDate]).toEqual(['Abu Dhabi Grand Prix', '2027-12-12']);
    expect(events.every((event) => event.startDate === event.endDate && event.rounds === 1 && event.field.length === 0)).toBe(true);
  });
});

describe('auto-racing-2027-nascar.json', () => {
  it('is a real 2027 NASCAR Cup Series schedule of the 34 points races both sources agree on, Daytona 500 first and Homestead last', () => {
    const file = readDataFile('auto-racing-2027-nascar.json', false);
    const events = file.sportLeagues[0].events;

    expect(file.scope).toEqual({ sport: Sport.AUTO_RACING, season: 2027, sportLeagues: ['NASCAR Cup Series'], contents: [SportDataContent.SCHEDULE] });
    expect(events).toHaveLength(34);
    expect([events[0].name, events[0].startDate, events[0].venue]).toEqual(['Daytona 500', '2027-02-21', 'Daytona International Speedway']);
    expect([events[33].startDate, events[33].venue]).toEqual(['2027-11-14', 'Homestead–Miami Speedway']);
    expect(events.map((event) => event.venue)).not.toContain('Richmond Raceway');
    expect(events.map((event) => event.venue)).not.toContain('New Hampshire Motor Speedway');
  });
});

describe('cycling-2027.json', () => {
  it('holds the 2027 WorldTour races two sources date alike, Grand Tours as one race spanning every stage', () => {
    const file = readDataFile('cycling-2027.json', false);

    expect(file.scope).toEqual({ sport: Sport.CYCLING, season: 2027, sportLeagues: ['UCI WorldTour', "UCI Women's WorldTour"], contents: [SportDataContent.SCHEDULE] });
    expect(eventRows(file, 0)).toEqual([
      ['Strade Bianche', '2027-03-06', '2027-03-06', 1, null],
      ['Tirreno-Adriatico', '2027-03-08', '2027-03-14', 1, null],
      ['Milano-Sanremo', '2027-03-20', '2027-03-20', 1, null],
      ["Giro d'Italia", '2027-05-08', '2027-05-30', 1, null],
      ['Tour de France', '2027-07-02', '2027-07-25', 1, null],
      ['Il Lombardia', '2027-10-09', '2027-10-09', 1, null],
    ]);
    expect(eventRows(file, 1)).toEqual([["Giro d'Italia Women", '2027-05-29', '2027-06-06', 1, null]]);
  });
});

describe('running-2027.json', () => {
  it("gives the men's and women's World Marathon Majors the same seven announced 2027 races, London over both days of its weekend", () => {
    const file = readDataFile('running-2027.json', false);

    expect(file.scope).toEqual({
      sport: Sport.RUNNING,
      season: 2027,
      sportLeagues: ['World Marathon Majors (men)', 'World Marathon Majors (women)'],
      contents: [SportDataContent.SCHEDULE],
    });
    expect(eventRows(file, 0)).toEqual([
      ['Tokyo Marathon', '2027-03-07', '2027-03-07', 1, null],
      ['Boston Marathon', '2027-04-19', '2027-04-19', 1, null],
      ['London Marathon', '2027-04-24', '2027-04-25', 1, null],
      ['Cape Town Marathon', '2027-05-23', '2027-05-23', 1, null],
      ['Sydney Marathon', '2027-08-29', '2027-08-29', 1, null],
      ['Berlin Marathon', '2027-09-26', '2027-09-26', 1, null],
      ['Chicago Marathon', '2027-10-10', '2027-10-10', 1, null],
    ]);
    expect(eventRows(file, 1)).toEqual(eventRows(file, 0));
  });
});

describe('american-football-2026-nfl-playoffs-test.json', () => {
  const file = readDataFile('american-football-2026-nfl-playoffs-test.json', true);
  const [nfl] = file.sportLeagues;
  const [playoffs] = nfl.events;
  const matches = playoffs.matches ?? [];

  it('is a test seed of one NFL playoffs bracket that reseeds, with fourteen teams seeded 1 to 7 in each conference', () => {
    expect(file.scope).toEqual({
      sport: Sport.AMERICAN_FOOTBALL,
      season: 2026,
      sportLeagues: ['NFL'],
      contents: [SportDataContent.SCHEDULE, SportDataContent.PLAYERS, SportDataContent.FIELDS, SportDataContent.BRACKET, SportDataContent.RESULTS],
    });
    expect(nfl.bracketAdvancement).toBe('RESEED_BY_SEED');
    expect([playoffs.rounds, playoffs.startDate, playoffs.endDate]).toEqual([4, '2026-01-10', '2026-02-08']);
    expect(playoffs.field.map((entry) => entry.seed)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
  });

  it('plays the 2025 season as it went: six Wild Card games, the 1 seeds on a bye, and the Seahawks beating the Patriots 29-13', () => {
    expect(matches.map((match) => match.roundNumber)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 4]);
    // The Divisional and conference rounds are both placed by the reseed, so the games before them link nowhere.
    expect(matches.filter((match) => match.roundNumber <= 2).every((match) => match.advancesTo === null)).toBe(true);
    expect(matches.filter((match) => match.roundNumber === 3).map((match) => [match.home, match.away, match.advancesTo?.matchNumber])).toEqual([
      [null, null, 13], [null, null, 13],
    ]);
    expect(matches.filter((match) => match.roundNumber === 2).map((match) => [match.home, match.away])).toEqual([
      ['nfl-denver-broncos', null], [null, null], ['nfl-seattle-seahawks', null], [null, null],
    ]);
    expect(matches.every((match) => match.result !== undefined)).toBe(true);
    expect(matches[12]).toMatchObject({ isNeutralSite: true, result: { winner: 'AWAY', homeScore: 13, awayScore: 29 } });
  });
});

describe('basketball-2025-nba-playoffs-test.json', () => {
  const file = readDataFile('basketball-2025-nba-playoffs-test.json', true);
  const [nba] = file.sportLeagues;
  const [playoffs] = nba.events;
  const matches = playoffs.matches ?? [];

  it('is a test seed of one fixed four-round NBA playoffs bracket of 16 places, seeded 1 to 8 in each conference', () => {
    expect(file.scope).toEqual({
      sport: Sport.BASKETBALL,
      season: 2025,
      sportLeagues: ['NBA'],
      contents: [SportDataContent.SCHEDULE, SportDataContent.PLAYERS, SportDataContent.FIELDS, SportDataContent.BRACKET, SportDataContent.RESULTS],
    });
    expect(nba.bracketAdvancement).toBeUndefined();
    expect([playoffs.rounds, playoffs.startDate, playoffs.endDate]).toEqual([4, '2025-04-19', '2025-06-22']);
    expect(playoffs.field.map((entry) => entry.seed)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
  });

  it('fills the 7 and 8 seeds through play-in places, each naming the team that won it and is not otherwise in the field', () => {
    expect(playoffs.field.filter((entry) => entry.isPlayInPlace).map((entry) => [entry.player, entry.seed, entry.playInWinner])).toEqual([
      ['nba-west-7-seed-play-in', 7, 'nba-golden-state-warriors'],
      ['nba-east-7-seed-play-in', 7, 'nba-orlando-magic'],
      ['nba-west-8-seed-play-in', 8, 'nba-memphis-grizzlies'],
      ['nba-east-8-seed-play-in', 8, 'nba-miami-heat'],
    ]);
  });

  it('plays each series as one game scored in games won, Oklahoma City beating Indiana 4-3 in the Finals', () => {
    expect(matches.map((match) => match.roundNumber)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 4]);
    expect(matches.every((match) => match.result !== undefined && Math.max(match.result.homeScore, match.result.awayScore) === 4)).toBe(true);
    expect(matches.filter((match) => match.roundNumber < 4).every((match) => match.regionLabel === 'East' || match.regionLabel === 'West')).toBe(true);
    expect(matches[14]).toMatchObject({ advancesTo: null, isNeutralSite: false, result: { winner: 'HOME', homeScore: 4, awayScore: 3 } });
  });
});

describe('basketball-2025-wnba-playoffs-test.json', () => {
  const file = readDataFile('basketball-2025-wnba-playoffs-test.json', true);
  const [playoffs] = file.sportLeagues[0].events;
  const matches = playoffs.matches ?? [];

  it('is a test seed of one fixed three-round WNBA bracket of eight teams seeded 1 to 8, Las Vegas sweeping Phoenix 4-0 in the Finals', () => {
    expect([file.scope.sport, file.scope.season, file.scope.sportLeagues]).toEqual([Sport.BASKETBALL, 2025, ['WNBA']]);
    expect([playoffs.rounds, playoffs.startDate, playoffs.endDate]).toEqual([3, '2025-09-14', '2025-10-10']);
    expect(playoffs.field.map((entry) => entry.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Best of three, then best of five, then best of seven.
    expect(matches.map((match) => [match.roundNumber, Math.max(match.result?.homeScore ?? 0, match.result?.awayScore ?? 0)])).toEqual([
      [1, 2], [1, 2], [1, 2], [1, 2], [2, 3], [2, 3], [3, 4],
    ]);
    expect(matches[6]).toMatchObject({ home: null, away: null, result: { winner: 'HOME', homeScore: 4, awayScore: 0 } });
  });
});

describe('american-football-2025-cfp-test.json', () => {
  const file = readDataFile('american-football-2025-cfp-test.json', true);
  const [playoff] = file.sportLeagues[0].events;
  const matches = playoff.matches ?? [];

  it('is a test seed of one fixed four-round College Football Playoff of 12 teams seeded 1 to 12, Indiana beating Miami 27-21 in the National Championship', () => {
    expect([file.scope.sport, file.scope.season, file.scope.sportLeagues]).toEqual([Sport.AMERICAN_FOOTBALL, 2025, ['College Football Playoff']]);
    expect([playoff.rounds, playoff.startDate, playoff.endDate]).toEqual([4, '2025-12-19', '2026-01-19']);
    expect(playoff.field.map((entry) => entry.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(file.sportLeagues[0].bracketAdvancement).toBe('FIXED');
    expect(matches[10]).toMatchObject({ roundNumber: 4, home: null, away: null, advancesTo: null, result: { winner: 'HOME', homeScore: 27, awayScore: 21 } });
  });

  it('plays the first round at the higher seed\'s campus and every later game at a neutral site, with the top four seeds placed straight into the quarterfinals', () => {
    expect(matches.map((match) => [match.roundNumber, match.isNeutralSite])).toEqual([
      [1, false], [1, false], [1, false], [1, false], [2, true], [2, true], [2, true], [2, true], [3, true], [3, true], [4, true],
    ]);
    const seedOf = new Map(playoff.field.map((entry) => [entry.player, entry.seed]));
    expect(matches.filter((match) => match.roundNumber === 2).map((match) => [seedOf.get(match.home ?? ''), match.away])).toEqual([[1, null], [4, null], [3, null], [2, null]]);
  });
});

describe('basketball-2026-ncaa-tournaments-test.json', () => {
  const file = readDataFile('basketball-2026-ncaa-tournaments-test.json', true);
  const [men, women] = file.sportLeagues.map((league) => league.events[0]);

  it('is a test seed of the 2026 men\'s and women\'s tournaments, each a six-round bracket of 64 places seeded 1 to 16 in four regions', () => {
    expect([file.scope.sport, file.scope.season, file.scope.sportLeagues]).toEqual([Sport.BASKETBALL, 2026, ['NCAA Division I Men', 'NCAA Division I Women']]);
    for (const tournament of [men, women]) {
      const matches = tournament.matches ?? [];
      expect(tournament.rounds).toBe(6);
      expect(tournament.field).toHaveLength(64);
      for (let seed = 1; seed <= 16; seed += 1) expect(tournament.field.filter((entry) => entry.seed === seed)).toHaveLength(4);
      expect(matches.map((match) => match.roundNumber)).toEqual([1, 2, 3, 4, 5, 6].flatMap((round) => Array<number>(2 ** (6 - round)).fill(round)));
      expect(matches.every((match) => match.result !== undefined)).toBe(true);
      expect(matches.filter((match) => match.roundNumber >= 5).every((match) => match.regionLabel === undefined)).toBe(true);
    }
    expect(new Set(men.matches?.map((match) => match.regionLabel))).toEqual(new Set(['East', 'South', 'West', 'Midwest', undefined]));
  });

  it('fills each First Four place with the team that won it, never a team already in the field', () => {
    expect(men.field.filter((entry) => entry.isPlayInPlace).map((entry) => [entry.seed, entry.playInWinner])).toEqual([
      [11, 'ncaam-texas-longhorns'], [11, 'ncaam-miami-oh-redhawks'], [16, 'ncaam-prairie-view-am-panthers'], [16, 'ncaam-howard-bison'],
    ]);
    expect(women.field.filter((entry) => entry.isPlayInPlace).map((entry) => [entry.seed, entry.playInWinner])).toEqual([
      [10, 'ncaaw-virginia-cavaliers'], [11, 'ncaaw-nebraska-cornhuskers'], [16, 'ncaaw-southern-jaguars'], [16, 'ncaaw-missouri-state-lady-bears'],
    ]);
    for (const tournament of [men, women]) {
      const fieldKeys = new Set(tournament.field.map((entry) => entry.player));
      expect(tournament.field.filter((entry) => entry.playInWinner !== undefined && fieldKeys.has(entry.playInWinner))).toEqual([]);
    }
  });

  it('ends with Michigan beating UConn 69-63 for the men\'s title and UCLA beating South Carolina 79-51 for the women\'s', () => {
    expect(men.matches?.[62]).toMatchObject({ roundNumber: 6, advancesTo: null, result: { winner: 'AWAY', homeScore: 63, awayScore: 69 } });
    expect(women.matches?.[62]).toMatchObject({ roundNumber: 6, advancesTo: null, result: { winner: 'AWAY', homeScore: 51, awayScore: 79 } });
  });
});

describe('2026 racing test seeds', () => {
  it.each([
    ['auto-racing-2026-test.json', Sport.AUTO_RACING, [['Formula 1', 17, 'Max Verstappen'], ['NASCAR Cup Series', 32, 'Chase Briscoe'], ['IndyCar', 18, 'Scott McLaughlin']]],
    ['horse-racing-2026-test.json', Sport.HORSE_RACING, [['US Thoroughbred', 3, 'Golden Tempo']]],
    ['cycling-2026-test.json', Sport.CYCLING, [['UCI WorldTour', 3, 'Tadej Pogačar'], ["UCI Women's WorldTour", 1, 'Demi Vollering']]],
    ['running-2026-test.json', Sport.RUNNING, [['World Marathon Majors (men)', 6, 'Amos Kipruto'], ['World Marathon Majors (women)', 6, 'Hawi Feysa']]],
  ] as const)('%s holds each sport league\'s 2026 races as run, every runner with a result and the last race won by its real winner', (fileName, sport, leagues) => {
    const file = readDataFile(fileName, true);

    expect([file.scope.sport, file.scope.season, file.scope.contents]).toEqual([sport, 2026, TEST_SEED_CONTENTS]);
    expect(file.sportLeagues.map((league) => league.name)).toEqual(leagues.map(([name]) => name));
    file.sportLeagues.forEach((league, index) => {
      const [, races, lastWinner] = leagues[index];
      const nameOf = new Map(league.players.map((player) => [player.key, player.name]));
      expect(league.events).toHaveLength(races);
      expect(league.events.every((event) => event.rounds === 1 && event.field.every((entry) => entry.raceResult !== undefined && entry.oddsToWin !== undefined))).toBe(true);
      const winner = expectDefined(league.events[races - 1].field.find((entry) => entry.raceResult?.finishPosition === 1));
      expect(nameOf.get(winner.player)).toBe(lastWinner);
    });
  });
});

describe('test seed match times', () => {
  it('move by the same whole days as the event dates, and stay put when the offset is zero', () => {
    const file = readDataFile('american-football-2026-nfl-playoffs-test.json', true);
    const shifted = shiftedMatchTimes(file, 280);

    expect(shifted.sportLeagues[0].events[0].matches?.[0].scheduledAt).toBe('2026-10-19T01:15:00.000Z');
    expect(file.sportLeagues[0].events[0].matches?.[0].scheduledAt).toBe('2026-01-12T01:15:00Z');
    expect(shiftedMatchTimes(file, 0)).toBe(file);
  });
});

describe('test slates', () => {
  it.each([
    ['us-thoroughbred.json', Sport.HORSE_RACING, 'US Thoroughbred'],
    ['formula-1.json', Sport.AUTO_RACING, 'Formula 1'],
    ['nascar-cup-series.json', Sport.AUTO_RACING, 'NASCAR Cup Series'],
    ['indycar.json', Sport.AUTO_RACING, 'IndyCar'],
    ['uci-worldtour.json', Sport.CYCLING, 'UCI WorldTour'],
    ['uci-womens-worldtour.json', Sport.CYCLING, "UCI Women's WorldTour"],
    ['world-marathon-majors-men.json', Sport.RUNNING, 'World Marathon Majors (men)'],
    ['world-marathon-majors-women.json', Sport.RUNNING, 'World Marathon Majors (women)'],
  ])('%s is test data for %s %s: players ranked 1 to n in order, no events, so it only fills a field already on the site', (name, sport, league) => {
    const file = readDataFile(`test-slates/${name}`, true);

    expect(file.testData).toBe(true);
    expect(file.scope.sport).toBe(sport);
    expect(file.scope.sportLeagues).toEqual([league]);
    expect(file.scope.contents).toEqual([SportDataContent.PLAYERS, SportDataContent.FIELDS]);
    expect(file.sportLeagues[0].events).toEqual([]);
    expect(file.sportLeagues[0].players.map((player) => player.ranking)).toEqual(file.sportLeagues[0].players.map((_, index) => index + 1));
  });
});
