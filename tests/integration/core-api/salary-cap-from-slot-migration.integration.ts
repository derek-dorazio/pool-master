/**
 * A budget contest's salary cap is read from its first covered slot's pricing, so the migration
 * drops the copy each stored budget configuration took (#2050), in real Postgres. Rows are written
 * as the old rules held them, the migration's own statements run from its file, and everything is
 * rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { contestOnEvents } from '../../support/contest-rows';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218032200_salary_cap_read_from_slot/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

class Rollback extends Error {}

describe('the salary cap from slot migration', () => {
  it('drops the salary cap a budget contest\'s stored rules copied, keeping the rest of its rules, and leaves a tiered contest\'s rules as they were', async () => {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const templates = await prisma.contestConfigTemplate.findMany({
      where: { selectionType: { in: ['BUDGET_PICK', 'TIERED'] }, active: true },
      select: { id: true, selectionType: true },
    });
    const templateOf = (selectionType: string) => {
      const template = templates.find((row) => row.selectionType === selectionType);
      if (template === undefined) throw new Error(`No seeded ${selectionType} template.`);
      return template.id;
    };
    const tieredRules = { selectionType: 'TIERED', picksPerTier: 1, countedScores: 4 };

    const stored = await prisma.$transaction(async (tx) => {
      const league = await tx.league.create({ data: { cupName: 'Test Cup', leagueCode: `CAP${suffix.toUpperCase()}`, name: `Salary Cap ${suffix}`, iconKey: 'TROPHY' } });
      const coverage = await contestOnEvents(tx, []);
      const budget = await tx.contest.create({ data: { leagueId: league.id, ...coverage, name: `Budget ${suffix}`, status: 'OPEN', contestFormat: 'ROSTER', selectionType: 'BUDGET_PICK' } });
      const tiered = await tx.contest.create({ data: { leagueId: league.id, ...coverage, name: `Tiered ${suffix}`, status: 'OPEN', contestFormat: 'ROSTER', selectionType: 'TIERED' } });
      // As the old rules held them: a budget contest's with the cap it copied on save.
      await tx.contestConfiguration.createMany({
        data: [
          { contestId: budget.id, templateId: templateOf('BUDGET_PICK'), selectionType: 'BUDGET_PICK', configJson: { selectionType: 'BUDGET_PICK', rosterSize: 6, salaryCap: 50_000, countedScores: 4 }, maxEntriesPerSquad: 1 },
          { contestId: tiered.id, templateId: templateOf('TIERED'), selectionType: 'TIERED', configJson: tieredRules, maxEntriesPerSquad: 1 },
        ],
      });
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const rows = await tx.contestConfiguration.findMany({ where: { contestId: { in: [budget.id, tiered.id] } }, select: { selectionType: true, configJson: true } });
      throw new Rollback(JSON.stringify(Object.fromEntries(rows.map((row) => [row.selectionType, row.configJson]))));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Record<string, unknown>;
      throw error;
    });

    expect(stored).toEqual({
      BUDGET_PICK: { selectionType: 'BUDGET_PICK', rosterSize: 6, countedScores: 4 },
      TIERED: tieredRules,
    });
  });
});
