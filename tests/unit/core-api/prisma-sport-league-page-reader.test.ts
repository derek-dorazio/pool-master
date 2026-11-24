/**
 * The League page reader (#1865) over a Prisma double: how it shapes each grouped read's rows
 * into the page's facts. The statements themselves, and their count, are proved against
 * Postgres in sport-league-page.integration.ts and root-admin-route-query-scaling.integration.ts.
 */
import { expect } from '@jest/globals';
import {
  AutoReleaseCheckOutcome,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ReleaseCheckKey,
  Sport,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import { PrismaSportLeaguePageReader } from '../../../packages/core-api/src/adapters/prisma-sport-league-page-reader';
import { readOverdueCandidates } from '../../../packages/core-api/src/adapters/prisma-overdue-event-reads';
import { asPrismaClient } from '../../support/prisma-double';

const NOW = new Date('2027-04-15T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

const SYNCED_TO_BALLDONTLIE = { providerLeague: { provider: { code: 'BALLDONTLIE' } } };
const LEAGUE_ROW = {
  id: 'tour', isActive: true, parentSportLeagueId: null, scoringFamily: null, selectedProviderMapping: SYNCED_TO_BALLDONTLIE, autoReleaseDaysBeforeStart: 7,
  sport: { sport: Sport.GOLF }, parentSportLeague: null,
};
const CLUTCH_ROW = {
  ...LEAGUE_ROW, id: 'clutch', parentSportLeagueId: 'tour', scoringFamily: 'COMPOSITE', selectedProviderMapping: null,
  parentSportLeague: { isActive: true, selectedProviderMapping: SYNCED_TO_BALLDONTLIE },
};

function runRow(kind: ProviderSyncKind, overrides: Record<string, unknown> = {}) {
  return { id: `run-${kind}`, kind, status: ProviderSyncRunStatus.COMPLETED, createdAt: NOW, startedAt: NOW, payloadJson: {}, ...overrides };
}

function prismaDouble(options: { league?: unknown } = {}) {
  return {
    sportLeague: { findUnique: jest.fn().mockResolvedValue(options.league === undefined ? LEAGUE_ROW : options.league) },
    providerSyncRun: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    eventSeries: { findMany: jest.fn().mockResolvedValue([{ id: 'series-1' }]) },
    sportEvent: { findMany: jest.fn().mockResolvedValue([]) },
    sportEventRound: { findMany: jest.fn().mockResolvedValue([]) },
    sportEventMatch: { groupBy: jest.fn().mockResolvedValue([]) },
    sportEventParticipant: { groupBy: jest.fn().mockResolvedValue([]) },
    participant: { findMany: jest.fn().mockResolvedValue([]) },
    participantProviderMapping: { findMany: jest.fn().mockResolvedValue([]) },
    providerLeague: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('PrismaSportLeaguePageReader.readSyncFacts', () => {
  it('answers null for a league that does not exist', async () => {
    const prisma = prismaDouble({ league: null });

    await expect(new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readSyncFacts('missing')).resolves.toBeNull();
  });

  it('reads no runs when no run names the league, and keeps the league with its sport', async () => {
    const prisma = prismaDouble();
    prisma.providerSyncRun.groupBy.mockResolvedValue([{ sportLeagueId: null, kind: ProviderSyncKind.EVENTS, _max: { createdAt: NOW } }, { sportLeagueId: 'tour', kind: ProviderSyncKind.FIELD, _max: { createdAt: null } }]);

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readSyncFacts('tour');

    expect(facts).toEqual({ league: expect.objectContaining({ id: 'tour', sport: Sport.GOLF, syncProviderId: 'balldontlie', parent: null }), latestRuns: [] });
    expect(prisma.providerSyncRun.findMany).not.toHaveBeenCalled();
  });

  it('takes a Clutch Card\'s event list from its parent\'s runs, keeps one run per kind, and counts a completed run\'s created and updated rows', async () => {
    const prisma = prismaDouble({ league: CLUTCH_ROW });
    prisma.providerSyncRun.groupBy.mockResolvedValue([
      { sportLeagueId: 'tour', kind: ProviderSyncKind.EVENTS, _max: { createdAt: NOW } },
      { sportLeagueId: 'clutch', kind: ProviderSyncKind.FIELD, _max: { createdAt: NOW } },
    ]);
    prisma.providerSyncRun.findMany.mockResolvedValue([
      runRow(ProviderSyncKind.EVENTS, { payloadJson: { stats: { writeCreated: 2, writeUpdated: 3 }, outcome: { summary: 'Read 5 events.' } } }),
      runRow(ProviderSyncKind.EVENTS, { id: 'run-EVENTS-twin' }),
      runRow(ProviderSyncKind.FIELD, { status: ProviderSyncRunStatus.FAILED, payloadJson: { stats: { writeCreated: 1, writeUpdated: 1 } } }),
    ]);

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readSyncFacts('clutch');

    expect(prisma.providerSyncRun.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ sportLeagueId: 'clutch', kind: { not: ProviderSyncKind.EVENTS } }, { sportLeagueId: 'tour', kind: ProviderSyncKind.EVENTS }] },
    }));
    expect(facts?.latestRuns).toEqual([
      expect.objectContaining({ id: 'run-EVENTS', summary: 'Read 5 events.', changedCount: 5 }),
      expect.objectContaining({ id: 'run-FIELD', changedCount: null }),
    ]);
  });

  it('counts no changed rows for a completed run whose payload names no stats, or stats that are not counts', async () => {
    const prisma = prismaDouble();
    prisma.providerSyncRun.groupBy.mockResolvedValue([{ sportLeagueId: 'tour', kind: ProviderSyncKind.EVENTS, _max: { createdAt: NOW } }]);
    const payloads = ['not an object', [], { stats: 'none' }, { stats: [] }, { stats: { writeCreated: 1 } }, { stats: { writeCreated: '1', writeUpdated: 1 } }];
    const reader = new PrismaSportLeaguePageReader(asPrismaClient(prisma));

    const runs = [];
    for (const payloadJson of payloads) {
      prisma.providerSyncRun.findMany.mockResolvedValueOnce([runRow(ProviderSyncKind.EVENTS, { payloadJson })]);
      runs.push(...(await reader.readSyncFacts('tour'))?.latestRuns ?? []);
    }

    expect(runs.map((run) => run.changedCount)).toEqual(payloads.map(() => null));
  });
});

