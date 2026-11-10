import { SportEventStatus } from '@poolmaster/shared/domain';
import { LoadAction, LoadSubject, withoutRepeatedRows, type LoadRow } from '../../../packages/core-api/scripts/seed-golf/load-report';
import { rollingOffsetDays, selectTestSeedEvents, shiftedEventDates, type StoredTestEvent } from '../../../packages/core-api/scripts/seed-golf/seed-golf-data';
import { SportDataContent, type SportDataEvent, type SportDataFile } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';

// Tuesday 10 November 2026, mid-morning in New York.
const NOW = new Date('2026-11-10T15:00:00Z');

function event(name: string, startDate: string, endDate = startDate): SportDataEvent {
  return { key: name.toLowerCase().replace(/\W+/g, '-'), name, startDate, endDate, venue: null, location: null, rounds: 1, roundsPar: null, field: [] };
}

function seed(leagues: Record<string, SportDataEvent[]>): SportDataFile {
  return {
    schemaVersion: 1,
    scope: { sport: 'AMERICAN_FOOTBALL', season: 2026, sportLeagues: Object.keys(leagues), contents: [SportDataContent.SCHEDULE] },
    testData: true,
    provenance: { gatheredAt: '2026-11-10', gatheredBy: 'unit test', sources: [] },
    sportLeagues: Object.entries(leagues).map(([name, events]) => ({ name, players: [], events })),
  } as unknown as SportDataFile;
}

function stored(league: string, ...events: StoredTestEvent[]): Map<string, StoredTestEvent[]> {
  return new Map([[league.toLowerCase(), events]]);
}

/** Each loaded event's name and whether the run releases it. */
function releases(selection: ReturnType<typeof selectTestSeedEvents>): Array<[string, boolean]> {
  return selection.leagues.flatMap((league) => league.events.map(({ file, release }) => [file.sportLeagues[0].events[0].name, release] as [string, boolean]));
}

/** Each loaded event's name and its start day after the move. */
function landings(selection: ReturnType<typeof selectTestSeedEvents>): Array<[string, string]> {
  return selection.leagues.flatMap((league) => league.events.map(({ file, offsetDays }) => {
    const loaded = file.sportLeagues[0].events[0];
    return [loaded.name, shiftedEventDates(loaded, offsetDays).startDate.slice(0, 10)] as [string, string];
  }));
}

const WEEKS = [
  event('NFL Week 1', '2025-09-04', '2025-09-08'), // Thursday
  event('NFL Week 2', '2025-09-11', '2025-09-15'),
  event('NFL Week 3', '2025-09-18', '2025-09-22'),
];

describe('rolling a test event forward from the run', () => {
  it('moves an event by whole weeks to the first day on or after the given date that falls on its own weekday', () => {
    // 2025-09-04 is a Thursday; the first Thursday on or after Wednesday 11 November 2026 is the 12th.
    const offset = rollingOffsetDays({ startDate: '2025-09-04' }, new Date('2026-11-11T15:00:00Z'));

    expect(offset % 7).toBe(0);
    expect(shiftedEventDates({ startDate: '2025-09-04', endDate: '2025-09-08' }, offset).startDate.slice(0, 10)).toBe('2026-11-12');
  });

  it('keeps an event that already starts on or after the date where it is', () => {
    expect(rollingOffsetDays({ startDate: '2026-12-03' }, new Date('2026-11-11T00:00:00Z'))).toBe(0);
  });
});

