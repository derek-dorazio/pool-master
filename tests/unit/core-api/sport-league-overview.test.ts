/**
 * The root admin's sport league overview (#1847): each row's sync health, issues, season and next
 * event, computed from the facts the reader gathers, and the row as the API sends it.
 */
import { expect } from '@jest/globals';
import {
  OVERDUE_AFTER_MS,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ReleaseCheckKey,
  ScoringFamily,
  Sport,
  SportEventStatus,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueKind,
  SportLeagueSyncHealth,
} from '@poolmaster/shared/domain';
import type { SportLeagueLatestSyncRun, SportLeagueOverviewFacts, SportLeagueOverviewLeague } from '@poolmaster/shared/db';
import { SportLeagueOverviewDtoSchema } from '@poolmaster/shared/dto/sport-catalog.dto';
import { mapSportLeagueOverviewToDto } from '../../../packages/core-api/src/mappers';
import {
  buildSportLeagueOverviews,
  seasonOf,
  SportLeagueOverviewService,
  syncHealthOf,
} from '../../../packages/core-api/src/modules/sport-catalog/sport-league-overview';

const NOW = new Date('2027-04-15T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

function league(overrides: Partial<SportLeagueOverviewLeague> = {}): SportLeagueOverviewLeague {
  return {
    id: 'mlb', sport: Sport.BASEBALL, name: 'MLB', parentSportLeagueId: null, scoringFamily: null, eventSyncProviderId: 'balldontlie', isActive: true,
    ...overrides,
  };
}

function facts(overrides: Partial<SportLeagueOverviewFacts> = {}): SportLeagueOverviewFacts {
  return {
    leagues: [league()],
    latestSyncRuns: [],
    heldEvents: [],
    eventCounts: new Map(),
    eventYearSpans: [],
    nextEventStarts: new Map(),
    clutchCardEvents: [],
    overdueCandidates: [],
    ...overrides,
  };
}

function run(kind: ProviderSyncKind, status: ProviderSyncRunStatus, overrides: Partial<SportLeagueLatestSyncRun> = {}): SportLeagueLatestSyncRun {
  return { id: `run-${kind}`, sportLeagueId: 'mlb', kind, status, createdAt: at('2027-04-15T10:00:00.000Z'), summary: null, ...overrides };
}

function only(input: SportLeagueOverviewFacts) {
  const row = buildSportLeagueOverviews(input, NOW).at(0);
  if (row === undefined) throw new Error('no overview row');
  return row;
}

describe('sport league sync health', () => {
  it('is OFF for a league that is off, even with a provider and failing runs', () => {
    expect(syncHealthOf({ isActive: false, providerId: 'balldontlie', runCount: 3, failedRunCount: 2 })).toBe(SportLeagueSyncHealth.OFF);
  });

  it('is OFF for a league on with no provider syncing it', () => {
    expect(only(facts({ leagues: [league({ eventSyncProviderId: null })] })).syncHealth).toBe(SportLeagueSyncHealth.OFF);
  });

  it('is NOT_RUN_YET for a synced league with no run of any sync', () => {
    expect(only(facts()).syncHealth).toBe(SportLeagueSyncHealth.NOT_RUN_YET);
  });

  it('is OK when the latest run of every sync it has run worked or is still under way', () => {
    const row = only(facts({ latestSyncRuns: [run(ProviderSyncKind.EVENTS, ProviderSyncRunStatus.COMPLETED), run(ProviderSyncKind.SCORES, ProviderSyncRunStatus.IN_PROGRESS)] }));

    expect(row.syncHealth).toBe(SportLeagueSyncHealth.OK);
    expect(row.issues).toEqual([]);
  });

  it('is ERROR when the latest run of any one sync failed', () => {
    const row = only(facts({ latestSyncRuns: [run(ProviderSyncKind.EVENTS, ProviderSyncRunStatus.COMPLETED), run(ProviderSyncKind.FIELD, ProviderSyncRunStatus.FAILED)] }));

    expect(row.syncHealth).toBe(SportLeagueSyncHealth.ERROR);
  });
});

describe('sport league issues', () => {
  it('lists a SYNC issue per failed sync, event list first, labelled by the run\'s summary or else its kind, targeting the run', () => {
    const row = only(facts({
      latestSyncRuns: [
        run(ProviderSyncKind.SCORES, ProviderSyncRunStatus.FAILED, { summary: 'Failed live scores sync.' }),
        run(ProviderSyncKind.EVENTS, ProviderSyncRunStatus.FAILED),
        run(ProviderSyncKind.FIELD, ProviderSyncRunStatus.COMPLETED),
      ],
    }));

    expect(row.issues).toEqual([{
      type: SportLeagueIssueType.SYNC,
      count: 2,
      items: [
        { label: 'EVENTS', occurredAt: at('2027-04-15T10:00:00.000Z'), target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: 'run-EVENTS' }, syncKind: ProviderSyncKind.EVENTS },
        { label: 'Failed live scores sync.', occurredAt: at('2027-04-15T10:00:00.000Z'), target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: 'run-SCORES' }, syncKind: ProviderSyncKind.SCORES },
      ],
    }]);
  });

  it('lists the held draft events as a RELEASE issue by name, after SYNC, leaving out another league\'s', () => {
    const row = only(facts({
      latestSyncRuns: [run(ProviderSyncKind.FIELD, ProviderSyncRunStatus.FAILED)],
      heldEvents: [
        { id: 'e2', sportLeagueId: 'mlb', name: 'World Series', checkedAt: at('2027-04-15T09:00:00.000Z'), failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] },
        { id: 'e1', sportLeagueId: 'mlb', name: 'ALCS', checkedAt: at('2027-04-15T11:00:00.000Z'), failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED, ReleaseCheckKey.CONTEST_SETUPS_ON] },
        { id: 'e3', sportLeagueId: 'other', name: 'Not this league', checkedAt: at('2027-04-15T11:00:00.000Z'), failedChecks: [ReleaseCheckKey.FIELD_LOADED] },
      ],
    }));

    expect(row.issues.map((issue) => [issue.type, issue.count])).toEqual([[SportLeagueIssueType.SYNC, 1], [SportLeagueIssueType.RELEASE, 2]]);
    expect(row.issues[1]?.items).toEqual([
      { label: 'ALCS', occurredAt: at('2027-04-15T11:00:00.000Z'), target: { type: SportLeagueIssueTargetType.SPORT_EVENT, id: 'e1' }, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED, ReleaseCheckKey.CONTEST_SETUPS_ON] },
      { label: 'World Series', occurredAt: at('2027-04-15T09:00:00.000Z'), target: { type: SportLeagueIssueTargetType.SPORT_EVENT, id: 'e2' }, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] },
    ]);
  });

  it('counts the league\'s overdue events as an OVERDUE issue after RELEASE, most overdue first, leaving out one not yet overdue and another league\'s', () => {
    const endedAgo = (ms: number) => new Date(NOW.getTime() - ms);
    const overdue = (id: string, sportLeagueId: string, name: string, endDate: Date) => ({
      id, sportLeagueId, name, sport: Sport.BASEBALL, status: SportEventStatus.IN_PROGRESS, startDate: at('2027-04-01T00:00:00.000Z'), endDate, rounds: [],
    });
    const row = only(facts({
      heldEvents: [{ id: 'e9', sportLeagueId: 'mlb', name: 'Held', checkedAt: NOW, failedChecks: [ReleaseCheckKey.FIELD_LOADED] }],
      overdueCandidates: [
        overdue('late', 'mlb', 'Game 2', endedAgo(OVERDUE_AFTER_MS + 60_000)),
        overdue('later', 'mlb', 'Game 1', endedAgo(2 * OVERDUE_AFTER_MS)),
        overdue('almost', 'mlb', 'Game 3', endedAgo(OVERDUE_AFTER_MS - 60_000)),
        overdue('elsewhere', 'other', 'Not this league', endedAgo(2 * OVERDUE_AFTER_MS)),
      ],
    }));

    expect(row.issues.map((issue) => [issue.type, issue.count])).toEqual([[SportLeagueIssueType.RELEASE, 1], [SportLeagueIssueType.OVERDUE, 2]]);
    expect(row.issues[1]?.items.map((item) => [item.target.id, item.occurredAt])).toEqual([
      ['later', endedAgo(2 * OVERDUE_AFTER_MS)],
      ['late', endedAgo(OVERDUE_AFTER_MS + 60_000)],
    ]);
  });
});

