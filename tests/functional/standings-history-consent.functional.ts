import {
  acceptInvitation,
  createContest,
  closeContest,
  getContestHistoryStandings,
  getContestHistorySummary,
  getLeagueResults,
  getMemberResults,
  getMyStandingsEntry,
  getStandings,
  getStandingsSummary,
  generateInviteLink,
  enterContest,
} from '@poolmaster/shared/generated/hey-api';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getSdkClient,
  getFunctionalPrisma,
} from './setup';

type HistoryFixture = Awaited<ReturnType<typeof seedCompletedContestFixture>>;

let currentFixture: HistoryFixture | undefined;

async function cleanupHistoryFixture(fixture: HistoryFixture): Promise<void> {
  const prisma = getFunctionalPrisma();

  await prisma.leagueInvitation.deleteMany({
    where: {
      leagueId: fixture.leagueId,
    },
  });
  await prisma.leagueMembership.deleteMany({
    where: {
      leagueId: fixture.leagueId,
    },
  });
  await prisma.contestEntry.deleteMany({
    where: {
      contestId: fixture.contestId,
    },
  });
  await prisma.contestConfiguration.deleteMany({
    where: {
      contestId: fixture.contestId,
    },
  });
  await prisma.draftSession.deleteMany({
    where: {
      contestId: fixture.contestId,
    },
  });
  await prisma.contest.deleteMany({
    where: {
      id: fixture.contestId,
    },
  });
  await prisma.squadMembership.deleteMany({
    where: {
      leagueId: fixture.leagueId,
    },
  });
  await prisma.squad.deleteMany({
    where: {
      leagueId: fixture.leagueId,
    },
  });
  await prisma.league.deleteMany({
    where: {
      id: fixture.leagueId,
    },
  });
  await prisma.refreshToken.deleteMany({
    where: {
      userId: {
        in: [fixture.commissioner.userId, fixture.challenger.userId],
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [fixture.commissioner.userId, fixture.challenger.userId],
      },
    },
  });
}

