/**
 * Integration coverage for first-pass contest history reads.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner and challenger through real invitation routes
 * - creates its own league, contest, and entries
 * - seeds completed-contest standings, prizes, roster picks, and participant performance
 * - verifies retained history endpoints read from the core contest model
 */
import {
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
  LeagueVisibility,
  ParticipantType,
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
  let challengerEntryId: string;
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
    const ownerEntryId = ownerEntryRes.json().entry.id;

    const challengerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(challengerHeaders),
    });
    expect([200, 201]).toContain(challengerEntryRes.statusCode);
    challengerEntryId = challengerEntryRes.json().entry.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `History Read Golf ${contestId.slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        statSchema: {},
      },
    });

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: 'History Golfer',
        participantType: ParticipantType.INDIVIDUAL,
        metadata: {},
        externalIds: {},
      },
    });

    const sportEvent = await prisma.sportEvent.create({
      data: {
        sport: 'GOLF',
        providerId: 'integration-test',
        externalId: `history-read-event-${contestId}`,
        name: 'History Event',
        status: 'COMPLETED',
        startDate: new Date('2026-04-03T12:00:00Z'),
      },
    });

    await prisma.contest.update({
      where: { id: contestId },
      data: {
        status: 'COMPLETED',
        sportEventId: sportEvent.id,
        startsAt: new Date('2026-04-03T12:00:00Z'),
        endsAt: new Date('2026-04-03T13:00:00Z'),
      },
    });

    await prisma.contestEntry.update({
      where: { id: challengerEntryId },
      data: { totalScore: 91.25, standingsPosition: 1 },
    });
    await prisma.contestEntry.update({
      where: { id: ownerEntryId },
      data: { totalScore: 84.5, standingsPosition: 2 },
    });

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });

    await prisma.sportEventParticipantSourceData.create({
      data: {
        sportEventParticipantId: sportEventParticipant.id,
        providerId: 'integration-test',
        externalId: participant.id,
        rawPayload: { finishPosition: 1 },
        normalizedData: { scoreToPar: -8, finishPosition: 1 },
        receivedAt: new Date('2026-04-03T13:00:00Z'),
      },
    });

    await prisma.rosterPick.create({
      data: {
        entryId: challengerEntryId,
        sportEventParticipantId: sportEventParticipant.id,
        pickedAt: new Date('2026-04-03T12:05:00Z'),
        autoPicked: false,
      },
    });

    const configuration = await prisma.contestConfiguration.findUniqueOrThrow({
      where: { contestId },
    });

    const prizeDefinition = await prisma.contestPrizeDefinition.create({
      data: {
        contestConfigurationId: configuration.id,
        prizeDefinitionId: 'FINAL_PLACE',
        displayName: 'Winner',
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
        displayName: 'Winner',
        amount: 250,
        awardedAt: new Date('2026-04-03T13:00:00Z'),
      },
    });
  });

  it('returns contest summary, standings, payouts, and roster detail from the core contest model', async () => {
    const summaryRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/summary`,
      headers: ownerHeaders,
    });

    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.json()).toEqual(
      expect.objectContaining({
        contestId,
        contestName: 'History Contest',
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
          prizeLabel: 'Winner',
        }),
      ]),
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
        prizeType: 'FINAL_STANDING',
        prizeLabel: 'Winner',
        amount: 250,
      }),
    );

    const rosterRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/roster/${challengerEntryId}`,
      headers: ownerHeaders,
    });

    expect(rosterRes.statusCode).toBe(200);
    expect(rosterRes.json().rosterHistory).toEqual(
      expect.objectContaining({
        contestId,
        entryId: challengerEntryId,
        rosterPicks: [
          expect.objectContaining({
            participantName: 'History Golfer',
            latestPerformance: expect.objectContaining({
              scoreToPar: -8,
              finishPosition: 1,
            }),
          }),
        ],
      }),
    );
  });
});
