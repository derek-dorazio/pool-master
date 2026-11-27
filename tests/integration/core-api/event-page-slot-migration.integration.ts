/**
 * An event page names the slot definition it shows, and an offer carries only its page and its
 * setup (#2050), in real Postgres. The offer's old columns are put back as they were, rows are set
 * as they held them, the migration's own statements run from its file, and everything is rolled
 * back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { keyedSlotDefinitionId } from '../../support/event-edition';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218031400_event_page_names_its_slot/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** The page and offer columns as they were before the migration. */
const PUT_BACK = [
  'ALTER TABLE "event_page_offers" ADD COLUMN "sport_league_id" UUID, ADD COLUMN "sport_league_competition_slot_id" UUID',
  'UPDATE "event_page_offers" o SET "sport_league_id" = p."sport_league_id", "sport_league_competition_slot_id" = p."sport_league_competition_slot_id" FROM "event_pages" p WHERE p."id" = o."event_page_id"',
  'ALTER TABLE "event_page_offers" ALTER COLUMN "sport_league_id" SET NOT NULL, ALTER COLUMN "sport_league_competition_slot_id" SET NOT NULL',
  'ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_definition_fkey" FOREIGN KEY ("sport_league_id", "sport_league_competition_slot_id") REFERENCES "sport_league_competition_slots"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'CREATE INDEX "event_page_offers_sport_league_id_sport_league_competition__idx" ON "event_page_offers"("sport_league_id", "sport_league_competition_slot_id")',
  'ALTER TABLE "event_pages" DROP CONSTRAINT "event_pages_definition_fkey"',
  'ALTER TABLE "event_pages" DROP CONSTRAINT "event_pages_sport_league_id_fkey"',
  'ALTER TABLE "event_pages" DROP COLUMN "sport_league_competition_slot_id", DROP COLUMN "sport_league_id"',
];

class Rollback extends Error {}

interface Migrated {
  shown: string;
  page: { sportLeagueId: string; definitionId: string };
  offers: { templateId: string; sortOrder: number }[];
}

describe('the event page slot migration', () => {
  it('gives each page its primary offer\'s slot definition and sport league, and drops an offer on another definition, which the page cannot show', async () => {
    const prisma = getPrisma();
    const templates = await prisma.contestConfigTemplate.findMany({ where: { templateKey: { in: ['nfl-squares', 'nfl-bracket-doubling'] } }, select: { id: true, sportLeagueId: true, templateKey: true } });
    const squares = templates.find((template) => template.templateKey === 'nfl-squares');
    const bracket = templates.find((template) => template.templateKey === 'nfl-bracket-doubling');
    if (squares === undefined || bracket === undefined) throw new Error('The NFL has no seeded squares or bracket template.');
    const suffix = randomUUID().replace(/-/g, '_').toUpperCase();
    const pageId = randomUUID();

    // The two definitions are made inside the transaction, so they roll back with everything else
    // and no seeded league is left with a definition of this test's.
    const migrated = await prisma.$transaction(async (tx) => {
      const shown = await keyedSlotDefinitionId(tx, squares.sportLeagueId, `PAGE_MIGRATION_${suffix}`);
      const other = await keyedSlotDefinitionId(tx, squares.sportLeagueId, `PAGE_MIGRATION_${suffix}_OTHER`);
      for (const statement of PUT_BACK) {
        // poolmaster-allow-query-in-loop: the statements putting the old columns back, in order
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRaw`INSERT INTO "event_pages" ("id", "sport", "url_segment", "display_order", "updated_at") VALUES (${pageId}::uuid, 'FOOTBALL', ${`page-migration-${suffix.toLowerCase().replace(/_/g, '-')}`}, 999, now())`;
      // The primary offer sits second in order: its definition is the page's, whichever comes first.
      const offers = [
        { templateId: bracket.id, definitionId: shown, sortOrder: 1, isPrimary: false },
        { templateId: squares.id, definitionId: shown, sortOrder: 2, isPrimary: true },
        { templateId: squares.id, definitionId: other, sortOrder: 3, isPrimary: false },
      ];
      for (const offer of offers) {
        // poolmaster-allow-query-in-loop: three fixture offers, inserted as the old table held them
        await tx.$executeRaw`INSERT INTO "event_page_offers" ("id", "event_page_id", "sport_league_id", "sport_league_competition_slot_id", "template_id", "sort_order", "is_primary", "updated_at")
          VALUES (${randomUUID()}::uuid, ${pageId}::uuid, ${squares.sportLeagueId}::uuid, ${offer.definitionId}::uuid, ${offer.templateId}::uuid, ${offer.sortOrder}, ${offer.isPrimary}, now())`;
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const [page] = await tx.$queryRaw<{ sportLeagueId: string; definitionId: string }[]>`SELECT "sport_league_id"::text AS "sportLeagueId", "sport_league_competition_slot_id"::text AS "definitionId" FROM "event_pages" WHERE "id" = ${pageId}::uuid`;
      const kept = await tx.$queryRaw<{ templateId: string; sortOrder: number }[]>`SELECT "template_id"::text AS "templateId", "sort_order" AS "sortOrder" FROM "event_page_offers" WHERE "event_page_id" = ${pageId}::uuid ORDER BY "sort_order"`;
      throw new Rollback(JSON.stringify({ shown, page, offers: kept }));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Migrated;
      throw error;
    });

    expect(migrated).toEqual({
      shown: migrated.shown,
      page: { sportLeagueId: squares.sportLeagueId, definitionId: migrated.shown },
      offers: [{ templateId: bracket.id, sortOrder: 1 }, { templateId: squares.id, sortOrder: 2 }],
    });
  });
});
