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
  enterContest,
  generateInviteLink,
  getContest,
  getContestEntry,
  getDraftState,
  getGolfContestLeaderboard,
  getMyContestEntry,
  leaveContest,
  listContestEntries,
  listContests,
  removeMember,
  updateContest,
  updateContestEntry,
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

async function buildContestWithMemberAndOutsider(status: 'DRAFT' | 'OPEN' = 'OPEN') {
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
    status,
  });

  return { commissioner, member, outsider, league, contestId };
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
    expect(reread.data?.contest.status).toBe('OPEN');
  });

  it('still lets the commissioner update and delete the contest while it is a draft', async () => {
    const { commissioner, contestId } = await buildContestWithMemberAndOutsider('DRAFT');

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

/**
 * #291 — the rest of #193's defect class. Four contest reads and the league's contest list
 * authorized nowhere; and the entry mutations accepted a member who had left the league, because
 * leaving keeps both membership rows as INACTIVE and nothing checked status. Every refused write
 * is followed by a re-read of the entry, since "403 and the write lands anyway" is this class.
 */
describe('SDK Functional: contest reads and entry access (#291)', () => {
  it('refuses a user outside the league each newly gated read', async () => {
    const { commissioner, outsider, league, contestId } = await buildContestWithMemberAndOutsider();
    const entered = await enterContest({ client: commissioner.client, path: { contestId } });
    const entryId = entered.data?.entry.id as string;
    expect(entryId).toBeTruthy();

    const reads = {
      listContestEntries: await listContestEntries({ client: outsider.client, path: { contestId } }),
      getContestEntry: await getContestEntry({ client: outsider.client, path: { contestId, entryId } }),
      getGolfContestLeaderboard: await getGolfContestLeaderboard({ client: outsider.client, path: { contestId } }),
      getDraftState: await getDraftState({ client: outsider.client, path: { contestId } }),
      listContests: await listContests({ client: outsider.client, path: { id: league.id } }),
    };
    // All five at once, so a failure names every read that let the outsider through.
    expect(Object.fromEntries(Object.entries(reads).map(([name, response]) => [name, response.response.status])))
      .toEqual({
        listContestEntries: 403,
        getContestEntry: 403,
        getGolfContestLeaderboard: 403,
        getDraftState: 403,
        listContests: 403,
      });
    for (const response of Object.values(reads)) {
      expectFunctionalError(response, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
    }
  });

  it('still serves those reads to a league member', async () => {
    const { commissioner, member, league, contestId } = await buildContestWithMemberAndOutsider();
    const entered = await enterContest({ client: commissioner.client, path: { contestId } });
    const entryId = entered.data?.entry.id as string;

    expect((await listContestEntries({ client: member.client, path: { contestId } })).response.status).toBe(200);
    expect((await getContestEntry({ client: member.client, path: { contestId, entryId } })).response.status).toBe(200);
    expect((await listContests({ client: member.client, path: { id: league.id } })).response.status).toBe(200);
    // Past the gate, the golf leaderboard refuses a DRAFT contest on its own terms: 400, not 403.
    expectFunctionalError(
      await getGolfContestLeaderboard({ client: member.client, path: { contestId } }),
      { status: 400, code: 'CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN' },
    );
  });

  it('refuses a member removed from the league a PATCH and a DELETE of their former entry, and the entry is unchanged', async () => {
    const { commissioner, member, league, contestId } = await buildContestWithMemberAndOutsider();
    const entered = await enterContest({ client: member.client, path: { contestId } });
    expect(entered.response.status).toBe(201);
    const entryId = entered.data?.entry.id as string;
    const originalName = entered.data?.entry.name;

    const removed = await removeMember({ client: commissioner.client, path: { id: league.id, uid: member.userId } });
    expect(removed.response.status).toBe(200);

    const patchResponse = await updateContestEntry({
      client: member.client,
      path: { contestId, entryId },
      body: { name: 'Renamed After Removal', tiebreakerValue: 99 },
    });
    expectFunctionalError(patchResponse, { status: 403, code: 'LEAGUE_MEMBERSHIP_INACTIVE' });

    const deleteResponse = await leaveContest({ client: member.client, path: { contestId } });
    expectFunctionalError(deleteResponse, { status: 403, code: 'LEAGUE_MEMBERSHIP_INACTIVE' });

    const reread = await getContestEntry({ client: commissioner.client, path: { contestId, entryId } });
    expect(reread.response.status).toBe(200);
    expect(reread.data?.entry.id).toBe(entryId);
    expect(reread.data?.entry.name).toBe(originalName);
    expect(reread.data?.entry.status).toBe('ACTIVE');
    expect(reread.data?.entry.tiebreakerValue ?? null).toBeNull();
  });

  it('refuses an outsider entry into the contest with 403', async () => {
    const { outsider, contestId } = await buildContestWithMemberAndOutsider();

    expectFunctionalError(
      await enterContest({ client: outsider.client, path: { contestId } }),
      { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' },
    );
    // getMyContestEntry stays a tolerant read: no league or team means no entry, not an error.
    const mine = await getMyContestEntry({ client: outsider.client, path: { contestId } });
    expect(mine.response.status).toBe(200);
    expect(mine.data?.entry ?? null).toBeNull();
  });
});
