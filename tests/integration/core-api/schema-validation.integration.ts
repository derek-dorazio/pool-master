/**
 * Prisma Schema Validation — Integration Tests
 *
 * Creates and reads every untested model to catch schema drift (P2022/P2023 errors).
 * Each test performs a create → findFirst → delete cycle with minimal required fields.
 * If Prisma field names or types diverge from the actual Postgres columns, these
 * tests will throw — that is the intended behaviour.
 */

import { randomUUID } from 'crypto';
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  getPrisma,
  cleanupTestData,
} from '../helpers';

// ---------------------------------------------------------------------------
// Shared prerequisite IDs populated in beforeAll
// ---------------------------------------------------------------------------
let tenantId: string;
let userId: string;
let leagueId: string;
let contestId: string;
let membershipId: string;
let entryId: string;
let sportId: string;
let participantId: string;
let adminUserId: string;
let featureFlagId: string;
let headers: Record<string, string>;

beforeAll(async () => {
  await setupIntegrationTests();
  const prisma = getPrisma();
  const app = getApp();

  // Tenant comes from helpers (test tenant)
  tenantId = '00000000-0000-0000-0000-999999999999';

  // User
  const testUser = await createTestUser();
  userId = testUser.user.id;
  headers = testUser.headers;

  // Sport
  sportId = randomUUID();
  await prisma.sport.upsert({
    where: { name: 'schema-val-golf' },
    create: { id: sportId, name: 'schema-val-golf', participantType: 'INDIVIDUAL' },
    update: { id: sportId },
  });

  // Participant
  participantId = randomUUID();
  await prisma.participant.create({
    data: {
      id: participantId,
      sportId,
      name: 'SchemaVal Player',
      participantType: 'INDIVIDUAL',
    },
  });

  // League via API
  const leagueRes = await app.inject({
    method: 'POST',
    url: '/api/v1/leagues',
    headers,
    payload: { name: 'Schema Validation League', visibility: 'PRIVATE' },
  });
  const leagueBody = JSON.parse(leagueRes.body);
  leagueId = leagueBody.league?.id ?? leagueBody.id;

  // Contest via API
  const contestRes = await app.inject({
    method: 'POST',
    url: `/api/v1/leagues/${leagueId}/contests`,
    headers,
    payload: {
      name: 'Schema Validation Contest',
      contestType: 'SINGLE_EVENT',
      selectionType: 'OPEN_SELECTION',
      scoringEngine: 'STROKE_PLAY',
    },
  });
  const contestBody = JSON.parse(contestRes.body);
  contestId = contestBody.contest?.id ?? contestBody.id;

  // LeagueMembership (auto-created when league was created)
  const membership = await prisma.leagueMembership.findFirst({
    where: { leagueId, userId },
  });
  membershipId = membership!.id;

  // ContestEntry
  entryId = randomUUID();
  await prisma.contestEntry.create({
    data: {
      id: entryId,
      contestId,
      leagueMembershipId: membershipId,
      name: 'Schema Val Entry',
    },
  });

  // AdminUser (needed for many admin models)
  adminUserId = randomUUID();
  await prisma.adminUser.create({
    data: {
      id: adminUserId,
      email: `admin-schema-val-${adminUserId.slice(0, 8)}@test.local`,
      name: 'Schema Validation Admin',
      role: 'SUPER_ADMIN',
    },
  });

  // FeatureFlag (needed for FeatureFlagOverride)
  featureFlagId = randomUUID();
  await prisma.featureFlag.create({
    data: {
      id: featureFlagId,
      key: `schema-val-flag-${featureFlagId.slice(0, 8)}`,
      name: 'Schema Validation Flag',
    },
  });
}, 30_000);

