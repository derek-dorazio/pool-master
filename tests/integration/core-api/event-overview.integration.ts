/**
 * The root admin's Event page overview (#1889) against real Postgres, over HTTP: one event's field
 * and scores syncs from its own runs, its health and issues, its release, the value its field is
 * ordered by, and each field row's feed id and when a sync last saw it, in a fixed number of
 * statements however large the field. No mocks.
 */
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  FieldOrderBasis,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  Sport,
  SportEventReleaseAtKind,
  SportEventReleaseMode,
  SportEventStatus,
  SportLeagueIssueType,
  SportLeagueSyncHealth,
} from '@poolmaster/shared/domain';
import { SportEventOverviewResponseSchema } from '@poolmaster/shared/dto';
import { syncLeagueTo } from '../../support/league-sync';
import { cleanupTestData, createTestUser, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, get, okBody, seedEventWithField } from '../list-route-seeds';
import { expectConstantQueries, measureQueryScaling } from '../query-scaling';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/**
 * The overview's whole cost, the root admin's session check included: the event; then its league,
 * its latest run of each kind, whether it is overdue (the event, its rounds and their last match
 * starts), its field and the event page offering its series; then those latest runs and the
 * field's provider mappings; and the league's sync provider, its selected mapping, provider league
 * and provider one read each (#1997). A new read, or one sent per field row, moves it.
 */
const OVERVIEW_STATEMENTS = 14;

/**
 * A draft golf event `golfers` strong in a synced tour of its own that releases a week out, each
 * golfer with odds and a provider mapping the feed last listed an hour ago, and one failed field
 * run on the event.
 */
