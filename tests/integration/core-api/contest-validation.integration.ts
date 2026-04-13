import {
  buildCreateLeaguePayload,
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  ContestType,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest Validation Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Contest Validation Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: buildCreateLeaguePayload('Contest Validation League'),
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;
  });

  it('rejects tiered contest creation when tier configuration is missing and does not persist a contest', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Broken Tiered Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          tierAssignmentMethod: 'ODDS',
          rounds: 6,
        },
      },
    });

    expect(createRes.statusCode).toBe(400);
    const body = createRes.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('CONTEST_TIER_CONFIGURATION_REQUIRED');
    expect(body.error.message).toBe('Tiered contests require tier configuration');

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().contests).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: 'Broken Tiered Contest' }),
      ]),
    );
  });

  it.each([
    SelectionType.OPEN_SELECTION,
    SelectionType.PICK_EM,
    SelectionType.BRACKET_PICK_EM,
  ])('rejects deferred contest mode %s at the create contract boundary', async (selectionType) => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: `Deferred ${selectionType}`,
        contestType: ContestType.SINGLE_EVENT,
        selectionType,
        scoringEngine: ScoringEngine.STROKE_PLAY,
      },
    });

    expect(createRes.statusCode).toBe(400);
    expect(JSON.stringify(createRes.json())).toContain('selectionType');

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().contests).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: `Deferred ${selectionType}` }),
      ]),
    );
  });
});
