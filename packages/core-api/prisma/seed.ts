/**
 * Prisma seed script — seeds plan tier definitions.
 *
 * Run with: npx prisma db seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Plan tier seed data
// ---------------------------------------------------------------------------

const FREE_TIER = {
  name: 'Free',
  slug: 'free',
  displayOrder: 0,
  monthlyPriceCents: 0,
  annualPriceCents: 0,
  trialDays: 0,
  entitlements: {
    max_leagues: -1,
    max_members_per_league: -1,
    max_contests_per_season: -1,
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
  isPublic: false,
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
  isPublic: false,
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
  isPublic: false,
};

const PLAN_TIERS = [FREE_TIER, STARTER_TIER, PRO_TIER, LEAGUE_PLUS_TIER];

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
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
    console.log(`  Upserted tier: ${tier.name} (${tier.slug})`);
  }

  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