async function seedSyncedEvent(golfers: number) {
  const prisma = getPrisma();
  const { event, field } = await seedEventWithField(golfers, { status: SportEventStatus.DRAFT, ownSportLeague: true, startsInDays: 30 });
  const { sportLeagueId } = await prisma.eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId }, select: { sportLeagueId: true } });
  await prisma.sportLeague.update({ where: { id: sportLeagueId }, data: { autoReleaseDaysBeforeStart: 7 } });
  await syncLeagueTo(prisma, sportLeagueId, 'pga');
  await prisma.sportEvent.update({ where: { id: event.id }, data: { providerId: 'balldontlie', syncScope: 'SCORES_ONLY' } });
  const seenAt = new Date(Date.now() - 60 * 60 * 1000);
  for (const [index, row] of field.entries()) {
    await prisma.sportEventParticipant.update({ where: { id: row.id }, data: { oddsToWin: 10 + index } });
    await prisma.participantProviderMapping.create({
      data: { participantId: row.participantId, sportLeagueId, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: `bdl-${randomUUID().slice(0, 8)}`, lastSeenAt: seenAt },
    });
  }
  const failedRun = await prisma.providerSyncRun.create({
    data: { kind: 'FIELD', trigger: 'SCHEDULE', providerId: BALLDONTLIE_TEST_PROVIDER_ID, sportLeagueId, sportEventId: event.id, status: 'FAILED', payloadJson: {} },
  });
  return { event, field, seenAt, failedRun, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

describe('GET /api/v1/events/{eventId}/overview', () => {
  it('reports the event\'s failed field run as ERROR with a SYNC issue, its planned automatic release, its odds order and each row\'s last time in the feed', async () => {
    const { event, field, seenAt, failedRun, rootAdmin } = await seedSyncedEvent(2);

    const response = await get(`/api/v1/events/${event.id}/overview`, rootAdmin);

    expect(response.statusCode).toBe(200);
    const { overview } = SportEventOverviewResponseSchema.parse(response.json());
    expect(overview.syncHealth).toBe(SportLeagueSyncHealth.ERROR);
    expect(overview.syncs.map((sync) => [sync.kind, sync.health, sync.lastRun?.id ?? null])).toEqual([
      [ProviderSyncKind.FIELD, SportLeagueSyncHealth.ERROR, failedRun.id],
      [ProviderSyncKind.SCORES, SportLeagueSyncHealth.NOT_RUN_YET, null],
    ]);
    expect(overview.syncs[0]?.lastRun?.status).toBe(ProviderSyncRunStatus.FAILED);
    expect(overview.issues.map((issue) => [issue.type, issue.count])).toEqual([[SportLeagueIssueType.SYNC, 1]]);
    expect(overview).toMatchObject({
      releaseMode: SportEventReleaseMode.AUTO,
      releaseAt: new Date(event.startDate.getTime() - 7 * DAY).toISOString(),
      releaseAtKind: SportEventReleaseAtKind.PLANNED,
      tierOrderBasis: FieldOrderBasis.ODDS,
      tierOrderCoversField: true,
    });
    expect(new Set(overview.fieldFeed.map((row) => row.sportEventParticipantId))).toEqual(new Set(field.map((row) => row.id)));
    expect(overview.fieldFeed.every((row) => row.feedId !== null && row.lastInFeedAt === seenAt.toISOString())).toBe(true);
  });

  it('reads an event no provider syncs as OFF with a manual release, its field in name order and no feed ids', async () => {
    const { event } = await seedEventWithField(2, { status: SportEventStatus.DRAFT });
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    const { overview } = okBody(await get(`/api/v1/events/${event.id}/overview`, rootAdmin), SportEventOverviewResponseSchema);

    expect(overview).toMatchObject({ syncHealth: SportLeagueSyncHealth.OFF, issues: [], releaseMode: SportEventReleaseMode.MANUAL, tierOrderBasis: null });
    expect(overview.fieldFeed.map((row) => [row.feedId, row.lastInFeedAt])).toEqual([[null, null], [null, null]]);
  });

  it('names the active event page offering the event\'s series, and none once that page is retired', async () => {
    const prisma = getPrisma();
    const { event } = await seedEventWithField(1, { status: SportEventStatus.DRAFT });
    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId }, select: { sportLeagueId: true, name: true } });
    const template = await prisma.contestConfigTemplate.findFirstOrThrow({ select: { id: true } });
    const urlSegment = `event-overview-${randomUUID().slice(0, 8)}`;
    const page = await prisma.eventPage.create({ data: { sport: Sport.GOLF, urlSegment, displayOrder: 9000 } });
    await prisma.eventPageOffer.create({
      data: { eventPageId: page.id, sportLeagueId: series.sportLeagueId, eventSeriesName: series.name, templateId: template.id, sortOrder: 1, isPrimary: true },
    });
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    try {
      const offered = okBody(await get(`/api/v1/events/${event.id}/overview`, rootAdmin), SportEventOverviewResponseSchema);
      await prisma.eventPage.update({ where: { id: page.id }, data: { isActive: false } });
      const retired = okBody(await get(`/api/v1/events/${event.id}/overview`, rootAdmin), SportEventOverviewResponseSchema);

      expect([offered.overview.eventPagePath, retired.overview.eventPagePath]).toEqual([`/play/golf/${urlSegment}`, null]);
    } finally {
      await prisma.eventPage.delete({ where: { id: page.id } });
    }
  });

  it('refuses anyone but a root admin with 403, and an unknown event with 404', async () => {
    const { event } = await seedEventWithField(0);
    const member = await createTestUser();
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    expect((await get(`/api/v1/events/${event.id}/overview`, member)).statusCode).toBe(403);
    expect((await get(`/api/v1/events/${randomUUID()}/overview`, rootAdmin)).statusCode).toBe(404);
  });

  it('costs the same statements for a field of 2 as for a field of 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}/overview',
      seed: seedSyncedEvent,
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}/overview`, rootAdmin),
      rowsShown: (response) => okBody(response, SportEventOverviewResponseSchema).overview.fieldFeed.length,
    });
  });

  it('sends exactly 14 statements, the session check included and the league\'s selected mapping, provider league and provider one read each, for a field of 2 and of 20 alike', async () => {
    const { small, large } = await measureQueryScaling({
      seed: seedSyncedEvent,
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}/overview`, rootAdmin),
      rowsShown: (response) => okBody(response, SportEventOverviewResponseSchema).overview.fieldFeed.length,
    });

    expect([small.length, large.length]).toEqual([OVERVIEW_STATEMENTS, OVERVIEW_STATEMENTS]);
  });
});
