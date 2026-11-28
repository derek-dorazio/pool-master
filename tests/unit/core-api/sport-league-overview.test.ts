/**
 * The root admin's sport league overview (#1847): each row's sync health, issues, season and next
 * event, computed from the facts the reader gathers, and the row as the API sends it.
 */
import { expect } from '@jest/globals';
import {
  ProviderSyncFindingSeverity,
  ProviderSyncKind,
  ReleaseCheckKey,
  Sport,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueSyncHealth,
} from '@poolmaster/shared/domain';
import type { SportLeagueFailedSync, SportLeagueOverviewFacts, SportLeagueOverviewLeague } from '@poolmaster/shared/db';
import { SportLeagueOverviewDtoSchema } from '@poolmaster/shared/dto/sport-catalog.dto';
import { mapSportLeagueOverviewToDto } from '../../../packages/core-api/src/mappers';
import {
  buildSportLeagueOverviews,
  findingsIssuesOf,
  SportLeagueOverviewService,
  syncHealthOf,
} from '../../../packages/core-api/src/modules/sport-catalog/sport-league-overview';

const NOW = new Date('2027-04-15T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

function league(overrides: Partial<SportLeagueOverviewLeague> = {}): SportLeagueOverviewLeague {
  return {
    id: 'mlb', sport: Sport.BASEBALL, sportUrlSegment: 'baseball', sportDisplayOrder: 3, name: 'MLB', syncProviderId: 'balldontlie', syncProviderName: 'BALLDONTLIE', isActive: true,
    ...overrides,
  };
}

function facts(overrides: Partial<SportLeagueOverviewFacts> = {}): SportLeagueOverviewFacts {
  return {
    leagues: [league()],
    leaguesWithSyncRuns: new Set(),
    failedSyncs: [],
    heldEvents: [],
    eventCounts: new Map(),
    currentSeasonSpans: new Map(),
    nextEventStarts: new Map(),
    openFindings: [],
    ...overrides,
  };
}

/** An OPEN SYNC_FAILED finding of MLB's `kind` sync, with its latest failed run kept unless `run` says otherwise. */
function failedSync(syncKind: ProviderSyncKind, overrides: Partial<SportLeagueFailedSync> = {}): SportLeagueFailedSync {
  return { sportLeagueId: 'mlb', syncKind, lastFailedAt: at('2027-04-15T10:00:00.000Z'), run: { id: `run-${syncKind}`, summary: null }, ...overrides };
}

const SYNCED = { leaguesWithSyncRuns: new Set(['mlb']) };

function only(input: SportLeagueOverviewFacts) {
  const row = buildSportLeagueOverviews(input).at(0);
  if (row === undefined) throw new Error('no overview row');
  return row;
}

describe('buildSportLeagueOverviews: provider', () => {
  it('names the league\'s sync provider by name, so no reader looks it up by id, and none for a league no provider syncs', () => {
    expect(only(facts())).toMatchObject({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' });
    expect(only(facts({ leagues: [league({ syncProviderId: null, syncProviderName: null })] }))).toMatchObject({ providerId: null, providerName: null });
  });
});

describe('sport league sync health', () => {
  it('is OFF for a league that is off, even with a provider and failing runs', () => {
    expect(syncHealthOf({ isActive: false, providerId: 'balldontlie', runCount: 3, failedRunCount: 2 })).toBe(SportLeagueSyncHealth.OFF);
  });

  it('is OFF for a league on with no provider syncing it', () => {
    expect(only(facts({ leagues: [league({ syncProviderId: null })] })).syncHealth).toBe(SportLeagueSyncHealth.OFF);
  });

  it('is NOT_RUN_YET for a synced league with no run of any sync', () => {
    expect(only(facts()).syncHealth).toBe(SportLeagueSyncHealth.NOT_RUN_YET);
  });

  it('is OK when the league has synced and none of its syncs has an open failure', () => {
    const row = only(facts({ ...SYNCED, failedSyncs: [failedSync(ProviderSyncKind.FIELD, { sportLeagueId: 'other' })] }));

    expect(row.syncHealth).toBe(SportLeagueSyncHealth.OK);
    expect(row.issues).toEqual([]);
  });

  it('is ERROR while any one of its syncs has an open failure, even one whose run the history has cleared', () => {
    expect(only(facts({ ...SYNCED, failedSyncs: [failedSync(ProviderSyncKind.FIELD)] })).syncHealth).toBe(SportLeagueSyncHealth.ERROR);
    expect(only(facts({ ...SYNCED, failedSyncs: [failedSync(ProviderSyncKind.FIELD, { run: null })] })).syncHealth).toBe(SportLeagueSyncHealth.ERROR);
  });
});

describe('sport league issues', () => {
  it('lists a SYNC issue per open failed sync, event list first and then the latest failure, labelled by its run\'s summary or else its kind, targeting the run', () => {
    const row = only(facts({
      ...SYNCED,
      failedSyncs: [
        failedSync(ProviderSyncKind.SCORES, { run: { id: 'run-older', summary: 'Failed live scores sync.' }, lastFailedAt: at('2027-04-15T08:00:00.000Z') }),
        failedSync(ProviderSyncKind.SCORES, { run: { id: 'run-newer', summary: 'Failed live scores sync: timeout' } }),
        failedSync(ProviderSyncKind.EVENTS),
      ],
    }));

    expect(row.issues).toEqual([{
      type: SportLeagueIssueType.SYNC,
      count: 3,
      items: [
        { label: 'EVENTS', occurredAt: at('2027-04-15T10:00:00.000Z'), target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: 'run-EVENTS' }, syncKind: ProviderSyncKind.EVENTS },
        { label: 'Failed live scores sync: timeout', occurredAt: at('2027-04-15T10:00:00.000Z'), target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: 'run-newer' }, syncKind: ProviderSyncKind.SCORES },
        { label: 'Failed live scores sync.', occurredAt: at('2027-04-15T08:00:00.000Z'), target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: 'run-older' }, syncKind: ProviderSyncKind.SCORES },
      ],
    }]);
  });

  it('lists no SYNC item for a failed sync whose run the history has cleared, since the Findings count holds it', () => {
    const row = only(facts({ ...SYNCED, failedSyncs: [failedSync(ProviderSyncKind.FIELD, { run: null })] }));

    expect(row.issues).toEqual([]);
  });

  it('lists the held draft events as a RELEASE issue by name, after SYNC, leaving out another league\'s', () => {
    const row = only(facts({
      failedSyncs: [failedSync(ProviderSyncKind.FIELD)],
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
});

describe('sport league findings issue', () => {
  it('counts the league\'s OPEN sync findings by severity, most serious first, and leads the issues with them', () => {
    const row = only(facts({
      heldEvents: [{ id: 'held', sportLeagueId: 'mlb', name: 'Game 1', checkedAt: NOW, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] }],
      openFindings: [
        { sportLeagueId: 'mlb', severity: ProviderSyncFindingSeverity.WARNING, count: 3 },
        { sportLeagueId: 'mlb', severity: ProviderSyncFindingSeverity.ERROR, count: 1 },
        { sportLeagueId: 'other', severity: ProviderSyncFindingSeverity.ERROR, count: 9 },
      ],
    }));

    expect(row.issues.map((issue) => [issue.type, issue.count])).toEqual([[SportLeagueIssueType.FINDINGS, 4], [SportLeagueIssueType.RELEASE, 1]]);
    expect(row.issues[0]?.items).toEqual([
      { severity: ProviderSyncFindingSeverity.ERROR, count: 1 },
      { severity: ProviderSyncFindingSeverity.WARNING, count: 3 },
    ]);
  });

  it('has no findings issue when the league has no OPEN finding, or only zero counts', () => {
    expect(findingsIssuesOf([])).toEqual([]);
    expect(findingsIssuesOf([{ severity: ProviderSyncFindingSeverity.INFO, count: 0 }])).toEqual([]);
  });
});

describe('sport league season', () => {
  it('is null for a league with no current Season, with no next event and no events counted', () => {
    const row = only(facts());

    expect(row.season).toBeNull();
    expect(row.nextEventStartsAt).toBeNull();
    expect(row.eventCount).toBe(0);
  });

  it('is the current Season\'s own span, not one worked out from its events\' dates', () => {
    const row = only(facts({
      currentSeasonSpans: new Map([['mlb', { start: at('2027-03-25T00:00:00.000Z'), end: at('2027-10-31T00:00:00.000Z') }]]),
      nextEventStarts: new Map([['mlb', at('2027-04-16T00:00:00.000Z')]]),
      eventCounts: new Map([['mlb', 7]]),
    }));

    expect(row.season).toEqual({ start: at('2027-03-25T00:00:00.000Z'), end: at('2027-10-31T00:00:00.000Z') });
    expect(row.nextEventStartsAt).toEqual(at('2027-04-16T00:00:00.000Z'));
    expect(row.eventCount).toBe(7);
  });
});

describe('sport league overview order', () => {
  it('lists by the sport row\'s display order, then by league name', () => {
    const rows = buildSportLeagueOverviews(facts({
      leagues: [
        league({ id: 'pga', sport: Sport.GOLF, sportUrlSegment: 'golf', sportDisplayOrder: 4, name: 'PGA Tour' }),
        league({ id: 'ncaa', name: 'NCAA Baseball' }),
        league(),
        league({ id: 'nfl', sport: Sport.FOOTBALL, sportUrlSegment: 'football', sportDisplayOrder: 0, name: 'NFL' }),
      ],
    }));

    expect(rows.map((row) => row.id)).toEqual(['nfl', 'mlb', 'ncaa', 'pga']);
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
      failedSyncs: [failedSync(ProviderSyncKind.SCORES, { run: { id: 'run-SCORES', summary: 'Failed live scores sync.' } })],
      heldEvents: [{ id: '5f0c8a8e-5a0e-4c1e-9d43-2f6f8e3e4b10', sportLeagueId: 'mlb', name: 'World Series', checkedAt: at('2027-04-15T09:00:00.000Z'), failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] }],
      currentSeasonSpans: new Map([['mlb', { start: at('2027-03-25T00:00:00.000Z'), end: at('2027-10-20T00:00:00.000Z') }]]),
      nextEventStarts: new Map([['mlb', at('2027-04-16T00:00:00.000Z')]]),
      openFindings: [{ sportLeagueId: 'mlb', severity: ProviderSyncFindingSeverity.ERROR, count: 2 }],
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
        { type: 'FINDINGS', count: 2, items: [{ severity: 'ERROR', count: 2 }] },
        { type: 'SYNC', count: 1, items: [{ label: 'Failed live scores sync.', occurredAt: '2027-04-15T10:00:00.000Z', syncKind: 'SCORES' }] },
        { type: 'RELEASE', count: 1, items: [{ label: 'World Series', failedChecks: ['TIERS_ASSIGNED'] }] },
      ],
    });
    expect(mapSportLeagueOverviewToDto({ ...withIds, season: null, nextEventStartsAt: null })).toMatchObject({ season: null, nextEventStartsAt: null });
  });
});
