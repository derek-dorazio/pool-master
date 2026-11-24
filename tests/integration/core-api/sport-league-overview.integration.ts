/**
 * The root admin's sport league overview (#1847) against real Postgres: what the reader gathers
 * for each sport league, that a sport event keeps its latest automatic release check, and that a
 * scheduled sync run records the event and sport league its provider event is linked to. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AutoReleaseCheckOutcome, JobTrigger, ProviderSyncKind, ProviderSyncRunStatus, ReleaseCheckKey, Sport } from '@poolmaster/shared/domain';
import { PrismaProviderSyncRunRepository, PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { PrismaSportLeagueOverviewReader } from '../../../packages/core-api/src/adapters/prisma-sport-league-overview-reader';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { cleanupTestData, createTestUser, getApp, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { findUnindexedScans } from '../index-check';
import { recordStatements } from '../statement-log';
import { leagueProfiles } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const NOW = new Date('2027-04-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (count: number) => new Date(NOW.getTime() + count * DAY_MS);

async function golfSportId(): Promise<string> {
  const sport = await getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return sport.id;
}

/** A golf league; `synced` maps it to BALLDONTLIE's PGA TOUR and selects that mapping. */
async function sportLeague(name: string, { synced = false, ...extra }: { scoringFamily?: 'COMPOSITE'; parentSportLeagueId?: string; parentRoundNumbers?: number[]; synced?: boolean } = {}) {
  const league = await getPrisma().sportLeague.create({
    data: { ...(await leagueProfiles(getPrisma())), sportId: await golfSportId(), name: `${name} ${randomUUID().slice(0, 8)}`, ...extra },
  });
  if (synced) await syncLeagueTo(getPrisma(), league.id, 'pga');
  return league;
}

