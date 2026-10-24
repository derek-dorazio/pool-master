import {
  acceptInvitation,
  generateInviteLink,
  getLeague,
  listLeaguePlans,
  updateLeaguePlan,
} from '@poolmaster/shared/generated/hey-api';
import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { LeagueContextResponseSchema, LeaguePlanListResponseSchema, LeagueResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getSdkClient } from './setup';
import { expectDefined } from '../support/expect-defined';

// Choosing a plan end to end (#945): a commissioner reads the comparison table, moves the league
// down to Free and back up, a member is refused, and a root admin outside the league changes it.

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: choosing a league plan (#945)', () => {
  it('lets a commissioner and a root admin change the plan at once, refuses a member, and every read of the league carries the new plan', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Plan Picker', leagueName: 'Plan Pickers' });
    const member = await buildRegisteredUser({ displayName: 'Plan Bystander' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    // --- The comparison table: four plans, lowest first ------------------------------------
    const plans = LeaguePlanListResponseSchema.parse(expectDefined((await listLeaguePlans({ client: commissioner.client })).data)).plans;
    expect(plans.map((plan) => plan.plan)).toEqual([LeaguePlan.FREE, LeaguePlan.PRO, LeaguePlan.PREMIUM, LeaguePlan.PLATINUM]);

    // --- Down to Free -----------------------------------------------------------------------
    const free = await updateLeaguePlan({ client: commissioner.client, path: { id: league.id }, body: { plan: LeaguePlan.FREE } });
    expect(LeagueResponseSchema.parse(expectDefined(free.data)).league.planEntitlements).toMatchObject({
      plan: LeaguePlan.FREE,
      caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 },
    });
    const memberView = LeagueContextResponseSchema.parse(expectDefined((await getLeague({ client: member.client, path: { id: league.id } })).data));
    expect(memberView.league.planEntitlements.features).not.toContain(PlanFeature.CHAMPIONSHIP);

    // --- A member may not change it -----------------------------------------------------------
    const refused = await updateLeaguePlan({ client: member.client, path: { id: league.id }, body: { plan: LeaguePlan.PLATINUM } });
    expect(refused.response.status).toBe(403);

    // --- A root admin outside the league moves it back up --------------------------------------
    const admin = await buildRegisteredUser({ displayName: 'Plan Director' });
    await promoteToRootAdmin(admin);
    const restored = await updateLeaguePlan({ client: admin.client, path: { id: league.id }, body: { plan: LeaguePlan.PLATINUM } });
    expect(LeagueResponseSchema.parse(expectDefined(restored.data)).league.planEntitlements.caps)
      .toEqual({ ENTRIES_PER_CONTEST: null, SPORTS_LEAGUES_PER_YEAR: null });
  });

  it('lets a visitor who is not signed in read every plan, lowest first, with its caps and features from the plan settings', async () => {
    const response = await listLeaguePlans({ client: getSdkClient() });

    expect(response.response.status).toBe(200);
    const plans = LeaguePlanListResponseSchema.parse(expectDefined(response.data)).plans;
    expect(plans.map((plan) => plan.plan)).toEqual([LeaguePlan.FREE, LeaguePlan.PRO, LeaguePlan.PREMIUM, LeaguePlan.PLATINUM]);
    expect(plans[0]?.caps).toEqual({ ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 });
    expect(plans[2]?.features).toContain(PlanFeature.ALL_TIME_SUMMARY);
    expect(plans[2]?.features).not.toContain(PlanFeature.RECORD_BOOK);
  });
});
