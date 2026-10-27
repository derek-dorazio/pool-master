import { ContestStatus, LeaguePlan, LeaguePaymentKind } from '@poolmaster/shared/domain';
import type { BillingConfig } from '@poolmaster/shared/dto';
import type { ContestExpansionWrite, ContestExpansionWriteResult } from '@poolmaster/shared/db';
import { ContestExpansionService } from '../../../packages/core-api/src/modules/billing/contest-expansion-service';
import { BILLING_SETTINGS } from '../../../packages/core-api/src/modules/billing/billing-settings';
import type { ContestExpansionNotice } from '../../../packages/core-api/src/modules/notifications/contest-expanded-notices';
import { buildContest, buildLeague } from '../../factories';
import { planEntitlementsOver } from '../../support/plan-entitlements';
import { fakeLogger } from '../../support/fake-logger';

// Contest expansions (#987): what a commissioner is offered and may expand to, what a root admin
// may give, and what each writes, against fakes of the contest, expansion and entry-window reads.

function setup(options: { status?: ContestStatus; entriesOpen?: boolean; config?: BillingConfig; expandedTo?: number | null; raceTo?: number; leagueActive?: boolean } = {}) {
  const league = buildLeague({ plan: LeaguePlan.FREE, isActive: options.leagueActive ?? true });
  const contest = buildContest({ leagueId: league.id, name: 'Masters Pool', status: options.status ?? ContestStatus.OPEN });
  let expandedTo = options.expandedTo ?? null;
  const writes: ContestExpansionWrite[] = [];
  const told: ContestExpansionNotice[] = [];
  const service = new ContestExpansionService({
    contests: { findById: async (id) => (id === contest.id ? contest : null) },
    leagues: { findById: async (id) => (id === league.id ? league : null) },
    expansions: {
      findState: async () => ({ expandedTo, entryCount: 20 }),
      findHighestBands: async () => new Map(),
      expand: async (write): Promise<ContestExpansionWriteResult> => {
        // Another expansion that landed while this one waited for the lock.
        const highest = options.raceTo ?? expandedTo;
        if (highest !== null && highest >= write.entriesPerContest) return { status: 'notAbove', expandedTo: highest };
        writes.push(write);
        expandedTo = write.entriesPerContest;
        return { status: 'expanded', expandedTo };
      },
    },
    planEntitlements: planEntitlementsOver({ findById: async (id) => (id === league.id ? league : null) }),
    entryWindow: { areEntriesOpen: async () => options.entriesOpen ?? true },
    readConfig: () => options.config ?? BILLING_SETTINGS.defaults({}),
    expanded: { tellExpanded: async (notice) => { told.push(notice); } },
    logger: fakeLogger(),
  });
  return { service, league, contest, writes, told };
}

