/**
 * The root admin's League page (#1865): each sync's health, latest run and next run; each
 * event's release, field, issues and last sync; each participant's feed id and who added it.
 * Computed from the facts the reader gathers, and sent as the API's rows.
 */
import { expect } from '@jest/globals';
import {
  AutoReleaseCheckOutcome,
  OVERDUE_AFTER_MS,
  ParticipantAddedBy,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ReleaseCheckKey,
  ScoringFamily,
  Sport,
  SportEventReleaseAtKind,
  SportEventReleaseMode,
  SportEventStatus,
  SportEventSyncScope,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueSyncHealth,
  SportLeagueSyncMode,
} from '@poolmaster/shared/domain';
import type { SportLeagueEventFacts, SportLeaguePageEvent, SportLeaguePageLeague, SportLeaguePageParticipant, SportLeaguePageReader, SportLeaguePageRun } from '@poolmaster/shared/db';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import {
  SportLeagueEventOverviewDtoSchema,
  SportLeagueParticipantOverviewDtoSchema,
  SportLeagueSyncDtoSchema,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import {
  mapSportLeagueEventOverviewToDto,
  mapSportLeagueParticipantOverviewToDto,
  mapSportLeagueSyncToDto,
} from '../../../packages/core-api/src/mappers';
import {
  buildSportLeagueEvents,
  buildSportLeagueSyncs,
  SportLeaguePageService,
} from '../../../packages/core-api/src/modules/sport-catalog/sport-league-page';

const NOW = new Date('2027-04-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const at = (iso: string) => new Date(iso);

const SCHEDULE: IngestionScheduleConfig = {
  scheduledSports: [Sport.BASEBALL],
  healthCheck: { enabled: true, intervalMinutes: 5 },
  eventList: { enabled: true, intervalMinutes: 360 },
  eventParticipants: { enabled: false, intervalMinutes: 360 },
  eventLiveScores: { enabled: true, intervalSeconds: 300 },
};

function league(overrides: Partial<SportLeaguePageLeague> = {}): SportLeaguePageLeague {
  return {
    id: 'mlb', sport: Sport.BASEBALL, isActive: true, parentSportLeagueId: null, scoringFamily: null,
    eventSyncProviderId: 'balldontlie', autoReleaseDaysBeforeStart: 7, parent: null, ...overrides,
  };
}

function run(kind: ProviderSyncKind, overrides: Partial<SportLeaguePageRun> = {}): SportLeaguePageRun {
  return {
    id: `${kind.toLowerCase()}-run`, kind, status: ProviderSyncRunStatus.COMPLETED, createdAt: at('2027-04-15T10:00:00.000Z'),
    startedAt: at('2027-04-15T10:00:05.000Z'), summary: 'Synced.', changedCount: 3, ...overrides,
  };
}

function pageEvent(overrides: Partial<SportLeaguePageEvent> = {}): SportLeaguePageEvent {
  return {
    id: 'e1', name: 'Opening Day', eventYear: 2027, startDate: at('2027-04-20T17:00:00.000Z'), endDate: null,
    status: SportEventStatus.DRAFT, providerId: 'balldontlie', syncScope: SportEventSyncScope.SCORES_ONLY, releasedAt: null, lastReleaseCheck: null,
    ...overrides,
  };
}

function eventFacts(overrides: Partial<SportLeagueEventFacts> = {}): SportLeagueEventFacts {
  return { league: league(), events: [pageEvent()], fieldSizes: new Map(), latestRunsByEvent: new Map(), overdueCandidates: [], ...overrides };
}

const context = { schedule: SCHEDULE, webhookProviderIds: [] as string[], now: NOW };

describe('buildSportLeagueSyncs', () => {
  it('reports every sync kind in order, each with its latest run, its health from that run, and its next run an interval after it', () => {
    const syncs = buildSportLeagueSyncs(league(), [
      run(ProviderSyncKind.SCORES, { createdAt: at('2027-04-15T11:58:00.000Z') }),
      run(ProviderSyncKind.EVENTS, { status: ProviderSyncRunStatus.FAILED, changedCount: null, summary: 'Rate limited.' }),
    ], context);

    expect(syncs.map((sync) => [sync.kind, sync.health])).toEqual([
      [ProviderSyncKind.EVENTS, SportLeagueSyncHealth.ERROR],
      [ProviderSyncKind.FIELD, SportLeagueSyncHealth.NOT_RUN_YET],
      [ProviderSyncKind.SCORES, SportLeagueSyncHealth.OK],
    ]);
    expect(syncs[0]).toMatchObject({ mode: SportLeagueSyncMode.SCHEDULE, lastRun: { id: 'events-run', summary: 'Rate limited.', changedCount: null }, nextRunAt: at('2027-04-15T16:00:00.000Z') });
    // The field policy is off, so nothing schedules it.
    expect(syncs[1]).toMatchObject({ lastRun: null, nextRunAt: null });
    expect(syncs[2]?.nextRunAt).toEqual(at('2027-04-15T12:03:00.000Z'));
  });

  it('runs a sync whose next time has passed, or that never ran, now', () => {
    const syncs = buildSportLeagueSyncs(league(), [run(ProviderSyncKind.EVENTS, { createdAt: at('2027-04-14T00:00:00.000Z') })], context);
    const fresh = buildSportLeagueSyncs(league(), [], context);

    expect(syncs[0]?.nextRunAt).toEqual(NOW);
    expect(fresh[0]?.nextRunAt).toEqual(NOW);
  });

  it('leaves the live scores of a provider whose webhook is set to the webhook, with no next run', () => {
    const syncs = buildSportLeagueSyncs(league(), [], { ...context, webhookProviderIds: ['balldontlie'] });

    expect(syncs.map((sync) => sync.mode)).toEqual([SportLeagueSyncMode.SCHEDULE, SportLeagueSyncMode.SCHEDULE, SportLeagueSyncMode.WEBHOOK]);
    expect(syncs[2]?.nextRunAt).toBeNull();
  });

  it('schedules nothing for a league that is off, has no provider, or whose sport is not scheduled', () => {
    const off = buildSportLeagueSyncs(league({ isActive: false }), [], context);
    const unsynced = buildSportLeagueSyncs(league({ eventSyncProviderId: null }), [], context);
    const unscheduled = buildSportLeagueSyncs(league(), [], { ...context, schedule: { ...SCHEDULE, scheduledSports: [Sport.GOLF] } });

    expect(off.map((sync) => sync.health)).toEqual([SportLeagueSyncHealth.OFF, SportLeagueSyncHealth.OFF, SportLeagueSyncHealth.OFF]);
    expect(unsynced.every((sync) => sync.health === SportLeagueSyncHealth.OFF && sync.nextRunAt === null)).toBe(true);
    expect(unscheduled.every((sync) => sync.nextRunAt === null)).toBe(true);
  });

  it('takes a Clutch Card\'s provider from its parent league, whose event list sync creates its events', () => {
    const clutchCard = league({ id: 'ws', scoringFamily: ScoringFamily.COMPOSITE, parentSportLeagueId: 'mlb', eventSyncProviderId: null, parent: { isActive: true, eventSyncProviderId: 'balldontlie' } });
    const syncs = buildSportLeagueSyncs(clutchCard, [run(ProviderSyncKind.EVENTS, { id: 'mlb-events' })], context);

    expect(syncs[0]).toMatchObject({ health: SportLeagueSyncHealth.OK, lastRun: { id: 'mlb-events' } });
  });

  it('sends each sync in the shape the contract declares', () => {
    for (const sync of buildSportLeagueSyncs(league(), [run(ProviderSyncKind.FIELD, { id: '9b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d32' })], context)) {
      expect(SportLeagueSyncDtoSchema.parse(mapSportLeagueSyncToDto(sync))).toBeTruthy();
    }
  });
});

describe('buildSportLeagueEvents', () => {
  it('plans an automatic draft\'s release for its start less its league\'s window', () => {
    const [row] = buildSportLeagueEvents(eventFacts(), NOW);

    expect(row).toMatchObject({ releaseMode: SportEventReleaseMode.AUTO, releaseAtKind: SportEventReleaseAtKind.PLANNED });
    expect(row.releaseAt).toEqual(new Date(at('2027-04-20T17:00:00.000Z').getTime() - 7 * DAY));
  });

  it('dates a released event by its release, automatic or not', () => {
    const releasedAt = at('2027-04-13T17:00:00.000Z');
    const [auto, manual] = buildSportLeagueEvents(eventFacts({
      events: [
        pageEvent({ status: SportEventStatus.SCHEDULED, releasedAt }),
        pageEvent({ id: 'e2', status: SportEventStatus.SCHEDULED, releasedAt, syncScope: SportEventSyncScope.NONE }),
      ],
    }), NOW);

    expect(auto).toMatchObject({ releaseMode: SportEventReleaseMode.AUTO, releaseAt: releasedAt, releaseAtKind: SportEventReleaseAtKind.ACTUAL });
    expect(manual).toMatchObject({ releaseMode: SportEventReleaseMode.MANUAL, releaseAt: releasedAt, releaseAtKind: SportEventReleaseAtKind.ACTUAL });
  });

  it('gives a manual draft, and an event released before release times were kept, no release date', () => {
    const [unsynced, offLeague, oldRelease] = [
      buildSportLeagueEvents(eventFacts({ events: [pageEvent({ syncScope: SportEventSyncScope.NONE })] }), NOW)[0],
      buildSportLeagueEvents(eventFacts({ league: league({ autoReleaseDaysBeforeStart: null }) }), NOW)[0],
      buildSportLeagueEvents(eventFacts({ events: [pageEvent({ status: SportEventStatus.COMPLETED })] }), NOW)[0],
    ];

    expect(unsynced).toMatchObject({ releaseMode: SportEventReleaseMode.MANUAL, releaseAt: null, releaseAtKind: null });
    expect(offLeague).toMatchObject({ releaseMode: SportEventReleaseMode.MANUAL, releaseAt: null });
    expect(oldRelease).toMatchObject({ releaseAt: null, releaseAtKind: null });
  });

  it('gives an event its own SYNC, RELEASE and OVERDUE issues, its field size and its last sync', () => {
    const check = { checkedAt: at('2027-04-15T11:00:00.000Z'), outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] };
    const expectedEnd = new Date(NOW.getTime() - OVERDUE_AFTER_MS - MINUTE);
    const [row] = buildSportLeagueEvents(eventFacts({
      events: [pageEvent({ lastReleaseCheck: check })],
      fieldSizes: new Map([['e1', 26]]),
      latestRunsByEvent: new Map([['e1', [
        run(ProviderSyncKind.SCORES, { status: ProviderSyncRunStatus.FAILED, createdAt: at('2027-04-15T11:30:00.000Z') }),
        run(ProviderSyncKind.FIELD),
      ]]]),
      overdueCandidates: [{ id: 'e1', name: 'Opening Day', sport: Sport.BASEBALL, status: SportEventStatus.DRAFT, startDate: at('2027-04-14T00:00:00.000Z'), endDate: expectedEnd, rounds: [] }],
    }), NOW);

    expect(row.issues.map((issue) => [issue.type, issue.count])).toEqual([
      [SportLeagueIssueType.SYNC, 1],
      [SportLeagueIssueType.RELEASE, 1],
      [SportLeagueIssueType.OVERDUE, 1],
    ]);
    expect(row.issues[2]?.items).toEqual([{ label: 'Opening Day', occurredAt: expectedEnd, target: { type: SportLeagueIssueTargetType.SPORT_EVENT, id: 'e1' } }]);
    expect(row).toMatchObject({ fieldSize: 26, lastSyncedAt: at('2027-04-15T11:30:00.000Z'), lastReleaseCheck: check });
  });

  it('gives an event with no runs, no field and nothing wrong no issues, no field size and no last sync', () => {
    const [row] = buildSportLeagueEvents(eventFacts(), NOW);

    expect(row).toMatchObject({ issues: [], fieldSize: null, lastSyncedAt: null });
  });

  it('sends each event in the shape the contract declares', () => {
    const [row] = buildSportLeagueEvents(eventFacts({ events: [pageEvent({ id: '7b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d32', lastReleaseCheck: { checkedAt: NOW, outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.FIELD_LOADED] } })] }), NOW);

    expect(SportLeagueEventOverviewDtoSchema.parse(mapSportLeagueEventOverviewToDto(row))).toBeTruthy();
  });
});

