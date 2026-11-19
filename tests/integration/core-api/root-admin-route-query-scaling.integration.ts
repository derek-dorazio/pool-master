/**
 * #1248 — the root admin's list reads cost the same SQL statements for 2 rows as for 20: the
 * participant catalog, a participant's provider mappings, a settings group's history, the sync
 * runs and one run's diagnostics, the provider participants nobody has mapped, and a provider's
 * event catalog.
 *
 * The last two read a provider, so the case registers one whose participants and events it sets
 * per seed. `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route needs one.
 */
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';
import {
  IngestionScheduleConfigSchema,
  ParticipantListResponseSchema,
  ParticipantProviderMappingListResponseSchema,
  ProviderCatalogEventListResponseSchema,
  ProviderListResponseSchema,
  ProviderSyncRunDetailDtoSchema,
  ProviderSyncRunListResponseSchema,
  ActivityListResponseSchema,
  CustomerLeagueListResponseSchema,
  CustomerUserListResponseSchema,
  SettingsChangeListSchema,
  SettingsGroupListSchema,
  SettingsGroupSchema,
  SportLeagueEventOverviewListResponseSchema,
  SportLeagueOverviewListResponseSchema,
  SportLeagueParticipantOverviewListResponseSchema,
  SportLeagueSyncListResponseSchema,
  SystemEmailListResponseSchema,
  UnmappedProviderParticipantListResponseSchema,
} from '@poolmaster/shared/dto';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type {
  ProviderHealthStatus,
  ProviderParticipant,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { BILLING_SETTINGS } from '../../../packages/core-api/src/modules/billing/billing-settings';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { SETTINGS_GROUPS } from '../../../packages/core-api/src/modules/platform/settings-groups';
import type { SettingsGroup } from '../../../packages/core-api/src/modules/platform/settings-group';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  getProviderRegistry,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { DAY, get, okBody } from '../list-route-seeds';
import { expectConstantQueries, expectFixedQueries } from '../query-scaling';
import { leagueProfiles, STAT_POOL_TIER_PROFILE_NAME } from '../../support/league-profiles';
import { participantLeagueId } from '../../support/participant-league';

// No mocks. The providers below are the test's own catalogs, registered on the shared app.

/** A provider of one sport whose participants and events are whatever the current seed set. */
class ScalingProvider implements SportDataProvider {
  readonly sportsCovered: Sport[];
  participants: ProviderParticipant[] = [];
  events: SportEvent[] = [];

  constructor(readonly providerId: string, readonly providerName: string, sport: Sport) {
    this.sportsCovered = [sport];
  }

  async getUpcomingEvents(): Promise<SportEvent[]> {
    return this.events;
  }

  async getEventDetails(): Promise<SportEventDetail | null> {
    return null;
  }

  async getParticipants(): Promise<ProviderParticipant[]> {
    return this.participants;
  }

  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    return { category: 'GOLF', externalEventId: eventId, rounds: [] };
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { providerId: this.providerId, status: 'HEALTHY', errorRateLastHour: 0, latencyMsP95: 1 };
  }
}

const provider = new ScalingProvider('scaling-provider', 'Scaling Provider', Sport.GOLF);
/** A second provider, so the provider list shows two and a read per provider would show. */
const tennisProvider = new ScalingProvider('scaling-tennis-provider', 'Scaling Tennis Provider', Sport.TENNIS);

