import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sport } from '@poolmaster/shared/domain';
import {
  golferRoundScore,
  seedDateOffsetDays,
  shiftedEventDates,
} from '../../../packages/core-api/scripts/seed-golf/seed-golf-data';
import { parseSportDataFile, SportDataContent, TEST_SEED_CONTENTS, type SportDataFile } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';

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