describe('sport league season', () => {
  const span = (eventYear: number, start: string, end: string) => ({ eventYear, start: at(start), end: at(end) });
  const seasons = [span(2026, '2026-03-26T00:00:00.000Z', '2026-11-01T00:00:00.000Z'), span(2027, '2027-03-25T00:00:00.000Z', '2027-10-31T00:00:00.000Z')];

  it('is the event year under way now', () => {
    expect(seasonOf(seasons, NOW)).toEqual({ start: at('2027-03-25T00:00:00.000Z'), end: at('2027-10-31T00:00:00.000Z') });
  });

  it('is the next event year to start between seasons', () => {
    expect(seasonOf(seasons, at('2026-12-15T00:00:00.000Z'))).toEqual({ start: at('2027-03-25T00:00:00.000Z'), end: at('2027-10-31T00:00:00.000Z') });
  });

  it('is the latest event year once every one has ended and no next one is known', () => {
    expect(seasonOf(seasons, at('2028-01-15T00:00:00.000Z'))).toEqual({ start: at('2027-03-25T00:00:00.000Z'), end: at('2027-10-31T00:00:00.000Z') });
  });

  it('is null while the league has no events, with no next event and no events counted', () => {
    const row = only(facts());

    expect(row.season).toBeNull();
    expect(row.nextEventStartsAt).toBeNull();
    expect(row.eventCount).toBe(0);
  });

  it('runs from a year\'s first start to its last end, or its last start when that is later or no event has an end', () => {
    const row = only(facts({
      eventYearSpans: [
        { sportLeagueId: 'mlb', eventYear: 2027, firstStart: at('2027-03-25T00:00:00.000Z'), lastStart: at('2027-10-20T00:00:00.000Z'), lastEnd: at('2027-10-31T00:00:00.000Z') },
        { sportLeagueId: 'mlb', eventYear: 2028, firstStart: at('2028-03-30T00:00:00.000Z'), lastStart: at('2028-10-01T00:00:00.000Z'), lastEnd: null },
      ],
      nextEventStarts: new Map([['mlb', at('2027-04-16T00:00:00.000Z')]]),
      eventCounts: new Map([['mlb', 7]]),
    }));

    expect(row.season).toEqual({ start: at('2027-03-25T00:00:00.000Z'), end: at('2027-10-31T00:00:00.000Z') });
    expect(row.nextEventStartsAt).toEqual(at('2027-04-16T00:00:00.000Z'));
    expect(row.eventCount).toBe(7);
    expect(seasonOf([{ eventYear: 2028, start: at('2028-03-30T00:00:00.000Z'), end: at('2028-10-01T00:00:00.000Z') }], NOW)?.end).toEqual(at('2028-10-01T00:00:00.000Z'));
  });
});

