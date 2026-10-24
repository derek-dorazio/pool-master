import { Sport } from '@poolmaster/shared/domain';
import { formatLoadReport, LoadAction, LoadMode, LoadSubject } from '../../../packages/core-api/scripts/seed-golf/load-report';
import { isTestSlate, parseSportDataFile, SportDataFileError } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';

// A sport data file carries its scope in an envelope; the loader refuses a file whose data
// strays outside it, before it reads or writes the site.

function realFile(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scope: { sport: 'GOLF', season: 2027, sportLeagues: ['PGA TOUR'], contents: ['SCHEDULE', 'PLAYERS', 'FIELDS'] },
    testData: false,
    provenance: { gatheredAt: '2026-10-13', gatheredBy: 'load-sport-data skill', sources: [{ name: 'PGA TOUR schedule', url: 'https://www.pgatour.com/schedule' }] },
    sportLeagues: [{
      name: 'PGA TOUR',
      players: [{ key: 'pga-a', name: 'Golfer A', countryCode: 'US', ranking: 1 }],
      events: [{
        key: 'rsm',
        name: 'The RSM Classic',
        startDate: '2027-11-18',
        endDate: '2027-11-21',
        venue: 'Sea Island',
        location: 'St. Simons Island, GA, US',
        rounds: 4,
        roundsPar: 70,
        field: [{ player: 'pga-a', ranking: 1 }],
      }],
    }],
  };
}

interface HorseRacingFile {
  testData: boolean;
  scope: { contents: string[] };
  sportLeagues: Array<{ events: Array<{ roundsPar: number | null; startsAt?: string }> }>;
}

function horseRacingFile(): HorseRacingFile {
  const file = {
    schemaVersion: 1,
    scope: { sport: 'HORSE_RACING', season: 2027, sportLeagues: ['US Thoroughbred'], contents: ['SCHEDULE'] },
    testData: false,
    provenance: { gatheredAt: '2026-10-14', gatheredBy: 'load-sport-data skill', sources: [{ name: 'Pegasus World Cup', url: 'https://www.pegasusworldcup.com/' }] },
    sportLeagues: [{
      name: 'US Thoroughbred',
      players: [],
      events: [{
        key: 'pegasus-world-cup',
        name: 'Pegasus World Cup',
        startDate: '2027-01-30',
        endDate: '2027-01-30',
        startsAt: '2027-01-30T17:40:00-05:00',
        venue: 'Gulfstream Park',
        location: 'Hallandale Beach, Florida',
        rounds: 1,
        roundsPar: null,
        field: [],
      }],
    }],
  };
  return file as HorseRacingFile;
}

interface RaceTestSeed {
  testData: boolean;
  scope: { contents: string[] };
  sportLeagues: Array<{
    players: Array<{ key: string; name: string; countryCode: string; ranking: number }>;
    events: Array<{ field: Array<{ player: string; oddsToWin?: number; rounds?: number[]; raceResult?: Record<string, unknown> }> }>;
  }>;
}

/** A played race as a test seed: four runners, two sharing second in a dead heat, one not finishing. */
function raceTestSeed(): RaceTestSeed {
  const file = horseRacingFile() as unknown as RaceTestSeed;
  file.testData = true;
  file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'];
  const runners = ['a', 'b', 'c', 'd'];
  file.sportLeagues[0].players = runners.map((runner, index) => ({ key: `race-${runner}`, name: `Horse ${runner.toUpperCase()}`, countryCode: 'US', ranking: index + 1 }));
  const places = [2, 1, 2, null];
  file.sportLeagues[0].events[0].field = runners.map((runner, index) => ({
    player: `race-${runner}`,
    oddsToWin: index + 2,
    raceResult: {
      status: places[index] === null ? 'DID_NOT_FINISH' : 'FINISHED',
      finishPosition: places[index],
      startPosition: index + 1,
      riderName: `Jockey ${runner.toUpperCase()}`,
    },
  }));
  return file;
}

function problemsOf(json: unknown, allowTestData = false): readonly string[] {
  try {
    parseSportDataFile(json, { allowTestData });
  } catch (error) {
    if (error instanceof SportDataFileError) return error.problems;
    throw error;
  }
  return [];
}

interface EditableFile {
  scope: { sport: string; season: number; sportLeagues: string[]; contents: string[] };
  testData: boolean;
  sportLeagues: Array<{ events: Array<{ startDate: string; winner?: string; purse?: number; field: Array<Record<string, unknown>> }> }>;
}

function edited(edit: (file: EditableFile) => void): unknown {
  const file = realFile() as unknown as EditableFile;
  edit(file);
  return file;
}

