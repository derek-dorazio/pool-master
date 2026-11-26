/**
 * #1248 — the root admin's list reads cost the same SQL statements for 2 rows as for 20: the
 * participant catalog, a participant's provider mappings, a settings group's history, the sync
 * runs and one run's diagnostics, the sync findings (#1999), and a provider's event catalog.
 *
 * Some read a provider, so the case registers one whose participants and events it sets
 * per seed. `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route needs one.
 */
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  ProviderCode,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
  ProviderSyncRunStatus,
  Sport,
} from '@poolmaster/shared/domain';
import {
  IngestionScheduleConfigSchema,
  ParticipantListResponseSchema,
  ParticipantProviderMappingListResponseSchema,
  ProviderListResponseSchema,
  ProviderSyncFindingListResponseSchema,
  ProviderSyncFindingResponseSchema,
  ProviderSyncFindingSlotChoiceListResponseSchema,
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
  SportLeaguePositionListResponseSchema,
  SportLeagueSyncListResponseSchema,
  SystemEmailListResponseSchema,
  SportLeagueStructureResponseSchema,
} from '@poolmaster/shared/dto';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type {
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
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { SYNCED_PROVIDER_ID, syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { nameSlotDefinitionFor } from '../../support/sync-slots';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { fixtureSeasonId, mapEventToProvider, withCurrentSeason } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';

// No mocks. The providers below are the test's own catalogs, registered on the shared app.

/** A provider whose participants and events are whatever the current seed set. */
class ScalingProvider implements SportDataProvider {
  participants: ProviderParticipant[] = [];
  events: SportEvent[] = [];

  constructor(readonly providerId: string, readonly providerName: string, readonly providerCode: ProviderCode) {}

  servesLeague(): boolean {
    return true;
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
}

// BALLDONTLIE's id, so the leagues synced from its seeded Provider row read as this provider's (#1997).
const provider = new ScalingProvider(SYNCED_PROVIDER_ID, 'BALLDONTLIE', ProviderCode.BALLDONTLIE);
/** A second provider, so the provider list shows two and a read per provider would show. */
const tennisProvider = new ScalingProvider('scaling-tennis-provider', 'Scaling Tennis Provider', 'SCALING_FEED' as ProviderCode);

beforeAll(async () => {
  await setupIntegrationTests();
  getProviderRegistry().register(provider);
  getProviderRegistry().register(tennisProvider);
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

async function golf() {
  return getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
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
      participantId: participant.id, sportLeagueId: participant.sportLeagueId, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: `golfer-${suffix}-${String(index)}`,
    })),
  });
  return { participant, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A root admin, and `mappings` golfers of one sport league each bound to one BALLDONTLIE feed id. */
async function seedSportLeagueProviderMappings(mappings: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const providerId = BALLDONTLIE_TEST_PROVIDER_ID;
  const suffix = randomUUID().slice(0, 8);
  const sportLeagueId = await participantLeagueId(prisma, sport.id);
  for (let index = 0; index < mappings; index += 1) {
    await prisma.participant.create({
      data: {
        sportLeagueId, name: `${suffix} Golfer ${String(index)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE',
        providerMappings: { create: { sportLeagueId, providerId, participantType: 'INDIVIDUAL', externalId: `golfer-${suffix}-${String(index)}` } },
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

/** A root admin, and `runs` BALLDONTLIE sync runs, all submitted in the last hour. */
async function seedSyncRuns(runs: number) {
  await getPrisma().providerSyncRun.createMany({
    data: Array.from({ length: runs }, () => ({
      kind: 'SCORES',
      trigger: 'SCHEDULE',
      providerId: BALLDONTLIE_TEST_PROVIDER_ID,
      status: ProviderSyncRunStatus.COMPLETED,
      summary: 'Completed event participants sync.',
    })),
  });
  return createTestUser({ isRootAdmin: true });
}

/**
 * A root admin, and a sport league with `jobs` background jobs on its Activity: half on the
 * league itself, each started by an admin of its own (#1861) and with the sync run it ran, and
 * half each on an event of its own, so every job's league and event names are read (#1887).
 */
async function seedLeagueActivity(jobs: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Activity Tour ${suffix}` } });
  for (let index = 0; index < jobs; index += 1) {
    const onLeague = index % 2 === 0;
    const event = onLeague ? null : await prisma.sportEvent.create({
      data: {
        sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2026 + index), name: `Activity Open ${suffix} ${String(index)}`,
        startDate: new Date(Date.now() + 7 * DAY),
      },
    });
    const job = await prisma.backgroundJob.create({
      data: event === null
        ? { type: 'SYNC_LEAGUE_EVENTS', trigger: 'ADMIN', startedByUserId: (await createTestUser()).user.id, payload: { sportLeagueId: sportLeague.id }, sportLeagueId: sportLeague.id, status: 'SUCCEEDED', completedAt: new Date(), result: { created: index } }
        : { type: 'SETTLE_SPORT_EVENT_CONTESTS', trigger: 'SYSTEM', payload: { sportEventId: event.id, completedAt: new Date().toISOString() }, sportEventId: event.id },
    });
    if (onLeague) {
      await prisma.providerSyncRun.create({
        data: {
          kind: 'EVENTS', trigger: 'SCHEDULE', providerId: BALLDONTLIE_TEST_PROVIDER_ID, sportLeagueId: sportLeague.id,
          backgroundJobId: job.id, status: ProviderSyncRunStatus.COMPLETED, summary: 'Synced the league\'s events.',
        },
      });
    }
  }
  return { sportLeague, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/**
 * Rate-limited jobs on both providers: one failed on a sport league the golf provider syncs, and one waiting to retry tomorrow on an event of each provider, so the provider list reads their
 * events, all at once.
 */
async function seedRateLimitedJobs() {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Limited Tour ${suffix}` },
  });
  await syncLeagueTo(prisma, sportLeague.id, 'pga');
  const events = await Promise.all([provider, tennisProvider].map(async (owner) => prisma.sportEvent.create({
    data: {
      sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2026), name: `Limited ${owner.providerName} ${suffix}`,
      startDate: new Date(Date.now() + 7 * DAY),
    },
  })));
  // The BALLDONTLIE event has its provider's id (#2004), so its job is BALLDONTLIE's. The tennis
  // provider has no Provider row, so its event can hold no provider id and its job counts for none.
  await mapEventToProvider(prisma, events[0].id, { providerId: provider.providerId, externalId: `limited-${suffix}` });
  await prisma.backgroundJob.createMany({
    data: [
      {
        type: 'SYNC_LEAGUE_EVENTS' as const, trigger: 'SYSTEM' as const, payload: { sportLeagueId: sportLeague.id },
        sportLeagueId: sportLeague.id, status: 'FAILED' as const, errorType: 'RATE_LIMITED' as const, completedAt: new Date(),
      },
      ...events.map((event) => ({
        type: 'SETTLE_SPORT_EVENT_CONTESTS' as const, trigger: 'SYSTEM' as const, payload: { sportEventId: event.id, completedAt: new Date().toISOString() },
        sportEventId: event.id, status: 'QUEUED' as const, errorType: 'RATE_LIMITED' as const, startedAt: new Date(), runAt: new Date(Date.now() + DAY),
      })),
    ],
  });
}

/** A root admin, and one sync run whose diagnostics hold `rows` written field rows. */
async function seedSyncRunDetails(rows: number) {
  const run = await getPrisma().providerSyncRun.create({
    data: {
      kind: 'SCORES',
      trigger: 'SCHEDULE',
      providerId: BALLDONTLIE_TEST_PROVIDER_ID,
      status: ProviderSyncRunStatus.COMPLETED,
      summary: 'Completed event participants sync.',
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

/**
 * A root admin, and `findings` sync findings, each on its own league and event, from the BALLDONTLIE
 * Provider row, and waived by its own admin, so every relation the list shows differs per row.
 */
async function seedSyncFindings(findings: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const providerRow = await prisma.provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE } });
  for (let index = 0; index < findings; index += 1) {
    const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Findings Tour ${suffix} ${String(index)}` } });
    const event = await prisma.sportEvent.create({
      data: { sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2026), name: `Findings Open ${suffix} ${String(index)}`,
        startDate: new Date(Date.now() + 7 * DAY) },
    });
    const changer = await createTestUser({ isRootAdmin: true });
    await prisma.providerSyncFinding.create({
      data: {
        kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT, severity: ProviderSyncFindingSeverity.WARNING, status: ProviderSyncFindingStatus.WAIVED,
        sportLeagueId: sportLeague.id, sportEventId: event.id, providerId: providerRow.id, providerValue: `golfer-${suffix}-${String(index)}`,
        waiveNote: 'An amateur the feed lists', statusChangedByUserId: changer.user.id,
        firstSeenAt: new Date(), lastSeenAt: new Date(), statusChangedAt: new Date(),
      },
    });
  }
  return createTestUser({ isRootAdmin: true });
}

