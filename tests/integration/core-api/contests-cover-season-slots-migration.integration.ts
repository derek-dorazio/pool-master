/**
 * Contests cover Season slots (#2014), in real Postgres: the tables are put back as they were
 * (a contest's events in `contest_sport_events`, its year and its cup's year as columns, a
 * configuration with no template, a draw's pending receipts on an event), the migration's own
 * statements run from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sport } from '@poolmaster/shared/domain';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { fixtureSeasonId, keyedSlotDefinitionId, putEventInSlot } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { uncachedStatement } from '../../support/put-back-sql';
import { deleteTestSportLeagues } from '../../support/test-slots';

const made = { sportLeagueIds: [] as string[] };

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await deleteTestSportLeagues(getPrisma(), made.sportLeagueIds);
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218028700_contests_cover_season_slots/migration.sql');

/** The migration's statements in order. A `DO $$ … $$` block holds no `;` followed by a line break. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/**
 * The schema as it was before the migration, with each row's old shape worked out from its new
 * one: a contest's events from its covered slots, its year and its cup's from their Season.
 */
const PUT_BACK = [
  'ALTER TABLE "contest_draws" DROP CONSTRAINT "contest_draws_receipts_pending_contest_season_slot_id_fkey"',
  'ALTER TABLE "contest_draws" ADD COLUMN "receipts_pending_sport_event_id" UUID',
  'ALTER TABLE "contest_draws" DROP COLUMN "receipts_pending_contest_season_slot_id"',
  'ALTER TABLE "contest_draws" ADD CONSTRAINT "contest_draws_receipts_pending_sport_event_id_fkey" FOREIGN KEY ("receipts_pending_sport_event_id") REFERENCES "sport_events"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'CREATE INDEX "contest_draws_receipts_pending_sport_event_id_idx" ON "contest_draws"("receipts_pending_sport_event_id")',
  `CREATE TABLE "contest_sport_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "contest_id" UUID NOT NULL REFERENCES "contests"("id") ON DELETE CASCADE,
    "sport_event_id" UUID NOT NULL REFERENCES "sport_events"("id"),
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `INSERT INTO "contest_sport_events" ("contest_id", "sport_event_id", "sequence")
    SELECT linked."contest_id", linked."sport_event_id", row_number() OVER (PARTITION BY linked."contest_id" ORDER BY linked."sport_event_id")
    FROM (
      SELECT DISTINCT css."contest_id", es."sport_event_id"
      FROM "contest_season_slots" css
      JOIN "sport_event_slots" es ON es."sport_league_season_id" = css."sport_league_season_id"
        AND es."sport_league_season_competition_slot_id" = css."sport_league_season_competition_slot_id"
    ) linked`,
  'DROP TABLE "contest_season_slots"',
  'ALTER TABLE "contests" ADD COLUMN "season_year" INTEGER',
  'UPDATE "contests" c SET "season_year" = s."championship_year" FROM "sport_league_seasons" s WHERE s."id" = c."sport_league_season_id"',
  // Another suite's contest with no event and no configuration is outside what the migration
  // copies (QA has none); it goes for the length of this rolled-back transaction.
  `DELETE FROM "contests" c WHERE NOT EXISTS (SELECT 1 FROM "contest_sport_events" cse WHERE cse."contest_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "contest_configurations" cc WHERE cc."contest_id" = c."id")`,
  'ALTER TABLE "contests" ALTER COLUMN "season_year" SET NOT NULL',
  'ALTER TABLE "contests" DROP COLUMN "sport_league_season_id"',
  'CREATE INDEX "contests_league_id_season_year_idx" ON "contests"("league_id", "season_year")',
  'ALTER TABLE "cups" ADD COLUMN "season_year" INTEGER',
  'UPDATE "cups" cu SET "season_year" = s."championship_year" FROM "sport_league_seasons" s WHERE s."id" = cu."sport_league_season_id"',
  'ALTER TABLE "cups" ALTER COLUMN "season_year" SET NOT NULL',
  'ALTER TABLE "cups" DROP COLUMN "sport_league_season_id"',
  'CREATE UNIQUE INDEX "cups_league_id_season_year_sport_league_id_key" ON "cups"("league_id", "season_year", "sport_league_id")',
  'ALTER TABLE "contest_configurations" ALTER COLUMN "template_id" DROP NOT NULL',
];

/**
 * A golf league of its own with a 2026 Season and one event in two Season slots, of which its
 * TIERED template lists one: contests on the event, one with no event, a cup and a draw.
 */
async function seedLeague() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const sport = await prisma.sport.upsert({ where: { sport: Sport.GOLF }, create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) }, update: {} });
  const sportLeague = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Coverage Migration ${suffix}` },
  });
  made.sportLeagueIds.push(sportLeague.id);
  const sportLeagueSeasonId = await fixtureSeasonId(prisma, sportLeague.id, 2026);
  const event = await prisma.sportEvent.create({
    data: { sportLeagueId: sportLeague.id, sportLeagueSeasonId, name: `Coverage Open ${suffix}`, startDate: new Date('2026-06-04T12:00:00.000Z'), status: 'SCHEDULED' },
  });
  const listedDefinitionId = await keyedSlotDefinitionId(prisma, sportLeague.id, 'COVERAGE_LISTED');
  const otherDefinitionId = await keyedSlotDefinitionId(prisma, sportLeague.id, 'COVERAGE_OTHER');
  const listedSlotId = await putEventInSlot(prisma, event.id, listedDefinitionId);
  await putEventInSlot(prisma, event.id, otherDefinitionId);
  const template = await prisma.contestConfigTemplate.create({
    data: {
      sportLeagueId: sportLeague.id, contestFormat: 'ROSTER', selectionType: 'TIERED', templateKey: 'coverage-tiered', name: 'Coverage Tiered',
      description: 'A template listing one of the event\'s two slots.', sortOrder: 1, isDefault: true, configJson: { selectionType: 'TIERED' },
      coverageMode: 'ALL_LISTED', slots: { create: { sportLeagueCompetitionSlotId: listedDefinitionId } },
    },
  });
  const league = await prisma.league.create({ data: { cupName: 'Coverage Cup', leagueCode: `COV${suffix.toUpperCase()}`, name: `Coverage League ${suffix}` } });
  const contest = async (name: string, covered: readonly string[]) => (await prisma.contest.create({
    data: {
      leagueId: league.id, sportLeagueSeasonId, name, status: 'OPEN', selectionType: 'TIERED',
      seasonSlots: { create: covered.map((sportLeagueSeasonCompetitionSlotId) => ({ sportLeagueSeasonCompetitionSlotId })) },
      configuration: { create: { templateId: template.id, selectionType: 'TIERED' } },
    },
  })).id;
  // Before the migration a contest linked the whole event, so each starts with its event's link alone.
  const onEvent = await contest('On the event', [listedSlotId]);
  const templateless = await contest('No template', [listedSlotId]);
  const eventless = await contest('No event', []);
  await prisma.contestDraw.create({ data: { contestId: onEvent, seed: 'seed', fieldOrder: [], entryOrder: [] } });
  const cup = await prisma.cup.create({ data: { leagueId: league.id, sportLeagueId: sportLeague.id, sportLeagueSeasonId } });
  return { sportLeagueSeasonId, templateId: template.id, event, listedSlotId, contests: { onEvent, templateless, eventless }, cupId: cup.id };
}

class Rollback extends Error {}

interface Migrated {
  covered: Record<string, string[]>;
  seasons: Record<string, string>;
  templateOfTemplateless: string | null;
  pendingSlotIsCovered: boolean;
  cupSeason: string | null;
}

describe('the contests-cover-Season-slots migration', () => {
  it('covers each linked event\'s template-listed slots, puts every contest and cup in its Season, gives a templateless configuration its league\'s template, and points a pending draw at a covered slot', async () => {
    const seeded = await seedLeague();
    const { onEvent, templateless, eventless } = seeded.contests;
    const ids = [onEvent, templateless, eventless];
    const prisma = getPrisma();

    const migrated = await prisma.$transaction(async (tx) => {
      for (const statement of PUT_BACK) {
        // poolmaster-allow-query-in-loop: the schema put back, one statement at a time
        await tx.$executeRawUnsafe(statement);
      }
      // The old rows: the configuration with no template, and the draw's receipts pending on the event.
      await tx.$executeRaw`${uncachedStatement()} UPDATE "contest_configurations" SET "template_id" = NULL WHERE "contest_id" = ${templateless}::uuid`;
      await tx.$executeRaw`${uncachedStatement()} UPDATE "contest_draws" SET "receipts_pending_sport_event_id" = ${seeded.event.id}::uuid WHERE "contest_id" = ${onEvent}::uuid`;
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const covered = await tx.$queryRaw<{ contestId: string; slotId: string }[]>`${uncachedStatement()} SELECT "contest_id"::text AS "contestId", "sport_league_season_competition_slot_id"::text AS "slotId" FROM "contest_season_slots" WHERE "contest_id" = ANY(${ids}::uuid[])`;
      const seasons = await tx.$queryRaw<{ id: string; seasonId: string }[]>`${uncachedStatement()} SELECT "id"::text AS "id", "sport_league_season_id"::text AS "seasonId" FROM "contests" WHERE "id" = ANY(${ids}::uuid[])`;
      const configurationRows = await tx.$queryRaw<{ templateId: string | null }[]>`${uncachedStatement()} SELECT "template_id"::text AS "templateId" FROM "contest_configurations" WHERE "contest_id" = ${templateless}::uuid`;
      const pendingRows = await tx.$queryRaw<{ covered: boolean }[]>`${uncachedStatement()} SELECT EXISTS (SELECT 1 FROM "contest_draws" d JOIN "contest_season_slots" css ON css."id" = d."receipts_pending_contest_season_slot_id" WHERE d."contest_id" = ${onEvent}::uuid AND css."contest_id" = ${onEvent}::uuid AND css."sport_league_season_competition_slot_id" = ${seeded.listedSlotId}::uuid) AS "covered"`;
      const cupRows = await tx.$queryRaw<{ seasonId: string | null }[]>`${uncachedStatement()} SELECT "sport_league_season_id"::text AS "seasonId" FROM "cups" WHERE "id" = ${seeded.cupId}::uuid`;
      const result: Migrated = {
        covered: Object.fromEntries(ids.map((id) => [id, covered.filter((row) => row.contestId === id).map((row) => row.slotId)])),
        seasons: Object.fromEntries(seasons.map((row) => [row.id, row.seasonId])),
        templateOfTemplateless: configurationRows.at(0)?.templateId ?? null,
        pendingSlotIsCovered: pendingRows.at(0)?.covered ?? false,
        cupSeason: cupRows.at(0)?.seasonId ?? null,
      };
      throw new Rollback(JSON.stringify(result));
    }, { timeout: 60_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Migrated;
      throw error;
    });

    expect(migrated).toEqual({
      covered: { [onEvent]: [seeded.listedSlotId], [templateless]: [seeded.listedSlotId], [eventless]: [] },
      seasons: { [onEvent]: seeded.sportLeagueSeasonId, [templateless]: seeded.sportLeagueSeasonId, [eventless]: seeded.sportLeagueSeasonId },
      templateOfTemplateless: seeded.templateId,
      pendingSlotIsCovered: true,
      cupSeason: seeded.sportLeagueSeasonId,
    });
  });
});
