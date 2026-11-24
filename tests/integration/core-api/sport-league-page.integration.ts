/**
 * The root admin's League page reads (#1865) against real Postgres, over HTTP: a sport league's
 * syncs, its events with their release, field,
 * issues and last sync, and its participants with their feed id and when a sync last saw them.
 * No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  ParticipantAddedBy,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  SportEventReleaseAtKind,
  SportEventReleaseMode,
  SportEventStatus,
  SportLeagueIssueType,
  SportLeagueSyncHealth,
  Sport,
} from '@poolmaster/shared/domain';
import {
  SportLeagueEventOverviewListResponseSchema,
  SportLeagueParticipantOverviewListResponseSchema,
  SportLeagueSyncListResponseSchema,
} from '@poolmaster/shared/dto';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, createTestUser, getApp, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { leagueProfiles } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const fromNow = (ms: number) => new Date(Date.now() + ms);

async function golfSportId(): Promise<string> {
  const sport = await getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return sport.id;
}

/** A golf league; `synced` maps it to BALLDONTLIE's PGA TOUR and selects that mapping. */
async function sportLeague(name: string, { synced = false, ...extra }: { synced?: boolean; autoReleaseDaysBeforeStart?: number } = {}) {
  const league = await getPrisma().sportLeague.create({
    data: { ...(await leagueProfiles(getPrisma())), sportId: await golfSportId(), name: `${name} ${randomUUID().slice(0, 8)}`, ...extra },
  });
  if (synced) await syncLeagueTo(getPrisma(), league.id, 'pga');
  return league;
}

