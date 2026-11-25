import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
/**
 * The root admin's sport league overview (#1847) against real Postgres: what the reader gathers
 * for each sport league, that a sport event keeps its latest automatic release check, and that a
 * scheduled sync run records the event and sport league its provider event is linked to. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { AutoReleaseCheckOutcome, JobTrigger, ProviderSyncKind, ProviderSyncRunStatus, ReleaseCheckKey, Sport } from '@poolmaster/shared/domain';
import { PrismaProviderSyncRunRepository, PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { PrismaSportLeagueOverviewReader } from '../../../packages/core-api/src/adapters/prisma-sport-league-overview-reader';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { cleanupTestData, createTestUser, getApp, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { findUnindexedScans } from '../index-check';
import { recordStatements } from '../statement-log';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';
import { sportRowKeys } from '../../support/sport-rows';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';

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
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return sport.id;
}

/** A golf league; `synced` maps it to BALLDONTLIE's PGA TOUR and selects that mapping. */
async function sportLeague(name: string, { synced = false }: { synced?: boolean } = {}) {
  const league = await getPrisma().sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(getPrisma())), ...sportPlay(Sport.GOLF), sportId: await golfSportId(), name: `${name} ${randomUUID().slice(0, 8)}` },
  });
  if (synced) await syncLeagueTo(getPrisma(), league.id, 'pga');
  return league;
}

