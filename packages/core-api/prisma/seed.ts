/**
 * Prisma seed script — seeds plan tiers, admin users, test users, leagues, and sports.
 *
 * Run with: npx prisma db seed
 * Idempotent — safe to run multiple times (uses upsert).
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const DEV_PASSWORD = 'poolmaster123';
const BCRYPT_ROUNDS = 12;

// =============================================================================
// Plan Tiers
// =============================================================================

const FREE_TIER = {
  name: 'Free',
  slug: 'free',
  displayOrder: 0,
  monthlyPriceCents: 0,
  annualPriceCents: 0,
  trialDays: 0,
  entitlements: {
    max_leagues: 50,
    max_members_per_league: 100,
    max_contests_per_season: 100,
    allowed_sports: 'ALL',
    allowed_draft_types: 'ALL',
    allowed_draft_modes: 'ALL',
    real_time_leaderboard: true,
    custom_scoring: true,
    history_seasons: -1,
    analytics_tier: 'FULL',
    branding: 'NONE',
    intermediate_prizes: true,
    api_access: true,
    support_tier: 'COMMUNITY',
  },
  isPublic: true,
};

const STARTER_TIER = {
  name: 'Starter',
  slug: 'starter',
  displayOrder: 1,
  monthlyPriceCents: 900,
  annualPriceCents: 8600,
  trialDays: 14,
  entitlements: {
    max_leagues: 3,
    max_members_per_league: 20,
    max_contests_per_season: 10,
    allowed_sports: ['GOLF', 'NFL'],
    allowed_draft_types: ['SNAKE', 'TIERED'],
    allowed_draft_modes: ['ASYNC', 'LIVE'],
    real_time_leaderboard: true,
    custom_scoring: true,
    history_seasons: 2,
    analytics_tier: 'BASIC',
    branding: 'NONE',
    intermediate_prizes: false,
    api_access: false,
    support_tier: 'EMAIL',
  },
  isPublic: true,
};

const PRO_TIER = {
  name: 'Pro',
  slug: 'pro',
  displayOrder: 2,
  monthlyPriceCents: 2900,
  annualPriceCents: 27800,
  trialDays: 14,
  entitlements: {
    max_leagues: 10,
    max_members_per_league: 50,
    max_contests_per_season: -1,
    allowed_sports: 'ALL',
    allowed_draft_types: 'ALL',
    allowed_draft_modes: ['ASYNC', 'LIVE'],
    real_time_leaderboard: true,
    custom_scoring: true,
    history_seasons: 5,
    analytics_tier: 'FULL',
    branding: 'LOGO',
    intermediate_prizes: true,
    api_access: false,
    support_tier: 'EMAIL_CHAT',
  },
  isPublic: true,
};

const LEAGUE_PLUS_TIER = {
  name: 'League+',
  slug: 'league_plus',
  displayOrder: 3,
  monthlyPriceCents: 7900,
  annualPriceCents: 75600,
  trialDays: 14,
  entitlements: {
    max_leagues: -1,
    max_members_per_league: 100,
    max_contests_per_season: -1,
    allowed_sports: 'ALL',
    allowed_draft_types: 'ALL',
    allowed_draft_modes: ['ASYNC', 'LIVE'],
    real_time_leaderboard: true,
    custom_scoring: true,
    history_seasons: -1,
    analytics_tier: 'FULL',
    branding: 'FULL',
    intermediate_prizes: true,
    api_access: true,
    support_tier: 'DEDICATED',
  },
  isPublic: true,
};

const PLAN_TIERS = [FREE_TIER, STARTER_TIER, PRO_TIER, LEAGUE_PLUS_TIER];

// =============================================================================
// Sports
// =============================================================================

const SPORTS = [
  { name: 'GOLF', participantType: 'INDIVIDUAL' },
  { name: 'NFL', participantType: 'TEAM' },
  { name: 'NBA', participantType: 'TEAM' },
  { name: 'F1', participantType: 'INDIVIDUAL' },
  { name: 'NASCAR', participantType: 'INDIVIDUAL' },
  { name: 'NCAA_BASKETBALL', participantType: 'TEAM' },
  { name: 'NCAA_FOOTBALL', participantType: 'TEAM' },
  { name: 'TENNIS', participantType: 'INDIVIDUAL' },
  { name: 'HORSE_RACING', participantType: 'INDIVIDUAL' },
  { name: 'SOCCER', participantType: 'TEAM' },
  { name: 'NHL', participantType: 'TEAM' },
  { name: 'MLB', participantType: 'TEAM' },
  { name: 'UFC', participantType: 'INDIVIDUAL' },
];

// =============================================================================
// Seed Runner
// =============================================================================

async function main(): Promise<void> {
  // --- Plan Tiers ---
  console.log('Seeding plan tiers...');
  for (const tier of PLAN_TIERS) {
    await prisma.planTier.upsert({
      where: { slug: tier.slug },
      update: {
        name: tier.name,
        displayOrder: tier.displayOrder,
        monthlyPriceCents: tier.monthlyPriceCents,
        annualPriceCents: tier.annualPriceCents,
        trialDays: tier.trialDays,
        entitlements: tier.entitlements,
        isPublic: tier.isPublic,
      },
      create: tier,
    });
    console.log(`  ✓ Tier: ${tier.name}`);
  }

  // --- Sports ---
  console.log('Seeding sports...');
  const sportMap: Record<string, string> = {};
  for (const sport of SPORTS) {
    const row = await prisma.sport.upsert({
      where: { name: sport.name },
      update: { participantType: sport.participantType },
      create: sport,
    });
    sportMap[sport.name] = row.id;
    console.log(`  ✓ Sport: ${sport.name}`);
  }

  // --- Tenant ---
  console.log('Seeding tenant...');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'poolmaster-dev' },
    update: { name: 'PoolMaster Dev' },
    create: {
      name: 'PoolMaster Dev',
      slug: 'poolmaster-dev',
      planTier: 'free',
      settings: {},
    },
  });
  console.log(`  ✓ Tenant: ${tenant.name} (${tenant.slug})`);

  // --- Admin Users ---
  console.log('Seeding admin users...');
  await prisma.adminUser.upsert({
    where: { email: 'derek.dorazio@gmail.com' },
    update: { name: 'Derek Dorazio', role: 'SUPER_ADMIN' },
    create: {
      email: 'derek.dorazio@gmail.com',
      name: 'Derek Dorazio',
      role: 'SUPER_ADMIN',
      permissions: [
        'tenant.view', 'tenant.edit', 'tenant.suspend', 'tenant.delete', 'tenant.impersonate',
        'user.view', 'user.edit', 'user.reset_password', 'user.force_logout', 'user.merge',
        'contest.view', 'contest.override', 'contest.recalculate', 'contest.close',
        'sportsdata.view', 'sportsdata.configure', 'sportsdata.re_ingest',
        'platform.health', 'platform.migrations',
        'audit.view',
      ],
      isActive: true,
    },
  });
  console.log('  ✓ Admin: Derek Dorazio (SUPER_ADMIN)');

  await prisma.adminUser.upsert({
    where: { email: 'jackson.dorazio@gmail.com' },
    update: { name: 'Jackson Dorazio', role: 'OPERATIONS' },
    create: {
      email: 'jackson.dorazio@gmail.com',
      name: 'Jackson Dorazio',
      role: 'OPERATIONS',
      permissions: [
        'tenant.view', 'tenant.edit',
        'user.view', 'user.edit', 'user.reset_password',
        'contest.view', 'contest.override', 'contest.recalculate',
        'sportsdata.view', 'sportsdata.configure',
        'platform.health',
        'audit.view',
      ],
      isActive: true,
    },
  });
  console.log('  ✓ Admin: Jackson Dorazio (OPERATIONS)');

  // --- Regular Users ---
  console.log('Seeding users...');
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, BCRYPT_ROUNDS);

  const derek = await prisma.user.upsert({
    where: { email: 'derek.dorazio@gmail.com' },
    update: { displayName: 'Derek Dorazio', passwordHash },
    create: {
      email: 'derek.dorazio@gmail.com',
      displayName: 'Derek Dorazio',
      passwordHash,
      tenantId: tenant.id,
      timezone: 'America/New_York',
    },
  });
  console.log('  ✓ User: Derek Dorazio');

  const jackson = await prisma.user.upsert({
    where: { email: 'jackson.dorazio@gmail.com' },
    update: { displayName: 'Jackson Dorazio', passwordHash },
    create: {
      email: 'jackson.dorazio@gmail.com',
      displayName: 'Jackson Dorazio',
      passwordHash,
      tenantId: tenant.id,
      timezone: 'America/New_York',
    },
  });
  console.log('  ✓ User: Jackson Dorazio');

  // Commissioner accounts (separate logins for testing commissioner features)
  const commish1 = await prisma.user.upsert({
    where: { email: 'commish.one@poolmaster.dev' },
    update: { displayName: 'Commish One', passwordHash },
    create: {
      email: 'commish.one@poolmaster.dev',
      displayName: 'Commish One',
      passwordHash,
      tenantId: tenant.id,
      timezone: 'America/New_York',
    },
  });
  console.log('  ✓ User: Commish One (commissioner for Masters Pool)');

  const commish2 = await prisma.user.upsert({
    where: { email: 'commish.two@poolmaster.dev' },
    update: { displayName: 'Commish Two', passwordHash },
    create: {
      email: 'commish.two@poolmaster.dev',
      displayName: 'Commish Two',
      passwordHash,
      tenantId: tenant.id,
      timezone: 'America/New_York',
    },
  });
  console.log('  ✓ User: Commish Two (commissioner for NFL Survivor)');

  // Test member accounts
  const testUsers: { id: string; name: string }[] = [];
  for (let i = 1; i <= 4; i++) {
    const user = await prisma.user.upsert({
      where: { email: `testmanager${i}@poolmaster.dev` },
      update: { displayName: `Test Manager ${i}`, passwordHash },
      create: {
        email: `testmanager${i}@poolmaster.dev`,
        displayName: `Test Manager ${i}`,
        passwordHash,
        tenantId: tenant.id,
        timezone: 'America/New_York',
      },
    });
    testUsers.push({ id: user.id, name: user.displayName });
    console.log(`  ✓ User: Test Manager ${i}`);
  }

  // --- Leagues ---
  console.log('Seeding leagues...');

  const mastersLeague = await prisma.league.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { name: 'Masters Pool 2026' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: tenant.id,
      name: 'Masters Pool 2026',
      description: 'Annual Masters tournament pool. Pick your golfers, compete for bragging rights.',
      createdBy: commish1.id,
      visibility: 'PUBLIC',
      maxMembers: 20,
      settings: {
        invitePolicy: 'LINK_INVITE',
        allowMidSeasonJoin: true,
        requireApproval: false,
        activityFeedEnabled: true,
        weeklyRecapEnabled: true,
        weeklyRecapDay: 'MONDAY',
        timezone: 'America/New_York',
        currency: 'USD',
      },
    },
  });
  console.log(`  ✓ League: ${mastersLeague.name} (PUBLIC, Golf)`);

  const nflLeague = await prisma.league.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: { name: 'NFL Survivor League' },
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      tenantId: tenant.id,
      name: 'NFL Survivor League',
      description: 'Pick one NFL team per week. If they win, you survive. If they lose, you\'re out.',
      createdBy: commish2.id,
      visibility: 'PRIVATE',
      maxMembers: 32,
      settings: {
        invitePolicy: 'COMMISSIONER_ONLY',
        allowMidSeasonJoin: false,
        requireApproval: true,
        activityFeedEnabled: true,
        weeklyRecapEnabled: true,
        weeklyRecapDay: 'TUESDAY',
        timezone: 'America/New_York',
        currency: 'USD',
      },
    },
  });
  console.log(`  ✓ League: ${nflLeague.name} (PRIVATE, NFL)`);

  // --- League Memberships ---
  console.log('Seeding league memberships...');

  const allMembers = [
    // Masters Pool — Commish One is OWNER
    { leagueId: mastersLeague.id, userId: commish1.id, role: 'OWNER' },
    { leagueId: mastersLeague.id, userId: derek.id, role: 'MANAGER' },
    { leagueId: mastersLeague.id, userId: jackson.id, role: 'MANAGER' },
    ...testUsers.map((u) => ({ leagueId: mastersLeague.id, userId: u.id, role: 'MANAGER' })),

    // NFL Survivor — Commish Two is OWNER
    { leagueId: nflLeague.id, userId: commish2.id, role: 'OWNER' },
    { leagueId: nflLeague.id, userId: derek.id, role: 'MANAGER' },
    { leagueId: nflLeague.id, userId: jackson.id, role: 'MANAGER' },
    ...testUsers.map((u) => ({ leagueId: nflLeague.id, userId: u.id, role: 'MANAGER' })),
  ];

  for (const membership of allMembers) {
    await prisma.leagueMembership.upsert({
      where: {
        leagueId_userId: {
          leagueId: membership.leagueId,
          userId: membership.userId,
        },
      },
      update: { role: membership.role },
      create: {
        leagueId: membership.leagueId,
        userId: membership.userId,
        role: membership.role,
        permissions: [],
        joinedAt: new Date(),
      },
    });
  }
  console.log(`  ✓ ${allMembers.length} memberships created (7 per league)`);

  // --- Seasons ---
  console.log('Seeding seasons...');

  await prisma.season.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: { name: 'PGA Tour 2026' },
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      sportId: sportMap['GOLF'],
      tenantId: tenant.id,
      name: 'PGA Tour 2026',
      year: 2026,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });
  console.log('  ✓ Season: PGA Tour 2026');

  await prisma.season.upsert({
    where: { id: '00000000-0000-0000-0000-000000000011' },
    update: { name: 'NFL 2025-2026' },
    create: {
      id: '00000000-0000-0000-0000-000000000011',
      sportId: sportMap['NFL'],
      tenantId: tenant.id,
      name: 'NFL 2025-2026',
      year: 2025,
      startDate: new Date('2025-09-04'),
      endDate: new Date('2026-02-08'),
    },
  });
  console.log('  ✓ Season: NFL 2025-2026');

  // --- Notification Preferences (defaults for real users) ---
  console.log('Seeding notification preferences...');
  const defaultPrefs = {
    DRAFT: { enabled: true, channels: { push: true, email: true, in_app: true, sms: false } },
    SCORING: { enabled: true, channels: { push: true, email: false, in_app: true, sms: false } },
    CONTEST: { enabled: true, channels: { push: true, email: true, in_app: true, sms: false } },
    LEAGUE: { enabled: true, channels: { push: false, email: false, in_app: true, sms: false } },
    SOCIAL: { enabled: true, channels: { push: true, email: false, in_app: true, sms: false } },
    ACCOUNT: { enabled: true, channels: { push: false, email: true, in_app: true, sms: false } },
  };

  for (const user of [derek, jackson]) {
    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        doNotDisturb: false,
        categoryPreferences: defaultPrefs,
      },
    });
  }
  console.log('  ✓ Notification preferences for Derek + Jackson');

  // --- Done ---
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Seed complete!');
  console.log('');
  console.log('  Password for all accounts: poolmaster123');
  console.log('');
  console.log('  Admin accounts:');
  console.log('    derek.dorazio@gmail.com   (SUPER_ADMIN)');
  console.log('    jackson.dorazio@gmail.com (OPERATIONS)');
  console.log('');
  console.log('  Commissioner accounts:');
  console.log('    commish.one@poolmaster.dev  (Masters Pool 2026)');
  console.log('    commish.two@poolmaster.dev  (NFL Survivor League)');
  console.log('');
  console.log('  Test accounts:');
  console.log('    testmanager1-4@poolmaster.dev');
  console.log('');
  console.log('  Leagues:');
  console.log('    Masters Pool 2026   (7 members, PUBLIC)');
  console.log('    NFL Survivor League (7 members, PRIVATE)');
  console.log('═══════════════════════════════════════════════════');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
