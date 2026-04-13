import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest management integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let sportEventId: string;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({
      displayName: 'Contest Management Owner',
    });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: buildCreateLeaguePayload('Contest Management League'),
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const sportEvent = await getPrisma().sportEvent.create({
      data: {
        externalId: `masters-2026-${randomUUID().slice(0, 8)}`,
        providerId: 'PGA',
        sport: Sport.GOLF,
        name: 'Masters Tournament 2026',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    sportEventId = sportEvent.id;
  });

  it('creates, reads, and updates contest management configuration', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Pick 6',
        sportEventId,
        contestType: 'SINGLE_EVENT',
        configuration: {
          selectionType: 'BUDGET_PICK',
          locksAt: '2026-04-10T11:30:00.000Z',
          minimumEntries: 1,
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          totalPrizePoolAmount: 500,
          participantScoringRules: [
            {
              participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
              sortOrder: 1,
              config: { missedCutPenalty: 10 },
              active: true,
            },
          ],
          entryAggregationRule: {
            aggregationDefinitionId: 'SUM_ALL_ENTRIES',
            config: {},
            active: true,
          },
          prizeDefinitions: [
            {
              prizeDefinitionId: 'FINAL_PLACE',
              displayName: 'First Place',
              sortOrder: 1,
              ruleConfig: { place: 1 },
              payoutType: 'PERCENTAGE',
              percentage: 60,
              active: true,
            },
          ],
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json().contest;
    contestId = createdContest.id;
    expect(createdContest.status).toBe(ContestStatus.DRAFT);
    expect(createdContest.sportEventId).toBe(sportEventId);
    expect(createdContest.configuration.participantScoringRules).toHaveLength(1);
    expect(createdContest.configuration.entryAggregationRule.aggregationDefinitionId).toBe(
      'SUM_ALL_ENTRIES',
    );

    const getRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contestManagement.detail(leagueId, contestId),
      headers: ownerHeaders,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().contest.id).toBe(contestId);
    expect(getRes.json().contest.configuration.prizeDefinitions[0].displayName).toBe(
      'First Place',
    );

    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contestManagement.configuration(leagueId, contestId),
      headers: ownerHeaders,
      payload: {
        selectionType: 'TIERED',
        locksAt: '2026-04-10T11:45:00.000Z',
        minimumEntries: 2,
        maxEntriesPerSquad: 2,
        rosterSize: 8,
        totalPrizePoolAmount: 1000,
        participantScoringRules: [
          {
            participantScoringDefinitionId: 'TEAM_WIN_POINTS',
            sortOrder: 1,
            config: { pointsPerWin: 1 },
            active: true,
          },
          {
            participantScoringDefinitionId: 'ROUND_MULTIPLIER',
            sortOrder: 2,
            config: { roundMultipliers: { '1': 1, '2': 2 } },
            active: true,
          },
        ],
        entryAggregationRule: {
          aggregationDefinitionId: 'SUM_TOP_N_ENTRIES',
          config: { topN: 4 },
          active: true,
        },
        prizeDefinitions: [
          {
            prizeDefinitionId: 'FINAL_PLACE',
            displayName: 'Champion',
            sortOrder: 1,
            ruleConfig: { place: 1 },
            payoutType: 'FIXED_AMOUNT',
            amount: 400,
            active: true,
          },
        ],
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedContest = updateRes.json().contest;
    expect(updatedContest.configuration.selectionType).toBe('TIERED');
    expect(updatedContest.configuration.rosterSize).toBe(8);
    expect(updatedContest.configuration.participantScoringRules).toHaveLength(2);
    expect(updatedContest.configuration.entryAggregationRule.aggregationDefinitionId).toBe(
      'SUM_TOP_N_ENTRIES',
    );
    expect(updatedContest.configuration.prizeDefinitions[0].displayName).toBe(
      'Champion',
    );

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId },
      include: {
        participantScoringRules: true,
        entryAggregationRule: true,
        prizeDefinitions: true,
      },
    });

    expect(configuration.selectionType).toBe('TIERED');
    expect(configuration.participantScoringRules).toHaveLength(2);
    expect(configuration.entryAggregationRule?.aggregationDefinitionId).toBe(
      'SUM_TOP_N_ENTRIES',
    );
    expect(configuration.prizeDefinitions).toHaveLength(1);
    expect(configuration.prizeDefinitions[0]?.displayName).toBe('Champion');
  });

  it('rejects duplicate participant scoring sort order values', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Invalid Masters Pick 6',
        sportEventId,
        contestType: 'SINGLE_EVENT',
        configuration: {
          selectionType: 'BUDGET_PICK',
          rosterSize: 6,
          minimumEntries: 1,
          maxEntriesPerSquad: 3,
          participantScoringRules: [
            {
              participantScoringDefinitionId: 'TEAM_WIN_POINTS',
              sortOrder: 1,
              config: {},
              active: true,
            },
            {
              participantScoringDefinitionId: 'ROUND_MULTIPLIER',
              sortOrder: 1,
              config: {},
              active: true,
            },
          ],
          entryAggregationRule: {
            aggregationDefinitionId: 'SUM_ALL_ENTRIES',
            config: {},
            active: true,
          },
          prizeDefinitions: [
            {
              prizeDefinitionId: 'FINAL_PLACE',
              displayName: 'Champion',
              sortOrder: 1,
              ruleConfig: { place: 1 },
              payoutType: 'FIXED_AMOUNT',
              amount: 100,
              active: true,
            },
          ],
        },
      },
    });

    expect(createRes.statusCode).toBe(422);
    const body = createRes.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('CONTEST_CONFIGURATION_INVALID');
    expect(body.error.message).toBe(
      'Participant scoring rules must have unique sortOrder values',
    );
  });
});