describe('sport data file envelope', () => {
  it('reads a real golf file and types its sport from the registry', () => {
    const file = parseSportDataFile(realFile(), { allowTestData: false });

    expect(file.scope.sport).toBe(Sport.GOLF);
    expect(file.sportLeagues[0].events[0].field).toEqual([{ player: 'pga-a', ranking: 1 }]);
  });

  it('refuses a schema version it does not know rather than misread it', () => {
    expect(problemsOf({ ...realFile(), schemaVersion: 2 })).toEqual(['schemaVersion is 2; this loader reads version 1.']);
  });

  it('refuses a sport that is not in the sport registry', () => {
    expect(problemsOf(edited((file) => { file.scope.sport = 'CURLING'; }))).toEqual(['scope.sport CURLING is not a sport in the sport registry.']);
  });

  it('reads a real horse racing schedule whose race has a post time and no par', () => {
    const file = parseSportDataFile(horseRacingFile(), { allowTestData: false });

    expect(file.scope.sport).toBe(Sport.HORSE_RACING);
    expect(file.sportLeagues[0].events[0]).toMatchObject({ name: 'Pegasus World Cup', startsAt: '2027-01-30T17:40:00-05:00', roundsPar: null });
  });

  it('refuses a par on a sport that is not stroke play, and a post time on another day than the start', () => {
    const file = horseRacingFile();
    const race = file.sportLeagues[0].events[0];
    race.roundsPar = 72;
    race.startsAt = '2027-01-31T17:40:00-05:00';

    expect(problemsOf(file)).toEqual([
      'US Thoroughbred, Pegasus World Cup: startsAt 2027-01-31T17:40:00-05:00 is not on its start date 2027-01-30.',
      'US Thoroughbred, Pegasus World Cup: has a par, which only a stroke-play sport has.',
    ]);
  });

  it('reads a race test seed whose runners carry the real finishing order, a dead heat sharing a place', () => {
    const file = parseSportDataFile(raceTestSeed(), { allowTestData: true });

    expect(file.sportLeagues[0].events[0].field.map((entry) => entry.raceResult)).toEqual([
      { status: 'FINISHED', finishPosition: 2, startPosition: 1, riderName: 'Jockey A' },
      { status: 'FINISHED', finishPosition: 1, startPosition: 2, riderName: 'Jockey B' },
      { status: 'FINISHED', finishPosition: 2, startPosition: 3, riderName: 'Jockey C' },
      { status: 'DID_NOT_FINISH', finishPosition: null, startPosition: 4, riderName: 'Jockey D' },
    ]);
  });

  it('refuses a race test seed with a runner missing its result, a place on a runner that did not finish, or places that skip', () => {
    const file = raceTestSeed();
    const [first, second, third, fourth] = file.sportLeagues[0].events[0].field;
    delete first.raceResult;
    third.raceResult = { status: 'FINISHED', finishPosition: 4 };
    fourth.raceResult = { status: 'DID_NOT_FINISH', finishPosition: 3 };
    second.rounds = [70];

    expect(problemsOf(file, true)).toEqual([
      'US Thoroughbred, Pegasus World Cup: race-a needs raceResult in test data.',
      'US Thoroughbred, Pegasus World Cup: race-b carries rounds, which only a golf test seed has.',
      'US Thoroughbred, Pegasus World Cup: race-d has a finishing place only if it finished, and needs one if it did.',
      'US Thoroughbred, Pegasus World Cup: the finishing places do not run 1, 2, 3 ... (a dead heat repeats a place and skips the next).',
    ]);
  });

  it('refuses a race result on a golf test seed and in a real file', () => {
    const golf = edited((file) => {
      file.testData = true;
      file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'];
      Object.assign(file.sportLeagues[0].events[0].field[0], { oddsToWin: 5, rounds: [70, 70, 70, 70], raceResult: { status: 'FINISHED', finishPosition: 1 } });
    });
    const real = horseRacingFile() as unknown as RaceTestSeed;
    real.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS'];
    real.sportLeagues[0].players = [{ key: 'race-a', name: 'Horse A', countryCode: 'US', ranking: 1 }];
    real.sportLeagues[0].events[0].field = [{ player: 'race-a', raceResult: { status: 'FINISHED', finishPosition: 1 } }];

    expect(problemsOf(golf, true)).toEqual(['PGA TOUR, The RSM Classic: pga-a carries raceResult, which only a race\'s test seed has.']);
    expect(problemsOf(real)).toEqual(['US Thoroughbred, Pegasus World Cup: race-a carries raceResult, which only test data may.']);
  });

  it('refuses a contents value outside the closed list and a key the shape does not have', () => {
    const problems = problemsOf(edited((file) => {
      file.scope.contents = ['SCHEDULE', 'ODDS'];
      file.sportLeagues[0].events[0].purse = 9_000_000;
    }));

    expect(problems.some((problem) => problem.startsWith('scope.contents.1:'))).toBe(true);
    expect(problems.some((problem) => problem.includes('purse'))).toBe(true);
  });

  it('refuses a sport league the scope does not name, and a scope league the file has no data for', () => {
    expect(problemsOf(edited((file) => { file.scope.sportLeagues = ['LPGA Tour']; }))).toEqual([
      'Sport league PGA TOUR is not named in scope.sportLeagues.',
      'scope.sportLeagues names LPGA Tour, which the file has no data for.',
    ]);
  });

  it('refuses an event that starts outside the scope season', () => {
    expect(problemsOf(edited((file) => { file.sportLeagues[0].events[0].startDate = '2026-11-18'; }))).toEqual([
      'PGA TOUR, The RSM Classic: starts 2026-11-18, outside the 2027 season.',
    ]);
  });

  it('refuses a field entry whose player is not in its league players list', () => {
    expect(problemsOf(edited((file) => { file.sportLeagues[0].events[0].field.push({ player: 'pga-zz' }); }))).toEqual([
      "PGA TOUR, The RSM Classic: pga-zz is not in PGA TOUR's players.",
    ]);
  });

  it('refuses a field in a file whose contents leave out FIELDS, and FIELDS without PLAYERS', () => {
    expect(problemsOf(edited((file) => { file.scope.contents = ['SCHEDULE', 'PLAYERS']; }))).toEqual([
      'PGA TOUR, The RSM Classic: has a field, but the scope\'s contents leave out FIELDS.',
    ]);
    expect(problemsOf(edited((file) => { file.scope.contents = ['SCHEDULE', 'FIELDS']; }))).toEqual([
      'scope.contents has FIELDS without PLAYERS: a field names its players, so the file carries them.',
    ]);
  });

  it('refuses made-up odds, scores and winners in a real file, and RESULTS in its contents', () => {
    expect(problemsOf(edited((file) => {
      file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'];
      file.sportLeagues[0].events[0].winner = 'generated';
      file.sportLeagues[0].events[0].field[0] = { player: 'pga-a', oddsToWin: 5, rounds: [70] };
    }))).toEqual([
      'scope.contents has RESULTS, which only test data may.',
      'PGA TOUR, The RSM Classic: pga-a carries oddsToWin, rounds, which only test data may.',
      'PGA TOUR, The RSM Classic: carries a winner, which only test data may.',
    ]);
  });

  it('refuses test data on a target that does not take it, and test data without a test seed\'s contents', () => {
    const testFile = edited((file) => {
      file.testData = true;
      file.sportLeagues[0].events[0].field[0] = { player: 'pga-a', ranking: 1, oddsToWin: 5, rounds: [70, 71, 72, 73] };
    });

    expect(problemsOf(testFile, false)).toEqual([
      'testData needs SCHEDULE, PLAYERS, FIELDS, RESULTS (a test seed), or just PLAYERS and FIELDS (a test slate); missing RESULTS.',
      'testData is true, and this target does not take test data.',
    ]);
    expect(problemsOf(testFile, true)).toEqual(['testData needs SCHEDULE, PLAYERS, FIELDS, RESULTS (a test seed), or just PLAYERS and FIELDS (a test slate); missing RESULTS.']);
  });
});