describe('SportLeaguePageService', () => {
  const participant = {
    id: '7b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d32', name: 'Aaron Judge', participantType: 'INDIVIDUAL' as const, shortName: null, nationality: 'USA',
    teamAffiliation: 'Yankees', role: 'RF', ranking: 1, createdAt: NOW,
  };
  const service = (rows: SportLeaguePageParticipant[] | null) => new SportLeaguePageService({
    reader: makeReader(rows),
    schedule: { getConfig: () => Promise.resolve(SCHEDULE) },
    webhookProviderIds: [],
    now: () => NOW,
  });

  it('marks a participant with a provider mapping added by the feed, with its feed id and when the feed last listed it, and one without added by an admin', async () => {
    const seen = at('2027-04-15T09:00:00.000Z');
    const rows = await service([
      { participant, mapping: { externalId: 'mlb-player-592450', lastSeenAt: seen } },
      { participant: { ...participant, id: 'admin-added' }, mapping: null },
    ]).listParticipants('mlb');

    expect(rows?.map((row) => [row.addedBy, row.feedId, row.lastInFeedAt])).toEqual([
      [ParticipantAddedBy.FEED, 'mlb-player-592450', seen],
      [ParticipantAddedBy.ADMIN, null, null],
    ]);
    expect(rows?.[0] && SportLeagueParticipantOverviewDtoSchema.parse(mapSportLeagueParticipantOverviewToDto(rows[0]))).toBeTruthy();
  });

  it('answers null for every read of a sport league that does not exist', async () => {
    const missing = service(null);

    await expect(missing.listSyncs('nope')).resolves.toBeNull();
    await expect(missing.listEvents('nope')).resolves.toBeNull();
    await expect(missing.listParticipants('nope')).resolves.toBeNull();
  });

  it('reads the syncs and events of a sport league that exists', async () => {
    const found = service([]);

    await expect(found.listSyncs('mlb')).resolves.toHaveLength(3);
    await expect(found.listEvents('mlb')).resolves.toHaveLength(1);
  });
});

/** A reader that knows every sport league when `participants` is a list, and none when it is null. */
function makeReader(participants: SportLeaguePageParticipant[] | null): SportLeaguePageReader {
  const exists = participants !== null;
  return {
    readSyncFacts: () => Promise.resolve(exists ? { league: league(), latestRuns: [] } : null),
    readEventFacts: () => Promise.resolve(exists ? eventFacts() : null),
    readParticipants: () => Promise.resolve(participants),
  };
}