describe('choosing which test seed events to load', () => {
  it('loads the next two events of a league named "Test- ...", the first within the coming week on its own weekday and the second a week later', () => {
    const selection = selectTestSeedEvents(seed({ NFL: WEEKS }), new Map(), 2, NOW);

    expect(selection.waiting).toEqual([]);
    expect(landings(selection)).toEqual([['Test- NFL Week 1', '2026-11-12'], ['Test- NFL Week 2', '2026-11-19']]);
    expect(selection.leagues[0].file.sportLeagues[0].events.map((loaded) => loaded.name)).toEqual(['Test- NFL Week 1', 'Test- NFL Week 2']);
    expect(selection.leagues[0].events.every(({ file }) => file.scope.sportLeagues.length === 1 && file.sportLeagues[0].events.length === 1)).toBe(true);
  });

  it('lays events of different leagues a week apart in the order they were played: the conference championships this coming Sunday and the Super Bowl the Sunday after', () => {
    const file = seed({
      'Championship Weekend': [event('Conference Championships', '2026-01-25')],
      'Super Bowl': [event('Super Bowl LX', '2026-02-08')],
    });

    expect(landings(selectTestSeedEvents(file, new Map(), 2, NOW))).toEqual([
      ['Test- Conference Championships', '2026-11-15'],
      ['Test- Super Bowl LX', '2026-11-22'],
    ]);
  });

  it('keeps two leagues\' events of the same real week in the same week', () => {
    const file = seed({
      'PGA TOUR': [event('Sony Open', '2026-01-15', '2026-01-18'), event('American Express', '2026-01-22', '2026-01-25')],
      'LPGA Tour': [event('Tournament of Champions', '2026-01-15', '2026-01-18')],
    });

    expect(landings(selectTestSeedEvents(file, new Map(), 2, NOW))).toEqual([
      ['Test- Sony Open', '2026-11-12'],
      ['Test- American Express', '2026-11-19'],
      ['Test- Tournament of Champions', '2026-11-12'],
    ]);
  });

  it('leaves a league alone while one of its released test events has not started, so a daily run adds nothing', () => {
    const selection = selectTestSeedEvents(seed({ NFL: WEEKS }), stored('NFL',
      { name: 'Test- NFL Week 1', status: SportEventStatus.COMPLETED, startDate: '2026-11-05T12:00:00Z' },
      { name: 'Test- NFL Week 2', status: SportEventStatus.SCHEDULED, startDate: '2026-11-12T12:00:00Z' },
    ), 2, NOW);

    expect(selection.waiting).toEqual(['NFL']);
    expect(selection.leagues).toEqual([]);
  });

  it('loads a league\'s next events once all its test events have started, rolled from this run', () => {
    const selection = selectTestSeedEvents(seed({ NFL: WEEKS }), stored('NFL',
      { name: 'Test- NFL Week 1', status: SportEventStatus.COMPLETED, startDate: '2026-10-29T12:00:00Z' },
      { name: 'Test- NFL Week 2', status: SportEventStatus.IN_PROGRESS, startDate: '2026-11-05T12:00:00Z' },
    ), 2, NOW);

    expect(landings(selection)).toEqual([['Test- NFL Week 3', '2026-11-12'], ['Test- NFL Week 1 (2)', '2026-11-19']]);
  });

  it('starts over with numbered copies once every event of a one-event league is on the site', () => {
    const file = seed({ 'Super Bowl': [event('Super Bowl LX', '2026-02-08')] });
    const selection = selectTestSeedEvents(file, stored('Super Bowl',
      { name: 'Test- Super Bowl LX', status: SportEventStatus.COMPLETED, startDate: '2026-11-08T12:00:00Z' },
    ), 1, NOW);

    expect(landings(selection)).toEqual([['Test- Super Bowl LX (2)', '2026-11-15']]);
  });

  it('releases only each league\'s first event for contests and leaves the one a week later a draft', () => {
    const file = seed({
      'Championship Weekend': [event('Conference Championships', '2026-01-25')],
      NFL: WEEKS,
    });

    expect(releases(selectTestSeedEvents(file, new Map(), 2, NOW))).toEqual([
      ['Test- Conference Championships', true],
      ['Test- NFL Week 1', true],
      ['Test- NFL Week 2', false],
    ]);
  });

  it('leaves a league\'s draft alone while its released test event has not started, so the draft is not released early', () => {
    const selection = selectTestSeedEvents(seed({ NFL: WEEKS }), stored('NFL',
      { name: 'Test- NFL Week 1', status: SportEventStatus.SCHEDULED, startDate: '2026-11-12T12:00:00Z' },
      { name: 'Test- NFL Week 2', status: SportEventStatus.DRAFT, startDate: '2026-11-19T12:00:00Z' },
    ), 2, NOW);

    expect(selection.waiting).toEqual(['NFL']);
    expect(selection.leagues).toEqual([]);
  });

  it('once the released event has started, moves the league\'s draft into the coming week and releases it, with one new draft a week later', () => {
    const selection = selectTestSeedEvents(seed({ NFL: WEEKS }), stored('NFL',
      { name: 'Test- NFL Week 1', status: SportEventStatus.IN_PROGRESS, startDate: '2026-11-05T12:00:00Z' },
      { name: 'Test- NFL Week 2', status: SportEventStatus.DRAFT, startDate: '2026-11-12T12:00:00Z' },
    ), 2, NOW);

    expect(landings(selection)).toEqual([['Test- NFL Week 2', '2026-11-12'], ['Test- NFL Week 3', '2026-11-19']]);
    expect(releases(selection)).toEqual([['Test- NFL Week 2', true], ['Test- NFL Week 3', false]]);
  });

  it('finishes and releases a test event an earlier run left a draft, counting it toward the league\'s events', () => {
    const selection = selectTestSeedEvents(seed({ NFL: WEEKS }), stored('NFL',
      { name: 'Test- NFL Week 1', status: SportEventStatus.DRAFT, startDate: '2026-11-12T12:00:00Z' },
    ), 1, NOW);

    expect(releases(selection)).toEqual([['Test- NFL Week 1', true]]);
  });

  it('ignores real events of the same name in the league: only "Test-" events count as loaded', () => {
    const selection = selectTestSeedEvents(seed({ NFL: WEEKS }), stored('NFL',
      { name: 'NFL Week 1', status: SportEventStatus.SCHEDULED, startDate: '2026-11-12T12:00:00Z' },
    ), 1, NOW);

    expect(selection.waiting).toEqual([]);
    expect(landings(selection).map(([name]) => name)).toEqual(['Test- NFL Week 1']);
  });
});

describe('a test seed report', () => {
  it('counts a sport league or player once although each event\'s load reports it again, and keeps every event row', () => {
    const row = (subject: LoadRow['subject'], name: string): LoadRow => ({ sportLeague: 'NFL', subject, action: LoadAction.SKIP, name, detail: null });
    const rows = [
      row(LoadSubject.SPORT_LEAGUE, 'NFL'), row(LoadSubject.PLAYER, 'Bills'), row(LoadSubject.EVENT, 'Test- NFL Week 1'),
      row(LoadSubject.SPORT_LEAGUE, 'NFL'), row(LoadSubject.PLAYER, 'Bills'), row(LoadSubject.EVENT, 'Test- NFL Week 2'),
    ];

    expect(withoutRepeatedRows(rows).map((kept) => `${kept.subject} ${kept.name}`)).toEqual([
      'SPORT_LEAGUE NFL', 'PLAYER Bills', 'EVENT Test- NFL Week 1', 'EVENT Test- NFL Week 2',
    ]);
  });
});