describe('sport data bracket', () => {
  // A four-team basketball bracket: two semifinals whose winners meet in the final.
  interface BracketMatch {
    home: string | null;
    away: string | null;
    advancesTo: { matchNumber: number; side: string } | null;
    regionLabel?: string;
    result?: { winner: string | null; homeScore: number | null; awayScore: number | null; homeShootoutScore?: number; awayShootoutScore?: number; ending?: string };
    periodScores?: Array<{ periodNumber: number; homeScore: number; awayScore: number }>;
  }
  interface BracketFile {
    testData: boolean;
    scope: { contents: string[] };
    sportLeagues: Array<{ bracketAdvancement?: string; events: Array<{ rounds?: number; field: unknown[]; matches: BracketMatch[] }> }>;
  }

  function bracketFile(): BracketFile {
    const team = (key: string, name: string) => ({ key, name, countryCode: 'US', ranking: 1 });
    const file = {
      schemaVersion: 1,
      scope: { sport: 'BASKETBALL', season: 2027, sportLeagues: ['NCAA Men'], contents: ['SCHEDULE', 'PLAYERS', 'FIELDS', 'BRACKET'] },
      testData: false,
      provenance: { gatheredAt: '2027-03-14', gatheredBy: 'load-sport-data skill', sources: [{ name: 'NCAA bracket', url: 'https://www.ncaa.com/brackets' }] },
      sportLeagues: [{
        name: 'NCAA Men',
        players: [team('ncaa-duke', 'Duke'), team('ncaa-vermont', 'Vermont'), team('ncaa-houston', 'Houston'), team('ncaa-texas-xavier', 'Texas / Xavier')],
        events: [{
          key: 'final-four',
          name: 'Tournament',
          startDate: '2027-03-18',
          endDate: '2027-04-05',
          venue: null,
          location: null,
          rounds: 2,
          roundsPar: null,
          field: [
            { player: 'ncaa-duke', seed: 1 },
            { player: 'ncaa-vermont', seed: 16 },
            { player: 'ncaa-houston', seed: 1 },
            { player: 'ncaa-texas-xavier', seed: 16, isPlayInPlace: true },
          ],
          matches: [
            { matchNumber: 1, roundNumber: 1, home: 'ncaa-duke', away: 'ncaa-vermont', isNeutralSite: true, scheduledAt: '2027-03-20T12:15:00-04:00', advancesTo: { matchNumber: 3, side: 'HOME' } },
            { matchNumber: 2, roundNumber: 1, home: 'ncaa-houston', away: 'ncaa-texas-xavier', isNeutralSite: true, advancesTo: { matchNumber: 3, side: 'AWAY' } },
            { matchNumber: 3, roundNumber: 2, home: null, away: null, isNeutralSite: true, advancesTo: null },
          ],
        }],
      }],
    };
    return file as BracketFile;
  }

  it('reads a basketball file whose events carry a bracket, region seeds and a play-in place', () => {
    const file = parseSportDataFile(bracketFile(), { allowTestData: false });
    const event = file.sportLeagues[0].events[0];

    expect(event.matches?.map((match) => [match.matchNumber, match.home, match.away, match.advancesTo?.matchNumber ?? null])).toEqual([
      [1, 'ncaa-duke', 'ncaa-vermont', 3],
      [2, 'ncaa-houston', 'ncaa-texas-xavier', 3],
      [3, null, null, null],
    ]);
    expect(event.field.map((entry) => [entry.seed, entry.isPlayInPlace ?? false])).toEqual([[1, false], [16, false], [1, false], [16, true]]);
  });

  it('refuses a bracket whose shape the bracket endpoint would refuse, naming each problem with the event', () => {
    const file = bracketFile();
    const matches = file.sportLeagues[0].events[0].matches;
    matches[1].away = 'ncaa-duke';
    matches[2].advancesTo = { matchNumber: 1, side: 'HOME' };

    expect(problemsOf(file)).toEqual([
      'NCAA Men, Tournament: bracket: match 2 away names the same field row as match 1 home.',
      'NCAA Men, Tournament: bracket: match 3 advances to match 1, which is not in a later round.',
      'NCAA Men, Tournament: bracket: match 1 home names a team, but match 3\'s winner fills it.',
      'NCAA Men, Tournament: bracket: a bracket has one final, the one match whose winner advances nowhere, but this one has 0.',
    ]);
  });

  it('refuses a side naming a team that is not in the event\'s field', () => {
    const file = bracketFile();
    file.sportLeagues[0].events[0].matches[0].away = 'ncaa-gonzaga';

    expect(problemsOf(file)).toEqual(['NCAA Men, Tournament: bracket: match 1 away names ncaa-gonzaga, which is not on the event\'s field.']);
  });

  it('refuses a bracket the scope\'s contents leave out, and BRACKET without FIELDS', () => {
    const withoutBracket = bracketFile();
    withoutBracket.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS'];
    expect(problemsOf(withoutBracket)).toEqual(['NCAA Men, Tournament: has a bracket, but the scope\'s contents leave out BRACKET.']);

    const withoutField = bracketFile();
    withoutField.scope.contents = ['SCHEDULE', 'BRACKET'];
    withoutField.sportLeagues[0].events[0].field = [];
    withoutField.sportLeagues[0].events[0].matches = [];
    expect(problemsOf(withoutField)).toEqual(['scope.contents has BRACKET without FIELDS: a bracket names field places, so the file carries the field.']);
  });

  /** The bracket as a test seed: made-up odds on every team and a result on every match. */
  function bracketTestSeed(): BracketFile {
    const file = bracketFile();
    file.testData = true;
    file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'BRACKET', 'RESULTS'];
    const event = file.sportLeagues[0].events[0];
    event.field = event.field.map((entry, index) => ({ ...(entry as object), oddsToWin: 3 + index }));
    for (const match of event.matches) match.result = { winner: 'HOME', homeScore: 70, awayScore: 61 };
    return file;
  }

  it('reads a bracket test seed: made-up odds on the field and a result on each match', () => {
    const event = parseSportDataFile(bracketTestSeed(), { allowTestData: true }).sportLeagues[0].events[0];

    expect(event.field.map((entry) => entry.oddsToWin)).toEqual([3, 4, 5, 6]);
    expect(event.matches?.map((match) => match.result?.winner)).toEqual(['HOME', 'HOME', 'HOME']);
  });

  it('reads a test seed\'s retirement and walkover with no score, and a result with no ending as played (#704)', () => {
    const file = bracketTestSeed();
    const [first, second] = file.sportLeagues[0].events[0].matches;
    first.result = { winner: 'AWAY', homeScore: 1, awayScore: 0, ending: 'RETIREMENT' };
    second.result = { winner: 'HOME', homeScore: null, awayScore: null, ending: 'WALKOVER' };

    const matches = parseSportDataFile(file, { allowTestData: true }).sportLeagues[0].events[0].matches;

    expect(matches?.map((match) => match.result?.ending)).toEqual(['RETIREMENT', 'WALKOVER', undefined]);
  });

  /** The test seed's event as a week: one round of two games that link nowhere. */
  function weekTestSeed(): BracketFile {
    const file = bracketTestSeed();
    const event = file.sportLeagues[0].events[0];
    event.rounds = 1;
    event.matches = event.matches.slice(0, 2).map((match) => ({ ...match, advancesTo: null }));
    return file;
  }

  it('reads a week\'s game left level with no winner (#787)', () => {
    const file = weekTestSeed();
    file.sportLeagues[0].events[0].matches[0].result = { winner: null, homeScore: 1, awayScore: 1 };

    const matches = parseSportDataFile(file, { allowTestData: true }).sportLeagues[0].events[0].matches;

    expect(matches?.map((match) => match.result?.winner)).toEqual([null, 'HOME']);
  });

  it('refuses no winner on a bracket match, on unequal scores, with a shoot-out or with an ending', () => {
    const bracket = bracketTestSeed();
    bracket.sportLeagues[0].events[0].matches[0].result = { winner: null, homeScore: 1, awayScore: 1 };
    expect(problemsOf(bracket, true)).toContain('NCAA Men, Tournament: match 1 has no winner, but a bracket match always has one.');

    const week = weekTestSeed();
    const [first, second] = week.sportLeagues[0].events[0].matches;
    first.result = { winner: null, homeScore: 2, awayScore: 1 };
    second.result = { winner: null, homeScore: 1, awayScore: 1, homeShootoutScore: 4, awayShootoutScore: 3 };
    expect(problemsOf(week, true)).toEqual([
      'NCAA Men, Tournament: match 1 has no winner, so it needs level scores, played to its end with no shoot-out.',
      'NCAA Men, Tournament: match 2 has no winner, so it needs level scores, played to its end with no shoot-out.',
    ]);
  });

  it('refuses a result with an ending that is not one', () => {
    const file = bracketTestSeed();
    file.sportLeagues[0].events[0].matches[0].result = { winner: 'HOME', homeScore: 1, awayScore: 0, ending: 'ABANDONED' };

    expect(problemsOf(file, true).join(' ')).toMatch(/ending/);
  });

  it('refuses a bracket test seed without odds, with golf\'s stroke rounds, or without its bracket', () => {
    const file = bracketTestSeed();
    const field = file.sportLeagues[0].events[0].field as Array<{ oddsToWin?: number; rounds?: number[] }>;
    delete field[0].oddsToWin;
    field[1].rounds = [70];
    file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'];

    expect(problemsOf(file, true)).toEqual([
      'A bracket sport\'s test seed needs BRACKET: its results are the bracket\'s match results.',
      'NCAA Men, Tournament: has a bracket, but the scope\'s contents leave out BRACKET.',
      'NCAA Men, Tournament: ncaa-duke needs oddsToWin in test data.',
      'NCAA Men, Tournament: ncaa-vermont carries rounds, which only a golf test seed has.',
    ]);
  });

  it('reads a play-in place\'s winner in a test seed: a team of the league not in the field', () => {
    const file = bracketTestSeed();
    file.sportLeagues[0].events[0].field[3] = { ...(file.sportLeagues[0].events[0].field[3] as object), playInWinner: 'ncaa-xavier' };
    (file.sportLeagues[0] as unknown as { players: unknown[] }).players.push({ key: 'ncaa-xavier', name: 'Xavier', countryCode: 'US', ranking: 1 });

    const event = parseSportDataFile(file, { allowTestData: true }).sportLeagues[0].events[0];

    expect(event.field.map((entry) => entry.playInWinner ?? null)).toEqual([null, null, null, 'ncaa-xavier']);
  });

  it('refuses a play-in winner in a real file, on a place that is not a play-in place, or naming a team outside the league or already in the field', () => {
    const real = bracketFile();
    real.sportLeagues[0].events[0].field[3] = { ...(real.sportLeagues[0].events[0].field[3] as object), playInWinner: 'ncaa-duke' };
    expect(problemsOf(real)).toEqual([
      'NCAA Men, Tournament: ncaa-texas-xavier\'s play-in winner ncaa-duke is already in the field.',
      'NCAA Men, Tournament: ncaa-texas-xavier carries playInWinner, which only test data may.',
    ]);

    const seed = bracketTestSeed();
    const field = seed.sportLeagues[0].events[0].field;
    field[0] = { ...(field[0] as object), playInWinner: 'ncaa-houston' };
    field[3] = { ...(field[3] as object), playInWinner: 'ncaa-gonzaga' };
    expect(problemsOf(seed, true)).toEqual([
      'NCAA Men, Tournament: ncaa-duke names a play-in winner, but is not a play-in place.',
      'NCAA Men, Tournament: ncaa-duke\'s play-in winner ncaa-houston is already in the field.',
      'NCAA Men, Tournament: ncaa-texas-xavier\'s play-in winner ncaa-gonzaga is not in NCAA Men\'s players.',
    ]);
  });

  it('refuses match results in a real file', () => {
    const file = bracketFile();
    file.sportLeagues[0].events[0].matches[0].result = { winner: 'AWAY', homeScore: 60, awayScore: 64 };

    expect(problemsOf(file)).toEqual(['NCAA Men, Tournament: carries match results, which only test data may.']);
  });

  it('refuses period scores in a real file, and on a match with no result', () => {
    const real = bracketFile();
    real.sportLeagues[0].events[0].matches[0].periodScores = [{ periodNumber: 1, homeScore: 30, awayScore: 28 }];
    expect(problemsOf(real)).toEqual([
      'NCAA Men, Tournament: carries period scores, which only test data may.',
      'NCAA Men, Tournament: match 1 carries period scores but no result, and they are entered with its result.',
    ]);
  });

  it('refuses a football test seed\'s period scores for the last quarter, out of order, or on a match with no result', () => {
    const file = bracketTestSeed();
    (file.scope as { sport?: string }).sport = 'AMERICAN_FOOTBALL';
    const matches = file.sportLeagues[0].events[0].matches;
    matches[0].periodScores = [{ periodNumber: 1, homeScore: 7, awayScore: 0 }, { periodNumber: 3, homeScore: 14, awayScore: 7 }];
    expect(problemsOf(file, true)).toEqual([]);

    matches[0].periodScores = [{ periodNumber: 4, homeScore: 21, awayScore: 7 }];
    matches[1].periodScores = [{ periodNumber: 2, homeScore: 7, awayScore: 0 }, { periodNumber: 1, homeScore: 0, awayScore: 0 }];
    delete matches[2].result;
    matches[2].periodScores = [{ periodNumber: 1, homeScore: 0, awayScore: 0 }];
    expect(problemsOf(file, true)).toEqual([
      'NCAA Men, Tournament: match 1 has a score for quarter 4 or later, which is the result\'s final score.',
      'NCAA Men, Tournament: match 2\'s period scores are not in period order, once each.',
      'NCAA Men, Tournament: match 3 carries period scores but no result, and they are entered with its result.',
    ]);
  });

  it('reads a league that reseeds: first-round games that link nowhere, each match in its region', () => {
    const file = bracketFile();
    file.sportLeagues[0].bracketAdvancement = 'RESEED_BY_SEED';
    for (const match of file.sportLeagues[0].events[0].matches) match.regionLabel = 'East';
    file.sportLeagues[0].events[0].matches[0].advancesTo = null;
    file.sportLeagues[0].events[0].matches[1].advancesTo = null;

    const league = parseSportDataFile(file, { allowTestData: false }).sportLeagues[0];

    expect(league.bracketAdvancement).toBe('RESEED_BY_SEED');
    expect(league.events[0].matches?.map((match) => [match.matchNumber, match.regionLabel, match.advancesTo])).toEqual([[1, 'East', null], [2, 'East', null], [3, 'East', null]]);
  });

  it('refuses first-round games that link nowhere when the league does not reseed', () => {
    const file = bracketFile();
    file.sportLeagues[0].events[0].matches[0].advancesTo = null;

    expect(problemsOf(file)).toEqual(['NCAA Men, Tournament: bracket: a bracket has one final, the one match whose winner advances nowhere, but this one has 2.']);
  });

  it('refuses a golf league that reseeds its brackets', () => {
    const golf = edited((file) => {
      (file.sportLeagues[0] as { bracketAdvancement?: string }).bracketAdvancement = 'RESEED_BY_SEED';
    });

    expect(problemsOf(golf)).toEqual(['PGA TOUR: reseeds its brackets, which only a sport played as a bracket has.']);
  });

  it('refuses a bracket, a seed or a play-in place for a sport not played as a bracket', () => {
    const golf = edited((file) => {
      file.scope.contents.push('BRACKET');
      file.sportLeagues[0].events[0].field[0] = { player: 'pga-a', seed: 1, isPlayInPlace: true };
      (file.sportLeagues[0].events[0] as { matches?: unknown[] }).matches = [
        { matchNumber: 1, roundNumber: 1, home: 'pga-a', away: null, isNeutralSite: true, advancesTo: null },
      ];
    });

    expect(problemsOf(golf)).toEqual([
      'scope.contents has BRACKET, but a golf event is not played as a bracket.',
      'PGA TOUR, The RSM Classic: has a bracket, which only a sport played as a bracket has.',
      'PGA TOUR, The RSM Classic: marks a seed or a play-in place, which only a sport played as a bracket has.',
    ]);
  });
});

