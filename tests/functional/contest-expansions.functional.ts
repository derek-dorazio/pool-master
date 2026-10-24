import {
  enterContest,
  expandContest,
  getContest,
  getContestExpansion,
  grantContestExpansion,
  updateLeaguePlan,
} from '@poolmaster/shared/generated/hey-api';
import { LeaguePaymentKind, LeaguePlan, SelectionType } from '@poolmaster/shared/domain';
import { ContestExpansionResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, seedContestFixture } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// Contest expansions end to end (#987): a Free contest is offered Free's bands above its 20
// entries; expanding it is free while payments are off, raises the cap at once and writes a $0
// line in the league's payment history; a root admin can give any size free, with a reason.

const RUN = `expansions-${Date.now()}`;

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

async function freeContest(name: string, status: 'DRAFT' | 'OPEN' = 'OPEN') {
  const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: `${name} Keeper`, leagueName: `${name} ${RUN}` });
  await updateLeaguePlan({ client: commissioner.client, path: { id: league.id }, body: { plan: LeaguePlan.FREE } });
  const { contestId } = await seedContestFixture(league.id, {
    name: `${name} Picks`,
    selectionType: SelectionType.TIERED,
    status,
    configuration: { maxEntriesPerSquad: 60 },
  });
  return { commissioner, league, contestId };
}

function paymentLines(leagueId: string) {
  return getFunctionalPrisma().leaguePayment.findMany({
    where: { leagueId },
    orderBy: { paidAt: 'asc' },
    select: { kind: true, amountCents: true, description: true, payerId: true },
  });
}