afterAll(async () => {
  const prisma = getPrisma();

  // Clean up prerequisite data in reverse dependency order
  await prisma.featureFlagOverride.deleteMany({ where: { flagId: featureFlagId } }).catch(() => {});
  await prisma.featureFlag.delete({ where: { id: featureFlagId } }).catch(() => {});
  await prisma.adminAuditEntry.deleteMany({ where: { adminUserId } }).catch(() => {});
  await prisma.globalAnnouncement.deleteMany({ where: { createdById: adminUserId } }).catch(() => {});
  await prisma.impersonationSession.deleteMany({ where: { adminUserId } }).catch(() => {});
  await prisma.migrationRun.deleteMany({ where: { startedById: adminUserId } }).catch(() => {});
  await prisma.adminUser.delete({ where: { id: adminUserId } }).catch(() => {});
  await prisma.contestEntry.delete({ where: { id: entryId } }).catch(() => {});
  await prisma.participant.delete({ where: { id: participantId } }).catch(() => {});
  await prisma.sport.delete({ where: { id: sportId } }).catch(() => {});

  await cleanupTestData();
  await teardownIntegrationTests();
}, 15_000);

// ===========================================================================
// Notification Models
// ===========================================================================

describe('Schema Validation — Notifications', () => {
  it('Notification: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.notification.create({
      data: {
        userId,
        eventType: 'TEST_EVENT',
        title: 'Schema validation test',
        body: 'Testing notification model schema',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.notification.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.notification.delete({ where: { id: record.id } });
  });

  it('NotificationDeliveryLog: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.notificationDeliveryLog.create({
      data: {
        notificationEventId: randomUUID(),
        userId,
        channel: 'IN_APP',
        status: 'SENT',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.notificationDeliveryLog.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.notificationDeliveryLog.delete({ where: { id: record.id } });
  });

  it('NotificationPreference: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.notificationPreference.create({
      data: {
        userId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.notificationPreference.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.notificationPreference.delete({ where: { id: record.id } });
  });

  it('NotificationTemplate: create + read + delete', async () => {
    const prisma = getPrisma();
    const uniqueEventType = `SCHEMA_VAL_${randomUUID().slice(0, 8)}`;
    const record = await prisma.notificationTemplate.create({
      data: {
        eventType: uniqueEventType,
        category: 'SYSTEM',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.notificationTemplate.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.notificationTemplate.delete({ where: { id: record.id } });
  });

  it('ScheduledNotification: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.scheduledNotification.create({
      data: {
        eventType: 'TEST_SCHEDULED',
        fireAt: new Date(Date.now() + 3600_000),
        context: { userId },
        sourceType: 'CONTEST',
        sourceId: randomUUID(),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.scheduledNotification.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.scheduledNotification.delete({ where: { id: record.id } });
  });
});

// ===========================================================================
// Compliance Models
// ===========================================================================

describe('Schema Validation — Compliance', () => {
  it('ConsentRecord: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.consentRecord.create({
      data: {
        userId,
        consentType: 'TOS',
        granted: true,
        version: '1.0',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.consentRecord.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.consentRecord.delete({ where: { id: record.id } });
  });

  it('DataExportRequest: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.dataExportRequest.create({
      data: {
        userId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.dataExportRequest.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.dataExportRequest.delete({ where: { id: record.id } });
  });

  it('DeletionRequest: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.deletionRequest.create({
      data: {
        userId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.deletionRequest.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.deletionRequest.delete({ where: { id: record.id } });
  });

  it('SelfExclusion: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.selfExclusion.create({
      data: {
        userId,
        exclusionType: 'TEMPORARY',
        duration: '30D',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.selfExclusion.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.selfExclusion.delete({ where: { id: record.id } });
  });

  it('AccountEnforcement: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.accountEnforcement.create({
      data: {
        userId,
        level: 'WARNING',
        reason: 'Schema validation test',
        trigger: 'MANUAL',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.accountEnforcement.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.accountEnforcement.delete({ where: { id: record.id } });
  });
});

// ===========================================================================
// Admin Models
// ===========================================================================

describe('Schema Validation — Admin', () => {
  it('AdminUser: create + read + delete', async () => {
    const prisma = getPrisma();
    const id = randomUUID();
    const record = await prisma.adminUser.create({
      data: {
        id,
        email: `admin-sv-${id.slice(0, 8)}@test.local`,
        name: 'SV Admin',
        role: 'VIEWER',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.adminUser.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.adminUser.delete({ where: { id: record.id } });
  });

  it('AdminAuditEntry: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.adminAuditEntry.create({
      data: {
        adminUserId,
        adminUserEmail: 'admin-sv@test.local',
        action: 'SCHEMA_VAL',
        resourceType: 'TEST',
        resourceId: randomUUID(),
        description: 'Schema validation test',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.adminAuditEntry.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.adminAuditEntry.delete({ where: { id: record.id } });
  });

  it('FeatureFlag: create + read + delete', async () => {
    const prisma = getPrisma();
    const key = `sv-flag-${randomUUID().slice(0, 8)}`;
    const record = await prisma.featureFlag.create({
      data: {
        key,
        name: 'Schema Val Flag Test',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.featureFlag.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.featureFlag.delete({ where: { id: record.id } });
  });

  it('FeatureFlagOverride: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.featureFlagOverride.create({
      data: {
        flagId: featureFlagId,
        tenantId,
        enabled: true,
        createdById: adminUserId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.featureFlagOverride.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.featureFlagOverride.delete({ where: { id: record.id } });
  });

  it('GlobalAnnouncement: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.globalAnnouncement.create({
      data: {
        title: 'Schema Validation',
        body: 'Test announcement body',
        startsAt: new Date(),
        createdById: adminUserId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.globalAnnouncement.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.globalAnnouncement.delete({ where: { id: record.id } });
  });

  it('ImpersonationSession: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.impersonationSession.create({
      data: {
        adminUserId,
        tenantId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.impersonationSession.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.impersonationSession.delete({ where: { id: record.id } });
  });
});

// ===========================================================================
// Billing Models
// ===========================================================================

describe('Schema Validation — Billing', () => {
  it('PlanTier: create + read + delete', async () => {
    const prisma = getPrisma();
    const slug = `sv-tier-${randomUUID().slice(0, 8)}`;
    const record = await prisma.planTier.create({
      data: {
        name: 'Schema Val Tier',
        slug,
        monthlyPriceCents: 999,
        annualPriceCents: 9999,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.planTier.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.planTier.delete({ where: { id: record.id } });
  });

  it('TenantSubscription: create + read + delete', async () => {
    const prisma = getPrisma();
    // Need a second tenant to avoid unique constraint on tenantId
    const subTenantId = randomUUID();
    await prisma.tenant.create({
      data: { id: subTenantId, name: 'SV Sub Tenant', slug: `sv-sub-${subTenantId.slice(0, 8)}` },
    });
    const record = await prisma.tenantSubscription.create({
      data: {
        tenantId: subTenantId,
        stripeCustomerId: `cus_sv_${randomUUID().slice(0, 8)}`,
        planTierSlug: 'free',
        billingCycle: 'MONTHLY',
        status: 'TRIALING',
        currency: 'usd',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.tenantSubscription.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.tenantSubscription.delete({ where: { id: record.id } });
    await prisma.tenant.delete({ where: { id: subTenantId } });
  });

  it('TenantUsage: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.tenantUsage.create({
      data: {
        tenantId,
        resource: 'SV_TEST',
        currentCount: 42,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.tenantUsage.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.tenantUsage.delete({ where: { id: record.id } });
  });

  it('EntitlementOverride: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.entitlementOverride.create({
      data: {
        tenantId,
        entitlementKey: 'sv_test_key',
        overrideValue: { limit: 999 },
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.entitlementOverride.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.entitlementOverride.delete({ where: { id: record.id } });
  });
});

// ===========================================================================
// Sports Data Models
// ===========================================================================

describe('Schema Validation — Sports Data', () => {
  it('SportEvent: create + read + delete', async () => {
    const prisma = getPrisma();
    const extId = `sv-event-${randomUUID().slice(0, 8)}`;
    const record = await prisma.sportEvent.create({
      data: {
        externalId: extId,
        providerId: 'sv-provider',
        sport: 'GOLF',
        name: 'Schema Validation Open',
        startDate: new Date(),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.sportEvent.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.sportEvent.delete({ where: { id: record.id } });
  });

  it('ProviderHealthLog: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.providerHealthLog.create({
      data: {
        providerId: 'sv-provider',
        status: 'HEALTHY',
        errorRate: 0.001,
        avgLatencyMs: 150,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.providerHealthLog.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.providerHealthLog.delete({ where: { id: record.id } });
  });

  it('IngestionJob: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.ingestionJob.create({
      data: {
        jobType: 'FIELD',
        providerId: 'sv-provider',
        sport: 'GOLF',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.ingestionJob.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.ingestionJob.delete({ where: { id: record.id } });
  });

  it('MigrationRun: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.migrationRun.create({
      data: {
        migrationId: 'sv-migration-001',
        options: { dryRun: true },
        startedById: adminUserId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.migrationRun.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.migrationRun.delete({ where: { id: record.id } });
  });
});

// ===========================================================================
// Contest Children Models
// ===========================================================================

describe('Schema Validation — Contest Children', () => {
  it('RosterPick: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.rosterPick.create({
      data: {
        entryId,
        participantId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.rosterPick.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.rosterPick.delete({ where: { id: record.id } });
  });

  it('ContestPick: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.contestPick.create({
      data: {
        entryId,
        contestId,
        participantId,
        period: 99,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.contestPick.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.contestPick.delete({ where: { id: record.id } });
  });

  it('BracketPrediction: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.bracketPrediction.create({
      data: {
        entryId,
        contestId,
        predictions: [{ round: 1, pick: 'Team A' }],
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.bracketPrediction.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.bracketPrediction.delete({ where: { id: record.id } });
  });

  it('DraftPick: create + read + delete', async () => {
    const prisma = getPrisma();
    // Need a DraftSession first
    const draftSession = await prisma.draftSession.create({
      data: { contestId },
    });
    const record = await prisma.draftPick.create({
      data: {
        draftSessionId: draftSession.id,
        entryId,
        participantId,
        pickNumber: 1,
        round: 1,
        pickInRound: 1,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.draftPick.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.draftPick.delete({ where: { id: record.id } });
    await prisma.draftSession.delete({ where: { id: draftSession.id } });
  });

  it('ScoringCheckpoint: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.scoringCheckpoint.create({
      data: {
        contestId,
        checkpointLabel: 'Round 1',
        checkpointType: 'ROUND',
        checkpointOrder: 1,
        standings: [{ entryId, score: 72 }],
        recordedAt: new Date(),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.scoringCheckpoint.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.scoringCheckpoint.delete({ where: { id: record.id } });
  });

  it('ContestResult: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.contestResult.create({
      data: {
        contestId,
        entryId,
        finalRank: 1,
        totalScore: 280.0,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.contestResult.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.contestResult.delete({ where: { id: record.id } });
  });

  it('PayoutHistory: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.payoutHistory.create({
      data: {
        contestId,
        leagueId,
        entryId,
        leagueMembershipId: membershipId,
        prizeType: 'CASH',
        prizeLabel: '1st Place',
        amount: 1000,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.payoutHistory.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.payoutHistory.delete({ where: { id: record.id } });
  });

  it('Trophy: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.trophy.create({
      data: {
        leagueId,
        leagueMembershipId: membershipId,
        trophyType: 'CHAMPION',
        label: 'Season Champion',
        awardedAt: new Date(),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.trophy.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.trophy.delete({ where: { id: record.id } });
  });
});

// ===========================================================================
// History & Discovery Models
// ===========================================================================

describe('Schema Validation — History & Discovery', () => {
  it('SeasonNote: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.seasonNote.create({
      data: {
        leagueId,
        season: '2026',
        content: 'Schema validation season note',
        authorId: userId,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.seasonNote.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.seasonNote.delete({ where: { id: record.id } });
  });

  it('LeagueSeasonSummary: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.leagueSeasonSummary.create({
      data: {
        leagueId,
        seasonName: 'SV 2026',
        year: 2026,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.leagueSeasonSummary.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.leagueSeasonSummary.delete({ where: { id: record.id } });
  });

  it('LeagueRecord: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.leagueRecord.create({
      data: {
        leagueId,
        category: 'HIGHEST_SCORE',
        scope: 'ALL_TIME',
        recordValue: 350.5,
        recordLabel: 'Highest Single Contest Score',
        heldByMemberId: membershipId,
        heldByMemberName: 'Test User',
        setAt: new Date(),
        lastComputedAt: new Date(),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.leagueRecord.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.leagueRecord.delete({ where: { id: record.id } });
  });

  it('RivalryRecord: create + read + delete', async () => {
    const prisma = getPrisma();
    // Create a second user for rivalry
    const user2 = await createTestUser();
    // Create membership for user2 in the league
    const membership2 = await prisma.leagueMembership.create({
      data: {
        leagueId,
        userId: user2.user.id,
        role: 'MEMBER',
      },
    });
    const record = await prisma.rivalryRecord.create({
      data: {
        leagueId,
        memberAId: membershipId,
        memberBId: membership2.id,
        lastUpdatedAt: new Date(),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.rivalryRecord.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.rivalryRecord.delete({ where: { id: record.id } });
    await prisma.leagueMembership.delete({ where: { id: membership2.id } });
  });

  it('DiscoverableContest: create + read + delete', async () => {
    const prisma = getPrisma();
    const dcId = randomUUID();
    const record = await prisma.discoverableContest.create({
      data: {
        id: dcId,
        leagueId,
        contestName: 'SV Discoverable Contest',
        sport: 'GOLF',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.discoverableContest.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.discoverableContest.delete({ where: { id: record.id } });
  });

  it('DiscoveryReport: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.discoveryReport.create({
      data: {
        entityType: 'LEAGUE',
        entityId: leagueId,
        reportedBy: userId,
        reason: 'Schema validation test report',
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.discoveryReport.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.discoveryReport.delete({ where: { id: record.id } });
  });
});

// ===========================================================================
// Other Models
// ===========================================================================

describe('Schema Validation — Other', () => {
  it('RefreshToken: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.refreshToken.create({
      data: {
        token: `sv-rt-${randomUUID()}`,
        userId,
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.refreshToken.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.refreshToken.delete({ where: { id: record.id } });
  });

  it('Season: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.season.create({
      data: {
        sportId,
        tenantId,
        name: 'SV 2026 Season',
        year: 2026,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.season.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.season.delete({ where: { id: record.id } });
  });

  it('DeviceRegistration: create + read + delete', async () => {
    const prisma = getPrisma();
    const uniqueToken = `sv-device-${randomUUID()}`;
    const record = await prisma.deviceRegistration.create({
      data: {
        userId,
        platform: 'IOS',
        token: uniqueToken,
      },
    });
    expect(record.id).toBeDefined();
    const found = await prisma.deviceRegistration.findFirst({ where: { id: record.id } });
    expect(found).not.toBeNull();
    await prisma.deviceRegistration.delete({ where: { id: record.id } });
  });

  it('UserLocalePreference: create + read + delete', async () => {
    const prisma = getPrisma();
    const record = await prisma.userLocalePreference.create({
      data: {
        userId,
      },
    });
    // UserLocalePreference PK is userId, not a generated id
    expect(record.userId).toBeDefined();
    const found = await prisma.userLocalePreference.findFirst({ where: { userId: record.userId } });
    expect(found).not.toBeNull();
    await prisma.userLocalePreference.delete({ where: { userId: record.userId } });
  });
});