async function event(sportLeagueId: string, input: { eventYear: number; startDate: Date; endDate?: Date; status?: 'DRAFT' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'; parentEventId?: string; parentRoundNumbers?: number[] }) {
  const prisma = getPrisma();
  const series = await prisma.eventSeries.create({ data: { sportLeagueId, name: `Series ${randomUUID()}` } });
  return prisma.sportEvent.create({
    data: { eventSeriesId: series.id, sport: Sport.GOLF, name: `Event ${randomUUID().slice(0, 8)}`, providerId: 'balldontlie', externalId: randomUUID(), ...input },
  });
}

describe('PrismaSportLeagueOverviewReader', () => {
  it('gathers each sport league\'s latest run per sync kind, held drafts, event years, next start and Clutch Card rounds', async () => {
    const prisma = getPrisma();
    const tour = await sportLeague('Overview Tour', { synced: true });
    const clutch = await sportLeague('Overview Clutch Card', { scoringFamily: 'COMPOSITE', parentSportLeagueId: tour.id, parentRoundNumbers: [2] });
    const past = await event(tour.id, { eventYear: 2026, startDate: days(-200), endDate: days(-196), status: 'COMPLETED' });
    const current = await event(tour.id, { eventYear: 2027, startDate: days(-20), endDate: days(-17), status: 'COMPLETED' });
    const next = await event(tour.id, { eventYear: 2027, startDate: days(10), endDate: days(13) });
    await event(tour.id, { eventYear: 2027, startDate: days(5), status: 'CANCELLED' });
    const held = await event(tour.id, { eventYear: 2027, startDate: days(30), status: 'DRAFT' });
    await new PrismaSportEventRepository(getAppPrisma()).recordAutoReleaseCheck(held.id, { checkedAt: NOW, outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] });
    await prisma.sportEventRound.createMany({
      data: [
        { sportEventId: next.id, roundNumber: 1, scheduledDate: days(10) },
        { sportEventId: next.id, roundNumber: 2, scheduledDate: days(12), scheduledEndAt: days(13) },
      ],
    });
    await event(clutch.id, { eventYear: 2027, startDate: days(12), parentEventId: next.id, parentRoundNumbers: [2] });
    const run = (kind: 'EVENTS' | 'FIELD' | 'SCORES', status: 'COMPLETED' | 'FAILED', createdAt: Date, payloadJson: Prisma.InputJsonValue = {}) => ({
      kind, trigger: 'SCHEDULE' as const, providerId: 'balldontlie', sport: Sport.GOLF, sportLeagueId: tour.id, status, createdAt, payloadJson,
    });
    await prisma.providerSyncRun.createMany({
      data: [
        run('EVENTS', 'COMPLETED', days(-2)),
        run('EVENTS', 'FAILED', days(-1), { outcome: { summary: 'Interrupted before it finished.' } }),
        run('FIELD', 'FAILED', days(-3)),
        run('FIELD', 'COMPLETED', days(-1), { outcome: { summary: '' } }),
        // Two runs in the same instant, neither with an outcome object: one is the latest, with no summary.
        run('SCORES', 'COMPLETED', days(-1), 'not an object'),
        run('SCORES', 'COMPLETED', days(-1), { outcome: 'not an object' }),
      ],
    });

    const { result: facts, statements } = await recordStatements(() => new PrismaSportLeagueOverviewReader(getAppPrisma()).readFacts(NOW));

    expect(facts.leagues).toEqual(expect.arrayContaining([
      { id: tour.id, sport: Sport.GOLF, name: tour.name, parentSportLeagueId: null, scoringFamily: null, syncProviderId: 'balldontlie', isActive: true },
      expect.objectContaining({ id: clutch.id, parentSportLeagueId: tour.id, scoringFamily: 'COMPOSITE' }),
    ]));
    expect(facts.latestSyncRuns.filter((latest) => latest.sportLeagueId === tour.id).sort((left, right) => left.kind.localeCompare(right.kind))).toEqual([
      expect.objectContaining({ kind: ProviderSyncKind.EVENTS, status: ProviderSyncRunStatus.FAILED, summary: 'Interrupted before it finished.' }),
      expect.objectContaining({ kind: ProviderSyncKind.FIELD, status: ProviderSyncRunStatus.COMPLETED, summary: null }),
      expect.objectContaining({ kind: ProviderSyncKind.SCORES, status: ProviderSyncRunStatus.COMPLETED, summary: null }),
    ]);
    expect(facts.heldEvents).toEqual([{ id: held.id, sportLeagueId: tour.id, name: held.name, checkedAt: NOW, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] }]);
    expect(facts.eventCounts.get(tour.id)).toBe(5);
    expect(facts.eventCounts.get(clutch.id)).toBe(1);
    // The cancelled event is in neither the 2027 span nor the next start.
    expect(facts.eventYearSpans.filter((span) => span.sportLeagueId === tour.id).sort((left, right) => left.eventYear - right.eventYear)).toEqual([
      { sportLeagueId: tour.id, eventYear: 2026, firstStart: past.startDate, lastStart: past.startDate, lastEnd: past.endDate },
      { sportLeagueId: tour.id, eventYear: 2027, firstStart: current.startDate, lastStart: held.startDate, lastEnd: next.endDate },
    ]);
    expect(facts.nextEventStarts.get(tour.id)).toEqual(next.startDate);
    expect(facts.clutchCardEvents).toEqual([{
      sportLeagueId: clutch.id,
      eventYear: 2027,
      parentRoundNumbers: [2],
      parentRounds: expect.arrayContaining([
        { roundNumber: 1, scheduledDate: days(10), scheduledEndAt: null },
        { roundNumber: 2, scheduledDate: days(12), scheduledEndAt: days(13) },
      ]),
    }]);
    await expect(findUnindexedScans(getPrisma(), statements.map(({ sql }) => ({ sql, test: 'PrismaSportLeagueOverviewReader.readFacts' })))).resolves.toEqual([]);
  });

  it('reads no sync runs at all when no run names a sport league', async () => {
    await sportLeague('Quiet Tour');

    const facts = await new PrismaSportLeagueOverviewReader(getAppPrisma()).readFacts(NOW);

    expect(facts.latestSyncRuns).toEqual([]);
    expect(facts.clutchCardEvents).toEqual([]);
  });
});

