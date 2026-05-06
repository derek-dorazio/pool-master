/**
 * Integration coverage for persisted standings and final results reads.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner and second member through real invitation routes
 * - creates its own league, contest, and entries through real routes
 * - persists live entry standings on contest entries through Prisma
 * - verifies live standings endpoints and first-pass history result endpoints
 */
import {
  buildCreateLeaguePayload,
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
  InviteType,
  LeagueRole,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Standings and Results Read Integration', () => {
  let ownerHeaders: Record<string, string>;
  let ownerUserId: string;
  let ownerDisplayName: string;
  let challengerHeaders: Record<string, string>;
  let challengerUserId: string;
  let challengerDisplayName: string;
  let leagueId: string;
  let contestId: string;
  let ownerEntryId: string;
  let challengerEntryId: string;
  let challengerMembershipId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Standings Owner' });
    const challenger = await createTestUser({ displayName: 'Standings Challenger' });
    ownerHeaders = owner.headers;
    ownerUserId = owner.user.id;
    ownerDisplayName = owner.user.displayName;
    challengerHeaders = challenger.headers;
    challengerUserId = challenger.user.id;
    challengerDisplayName = challenger.user.displayName;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: buildCreateLeaguePayload('Standings Read League'),
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
    expect(inviteRes.json().sent).toHaveLength(1);
    expect(inviteRes.json().sent[0].inviteType).toBe(InviteType.EMAIL);
    expect(inviteRes.json().sent[0].status).toBe(InvitationStatus.PENDING);

    const acceptInviteRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: challengerHeaders,
      payload: {
        inviteCode: inviteRes.json().sent[0].inviteCode,
      },
    });

    expect(acceptInviteRes.statusCode).toBe(201);
    challengerMembershipId = acceptInviteRes.json().membership.id;
    expect(acceptInviteRes.json().membership.role).toBe(LeagueRole.MEMBER);

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Standings Read Contest',
        sport: 'GOLF',
        contestType: ContestFormat.ROSTER,
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
    contestId = contestRes.json().contest.id;

    const ownerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect([200, 201]).toContain(ownerEntryRes.statusCode);
    ownerEntryId = ownerEntryRes.json().entry.id;

    const challengerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(challengerHeaders),
    });
    expect([200, 201]).toContain(challengerEntryRes.statusCode);
    challengerEntryId = challengerEntryRes.json().entry.id;

    const prisma = getPrisma();

    await prisma.contestEntry.update({
      where: { id: ownerEntryId },
      data: {
        totalScore: 88.25,
        standingsPosition: 2,
      },
    });
    await prisma.contestEntry.update({
      where: { id: challengerEntryId },
      data: {
        totalScore: 92.5,
        standingsPosition: 1,
      },
    });

    await prisma.contest.update({
      where: { id: contestId },
      data: {
        status: 'COMPLETED',
        startsAt: new Date('2026-04-03T12:00:00Z'),
        endsAt: new Date('2026-04-03T13:00:00Z'),
      },
    });
  });

  it('returns live standings, summary, my-entry context, and historical results from contest entries', async () => {
    const standingsRes = await getApp().inject({
      method: 'GET',
      url: `${API_ROUTES.contests.standings(contestId)}?page=1&pageSize=10&sortBy=rank`,
      headers: ownerHeaders,
    });

    expect(standingsRes.statusCode).toBe(200);
    expect(standingsRes.json().contestId).toBe(contestId);
    expect(standingsRes.json().total).toBe(2);
    expect(standingsRes.json().standings).toHaveLength(2);
    expect(standingsRes.json().standings[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        entryId: challengerEntryId,
        ownerId: challengerUserId,
        ownerDisplayName: challengerDisplayName,
        totalScore: 92.5,
        movement: 'same',
      }),
    );

    const summaryRes = await getApp().inject({
      method: 'GET',
      url: `${API_ROUTES.contests.standings(contestId)}/summary?topN=1`,
      headers: ownerHeaders,
    });

    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.json().contestId).toBe(contestId);
    expect(summaryRes.json().totalEntries).toBe(2);
    expect(summaryRes.json().topEntries).toHaveLength(1);
    expect(summaryRes.json().topEntries[0].entryId).toBe(challengerEntryId);

    const myEntryRes = await getApp().inject({
      method: 'GET',
      url: `${API_ROUTES.contests.standings(contestId)}/my-entry`,
      headers: ownerHeaders,
    });

    expect(myEntryRes.statusCode).toBe(200);
    expect(myEntryRes.json().contestId).toBe(contestId);
    expect(myEntryRes.json().totalEntries).toBe(2);
    expect(myEntryRes.json().entry).toEqual(
      expect.objectContaining({
        entryId: ownerEntryId,
        ownerId: ownerUserId,
        ownerDisplayName: ownerDisplayName,
        rank: 2,
        totalScore: 88.25,
      }),
    );

    const historyStandingsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/standings`,
      headers: ownerHeaders,
    });

    expect(historyStandingsRes.statusCode).toBe(200);
    expect(historyStandingsRes.json().standings).toHaveLength(2);
    expect(historyStandingsRes.json().standings[0]).toEqual(
      expect.objectContaining({
        contestId,
        entryId: challengerEntryId,
        finalRank: 1,
        totalScore: 92.5,
        leagueId,
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

    const memberResultsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/history/members/${challengerMembershipId}/results`,
      headers: ownerHeaders,
    });

    expect(memberResultsRes.statusCode).toBe(200);
    expect(memberResultsRes.json().results).toHaveLength(1);
    expect(memberResultsRes.json().results[0]).toEqual(
      expect.objectContaining({
        contestId,
        entryId: challengerEntryId,
        finalRank: 1,
        leagueMembershipId: challengerMembershipId,
      }),
    );
  });
});
