/**
 * Negative-path coverage for contest entry state transitions.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner and member users
 * - creates its own league and contests
 * - seeds a real participant and a direct roster pick when required
 * - verifies entries cannot be created after close and cannot be removed after picks
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
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  ContestStatus,
  ContestType,
  TierAssignmentMethod,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
  Sport,
  ParticipantType,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

beforeAll(() => setupIntegrationTests());

describe('Contest Entry Negative Integration', () => {
  let ownerHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;
  let leagueId: string;
  let openContestId: string;
  let closedContestId: string;
  let openContestEntryId: string;
  let createdSportId: string | null = null;
  let createdParticipantId: string | null = null;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Entry Negative Owner' });
    const member = await createTestUser({ displayName: 'Entry Negative Member' });
    ownerHeaders = owner.headers;
    memberHeaders = member.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Entry Negative League',
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
        emails: [member.user.email],
      },
    });
    expect(inviteRes.statusCode).toBe(201);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: memberHeaders,
      payload: {
        inviteCode: inviteRes.json().sent[0].inviteCode,
      },
    });
    expect(acceptRes.statusCode).toBe(201);

    const openContestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Entry Negative Open Contest',
        sport: Sport.GOLF,
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 1,
          tierAssignmentMethod: TierAssignmentMethod.ODDS,
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
    expect(openContestRes.statusCode).toBe(201);
    openContestId = openContestRes.json().contest.id;

    const closedContestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Entry Negative Closed Contest',
        sport: Sport.GOLF,
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 1,
          tierAssignmentMethod: TierAssignmentMethod.ODDS,
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
    expect(closedContestRes.statusCode).toBe(201);
    closedContestId = closedContestRes.json().contest.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `INTEGRATION_SPORT_${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        statSchema: {},
      },
    });
    createdSportId = sport.id;

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Integration Pick ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantId = participant.id;

    const sportEvent = await prisma.sportEvent.create({
      data: {
        externalId: `contest-entry-negative-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Contest Entry Negative Event',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });

    await prisma.contest.update({
      where: { id: openContestId },
      data: { sportEventId: sportEvent.id },
    });

    await prisma.contestConfiguration.update({
      where: { contestId: openContestId },
      data: {
        tierConfig: [
          {
            tierId: 'tier-1',
            tierName: 'Tier 1',
            tierNumber: 1,
            picksFromTier: 1,
            participantIds: [participant.id],
          },
        ],
      },
    });

    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: sportEventParticipant.id,
        price: 1000,
        tier: 'tier-1',
        orderIndex: 1,
        valuationSource: 'integration-test',
      },
    });

    const entryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(openContestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect([200, 201]).toContain(entryRes.statusCode);
    openContestEntryId = entryRes.json().entry.id;

    await prisma.rosterPick.create({
      data: {
        entryId: openContestEntryId,
        sportEventParticipantId: sportEventParticipant.id,
        draftRound: 1,
        draftPickNumber: 1,
        autoPicked: false,
      },
    });

    await prisma.contest.update({
      where: { id: closedContestId },
      data: {
        status: ContestStatus.LOCKED,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    if (createdParticipantId) {
      await getPrisma().participant.delete({
        where: { id: createdParticipantId },
      }).catch(() => {});
    }
    if (createdSportId) {
      await getPrisma().sport.delete({
        where: { id: createdSportId },
      }).catch(() => {});
    }
    await teardownIntegrationTests();
  });

  it('rejects entry creation after close and rejecting leaving after picks', async () => {
    const closedContestEnterRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(closedContestId),
      headers: withoutJsonBodyHeaders(memberHeaders),
    });

    expect(closedContestEnterRes.statusCode).toBe(400);
    const closedEnterBody = closedContestEnterRes.json();
    expect(ErrorEnvelopeSchema.safeParse(closedEnterBody).success).toBe(true);
    expect(closedEnterBody.error.message).toContain('before the contest starts');

    const leaveRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.contests.myEntry(openContestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect(leaveRes.statusCode).toBe(400);
    const leaveBody = leaveRes.json();
    expect(ErrorEnvelopeSchema.safeParse(leaveBody).success).toBe(true);
    expect(leaveBody.error.message).toContain('after making picks');
  });
});
