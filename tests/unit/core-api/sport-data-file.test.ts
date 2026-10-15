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

  it('refuses a test seed of a sport other than golf, whose made-up results are stroke rounds', () => {
    const file = horseRacingFile();
    file.testData = true;
    file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'];

    expect(problemsOf(file, true)).toContain(
      'scope.sport HORSE_RACING cannot have a test seed: its made-up results are stroke rounds, so only golf has one. Use a real file or a test slate.',
    );
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

  it('refuses test data on a target that does not take it, and test data without every kind of contents', () => {
    const testFile = edited((file) => {
      file.testData = true;
      file.sportLeagues[0].events[0].field[0] = { player: 'pga-a', ranking: 1, oddsToWin: 5, rounds: [70, 71, 72, 73] };
    });

    expect(problemsOf(testFile, false)).toEqual([
      'testData needs every kind of contents (a test seed), or just PLAYERS and FIELDS (a test slate); missing RESULTS.',
      'testData is true, and this target does not take test data.',
    ]);
    expect(problemsOf(testFile, true)).toEqual(['testData needs every kind of contents (a test seed), or just PLAYERS and FIELDS (a test slate); missing RESULTS.']);
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
