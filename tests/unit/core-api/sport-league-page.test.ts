/**
 * The root admin's League page (#1865): each sync's health, latest run and next run; each
 * event's release, field, issues and last sync; each participant's feed id and who added it.
 * Computed from the facts the reader gathers, and sent as the API's rows.
 */
import { expect } from '@jest/globals';
import {
  AutoReleaseCheckOutcome,
  FieldOrderBasis,
  OVERDUE_AFTER_MS,
  ParticipantAddedBy,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ReleaseCheckKey,
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
import type { SportEventPageFacts, SportEventPageFieldRow, SportLeagueEventFacts, SportLeaguePageEvent, SportLeaguePageLeague, SportLeaguePageParticipant, SportLeaguePageReader, SportLeaguePageRun } from '@poolmaster/shared/db';
import {
  SportEventOverviewDtoSchema,
  SportLeagueEventOverviewDtoSchema,
  SportLeagueParticipantOverviewDtoSchema,
  SportLeagueSyncDtoSchema,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import {
  mapSportEventOverviewToDto,
  mapSportLeagueEventOverviewToDto,
  mapSportLeagueParticipantOverviewToDto,
  mapSportLeagueSyncToDto,
} from '../../../packages/core-api/src/mappers';
import {
  buildSportEventOverview,
  buildSportLeagueEvents,
  buildSportLeagueSyncs,
  SportLeaguePageService,
} from '../../../packages/core-api/src/modules/sport-catalog/sport-league-page';

const NOW = new Date('2027-04-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const at = (iso: string) => new Date(iso);

function league(overrides: Partial<SportLeaguePageLeague> = {}): SportLeaguePageLeague {
  return {
    id: 'mlb', sport: Sport.BASEBALL, isActive: true,
    syncProviderId: 'balldontlie', autoReleaseDaysBeforeStart: 7, ...overrides,
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

function fieldRow(overrides: Partial<SportEventPageFieldRow> = {}): SportEventPageFieldRow {
  return { id: 'sep1', isActive: true, oddsToWin: null, seedNumber: null, ranking: null, name: 'Aaron Judge', mapping: null, ...overrides };
}

function eventPageFacts(overrides: Partial<SportEventPageFacts> = {}): SportEventPageFacts {
  return { league: league(), event: pageEvent(), latestRuns: [], overdueCandidates: [], field: [], eventPagePath: null, ...overrides };
}

const context = { webhookProviderIds: [] as string[], now: NOW };

describe('buildSportLeagueSyncs', () => {
  it('reports every sync kind in order, each with its latest run and its health from that run', () => {
    const syncs = buildSportLeagueSyncs(league(), [
      run(ProviderSyncKind.SCORES, { createdAt: at('2027-04-15T11:58:00.000Z') }),
      run(ProviderSyncKind.EVENTS, { status: ProviderSyncRunStatus.FAILED, changedCount: null, summary: 'Rate limited.' }),
    ], context);

    expect(syncs.map((sync) => [sync.kind, sync.health])).toEqual([
      [ProviderSyncKind.EVENTS, SportLeagueSyncHealth.ERROR],
      [ProviderSyncKind.FIELD, SportLeagueSyncHealth.NOT_RUN_YET],
      [ProviderSyncKind.SCORES, SportLeagueSyncHealth.OK],
    ]);
    expect(syncs[0]).toMatchObject({ mode: SportLeagueSyncMode.SCHEDULE, lastRun: { id: 'events-run', summary: 'Rate limited.', changedCount: null } });
    expect(syncs[1]).toMatchObject({ lastRun: null });
  });

  it('leaves the live scores of a provider whose webhook is on to the webhook, and every other sync to the schedule', () => {
    const syncs = buildSportLeagueSyncs(league(), [], { ...context, webhookProviderIds: ['balldontlie'] });

    expect(syncs.map((sync) => sync.mode)).toEqual([SportLeagueSyncMode.SCHEDULE, SportLeagueSyncMode.SCHEDULE, SportLeagueSyncMode.WEBHOOK]);
  });

  it('reads every sync OFF for a league that is off or has no provider', () => {
    const off = buildSportLeagueSyncs(league({ isActive: false }), [], context);
    const unsynced = buildSportLeagueSyncs(league({ syncProviderId: null }), [], context);

    expect(off.map((sync) => sync.health)).toEqual([SportLeagueSyncHealth.OFF, SportLeagueSyncHealth.OFF, SportLeagueSyncHealth.OFF]);
    expect(unsynced.every((sync) => sync.health === SportLeagueSyncHealth.OFF)).toBe(true);
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
      overdueCandidates: [{ id: 'e1', name: 'Opening Day', sport: Sport.BASEBALL, status: SportEventStatus.IN_PROGRESS, startDate: at('2027-04-14T00:00:00.000Z'), endDate: expectedEnd, rounds: [], typicalGameMinutes: 180 }],
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

describe('buildSportEventOverview', () => {
  it('reports the event\'s field and scores syncs from its own runs, never the league\'s event list', () => {
    const overview = buildSportEventOverview(eventPageFacts({
      latestRuns: [run(ProviderSyncKind.FIELD), run(ProviderSyncKind.SCORES), run(ProviderSyncKind.EVENTS)],
    }), context);

    expect(overview.syncs.map((sync) => [sync.kind, sync.health, sync.lastRun?.id])).toEqual([
      [ProviderSyncKind.FIELD, SportLeagueSyncHealth.OK, 'field-run'],
      [ProviderSyncKind.SCORES, SportLeagueSyncHealth.OK, 'scores-run'],
    ]);
    expect(overview.syncHealth).toBe(SportLeagueSyncHealth.OK);
  });

  it('reads ERROR with a SYNC issue when the event\'s latest field or scores run failed, and NOT_RUN_YET before any run', () => {
    const failed = buildSportEventOverview(eventPageFacts({ latestRuns: [run(ProviderSyncKind.FIELD, { status: ProviderSyncRunStatus.FAILED })] }), context);
    const fresh = buildSportEventOverview(eventPageFacts(), context);

    expect(failed.syncHealth).toBe(SportLeagueSyncHealth.ERROR);
    expect(failed.issues.map((issue) => [issue.type, issue.count])).toEqual([[SportLeagueIssueType.SYNC, 1]]);
    expect(fresh).toMatchObject({ syncHealth: SportLeagueSyncHealth.NOT_RUN_YET, issues: [] });
  });

  it('reads every sync OFF for an event no provider syncs, as one an admin made in a synced league', () => {
    const overview = buildSportEventOverview(eventPageFacts({ event: pageEvent({ providerId: 'manual-admin', syncScope: SportEventSyncScope.NONE }) }), context);

    expect(overview.syncHealth).toBe(SportLeagueSyncHealth.OFF);
    expect(overview.syncs.map((sync) => sync.health)).toEqual([SportLeagueSyncHealth.OFF, SportLeagueSyncHealth.OFF]);
    expect(overview.releaseMode).toBe(SportEventReleaseMode.MANUAL);
  });

  it('gives a held draft its RELEASE issue and an automatic draft its planned release, its start less the league\'s window', () => {
    const check = { checkedAt: at('2027-04-15T11:00:00.000Z'), outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] };
    const overview = buildSportEventOverview(eventPageFacts({ event: pageEvent({ lastReleaseCheck: check }) }), context);

    expect(overview.issues.map((issue) => issue.type)).toEqual([SportLeagueIssueType.RELEASE]);
    expect(overview).toMatchObject({
      releaseMode: SportEventReleaseMode.AUTO,
      releaseAt: new Date(at('2027-04-20T17:00:00.000Z').getTime() - 7 * DAY),
      releaseAtKind: SportEventReleaseAtKind.PLANNED,
    });
  });

  it('counts only this event\'s overdue candidate as its OVERDUE issue', () => {
    const expectedEnd = new Date(NOW.getTime() - OVERDUE_AFTER_MS - MINUTE);
    const candidate = { id: 'e1', name: 'Opening Day', sport: Sport.BASEBALL, status: SportEventStatus.IN_PROGRESS, startDate: at('2027-04-14T00:00:00.000Z'), endDate: expectedEnd, rounds: [], typicalGameMinutes: 180 };
    const overview = buildSportEventOverview(eventPageFacts({ overdueCandidates: [candidate, { ...candidate, id: 'e2' }] }), context);

    expect(overview.issues).toEqual([{
      type: SportLeagueIssueType.OVERDUE, count: 1, items: [{ label: 'Opening Day', occurredAt: expectedEnd, target: { type: SportLeagueIssueTargetType.SPORT_EVENT, id: 'e1' } }],
    }]);
  });

  it('orders the active field by the first value every active participant has, ignoring a withdrawn one without it', () => {
    const overview = buildSportEventOverview(eventPageFacts({
      field: [fieldRow({ oddsToWin: 5, ranking: 1 }), fieldRow({ id: 'sep2', oddsToWin: 12 }), fieldRow({ id: 'sep3', isActive: false })],
    }), context);

    expect(overview).toMatchObject({ tierOrderBasis: FieldOrderBasis.ODDS, tierOrderCoversField: true });
  });

  it('names the first value anyone has when none covers the field, and no basis with no active field', () => {
    const partial = buildSportEventOverview(eventPageFacts({ field: [fieldRow({ seedNumber: 1 }), fieldRow({ id: 'sep2' })] }), context);
    const empty = buildSportEventOverview(eventPageFacts({ field: [fieldRow({ isActive: false })] }), context);

    expect(partial).toMatchObject({ tierOrderBasis: FieldOrderBasis.SEED, tierOrderCoversField: false });
    expect(empty).toMatchObject({ tierOrderBasis: null, tierOrderCoversField: true });
  });

  it('gives every field row, withdrawn ones too, its feed id and when the feed last listed it', () => {
    const seen = at('2027-04-15T09:00:00.000Z');
    const overview = buildSportEventOverview(eventPageFacts({
      field: [fieldRow({ mapping: { externalId: 'mlb-player-592450', lastSeenAt: seen } }), fieldRow({ id: 'sep2', isActive: false })],
    }), context);

    expect(overview.fieldFeed).toEqual([
      { sportEventParticipantId: 'sep1', feedId: 'mlb-player-592450', lastInFeedAt: seen },
      { sportEventParticipantId: 'sep2', feedId: null, lastInFeedAt: null },
    ]);
  });

  it('carries the path of the event page offering its series, and null when no page offers it', () => {
    expect(buildSportEventOverview(eventPageFacts({ eventPagePath: '/play/baseball/world-series' }), context).eventPagePath).toBe('/play/baseball/world-series');
    expect(buildSportEventOverview(eventPageFacts(), context).eventPagePath).toBeNull();
  });

  it('sends the overview in the shape the contract declares', () => {
    const overview = buildSportEventOverview(eventPageFacts({
      latestRuns: [run(ProviderSyncKind.FIELD, { id: '7b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d32' })],
      field: [fieldRow({ id: '7b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d33', mapping: { externalId: 'x', lastSeenAt: NOW } })],
    }), context);

    expect(SportEventOverviewDtoSchema.parse(mapSportEventOverviewToDto(overview))).toBeTruthy();
  });
});

describe('SportLeaguePageService', () => {
  const participant = {
    id: '7b2eac0a-7c2a-4e3a-9f65-4b8a0a5a6d32', name: 'Aaron Judge', participantType: 'INDIVIDUAL' as const, shortName: null, nationality: 'USA',
    teamAffiliation: 'Yankees', role: 'RF', ranking: 1, createdAt: NOW,
  };
  const service = (rows: SportLeaguePageParticipant[] | null) => new SportLeaguePageService({
    reader: makeReader(rows),
    webhookProviderIds: () => [],
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
    await expect(missing.getEventOverview('nope')).resolves.toBeNull();
  });

  it('reads the syncs and events of a sport league that exists', async () => {
    const found = service([]);

    await expect(found.listSyncs('mlb')).resolves.toHaveLength(3);
    await expect(found.listEvents('mlb')).resolves.toHaveLength(1);
    await expect(found.getEventOverview('e1')).resolves.toMatchObject({ syncs: [{ kind: ProviderSyncKind.FIELD }, { kind: ProviderSyncKind.SCORES }] });
  });
});

/** A reader that knows every sport league when `participants` is a list, and none when it is null. */
function makeReader(participants: SportLeaguePageParticipant[] | null): SportLeaguePageReader {
  const exists = participants !== null;
  return {
    readSyncFacts: () => Promise.resolve(exists ? { league: league(), latestRuns: [] } : null),
    readEventFacts: () => Promise.resolve(exists ? eventFacts() : null),
    readParticipants: () => Promise.resolve(participants),
    readEventPageFacts: () => Promise.resolve(exists ? eventPageFacts() : null),
  };
}
