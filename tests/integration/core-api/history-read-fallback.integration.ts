import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  ContestType,
  InvitationStatus,
  LeagueRole,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('History Read Fallback Integration', () => {
  it('serves completed contest history from contest entries and prize awards when legacy snapshots do not exist', async () => {
    const owner = await createTestUser({ displayName: 'History Fallback Owner' });
    const challenger = await createTestUser({
      displayName: 'History Fallback Challenger',
    });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('History Fallback League'),
    });
    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id;

    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: owner.headers,
      payload: {
        emails: [challenger.user.email],
      },
    });
    expect(inviteRes.statusCode).toBe(201);
    expect(inviteRes.json().sent[0].status).toBe(InvitationStatus.PENDING);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: challenger.headers,
      payload: {
        inviteCode: inviteRes.json().sent[0].inviteCode,
      },
    });
    expect(acceptRes.statusCode).toBe(201);
    const challengerMembershipId = acceptRes.json().membership.id;
    expect(acceptRes.json().membership.role).toBe(LeagueRole.MEMBER);

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: owner.headers,
      payload: {
        name: 'History Fallback Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
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
    expect(contestRes.statusCode).toBe(201);
    const contestId = contestRes.json().contest.id;

    const ownerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect([200, 201]).toContain(ownerEntryRes.statusCode);
    const ownerEntryId = ownerEntryRes.json().entry.id;

    const challengerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(challenger.headers),
    });
    expect([200, 201]).toContain(challengerEntryRes.statusCode);
    const challengerEntryId = challengerEntryRes.json().entry.id;

    const prisma = getPrisma();
    const ownerMembership = await prisma.leagueMembership.findFirstOrThrow({
      where: { leagueId, userId: owner.user.id },
    });

    await prisma.contest.update({
      where: { id: contestId },
      data: {
        status: 'COMPLETED',
        startsAt: new Date('2026-04-03T12:00:00Z'),
        endsAt: new Date('2026-04-03T13:00:00Z'),
      },
    });

    await prisma.contestEntry.update({
      where: { id: challengerEntryId },
      data: {
        totalScore: 91.25,
        standingsPosition: 1,
      },
    });
    await prisma.contestEntry.update({
      where: { id: ownerEntryId },
      data: {
        totalScore: 84.5,
        standingsPosition: 2,
      },
    });

    const configuration = await prisma.contestConfiguration.findUniqueOrThrow({
      where: { contestId },
    });
    const prizeDefinition = await prisma.contestPrizeDefinition.create({
      data: {
        contestConfigurationId: configuration.id,
        prizeDefinitionId: 'FINAL_PLACE',
        displayName: 'Champion',
        sortOrder: 1,
        ruleConfig: { place: 1 },
        payoutType: 'FIXED_AMOUNT',
        amount: 250,
        active: true,
      },
    });

    await prisma.contestEntryPrizeAward.create({
      data: {
        entryId: challengerEntryId,
        contestPrizeDefinitionId: prizeDefinition.id,
        prizeDefinitionId: 'FINAL_PLACE',
        displayName: 'Champion',
        amount: 250,
        awardedAt: new Date('2026-04-03T13:00:00Z'),
      },
    });

    const summaryRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/summary`,
      headers: owner.headers,
    });
    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.json()).toEqual(
      expect.objectContaining({
        contestId,
        contestName: 'History Fallback Contest',
        numEntries: 2,
      }),
    );
    expect(summaryRes.json().finalStandings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: challengerEntryId,
          finalRank: 1,
          totalScore: 91.25,
          isWinner: true,
        }),
      ]),
    );
    expect(summaryRes.json().payouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: challengerEntryId,
          amount: 250,
          prizeLabel: 'Champion',
        }),
      ]),
    );

    const standingsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/standings`,
      headers: owner.headers,
    });
    expect(standingsRes.statusCode).toBe(200);
    expect(standingsRes.json().standings).toHaveLength(2);
    expect(standingsRes.json().standings[0]).toEqual(
      expect.objectContaining({
        contestId,
        entryId: challengerEntryId,
        finalRank: 1,
        prizeAmount: 250,
      }),
    );

    const leagueResultsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/history/results`,
      headers: owner.headers,
    });
    expect(leagueResultsRes.statusCode).toBe(200);
    expect(leagueResultsRes.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contestId,
          entryId: challengerEntryId,
          leagueId,
          finalRank: 1,
          isPaidPosition: true,
        }),
        expect.objectContaining({
          contestId,
          entryId: ownerEntryId,
          leagueId,
          finalRank: 2,
          isPaidPosition: false,
        }),
      ]),
    );

    const memberResultsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/history/members/${challengerMembershipId}/results`,
      headers: owner.headers,
    });
    expect(memberResultsRes.statusCode).toBe(200);
    expect(memberResultsRes.json().results).toHaveLength(1);
    expect(memberResultsRes.json().results[0]).toEqual(
      expect.objectContaining({
        contestId,
        entryId: challengerEntryId,
        leagueMembershipId: challengerMembershipId,
      }),
    );

    const ownerResultsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/history/members/${ownerMembership.id}/results`,
      headers: owner.headers,
    });
    expect(ownerResultsRes.statusCode).toBe(200);
    expect(ownerResultsRes.json().results).toHaveLength(1);
    expect(ownerResultsRes.json().results[0]).toEqual(
      expect.objectContaining({
        contestId,
        entryId: ownerEntryId,
        leagueMembershipId: ownerMembership.id,
      }),
    );
  });
});
