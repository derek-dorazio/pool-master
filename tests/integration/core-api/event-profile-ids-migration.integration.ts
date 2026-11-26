/**
 * Events name the profile they used by id (#2205), in real Postgres: the two columns are taken off
 * again, two events are given the old JSON that named their profile, the migration's own
 * statements run from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sport } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218026500_event_profile_ids/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** Two golf events, each with no recorded tiers or prices yet. */
async function twoEvents() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'PGA Tour' } },
    create: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: 'PGA Tour' },
    update: {},
  });
  const sportLeagueSeasonId = await fixtureSeasonId(prisma, sportLeague.id, 2027);
  const events = new PrismaSportEventRepository(getAppPrisma());
  return Promise.all(['Known', 'Unknown'].map((label) => createSportEventRow(events, {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId,
    name: `Profile Ids ${label} ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-04-08T12:00:00.000Z'),
    status: 'DRAFT',
    rounds: 4,
    autoLifecycleEnabled: false,
  })));
}

class Rollback extends Error {}

interface MigratedEvent {
  id: string;
  platform_pricing_profile_id: string | null;
  platform_tier_profile_id: string | null;
  pricing_config: Record<string, unknown> | null;
  tier_config: Record<string, unknown> | null;
}

describe('the event profile ids migration', () => {
  it('sets each event\'s profile ids from the names it stored, leaves the id null for a name no profile has, and drops the name from the stored JSON', async () => {
    const [known, unknown] = await twoEvents();
    const prisma = getPrisma();
    const pricingProfile = await prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: 'STANDARD' } });
    const tierProfile = await prisma.platformTierProfile.findFirstOrThrow({ where: { type: 'EQUAL_GROUPS' } });
    const values = { salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
    const layout = { type: 'EQUAL_GROUPS', tierCount: tierProfile.tierCount, tierSize: tierProfile.tierSize, lastTier: tierProfile.lastTier, lastTierMax: tierProfile.lastTierMax };

    const migrated = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "sport_events" DROP COLUMN "platform_pricing_profile_id", DROP COLUMN "platform_tier_profile_id"');
      const stored = [
        { id: known.id, pricing: { profileName: pricingProfile.name, ...values }, tiers: { profileName: tierProfile.name, ...layout } },
        { id: unknown.id, pricing: { profileName: 'A profile since deleted', ...values }, tiers: { profileName: 'Another since deleted', ...layout } },
      ];
      for (const row of stored) {
        // poolmaster-allow-query-in-loop: two events, each given the JSON the old code stored
        await tx.$executeRaw`${uncachedStatement()} UPDATE "sport_events" SET "pricing_config" = ${JSON.stringify(row.pricing)}::jsonb, "tier_config" = ${JSON.stringify(row.tiers)}::jsonb WHERE "id" = ${row.id}::uuid`;
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const rows = await tx.$queryRaw<MigratedEvent[]>`${uncachedStatement()} SELECT "id", "platform_pricing_profile_id", "platform_tier_profile_id", "pricing_config", "tier_config" FROM "sport_events" WHERE "id" IN (${known.id}::uuid, ${unknown.id}::uuid)`;
      throw new Rollback(JSON.stringify(rows));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as MigratedEvent[];
      throw error;
    });

    expect(migrated).toEqual(expect.arrayContaining([
      { id: known.id, platform_pricing_profile_id: pricingProfile.id, platform_tier_profile_id: tierProfile.id, pricing_config: values, tier_config: layout },
      { id: unknown.id, platform_pricing_profile_id: null, platform_tier_profile_id: null, pricing_config: values, tier_config: layout },
    ]));
    expect(migrated).toHaveLength(2);
  });
});
