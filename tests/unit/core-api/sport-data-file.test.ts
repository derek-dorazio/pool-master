import { Sport } from '@poolmaster/shared/domain';
import { formatLoadReport, LoadAction, LoadMode, LoadSubject } from '../../../packages/core-api/scripts/seed-golf/load-report';
import { isTestSlate, parseSportDataFile, SportDataFileError } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';

// A test data file carries its scope in an envelope; the loader refuses a file whose data
// strays outside it, before it reads or writes the site. Every file is test data (#1850).

function golfTestSeed(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scope: { sport: 'GOLF', season: 2027, sportLeagues: ['PGA TOUR'], contents: ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'] },
    testData: true,
    provenance: { gatheredAt: '2026-10-13', gatheredBy: 'test data', sources: [{ name: 'PGA TOUR schedule', url: 'https://www.pgatour.com/schedule' }] },
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
        field: [{ player: 'pga-a', ranking: 1, oddsToWin: 6.5, rounds: [71, 65, 70, 64] }],
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
    scope: { sport: 'HORSE_RACING', season: 2027, sportLeagues: ['US Thoroughbred'], contents: ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'] },
    testData: true,
    provenance: { gatheredAt: '2026-10-14', gatheredBy: 'test data', sources: [{ name: 'Pegasus World Cup', url: 'https://www.pegasusworldcup.com/' }] },
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
  return file;
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

function problemsOf(json: unknown): readonly string[] {
  try {
    parseSportDataFile(json);
  } catch (error) {
    if (error instanceof SportDataFileError) return error.problems;
    throw error;
  }
  return [];
}

interface EditableFile {
  scope: { sport: string; season: number; sportLeagues: string[]; contents: string[] };
  testData: boolean;
  sportLeagues: Array<{ events: Array<{ name: string; startDate: string; winner?: string; purse?: number; field: Array<Record<string, unknown>> }> }>;
}

function edited(edit: (file: EditableFile) => void): unknown {
  const file = golfTestSeed() as unknown as EditableFile;
  edit(file);
  return file;
}

describe('sport data file envelope', () => {
  it('reads a golf test seed and types its sport from the registry', () => {
    const file = parseSportDataFile(golfTestSeed());

    expect(file.scope.sport).toBe(Sport.GOLF);
    expect(file.sportLeagues[0].events[0].field).toEqual([{ player: 'pga-a', ranking: 1, oddsToWin: 6.5, rounds: [71, 65, 70, 64] }]);
  });

  it('refuses a file that is not test data, since real events and fields come from the provider sync (#1850)', () => {
    expect(problemsOf(edited((file) => { file.testData = false; }))).toEqual([expect.stringMatching(/^testData: /)]);
  });

  it('reads a player\'s feed id at each provider, and refuses one feed id on two players of a league (#1850)', () => {
    const feedIds = { balldontlie: '1001' };
    const withFeedIds = golfTestSeed() as { sportLeagues: Array<{ players: Array<Record<string, unknown>> }> };
    withFeedIds.sportLeagues[0].players[0]['feedIds'] = feedIds;

    expect(parseSportDataFile(withFeedIds).sportLeagues[0].players[0].feedIds).toEqual(feedIds);

    withFeedIds.sportLeagues[0].players.push({ key: 'pga-b', name: 'Golfer B', countryCode: 'US', ranking: 2, feedIds });
    expect(problemsOf(withFeedIds)).toEqual(['PGA TOUR: feed id balldontlie 1001 is on more than one player.']);
  });

  it('refuses a feed id on an event, which a test event never carries: a real one would let the live-score poll write real results onto it (#1850)', () => {
    const problems = problemsOf(edited((file) => { Object.assign(file.sportLeagues[0].events[0], { feedIds: { balldontlie: '40' } }); }));

    expect(problems.some((problem) => problem.includes('feedIds'))).toBe(true);
  });

  it('refuses a schema version it does not know rather than misread it', () => {
    expect(problemsOf({ ...golfTestSeed(), schemaVersion: 2 })).toEqual(['schemaVersion is 2; this loader reads version 1.']);
  });

  it('refuses a sport that is not in the sport registry', () => {
    expect(problemsOf(edited((file) => { file.scope.sport = 'CURLING'; }))).toContain('scope.sport CURLING is not a sport in the sport registry.');
  });

  it('reads a horse racing test seed whose race has a post time and no par', () => {
    const file = parseSportDataFile(horseRacingFile());

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
    const file = parseSportDataFile(raceTestSeed());

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

    expect(problemsOf(file)).toEqual([
      'US Thoroughbred, Pegasus World Cup: race-a needs raceResult in test data.',
      'US Thoroughbred, Pegasus World Cup: race-b carries rounds, which only a golf test seed has.',
      'US Thoroughbred, Pegasus World Cup: race-d has a finishing place only if it finished, and needs one if it did.',
      'US Thoroughbred, Pegasus World Cup: the finishing places do not run 1, 2, 3 ... (a dead heat repeats a place and skips the next).',
    ]);
  });

  it('refuses a race result on a golf test seed', () => {
    const golf = edited((file) => {
      Object.assign(file.sportLeagues[0].events[0].field[0], { raceResult: { status: 'FINISHED', finishPosition: 1 } });
    });

    expect(problemsOf(golf)).toEqual(['PGA TOUR, The RSM Classic: pga-a carries raceResult, which only a race\'s test seed has.']);
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
    expect(problemsOf(edited((file) => { file.sportLeagues[0].events[0].field.push({ player: 'pga-zz', oddsToWin: 9, rounds: [70, 70, 70, 70] }); }))).toEqual([
      "PGA TOUR, The RSM Classic: pga-zz is not in PGA TOUR's players.",
    ]);
  });

  it('refuses a field in a file whose contents leave out FIELDS, and FIELDS without PLAYERS', () => {
    expect(problemsOf(edited((file) => { file.scope.contents = ['SCHEDULE', 'PLAYERS', 'RESULTS']; }))).toEqual([
      'testData needs SCHEDULE, PLAYERS, FIELDS, RESULTS (a test seed), or just PLAYERS and FIELDS (a test slate); missing FIELDS.',
      'PGA TOUR, The RSM Classic: has a field, but the scope\'s contents leave out FIELDS.',
    ]);
    expect(problemsOf(edited((file) => { file.scope.contents = ['SCHEDULE', 'FIELDS', 'RESULTS']; }))).toEqual([
      'scope.contents has FIELDS without PLAYERS: a field names its players, so the file carries them.',
      'testData needs SCHEDULE, PLAYERS, FIELDS, RESULTS (a test seed), or just PLAYERS and FIELDS (a test slate); missing PLAYERS.',
    ]);
  });

  it('refuses a test seed without a test seed\'s contents', () => {
    expect(problemsOf(edited((file) => { file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS']; }))).toEqual([
      'testData needs SCHEDULE, PLAYERS, FIELDS, RESULTS (a test seed), or just PLAYERS and FIELDS (a test slate); missing RESULTS.',
    ]);
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
      scope: { sport: 'BASKETBALL', season: 2027, sportLeagues: ['NCAA Men'], contents: ['SCHEDULE', 'PLAYERS', 'FIELDS', 'BRACKET', 'RESULTS'] },
      testData: true,
      provenance: { gatheredAt: '2027-03-14', gatheredBy: 'test data', sources: [{ name: 'NCAA bracket', url: 'https://www.ncaa.com/brackets' }] },
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
            { player: 'ncaa-duke', seed: 1, oddsToWin: 3 },
            { player: 'ncaa-vermont', seed: 16, oddsToWin: 4 },
            { player: 'ncaa-houston', seed: 1, oddsToWin: 5 },
            { player: 'ncaa-texas-xavier', seed: 16, isPlayInPlace: true, oddsToWin: 6 },
          ],
          matches: [
            { matchNumber: 1, roundNumber: 1, home: 'ncaa-duke', away: 'ncaa-vermont', isNeutralSite: true, scheduledAt: '2027-03-20T12:15:00-04:00', advancesTo: { matchNumber: 3, side: 'HOME' } },
            { matchNumber: 2, roundNumber: 1, home: 'ncaa-houston', away: 'ncaa-texas-xavier', isNeutralSite: true, advancesTo: { matchNumber: 3, side: 'AWAY' } },
            { matchNumber: 3, roundNumber: 2, home: null, away: null, isNeutralSite: true, advancesTo: null },
          ],
        }],
      }],
    };
    return file;
  }

  it('reads a basketball file whose events carry a bracket, region seeds and a play-in place', () => {
    const file = parseSportDataFile(bracketFile());
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
      'NCAA Men, Tournament: ncaa-texas-xavier is in the field but in no match, and the release refuses a field member left out of the games.',
    ]);
  });

  it('refuses a side naming a team that is not in the event\'s field', () => {
    const file = bracketFile();
    file.sportLeagues[0].events[0].matches[0].away = 'ncaa-gonzaga';

    expect(problemsOf(file)).toEqual([
      'NCAA Men, Tournament: bracket: match 1 away names ncaa-gonzaga, which is not on the event\'s field.',
      'NCAA Men, Tournament: ncaa-vermont is in the field but in no match, and the release refuses a field member left out of the games.',
    ]);
  });

  it('refuses a bracket the scope\'s contents leave out, and BRACKET without FIELDS', () => {
    const withoutBracket = bracketFile();
    withoutBracket.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'];
    expect(problemsOf(withoutBracket)).toContain('NCAA Men, Tournament: has a bracket, but the scope\'s contents leave out BRACKET.');

    const withoutField = bracketFile();
    withoutField.scope.contents = ['SCHEDULE', 'BRACKET', 'RESULTS'];
    withoutField.sportLeagues[0].events[0].field = [];
    withoutField.sportLeagues[0].events[0].matches = [];
    expect(problemsOf(withoutField)).toContain('scope.contents has BRACKET without FIELDS: a bracket names field places, so the file carries the field.');
  });

  /** The bracket test seed with a result on every match. */
  function bracketTestSeed(): BracketFile {
    const file = bracketFile();
    for (const match of file.sportLeagues[0].events[0].matches) match.result = { winner: 'HOME', homeScore: 70, awayScore: 61 };
    return file;
  }

  it('reads a bracket test seed: made-up odds on the field and a result on each match', () => {
    const event = parseSportDataFile(bracketTestSeed()).sportLeagues[0].events[0];

    expect(event.field.map((entry) => entry.oddsToWin)).toEqual([3, 4, 5, 6]);
    expect(event.matches?.map((match) => match.result?.winner)).toEqual(['HOME', 'HOME', 'HOME']);
  });

  it('reads a test seed\'s retirement and walkover with no score, and a result with no ending as played (#704)', () => {
    const file = bracketTestSeed();
    const [first, second] = file.sportLeagues[0].events[0].matches;
    first.result = { winner: 'AWAY', homeScore: 1, awayScore: 0, ending: 'RETIREMENT' };
    second.result = { winner: 'HOME', homeScore: null, awayScore: null, ending: 'WALKOVER' };

    const matches = parseSportDataFile(file).sportLeagues[0].events[0].matches;

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

    const matches = parseSportDataFile(file).sportLeagues[0].events[0].matches;

    expect(matches?.map((match) => match.result?.winner)).toEqual([null, 'HOME']);
  });

  it('refuses no winner on a bracket match, on unequal scores, with a shoot-out or with an ending', () => {
    const bracket = bracketTestSeed();
    bracket.sportLeagues[0].events[0].matches[0].result = { winner: null, homeScore: 1, awayScore: 1 };
    expect(problemsOf(bracket)).toContain('NCAA Men, Tournament: match 1 has no winner, but a bracket match always has one.');

    const week = weekTestSeed();
    const [first, second] = week.sportLeagues[0].events[0].matches;
    first.result = { winner: null, homeScore: 2, awayScore: 1 };
    second.result = { winner: null, homeScore: 1, awayScore: 1, homeShootoutScore: 4, awayShootoutScore: 3 };
    expect(problemsOf(week)).toEqual([
      'NCAA Men, Tournament: match 1 has no winner, so it needs level scores, played to its end with no shoot-out.',
      'NCAA Men, Tournament: match 2 has no winner, so it needs level scores, played to its end with no shoot-out.',
    ]);
  });

  it('refuses a week whose field has a team in none of its games, which the release would refuse', () => {
    const week = weekTestSeed();
    week.sportLeagues[0].events[0].matches = week.sportLeagues[0].events[0].matches.slice(0, 1);

    expect(problemsOf(week)).toEqual([
      'NCAA Men, Tournament: ncaa-houston is in the field but in no match, and the release refuses a field member left out of the games.',
      'NCAA Men, Tournament: ncaa-texas-xavier is in the field but in no match, and the release refuses a field member left out of the games.',
    ]);
  });

  it('reads a week\'s postponed game as cancelled, with no result, so every team of the week stays in a game', () => {
    const week = weekTestSeed();
    const second = week.sportLeagues[0].events[0].matches[1] as BracketMatch & { cancelled?: boolean };
    delete second.result;
    second.cancelled = true;

    const matches = parseSportDataFile(week).sportLeagues[0].events[0].matches;

    expect(matches?.map((match) => [match.matchNumber, match.cancelled, match.result?.winner])).toEqual([[1, undefined, 'HOME'], [2, true, undefined]]);
  });

  it('refuses a cancelled game with a result or period scores, and in a bracket, which cannot lose a game', () => {
    const played = weekTestSeed();
    Object.assign(played.sportLeagues[0].events[0].matches[1], { cancelled: true });
    expect(problemsOf(played)).toEqual(['NCAA Men, Tournament: match 2 is cancelled, so it has no result and no period scores.']);

    const scored = weekTestSeed();
    const scoredGame = scored.sportLeagues[0].events[0].matches[1];
    delete scoredGame.result;
    Object.assign(scoredGame, { cancelled: true, periodScores: [{ periodNumber: 1, homeScore: 0, awayScore: 0 }] });
    expect(problemsOf(scored)).toContain('NCAA Men, Tournament: match 2 is cancelled, so it has no result and no period scores.');

    const bracket = bracketTestSeed();
    delete bracket.sportLeagues[0].events[0].matches[1].result;
    Object.assign(bracket.sportLeagues[0].events[0].matches[1], { cancelled: true });
    expect(problemsOf(bracket)).toEqual(['NCAA Men, Tournament: match 2 is cancelled, but only a week\'s game can be: a bracket cannot lose a game.']);
  });

  it('refuses a result with an ending that is not one', () => {
    const file = bracketTestSeed();
    file.sportLeagues[0].events[0].matches[0].result = { winner: 'HOME', homeScore: 1, awayScore: 0, ending: 'ABANDONED' };

    expect(problemsOf(file).join(' ')).toMatch(/ending/);
  });

  it('refuses a bracket test seed without odds, with golf\'s stroke rounds, or without its bracket', () => {
    const file = bracketTestSeed();
    const field = file.sportLeagues[0].events[0].field as Array<{ oddsToWin?: number; rounds?: number[] }>;
    delete field[0].oddsToWin;
    field[1].rounds = [70];
    file.scope.contents = ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'];

    expect(problemsOf(file)).toEqual([
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

    const event = parseSportDataFile(file).sportLeagues[0].events[0];

    expect(event.field.map((entry) => entry.playInWinner ?? null)).toEqual([null, null, null, 'ncaa-xavier']);
  });

  it('refuses a play-in winner on a place that is not a play-in place, or naming a team outside the league or already in the field', () => {
    const seed = bracketTestSeed();
    const field = seed.sportLeagues[0].events[0].field;
    field[0] = { ...(field[0] as object), playInWinner: 'ncaa-houston' };
    field[3] = { ...(field[3] as object), playInWinner: 'ncaa-gonzaga' };
    expect(problemsOf(seed)).toEqual([
      'NCAA Men, Tournament: ncaa-duke names a play-in winner, but is not a play-in place.',
      'NCAA Men, Tournament: ncaa-duke\'s play-in winner ncaa-houston is already in the field.',
      'NCAA Men, Tournament: ncaa-texas-xavier\'s play-in winner ncaa-gonzaga is not in NCAA Men\'s players.',
    ]);
  });

  it('refuses a football test seed\'s period scores for the last quarter, out of order, or on a match with no result', () => {
    const file = bracketTestSeed();
    (file.scope as { sport?: string }).sport = 'AMERICAN_FOOTBALL';
    const matches = file.sportLeagues[0].events[0].matches;
    matches[0].periodScores = [{ periodNumber: 1, homeScore: 7, awayScore: 0 }, { periodNumber: 3, homeScore: 14, awayScore: 7 }];
    expect(problemsOf(file)).toEqual([]);

    matches[0].periodScores = [{ periodNumber: 4, homeScore: 21, awayScore: 7 }];
    matches[1].periodScores = [{ periodNumber: 2, homeScore: 7, awayScore: 0 }, { periodNumber: 1, homeScore: 0, awayScore: 0 }];
    delete matches[2].result;
    matches[2].periodScores = [{ periodNumber: 1, homeScore: 0, awayScore: 0 }];
    expect(problemsOf(file)).toEqual([
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

    const league = parseSportDataFile(file).sportLeagues[0];

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
      file.sportLeagues[0].events[0].field[0] = { player: 'pga-a', seed: 1, isPlayInPlace: true, oddsToWin: 6.5, rounds: [71, 65, 70, 64] };
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
    const file = parseSportDataFile(slate());

    expect(file.scope.sport).toBe(Sport.AUTO_RACING);
    expect(isTestSlate(file)).toBe(true);
  });

  it('does not treat a test seed, which carries a schedule, as a slate', () => {
    expect(isTestSlate({ scope: { contents: ['SCHEDULE', 'PLAYERS', 'FIELDS', 'RESULTS'] } })).toBe(false);
  });

  it('refuses a slate with events, with no players, or or with more than one sport league', () => {
    const withEvents = slate() as { sportLeagues: Array<{ name: string; players: unknown[]; events: unknown[] }>; scope: { season: number; sportLeagues: string[] } };
    withEvents.sportLeagues[0].events.push({
      key: 'bahrain', name: 'Bahrain Grand Prix', startDate: '2025-04-11', endDate: '2025-04-13', venue: null, location: null, rounds: 1, roundsPar: null, field: [],
    });
    expect(problemsOf(withEvents)).toContain('Formula 1: a test slate has no events; the run names the event it fills.');

    const empty = slate() as { sportLeagues: Array<{ players: unknown[] }> };
    empty.sportLeagues[0].players = [];
    expect(problemsOf(empty)).toEqual(['Formula 1: a test slate needs players.']);

    const two = slate() as { scope: { sportLeagues: string[] }; sportLeagues: Array<Record<string, unknown>> };
    two.scope.sportLeagues.push('IndyCar');
    two.sportLeagues.push({ name: 'IndyCar', players: [{ key: 'indy-a', name: 'Driver B', countryCode: 'US', ranking: 1 }], events: [] });
    expect(problemsOf(two)).toEqual(['A test slate holds one sport league; this one has 2.']);
  });
});

describe('sport data load report', () => {
  it('counts every row and lists only the changes, with the file scope and where the data came from', () => {
    const file = parseSportDataFile(golfTestSeed());
    const report = formatLoadReport(file, LoadMode.DRY_RUN, [
      { sportLeague: 'PGA TOUR', subject: LoadSubject.PLAYER, action: LoadAction.SKIP, name: 'Golfer A', detail: null },
      { sportLeague: 'PGA TOUR', subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: 'The RSM Classic', detail: 'venue A → B' },
    ]);

    expect(report).toContain('dry run, nothing written');
    expect(report).toContain('GOLF 2027: PGA TOUR. Contents: SCHEDULE, PLAYERS, FIELDS, RESULTS.');
    expect(report).toContain('[PGA TOUR schedule](https://www.pgatour.com/schedule)');
    expect(report).toContain('| Player | 0 | 0 | 1 | 0 |');
    expect(report).toContain('| PGA TOUR | Event | UPDATE | The RSM Classic | venue A → B |');
    expect(report).not.toContain('| Player | SKIP |');
  });

  it('says the site already matches when a run has nothing but skips', () => {
    const file = parseSportDataFile(golfTestSeed());

    expect(formatLoadReport(file, LoadMode.APPLY, [])).toContain('Nothing to change: the site already matches the file.');
  });
});