describe('PrismaSportLeaguePageReader.readEventFacts', () => {
  it('answers null for a league that does not exist', async () => {
    const prisma = prismaDouble({ league: null });

    await expect(new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readEventFacts('missing', NOW)).resolves.toBeNull();
  });

  it('reads no field or runs for a league with no events', async () => {
    const prisma = prismaDouble();

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readEventFacts('tour', NOW);

    expect(facts).toMatchObject({ events: [], overdueCandidates: [] });
    expect(prisma.sportEventParticipant.groupBy).not.toHaveBeenCalled();
  });

  it('gives each event its stored release check, field size and latest run of each kind', async () => {
    const prisma = prismaDouble();
    const event = {
      id: 'e1', name: 'Opener', eventYear: 2027, startDate: NOW, endDate: null, status: SportEventStatus.DRAFT, providerId: 'balldontlie', syncScope: 'SCORES_ONLY', releasedAt: null,
      autoReleaseCheckedAt: NOW, autoReleaseOutcome: AutoReleaseCheckOutcome.HELD, autoReleaseFailedChecks: [ReleaseCheckKey.TIERS_ASSIGNED],
    };
    prisma.sportEvent.findMany.mockImplementation(async (args: { where: { status?: unknown } }) => (args.where.status === undefined
      ? [event, { ...event, id: 'e2', autoReleaseCheckedAt: null, autoReleaseOutcome: null, autoReleaseFailedChecks: [] }]
      : []));
    prisma.sportEventParticipant.groupBy.mockResolvedValue([{ sportEventId: 'e1', _count: { _all: 26 } }]);
    prisma.providerSyncRun.groupBy.mockResolvedValue([
      { sportEventId: 'e1', kind: ProviderSyncKind.FIELD, _max: { createdAt: NOW } },
      { sportEventId: null, kind: ProviderSyncKind.FIELD, _max: { createdAt: NOW } },
      { sportEventId: 'e2', kind: ProviderSyncKind.FIELD, _max: { createdAt: null } },
    ]);
    prisma.providerSyncRun.findMany.mockResolvedValue([
      { ...runRow(ProviderSyncKind.FIELD), sportEventId: 'e1' },
      { ...runRow(ProviderSyncKind.SCORES), sportEventId: 'e1' },
      { ...runRow(ProviderSyncKind.SCORES), sportEventId: null },
    ]);

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readEventFacts('tour', NOW);

    expect(facts?.events.map((row) => row.lastReleaseCheck)).toEqual([
      { checkedAt: NOW, outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] },
      null,
    ]);
    expect(facts?.fieldSizes.get('e1')).toBe(26);
    expect(facts?.latestRunsByEvent.get('e1')?.map((run) => run.kind)).toEqual([ProviderSyncKind.FIELD, ProviderSyncKind.SCORES]);
    expect(facts?.latestRunsByEvent.has('e2')).toBe(false);
  });
});