describe('sport data stat pool box scores (#935)', () => {
  interface StatPoolFile {
    testData: boolean;
    scope: { sport: string; season: number; sportLeagues: string[]; contents: string[] };
    sportLeagues: Array<{
      name: string;
      players: Array<Record<string, unknown>>;
      events: Array<{ rounds: number; field: Array<Record<string, unknown>>; games?: Array<{ gameNumber: number; lines: Array<{ player: string; stats: Record<string, number> }> }> } & Record<string, unknown>>;
    }>;
  }

  /** The World Series as a stat pool: two hitters, their lines for the first two games. */
  function worldSeries(): StatPoolFile {
    const file = {
      schemaVersion: 1,
      scope: { sport: 'BASEBALL', season: 2025, sportLeagues: ['World Series'], contents: ['SCHEDULE', 'PLAYERS', 'FIELDS', 'STATS'] },
      testData: false,
      provenance: { gatheredAt: '2026-10-24', gatheredBy: 'load-sport-data skill', sources: [{ name: 'MLB Stats API', url: 'https://statsapi.mlb.com' }] },
      sportLeagues: [{
        name: 'World Series',
        players: [
          { key: 'mlb-shohei-ohtani', name: 'Shohei Ohtani', countryCode: 'JP', ranking: 1, team: 'Los Angeles Dodgers', position: 'DH' },
          { key: 'mlb-bo-bichette', name: 'Bo Bichette', countryCode: 'US', ranking: 2, team: 'Toronto Blue Jays', position: 'SS' },
        ],
        events: [{
          key: 'world-series-2025',
          name: 'World Series',
          startDate: '2025-10-24',
          endDate: '2025-11-01',
          venue: null,
          location: null,
          rounds: 7,
          roundsPar: null,
          field: [{ player: 'mlb-shohei-ohtani', ranking: 1 }, { player: 'mlb-bo-bichette', ranking: 2 }],
          games: [
            { gameNumber: 1, lines: [{ player: 'mlb-shohei-ohtani', stats: { TOTAL_BASES: 4, RUNS: 1, RUNS_BATTED_IN: 2, WALKS: 1 } }] },
            { gameNumber: 2, lines: [{ player: 'mlb-bo-bichette', stats: { TOTAL_BASES: 1 } }, { player: 'mlb-shohei-ohtani', stats: {} }] },
          ],
        }],
      }],
    };
    return file as StatPoolFile;
  }

  it('reads a real stat pool file: players with their team and position, and each game\'s box score', () => {
    const file = parseSportDataFile(worldSeries(), { allowTestData: false });

    expect(file.sportLeagues[0].players[0]).toMatchObject({ team: 'Los Angeles Dodgers', position: 'DH' });
    expect(file.sportLeagues[0].events[0].games?.map((game) => [game.gameNumber, game.lines.length])).toEqual([[1, 1], [2, 2]]);
  });

  it('reads a stat pool test seed tiered by its ranking, with no made-up odds and no bracket', () => {
    const seed = worldSeries();
    seed.testData = true;
    seed.scope.contents.push('RESULTS');

    expect(problemsOf(seed, true)).toEqual([]);
  });

  it('refuses a stat pool test seed entry with no ranking to tier it by', () => {
    const seed = worldSeries();
    seed.testData = true;
    seed.scope.contents.push('RESULTS');
    delete seed.sportLeagues[0].events[0].field[1]['ranking'];

    expect(problemsOf(seed, true)).toEqual(['World Series, World Series: mlb-bo-bichette needs a ranking in test data, to tier the field by.']);
  });

  it('refuses a game beyond the series or given twice, a line off the field or twice in a game, and a stat the Box Score does not count', () => {
    const file = worldSeries();
    const event = file.sportLeagues[0].events[0];
    event.games?.push(
      { gameNumber: 8, lines: [] },
      { gameNumber: 2, lines: [] },
      { gameNumber: 3, lines: [
        { player: 'mlb-nobody', stats: {} },
        { player: 'mlb-bo-bichette', stats: { POINTS: 3 } },
        { player: 'mlb-bo-bichette', stats: {} },
      ] },
    );

    expect(problemsOf(file)).toEqual([
      'World Series, World Series: game 2 appears more than once.',
      'World Series, World Series: game 8 is beyond its 7 games.',
      'World Series, World Series: game 3: mlb-bo-bichette has more than one line.',
      'World Series, World Series: game 3: mlb-nobody is not in the field.',
      'World Series, World Series: game 3: mlb-bo-bichette\'s POINTS is not a stat the Box Score counts.',
    ]);
  });

  it('refuses box scores the scope\'s contents leave out, STATS without FIELDS, and STATS for a sport with no stat pool', () => {
    const unscoped = worldSeries();
    unscoped.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS'];
    expect(problemsOf(unscoped)).toEqual(['World Series, World Series: has box scores, but the scope\'s contents leave out STATS.']);

    const fieldless = worldSeries();
    fieldless.scope.contents = ['SCHEDULE', 'STATS'];
    expect(problemsOf(fieldless)).toContain('scope.contents has STATS without FIELDS: a box score names field players, so the file carries the field.');

    const golf = edited((file) => file.scope.contents.push('STATS'));
    expect(problemsOf(golf)).toContain('scope.contents has STATS, but golf has no stat pool.');
  });

  it('reads a run for a loss as negative rushing yards, and refuses a negative count of anything else', () => {
    const superBowl = worldSeries();
    superBowl.scope = { ...superBowl.scope, sport: 'AMERICAN_FOOTBALL', season: 2026, sportLeagues: ['Super Bowl'] };
    const league = superBowl.sportLeagues[0];
    league.name = 'Super Bowl';
    Object.assign(league.events[0], { key: 'super-bowl-lx', name: 'Super Bowl LX', startDate: '2026-02-08', endDate: '2026-02-08', rounds: 1 });
    league.events[0].games = [{ gameNumber: 1, lines: [{ player: 'mlb-shohei-ohtani', stats: { RUSHING_YARDS: -3, RECEPTIONS: 2 } }] }];
    expect(problemsOf(superBowl)).toEqual([]);

    const file = worldSeries();
    file.sportLeagues[0].events[0].games = [{ gameNumber: 1, lines: [{ player: 'mlb-shohei-ohtani', stats: { RUNS: -1 } }] }];
    expect(problemsOf(file)).toEqual(['World Series, World Series: game 1: mlb-shohei-ohtani\'s RUNS is -1; only yards go below 0.']);
  });
});

