/**
 * The contest expansion and league payment tables (#980), against a real database: what the
 * schema refuses, and what deleting a contest keeps. The entry cap they feed is covered with the
 * entry repository in contest-repositories.integration.ts.
 */
import { randomUUID } from 'node:crypto';
import { LeaguePaymentKind } from '@poolmaster/shared/domain';
import type { ContestExpansionWrite } from '@poolmaster/shared/db';
import { PrismaContestExpansionRepository } from '../../../packages/core-api/src/adapters';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

async function createLeagueAndContest() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const payer = await createTestUser({ displayName: `Expansion Payer ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `XPAN${suffix.toUpperCase()}`, name: `Expansion League ${suffix}` },
  });
  // The commissioner's membership is what lets cleanupTestData find the league.
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: payer.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const contest = await prisma.contest.create({
    data: { leagueId: league.id, seasonYear: 2026, name: 'Masters Pool', selectionType: 'TIERED' },
  });
  return { league, contest, payer: payer.user };
}

async function expand(leagueId: string, contestId: string, entriesPerContest: number, payerId: string) {
  const prisma = getPrisma();
  const payment = await prisma.leaguePayment.create({
    data: {
      leagueId,
      contestId,
      payerId,
      kind: LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF,
      amountCents: 0,
      description: `Masters Pool: up to ${entriesPerContest} entries, free while payments are off`,
    },
  });
  return prisma.contestExpansion.create({ data: { contestId, entriesPerContest, paymentId: payment.id } });
}

describe('contest_expansions and league_payments', () => {
  it('keeps a step up as a second expansion row, so the contest\'s history holds both bands', async () => {
    const { league, contest, payer } = await createLeagueAndContest();

    await expand(league.id, contest.id, 100, payer.id);
    await expand(league.id, contest.id, 200, payer.id);

    const bands = await getPrisma().contestExpansion.findMany({ where: { contestId: contest.id }, orderBy: { entriesPerContest: 'asc' } });
    expect(bands.map((row) => row.entriesPerContest)).toEqual([100, 200]);
  });

  it('refuses the same band twice for one contest', async () => {
    const { league, contest, payer } = await createLeagueAndContest();
    await expand(league.id, contest.id, 100, payer.id);

    await expect(expand(league.id, contest.id, 100, payer.id)).rejects.toThrow(/Unique constraint/);
  });

  it('refuses a payment with a negative amount and an expansion to no entries', async () => {
    const { league, contest } = await createLeagueAndContest();
    const prisma = getPrisma();

    await expect(prisma.leaguePayment.create({
      data: { leagueId: league.id, kind: LeaguePaymentKind.CONTEST_EXPANSION_GRANT, amountCents: -100, description: 'Below zero' },
    })).rejects.toThrow(/league_payments_amount_cents_not_negative/);
    const payment = await prisma.leaguePayment.create({
      data: { leagueId: league.id, contestId: contest.id, kind: LeaguePaymentKind.CONTEST_EXPANSION_GRANT, amountCents: 0, description: 'Given free' },
    });
    await expect(prisma.contestExpansion.create({
      data: { contestId: contest.id, entriesPerContest: 0, paymentId: payment.id },
    })).rejects.toThrow(/contest_expansions_entries_per_contest_positive/);
  });

  it('drops a deleted contest\'s expansions and keeps its payment history line, naming no contest', async () => {
    const { league, contest, payer } = await createLeagueAndContest();
    const expansion = await expand(league.id, contest.id, 200, payer.id);

    await getPrisma().contest.delete({ where: { id: contest.id } });

    await expect(getPrisma().contestExpansion.count({ where: { contestId: contest.id } })).resolves.toBe(0);
    await expect(getPrisma().leaguePayment.findUnique({ where: { id: expansion.paymentId } })).resolves.toMatchObject({
      contestId: null,
      payerId: payer.id,
      description: 'Masters Pool: up to 200 entries, free while payments are off',
    });
  });

  it('keeps a payment history line when its payer\'s account is deleted, naming nobody', async () => {
    const { league, contest } = await createLeagueAndContest();
    const { user: payer } = await createTestUser({ displayName: 'Departing Payer' });
    const expansion = await expand(league.id, contest.id, 200, payer.id);

    await getPrisma().user.delete({ where: { id: payer.id } });

    await expect(getPrisma().leaguePayment.findUnique({ where: { id: expansion.paymentId } })).resolves.toMatchObject({ payerId: null });
  });
});

describe('PrismaContestExpansionRepository (#987)', () => {
  const repo = () => new PrismaContestExpansionRepository(getPrisma());
  const write = (leagueId: string, contestId: string, payerId: string, entriesPerContest: number): ContestExpansionWrite => ({
    contestId,
    leagueId,
    entriesPerContest,
    payerId,
    kind: LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF,
    amountCents: 0,
    describe: (expandedTo) => `${expandedTo ?? 'none'} to ${entriesPerContest}`,
  });

  it('reads a contest with no expansion and no entries as such', async () => {
    const { contest } = await createLeagueAndContest();

    await expect(repo().findState(contest.id)).resolves.toEqual({ expandedTo: null, entryCount: 0 });
  });

  it('writes the expansion with its payment line, described from the band it had, and reads the highest band back', async () => {
    const { league, contest, payer } = await createLeagueAndContest();

    await expect(repo().expand(write(league.id, contest.id, payer.id, 100))).resolves.toEqual({ status: 'expanded', expandedTo: 100 });
    await expect(repo().expand(write(league.id, contest.id, payer.id, 200))).resolves.toEqual({ status: 'expanded', expandedTo: 200 });

    await expect(repo().findState(contest.id)).resolves.toEqual({ expandedTo: 200, entryCount: 0 });
    const lines = await getPrisma().leaguePayment.findMany({ where: { leagueId: league.id }, orderBy: { paidAt: 'asc' } });
    expect(lines.map((line) => line.description)).toEqual(['none to 100', '100 to 200']);
  });

  it('writes nothing for a band at or below the contest\'s highest, answering notAbove with that band', async () => {
    const { league, contest, payer } = await createLeagueAndContest();
    await repo().expand(write(league.id, contest.id, payer.id, 200));

    await expect(repo().expand(write(league.id, contest.id, payer.id, 100))).resolves.toEqual({ status: 'notAbove', expandedTo: 200 });
    await expect(getPrisma().leaguePayment.count({ where: { leagueId: league.id } })).resolves.toBe(1);
  });

  it('lets only one of two commissioners expanding to the same band at once write it', async () => {
    const { league, contest, payer } = await createLeagueAndContest();

    const results = await Promise.all([
      repo().expand(write(league.id, contest.id, payer.id, 100)),
      repo().expand(write(league.id, contest.id, payer.id, 100)),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['expanded', 'notAbove']);
    await expect(getPrisma().leaguePayment.count({ where: { leagueId: league.id } })).resolves.toBe(1);
  });
});
