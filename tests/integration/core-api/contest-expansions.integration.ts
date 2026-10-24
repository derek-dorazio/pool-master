/**
 * The contest expansion and league payment tables (#980), against a real database: what the
 * schema refuses, and what deleting a contest keeps. The entry cap they feed is covered with the
 * entry repository in contest-repositories.integration.ts.
 */
import { randomUUID } from 'node:crypto';
import { LeaguePaymentKind } from '@poolmaster/shared/domain';
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