describe('PrismaSportEventRepository.recordAutoReleaseCheck', () => {
  it('stores a held check and reads it back, overwrites it with a release, and clears it', async () => {
    const tour = await sportLeague('Release Tour');
    const draft = await event(tour.id, { eventYear: 2027, startDate: days(3), status: 'DRAFT' });
    const repository = new PrismaSportEventRepository(getAppPrisma());
    const stored = async () => getPrisma().sportEvent.findUniqueOrThrow({
      where: { id: draft.id },
      select: { autoReleaseCheckedAt: true, autoReleaseOutcome: true, autoReleaseFailedChecks: true },
    });

    await expect(repository.findAutoReleaseCheck(draft.id)).resolves.toBeNull();
    await repository.recordAutoReleaseCheck(draft.id, { checkedAt: NOW, outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED, ReleaseCheckKey.CONTEST_SETUPS_ON] });
    await expect(stored()).resolves.toEqual({ autoReleaseCheckedAt: NOW, autoReleaseOutcome: 'HELD', autoReleaseFailedChecks: ['TIERS_ASSIGNED', 'CONTEST_SETUPS_ON'] });
    await expect(repository.findAutoReleaseCheck(draft.id)).resolves.toEqual({
      checkedAt: NOW, outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED, ReleaseCheckKey.CONTEST_SETUPS_ON],
    });

    await repository.recordAutoReleaseCheck(draft.id, { checkedAt: days(1), outcome: AutoReleaseCheckOutcome.RELEASED, failedChecks: [] });
    await expect(stored()).resolves.toEqual({ autoReleaseCheckedAt: days(1), autoReleaseOutcome: 'RELEASED', autoReleaseFailedChecks: [] });

    await repository.recordAutoReleaseCheck(draft.id, null);
    await expect(stored()).resolves.toEqual({ autoReleaseCheckedAt: null, autoReleaseOutcome: null, autoReleaseFailedChecks: [] });
  });

  it('refuses at the database a released check that names failed checks, and an outcome with no time', async () => {
    const tour = await sportLeague('Constraint Tour');
    const draft = await event(tour.id, { eventYear: 2027, startDate: days(3), status: 'DRAFT' });

    await expect(getPrisma().sportEvent.update({
      where: { id: draft.id },
      data: { autoReleaseCheckedAt: NOW, autoReleaseOutcome: 'RELEASED', autoReleaseFailedChecks: ['FIELD_LOADED'] },
    })).rejects.toThrow(/sport_events_auto_release_released_has_no_failed_checks/);
    await expect(getPrisma().sportEvent.update({ where: { id: draft.id }, data: { autoReleaseOutcome: 'HELD' } }))
      .rejects.toThrow(/sport_events_auto_release_check_complete/);
  });
});

describe('ProviderSyncRunLedger with the event repository', () => {
  it('records on a scheduled run the event and sport league its provider event is linked to', async () => {
    const tour = await sportLeague('Ledger Tour');
    const linked = await event(tour.id, { eventYear: 2027, startDate: days(3) });
    const ledger = new ProviderSyncRunLedger(new PrismaProviderSyncRunRepository(getAppPrisma()), undefined, new PrismaSportEventRepository(getAppPrisma()));
    const normalizedRequest = new SyncOrchestrator({ now: () => NOW }).normalizeRequest({
      source: 'SCHEDULED',
      actor: { type: 'SYSTEM', name: 'scheduler' },
      scope: { type: 'EVENT', sport: Sport.GOLF, providerId: 'balldontlie', eventId: linked.externalId, feeds: ['EVENTLIVESCORES'] },
    });

    const [run] = await ledger.createSubmissions({ normalizedRequest, providerId: 'balldontlie', submittedAt: NOW, runType: 'SCHEDULED_EVENT_SYNC', trigger: JobTrigger.SCHEDULE });

    expect(run).toMatchObject({ kind: ProviderSyncKind.SCORES, sportEventId: linked.id, sportLeagueId: tour.id });
  });
});

describe('GET /api/v1/sport-leagues/overview', () => {
  it('answers a signed-in member who is not a root admin with 403, and a root admin with 200', async () => {
    const member = await createTestUser();
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    const refused = await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues/overview', headers: member.headers });
    const answered = await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues/overview', headers: rootAdmin.headers });

    expect(refused.statusCode).toBe(403);
    expect(answered.statusCode).toBe(200);
  });
});
