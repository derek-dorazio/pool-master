/**
 * Integration coverage for contest history read models.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner and challenger through real invitation routes
 * - creates its own league, contest, and entries
 * - seeds standings, results, and payouts directly through Prisma
 * - verifies history endpoints return the expected live DTO shapes
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  getPrisma,
  createTestUser,
  cleanupTestData,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  ContestType,
  InvitationStatus,
  LeagueRole,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('History Read Integration', () => {
  let ownerHeaders: Record<string, string>;
  let challengerHeaders: Record<string, string>;
  let leagueId: string;
  let contestId: string;
  let ownerEntryId: string;
  let challengerEntryId: string;
  let ownerMembershipId: string;
  let challengerMembershipId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'History Owner' });
    const challenger = await createTestUser({ displayName: 'History Challenger' });
    ownerHeaders = owner.headers;
    challengerHeaders = challenger.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'History League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });
    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: ownerHeaders,
      payload: {
        emails: [challenger.user.email],
      },
    });
    expect(inviteRes.statusCode).toBe(201);
    expect(inviteRes.json().sent[0].status).toBe(InvitationStatus.PENDING);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: challengerHeaders,
      payload: {
        inviteCode: inviteRes.json().sent[0].inviteCode,
      },
    });
    expect(acceptRes.statusCode).toBe(201);
    challengerMembershipId = acceptRes.json().membership.id;
    expect(acceptRes.json().membership.role).toBe(LeagueRole.MANAGER);

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'History Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        selectionConfig: {
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
    contestId = contestRes.json().contest.id;

    const ownerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect([200, 201]).toContain(ownerEntryRes.statusCode);
    ownerEntryId = ownerEntryRes.json().entry.id;
    ownerMembershipId = ownerEntryRes.json().entry.leagueMembershipId;

    const challengerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(challengerHeaders),
    });
    expect([200, 201]).toContain(challengerEntryRes.statusCode);
    challengerEntryId = challengerEntryRes.json().entry.id;

    const prisma = getPrisma();
    await prisma.contestStanding.createMany({
      data: [
        {
          contestId,
          entryId: ownerEntryId,
          rank: 2,
          totalScore: 84.5,
          lastUpdatedAt: new Date('2026-04-03T12:00:00Z'),
        },
        {
          contestId,
          entryId: challengerEntryId,
          rank: 1,
          totalScore: 91.25,
          lastUpdatedAt: new Date('2026-04-03T12:00:00Z'),
        },
      ],
    });

    await prisma.contestResult.createMany({
      data: [
        {
          contestId,
          entryId: challengerEntryId,
          finalRank: 1,
          totalScore: 91.25,
          prizeAmount: 250,
          leagueId,
          leagueMembershipId: challengerMembershipId,
          contestName: 'History Contest',
          contestType: ContestType.SINGLE_EVENT,
          sport: 'GOLF',
          numEntries: 2,
          isWinner: true,
          isPaidPosition: true,
          entryFeePaid: 25,
          prizeLabel: 'Winner',
          netResult: 225,
          percentileRank: 100,
          pointsBehindWinner: 0,
          pointsBehindNext: 0,
          closedAt: new Date('2026-04-03T13:00:00Z'),
        },
        {
          contestId,
          entryId: ownerEntryId,
          finalRank: 2,
          totalScore: 84.5,
          prizeAmount: 0,
          leagueId,
          leagueMembershipId: ownerMembershipId,
          contestName: 'History Contest',
          contestType: ContestType.SINGLE_EVENT,
          sport: 'GOLF',
          numEntries: 2,
          isWinner: false,
          isPaidPosition: false,
          entryFeePaid: 25,
          prizeLabel: 'Runner-up',
          netResult: -25,
          percentileRank: 50,
          pointsBehindWinner: 6.75,
          pointsBehindNext: 6.75,
          closedAt: new Date('2026-04-03T13:00:00Z'),
        },
      ],
    });

    await prisma.payoutHistory.create({
      data: {
        contestId,
        leagueId,
        entryId: challengerEntryId,
        leagueMembershipId: challengerMembershipId,
        prizeType: 'CASH',
        prizeLabel: 'Winner',
        prizeRank: 1,
        amount: 250,
        isCash: true,
        acknowledgedByMember: false,
      },
    });
  });

  it('returns contest history summary, standings, payouts, and league results from persisted snapshots', async () => {
    const summaryRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/summary`,
      headers: ownerHeaders,
    });

    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.json().contestId).toBe(contestId);
    expect(summaryRes.json().contestName).toBe('History Contest');
    expect(summaryRes.json().finalStandings).toHaveLength(2);
    expect(summaryRes.json().payouts).toHaveLength(1);
    expect(summaryRes.json().highlights).toEqual(
      expect.objectContaining({
        winnerMargin: 6.75,
      }),
    );

    const standingsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/standings`,
      headers: ownerHeaders,
    });

    expect(standingsRes.statusCode).toBe(200);
    expect(standingsRes.json().standings).toHaveLength(2);
    expect(standingsRes.json().standings[0]).toEqual(
      expect.objectContaining({
        contestId,
        entryId: challengerEntryId,
        finalRank: 1,
        leagueMembershipId: challengerMembershipId,
      }),
    );

    const payoutsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/payouts`,
      headers: ownerHeaders,
    });

    expect(payoutsRes.statusCode).toBe(200);
    expect(payoutsRes.json().payouts).toHaveLength(1);
    expect(payoutsRes.json().payouts[0]).toEqual(
      expect.objectContaining({
        contestId,
        leagueId,
        entryId: challengerEntryId,
        amount: 250,
      }),
    );

    const leagueResultsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/history/results`,
      headers: ownerHeaders,
    });

    expect(leagueResultsRes.statusCode).toBe(200);
    expect(leagueResultsRes.json().results).toHaveLength(2);
    expect(leagueResultsRes.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contestId,
          finalRank: 1,
          leagueId,
          isWinner: true,
        }),
      ]),
    );
  });
});