describe('a Clutch Card sport league', () => {
  const worldSeries = league({ id: 'ws', name: 'World Series', parentSportLeagueId: 'mlb', scoringFamily: ScoringFamily.COMPOSITE, eventSyncProviderId: null });

  it('is CLUTCH_CARD, takes its parent\'s provider and its parent\'s event list run, and keeps its own field and scores runs', () => {
    const rows = buildSportLeagueOverviews(facts({
      leagues: [worldSeries, league()],
      latestSyncRuns: [
        run(ProviderSyncKind.EVENTS, ProviderSyncRunStatus.FAILED, { id: 'mlb-events' }),
        run(ProviderSyncKind.FIELD, ProviderSyncRunStatus.COMPLETED, { id: 'mlb-field' }),
        run(ProviderSyncKind.EVENTS, ProviderSyncRunStatus.COMPLETED, { id: 'ws-own-events', sportLeagueId: 'ws' }),
        run(ProviderSyncKind.SCORES, ProviderSyncRunStatus.COMPLETED, { id: 'ws-scores', sportLeagueId: 'ws' }),
      ],
    }), NOW);
    const clutch = rows.find((row) => row.id === 'ws');

    expect(clutch).toMatchObject({ kind: SportLeagueKind.CLUTCH_CARD, providerId: 'balldontlie', parentSportLeagueId: 'mlb', syncHealth: SportLeagueSyncHealth.ERROR });
    expect(clutch?.issues).toEqual([expect.objectContaining({ type: SportLeagueIssueType.SYNC, items: [expect.objectContaining({ target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: 'mlb-events' } })] })]);
    expect(rows.find((row) => row.id === 'mlb')?.kind).toBe(SportLeagueKind.REAL);
  });

  it('spans its season over the parent event rounds its events cover, ignoring the parent\'s other rounds', () => {
    const row = buildSportLeagueOverviews(facts({
      leagues: [league(), worldSeries],
      clutchCardEvents: [{
        sportLeagueId: 'ws',
        eventYear: 2026,
        parentRoundNumbers: [4],
        parentRounds: [
          { roundNumber: 3, scheduledDate: at('2026-10-10T00:00:00.000Z'), scheduledEndAt: at('2026-10-20T00:00:00.000Z') },
          { roundNumber: 4, scheduledDate: at('2026-10-24T00:00:00.000Z'), scheduledEndAt: at('2026-11-01T00:00:00.000Z') },
        ],
      }, {
        sportLeagueId: 'ws',
        eventYear: 2027,
        parentRoundNumbers: [4, 5],
        parentRounds: [
          { roundNumber: 4, scheduledDate: at('2027-10-23T00:00:00.000Z'), scheduledEndAt: null },
          { roundNumber: 5, scheduledDate: at('2027-10-25T00:00:00.000Z'), scheduledEndAt: at('2027-10-31T00:00:00.000Z') },
        ],
      }, {
        sportLeagueId: 'ws',
        eventYear: 2028,
        parentRoundNumbers: [4],
        parentRounds: [],
      }],
    }), NOW).find((overview) => overview.id === 'ws');

    expect(row?.season).toEqual({ start: at('2027-10-23T00:00:00.000Z'), end: at('2027-10-31T00:00:00.000Z') });
  });

  it('is OFF while its parent league has no provider', () => {
    const rows = buildSportLeagueOverviews(facts({ leagues: [league({ eventSyncProviderId: null }), worldSeries] }), NOW);

    expect(rows.find((row) => row.id === 'ws')).toMatchObject({ providerId: null, syncHealth: SportLeagueSyncHealth.OFF });
  });
});