describe('sport data test slate', () => {
  function slate(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      scope: { sport: 'AUTO_RACING', season: 2025, sportLeagues: ['Formula 1'], contents: ['PLAYERS', 'FIELDS'] },
      testData: true,
      provenance: { gatheredAt: '2026-10-14', gatheredBy: 'test', sources: [{ name: 'F1 2025', url: 'https://example.com/f1' }] },
      sportLeagues: [{ name: 'Formula 1', players: [{ key: 'f1-a', name: 'Driver A', countryCode: 'GB', ranking: 1 }], events: [] }],
    };
  }

  it('reads a test slate of any registry sport, with players and no events, as a slate', () => {
    const file = parseSportDataFile(slate(), { allowTestData: true });

    expect(file.scope.sport).toBe(Sport.AUTO_RACING);
    expect(isTestSlate(file)).toBe(true);
  });

  it('does not treat a test seed or a real field file as a slate', () => {
    expect(isTestSlate({ testData: true, scope: { contents: ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'] } })).toBe(false);
    expect(isTestSlate({ testData: false, scope: { contents: ['PLAYERS', 'FIELDS'] } })).toBe(false);
  });

  it('refuses a slate with events, with no players, or with more than one sport league, and one on a target without test data', () => {
    const withEvents = slate() as { sportLeagues: Array<{ name: string; players: unknown[]; events: unknown[] }>; scope: { season: number; sportLeagues: string[] } };
    withEvents.sportLeagues[0].events.push({
      key: 'bahrain', name: 'Bahrain Grand Prix', startDate: '2025-04-11', endDate: '2025-04-13', venue: null, location: null, rounds: 1, roundsPar: null, field: [],
    });
    expect(problemsOf(withEvents, true)).toContain('Formula 1: a test slate has no events; the run names the event it fills.');

    const empty = slate() as { sportLeagues: Array<{ players: unknown[] }> };
    empty.sportLeagues[0].players = [];
    expect(problemsOf(empty, true)).toEqual(['Formula 1: a test slate needs players.']);

    const two = slate() as { scope: { sportLeagues: string[] }; sportLeagues: Array<Record<string, unknown>> };
    two.scope.sportLeagues.push('IndyCar');
    two.sportLeagues.push({ name: 'IndyCar', players: [{ key: 'indy-a', name: 'Driver B', countryCode: 'US', ranking: 1 }], events: [] });
    expect(problemsOf(two, true)).toEqual(['A test slate holds one sport league; this one has 2.']);

    expect(problemsOf(slate(), false)).toEqual(['testData is true, and this target does not take test data.']);
  });
});

describe('sport data load report', () => {
  it('counts every row and lists only the changes, with the file scope and where the data came from', () => {
    const file = parseSportDataFile(realFile(), { allowTestData: false });
    const report = formatLoadReport(file, LoadMode.DRY_RUN, [
      { sportLeague: 'PGA TOUR', subject: LoadSubject.PLAYER, action: LoadAction.SKIP, name: 'Golfer A', detail: null },
      { sportLeague: 'PGA TOUR', subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: 'The RSM Classic', detail: 'venue A → B' },
    ]);

    expect(report).toContain('dry run, nothing written');
    expect(report).toContain('GOLF 2027: PGA TOUR. Contents: SCHEDULE, PLAYERS, FIELDS.');
    expect(report).toContain('[PGA TOUR schedule](https://www.pgatour.com/schedule)');
    expect(report).toContain('| Player | 0 | 0 | 1 | 0 |');
    expect(report).toContain('| PGA TOUR | Event | UPDATE | The RSM Classic | venue A → B |');
    expect(report).not.toContain('| Player | SKIP |');
  });

  it('says the site already matches when a run has nothing but skips', () => {
    const file = parseSportDataFile(realFile(), { allowTestData: false });

    expect(formatLoadReport(file, LoadMode.APPLY, [])).toContain('Nothing to change: the site already matches the file.');
  });
});