describe('SDK Functional: contest expansions (#987)', () => {
  it('expands a full Free contest to 50 entries free while payments are off, lets the 21st entry in, and steps up for the difference', async () => {
    const { commissioner, league, contestId } = await freeContest('Expand House');
    const path = { id: league.id, contestId };
    const read = async () => ContestExpansionResponseSchema.parse(expectDefined((await getContestExpansion({ client: commissioner.client, path })).data));

    expect(await read()).toEqual({
      entriesPerContest: 20,
      entryCount: 0,
      expandedTo: null,
      expandable: true,
      paymentsEnabled: false,
      offers: [
        { entriesPerContest: 50, priceCents: 1000 },
        { entriesPerContest: 100, priceCents: 2000 },
        { entriesPerContest: 200, priceCents: 3000 },
        { entriesPerContest: 500, priceCents: 4000 },
      ],
    });
    for (let entry = 1; entry <= 20; entry += 1) {
      expect((await enterContest({ client: commissioner.client, path: { contestId } })).response.status).toBe(201);
    }
    expect((await enterContest({ client: commissioner.client, path: { contestId } })).error?.error.code).toBe('CONTEST_FULL');

    const expanded = await expandContest({ client: commissioner.client, path, body: { entriesPerContest: 50 } });

    expect(ContestExpansionResponseSchema.parse(expectDefined(expanded.data))).toEqual({
      entriesPerContest: 50,
      entryCount: 20,
      expandedTo: 50,
      expandable: true,
      paymentsEnabled: false,
      // A step up is the band's price less the $10 already "bought".
      offers: [
        { entriesPerContest: 100, priceCents: 1000 },
        { entriesPerContest: 200, priceCents: 2000 },
        { entriesPerContest: 500, priceCents: 3000 },
      ],
    });
    expect((await enterContest({ client: commissioner.client, path: { contestId } })).response.status).toBe(201);
    // Every contest read carries the contest's own cap, so the contest page shows 21 of 50.
    expect((await getContest({ client: commissioner.client, path: { contestId } })).data?.contest.entriesPerContest).toBe(50);

    await expandContest({ client: commissioner.client, path, body: { entriesPerContest: 100 } });
    expect(await paymentLines(league.id)).toEqual([
      { kind: LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF, amountCents: 0, description: 'Expand House Picks: up to 50 entries, free while payments are off', payerId: commissioner.userId },
      { kind: LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF, amountCents: 0, description: 'Expand House Picks: 50 to 100 entries, free while payments are off', payerId: commissioner.userId },
    ]);
  });

  it('lets a commissioner expand a draft contest before it opens', async () => {
    const { commissioner, league, contestId } = await freeContest('Draft House', 'DRAFT');

    const expanded = await expandContest({ client: commissioner.client, path: { id: league.id, contestId }, body: { entriesPerContest: 200 } });

    expect(expanded.data?.entriesPerContest).toBe(200);
  });

  it('refuses a band not offered and one already passed with 409 CONTEST_EXPANSION_BAND_UNAVAILABLE, writing nothing', async () => {
    const { commissioner, league, contestId } = await freeContest('Odd Sizes');
    const path = { id: league.id, contestId };
    await expandContest({ client: commissioner.client, path, body: { entriesPerContest: 100 } });

    const odd = await expandContest({ client: commissioner.client, path, body: { entriesPerContest: 75 } });
    const passed = await expandContest({ client: commissioner.client, path, body: { entriesPerContest: 50 } });

    expect([odd.response.status, odd.error?.error.code]).toEqual([409, 'CONTEST_EXPANSION_BAND_UNAVAILABLE']);
    expect([passed.response.status, passed.error?.error.code]).toEqual([409, 'CONTEST_EXPANSION_BAND_UNAVAILABLE']);
    expect(await paymentLines(league.id)).toHaveLength(1);
  });

  it('refuses another league\'s contest with 404 CONTEST_NOT_FOUND', async () => {
    const { commissioner, league } = await freeContest('Home League');
    const other = await freeContest('Away League');

    const read = await getContestExpansion({ client: commissioner.client, path: { id: league.id, contestId: other.contestId } });

    expect([read.response.status, read.error?.error.code]).toEqual([404, 'CONTEST_NOT_FOUND']);
  });

  it('refuses a commissioner\'s expansion in an inactive league with 400 LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE, but lets a root admin give one', async () => {
    const { commissioner, league, contestId } = await freeContest('Closed Doors');
    const admin = await buildRegisteredUser({ displayName: 'Door Opener' });
    await promoteToRootAdmin(admin);
    await getFunctionalPrisma().league.update({ where: { id: league.id }, data: { isActive: false } });
    const path = { id: league.id, contestId };

    const refused = await expandContest({ client: commissioner.client, path, body: { entriesPerContest: 50 } });
    const granted = await grantContestExpansion({ client: admin.client, path, body: { entriesPerContest: 50, reason: 'Reactivating soon' } });

    expect([refused.response.status, refused.error?.error.code]).toEqual([400, 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE']);
    expect(granted.data?.entriesPerContest).toBe(50);
    expect(await paymentLines(league.id)).toEqual([
      expect.objectContaining({ kind: LeaguePaymentKind.CONTEST_EXPANSION_GRANT }),
    ]);
  });

  it('keeps prices and expanding to the league\'s commissioners: anyone else gets 403', async () => {
    const { league, contestId } = await freeContest('Members Only');
    const outsider = await buildRegisteredUser({ displayName: 'Price Peeker' });
    const path = { id: league.id, contestId };

    expect((await getContestExpansion({ client: outsider.client, path })).response.status).toBe(403);
    expect((await expandContest({ client: outsider.client, path, body: { entriesPerContest: 50 } })).response.status).toBe(403);
  });

  it('lets a root admin give any size above the cap free with a reason, recorded as a $0 grant, and refuses a commissioner', async () => {
    const { commissioner, league, contestId } = await freeContest('Favour House');
    const admin = await buildRegisteredUser({ displayName: 'Grant Giver' });
    await promoteToRootAdmin(admin);
    const path = { id: league.id, contestId };

    const byCommissioner = await grantContestExpansion({ client: commissioner.client, path, body: { entriesPerContest: 300, reason: 'Please' } });
    const tooSmall = await grantContestExpansion({ client: admin.client, path, body: { entriesPerContest: 20, reason: 'No change' } });
    const granted = await grantContestExpansion({ client: admin.client, path, body: { entriesPerContest: 300, reason: 'Charity pool' } });

    expect(byCommissioner.response.status).toBe(403);
    expect([tooSmall.response.status, tooSmall.error?.error.code]).toEqual([409, 'CONTEST_EXPANSION_NOT_ABOVE_CAP']);
    expect(granted.data).toMatchObject({ entriesPerContest: 300, expandedTo: 300 });
    expect(await paymentLines(league.id)).toEqual([
      { kind: LeaguePaymentKind.CONTEST_EXPANSION_GRANT, amountCents: 0, description: 'Favour House Picks: up to 300 entries, given free by Poolmaster: Charity pool', payerId: admin.userId },
    ]);
  });
});