describe('sport league overview order', () => {
  it('lists by sport, most popular first, then by name, each Clutch Card straight after its parent', () => {
    const rows = buildSportLeagueOverviews(facts({
      leagues: [
        league({ id: 'pga', sport: Sport.GOLF, name: 'PGA Tour' }),
        league({ id: 'ws', name: 'World Series', parentSportLeagueId: 'mlb', scoringFamily: ScoringFamily.COMPOSITE }),
        league({ id: 'ncaa', name: 'NCAA Baseball' }),
        league({ id: 'alcs', name: 'ALCS', parentSportLeagueId: 'mlb', scoringFamily: ScoringFamily.COMPOSITE }),
        league(),
        league({ id: 'nfl', sport: Sport.AMERICAN_FOOTBALL, name: 'NFL' }),
      ],
    }), NOW);

    expect(rows.map((row) => row.id)).toEqual(['nfl', 'mlb', 'alcs', 'ws', 'ncaa', 'pga']);
  });
});

describe('SportLeagueOverviewService', () => {
  it('reads the facts as of its clock and builds every row from them', async () => {
    const readFacts = jest.fn(async (_now: Date) => facts());
    const service = new SportLeagueOverviewService({ reader: { readFacts }, now: () => NOW });

    await expect(service.listOverviews()).resolves.toHaveLength(1);
    expect(readFacts).toHaveBeenCalledWith(NOW);
  });

  it('reads as of the current time when given no clock', async () => {
    const readFacts = jest.fn(async (_now: Date) => facts());

    await new SportLeagueOverviewService({ reader: { readFacts } }).listOverviews();

    expect(readFacts.mock.calls[0]?.[0]).toBeInstanceOf(Date);
  });
});

describe('mapSportLeagueOverviewToDto', () => {
  it('sends dates as ISO strings and each issue type with its own item fields, matching the published schema', () => {
    const row = only(facts({
      latestSyncRuns: [run(ProviderSyncKind.SCORES, ProviderSyncRunStatus.FAILED, { summary: 'Failed live scores sync.' })],
      heldEvents: [{ id: '5f0c8a8e-5a0e-4c1e-9d43-2f6f8e3e4b10', sportLeagueId: 'mlb', name: 'World Series', checkedAt: at('2027-04-15T09:00:00.000Z'), failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] }],
      eventYearSpans: [{ sportLeagueId: 'mlb', eventYear: 2027, firstStart: at('2027-03-25T00:00:00.000Z'), lastStart: at('2027-10-20T00:00:00.000Z'), lastEnd: null }],
      nextEventStarts: new Map([['mlb', at('2027-04-16T00:00:00.000Z')]]),
    }));
    const withIds = { ...row, id: '7b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d32', issues: row.issues.map((issue) => (issue.type === SportLeagueIssueType.SYNC
      ? { ...issue, items: issue.items.map((item) => ({ ...item, target: { ...item.target, id: '8c3fbd1b-8d3b-4f4b-8a76-5c9b1b6b7e43' } })) }
      : issue)) };

    const dto = mapSportLeagueOverviewToDto(withIds);

    expect(SportLeagueOverviewDtoSchema.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({
      season: { start: '2027-03-25T00:00:00.000Z', end: '2027-10-20T00:00:00.000Z' },
      nextEventStartsAt: '2027-04-16T00:00:00.000Z',
      issues: [
        { type: 'SYNC', count: 1, items: [{ label: 'Failed live scores sync.', occurredAt: '2027-04-15T10:00:00.000Z', syncKind: 'SCORES' }] },
        { type: 'RELEASE', count: 1, items: [{ label: 'World Series', failedChecks: ['TIERS_ASSIGNED'] }] },
      ],
    });
    expect(mapSportLeagueOverviewToDto({ ...withIds, season: null, nextEventStartsAt: null })).toMatchObject({ season: null, nextEventStartsAt: null });
  });
});
