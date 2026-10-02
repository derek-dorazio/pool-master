/**
 * #193 — the contest routes reached by `:contestId` authorized nowhere: any signed-in user could
 * read, rename or delete any contest by id. Reads now require membership of the contest's league
 * (`requireMemberOfLeague`); writes require its commissioner (`requireCommissionerForContest`).
 *
 * Real HTTP through the generated SDK against a spawned server, because a route-level gate is only
 * observable there. Each denial also re-reads the contest as its commissioner, so a 403 that still
 * wrote fails too. That is not hypothetical: `requireCommissionerForContest` sent its 403 without
 * awaiting the reply, so Fastify ran the handler anyway and the write landed behind the refusal —
 * on the four lifecycle routes it already guarded, as well as on the routes #193 gates with it.
 */
import {
  acceptInvitation,
  closeContest,
  deleteContest,
  generateInviteLink,
  getContest,
  updateContest,
} from '@poolmaster/shared/generated/hey-api';
import { ScoringEngine, SelectionType } from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser, seedContestFixture } from './builders';
import type { RegisteredUserContext } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

async function buildContestWithMemberAndOutsider() {
  const { commissioner, league } = await buildLeagueWithCommissioner({
    displayName: 'Authz Commissioner',
    leagueName: 'Contest Authorization League',
  });
  const member = await buildRegisteredUser({ displayName: 'Authz Member' });
  const outsider = await buildRegisteredUser({ displayName: 'Authz Outsider' });

  const inviteLink = await generateInviteLink({
    client: commissioner.client,
    path: { id: league.id },
    body: { maxUses: 1 },
  });
  const accepted = await acceptInvitation({
    client: member.client,
    body: { inviteCode: inviteLink.data?.invitation.inviteCode as string },
  });
  expect(accepted.data?.membership.userId).toBe(member.userId);
  expect(accepted.data?.membership.role).toBe('MEMBER');

  const { contestId } = await seedContestFixture(league.id, {
    name: 'Authorization Contest',
    selectionType: SelectionType.BUDGET_PICK,
    scoringEngine: ScoringEngine.POSITION,
  });

  return { commissioner, member, outsider, contestId: contestId as string };
}

async function expectContestUnchanged(commissioner: RegisteredUserContext, contestId: string) {
  const reread = await getContest({ client: commissioner.client, path: { contestId } });
  expect(reread.response.status).toBe(200);
  expect(reread.data?.contest.name).toBe('Authorization Contest');
  expect(reread.data?.contest.isExclusive).toBe(false);
}

describe('SDK Functional: contest authorization by id (#193)', () => {
  it('lets a league member who is not a commissioner read the contest', async () => {
    const { member, contestId } = await buildContestWithMemberAndOutsider();

    const response = await getContest({ client: member.client, path: { contestId } });

    expect(response.response.status).toBe(200);
    expect(response.data?.contest.id).toBe(contestId);
  });

  it('refuses a league member who is not a commissioner a PUT, and leaves the contest unchanged', async () => {
    const { commissioner, member, contestId } = await buildContestWithMemberAndOutsider();

    const response = await updateContest({
      client: member.client,
      path: { contestId },
      body: { name: 'Renamed By A Member', isExclusive: true },
    });

    expectFunctionalError(response, { status: 403, code: 'LEAGUE_PERMISSION_DENIED' });
    await expectContestUnchanged(commissioner, contestId);
  });

  it('refuses a league member who is not a commissioner a DELETE, and the contest survives', async () => {
    const { commissioner, member, contestId } = await buildContestWithMemberAndOutsider();

    const response = await deleteContest({ client: member.client, path: { contestId } });

    expectFunctionalError(response, { status: 403, code: 'LEAGUE_PERMISSION_DENIED' });
    await expectContestUnchanged(commissioner, contestId);
  });

  it('refuses a user outside the league a GET', async () => {
    const { outsider, contestId } = await buildContestWithMemberAndOutsider();

    const response = await getContest({ client: outsider.client, path: { contestId } });

    expectFunctionalError(response, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
  });

  it('refuses a user outside the league a PUT and a DELETE, and the contest is untouched', async () => {
    const { commissioner, outsider, contestId } = await buildContestWithMemberAndOutsider();

    const updateResponse = await updateContest({
      client: outsider.client,
      path: { contestId },
      body: { name: 'Renamed By An Outsider' },
    });
    expectFunctionalError(updateResponse, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });

    const deleteResponse = await deleteContest({ client: outsider.client, path: { contestId } });
    expectFunctionalError(deleteResponse, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });

    await expectContestUnchanged(commissioner, contestId);
  });

  it('refuses a league member a lifecycle override, and the override does not run behind the 403', async () => {
    const { commissioner, member, contestId } = await buildContestWithMemberAndOutsider();

    const response = await closeContest({ client: member.client, path: { contestId } });

    expectFunctionalError(response, { status: 403, code: 'LEAGUE_PERMISSION_DENIED' });
    const reread = await getContest({ client: commissioner.client, path: { contestId } });
    expect(reread.data?.contest.status).toBe('DRAFT');
  });

  it('still lets the commissioner update and delete the contest', async () => {
    const { commissioner, contestId } = await buildContestWithMemberAndOutsider();

    const updateResponse = await updateContest({
      client: commissioner.client,
      path: { contestId },
      body: { name: 'Renamed By The Commissioner' },
    });
    expect(updateResponse.response.status).toBe(200);
    expect(updateResponse.data?.contest.name).toBe('Renamed By The Commissioner');

    const deleteResponse = await deleteContest({ client: commissioner.client, path: { contestId } });
    expect(deleteResponse.response.status).toBe(204);
  });
});