async function event(sportLeagueId: string, { championshipYear, ...input }: { championshipYear: number; startDate: Date; endDate?: Date; status?: 'DRAFT' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' }) {
  const prisma = getPrisma();
  const series = await prisma.eventSeries.create({ data: { sportLeagueId, name: `Series ${randomUUID()}` } });
  const sportLeagueSeasonId = await fixtureSeasonId(prisma, sportLeagueId, championshipYear);
  return prisma.sportEvent.create({
    data: { eventSeriesId: series.id, sportLeagueSeasonId, name: `Event ${randomUUID().slice(0, 8)}`, providerId: 'balldontlie', externalId: randomUUID(), ...input },
  });
}

describe('PrismaSportLeagueOverviewReader', () => {
  it('gathers each sport league\'s latest run per sync kind, held drafts, the current Season\'s span and next start', async () => {
    const prisma = getPrisma();
    const tour = await sportLeague('Overview Tour', { synced: true });
    const other = await sportLeague('No Season Tour');
    await getPrisma().sportLeague.update({ where: { id: tour.id }, data: { currentSeasonId: await fixtureSeasonId(prisma, tour.id, 2027) } });
    const currentSeason = await prisma.sportLeagueSeason.findFirstOrThrow({ where: { sportLeagueId: tour.id, championshipYear: 2027 } });
    await event(tour.id, { championshipYear: 2026, startDate: days(-200), endDate: days(-196), status: 'COMPLETED' });
    await event(tour.id, { championshipYear: 2027, startDate: days(-20), endDate: days(-17), status: 'COMPLETED' });
    const next = await event(tour.id, { championshipYear: 2027, startDate: days(10), endDate: days(13) });
    // Another series starting at the same time keeps the same next start.
    await event(tour.id, { championshipYear: 2027, startDate: days(10), endDate: days(12) });
    await event(tour.id, { championshipYear: 2027, startDate: days(5), status: 'CANCELLED' });
    const held = await event(tour.id, { championshipYear: 2027, startDate: days(30), status: 'DRAFT' });
    await new PrismaSportEventRepository(getAppPrisma()).recordAutoReleaseCheck(held.id, { checkedAt: NOW, outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] });
    const run = (kind: 'EVENTS' | 'FIELD' | 'SCORES', status: 'COMPLETED' | 'FAILED', createdAt: Date, summary = '') => ({
      kind, trigger: 'SCHEDULE' as const, providerId: BALLDONTLIE_TEST_PROVIDER_ID, sportLeagueId: tour.id, status, createdAt, summary,
    });
    await prisma.providerSyncRun.createMany({
      data: [
        run('EVENTS', 'COMPLETED', days(-2)),
        run('EVENTS', 'FAILED', days(-1), 'Interrupted before it finished.'),
        run('FIELD', 'FAILED', days(-3)),
        // An empty summary reads as none.
        run('FIELD', 'COMPLETED', days(-1)),
        // Two runs in the same instant, neither with a summary: one is the latest.
        run('SCORES', 'COMPLETED', days(-1)),
        run('SCORES', 'COMPLETED', days(-1)),
      ],
    });

    const { result: facts, statements } = await recordStatements(() => new PrismaSportLeagueOverviewReader(getAppPrisma()).readFacts(NOW));

    expect(facts.leagues).toEqual(expect.arrayContaining([
      { id: tour.id, sport: Sport.GOLF, sportUrlSegment: 'golf', sportDisplayOrder: 5, name: tour.name, syncProviderId: 'balldontlie', syncProviderName: 'BALLDONTLIE', isActive: true },
    ]));
    expect(facts.latestSyncRuns.filter((latest) => latest.sportLeagueId === tour.id).sort((left, right) => left.kind.localeCompare(right.kind))).toEqual([
      expect.objectContaining({ kind: ProviderSyncKind.EVENTS, status: ProviderSyncRunStatus.FAILED, summary: 'Interrupted before it finished.' }),
      expect.objectContaining({ kind: ProviderSyncKind.FIELD, status: ProviderSyncRunStatus.COMPLETED, summary: null }),
      expect.objectContaining({ kind: ProviderSyncKind.SCORES, status: ProviderSyncRunStatus.COMPLETED, summary: null }),
    ]);
    expect(facts.heldEvents).toEqual([{ id: held.id, sportLeagueId: tour.id, name: held.name, checkedAt: NOW, failedChecks: [ReleaseCheckKey.TIERS_ASSIGNED] }]);
    expect(facts.eventCounts.get(tour.id)).toBe(6);
    // The season is the current Season's own span, set by migration, not one drawn from its events (#2003).
    expect(facts.currentSeasonSpans.get(tour.id)).toEqual({ start: currentSeason.startsAt, end: currentSeason.endsAt });
    expect(facts.currentSeasonSpans.has(other.id)).toBe(false);
    // The cancelled event is not the next start.
    expect(facts.nextEventStarts.get(tour.id)).toEqual(next.startDate);
    await expect(findUnindexedScans(getPrisma(), statements.map(({ sql }) => ({ sql, test: 'PrismaSportLeagueOverviewReader.readFacts' })))).resolves.toEqual([]);
  });

  it('reads no sync runs at all when no run names a sport league', async () => {
    await sportLeague('Quiet Tour');

    const facts = await new PrismaSportLeagueOverviewReader(getAppPrisma()).readFacts(NOW);

    expect(facts.latestSyncRuns).toEqual([]);
  });
});

describe('PrismaSportEventRepository.recordAutoReleaseCheck', () => {
  it('stores a held check and reads it back, overwrites it with a release, and clears it', async () => {
    const tour = await sportLeague('Release Tour');
    const draft = await event(tour.id, { championshipYear: 2027, startDate: days(3), status: 'DRAFT' });
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
    const draft = await event(tour.id, { championshipYear: 2027, startDate: days(3), status: 'DRAFT' });

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
    const linked = await event(tour.id, { championshipYear: 2027, startDate: days(3) });
    const ledger = new ProviderSyncRunLedger(new PrismaProviderSyncRunRepository(getAppPrisma()), undefined, new PrismaSportEventRepository(getAppPrisma()));
    const normalizedRequest = new SyncOrchestrator({ now: () => NOW }).normalizeRequest({
      source: 'SCHEDULED',
      actor: { type: 'SYSTEM', name: 'scheduler' },
      scope: { type: 'EVENT', sport: Sport.GOLF, providerId: 'balldontlie', eventId: linked.externalId, feeds: ['EVENTLIVESCORES'] },
    });

    const [run] = await ledger.createSubmissions({ normalizedRequest, providerId: 'balldontlie', submittedAt: NOW, trigger: JobTrigger.SCHEDULE });

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