async function event(sportLeagueId: string, input: { startDate: Date; status?: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' }) {
  const prisma = getPrisma();
  const series = await prisma.eventSeries.create({ data: { sportLeagueId, name: `Series ${randomUUID()}` } });
  return prisma.sportEvent.create({
    data: { eventSeriesId: series.id, eventYear: 2026, sport: Sport.GOLF, name: `Event ${randomUUID().slice(0, 8)}`, providerId: 'balldontlie', externalId: randomUUID(), syncScope: 'SCORES_ONLY', ...input },
  });
}

async function get(url: string) {
  const rootAdmin = await createTestUser({ isRootAdmin: true });
  return getApp().inject({ method: 'GET', url, headers: rootAdmin.headers });
}

describe('GET /api/v1/sport-leagues/{sportLeagueId}/syncs', () => {
  it('reports each sync by the league\'s own latest run of its kind, in kind order, a kind with no run not run yet', async () => {
    const tour = await sportLeague('Page Tour', { synced: true });
    const other = await sportLeague('Page Other Tour', { synced: true });
    const run = (sportLeagueId: string, kind: 'EVENTS' | 'FIELD' | 'SCORES', status: 'COMPLETED' | 'FAILED', createdAt: Date) => ({
      kind, trigger: 'SCHEDULE' as const, providerId: 'balldontlie', sport: Sport.GOLF, sportLeagueId, status, createdAt,
      payloadJson: { stats: { writeCreated: 2, writeUpdated: 3 } },
    });
    await getPrisma().providerSyncRun.createMany({
      data: [
        run(tour.id, 'EVENTS', 'COMPLETED', fromNow(-2 * HOUR_MS)),
        run(tour.id, 'EVENTS', 'FAILED', fromNow(-HOUR_MS)),
        run(tour.id, 'FIELD', 'COMPLETED', fromNow(-HOUR_MS)),
        // Another league's later run never stands for this league's.
        run(other.id, 'EVENTS', 'COMPLETED', fromNow(-HOUR_MS / 2)),
      ],
    });

    const response = await get(`/api/v1/sport-leagues/${tour.id}/syncs`);

    expect(response.statusCode).toBe(200);
    const { syncs } = SportLeagueSyncListResponseSchema.parse(response.json());
    expect(syncs.map((sync) => [sync.kind, sync.health, sync.lastRun?.status ?? null, sync.lastRun?.changedCount ?? null])).toEqual([
      [ProviderSyncKind.EVENTS, SportLeagueSyncHealth.ERROR, ProviderSyncRunStatus.FAILED, null],
      [ProviderSyncKind.FIELD, SportLeagueSyncHealth.OK, ProviderSyncRunStatus.COMPLETED, 5],
      [ProviderSyncKind.SCORES, SportLeagueSyncHealth.NOT_RUN_YET, null, null],
    ]);
  });

  it('answers 404 for a sport league that does not exist', async () => {
    const response = await get(`/api/v1/sport-leagues/${randomUUID()}/syncs`);

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/v1/sport-leagues/{sportLeagueId}/events/overview', () => {
  it('shows a released event\'s release time as ACTUAL and an automatic draft\'s window opening as PLANNED, with its field and last sync', async () => {
    const tour = await sportLeague('Release Page Tour', { synced: true, autoReleaseDaysBeforeStart: 5 });
    const released = await event(tour.id, { startDate: fromNow(3 * DAY_MS), status: 'DRAFT' });
    const draft = await event(tour.id, { startDate: fromNow(10 * DAY_MS), status: 'DRAFT' });
    const releasedAt = fromNow(-HOUR_MS);
    await new PrismaSportEventRepository(getAppPrisma()).transitionStatus(released.id, { from: SportEventStatus.DRAFT, to: SportEventStatus.SCHEDULED, releasedAt });
    const golfer = await getPrisma().participant.create({ data: { sportLeagueId: tour.id, name: `Page Golfer ${randomUUID().slice(0, 8)}`, participantType: 'INDIVIDUAL' } });
    await getPrisma().sportEventParticipant.create({ data: { sportEventId: released.id, participantId: golfer.id } });
    const synced = fromNow(-2 * HOUR_MS);
    await getPrisma().providerSyncRun.create({
      data: { kind: 'FIELD', trigger: 'SCHEDULE', providerId: 'balldontlie', sport: Sport.GOLF, sportLeagueId: tour.id, sportEventId: released.id, status: 'COMPLETED', createdAt: synced, payloadJson: {} },
    });

    const response = await get(`/api/v1/sport-leagues/${tour.id}/events/overview`);

    expect(response.statusCode).toBe(200);
    const { events } = SportLeagueEventOverviewListResponseSchema.parse(response.json());
    expect(events.map((row) => row.id)).toEqual([released.id, draft.id]);
    expect(events[0]).toMatchObject({
      status: SportEventStatus.SCHEDULED, releaseMode: SportEventReleaseMode.AUTO, releaseAt: releasedAt.toISOString(), releaseAtKind: SportEventReleaseAtKind.ACTUAL,
      fieldSize: 1, lastSyncedAt: synced.toISOString(), issues: [],
    });
    expect(events[1]).toMatchObject({
      status: SportEventStatus.DRAFT, releaseMode: SportEventReleaseMode.AUTO, releaseAt: new Date(draft.startDate.getTime() - 5 * DAY_MS).toISOString(), releaseAtKind: SportEventReleaseAtKind.PLANNED,
      fieldSize: null, lastSyncedAt: null,
    });
  });

  it('marks an event overdue once its last round ended more than 4 hours ago, and not one whose last round ended within 4 hours', async () => {
    const tour = await sportLeague('Overdue Page Tour', { synced: true });
    const late = await event(tour.id, { startDate: fromNow(-3 * DAY_MS), status: 'IN_PROGRESS' });
    const recent = await event(tour.id, { startDate: fromNow(-2 * DAY_MS), status: 'IN_PROGRESS' });
    const roundEnd = fromNow(-5 * HOUR_MS);
    await getPrisma().sportEventRound.createMany({
      data: [
        { sportEventId: late.id, roundNumber: 1, scheduledDate: fromNow(-3 * DAY_MS), scheduledEndAt: fromNow(-2 * DAY_MS) },
        { sportEventId: late.id, roundNumber: 2, scheduledDate: fromNow(-DAY_MS), scheduledEndAt: roundEnd },
        { sportEventId: recent.id, roundNumber: 1, scheduledDate: fromNow(-2 * DAY_MS), scheduledEndAt: fromNow(-DAY_MS) },
        { sportEventId: recent.id, roundNumber: 2, scheduledDate: fromNow(-4 * HOUR_MS), scheduledEndAt: fromNow(-HOUR_MS) },
      ],
    });

    const response = await get(`/api/v1/sport-leagues/${tour.id}/events/overview`);

    const rows = SportLeagueEventOverviewListResponseSchema.parse(response.json()).events;
    expect(rows.find((row) => row.id === late.id)?.issues).toEqual([{ type: SportLeagueIssueType.OVERDUE, count: 1, items: [expect.objectContaining({ label: late.name, occurredAt: roundEnd.toISOString() })] }]);
    expect(rows.find((row) => row.id === recent.id)?.issues).toEqual([]);
  });

  it('answers 404 for a sport league that does not exist', async () => {
    const response = await get(`/api/v1/sport-leagues/${randomUUID()}/events/overview`);

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/v1/sport-leagues/{sportLeagueId}/participants/overview', () => {
  it('names a mapped participant\'s feed id and when a sync last saw it as added by the feed, and an unmapped one as added by an admin', async () => {
    const tour = await sportLeague('Roster Page Tour');
    const prisma = getPrisma();
    const fed = await prisma.participant.create({ data: { sportLeagueId: tour.id, name: 'Alpha Golfer', participantType: 'INDIVIDUAL', ranking: 1 } });
    const typed = await prisma.participant.create({ data: { sportLeagueId: tour.id, name: 'Beta Golfer', participantType: 'INDIVIDUAL' } });
    const seenAt = fromNow(-HOUR_MS);
    await prisma.participantProviderMapping.create({ data: { participantId: fed.id, sportLeagueId: tour.id, providerId: 'balldontlie', externalId: 'bdl-7', lastSeenAt: seenAt } });

    const response = await get(`/api/v1/sport-leagues/${tour.id}/participants/overview`);

    expect(response.statusCode).toBe(200);
    expect(SportLeagueParticipantOverviewListResponseSchema.parse(response.json()).participants).toEqual([
      expect.objectContaining({ id: fed.id, ranking: 1, feedId: 'bdl-7', lastInFeedAt: seenAt.toISOString(), addedBy: ParticipantAddedBy.FEED }),
      expect.objectContaining({ id: typed.id, ranking: null, feedId: null, lastInFeedAt: null, addedBy: ParticipantAddedBy.ADMIN }),
    ]);
  });

  it('answers a signed-in member who is not a root admin with 403, and 404 for a sport league that does not exist', async () => {
    const tour = await sportLeague('Roster Page Guard');
    const member = await createTestUser();

    const refused = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${tour.id}/participants/overview`, headers: member.headers });
    const missing = await get(`/api/v1/sport-leagues/${randomUUID()}/participants/overview`);

    expect(refused.statusCode).toBe(403);
    expect(missing.statusCode).toBe(404);
  });
});