afterEach(async () => {
  if (currentFixture) {
    await cleanupHistoryFixture(currentFixture);
    currentFixture = undefined;
  }
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

async function seedCompletedContestFixture() {
  const { league, commissioner } = await buildLeagueWithCommissioner({
    displayName: 'History Commissioner',
    leagueName: 'History Functional League',
  });
  const challenger = await buildRegisteredUser({
    displayName: 'History Challenger',
  });

  const invitationResponse = await generateInviteLink({
    client: commissioner.client,
    path: {
      id: league.id,
    },
    body: {
      maxUses: 1,
      expiresInDays: 7,
    },
  });

  if (!invitationResponse.data) {
    throw new Error('Builder: generateInviteLink failed for history functional fixture');
  }

  const acceptResponse = await acceptInvitation({
    client: challenger.client,
    body: {
      inviteCode: invitationResponse.data.invitation.inviteCode,
    },
  });

  if (!acceptResponse.data) {
    throw new Error('Builder: acceptInvitation failed for history functional fixture');
  }

  const contestResponse = await createContest({
    client: commissioner.client,
    path: {
      id: league.id,
    },
    body: {
      name: 'History Functional Contest',
      contestType: 'SINGLE_EVENT',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
      contestConfiguration: {
        rounds: 1,
        tierAssignmentMethod: 'AUTO_ODDS',
        tierConfig: [
          {
            tierId: 'tier-1',
            tierName: 'Tier 1',
            tierNumber: 1,
            picksFromTier: 1,
            participantIds: [],
          },
        ],
      },
    },
  });

  if (!contestResponse.data) {
    throw new Error('Builder: createContest failed for history functional fixture');
  }

  const contestId = contestResponse.data.contest.id;

  const commissionerEntry = await enterContest({
    client: commissioner.client,
    path: {
      contestId,
    },
  });

  if (!commissionerEntry.data) {
    throw new Error('Builder: enterContest failed for commissioner in history functional fixture');
  }

  const challengerEntry = await enterContest({
    client: challenger.client,
    path: {
      contestId,
    },
  });

  if (!challengerEntry.data) {
    throw new Error('Builder: enterContest failed for challenger in history functional fixture');
  }

  const prisma = getFunctionalPrisma();
  await prisma.contestEntry.update({
    where: {
      id: commissionerEntry.data.entry.id,
    },
    data: {
      totalScore: 84.5,
      standingsPosition: 2,
    },
  });

  await prisma.contestEntry.update({
    where: {
      id: challengerEntry.data.entry.id,
    },
    data: {
      totalScore: 91.25,
      standingsPosition: 1,
    },
  });

  const commissionerMembership = await prisma.leagueMembership.findUniqueOrThrow({
    where: {
      leagueId_userId: {
        leagueId: league.id,
        userId: commissioner.userId,
      },
    },
  });

  const closeResponse = await closeContest({
    client: commissioner.client,
    path: {
      contestId,
    },
    body: {
      reason: 'Functional history fixture complete',
    },
  });

  expect(closeResponse.data).toBeDefined();
  expect(closeResponse.data?.contest.status).toBe('COMPLETED');

  return {
    contestId,
    leagueId: league.id,
    commissioner,
    commissionerMembershipId: commissionerMembership.id,
    commissionerEntryId: commissionerEntry.data.entry.id,
    challenger,
    challengerMembershipId: acceptResponse.data.membership.id,
    challengerEntryId: challengerEntry.data.entry.id,
  };
}

describe('SDK Functional: Standings, History, and Consent', () => {
  it('returns current standings and completed contest history through the generated SDK', async () => {
    currentFixture = await seedCompletedContestFixture();
    const fixture = currentFixture;
    if (!fixture) {
      throw new Error('History fixture was not initialized');
    }

    const standingsResponse = await getStandings({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      query: {
        page: '1',
        pageSize: '10',
        sortBy: 'score',
      },
    });

    expect(standingsResponse.data).toBeDefined();
    expect(standingsResponse.data?.contestId).toBe(fixture.contestId);
    expect(standingsResponse.data?.total).toBe(2);
    expect(standingsResponse.data?.standings).toHaveLength(2);
    expect(standingsResponse.data?.standings[0]?.entryId).toBe(fixture.challengerEntryId);
    expect(standingsResponse.data?.standings[0]?.totalScore).toBe(91.25);

    const summaryResponse = await getStandingsSummary({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      query: {
        topN: '1',
      },
    });

    expect(summaryResponse.data).toBeDefined();
    expect(summaryResponse.data?.contestId).toBe(fixture.contestId);
    expect(summaryResponse.data?.totalEntries).toBe(2);
    expect(summaryResponse.data?.topEntries).toHaveLength(1);
    expect(summaryResponse.data?.topEntries[0]?.entryId).toBe(fixture.challengerEntryId);

    const myEntryResponse = await getMyStandingsEntry({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(myEntryResponse.data).toBeDefined();
    expect(myEntryResponse.data?.contestId).toBe(fixture.contestId);
    expect(myEntryResponse.data?.entry.entryId).toBe(fixture.challengerEntryId);
    expect(myEntryResponse.data?.entry.totalScore).toBe(91.25);

    const historySummaryResponse = await getContestHistorySummary({
      client: fixture.commissioner.client,
      path: {
        id: fixture.contestId,
      },
    });

    expect(historySummaryResponse.data).toBeDefined();
    expect(historySummaryResponse.data?.contestId).toBe(fixture.contestId);
    expect(historySummaryResponse.data?.contestName).toBe('History Functional Contest');
    expect(historySummaryResponse.data?.numEntries).toBe(2);
    expect(historySummaryResponse.data?.finalStandings).toHaveLength(2);

    const historyStandingsResponse = await getContestHistoryStandings({
      client: fixture.commissioner.client,
      path: {
        id: fixture.contestId,
      },
    });

    expect(historyStandingsResponse.data).toBeDefined();
    expect(historyStandingsResponse.data?.standings).toHaveLength(2);
    expect(historyStandingsResponse.data?.standings[0]?.contestId).toBe(fixture.contestId);
    expect(historyStandingsResponse.data?.standings[0]?.entryId).toBe(fixture.challengerEntryId);

    const leagueResultsResponse = await getLeagueResults({
      client: fixture.commissioner.client,
      path: {
        id: fixture.leagueId,
      },
    });

    expect(leagueResultsResponse.data).toBeDefined();
    expect(leagueResultsResponse.data?.results).toHaveLength(2);
    expect(leagueResultsResponse.data?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contestId: fixture.contestId,
          entryId: fixture.commissionerEntryId,
          leagueMembershipId: fixture.commissionerMembershipId,
        }),
        expect.objectContaining({
          contestId: fixture.contestId,
          entryId: fixture.challengerEntryId,
          leagueMembershipId: fixture.challengerMembershipId,
        }),
      ]),
    );

    const memberResultsResponse = await getMemberResults({
      client: fixture.commissioner.client,
      path: {
        id: fixture.leagueId,
        mid: fixture.challengerMembershipId,
      },
    });

    expect(memberResultsResponse.data).toBeDefined();
    expect(memberResultsResponse.data?.results).toHaveLength(1);
    expect(memberResultsResponse.data?.results[0]?.contestId).toBe(fixture.contestId);
    expect(memberResultsResponse.data?.results[0]?.leagueMembershipId).toBe(
      fixture.challengerMembershipId,
    );
  });

  it('rejects anonymous and missing contest history reads with the expected status and error shape', async () => {
    currentFixture = await seedCompletedContestFixture();
    const fixture = currentFixture;
    if (!fixture) {
      throw new Error('History fixture was not initialized');
    }
    const anonymousClient = getSdkClient();

    const standingsResponse = await getStandings({
      client: anonymousClient,
      path: {
        contestId: fixture.contestId,
      },
    });

    expectFunctionalError(standingsResponse, {
      status: 401,
      code: 'AUTH_SESSION_REQUIRED',
    });

    const missingHistoryResponse = await getContestHistorySummary({
      client: fixture.commissioner.client,
      path: {
        id: '00000000-0000-0000-0000-000000000000',
      },
    });

    expectFunctionalError(missingHistoryResponse, {
      status: 404,
      code: 'CONTEST_HISTORY_NOT_FOUND',
    });
  });
});
