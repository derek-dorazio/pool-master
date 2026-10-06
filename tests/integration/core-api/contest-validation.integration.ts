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
import type { ContestListResponse, LeagueResponse } from '@poolmaster/shared/dto';
import {
  ContestFormat,
  SelectionType,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

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
    leagueId = leagueRes.json<LeagueResponse>().league.id;
  });

  // #245 — the one create validates its configuration against the typed tiered shape; an
  // incomplete configuration is refused at the contract and nothing is persisted.
  it('rejects a tiered create whose configuration is incomplete and does not persist a contest', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Broken Tiered Contest',
        sportEventId: randomUUID(),
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        configuration: {
          countedScores: 4,
        },
      },
    });

    expect(createRes.statusCode).toBe(400);
    const body = createRes.json<unknown>();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).toContain('rosterSize');

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json<ContestListResponse>().contests).toEqual(
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
        sportEventId: randomUUID(),
        contestFormat: ContestFormat.ROSTER,
        selectionType,
        configuration: { rosterSize: 6, countedScores: 4 },
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
    expect(listRes.json<ContestListResponse>().contests).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: `Deferred ${selectionType}` }),
      ]),
    );
  });
});