/**
 * A root admin and a golf tour synced from the PGA TOUR with `slots` name-matched tournament slots,
 * two patterns each, and the OPEN SLOT_NAME_UNMATCHED finding whose "link to existing" offers them.
 */
async function seedSlotNameChoices(slots: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Name Tour ${randomUUID().slice(0, 8)}` } });
  const sportLeagueProviderMappingId = await syncLeagueTo(prisma, sportLeague.id, 'pga');
  const [seasonId] = await syncSeasonsTo(prisma, sportLeague.id, sportLeagueProviderMappingId, [2027]);
  for (let index = 0; index < slots; index += 1) {
    const slotDefinitionId = await nameSlotDefinitionFor(prisma, { sportLeagueId: sportLeague.id, sportLeagueProviderMappingId, pattern: `open ${String(index)}`, seasonIds: [seasonId], covered: false });
    await prisma.sportLeagueCompetitionSlotProviderMapping.create({ data: { sportLeagueId: sportLeague.id, sportLeagueCompetitionSlotId: slotDefinitionId, sportLeagueProviderMappingId, matchType: 'NAME_PATTERN', providerValue: `the open ${String(index)}` } });
  }
  const providerRow = await prisma.provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE } });
  const finding = await prisma.providerSyncFinding.create({
    data: {
      kind: ProviderSyncFindingKind.SLOT_NAME_UNMATCHED, severity: ProviderSyncFindingSeverity.INFO, sportLeagueId: sportLeague.id, providerId: providerRow.id,
      providerValue: 'the new open', providerValueName: 'The New Open', firstSeenAt: new Date(), lastSeenAt: new Date(), statusChangedAt: new Date(),
    },
  });
  return { finding, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/**
 * A root admin, and `leagues` synced golf sport leagues of one run, each with what every column of
 * the Sports page reads (#1847): an upcoming event with a scheduled round, a draft its automatic
 * release held, a failed event list run and a completed field run.
 */
async function seedSportLeagueOverviews(leagues: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  for (let index = 0; index < leagues; index += 1) {
    const name = `Overview Tour ${suffix} ${String(index)}`;
    const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name } });
    await syncLeagueTo(prisma, sportLeague.id, 'pga');
    // Its current Season gives the row its season (#2003).
    await withCurrentSeason(prisma, sportLeague.id, 2026);
    const event = async (key: string, eventYear: number, extra: Pick<Prisma.SportEventUncheckedCreateInput, 'status' | 'autoReleaseCheckedAt' | 'autoReleaseOutcome' | 'autoReleaseFailedChecks'> = {}) => prisma.sportEvent.create({
      data: {
        sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, eventYear), name: `${name} ${key}`,
        startDate: new Date(Date.now() + 7 * DAY), ...extra,
      },
    });
    const upcoming = await event('upcoming', 2026);
    await prisma.sportEventRound.create({ data: { sportEventId: upcoming.id, roundNumber: 1, scheduledDate: upcoming.startDate } });
    // Its results are overdue: in play, with its one round's scheduled end a day gone (#1865).
    const overdue = await prisma.sportEvent.create({
      data: {
        sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2025), name: `${name} overdue`, status: 'IN_PROGRESS',
        startDate: new Date(Date.now() - 3 * DAY),
      },
    });
    await prisma.sportEventRound.create({ data: { sportEventId: overdue.id, roundNumber: 1, scheduledDate: overdue.startDate, scheduledEndAt: new Date(Date.now() - DAY) } });
    await event('held', 2027, {
      status: 'DRAFT', autoReleaseCheckedAt: new Date(), autoReleaseOutcome: 'HELD', autoReleaseFailedChecks: ['TIERS_ASSIGNED'],
    });
    await prisma.providerSyncRun.createMany({
      data: [
        { kind: 'EVENTS', trigger: 'SCHEDULE', providerId: BALLDONTLIE_TEST_PROVIDER_ID, sportLeagueId: sportLeague.id, status: ProviderSyncRunStatus.FAILED, summary: 'Interrupted before it finished.', errorCount: 1 },
        { kind: 'FIELD', trigger: 'SCHEDULE', providerId: BALLDONTLIE_TEST_PROVIDER_ID, sportLeagueId: sportLeague.id, status: ProviderSyncRunStatus.COMPLETED },
      ],
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
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `League Page Tour ${suffix}` } });
  await syncLeagueTo(prisma, sportLeague.id, 'pga');
  for (let index = 0; index < events; index += 1) {
    const overdue = index % 2 === 0;
    const startDate = new Date(Date.now() + (overdue ? -3 : 3) * DAY);
    const event = await prisma.sportEvent.create({
      data: {
        sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2026), name: `League Page Open ${suffix} ${String(index)}`, status: overdue ? 'IN_PROGRESS' : 'DRAFT',
        startDate,
        ...(!overdue && { autoReleaseCheckedAt: new Date(), autoReleaseOutcome: 'HELD', autoReleaseFailedChecks: ['TIERS_ASSIGNED'] }),
      },
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: startDate } });
    await prisma.sportEventRoundMatch.create({ data: { sportEventId: event.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: false, scheduledDate: startDate } });
    const golfer = await prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `League Page Golfer ${suffix} ${String(index)}`, participantType: 'INDIVIDUAL' } });
    await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: golfer.id } });
    await prisma.providerSyncRun.create({
      data: { kind: 'FIELD', trigger: 'SCHEDULE', providerId: BALLDONTLIE_TEST_PROVIDER_ID, sportLeagueId: sportLeague.id, sportEventId: event.id, status: ProviderSyncRunStatus.FAILED },
    });
  }
  return { sportLeagueId: sportLeague.id, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A sport league of its own with `participants` golfers, every other one mapped to a feed id. */
async function seedLeagueParticipantOverviews(participants: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `League Page Roster ${suffix}` } });
  for (let index = 0; index < participants; index += 1) {
    const golfer = await prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `Roster Golfer ${suffix} ${String(index)}`, participantType: 'INDIVIDUAL', ranking: index + 1 } });
    if (index % 2 === 0) {
      await prisma.participantProviderMapping.create({ data: { participantId: golfer.id, sportLeagueId: sportLeague.id, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: `golfer-${suffix}-${String(index)}`, lastSeenAt: new Date() } });
    }
  }
  return { sportLeagueId: sportLeague.id, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A sport league of `positions` positions, each named by two provider codes on the league's mapping. */
async function seedLeaguePositions(positions: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `League Page Positions ${randomUUID().slice(0, 8)}` } });
  const mappingId = await syncLeagueTo(prisma, sportLeague.id, 'pga');
  for (let index = 0; index < positions; index += 1) {
    const position = await prisma.sportLeaguePosition.create({ data: { sportLeagueId: sportLeague.id, code: `P${String(index)}`, displayOrder: index + 1, isFieldEligible: index % 2 === 0 } });
    await prisma.sportLeaguePositionProviderMapping.createMany({
      data: ['A', 'B'].map((letter) => ({ sportLeagueId: sportLeague.id, sportLeaguePositionId: position.id, sportLeagueProviderMappingId: mappingId, providerCode: `${letter}${String(index)}` })),
    });
  }
  return { sportLeagueId: sportLeague.id, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/**
 * A basketball league of its own with a regular phase's one competition of `slots` weeks, each matched to its
 * provider by calendar week (#2002).
 */
async function seedLeagueStructure(slots: number) {
  const prisma = getPrisma();
  const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.BASKETBALL }, select: { id: true } });
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.BASKETBALL), sportId: sport.id, name: `League Page Structure ${randomUUID().slice(0, 8)}` } });
  const mappingId = await syncLeagueTo(prisma, sportLeague.id, 'nba');
  const phase = await prisma.sportLeaguePhase.create({ data: { sportLeagueId: sportLeague.id, phase: 'REGULAR', isSynced: true } });
  const competition = await prisma.sportLeagueCompetition.create({ data: { sportLeagueId: sportLeague.id, sportLeaguePhaseId: phase.id, code: 'REGULAR', orderIndex: 1 } });
  for (let week = 1; week <= slots; week += 1) {
    await prisma.sportLeagueCompetitionSlot.create({
      data: {
        sportLeagueId: sportLeague.id, sportLeagueCompetitionId: competition.id, key: `WEEK_${String(week)}`, slotKind: 'WEEK', weekNumber: week,
        awardsTrophy: false, squaresEligible: true, seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
        matchFormat: 'HEAD_TO_HEAD', canEndTied: false, periodUnit: 'QUARTER', periodCount: 4,
        providerMappings: { create: { sportLeagueProviderMappingId: mappingId, matchType: 'CALENDAR_WEEK' } },
      },
    });
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

  it('GET the sport league overview: the same statements for 2 leagues, each with its runs, held draft and overdue event, as for 20 (#1847, #1865)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/overview',
      seed: seedSportLeagueOverviews,
      call: ({ rootAdmin }) => get('/api/v1/sport-leagues/overview', rootAdmin),
      rowsShown: (response) => {
        const rows = okBody(response, SportLeagueOverviewListResponseSchema).sportLeagues.filter((row) => row.name.startsWith('Overview Tour'));
        // Every seeded league shows what was seeded for it, so a read that skipped one would show here.
        for (const row of rows) {
          expect(row.issues.map((issue) => [issue.type, issue.count])).toEqual([['SYNC', 1], ['RELEASE', 1], ['OVERDUE', 1]]);
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

  it('GET a sport league\'s positions with their provider codes: the same statements for 2 positions as for 20 (#2001)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/positions',
      seed: seedLeaguePositions,
      call: ({ sportLeagueId, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeagueId}/positions`, rootAdmin),
      rowsShown: (response) => {
        const { positions } = okBody(response, SportLeaguePositionListResponseSchema);
        // Every position shows both its codes, so a read that dropped the codes would show here.
        for (const position of positions) expect(position.providerCodes).toHaveLength(2);
        return positions.length;
      },
    });
  });

  it('GET a sport league\'s structure with each slot\'s provider mappings: the same statements for 2 slots as for 20 (#2002)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/structure',
      seed: seedLeagueStructure,
      call: ({ sportLeagueId, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeagueId}/structure`, rootAdmin),
      rowsShown: (response) => okBody(response, SportLeagueStructureResponseSchema).phases
        .flatMap((phase) => phase.competitions)
        .flatMap((competition) => competition.slots)
        .filter((slot) => slot.providerMappings.length === 1).length,
    });
  });

  it('GET a sport league\'s syncs: one row per sync kind, from the league with its sport and its sync provider (its selected mapping, provider league and provider, one read each, #1997), its tier profile\'s sources (two reads, #2160) and the latest run of each kind in nine statements, however many runs (#1865)', async () => {
    const prisma = getPrisma();
    const sport = await golf();
    const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `League Page Syncs ${randomUUID().slice(0, 8)}` } });
    await syncLeagueTo(prisma, sportLeague.id, 'pga');
    await prisma.providerSyncRun.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        kind: (['EVENTS', 'FIELD', 'SCORES'] as const)[index % 3], trigger: 'SCHEDULE' as const, providerId: BALLDONTLIE_TEST_PROVIDER_ID, 
        sportLeagueId: sportLeague.id, status: ProviderSyncRunStatus.COMPLETED, createdAt: new Date(Date.now() - index * 60_000),
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
      statements: 9,
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

  it('GET a sport league\'s Activity: the same statements for 2 jobs, on the league and its events, as for 20, each with its sync runs, the admin who started it and its league and event names', async () => {
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

  it('GET the sync findings: the same statements for 2 findings as for 20, each with its league and sport, event, Provider and the admin who set its status', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/ingestion/sync-findings/',
      seed: seedSyncFindings,
      call: (rootAdmin) => get('/api/v1/ingestion/sync-findings/', rootAdmin),
      rowsShown: (response) => okBody(response, ProviderSyncFindingListResponseSchema).findings.length,
    });
  });

  it('GET a tournament-name finding\'s slot choices: the same statements for 2 slots as for 20, each with its patterns', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/ingestion/sync-findings/{findingId}/slot-choices',
      seed: seedSlotNameChoices,
      call: ({ finding, rootAdmin }) => get(`/api/v1/ingestion/sync-findings/${finding.id}/slot-choices`, rootAdmin),
      rowsShown: (response) => okBody(response, ProviderSyncFindingSlotChoiceListResponseSchema).slots.filter((slot) => slot.patterns.length === 2).length,
    });
  });

  it('GET one sync finding: its actions are fixed by its kind and status, read with its league, sport, event, Provider and changer, one statement each', async () => {
    const rootAdmin = await seedSyncFindings(1);
    const finding = await getPrisma().providerSyncFinding.update({
      where: { id: (await getPrisma().providerSyncFinding.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).id },
      data: { status: ProviderSyncFindingStatus.OPEN, waiveNote: null },
    });

    await expectFixedQueries({
      route: 'GET /api/v1/ingestion/sync-findings/{findingId}',
      fixedBy: 'the actions an OPEN unmapped participant offers',
      call: () => get(`/api/v1/ingestion/sync-findings/${finding.id}`, rootAdmin),
      rowsShown: (response) => okBody(response, ProviderSyncFindingResponseSchema).finding.actions.length,
      statements: 6,
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

  it('GET the ingestion schedule: every sync kind\'s policy from the settings in memory, with no query', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    await expectFixedQueries({
      route: 'GET /api/v1/platform/ingestion-schedule',
      fixedBy: 'the sync kinds',
      call: () => get('/api/v1/platform/ingestion-schedule', rootAdmin),
      rowsShown: (response) => Object.keys(okBody(response, IngestionScheduleConfigSchema)).length,
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

  it('GET the providers: one row per registered provider, with their events counted and dated in one grouped query each, their synced sport leagues read in one more with the provider each syncs from (its selected mapping, provider league and provider, one read each, #1997), and their rate-limited jobs counted in one grouped query, with their events read once for all of them, and their sync runs of the last hour counted in one grouped query for their health (#1999, no live provider call), without the rest of each row', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    await seedRateLimitedJobs();
    await expectFixedQueries({
      route: 'GET /api/v1/ingestion/providers',
      fixedBy: 'the providers registered at startup',
      call: () => get('/api/v1/ingestion/providers', rootAdmin),
      rowsShown: (response) => {
        const { providers } = okBody(response, ProviderListResponseSchema);
        expect(providers.map((summary) => [summary.providerId, summary.rateLimitedJobsLast24h])).toEqual([[provider.providerId, 2], [tennisProvider.providerId, 0]]);
        return providers.length;
      },
      // The events' links read each event's provider ids, Season, league and its sync provider
      // (mapping, provider league, provider): one read each for all of them (#2004).
      statements: 16,
    });
  });
});
