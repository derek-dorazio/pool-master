/**
 * #340 — every uuid `id` carries `DEFAULT gen_random_uuid()`, and nothing about Prisma's
 * write API changed because of it.
 *
 * `schema.prisma` used to declare `@default(uuid())` on every uuid `id`. Prisma generates that
 * value application-side, so the column was left with no database default — while five tables
 * had nonetheless acquired one in earlier migrations. The schema and the migration history
 * therefore disagreed in 7 places, and #340 reconciled them by extending the database default
 * to all 37 uuid `id` columns and declaring it as `@default(dbgenerated("gen_random_uuid()"))`.
 *
 * Two claims hold that reconciliation up, and both are asserted here against a real database
 * rather than argued:
 *
 *   1. The reason for choosing this direction: raw SQL that omits `id` now works. That is what
 *      reference-data migrations and bootstrap scripts do, and before this change they had to
 *      call `gen_random_uuid()` by hand — `20261004140000_seed_golf_sport_reference_row` does
 *      exactly that, precisely because `sports.id` had no default.
 *   2. The reason it is safe: `dbgenerated` changes nothing Prisma-side. An explicitly supplied
 *      id is still accepted, and an omitted one still produces a row.
 *
 * The `sport_leagues.name` / `match_keyword` half of #340 is also covered: the schema now
 * declares `@db.VarChar(255)` for columns the database had always bounded at 255, and the bound
 * is asserted to be real rather than taken on trust.
 *
 * The drift itself is gated by `npm run db:drift:check` and the `schema-migration-drift` CI job;
 * this suite covers the behavior that gate cannot see.
 */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

/** Every row this suite creates carries this prefix in its natural key, so cleanup is exact. */
const SPORT_NAME_PREFIX = 'UUIDDEFAULT';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uniqueSportName(): string {
  return `${SPORT_NAME_PREFIX}_${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function removeSuiteRows(): Promise<void> {
  const prisma = getPrisma();
  // sport_leagues first: it holds the FK to sports.
  await prisma.sportLeague.deleteMany({
    where: { sport: { name: { startsWith: SPORT_NAME_PREFIX } } },
  });
  await prisma.sport.deleteMany({ where: { name: { startsWith: SPORT_NAME_PREFIX } } });
}

beforeAll(() => setupIntegrationTests());
afterEach(() => removeSuiteRows());
afterAll(async () => {
  await removeSuiteRows();
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('#340 database-generated uuid ids', () => {
  it('accepts a raw INSERT that omits id, and generates one', async () => {
    const prisma = getPrisma();
    const name = uniqueSportName();

    // No "id" column. Before #340 this failed on the NOT NULL constraint, which is why
    // reference-data migrations had to supply gen_random_uuid() themselves.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "sports" ("name", "participant_type", "category", "tournament_format", "created_at", "updated_at")
       VALUES ($1, 'INDIVIDUAL', 'GOLF', 'STROKE_PLAY_TOURNAMENT', NOW(), NOW())`,
      name,
    );

    const inserted = await prisma.sport.findUnique({ where: { name } });
    expect(inserted).not.toBeNull();
    expect(inserted?.id).toMatch(UUID_PATTERN);
  });

  it('still accepts an explicitly supplied id through Prisma', async () => {
    const prisma = getPrisma();
    const chosenId = randomUUID();
    const name = uniqueSportName();

    // The claim #340 makes about write paths: `dbgenerated` does not take the id away from
    // the caller. Every repository in this codebase that supplies one keeps working.
    const created = await prisma.sport.create({
      data: {
        id: chosenId,
        name,
        participantType: 'INDIVIDUAL',
        category: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });

    expect(created.id).toBe(chosenId);
    const reread = await prisma.sport.findUnique({ where: { name } });
    expect(reread?.id).toBe(chosenId);
  });

  it('still generates an id when Prisma omits it', async () => {
    const prisma = getPrisma();
    const name = uniqueSportName();

    const created = await prisma.sport.create({
      data: {
        name,
        participantType: 'INDIVIDUAL',
        category: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });

    expect(created.id).toMatch(UUID_PATTERN);
  });

  it('generates distinct ids across rows inserted in one statement', async () => {
    const prisma = getPrisma();
    const first = uniqueSportName();
    const second = uniqueSportName();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "sports" ("name", "participant_type", "category", "tournament_format", "created_at", "updated_at")
       VALUES ($1, 'INDIVIDUAL', 'GOLF', 'STROKE_PLAY_TOURNAMENT', NOW(), NOW()),
              ($2, 'INDIVIDUAL', 'GOLF', 'STROKE_PLAY_TOURNAMENT', NOW(), NOW())`,
      first,
      second,
    );

    const rows = await prisma.sport.findMany({
      where: { name: { in: [first, second] } },
      select: { id: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });
});

describe('#340 sport_leagues bounded text columns', () => {
  async function seedSport(): Promise<string> {
    const sport = await getPrisma().sport.create({
      data: {
        name: uniqueSportName(),
        participantType: 'INDIVIDUAL',
        category: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });
    return sport.id;
  }

  it('stores a name and matchKeyword of exactly 255 characters', async () => {
    const prisma = getPrisma();
    const sportId = await seedSport();

    // The declared bound is the one the database has always had. 255 must still fit.
    const created = await prisma.sportLeague.create({
      data: { sportId, name: 'n'.repeat(255), matchKeyword: 'k'.repeat(255) },
    });

    expect(created.name).toHaveLength(255);
    expect(created.matchKeyword).toHaveLength(255);
  });

  it('rejects a name longer than 255 characters, so the declared bound is real', async () => {
    const prisma = getPrisma();
    const sportId = await seedSport();

    // Before #340 the schema declared unbounded `String` for a column the database bounded at
    // 255. The schema was the artifact that was wrong, and this is the behavior it misdescribed.
    await expect(
      prisma.sportLeague.create({ data: { sportId, name: 'n'.repeat(256) } }),
    ).rejects.toThrow();
  });

  it('rejects a matchKeyword longer than 255 characters', async () => {
    const prisma = getPrisma();
    const sportId = await seedSport();

    await expect(
      prisma.sportLeague.create({
        data: { sportId, name: uniqueSportName(), matchKeyword: 'k'.repeat(256) },
      }),
    ).rejects.toThrow();
  });
});