describe('PrismaSportLeaguePageReader.readParticipants', () => {
  it('answers null for a league that does not exist', async () => {
    const prisma = prismaDouble({ league: null });

    await expect(new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readParticipants('missing')).resolves.toBeNull();
  });

  it('names each participant\'s latest made mapping, and none for one with no mapping', async () => {
    const prisma = prismaDouble();
    prisma.participant.findMany.mockResolvedValue([{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }]);
    prisma.participantProviderMapping.findMany.mockResolvedValue([
      { participantId: 'p1', externalId: 'newer', lastSeenAt: NOW, mappedAt: NOW },
      { participantId: 'p1', externalId: 'older', lastSeenAt: null, mappedAt: at('2027-01-01T00:00:00.000Z') },
    ]);

    const rows = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readParticipants('tour');

    expect(rows?.map((row) => [row.participant.id, row.mapping])).toEqual([
      ['p1', { externalId: 'newer', lastSeenAt: NOW }],
      ['p2', null],
    ]);
  });
});

describe('readOverdueCandidates', () => {
  it('never reads a never-released draft, nor a completed or cancelled event, as a candidate', async () => {
    const prisma = prismaDouble();

    await readOverdueCandidates(asPrismaClient(prisma), NOW);

    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { notIn: [SportEventStatus.DRAFT, SportEventStatus.COMPLETED, SportEventStatus.CANCELLED] },
      }),
    }));
  });

  it('reads no rounds when no event may be overdue', async () => {
    const prisma = prismaDouble();

    await expect(readOverdueCandidates(asPrismaClient(prisma), NOW)).resolves.toEqual([]);
    expect(prisma.sportEventRound.findMany).not.toHaveBeenCalled();
  });

  it('gives an event its own rounds with each round\'s latest match start, and a Clutch Card event only the parent rounds it covers, each with its league\'s typical game length', async () => {
    const prisma = prismaDouble();
    const base = { name: 'Event', sport: Sport.GOLF, status: SportEventStatus.IN_PROGRESS, startDate: at('2027-04-10T00:00:00.000Z'), endDate: null, eventSeriesId: 'series-1', parentRoundNumbers: [] };
    prisma.sportEvent.findMany.mockResolvedValue([
      { ...base, id: 'parent', parentEventId: null },
      { ...base, id: 'card', parentEventId: 'parent', parentRoundNumbers: [2] },
      { ...base, id: 'bare', parentEventId: null },
    ]);
    const round = (roundNumber: number) => ({ id: `r${String(roundNumber)}`, sportEventId: 'parent', roundNumber, scheduledDate: at(`2027-04-1${String(roundNumber)}T00:00:00.000Z`), scheduledEndAt: null });
    prisma.sportEventRound.findMany.mockResolvedValue([round(1), round(2)]);
    prisma.sportEventMatch.groupBy.mockResolvedValue([{ sportEventRoundId: 'r2', _max: { scheduledDate: at('2027-04-12T18:00:00.000Z') } }]);
    prisma.eventSeries.findMany.mockResolvedValue([{ id: 'series-1', sportLeagueId: 'tour' }]);
    prisma.providerLeague.findMany.mockResolvedValue([{ typicalGameMinutes: 300, sportLeagues: [{ sportLeagueId: 'tour' }] }]);

    const candidates = await readOverdueCandidates(asPrismaClient(prisma), NOW, ['series-1']);

    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventSeriesId: { in: ['series-1'] } }) }));
    expect(candidates.map((candidate) => [candidate.id, candidate.rounds.map((facts) => facts.latestMatchStart)])).toEqual([
      ['parent', [null, at('2027-04-12T18:00:00.000Z')]],
      ['card', [at('2027-04-12T18:00:00.000Z')]],
      ['bare', []],
    ]);
    expect(candidates.map((candidate) => candidate.typicalGameMinutes)).toEqual([300, 300, 300]);
  });
});
