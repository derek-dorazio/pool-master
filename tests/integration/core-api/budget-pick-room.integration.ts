/**
 * Integration coverage for the supported budget-pick room flow.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner user
 * - creates its own league and contest through the real routes
 * - seeds a tiny contest pool with real participant records directly
 * - reads the room state
 * - submits a budget pick through the real draft route
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

describe('Budget Pick Room Integration', () => {
  const createdParticipantIds: string[] = [];
  let createdSportId: string | null = null;
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let contestId: string;
  let entryId: string;
  let firstParticipantId: string;
  let firstParticipantPrice: number;
  let secondParticipantId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Budget Room Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Budget Room League',
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
        name: 'Budget Room Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        selectionConfig: {
          rosterSize: 1,
          budget: 8000,
          pricingMethod: 'WORLD_RANKING',
          isExclusive: true,
        },
      },
    });

    expect(contestRes.statusCode).toBe(201);
    const contest = contestRes.json().contest ?? contestRes.json();
    contestId = contest.id;

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
        name: `INTEGRATION_BUDGET_GOLF_${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        statSchema: {},
      },
    });
    createdSportId = sport.id;

    const firstParticipant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Budget Golfer ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantIds.push(firstParticipant.id);
    firstParticipantId = firstParticipant.id;
    firstParticipantPrice = 3200;

    const secondParticipant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Budget Golfer ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantIds.push(secondParticipant.id);
    secondParticipantId = secondParticipant.id;

    const pool = await prisma.contestPool.create({
      data: {
        contestId,
        sport: 'GOLF',
        poolType: 'CUSTOM',
        config: {},
      },
    });

    await prisma.contestParticipantPool.createMany({
      data: [
        {
          poolId: pool.id,
          contestId,
          participantId: firstParticipantId,
          cost: firstParticipantPrice,
          tier: null,
          tierAssignmentMethod: 'MANUAL',
          ranking: 1,
          isAvailable: true,
        },
        {
          poolId: pool.id,
          contestId,
          participantId: secondParticipantId,
          cost: 5100,
          tier: null,
          tierAssignmentMethod: 'MANUAL',
          ranking: 2,
          isAvailable: true,
        },
      ],
    });
  });

  afterAll(async () => {
    const prisma = getPrisma();
    if (createdParticipantIds.length > 0) {
      await prisma.participant.deleteMany({
        where: { id: { in: createdParticipantIds } },
      }).catch(() => {});
    }
    if (createdSportId) {
      await prisma.sport.delete({
        where: { id: createdSportId },
      }).catch(() => {});
    }
  });

  it('reads budget room state, submits a pick, and returns the updated room with prices', async () => {
    const roomRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.drafts.state(contestId),
      headers: ownerHeaders,
    });

    expect(roomRes.statusCode).toBe(200);
    expect(roomRes.json().contestId).toBe(contestId);
    expect(roomRes.json().selectionType).toBe(SelectionType.BUDGET_PICK);
    expect(roomRes.json().myEntryId).toBe(entryId);
    expect(roomRes.json().selectionConfig?.budget).toBe(8000);
    expect(roomRes.json().selectionConfig?.pricingMethod).toBe('WORLD_RANKING');
    expect(roomRes.json().selectionConfig?.rosterSize).toBe(1);
    expect(roomRes.json().availableParticipantIds).toEqual(
      expect.arrayContaining([firstParticipantId, secondParticipantId]),
    );

    const submitRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.drafts.pick(contestId),
      headers: ownerHeaders,
      payload: {
        entryId,
        participantId: firstParticipantId,
      },
    });

    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().contestId).toBe(contestId);
    expect(submitRes.json().selectionType).toBe(SelectionType.BUDGET_PICK);
    expect(submitRes.json().picks).toHaveLength(1);
    expect(submitRes.json().picks[0]).toEqual(
      expect.objectContaining({
        entryId,
        participantId: firstParticipantId,
        price: firstParticipantPrice,
      }),
    );
    expect(submitRes.json().isComplete).toBe(true);

    const afterPickRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.drafts.state(contestId),
      headers: ownerHeaders,
    });

    expect(afterPickRes.statusCode).toBe(200);
    expect(afterPickRes.json().picks).toHaveLength(1);
    expect(afterPickRes.json().picks[0]).toEqual(
      expect.objectContaining({
        entryId,
        participantId: firstParticipantId,
        price: firstParticipantPrice,
      }),
    );
    expect(afterPickRes.json().availableParticipantIds).not.toContain(firstParticipantId);
    expect(afterPickRes.json().availableParticipantIds).toContain(secondParticipantId);
    expect(afterPickRes.json().isComplete).toBe(true);
  });
});
