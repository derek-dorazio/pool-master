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
        releaseAt: new Date('2026-04-10T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    sportEventId = sportEvent.id;
  });

  it('creates, reads, and updates golf-first contest management configuration', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Pick 6',
        sportEventId,
        contestType: 'SINGLE_EVENT',
        configuration: {
          mode: 'GOLF_TIERED',
          locksAt: '2026-04-10T11:30:00.000Z',
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          countedScores: 4,
          tierSource: 'ODDS',
          tierGeneration: {
            defaultTierSize: 10,
          },
          tiers: [
            {
              tierKey: 'A',
              label: 'Tier A',
              pickCount: 1,
              startPosition: 1,
              endPosition: 10,
            },
          ],
          cutRule: {
            type: 'FIXED_SCORE',
            fixedScore: 80,
          },
          playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
          displayScoring: 'TO_PAR',
          tiebreaker: {
            type: 'PREDICT_WINNING_SCORE',
          },
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json().contest;
    contestId = createdContest.id;
    expect(createdContest.status).toBe(ContestStatus.OPEN);
    expect(createdContest.sportEventId).toBe(sportEventId);
    expect(createdContest.configuration.mode).toBe('GOLF_TIERED');
    expect(createdContest.configuration.countedScores).toBe(4);

    const getRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contestManagement.detail(leagueId, contestId),
      headers: ownerHeaders,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().contest.id).toBe(contestId);
    expect(getRes.json().contest.configuration.tiebreaker.type).toBe(
      'PREDICT_WINNING_SCORE',
    );

    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contestManagement.configuration(leagueId, contestId),
      headers: ownerHeaders,
      payload: {
        mode: 'GOLF_CATEGORY_PICKS',
        locksAt: '2026-04-10T11:45:00.000Z',
        maxEntriesPerSquad: null,
        categories: [
          {
            categoryKey: 'ROOKIE',
            label: 'Rookie',
            pickCount: 1,
          },
          {
            categoryKey: 'US_PLAYER',
            label: 'US Player',
            pickCount: 1,
          },
        ],
        cutRule: {
          type: 'FIXED_SCORE',
          fixedScore: 82,
        },
        playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
        displayScoring: 'TO_PAR',
        tiebreaker: {
          type: 'PREDICT_WINNING_SCORE',
        },
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedContest = updateRes.json().contest;
    expect(updatedContest.configuration.mode).toBe('GOLF_CATEGORY_PICKS');
    expect(updatedContest.configuration.categories).toHaveLength(2);
    expect(updatedContest.configuration.cutRule.fixedScore).toBe(82);

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId },
      include: {
        participantScoringRules: true,
        entryAggregationRule: true,
      },
    });

    expect(configuration.configMode).toBe('GOLF_CATEGORY_PICKS');
    expect(configuration.entryAggregationRule?.aggregationDefinitionId).toBe(
      'SUM_ALL_ENTRIES',
    );
    expect(configuration.participantScoringRules).toHaveLength(1);
  });

  it('lists seeded templates and creates a contest from a selected template', async () => {
    const templateRes = await getApp().inject({
      method: 'GET',
      url: `${API_ROUTES.contestManagement.templates(leagueId)}?sport=GOLF&contestType=SINGLE_EVENT`,
      headers: ownerHeaders,
    });

    expect(templateRes.statusCode).toBe(200);
    const templates = templateRes.json().templates;
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].configuration.mode).toBeTruthy();

    const defaultTemplate = templates.find(
      (template: { isDefault: boolean }) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Template Contest',
        sportEventId,
        contestType: 'SINGLE_EVENT',
        templateId: defaultTemplate.id,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json().contest;
    expect(createdContest.status).toBe(ContestStatus.OPEN);
    expect(createdContest.templateId).toBe(defaultTemplate.id);
    expect(createdContest.templateVersion).toBe(1);
    expect(createdContest.configuration.mode).toBe(defaultTemplate.configuration.mode);

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId: createdContest.id },
    });
    expect(configuration.templateId).toBe(defaultTemplate.id);
    expect(configuration.templateVersion).toBe(1);
  });

  it('rejects unsupported legacy contest-management payloads', async () => {
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
        },
      },
    });

    expect(createRes.statusCode).toBe(400);
    const body = createRes.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });
});
