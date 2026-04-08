/**
 * CRUD-style integration coverage for the tiered draft-room flow.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner user
 * - creates its own league, contest, and contest entry
 * - seeds event participants plus valuations through Prisma using real models
 * - reads the draft room state
 * - submits a selection through the real draft route
 * - verifies read-after-write room state
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
  ContestStatus,
  ContestType,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Draft Session Flow Integration', () => {
  const createdParticipantIds: string[] = [];
  let createdSportId: string | null = null;
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let contestId: string;
  let entryId: string;
  let participantId: string;
  let sportEventParticipantId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Draft Flow Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Draft Flow League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Draft Flow Contest',
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
    const contest = contestRes.json().contest ?? contestRes.json();
    contestId = contest.id;
    expect(contest.status).toBe(ContestStatus.DRAFT);

    const entryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect([200, 201]).toContain(entryRes.statusCode);
    entryId = entryRes.json().entry.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `INTEGRATION_GOLF_${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        statSchema: {},
      },
    });
    createdSportId = sport.id;

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Integration Contestant ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantIds.push(participant.id);
    participantId = participant.id;

    const sportEvent = await prisma.sportEvent.create({
      data: {
        externalId: `draft-flow-event-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: 'GOLF',
        name: 'Draft Flow Event',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId,
        status: 'ACTIVE',
      },
    });
    sportEventParticipantId = sportEventParticipant.id;

    await prisma.contest.update({
      where: { id: contestId },
      data: { sportEventId: sportEvent.id },
    });

    await prisma.contestConfiguration.update({
      where: { contestId },
      data: {
        tierConfig: [
          {
            tierId: 'tier-1',
            tierName: 'Tier 1',
            tierNumber: 1,
            picksFromTier: 1,
            participantIds: [participantId],
          },
        ] as object[],
      },
    });

    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId,
        price: 1200,
        tier: 'tier-1',
        orderIndex: 1,
        valuationSource: 'integration-test',
      },
    });
  });

  afterAll(async () => {
    const prisma = getPrisma();
    if (createdParticipantIds.length > 0) {
      await prisma.participant.deleteMany({
        where: {
          id: { in: createdParticipantIds },
        },
      }).catch(() => {});
    }
    if (createdSportId) {
      await prisma.sport.delete({
        where: { id: createdSportId },
      }).catch(() => {});
    }
  });

  it('reads room state, submits a pick, and returns updated tiered room state', async () => {
    const roomRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.drafts.state(contestId),
      headers: ownerHeaders,
    });

    expect(roomRes.statusCode).toBe(200);
    expect(roomRes.json().contestId).toBe(contestId);
    expect(roomRes.json().selectionType).toBe(SelectionType.TIERED);
    expect(roomRes.json().myEntryId).toBe(entryId);
    expect(roomRes.json().availableParticipantIds).toContain(sportEventParticipantId);
    expect(roomRes.json().draftPickHistories).toEqual([]);

    const submitRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.drafts.pick(contestId),
      headers: ownerHeaders,
      payload: {
        entryId,
        participantId: sportEventParticipantId,
      },
    });

    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().contestId).toBe(contestId);
    expect(submitRes.json().selectionType).toBe(SelectionType.TIERED);
    expect(submitRes.json().draftPickHistories).toHaveLength(1);
    expect(submitRes.json().draftPickHistories[0].entryId).toBe(entryId);
    expect(submitRes.json().draftPickHistories[0].participantId).toBe(sportEventParticipantId);
    expect(submitRes.json().draftPickHistories[0].tierId).toBe('tier-1');
    expect(submitRes.json().draftPickHistories[0].tierName).toBe('Tier 1');
    expect(submitRes.json().isComplete).toBe(true);

    const afterPickRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.drafts.state(contestId),
      headers: ownerHeaders,
    });

    expect(afterPickRes.statusCode).toBe(200);
    expect(afterPickRes.json().draftPickHistories).toHaveLength(1);
    expect(afterPickRes.json().draftPickHistories[0].participantId).toBe(sportEventParticipantId);
    expect(afterPickRes.json().isComplete).toBe(true);
    expect(afterPickRes.json().availableParticipantIds).toContain(sportEventParticipantId);
  });
});
