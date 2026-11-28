/**
 * The League page reader (#1865) over a Prisma double: how it shapes each grouped read's rows
 * into the page's facts. The statements themselves, and their count, are proved against
 * Postgres in sport-league-page.integration.ts and root-admin-route-query-scaling.integration.ts.
 */
import { expect } from '@jest/globals';
import {
  AutoReleaseCheckOutcome,
  LeaguePhase,
  SeriesFormat,
  SlotKind,
  SlotPairing,
  MatchFormat,
  PeriodUnit,
  SlotProviderMatchType,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ReleaseCheckKey,
  Sport,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import { PrismaSportLeaguePageReader } from '../../../packages/core-api/src/adapters/prisma-sport-league-page-reader';
import { asPrismaClient } from '../../support/prisma-double';

const NOW = new Date('2027-04-15T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

const SYNCED_TO_BALLDONTLIE = { providerLeague: { provider: { code: 'BALLDONTLIE' } } };
const LEAGUE_ROW = {
  id: 'tour', isActive: true, selectedProviderMapping: SYNCED_TO_BALLDONTLIE, autoReleaseDaysBeforeStart: 7, sport: { sport: Sport.GOLF },
  platformTierProfile: { sources: [{ basis: 'ODDS' }, { basis: 'SEED' }] },
};

function runRow(kind: ProviderSyncKind, overrides: Record<string, unknown> = {}) {
  return { id: `run-${kind}`, kind, status: ProviderSyncRunStatus.COMPLETED, createdAt: NOW, startedAt: NOW, summary: '', changedCount: null, ...overrides };
}

function prismaDouble(options: { league?: unknown } = {}) {
  return {
    sportLeague: { findUnique: jest.fn().mockResolvedValue(options.league === undefined ? LEAGUE_ROW : options.league) },
    providerSyncRun: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    sportEvent: { findMany: jest.fn().mockResolvedValue([]) },
    sportEventParticipant: { groupBy: jest.fn().mockResolvedValue([]) },
    participant: { findMany: jest.fn().mockResolvedValue([]) },
    participantProviderMapping: { findMany: jest.fn().mockResolvedValue([]) },
    sportLeagueSeasonParticipantTeam: { findMany: jest.fn().mockResolvedValue([]) },
    sportLeaguePositionProviderMapping: { findFirst: jest.fn().mockResolvedValue(null) },
    sportLeaguePhase: { findMany: jest.fn().mockResolvedValue([]) },
    sportLeagueCompetition: { findMany: jest.fn().mockResolvedValue([]) },
    sportLeagueCompetitionSlot: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('PrismaSportLeaguePageReader.readSyncFacts', () => {
  it('answers null for a league that does not exist', async () => {
    const prisma = prismaDouble({ league: null });

    await expect(new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readSyncFacts('missing')).resolves.toBeNull();
  });

  it('reads no runs when no run names the league, and keeps the league with its sport', async () => {
    const prisma = prismaDouble();
    prisma.providerSyncRun.groupBy.mockResolvedValue([{ kind: ProviderSyncKind.FIELD, _max: { createdAt: null } }]);

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readSyncFacts('tour');

    expect(facts).toEqual({ league: { id: 'tour', sport: Sport.GOLF, isActive: true, syncProviderId: 'balldontlie', autoReleaseDaysBeforeStart: 7, tierSources: ['ODDS', 'SEED'] }, latestRuns: [], syncsRoster: false });
    expect(prisma.providerSyncRun.findMany).not.toHaveBeenCalled();
  });

  it('reads the league\'s own runs, keeps one run per kind, and shows a changed count for a completed run only', async () => {
    const prisma = prismaDouble();
    prisma.providerSyncRun.groupBy.mockResolvedValue([
      { kind: ProviderSyncKind.EVENTS, _max: { createdAt: NOW } },
      { kind: ProviderSyncKind.FIELD, _max: { createdAt: NOW } },
    ]);
    prisma.providerSyncRun.findMany.mockResolvedValue([
      runRow(ProviderSyncKind.EVENTS, { summary: 'Read 5 events.', changedCount: 5 }),
      runRow(ProviderSyncKind.EVENTS, { id: 'run-EVENTS-twin' }),
      runRow(ProviderSyncKind.FIELD, { status: ProviderSyncRunStatus.FAILED, changedCount: 2 }),
    ]);

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readSyncFacts('tour');

    expect(prisma.providerSyncRun.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { sportLeagueId: 'tour' } }));
    expect(facts?.latestRuns).toEqual([
      expect.objectContaining({ id: 'run-EVENTS', summary: 'Read 5 events.', changedCount: 5 }),
      expect.objectContaining({ id: 'run-FIELD', changedCount: null }),
    ]);
  });

  it('reads an empty summary as none', async () => {
    const prisma = prismaDouble();
    prisma.providerSyncRun.groupBy.mockResolvedValue([{ kind: ProviderSyncKind.EVENTS, _max: { createdAt: NOW } }]);
    prisma.providerSyncRun.findMany.mockResolvedValue([runRow(ProviderSyncKind.EVENTS)]);

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readSyncFacts('tour');

    expect(facts?.latestRuns).toEqual([expect.objectContaining({ summary: null })]);
  });
});

describe('PrismaSportLeaguePageReader.readEventFacts', () => {
  it('answers null for a league that does not exist', async () => {
    const prisma = prismaDouble({ league: null });

    await expect(new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readEventFacts('missing')).resolves.toBeNull();
  });

  it('reads no field or runs for a league with no events', async () => {
    const prisma = prismaDouble();

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readEventFacts('tour');

    expect(facts).toMatchObject({ events: [] });
    expect(prisma.sportEventParticipant.groupBy).not.toHaveBeenCalled();
  });

  it('gives each event its stored release check, field size and latest run of each kind', async () => {
    const prisma = prismaDouble();
    const event = {
      id: 'e1', name: 'Opener', startDate: NOW, endDate: null, status: SportEventStatus.DRAFT, slots: [], releasedAt: null,
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

    const facts = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readEventFacts('tour');

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

  it('names a player\'s team and position on the current Season\'s roster, and none for one not on it', async () => {
    const prisma = prismaDouble();
    prisma.participant.findMany.mockResolvedValue([{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }]);
    prisma.sportLeagueSeasonParticipantTeam.findMany.mockResolvedValue([
      { participantId: 'p1', teamParticipantId: 't1', lastSeenAt: NOW, team: { name: 'Kansas City Chiefs' }, position: { code: 'QB' } },
    ]);

    const rows = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readParticipants('tour');

    expect(rows?.map((row) => [row.participant.id, row.roster])).toEqual([
      ['p1', { teamParticipantId: 't1', teamName: 'Kansas City Chiefs', positionCode: 'QB', lastSeenAt: NOW }],
      ['p2', null],
    ]);
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

describe('PrismaSportLeaguePageReader.readStructure', () => {
  it('answers null for a league that does not exist', async () => {
    const prisma = prismaDouble({ league: null });

    await expect(new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readStructure('missing')).resolves.toBeNull();
  });

  it('puts each slot under its own competition and each competition under its phase, with its provider mappings named by provider and provider league, and a competition with no slots none', async () => {
    const prisma = prismaDouble();
    prisma.sportLeaguePhase.findMany.mockResolvedValue([
      { id: 'regular', phase: LeaguePhase.REGULAR, isSynced: true },
      { id: 'preseason', phase: LeaguePhase.PRESEASON, isSynced: false },
    ]);
    prisma.sportLeagueCompetition.findMany.mockResolvedValue([
      { id: 'c-regular', sportLeaguePhaseId: 'regular', code: 'REGULAR', orderIndex: 1 },
      { id: 'c-preseason', sportLeaguePhaseId: 'preseason', code: 'PRESEASON', orderIndex: 1 },
    ]);
    const slot = {
      id: 'week-1', sportLeagueCompetitionId: 'c-regular', key: 'WEEK_1', slotKind: SlotKind.WEEK, weekNumber: 1, name: null, awardsTrophy: false, squaresEligible: true,
      seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1, pairing: SlotPairing.FIXED,
      matchFormat: MatchFormat.HEAD_TO_HEAD, canEndTied: true, periodUnit: PeriodUnit.HALF, periodCount: 2,
      providerMappings: [{
        id: 'm1', matchType: SlotProviderMatchType.PROVIDER_CODE, providerValue: 'REG:1',
        sportLeagueProviderMapping: { providerLeague: { code: 'nfl', name: 'NFL', provider: { id: 'bdl', name: 'BALLDONTLIE' } } },
      }],
    };
    prisma.sportLeagueCompetitionSlot.findMany.mockResolvedValue([slot]);

    const phases = await new PrismaSportLeaguePageReader(asPrismaClient(prisma)).readStructure('tour');

    expect(phases).toEqual([
      {
        id: 'regular', phase: LeaguePhase.REGULAR, isSynced: true,
        competitions: [{ id: 'c-regular', code: 'REGULAR', orderIndex: 1, slots: [{
          id: 'week-1', key: 'WEEK_1', slotKind: SlotKind.WEEK, weekNumber: 1, name: null, awardsTrophy: false, squaresEligible: true,
          seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1, pairing: SlotPairing.FIXED,
          matchFormat: MatchFormat.HEAD_TO_HEAD, canEndTied: true, periodUnit: PeriodUnit.HALF, periodCount: 2,
          providerMappings: [{
            id: 'm1', matchType: SlotProviderMatchType.PROVIDER_CODE, providerValue: 'REG:1',
            providerId: 'bdl', providerName: 'BALLDONTLIE', providerLeagueCode: 'nfl', providerLeagueName: 'NFL',
          }],
        }] }],
      },
      { id: 'preseason', phase: LeaguePhase.PRESEASON, isSynced: false, competitions: [{ id: 'c-preseason', code: 'PRESEASON', orderIndex: 1, slots: [] }] },
    ]);
  });
});