beforeAll(async () => {
  await setupIntegrationTests();
  getProviderRegistry().register(Sport.GOLF, provider, 'PRIMARY');
  getProviderRegistry().register(Sport.TENNIS, tennisProvider, 'PRIMARY');
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

async function golf() {
  return getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
}

/** A root admin, and `participants` golfers whose names all hold one search term no other participant has. */
async function seedParticipantsFound(participants: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const term = `scaling${randomUUID().slice(0, 8)}`;
  const sportLeagueId = await participantLeagueId(prisma, sport.id);
  await prisma.participant.createMany({
    data: Array.from({ length: participants }, (_, index) => ({
      sportLeagueId, name: `${term} Golfer ${String(index)}`, participantType: 'INDIVIDUAL' as const, status: 'ACTIVE' as const,
    })),
  });
  return { term, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A root admin, and one golfer bound to `mappings` provider identities, each from a provider of its own. */
async function seedProviderMappings(mappings: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const participant = await prisma.participant.create({
    data: { sportLeagueId: await participantLeagueId(prisma, sport.id), name: `Mapped Golfer ${suffix}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
  });
  await prisma.participantProviderMapping.createMany({
    data: Array.from({ length: mappings }, (_, index) => ({
      participantId: participant.id, sportLeagueId: participant.sportLeagueId, providerId: `provider-${suffix}-${String(index)}`, externalId: `golfer-${suffix}`,
    })),
  });
  return { participant, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A root admin, and `mappings` golfers of one sport league each bound to one feed id of a provider of their own. */
async function seedSportLeagueProviderMappings(mappings: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const providerId = `provider-${randomUUID().slice(0, 8)}`;
  const sportLeagueId = await participantLeagueId(prisma, sport.id);
  for (let index = 0; index < mappings; index += 1) {
    await prisma.participant.create({
      data: {
        sportLeagueId, name: `${providerId} Golfer ${String(index)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE',
        providerMappings: { create: { sportLeagueId, providerId, externalId: `golfer-${String(index)}` } },
      },
    });
  }
  return { providerId, sportLeagueId, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/**
 * A root admin, and `changes` saved changes to the plan settings, each by an admin of their own.
 * The history shows the newest 20, so a second seed's changes are the ones the read returns.
 */
async function seedSettingsChanges(changes: number) {
  const prisma = getPrisma();
  const value = PLAN_SETTINGS.defaults(process.env);
  for (let index = 0; index < changes; index += 1) {
    const admin = await createTestUser({ isRootAdmin: true });
    await prisma.platformRuntimeConfigHistory.create({
      data: { configKey: PLAN_SETTINGS.key, previousJson: value, newJson: value, changedById: admin.user.id },
    });
  }
  return createTestUser({ isRootAdmin: true });
}

/** A root admin, and `runs` sync runs against providers of their own, all submitted in the last hour. */
async function seedSyncRuns(runs: number) {
  const suffix = randomUUID().slice(0, 8);
  await getPrisma().providerSyncRun.createMany({
    data: Array.from({ length: runs }, (_, index) => ({
      kind: 'SCORES',
      trigger: 'SCHEDULE',
      providerId: `provider-${suffix}-${String(index)}`,
      sport: Sport.GOLF,
      status: ProviderSyncRunStatus.COMPLETED,
      payloadJson: { requestedFeed: 'EVENTPARTICIPANTS' },
    })),
  });
  return createTestUser({ isRootAdmin: true });
}

/**
 * A root admin, and a sport league with `jobs` background jobs on its Activity: half on the
 * league itself, each started by an admin of its own (#1861) and with the sync run it ran, and
 * half on one of its events.
 */
async function seedLeagueActivity(jobs: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name: `Activity Tour ${suffix}`, matchKeyword: `ACT${suffix}` } });
  const series = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Activity Open ${suffix}` } });
  const event = await prisma.sportEvent.create({
    data: {
      eventSeriesId: series.id, eventYear: 2026, name: `Activity Open ${suffix}`, sport: Sport.GOLF,
      providerId: provider.providerId, externalId: `activity-${suffix}`, startDate: new Date(Date.now() + 7 * DAY),
    },
  });
  for (let index = 0; index < jobs; index += 1) {
    const onLeague = index % 2 === 0;
    const job = await prisma.backgroundJob.create({
      data: onLeague
        ? { type: 'SYNC_LEAGUE_EVENTS', trigger: 'ADMIN', startedByUserId: (await createTestUser()).user.id, payload: { sportLeagueId: sportLeague.id, eventYears: [2026] }, sportLeagueId: sportLeague.id, status: 'SUCCEEDED', completedAt: new Date(), result: { created: index } }
        : { type: 'SETTLE_SPORT_EVENT_CONTESTS', trigger: 'SYSTEM', payload: { sportEventId: event.id, completedAt: new Date().toISOString() }, sportEventId: event.id },
    });
    if (onLeague) {
      await prisma.providerSyncRun.create({
        data: {
          kind: 'EVENTS', trigger: 'SCHEDULE', providerId: provider.providerId, sport: Sport.GOLF, sportLeagueId: sportLeague.id,
          backgroundJobId: job.id, status: ProviderSyncRunStatus.COMPLETED, payloadJson: { runType: 'LEAGUE_EVENTS_SYNC' },
        },
      });
    }
  }
  return { sportLeague, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A root admin, and one sync run whose diagnostics hold `rows` written field rows. */
async function seedSyncRunDetails(rows: number) {
  const run = await getPrisma().providerSyncRun.create({
    data: {
      kind: 'SCORES',
      trigger: 'SCHEDULE',
      providerId: provider.providerId,
      sport: Sport.GOLF,
      status: ProviderSyncRunStatus.COMPLETED,
      payloadJson: { requestedFeed: 'EVENTPARTICIPANTS' },
      detailsJson: {
        writeDiagnostics: {
          summary: { total: rows, unchanged: 0, created: rows, updated: 0, deleted: 0 },
          rows: Array.from({ length: rows }, (_, index) => ({
            id: `row-${String(index)}`, entityType: 'SportEventParticipant', disposition: 'CREATED', name: `Golfer ${String(index)}`,
          })),
        },
      },
    },
  });
  return { run, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A root admin, and a provider with `unmapped` golfers nobody has mapped, beside as many that are mapped. */
async function seedUnmappedParticipants(unmapped: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const golfer = (index: number): ProviderParticipant => ({
    externalId: `golfer-${suffix}-${String(index)}`, providerId: provider.providerId, sport: Sport.GOLF, name: `Golfer ${suffix} ${String(index)}`, active: true, metadata: {},
  });
  const mapped = Array.from({ length: unmapped }, (_, index) => golfer(index));
  provider.participants = [...mapped, ...Array.from({ length: unmapped }, (_, index) => golfer(unmapped + index))];
  const sportLeagueId = await participantLeagueId(prisma, sport.id);
  for (const participant of mapped) {
    const row = await prisma.participant.create({ data: { sportLeagueId, name: participant.name, participantType: 'INDIVIDUAL', status: 'ACTIVE' } });
    await prisma.participantProviderMapping.create({ data: { participantId: row.id, sportLeagueId, providerId: provider.providerId, externalId: participant.externalId } });
  }
  return createTestUser({ isRootAdmin: true });
}

/** A root admin, a sports league keyed to a tour, and a provider with `events` of that tour's events. */
async function seedCatalogEvents(events: number) {
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const tour = `Scaling Tour ${suffix}`;
  const sportLeague = await getPrisma().sportLeague.create({ data: { ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: tour, matchKeyword: tour } });
  provider.events = Array.from({ length: events }, (_, index) => {
    const startDate = new Date(Date.now() + (index + 1) * 7 * DAY);
    return {
      externalId: `event-${suffix}-${String(index)}`,
      providerId: provider.providerId,
      sport: Sport.GOLF,
      name: `${tour} Open ${String(index)}`,
      startDate,
      status: 'SCHEDULED' as const,
      fieldLocked: false,
      metadata: {},
    };
  });
  return { sportLeague, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/**
 * A root admin, and `leagues` synced golf sport leagues of one run, each with what every column of
 * the Sports page reads (#1847): an upcoming event with a scheduled round, a draft its automatic
 * release held, a failed event list run and a completed field run, and a Clutch Card league of its own whose event covers the upcoming event's round.
 */
async function seedSportLeagueOverviews(leagues: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  for (let index = 0; index < leagues; index += 1) {
    const name = `Overview Tour ${suffix} ${String(index)}`;
    const sportLeague = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name, matchKeyword: `OV${suffix}${String(index)}`, eventSyncProviderId: provider.providerId } });
    const series = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `${name} Open` } });
    const event = (key: string, eventYear: number, extra: Pick<Prisma.SportEventUncheckedCreateInput, 'status' | 'autoReleaseCheckedAt' | 'autoReleaseOutcome' | 'autoReleaseFailedChecks'> = {}) => prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id, eventYear, name: `${name} ${key}`, sport: Sport.GOLF,
        providerId: provider.providerId, externalId: `${suffix}-${String(index)}-${key}`, startDate: new Date(Date.now() + 7 * DAY), ...extra,
      },
    });
    const upcoming = await event('upcoming', 2026);
    await prisma.sportEventRound.create({ data: { sportEventId: upcoming.id, roundNumber: 1, scheduledDate: upcoming.startDate } });
    // Its results are overdue: in play, with its one round's scheduled end a day gone (#1865).
    const overdue = await prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id, eventYear: 2025, name: `${name} overdue`, sport: Sport.GOLF, status: 'IN_PROGRESS',
        providerId: provider.providerId, externalId: `${suffix}-${String(index)}-overdue`, startDate: new Date(Date.now() - 3 * DAY),
      },
    });
    await prisma.sportEventRound.create({ data: { sportEventId: overdue.id, roundNumber: 1, scheduledDate: overdue.startDate, scheduledEndAt: new Date(Date.now() - DAY) } });
    await event('held', 2027, {
      status: 'DRAFT', autoReleaseCheckedAt: new Date(), autoReleaseOutcome: 'HELD', autoReleaseFailedChecks: ['TIERS_ASSIGNED'],
    });
    await prisma.providerSyncRun.createMany({
      data: [
        { kind: 'EVENTS', trigger: 'SCHEDULE', providerId: provider.providerId, sport: Sport.GOLF, sportLeagueId: sportLeague.id, status: ProviderSyncRunStatus.FAILED, payloadJson: { outcome: { summary: 'Interrupted before it finished.' } } },
        { kind: 'FIELD', trigger: 'SCHEDULE', providerId: provider.providerId, sport: Sport.GOLF, sportLeagueId: sportLeague.id, status: ProviderSyncRunStatus.COMPLETED, payloadJson: {} },
      ],
    });
    const clutchCard = await prisma.sportLeague.create({
      data: { ...(await leagueProfiles(prisma, STAT_POOL_TIER_PROFILE_NAME)), sportId: sport.id, name: `${name} Clutch Card`, matchKeyword: `OVC${suffix}${String(index)}`, scoringFamily: 'COMPOSITE', parentSportLeagueId: sportLeague.id, parentRoundNumbers: [1] },
    });
    const clutchSeries = await prisma.eventSeries.create({ data: { sportLeagueId: clutchCard.id, name: `${name} Clutch Card` } });
    await prisma.sportEvent.create({
      data: {
        eventSeriesId: clutchSeries.id, eventYear: 2026, name: `${name} Clutch Card`, sport: Sport.GOLF, providerId: provider.providerId,
        externalId: `${suffix}-${String(index)}-clutch`, startDate: upcoming.startDate, parentEventId: upcoming.id, parentRoundNumbers: [1],
      },
    });
  }
  return { suffix, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/**
 * `leagues` leagues, each with a commissioner, a member and an open contest, and a root admin:
 * every row of the Customers › Leagues grid has an owner and counts to read.
 */
async function seedCustomerLeagues(leagues: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  for (let index = 0; index < leagues; index += 1) {
    const commissioner = await createTestUser({ displayName: `Owner ${suffix}${String(index)}` });
    const member = await createTestUser({ displayName: `Member ${suffix}${String(index)}` });
    const league = await prisma.league.create({
      data: { cupName: 'Customers Cup', leagueCode: `CU${suffix.toUpperCase()}${String(index)}`, name: `Customers League ${suffix} ${String(index)}` },
    });
    await prisma.leagueMembership.createMany({
      data: [
        { leagueId: league.id, userId: commissioner.user.id, role: 'COMMISSIONER', status: 'ACTIVE' },
        { leagueId: league.id, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE' },
      ],
    });
  }
  return createTestUser({ isRootAdmin: true });
}

/** `users` users, each in a league of their own, and a root admin: every Users row has leagues to read. */
async function seedCustomerUsers(users: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  for (let index = 0; index < users; index += 1) {
    const user = await createTestUser({ displayName: `Customer ${suffix}${String(index)}` });
    const league = await prisma.league.create({
      data: { cupName: 'Customers Cup', leagueCode: `CV${suffix.toUpperCase()}${String(index)}`, name: `Customer League ${suffix} ${String(index)}` },
    });
    await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: user.user.id, role: 'COMMISSIONER', status: 'ACTIVE' } });
  }
  return createTestUser({ isRootAdmin: true });
}

/** A synced sport league of its own with `events` events, each with a field, a round, a field run and, every other one, overdue results (#1865). */
async function seedLeagueEventOverviews(events: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name: `League Page Tour ${suffix}`, eventSyncProviderId: provider.providerId } });
  for (let index = 0; index < events; index += 1) {
    const series = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `League Page Open ${suffix} ${String(index)}` } });
    const overdue = index % 2 === 0;
    const startDate = new Date(Date.now() + (overdue ? -3 : 3) * DAY);
    const event = await prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id, eventYear: 2026, name: `League Page Open ${suffix} ${String(index)}`, sport: Sport.GOLF, status: overdue ? 'IN_PROGRESS' : 'DRAFT',
        providerId: provider.providerId, externalId: `${suffix}-${String(index)}`, syncScope: 'SCORES_ONLY', startDate,
        ...(!overdue && { autoReleaseCheckedAt: new Date(), autoReleaseOutcome: 'HELD', autoReleaseFailedChecks: ['TIERS_ASSIGNED'] }),
      },
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: startDate } });
    await prisma.sportEventMatch.create({ data: { sportEventId: event.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: false, scheduledDate: startDate } });
    const golfer = await prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `League Page Golfer ${suffix} ${String(index)}`, participantType: 'INDIVIDUAL' } });
    await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: golfer.id } });
    await prisma.providerSyncRun.create({
      data: { kind: 'FIELD', trigger: 'SCHEDULE', providerId: provider.providerId, sport: Sport.GOLF, sportLeagueId: sportLeague.id, sportEventId: event.id, status: ProviderSyncRunStatus.FAILED, payloadJson: {} },
    });
  }
  return { sportLeagueId: sportLeague.id, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A sport league of its own with `participants` golfers, every other one mapped to a feed id. */
async function seedLeagueParticipantOverviews(participants: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name: `League Page Roster ${suffix}` } });
  for (let index = 0; index < participants; index += 1) {
    const golfer = await prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `Roster Golfer ${suffix} ${String(index)}`, participantType: 'INDIVIDUAL', ranking: index + 1 } });
    if (index % 2 === 0) {
      await prisma.participantProviderMapping.create({ data: { participantId: golfer.id, sportLeagueId: sportLeague.id, providerId: provider.providerId, externalId: `golfer-${suffix}-${String(index)}`, lastSeenAt: new Date() } });
    }
  }
  return { sportLeagueId: sportLeague.id, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

describe('root admin reads cost the same statements for 2 rows as for 20', () => {
  it('GET the participants a search finds: the same statements for 2 golfers as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/participants/',
      seed: seedParticipantsFound,
      call: ({ term, rootAdmin }) => get(`/api/v1/participants/?q=${term}`, rootAdmin),
      rowsShown: (response) => okBody(response, ParticipantListResponseSchema).participants.length,
    });
  });

  it("GET a participant's provider mappings: the same statements for 2 mappings as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/participants/{id}/provider-mappings',
      seed: seedProviderMappings,
      call: ({ participant, rootAdmin }) => get(`/api/v1/participants/${participant.id}/provider-mappings`, rootAdmin),
      rowsShown: (response) => okBody(response, ParticipantProviderMappingListResponseSchema).providerMappings.length,
    });
  });

  it("GET a provider's feed ids for a sport league: the same statements for 2 mapped golfers as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/participants/provider-mappings',
      seed: seedSportLeagueProviderMappings,
      call: ({ providerId, sportLeagueId, rootAdmin }) => get(`/api/v1/participants/provider-mappings?providerId=${providerId}&sportLeagueId=${sportLeagueId}`, rootAdmin),
      rowsShown: (response) => okBody(response, ParticipantProviderMappingListResponseSchema).providerMappings.length,
    });
  });

  it("GET a settings group's history: the same statements for 2 changes by 2 admins as for 20 by 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/platform/settings/{key}/history',
      seed: seedSettingsChanges,
      call: (rootAdmin) => get(`/api/v1/platform/settings/${PLAN_SETTINGS.key}/history`, rootAdmin),
      rowsShown: (response) => okBody(response, SettingsChangeListSchema).changes.length,
    });
  });

  it('GET the sport league overview: the same statements for 2 leagues, each with its Clutch Card, runs, held draft and overdue event, as for 20 (#1847, #1865)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/overview',
      seed: seedSportLeagueOverviews,
      call: ({ rootAdmin }) => get('/api/v1/sport-leagues/overview', rootAdmin),
      rowsShown: (response) => {
        const rows = okBody(response, SportLeagueOverviewListResponseSchema).sportLeagues.filter((row) => row.name.startsWith('Overview Tour'));
        // Every seeded league shows what was seeded for it, so a read that skipped one would show here.
        for (const row of rows.filter((overview) => overview.kind === 'REAL')) {
          expect(row.issues.map((issue) => [issue.type, issue.count])).toEqual([['SYNC', 1], ['RELEASE', 1], ['OVERDUE', 1]]);
        }
        for (const row of rows.filter((overview) => overview.kind === 'CLUTCH_CARD')) {
          expect(row).toMatchObject({ syncHealth: 'ERROR', eventCount: 1 });
          expect(row.season).not.toBeNull();
        }
        return rows.length;
      },
    });
  });

  it('GET every league for Customers: the same statements for 2 leagues, each with an owner and a member, as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/customers/leagues',
      seed: seedCustomerLeagues,
      call: (rootAdmin) => get('/api/v1/customers/leagues', rootAdmin),
      rowsShown: (response) => {
        const { leagues } = okBody(response, CustomerLeagueListResponseSchema);
        for (const league of leagues) {
          expect(league.memberCount).toBe(2);
          expect(league.owner).not.toBeNull();
        }
        return leagues.length;
      },
    });
  });

  it('GET every user for Customers: the same statements for 2 users, each in a league, as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/customers/users',
      seed: seedCustomerUsers,
      call: (rootAdmin) => get('/api/v1/customers/users', rootAdmin),
      rowsShown: (response) => okBody(response, CustomerUserListResponseSchema).users.filter((user) => user.leagues.length === 1).length,
    });
  });

  it('GET a sport league\'s events with their release, field, issues and last sync: the same statements for 2 events as for 20 (#1865)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/events/overview',
      seed: seedLeagueEventOverviews,
      call: ({ sportLeagueId, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeagueId}/events/overview`, rootAdmin),
      rowsShown: (response) => {
        const { events } = okBody(response, SportLeagueEventOverviewListResponseSchema);
        // Every event shows what was seeded for it, so a read that skipped one would show here.
        for (const event of events) {
          expect(event.fieldSize).toBe(1);
          expect(event.lastSyncedAt).not.toBeNull();
          expect(event.issues.map((issue) => issue.type)).toEqual(event.status === 'DRAFT' ? ['SYNC', 'RELEASE'] : ['SYNC', 'OVERDUE']);
        }
        return events.length;
      },
    });
  });

  it('GET a sport league\'s participants with their feed ids: the same statements for 2 participants as for 20 (#1865)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/participants/overview',
      seed: seedLeagueParticipantOverviews,
      call: ({ sportLeagueId, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeagueId}/participants/overview`, rootAdmin),
      rowsShown: (response) => okBody(response, SportLeagueParticipantOverviewListResponseSchema).participants.length,
    });
  });

  it('GET a sport league\'s syncs: one row per sync kind, from the league with its sport and the latest run of each kind in four statements, however many runs (#1865)', async () => {
    const prisma = getPrisma();
    const sport = await golf();
    const sportLeague = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name: `League Page Syncs ${randomUUID().slice(0, 8)}`, eventSyncProviderId: provider.providerId } });
    await prisma.providerSyncRun.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        kind: (['EVENTS', 'FIELD', 'SCORES'] as const)[index % 3], trigger: 'SCHEDULE' as const, providerId: provider.providerId, sport: Sport.GOLF,
        sportLeagueId: sportLeague.id, status: ProviderSyncRunStatus.COMPLETED, createdAt: new Date(Date.now() - index * 60_000), payloadJson: {},
      })),
    });
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    await expectFixedQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/syncs',
      fixedBy: 'the sync kinds',
      call: () => get(`/api/v1/sport-leagues/${sportLeague.id}/syncs`, rootAdmin),
      rowsShown: (response) => {
        const { syncs } = okBody(response, SportLeagueSyncListResponseSchema);
        expect(syncs.map((sync) => [sync.kind, sync.health])).toEqual([['EVENTS', 'OK'], ['FIELD', 'OK'], ['SCORES', 'OK']]);
        return syncs.length;
      },
      statements: 4,
    });
  });

  it('GET the sync runs: the same statements for 2 runs as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/ingestion/sync-runs',
      seed: seedSyncRuns,
      call: (rootAdmin) => get('/api/v1/ingestion/sync-runs', rootAdmin),
      rowsShown: (response) => okBody(response, ProviderSyncRunListResponseSchema).syncRuns.length,
    });
  });

  it('GET a sport league\'s Activity: the same statements for 2 jobs, on the league and its event, as for 20, each with its sync runs and the admin who started it', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/activity/',
      seed: seedLeagueActivity,
      call: ({ sportLeague, rootAdmin }) => get(`/api/v1/activity/?sportLeagueId=${sportLeague.id}`, rootAdmin),
      rowsShown: (response) => okBody(response, ActivityListResponseSchema).jobs.length,
    });
  });

  it("GET a sync run: the same statements for 2 diagnostic rows as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/ingestion/sync-runs/{syncRunId}',
      seed: seedSyncRunDetails,
      call: ({ run, rootAdmin }) => get(`/api/v1/ingestion/sync-runs/${run.id}`, rootAdmin),
      rowsShown: (response) => okBody(response, ProviderSyncRunDetailDtoSchema).details?.writeDiagnostics?.rows.length ?? 0,
    });
  });

  it('GET the unmapped provider participants: the same statements for 2 unmapped and 2 mapped golfers as for 20 and 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/ingestion/unmapped-participants',
      seed: seedUnmappedParticipants,
      call: (rootAdmin) => get(`/api/v1/ingestion/unmapped-participants?providerId=${provider.providerId}`, rootAdmin),
      rowsShown: (response) => okBody(response, UnmappedProviderParticipantListResponseSchema).participants.length,
    });
  });

  it("GET a provider's event catalog for a sports league: the same statements for 2 events as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/ingestion/providers/{providerId}/catalog-events',
      seed: seedCatalogEvents,
      call: ({ sportLeague, rootAdmin }) => get(
        `/api/v1/ingestion/providers/${provider.providerId}/catalog-events?sport=${Sport.GOLF}&sportLeagueId=${sportLeague.id}`,
        rootAdmin,
      ),
      rowsShown: (response) => okBody(response, ProviderCatalogEventListResponseSchema).events.length,
    });
  });
});

/** Saves the group's defaults as its value, as `admin`, so the group names who last saved it. */
async function saveSettings<T>(group: SettingsGroup<T>) {
  const admin = await createTestUser({ isRootAdmin: true });
  const response = await getApp().inject({
    method: 'PUT',
    url: `/api/v1/platform/settings/${group.key}`,
    headers: admin.headers,
    payload: { key: group.key, value: group.defaults(process.env), expectedUpdatedAt: null },
  });
  expect(response.statusCode).toBe(200);
}

describe('fixed-length root admin lists cost the same statements every time', () => {
  it('GET the settings groups: one row per group, with the admins who saved them read in one query', async () => {
    await saveSettings(PLAN_SETTINGS);
    await saveSettings(BILLING_SETTINGS);
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    await expectFixedQueries({
      route: 'GET /api/v1/platform/settings',
      fixedBy: 'the settings groups',
      call: () => get('/api/v1/platform/settings', rootAdmin),
      rowsShown: (response) => {
        const { groups } = okBody(response, SettingsGroupListSchema);
        expect(groups).toHaveLength(SETTINGS_GROUPS.length);
        expect(groups.filter((group) => group.updatedBy !== null)).toHaveLength(2);
        return groups.length;
      },
      statements: 1,
    });
  });

  it('GET one settings group: its value, with the admin who saved it read in one query', async () => {
    await saveSettings(PLAN_SETTINGS);
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    await expectFixedQueries({
      route: 'GET /api/v1/platform/settings/{key}',
      fixedBy: 'the plan caps its value lists',
      call: () => get(`/api/v1/platform/settings/${PLAN_SETTINGS.key}`, rootAdmin),
      rowsShown: (response) => {
        const group = okBody(response, SettingsGroupSchema);
        expect(group.updatedBy).not.toBeNull();
        if (group.key !== 'PLAN_CONFIG') throw new Error(`Read ${group.key} instead of the plan settings.`);
        return Object.keys(group.value.caps).length;
      },
      statements: 1,
    });
  });

  it('GET the ingestion schedule: every sport\'s schedule from the settings in memory, with no query', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    await expectFixedQueries({
      route: 'GET /api/v1/platform/ingestion-schedule',
      fixedBy: 'the supported sports',
      call: () => get('/api/v1/platform/ingestion-schedule', rootAdmin),
      rowsShown: (response) => okBody(response, IngestionScheduleConfigSchema).scheduledSports.length,
      statements: 0,
    });
  });

  it('GET the system emails: one row per email key, with the 30-day sends counted and dated in two grouped queries (#1870)', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    await expectFixedQueries({
      route: 'GET /api/v1/platform/emails/',
      fixedBy: 'the system email template keys',
      call: () => get('/api/v1/platform/emails/', rootAdmin),
      rowsShown: (response) => okBody(response, SystemEmailListResponseSchema).emails.length,
      statements: 2,
    });
  });

  it('GET the providers: one row per registered provider, with their events counted and dated in one grouped query each, and their synced sport leagues read in one more', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    await expectFixedQueries({
      route: 'GET /api/v1/ingestion/providers',
      fixedBy: 'the providers registered at startup',
      call: () => get('/api/v1/ingestion/providers', rootAdmin),
      rowsShown: (response) => {
        const { providers } = okBody(response, ProviderListResponseSchema);
        expect(providers.map((summary) => summary.providerId)).toEqual([provider.providerId, tennisProvider.providerId]);
        return providers.length;
      },
      statements: 3,
    });
  });
});