describe('ContestExpansionService', () => {
  it('expands to an offered band with a $0 "free while payments are off" line naming the commissioner, and tells the other commissioners', async () => {
    const { service, league, contest, writes, told } = setup();

    const state = await service.expand(league.id, contest.id, 200, 'commissioner-1');

    expect(state).toMatchObject({ entriesPerContest: 200, expandedTo: 200 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ contestId: contest.id, leagueId: league.id, entriesPerContest: 200, payerId: 'commissioner-1', kind: LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF, amountCents: 0 });
    expect([writes[0].describe(null), writes[0].describe(50)]).toEqual([
      'Masters Pool: up to 200 entries, free while payments are off',
      'Masters Pool: 50 to 200 entries, free while payments are off',
    ]);
    expect(told).toEqual([{ contest, entriesPerContest: 200, expandedById: 'commissioner-1', granted: false }]);
  });

  it('refuses to expand while payments are on, because checkout is not built, and writes nothing', async () => {
    const { service, league, contest, writes } = setup({ config: { ...BILLING_SETTINGS.defaults({}), paymentsEnabled: true } });

    await expect(service.expand(league.id, contest.id, 50, 'commissioner-1')).rejects.toMatchObject({ code: 'PAYMENTS_CHECKOUT_UNAVAILABLE', statusCode: 409 });
    expect(writes).toEqual([]);
  });

  it('shows the price of each band while payments are on, so a commissioner sees what it would cost', async () => {
    const { service, league, contest } = setup({ config: { ...BILLING_SETTINGS.defaults({}), paymentsEnabled: true } });

    const state = await service.getExpansion(league.id, contest.id);

    expect(state.paymentsEnabled).toBe(true);
    expect(state.offers[0]).toEqual({ entriesPerContest: 50, priceCents: 1000 });
  });

  it('offers nothing and refuses to expand once the contest has stopped taking entries', async () => {
    const { service, league, contest, writes } = setup({ status: ContestStatus.ACTIVE, entriesOpen: false });

    await expect(service.getExpansion(league.id, contest.id)).resolves.toMatchObject({ expandable: false, offers: [] });
    await expect(service.expand(league.id, contest.id, 50, 'commissioner-1')).rejects.toMatchObject({ code: 'CONTEST_EXPANSION_CLOSED' });
    expect(writes).toEqual([]);
  });

  it('refuses to expand a contest of an inactive league, which is read-only, and writes nothing', async () => {
    const { service, league, contest, writes } = setup({ leagueActive: false });

    await expect(service.expand(league.id, contest.id, 50, 'commissioner-1')).rejects.toMatchObject({ code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE', statusCode: 400 });
    expect(writes).toEqual([]);
  });

  it('lets a root admin give an expansion to a contest of an inactive league', async () => {
    const { service, league, contest, writes } = setup({ leagueActive: false });

    await expect(service.grant(league.id, contest.id, 75, 'Charity pool', 'admin-1')).resolves.toMatchObject({ entriesPerContest: 75 });
    expect(writes).toHaveLength(1);
  });

  it('lets a draft contest be expanded although it takes no entries yet', async () => {
    const { service, league, contest } = setup({ status: ContestStatus.DRAFT, entriesOpen: false });

    await expect(service.expand(league.id, contest.id, 50, 'commissioner-1')).resolves.toMatchObject({ expandable: true, entriesPerContest: 50 });
  });

  it('refuses with CONTEST_EXPANSION_NOT_ABOVE_CAP when another expansion to that band or higher landed first, and tells no one', async () => {
    const { service, league, contest, writes, told } = setup({ raceTo: 200 });

    await expect(service.expand(league.id, contest.id, 100, 'commissioner-1')).rejects.toMatchObject({ code: 'CONTEST_EXPANSION_NOT_ABOVE_CAP', statusCode: 409 });
    expect(writes).toEqual([]);
    expect(told).toEqual([]);
  });

  it('refuses a contest from another league with CONTEST_NOT_FOUND', async () => {
    const { service, contest } = setup();

    await expect(service.getExpansion('another-league', contest.id)).rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
  });

  it('gives a root admin\'s expansion of any size above the cap, even after entries close, as a $0 grant with the reason, told as a grant', async () => {
    const { service, league, contest, writes, told } = setup({ status: ContestStatus.COMPLETED, entriesOpen: false });

    await service.grant(league.id, contest.id, 333, '  Dispute settled  ', 'admin-1');

    expect(writes[0]).toMatchObject({ entriesPerContest: 333, payerId: 'admin-1', kind: LeaguePaymentKind.CONTEST_EXPANSION_GRANT, amountCents: 0 });
    expect(writes[0].describe(null)).toBe('Masters Pool: up to 333 entries, given free by Primetime Commissioner: Dispute settled');
    expect(told).toEqual([{ contest, entriesPerContest: 333, expandedById: 'admin-1', granted: true }]);
  });

  it('refuses a root admin\'s grant at or below the contest\'s cap', async () => {
    const { service, league, contest, writes } = setup();

    await expect(service.grant(league.id, contest.id, 20, 'Nothing', 'admin-1')).rejects.toMatchObject({ code: 'CONTEST_EXPANSION_NOT_ABOVE_CAP' });
    expect(writes).toEqual([]);
  });
});
