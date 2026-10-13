import { Sport } from '@poolmaster/shared/domain';
import { formatLoadReport, LoadAction, LoadMode, LoadSubject } from '../../../packages/core-api/scripts/seed-golf/load-report';
import { parseSportDataFile, SportDataFileError } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';

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

  it('refuses a registry sport the loader has no data shape for yet', () => {
    expect(problemsOf(edited((file) => { file.scope.sport = 'HORSE_RACING'; }))).toEqual([
      'scope.sport HORSE_RACING has no data shape in this loader yet; it loads GOLF.',
    ]);
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
      'testData needs every kind of contents; missing RESULTS.',
      'testData is true, and this target does not take test data.',
    ]);
    expect(problemsOf(testFile, true)).toEqual(['testData needs every kind of contents; missing RESULTS.']);
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
